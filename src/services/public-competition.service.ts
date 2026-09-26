import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { projectAdministrativeGameResult } from "@/lib/administrative-game-result";
import { resolveSeriesCarryOver, type SeriesCarryOverGameLike, type SeriesCarryOverPhaseLike } from "@/lib/series-carry-over";
import { calculateSeriesProgression, type SeriesProgressionMaterializedGame, type SeriesProgressionTransferredGame, type SeriesProgressionResult } from "@/lib/series-progression";
import { calculateStandings, type StandingsTieBreakerKey } from "@/lib/standings-calculator";
import { buildPublicTeamStatistics, type PublicTeamStatistics } from "@/lib/public-team-statistics";
import { selectCompetitionLatestMovements } from "@/lib/competition-latest-movements";
import type { PlatformMatchReportMode } from "@/lib/platform-match-report";
import { listPlatformMatchReportAvailabilityWithDb, readAuthoritativeTeamStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export const PUBLIC_KOMOBASKET_ORGANIZATION_ID = "organization_komobasket";
export const CANONICAL_PUBLIC_SEASON_START = "2026-01-01";

export type PublicStandingsPresentation = {
  directQualification: number[];
  playOut: number[];
  eliminated: number[];
};

export type PublicDirectAdvancement = {
  matchupId: string;
  label: string;
  participantSlotType: string;
};

export type PublicGameTeam = {
  id: string;
  name: string;
  logoUrl: string | null;
};

export type PublicVenue = {
  id: string | null;
  name: string;
  address: string | null;
  mapUrl: string | null;
};

export type PublicGame = {
  id: string;
  roundNumber: number;
  gameOrder: number | null;
  roundLabel: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  venue: PublicVenue | null;
  homeScore: number | null;
  awayScore: number | null;
  publicStatus: "scheduled" | "live" | "completed";
  liveAvailable: boolean;
  finalizedStatisticsAvailable: boolean;
  videoUrl: string | null;
  homeTeam: PublicGameTeam;
  awayTeam: PublicGameTeam;
};

export type PublicStandingRow = { rank: number; team: PublicGameTeam; gamesPlayed: number; wins: number; losses: number; standingsPoints: number; pointsFor: number; pointsAgainst: number; pointDifference: number };
export type PublicSeriesRound = { roundNumber: number; kind: "transferred" | "game" | "not_needed"; sourcePhaseName: string | null; game: PublicGame | null };
export type PublicSeriesSummary = Pick<SeriesProgressionResult,
  "teamAId" | "teamAName" | "teamBId" | "teamBName" | "winsRequired" |
  "currentWinsA" | "currentWinsB" | "qualifiedTeamId" | "qualifiedTeamName" | "transferredRoundCount"
>;
export type PublicSeriesMatchupHistory = { matchupId: string; label: string; maximumSeriesRounds: number; rounds: PublicSeriesRound[]; summary?: PublicSeriesSummary };
export type PublicBracketParticipant = { slot: "A" | "B"; team: PublicGameTeam | null; originLabel: string | null };
export type PublicBracketMatchup = { matchupId: string; kind: "series" | "direct_qualifier" | "standings_origin"; participants: PublicBracketParticipant[]; winnerTeamId: string | null; seriesScore: { winsA: number; winsB: number; winsRequired: number } | null; directAdvancement: boolean };
export type PublicBracketStage = { phaseId: string; phaseSlug: string; label: string; order: number; kind: "standings_origin" | "series"; matchups: PublicBracketMatchup[] };
export type PublicBracketEdge = { id: string; from: { phaseId: string; matchupId: string; outcome: "winner" | "loser" | "standing_position" }; to: { phaseId: string; matchupId: string; slot: "A" | "B" } };
export type CompetitionBracketProjection = { meaningful: boolean; stages: PublicBracketStage[]; edges: PublicBracketEdge[] };

export type PublicPhase = {
  id: string;
  slug: string;
  name: string;
  phaseOrder: number;
  lifecycleStatus: string | null;
  format: "standings" | "series" | "custom";
  phaseType: string;
  participantCount: number | null;
  roundCount: number | null;
  winsRequired: number | null;
  directAdvancements: PublicDirectAdvancement[];
  standingsPresentation: PublicStandingsPresentation;
};

export type PublicCompetition = {
  id: string;
  slug: string;
  name: string;
  type: string;
  lifecycleStatus: "online" | "complete";
  gameMode: PlatformMatchReportMode;
};

export type PublicSeason = {
  id: string;
  slug: string;
  name: string;
};

export type PublicTeamRosterPlayer = {
  id: string;
  displayName: string;
  shirtNumber: number | null;
  photoUrl: string | null;
};

export type PublicTeamGame = {
  game: PublicGame;
  phaseName: string;
  phaseOrder: number;
  status: "scheduled" | "completed" | "postponed" | "cancelled";
};

export type PublicTeamView = {
  team: PublicGameTeam;
  gameMode: PlatformMatchReportMode;
  roster: PublicTeamRosterPlayer[];
  games: PublicTeamGame[];
  statistics: PublicTeamStatistics;
};

const PUBLIC_TEAM_GAME_STATUSES = ["scheduled", "completed", "postponed", "cancelled"] as const;

function isPublicTeamGameStatus(status: string | null): status is PublicTeamGame["status"] {
  return status !== null && (PUBLIC_TEAM_GAME_STATUSES as readonly string[]).includes(status);
}

export type PublicCompetitionContext = {
  seasons: PublicSeason[];
  competitions: PublicCompetition[];
  phases: PublicPhase[];
  games: PublicGame[];
  standings: PublicStandingRow[];
  seriesHistory: PublicSeriesMatchupHistory[];
  bracket: CompetitionBracketProjection | null;
  teamView: PublicTeamView | null;
  selectedSeason: PublicSeason | null;
  selectedCompetition: PublicCompetition | null;
  selectedPhase: PublicPhase | null;
};

type PublicCompetitionRow = {
  season_id: string;
  season_name: string;
  season_slug: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  competition_type: string;
  lifecycle_status: "online" | "complete";
  game_mode: "SIMPLE" | "FULL" | null;
};

type PublicPhaseRow = {
  id: string;
  slug: string;
  name: string;
  format: string;
  phase_type: string;
  phase_kind: string | null;
  lifecycle_status: string | null;
  phase_order: number | null;
  previous_phase_id: string | null;
  participant_count: number | null;
  round_count: number | null;
  wins_required: number | null;
  carry_over_enabled: number | null;
  carry_over_source_phase_id: string | null;
  settings_json: string | null;
  rule_settings_json: string | null;
  standings_presentation_json: string;
};

type PublicGameRow = {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string | null;
  cycle_number: number | null;
  round_number: number | null;
  series_round_number: number | null;
  game_order: number | null;
  round_label: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  game_venue: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_map_url: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string | null;
  result_source: string | null;
  gameplay_lifecycle: string | null;
  series_matchup_id: string | null;
  video_url: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_logo_url: string | null;
  finalized_statistics_available?: boolean;
  administrative_result_id: string | null;
  administrative_home_score: number | null;
  administrative_away_score: number | null;
  administrative_home_standings_points_override: number | null;
  administrative_away_standings_points_override: number | null;
};

type PublicTeamRow = { id: string; name: string; logo_url: string | null };

async function getDb(): Promise<D1DatabaseBinding> {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_DB) throw new Error("Η canonical δημόσια βάση διοργανώσεων δεν είναι διαθέσιμη.");
  return env.NEWS_DB;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  try {
    return parseRecord(JSON.parse(value ?? "{}"));
  } catch {
    return {};
  }
}

