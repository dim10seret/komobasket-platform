import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { requirePhaseAccessWithDb } from "@/lib/platform-authorization";
import { classifySeriesBracketEntry, type SeriesCarryOverGameLike, type SeriesCarryOverPhaseLike, type SeriesCarryOverTeamLike } from "@/lib/series-carry-over";
import { deriveSeriesPhaseCompletion } from "@/lib/series-phase-completion";
import { rankMatchdayMvpPerformances, type MatchdayMvpPerformance } from "@/services/matchday-mvp.service";
import { readAuthoritativePhaseStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type Scope = { phaseId: string; scopeType: "round"; roundNumber: number; matchupId?: never }
  | { phaseId: string; scopeType: "series"; matchupId: string; roundNumber?: never };
type Visibility = "live" | "after_close";
type PhaseRow = SeriesCarryOverPhaseLike & {
  id: string; competition_id: string; format: string; mvp_enabled: number;
  rule_settings_json: string | null;
};
type GameRow = SeriesCarryOverGameLike & {
  id: string; phase_id: string | null; status: string; series_matchup_id: string | null;
  round_number: number | null; result_source: string | null;
};
type Candidate = MatchdayMvpPerformance & { teamId: string };

export class MvpContestError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "SCOPE_NOT_FOUND" | "SCOPE_INCOMPLETE" | "EVIDENCE_REVIEW_REQUIRED" | "NO_ELIGIBLE_PLAYERS" | "CONTEST_CONFLICT" | "OFFICIAL_MVP_EXISTS", readonly status: number) {
    super(code);
    this.name = "MvpContestError";
  }
}

function fail(code: MvpContestError["code"], status = 400): never {
  throw new MvpContestError(code, status);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return record(JSON.parse(value) as unknown); } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validateScope(scope: Scope): void {
  if (!scope.phaseId?.trim()) fail("INVALID_INPUT");
  if (scope.scopeType === "round") {
    if (!Number.isInteger(scope.roundNumber) || scope.roundNumber < 1 || scope.roundNumber > 10000 || scope.matchupId !== undefined) fail("INVALID_INPUT");
  } else if (scope.scopeType === "series") {
    if (!scope.matchupId?.trim() || scope.roundNumber !== undefined) fail("INVALID_INPUT");
  } else fail("INVALID_INPUT");
}

/** Explicit deadlines require an offset. Fixture wall-clock fields are never interpreted as UTC. */
export function mvpClosesAt(input: { durationHours?: number; closesAt?: string }, opensAt: number): number {
  if ((input.durationHours === undefined) === (input.closesAt === undefined)) fail("INVALID_INPUT");
  if (input.durationHours !== undefined) {
    if (!Number.isInteger(input.durationHours) || input.durationHours < 1 || input.durationHours > 168) fail("INVALID_INPUT");
    return opensAt + input.durationHours * 3600;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/.exec(input.closesAt ?? "");
  if (!match) fail("INVALID_INPUT");
  const [, year, month, day, hour, minute, second, , sign, offsetHour, offsetMinute] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, h, min, sec] = parts;
  const wall = Date.UTC(y, m - 1, d, h, min, sec);
  const normalized = new Date(wall);
  if (normalized.getUTCFullYear() !== y || normalized.getUTCMonth() + 1 !== m || normalized.getUTCDate() !== d
    || normalized.getUTCHours() !== h || normalized.getUTCMinutes() !== min || normalized.getUTCSeconds() !== sec) fail("INVALID_INPUT");
  const offsetHours = Number(offsetHour ?? 0);
  const offsetMinutes = Number(offsetMinute ?? 0);
  if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) fail("INVALID_INPUT");
  const offset = (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  const closesAt = wall / 1000 - offset * 60;
  if (closesAt <= opensAt || closesAt > opensAt + 30 * 86400) fail("INVALID_INPUT");
  return closesAt;
}

