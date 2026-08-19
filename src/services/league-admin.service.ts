import "server-only";

import { players as legacyPlayers } from "@/data/players";
import { teams as legacyTeams } from "@/data/teams";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { calculateStandings } from "@/lib/standings-calculator";
import {
  createEntityId,
  findAutomaticPlayerMatch,
  normalizePlayerName,
} from "@/lib/player-matching";
import { generateRoundRobinDryRun } from "@/services/round-robin-generator";
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
  if (currentFormat !== "standings") {
    throw new Error("Προς το παρόν μπορούν να οριστικοποιηθούν μόνο βαθμολογικές φάσεις.");
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

export async function getLeagueAdminSnapshot() {
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
      participations: [], rosters: [], movements: [], phases: [], games: [],
      counts: {
        seasons: HISTORICAL_SEASONS.length,
        competitions: HISTORICAL_SEASONS.length,
        teams: legacyTeams.length,
        players: legacyPlayers.length,
      },
    };
  }

  const [seasons, competitions, teams, participations, players, rosters, movements, rawPhases, phaseSchedules, games, competitionVenues] = await Promise.all([
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
      ORDER BY s.name DESC, c.name`),
    rows(db, "SELECT * FROM league_teams ORDER BY name"),
    rows(db, `SELECT ct.id, ct.competition_id, ct.season_team_id, ct.seed, ct.status,
      st.season_id, st.team_id, st.display_name, st.logo_url,
      s.name AS season_name, t.name AS team_name, c.name AS competition_name
      FROM league_competition_teams ct
      JOIN league_season_teams st ON st.id=ct.season_team_id
      JOIN league_seasons s ON s.id=st.season_id
      JOIN league_teams t ON t.id=st.team_id
      JOIN league_competitions c ON c.id=ct.competition_id
      ORDER BY s.name DESC, c.name, st.display_name`),
    rows(db, "SELECT * FROM league_players ORDER BY display_name LIMIT 1000"),
    rows(db, `SELECT r.*, p.display_name AS player_name, t.name AS team_name, s.name AS season_name FROM league_roster_memberships r JOIN league_players p ON p.id=r.player_id JOIN league_teams t ON t.id=r.team_id JOIN league_seasons s ON s.id=r.season_id ORDER BY s.name DESC, t.name, p.display_name LIMIT 2000`),
    rows(db, `SELECT m.*, p.display_name AS player_name, ft.name AS from_team_name, tt.name AS to_team_name FROM league_player_movements m JOIN league_players p ON p.id=m.player_id LEFT JOIN league_teams ft ON ft.id=m.from_team_id LEFT JOIN league_teams tt ON tt.id=m.to_team_id ORDER BY m.effective_on DESC LIMIT 500`),
    rows(db, `SELECT p.*, c.name AS competition_name, s.name AS season_name,
      p.lifecycle_status, p.finalized_at,
      COALESCE(pr.phase_kind, CASE WHEN p.phase_type='regular' THEN 'regular_season' ELSE p.phase_type END) AS phase_kind,
      COALESCE(p.phase_order, p.order_index) AS phase_order,
      p.previous_phase_id,
      pr.bracket_size, pr.best_of, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, source_phase.name AS carry_over_source_name,
      pr.settings_json AS rule_settings_json
      FROM league_phases p
      JOIN league_competitions c ON c.id=p.competition_id
      JOIN league_seasons s ON s.id=c.season_id
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      LEFT JOIN league_phases source_phase ON source_phase.id=pr.carry_over_source_phase_id
      ORDER BY s.name DESC, c.name, COALESCE(p.phase_order, p.order_index), p.id`),
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
      ORDER BY c.name, COALESCE(p.phase_order, p.order_index), p.id`),
    rows(db, `SELECT g.*, ht.name AS home_team_name, at.name AS away_team_name, p.name AS phase_name FROM league_games g JOIN league_teams ht ON ht.id=g.home_team_id JOIN league_teams at ON at.id=g.away_team_id LEFT JOIN league_phases p ON p.id=g.phase_id ORDER BY COALESCE(g.scheduled_at,'9999') DESC LIMIT 1000`),
    rows(db, `SELECT v.*, c.name AS competition_name, s.name AS season_name
      FROM league_competition_venues v
      JOIN league_competitions c ON c.id=v.competition_id
      JOIN league_seasons s ON s.id=c.season_id
      ORDER BY c.name, COALESCE(v.sort_order, 0), v.name`),
  ]);
  const phases = rawPhases.map((phase) => ({
    ...phase,
    format: normalizeCanonicalFormat(String(phase.format ?? ""), String(phase.phase_kind ?? "")),
  }));

  return {
    mode: "database" as const, seasons, competitions, teams, participations, players, rosters,
    movements, phases, phaseSchedules, games, competitionVenues,
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

export async function getPreviousRosterLookup(
  seasonId: string,
  competitionId: string,
  teamId: string,
) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");

  const target = await loadSeasonSortInfo(db, seasonId);
  if (!target) throw new Error("Δεν βρέθηκε η επιλεγμένη σεζόν.");

  const targetAthleteCount = await db.prepare(
    `SELECT COUNT(*) AS count FROM league_roster_memberships
     WHERE season_id=? AND competition_id=? AND team_id=? AND status='active'`,
  ).bind(seasonId, competitionId, teamId).first<{ count: number }>();

  const targetStaffCount = await db.prepare(
    `SELECT COUNT(*) AS count FROM league_staff_memberships
     WHERE season_id=? AND competition_id=? AND team_id=?`,
  ).bind(seasonId, competitionId, teamId).first<{ count: number }>();

  const candidateSeasons = await rows<{
    id: string;
    name: string | null;
    starts_on: string | null;
  }>(
    db,
    `SELECT DISTINCT s.id, s.name, s.starts_on
     FROM league_seasons s
     JOIN league_competitions c ON c.season_id=s.id
     JOIN league_competition_teams ct ON ct.competition_id=c.id
     JOIN league_season_teams st ON st.id=ct.season_team_id
     WHERE c.id=?
       AND st.team_id=?
       AND c.status IS NOT NULL`,
    [competitionId, teamId],
  );

  const targetSort = target;
  const previousCandidate = candidateSeasons
    .map((season) => ({ ...seasonSortInfo({ name: season.name, starts_on: season.starts_on }), id: season.id }))
    .filter((info) => isEarlierSeason(info, targetSort))
    .sort((left, right) => normalizeLookupOrder(left, right))
    .at(-1);

  const previousSeasonId = previousCandidate?.id ?? null;

  let previousAthleteCount = 0;
  let previousStaffCount = 0;
  if (previousSeasonId) {
    const previousAthletes = await db.prepare(
      `SELECT COUNT(*) AS count FROM league_roster_memberships
       WHERE season_id=? AND competition_id=? AND team_id=? AND status='active'`,
    ).bind(previousSeasonId, competitionId, teamId).first<{ count: number }>();
    previousAthleteCount = previousAthletes?.count ?? 0;

    const previousStaff = await db.prepare(
      `SELECT COUNT(*) AS count FROM league_staff_memberships
       WHERE season_id=? AND competition_id=? AND team_id=?`,
    ).bind(previousSeasonId, competitionId, teamId).first<{ count: number }>();
    previousStaffCount = previousStaff?.count ?? 0;
  }

  const previousSeasonInfo = previousSeasonId ? await loadSeasonSortInfo(db, previousSeasonId) : null;
  const previousSeasonName = previousSeasonInfo ? previousSeasonInfo.raw : null;

  return {
    seasonId: previousSeasonId,
    seasonName: previousSeasonName,
    targetAthleteRosterExists: (targetAthleteCount?.count ?? 0) > 0,
    targetAthleteCount: Number(targetAthleteCount?.count ?? 0),
    targetStaffRosterExists: (targetStaffCount?.count ?? 0) > 0,
    targetStaffCount: Number(targetStaffCount?.count ?? 0),
    previousAthleteCount,
    previousStaffCount,
  } satisfies PreviousRosterInfo;
}

