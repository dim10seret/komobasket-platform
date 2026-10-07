import "server-only";

import { selectHostedHomePhaseContext } from "@/components/hosted/HostedOrganizationHomeData";
import { projectAdministrativeGameResult } from "@/lib/administrative-game-result";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { hostedCompetitionGamePath } from "@/lib/hosted-organization-routes";
import { buildPhaseTournamentGroups, resolvePhaseTournamentGraph, type PhaseTournamentGroup } from "@/lib/phase-root-source";
import { resolveSeriesCarryOver, type SeriesCarryOverGameLike, type SeriesCarryOverPhaseLike } from "@/lib/series-carry-over";
import { calculateStandings, type StandingsTieBreakerKey } from "@/lib/standings-calculator";
import { readMobileCompetitionWithDb, type CompetitionSummary } from "@/services/public-mobile-catalogue.service";
import { PUBLIC_KOMOBASKET_ORGANIZATION_ID, type PublicCompetitionContext, type PublicGame } from "@/services/public-competition.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type PhaseView = "schedule" | "results" | "standings" | "matchups";
export type PhaseSummary = {
  id: string;
  competitionId: string;
  name: string;
  order: number;
  format: "standings" | "series" | "custom";
  phaseType: string;
  lifecycleStatus: "active" | "finalized";
  rootPhaseId: string;
  previousPhaseId: string | null;
  isCurrent: boolean;
  availableViews: PhaseView[];
};
export type CompetitionDetail = CompetitionSummary & {
  phases: PhaseSummary[];
  currentPhaseId: string | null;
  activePhaseIds: string[];
  tournamentGroups: Array<{ id: string; name: string; phaseIds: string[]; currentPhaseId: string | null }>;
};
export type PhaseDetail = PhaseSummary & {
  rounds: Array<{ number: number; label: string | null }>;
  matchups: Array<{
    id: string;
    label: string;
    teamAId: string | null;
    teamBId: string | null;
    qualifiedTeamId: string | null;
    state: string;
  }>;
};
export type GameStatus = "scheduled" | "live" | "completed" | "postponed" | "cancelled";
export type GameSummary = {
  id: string;
  competitionId: string;
  phaseId: string;
  round: number | null;
  roundLabel: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  venue: { name: string; address: string | null; mapUrl: string | null } | null;
  homeTeam: { id: string; name: string; logoUrl: string | null };
  awayTeam: { id: string; name: string; logoUrl: string | null };
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  webLiveUrl: string | null;
};
export type GameListMeta = { nextCursor: string | null; hasMore: boolean };
export type GameList = { data: GameSummary[]; meta: GameListMeta };
export type CompetitionHome = {
  competition: CompetitionSummary;
  currentPhaseId: string | null;
  currentPhase: PhaseSummary | null;
  activePhaseIds: string[];
  currentRound: { number: number; label: string | null } | null;
  liveGames: GameSummary[];
  upcomingGames: GameSummary[];
  recentResults: GameSummary[];
  standingsPreview: StandingsRow[] | null;
};
export type StandingsRow = {
  rank: number;
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  standingsPoints: number;
};
export type GameFilters = {
  rootPhaseId?: string;
  phaseId?: string;
  round?: number;
  status?: GameStatus;
  teamId?: string;
  cursor?: string;
  order?: "asc" | "desc";
  limit: number;
};

export class MobileCompetitionError extends Error {
  constructor(readonly code: "COMPETITION_NOT_FOUND" | "PHASE_NOT_FOUND" | "TOURNAMENT_NOT_FOUND" | "TEAM_NOT_FOUND" | "STANDINGS_NOT_AVAILABLE" | "INVALID_CURSOR" | "CATALOGUE_UNAVAILABLE") {
    super(code);
  }
}

type PhaseRow = {
  id: string;
  competition_id: string;
  name: string;
  tournament_name: string | null;
  format: string;
  phase_type: string;
  lifecycle_status: string;
  phase_order: number | null;
  order_index: number;
  previous_phase_id: string | null;
  settings_json: string;
  phase_kind: string | null;
  wins_required: number | null;
  carry_over_enabled: number | null;
  carry_over_source_phase_id: string | null;
  rule_settings_json: string | null;
  game_count: number;
};
type TeamRow = { id: string; name: string; logo_url: string | null };
type ResultRow = SeriesCarryOverGameLike & {
  id: string;
  competition_id: string;
  phase_id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  result_source: string | null;
  administrative_result_id: string | null;
  administrative_home_score: number | null;
  administrative_away_score: number | null;
  home_standings_points_override: number | null;
  away_standings_points_override: number | null;
};

