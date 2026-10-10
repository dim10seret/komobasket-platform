import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { requireOrganizationAccessWithDb, requirePhaseAccessWithDb } from "@/lib/platform-authorization";
import { mvpClosesAt, previewMvpCandidatesWithDb, setPhaseMvpEnabledWithDb, startMvpContestWithDb, type StartMvpContestInput } from "@/services/mvp-contest.service";
import { reconcileMvpContestIfDue, resolveMvpContestWithDb } from "@/services/mvp-finalization.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type Phase = { id: string; competition_id: string; name: string; format: string; previous_phase_id: string | null; tournament_name: string | null; mvp_enabled: number };
type Contest = { id: string; phase_id: string; scope_type: "round" | "series"; round_number: number | null; matchup_id: string | null;
  status: string; selection_method: string; results_visibility: "live" | "after_close"; opens_at: number; closes_at: number;
  finalized_at: number | null; winner_player_id: string | null; competition_name: string; phase_name: string };
type CandidateRow = { id: string; contest_id: string; player_id: string; player_name: string; team_name: string; votes: number };
type OccupiedScope = { phase_id: string; scope_type: "round" | "series"; round_number: number | null; matchup_id: string | null };

export class PlatformMvpError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONTEST_NOT_FOUND" | "CONTEST_NOT_OPEN" | "CONTEST_CONFLICT", readonly status: number) {
    super(code); this.name = "PlatformMvpError";
  }
}
const invalid = (): never => { throw new PlatformMvpError("INVALID_INPUT", 400); };
const conflict = (): never => { throw new PlatformMvpError("CONTEST_CONFLICT", 409); };

async function ownedContest(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string, contestId: string, mode: "read" | "manage") {
  if (!contestId?.trim()) invalid();
  const contest = await db.prepare("SELECT id, phase_id, scope_type, round_number, matchup_id, status, selection_method, opens_at, closes_at FROM mvp_contests WHERE id=?")
    .bind(contestId).first<Pick<Contest, "id" | "phase_id" | "scope_type" | "round_number" | "matchup_id" | "status" | "selection_method" | "opens_at" | "closes_at">>();
  if (!contest) throw new PlatformMvpError("CONTEST_NOT_FOUND", 404);
  const access = await requirePhaseAccessWithDb(db, actor, contest.phase_id, mode);
  if (access.organizationId !== organizationId) throw new PlatformMvpError("CONTEST_NOT_FOUND", 404);
  return contest;
}

async function openContest(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string, id: string) {
  const contest = await ownedContest(db, actor, organizationId, id, "manage");
  const current = await reconcileMvpContestIfDue(db, id);
  if (current.status !== "open" || contest.selection_method !== "app_poll") throw new PlatformMvpError("CONTEST_NOT_OPEN", 409);
  return contest;
}