function parseStandingsPresentation(value: string): PublicStandingsPresentation {
  const presentation: PublicStandingsPresentation = {
    directQualification: [],
    playOut: [],
    eliminated: [],
  };
  try {
    const entries = JSON.parse(value);
    if (!Array.isArray(entries)) return presentation;
    for (const entry of entries) {
      const category = String(entry?.category ?? "");
      const position = Number(entry?.position);
      if (!Number.isInteger(position) || position < 1) continue;
      if (category === "direct_qualification") presentation.directQualification.push(position);
      if (category === "play_out") presentation.playOut.push(position);
      if (category === "eliminated") presentation.eliminated.push(position);
    }
  } catch {
    return presentation;
  }
  for (const positions of Object.values(presentation)) positions.sort((left, right) => left - right);
  return presentation;
}

function parseDirectAdvancements(settingsJson: string | null): PublicDirectAdvancement[] {
  const settings = parseJsonRecord(settingsJson);
  const bracket = parseRecord(settings.bracketConfiguration);
  const matchups = Array.isArray(bracket.matchups) ? bracket.matchups : [];
  return matchups.flatMap((rawMatchup) => {
    const matchup = parseRecord(rawMatchup);
    const slotA = parseRecord(matchup.slotA);
    const slotB = parseRecord(matchup.slotB);
    const byeA = String(slotA.type ?? "") === "bye";
    const byeB = String(slotB.type ?? "") === "bye";
    if (byeA === byeB) return [];
    const participantSlot = byeA ? slotB : slotA;
    const matchupId = String(matchup.id ?? "").trim();
    if (!matchupId) return [];
    return [{
      matchupId,
      label: "Άμεση πρόκριση χωρίς αγώνα.",
      participantSlotType: String(participantSlot.type ?? "").trim(),
    }];
  });
}

function normalizePhase(row: PublicPhaseRow): PublicPhase {
  const format = String(row.format ?? "custom");
  const normalizedFormat = format === "standings" || format === "series" ? format : "custom";
  const settings = parseJsonRecord(row.rule_settings_json);
  const participantConfiguration = parseRecord(settings.participantConfiguration);
  const bracket = parseRecord(settings.bracketConfiguration);
  const configuredParticipantCount = Number(bracket.participantCount);
  const participantCount = normalizedFormat === "series"
    ? (Number.isInteger(configuredParticipantCount) && configuredParticipantCount > 0 ? configuredParticipantCount : null)
    : normalizedFormat === "standings" && String(participantConfiguration.participantSourceType ?? "") === "competition_participants"
      ? (row.participant_count === null ? null : Number(row.participant_count))
      : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    phaseOrder: row.phase_order ?? Number.MAX_SAFE_INTEGER,
    lifecycleStatus: row.lifecycle_status,
    format: normalizedFormat,
    phaseType: row.phase_type,
    participantCount,
    roundCount: row.round_count === null ? null : Number(row.round_count),
    winsRequired: row.wins_required === null ? null : Number(row.wins_required),
    directAdvancements: parseDirectAdvancements(row.rule_settings_json),
    standingsPresentation: parseStandingsPresentation(row.standings_presentation_json),
  };
}