export async function getTeamRosterManagementView(
  seasonId: string,
  competitionId: string,
  teamId: string,
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
      AND ct.status IS NOT NULL
  `).bind(seasonId, competitionId, teamId).first<{
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
    WHERE r.season_id=? AND r.competition_id=? AND r.team_id=? AND r.status='active'
    ORDER BY COALESCE(p.last_name, p.display_name, ""), COALESCE(p.first_name, p.display_name, "")
  `, [seasonId, competitionId, teamId]);

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
    WHERE sm.season_id=? AND sm.competition_id=? AND sm.team_id=?
    ORDER BY COALESCE(s.last_name, s.display_name, ""), COALESCE(s.first_name, s.display_name, "")
  `, [seasonId, competitionId, teamId]);

  const previousRoster = await getPreviousRosterLookup(seasonId, competitionId, teamId);

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
) {
  const lookup = await getPreviousRosterLookup(seasonId, competitionId, teamId);
  if (!lookup.seasonId) return { copiedAthletes: 0, copiedStaff: 0 };

  const previousSeasonId = lookup.seasonId;

  let copiedAthletes = 0;
  const previousAthletes = await rows<{ player_id: string; shirt_number: number | null }>(
    db,
    `SELECT player_id, MAX(shirt_number) AS shirt_number
     FROM league_roster_memberships
     WHERE season_id=? AND team_id=? AND competition_id=? AND status='active'
     GROUP BY player_id`,
    [previousSeasonId, teamId, competitionId],
  );

  for (const player of previousAthletes) {
    const existing = await db.prepare(`SELECT id
      FROM league_roster_memberships
      WHERE season_id=? AND competition_id=? AND team_id=? AND player_id=? AND status='active'
      LIMIT 1`)
      .bind(seasonId, competitionId, teamId, player.player_id)
      .first<{ id: string }>();
    if (existing) continue;

    await db.prepare(`INSERT INTO league_roster_memberships
      (id,season_id,competition_id,player_id,team_id,shirt_number,joined_on,left_on,status)
      VALUES (?,?,?,?,?,?,NULL,NULL,'active')`)
      .bind(
        createEntityId("roster"),
        seasonId,
        competitionId,
        player.player_id,
        teamId,
        player.shirt_number,
      ).run();
    copiedAthletes += 1;
  }

  let copiedStaff = 0;
  if (includeStaff) {
    const previousStaff = await rows<{
      staff_id: string;
      role: string;
      custom_role_label: string | null;
    }>(
      db,
      `SELECT staff_id, role, custom_role_label
       FROM league_staff_memberships
       WHERE season_id=? AND competition_id=? AND team_id=?`,
      [previousSeasonId, competitionId, teamId],
    );

    for (const staff of previousStaff) {
      const existing = await db.prepare(`SELECT id
        FROM league_staff_memberships
        WHERE season_id=? AND competition_id=? AND team_id=? AND staff_id=?`
      ).bind(seasonId, competitionId, teamId, staff.staff_id).first<{ id: string }>();
      if (existing) continue;

      await db.prepare(`INSERT INTO league_staff_memberships
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
        ).run();
      copiedStaff += 1;
    }
  }

  return { copiedAthletes, copiedStaff };
}

