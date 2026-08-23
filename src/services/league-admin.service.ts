import "server-only";

import { players as legacyPlayers } from "@/data/players";
import { teams as legacyTeams } from "@/data/teams";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { calculateStandings } from "@/lib/standings-calculator";
import {
  calculateSeriesProgression,
  calculateSeriesRoundWindow,
  type SeriesProgressionMaterializedGame,
  type SeriesProgressionPlanningSlot,
  type SeriesProgressionTransferredGame,
} from "@/lib/series-progression";
import {
  resolveSeriesCarryOver,
  type SeriesCarryOverMatchupResolution,
  type SeriesCarryOverPhaseLike,
  type SeriesCarryOverTeamLike,
  type SeriesPhaseCompletion,
  type SeriesPhaseCompletionBlocker,
} from "@/lib/series-carry-over";
import {
  deriveSeriesPhaseCompletion,
  resolveFinalizedSeriesOutcomeReference,
} from "@/lib/series-phase-completion";
import {
  createEntityId,
  findAutomaticPlayerMatch,
  normalizePlayerName,
} from "@/lib/player-matching";
import {
  hasPhaseProgramStarted,
  type PhaseProgramGameStartEvidence,
} from "@/lib/phase-program-delete-policy";
import {
  planSeriesResultTransition,
  type SeriesResultDownstreamGame,
} from "@/lib/series-result-progression";
import {
  generateRoundRobinDryRun,
  generateRoundRobinFixturePlan,
} from "@/services/round-robin-generator";
import type { D1DatabaseBinding } from "@/types/cloudflare";

const HISTORICAL_SEASONS = [
  "2019-20",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
];

type DbRow = Record<string, unknown>;

type CanonicalSeriesGameRow = {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string | null;
  series_matchup_id: string | null;
  series_round_number: number | null;
  cycle_number: number | null;
  round_number: number | null;
  game_order: number | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  result_source: string | null;
  video_url: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  venue: string | null;
};

type CanonicalSeriesCompletionSnapshot = {
  phases: SeriesCarryOverPhaseLike[];
  games: CanonicalSeriesGameRow[];
  teams: SeriesCarryOverTeamLike[];
};

const SEASON_STATUSES = new Set(["draft", "active", "completed"]);
const COMPETITION_TYPES = new Set(["league", "cup", "tournament"]);
const COMPETITION_LIFECYCLES = new Set(["under_construction", "online", "complete"]);
const PARTICIPATION_STATUSES = new Set(["active", "inactive", "withdrawn"]);
const COMPLETED_COMPETITION_STATUSES = new Set(["complete", "completed", "finished"]);
const STAFF_ROLE_VALUES = [
  "head_coach",
  "assistant_coach",
  "trainer",
  "physiotherapist",
  "doctor",
  "team_manager",
  "team_official",
  "other",
 ] as const;
const STAFF_ROLES = new Set<string>(STAFF_ROLE_VALUES);
const PHASE_FORMATS = new Set(["standings", "series", "custom"]);
const PHASE_FORMAT_TO_LEGACY_KIND: Record<string, string> = {
  standings: "regular_season",
  series: "play_in",
  custom: "custom",
};
const PHASE_KIND_TO_FORMAT: Record<string, string> = {
  regular: "standings",
  regular_season: "standings",
  play_in: "series",
  play_out: "series",
  playoffs: "series",
  final_four: "series",
  finals: "series",
  custom: "custom",
  standings: "standings",
  series: "series",
  knockout: "series",
};
const STANDINGS_TIE_BREAKER_OPTIONS = [
  "head_to_head",
  "head_to_head_point_diff",
  "overall_point_diff",
  "points_for",
  "alphabetical",
] as const;
const STANDINGS_TIE_BREAKER_SET = new Set<string>(STANDINGS_TIE_BREAKER_OPTIONS);
const DEFAULT_STANDINGS_TIE_BREAKERS = [
  "head_to_head",
  "head_to_head_point_diff",
  "overall_point_diff",
  "points_for",
  "alphabetical",
];

const PHASE_PARTICIPANT_SOURCE_TYPES = new Set([
  "competition_participants",
  "standing_positions",
  "matchup_winners",
  "matchup_losers",
  "selected_teams",
  "manual",
]);

const isDirectSourcePosition = (value: unknown) => /^direct:\d+$/.test(String(value ?? "").trim());
const isStandingPositionValue = (value: unknown) => /^\d+$/.test(String(value ?? "").trim());

const normalizeStandingPositionValue = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  if (isDirectSourcePosition(normalized)) {
    const directValue = normalized.replace(/^direct:/, "");
    return `direct:${Number(directValue)}`;
  }
  if (!isStandingPositionValue(normalized)) return "";
  return String(Number(normalized));
};

const countDirectSeriesOutputs = (candidate: unknown) => {
  const parsed = parseJsonRecord(candidate);
  const bracketConfig = parseJsonRecord(parsed.bracketConfiguration);
  const matchups = Array.isArray(bracketConfig.matchups) ? bracketConfig.matchups : [];
  const directMatches = new Set<string>();
  for (const matchup of matchups) {
    if (!matchup || typeof matchup !== "object") continue;
    const candidateMatchup = parseJsonRecord(matchup);
    const slotA = parseJsonRecord(candidateMatchup.slotA);
    const slotB = parseJsonRecord(candidateMatchup.slotB);
    const byeSlot = String(slotA.type ?? "") === "bye" ? slotA : String(slotB.type ?? "") === "bye" ? slotB : null;
    if (!byeSlot) continue;
    const otherSlot = byeSlot === slotA ? slotB : slotA;
    const raw = normalizeStandingPositionValue(otherSlot.position);
    if (raw && raw.startsWith("direct:")) {
      directMatches.add(raw);
    }
  }
  return directMatches.size;
};

const PHASE_MATCHUP_METHODS = new Set([
  "seeded_high_low",
  "random",
  "manual",
  "custom",
]);

const PHASE_MATCHUP_SLOT_SOURCE_TYPES = new Set([
  "standing_position",
  "matchup_winner",
  "matchup_loser",
  "fixed_team",
  "bye",
  "manual",
]);

const SCHEDULE_LIFECYCLE_STATUSES = new Set(["draft", "published"]);

type LegacyKnockoutPhase = {
  id: string;
  name: string;
  wins_required: number | null;
};

const lifecycleToLegacyStatus: Record<string, string> = {
  under_construction: "draft",
  online: "active",
  complete: "completed",
};

type SeasonInput = {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  status: "draft" | "active" | "completed";
};

type StaffRole = (typeof STAFF_ROLE_VALUES)[number];

type SeasonSortInfo = {
  value: number | null;
  raw: string;
};

type SearchAthleteContext = {
  lastTeam: string | null;
  lastSeason: string | null;
};

type SearchResultPlayer = {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  birth_date: string | null;
  last_team_name: string | null;
  last_season_name: string | null;
  career_history: {
    season_name: string;
    team_name: string;
    competition_name: string | null;
    season_year_key: number | null;
  }[];
};

type SearchResultStaff = {
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  birth_date: string | null;
  last_team_name: string | null;
  last_season_name: string | null;
};

type RosterAthleteRow = {
  roster_id: string;
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  photo_url: string | null;
  birth_date: string | null;
  shirt_number: number | null;
};

type RosterStaffRow = {
  membership_id: string;
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  photo_url: string | null;
  birth_date: string | null;
  role: string;
  custom_role_label: string | null;
};

type PreviousRosterInfo = {
  seasonId: string | null;
  seasonName: string | null;
  competitionId: string | null;
  competitionName: string | null;
  targetAthleteRosterExists: boolean;
  targetAthleteCount: number;
  targetStaffRosterExists: boolean;
  targetStaffCount: number;
  previousAthleteCount: number;
  previousStaffCount: number;
};

type TeamRosterManagementView = {
  seasonId: string;
  seasonName: string;
  competitionId: string;
  competitionName: string;
  teamId: string;
  teamName: string;
  athletes: RosterAthleteRow[];
  staff: RosterStaffRow[];
  previousRoster: PreviousRosterInfo;
};

type SearchRequestInput = {
  query: string;
  limit?: number;
};

function withLimit(limit: unknown, fallback = 25) {
  if (limit === undefined || limit === null) return fallback;
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
}

function createResourceEntityId(resource: string) {
  if (resource === "phase-schedules") return createEntityId("phase_schedule");
  return createEntityId(resource.replace(/s$/, ""));
}

function normalizeLookupOrder(left: SeasonSortInfo, right: SeasonSortInfo) {
  if (left.value !== null && right.value !== null) {
    if (left.value !== right.value) return left.value - right.value;
    return right.raw.localeCompare(left.raw, "el-GR", { numeric: true, sensitivity: "base" });
  }
  if (left.value === null && right.value === null) {
    return right.raw.localeCompare(left.raw, "el-GR", { numeric: true, sensitivity: "base" });
  }
  if (left.value === null) return -1;
  return 1;
}

function normalizeStaffRole(value: unknown, fallback: "other" | StaffRole = "other") {
  const role = String(value ?? fallback).trim();
  return STAFF_ROLES.has(role) ? role as StaffRole : fallback;
}

function parseSeasonOrderValue(input: { name?: string | null; startsOn?: string | null }) {
  const seasonName = String(input.name ?? "").trim();
  const startsOn = String(input.startsOn ?? "").trim();

  const labelMatch = /^(\d{4})-(\d{2})$/.exec(seasonName);
  if (labelMatch) return Number(labelMatch[1]);

  if (/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    return Number(startsOn.slice(0, 4));
  }

  return null;
}

function seasonSortInfo(row: { name: string | null; starts_on: string | null }) {
  return {
    value: parseSeasonOrderValue({ name: row.name, startsOn: row.starts_on }),
    raw: String(row.name ?? ""),
  } satisfies SeasonSortInfo;
}

function isEarlierSeason(left: SeasonSortInfo, right: SeasonSortInfo) {
  if (left.value !== null && right.value !== null) return left.value < right.value;
  if (left.value === null && right.value === null) return left.raw < right.raw;
  if (left.value === null) return true;
  return false;
}

function isAtOrBeforeSeason(left: SeasonSortInfo, right: SeasonSortInfo) {
  if (left.value !== null && right.value !== null) return left.value <= right.value;
  if (left.value === right.value) return left.raw <= right.raw;
  if (left.value === null) return true;
  return false;
}

async function database() {
  const env = await getKomoBasketCloudflareEnv();
  return env?.NEWS_DB ?? null;
}

function isCompletedCompetitionStatus(status: string | null | undefined) {
  return isCompletedStatus(String(status ?? ""));
}

async function assertRosterTargetWritable(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
) {
  const statusRows = await rows<{
    seasonStatus: string | null;
    competitionLifecycle: string | null;
  }>(
    db,
    `SELECT
      s.status AS seasonStatus,
      COALESCE(cp.lifecycle_status, CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END) AS competitionLifecycle
    FROM league_seasons s
    JOIN league_competitions c ON c.id=?
    LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
    WHERE s.id=? AND c.id=?`,
    [competitionId, seasonId, competitionId],
  );

  const seasonStatus = statusRows[0]?.seasonStatus ?? null;
  const competitionLifecycle = statusRows[0]?.competitionLifecycle ?? null;

  if (isCompletedCompetitionStatus(seasonStatus) || isCompletedCompetitionStatus(competitionLifecycle)) {
    throw new Error("Η ενέργεια δεν επιτρέπεται σε ολοκληρωμένη σεζόν ή διοργάνωση.");
  }
}

function isCompletedStatus(status: string) {
  return COMPLETED_COMPETITION_STATUSES.has(String(status).trim().toLowerCase());
}

async function rows<T = DbRow>(db: D1DatabaseBinding, sql: string, values: unknown[] = []) {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results ?? [];
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el-GR")
    .replace(/[^a-z0-9α-ω]+/g, "-")
    .replace(/^-|-$/g, "");
}

function baseTeamSlug(season: string, slug: string) {
  return slug.startsWith(`${season}-`) ? slug.slice(season.length + 1) : slug;
}

function optionalInteger(value: unknown, label: string, minimum = 0) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρο.`);
  }
  return parsed;
}

function numberValue(value: unknown, fallback: number, label: string) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρο.`);
  return parsed;
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function trimmedTextOrNull(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function validateHttpUrl(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρο URL.`);
  }
}

function validateIsoDate(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρη ημερομηνία.`);
  }
  const [yearPart, monthPart, dayPart] = text.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(yearPart, monthPart - 1, dayPart));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== yearPart
    || date.getUTCMonth() !== monthPart - 1
    || date.getUTCDate() !== dayPart
  ) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρη ημερομηνία.`);
  }
  return text;
}

function validateHmTime(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρη ώρα.`);
  }
  const [hours, minutes] = text.split(":").map((part) => Number(part));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρη ώρα.`);
  }
  return text;
}

const parseNonNegativeInteger = (value: unknown, label: string) => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} είναι υποχρεωτικό.`);
  if (!/^\d+$/.test(text)) throw new Error(`${label} πρέπει να είναι ακέραιος μη αρνητικός αριθμός.`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} είναι εκτός έγκυρου εύρους.`);
  return parsed;
};

function teamInput(input: Record<string, unknown>, current?: DbRow) {
  const name = String(input.name ?? current?.name ?? "").trim();
  if (!name) throw new Error("Η ονομασία της ομάδας είναι υποχρεωτική.");

  const slug = String(input.slug ?? "").trim() || slugify(name);
  if (!slug) throw new Error("Δεν ήταν δυνατή η δημιουργία συντόμου ονόματος για την ομάδα.");

  return {
    name,
    slug,
    city: String(input.city ?? current?.city ?? "Κομοτηνή").trim() || "Κομοτηνή",
    logoUrl: String(input.logoUrl ?? current?.logo_url ?? "").trim() || null,
    active: input.active === undefined ? Number(current?.active ?? 1) === 1 : booleanValue(input.active),
  };
}

function participationStatus(value: unknown, fallback = "active") {
  const status = String(value ?? fallback).trim();
  if (!PARTICIPATION_STATUSES.has(status)) {
    throw new Error("Η κατάσταση συμμετοχής της ομάδας δεν είναι έγκυρη.");
  }
  return status;
}

function lifecycleValue(input: Record<string, unknown>, fallback = "under_construction") {
  const lifecycle = String(input.lifecycleStatus ?? input.status ?? fallback);
  const normalized = lifecycle === "draft" ? "under_construction"
    : lifecycle === "active" ? "online"
      : lifecycle === "completed" ? "complete" : lifecycle;
  if (!COMPETITION_LIFECYCLES.has(normalized)) {
    throw new Error("Η κατάσταση της διοργάνωσης δεν είναι έγκυρη.");
  }
  return normalized;
}

function competitionVenueInput(input: Record<string, unknown>, current?: DbRow) {
  const name = String(input.name ?? current?.name ?? "").trim();
  if (!name) throw new Error("Το όνομα του γηπέδου είναι υποχρεωτικό.");
  return {
    competitionId: String(input.competitionId ?? current?.competition_id ?? "").trim(),
    name,
    address: trimmedTextOrNull(input.address ?? current?.address ?? null),
    mapUrl: validateHttpUrl(input.mapUrl ?? input.map_url ?? current?.map_url ?? null, "Σύνδεσμος χάρτη"),
    sortOrder: optionalInteger(input.sortOrder ?? input.sort_order ?? current?.sort_order ?? 0, "Σειρά", 0) ?? 0,
  };
}

type SchedulingMode = "keep" | "set" | "clear";

function schedulingModeValue(input: unknown, label: string): SchedulingMode {
  const mode = String(input ?? "keep").trim().toLowerCase();
  if (mode === "keep" || mode === "set" || mode === "clear") return mode;
  throw new Error(`${label} έχει μη έγκυρη κατάσταση.`);
}

function phaseFormatValue(input: Record<string, unknown>, fallback = "standings") {
  const raw = String(input.format ?? input.phaseKind ?? input.phaseType ?? fallback);
  const normalized = String(raw).trim().toLowerCase();
  const mapped = PHASE_KIND_TO_FORMAT[normalized] ?? normalized;
  const canonical = mapped === "knockout" ? "series" : mapped;
  if (!PHASE_FORMATS.has(canonical)) throw new Error("Ο τύπος της φάσης δεν είναι έγκυρος.");
  return canonical;
}

async function auditAndConvertLegacyKnockoutFormats(db: D1DatabaseBinding): Promise<number> {
  const knockoutPhases = await rows<LegacyKnockoutPhase>(db, `
    SELECT p.id, p.name, pr.wins_required
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.format='knockout'
  `);

  if (!knockoutPhases.length) return 0;

  for (const phase of knockoutPhases) {
    await db.prepare(`UPDATE league_phases SET format=?, phase_type=? WHERE id=?`).bind("series", "play_in", phase.id).run();
    const wins = Number.isFinite(Number(phase.wins_required)) && Number(phase.wins_required) > 0
      ? Number(phase.wins_required)
      : 1;
    await db.prepare(`
      UPDATE league_phase_rules
      SET phase_kind=?, wins_required=?
      WHERE phase_id=?
    `).bind("play_in", wins, phase.id).run();
  }

  return knockoutPhases.length;
}

function normalizeCanonicalFormat(rawFormat: string | null | undefined, rawPhaseKind?: string | null) {
  const normalizedFormat = String(rawFormat ?? "").trim().toLowerCase();
  const normalizedKind = String(rawPhaseKind ?? "").trim().toLowerCase();
  const fromKind = PHASE_KIND_TO_FORMAT[normalizedKind];
  const canonical = PHASE_KIND_TO_FORMAT[normalizedFormat] ?? fromKind ?? normalizedFormat;
  const fallback = canonical === "knockout" ? "series" : canonical;
  return PHASE_FORMATS.has(fallback) ? fallback : "standings";
}

function phaseFormatToPhaseType(phaseFormat: string) {
  const normalized = String(phaseFormat).trim().toLowerCase();
  const mapped = PHASE_FORMAT_TO_LEGACY_KIND[normalized];
  if (!mapped) throw new Error("Ο τύπος αποθήκευσης φάσης είναι άκυρος.");
  return mapped;
}

function parsePhaseRuleJson(input: unknown) {
  if (typeof input !== "string" || !input.trim()) return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseJsonRecord(input: unknown) {
  if (typeof input === "string") {
    if (!input.trim()) return {};
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
    return {};
  }
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function parseJsonArray(input: unknown) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

function parseCarryOverMeetingNumbers(input: unknown, maxMeetingNumber: number, enabled: boolean) {
  if (!enabled) return [];
  const values = parseJsonArray(input);
  if (!values.length) {
    throw new Error("Επίλεξε τουλάχιστον μία συνάντηση που θα προσμετράται.");
  }
  if (!Number.isInteger(maxMeetingNumber) || maxMeetingNumber < 1) {
    throw new Error("Η φάση προέλευσης δεν είναι έγκυρη.");
  }
  const normalized = new Set<number>();
  for (const value of values) {
    const meetingNumber = Number(value);
    if (!Number.isInteger(meetingNumber) || meetingNumber < 1 || meetingNumber > maxMeetingNumber) {
      throw new Error("Οι συνάντησεις μεταφοράς προηγούμενου αγώνα δεν είναι έγκυρες.");
    }
    normalized.add(meetingNumber);
  }
  return [...normalized].sort((left, right) => left - right);
}

function parseJsonStringArray(input: unknown) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((value) => String(value ?? "").trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value ?? "").trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function parsePositiveInteger(value: unknown, label: string, minimum = 1) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρο.`);
  }
  return parsed;
}

function parseStandingsRuleInt(value: unknown, fallback: number, label: string, minimum = 0) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`Το πεδίο «${label}» δεν είναι έγκυρο.`);
  }
  return parsed;
}

function parseScheduleMode(value: unknown) {
  const normalized = String(value ?? "automatic").trim().toLowerCase();
  if (normalized === "manual") return "manual";
  return "automatic";
}