async function phaseForScope(db: D1DatabaseBinding, actor: CanonicalAppUser | null, scope: Scope, mode: "read" | "manage") {
  validateScope(scope);
  const access = await requirePhaseAccessWithDb(db, actor, scope.phaseId, mode);
  const phase = await db.prepare(`SELECT p.*, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
    FROM league_phases p LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.id=? AND p.competition_id=?`).bind(scope.phaseId, access.competitionId).first<PhaseRow>();
  if (!phase || phase.format !== (scope.scopeType === "round" ? "standings" : "series")) fail("SCOPE_NOT_FOUND", 404);
  return { access, phase };
}

async function scopeGames(db: D1DatabaseBinding, scope: Scope, phase: PhaseRow): Promise<GameRow[]> {
  if (scope.scopeType === "round") {
    const missing = await db.prepare(`SELECT COUNT(*) AS count
      FROM league_round_robin_planning_slots slot
      JOIN league_phase_schedules schedule ON schedule.id=slot.schedule_id
      WHERE schedule.phase_id=? AND slot.round_number=? AND NOT EXISTS (
        SELECT 1 FROM league_games game WHERE game.phase_id=? AND game.schedule_id=slot.schedule_id
          AND game.round_number=slot.round_number AND game.game_order=slot.game_order
      )`).bind(scope.phaseId, scope.roundNumber, scope.phaseId).first<{ count: number }>();
    if (Number(missing?.count ?? 0) > 0) fail("SCOPE_INCOMPLETE", 409);
    const result = await db.prepare(`SELECT game.id, game.phase_id, game.status, game.round_number,
        game.series_matchup_id, game.result_source
      FROM league_games game WHERE game.competition_id=? AND game.phase_id=? AND game.round_number=?
      ORDER BY game.game_order, game.id`).bind(phase.competition_id, scope.phaseId, scope.roundNumber).all<GameRow>();
    const games = result.results ?? [];
    if (!games.length) fail("SCOPE_NOT_FOUND", 404);
    if (games.some((game) => !["completed", "cancelled"].includes(game.status))) fail("SCOPE_INCOMPLETE", 409);
    if (!games.some((game) => game.status === "completed")) fail("NO_ELIGIBLE_PLAYERS", 409);
    return games.filter((game) => game.status === "completed");
  }

  const bracket = record(record(phase.rule_settings_json ?? phase.settings_json).bracketConfiguration);
  const matches = Array.isArray(bracket.matchups) ? bracket.matchups.map(record) : [];
  const selected = matches.filter((matchup) => matchup.id === scope.matchupId);
  if (selected.length !== 1) fail("SCOPE_NOT_FOUND", 404);
  const chosen = selected[0];
  const entry = classifySeriesBracketEntry({
    id: scope.matchupId,
    slotA: record(chosen.slotA) as { type?: string | null },
    slotB: record(chosen.slotB) as { type?: string | null },
  });
  if (entry.kind !== "playable_matchup") fail("NO_ELIGIBLE_PLAYERS", 409);
  const phasesResult = await db.prepare(`SELECT p.*, pr.wins_required, pr.carry_over_enabled,
      pr.carry_over_source_phase_id, pr.settings_json AS rule_settings_json
    FROM league_phases p LEFT JOIN league_phase_rules pr ON pr.phase_id=p.id
    WHERE p.competition_id=?`).bind(phase.competition_id).all<PhaseRow>();
  const gamesResult = await db.prepare(`SELECT * FROM league_games WHERE competition_id=?`)
    .bind(phase.competition_id).all<GameRow>();
  const teamsResult = await db.prepare(`SELECT id, name FROM league_teams WHERE organization_id=(
      SELECT organization_id FROM league_competitions WHERE id=?)`).bind(phase.competition_id).all<SeriesCarryOverTeamLike>();
  const allGames = gamesResult.results ?? [];
  const completion = deriveSeriesPhaseCompletion(phasesResult.results ?? [], allGames, teamsResult.results ?? [], phase);
  const outcome = completion.outcomes.find((item) => item.matchupId === scope.matchupId);
  if (!outcome || outcome.resolution !== "series_winner"
    || completion.blockers.some((item) => item.matchupId === null || item.matchupId === scope.matchupId)) fail("SCOPE_INCOMPLETE", 409);
  const played = allGames.filter((game) => game.phase_id === scope.phaseId && game.series_matchup_id === scope.matchupId && game.status === "completed");
  if (!played.length) fail("NO_ELIGIBLE_PLAYERS", 409);
  return played;
}