function normalizePublicGame(row: PublicGameRow, format: PublicPhase["format"], roundOverride?: number): PublicGame | null {
  const roundNumber = format === "series"
    ? roundOverride ?? row.series_round_number ?? row.round_number
    : row.round_number;
  if (typeof roundNumber !== "number" || !Number.isInteger(roundNumber) || roundNumber < 1) return null;
  const venueName = row.venue_name?.trim() || row.game_venue?.trim() || null;
  const publicStatus = row.administrative_result_id
    ? "completed" as const
    : row.gameplay_lifecycle === "live"
    ? "live" as const
    : row.status === "completed" && row.home_score !== null && row.away_score !== null
      ? "completed" as const
      : "scheduled" as const;
  return {
    id: row.id,
    roundNumber,
    gameOrder: row.game_order === null ? null : Number(row.game_order),
    roundLabel: row.round_label?.trim() || null,
    scheduledDate: row.scheduled_date?.trim() || null,
    scheduledTime: row.scheduled_time?.trim() || null,
    venue: venueName ? { id: row.venue_id, name: venueName, address: row.venue_address?.trim() || null, mapUrl: row.venue_map_url?.trim() || null } : null,
    homeScore: row.home_score === null ? null : Number(row.home_score),
    awayScore: row.away_score === null ? null : Number(row.away_score),
    publicStatus,
    liveAvailable: publicStatus === "live",
    finalizedStatisticsAvailable: publicStatus === "completed" && row.finalized_statistics_available === true,
    videoUrl: row.video_url?.trim() || null,
    homeTeam: {
      id: row.home_team_id,
      name: row.home_team_name,
      logoUrl: row.home_team_logo_url?.trim() || null,
    },
    awayTeam: {
      id: row.away_team_id,
      name: row.away_team_name,
      logoUrl: row.away_team_logo_url?.trim() || null,
    },
  };
}

function tieBreakers(settingsJson: string | null): StandingsTieBreakerKey[] | undefined {
  const values = parseJsonRecord(settingsJson).tieBreakers;
  const allowed: StandingsTieBreakerKey[] = ["head_to_head", "head_to_head_point_diff", "overall_point_diff", "points_for", "alphabetical"];
  if (!Array.isArray(values)) return undefined;
  const result = values.filter((value): value is StandingsTieBreakerKey => allowed.includes(value as StandingsTieBreakerKey));
  return result.length ? result : undefined;
}

function toSeriesPhase(row: PublicPhaseRow, competitionId: string): SeriesCarryOverPhaseLike {
  return {
    id: row.id,
    competition_id: competitionId,
    name: row.name,
    format: row.format,
    phase_kind: row.phase_kind,
    lifecycle_status: row.lifecycle_status,
    previous_phase_id: row.previous_phase_id,
    wins_required: row.wins_required,
    carry_over_enabled: row.carry_over_enabled,
    carry_over_source_phase_id: row.carry_over_source_phase_id,
    settings_json: row.settings_json,
    rule_settings_json: row.rule_settings_json,
  };
}

type BracketSlot = { type: string; position: string | null; teamId: string | null; matchupId: string | null };
type BracketDefinition = { id: string; slotA: BracketSlot; slotB: BracketSlot };

function bracketDefinitions(settingsJson: string | null): BracketDefinition[] {
  const settings = parseJsonRecord(settingsJson);
  const bracket = parseRecord(settings.bracketConfiguration);
  const matchups = Array.isArray(bracket.matchups) ? bracket.matchups : [];
  const slot = (value: unknown): BracketSlot => {
    const record = parseRecord(value);
    return {
      type: String(record.type ?? "").trim(),
      position: String(record.position ?? "").trim() || null,
      teamId: String(record.teamId ?? "").trim() || null,
      matchupId: String(record.matchupId ?? "").trim() || null,
    };
  };
  return matchups.flatMap((value) => {
    const matchup = parseRecord(value);
    const id = String(matchup.id ?? "").trim();
    return id ? [{ id, slotA: slot(matchup.slotA), slotB: slot(matchup.slotB) }] : [];
  });
}

function slotOriginLabel(slot: BracketSlot): string | null {
  if (slot.type === "standing_position" && slot.position) return `#${slot.position}`;
  if (slot.type === "matchup_winner") return "Νικητής διασταύρωσης";
  if (slot.type === "matchup_loser") return "Ηττημένος διασταύρωσης";
  if (slot.type === "fixed_team") return "Επιλεγμένη ομάδα";
  return null;
}

function canonicalSeriesState(matchup: ReturnType<typeof resolveSeriesCarryOver>["matchups"][number], phase: PublicPhaseRow, games: PublicGameRow[]) {
  const transferred: SeriesProgressionTransferredGame[] = matchup.meetingResolutions.flatMap((meeting, index) => {
    const game = games.find((item) => item.id === meeting.gameId);
    return meeting.state === "resolved" && game && game.home_score !== null && game.away_score !== null
      ? [{ sourceGameId: game.id, seriesRoundNumber: index + 1, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: Number(game.home_score), awayScore: Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.game_venue }]
      : [];
  });
  const materialized: SeriesProgressionMaterializedGame[] = games
    .filter((game) => game.phase_id === phase.id && game.series_matchup_id === matchup.matchupId && game.series_round_number !== null)
    .map((game) => ({ matchupId: matchup.matchupId, gameId: game.id, seriesRoundNumber: Number(game.series_round_number), homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score === null ? null : Number(game.home_score), awayScore: game.away_score === null ? null : Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.game_venue }));
  if (!matchup.teamAId || !matchup.teamBId) return { transferred, materialized, progression: null };
  return {
    transferred,
    materialized,
    progression: calculateSeriesProgression({
      matchupId: matchup.matchupId,
      teamA: { id: matchup.teamAId, name: matchup.teamAName ?? matchup.teamAId },
      teamB: { id: matchup.teamBId, name: matchup.teamBName ?? matchup.teamBId },
      winsRequired: Math.max(1, Number(phase.wins_required ?? 2)),
      transferredGames: transferred,
      materializedGames: materialized,
      planningSlots: [],
    }),
  };
}