export async function searchAthletesForRosterFoundation(input: SearchRequestInput) {
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
        WHERE r.player_id = p.id AND r.status='active'
        ORDER BY r.created_at DESC
        LIMIT 1
      ) AS last_team_name,
      (
        SELECT s.name
        FROM league_roster_memberships r
        JOIN league_seasons s ON s.id = r.season_id
        WHERE r.player_id = p.id AND r.status='active'
        ORDER BY r.created_at DESC
        LIMIT 1
      ) AS last_season_name
    FROM league_players p
    WHERE p.normalized_name LIKE ?
       OR lower(p.display_name) LIKE lower(?)
       OR (p.first_name IS NOT NULL AND lower(p.first_name) LIKE lower(?))
       OR (p.last_name IS NOT NULL AND lower(p.last_name) LIKE lower(?))
    ORDER BY p.display_name ASC
    LIMIT ?`,
    [wildcard, `%${query}%`, wildcard, wildcard, limit],
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
    ORDER BY
      CASE
        WHEN CAST(substr(season.name, 1, 4) AS INTEGER) IS NOT NULL
          THEN CAST(substr(season.name, 1, 4) AS INTEGER)
        ELSE -1
      END DESC,
      season.name DESC,
      team.name ASC`,
    [...ids],
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

export async function searchStaffForRosterFoundation(input: SearchRequestInput) {
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
        WHERE m.staff_id=s.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_team_name,
      (
        SELECT se.name
        FROM league_staff_memberships m
        JOIN league_seasons se ON se.id=m.season_id
        WHERE m.staff_id=s.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_season_name
    FROM league_staff s
    WHERE s.normalized_name LIKE ?
       OR lower(s.display_name) LIKE lower(?)
    ORDER BY s.display_name ASC
    LIMIT ?`,
    [wildcard, `%${String(query)}%`, limit],
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
    (id, first_name, last_name, display_name, normalized_name, birth_date, photo_url, active, slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .bind(id, firstName, lastName, displayName, normalizedName, birthDate, photoUrl, slug)
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

  await db.prepare(`INSERT INTO league_staff
    (id, first_name, last_name, display_name, normalized_name, birth_date, photo_url, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, firstName, lastName, displayName, normalizedName, birthDate, photoUrl, active)
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
}) {
  const staff = await createStaffInFoundation({
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate: input.birthDate ?? null,
    photoUrl: input.photoUrl ?? null,
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
}) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const seasonId = String(input.seasonId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const teamId = String(input.teamId ?? "").trim();
  if (!seasonId || !competitionId || !teamId) throw new Error("Λείπουν στοιχεία στοχευμένου ρόστερ.");
  await assertRosterTargetWritable(db, seasonId, competitionId);

  return copyPreviousRoster(db, seasonId, competitionId, teamId, true);
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

export async function createLeagueEntity(resource: string, input: Record<string, unknown>, actor: string) {
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
    const competition = await competitionInput(db, input);
    const duplicate = await db.prepare(
      "SELECT id FROM league_competitions WHERE season_id=? AND slug=?",
    ).bind(competition.seasonId, competition.slug).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη διοργάνωση με αυτή την ονομασία στη συγκεκριμένη σεζόν.");
    await db.prepare(`INSERT INTO league_competitions
      (id,season_id,name,slug,type,description,status,custom_type_label,logo_url)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
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
    const team = teamInput(input);
    const duplicate = await db.prepare(
      "SELECT id FROM league_teams WHERE slug=? OR LOWER(TRIM(name))=LOWER(TRIM(?))",
    ).bind(team.slug, team.name).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη ομάδα με αυτή την ονομασία.");
    await db.prepare(`INSERT INTO league_teams (id,name,slug,city,logo_url,active) VALUES (?,?,?,?,?,?)`)
      .bind(id, team.name, team.slug, team.city, team.logoUrl, team.active ? 1 : 0).run();
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
    const name = String(input.displayName ?? "").trim();
    const existing = await rows<{ id: string; display_name: string }>(db, "SELECT id,display_name FROM league_players");
    const match = findAutomaticPlayerMatch(name, existing.map((row) => ({ id: row.id, displayName: row.display_name })));
    if (match) {
      await db.prepare(`INSERT OR IGNORE INTO league_player_aliases (id,player_id,alias,normalized_alias,source,confidence) VALUES (?,?,?,?,?,?)`)
        .bind(createEntityId("alias"), match.candidate.id, name, normalizePlayerName(name), "automatic", match.confidence).run();
      return { id: match.candidate.id, automaticallyMatched: true };
    }
    await db.prepare(`INSERT INTO league_players (id,slug,display_name,normalized_name,active) VALUES (?,?,?,?,1)`)
      .bind(id, String(input.slug || slugify(name)), name, normalizePlayerName(name)).run();
  } else if (resource === "rosters") {
    await addRosterMembership(db, id, input);
  } else if (resource === "phases") {
    const phase = await phaseInput(db, input);
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
    await normalizeCompetitionPhaseOrder(db, phase.competitionId);
  } else if (resource === "phase-schedules") {
    const competitionId = String(input.competitionId ?? "").trim();
    const phaseId = String(input.phaseId ?? input.phase_id ?? "").trim();
    if (!competitionId || !phaseId) {
      throw new Error("Η φάση και η διοργάνωση είναι υποχρεωτικές.");
    }
    const phaseExists = await db.prepare(`
      SELECT p.id
      FROM league_phases p
      WHERE p.id=? AND p.competition_id=?
    `).bind(phaseId, competitionId).first<{ id: string }>();
    if (!phaseExists) throw new Error("Δεν βρέθηκε η επιλεγμένη φάση.");
    const duplicate = await db.prepare(
      "SELECT id FROM league_phase_schedules WHERE phase_id=?",
    ).bind(phaseId).first<{ id: string }>();
    if (duplicate) throw new Error("Υπάρχει ήδη πρόγραμμα για αυτή τη φάση.");
    await db.prepare(`INSERT INTO league_phase_schedules
      (id, competition_id, phase_id, lifecycle_status)
      VALUES (?,?,?,'draft')`)
      .bind(id, competitionId, phaseId).run();
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

export async function generateRoundRobinGamesForSchedule(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η δημιουργία αγώνων είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");

  const scheduleId = String(input.scheduleId ?? input.id ?? "").trim();
  if (!scheduleId) throw new Error("Δεν επιλέχθηκε πρόγραμμα για δημιουργία αγώνων.");

  const schedule = await db.prepare(`
    SELECT
      ps.id,
      ps.competition_id,
      ps.phase_id,
      ps.lifecycle_status,
      ps.published_at,
      p.name AS phase_name,
      p.format AS phase_format,
      p.phase_type,
      pr.settings_json AS phase_rule_settings_json,
      pr.settings_json AS canonical_rule_settings_json
    FROM league_phase_schedules ps
    JOIN league_phases p ON p.id=ps.phase_id
    LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE ps.id=?
  `).bind(scheduleId).first<DbRow>();
  if (!schedule) throw new Error("Δεν βρέθηκε το πρόγραμμα.");
  if (String(schedule.lifecycle_status ?? "draft") !== "draft") {
    throw new Error("Δεν μπορείτε να δημιουργήσετε αγώνες σε δημοσιευμένο πρόγραμμα.");
  }

  const existingGames = await db.prepare("SELECT COUNT(*) AS count FROM league_games WHERE schedule_id=?")
    .bind(scheduleId).first<{ count: number }>();
  if (Number(existingGames?.count ?? 0) > 0) {
    throw new Error("Οι αγώνες για αυτή τη φάση έχουν ήδη δημιουργηθεί.");
  }

  const phaseFormat = String(schedule.phase_format ?? schedule.phase_type ?? "").trim().toLowerCase();
  if (phaseFormat !== "standings") {
    throw new Error("Η δημιουργία αγώνων υποστηρίζεται μόνο για βαθμολογικές φάσεις.");
  }

  const phaseRules = parseJsonRecord(schedule.canonical_rule_settings_json ?? schedule.phase_rule_settings_json ?? schedule.rule_settings_json);
  const gamesPerPairing = parseStandingsRuleInt(phaseRules.gamesPerPairing, 1, "Αγώνες ανά ζευγάρι", 1);

  const competitionParticipants = await rows<{ team_id: string; team_name: string }>(
    db,
    `SELECT st.team_id, COALESCE(st.display_name, t.name) AS team_name
     FROM league_competition_teams ct
     INNER JOIN league_season_teams st ON st.id=ct.season_team_id
     INNER JOIN league_teams t ON t.id=st.team_id
     WHERE ct.competition_id=? AND ct.status='active'
     ORDER BY COALESCE(ct.seed, 999), LOWER(TRIM(COALESCE(st.display_name, t.name))), st.id`,
    [String(schedule.competition_id ?? "")],
  );

  const dryRun = generateRoundRobinDryRun({
    competitionId: String(schedule.competition_id ?? ""),
    phaseId: String(schedule.phase_id ?? ""),
    scheduleId,
    gamesPerPairing,
    teams: competitionParticipants.map((team) => ({
      id: String(team.team_id ?? ""),
      name: String(team.team_name ?? "—"),
    })),
  });

  if (!dryRun.ok) {
    throw new Error(dryRun.errors.join(" "));
  }

  if (!dryRun.games.length) {
    throw new Error("Δεν προέκυψαν αγώνες για δημιουργία.");
  }

  const gameInserts = dryRun.games.map((game) => db.prepare(`INSERT INTO league_games
      (id,competition_id,phase_id,schedule_id,cycle_number,round_number,game_order,round_label,scheduled_at,venue,home_team_id,away_team_id,home_score,away_score,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      createEntityId("game"),
      game.competition_id,
      game.phase_id,
      game.schedule_id,
      game.cycle_number,
      game.round_number,
      game.game_order,
      game.round_label,
      null,
      "",
      game.home_team_id,
      game.away_team_id,
      null,
      null,
      game.status,
    ));

  const auditId = createEntityId("audit");
  await db.batch([
    ...gameInserts,
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(
        auditId,
        actor,
        "create",
        "league_games",
        scheduleId,
        JSON.stringify({
          scheduleId,
          phaseId: String(schedule.phase_id ?? ""),
          competitionId: String(schedule.competition_id ?? ""),
          games: dryRun.games.length,
          rounds: dryRun.input.cycles * dryRun.input.roundsPerCycle,
        }),
      ),
  ]);

  const createdCount = await db.prepare("SELECT COUNT(*) AS count FROM league_games WHERE schedule_id=?")
    .bind(scheduleId).first<{ count: number }>();
  if (Number(createdCount?.count ?? 0) !== dryRun.games.length) {
    throw new Error("Η δημιουργία αγώνων δεν ολοκληρώθηκε σωστά.");
  }

  return {
    scheduleId,
    competitionId: String(schedule.competition_id ?? ""),
    phaseId: String(schedule.phase_id ?? ""),
    gamesCreated: dryRun.games.length,
    roundsCreated: dryRun.input.cycles * dryRun.input.roundsPerCycle,
  };
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
    const current = await db.prepare("SELECT * FROM league_games WHERE id=?")
      .bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε ο αγώνας.");

    if (String(input.action ?? input.updateAction ?? "") === "manual-result") {
      const competitionId = String(input.competitionId ?? input.competition_id ?? "").trim();
      if (!competitionId) throw new Error("Λείπει η διοργάνωση του αγώνα.");
      if (String(current.competition_id ?? "") !== competitionId) {
        throw new Error("Ο αγώνας δεν ανήκει σε αυτή τη διοργάνωση.");
      }
      const currentResultSource = String(current.result_source ?? "").trim();
      if (["match_report", "award"].includes(currentResultSource)) {
        throw new Error("Το αποτέλεσμα αυτού του αγώνα έχει ήδη δοθεί από Match Report ή κατακύρωση και δεν μπορεί να αντικατασταθεί ακόμη.");
      }

      const homeScore = parseNonNegativeInteger(input.homeScore ?? input.home_score, "Σκορ γηπεδούχου");
      const awayScore = parseNonNegativeInteger(input.awayScore ?? input.away_score, "Σκορ φιλοξενούμενου");
      if (homeScore === awayScore) {
        throw new Error("Το τελικό αποτέλεσμα δεν μπορεί να είναι ισόπαλο.");
      }

      await db.prepare(`UPDATE league_games SET
        home_score=?, away_score=?, status='completed', result_source='manual', updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND competition_id=?`)
        .bind(homeScore, awayScore, id, competitionId).run();

      await db.prepare(`INSERT INTO league_audit_log
        (id,actor_email,action,entity_type,entity_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`).bind(
        createEntityId("audit"), actor, "update", resource, id,
        JSON.stringify({ before: current, after: { homeScore, awayScore, status: "completed", resultSource: "manual" } }), new Date().toISOString(),
      ).run();

      return { id };
    }

    const hasScheduledDate = Object.prototype.hasOwnProperty.call(input, "scheduledDate")
      || Object.prototype.hasOwnProperty.call(input, "scheduled_date");
    const hasScheduledTime = Object.prototype.hasOwnProperty.call(input, "scheduledTime")
      || Object.prototype.hasOwnProperty.call(input, "scheduled_time");
    const hasVenue = Object.prototype.hasOwnProperty.call(input, "venue");
    const hasScheduledAt = Object.prototype.hasOwnProperty.call(input, "scheduledAt")
      || Object.prototype.hasOwnProperty.call(input, "scheduled_at");

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

    await db.prepare(`UPDATE league_games SET
      scheduled_at=?, scheduled_date=?, scheduled_time=?, venue=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(scheduledAt, scheduledDate, scheduledTime, venue, id).run();

    await db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
      createEntityId("audit"), actor, "update", resource, id,
      JSON.stringify({ before: current, after: { scheduledAt, scheduledDate, scheduledTime, venue } }), new Date().toISOString(),
    ).run();
    return { id };
  }

  if (resource === "teams") {
    const current = await db.prepare("SELECT * FROM league_teams WHERE id=?")
      .bind(id).first<DbRow>();
    if (!current) throw new Error("Δεν βρέθηκε η ομάδα.");

    const team = teamInput(input, current);
    const duplicate = await db.prepare(
      "SELECT id FROM league_teams WHERE (slug=? OR LOWER(TRIM(name))=LOWER(TRIM(?))) AND id<>?",
    ).bind(team.slug, team.name, id).first<{ id: string }>();
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
      "SELECT id FROM league_competitions WHERE season_id=? AND slug=? AND id<>?",
    ).bind(competition.seasonId, competition.slug, id).first<{ id: string }>();
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