async function eligibleCandidates(db: D1DatabaseBinding, scope: Scope, phase: PhaseRow, organizationId: string): Promise<Candidate[]> {
  const games = await scopeGames(db, scope, phase);
  const verified = await readAuthoritativePhaseStatisticalGamesWithDb(db, phase.competition_id, organizationId, [scope.phaseId]);
  const byId = new Map(verified.filter((game) => game.phaseId === scope.phaseId).map((game) => [game.gameId, game]));
  if (games.some((game) => !byId.has(game.id))) fail("EVIDENCE_REVIEW_REQUIRED", 409);
  const source = games.map((game) => byId.get(game.id)!).sort((a, b) => a.gameId.localeCompare(b.gameId)).map((game) => ({
    ...game,
    roundNumber: game.round,
    homePlayers: game.homePlayers.filter((player) => game.participatingPlayerIds.includes(player.canonicalPlayerId)),
    awayPlayers: game.awayPlayers.filter((player) => game.participatingPlayerIds.includes(player.canonicalPlayerId)),
  }));
  const ranks = rankMatchdayMvpPerformances(source);
  const unique = new Map<string, Candidate>();
  for (const performance of ranks) {
    if (unique.has(performance.playerId)) continue;
    const game = source.find((item) => item.gameId === performance.gameId)!;
    const home = game.homePlayers.some((player) => player.canonicalPlayerId === performance.playerId);
    const away = game.awayPlayers.some((player) => player.canonicalPlayerId === performance.playerId);
    if (home === away) fail("EVIDENCE_REVIEW_REQUIRED", 409);
    unique.set(performance.playerId, { ...performance, teamId: home ? game.homeTeamId : game.awayTeamId });
  }
  if (!unique.size) fail("NO_ELIGIBLE_PLAYERS", 409);
  return [...unique.values()];
}

export async function previewMvpCandidatesWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, scope: Scope) {
  const { access, phase } = await phaseForScope(db, actor, scope, "read");
  if (phase.mvp_enabled !== 1) fail("SCOPE_NOT_FOUND", 404);
  const eligible = await eligibleCandidates(db, scope, phase, access.organizationId);
  return { scope, suggested: eligible.slice(0, 5), eligible };
}

export async function setPhaseMvpEnabledWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, phaseId: string, enabled: boolean) {
  if (typeof enabled !== "boolean") fail("INVALID_INPUT");
  await requirePhaseAccessWithDb(db, actor, phaseId, "manage");
  await db.prepare("UPDATE league_phases SET mvp_enabled=? WHERE id=?").bind(enabled ? 1 : 0, phaseId).run();
  return { phaseId, enabled };
}

export type StartMvpContestInput = Scope & {
  candidatePlayerIds: string[];
  durationHours?: number;
  closesAt?: string;
  resultsVisibility?: Visibility;
};