function buildCompetitionBracketProjection(phaseRows: PublicPhaseRow[], phases: PublicPhase[], competitionId: string, games: PublicGameRow[], teams: PublicTeamRow[]): CompetitionBracketProjection | null {
  const phaseById = new Map(phaseRows.map((phase) => [phase.id, phase]));
  const publicPhaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const teamById = new Map(teams.map((team) => [team.id, { id: team.id, name: team.name, logoUrl: team.logo_url?.trim() || null }]));
  const seriesRows = phaseRows.filter((phase) => phase.format === "series");
  if (!seriesRows.length) return null;
  const carries = new Map(seriesRows.map((phase) => [phase.id, resolveSeriesCarryOver(phaseRows.map((row) => toSeriesPhase(row, competitionId)), games as SeriesCarryOverGameLike[], teams, toSeriesPhase(phase, competitionId))]));
  const stages: PublicBracketStage[] = [];
  const edges: PublicBracketEdge[] = [];
  const originEntries = new Map<string, { phaseId: string; position: string; team: PublicGameTeam | null }>();

  for (const phase of seriesRows) {
    const carry = carries.get(phase.id);
    const definitions = new Map(bracketDefinitions(phase.rule_settings_json).map((definition) => [definition.id, definition]));
    const participantSourcePhaseId = String(parseRecord(parseJsonRecord(phase.rule_settings_json).participantConfiguration).participantSourcePhaseId ?? "").trim() || null;
    const matchups: PublicBracketMatchup[] = (carry?.matchups ?? []).flatMap((resolution) => {
      const definition = definitions.get(resolution.matchupId);
      if (!definition) return [];
      const direct = resolution.entryKind === "direct_qualifier";
      const playable = resolution.entryKind === undefined && resolution.playable !== false;
      if (!direct && !playable) return [];
      const sides: Array<["A" | "B", BracketSlot, string | null]> = [["A", definition.slotA, resolution.teamAId], ["B", definition.slotB, resolution.teamBId]];
      const participants = sides.flatMap(([slot, source, teamId]) => source.type === "bye" ? [] : [{ slot, team: teamId ? teamById.get(teamId) ?? null : null, originLabel: slotOriginLabel(source) }]);
      for (const [slot, source, teamId] of sides) {
        if (source.type === "standing_position" && source.position && participantSourcePhaseId) {
          originEntries.set(`${participantSourcePhaseId}:${source.position}`, { phaseId: participantSourcePhaseId, position: source.position, team: teamId ? teamById.get(teamId) ?? null : null });
          edges.push({ id: `${participantSourcePhaseId}:seed-${source.position}->${phase.id}:${resolution.matchupId}:${slot}`, from: { phaseId: participantSourcePhaseId, matchupId: `seed-${source.position}`, outcome: "standing_position" }, to: { phaseId: phase.id, matchupId: resolution.matchupId, slot } });
        }
        if ((source.type === "matchup_winner" || source.type === "matchup_loser") && source.matchupId && participantSourcePhaseId) {
          edges.push({ id: `${participantSourcePhaseId}:${source.matchupId}:${source.type}->${phase.id}:${resolution.matchupId}:${slot}`, from: { phaseId: participantSourcePhaseId, matchupId: source.matchupId, outcome: source.type === "matchup_winner" ? "winner" : "loser" }, to: { phaseId: phase.id, matchupId: resolution.matchupId, slot } });
        }
      }
      const state = direct ? null : canonicalSeriesState(resolution, phase, games).progression;
      return [{ matchupId: resolution.matchupId, kind: direct ? "direct_qualifier" as const : "series" as const, participants, winnerTeamId: direct ? resolution.qualifiedTeamId ?? null : state?.qualifiedTeamId ?? null, seriesScore: state ? { winsA: state.currentWinsA, winsB: state.currentWinsB, winsRequired: state.winsRequired } : null, directAdvancement: direct }];
    });
    if (!matchups.length) continue;
    const publicPhase = publicPhaseById.get(phase.id);
    stages.push({ phaseId: phase.id, phaseSlug: publicPhase?.slug ?? phase.id, label: phase.name, order: Number(phase.phase_order ?? 0), kind: "series", matchups });
  }

  for (const entry of originEntries.values()) {
    const source = phaseById.get(entry.phaseId);
    const publicPhase = publicPhaseById.get(entry.phaseId);
    if (!source || source.format !== "standings") continue;
    const stage = stages.find((candidate) => candidate.phaseId === entry.phaseId);
    const matchup: PublicBracketMatchup = { matchupId: `seed-${entry.position}`, kind: "standings_origin", participants: [{ slot: "A", team: entry.team, originLabel: `#${entry.position}` }], winnerTeamId: entry.team?.id ?? null, seriesScore: null, directAdvancement: false };
    if (stage) stage.matchups.push(matchup);
    else stages.push({ phaseId: entry.phaseId, phaseSlug: publicPhase?.slug ?? entry.phaseId, label: `Προέλευση · ${source.name}`, order: Number(source.phase_order ?? 0), kind: "standings_origin", matchups: [matchup] });
  }

  stages.sort((left, right) => left.order - right.order || left.phaseId.localeCompare(right.phaseId));
  const stageIds = new Set(stages.map((stage) => stage.phaseId));
  const canonicalEdges = edges.filter((edge) => stageIds.has(edge.from.phaseId) && stageIds.has(edge.to.phaseId));
  return { meaningful: canonicalEdges.length > 0 && stages.some((stage) => stage.kind === "series"), stages, edges: canonicalEdges };
}