function parseStandingsTieBreakers(value: unknown) {
  const fallback = value === undefined || value === null ? DEFAULT_STANDINGS_TIE_BREAKERS : value;
  const parsed = Array.isArray(fallback)
    ? fallback
    : parsePhaseRuleJson(fallback);
  const source = Array.isArray(parsed) ? parsed : null;
  if (!source) return [...DEFAULT_STANDINGS_TIE_BREAKERS];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const key = String(item ?? "").trim();
    if (!key || !STANDINGS_TIE_BREAKER_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  const withoutAlphabetical = normalized.filter((item) => item !== "alphabetical");
  return [...withoutAlphabetical, "alphabetical"];
}

async function parsePhaseParticipantConfig(
  db: D1DatabaseBinding,
  competitionId: string,
  phaseOrder: number,
  phaseFormat: string,
  input: Record<string, unknown>,
  current: DbRow = {},
) {
  const parsedCurrent = parseJsonRecord(current?.rule_settings_json);
  const source = parseJsonRecord(input.participantConfiguration ?? parsedCurrent.participantConfiguration);
  const participantSourceType = String(source.participantSourceType || input.participantSourceType || "").trim() || "competition_participants";
  if (!PHASE_PARTICIPANT_SOURCE_TYPES.has(participantSourceType)) {
    throw new Error("Ο τύπος προέλευσης συμμετεχόντων δεν είναι έγκυρος.");
  }

  const participantSourcePhaseId = String(
    source.participantSourcePhaseId || source.sourcePhaseId || input.participantSourcePhaseId || "",
  ).trim() || "";
  const standingFrom = parsePositiveInteger(
    source.standingFrom ?? input.standingFrom,
    "Από θέση",
    1,
  ) ?? 1;
  const standingTo = parsePositiveInteger(
    source.standingTo ?? input.standingTo,
    "Έως θέση",
    1,
  ) ?? standingFrom;
  if (standingFrom > standingTo) {
    throw new Error("Η θέση έναρξης δεν μπορεί να είναι μεγαλύτερη από την θέση λήξης.");
  }

  const participantTeamIds = parseJsonStringArray(source.selectedTeamIds || input.participantTeamIds);
  const sourceMatchupIds = parseJsonStringArray(source.sourceMatchupIds || input.sourceMatchupIds);
  const manualSlotCount = parsePositiveInteger(source.manualSlotCount || input.manualSlotCount, "Αριθμός manual slots", 0);

  if (participantSourceType !== "competition_participants" && participantSourceType !== "selected_teams") {
    if (!participantSourcePhaseId) {
      throw new Error("Απαιτείται φάση προέλευσης για αυτόν τον τύπο συμμετοχής.");
    }
    if (participantSourceType !== "manual" && participantSourcePhaseId && participantSourcePhaseId === String(current?.id ?? "")) {
      throw new Error("Η φάση προέλευσης δεν μπορεί να είναι η ίδια φάση.");
    }
    const sourcePhase = await db.prepare(`
      SELECT p.phase_order, p.order_index, p.format, pr.phase_kind, pr.settings_json
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      WHERE p.id=? AND p.competition_id=?
    `)
      .bind(participantSourcePhaseId, competitionId).first<{ phase_order: number | null; order_index: number | null; format: string | null }>();
    if (!sourcePhase) throw new Error("Η φάση προέλευσης δεν ανήκει στην ίδια διοργάνωση.");
    if (participantSourceType === "standing_positions") {
      const sourceFormat = String(sourcePhase.format || "").trim().toLowerCase();
      if (sourceFormat !== "standings" && sourceFormat !== "series") {
        throw new Error("Η πηγή θέσεων απαιτεί προηγούμενη standings ή series phase.");
      }
    }
    if ((participantSourceType === "matchup_winners" || participantSourceType === "matchup_losers") && !String(sourcePhase.format || "").trim()) {
      throw new Error("Η πηγή matchups απαιτεί έγκυρη προηγούμενη phase.");
    }
    const sourcePhaseOrder = Number(sourcePhase?.phase_order ?? sourcePhase?.order_index ?? 0);
    if (sourcePhaseOrder >= phaseOrder) {
      throw new Error("Η φάση προέλευσης πρέπει να προηγείται της τρέχουσας φάσης.");
    }
  }

  const sourceTeamCount = participantSourceType === "competition_participants"
    ? Number((await db.prepare("SELECT COUNT(*) AS count FROM league_competition_teams WHERE competition_id=? AND status='active'")
      .bind(competitionId)
      .first<{ count: number }>())?.count ?? 0)
    : participantSourceType === "selected_teams"
      ? participantTeamIds.length
      : participantSourceType === "standing_positions"
        ? await (async () => {
          const sourcePhaseConfig = await db.prepare(`
            SELECT p.format, pr.settings_json
            FROM league_phases p
            LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
            WHERE p.id=? AND p.competition_id=?
          `).bind(participantSourcePhaseId, competitionId).first<{ format: string | null; settings_json: string | null }>();
          if (!sourcePhaseConfig) return 0;
          const sourceConfigFormat = String(sourcePhaseConfig.format || "").trim().toLowerCase();
          if (sourceConfigFormat !== "series") {
            return Math.max(0, standingTo - standingFrom + 1);
          }
          const sourceRuleSettings = parseJsonRecord(sourcePhaseConfig.settings_json);
          const bracketConfig = parseJsonRecord(sourceRuleSettings.bracketConfiguration);
          const sourceMatchups = Array.isArray(bracketConfig.matchups) ? bracketConfig.matchups : [];
          let outputs = 0;
          for (const sourceMatchup of sourceMatchups) {
            const nextMatchup = parseJsonRecord(sourceMatchup);
            const slotA = parseJsonRecord(nextMatchup.slotA);
            const slotB = parseJsonRecord(nextMatchup.slotB);
            const isByeA = String(slotA.type || "") === "bye";
            const isByeB = String(slotB.type || "") === "bye";
            outputs += isByeA || isByeB ? 1 : 1;
          }
          return outputs;
        })()
        : sourceMatchupIds.length;

  const bracketMethod = String(
    source.bracketMethod || input.bracketMethod || "manual",
  ).trim();
  const validMethod = String(phaseFormat).trim() === "series" ? "manual" : (PHASE_MATCHUP_METHODS.has(bracketMethod) ? bracketMethod : "seeded_high_low");

  if (String(phaseFormat).trim() === "series" && sourceTeamCount < 2 && sourceTeamCount !== 0) {
    throw new Error("Μια φάση ακολουθίας χρειάζεται τουλάχιστον 2 συμμετοχές.");
  }

  const slotInputs = parseJsonArray(source.matchups ?? input.matchups ?? "[]");
  const matchups = Array.isArray(slotInputs)
    ? slotInputs.filter((matchup) => matchup && typeof matchup === "object")
        .map((matchup) => ({
          id: String((matchup as Record<string, unknown>).id || createEntityId("matchup")),
          slotA: parseJsonRecord((matchup as Record<string, unknown>).slotA),
          slotB: parseJsonRecord((matchup as Record<string, unknown>).slotB),
        }))
    : [];

  if (matchups.length) {
    for (const matchup of matchups) {
      if (!matchup.slotA || !matchup.slotB) {
        throw new Error("Κάθε matchup πρέπει να έχει και τις δύο θέσεις.");
      }
      const isValidSlot = (slot: Record<string, unknown>) => {
        const type = String(slot.type || "").trim();
        if (!PHASE_MATCHUP_SLOT_SOURCE_TYPES.has(type)) return false;
        if (type === "standing_position") {
          const position = normalizeStandingPositionValue(slot.position);
          return isDirectSourcePosition(position) || (isStandingPositionValue(position) && Number(position) >= 1);
        }
        if (type === "bye") return true;
        if (type === "fixed_team") return Boolean(String(slot.teamId ?? "").trim());
        if (type === "matchup_winner" || type === "matchup_loser") return Boolean(String(slot.matchupId ?? "").trim());
        return true;
      };
      if (!isValidSlot(matchup.slotA) || !isValidSlot(matchup.slotB)) {
        throw new Error("Παρουσιάστηκε μη έγκυρη πηγή συμμετοχής μέσα σε matchup.");
      }
    }

    const sourceTokenCounts = new Map<string, number>();
    const toToken = (slot: Record<string, unknown>) => {
      const type = String(slot.type || "").trim();
      if (type === "standing_position") return normalizeStandingPositionValue(slot.position);
      if (type === "matchup_winner" || type === "matchup_loser") return `${type}:${String(slot.matchupId ?? "")}`;
      if (type === "manual") return `manual:${String(slot.teamId ?? "")}`;
      return "";
    };
    for (const matchup of matchups) {
      const slots = [matchup.slotA, matchup.slotB];
      for (const slot of slots) {
        const token = toToken(slot);
        if (!token || String(slot.type || "") === "bye") continue;
        const next = (sourceTokenCounts.get(token) ?? 0) + 1;
        sourceTokenCounts.set(token, next);
      }
    }
    for (const [token, count] of sourceTokenCounts.entries()) {
      if (count > 1) {
        throw new Error(`Το slot ${token} χρησιμοποιείται περισσότερες φορές.`);
      }
    }
  }

  const participantConfiguration = {
    participantSourceType,
    participantSourcePhaseId: participantSourcePhaseId || null,
    standingFrom,
    standingTo,
    selectedTeamIds: participantTeamIds,
    sourceMatchupIds,
    manualSlotCount,
  };

  return {
    participantConfiguration,
    bracketConfiguration: {
      method: validMethod,
      matchups,
      participantCount: sourceTeamCount,
    },
    carryOverSourcePhaseId: participantSourceType === "selected_teams" ? null : participantSourcePhaseId || null,
  };
}

type FinalizationParticipant = {
  teamId: string;
  teamName: string;
};

type SeriesMaterializationAction = "create_game" | "already_materialized" | "qualified" | "pending";

type SeriesMaterializationPlannedGame = {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string;
  series_matchup_id: string;
  series_round_number: number;
  home_team_id: string;
  away_team_id: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  venue: string;
  status: "scheduled";
};

type SeriesPlanningSlotRow = {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string;
  matchup_id: string;
  series_round_number: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  venue: string;
  real_game_id: string | null;
};

type SeriesMaterializationMatchupPlan = {
  matchupId: string;
  label: string;
  teamAId: string | null;
  teamAName: string | null;
  teamBId: string | null;
  teamBName: string | null;
  currentWinsA: number | null;
  currentWinsB: number | null;
  transferredRoundCount: number;
  maximumSeriesRounds: number | null;
  nextRequiredRoundNumber: number | null;
  alreadyMaterialized: boolean;
  action: SeriesMaterializationAction;
  proposedHomeTeamId: string | null;
  proposedHomeTeamName: string | null;
  proposedAwayTeamId: string | null;
  proposedAwayTeamName: string | null;
  planningDate: string | null;
  planningTime: string | null;
  planningVenue: string | null;
  qualificationRoundNumber: number | null;
  qualifiedTeamId: string | null;
  qualifiedTeamName: string | null;
  plannedGame: SeriesMaterializationPlannedGame | null;
  progression: ReturnType<typeof calculateSeriesProgression> | null;
  message: string;
};

type SeriesMaterializationDryRunResult = {
  competitionId: string;
  phaseId: string;
  phaseName: string | null;
  scheduleId: string | null;
  sourcePhaseId: string | null;
  sourcePhaseName: string | null;
  carryOverEnabled: boolean;
  seriesMatchupCount: number;
  existingSeriesGameCount: number;
  existingPlanningSlotCount: number;
  proposedGameCount: number;
  plans: SeriesMaterializationMatchupPlan[];
};

type SeriesMaterializationExecutionResult = {
  dryRun: SeriesMaterializationDryRunResult;
  createdGameIds: string[];
  alreadyMaterializedGameIds: string[];
  scheduleCreated?: boolean;
  planningLinksUpdated?: number;
};

export type PhaseProgramMaterializationResult = {
  scheduleId: string;
  competitionId: string;
  phaseId: string;
  scheduleCreated: boolean;
  expectedGames: number;
  existingGames: number;
  gamesCreated: number;
  complete: boolean;
  planningLinksUpdated?: number;
};

type ProvisionalPhaseSchedule = {
  id: string;
  competition_id: string;
  phase_id: string;
  lifecycle_status: string;
};

function parsePhaseParticipantSettings(raw: unknown) {
  const settings = parseJsonRecord(raw);
  const participantConfig = parseJsonRecord(settings.participantConfiguration);
  return {
    participantConfig,
    participantSourceType: String(participantConfig.participantSourceType ?? "competition_participants").trim() || "competition_participants",
  };
}

async function resolvePhaseParticipantsForStandings(
  db: D1DatabaseBinding,
  phase: DbRow,
): Promise<FinalizationParticipant[]> {
  const competitionId = String(phase.competition_id ?? "").trim();
  const { participantConfig, participantSourceType } = parsePhaseParticipantSettings(phase.rule_settings_json ?? phase.settings_json ?? "{}");

  if (participantSourceType === "matchup_winners" || participantSourceType === "matchup_losers") {
    const sourcePhaseId = String(participantConfig.participantSourcePhaseId ?? participantConfig.sourcePhaseId ?? "").trim();
    const sourceMatchupIds = parseJsonStringArray(participantConfig.sourceMatchupIds);
    if (!sourcePhaseId || !sourceMatchupIds.length) {
      throw new Error("Η συμβολική πηγή matchups δεν έχει πλήρη ταυτότητα φάσης και matchups.");
    }
    const outcomeKind = participantSourceType === "matchup_winners" ? "winner" as const : "loser" as const;
    return Promise.all(sourceMatchupIds.map(async (matchupId) => {
      const resolved = await resolveFinalizedSeriesOutcomeReferenceWithDb(db, sourcePhaseId, matchupId, outcomeKind);
      if (resolved.state !== "resolved" || !resolved.teamId || !resolved.teamName) {
        throw new Error(resolved.message || "Δεν επιλύθηκε η συμβολική αναφορά matchup.");
      }
      return { teamId: resolved.teamId, teamName: resolved.teamName };
    }));
  }

  if (participantSourceType === "standing_positions") {
    throw new Error("Η οριστικοποίηση της φάσης με θέσεις από προηγούμενη βαθμολογία θα υποστηριχθεί σε επόμενο στάδιο.");
  }

  if (participantSourceType === "selected_teams") {
    const selectedTeamIds = parseJsonStringArray(participantConfig.selectedTeamIds);
    if (!selectedTeamIds.length) throw new Error("Η φάση δεν έχει έγκυρους συμμετέχοντες.");
    const placeholders = selectedTeamIds.map(() => "?").join(",");
    const rowsResult = await rows<FinalizationParticipant>(
      db,
      `
      SELECT t.id AS teamId, COALESCE(st.display_name, t.name) AS teamName
      FROM league_teams t
      LEFT JOIN league_season_teams st ON st.team_id=t.id
      INNER JOIN league_competition_teams ct ON ct.season_team_id=st.id AND ct.competition_id=? AND ct.status='active'
      WHERE t.id IN (${placeholders})
      ORDER BY COALESCE(ct.seed, 999999), COALESCE(st.display_name, t.name), t.id
      `,
      [competitionId, ...selectedTeamIds],
    );
    return rowsResult;
  }

  const rowsResult = await rows<FinalizationParticipant>(
    db,
    `
    SELECT t.id AS teamId, COALESCE(st.display_name, t.name) AS teamName
    FROM league_competition_teams ct
    JOIN league_season_teams st ON st.id=ct.season_team_id
    JOIN league_teams t ON t.id=st.team_id
    WHERE ct.competition_id=? AND ct.status='active'
    ORDER BY COALESCE(ct.seed, 999999), COALESCE(st.display_name, t.name), t.id
    `,
    [competitionId],
  );
  return rowsResult;
}

function validateFinalGameState(game: DbRow) {
  const status = String(game.status ?? "").trim().toLowerCase();
  if (status === "scheduled" || status === "postponed") {
    throw new Error("Η φάση δεν μπορεί να οριστικοποιηθεί επειδή υπάρχουν ακόμη αγώνες σε εκκρεμότητα.");
  }
  if (status === "cancelled") return;
  if (status !== "completed") {
    throw new Error("Η φάση δεν μπορεί να οριστικοποιηθεί επειδή υπάρχουν μη έγκυρες καταστάσεις αγώνων.");
  }
  const homeScore = parseNonNegativeInteger(game.home_score, "Σκορ γηπεδούχου");
  const awayScore = parseNonNegativeInteger(game.away_score, "Σκορ φιλοξενούμενου");
  if (homeScore === awayScore) {
    throw new Error("Η φάση δεν μπορεί να οριστικοποιηθεί με ισόπαλο επίσημο αποτέλεσμα.");
  }
}

function normalizeSeriesPhaseLike(row: DbRow): SeriesCarryOverPhaseLike {
  return {
    id: String(row.id ?? "").trim(),
    competition_id: String(row.competition_id ?? "").trim(),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    format: row.format === null || row.format === undefined ? null : String(row.format),
    phase_kind: row.phase_kind === null || row.phase_kind === undefined ? null : String(row.phase_kind),
    lifecycle_status: row.lifecycle_status === null || row.lifecycle_status === undefined ? null : String(row.lifecycle_status),
    previous_phase_id: row.previous_phase_id === null || row.previous_phase_id === undefined ? null : String(row.previous_phase_id),
    wins_required: row.wins_required === null || row.wins_required === undefined ? null : Number(row.wins_required),
    carry_over_enabled: row.carry_over_enabled === null || row.carry_over_enabled === undefined ? null : Number(row.carry_over_enabled),
    carry_over_source_phase_id: row.carry_over_source_phase_id === null || row.carry_over_source_phase_id === undefined ? null : String(row.carry_over_source_phase_id),
    rule_settings_json: row.rule_settings_json ?? null,
    settings_json: row.settings_json ?? null,
  };
}

async function loadSeriesCompletionSnapshot(
  db: D1DatabaseBinding,
  competitionId: string,
): Promise<CanonicalSeriesCompletionSnapshot> {
  const phases = await rows<DbRow>(db, `
    SELECT p.*, pr.phase_kind, pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.competition_id=?
    ORDER BY COALESCE(p.phase_order, p.order_index), p.id
  `, [competitionId]);
  const games = await rows<CanonicalSeriesGameRow>(db, `
    SELECT id, competition_id, phase_id, schedule_id, series_matchup_id, series_round_number,
      cycle_number, round_number, game_order, home_team_id, away_team_id,
      home_score, away_score, status, result_source, scheduled_date, scheduled_time, venue
    FROM league_games
    WHERE competition_id=?
    ORDER BY phase_id, COALESCE(series_round_number, 0), COALESCE(round_number, 0), id
  `, [competitionId]);
  const teams = await rows<{ id: string; name: string }>(db, `
    SELECT t.id, COALESCE(st.display_name, t.name) AS name
    FROM league_competition_teams ct
    JOIN league_season_teams st ON st.id=ct.season_team_id
    JOIN league_teams t ON t.id=st.team_id
    WHERE ct.competition_id=? AND ct.status='active'
    ORDER BY COALESCE(ct.seed, 999999), COALESCE(st.display_name, t.name), t.id
  `, [competitionId]);
  return { phases: phases.map(normalizeSeriesPhaseLike), games, teams };
}

async function loadCanonicalFinalizedSeriesSourceSnapshot(
  db: D1DatabaseBinding,
  sourcePhaseId: string,
): Promise<CanonicalSeriesCompletionSnapshot> {
  const source = await db.prepare(`
    SELECT competition_id
    FROM league_phases
    WHERE id=?
  `).bind(sourcePhaseId).first<{ competition_id: string }>();
  if (!source?.competition_id) {
    throw new Error("Δεν βρέθηκε η Series Phase προέλευσης.");
  }
  return loadSeriesCompletionSnapshot(db, String(source.competition_id));
}

async function resolveFinalizedSeriesOutcomeReferenceWithDb(
  db: D1DatabaseBinding,
  sourcePhaseId: string,
  matchupId: string,
  outcomeKind: "winner" | "loser",
) {
  const snapshot = await loadCanonicalFinalizedSeriesSourceSnapshot(db, sourcePhaseId);
  return resolveFinalizedSeriesOutcomeReference(
    snapshot.phases,
    snapshot.games,
    snapshot.teams,
    sourcePhaseId,
    matchupId,
    outcomeKind,
  );
}

async function deriveSeriesPhaseCompletionWithDb(
  db: D1DatabaseBinding,
  phase: DbRow,
): Promise<SeriesPhaseCompletion> {
  const competitionId = String(phase.competition_id ?? "").trim();
  const snapshot = await loadSeriesCompletionSnapshot(db, competitionId);
  const normalizedPhase = snapshot.phases.find((entry) => String(entry.id ?? "") === String(phase.id ?? ""))
    ?? normalizeSeriesPhaseLike(phase);
  return deriveSeriesPhaseCompletion(snapshot.phases, snapshot.games, snapshot.teams, normalizedPhase);
}

export async function dryRunSeriesInitialMaterializationPlan(
  db: D1DatabaseBinding,
  phaseId: string,
  competitionId: string,
  provisionalSchedule?: ProvisionalPhaseSchedule,
) : Promise<SeriesMaterializationDryRunResult> {
  const current = await db.prepare(`
    SELECT p.*, pr.phase_kind, pr.bracket_size, pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.id=? AND p.competition_id=?
  `).bind(phaseId, competitionId).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η φάση.");

  const currentFormat = normalizeCanonicalFormat(String(current.format ?? ""), String(current.phase_kind ?? ""));
  if (currentFormat !== "series") {
    throw new Error("Το πρόγραμμα υλοποίησης είναι διαθέσιμο μόνο για σειρά αγώνων.");
  }

  const schedules = await rows<DbRow>(
    db,
    `
    SELECT id, competition_id, phase_id, lifecycle_status
    FROM league_phase_schedules
    WHERE phase_id=? AND competition_id=?
    ORDER BY id
    `,
    [phaseId, competitionId],
  );
  if (!schedules.length && provisionalSchedule) {
    schedules.push(provisionalSchedule);
  }
  if (!schedules.length) {
    throw new Error("Δεν βρέθηκε προγραμματισμός για τη φάση.");
  }
  const schedule = schedules[0];
  if (schedules.length > 1) {
    throw new Error("Βρέθηκαν πολλαπλοί προγραμματισμοί για τη φάση.");
  }
  if (String(schedule.competition_id ?? "") !== competitionId || String(schedule.phase_id ?? "") !== phaseId) {
    throw new Error("Ο προγραμματισμός δεν ανήκει στη σωστή φάση ή διοργάνωση.");
  }

  // Operational Series resolution must use the same full canonical snapshot as
  // finalization. In particular, nested finalized sources need their complete
  // rule fields and canonical Game identity; a target-specific projection is
  // not an authoritative source snapshot.
  const canonicalSnapshot = await loadSeriesCompletionSnapshot(db, competitionId);
  const allPhases = canonicalSnapshot.phases;
  const allTeams = canonicalSnapshot.teams;
  const allGames = canonicalSnapshot.games;
  const planningSlots = await rows<SeriesPlanningSlotRow>(
    db,
    `
    SELECT id, competition_id, phase_id, schedule_id, matchup_id,
      series_round_number, scheduled_date, scheduled_time, venue, real_game_id
    FROM league_series_planning_slots
    WHERE competition_id=? AND phase_id=? AND schedule_id=?
    ORDER BY series_round_number, id
    `,
    [competitionId, phaseId, String(schedule.id ?? "")],
  );

  const carryOver = resolveSeriesCarryOver(allPhases, allGames, allTeams, normalizeSeriesPhaseLike(current));
  const materializedGames = allGames
    .filter((game) =>
      String(game.phase_id ?? "") === String(phaseId) &&
      String(game.series_matchup_id ?? "").trim() &&
      Number.isInteger(Number(game.series_round_number)) &&
      Number(game.series_round_number) >= 1,
    )
    .map((game): SeriesProgressionMaterializedGame => ({
      matchupId: String(game.series_matchup_id ?? ""),
      gameId: String(game.id ?? ""),
      seriesRoundNumber: Number(game.series_round_number),
      homeTeamId: String(game.home_team_id ?? ""),
      awayTeamId: String(game.away_team_id ?? ""),
      homeScore: game.home_score === null || game.home_score === undefined ? null : Number(game.home_score),
      awayScore: game.away_score === null || game.away_score === undefined ? null : Number(game.away_score),
      status: String(game.status ?? ""),
      date: game.scheduled_date === null || game.scheduled_date === undefined ? null : String(game.scheduled_date),
      time: game.scheduled_time === null || game.scheduled_time === undefined ? null : String(game.scheduled_time),
      venue: game.venue === null || game.venue === undefined ? null : String(game.venue),
    }));

  const sourcePhaseId = carryOver.sourcePhaseId;
  const sourceGames = sourcePhaseId
    ? allGames.filter((game) => String(game.phase_id ?? "") === String(sourcePhaseId))
    : [];
  const planningSlotsForMatchup = (matchupId: string): SeriesProgressionPlanningSlot[] => planningSlots
    .filter((slot) =>
      slot.matchup_id === matchupId
      && !String(slot.real_game_id ?? "").trim()
      && !materializedGames.some((game) =>
        String(game.matchupId ?? "") === matchupId
        && game.seriesRoundNumber === Number(slot.series_round_number)
      )
    )
    .map((slot) => ({
      seriesRoundNumber: Number(slot.series_round_number),
      scheduledDate: slot.scheduled_date,
      scheduledTime: slot.scheduled_time,
      venue: slot.venue,
    }));

  const plans: SeriesMaterializationMatchupPlan[] = carryOver.matchups.map((matchup) => {
    if (matchup.entryKind === "direct_qualifier" && matchup.state === "resolved" && matchup.qualifiedTeamId) {
      return {
        matchupId: matchup.matchupId,
        label: matchup.label,
        teamAId: matchup.teamAId,
        teamAName: matchup.teamAName,
        teamBId: matchup.teamBId,
        teamBName: matchup.teamBName,
        currentWinsA: null,
        currentWinsB: null,
        transferredRoundCount: 0,
        maximumSeriesRounds: 0,
        nextRequiredRoundNumber: null,
        alreadyMaterialized: false,
        action: "qualified" as const,
        proposedHomeTeamId: null,
        proposedHomeTeamName: null,
        proposedAwayTeamId: null,
        proposedAwayTeamName: null,
        planningDate: null,
        planningTime: null,
        planningVenue: null,
        qualificationRoundNumber: null,
        qualifiedTeamId: matchup.qualifiedTeamId,
        qualifiedTeamName: matchup.qualifiedTeamName ?? null,
        plannedGame: null,
        progression: null,
        message: matchup.message,
      };
    }
    if (matchup.state !== "resolved" || !matchup.teamAId || !matchup.teamBId) {
      return {
        matchupId: matchup.matchupId,
        label: matchup.label,
        teamAId: matchup.teamAId,
        teamAName: matchup.teamAName,
        teamBId: matchup.teamBId,
        teamBName: matchup.teamBName,
        currentWinsA: matchup.startingWinsA,
        currentWinsB: matchup.startingWinsB,
        transferredRoundCount: matchup.selectedMeetings.length,
        maximumSeriesRounds: matchup.maxNewGames === null ? null : (2 * 2 - 1),
        nextRequiredRoundNumber: null,
        alreadyMaterialized: false,
        action: "pending",
        proposedHomeTeamId: null,
        proposedHomeTeamName: null,
        proposedAwayTeamId: null,
        proposedAwayTeamName: null,
        planningDate: null,
        planningTime: null,
        planningVenue: null,
        qualificationRoundNumber: null,
        qualifiedTeamId: null,
        qualifiedTeamName: null,
        plannedGame: null,
        progression: null,
        message: matchup.message,
      };
    }

    const selectedMeetings = [...matchup.selectedMeetings];
    const transferredGames: SeriesProgressionTransferredGame[] = [];
    let unresolvedMessage: string | null = null;

    for (let index = 0; index < selectedMeetings.length; index += 1) {
      const meetingNumber = selectedMeetings[index];
      const candidates = sourceGames.filter((game) => {
        const cycleNumber = Number(game.cycle_number);
        const homeTeamId = String(game.home_team_id ?? "");
        const awayTeamId = String(game.away_team_id ?? "");
        const matchesPair =
          (homeTeamId === matchup.teamAId && awayTeamId === matchup.teamBId) ||
          (homeTeamId === matchup.teamBId && awayTeamId === matchup.teamAId);
        return Number.isInteger(cycleNumber) && cycleNumber === meetingNumber && matchesPair;
      });

      if (candidates.length === 0) {
        unresolvedMessage = `Δεν βρέθηκε επίσημος αγώνας για τη συνάντηση ${meetingNumber}.`;
        break;
      }
      if (candidates.length > 1) {
        throw new Error(`Υπάρχουν πολλαπλοί αγώνες για τη συνάντηση ${meetingNumber}.`);
      }

      const game = candidates[0];
      const homeScore = Number(game.home_score);
      const awayScore = Number(game.away_score);
      const status = String(game.status ?? "").trim().toLowerCase();
      if (status !== "completed" || !Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore === awayScore) {
        unresolvedMessage = `Σε αναμονή αποτελέσματος προηγούμενου αγώνα.`;
        break;
      }

      transferredGames.push({
        sourceGameId: String(game.id ?? ""),
        seriesRoundNumber: index + 1,
        homeTeamId: String(game.home_team_id ?? ""),
        awayTeamId: String(game.away_team_id ?? ""),
        homeScore,
        awayScore,
        status: String(game.status ?? ""),
        date: game.scheduled_date === null || game.scheduled_date === undefined ? null : String(game.scheduled_date),
        time: game.scheduled_time === null || game.scheduled_time === undefined ? null : String(game.scheduled_time),
        venue: game.venue === null || game.venue === undefined ? null : String(game.venue),
      });
    }

    if (unresolvedMessage) {
      return {
        matchupId: matchup.matchupId,
        label: matchup.label,
        teamAId: matchup.teamAId,
        teamAName: matchup.teamAName,
        teamBId: matchup.teamBId,
        teamBName: matchup.teamBName,
        currentWinsA: matchup.startingWinsA,
        currentWinsB: matchup.startingWinsB,
        transferredRoundCount: transferredGames.length,
        maximumSeriesRounds: matchup.maxNewGames === null ? null : (2 * 2 - 1),
        nextRequiredRoundNumber: null,
        alreadyMaterialized: false,
        action: "pending",
        proposedHomeTeamId: null,
        proposedHomeTeamName: null,
        proposedAwayTeamId: null,
        proposedAwayTeamName: null,
        planningDate: null,
        planningTime: null,
        planningVenue: null,
        qualificationRoundNumber: null,
        qualifiedTeamId: null,
        qualifiedTeamName: null,
        plannedGame: null,
        progression: null,
        message: unresolvedMessage,
      };
    }

    const matchupPlanningSlots = planningSlotsForMatchup(matchup.matchupId);
    const progression = calculateSeriesProgression({
      matchupId: matchup.matchupId,
      teamA: { id: String(matchup.teamAId ?? ""), name: String(matchup.teamAName ?? "—") },
      teamB: { id: String(matchup.teamBId ?? ""), name: String(matchup.teamBName ?? "—") },
      winsRequired: Number(current.wins_required ?? current.best_of ?? 2),
      transferredGames,
      materializedGames: materializedGames.filter((game) =>
        String(game.matchupId ?? "") === matchup.matchupId
        && String(game.gameId ?? "").trim()
        && game.seriesRoundNumber >= 1
        && game.seriesRoundNumber <= (2 * Number(current.wins_required ?? current.best_of ?? 2)) - 1
      ),
      planningSlots: matchupPlanningSlots,
    });

    const nextRequiredRoundNumber = progression.nextRequiredRoundNumber;
    const qualifiedTeamId = progression.qualifiedTeamId;
    const qualifiedTeamName = progression.qualifiedTeamName;
    const qualificationRoundNumber = progression.qualificationRoundNumber;
    if (qualifiedTeamId) {
      return {
        matchupId: matchup.matchupId,
        label: matchup.label,
        teamAId: matchup.teamAId,
        teamAName: matchup.teamAName,
        teamBId: matchup.teamBId,
        teamBName: matchup.teamBName,
        currentWinsA: progression.currentWinsA,
        currentWinsB: progression.currentWinsB,
        transferredRoundCount: progression.transferredRoundCount,
        maximumSeriesRounds: progression.maximumSeriesRounds,
        nextRequiredRoundNumber: null,
        alreadyMaterialized: false,
        action: "qualified",
        proposedHomeTeamId: null,
        proposedHomeTeamName: null,
        proposedAwayTeamId: null,
        proposedAwayTeamName: null,
        planningDate: null,
        planningTime: null,
        planningVenue: null,
        qualificationRoundNumber,
        qualifiedTeamId,
        qualifiedTeamName,
        plannedGame: null,
        progression,
        message: `Πρόκριση ${qualifiedTeamName ?? "—"} από τον ${qualificationRoundNumber ?? "—"}ο Γύρο.`,
      };
    }

    if (nextRequiredRoundNumber === null) {
      return {
        matchupId: matchup.matchupId,
        label: matchup.label,
        teamAId: matchup.teamAId,
        teamAName: matchup.teamAName,
        teamBId: matchup.teamBId,
        teamBName: matchup.teamBName,
        currentWinsA: progression.currentWinsA,
        currentWinsB: progression.currentWinsB,
        transferredRoundCount: progression.transferredRoundCount,
        maximumSeriesRounds: progression.maximumSeriesRounds,
        nextRequiredRoundNumber: null,
        alreadyMaterialized: false,
        action: "pending",
        proposedHomeTeamId: null,
        proposedHomeTeamName: null,
        proposedAwayTeamId: null,
        proposedAwayTeamName: null,
        planningDate: null,
        planningTime: null,
        planningVenue: null,
        qualificationRoundNumber: null,
        qualifiedTeamId: null,
        qualifiedTeamName: null,
        plannedGame: null,
        progression,
        message: "Σε αναμονή προσδιορισμού επόμενου γύρου.",
      };
    }

    const nextRound = progression.rounds.find((round) => round.seriesRoundNumber === nextRequiredRoundNumber) ?? null;
    const existingRealGame = progression.rounds.find((round) => round.seriesRoundNumber === nextRequiredRoundNumber && round.realGameId) ?? null;
    const planningSlot = matchupPlanningSlots.find((slot) => slot.seriesRoundNumber === nextRequiredRoundNumber) ?? null;
    const proposedHomeTeamId = nextRound?.expectedHomeTeamId ?? null;
    const proposedHomeTeamName = nextRound?.expectedHomeTeamName ?? null;
    const proposedAwayTeamId = nextRound?.expectedAwayTeamId ?? null;
    const proposedAwayTeamName = nextRound?.expectedAwayTeamName ?? null;
    const plannedGame: SeriesMaterializationPlannedGame | null = nextRound
      ? {
          id: createEntityId("game"),
          competition_id: competitionId,
          phase_id: phaseId,
          schedule_id: String(schedule.id ?? ""),
          series_matchup_id: matchup.matchupId,
          series_round_number: nextRequiredRoundNumber,
          home_team_id: proposedHomeTeamId ?? "",
          away_team_id: proposedAwayTeamId ?? "",
          scheduled_date: planningSlot?.scheduledDate ?? null,
          scheduled_time: planningSlot?.scheduledTime ?? null,
          venue: planningSlot?.venue ?? "",
          status: "scheduled",
        }
      : null;

    return {
      matchupId: matchup.matchupId,
      label: matchup.label,
      teamAId: matchup.teamAId,
      teamAName: matchup.teamAName,
      teamBId: matchup.teamBId,
      teamBName: matchup.teamBName,
      currentWinsA: progression.currentWinsA,
      currentWinsB: progression.currentWinsB,
      transferredRoundCount: progression.transferredRoundCount,
      maximumSeriesRounds: progression.maximumSeriesRounds,
      nextRequiredRoundNumber,
      alreadyMaterialized: Boolean(existingRealGame),
      action: existingRealGame ? "already_materialized" : "create_game",
      proposedHomeTeamId,
      proposedHomeTeamName,
      proposedAwayTeamId,
      proposedAwayTeamName,
      planningDate: planningSlot?.scheduledDate ?? null,
      planningTime: planningSlot?.scheduledTime ?? null,
      planningVenue: planningSlot?.venue ?? null,
      qualificationRoundNumber,
      qualifiedTeamId,
      qualifiedTeamName,
      plannedGame,
      progression,
      message: existingRealGame
        ? "Ο απαιτούμενος αγώνας έχει ήδη υλικοποιηθεί."
        : "Ο επόμενος απαιτούμενος αγώνας μπορεί να δημιουργηθεί.",
    };
  });

  const guaranteedPlans = plans.flatMap((plan) => {
    if (!plan.progression || (plan.action !== "create_game" && plan.action !== "already_materialized")) {
      return [plan];
    }
    const matchup = carryOver.matchups.find((entry) => entry.matchupId === plan.matchupId);
    if (!matchup) return [plan];
    const roundWindow = calculateSeriesRoundWindow({
      winsRequired: Number(current.wins_required ?? current.best_of ?? 2),
      currentWinsA: Number(matchup.startingWinsA ?? 0),
      currentWinsB: Number(matchup.startingWinsB ?? 0),
      qualified: Boolean(matchup.currentSeriesDecided),
    });
    const firstNewRound = plan.progression.transferredRoundCount + 1;
    const guaranteedRoundNumbers = Array.from(
      { length: roundWindow.minimumNewRounds },
      (_, index) => firstNewRound + index,
    );
    return guaranteedRoundNumbers.map((seriesRoundNumber) => {
      const round = plan.progression?.rounds.find((entry) => entry.seriesRoundNumber === seriesRoundNumber) ?? null;
      const existingRealGame = Boolean(round?.realGameId);
      const planningSlot = planningSlotsForMatchup(plan.matchupId)
        .find((slot) => slot.seriesRoundNumber === seriesRoundNumber) ?? null;
      const plannedGame: SeriesMaterializationPlannedGame | null = round
        ? {
            id: createEntityId("game"),
            competition_id: competitionId,
            phase_id: phaseId,
            schedule_id: String(schedule.id ?? ""),
            series_matchup_id: plan.matchupId,
            series_round_number: seriesRoundNumber,
            home_team_id: round.expectedHomeTeamId ?? "",
            away_team_id: round.expectedAwayTeamId ?? "",
            scheduled_date: planningSlot?.scheduledDate ?? null,
            scheduled_time: planningSlot?.scheduledTime ?? null,
            venue: planningSlot?.venue ?? "",
            status: "scheduled",
          }
        : null;
      return {
        ...plan,
        nextRequiredRoundNumber: seriesRoundNumber,
        alreadyMaterialized: existingRealGame,
        action: existingRealGame ? "already_materialized" as const : "create_game" as const,
        proposedHomeTeamId: round?.expectedHomeTeamId ?? null,
        proposedHomeTeamName: round?.expectedHomeTeamName ?? null,
        proposedAwayTeamId: round?.expectedAwayTeamId ?? null,
        proposedAwayTeamName: round?.expectedAwayTeamName ?? null,
        planningDate: planningSlot?.scheduledDate ?? null,
        planningTime: planningSlot?.scheduledTime ?? null,
        planningVenue: planningSlot?.venue ?? null,
        plannedGame,
        message: existingRealGame
          ? "Ο απαιτούμενος αγώνας έχει ήδη υλοποιηθεί."
          : "Ο εγγυημένα απαιτούμενος αγώνας μπορεί να δημιουργηθεί.",
      };
    });
  });

  const proposedGameCount = guaranteedPlans.filter((plan) => plan.action === "create_game").length;

  return {
    competitionId,
    phaseId,
    phaseName: String(current.name ?? null) || null,
    scheduleId: String(schedule.id ?? null) || null,
    sourcePhaseId: carryOver.sourcePhaseId,
    sourcePhaseName: carryOver.sourcePhaseName,
    carryOverEnabled: carryOver.carryOverEnabled,
    seriesMatchupCount: plans.length,
    existingSeriesGameCount: materializedGames.length,
    existingPlanningSlotCount: planningSlots.length,
    proposedGameCount,
    plans: guaranteedPlans,
  };
}

export async function materializeSeriesRequiredGames(
  db: D1DatabaseBinding,
  phaseId: string,
  competitionId: string,
  options: { provisionalSchedule?: ProvisionalPhaseSchedule } = {},
): Promise<SeriesMaterializationExecutionResult> {
  const writablePhase = await db.prepare(`SELECT id FROM league_phases
    WHERE id=? AND competition_id=? AND lifecycle_status='active' AND finalized_at IS NULL`)
    .bind(phaseId, competitionId).first<{ id: string }>();
  if (!writablePhase) throw new Error("Δεν επιτρέπεται υλοποίηση αγώνων σε οριστικοποιημένη Series Phase.");
  const dryRun = await dryRunSeriesInitialMaterializationPlan(db, phaseId, competitionId, options.provisionalSchedule);
  const createPlans = dryRun.plans.filter((plan) => plan.action === "create_game");
  const pendingPlans = dryRun.plans.filter((plan) => plan.action === "pending" && !plan.progression);
  if (pendingPlans.length) {
    throw new Error(pendingPlans.map((plan) => plan.message).filter(Boolean).join(" ") || "Το πρόγραμμα της Series Phase δεν μπορεί ακόμη να υλοποιηθεί.");
  }
  const alreadyMaterializedGameIds = dryRun.plans
    .filter((plan) => plan.action === "already_materialized" && plan.progression)
    .flatMap((plan) => plan.progression?.rounds ?? [])
    .map((round) => String(round.realGameId ?? ""))
    .filter(Boolean);

  if (!createPlans.length && !options.provisionalSchedule) {
    return {
      dryRun,
      createdGameIds: [],
      alreadyMaterializedGameIds,
    };
  }

  const statements: ReturnType<D1DatabaseBinding["prepare"]>[] = [];
  let scheduleStatementIndex: number | null = null;
  if (options.provisionalSchedule) {
    scheduleStatementIndex = statements.length;
    statements.push(db.prepare(`INSERT INTO league_phase_schedules
      (id, competition_id, phase_id, lifecycle_status)
      SELECT ?, ?, ?, 'draft'
      WHERE NOT EXISTS (SELECT 1 FROM league_phase_schedules WHERE phase_id=?)`)
      .bind(
        options.provisionalSchedule.id,
        options.provisionalSchedule.competition_id,
        options.provisionalSchedule.phase_id,
        options.provisionalSchedule.phase_id,
      ));
  }
  const operations: { plan: SeriesMaterializationMatchupPlan; proposedGameId: string; insertStatementIndex: number; planningStatementIndex: number }[] = [];
  for (const plan of createPlans) {
    if (!plan.plannedGame) {
      throw new Error(`Λείπει προτεινόμενος αγώνας για το matchup ${plan.matchupId}.`);
    }
    const operation = appendExactSeriesGameMaterializationStatements(db, statements, plan.plannedGame);
    operations.push({ plan, ...operation });
  }

  const batchResults = await db.batch(statements);
  const scheduleCreated = scheduleStatementIndex !== null
    && Number((batchResults[scheduleStatementIndex] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0;
  const insertedIds = operations
    .filter((operation) => Number((batchResults[operation.insertStatementIndex] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0)
    .map((operation) => operation.proposedGameId);
  const canonicalGameIds = await Promise.all(operations.map(async ({ plan }) => {
    const game = await db.prepare(`
      SELECT id FROM league_games
      WHERE phase_id=? AND series_matchup_id=? AND series_round_number=?
      LIMIT 1
    `).bind(
      plan.plannedGame?.phase_id ?? "",
      plan.plannedGame?.series_matchup_id ?? "",
      plan.plannedGame?.series_round_number ?? 0,
    ).first<{ id: string }>();
    return String(game?.id ?? "");
  }));
  const allAlreadyMaterializedGameIds = [...new Set([
    ...alreadyMaterializedGameIds,
    ...canonicalGameIds.filter((gameId) => gameId && !insertedIds.includes(gameId)),
  ])];

  return {
    dryRun,
    createdGameIds: insertedIds,
    alreadyMaterializedGameIds: allAlreadyMaterializedGameIds,
    scheduleCreated,
    planningLinksUpdated: operations.filter((operation) => Number((batchResults[operation.planningStatementIndex] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0).length,
  };
}

type ExactSeriesGameMaterializationOperation = {
  proposedGameId: string;
  insertStatementIndex: number;
  planningStatementIndex: number;
};

function appendExactSeriesGameMaterializationStatements(
  db: D1DatabaseBinding,
  statements: ReturnType<D1DatabaseBinding["prepare"]>[],
  plannedGame: SeriesMaterializationPlannedGame,
  guard: { sql: string; bindings: unknown[] } = { sql: "1=1", bindings: [] },
): ExactSeriesGameMaterializationOperation {
  const proposedGameId = createEntityId("game");
  const insertStatementIndex = statements.length;
  const planningStatementIndex = statements.length;
  statements.push(db.prepare(`
    INSERT INTO league_games
      (id, competition_id, phase_id, schedule_id, series_matchup_id, series_round_number,
       home_team_id, away_team_id, scheduled_date, scheduled_time, venue, home_score, away_score, status, result_source)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'scheduled', NULL
    WHERE ${guard.sql}
    ON CONFLICT(phase_id, series_matchup_id, series_round_number)
      WHERE series_matchup_id IS NOT NULL AND series_round_number IS NOT NULL
    DO NOTHING
  `).bind(
    proposedGameId,
    plannedGame.competition_id,
    plannedGame.phase_id,
    plannedGame.schedule_id,
    plannedGame.series_matchup_id,
    plannedGame.series_round_number,
    plannedGame.home_team_id,
    plannedGame.away_team_id,
    plannedGame.scheduled_date,
    plannedGame.scheduled_time,
    plannedGame.venue,
    ...guard.bindings,
  ));
  statements.push(db.prepare(`
    UPDATE league_series_planning_slots
    SET real_game_id=(
      SELECT g.id FROM league_games g
      WHERE g.phase_id=? AND g.series_matchup_id=? AND g.series_round_number=?
      LIMIT 1
    ), updated_at=CURRENT_TIMESTAMP
    WHERE schedule_id=? AND matchup_id=? AND series_round_number=?
      AND real_game_id IS NULL
      AND EXISTS (
        SELECT 1 FROM league_games g
        WHERE g.phase_id=? AND g.series_matchup_id=? AND g.series_round_number=?
      )
      AND (${guard.sql})
  `).bind(
    plannedGame.phase_id,
    plannedGame.series_matchup_id,
    plannedGame.series_round_number,
    plannedGame.schedule_id,
    plannedGame.series_matchup_id,
    plannedGame.series_round_number,
    plannedGame.phase_id,
    plannedGame.series_matchup_id,
    plannedGame.series_round_number,
    ...guard.bindings,
  ));
  return { proposedGameId, insertStatementIndex, planningStatementIndex };
}

type OfficialGameResultSource = "manual" | "match_report" | "award";

type OfficialGameResultInput = {
  gameId: string;
  competitionId: string;
  homeScore: unknown;
  awayScore: unknown;
  resultSource: OfficialGameResultSource;
};

export async function saveOfficialGameResultAndProgressSeries(
  input: OfficialGameResultInput,
  actor: string,
) {
  const db = await database();
  if (!db) throw new Error("Η αποθήκευση αποτελέσματος είναι διαθέσιμη μόνο με ενεργή βάση D1.");
  return saveOfficialGameResultAndProgressSeriesWithDb(db, input, actor);
}

async function saveOfficialGameResultAndProgressSeriesWithDb(
  db: D1DatabaseBinding,
  input: OfficialGameResultInput,
  actor: string,
) {
  const gameId = String(input.gameId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  if (!gameId || !competitionId) throw new Error("Λείπει ο αγώνας ή η διοργάνωση.");
  const current = await db.prepare(`SELECT g.*, p.lifecycle_status AS phase_lifecycle_status, p.finalized_at AS phase_finalized_at
    FROM league_games g JOIN league_phases p ON p.id=g.phase_id
    WHERE g.id=? AND g.competition_id=?`)
    .bind(gameId, competitionId).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε ο αγώνας στη συγκεκριμένη διοργάνωση.");
  if (String(current.phase_lifecycle_status ?? "active") === "finalized" || current.phase_finalized_at) {
    throw new Error("Το αποτέλεσμα αγώνα οριστικοποιημένης φάσης δεν μπορεί να τροποποιηθεί.");
  }

  const resultSource = input.resultSource;
  const currentResultSource = String(current.result_source ?? "").trim();
  if (resultSource === "manual" && ["match_report", "award"].includes(currentResultSource)) {
    throw new Error("Το αποτέλεσμα αυτού του αγώνα έχει ήδη δοθεί από Match Report ή κατακύρωση και δεν μπορεί να αντικατασταθεί ακόμη.");
  }
  const homeScore = parseNonNegativeInteger(input.homeScore, "Σκορ γηπεδούχου");
  const awayScore = parseNonNegativeInteger(input.awayScore, "Σκορ φιλοξενούμενου");
  if (homeScore === awayScore) throw new Error("Το τελικό αποτέλεσμα δεν μπορεί να είναι ισόπαλο.");

  const phaseId = String(current.phase_id ?? "").trim();
  const scheduleId = String(current.schedule_id ?? "").trim();
  const matchupId = String(current.series_matchup_id ?? "").trim();
  const seriesRoundNumber = Number(current.series_round_number ?? 0);
  const isSeriesGame = Boolean(phaseId && scheduleId && matchupId && Number.isInteger(seriesRoundNumber) && seriesRoundNumber >= 1);
  const optimisticBindings = [
    gameId,
    competitionId,
    String(current.status ?? ""),
    current.home_score ?? null,
    current.away_score ?? null,
    current.result_source ?? null,
    current.updated_at ?? null,
  ];
  const optimisticWhere = `id=? AND competition_id=? AND status IS ? AND home_score IS ?
    AND away_score IS ? AND result_source IS ? AND updated_at IS ?`;
  const resultPersistedGuard = {
    sql: `EXISTS (SELECT 1 FROM league_games result_game
      WHERE result_game.id=? AND result_game.competition_id=?
        AND result_game.home_score=? AND result_game.away_score=?
        AND result_game.status='completed' AND result_game.result_source=?)`,
    bindings: [gameId, competitionId, homeScore, awayScore, resultSource] as unknown[],
  };

  let transition: ReturnType<typeof planSeriesResultTransition> | null = null;
  let proposedProgression: ReturnType<typeof calculateSeriesProgression> | null = null;
  let exactMaterialization: SeriesMaterializationPlannedGame | null = null;
  let downstreamGames: (DbRow & { has_player_stats: number })[] = [];

  if (isSeriesGame) {
    const dryRun = await dryRunSeriesInitialMaterializationPlan(db, phaseId, competitionId);
    if (dryRun.scheduleId !== scheduleId) throw new Error("Ο αγώνας δεν ανήκει στον κανονικό προγραμματισμό της φάσης.");
    const matchupPlan = dryRun.plans.find((plan) => plan.matchupId === matchupId && plan.progression)?.progression ?? null;
    if (!matchupPlan) throw new Error("Δεν ήταν δυνατή η επίλυση του Series matchup.");

    const matchupGames = await rows<DbRow & { has_player_stats: number }>(db, `
      SELECT g.*, EXISTS(
        SELECT 1 FROM league_player_game_stats pgs WHERE pgs.game_id=g.id
      ) AS has_player_stats
      FROM league_games g
      WHERE g.competition_id=? AND g.phase_id=? AND g.schedule_id=? AND g.series_matchup_id=?
      ORDER BY g.series_round_number, g.id
    `, [competitionId, phaseId, scheduleId, matchupId]);
    if (!matchupGames.some((game) => String(game.id ?? "") === gameId)) {
      throw new Error("Ο αγώνας δεν ανήκει στο συγκεκριμένο Series matchup.");
    }
    const planningRows = await rows<SeriesPlanningSlotRow>(db, `
      SELECT id, competition_id, phase_id, schedule_id, matchup_id, series_round_number,
        scheduled_date, scheduled_time, venue, real_game_id
      FROM league_series_planning_slots
      WHERE competition_id=? AND phase_id=? AND schedule_id=? AND matchup_id=?
      ORDER BY series_round_number, id
    `, [competitionId, phaseId, scheduleId, matchupId]);
    const materializedRounds = new Set(matchupGames.map((game) => Number(game.series_round_number ?? 0)));
    const transferredGames: SeriesProgressionTransferredGame[] = matchupPlan.rounds
      .filter((round) => round.rowState === "transferred" && round.sourceGameId)
      .map((round) => ({
        sourceGameId: String(round.sourceGameId),
        seriesRoundNumber: round.seriesRoundNumber,
        homeTeamId: String(round.homeTeamId ?? ""),
        awayTeamId: String(round.awayTeamId ?? ""),
        homeScore: Number(round.homeScore),
        awayScore: Number(round.awayScore),
        status: "completed",
        date: null,
        time: null,
        venue: null,
      }));
    const materializedGames: SeriesProgressionMaterializedGame[] = matchupGames.map((game) => ({
      matchupId,
      gameId: String(game.id ?? ""),
      seriesRoundNumber: Number(game.series_round_number ?? 0),
      homeTeamId: String(game.home_team_id ?? ""),
      awayTeamId: String(game.away_team_id ?? ""),
      homeScore: String(game.id ?? "") === gameId ? homeScore : game.home_score === null ? null : Number(game.home_score),
      awayScore: String(game.id ?? "") === gameId ? awayScore : game.away_score === null ? null : Number(game.away_score),
      status: String(game.id ?? "") === gameId ? "completed" : String(game.status ?? ""),
      date: game.scheduled_date === null ? null : String(game.scheduled_date),
      time: game.scheduled_time === null ? null : String(game.scheduled_time),
      venue: game.venue === null ? null : String(game.venue),
    }));
    const planningSlots: SeriesProgressionPlanningSlot[] = planningRows
      .filter((slot) => !String(slot.real_game_id ?? "").trim() && !materializedRounds.has(Number(slot.series_round_number)))
      .map((slot) => ({
        seriesRoundNumber: Number(slot.series_round_number),
        scheduledDate: slot.scheduled_date,
        scheduledTime: slot.scheduled_time,
        venue: slot.venue,
      }));
    proposedProgression = calculateSeriesProgression({
      matchupId,
      teamA: { id: matchupPlan.teamAId, name: matchupPlan.teamAName },
      teamB: { id: matchupPlan.teamBId, name: matchupPlan.teamBName },
      winsRequired: matchupPlan.winsRequired,
      transferredGames,
      materializedGames,
      planningSlots,
    });
    downstreamGames = matchupGames.filter((game) => Number(game.series_round_number ?? 0) > seriesRoundNumber);
    const downstreamEvidence: SeriesResultDownstreamGame[] = downstreamGames.map((game) => ({
      gameId: String(game.id ?? ""),
      seriesRoundNumber: Number(game.series_round_number ?? 0),
      status: String(game.status ?? ""),
      homeScore: game.home_score === null ? null : Number(game.home_score),
      awayScore: game.away_score === null ? null : Number(game.away_score),
      resultSource: game.result_source === null ? null : String(game.result_source),
      externalId: game.external_id === null ? null : String(game.external_id),
      hasPlayerStats: Boolean(Number(game.has_player_stats ?? 0)),
      hasCompetitiveDependency: false,
    }));
    transition = planSeriesResultTransition({
      proposedProgression,
      resultRoundNumber: seriesRoundNumber,
      downstreamGames: downstreamEvidence,
    });

    if (transition.materializeRoundNumber !== null) {
      const nextRound = proposedProgression.rounds.find(
        (round) => round.seriesRoundNumber === transition?.materializeRoundNumber,
      );
      if (!nextRound?.expectedHomeTeamId || !nextRound.expectedAwayTeamId) {
        throw new Error("Δεν ήταν δυνατός ο προσδιορισμός του επόμενου Series αγώνα.");
      }
      const planning = planningRows.find(
        (slot) => Number(slot.series_round_number) === transition?.materializeRoundNumber && !slot.real_game_id,
      ) ?? null;
      exactMaterialization = {
        id: createEntityId("game"),
        competition_id: competitionId,
        phase_id: phaseId,
        schedule_id: scheduleId,
        series_matchup_id: matchupId,
        series_round_number: transition.materializeRoundNumber,
        home_team_id: nextRound.expectedHomeTeamId,
        away_team_id: nextRound.expectedAwayTeamId,
        scheduled_date: planning?.scheduled_date ?? null,
        scheduled_time: planning?.scheduled_time ?? null,
        venue: planning?.venue ?? "",
        status: "scheduled",
      };
    }
  }

  const invalidatedIds = transition?.dematerializeGameIds ?? [];
  const invalidatedPlaceholders = invalidatedIds.map(() => "?").join(",");
  const noUnsafeInvalidatedSql = invalidatedIds.length
    ? `AND NOT EXISTS (
        SELECT 1 FROM league_games g
        WHERE g.id IN (${invalidatedPlaceholders}) AND ${phaseProgramUnsafeGameSql}
      )`
    : "";
  const statements: ReturnType<D1DatabaseBinding["prepare"]>[] = [];
  statements.push(db.prepare(`UPDATE league_games SET
    home_score=?, away_score=?, status='completed', result_source=?, updated_at=CURRENT_TIMESTAMP
    WHERE ${optimisticWhere} ${noUnsafeInvalidatedSql}`)
    .bind(homeScore, awayScore, resultSource, ...optimisticBindings, ...invalidatedIds));

  for (const downstreamGameId of invalidatedIds) {
    statements.push(db.prepare(`
      UPDATE league_series_planning_slots
      SET scheduled_date=(SELECT g.scheduled_date FROM league_games g WHERE g.id=?),
        scheduled_time=(SELECT g.scheduled_time FROM league_games g WHERE g.id=?),
        venue=COALESCE((SELECT g.venue FROM league_games g WHERE g.id=?), ''),
        real_game_id=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE real_game_id=?
        AND ${resultPersistedGuard.sql}
        AND EXISTS (
          SELECT 1 FROM league_games g
          WHERE g.id=? AND NOT ${phaseProgramUnsafeGameSql}
        )
    `).bind(
      downstreamGameId,
      downstreamGameId,
      downstreamGameId,
      downstreamGameId,
      ...resultPersistedGuard.bindings,
      downstreamGameId,
    ));
    statements.push(db.prepare(`
      DELETE FROM league_games AS g
      WHERE g.id=? AND g.phase_id=? AND g.schedule_id=? AND g.series_matchup_id=?
        AND NOT ${phaseProgramUnsafeGameSql}
        AND ${resultPersistedGuard.sql}
    `).bind(
      downstreamGameId,
      phaseId,
      scheduleId,
      matchupId,
      ...resultPersistedGuard.bindings,
    ));
  }

  let materializationOperation: ExactSeriesGameMaterializationOperation | null = null;
  if (exactMaterialization) {
    materializationOperation = appendExactSeriesGameMaterializationStatements(
      db,
      statements,
      exactMaterialization,
      resultPersistedGuard,
    );
  }
  statements.push(db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
    WHERE ${resultPersistedGuard.sql}`)
    .bind(
      createEntityId("audit"),
      actor,
      "official_result",
      "games",
      gameId,
      JSON.stringify({
        before: current,
        after: { homeScore, awayScore, status: "completed", resultSource },
        seriesTransition: transition,
      }),
      ...resultPersistedGuard.bindings,
    ));

  const batchResults = await db.batch(statements);
  const updateChanges = Number((batchResults[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  const persisted = await db.prepare(`SELECT home_score, away_score, status, result_source
    FROM league_games WHERE id=? AND competition_id=?`)
    .bind(gameId, competitionId).first<DbRow>();
  const persistedAsProposed = Number(persisted?.home_score) === homeScore
    && Number(persisted?.away_score) === awayScore
    && String(persisted?.status ?? "") === "completed"
    && String(persisted?.result_source ?? "") === resultSource;
  if (!updateChanges && !persistedAsProposed) {
    throw new Error("Το αποτέλεσμα άλλαξε ταυτόχρονα. Ανανεώστε τα δεδομένα και δοκιμάστε ξανά.");
  }

  let materializedGameId: string | null = null;
  if (exactMaterialization) {
    const canonicalGame = await db.prepare(`SELECT id FROM league_games
      WHERE phase_id=? AND series_matchup_id=? AND series_round_number=? LIMIT 1`)
      .bind(phaseId, matchupId, exactMaterialization.series_round_number).first<{ id: string }>();
    materializedGameId = String(canonicalGame?.id ?? "") || null;
  }
  return {
    id: gameId,
    resultSource,
    seriesProgression: transition,
    materializedGameId,
    materializedGameCreated: Boolean(
      materializationOperation
      && Number((batchResults[materializationOperation.insertStatementIndex] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0
    ),
  };
}

export async function saveSeriesPlanningSlot(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Ο προσωρινός προγραμματισμός είναι διαθέσιμος στη βάση D1 μετά την εγκατάσταση.");

  const competitionId = String(input.competitionId ?? input.competition_id ?? "").trim();
  const phaseId = String(input.phaseId ?? input.phase_id ?? "").trim();
  const matchupId = String(input.matchupId ?? input.matchup_id ?? "").trim();
  const seriesRoundNumber = optionalInteger(
    input.seriesRoundNumber ?? input.series_round_number,
    "Γύρος σειράς",
    1,
  );
  if (!competitionId || !phaseId || !matchupId || seriesRoundNumber === null) {
    throw new Error("Λείπει η διοργάνωση, η φάση, το matchup ή ο γύρος σειράς.");
  }

  const phase = await db.prepare(`
    SELECT p.*, pr.phase_kind, pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.id=? AND p.competition_id=?
  `).bind(phaseId, competitionId).first<DbRow>();
  if (!phase) throw new Error("Δεν βρέθηκε η φάση στη συγκεκριμένη διοργάνωση.");
  if (normalizeCanonicalFormat(String(phase.format ?? ""), String(phase.phase_kind ?? "")) !== "series") {
    throw new Error("Ο προσωρινός προγραμματισμός επιτρέπεται μόνο σε φάση σειράς αγώνων.");
  }
  if (String(phase.lifecycle_status ?? "active") === "finalized" || phase.finalized_at) {
    throw new Error("Η οριστικοποιημένη φάση δεν επιτρέπει προσωρινό προγραμματισμό.");
  }

  const schedules = await rows<DbRow>(db, `
    SELECT id, competition_id, phase_id
    FROM league_phase_schedules
    WHERE competition_id=? AND phase_id=?
    ORDER BY id
  `, [competitionId, phaseId]);
  if (schedules.length !== 1) {
    throw new Error(schedules.length ? "Βρέθηκαν πολλαπλά προγράμματα για τη φάση." : "Δεν βρέθηκε πρόγραμμα για τη φάση.");
  }
  const scheduleId = String(schedules[0]?.id ?? "");

  const settings = parseJsonRecord(phase.rule_settings_json ?? phase.settings_json ?? "{}");
  const bracket = parseJsonRecord(settings.bracketConfiguration);
  const matchups = Array.isArray(bracket.matchups) ? bracket.matchups : [];
  if (!matchups.some((matchup) => String(parseJsonRecord(matchup).id ?? "").trim() === matchupId)) {
    throw new Error("Το matchup δεν υπάρχει στη διαμόρφωση της φάσης.");
  }

  const existingSlot = await db.prepare(`
    SELECT * FROM league_series_planning_slots
    WHERE schedule_id=? AND matchup_id=? AND series_round_number=?
  `).bind(scheduleId, matchupId, seriesRoundNumber).first<DbRow>();
  if (existingSlot?.real_game_id) {
    throw new Error("Ο προσωρινός προγραμματισμός έχει ήδη συνδεθεί με πραγματικό αγώνα.");
  }
  const existingGame = await db.prepare(`
    SELECT id FROM league_games
    WHERE phase_id=? AND series_matchup_id=? AND series_round_number=?
  `).bind(phaseId, matchupId, seriesRoundNumber).first<DbRow>();
  if (existingGame) {
    throw new Error("Ο γύρος έχει ήδη υλοποιηθεί ως πραγματικός αγώνας.");
  }

  const dryRun = await dryRunSeriesInitialMaterializationPlan(db, phaseId, competitionId);
  const matchupPlan = dryRun.plans.find((plan) => plan.matchupId === matchupId && plan.progression)?.progression ?? null;
  const progressionRow = matchupPlan?.rounds.find((round) => round.seriesRoundNumber === seriesRoundNumber) ?? null;
  if (!progressionRow || progressionRow.rowState !== "if_needed") {
    throw new Error("Ο συγκεκριμένος γύρος δεν είναι διαθέσιμος για προσωρινό προγραμματισμό.");
  }

  const scheduledDate = validateIsoDate(input.scheduledDate ?? input.scheduled_date ?? null, "Ημερομηνία");
  const scheduledTime = validateHmTime(input.scheduledTime ?? input.scheduled_time ?? null, "Ώρα");
  if (!scheduledDate && scheduledTime) {
    throw new Error("Η ώρα δεν μπορεί να οριστεί χωρίς ημερομηνία.");
  }

  const venueId = String(input.venueId ?? input.venue_id ?? "").trim();
  let venue = "";
  if (venueId) {
    const venueRow = await db.prepare(`
      SELECT id, name FROM league_competition_venues
      WHERE id=? AND competition_id=?
    `).bind(venueId, competitionId).first<DbRow>();
    if (!venueRow) throw new Error("Το επιλεγμένο γήπεδο δεν ανήκει στη συγκεκριμένη διοργάνωση.");
    venue = String(venueRow.name ?? "").trim();
    if (!venue) throw new Error("Το επιλεγμένο γήπεδο δεν είναι έγκυρο.");
  }

  const allEmpty = !scheduledDate && !scheduledTime && !venue;
  if (allEmpty) {
    if (!existingSlot) {
      return { saved: false, cleared: true, noPlanning: true, planningSlotId: null };
    }
    await db.prepare(`
      DELETE FROM league_series_planning_slots
      WHERE schedule_id=? AND matchup_id=? AND series_round_number=? AND real_game_id IS NULL
    `).bind(scheduleId, matchupId, seriesRoundNumber).run();
    const remainingSlot = await db.prepare(`
      SELECT id, real_game_id
      FROM league_series_planning_slots
      WHERE schedule_id=? AND matchup_id=? AND series_round_number=?
      LIMIT 1
    `).bind(scheduleId, matchupId, seriesRoundNumber).first<Record<string, unknown>>();
    if (remainingSlot?.real_game_id) {
      throw new Error("Ο προσωρινός προγραμματισμός έχει ήδη συνδεθεί με πραγματικό αγώνα.");
    }
    if (remainingSlot) {
      throw new Error("Ο προσωρινός προγραμματισμός άλλαξε ταυτόχρονα. Ανανεώστε τα δεδομένα και δοκιμάστε ξανά.");
    }
    return { saved: false, cleared: true, noPlanning: true, planningSlotId: null };
  }

  const planningSlotId = String(existingSlot?.id ?? createEntityId("seriesPlanningSlot"));
  await db.prepare(`
    INSERT INTO league_series_planning_slots
      (id, competition_id, phase_id, schedule_id, matchup_id, series_round_number,
       scheduled_date, scheduled_time, venue, real_game_id, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1 FROM league_games
      WHERE phase_id=? AND series_matchup_id=? AND series_round_number=?
    )
    ON CONFLICT(schedule_id, matchup_id, series_round_number) DO UPDATE SET
      scheduled_date=excluded.scheduled_date,
      scheduled_time=excluded.scheduled_time,
      venue=excluded.venue,
      updated_at=CURRENT_TIMESTAMP
    WHERE league_series_planning_slots.real_game_id IS NULL
  `).bind(
    planningSlotId,
    competitionId,
    phaseId,
    scheduleId,
    matchupId,
    seriesRoundNumber,
    scheduledDate,
    scheduledTime,
    venue,
    phaseId,
    matchupId,
    seriesRoundNumber,
  ).run();

  const savedSlot = await db.prepare(`
    SELECT id, real_game_id FROM league_series_planning_slots
    WHERE schedule_id=? AND matchup_id=? AND series_round_number=?
  `).bind(scheduleId, matchupId, seriesRoundNumber).first<DbRow>();
  if (!savedSlot || savedSlot.real_game_id) {
    throw new Error("Ο γύρος υλοποιήθηκε ταυτόχρονα ως πραγματικός αγώνας. Επεξεργαστείτε πλέον τον αγώνα.");
  }

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(
      createEntityId("audit"),
      actor,
      existingSlot ? "update" : "create",
      "series-planning-slots",
      String(savedSlot.id ?? planningSlotId),
      JSON.stringify({ competitionId, phaseId, scheduleId, matchupId, seriesRoundNumber, scheduledDate, scheduledTime, venue }),
    ).run();

  return {
    saved: true,
    cleared: false,
    noPlanning: false,
    planningSlotId: String(savedSlot.id ?? planningSlotId),
  };
}

export async function finalizePhaseById(
  db: D1DatabaseBinding,
  phaseId: string,
  competitionId: string,
  actor: string,
) {
  const current = await db.prepare(`
    SELECT p.*, pr.phase_kind, pr.bracket_size, pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
    FROM league_phases p
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.id=? AND p.competition_id=?
  `).bind(phaseId, competitionId).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η φάση.");
  const currentLifecycle = String(current.lifecycle_status ?? "active");
  if (currentLifecycle === "finalized") {
    throw new Error("Η φάση έχει ήδη οριστικοποιηθεί.");
  }

  const currentFormat = normalizeCanonicalFormat(String(current.format ?? ""), String(current.phase_kind ?? ""));
  if (currentFormat === "series") {
    const completion = await deriveSeriesPhaseCompletionWithDb(db, current);
    if (!completion.competitivelyComplete || completion.blockers.length) {
      const explanation = completion.blockers.map((entry: SeriesPhaseCompletionBlocker) => entry.message).join(" ");
      throw new Error(`Η Series Phase δεν είναι competitively complete.${explanation ? ` ${explanation}` : ""}`);
    }
    const batchResults = await db.batch([
      db.prepare(`UPDATE league_phases
        SET lifecycle_status='finalized', finalized_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND competition_id=? AND lifecycle_status='active' AND finalized_at IS NULL`)
        .bind(phaseId, competitionId),
      db.prepare(`INSERT INTO league_audit_log
        (id,actor_email,action,entity_type,entity_id,details_json,created_at)
        SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
        WHERE changes()=1`)
        .bind(
          createEntityId("audit"),
          actor,
          "finalize",
          "phases",
          phaseId,
          JSON.stringify({
            before: { lifecycle_status: currentLifecycle },
            after: { lifecycle_status: "finalized" },
            seriesOutcomes: completion.outcomes,
          }),
        ),
    ]);
    const changed = Number((batchResults[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0);
    if (changed !== 1) throw new Error("Η φάση έχει ήδη οριστικοποιηθεί ή άλλαξε ταυτόχρονα.");
    return { id: phaseId, competitivelyComplete: true, outcomes: completion.outcomes };
  }
  if (currentFormat !== "standings") {
    throw new Error("Η μορφή της φάσης δεν υποστηρίζει οριστικοποίηση.");
  }

  const phaseGames = await rows<DbRow>(
    db,
    `
    SELECT id, phase_id, home_team_id, away_team_id, home_score, away_score, status, result_source
    FROM league_games
    WHERE phase_id=?
    ORDER BY COALESCE(round_number, 0), COALESCE(game_order, 0), id
    `,
    [phaseId],
  );
  if (!phaseGames.length) {
    throw new Error("Η φάση δεν μπορεί να οριστικοποιηθεί χωρίς αγώνες.");
  }

  const eligibleParticipants = await resolvePhaseParticipantsForStandings(db, current);
  if (eligibleParticipants.length < 2) {
    throw new Error("Η φάση δεν έχει αρκετές συμμετοχές για οριστικοποίηση.");
  }
  const participantIds = new Set(eligibleParticipants.map((entry) => entry.teamId));

  for (const game of phaseGames) {
    const homeTeamId = String(game.home_team_id ?? "").trim();
    const awayTeamId = String(game.away_team_id ?? "").trim();
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
      throw new Error("Η φάση περιέχει μη έγκυρο αγώνα.");
    }
    if (!participantIds.has(homeTeamId) || !participantIds.has(awayTeamId)) {
      throw new Error("Η φάση περιέχει αγώνα με ομάδα εκτός της συμμετοχής.");
    }
    validateFinalGameState(game);
  }

  const rules = parsePhaseRuleJson(current.rule_settings_json);
  const standings = calculateStandings({
    phaseId,
    teams: eligibleParticipants.map((entry) => ({
      id: String(entry.teamId ?? ""),
      name: String(entry.teamName ?? "—"),
    })),
    games: phaseGames.map((game) => ({
      id: String(game.id ?? ""),
      phaseId: String(game.phase_id ?? null),
      homeTeamId: String(game.home_team_id ?? ""),
      awayTeamId: String(game.away_team_id ?? ""),
      homeScore: game.home_score as number | string | null,
      awayScore: game.away_score as number | string | null,
      status: String(game.status ?? null),
      resultSource: game.result_source === undefined ? null : String(game.result_source ?? null),
    })),
    rules: {
      pointsForWin: Number(rules.pointsForWin ?? rules.winPoints ?? 2),
      pointsForLoss: Number(rules.pointsForLoss ?? rules.lossPoints ?? 1),
    },
    tieBreakers: parseStandingsTieBreakers(rules.tieBreakers) as any,
  });
  await db.batch([
    db.prepare(`UPDATE league_phases
      SET lifecycle_status='finalized', finalized_at=COALESCE(finalized_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND competition_id=?`).bind(phaseId, competitionId),
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(
        createEntityId("audit"),
        actor,
        "finalize",
        "phases",
        phaseId,
        JSON.stringify({
          before: { lifecycle_status: currentLifecycle },
          after: { lifecycle_status: "finalized" },
          standings: standings.orderedRows.map((row) => ({
            teamId: row.teamId,
            rank: row.rank,
            primaryPoints: row.primaryPoints,
            tieResolved: row.tieResolved,
          })),
        }),
      ),
  ]);

  return { id: phaseId };
}

export async function finalizeLeaguePhase(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η οριστικοποίηση φάσης είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");
  const phaseId = String(input.phaseId ?? input.id ?? input.phase_id ?? "").trim();
  const competitionId = String(input.competitionId ?? input.competition_id ?? "").trim();
  if (!phaseId || !competitionId) throw new Error("Λείπει phaseId ή competitionId.");
  return finalizePhaseById(db, phaseId, competitionId, actor);
}

function seasonInput(input: Record<string, unknown>): SeasonInput {
  const name = String(input.name ?? "").trim();
  const startsOn = String(input.startsOn ?? "").trim() || null;
  const endsOn = String(input.endsOn ?? "").trim() || null;
  const status = String(input.status ?? "draft");

  const seasonMatch = /^(\d{4})-(\d{2})$/.exec(name);
  if (!seasonMatch || Number(seasonMatch[2]) !== (Number(seasonMatch[1]) + 1) % 100) {
    throw new Error("Η ονομασία της σεζόν πρέπει να έχει μορφή 2026-27.");
  }
  if (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    throw new Error("Η ημερομηνία έναρξης δεν είναι έγκυρη.");
  }
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
    throw new Error("Η ημερομηνία λήξης δεν είναι έγκυρη.");
  }
  if (startsOn && endsOn && startsOn > endsOn) {
    throw new Error("Η ημερομηνία λήξης πρέπει να είναι μετά την ημερομηνία έναρξης.");
  }
  if (!SEASON_STATUSES.has(status)) {
    throw new Error("Η κατάσταση της σεζόν δεν είναι έγκυρη.");
  }

  return { name, startsOn, endsOn, status: status as SeasonInput["status"] };
}

async function competitionInput(
  db: D1DatabaseBinding,
  input: Record<string, unknown>,
  current?: DbRow,
) {
  const sourceId = String(input.sourceCompetitionId ?? "").trim();
  const source = sourceId
    ? await db.prepare(`SELECT c.*, cp.lifecycle_status, cf.expected_team_count,
        cf.regular_season_meetings, cf.win_points, cf.loss_points, cf.forfeit_points,
        cf.tiebreakers_json, cf.settings_json AS format_settings_json
        FROM league_competitions c
        LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
        LEFT JOIN league_competition_formats cf ON cf.competition_id=c.id
        WHERE c.id=?`).bind(sourceId).first<DbRow>()
    : null;
  if (sourceId && !source) throw new Error("Δεν βρέθηκε η διοργάνωση που επιλέχθηκε για επαναχρησιμοποίηση.");

  const seasonId = String(input.seasonId ?? current?.season_id ?? "").trim();
  const season = seasonId
    ? await db.prepare("SELECT id FROM league_seasons WHERE id=?").bind(seasonId).first<{ id: string }>()
    : null;
  if (!season) throw new Error("Επίλεξε έγκυρη σεζόν.");

  const name = String(input.name ?? source?.name ?? current?.name ?? "").trim();
  if (!name) throw new Error("Η ονομασία της διοργάνωσης είναι υποχρεωτική.");
  const rawType = String(input.type ?? source?.type ?? current?.type ?? "league");
  const type = rawType === "custom" ? "league" : rawType;
  if (!COMPETITION_TYPES.has(type)) throw new Error("Ο τύπος της διοργάνωσης δεν είναι έγκυρος.");
  const customTypeLabel = rawType === "custom"
    ? String(input.customTypeLabel ?? "").trim() || null
    : null;
  if (rawType === "custom" && !customTypeLabel) throw new Error("Απαιτείται ονομασία για custom τύπο.");
  const lifecycleStatus = lifecycleValue(
    input,
    String(source?.lifecycle_status ?? current?.lifecycle_status ?? "under_construction"),
  );
  const expectedTeamCount = optionalInteger(
    input.expectedTeamCount ?? source?.expected_team_count ?? current?.expected_team_count,
    "Αριθμός ομάδων",
    2,
  );
  const regularSeasonMeetings = optionalInteger(
    input.regularSeasonMeetings ?? source?.regular_season_meetings ?? current?.regular_season_meetings ?? 1,
    "Αγώνες μεταξύ ομάδων",
    0,
  ) ?? 1;

  return {
    sourceId,
    seasonId,
    name,
    slug: String(input.slug ?? "").trim() || slugify(name),
    type,
    customTypeLabel,
    description: String(input.description ?? source?.description ?? current?.description ?? "").trim(),
    lifecycleStatus,
    legacyStatus: lifecycleToLegacyStatus[lifecycleStatus],
    expectedTeamCount,
    regularSeasonMeetings,
    winPoints: numberValue(input.winPoints ?? source?.win_points ?? current?.win_points, 2, "Βαθμοί νίκης"),
    lossPoints: numberValue(input.lossPoints ?? source?.loss_points ?? current?.loss_points, 1, "Βαθμοί ήττας"),
    forfeitPoints: numberValue(input.forfeitPoints ?? source?.forfeit_points ?? current?.forfeit_points, 0, "Βαθμοί μηδενισμού"),
    tiebreakersJson: String(input.tiebreakersJson ?? source?.tiebreakers_json ?? current?.tiebreakers_json ?? "[]"),
    settingsJson: String(input.settingsJson ?? source?.format_settings_json ?? current?.format_settings_json ?? "{}"),
    copyPhases: booleanValue(input.copyPhases),
    logoUrl: String(input.logoUrl ?? source?.logo_url ?? current?.logo_url ?? "").trim() || null,
  };
}

async function saveCompetitionDetails(
  db: D1DatabaseBinding,
  id: string,
  competition: Awaited<ReturnType<typeof competitionInput>>,
) {
  await db.prepare(`INSERT INTO league_competition_publication
    (competition_id,lifecycle_status,published_at,completed_at,updated_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(competition_id) DO UPDATE SET
      lifecycle_status=excluded.lifecycle_status,
      published_at=CASE WHEN excluded.lifecycle_status='online' THEN COALESCE(league_competition_publication.published_at,CURRENT_TIMESTAMP) ELSE league_competition_publication.published_at END,
      completed_at=CASE WHEN excluded.lifecycle_status='complete' THEN COALESCE(league_competition_publication.completed_at,CURRENT_TIMESTAMP) ELSE NULL END,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(
      id,
      competition.lifecycleStatus,
      competition.lifecycleStatus === "online" ? new Date().toISOString() : null,
      competition.lifecycleStatus === "complete" ? new Date().toISOString() : null,
    ).run();

  await db.prepare(`INSERT INTO league_competition_formats
    (competition_id,expected_team_count,regular_season_meetings,win_points,loss_points,forfeit_points,tiebreakers_json,settings_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(competition_id) DO UPDATE SET
      expected_team_count=excluded.expected_team_count,
      regular_season_meetings=excluded.regular_season_meetings,
      win_points=excluded.win_points,
      loss_points=excluded.loss_points,
      forfeit_points=excluded.forfeit_points,
      tiebreakers_json=excluded.tiebreakers_json,
      settings_json=excluded.settings_json,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(
      id,
      competition.expectedTeamCount,
      competition.regularSeasonMeetings,
      competition.winPoints,
      competition.lossPoints,
      competition.forfeitPoints,
      competition.tiebreakersJson,
      competition.settingsJson,
    ).run();
}

async function phaseInput(db: D1DatabaseBinding, input: Record<string, unknown>, current?: DbRow) {
  const competitionId = String(input.competitionId ?? current?.competition_id ?? "").trim();
  const competition = competitionId
    ? await db.prepare("SELECT id FROM league_competitions WHERE id=?").bind(competitionId).first<{ id: string }>()
    : null;
  if (!competition) throw new Error("Επίλεξε έγκυρη διοργάνωση.");
  const name = String(input.name ?? current?.name ?? "").trim();
  if (!name) throw new Error("Η ονομασία της φάσης είναι υποχρεωτική.");
  const phaseFormat = phaseFormatValue(input, String(current?.format ?? current?.phase_kind ?? "standings"));
  const legacyPhaseType = phaseFormatToPhaseType(phaseFormat);
  const providedOrder = optionalInteger(
    input.orderIndex ?? input.phaseOrder ?? input.order ?? input.phase_order,
    "Σειρά εμφάνισης",
    1,
  );
  const nextOrder = current
    ? undefined
    : await db.prepare(
      "SELECT COALESCE(MAX(COALESCE(phase_order, order_index, 0)), 0) AS max_order FROM league_phases WHERE competition_id=?",
    ).bind(competitionId).first<{ max_order: number | null }>();
  const resolvedPhaseOrder = current
    ? (providedOrder ?? Number(current?.phase_order ?? current?.order_index ?? 1))
    : (providedOrder ?? Number(nextOrder?.max_order ?? 0) + 1);
  const bestOf = optionalInteger(input.bestOf ?? current?.best_of, "Best of", 1);
  if (bestOf !== null && bestOf % 2 === 0) throw new Error("Το Best of πρέπει να είναι μονός αριθμός.");
  const winsRequired = optionalInteger(input.winsRequired ?? current?.wins_required, "Απαιτούμενες νίκες", 1);
  if (bestOf !== null && winsRequired !== null && winsRequired > Math.ceil(bestOf / 2)) {
    throw new Error("Οι απαιτούμενες νίκες δεν συμφωνούν με το Best of.");
  }
  const carryOverEnabled = booleanValue(input.carryOverEnabled);
  const sourcePhaseIdInput = String(input.carryOverSourcePhaseId ?? "").trim() || null;
  const sourcePhaseId = carryOverEnabled ? sourcePhaseIdInput : null;
  let sourceGamesPerPairing = 1;
  if (carryOverEnabled && sourcePhaseId) {
    const source = await db.prepare(`
      SELECT p.id, p.format, pr.settings_json
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      WHERE p.id=? AND p.competition_id=?
    `).bind(sourcePhaseId, competitionId).first<{ id: string; format: string | null; settings_json: string | null }>();
    if (!source) throw new Error("Η φάση προέλευσης πρέπει να ανήκει στην ίδια διοργάνωση.");
    const sourceFormat = String(source.format ?? "").trim().toLowerCase();
    if (sourceFormat !== "standings") {
      throw new Error("Η φάση προέλευσης πρέπει να είναι βαθμολογική.");
    }
    const sourceRules = parseJsonRecord(source.settings_json);
    sourceGamesPerPairing = parseStandingsRuleInt(sourceRules.gamesPerPairing, 1, "Αγώνες ανά ζευγάρι", 1);
  }
  const previousPhaseIdInput = String(input.previousPhaseId ?? input.previous_phase_id ?? "").trim() || null;
  const previousPhaseId = previousPhaseIdInput || null;
  if (previousPhaseId) {
    if (previousPhaseId === String(current?.id ?? "")) {
      throw new Error("Η προηγούμενη φάση δεν μπορεί να είναι η ίδια η φάση.");
    }
    const previousPhase = await db.prepare(`
      SELECT id, competition_id, previous_phase_id
      FROM league_phases
      WHERE id=?
    `).bind(previousPhaseId).first<{ id: string; competition_id: string; previous_phase_id: string | null }>();
    if (!previousPhase || String(previousPhase.competition_id ?? "") !== competitionId) {
      throw new Error("Η προηγούμενη φάση πρέπει να ανήκει στην ίδια διοργάνωση.");
    }
    const visited = new Set<string>([String(current?.id ?? "")].filter(Boolean));
    let cursor: string | null = previousPhaseId;
    while (cursor) {
      if (visited.has(cursor)) {
        throw new Error("Η προηγούμενη φάση δημιουργεί κυκλική εξάρτηση.");
      }
      visited.add(cursor);
      const parent: { previous_phase_id: string | null } | null = await db.prepare(`
        SELECT previous_phase_id
        FROM league_phases
        WHERE id=? AND competition_id=?
      `).bind(cursor, competitionId).first<{ previous_phase_id: string | null }>();
      cursor = parent?.previous_phase_id ? String(parent.previous_phase_id) : null;
    }
  }
  const currentRuleSettings = parsePhaseRuleJson(current?.rule_settings_json);
  const participantConfig = await parsePhaseParticipantConfig(
    db,
    competitionId,
    Number.isFinite(resolvedPhaseOrder) ? resolvedPhaseOrder : 1,
    phaseFormat,
    input,
    current ?? {},
  );
  const scheduleMode = parseScheduleMode(
    input.scheduleMode ?? currentRuleSettings.scheduleMode,
  );
  const pointsForWin = parseStandingsRuleInt(
    input.pointsForWin ?? input.winPoints ?? currentRuleSettings.pointsForWin ?? currentRuleSettings.winPoints,
    2,
    "Βαθμοί νίκης",
    0,
  );
  const pointsForLoss = parseStandingsRuleInt(
    input.pointsForLoss ?? input.lossPoints ?? currentRuleSettings.pointsForLoss ?? currentRuleSettings.lossPoints,
    1,
    "Βαθμοί ήττας",
    0,
  );
  const forfeitPoints = parseStandingsRuleInt(
    input.forfeitPoints ?? currentRuleSettings.forfeitPoints,
    0,
    "Βαθμοί μηδενισμού",
    0,
  );
  const gamesPerPairing = parseStandingsRuleInt(
    input.gamesPerPairing ?? currentRuleSettings.gamesPerPairing,
    1,
    "Αγώνες ανά ζευγάρι",
    1,
  );
  const tieBreakers = parseStandingsTieBreakers(
    input.tieBreakers ?? currentRuleSettings.tieBreakers,
  );
  const carryOverMeetingNumbers = parseCarryOverMeetingNumbers(
    input.carryOverMeetingNumbers ?? currentRuleSettings.carryOverMeetingNumbers,
    sourceGamesPerPairing,
    carryOverEnabled,
  );
  return {
    competitionId,
    name,
    slug: String(input.slug ?? "").trim() || slugify(name),
    phaseFormat,
    legacyPhaseType,
    orderIndex: Number.isFinite(resolvedPhaseOrder) ? resolvedPhaseOrder : 1,
    bracketSize: optionalInteger(input.bracketSize ?? current?.bracket_size, "Μέγεθος ταμπλό", 2),
    bestOf,
    winsRequired,
    carryOverEnabled: booleanValue(input.carryOverEnabled),
    carryOverSourcePhaseId: sourcePhaseId,
    previousPhaseId,
    settingsJson: JSON.stringify({
      ...currentRuleSettings,
      winPoints: pointsForWin,
      lossPoints: pointsForLoss,
      pointsForWin,
      pointsForLoss,
      forfeitPoints,
      gamesPerPairing,
      tieBreakers,
      scheduleMode,
      participantConfiguration: participantConfig.participantConfiguration,
      bracketConfiguration: participantConfig.bracketConfiguration,
      carryOverMeetingNumbers,
    }),
    participantConfig,
  };
}

async function savePhaseRules(
  db: D1DatabaseBinding,
  id: string,
  phase: Awaited<ReturnType<typeof phaseInput>>,
) {
  await db.prepare(`INSERT INTO league_phase_rules
    (phase_id,phase_kind,bracket_size,best_of,wins_required,carry_over_enabled,carry_over_source_phase_id,settings_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(phase_id) DO UPDATE SET
      phase_kind=excluded.phase_kind,
      bracket_size=excluded.bracket_size,
      best_of=excluded.best_of,
      wins_required=excluded.wins_required,
      carry_over_enabled=excluded.carry_over_enabled,
      carry_over_source_phase_id=excluded.carry_over_source_phase_id,
      settings_json=excluded.settings_json,
      updated_at=CURRENT_TIMESTAMP`)
    .bind(
      id,
      phase.legacyPhaseType,
      phase.bracketSize,
      phase.bestOf,
      phase.winsRequired,
      phase.carryOverEnabled ? 1 : 0,
      phase.carryOverEnabled ? phase.carryOverSourcePhaseId : null,
      phase.settingsJson,
    ).run();
}

type StandingsPresentationCategory = "direct_qualification" | "play_out" | "eliminated";
type StandingsPresentation = Record<StandingsPresentationCategory, number[]>;

const standingsPresentationCategories = new Set<StandingsPresentationCategory>([
  "direct_qualification",
  "play_out",
  "eliminated",
]);

function parseStandingsPresentation(input: Record<string, unknown>): StandingsPresentation | null {
  if (input.standingsPresentation === undefined) return null;
  const raw = parseJsonRecord(input.standingsPresentation);
  const presentation: StandingsPresentation = {
    direct_qualification: [],
    play_out: [],
    eliminated: [],
  };
  const assignedPositions = new Set<number>();

  for (const [category, value] of Object.entries(raw)) {
    if (!standingsPresentationCategories.has(category as StandingsPresentationCategory)) {
      throw new Error("Μη έγκυρη κατηγορία δημόσιας απεικόνισης βαθμολογίας.");
    }
    if (!Array.isArray(value)) {
      throw new Error("Οι θέσεις δημόσιας απεικόνισης βαθμολογίας πρέπει να είναι λίστα.");
    }
    const positions = value.map((position) => Number(position));
    if (positions.some((position) => !Number.isInteger(position) || position < 1)) {
      throw new Error("Οι θέσεις δημόσιας απεικόνισης βαθμολογίας πρέπει να είναι θετικοί ακέραιοι.");
    }
    if (new Set(positions).size !== positions.length) {
      throw new Error("Η ίδια θέση εμφανίζεται περισσότερες από μία φορές στην ίδια κατηγορία.");
    }
    for (const position of positions) {
      if (assignedPositions.has(position)) {
        throw new Error("Η ίδια θέση δεν μπορεί να ανήκει σε περισσότερες από μία κατηγορίες δημόσιας απεικόνισης.");
      }
      assignedPositions.add(position);
    }
    presentation[category as StandingsPresentationCategory] = positions.sort((left, right) => left - right);
  }

  return presentation;
}

async function savePhaseStandingsPresentation(
  db: D1DatabaseBinding,
  phaseId: string,
  presentation: StandingsPresentation | null,
) {
  if (!presentation) return;
  await db.batch([
    db.prepare("DELETE FROM league_phase_standings_presentation WHERE phase_id=?").bind(phaseId),
    ...Object.entries(presentation).flatMap(([category, positions]) => positions.map((position) =>
      db.prepare(`INSERT INTO league_phase_standings_presentation (phase_id, category, position)
        VALUES (?, ?, ?)`)
        .bind(phaseId, category, position),
    )),
  ]);
}

async function normalizeCompetitionPhaseOrder(
  db: D1DatabaseBinding,
  competitionId: string,
) {
  const competitionPhases = await rows<{ id: string; phase_order: number | null; order_index: number | null }>(
    db,
    `SELECT id, COALESCE(phase_order, order_index, 0) AS phase_order, order_index
      FROM league_phases
      WHERE competition_id=?
      ORDER BY COALESCE(phase_order, order_index, 0), id`,
    [competitionId],
  );

  for (let index = 0; index < competitionPhases.length; index++) {
    const sequenceOrder = index + 1;
    const row = competitionPhases[index];
    if (!row?.id) continue;
    await db.prepare(
      `UPDATE league_phases
        SET phase_order=?, order_index=?
        WHERE id=?`,
    ).bind(sequenceOrder, sequenceOrder, row.id).run();
  }
}

export async function getLeagueAdminSnapshot(organizationId: string) {
  const db = await database();
  if (!db) {
    return {
      mode: "preview" as const,
      seasons: HISTORICAL_SEASONS.map((name) => ({
        id: `season_${name}`, name, slug: name, status: "completed",
      })),
      competitions: HISTORICAL_SEASONS.map((season) => ({
        id: `competition_${season}_league`, season_id: `season_${season}`,
        season_name: season, name: "KomoBasket League", slug: "komobasket-league", type: "league", status: "completed",
        lifecycle_status: "complete", expected_team_count: null, regular_season_meetings: 1,
        win_points: 2, loss_points: 1, forfeit_points: 0,
      })),
      teams: legacyTeams.map((team) => ({
        id: `team_${baseTeamSlug(team.season, team.slug)}`, name: team.name,
        slug: baseTeamSlug(team.season, team.slug), city: team.city, logo_url: team.logo, active: 1,
      })),
      players: legacyPlayers.slice(0, 100).map((player) => ({
        id: `preview_${player.slug}`, slug: player.slug, display_name: player.name,
        normalized_name: normalizePlayerName(player.name), active: 1,
      })),
      participations: [], rosters: [], movements: [], phases: [], phaseSchedules: [],
      seriesPlanningSlots: [], games: [], competitionVenues: [],
      counts: {
        seasons: HISTORICAL_SEASONS.length,
        competitions: HISTORICAL_SEASONS.length,
        teams: legacyTeams.length,
        players: legacyPlayers.length,
      },
    };
  }

  const [seasons, competitions, teams, participations, players, rosters, movements, rawPhases, phaseSchedules, seriesPlanningSlots, games, competitionVenues] = await Promise.all([
    rows(db, "SELECT * FROM league_seasons ORDER BY name DESC"),
    rows(db, `SELECT c.*, s.name AS season_name,
      COALESCE(cp.lifecycle_status,
        CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
      ) AS lifecycle_status,
      c.custom_type_label, c.logo_url,
      cf.expected_team_count, cf.regular_season_meetings, cf.win_points,
      cf.loss_points, cf.forfeit_points, cf.tiebreakers_json, cf.settings_json AS format_settings_json
      FROM league_competitions c
      JOIN league_seasons s ON s.id=c.season_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
      LEFT JOIN league_competition_formats cf ON cf.competition_id=c.id
      WHERE c.organization_id=?
      ORDER BY s.name DESC, c.name`, [organizationId]),
    rows(db, "SELECT * FROM league_teams WHERE organization_id=? ORDER BY name", [organizationId]),
    rows(db, `SELECT ct.id, ct.competition_id, ct.season_team_id, ct.seed, ct.status,
      st.season_id, st.team_id, st.display_name, st.logo_url,
      s.name AS season_name, t.name AS team_name, c.name AS competition_name
      FROM league_competition_teams ct
      JOIN league_season_teams st ON st.id=ct.season_team_id
      JOIN league_seasons s ON s.id=st.season_id
      JOIN league_teams t ON t.id=st.team_id
      JOIN league_competitions c ON c.id=ct.competition_id
      WHERE c.organization_id=? AND t.organization_id=?
      ORDER BY s.name DESC, c.name, st.display_name`, [organizationId, organizationId]),
    rows(db, "SELECT * FROM league_players WHERE organization_id=? ORDER BY display_name LIMIT 1000", [organizationId]),
    rows(db, `SELECT r.*, p.display_name AS player_name, t.name AS team_name, s.name AS season_name
      FROM league_roster_memberships r
      JOIN league_players p ON p.id=r.player_id
      JOIN league_teams t ON t.id=r.team_id
      JOIN league_seasons s ON s.id=r.season_id
      JOIN league_competitions c ON c.id=r.competition_id
      WHERE c.organization_id=? AND p.organization_id=? AND t.organization_id=?
      ORDER BY s.name DESC, t.name, p.display_name LIMIT 2000`, [organizationId, organizationId, organizationId]),
    rows(db, `SELECT m.*, p.display_name AS player_name, ft.name AS from_team_name, tt.name AS to_team_name
      FROM league_player_movements m
      JOIN league_players p ON p.id=m.player_id
      LEFT JOIN league_teams ft ON ft.id=m.from_team_id
      LEFT JOIN league_teams tt ON tt.id=m.to_team_id
      WHERE p.organization_id=?
        AND (ft.id IS NULL OR ft.organization_id=?)
        AND (tt.id IS NULL OR tt.organization_id=?)
      ORDER BY m.effective_on DESC LIMIT 500`, [organizationId, organizationId, organizationId]),
    rows(db, `SELECT p.*, c.name AS competition_name, s.name AS season_name,
      p.lifecycle_status, p.finalized_at,
      COALESCE(pr.phase_kind, CASE WHEN p.phase_type='regular' THEN 'regular_season' ELSE p.phase_type END) AS phase_kind,
      COALESCE(p.phase_order, p.order_index) AS phase_order,
      p.previous_phase_id,
      pr.bracket_size, pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, source_phase.name AS carry_over_source_name,
      pr.settings_json AS rule_settings_json,
      COALESCE((SELECT json_group_array(json_object('category', sp.category, 'position', sp.position))
        FROM league_phase_standings_presentation sp WHERE sp.phase_id=p.id), '[]') AS standings_presentation_json
      FROM league_phases p
      JOIN league_competitions c ON c.id=p.competition_id
      JOIN league_seasons s ON s.id=c.season_id
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      LEFT JOIN league_phases source_phase ON source_phase.id=pr.carry_over_source_phase_id
      WHERE c.organization_id=?
      ORDER BY s.name DESC, c.name, COALESCE(p.phase_order, p.order_index), p.id`, [organizationId]),
    rows(db, `SELECT ps.*, p.name AS phase_name, p.format AS phase_format,
      p.phase_type, p.lifecycle_status, p.finalized_at, COALESCE(p.phase_order, p.order_index) AS phase_order,
      pr.phase_kind, pr.bracket_size, pr.best_of, pr.wins_required,
      pr.carry_over_enabled, pr.carry_over_source_phase_id,
      source_phase.name AS carry_over_source_name,
      c.name AS competition_name
      FROM league_phase_schedules ps
      JOIN league_phases p ON p.id=ps.phase_id
      JOIN league_competitions c ON c.id=ps.competition_id
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      LEFT JOIN league_phases source_phase ON source_phase.id=pr.carry_over_source_phase_id
      WHERE c.organization_id=?
      ORDER BY c.name, COALESCE(p.phase_order, p.order_index), p.id`, [organizationId]),
    rows(db, `SELECT slots.id, slots.competition_id, slots.phase_id,
      slots.schedule_id, slots.matchup_id, slots.series_round_number,
      slots.scheduled_date, slots.scheduled_time, slots.venue, slots.real_game_id,
      slots.created_at, slots.updated_at
      FROM league_series_planning_slots slots
      JOIN league_competitions c ON c.id=slots.competition_id
      WHERE c.organization_id=?
      ORDER BY slots.schedule_id, slots.matchup_id, slots.series_round_number`, [organizationId]),
    rows(db, `SELECT g.*, ht.name AS home_team_name, at.name AS away_team_name, p.name AS phase_name
      FROM league_games g
      JOIN league_competitions c ON c.id=g.competition_id
      JOIN league_teams ht ON ht.id=g.home_team_id
      JOIN league_teams at ON at.id=g.away_team_id
      LEFT JOIN league_phases p ON p.id=g.phase_id
      WHERE c.organization_id=? AND ht.organization_id=? AND at.organization_id=?
      ORDER BY COALESCE(g.scheduled_at,'9999') DESC LIMIT 1000`, [organizationId, organizationId, organizationId]),
    rows(db, `SELECT v.*, c.name AS competition_name, s.name AS season_name
      FROM league_competition_venues v
      JOIN league_competitions c ON c.id=v.competition_id
      JOIN league_seasons s ON s.id=c.season_id
      WHERE c.organization_id=?
      ORDER BY c.name, COALESCE(v.sort_order, 0), v.name`, [organizationId]),
  ]);
  const phases = rawPhases.map((phase) => ({
    ...phase,
    format: normalizeCanonicalFormat(String(phase.format ?? ""), String(phase.phase_kind ?? "")),
  }));

  return {
    mode: "database" as const, seasons, competitions, teams, participations, players, rosters,
    movements, phases, phaseSchedules, seriesPlanningSlots, games, competitionVenues,
    counts: {
      seasons: seasons.length, competitions: competitions.length,
      teams: teams.length, players: players.length,
    },
  };
}

async function loadSeasonSortInfo(db: D1DatabaseBinding, seasonId: string) {
  return db.prepare("SELECT id,name,starts_on FROM league_seasons WHERE id=?")
    .bind(seasonId).first<{ id: string; name: string | null; starts_on: string | null }>()
    .then((season) => (season ? seasonSortInfo(season) : null));
}

type PreviousRosterCandidate = {
  season_id: string;
  season_name: string | null;
  starts_on: string | null;
  competition_id: string;
  competition_name: string;
  competition_type: string;
  custom_type_label: string | null;
  athlete_count: number;
  staff_count: number;
};

const normalizeCompetitionRosterIdentity = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("el-GR");

async function getPreviousRosterLookupWithDb(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
  teamId: string,
  organizationId: string | null = null,
) {
  const targetSelection = await db.prepare(`
    SELECT
      s.id AS season_id,
      s.name AS season_name,
      s.starts_on,
      c.id AS competition_id,
      c.name AS competition_name,
      c.type AS competition_type,
      c.custom_type_label
    FROM league_seasons s
    INNER JOIN league_competitions c ON c.season_id=s.id
    INNER JOIN league_competition_teams ct ON ct.competition_id=c.id
    INNER JOIN league_season_teams st ON st.id=ct.season_team_id
    INNER JOIN league_teams t ON t.id=st.team_id
    WHERE s.id=? AND c.id=? AND st.team_id=?
      AND (? IS NULL OR c.organization_id=?)
      AND (? IS NULL OR t.organization_id=?)
    LIMIT 1
  `).bind(seasonId, competitionId, teamId, organizationId, organizationId, organizationId, organizationId).first<{
    season_id: string;
    season_name: string | null;
    starts_on: string | null;
    competition_id: string;
    competition_name: string;
    competition_type: string;
    custom_type_label: string | null;
  }>();
  if (!targetSelection) {
    throw new Error("Η επιλεγμένη ομάδα δεν συμμετέχει στη συγκεκριμένη διοργάνωση και σεζόν.");
  }

  const targetSort = seasonSortInfo({ name: targetSelection.season_name, starts_on: targetSelection.starts_on });
  const targetAthleteCount = await db.prepare(
    `SELECT COUNT(*) AS count FROM league_roster_memberships
     WHERE season_id=? AND competition_id=? AND team_id=? AND status='active'`,
  ).bind(seasonId, competitionId, teamId).first<{ count: number }>();
  const targetStaffCount = await db.prepare(
    `SELECT COUNT(*) AS count FROM league_staff_memberships
     WHERE season_id=? AND competition_id=? AND team_id=?`,
  ).bind(seasonId, competitionId, teamId).first<{ count: number }>();

  const candidates = await rows<PreviousRosterCandidate>(db, `
    SELECT
      s.id AS season_id,
      s.name AS season_name,
      s.starts_on,
      c.id AS competition_id,
      c.name AS competition_name,
      c.type AS competition_type,
      c.custom_type_label,
      (SELECT COUNT(*) FROM league_roster_memberships r
       WHERE r.season_id=s.id AND r.competition_id=c.id AND r.team_id=st.team_id AND r.status='active') AS athlete_count,
      (SELECT COUNT(*) FROM league_staff_memberships sm
       WHERE sm.season_id=s.id AND sm.competition_id=c.id AND sm.team_id=st.team_id) AS staff_count
    FROM league_seasons s
    INNER JOIN league_competitions c ON c.season_id=s.id
    INNER JOIN league_competition_teams ct ON ct.competition_id=c.id
    INNER JOIN league_season_teams st ON st.id=ct.season_team_id
    INNER JOIN league_teams t ON t.id=st.team_id
    WHERE st.team_id=?
      AND (? IS NULL OR c.organization_id=?)
      AND (? IS NULL OR t.organization_id=?)
      AND (
        EXISTS (SELECT 1 FROM league_roster_memberships r
          WHERE r.season_id=s.id AND r.competition_id=c.id AND r.team_id=st.team_id AND r.status='active')
        OR EXISTS (SELECT 1 FROM league_staff_memberships sm
          WHERE sm.season_id=s.id AND sm.competition_id=c.id AND sm.team_id=st.team_id)
      )
  `, [teamId, organizationId, organizationId, organizationId, organizationId]);

  const earlierCandidates = candidates.filter((candidate) => isEarlierSeason(
    seasonSortInfo({ name: candidate.season_name, starts_on: candidate.starts_on }),
    targetSort,
  ));
  earlierCandidates.sort((left, right) => normalizeLookupOrder(
    seasonSortInfo({ name: left.season_name, starts_on: left.starts_on }),
    seasonSortInfo({ name: right.season_name, starts_on: right.starts_on }),
  ));
  const latestSeasonId = earlierCandidates.at(-1)?.season_id ?? null;
  const latestSeasonCandidates = latestSeasonId
    ? earlierCandidates.filter((candidate) => candidate.season_id === latestSeasonId)
    : [];

  const targetName = normalizeCompetitionRosterIdentity(targetSelection.competition_name);
  const targetType = normalizeCompetitionRosterIdentity(targetSelection.competition_type);
  const targetCustomType = normalizeCompetitionRosterIdentity(targetSelection.custom_type_label);
  const compatibilityScore = (candidate: PreviousRosterCandidate) => {
    const sameName = normalizeCompetitionRosterIdentity(candidate.competition_name) === targetName;
    const sameType = normalizeCompetitionRosterIdentity(candidate.competition_type) === targetType;
    const sameCustomType = normalizeCompetitionRosterIdentity(candidate.custom_type_label) === targetCustomType;
    if (sameName && sameType && sameCustomType) return 3;
    if (sameType && sameCustomType) return 2;
    if (sameType) return 1;
    return 0;
  };
  latestSeasonCandidates.sort((left, right) => (
    compatibilityScore(right) - compatibilityScore(left)
    || Number(right.athlete_count ?? 0) - Number(left.athlete_count ?? 0)
    || Number(right.staff_count ?? 0) - Number(left.staff_count ?? 0)
    || String(left.competition_id).localeCompare(String(right.competition_id))
  ));
  const source = latestSeasonCandidates[0] ?? null;

  return {
    seasonId: source?.season_id ?? null,
    seasonName: source?.season_name ?? null,
    competitionId: source?.competition_id ?? null,
    competitionName: source?.competition_name ?? null,
    targetAthleteRosterExists: Number(targetAthleteCount?.count ?? 0) > 0,
    targetAthleteCount: Number(targetAthleteCount?.count ?? 0),
    targetStaffRosterExists: Number(targetStaffCount?.count ?? 0) > 0,
    targetStaffCount: Number(targetStaffCount?.count ?? 0),
    previousAthleteCount: Number(source?.athlete_count ?? 0),
    previousStaffCount: Number(source?.staff_count ?? 0),
  } satisfies PreviousRosterInfo;
}

export async function getPreviousRosterLookup(
  seasonId: string,
  competitionId: string,
  teamId: string,
) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  return getPreviousRosterLookupWithDb(db, seasonId, competitionId, teamId);
}

export async function getTeamRosterManagementView(
  seasonId: string,
  competitionId: string,
  teamId: string,
  organizationId: string,
) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const selection = await db.prepare(`
    SELECT
      s.id AS season_id, s.name AS season_name,
      c.id AS competition_id, c.name AS competition_name,
      t.id AS team_id, t.name AS team_name
    FROM league_seasons s
    INNER JOIN league_competitions c ON c.season_id=s.id
    INNER JOIN league_competition_teams ct ON ct.competition_id=c.id
    INNER JOIN league_season_teams st ON st.id=ct.season_team_id
    INNER JOIN league_teams t ON t.id=st.team_id
    WHERE s.id=? AND c.id=? AND t.id=?
      AND c.organization_id=? AND t.organization_id=?
      AND ct.status IS NOT NULL
  `).bind(seasonId, competitionId, teamId, organizationId, organizationId).first<{
    season_id: string;
    season_name: string;
    competition_id: string;
    competition_name: string;
    team_id: string;
    team_name: string;
  }>();
  if (!selection) throw new Error("Η επιλεγμένη ομάδα δεν συμμετέχει στη συγκεκριμένη διοργάνωση.");

  const athletes = await rows<RosterAthleteRow>(db, `
    SELECT
      r.id AS roster_id,
      p.id AS player_id,
      p.first_name,
      p.last_name,
      p.display_name,
      p.photo_url,
      p.birth_date,
      r.shirt_number
    FROM league_roster_memberships r
    INNER JOIN league_players p ON p.id = r.player_id
    INNER JOIN league_teams t ON t.id = r.team_id
    INNER JOIN league_competitions c ON c.id = r.competition_id
    WHERE r.season_id=? AND r.competition_id=? AND r.team_id=? AND r.status='active'
      AND p.organization_id=? AND t.organization_id=? AND c.organization_id=?
    ORDER BY COALESCE(p.last_name, p.display_name, ""), COALESCE(p.first_name, p.display_name, "")
  `, [seasonId, competitionId, teamId, organizationId, organizationId, organizationId]);

  const staff = await rows<RosterStaffRow>(db, `
    SELECT
      sm.id AS membership_id,
      s.id AS staff_id,
      s.first_name,
      s.last_name,
      s.display_name,
      s.photo_url,
      s.birth_date,
      sm.role,
      sm.custom_role_label
    FROM league_staff_memberships sm
    INNER JOIN league_staff s ON s.id = sm.staff_id
    INNER JOIN league_teams t ON t.id = sm.team_id
    INNER JOIN league_competitions c ON c.id = sm.competition_id
    WHERE sm.season_id=? AND sm.competition_id=? AND sm.team_id=?
      AND s.organization_id=? AND t.organization_id=? AND c.organization_id=?
    ORDER BY COALESCE(s.last_name, s.display_name, ""), COALESCE(s.first_name, s.display_name, "")
  `, [seasonId, competitionId, teamId, organizationId, organizationId, organizationId]);

  const previousRoster = await getPreviousRosterLookupWithDb(
    db,
    seasonId,
    competitionId,
    teamId,
    organizationId,
  );

  return {
    seasonId: selection.season_id,
    seasonName: String(selection.season_name),
    competitionId: selection.competition_id,
    competitionName: String(selection.competition_name),
    teamId: selection.team_id,
    teamName: String(selection.team_name),
    athletes,
    staff,
    previousRoster,
  } satisfies TeamRosterManagementView;
}

export async function copyPreviousRoster(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
  teamId: string,
  includeStaff = false,
  organizationId?: string,
) {
  const canonicalOrganizationId = String(organizationId ?? "").trim();
  const lookup = await getPreviousRosterLookupWithDb(
    db,
    seasonId,
    competitionId,
    teamId,
    canonicalOrganizationId || undefined,
  );
  if (!lookup.seasonId || !lookup.competitionId) {
    return { copiedAthletes: 0, copiedStaff: 0, skippedAthletes: 0, skippedStaff: 0, sourceSeasonId: null, sourceCompetitionId: null };
  }

  const previousSeasonId = lookup.seasonId;
  const previousCompetitionId = lookup.competitionId;
  const previousAthletes = await rows<{ player_id: string; shirt_number: number | null }>(
    db,
    `SELECT r.player_id, MAX(r.shirt_number) AS shirt_number
     FROM league_roster_memberships r
     JOIN league_players p ON p.id=r.player_id
     WHERE r.season_id=? AND r.team_id=? AND r.competition_id=? AND r.status='active'
       AND (?='' OR p.organization_id=?)
     GROUP BY r.player_id`,
    [previousSeasonId, teamId, previousCompetitionId, canonicalOrganizationId, canonicalOrganizationId],
  );
  const targetAthletes = await rows<{ player_id: string }>(db, `SELECT player_id
    FROM league_roster_memberships
    WHERE season_id=? AND competition_id=? AND status='active'`, [seasonId, competitionId]);
  const targetAthleteIds = new Set(targetAthletes.map((player) => String(player.player_id)));
  const athletesToCopy = previousAthletes.filter((player) => !targetAthleteIds.has(String(player.player_id)));

  const statements = athletesToCopy.map((player) => db.prepare(`INSERT INTO league_roster_memberships
      (id,season_id,competition_id,player_id,team_id,shirt_number,joined_on,left_on,status)
      VALUES (?,?,?,?,?,?,NULL,NULL,'active')`)
      .bind(
        createEntityId("roster"),
        seasonId,
        competitionId,
        player.player_id,
        teamId,
        player.shirt_number,
      ));

  let previousStaff: Array<{ staff_id: string; role: string; custom_role_label: string | null }> = [];
  let staffToCopy = previousStaff;
  if (includeStaff) {
    previousStaff = await rows<{
      staff_id: string;
      role: string;
      custom_role_label: string | null;
    }>(
      db,
      `SELECT sm.staff_id, sm.role, sm.custom_role_label
       FROM league_staff_memberships sm
       JOIN league_staff s ON s.id=sm.staff_id
       WHERE sm.season_id=? AND sm.competition_id=? AND sm.team_id=?
         AND (?='' OR s.organization_id=?)`,
      [previousSeasonId, previousCompetitionId, teamId, canonicalOrganizationId, canonicalOrganizationId],
    );
    const targetStaff = await rows<{ staff_id: string }>(db, `SELECT staff_id
      FROM league_staff_memberships
      WHERE season_id=? AND competition_id=? AND team_id=?`, [seasonId, competitionId, teamId]);
    const targetStaffIds = new Set(targetStaff.map((staff) => String(staff.staff_id)));
    staffToCopy = previousStaff.filter((staff) => !targetStaffIds.has(String(staff.staff_id)));
    statements.push(...staffToCopy.map((staff) => db.prepare(`INSERT INTO league_staff_memberships
        (id,staff_id,season_id,competition_id,team_id,role,custom_role_label)
        VALUES (?,?,?,?,?,?,?)`)
        .bind(
          createEntityId("staffMembership"),
          staff.staff_id,
          seasonId,
          competitionId,
          teamId,
          normalizeStaffRole(staff.role, "other"),
          staff.custom_role_label,
        )));
  }

  if (statements.length) await db.batch(statements);

  return {
    copiedAthletes: athletesToCopy.length,
    copiedStaff: staffToCopy.length,
    skippedAthletes: previousAthletes.length - athletesToCopy.length,
    skippedStaff: previousStaff.length - staffToCopy.length,
    sourceSeasonId: previousSeasonId,
    sourceCompetitionId: previousCompetitionId,
  };
}

export async function searchAthletesForRosterFoundation(
  input: SearchRequestInput,
  organizationId: string,
) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const query = String(input.query ?? "").trim();
  const limit = withLimit(input.limit, 25);
  if (!query) return [] as SearchResultPlayer[];
  const normalized = normalizePlayerName(query);
  const wildcard = `%${normalized}%`;

  const rowsQuery = await rows<{
    player_id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string;
    birth_date: string | null;
    last_team_name: string | null;
    last_season_name: string | null;
  }>(
    db,
    `SELECT
      p.id AS player_id,
      p.first_name,
      p.last_name,
      p.display_name,
      p.birth_date,
      (
        SELECT t.name
        FROM league_roster_memberships r
        JOIN league_teams t ON t.id = r.team_id
        JOIN league_competitions c ON c.id = r.competition_id
        WHERE r.player_id = p.id AND r.status='active'
          AND t.organization_id=p.organization_id
          AND c.organization_id=p.organization_id
        ORDER BY r.created_at DESC
        LIMIT 1
      ) AS last_team_name,
      (
        SELECT s.name
        FROM league_roster_memberships r
        JOIN league_seasons s ON s.id = r.season_id
        JOIN league_teams t ON t.id = r.team_id
        JOIN league_competitions c ON c.id = r.competition_id
        WHERE r.player_id = p.id AND r.status='active'
          AND t.organization_id=p.organization_id
          AND c.organization_id=p.organization_id
        ORDER BY r.created_at DESC
        LIMIT 1
      ) AS last_season_name
    FROM league_players p
    WHERE p.organization_id=? AND (
         p.normalized_name LIKE ?
      OR lower(p.display_name) LIKE lower(?)
      OR (p.first_name IS NOT NULL AND lower(p.first_name) LIKE lower(?))
      OR (p.last_name IS NOT NULL AND lower(p.last_name) LIKE lower(?))
    )
    ORDER BY p.display_name ASC
    LIMIT ?`,
    [organizationId, wildcard, `%${query}%`, wildcard, wildcard, limit],
  );
  if (rowsQuery.length === 0) {
    return [];
  }

  const ids = rowsQuery.map((row) => row.player_id);
  const placeholders = ids.map(() => "?").join(",");
  const careerRows = await rows<{
    player_id: string;
    season_name: string;
    team_name: string;
    competition_name: string;
    season_year_key: number | null;
    season_start_on: string | null;
  }>(
    db,
    `SELECT
      roster.player_id,
      season.name AS season_name,
      team.name AS team_name,
      competition.name AS competition_name,
      CAST(substr(season.name, 1, 4) AS INTEGER) AS season_year_key,
      season.starts_on AS season_start_on
    FROM (
      SELECT
        player_id,
        season_id,
        team_id,
        competition_id
      FROM league_roster_memberships
      WHERE player_id IN (${placeholders})
      GROUP BY player_id, season_id, team_id
    ) AS roster
    JOIN league_seasons season ON season.id = roster.season_id
    JOIN league_teams team ON team.id = roster.team_id
    JOIN league_competitions competition ON competition.id = roster.competition_id
    WHERE team.organization_id=? AND competition.organization_id=?
    ORDER BY
      CASE
        WHEN CAST(substr(season.name, 1, 4) AS INTEGER) IS NOT NULL
          THEN CAST(substr(season.name, 1, 4) AS INTEGER)
        ELSE -1
      END DESC,
      season.name DESC,
      team.name ASC`,
    [...ids, organizationId, organizationId],
  );

  const careerHistoryByPlayer = new Map<string, {
    season_name: string;
    team_name: string;
    competition_name: string | null;
    season_year_key: number | null;
  }[]>();

  for (const row of careerRows) {
    const history = careerHistoryByPlayer.get(row.player_id) ?? [];
    const duplicate = history.some((entry) => entry.season_name === row.season_name && entry.team_name === row.team_name);
    if (!duplicate) {
      history.push({
        season_name: row.season_name,
        team_name: row.team_name,
        competition_name: row.competition_name ?? null,
        season_year_key: row.season_year_key ?? null,
      });
      careerHistoryByPlayer.set(row.player_id, history);
    }
  }

  return rowsQuery.map((row) => ({
    player_id: row.player_id,
    first_name: row.first_name,
    last_name: row.last_name,
    display_name: row.display_name,
    birth_date: row.birth_date,
    last_team_name: row.last_team_name,
    last_season_name: row.last_season_name,
    career_history: careerHistoryByPlayer.get(row.player_id) ?? [],
  }));
}

export async function searchStaffForRosterFoundation(
  input: SearchRequestInput,
  organizationId: string,
) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const query = String(input.query ?? "").trim();
  const limit = withLimit(input.limit, 25);
  if (!query) return [] as SearchResultStaff[];
  const wildcard = `%${normalizePlayerName(query)}%`;

  const rowsQuery = await rows<{
    staff_id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    birth_date: string | null;
    last_team_name: string | null;
    last_season_name: string | null;
  }>(
    db,
    `SELECT
      s.id AS staff_id,
      s.first_name,
      s.last_name,
      s.display_name,
      s.birth_date,
      (
        SELECT t.name
        FROM league_staff_memberships m
        JOIN league_teams t ON t.id=m.team_id
        JOIN league_competitions c ON c.id=m.competition_id
        WHERE m.staff_id=s.id
          AND t.organization_id=s.organization_id
          AND c.organization_id=s.organization_id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_team_name,
      (
        SELECT se.name
        FROM league_staff_memberships m
        JOIN league_seasons se ON se.id=m.season_id
        JOIN league_teams t ON t.id=m.team_id
        JOIN league_competitions c ON c.id=m.competition_id
        WHERE m.staff_id=s.id
          AND t.organization_id=s.organization_id
          AND c.organization_id=s.organization_id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_season_name
    FROM league_staff s
    WHERE s.organization_id=? AND (
         s.normalized_name LIKE ?
      OR lower(s.display_name) LIKE lower(?)
    )
    ORDER BY s.display_name ASC
    LIMIT ?`,
    [organizationId, wildcard, `%${String(query)}%`, limit],
  );

  return rowsQuery.map((row) => ({
    staff_id: row.staff_id,
    first_name: row.first_name,
    last_name: row.last_name,
    display_name: row.display_name,
    birth_date: row.birth_date,
    last_team_name: row.last_team_name,
    last_season_name: row.last_season_name,
  }));
}

export async function updateAthleteCanonical(input: {
  playerId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  birthDate?: string | null;
  photoUrl?: string | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const playerId = String(input.playerId ?? "").trim();
  if (!playerId) throw new Error("Δεν επιλέχθηκε αθλητής.");

  const existing = await db.prepare("SELECT * FROM league_players WHERE id=?")
    .bind(playerId).first<DbRow>();
  if (!existing) throw new Error("Δεν βρέθηκε αθλητής.");

  const displayName = String(input.displayName ?? existing.display_name).trim() || String(existing.display_name);
  const normalizedName = normalizePlayerName(displayName);
  const firstName = input.firstName !== undefined ? (String(input.firstName).trim() || null) : existing.first_name ?? null;
  const lastName = input.lastName !== undefined ? (String(input.lastName).trim() || null) : existing.last_name ?? null;
  const birthDate = input.birthDate !== undefined ? (input.birthDate ? String(input.birthDate) : null) : existing.birth_date ?? null;
  const photoUrl = input.photoUrl !== undefined ? (input.photoUrl ? String(input.photoUrl) : null) : existing.photo_url ?? null;

  await db.prepare(`UPDATE league_players
    SET first_name=?, last_name=?, display_name=?, normalized_name=?, birth_date=?, photo_url=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(firstName, lastName, displayName, normalizedName, birthDate, photoUrl, playerId).run();
  return { playerId };
}

export async function updateRosterShirtNumber(input: { rosterId: string; shirtNumber: number | null }) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const rosterId = String(input.rosterId ?? "").trim();
  if (!rosterId) throw new Error("Δεν επιλέχθηκε εγγραφή ρόστερ.");
  const existing = await db.prepare("SELECT id, season_id, competition_id FROM league_roster_memberships WHERE id=?")
    .bind(rosterId).first<{ id: string; season_id: string; competition_id: string }>();
  if (!existing) throw new Error("Δεν βρέθηκε η εγγραφή.");
  await assertRosterTargetWritable(db, existing.season_id, existing.competition_id);

  await db.prepare(`UPDATE league_roster_memberships
    SET shirt_number=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(input.shirtNumber, rosterId).run();
  return { rosterId };
}

export async function removeAthleteFromRoster(input: { rosterId: string; effectiveOn?: string | null }) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const rosterId = String(input.rosterId ?? "").trim();
  if (!rosterId) throw new Error("Δεν επιλέχθηκε εγγραφή ρόστερ.");
  const date = String(input.effectiveOn || new Date().toISOString().slice(0, 10));
  const existing = await db.prepare(
    "SELECT id, player_id, team_id, season_id, competition_id FROM league_roster_memberships WHERE id=?",
  ).bind(rosterId).first<{ id: string; player_id: string; team_id: string; season_id: string; competition_id: string }>();
  if (!existing) throw new Error("Δεν βρέθηκε η εγγραφή.");
  await assertRosterTargetWritable(db, existing.season_id, existing.competition_id);

  await db.prepare(`UPDATE league_roster_memberships
    SET status='departed', left_on=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(date, rosterId).run();
  await db.prepare(`INSERT INTO league_player_movements
    (id, player_id, season_id, from_team_id, to_team_id, movement_type, effective_on, note)
    VALUES (?, ?, ?, ?, ?, 'departure', ?, '')`)
    .bind(createEntityId("movement"), existing.player_id, existing.season_id, existing.team_id, null, date).run();
  return { rosterId };
}

export async function createAthleteCanonical(input: {
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  photoUrl?: string | null;
  organizationId: string;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const firstName = String(input.firstName ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  if (!firstName || !lastName) throw new Error("Το όνομα και το επώνυμο είναι υποχρεωτικά.");

  const displayName = `${firstName} ${lastName}`.trim();
  const normalizedName = normalizePlayerName(displayName);
  const id = createEntityId("player");
  const birthDate = input.birthDate ? String(input.birthDate) : null;
  const photoUrl = input.photoUrl ? String(input.photoUrl) : null;
  const organizationId = String(input.organizationId ?? "").trim();
  if (!organizationId) throw new Error("Ο Οργανισμός είναι υποχρεωτικός.");
  const baseSlug = slugify(displayName);
  const existingSlugs = await rows<{ slug: string }>(
    db,
    `SELECT slug FROM league_players WHERE slug = ? OR slug LIKE ?`,
    [baseSlug, `${baseSlug}-%`],
  );
  const occupied = new Set(existingSlugs.map((row) => String(row.slug ?? "").trim()).filter(Boolean));
  let slug = baseSlug;
  if (occupied.has(slug)) {
    let suffix = 2;
    while (occupied.has(`${baseSlug}-${suffix}`)) {
      suffix += 1;
    }
    slug = `${baseSlug}-${suffix}`;
  }

  await db.prepare(`INSERT INTO league_players
    (id, organization_id, first_name, last_name, display_name, normalized_name, birth_date, photo_url, active, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(id, organizationId, firstName, lastName, displayName, normalizedName, birthDate, photoUrl, slug)
    .run();

  return { playerId: id };
}

function athleteInTargetRosterRowExists(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
  teamId: string,
  playerId: string,
) {
  return db.prepare(`SELECT id FROM league_roster_memberships
    WHERE season_id=? AND competition_id=? AND team_id=? AND player_id=? AND status='active'`)
    .bind(seasonId, competitionId, teamId, playerId).first<{ id: string }>();
}

function athleteInCompetitionRosterRowExists(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
  playerId: string,
) {
  return db.prepare(`SELECT r.id, r.team_id, t.name AS team_name
    FROM league_roster_memberships r
    JOIN league_teams t ON t.id = r.team_id
    WHERE r.season_id=? AND r.competition_id=? AND r.player_id=? AND r.status='active'
    ORDER BY r.created_at DESC
    LIMIT 1`)
    .bind(seasonId, competitionId, playerId).first<{ id: string; team_id: string; team_name: string }>();
}

export async function addExistingAthleteToRoster(input: {
  playerId: string;
  seasonId: string;
  competitionId: string;
  teamId: string;
  shirtNumber?: number | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const playerId = String(input.playerId ?? "").trim();
  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!playerId || !seasonId || !competitionId || !teamId) {
    throw new Error("Λείπουν υποχρεωτικά πεδία.");
  }

  const player = await db.prepare(`SELECT id FROM league_players WHERE id=?`).bind(playerId).first<{ id: string }>();
  if (!player) throw new Error("Δεν βρέθηκε ο αθλητής.");
  const playerConflict = await db.prepare(`SELECT id FROM league_staff WHERE id=?`).bind(playerId).first<{ id: string }>();
  if (playerConflict) {
    throw new Error("Το αναγνωριστικό δεν μπορεί να χρησιμοποιηθεί ταυτόχρονα ως staff.");
  }

  await assertRosterTargetWritable(db, seasonId, competitionId);

  const competitionConflict = await athleteInCompetitionRosterRowExists(db, seasonId, competitionId, playerId);
  if (competitionConflict) {
    if (String(competitionConflict.team_id ?? "") === teamId) {
      return { rosterId: competitionConflict.id, created: false, duplicate: true };
    }
    throw new Error(`Ο αθλητής ανήκει ήδη στην ομάδα «${competitionConflict.team_name ?? "—"}» στη συγκεκριμένη διοργάνωση.`);
  }

  const exists = await athleteInTargetRosterRowExists(db, seasonId, competitionId, teamId, playerId);
  if (exists) {
    return { rosterId: exists.id, created: false, duplicate: true };
  }

  const rosterId = createEntityId("roster");
  await db.prepare(`INSERT INTO league_roster_memberships
    (id, season_id, competition_id, player_id, team_id, shirt_number, joined_on, left_on, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,NULL,NULL,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(rosterId, seasonId, competitionId, playerId, teamId, input.shirtNumber ?? null).run();

  return { rosterId, created: true, duplicate: false };
}

export async function bulkAddExistingAthletesToRoster(input: {
  seasonId: string;
  competitionId: string;
  teamId: string;
  items: Array<{
    playerId: string;
    shirtNumber?: number | null;
  }>;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!seasonId || !competitionId || !teamId) throw new Error("Λείπουν τα στοιχεία ρόστερ.");

  const uniqueItems = (input.items ?? []).map((item) => ({
    playerId: String(item.playerId ?? "").trim(),
    shirtNumber: item.shirtNumber ?? null,
  })).filter((item) => Boolean(item.playerId));

  if (!uniqueItems.length) throw new Error("Δεν έχουν επιλεγεί αθλητές για προσθήκη.");

  const seen = new Set<string>();
  for (const item of uniqueItems) {
    if (seen.has(item.playerId)) {
      throw new Error("Ο ίδιος αθλητής δεν μπορεί να προστεθεί δύο φορές στην ίδια μαζική προσθήκη.");
    }
    seen.add(item.playerId);
  }

  await assertRosterTargetWritable(db, seasonId, competitionId);

  const placeholders = uniqueItems.map(() => "?").join(",");
  const existingPlayers = await rows<{ id: string }>(
    db,
    `SELECT id FROM league_players WHERE id IN (${placeholders})`,
    uniqueItems.map((item) => item.playerId),
  );
  if (existingPlayers.length !== uniqueItems.length) {
    throw new Error("Κάποιος αθλητής δεν βρέθηκε.");
  }

  const staffConflicts = await rows<{ id: string }>(
    db,
    `SELECT id FROM league_staff WHERE id IN (${placeholders})`,
    uniqueItems.map((item) => item.playerId),
  );
  if (staffConflicts.length > 0) {
    throw new Error("Το αναγνωριστικό δεν μπορεί να χρησιμοποιηθεί ταυτόχρονα ως staff.");
  }

  const existingRosterMembers = await rows<{ player_id: string; team_id: string; team_name: string }>(
    db,
    `SELECT r.player_id, r.team_id, t.name AS team_name
      FROM league_roster_memberships r
      JOIN league_teams t ON t.id = r.team_id
      WHERE r.season_id=? AND r.competition_id=? AND r.player_id IN (${placeholders}) AND r.status='active'
      ORDER BY r.created_at DESC`,
    [seasonId, competitionId, ...uniqueItems.map((item) => item.playerId)],
  );
  if (existingRosterMembers.length > 0) {
    const conflictMap = new Map(existingRosterMembers.map((row) => [String(row.player_id), row]));
    for (const item of uniqueItems) {
      const conflict = conflictMap.get(item.playerId);
      if (!conflict) continue;
      if (String(conflict.team_id ?? "") === teamId) {
        throw new Error("Ο αθλητής βρίσκεται ήδη στο ρόστερ αυτής της ομάδας.");
      }
      throw new Error(`Ο αθλητής ανήκει ήδη στην ομάδα «${conflict.team_name ?? "—"}» στη συγκεκριμένη διοργάνωση.`);
    }
  }

  const statements = uniqueItems.map((item) => {
    const rosterId = createEntityId("roster");
    return db.prepare(`INSERT INTO league_roster_memberships
      (id, season_id, competition_id, player_id, team_id, shirt_number, joined_on, left_on, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(rosterId, seasonId, competitionId, item.playerId, teamId, item.shirtNumber ?? null);
  });
  await db.batch(statements);

  return { createdCount: uniqueItems.length, duplicate: false };
}

export async function createAthleteWithRoster(input: {
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  photoUrl?: string | null;
  seasonId: string;
  competitionId: string;
  teamId: string;
  shirtNumber?: number | null;
  organizationId: string;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!seasonId || !competitionId || !teamId) throw new Error("Λείπουν τα στοιχεία ρόστερ.");

  await assertRosterTargetWritable(db, seasonId, competitionId);

  const createdAthlete = await createAthleteCanonical({
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate,
    photoUrl: input.photoUrl,
    organizationId: input.organizationId,
  });

  const roster = await addExistingAthleteToRoster({
    playerId: createdAthlete.playerId,
    seasonId,
    competitionId,
    teamId,
    shirtNumber: input.shirtNumber ?? null,
  });

  return { playerId: createdAthlete.playerId, rosterId: roster.rosterId, duplicate: false, created: true };
}

export async function createStaffInFoundation(input: {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  birthDate?: string | null;
  photoUrl?: string | null;
  active?: boolean;
  organizationId: string;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const firstName = String(input.firstName ?? "").trim() || null;
  const lastName = String(input.lastName ?? "").trim() || null;
  const displayName = String(input.displayName ?? "").trim() || `${firstName ?? ""} ${lastName ?? ""}`.trim();
  if (!displayName) throw new Error("Απαιτείται όνομα.");
  const normalizedName = normalizePlayerName(displayName);

  const id = createEntityId("staff");
  const birthDate = input.birthDate ? String(input.birthDate) : null;
  const photoUrl = input.photoUrl ? String(input.photoUrl) : null;
  const active = input.active === undefined ? 1 : (input.active ? 1 : 0);
  const organizationId = String(input.organizationId ?? "").trim();
  if (!organizationId) throw new Error("Ο Οργανισμός είναι υποχρεωτικός.");

  await db.prepare(`INSERT INTO league_staff
    (id, organization_id, first_name, last_name, display_name, normalized_name, birth_date, photo_url, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, organizationId, firstName, lastName, displayName, normalizedName, birthDate, photoUrl, active)
    .run();
  return { staffId: id };
}

export async function createStaffWithRoster(input: {
  firstName: string;
  lastName: string;
  birthDate?: string | null;
  photoUrl?: string | null;
  role: StaffRole | string;
  customRoleLabel?: string | null;
  seasonId: string;
  competitionId: string;
  teamId: string;
  organizationId: string;
}) {
  const staff = await createStaffInFoundation({
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate ?? null,
    photoUrl: input.photoUrl ?? null,
    organizationId: input.organizationId,
  });

  const staffId = staff.staffId;
  const membership = await upsertStaffMembership({
    staffId,
    seasonId: String(input.seasonId),
    competitionId: String(input.competitionId),
    teamId: String(input.teamId),
    role: input.role,
    customRoleLabel: input.customRoleLabel ?? null,
  });
  return {
    staffId,
    membershipId: membership.staffMembershipId,
    membershipUpdated: membership.updated,
  };
}

export async function addExistingStaffToRoster(input: {
  staffId: string;
  seasonId: string;
  competitionId: string;
  teamId: string;
  role: StaffRole | string;
  customRoleLabel?: string | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const staffId = String(input.staffId ?? "").trim();
  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!staffId || !seasonId || !competitionId || !teamId) {
    throw new Error("Λείπουν υποχρεωτικά πεδία.");
  }

  const staff = await rows(db,"SELECT id FROM league_staff WHERE id=?", [staffId]);
  if (!(await staff).length) throw new Error("Δεν βρέθηκε το μέλος Staff.");
  const staffConflict = await db.prepare(`SELECT id FROM league_players WHERE id=?`).bind(staffId).first<{ id: string }>();
  if (staffConflict) {
    throw new Error("Το αναγνωριστικό δεν μπορεί να χρησιμοποιηθεί ταυτόχρονα ως αθλητής.");
  }
  await assertRosterTargetWritable(db, seasonId, competitionId);

  return upsertStaffMembership({
    staffId,
    seasonId,
    competitionId,
    teamId,
    role: input.role,
    customRoleLabel: input.customRoleLabel,
  });
}

export async function copyPreviousRosterForTeam(input: {
  seasonId: string;
  competitionId: string;
  teamId: string;
  organizationId: string;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!seasonId || !competitionId || !teamId) throw new Error("Λείπουν στοιχεία στοχευμένου ρόστερ.");
  await assertRosterTargetWritable(db, seasonId, competitionId);

  return copyPreviousRoster(db, seasonId, competitionId, teamId, true, input.organizationId);
}

export async function updateStaffCanonical(input: {
  staffId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  birthDate?: string | null;
  photoUrl?: string | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const staffId = String(input.staffId ?? "").trim();
  if (!staffId) throw new Error("Δεν επιλέχθηκε staff.");
  const existing = await db.prepare("SELECT * FROM league_staff WHERE id=?")
    .bind(staffId).first<DbRow>();
  if (!existing) throw new Error("Δεν βρέθηκε staff.");

  const displayName = String(input.displayName ?? existing.display_name).trim() || String(existing.display_name);
  const normalizedName = normalizePlayerName(displayName);
  const firstName = input.firstName !== undefined ? (String(input.firstName).trim() || null) : existing.first_name ?? null;
  const lastName = input.lastName !== undefined ? (String(input.lastName).trim() || null) : existing.last_name ?? null;
  const birthDate = input.birthDate !== undefined ? (input.birthDate ? String(input.birthDate) : null) : existing.birth_date ?? null;
  const photoUrl = input.photoUrl !== undefined ? (input.photoUrl ? String(input.photoUrl) : null) : existing.photo_url ?? null;

  await db.prepare(`UPDATE league_staff
    SET first_name=?, last_name=?, display_name=?, normalized_name=?, birth_date=?, photo_url=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(firstName, lastName, displayName, normalizedName, birthDate, photoUrl, staffId).run();
  return { staffId };
}

export async function upsertStaffMembership(input: {
  staffId: string;
  seasonId: string;
  competitionId: string;
  teamId: string;
  role: StaffRole | string;
  customRoleLabel?: string | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const staffId = String(input.staffId ?? "").trim();
  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!staffId || !seasonId || !competitionId || !teamId) throw new Error("Δεν υπάρχουν όλα τα πεδία συμμετοχής.");
  await assertRosterTargetWritable(db, seasonId, competitionId);

  const role = normalizeStaffRole(input.role, "other");
  const customRoleLabel = input.customRoleLabel ? String(input.customRoleLabel) : null;

  const existing = await db.prepare(`SELECT id FROM league_staff_memberships
    WHERE staff_id=? AND season_id=? AND competition_id=? AND team_id=?`)
    .bind(staffId, seasonId, competitionId, teamId).first<{ id: string }>();
  if (existing) {
    await db.prepare(`UPDATE league_staff_memberships
      SET role=?, custom_role_label=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(role, customRoleLabel, existing.id).run();
    return { staffMembershipId: existing.id, updated: true };
  }

  const id = createEntityId("staffMembership");
  await db.prepare(`INSERT INTO league_staff_memberships
    (id, staff_id, season_id, competition_id, team_id, role, custom_role_label)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, staffId, seasonId, competitionId, teamId, role, customRoleLabel).run();
  return { staffMembershipId: id, updated: false };
}

export async function updateStaffMembership(input: {
  membershipId: string;
  role: StaffRole | string;
  customRoleLabel?: string | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const membershipId = String(input.membershipId ?? "").trim();
  if (!membershipId) throw new Error("Δεν επιλέχθηκε εγγραφή staff.");
  const role = normalizeStaffRole(input.role, "other");
  const customRoleLabel = input.customRoleLabel ? String(input.customRoleLabel) : null;
  const existing = await db.prepare("SELECT id, season_id, competition_id FROM league_staff_memberships WHERE id=?")
    .bind(membershipId).first<{ id: string; season_id: string; competition_id: string }>();
  if (!existing) throw new Error("Δεν βρέθηκε η εγγραφή.");
  await assertRosterTargetWritable(db, existing.season_id, existing.competition_id);

  await db.prepare(`UPDATE league_staff_memberships
    SET role=?, custom_role_label=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(role, customRoleLabel, membershipId).run();
  return { staffMembershipId: membershipId };
}

export async function removeStaffFromRoster(input: { membershipId: string }) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const membershipId = String(input.membershipId ?? "").trim();
  if (!membershipId) throw new Error("Δεν επιλέχθηκε εγγραφή staff.");
  const existing = await db.prepare("SELECT id, season_id, competition_id FROM league_staff_memberships WHERE id=?")
    .bind(membershipId).first<{ id: string; season_id: string; competition_id: string }>();
  if (!existing) throw new Error("Δεν βρέθηκε η εγγραφή.");
  await assertRosterTargetWritable(db, existing.season_id, existing.competition_id);
  await db.prepare("DELETE FROM league_staff_memberships WHERE id=?").bind(membershipId).run();
  return { staffMembershipId: membershipId };
}

export async function createLeagueEntity(resource: string, input: Record<string, unknown>, actor: string, organizationId?: string) {
  const db = await database();
  if (!db) throw new Error("Η αποθήκευση διοργανώσεων είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");
  let id = createResourceEntityId(resource);
  const now = new Date().toISOString();
  await auditAndConvertLegacyKnockoutFormats(db);

  if (resource === "seasons") {
    const season = seasonInput(input);
    const existing = await db.prepare("SELECT id FROM league_seasons WHERE name=?")
      .bind(season.name).first<{ id: string }>();
    if (existing) throw new Error("Υπάρχει ήδη σεζόν με αυτή την ονομασία.");
    await db.prepare(`INSERT INTO league_seasons (id,name,slug,starts_on,ends_on,status) VALUES (?,?,?,?,?,?)`)
      .bind(id, season.name, String(input.slug || slugify(season.name)), season.startsOn, season.endsOn, season.status).run();
  } else if (resource === "competitions") {
    const canonicalOrganizationId = String(organizationId ?? "").trim();
    if (!canonicalOrganizationId) throw new Error("Ο Οργανισμός είναι υποχρεωτικός.");
    const competition = await competitionInput(db, input);
    const duplicate = await db.prepare(
      "SELECT id FROM league_competitions WHERE organization_id=? AND season_id=? AND slug=?",
    ).bind(canonicalOrganizationId, competition.seasonId, competition.slug).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη διοργάνωση με αυτή την ονομασία στη συγκεκριμένη σεζόν.");
    await db.prepare(`INSERT INTO league_competitions
      (id,organization_id,season_id,name,slug,type,description,status,custom_type_label,logo_url)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        canonicalOrganizationId,
        competition.seasonId,
        competition.name,
        competition.slug,
        competition.type,
        competition.description,
        competition.legacyStatus,
        competition.customTypeLabel,
        competition.logoUrl,
      ).run();
    await saveCompetitionDetails(db, id, competition);

    if (competition.copyPhases && competition.sourceId) {
      const sourcePhases = await rows<DbRow>(db, `SELECT p.*,
        pr.phase_kind, pr.bracket_size, pr.best_of, pr.wins_required,
        pr.carry_over_enabled, pr.carry_over_source_phase_id,
        pr.settings_json AS rule_settings_json
        FROM league_phases p
        LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
        WHERE p.competition_id=? ORDER BY p.order_index`, [competition.sourceId]);
      const copiedIds = new Map<string, string>();
      for (const sourcePhase of sourcePhases) {
        const phaseId = createEntityId("phase");
        copiedIds.set(String(sourcePhase.id), phaseId);
        const sourceFormat = normalizeCanonicalFormat(String(sourcePhase.format ?? sourcePhase.phase_kind ?? "standings"));
        const sourceOrder = Number(sourcePhase.phase_order ?? sourcePhase.order_index ?? 1);
        const sourcePhaseOrder = Number.isFinite(sourceOrder) && sourceOrder > 0 ? sourceOrder : 1;
        await db.prepare(`INSERT INTO league_phases
          (id,competition_id,name,slug,phase_type,format,order_index,phase_order,settings_json)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .bind(
            phaseId,
            id,
            sourcePhase.name,
            sourcePhase.slug,
            sourcePhase.phase_type,
            sourceFormat,
            sourcePhase.order_index,
            sourcePhaseOrder,
            sourcePhase.settings_json ?? "{}",
          ).run();
        await db.prepare(`INSERT INTO league_phase_rules
          (phase_id,phase_kind,bracket_size,best_of,wins_required,carry_over_enabled,carry_over_source_phase_id,settings_json)
          VALUES (?,?,?,?,?,?,NULL,?)
          ON CONFLICT(phase_id) DO UPDATE SET
            phase_kind=excluded.phase_kind, bracket_size=excluded.bracket_size,
            best_of=excluded.best_of, wins_required=excluded.wins_required,
            carry_over_enabled=excluded.carry_over_enabled,
            carry_over_source_phase_id=NULL, settings_json=excluded.settings_json`)
          .bind(
            phaseId,
            sourcePhase.phase_kind ?? (sourcePhase.phase_type === "regular" ? "regular_season" : sourcePhase.phase_type),
            sourcePhase.bracket_size,
            sourcePhase.best_of,
            sourcePhase.wins_required,
            sourcePhase.carry_over_enabled ?? 0,
            sourcePhase.rule_settings_json ?? "{}",
          ).run();
      }
      for (const sourcePhase of sourcePhases) {
        const copiedSource = copiedIds.get(String(sourcePhase.carry_over_source_phase_id ?? ""));
        if (copiedSource) {
          await db.prepare("UPDATE league_phase_rules SET carry_over_source_phase_id=? WHERE phase_id=?")
            .bind(copiedSource, copiedIds.get(String(sourcePhase.id))).run();
        }
      }
    }
  } else if (resource === "competition-venues") {
    const competitionId = String(input.competitionId ?? "").trim();
    if (!competitionId) throw new Error("Η διοργάνωση είναι υποχρεωτική.");
    const competition = await db.prepare("SELECT id FROM league_competitions WHERE id=?")
      .bind(competitionId).first<{ id: string }>();
    if (!competition) throw new Error("Η διοργάνωση δεν βρέθηκε.");
    const venue = competitionVenueInput(input);
    const duplicate = await db.prepare(
      "SELECT id FROM league_competition_venues WHERE competition_id=? AND LOWER(TRIM(name))=LOWER(TRIM(?))",
    ).bind(competitionId, venue.name).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη γήπεδο με αυτή την ονομασία στη συγκεκριμένη διοργάνωση.");
    const maxSort = await db.prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM league_competition_venues WHERE competition_id=?",
    ).bind(competitionId).first<{ max_sort: number | null }>();
    const sortOrder = venue.sortOrder || Number(maxSort?.max_sort ?? 0) + 1;
    await db.prepare(`INSERT INTO league_competition_venues
      (id,competition_id,name,address,map_url,sort_order)
      VALUES (?,?,?,?,?,?)`)
      .bind(id, competitionId, venue.name, venue.address, venue.mapUrl, sortOrder).run();
  } else if (resource === "teams") {
    const canonicalOrganizationId = String(organizationId ?? "").trim();
    if (!canonicalOrganizationId) throw new Error("Ο Οργανισμός είναι υποχρεωτικός.");
    const team = teamInput(input);
    const duplicate = await db.prepare(
      "SELECT id FROM league_teams WHERE organization_id=? AND (slug=? OR LOWER(TRIM(name))=LOWER(TRIM(?)))",
    ).bind(canonicalOrganizationId, team.slug, team.name).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη ομάδα με αυτή την ονομασία.");
    await db.prepare(`INSERT INTO league_teams (id,organization_id,name,slug,city,logo_url,active) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, canonicalOrganizationId, team.name, team.slug, team.city, team.logoUrl, team.active ? 1 : 0).run();
  } else if (resource === "participations") {
    const seasonId = String(input.seasonId ?? "").trim();
    const competitionId = String(input.competitionId ?? "").trim();
    const rawTeamIds = input.teamIds;
    const singleTeamId = String(input.teamId ?? "").trim();
    const normalizedTeamIds = new Set<string>();

    if (Array.isArray(rawTeamIds)) {
      for (const value of rawTeamIds) {
        const normalized = String(value).trim();
        if (normalized) normalizedTeamIds.add(normalized);
      }
    } else if (typeof rawTeamIds === "string") {
      for (const value of rawTeamIds.split(",").map((value) => value.trim()).filter(Boolean)) {
        normalizedTeamIds.add(value);
      }
    }

    if (singleTeamId) normalizedTeamIds.add(singleTeamId);

    const teamIds = Array.from(normalizedTeamIds);

    if (!seasonId || !competitionId || !teamIds.length) {
      throw new Error("Η σεζόν, η διοργάνωση και η ομάδα είναι υποχρεωτικές.");
    }

    const competition = await db.prepare(
      `SELECT c.id, cf.expected_team_count
       FROM league_competitions c
       LEFT JOIN league_competition_formats cf ON cf.competition_id=c.id
       WHERE c.id=? AND c.season_id=?`,
    ).bind(competitionId, seasonId).first<{ id: string; expected_team_count: number | null }>();
    if (!competition) throw new Error("Η διοργάνωση δεν ανήκει στην επιλεγμένη σεζόν.");

    const expectedTeamCount = Number(competition.expected_team_count ?? 0);
    if (!Number.isFinite(expectedTeamCount) || expectedTeamCount <= 0) {
      throw new Error("Δεν έχει οριστεί έγκυρη χωρητικότητα ομάδων για τη διοργάνωση.");
    }

    const activeCompetitionTeams = await rows<{ team_id: string }>(
      db,
      `SELECT st.team_id
       FROM league_competition_teams ct
       INNER JOIN league_season_teams st ON st.id=ct.season_team_id
       WHERE ct.competition_id=? AND ct.status='active'`,
      [competitionId],
    );
    const activeTeamSet = new Set(activeCompetitionTeams.map((row) => String(row.team_id ?? "").trim()).filter(Boolean));
    const newUniqueTeamIds = teamIds.filter((teamId) => !activeTeamSet.has(teamId));
    const currentActiveCount = activeTeamSet.size;
    if (currentActiveCount + newUniqueTeamIds.length > expectedTeamCount) {
      throw new Error(`Η διοργάνωση έχει συμπληρώσει τον μέγιστο αριθμό των ${expectedTeamCount} ομάδων.`);
    }

    const normalizedSeed = optionalInteger(input.seed, "Seed", 1);
    let created = 0;
    let existing = 0;

    for (const teamId of teamIds) {
      const team = await db.prepare("SELECT name,logo_url FROM league_teams WHERE id=?")
        .bind(teamId).first<{ name: string; logo_url: string | null }>();
      if (!team) throw new Error("Δεν βρέθηκε η ομάδα.");

      const existingSeasonTeam = await db.prepare(
        "SELECT id FROM league_season_teams WHERE season_id=? AND team_id=?",
      ).bind(seasonId, teamId).first<{ id: string }>();
      let seasonTeamId = existingSeasonTeam?.id ?? "";
      if (!seasonTeamId) {
        const pendingSeasonTeamId = createEntityId("season_team");
        await db.prepare(`INSERT INTO league_season_teams
          (id,season_id,team_id,display_name,logo_url) VALUES (?,?,?,?,?)
          ON CONFLICT(season_id,team_id) DO NOTHING`)
          .bind(pendingSeasonTeamId, seasonId, teamId, input.displayName || team.name, input.logoUrl || team.logo_url).run();

        const createdSeasonTeam = await db.prepare(
          "SELECT id FROM league_season_teams WHERE season_id=? AND team_id=?",
        ).bind(seasonId, teamId).first<{ id: string }>();
        seasonTeamId = createdSeasonTeam?.id || "";
        if (!seasonTeamId) throw new Error("Αποτυχία αποθήκευσης σχέσης ομάδας με σεζόν.");
      }

      const existingEntry = await db.prepare(
        "SELECT id,status FROM league_competition_teams WHERE competition_id=? AND season_team_id=?",
      ).bind(competitionId, seasonTeamId).first<{ id: string; status: string }>();
      if (existingEntry) {
        existing += 1;
        if (existingEntry.status !== "active") {
          await db.prepare(
            "UPDATE league_competition_teams SET seed=?,status='active' WHERE id=?",
          ).bind(normalizedSeed, existingEntry.id).run();
        }
        continue;
      }

      const insertResult = (await db.prepare(`INSERT INTO league_competition_teams
        (id,competition_id,season_team_id,seed,status) VALUES (?,?,?,?,'active')
        ON CONFLICT(competition_id, season_team_id) DO NOTHING`)
        .bind(createEntityId("competition_team"), competitionId, seasonTeamId, normalizedSeed).run()) as { meta?: { changes?: number } };
      const finalEntry = await db.prepare(
        "SELECT id,status FROM league_competition_teams WHERE competition_id=? AND season_team_id=?",
      ).bind(competitionId, seasonTeamId).first<{ id: string; status: string }>();
      if (!finalEntry) {
        throw new Error("Αποτυχία αποθήκευσης συμμετοχής σε διοργάνωση.");
      }
      if (finalEntry.status !== "active") {
        await db.prepare(
          "UPDATE league_competition_teams SET seed=?,status='active' WHERE id=?",
        ).bind(normalizedSeed, finalEntry.id).run();
        existing += 1;
        continue;
      }
      if (insertResult.meta?.changes) {
        created += 1;
      } else {
        existing += 1;
      }
    }

    // Στη φάση 5C: προσθήκη participation χωρίς αυτόματη αντιγραφή roster.

    await db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(createEntityId("audit"), actor, "create", "participations", "", JSON.stringify({ seasonId, competitionId, teamIds, created, existing }), now).run();

    return {
      teamIds: teamIds.length,
      created,
      existing,
      message: `Προστέθηκαν ${created} ομάδες. ${existing > 0 ? `${existing} υπήρχαν ήδη στη διοργάνωση.` : ""}`.trim(),
    };
  } else if (resource === "players") {
    const canonicalOrganizationId = String(organizationId ?? "").trim();
    if (!canonicalOrganizationId) throw new Error("Ο Οργανισμός είναι υποχρεωτικός.");
    const name = String(input.displayName ?? "").trim();
    const existing = await rows<{ id: string; display_name: string }>(db, "SELECT id,display_name FROM league_players WHERE organization_id=?", [canonicalOrganizationId]);
    const match = findAutomaticPlayerMatch(name, existing.map((row) => ({ id: row.id, displayName: row.display_name })));
    if (match) {
      await db.prepare(`INSERT OR IGNORE INTO league_player_aliases (id,player_id,alias,normalized_alias,source,confidence) VALUES (?,?,?,?,?,?)`)
        .bind(createEntityId("alias"), match.candidate.id, name, normalizePlayerName(name), "automatic", match.confidence).run();
      return { id: match.candidate.id, automaticallyMatched: true };
    }
    await db.prepare(`INSERT INTO league_players (id,organization_id,slug,display_name,normalized_name,active) VALUES (?,?,?,?,?,1)`)
      .bind(id, canonicalOrganizationId, String(input.slug || slugify(name)), name, normalizePlayerName(name)).run();
  } else if (resource === "rosters") {
    await addRosterMembership(db, id, input);
  } else if (resource === "phases") {
    const phase = await phaseInput(db, input);
    const standingsPresentation = parseStandingsPresentation(input);
    const duplicate = await db.prepare(
      "SELECT id FROM league_phases WHERE competition_id=? AND slug=?",
    ).bind(phase.competitionId, phase.slug).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη φάση με αυτή την ονομασία στη διοργάνωση.");
    await db.prepare(`INSERT INTO league_phases
      (id,competition_id,name,slug,phase_type,format,order_index,phase_order,previous_phase_id)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        phase.competitionId,
        phase.name,
        phase.slug,
        phase.legacyPhaseType,
        phase.phaseFormat,
        phase.orderIndex,
        phase.orderIndex,
        phase.previousPhaseId,
      ).run();
    await savePhaseRules(db, id, phase);
    await savePhaseStandingsPresentation(db, id, standingsPresentation);
    await normalizeCompetitionPhaseOrder(db, phase.competitionId);
  } else if (resource === "phase-schedules") {
    if (!["materializePhaseProgram", "generateRoundRobinGames"].includes(String(input.action ?? "").trim())) {
      throw new Error("Η δημιουργία προγράμματος απαιτεί την ενέργεια materializePhaseProgram.");
    }
    return materializePhaseProgramWithDb(db, input, actor);
  } else if (resource === "games") {
    const scheduledDate = validateIsoDate(input.scheduledDate ?? input.scheduled_date ?? null, "Ημερομηνία αγώνα");
    const scheduledTime = validateHmTime(input.scheduledTime ?? input.scheduled_time ?? null, "Ώρα αγώνα");
    if (!scheduledDate && scheduledTime) {
      throw new Error("Η ώρα αγώνα δεν μπορεί να οριστεί χωρίς ημερομηνία.");
    }
    const resultSource = trimmedTextOrNull(input.resultSource ?? input.result_source);
    if (resultSource && !["manual", "match_report", "award"].includes(resultSource)) {
      throw new Error("Μη έγκυρη προέλευση αποτελέσματος.");
    }
    await db.prepare(`INSERT INTO league_games
      (id,competition_id,phase_id,schedule_id,cycle_number,round_number,game_order,round_label,scheduled_at,scheduled_date,scheduled_time,venue,home_team_id,away_team_id,home_score,away_score,result_source,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        input.competitionId,
        input.phaseId || null,
        input.scheduleId || input.schedule_id || null,
        input.cycleNumber ?? input.cycle_number ?? null,
        input.roundNumber ?? input.round_number ?? null,
        input.gameOrder ?? input.game_order ?? null,
        input.roundLabel || "",
        input.scheduledAt || null,
        scheduledDate,
        scheduledTime,
        input.venue || "",
        input.homeTeamId,
        input.awayTeamId,
        input.homeScore ?? null,
        input.awayScore ?? null,
        resultSource,
        input.status || "scheduled",
      ).run();
  } else {
    throw new Error("Μη υποστηριζόμενη ενέργεια.");
  }

  await db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(createEntityId("audit"), actor, "create", resource, id, JSON.stringify(input), now).run();
  return { id, automaticallyMatched: false };
}

export async function updateLeagueSeason(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η επεξεργασία σεζόν είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε σεζόν για επεξεργασία.");

  const current = await db.prepare("SELECT * FROM league_seasons WHERE id=?")
    .bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η σεζόν.");

  const season = seasonInput(input);
  const duplicate = await db.prepare("SELECT id FROM league_seasons WHERE name=? AND id<>?")
    .bind(season.name, id).first<{ id: string }>();
  if (duplicate) throw new Error("Υπάρχει ήδη άλλη σεζόν με αυτή την ονομασία.");

  await db.prepare(`UPDATE league_seasons
    SET name=?, starts_on=?, ends_on=?, status=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(season.name, season.startsOn, season.endsOn, season.status, id).run();

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(
      createEntityId("audit"),
      actor,
      "update",
      "seasons",
      id,
      JSON.stringify({ before: current, after: season }),
      new Date().toISOString(),
    ).run();

  return { id };
}

export async function deleteLeagueSeason(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή σεζόν είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε σεζόν για διαγραφή.");

  const current = await db.prepare("SELECT * FROM league_seasons WHERE id=?")
    .bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η σεζόν.");

  const dependencies = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM league_competitions WHERE season_id=? LIMIT 1) AS competitions,
    EXISTS(SELECT 1 FROM league_season_teams WHERE season_id=? LIMIT 1) AS team_participations,
    EXISTS(SELECT 1 FROM league_roster_memberships WHERE season_id=? LIMIT 1) AS roster_memberships,
    EXISTS(SELECT 1 FROM league_player_movements WHERE season_id=? LIMIT 1) AS player_movements,
    EXISTS(SELECT 1 FROM league_legacy_player_refs WHERE season_id=? LIMIT 1) AS legacy_player_refs`)
    .bind(id, id, id, id, id).first<Record<string, number>>();

  if (dependencies && Object.values(dependencies).some(Boolean)) {
    throw new Error(`Η σεζόν «${String(current.name)}» δεν μπορεί να διαγραφεί επειδή χρησιμοποιείται ήδη από διοργανώσεις ή άλλα αγωνιστικά δεδομένα.`);
  }

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(
      createEntityId("audit"),
      actor,
      "delete",
      "seasons",
      id,
      JSON.stringify({ deleted: current }),
      new Date().toISOString(),
    ).run();

  await db.prepare("DELETE FROM league_seasons WHERE id=?")
    .bind(id).run();

  return { id };
}

export async function deleteLeagueCompetition(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή διοργάνωσης είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε διοργάνωση για διαγραφή.");

  const current = await db.prepare("SELECT * FROM league_competitions WHERE id=?")
    .bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η διοργάνωση.");

  const dependencies = await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM league_competition_teams WHERE competition_id=? LIMIT 1) AS team_participations,
    EXISTS(SELECT 1 FROM league_roster_memberships WHERE competition_id=? LIMIT 1) AS roster_memberships,
    EXISTS(SELECT 1 FROM league_phases WHERE competition_id=? LIMIT 1) AS phases,
    EXISTS(SELECT 1 FROM league_games WHERE competition_id=? LIMIT 1) AS games,
    EXISTS(
      SELECT 1
      FROM league_player_game_stats AS stats
      INNER JOIN league_games AS games ON games.id=stats.game_id
      WHERE games.competition_id=?
      LIMIT 1
    ) AS player_stats`)
    .bind(id, id, id, id, id).first<Record<string, number>>();

  if (dependencies && Object.values(dependencies).some(Boolean)) {
    throw new Error(`Η διοργάνωση «${String(current.name)}» δεν μπορεί να διαγραφεί επειδή χρησιμοποιείται ήδη από συμμετοχές ομάδων, ρόστερ, φάσεις, αγώνες ή άλλα αγωνιστικά δεδομένα.`);
  }

  await db.batch([
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`)
      .bind(
        createEntityId("audit"),
        actor,
        "delete",
        "competitions",
        id,
        JSON.stringify({ deleted: current }),
        new Date().toISOString(),
      ),
    db.prepare("DELETE FROM league_competition_publication WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM league_competition_formats WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM league_competitions WHERE id=?").bind(id),
  ]);

  return { id };
}

export async function cleanupLeagueCompetition(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Ο καθαρισμός διοργάνωσης είναι διαθέσιμος στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε διοργάνωση για καθαρισμό.");

  const current = await db.prepare(`
    SELECT c.id, c.name,
      COALESCE(cp.lifecycle_status, CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END) AS lifecycle_status
    FROM league_competitions c
    LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
    WHERE c.id=?
  `)
    .bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η διοργάνωση.");

  const lifecycleStatus = String(current.lifecycle_status ?? "");
  if (lifecycleStatus !== "under_construction") {
    throw new Error("Ο καθαρισμός επιτρέπεται μόνο για διοργάνωση σε κατάσταση Under Construction.");
  }

  const dependencyCounts = await db.prepare(`SELECT
    COUNT(*) AS phases,
    (
      SELECT COUNT(*)
      FROM league_games
      WHERE competition_id=?
    ) AS games,
    (
      SELECT COUNT(*)
      FROM league_player_game_stats AS stats
      INNER JOIN league_games AS games ON games.id=stats.game_id
      WHERE games.competition_id=?
    ) AS player_stats
  FROM league_phases
  WHERE competition_id=?`)
    .bind(id, id, id).first<DbRow>();

  const phasesCount = Number(dependencyCounts?.phases ?? 0);
  const gamesCount = Number(dependencyCounts?.games ?? 0);
  const playerStatsCount = Number(dependencyCounts?.player_stats ?? 0);

  if (phasesCount > 0) {
    throw new Error("Ο καθαρισμός δεν επιτρέπεται επειδή υπάρχουν φάσεις στη διοργάνωση.");
  }
  if (gamesCount > 0 || playerStatsCount > 0) {
    throw new Error("Ο καθαρισμός δεν επιτρέπεται επειδή υπάρχουν αγώνες ή στατιστικά αγώνων στη διοργάνωση.");
  }

  const [rosterMemberships, competitionTeams, publicationRows, formatRows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM league_roster_memberships WHERE competition_id=?").bind(id).first<DbRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM league_competition_teams WHERE competition_id=?").bind(id).first<DbRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM league_competition_publication WHERE competition_id=?").bind(id).first<DbRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM league_competition_formats WHERE competition_id=?").bind(id).first<DbRow>(),
  ]);

  const rosterMembershipsCount = Number(rosterMemberships?.count ?? 0);
  const competitionTeamsCount = Number(competitionTeams?.count ?? 0);
  const publicationCount = Number(publicationRows?.count ?? 0);
  const formatCount = Number(formatRows?.count ?? 0);

  await db.batch([
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`)
      .bind(
        createEntityId("audit"),
        actor,
        "cleanup",
        "competitions",
        id,
        JSON.stringify({
          competition: { id, name: current.name, lifecycle_status: current.lifecycle_status },
          removed: {
            roster_memberships: rosterMembershipsCount,
            competition_teams: competitionTeamsCount,
            publication_rows: publicationCount,
            format_rows: formatCount,
          },
        }),
        new Date().toISOString(),
      ),
    db.prepare("DELETE FROM league_roster_memberships WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM league_competition_teams WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM league_competition_publication WHERE competition_id=?").bind(id),
    db.prepare("DELETE FROM league_competition_formats WHERE competition_id=?").bind(id),
  ]);

  return {
    id,
    removed: {
      rosterMemberships: rosterMembershipsCount,
      competitionTeams: competitionTeamsCount,
      publicationRows: publicationCount,
      formatRows: formatCount,
    },
  };
}

export async function deleteLeagueParticipation(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή συμμετοχής είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε συμμετοχή για διαγραφή.");

  const current = await db.prepare(`
    SELECT ct.id, ct.competition_id, ct.season_team_id,
      st.team_id, st.season_id,
      s.status AS season_status,
      c.name AS competition_name, s.name AS season_name,
      COALESCE(cp.lifecycle_status, CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END) AS lifecycle_status
    FROM league_competition_teams ct
    JOIN league_season_teams st ON st.id=ct.season_team_id
    JOIN league_competitions c ON c.id=ct.competition_id
    JOIN league_seasons s ON s.id=st.season_id
    LEFT JOIN league_competition_publication cp ON cp.competition_id=ct.competition_id
    WHERE ct.id=?
  `)
    .bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η συμμετοχή.");

  const competitionLifecycle = String(current.lifecycle_status ?? "");
  const seasonStatus = String(current.season_status ?? "");
  if (isCompletedStatus(competitionLifecycle) || isCompletedStatus(seasonStatus)) {
    throw new Error("Δεν επιτρέπεται η αφαίρεση ομάδας από ολοκληρωμένη διοργάνωση ή σεζόν.");
  }

  const dependencies = await db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM league_games WHERE competition_id=? LIMIT 1) AS games,
      EXISTS(
        SELECT 1
        FROM league_player_game_stats stats
        INNER JOIN league_games g ON g.id=stats.game_id
        WHERE g.competition_id=?
        LIMIT 1
      ) AS player_stats,
      EXISTS(SELECT 1 FROM league_roster_memberships WHERE competition_id=? AND team_id=? LIMIT 1) AS roster_memberships
    `)
    .bind(
      String(current.competition_id),
      String(current.competition_id),
      String(current.competition_id),
      String(current.team_id),
    ).first<Record<string, number>>();

  if (dependencies && (dependencies.games || dependencies.player_stats || dependencies.roster_memberships)) {
    throw new Error(`Η συμμετοχή στην ομάδα της διοργάνωσης ${String(current.competition_name)} δεν μπορεί να αφαιρεθεί επειδή υπάρχουν εξαρτώμενα αγωνιστικά δεδομένα στη σεζόν ${String(current.season_name)}.`);
  }

  await db.prepare("DELETE FROM league_competition_teams WHERE id=?").bind(id).run();

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(
      createEntityId("audit"),
      actor,
      "delete",
      "participations",
      id,
      JSON.stringify({ deleted: current }),
    ).run();

  return { id };
}

export async function deleteLeaguePhase(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή φάσης είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε φάση για διαγραφή.");

  const current = await db.prepare(`
    SELECT p.id, p.competition_id, p.name, c.name AS competition_name
    FROM league_phases p
    JOIN league_competitions c ON c.id=p.competition_id
    WHERE p.id=?
  `).bind(id).first<{ id: string; competition_id: string; name: string; competition_name: string }>();
  if (!current) throw new Error("Δεν βρέθηκε η φάση.");

  const downstream = await db.prepare(`
    SELECT id, name
    FROM league_phases
    WHERE competition_id=? AND previous_phase_id=?
    ORDER BY COALESCE(phase_order, order_index, 0), id
    LIMIT 1
  `).bind(String(current.competition_id), id).first<{ id: string; name: string }>();
  if (downstream) {
    throw new Error(`Η φάση δεν μπορεί να διαγραφεί επειδή χρησιμοποιείται από τη φάση «${String(downstream.name ?? "")}».`);
  }

  const schedule = await db.prepare(`
    SELECT id, lifecycle_status
    FROM league_phase_schedules
    WHERE phase_id=?
    LIMIT 1
  `).bind(id).first<{ id: string; lifecycle_status: string }>();
  if (schedule) {
    throw new Error("Η φάση δεν μπορεί να διαγραφεί επειδή έχει δημιουργηθεί πρόγραμμα αγώνων. Διαγράψτε πρώτα το πρόγραμμα της φάσης.");
  }

  await db.prepare("DELETE FROM league_phase_rules WHERE phase_id=?").bind(id).run();
  await db.prepare("DELETE FROM league_phases WHERE id=?").bind(id).run();
  await normalizeCompetitionPhaseOrder(db, String(current.competition_id));

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(
      createEntityId("audit"),
      actor,
      "delete",
      "phases",
      id,
      JSON.stringify({ deleted: current }),
    ).run();

  return { id };
}

export async function deleteLeaguePhaseSchedule(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή προγράμματος είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε πρόγραμμα για διαγραφή.");

  const current = await db.prepare(`
    SELECT ps.id, ps.phase_id, ps.competition_id, ps.lifecycle_status,
      p.name AS phase_name, c.name AS competition_name
    FROM league_phase_schedules ps
    JOIN league_phases p ON p.id=ps.phase_id
    JOIN league_competitions c ON c.id=ps.competition_id
    WHERE ps.id=?
  `).bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε το πρόγραμμα.");
  if (String(current.lifecycle_status ?? "draft") !== "draft") {
    throw new Error("Μόνο τα πρόχειρα προγράμματα μπορούν να διαγραφούν.");
  }

  const games = await db.prepare(
    "SELECT COUNT(*) AS count FROM league_games WHERE schedule_id=?",
  ).bind(String(current.id ?? "")).first<DbRow>();
  if (Number(games?.count ?? 0) > 0) {
    throw new Error("Το πρόγραμμα δεν μπορεί να διαγραφεί επειδή έχουν ήδη δημιουργηθεί αγώνες.");
  }

  await db.batch([
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(
        createEntityId("audit"),
        actor,
        "delete",
        "phase-schedules",
        id,
        JSON.stringify({ deleted: current }),
      ),
    db.prepare("DELETE FROM league_phase_schedules WHERE id=?").bind(id),
  ]);

  return { id };
}

export type DeletePhaseProgramErrorCode =
  | "PHASE_PROGRAM_FINALIZED"
  | "PHASE_PROGRAM_STARTED"
  | "PHASE_PROGRAM_CONCURRENT_CHANGE";

export class DeletePhaseProgramError extends Error {
  readonly code: DeletePhaseProgramErrorCode;

  constructor(code: DeletePhaseProgramErrorCode, message: string) {
    super(message);
    this.name = "DeletePhaseProgramError";
    this.code = code;
  }
}

type PhaseProgramOwnedGame = DbRow & {
  id: string;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  result_source: string | null;
  external_id: string | null;
  has_player_stats: number;
};

const phaseProgramUnsafeGameSql = `
  (g.status <> 'scheduled'
    OR g.home_score IS NOT NULL
    OR g.away_score IS NOT NULL
    OR NULLIF(TRIM(COALESCE(g.result_source, '')), '') IS NOT NULL
    OR NULLIF(TRIM(COALESCE(g.external_id, '')), '') IS NOT NULL
    OR EXISTS (SELECT 1 FROM league_player_game_stats pgs WHERE pgs.game_id=g.id))
`;

const phaseProgramGuardSql = `NOT EXISTS (
  SELECT 1
  FROM league_games g
  WHERE g.phase_id=? AND g.schedule_id=? AND ${phaseProgramUnsafeGameSql}
)`;

export async function deletePhaseProgram(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή προγράμματος είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const competitionId = String(input.competitionId ?? input.competition_id ?? "").trim();
  const phaseId = String(input.phaseId ?? input.phase_id ?? "").trim();
  if (!competitionId || !phaseId) {
    throw new Error("Δεν επιλέχθηκε διοργάνωση και φάση για διαγραφή προγράμματος.");
  }

  const competition = await db.prepare("SELECT id FROM league_competitions WHERE id=?")
    .bind(competitionId).first<DbRow>();
  if (!competition) throw new Error("Δεν βρέθηκε η διοργάνωση.");

  const phase = await db.prepare(`
    SELECT id, competition_id, name, lifecycle_status, finalized_at
    FROM league_phases
    WHERE id=?
  `).bind(phaseId).first<DbRow>();
  if (!phase) throw new Error("Δεν βρέθηκε η φάση.");
  if (String(phase.competition_id ?? "") !== competitionId) {
    throw new Error("Η φάση δεν ανήκει στη συγκεκριμένη διοργάνωση.");
  }
  if (String(phase.lifecycle_status ?? "active") === "finalized" || phase.finalized_at) {
    throw new DeletePhaseProgramError(
      "PHASE_PROGRAM_FINALIZED",
      "Το πρόγραμμα οριστικοποιημένης φάσης δεν μπορεί να διαγραφεί.",
    );
  }

  const schedules = await rows<DbRow>(
    db,
    `SELECT id, competition_id, phase_id, lifecycle_status
      FROM league_phase_schedules
      WHERE phase_id=? AND competition_id=?
      ORDER BY id`,
    [phaseId, competitionId],
  );
  if (!schedules.length) {
    return {
      deleted: false,
      alreadyDeleted: true,
      noProgram: true,
      gamesDeleted: 0,
      planningSlotsDeleted: 0,
      phaseId,
    };
  }
  if (schedules.length !== 1) {
    throw new Error("Βρέθηκαν πολλαπλά προγράμματα για τη φάση. Η διαγραφή ακυρώθηκε.");
  }

  const schedule = schedules[0];
  const scheduleId = String(schedule.id ?? "");
  if (String(schedule.phase_id ?? "") !== phaseId || String(schedule.competition_id ?? "") !== competitionId) {
    throw new Error("Το πρόγραμμα δεν ανήκει στη σωστή φάση ή διοργάνωση.");
  }

  const ownedGames = await rows<PhaseProgramOwnedGame>(
    db,
    `SELECT g.id, g.status, g.home_score, g.away_score, g.result_source, g.external_id,
      EXISTS (SELECT 1 FROM league_player_game_stats pgs WHERE pgs.game_id=g.id) AS has_player_stats
      FROM league_games g
      WHERE g.phase_id=? AND g.schedule_id=?
      ORDER BY g.id`,
    [phaseId, scheduleId],
  );
  const startEvidence: PhaseProgramGameStartEvidence[] = ownedGames.map((game) => ({
    status: game.status,
    homeScore: game.home_score,
    awayScore: game.away_score,
    resultSource: game.result_source,
    externalId: game.external_id,
    hasPlayerStats: Boolean(Number(game.has_player_stats ?? 0)),
    // Add Match Report/play-by-play evidence here when those canonical tables are introduced.
    hasCompetitiveDependency: false,
  }));
  if (hasPhaseProgramStarted(startEvidence)) {
    throw new DeletePhaseProgramError(
      "PHASE_PROGRAM_STARTED",
      "Το πρόγραμμα δεν μπορεί να διαγραφεί επειδή τουλάχιστον ένας αγώνας έχει ξεκινήσει ή περιέχει αγωνιστικά δεδομένα.",
    );
  }

  const planningCount = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM league_series_planning_slots
    WHERE competition_id=? AND phase_id=? AND schedule_id=?
  `).bind(competitionId, phaseId, scheduleId).first<DbRow>();
  const gamesDeleted = ownedGames.length;
  const planningSlotsDeleted = Number(planningCount?.count ?? 0);

  // D1 batch is transactional. Every destructive statement repeats the no-start
  // guard so a concurrent result/stat write cannot be followed by deletion.
  await db.batch([
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP
      WHERE ${phaseProgramGuardSql}`)
      .bind(
        createEntityId("audit"),
        actor,
        "delete_program",
        "phases",
        phaseId,
        JSON.stringify({ competitionId, phaseId, scheduleId, gamesDeleted, planningSlotsDeleted }),
        phaseId,
        scheduleId,
      ),
    db.prepare(`DELETE FROM league_series_planning_slots
      WHERE competition_id=? AND phase_id=? AND schedule_id=?
        AND ${phaseProgramGuardSql}`)
      .bind(competitionId, phaseId, scheduleId, phaseId, scheduleId),
    db.prepare(`DELETE FROM league_games
      WHERE phase_id=? AND schedule_id=?
        AND ${phaseProgramGuardSql}`)
      .bind(phaseId, scheduleId, phaseId, scheduleId),
    db.prepare(`DELETE FROM league_phase_schedules
      WHERE id=? AND phase_id=? AND competition_id=?
        AND EXISTS (
          SELECT 1 FROM league_phases p
          WHERE p.id=? AND p.competition_id=?
            AND p.lifecycle_status <> 'finalized' AND p.finalized_at IS NULL
        )
        AND NOT EXISTS (SELECT 1 FROM league_games g WHERE g.phase_id=? AND g.schedule_id=?)
        AND NOT EXISTS (
          SELECT 1 FROM league_series_planning_slots ps
          WHERE ps.phase_id=? AND ps.schedule_id=?
        )`)
      .bind(
        scheduleId,
        phaseId,
        competitionId,
        phaseId,
        competitionId,
        phaseId,
        scheduleId,
        phaseId,
        scheduleId,
      ),
  ]);

  const remainingSchedule = await db.prepare(`
    SELECT id FROM league_phase_schedules
    WHERE id=? AND phase_id=? AND competition_id=?
  `).bind(scheduleId, phaseId, competitionId).first<DbRow>();
  if (remainingSchedule) {
    const unsafeAfterBatch = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM league_games g
      WHERE g.phase_id=? AND g.schedule_id=? AND ${phaseProgramUnsafeGameSql}
    `).bind(phaseId, scheduleId).first<DbRow>();
    if (Number(unsafeAfterBatch?.count ?? 0) > 0) {
      throw new DeletePhaseProgramError(
        "PHASE_PROGRAM_STARTED",
        "Το πρόγραμμα άλλαξε και περιέχει πλέον αγωνιστικά δεδομένα. Δεν διαγράφηκε τίποτα.",
      );
    }
    throw new DeletePhaseProgramError(
      "PHASE_PROGRAM_CONCURRENT_CHANGE",
      "Το πρόγραμμα άλλαξε ταυτόχρονα με τη διαγραφή. Δεν διαγράφηκε τίποτα.",
    );
  }

  return {
    deleted: true,
    alreadyDeleted: false,
    noProgram: false,
    gamesDeleted,
    planningSlotsDeleted,
    competitionId,
    phaseId,
    scheduleId,
  };
}

export async function deleteLeagueCompetitionVenue(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή γηπέδου είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε γήπεδο για διαγραφή.");

  const current = await db.prepare(`
    SELECT v.*, c.name AS competition_name
    FROM league_competition_venues v
    JOIN league_competitions c ON c.id=v.competition_id
    WHERE v.id=?
  `).bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε το γήπεδο.");

  await db.prepare("DELETE FROM league_competition_venues WHERE id=?").bind(id).run();

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(
      createEntityId("audit"),
      actor,
      "delete",
      "competition-venues",
      id,
      JSON.stringify({ deleted: current }),
    ).run();

  return { id };
}

export async function bulkScheduleGames(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η επεξεργασία προγραμματισμού είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const competitionId = String(input.competitionId ?? "").trim();
  if (!competitionId) throw new Error("Δεν επιλέχθηκε διοργάνωση.");

  const rawGameIds = Array.isArray(input.gameIds) ? input.gameIds : [];
  const gameIds = rawGameIds.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (!gameIds.length) throw new Error("Δεν επιλέχθηκαν αγώνες.");
  if (new Set(gameIds).size !== gameIds.length) throw new Error("Η επιλογή αγώνων περιέχει διπλότυπα.");

  const dateMode = schedulingModeValue(input.scheduledDateMode ?? input.scheduled_date_mode, "Ημερομηνία");
  const timeMode = schedulingModeValue(input.scheduledTimeMode ?? input.scheduled_time_mode, "Ώρα");
  const venueMode = schedulingModeValue(input.venueMode ?? input.venue_mode, "Γήπεδο");

  const placeholders = gameIds.map(() => "?").join(", ");
  const games = await db.prepare(`SELECT * FROM league_games WHERE id IN (${placeholders})`).bind(...gameIds).all<DbRow>();
  const gameRows = games.results ?? [];
  if (gameRows.length !== gameIds.length) throw new Error("Ένας ή περισσότεροι αγώνες δεν βρέθηκαν.");
  const gameMap = new Map(gameRows.map((game) => [String(game.id ?? ""), game]));
  const phaseIds = [...new Set(gameRows.map((game) => String(game.phase_id ?? "").trim()).filter(Boolean))];
  if (phaseIds.length) {
    const phasePlaceholders = phaseIds.map(() => "?").join(",");
    const finalizedPhase = await db.prepare(`SELECT id FROM league_phases
      WHERE id IN (${phasePlaceholders}) AND (lifecycle_status='finalized' OR finalized_at IS NOT NULL) LIMIT 1`)
      .bind(...phaseIds).first<{ id: string }>();
    if (finalizedPhase) throw new Error("Δεν επιτρέπεται προγραμματισμός αγώνων οριστικοποιημένης φάσης.");
  }
  for (const gameId of gameIds) {
    const game = gameMap.get(gameId);
    if (!game) throw new Error("Ένας ή περισσότεροι αγώνες δεν βρέθηκαν.");
    if (String(game.competition_id ?? "") !== competitionId) {
      throw new Error("Ένας ή περισσότεροι αγώνες ανήκουν σε άλλη διοργάνωση.");
    }
  }

  const dateValue = dateMode === "set"
    ? validateIsoDate(input.scheduledDate ?? input.scheduled_date ?? null, "Ημερομηνία αγώνα")
    : null;
  const timeValue = timeMode === "set"
    ? validateHmTime(input.scheduledTime ?? input.scheduled_time ?? null, "Ώρα αγώνα")
    : null;

  let venueName = "";
  if (venueMode === "set") {
    const venueId = String(input.venueId ?? input.venue_id ?? "").trim();
    if (!venueId) throw new Error("Δεν επιλέχθηκε γήπεδο.");
    const venue = await db.prepare(
      "SELECT id, name FROM league_competition_venues WHERE id=? AND competition_id=?",
    ).bind(venueId, competitionId).first<DbRow>();
    if (!venue) throw new Error("Το επιλεγμένο γήπεδο δεν ανήκει στη συγκεκριμένη διοργάνωση.");
    venueName = String(venue.name ?? "").trim();
    if (!venueName) throw new Error("Το επιλεγμένο γήπεδο δεν είναι έγκυρο.");
  }

  const updates = gameIds.map((gameId) => {
    const current = gameMap.get(gameId);
    if (!current) throw new Error("Ένας ή περισσότεροι αγώνες δεν βρέθηκαν.");
    const currentDate = trimmedTextOrNull(current.scheduled_date);
    const currentTime = trimmedTextOrNull(current.scheduled_time);
    const currentVenue = String(current.venue ?? "").trim();

    const nextDate = dateMode === "keep" ? currentDate : dateMode === "clear" ? null : dateValue;
    const nextTime = timeMode === "keep" ? currentTime : timeMode === "clear" ? null : timeValue;
    const nextVenue = venueMode === "keep" ? currentVenue : venueMode === "clear" ? "" : venueName;

    if (!nextDate && nextTime) {
      throw new Error("Η ώρα αγώνα δεν μπορεί να οριστεί χωρίς ημερομηνία.");
    }

    return { id: gameId, scheduledDate: nextDate, scheduledTime: nextTime, venue: nextVenue };
  });

  await db.batch(updates.map((update) => db.prepare(`UPDATE league_games SET
    scheduled_date=?, scheduled_time=?, venue=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?`).bind(update.scheduledDate, update.scheduledTime, update.venue, update.id)));

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
    .bind(
      createEntityId("audit"),
      actor,
      "update",
      "games",
      gameIds.join(","),
      JSON.stringify({
        competitionId,
        gameIds,
        scheduling: {
          scheduledDateMode: dateMode,
          scheduledTimeMode: timeMode,
          venueMode,
          scheduledDate: dateValue,
          scheduledTime: timeValue,
          venueName: venueMode === "set" ? venueName : null,
        },
      }),
    ).run();

  return { updatedCount: gameIds.length, gameIds };
}

async function materializeRoundRobinProgramWithDb(
  db: D1DatabaseBinding,
  schedule: DbRow,
  actor: string,
  createSchedule: boolean,
): Promise<PhaseProgramMaterializationResult> {
  const scheduleId = String(schedule.id ?? "");
  const competitionId = String(schedule.competition_id ?? "");
  const phaseId = String(schedule.phase_id ?? "");
  if (String(schedule.phase_lifecycle_status ?? "active") === "finalized" || schedule.phase_finalized_at) {
    throw new Error("Δεν επιτρέπεται αναγέννηση προγράμματος οριστικοποιημένης φάσης.");
  }
  if (String(schedule.lifecycle_status ?? "draft") !== "draft") {
    throw new Error("Δεν μπορείτε να δημιουργήσετε αγώνες σε δημοσιευμένο πρόγραμμα.");
  }

  const phaseRules = parseJsonRecord(schedule.canonical_rule_settings_json ?? schedule.phase_rule_settings_json ?? schedule.rule_settings_json);
  const gamesPerPairing = parseStandingsRuleInt(phaseRules.gamesPerPairing, 1, "Αγώνες ανά ζευγάρι", 1);
  const competitionParticipants = await rows<{ team_id: string; team_name: string }>(db, `
    SELECT st.team_id, COALESCE(st.display_name, t.name) AS team_name
    FROM league_competition_teams ct
    INNER JOIN league_season_teams st ON st.id=ct.season_team_id
    INNER JOIN league_teams t ON t.id=st.team_id
    WHERE ct.competition_id=? AND ct.status='active'
    ORDER BY COALESCE(ct.seed, 999), LOWER(TRIM(COALESCE(st.display_name, t.name))), st.id
  `, [competitionId]);
  const input = {
    competitionId,
    phaseId,
    scheduleId,
    gamesPerPairing,
    teams: competitionParticipants.map((team) => ({ id: String(team.team_id ?? ""), name: String(team.team_name ?? "—") })),
  };
  const validation = generateRoundRobinDryRun(input);
  if (!validation.ok) throw new Error(validation.errors.join(" "));

  const materializedGames = await rows<DbRow>(db, `
    SELECT id, competition_id, phase_id, schedule_id, cycle_number, round_number, game_order, home_team_id, away_team_id
    FROM league_games
    WHERE competition_id=? AND phase_id=? AND schedule_id=?
  `, [competitionId, phaseId, scheduleId]);
  if (!createSchedule && materializedGames.length === validation.games.length) {
    return {
      scheduleId,
      competitionId,
      phaseId,
      scheduleCreated: false,
      expectedGames: validation.games.length,
      existingGames: materializedGames.length,
      gamesCreated: 0,
      complete: true,
    };
  }
  const fixturePlan = generateRoundRobinFixturePlan(input, materializedGames.map((game) => ({
    id: String(game.id ?? ""),
    competition_id: String(game.competition_id ?? ""),
    phase_id: String(game.phase_id ?? ""),
    schedule_id: String(game.schedule_id ?? ""),
    cycle_number: Number(game.cycle_number ?? 0) || null,
    round_number: Number(game.round_number ?? 0) || null,
    game_order: Number(game.game_order ?? 0) || null,
    home_team_id: String(game.home_team_id ?? ""),
    away_team_id: String(game.away_team_id ?? ""),
  })));
  if (fixturePlan.conflictCount > 0) throw new Error("Υπάρχει σύγκρουση στο υπάρχον πρόγραμμα της φάσης.");

  const missingFixtures = fixturePlan.items.filter((item) => item.state === "missing");
  if (!createSchedule && !missingFixtures.length) {
    return { scheduleId, competitionId, phaseId, scheduleCreated: false, expectedGames: fixturePlan.expectedCount, existingGames: fixturePlan.existingCount, gamesCreated: 0, complete: true };
  }

  const statements: ReturnType<D1DatabaseBinding["prepare"]>[] = [];
  let scheduleStatementIndex: number | null = null;
  if (createSchedule) {
    scheduleStatementIndex = statements.length;
    statements.push(db.prepare(`INSERT INTO league_phase_schedules (id,competition_id,phase_id,lifecycle_status) VALUES (?,?,?,'draft')`)
      .bind(scheduleId, competitionId, phaseId));
  }
  statements.push(...missingFixtures.map((fixture) => db.prepare(`INSERT INTO league_games
    (id,competition_id,phase_id,schedule_id,cycle_number,round_number,game_order,round_label,scheduled_at,venue,home_team_id,away_team_id,home_score,away_score,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      createEntityId("game"), competitionId, phaseId, scheduleId, fixture.cycle_number, fixture.round_number,
      fixture.game_order, `${fixture.round_number}η Αγωνιστική`, null, "", fixture.home_team_id, fixture.away_team_id, null, null, "scheduled",
    )));
  statements.push(db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(
      createEntityId("audit"), actor, "materializePhaseProgram", "league_phase_schedules", scheduleId,
      JSON.stringify({ scheduleId, phaseId, competitionId, scheduleCreated: createSchedule, games: missingFixtures.length, existingGames: fixturePlan.existingCount, expectedGames: fixturePlan.expectedCount }),
    ));
  const results = await db.batch(statements);
  const scheduleCreated = scheduleStatementIndex !== null
    && Number((results[scheduleStatementIndex] as { meta?: { changes?: number } })?.meta?.changes ?? 0) > 0;
  return {
    scheduleId,
    competitionId,
    phaseId,
    scheduleCreated,
    expectedGames: fixturePlan.expectedCount,
    existingGames: fixturePlan.existingCount,
    gamesCreated: missingFixtures.length,
    complete: fixturePlan.existingCount + missingFixtures.length === fixturePlan.expectedCount,
  };
}

async function materializePhaseProgramWithDb(
  db: D1DatabaseBinding,
  input: Record<string, unknown>,
  actor: string,
): Promise<PhaseProgramMaterializationResult> {
  const requestedScheduleId = String(input.scheduleId ?? input.id ?? "").trim();
  const requestedSchedule = requestedScheduleId
    ? await db.prepare(`SELECT id,competition_id,phase_id,lifecycle_status FROM league_phase_schedules WHERE id=?`)
      .bind(requestedScheduleId).first<DbRow>()
    : null;
  const competitionId = String(input.competitionId ?? requestedSchedule?.competition_id ?? "").trim();
  const phaseId = String(input.phaseId ?? input.phase_id ?? requestedSchedule?.phase_id ?? "").trim();
  if (!competitionId || !phaseId) throw new Error("Η φάση και η διοργάνωση είναι υποχρεωτικές.");

  const phase = await db.prepare(`SELECT p.*, pr.phase_kind, pr.settings_json AS phase_rule_settings_json,
      pr.settings_json AS canonical_rule_settings_json
    FROM league_phases p LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.id=? AND p.competition_id=?`).bind(phaseId, competitionId).first<DbRow>();
  if (!phase) throw new Error("Δεν βρέθηκε η επιλεγμένη φάση.");
  if (String(phase.lifecycle_status ?? "active") === "finalized" || phase.finalized_at) {
    throw new Error("Δεν επιτρέπεται δημιουργία ή αναγέννηση προγράμματος οριστικοποιημένης φάσης.");
  }
  const schedules = await rows<DbRow>(db, `SELECT id,competition_id,phase_id,lifecycle_status FROM league_phase_schedules WHERE phase_id=? AND competition_id=? ORDER BY id`, [phaseId, competitionId]);
  if (schedules.length > 1) throw new Error("Βρέθηκαν πολλαπλοί προγραμματισμοί για τη φάση.");
  const existingSchedule = schedules[0] ?? null;
  if (requestedSchedule && (!existingSchedule || String(existingSchedule.id) !== requestedScheduleId)) {
    throw new Error("Ο προγραμματισμός δεν ανήκει στη σωστή φάση ή διοργάνωση.");
  }
  const scheduleId = String(existingSchedule?.id ?? createResourceEntityId("phase-schedules"));
  const schedule: DbRow = {
    ...phase,
    ...existingSchedule,
    id: scheduleId,
    competition_id: competitionId,
    phase_id: phaseId,
    lifecycle_status: String(existingSchedule?.lifecycle_status ?? "draft"),
    phase_format: phase.format,
    phase_type: phase.phase_type,
    phase_lifecycle_status: phase.lifecycle_status,
    phase_finalized_at: phase.finalized_at,
  };
  const createSchedule = !existingSchedule;
  const phaseFormat = normalizeCanonicalFormat(String(phase.format ?? ""), String(phase.phase_kind ?? phase.phase_type ?? ""));
  if (phaseFormat === "standings") return materializeRoundRobinProgramWithDb(db, schedule, actor, createSchedule);
  if (phaseFormat === "series") {
    const provisionalSchedule = createSchedule
      ? { id: scheduleId, competition_id: competitionId, phase_id: phaseId, lifecycle_status: "draft" }
      : undefined;
    const result = await materializeSeriesRequiredGames(db, phaseId, competitionId, { provisionalSchedule });
    const expectedGames = result.dryRun.existingSeriesGameCount + result.dryRun.proposedGameCount;
    return {
      scheduleId,
      competitionId,
      phaseId,
      scheduleCreated: Boolean(result.scheduleCreated),
      expectedGames,
      existingGames: result.dryRun.existingSeriesGameCount,
      gamesCreated: result.createdGameIds.length,
      complete: result.dryRun.existingSeriesGameCount + result.createdGameIds.length >= expectedGames,
      planningLinksUpdated: result.planningLinksUpdated ?? 0,
    };
  }
  throw new Error("Η δημιουργία προγράμματος δεν υποστηρίζεται για αυτόν τον τύπο φάσης.");
}

export async function materializePhaseProgram(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η δημιουργία προγράμματος είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");
  return materializePhaseProgramWithDb(db, input, actor);
}

export async function generateRoundRobinGamesForSchedule(input: Record<string, unknown>, actor: string) {
  return materializePhaseProgram(input, actor);
}

export async function deleteLeagueTeam(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η διαγραφή ομάδας είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε ομάδα για διαγραφή.");

  const current = await db.prepare("SELECT * FROM league_teams WHERE id=?")
    .bind(id).first<DbRow>();
  if (!current) throw new Error("Δεν βρέθηκε η ομάδα.");

  const references = await db.prepare(`
    SELECT
      EXISTS(SELECT 1 FROM league_season_teams WHERE team_id=? LIMIT 1) AS season_teams,
      EXISTS(
        SELECT 1
        FROM league_competition_teams ct
        INNER JOIN league_season_teams st ON st.id=ct.season_team_id
        WHERE st.team_id=?
        LIMIT 1
      ) AS competition_participations,
      EXISTS(SELECT 1 FROM league_roster_memberships WHERE team_id=? LIMIT 1) AS roster_memberships,
      EXISTS(SELECT 1 FROM league_games WHERE home_team_id=? OR away_team_id=? LIMIT 1) AS games,
      EXISTS(SELECT 1 FROM league_player_game_stats WHERE team_id=? LIMIT 1) AS player_stats,
      EXISTS(
        SELECT 1
        FROM league_player_movements
        WHERE from_team_id=? OR to_team_id=?
        LIMIT 1
      ) AS player_movements
    `)
    .bind(id, id, id, id, id, id, id, id).first<Record<string, number>>();

  const participationRows = await db.prepare(`
    SELECT
      st.id AS season_team_id,
      s.name AS season_name,
      s.status AS season_status,
      c.name AS competition_name,
      c.id AS competition_id,
      COALESCE(cp.lifecycle_status, CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END) AS competition_status
    FROM league_competition_teams ct
    INNER JOIN league_season_teams st ON st.id=ct.season_team_id
    INNER JOIN league_seasons s ON s.id=st.season_id
    INNER JOIN league_competitions c ON c.id=ct.competition_id
    LEFT JOIN league_competition_publication cp ON cp.competition_id=ct.competition_id
    WHERE st.team_id=?
  `).bind(id).all<DbRow>();

  const completedParticipations = (participationRows.results ?? []).filter((participation) => {
    if (isCompletedStatus(String(participation.competition_status ?? ""))) return true;
    if (isCompletedStatus(String(participation.season_status ?? ""))) return true;
    return false;
  });

  const completedParticipation = completedParticipations.length > 0;
  if (completedParticipation) {
    const sample = completedParticipations[0];
    throw new Error(
      `Η ομάδα ${String(current.name)} δεν μπορεί να διαγραφεί γιατί έχει ιστορική συμμετοχή στην διοργάνωση ${String(sample?.competition_name ?? "")} / σεζόν ${String(sample?.season_name ?? "")}.`,
    );
  }

  if (references?.competition_participations) {
    throw new Error("Η ομάδα συμμετέχει ακόμη σε ενεργή ή μη ολοκληρωμένη διοργάνωση. Αφαίρεσέ την πρώτα από τη διοργάνωση.");
  }

  const dependencyRows = [
    { key: "roster_memberships", label: "roster" },
    { key: "games", label: "αγώνων" },
    { key: "player_stats", label: "στατιστικών" },
    { key: "player_movements", label: "μετακινήσεων παικτών" },
  ] as const;
  for (const dependency of dependencyRows) {
    if (references?.[dependency.key]) {
      throw new Error(`Η ομάδα ${String(current.name)} δεν μπορεί να διαγραφεί επειδή έχει εξαρτώμενα δεδομένα ${dependency.label}.`);
    }
  }

  const seasonTeamRows = await db.prepare(`
    SELECT st.id, st.season_id, s.status AS season_status, s.name AS season_name
    FROM league_season_teams st
    INNER JOIN league_seasons s ON s.id=st.season_id
    WHERE st.team_id=?
  `).bind(id).all<DbRow>();

  for (const seasonTeam of seasonTeamRows.results ?? []) {
    if (isCompletedStatus(String(seasonTeam.season_status ?? ""))) {
      throw new Error(`Η ομάδα ${String(current.name)} συνδέεται με ολοκληρωμένη σεζόν (${String(seasonTeam.season_name)}), άρα δεν μπορεί να διαγραφεί χωρίς ιστορική απώλεια.`);
    }
  }

  if (references?.season_teams) {
    await db.prepare("DELETE FROM league_season_teams WHERE team_id=?")
      .bind(id).run();
  }

  await db.prepare(`INSERT INTO league_audit_log
    (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(
      createEntityId("audit"),
      actor,
      "delete",
      "teams",
      id,
      JSON.stringify({ deleted: current }),
      new Date().toISOString(),
    ).run();

  await db.prepare("DELETE FROM league_teams WHERE id=?")
    .bind(id).run();

  return { id };
}

export async function updateLeagueEntity(resource: string, input: Record<string, unknown>, actor: string) {
  if (resource === "seasons") return updateLeagueSeason(input, actor);

  const db = await database();
  if (!db) throw new Error("Η επεξεργασία είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");
  const id = String(input.id ?? "").trim();
  if (!id) throw new Error("Δεν επιλέχθηκε εγγραφή για επεξεργασία.");
  await auditAndConvertLegacyKnockoutFormats(db);

  if (resource === "competition-venues") {
    const current = await db.prepare("SELECT * FROM league_competition_venues WHERE id=?")
      .bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε το γήπεδο.");
    const competitionId = String(current.competition_id ?? "").trim();
    if (String(input.competitionId ?? competitionId).trim() !== competitionId) {
      throw new Error("Το γήπεδο ανήκει σε συγκεκριμένη διοργάνωση και δεν μπορεί να μεταφερθεί.");
    }
    const venue = competitionVenueInput(input, current);
    const duplicate = await db.prepare(
      "SELECT id FROM league_competition_venues WHERE competition_id=? AND LOWER(TRIM(name))=LOWER(TRIM(?)) AND id<>?",
    ).bind(competitionId, venue.name, id).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη γήπεδο με αυτή την ονομασία στη συγκεκριμένη διοργάνωση.");
    await db.prepare(`UPDATE league_competition_venues
      SET name=?, address=?, map_url=?, sort_order=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(venue.name, venue.address, venue.mapUrl, venue.sortOrder, id).run();
    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
      createEntityId("audit"), actor, "update", resource, id,
      JSON.stringify({ before: current, after: venue }), new Date().toISOString(),
    ).run();
    return { id };
  }

  if (resource === "games") {
    const current = await db.prepare(`SELECT g.*, p.lifecycle_status AS phase_lifecycle_status, p.finalized_at AS phase_finalized_at
      FROM league_games g JOIN league_phases p ON p.id=g.phase_id WHERE g.id=?`)
      .bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε ο αγώνας.");
    if (String(current.phase_lifecycle_status ?? "active") === "finalized" || current.phase_finalized_at) {
      throw new Error("Οι αγώνες οριστικοποιημένης φάσης δεν μπορούν να τροποποιηθούν.");
    }

    if (String(input.action ?? input.updateAction ?? "") === "manual-result") {
      const competitionId = String(input.competitionId ?? input.competition_id ?? "").trim();
      return saveOfficialGameResultAndProgressSeriesWithDb(db, {
        gameId: id,
        competitionId,
        homeScore: input.homeScore ?? input.home_score,
        awayScore: input.awayScore ?? input.away_score,
        resultSource: "manual",
      }, actor);
    }

    const hasScheduledDate = Object.prototype.hasOwnProperty.call(input, "scheduledDate")
      || Object.prototype.hasOwnProperty.call(input, "scheduled_date");
    const hasScheduledTime = Object.prototype.hasOwnProperty.call(input, "scheduledTime")
      || Object.prototype.hasOwnProperty.call(input, "scheduled_time");
    const hasVenue = Object.prototype.hasOwnProperty.call(input, "venue");
    const hasScheduledAt = Object.prototype.hasOwnProperty.call(input, "scheduledAt")
      || Object.prototype.hasOwnProperty.call(input, "scheduled_at");
    const hasVideoUrl = Object.prototype.hasOwnProperty.call(input, "videoUrl")
      || Object.prototype.hasOwnProperty.call(input, "video_url");

    const scheduledDate = hasScheduledDate
      ? validateIsoDate(input.scheduledDate ?? input.scheduled_date ?? null, "Ημερομηνία αγώνα")
      : (trimmedTextOrNull(current.scheduled_date) ?? null);
    const scheduledTime = hasScheduledTime
      ? validateHmTime(input.scheduledTime ?? input.scheduled_time ?? null, "Ώρα αγώνα")
      : (trimmedTextOrNull(current.scheduled_time) ?? null);
    if (!scheduledDate && scheduledTime) {
      throw new Error("Η ώρα αγώνα δεν μπορεί να οριστεί χωρίς ημερομηνία.");
    }
    const venue = hasVenue
      ? String(input.venue ?? "").trim()
      : String(current.venue ?? "").trim();
    const scheduledAt = hasScheduledAt
      ? (String(input.scheduledAt ?? input.scheduled_at ?? "").trim() || null)
      : (trimmedTextOrNull(current.scheduled_at) ?? null);
    const rawVideoUrl = String(input.videoUrl ?? input.video_url ?? "").trim();
    let videoUrl = trimmedTextOrNull(current.video_url);
    if (hasVideoUrl) {
      if (!rawVideoUrl) {
        videoUrl = null;
      } else {
        let parsedVideoUrl: URL;
        try {
          parsedVideoUrl = new URL(rawVideoUrl);
        } catch {
          throw new Error("Το URL του βίντεο δεν είναι έγκυρο.");
        }
        if (!["http:", "https:"].includes(parsedVideoUrl.protocol)) {
          throw new Error("Το URL του βίντεο πρέπει να είναι http ή https.");
        }
        videoUrl = rawVideoUrl;
      }
    }

    await db.prepare(`UPDATE league_games SET
      scheduled_at=?, scheduled_date=?, scheduled_time=?, venue=?, video_url=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(scheduledAt, scheduledDate, scheduledTime, venue, videoUrl, id).run();

    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
      createEntityId("audit"), actor, "update", resource, id,
      JSON.stringify({ before: current, after: { scheduledAt, scheduledDate, scheduledTime, venue, videoUrl } }), new Date().toISOString(),
    ).run();
    return { id };
  }

  if (resource === "teams") {
    const current = await db.prepare("SELECT * FROM league_teams WHERE id=?")
      .bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε η ομάδα.");

    const team = teamInput(input, current);
    const duplicate = await db.prepare(
      "SELECT id FROM league_teams WHERE organization_id=? AND (slug=? OR LOWER(TRIM(name))=LOWER(TRIM(?))) AND id<>?",
    ).bind(String(current.organization_id ?? ""), team.slug, team.name, id).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη άλλη ομάδα με αυτή την ονομασία.");

    await db.prepare(`UPDATE league_teams SET
      name=?, slug=?, city=?, logo_url=?, active=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(
        team.name,
        team.slug,
        team.city,
        team.logoUrl,
        team.active ? 1 : 0,
        id,
      ).run();

    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
        createEntityId("audit"), actor, "update", resource, id,
        JSON.stringify({ before: current, after: team }), new Date().toISOString(),
      ).run();
    return { id };
  }

  if (resource === "participations") {
    const current = await db.prepare(`SELECT ct.*, st.season_id, st.team_id,
      st.display_name, st.logo_url
      FROM league_competition_teams ct
      JOIN league_season_teams st ON st.id=ct.season_team_id
      WHERE ct.id=?`).bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε η συμμετοχή της ομάδας.");

    const status = participationStatus(input.status, String(current.status ?? "active"));
    const seed = optionalInteger(input.seed ?? current.seed, "Seed", 1);
    const displayName = String(input.displayName ?? current.display_name ?? "").trim();
    if (!displayName) throw new Error("Η ονομασία της ομάδας στη σεζόν είναι υποχρεωτική.");
    const logoUrl = String(input.logoUrl ?? current.logo_url ?? "").trim() || null;

    await db.prepare(`UPDATE league_season_teams
      SET display_name=?, logo_url=? WHERE id=?`)
      .bind(displayName, logoUrl, String(current.season_team_id)).run();
    await db.prepare(`UPDATE league_competition_teams
      SET seed=?, status=? WHERE id=?`)
      .bind(seed, status, id).run();

    const after = { seed, status, displayName, logoUrl };
    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
        createEntityId("audit"), actor, "update", resource, id,
        JSON.stringify({ before: current, after }), new Date().toISOString(),
      ).run();
    return { id };
  }

  if (resource === "competitions") {
    const current = await db.prepare(`SELECT c.*, cp.lifecycle_status,
      cf.expected_team_count, cf.regular_season_meetings, cf.win_points,
      cf.loss_points, cf.forfeit_points, cf.tiebreakers_json,
      cf.settings_json AS format_settings_json
      FROM league_competitions c
      LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
      LEFT JOIN league_competition_formats cf ON cf.competition_id=c.id
      WHERE c.id=?`).bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε η διοργάνωση.");
    const competition = await competitionInput(db, input, current);
    const activeParticipationCount = await db.prepare(
      "SELECT COUNT(*) AS count FROM league_competition_teams WHERE competition_id=? AND status='active'",
    ).bind(id).first<{ count: number }>();
    const currentActiveParticipationCount = Number(activeParticipationCount?.count ?? 0);
    if (competition.expectedTeamCount !== null && currentActiveParticipationCount > competition.expectedTeamCount) {
      throw new Error(`Δεν μπορείτε να ορίσετε ${competition.expectedTeamCount} αναμενόμενες ομάδες, επειδή η διοργάνωση έχει ήδη ${currentActiveParticipationCount} συμμετοχές.`);
    }
    const duplicate = await db.prepare(
      "SELECT id FROM league_competitions WHERE organization_id=? AND season_id=? AND slug=? AND id<>?",
    ).bind(String(current.organization_id ?? ""), competition.seasonId, competition.slug, id).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη άλλη διοργάνωση με αυτή την ονομασία στη συγκεκριμένη σεζόν.");
    await db.prepare(`UPDATE league_competitions SET
      season_id=?, name=?, slug=?, type=?, description=?, custom_type_label=?, logo_url=?, status=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(
        competition.seasonId,
        competition.name,
        competition.slug,
        competition.type,
        competition.description,
        competition.customTypeLabel,
        competition.logoUrl,
        competition.legacyStatus,
        id,
      ).run();
    await saveCompetitionDetails(db, id, competition);
    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
        createEntityId("audit"), actor, "update", resource, id,
        JSON.stringify({ before: current, after: competition }), new Date().toISOString(),
      ).run();
    return { id };
  }

  if (resource === "phases") {
    const current = await db.prepare(`SELECT p.*, p.lifecycle_status, p.finalized_at, pr.phase_kind, pr.bracket_size,
      pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      WHERE p.id=?`).bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε η φάση.");
    if (String(current.lifecycle_status ?? "active") === "finalized") {
      throw new Error("Η οριστικοποιημένη φάση δεν μπορεί να τροποποιηθεί.");
    }
    if (String(current.lifecycle_status ?? "active") === "finalized") {
      throw new Error("Η οριστικοποιημένη φάση δεν μπορεί να τροποποιηθεί.");
    }
    const phase = await phaseInput(db, input, current);
    const standingsPresentation = parseStandingsPresentation(input);
    const generatedSchedule = await db.prepare(
      "SELECT id FROM league_phase_schedules WHERE phase_id=? LIMIT 1",
    ).bind(id).first<{ id: string }>();
    if (generatedSchedule) {
      const generatedGames = await db.prepare(
        "SELECT COUNT(*) AS count FROM league_games WHERE schedule_id=?",
      ).bind(generatedSchedule.id).first<{ count: number }>();
      if (Number(generatedGames?.count ?? 0) > 0) {
        const currentFormat = normalizeCanonicalFormat(String(current.format ?? ""), String(current.phase_kind ?? ""));
        const nextFormat = normalizeCanonicalFormat(phase.phaseFormat, phase.legacyPhaseType);
        const currentRules = JSON.stringify(parsePhaseRuleJson(current.rule_settings_json));
        if (currentFormat !== nextFormat || currentRules !== phase.settingsJson) {
          throw new Error("Η δομή της φάσης δεν μπορεί να αλλάξει επειδή έχουν ήδη δημιουργηθεί αγώνες.");
        }
      }
    }
    const duplicate = await db.prepare(
      "SELECT id FROM league_phases WHERE competition_id=? AND slug=? AND id<>?",
    ).bind(phase.competitionId, phase.slug, id).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη άλλη φάση με αυτή την ονομασία στη διοργάνωση.");
    await db.prepare(`UPDATE league_phases SET competition_id=?, name=?, slug=?,
      phase_type=?, format=?, order_index=?, phase_order=?, previous_phase_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(
        phase.competitionId,
        phase.name,
        phase.slug,
        phase.legacyPhaseType,
        phase.phaseFormat,
        phase.orderIndex,
        phase.orderIndex,
        phase.previousPhaseId,
        id,
      ).run();
    await savePhaseRules(db, id, phase);
    await savePhaseStandingsPresentation(db, id, standingsPresentation);
    await normalizeCompetitionPhaseOrder(db, phase.competitionId);
    await db.prepare("UPDATE league_phase_schedules SET competition_id=?, updated_at=CURRENT_TIMESTAMP WHERE phase_id=?")
      .bind(phase.competitionId, id).run();
    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
      createEntityId("audit"), actor, "update", resource, id,
        JSON.stringify({ before: current, after: phase }), new Date().toISOString(),
      ).run();
    return { id };
  }

  throw new Error("Μη υποστηριζόμενη ενέργεια επεξεργασίας.");
}

async function addRosterMembership(db: D1DatabaseBinding, id: string, input: Record<string, unknown>) {
  const seasonId = String(input.seasonId);
  const playerId = String(input.playerId);
  const teamId = String(input.teamId);
  const current = await db.prepare(`SELECT id,team_id FROM league_roster_memberships WHERE season_id=? AND player_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`)
    .bind(seasonId, playerId).first<{ id: string; team_id: string }>();
  if (current && current.team_id !== teamId) {
    const date = String(input.joinedOn || new Date().toISOString().slice(0, 10));
    await db.prepare(`UPDATE league_roster_memberships SET status='transferred',left_on=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(date, current.id).run();
    await db.prepare(`INSERT INTO league_player_movements (id,player_id,season_id,from_team_id,to_team_id,movement_type,effective_on,note) VALUES (?,?,?,?,?,'transfer',?,?)`)
      .bind(createEntityId("movement"), playerId, seasonId, current.team_id, teamId, date, input.note || "").run();
  }
  await db.prepare(`INSERT INTO league_roster_memberships (id,season_id,competition_id,player_id,team_id,shirt_number,joined_on,status) VALUES (?,?,?,?,?,?,?,'active')`)
    .bind(id, seasonId, input.competitionId || null, playerId, teamId, input.shirtNumber ?? null, input.joinedOn || null).run();
  if (!current) {
    await db.prepare(`INSERT INTO league_player_movements (id,player_id,season_id,from_team_id,to_team_id,movement_type,effective_on,note) VALUES (?,?,?,?,?,'registration',?,?)`)
      .bind(createEntityId("movement"), playerId, seasonId, null, teamId, input.joinedOn || new Date().toISOString().slice(0, 10), input.note || "").run();
  }
}

async function getCurrentActiveRosterMembership(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
  playerId: string,
) {
  return db.prepare(`SELECT id, team_id, shirt_number
    FROM league_roster_memberships
    WHERE season_id=? AND competition_id=? AND player_id=? AND status='active'
    ORDER BY created_at DESC
    LIMIT 1`)
    .bind(seasonId, competitionId, playerId).first<{ id: string; team_id: string; shirt_number: number | null }>();
}

async function getInactiveRosterMembershipForTeam(
  db: D1DatabaseBinding,
  seasonId: string,
  competitionId: string,
  playerId: string,
  teamId: string,
) {
  return db.prepare(`SELECT id, shirt_number, status
    FROM league_roster_memberships
    WHERE season_id=? AND competition_id=? AND player_id=? AND team_id=? AND status<> 'active'
    ORDER BY created_at DESC
    LIMIT 1`)
    .bind(seasonId, competitionId, playerId, teamId).first<{ id: string; shirt_number: number | null; status: string }>();
}

export async function transferAthleteBetweenTeams(input: {
  playerId: string;
  seasonId: string;
  competitionId: string;
  fromTeamId: string;
  toTeamId: string;
  shirtNumber?: number | null;
  effectiveOn?: string | null;
  note?: string | null;
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const playerId = String(input.playerId ?? "").trim();
  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const fromTeamId = String(input.fromTeamId ?? "").trim();
  const toTeamId = String(input.toTeamId ?? "").trim();
  if (!playerId || !seasonId || !competitionId || !fromTeamId || !toTeamId) {
    throw new Error("Λείπουν υποχρεωτικά πεδία.");
  }
  if (fromTeamId === toTeamId) {
    throw new Error("Η ομάδα προέλευσης και η ομάδα προορισμού δεν μπορούν να είναι ίδιες.");
  }

  const date = String(input.effectiveOn || new Date().toISOString().slice(0, 10));

  const player = await db.prepare(`SELECT id FROM league_players WHERE id=?`).bind(playerId).first<{ id: string }>();
  if (!player) throw new Error("Δεν βρέθηκε ο αθλητής.");

  await assertRosterTargetWritable(db, seasonId, competitionId);

  const competitionTeams = await rows<{ team_id: string }>(
    db,
    `SELECT st.team_id
     FROM league_competition_teams ct
     INNER JOIN league_season_teams st ON st.id = ct.season_team_id
     WHERE ct.competition_id=? AND st.team_id IN (?, ?)`,
    [competitionId, fromTeamId, toTeamId],
  );
  const competitionTeamSet = new Set(competitionTeams.map((row) => String(row.team_id ?? "")));
  if (!competitionTeamSet.has(fromTeamId) || !competitionTeamSet.has(toTeamId)) {
    throw new Error("Η ομάδα προέλευσης ή η ομάδα προορισμού δεν είναι έγκυρη για τη συγκεκριμένη διοργάνωση.");
  }

  const currentActive = await getCurrentActiveRosterMembership(db, seasonId, competitionId, playerId);
  if (!currentActive) {
    throw new Error("Ο αθλητής δεν έχει ενεργό ρόστερ για μεταγραφή στη συγκεκριμένη διοργάνωση.");
  }
  if (String(currentActive.team_id ?? "") !== fromTeamId) {
    throw new Error("Ο αθλητής δεν ανήκει στην ομάδα προέλευσης.");
  }

  const destinationActive = await db.prepare(
    `SELECT id, team_id FROM league_roster_memberships WHERE season_id=? AND competition_id=? AND player_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`,
  ).bind(seasonId, competitionId, playerId).first<{ id: string; team_id: string }>();
  if (destinationActive && String(destinationActive.team_id ?? "") !== fromTeamId) {
    throw new Error("Ο αθλητής ανήκει ήδη σε άλλη ενεργή ομάδα στη συγκεκριμένη διοργάνωση.");
  }

  const destinationHistorical = await getInactiveRosterMembershipForTeam(db, seasonId, competitionId, playerId, toTeamId);
  const movementId = createEntityId("movement");
  const destinationRosterId = destinationHistorical?.id ?? createEntityId("roster");

  const batchStatements = [
    db.prepare(`UPDATE league_roster_memberships
      SET status='transferred', left_on=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(date, currentActive.id),
    destinationHistorical
      ? db.prepare(`UPDATE league_roster_memberships
          SET status='active', joined_on=COALESCE(joined_on, ?), left_on=NULL, shirt_number=COALESCE(?, shirt_number), updated_at=CURRENT_TIMESTAMP
          WHERE id=?`)
          .bind(date, input.shirtNumber ?? null, destinationHistorical.id)
      : db.prepare(`INSERT INTO league_roster_memberships
          (id, season_id, competition_id, player_id, team_id, shirt_number, joined_on, left_on, status, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,NULL,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
          .bind(destinationRosterId, seasonId, competitionId, playerId, toTeamId, input.shirtNumber ?? null, date),
    db.prepare(`INSERT INTO league_player_movements
      (id, player_id, season_id, from_team_id, to_team_id, movement_type, effective_on, note)
      VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?)`)
      .bind(movementId, playerId, seasonId, fromTeamId, toTeamId, date, input.note || ""),
  ];

  await db.batch(batchStatements);

  return {
    success: true,
    playerId,
    fromTeamId,
    toTeamId,
    destinationMembershipId: destinationRosterId,
    movementId,
  };
}

export async function departPlayer(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const date = String(input.effectiveOn || new Date().toISOString().slice(0, 10));
  const roster = await db.prepare(`SELECT * FROM league_roster_memberships WHERE id=?`).bind(input.rosterId).first<{ id:string; player_id:string; season_id:string; team_id:string }>();
  if (!roster) throw new Error("Δεν βρέθηκε η εγγραφή ρόστερ.");
  await db.prepare(`UPDATE league_roster_memberships SET status='departed',left_on=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(date, roster.id).run();
  await db.prepare(`INSERT INTO league_player_movements (id,player_id,season_id,from_team_id,to_team_id,movement_type,effective_on,note) VALUES (?,?,?,?,?,'departure',?,?)`)
    .bind(createEntityId("movement"), roster.player_id, roster.season_id, roster.team_id, null, date, input.note || "").run();
  await db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?,?)`)
    .bind(createEntityId("audit"), actor, "departure", "rosters", roster.id, JSON.stringify(input)).run();
  return { id: roster.id };
}