export async function startMvpContestWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, input: StartMvpContestInput) {
  const { access, phase } = await phaseForScope(db, actor, input, "manage");
  if (phase.mvp_enabled !== 1) fail("SCOPE_NOT_FOUND", 404);
  const visibility = input.resultsVisibility ?? "after_close";
  if (visibility !== "live" && visibility !== "after_close") fail("INVALID_INPUT");
  const selectedIds = input.candidatePlayerIds;
  if (!Array.isArray(selectedIds) || selectedIds.length < 1 || selectedIds.length > 32
    || selectedIds.some((id) => typeof id !== "string" || !id.trim())
    || new Set(selectedIds).size !== selectedIds.length) fail("INVALID_INPUT");
  const eligible = await eligibleCandidates(db, input, phase, access.organizationId);
  const byPlayer = new Map(eligible.map((candidate) => [candidate.playerId, candidate]));
  if (selectedIds.some((id) => !byPlayer.has(id))) fail("INVALID_INPUT");
  if (input.scopeType === "round") {
    const official = await db.prepare(`SELECT id FROM league_matchday_mvp_selections
      WHERE competition_id=? AND phase_id=? AND round_number=?`).bind(phase.competition_id, input.phaseId, input.roundNumber).first<{ id: string }>();
    if (official) fail("OFFICIAL_MVP_EXISTS", 409);
  }
  const scopeConflict = input.scopeType === "round"
    ? await db.prepare("SELECT id FROM mvp_contests WHERE phase_id=? AND scope_type='round' AND round_number=?")
      .bind(input.phaseId, input.roundNumber).first<{ id: string }>()
    : await db.prepare("SELECT id FROM mvp_contests WHERE phase_id=? AND scope_type='series' AND matchup_id=?")
      .bind(input.phaseId, input.matchupId).first<{ id: string }>();
  if (scopeConflict) fail("CONTEST_CONFLICT", 409);
  const opensAt = Math.floor(Date.now() / 1000);
  const closesAt = mvpClosesAt(input, opensAt);
  const contestId = `mvp_contest_${crypto.randomUUID()}`;
  const suggestedRanks = new Map(eligible.slice(0, 5).map((candidate, index) => [candidate.playerId, index + 1]));
  const insertContest = db.prepare(`INSERT INTO mvp_contests
      (id, phase_id, scope_type, round_number, matchup_id, selection_method, status, results_visibility,
       opens_at, closes_at, created_by_user_id, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, 'app_poll', 'open', ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM league_phases WHERE id=? AND competition_id=? AND mvp_enabled=1)
      AND NOT EXISTS (SELECT 1 FROM league_matchday_mvp_selections
        WHERE competition_id=? AND phase_id=? AND round_number IS ?)`)
    .bind(contestId, input.phaseId, input.scopeType,
      input.scopeType === "round" ? input.roundNumber : null,
      input.scopeType === "series" ? input.matchupId : null,
      visibility, opensAt, closesAt, actor!.userId, opensAt, opensAt,
      input.phaseId, phase.competition_id, phase.competition_id, input.phaseId,
      input.scopeType === "round" ? input.roundNumber : null);
  const inserts = selectedIds.map((playerId) => {
    const candidate = byPlayer.get(playerId)!;
    const proposalRank = suggestedRanks.get(playerId) ?? null;
    return db.prepare(`INSERT INTO mvp_candidates
        (id, contest_id, player_id, supporting_game_id, team_id, player_name, team_name,
         points, rebounds, assists, efficiency, origin, proposal_rank, added_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`mvp_candidate_${crypto.randomUUID()}`, contestId, playerId, candidate.gameId, candidate.teamId,
        candidate.player.displayName, candidate.teamName, candidate.statistics.points,
        candidate.statistics.rebounds, candidate.statistics.assists, candidate.statistics.efficiency,
        proposalRank === null ? "operator" : "system", proposalRank,
        proposalRank === null ? actor!.userId : null, opensAt);
  });
  try {
    await db.batch([insertContest, ...inserts]);
  } catch (error) {
    if (error instanceof Error && /(?:UNIQUE|FOREIGN KEY) constraint failed/i.test(error.message)) fail("CONTEST_CONFLICT", 409);
    throw error;
  }
  return { id: contestId, phaseId: input.phaseId, scopeType: input.scopeType,
    roundNumber: input.scopeType === "round" ? input.roundNumber : null,
    matchupId: input.scopeType === "series" ? input.matchupId : null,
    status: "open" as const, resultsVisibility: visibility, opensAt, closesAt, serverTime: Math.floor(Date.now() / 1000) };
}