export async function getPublicCompetitionContextForOrganizationWithDb(
  db: D1DatabaseBinding,
  organizationId: string,
  input: {
    seasonSlug?: string | null;
    competitionSlug?: string | null;
    phaseSlug?: string | null;
    teamId?: string | null;
  } = {},
): Promise<PublicCompetitionContext> {
  const visible = await db.prepare(`
    SELECT s.id AS season_id, s.name AS season_name, s.slug AS season_slug,
           c.id AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
           c.type AS competition_type, COALESCE(kc.game_mode, 'FULL') AS game_mode,
           COALESCE(cp.lifecycle_status,
             CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
           ) AS lifecycle_status
      FROM league_competitions c
      JOIN league_seasons s ON s.id=c.season_id
      LEFT JOIN league_competition_komocontrol_defaults kc ON kc.competition_id=c.id
      LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
     WHERE c.organization_id=?
       AND s.starts_on >= ?
       AND s.status IN ('active','completed')
       AND COALESCE(cp.lifecycle_status,
             CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
           ) IN ('online','complete')
     ORDER BY s.starts_on DESC, s.name DESC, c.name COLLATE NOCASE ASC, c.id ASC
  `).bind(organizationId, CANONICAL_PUBLIC_SEASON_START).all<PublicCompetitionRow>();
  const rows = visible.results ?? [];
  const seasons = Array.from(new Map(rows.map((row) => [row.season_id, {
    id: row.season_id,
    slug: row.season_slug,
    name: row.season_name,
  }])).values());
  const selectedSeason = seasons.find((season) => season.slug === input.seasonSlug) ?? seasons[0] ?? null;
  const competitions = selectedSeason
    ? rows.filter((row) => row.season_id === selectedSeason.id).map((row): PublicCompetition => ({
      id: row.competition_id,
      slug: row.competition_slug,
      name: row.competition_name,
      type: row.competition_type,
      lifecycleStatus: row.lifecycle_status,
      gameMode: row.game_mode === "SIMPLE" ? "SIMPLE" : "FULL",
    }))
    : [];
  const selectedCompetition = competitions.find((competition) => competition.slug === input.competitionSlug) ?? competitions[0] ?? null;
  if (!selectedCompetition) return { seasons, competitions, phases: [], games: [], standings: [], seriesHistory: [], bracket: null, teamView: null, selectedSeason, selectedCompetition: null, selectedPhase: null };

  const phaseResult = await db.prepare(`
    SELECT p.id, p.slug, p.name, p.format, p.phase_type, p.lifecycle_status, p.previous_phase_id, p.settings_json,
           COALESCE(p.phase_order, p.order_index) AS phase_order,
           pr.phase_kind, pr.wins_required, pr.carry_over_enabled, pr.carry_over_source_phase_id,
           pr.settings_json AS rule_settings_json,
           (SELECT COUNT(*) FROM league_competition_teams ct WHERE ct.competition_id=p.competition_id AND ct.status='active') AS participant_count,
           (SELECT COUNT(DISTINCT g.round_number) FROM league_games g WHERE g.phase_id=p.id AND g.round_number IS NOT NULL) AS round_count,
           COALESCE((SELECT json_group_array(json_object('category', spp.category, 'position', spp.position))
             FROM league_phase_standings_presentation spp WHERE spp.phase_id=p.id), '[]') AS standings_presentation_json
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
     WHERE p.competition_id=?
     ORDER BY COALESCE(p.phase_order, p.order_index), p.id
  `).bind(selectedCompetition.id).all<PublicPhaseRow>();
  const phaseRows = phaseResult.results ?? [];
  const phases = phaseRows.map(normalizePhase);
  const selectedPhase = phases.find((phase) => phase.slug === input.phaseSlug) ?? phases[0] ?? null;
  const selectedPhaseRow = phaseRows.find((row) => row.id === selectedPhase?.id) ?? null;
  if (!selectedPhase || !selectedPhaseRow) return { seasons, competitions, phases, games: [], standings: [], seriesHistory: [], bracket: null, teamView: null, selectedSeason, selectedCompetition, selectedPhase: null };

  const [teamResult, gameResult, matchReportAvailability] = await Promise.all([
    db.prepare(`SELECT t.id, COALESCE(NULLIF(TRIM(st.display_name), ''), t.name) AS name, NULLIF(TRIM(t.logo_url), '') AS logo_url
      FROM league_competition_teams ct JOIN league_season_teams st ON st.id=ct.season_team_id JOIN league_teams t ON t.id=st.team_id
      WHERE ct.competition_id=? AND ct.status='active' AND t.organization_id=? ORDER BY COALESCE(NULLIF(TRIM(st.display_name), ''), t.name) COLLATE NOCASE, t.id`)
      .bind(selectedCompetition.id, organizationId).all<PublicTeamRow>(),
    db.prepare(`
    SELECT g.id, g.competition_id, g.phase_id, g.schedule_id, g.cycle_number, g.round_number, g.series_round_number, g.game_order, g.round_label,
           g.scheduled_date, g.scheduled_time, g.venue AS game_venue, v.id AS venue_id, v.name AS venue_name, v.address AS venue_address, v.map_url AS venue_map_url,
           g.home_score, g.away_score, g.status, g.result_source, gameplay_head.lifecycle AS gameplay_lifecycle, g.series_matchup_id, g.video_url,
           administrative.id AS administrative_result_id,
           administrative.official_home_score AS administrative_home_score,
           administrative.official_away_score AS administrative_away_score,
           administrative.home_standings_points_override AS administrative_home_standings_points_override,
           administrative.away_standings_points_override AS administrative_away_standings_points_override,
           home.id AS home_team_id, COALESCE(NULLIF(TRIM(home_st.display_name), ''), home.name) AS home_team_name, NULLIF(TRIM(home.logo_url), '') AS home_team_logo_url,
           away.id AS away_team_id, COALESCE(NULLIF(TRIM(away_st.display_name), ''), away.name) AS away_team_name, NULLIF(TRIM(away.logo_url), '') AS away_team_logo_url
      FROM league_games g
      LEFT JOIN league_komocontrol_gameplay_game_claims gameplay_claim ON gameplay_claim.game_id=g.id
      LEFT JOIN league_komocontrol_gameplay_heads gameplay_head ON gameplay_head.run_id=gameplay_claim.run_id
      LEFT JOIN league_game_administrative_results administrative ON administrative.game_id=g.id
      LEFT JOIN league_competition_venues v ON v.competition_id=g.competition_id AND v.name=g.venue
      JOIN league_competition_teams home_ct ON home_ct.competition_id=g.competition_id AND home_ct.status='active'
      JOIN league_season_teams home_st ON home_st.id=home_ct.season_team_id AND home_st.team_id=g.home_team_id
      JOIN league_teams home ON home.id=g.home_team_id
      JOIN league_competition_teams away_ct ON away_ct.competition_id=g.competition_id AND away_ct.status='active'
      JOIN league_season_teams away_st ON away_st.id=away_ct.season_team_id AND away_st.team_id=g.away_team_id
      JOIN league_teams away ON away.id=g.away_team_id
     WHERE g.competition_id=? AND home.organization_id=? AND away.organization_id=?
     ORDER BY CASE WHEN ?='series' THEN COALESCE(g.series_round_number, g.round_number) ELSE g.round_number END,
              g.game_order, g.id
  `).bind(
    selectedCompetition.id,
    organizationId,
    organizationId,
    selectedPhase.format,
  ).all<PublicGameRow>(),
    listPlatformMatchReportAvailabilityWithDb(db, organizationId),
  ]);
  const teams = teamResult.results ?? [];
  const canonicalGames = (gameResult.results ?? []).map((game) => ({
    ...projectAdministrativeGameResult(game),
    finalized_statistics_available: matchReportAvailability[game.id]?.available === true,
  }));
  const bracket = buildCompetitionBracketProjection(phaseRows, phases, selectedCompetition.id, canonicalGames, teams);
  const games = canonicalGames.filter((game) => game.phase_id === selectedPhase.id)
    .map((row) => normalizePublicGame(row, selectedPhase.format))
    .filter((game): game is PublicGame => game !== null);

  const selectedTeam = input.teamId ? teams.find((team) => team.id === input.teamId) ?? null : null;
  let teamView: PublicTeamView | null = null;
  if (selectedTeam) {
    const [rosterResult, statisticalGames] = await Promise.all([db.prepare(`
      SELECT p.id, p.display_name AS display_name, r.shirt_number AS shirt_number, p.photo_url AS photo_url
        FROM league_roster_memberships r
        JOIN league_players p ON p.id=r.player_id
       WHERE r.season_id=? AND r.competition_id=? AND r.team_id=? AND r.status='active'
         AND p.organization_id=?
       ORDER BY CASE WHEN r.shirt_number IS NULL THEN 1 ELSE 0 END,
                r.shirt_number ASC, p.display_name COLLATE NOCASE, p.id
    `).bind(selectedSeason.id, selectedCompetition.id, selectedTeam.id, organizationId).all<{
      id: string;
      display_name: string;
      shirt_number: number | null;
      photo_url: string | null;
    }>(), readAuthoritativeTeamStatisticalGamesWithDb(
      db,
      selectedCompetition.id,
      selectedTeam.id,
      organizationId,
    )]);
    const publicPhaseById = new Map(phases.map((phase) => [phase.id, phase]));
    const phaseById = new Map<string, { name: string; format: PublicPhase["format"]; order: number }>();
    for (const row of phaseRows) {
      const phase = publicPhaseById.get(row.id);
      if (phase && typeof row.phase_order === "number") {
        phaseById.set(row.id, { name: phase.name, format: phase.format, order: row.phase_order });
      }
    }
    const statusRank: Record<PublicTeamGame['status'], number> = { scheduled: 0, completed: 1, postponed: 2, cancelled: 3 };
    const normalizedTeamGames = canonicalGames.flatMap((row): PublicTeamGame[] => {
      if (row.home_team_id !== selectedTeam.id && row.away_team_id !== selectedTeam.id) return [];
      const phase = phaseById.get(row.phase_id);
      if (!phase || !isPublicTeamGameStatus(row.status)) return [];
      const game = normalizePublicGame(row, phase.format);
      if (!game) return [];
      return [{ game, phaseName: phase.name, phaseOrder: phase.order, status: row.status }];
    });
    const date = (entry: PublicTeamGame) => entry.game.scheduledDate ?? '';
    normalizedTeamGames.sort((left, right) => {
      const statusDifference = statusRank[left.status] - statusRank[right.status];
      if (statusDifference !== 0) return statusDifference;
      const fallback = left.phaseOrder - right.phaseOrder || (left.game.roundNumber ?? Number.MAX_SAFE_INTEGER) - (right.game.roundNumber ?? Number.MAX_SAFE_INTEGER) || left.game.id.localeCompare(right.game.id);
      return left.status === 'completed' ? date(right).localeCompare(date(left)) || -fallback : date(left).localeCompare(date(right)) || fallback;
    });
    const roster = (rosterResult.results ?? []).map((player) => ({ id: player.id, displayName: player.display_name, shirtNumber: player.shirt_number, photoUrl: player.photo_url?.trim() || null }));
    teamView = {
      team: { id: selectedTeam.id, name: selectedTeam.name, logoUrl: selectedTeam.logo_url?.trim() || null },
      gameMode: selectedCompetition.gameMode,
      roster,
      games: normalizedTeamGames,
      statistics: buildPublicTeamStatistics({ team: { id: selectedTeam.id, name: selectedTeam.name }, roster, games: statisticalGames }),
    };
  }
  let standings: PublicStandingRow[] = [];
  if (selectedPhase.format === "standings" && selectedPhase.participantCount !== null) {
    const settings = parseJsonRecord(selectedPhaseRow.rule_settings_json);
    const result = calculateStandings({ phaseId: selectedPhase.id, teams: teams.map((team) => ({ id: team.id, name: team.name })), games: canonicalGames.map((game) => ({ id: game.id, phaseId: game.phase_id, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score, awayScore: game.away_score, status: game.status, resultSource: game.result_source, homeStandingsPointsOverride: game.administrative_home_standings_points_override, awayStandingsPointsOverride: game.administrative_away_standings_points_override })), rules: { pointsForWin: Number(settings.pointsForWin ?? settings.winPoints ?? 2), pointsForLoss: Number(settings.pointsForLoss ?? settings.lossPoints ?? 1) }, tieBreakers: tieBreakers(selectedPhaseRow.rule_settings_json) });
    const stats = new Map(result.rows.map((row) => [row.teamId, row]));
    const byTeam = new Map(teams.map((team) => [team.id, team]));
    standings = result.orderedRows.flatMap((ordered) => { const row = stats.get(ordered.teamId); const team = byTeam.get(ordered.teamId); return row && team ? [{ rank: ordered.rank, team: { id: team.id, name: team.name, logoUrl: team.logo_url?.trim() || null }, gamesPlayed: row.gamesPlayed, wins: row.wins, losses: row.losses, standingsPoints: row.standingsPoints, pointsFor: row.pointsFor, pointsAgainst: row.pointsAgainst, pointDifference: row.pointDifference }] : []; });
  }

  const seriesHistory: PublicSeriesMatchupHistory[] = [];
  let directAdvancements = selectedPhase.directAdvancements;
  if (selectedPhase.format === "series") {
    const carry = resolveSeriesCarryOver(phaseRows.map((row) => toSeriesPhase(row, selectedCompetition.id)), canonicalGames as SeriesCarryOverGameLike[], teams, toSeriesPhase(selectedPhaseRow, selectedCompetition.id));
    const direct = carry.matchups.filter((matchup) => matchup.entryKind === "direct_qualifier" && matchup.state === "resolved" && matchup.qualifiedTeamName).map((matchup) => ({ matchupId: matchup.matchupId, label: `${matchup.qualifiedTeamName} — Πρόκριση χωρίς αγώνα.`, participantSlotType: "canonical_direct_qualifier" }));
    if (direct.length) directAdvancements = direct;
    for (const matchup of carry.matchups) {
      if (matchup.entryKind !== undefined || matchup.playable === false || matchup.state !== "resolved" || !matchup.teamAId || !matchup.teamBId) continue;
      const transferred: SeriesProgressionTransferredGame[] = matchup.meetingResolutions.flatMap((meeting, index) => { const game = canonicalGames.find((item) => item.id === meeting.gameId); return meeting.state === "resolved" && game && game.home_score !== null && game.away_score !== null ? [{ sourceGameId: game.id, seriesRoundNumber: index + 1, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: Number(game.home_score), awayScore: Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.game_venue }] : []; });
      const materialized: SeriesProgressionMaterializedGame[] = canonicalGames.filter((game) => game.phase_id === selectedPhase.id && game.series_matchup_id === matchup.matchupId && game.series_round_number !== null).map((game) => ({ matchupId: matchup.matchupId, gameId: game.id, seriesRoundNumber: Number(game.series_round_number), homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeScore: game.home_score === null ? null : Number(game.home_score), awayScore: game.away_score === null ? null : Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date, time: game.scheduled_time, venue: game.game_venue }));
      const progression = calculateSeriesProgression({ matchupId: matchup.matchupId, teamA: { id: matchup.teamAId, name: matchup.teamAName ?? matchup.teamAId }, teamB: { id: matchup.teamBId, name: matchup.teamBName ?? matchup.teamBId }, winsRequired: Math.max(1, Number(selectedPhase.winsRequired ?? 2)), transferredGames: transferred, materializedGames: materialized, planningSlots: [] });
      const rounds = progression.rounds.flatMap<PublicSeriesRound>((round): PublicSeriesRound[] => { if (round.rowState === "transferred" && round.sourceGameId) { const game = canonicalGames.find((item) => item.id === round.sourceGameId); const projected = game ? normalizePublicGame(game, "series", round.seriesRoundNumber) : null; return projected ? [{ roundNumber: round.seriesRoundNumber, kind: "transferred" as const, sourcePhaseName: matchup.sourcePhaseName, game: projected }] : []; } if (round.rowState === "real_game" && round.realGameId) { const game = canonicalGames.find((item) => item.id === round.realGameId); const projected = game ? normalizePublicGame(game, "series", round.seriesRoundNumber) : null; return projected ? [{ roundNumber: round.seriesRoundNumber, kind: "game" as const, sourcePhaseName: null, game: projected }] : []; } return round.rowState === "qualified" ? [{ roundNumber: round.seriesRoundNumber, kind: "not_needed" as const, sourcePhaseName: null, game: null }] : []; });
      seriesHistory.push({ matchupId: matchup.matchupId, label: matchup.label, maximumSeriesRounds: progression.maximumSeriesRounds, rounds, summary: {
        teamAId: progression.teamAId, teamAName: progression.teamAName,
        teamBId: progression.teamBId, teamBName: progression.teamBName,
        winsRequired: progression.winsRequired,
        currentWinsA: progression.currentWinsA, currentWinsB: progression.currentWinsB,
        qualifiedTeamId: progression.qualifiedTeamId, qualifiedTeamName: progression.qualifiedTeamName,
        transferredRoundCount: progression.transferredRoundCount,
      } });
    }
  }
  return { seasons, competitions, phases, games, standings, seriesHistory, bracket, teamView, selectedSeason, selectedCompetition, selectedPhase: { ...selectedPhase, directAdvancements } };
}