export async function readPlatformMvpWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string) {
  const access = await requireOrganizationAccessWithDb(db, actor, organizationId, "read");
  const competitions = (await db.prepare(`SELECT c.id, c.name, s.name AS season_name
    FROM league_competitions c JOIN league_seasons s ON s.id=c.season_id
    WHERE c.organization_id=? ORDER BY s.starts_on DESC, c.name`).bind(organizationId).all<{ id: string; name: string; season_name: string }>()).results ?? [];
  const phases = (await db.prepare(`SELECT p.id,p.competition_id,p.name,p.format,p.previous_phase_id,p.tournament_name,p.mvp_enabled
    FROM league_phases p JOIN league_competitions c ON c.id=p.competition_id
    WHERE c.organization_id=? ORDER BY p.competition_id,p.order_index,p.id`).bind(organizationId).all<Phase>()).results ?? [];
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  const phaseViews = phases.filter((phase) => phase.format === "standings" || phase.format === "series").map((phase) => {
    let root = phase;
    const seen = new Set([root.id]);
    while (root.previous_phase_id && byId.get(root.previous_phase_id)?.competition_id === phase.competition_id && !seen.has(root.previous_phase_id)) {
      root = byId.get(root.previous_phase_id)!; seen.add(root.id);
    }
    return { ...phase, tournamentId: root.id, tournamentName: root.tournament_name || root.name };
  });
  const scopes = (await db.prepare(`WITH scoped_games AS (
      SELECT g.phase_id,g.round_number,g.series_matchup_id,
        MAX(NULLIF(TRIM(g.round_label),'')) OVER (
          PARTITION BY g.phase_id,g.round_number,g.series_matchup_id) AS round_label,
        COALESCE(NULLIF(TRIM(home_season.display_name),''),home.name) AS home_team_name,
        COALESCE(NULLIF(TRIM(away_season.display_name),''),away.name) AS away_team_name,
        ROW_NUMBER() OVER (PARTITION BY g.phase_id,g.round_number,g.series_matchup_id
          ORDER BY CASE WHEN g.status='completed' THEN 0 ELSE 1 END,g.series_round_number,g.id) AS scope_rank
      FROM league_games g JOIN league_competitions c ON c.id=g.competition_id
      LEFT JOIN league_teams home ON home.id=g.home_team_id AND home.organization_id=c.organization_id
      LEFT JOIN league_teams away ON away.id=g.away_team_id AND away.organization_id=c.organization_id
      LEFT JOIN league_season_teams home_season ON home_season.season_id=c.season_id AND home_season.team_id=home.id
      LEFT JOIN league_season_teams away_season ON away_season.season_id=c.season_id AND away_season.team_id=away.id
      WHERE c.organization_id=? AND g.phase_id IS NOT NULL
    ) SELECT phase_id,round_number,series_matchup_id,round_label,home_team_name,away_team_name
      FROM scoped_games WHERE scope_rank=1 ORDER BY phase_id,round_number,series_matchup_id`).bind(organizationId)
    .all<{ phase_id: string; round_number: number | null; series_matchup_id: string | null; round_label: string | null;
      home_team_name: string | null; away_team_name: string | null }>()).results ?? [];
  const occupiedScopes = (await db.prepare(`SELECT m.phase_id,m.scope_type,m.round_number,m.matchup_id
    FROM mvp_contests m JOIN league_phases p ON p.id=m.phase_id JOIN league_competitions c ON c.id=p.competition_id
    WHERE c.organization_id=?`).bind(organizationId).all<OccupiedScope>()).results ?? [];
  const contests = (await db.prepare(`SELECT m.id,m.phase_id,m.scope_type,m.round_number,m.matchup_id,m.status,m.selection_method,
      m.results_visibility,m.opens_at,m.closes_at,m.finalized_at,m.winner_player_id,
      c.name AS competition_name,p.name AS phase_name
    FROM mvp_contests m JOIN league_phases p ON p.id=m.phase_id JOIN league_competitions c ON c.id=p.competition_id
    WHERE c.organization_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100`).bind(organizationId).all<Contest>()).results ?? [];
  // Platform is an authenticated MVP backend read: use the existing lazy finalizer for due contests.
  const clock = await db.prepare("SELECT unixepoch('now') AS now").first<{ now: number }>();
  for (const contest of contests) if (contest.status === "open" && contest.closes_at <= Number(clock?.now)) {
    const current = await reconcileMvpContestIfDue(db, contest.id);
    if (current.status !== "open") {
      const refreshed = await db.prepare("SELECT status,finalized_at,winner_player_id FROM mvp_contests WHERE id=?")
        .bind(contest.id).first<Pick<Contest, "status" | "finalized_at" | "winner_player_id">>();
      if (refreshed) Object.assign(contest, refreshed);
    }
  }
  const candidates = (await db.prepare(`SELECT a.id,a.contest_id,a.player_id,a.player_name,a.team_name,COUNT(v.id) AS votes
    FROM mvp_candidates a JOIN mvp_contests m ON m.id=a.contest_id
    JOIN league_phases p ON p.id=m.phase_id JOIN league_competitions c ON c.id=p.competition_id
    LEFT JOIN mvp_votes v ON v.contest_id=a.contest_id AND v.candidate_id=a.id
    WHERE c.organization_id=? GROUP BY a.id ORDER BY a.created_at,a.id`).bind(organizationId).all<CandidateRow>()).results ?? [];
  const byContest = new Map<string, CandidateRow[]>();
  for (const candidate of candidates) byContest.set(candidate.contest_id, [...(byContest.get(candidate.contest_id) ?? []), candidate]);
  return { competitions, phases: phaseViews, scopes, occupiedScopes, contests: contests.map((contest) => ({ ...contest,
    candidates: (byContest.get(contest.id) ?? []).map((candidate) => ({ ...candidate,
      votes: access.role === "viewer" ? null : Number(candidate.votes) })),
    totalVotes: access.role === "viewer" ? null : (byContest.get(contest.id) ?? []).reduce((sum, candidate) => sum + Number(candidate.votes), 0) })) };
}

export async function previewPlatformMvpWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  scope: StartMvpContestInput) {
  const access = await requirePhaseAccessWithDb(db, actor, scope.phaseId, "read");
  if (access.organizationId !== organizationId) throw new PlatformMvpError("CONTEST_NOT_FOUND", 404);
  return previewMvpCandidatesWithDb(db, actor, scope);
}

export async function startPlatformMvpWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  input: StartMvpContestInput) {
  const access = await requirePhaseAccessWithDb(db, actor, input.phaseId, "manage");
  if (access.organizationId !== organizationId) throw new PlatformMvpError("CONTEST_NOT_FOUND", 404);
  return startMvpContestWithDb(db, actor, input);
}

export async function setPlatformPhaseMvpWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  phaseId: string, enabled: boolean) {
  const access = await requirePhaseAccessWithDb(db, actor, phaseId, "manage");
  if (access.organizationId !== organizationId) throw new PlatformMvpError("CONTEST_NOT_FOUND", 404);
  return setPhaseMvpEnabledWithDb(db, actor, phaseId, enabled);
}

export async function addPlatformMvpCandidateWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  contestId: string, playerId: string) {
  if (!playerId?.trim()) invalid();
  const contest = await openContest(db, actor, organizationId, contestId);
  const scope = contest.scope_type === "round"
    ? { phaseId: contest.phase_id, scopeType: "round" as const, roundNumber: contest.round_number! }
    : { phaseId: contest.phase_id, scopeType: "series" as const, matchupId: contest.matchup_id! };
  const eligible = (await previewMvpCandidatesWithDb(db, actor, scope)).eligible.find((candidate) => candidate.playerId === playerId);
  if (!eligible) throw new PlatformMvpError("INVALID_INPUT", 400);
  const id = `mvp_candidate_${crypto.randomUUID()}`;
  const statements = [db.prepare(`INSERT INTO mvp_candidates
      (id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,points,rebounds,assists,efficiency,origin,added_by_user_id,created_at)
      SELECT ?,m.id,?,?,?,?,?,?,?,?,?,'operator',?,unixepoch('now') FROM mvp_contests m
      JOIN league_phases p ON p.id=m.phase_id AND p.mvp_enabled=1
      WHERE m.id=? AND m.status='open' AND m.closes_at>unixepoch('now') AND m.selection_method='app_poll'
        AND (SELECT COUNT(*) FROM mvp_candidates WHERE contest_id=m.id)<32`)
    .bind(id, eligible.playerId, eligible.gameId, eligible.teamId, eligible.player.displayName,
      eligible.teamName, eligible.statistics.points, eligible.statistics.rebounds, eligible.statistics.assists,
      eligible.statistics.efficiency, actor!.userId, contestId),
    db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      VALUES (?, ?, CASE WHEN changes()=1 THEN 'mvp_candidate_added' ELSE NULL END,'mvp_contest',?,?,datetime('now'))`)
      .bind(`mvp_audit_${crypto.randomUUID()}`, actor!.email, contestId, JSON.stringify({ candidateId: id, playerId }))];
  try { await db.batch(statements); } catch (error) {
    if (error instanceof Error && /(?:UNIQUE|NOT NULL|FOREIGN KEY) constraint failed/i.test(error.message)) conflict();
    throw error;
  }
  return { id, contestId, playerId };
}

export async function updatePlatformMvpContestWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  input: { contestId: string; closesAt?: string; resultsVisibility?: "live" | "after_close" }) {
  if ((input.closesAt === undefined) === (input.resultsVisibility === undefined)) invalid();
  const contest = await openContest(db, actor, organizationId, input.contestId);
  if (input.resultsVisibility !== undefined && !["live", "after_close"].includes(input.resultsVisibility)) invalid();
  const closesAt = input.closesAt === undefined ? null : mvpClosesAt({ closesAt: input.closesAt }, contest.opens_at);
  const update = input.closesAt !== undefined
    ? db.prepare(`UPDATE mvp_contests SET closes_at=?,updated_at=unixepoch('now')
      WHERE id=? AND status='open' AND selection_method='app_poll' AND closes_at>unixepoch('now') AND ?>unixepoch('now')`)
      .bind(closesAt, input.contestId, closesAt)
    : db.prepare(`UPDATE mvp_contests SET results_visibility=?,updated_at=unixepoch('now')
      WHERE id=? AND status='open' AND selection_method='app_poll' AND closes_at>unixepoch('now')`)
      .bind(input.resultsVisibility, input.contestId);
  const audit = db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json,created_at)
    VALUES (?,?,CASE WHEN changes()=1 THEN 'mvp_contest_updated' ELSE NULL END,'mvp_contest',?,?,datetime('now'))`)
    .bind(`mvp_audit_${crypto.randomUUID()}`, actor!.email, input.contestId, JSON.stringify({ closesAt, resultsVisibility: input.resultsVisibility }));
  try { await db.batch([update, audit]); } catch (error) {
    if (error instanceof Error && /NOT NULL constraint failed/i.test(error.message)) conflict();
    throw error;
  }
  return { contestId: input.contestId, closesAt, resultsVisibility: input.resultsVisibility };
}

export async function resolvePlatformMvpWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null, organizationId: string,
  input: { contestId: string; candidateId: string; reason: string }) {
  await ownedContest(db, actor, organizationId, input.contestId, "manage");
  return resolveMvpContestWithDb(db, actor, input);
}