const MAX_PHASES = 200;
const MAX_STANDINGS_TEAMS = 200;
const MAX_CALCULATION_GAMES = 2000;
const MAX_ROUNDS = 200;
const MAX_MATCHUPS = 100;
const GAME_PARTICIPANTS_VISIBLE_SQL = `
  EXISTS (
    SELECT 1 FROM league_competition_teams ct
    JOIN league_season_teams st ON st.id=ct.season_team_id
      AND st.season_id=c.season_id AND st.team_id=g.home_team_id
    JOIN league_teams t ON t.id=st.team_id AND t.organization_id=c.organization_id
    WHERE ct.competition_id=g.competition_id AND ct.status='active'
  )
  AND EXISTS (
    SELECT 1 FROM league_competition_teams ct
    JOIN league_season_teams st ON st.id=ct.season_team_id
      AND st.season_id=c.season_id AND st.team_id=g.away_team_id
    JOIN league_teams t ON t.id=st.team_id AND t.organization_id=c.organization_id
    WHERE ct.competition_id=g.competition_id AND ct.status='active'
  )
`;

function jsonRecord(value: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function bracketMatchupCount(row: PhaseRow): number {
  const settings = jsonRecord(row.rule_settings_json);
  const bracket = settings.bracketConfiguration;
  if (!bracket || typeof bracket !== "object" || Array.isArray(bracket)) return 0;
  return Array.isArray((bracket as Record<string, unknown>).matchups) ? (bracket as { matchups: unknown[] }).matchups.length : 0;
}

function supportsStandings(row: PhaseRow): boolean {
  if (row.format !== "standings") return false;
  const participantConfiguration = jsonRecord(row.rule_settings_json).participantConfiguration;
  return participantConfiguration !== null && typeof participantConfiguration === "object"
    && !Array.isArray(participantConfiguration)
    && (participantConfiguration as Record<string, unknown>).participantSourceType === "competition_participants";
}

function views(row: PhaseRow): PhaseView[] {
  if (row.format === "standings") return supportsStandings(row)
    ? ["schedule", "results", "standings"] : row.game_count > 0 ? ["schedule", "results"] : [];
  if (row.format === "series") return bracketMatchupCount(row) > 0
    ? ["matchups", "schedule", "results"] : ["schedule", "results"];
  return row.game_count > 0 ? ["schedule", "results"] : [];
}

async function publicCompetition(db: D1DatabaseBinding, competitionId: string): Promise<CompetitionSummary> {
  const competition = await readMobileCompetitionWithDb(db, competitionId);
  if (!competition) throw new MobileCompetitionError("COMPETITION_NOT_FOUND");
  return competition;
}

async function phasesForCompetition(db: D1DatabaseBinding, competitionId: string) {
  const result = await db.prepare(`
    SELECT p.id, p.competition_id, p.name, p.tournament_name, p.format, p.phase_type, p.lifecycle_status,
           p.phase_order, p.order_index, p.previous_phase_id, p.settings_json,
           pr.phase_kind, pr.wins_required, pr.carry_over_enabled,
           pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json,
           COALESCE(game_counts.game_count,0) AS game_count
      FROM league_phases p
      LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
      LEFT JOIN (
        SELECT phase_id, COUNT(*) AS game_count FROM league_games
         WHERE competition_id=? GROUP BY phase_id
      ) game_counts ON game_counts.phase_id=p.id
     WHERE p.competition_id=? AND p.lifecycle_status IN ('active','finalized')
     ORDER BY COALESCE(p.phase_order,p.order_index),p.id
     LIMIT ?
  `).bind(competitionId, competitionId, MAX_PHASES + 1).all<PhaseRow>();
  const rows = result.results ?? [];
  if (rows.length > MAX_PHASES) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
  const graph = resolvePhaseTournamentGraph(rows);
  const groups = buildPhaseTournamentGroups(rows);
  const phases: PhaseSummary[] = rows.map((row) => ({
    id: row.id,
    competitionId,
    name: row.name,
    order: row.phase_order ?? row.order_index,
    format: row.format === "standings" || row.format === "series" ? row.format : "custom",
    phaseType: row.phase_type,
    lifecycleStatus: row.lifecycle_status as PhaseSummary["lifecycleStatus"],
    rootPhaseId: graph.rootPhaseIdByPhaseId.get(row.id) ?? row.id,
    previousPhaseId: row.previous_phase_id,
    isCurrent: false,
    availableViews: views(row),
  }));
  return { rows, phases, groups };
}

function tournamentGroup(groups: PhaseTournamentGroup<PhaseRow>[], rootPhaseId: string) {
  const group = groups.find((item) => item.rootPhaseId === rootPhaseId);
  if (!group) throw new MobileCompetitionError("TOURNAMENT_NOT_FOUND");
  return group;
}

type ActivityRow = { phase_id: string; round_number: number };
async function activePhaseCandidates(db: D1DatabaseBinding, competitionId: string): Promise<ActivityRow[]> {
  const result = await db.prepare(`
    SELECT phase_id, MIN(round_number) AS round_number FROM (
      SELECT g.phase_id, COALESCE(g.series_round_number,g.round_number) AS round_number
        FROM league_games g
        JOIN league_competitions c ON c.id=g.competition_id
        LEFT JOIN league_game_administrative_results ar ON ar.game_id=g.id
        LEFT JOIN league_komocontrol_gameplay_game_claims claim ON claim.game_id=g.id
        LEFT JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
       WHERE g.competition_id=? AND ${GAME_PARTICIPANTS_VISIBLE_SQL} AND ar.id IS NULL
         AND (head.lifecycle='live' OR g.status<>'completed' OR g.home_score IS NULL OR g.away_score IS NULL)
      UNION ALL
      SELECT schedule.phase_id, slot.round_number
        FROM league_round_robin_planning_slots slot
        JOIN league_phase_schedules schedule ON schedule.id=slot.schedule_id
        LEFT JOIN league_games game ON game.schedule_id=slot.schedule_id
         AND game.round_number=slot.round_number AND game.game_order=slot.game_order
       WHERE schedule.competition_id=? AND game.id IS NULL
      UNION ALL
      SELECT slot.phase_id, slot.series_round_number
        FROM league_series_planning_slots slot
        LEFT JOIN league_games game ON game.phase_id=slot.phase_id
         AND game.series_matchup_id=slot.matchup_id AND game.series_round_number=slot.series_round_number
       WHERE slot.competition_id=? AND slot.real_game_id IS NULL AND game.id IS NULL
    ) pending WHERE round_number>=1 GROUP BY phase_id LIMIT ?
  `).bind(competitionId, competitionId, competitionId, MAX_PHASES + 1).all<ActivityRow>();
  const rows = result.results ?? [];
  if (rows.length > MAX_PHASES) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
  return rows;
}

function selectPhases(phases: PhaseSummary[], pending: Map<string, number>) {
  if (!phases.length) return { currentPhaseId: null as string | null, activePhaseIds: [] as string[], currentRoundNumber: null as number | null };
  const contexts = phases.flatMap((phase): PublicCompetitionContext[] => {
    const roundNumber = pending.get(phase.id);
    if (!roundNumber || phase.lifecycleStatus === "finalized") return [];
    const game = { id: `activity:${phase.id}`, roundNumber, gameOrder: 1, publicStatus: "scheduled" } as PublicGame;
    const context = {
      selectedPhase: { id: phase.id, phaseOrder: phase.order, lifecycleStatus: phase.lifecycleStatus, format: phase.format },
      games: phase.format === "series" ? [] : [game],
      seriesHistory: phase.format === "series" ? [{ rounds: [{ kind: "game", game }] }] : [],
    } as unknown as PublicCompetitionContext;
    return [context];
  });
  // Use the existing website selection rule: first non-finalized phase with an unresolved block.
  const currentPhaseId = selectHostedHomePhaseContext(contexts)?.selectedPhase?.id ?? null;
  const activePhaseIds = contexts.map((context) => context.selectedPhase!.id);
  return { currentPhaseId, activePhaseIds, currentRoundNumber: currentPhaseId ? pending.get(currentPhaseId) ?? null : null };
}

async function phaseSelection(db: D1DatabaseBinding, competitionId: string, phases: PhaseSummary[]) {
  if (!phases.length) return selectPhases(phases, new Map());
  const pending = new Map((await activePhaseCandidates(db, competitionId)).map((row) => [row.phase_id, row.round_number]));
  return selectPhases(phases, pending);
}

export async function readCompetitionDetailWithDb(db: D1DatabaseBinding, competitionId: string): Promise<CompetitionDetail> {
  const competition = await publicCompetition(db, competitionId);
  const { phases, groups } = await phasesForCompetition(db, competitionId);
  const pending = new Map((phases.length ? await activePhaseCandidates(db, competitionId) : [])
    .map((row) => [row.phase_id, row.round_number]));
  const { currentPhaseId, activePhaseIds } = selectPhases(phases, pending);
  const phasesById = new Map(phases.map((phase) => [phase.id, phase]));
  return {
    ...competition,
    phases: phases.map((phase) => ({ ...phase, isCurrent: phase.id === currentPhaseId })),
    currentPhaseId,
    activePhaseIds,
    tournamentGroups: groups.map((group) => ({
      id: group.rootPhaseId,
      name: group.tournamentName,
      phaseIds: group.phases.map((phase) => phase.id),
      currentPhaseId: selectPhases(group.phases.map((phase) => phasesById.get(phase.id)!), pending).currentPhaseId,
    })),
  };
}

async function calculationTeams(db: D1DatabaseBinding, competition: CompetitionSummary): Promise<TeamRow[]> {
  const result = await db.prepare(`
    SELECT t.id, COALESCE(NULLIF(TRIM(st.display_name),''),t.name) AS name,
           NULLIF(TRIM(t.logo_url),'') AS logo_url
      FROM league_competition_teams ct
      JOIN league_season_teams st ON st.id=ct.season_team_id AND st.season_id=?
      JOIN league_teams t ON t.id=st.team_id AND t.organization_id=?
     WHERE ct.competition_id=? AND ct.status='active'
     ORDER BY name COLLATE NOCASE,t.id LIMIT ?
  `).bind(competition.seasonId, competition.organizationId, competition.id, MAX_STANDINGS_TEAMS + 1).all<TeamRow>();
  const rows = result.results ?? [];
  if (rows.length > MAX_STANDINGS_TEAMS) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
  return rows;
}

async function calculationGames(db: D1DatabaseBinding, competitionId: string, phaseId?: string): Promise<ResultRow[]> {
  const result = await db.prepare(`
    SELECT g.id, g.competition_id, g.phase_id, g.schedule_id, g.series_matchup_id,
           g.series_round_number, g.cycle_number, g.round_number, g.game_order,
           g.home_team_id, g.away_team_id, g.home_score, g.away_score,
           g.status, g.result_source, g.scheduled_date, g.scheduled_time, g.round_label,
           ar.id AS administrative_result_id,
           ar.official_home_score AS administrative_home_score,
           ar.official_away_score AS administrative_away_score,
           ar.home_standings_points_override,
           ar.away_standings_points_override
      FROM league_games g
      JOIN league_competitions c ON c.id=g.competition_id
      JOIN league_phases p ON p.id=g.phase_id AND p.competition_id=g.competition_id
        AND p.lifecycle_status IN ('active','finalized')
      LEFT JOIN league_game_administrative_results ar ON ar.game_id=g.id
     WHERE g.competition_id=? AND ${GAME_PARTICIPANTS_VISIBLE_SQL} ${phaseId ? "AND g.phase_id=?" : ""}
     ORDER BY g.id LIMIT ?
  `).bind(competitionId, ...(phaseId ? [phaseId] : []), MAX_CALCULATION_GAMES + 1).all<ResultRow>();
  const rows = result.results ?? [];
  if (rows.length > MAX_CALCULATION_GAMES) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
  return rows.map((row) => projectAdministrativeGameResult(row));
}

async function phaseRoundsWithDb(db: D1DatabaseBinding, competitionId: string, phaseId: string): Promise<PhaseDetail["rounds"]> {
  const roundResult = await db.prepare(`
    SELECT round_number, MAX(round_label) AS label FROM (
      SELECT COALESCE(g.series_round_number,g.round_number) AS round_number,
             NULLIF(TRIM(g.round_label),'') AS round_label
        FROM league_games g
        JOIN league_competitions c ON c.id=g.competition_id
       WHERE g.competition_id=? AND g.phase_id=? AND ${GAME_PARTICIPANTS_VISIBLE_SQL}
      UNION ALL
      SELECT slot.round_number, NULL AS round_label
        FROM league_round_robin_planning_slots slot
        JOIN league_phase_schedules s ON s.id=slot.schedule_id
       WHERE s.competition_id=? AND s.phase_id=?
      UNION ALL
      SELECT slot.series_round_number, NULL AS round_label
        FROM league_series_planning_slots slot
       WHERE slot.competition_id=? AND slot.phase_id=?
    ) WHERE round_number>=1 GROUP BY round_number ORDER BY round_number LIMIT ?
  `).bind(competitionId, phaseId, competitionId, phaseId, competitionId, phaseId, MAX_ROUNDS + 1)
    .all<{ round_number: number; label: string | null }>();
  const rounds = roundResult.results ?? [];
  if (rounds.length > MAX_ROUNDS) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
  return rounds.map((item) => ({ number: Number(item.round_number), label: item.label }));
}

export async function readPhaseDetailWithDb(db: D1DatabaseBinding, competitionId: string, phaseId: string): Promise<PhaseDetail> {
  const competition = await publicCompetition(db, competitionId);
  const { rows, phases } = await phasesForCompetition(db, competitionId);
  const row = rows.find((item) => item.id === phaseId);
  const phase = phases.find((item) => item.id === phaseId);
  if (!row || !phase) throw new MobileCompetitionError("PHASE_NOT_FOUND");
  const { currentPhaseId } = await phaseSelection(db, competitionId, phases);
  const rounds = await phaseRoundsWithDb(db, competitionId, phaseId);
  let matchups: PhaseDetail["matchups"] = [];
  if (phase.format === "series" && bracketMatchupCount(row) > 0) {
    if (bracketMatchupCount(row) > MAX_MATCHUPS) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
    const [teams, games] = await Promise.all([
      calculationTeams(db, competition),
      calculationGames(db, competitionId),
    ]);
    const seriesPhases: SeriesCarryOverPhaseLike[] = rows.map((item) => ({
      ...item,
      rule_settings_json: item.rule_settings_json,
    }));
    const selected = seriesPhases.find((item) => item.id === phaseId);
    const resolution = resolveSeriesCarryOver(seriesPhases, games, teams, selected);
    if (resolution.matchups.length > MAX_MATCHUPS) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
    matchups = resolution.matchups.map((matchup) => ({
      id: matchup.matchupId,
      label: matchup.label,
      teamAId: matchup.teamAId,
      teamBId: matchup.teamBId,
      qualifiedTeamId: matchup.qualifiedTeamId ?? null,
      state: matchup.state,
    }));
  }
  return {
    ...phase,
    isCurrent: phase.id === currentPhaseId,
    rounds,
    matchups,
  };
}

function configuredTieBreakers(settingsJson: string | null): StandingsTieBreakerKey[] | undefined {
  const values = jsonRecord(settingsJson).tieBreakers;
  const allowed: StandingsTieBreakerKey[] = ["head_to_head", "head_to_head_point_diff", "overall_point_diff", "points_for", "alphabetical"];
  if (!Array.isArray(values)) return undefined;
  const configured = values.filter((value): value is StandingsTieBreakerKey => allowed.includes(value as StandingsTieBreakerKey));
  return configured.length ? configured : undefined;
}

export async function readStandingsWithDb(db: D1DatabaseBinding, competitionId: string, phaseId: string): Promise<StandingsRow[]> {
  const competition = await publicCompetition(db, competitionId);
  const { rows } = await phasesForCompetition(db, competitionId);
  const phase = rows.find((item) => item.id === phaseId);
  if (!phase) throw new MobileCompetitionError("PHASE_NOT_FOUND");
  if (!supportsStandings(phase)) throw new MobileCompetitionError("STANDINGS_NOT_AVAILABLE");
  return calculatePhaseStandingsWithDb(db, competition, phase);
}

async function calculatePhaseStandingsWithDb(db: D1DatabaseBinding, competition: CompetitionSummary, phase: PhaseRow): Promise<StandingsRow[]> {
  const phaseId = phase.id;
  const competitionId = competition.id;
  const [teams, games] = await Promise.all([
    calculationTeams(db, competition),
    calculationGames(db, competitionId, phaseId),
  ]);
  const settings = jsonRecord(phase.rule_settings_json);
  const result = calculateStandings({
    phaseId,
    teams: teams.map((team) => ({ id: team.id, name: team.name })),
    games: games.map((game) => ({
      id: game.id,
      phaseId: game.phase_id,
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeScore: game.home_score,
      awayScore: game.away_score,
      status: game.status,
      resultSource: game.result_source,
      homeStandingsPointsOverride: game.home_standings_points_override,
      awayStandingsPointsOverride: game.away_standings_points_override,
    })),
    rules: {
      pointsForWin: Number(settings.pointsForWin ?? settings.winPoints ?? 2),
      pointsForLoss: Number(settings.pointsForLoss ?? settings.lossPoints ?? 1),
    },
    tieBreakers: configuredTieBreakers(phase.rule_settings_json),
  });
  const stats = new Map(result.rows.map((item) => [item.teamId, item]));
  const teamById = new Map(teams.map((item) => [item.id, item]));
  return result.orderedRows.flatMap((ordered): StandingsRow[] => {
    const row = stats.get(ordered.teamId);
    const team = teamById.get(ordered.teamId);
    return row && team ? [{
      rank: ordered.rank,
      teamId: team.id,
      teamName: team.name,
      teamLogoUrl: team.logo_url,
      gamesPlayed: row.gamesPlayed,
      wins: row.wins,
      losses: row.losses,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      pointDifference: row.pointDifference,
      standingsPoints: row.standingsPoints,
    }] : [];
  });
}

type GameRow = {
  id: string;
  competition_id: string;
  phase_id: string;
  round_number: number | null;
  series_round_number: number | null;
  round_label: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  venue_map_url: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_logo_url: string | null;
  away_team_id: string;
  away_team_name: string;
  away_team_logo_url: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  result_source: string | null;
  administrative_result_id: string | null;
  administrative_home_score: number | null;
  administrative_away_score: number | null;
  public_status: GameStatus;
  organization_slug: string;
  sort_date: string;
  sort_time: string;
  sort_phase: number;
  sort_round: number;
  sort_game: number;
};
type CursorKey = [string, string, number, number, number, string];
type CursorPayload = { v: 1; competitionId: string; filters: string; key: CursorKey };

function filterSignature(filters: GameFilters): string {
  const signature = [filters.phaseId ?? null, filters.round ?? null, filters.status ?? null, filters.teamId ?? null];
  // Keep the established ascending cursor signature valid, including when order=asc is explicit.
  const ordered = filters.order === "desc" ? [...signature, "desc"] : signature;
  return JSON.stringify(filters.rootPhaseId ? [...ordered, "root", filters.rootPhaseId] : ordered);
}

function decodeCursor(value: string | undefined, competitionId: string, filters: GameFilters): CursorKey | null {
  if (!value) return null;
  try {
    if (value.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("bad cursor");
    const decoded: CursorPayload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (decoded.v !== 1 || decoded.competitionId !== competitionId || decoded.filters !== filterSignature(filters)
      || !Array.isArray(decoded.key) || decoded.key.length !== 6
      || typeof decoded.key[0] !== "string" || typeof decoded.key[1] !== "string"
      || !decoded.key.slice(2, 5).every((item) => typeof item === "number" && Number.isInteger(item))
      || typeof decoded.key[5] !== "string") throw new Error("bad cursor");
    return decoded.key;
  } catch {
    throw new MobileCompetitionError("INVALID_CURSOR");
  }
}

function encodeCursor(row: GameRow, competitionId: string, filters: GameFilters): string {
  const payload: CursorPayload = {
    v: 1,
    competitionId,
    filters: filterSignature(filters),
    key: [row.sort_date, row.sort_time, row.sort_phase, row.sort_round, row.sort_game, row.id],
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

const GAME_PUBLIC_STATUS = `CASE
  WHEN ar.id IS NOT NULL THEN 'completed'
  WHEN head.lifecycle='live' THEN 'live'
  WHEN g.status='completed' AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL THEN 'completed'
  WHEN g.status IN ('postponed','cancelled') THEN g.status
  ELSE 'scheduled' END`;
const GAME_SORT = [
  "COALESCE(g.scheduled_date,'9999-12-31')",
  "COALESCE(g.scheduled_time,'99:99')",
  "COALESCE(p.phase_order,p.order_index,2147483647)",
  "COALESCE(g.series_round_number,g.round_number,2147483647)",
  "COALESCE(g.game_order,2147483647)",
  "g.id",
];

export async function listGamesWithDb(db: D1DatabaseBinding, competitionId: string, filters: GameFilters): Promise<GameList> {
  const competition = await publicCompetition(db, competitionId);
  const cursor = decodeCursor(filters.cursor, competitionId, filters);
  const group = filters.rootPhaseId
    ? tournamentGroup((await phasesForCompetition(db, competitionId)).groups, filters.rootPhaseId)
    : null;
  if (filters.phaseId) {
    if (group && !group.phases.some((phase) => phase.id === filters.phaseId)) {
      throw new MobileCompetitionError("PHASE_NOT_FOUND");
    }
    const phase = await db.prepare(`SELECT id FROM league_phases
      WHERE id=? AND competition_id=? AND lifecycle_status IN ('active','finalized') LIMIT 1`)
      .bind(filters.phaseId, competitionId).first<{ id: string }>();
    if (!phase) throw new MobileCompetitionError("PHASE_NOT_FOUND");
  }
  if (filters.teamId) {
    const team = await db.prepare(`SELECT t.id FROM league_competition_teams ct
      JOIN league_season_teams st ON st.id=ct.season_team_id AND st.season_id=?
      JOIN league_teams t ON t.id=st.team_id AND t.organization_id=?
      WHERE ct.competition_id=? AND ct.status='active' AND t.id=? LIMIT 1`)
      .bind(competition.seasonId, competition.organizationId, competitionId, filters.teamId).first<{ id: string }>();
    if (!team) throw new MobileCompetitionError("TEAM_NOT_FOUND");
  }
  return queryGamesWithDb(db, competition, filters, {
    cursor, order: filters.order ?? "asc", phaseIds: group?.phases.map((phase) => phase.id),
  });
}

type GameQueryOptions = {
  cursor?: CursorKey | null;
  order?: "asc" | "desc";
  datedOnly?: boolean;
  legacyHomeOrder?: boolean;
  phaseIds?: string[];
};

async function queryGamesWithDb(db: D1DatabaseBinding, competition: CompetitionSummary, filters: GameFilters, options: GameQueryOptions = {}): Promise<GameList> {
  const competitionId = competition.id;
  const { cursor = null, order = "asc", datedOnly = false, legacyHomeOrder = false } = options;
  const conditions = ["g.competition_id=?"];
  const bindings: unknown[] = [competitionId];
  if (options.phaseIds) {
    conditions.push("g.phase_id IN (SELECT value FROM json_each(?))");
    bindings.push(JSON.stringify(options.phaseIds));
  }
  if (filters.phaseId) { conditions.push("g.phase_id=?"); bindings.push(filters.phaseId); }
  if (filters.round) { conditions.push("COALESCE(g.series_round_number,g.round_number)=?"); bindings.push(filters.round); }
  if (filters.status) { conditions.push(`${GAME_PUBLIC_STATUS}=?`); bindings.push(filters.status); }
  if (filters.teamId) { conditions.push("(g.home_team_id=? OR g.away_team_id=?)"); bindings.push(filters.teamId, filters.teamId); }
  if (cursor) { conditions.push(`(${GAME_SORT.join(",")})${order === "asc" ? ">" : "<"}(?,?,?,?,?,?)`); bindings.push(...cursor); }
  if (datedOnly) conditions.push("g.scheduled_date IS NOT NULL");
  const sort = order === "asc" ? GAME_SORT.join(",") : legacyHomeOrder ? [
    "g.scheduled_date DESC", "g.scheduled_time DESC", ...GAME_SORT.slice(2).map((part) => `${part} DESC`),
  ].join(",") : GAME_SORT.map((part) => `${part} DESC`).join(",");
  const result = await db.prepare(`
    SELECT g.id, g.competition_id, g.phase_id, g.round_number, g.series_round_number,
           g.round_label, g.scheduled_date, g.scheduled_time,
           COALESCE(NULLIF(TRIM(v.name),''),NULLIF(TRIM(g.venue),'')) AS venue_name,
           v.address AS venue_address, v.map_url AS venue_map_url,
           home.id AS home_team_id,
           COALESCE(NULLIF(TRIM(home_st.display_name),''),home.name) AS home_team_name,
           NULLIF(TRIM(home.logo_url),'') AS home_team_logo_url,
           away.id AS away_team_id,
           COALESCE(NULLIF(TRIM(away_st.display_name),''),away.name) AS away_team_name,
           NULLIF(TRIM(away.logo_url),'') AS away_team_logo_url,
           g.home_score, g.away_score, g.status, g.result_source,
           ar.id AS administrative_result_id,
           ar.official_home_score AS administrative_home_score,
           ar.official_away_score AS administrative_away_score,
           ${GAME_PUBLIC_STATUS} AS public_status,
           o.slug AS organization_slug,
           ${GAME_SORT[0]} AS sort_date, ${GAME_SORT[1]} AS sort_time,
           ${GAME_SORT[2]} AS sort_phase, ${GAME_SORT[3]} AS sort_round,
           ${GAME_SORT[4]} AS sort_game
      FROM league_games g
      JOIN league_phases p ON p.id=g.phase_id AND p.competition_id=g.competition_id
        AND p.lifecycle_status IN ('active','finalized')
      JOIN league_competitions c ON c.id=g.competition_id
      JOIN league_organizations o ON o.id=c.organization_id
      JOIN league_competition_teams home_ct ON home_ct.competition_id=g.competition_id AND home_ct.status='active'
      JOIN league_season_teams home_st ON home_st.id=home_ct.season_team_id AND home_st.season_id=c.season_id AND home_st.team_id=g.home_team_id
      JOIN league_teams home ON home.id=g.home_team_id AND home.organization_id=c.organization_id
      JOIN league_competition_teams away_ct ON away_ct.competition_id=g.competition_id AND away_ct.status='active'
      JOIN league_season_teams away_st ON away_st.id=away_ct.season_team_id AND away_st.season_id=c.season_id AND away_st.team_id=g.away_team_id
      JOIN league_teams away ON away.id=g.away_team_id AND away.organization_id=c.organization_id
      LEFT JOIN league_competition_venues v ON v.competition_id=g.competition_id AND v.name=g.venue
      LEFT JOIN league_game_administrative_results ar ON ar.game_id=g.id
      LEFT JOIN league_komocontrol_gameplay_game_claims claim ON claim.game_id=g.id
      LEFT JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${sort}
     LIMIT ?
  `).bind(...bindings, filters.limit + 1).all<GameRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > filters.limit;
  const page = rows.slice(0, filters.limit);
  const data: GameSummary[] = page.map((row) => {
    const official = projectAdministrativeGameResult(row);
    const status = row.public_status;
    const livePath = competition.organizationId === PUBLIC_KOMOBASKET_ORGANIZATION_ID
      ? `/competitions/games/${encodeURIComponent(row.id)}/live`
      : hostedCompetitionGamePath(row.organization_slug, row.id, true);
    return {
      id: row.id,
      competitionId: row.competition_id,
      phaseId: row.phase_id,
      round: row.series_round_number ?? row.round_number,
      roundLabel: row.round_label?.trim() || null,
      scheduledDate: row.scheduled_date?.trim() || null,
      scheduledTime: row.scheduled_time?.trim() || null,
      venue: row.venue_name ? { name: row.venue_name, address: row.venue_address?.trim() || null, mapUrl: row.venue_map_url?.trim() || null } : null,
      homeTeam: { id: row.home_team_id, name: row.home_team_name, logoUrl: row.home_team_logo_url },
      awayTeam: { id: row.away_team_id, name: row.away_team_name, logoUrl: row.away_team_logo_url },
      status,
      homeScore: status === "completed" && official.home_score !== null ? Number(official.home_score) : null,
      awayScore: status === "completed" && official.away_score !== null ? Number(official.away_score) : null,
      webLiveUrl: status === "live" ? `https://komobasket.gr${livePath}` : null,
    };
  });
  return {
    data,
    meta: { hasMore, nextCursor: !legacyHomeOrder && hasMore && page.length
      ? encodeCursor(page[page.length - 1], competitionId, filters) : null },
  };
}

export async function readCompetitionHomeWithDb(db: D1DatabaseBinding, competitionId: string, rootPhaseId?: string): Promise<CompetitionHome> {
  const competition = await publicCompetition(db, competitionId);
  const { rows, phases, groups } = await phasesForCompetition(db, competitionId);
  const group = rootPhaseId ? tournamentGroup(groups, rootPhaseId) : null;
  const selectedPhases = group ? phases.filter((phase) => phase.rootPhaseId === group.rootPhaseId) : phases;
  const phaseIds = group?.phases.map((phase) => phase.id);
  const { currentPhaseId, activePhaseIds, currentRoundNumber } = await phaseSelection(db, competitionId, selectedPhases);
  const selected = selectedPhases.find((phase) => phase.id === currentPhaseId);
  const currentPhase = selected ? { ...selected, isCurrent: true } : null;
  const phaseRow = rows.find((row) => row.id === currentPhaseId);
  const [rounds, liveGames, upcomingGames, recentResults, standings] = await Promise.all([
    currentPhaseId && currentRoundNumber !== null ? phaseRoundsWithDb(db, competitionId, currentPhaseId) : Promise.resolve([]),
    queryGamesWithDb(db, competition, { status: "live", limit: 3 }, { phaseIds }).then((result) => result.data),
    queryGamesWithDb(db, competition, { status: "scheduled", limit: 5 }, { datedOnly: true, phaseIds }).then((result) => result.data),
    queryGamesWithDb(db, competition, { status: "completed", limit: 5 }, { order: "desc", legacyHomeOrder: true, phaseIds }).then((result) => result.data),
    phaseRow && supportsStandings(phaseRow)
      ? calculatePhaseStandingsWithDb(db, competition, phaseRow).then((result) => result.slice(0, 5))
      : Promise.resolve(null),
  ]);
  return {
    competition,
    currentPhaseId,
    currentPhase,
    activePhaseIds,
    currentRound: currentRoundNumber === null ? null : rounds.find((round) => round.number === currentRoundNumber) ?? null,
    liveGames,
    upcomingGames,
    recentResults,
    standingsPreview: standings,
  };
}

async function catalogueDb(): Promise<D1DatabaseBinding> {
  const db = (await getKomoBasketCloudflareEnv())?.NEWS_DB;
  if (!db) throw new MobileCompetitionError("CATALOGUE_UNAVAILABLE");
  return db;
}

export async function readCompetitionDetail(competitionId: string) {
  return readCompetitionDetailWithDb(await catalogueDb(), competitionId);
}
export async function readPhaseDetail(competitionId: string, phaseId: string) {
  return readPhaseDetailWithDb(await catalogueDb(), competitionId, phaseId);
}
export async function listGames(competitionId: string, filters: GameFilters) {
  return listGamesWithDb(await catalogueDb(), competitionId, filters);
}
export async function readStandings(competitionId: string, phaseId: string) {
  return readStandingsWithDb(await catalogueDb(), competitionId, phaseId);
}
export async function readCompetitionHome(competitionId: string, rootPhaseId?: string) {
  return readCompetitionHomeWithDb(await catalogueDb(), competitionId, rootPhaseId);
}