export async function getPublicCompetitionContextForOrganization(
  organizationId: string,
  input: {
    seasonSlug?: string | null;
    competitionSlug?: string | null;
    phaseSlug?: string | null;
    teamId?: string | null;
  } = {},
): Promise<PublicCompetitionContext> {
  return getPublicCompetitionContextForOrganizationWithDb(await getDb(), organizationId, input);
}

export type PublicCompetitionMovement = {
  id: string;
  movementType: "addition" | "departure" | "transfer";
  effectiveOn: string;
  playerName: string;
  fromTeamName: string | null;
  toTeamName: string | null;
};

export async function listPublicCompetitionMovementsForOrganizationWithDb(
  db: D1DatabaseBinding,
  organizationId: string,
  seasonId: string,
  competitionId: string,
): Promise<PublicCompetitionMovement[]> {
  const result = await db.prepare(`SELECT
      m.id, c.organization_id, m.season_id, m.competition_id, m.movement_type,
      m.effective_on, m.created_at, p.display_name AS player_name,
      ft.name AS from_team_name, tt.name AS to_team_name
    FROM league_player_movements m
    JOIN league_competitions c ON c.id=m.competition_id
    JOIN league_seasons s ON s.id=m.season_id AND s.id=c.season_id
    JOIN league_players p ON p.id=m.player_id
    LEFT JOIN league_teams ft ON ft.id=m.from_team_id
    LEFT JOIN league_teams tt ON tt.id=m.to_team_id
    LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
    WHERE m.competition_id=? AND m.season_id=?
      AND c.organization_id=? AND p.organization_id=?
      AND (ft.id IS NULL OR ft.organization_id=?)
      AND (tt.id IS NULL OR tt.organization_id=?)
      AND s.starts_on >= ? AND s.status IN ('active','completed')
      AND COALESCE(cp.lifecycle_status,
        CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
      ) IN ('online','complete')
      AND m.movement_type IN ('addition','departure','transfer')
    ORDER BY m.effective_on DESC, m.created_at DESC, m.id DESC`)
    .bind(competitionId, seasonId, organizationId, organizationId, organizationId, organizationId, CANONICAL_PUBLIC_SEASON_START)
    .all<{
      id: string;
      organization_id: string;
      season_id: string;
      competition_id: string;
      movement_type: string;
      effective_on: string;
      created_at: string;
      player_name: string;
      from_team_name: string | null;
      to_team_name: string | null;
    }>();

  return selectCompetitionLatestMovements(result.results ?? [], { organizationId, seasonId, competitionId })
    .map((movement) => ({
      id: movement.id,
      movementType: movement.movement_type as PublicCompetitionMovement["movementType"],
      effectiveOn: movement.effective_on,
      playerName: movement.player_name,
      fromTeamName: movement.from_team_name,
      toTeamName: movement.to_team_name,
    }));
}

export async function listPublicCompetitionMovementsForOrganization(
  organizationId: string,
  seasonId: string,
  competitionId: string,
) {
  return listPublicCompetitionMovementsForOrganizationWithDb(await getDb(), organizationId, seasonId, competitionId);
}

export async function getPublicCompetitionContext(input: {
  seasonSlug?: string | null;
  competitionSlug?: string | null;
  phaseSlug?: string | null;
  teamId?: string | null;
} = {}): Promise<PublicCompetitionContext> {
  return getPublicCompetitionContextForOrganization(PUBLIC_KOMOBASKET_ORGANIZATION_ID, input);
}
