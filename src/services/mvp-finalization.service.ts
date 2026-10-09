import "server-only";

import type { CanonicalAppUser } from "@/lib/app-user-identity";
import { requirePhaseAccessWithDb } from "@/lib/platform-authorization";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

type Status = "open" | "tie_requires_resolution" | "needs_operator_decision" | "finalized";
type Contest = {
  id: string; phase_id: string; scope_type: "round" | "series"; round_number: number | null;
  matchup_id: string | null; status: Status; closes_at: number; selection_method: string;
  winner_player_id: string | null; official_matchday_selection_id: string | null;
};
type Tally = { id: string; player_id: string; votes: number };

export class MvpFinalizationError extends Error {
  readonly status: number;
  constructor(readonly code: "CONTEST_NOT_FOUND" | "INVALID_RESOLUTION" | "CONFLICT" | "ALREADY_FINALIZED") {
    super(code);
    this.status = code === "ALREADY_FINALIZED" || code === "CONFLICT" ? 409
      : code === "CONTEST_NOT_FOUND" ? 404 : 400;
  }
}

async function contestById(db: D1DatabaseBinding, id: string): Promise<Contest> {
  const contest = await db.prepare(`SELECT id, phase_id, scope_type, round_number, matchup_id, status,
      closes_at, selection_method, winner_player_id, official_matchday_selection_id
    FROM mvp_contests WHERE id=?`).bind(id).first<Contest>();
  if (!contest) throw new MvpFinalizationError("CONTEST_NOT_FOUND");
  return contest;
}

async function serverTime(db: D1DatabaseBinding): Promise<number> {
  const row = await db.prepare("SELECT unixepoch('now') AS now").first<{ now: number }>();
  if (!Number.isSafeInteger(row?.now)) throw new MvpFinalizationError("CONFLICT");
  return row!.now;
}

async function tally(db: D1DatabaseBinding, id: string): Promise<Tally[]> {
  return (await db.prepare(`SELECT candidate.id, candidate.player_id, COUNT(vote.id) AS votes
    FROM mvp_candidates candidate LEFT JOIN mvp_votes vote
      ON vote.contest_id=candidate.contest_id AND vote.candidate_id=candidate.id
    WHERE candidate.contest_id=? GROUP BY candidate.id, candidate.player_id
    ORDER BY votes DESC, candidate.id`).bind(id).all<Tally>()).results ?? [];
}

function audit(db: D1DatabaseBinding, contestId: string, actorEmail: string, action: string,
  details: Record<string, unknown>): D1PreparedStatement {
  // A zero-row preceding UPDATE makes action NULL and aborts the entire D1 batch.
  return db.prepare(`INSERT INTO league_audit_log
    (id, actor_email, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, CASE WHEN changes()=1 THEN ? ELSE NULL END, 'mvp_contest', ?, ?, datetime('now'))`)
    .bind(`mvp_audit_${crypto.randomUUID()}`, actorEmail, action, contestId, JSON.stringify(details));
}

async function finalizeWinner(db: D1DatabaseBinding, contest: Contest, candidate: Tally,
  expectedStatus: Status, actorEmail: string, reason: string | null): Promise<void> {
  const officialId = contest.scope_type === "round" ? `matchday_mvp_${crypto.randomUUID()}` : null;
  const statements: D1PreparedStatement[] = [];
  if (officialId) {
    statements.push(db.prepare(`INSERT INTO league_matchday_mvp_selections
      (id, organization_id, competition_id, phase_id, round_number, game_id, player_id, created_at, updated_at)
      SELECT ?, competition.organization_id, competition.id, contest.phase_id, contest.round_number,
        candidate.supporting_game_id, candidate.player_id, datetime('now'), datetime('now')
      FROM mvp_contests contest
      JOIN league_phases phase ON phase.id=contest.phase_id
      JOIN league_competitions competition ON competition.id=phase.competition_id
      JOIN mvp_candidates candidate ON candidate.contest_id=contest.id AND candidate.id=?
      JOIN league_games game ON game.id=candidate.supporting_game_id
        AND game.competition_id=competition.id AND game.phase_id=contest.phase_id
        AND game.round_number=contest.round_number AND game.status='completed'
      JOIN league_players player ON player.id=candidate.player_id
        AND player.organization_id=competition.organization_id
      JOIN league_teams team ON team.id=candidate.team_id
        AND team.organization_id=competition.organization_id
        AND team.id IN (game.home_team_id,game.away_team_id)
      WHERE contest.id=? AND contest.scope_type='round' AND contest.status=?
        AND contest.closes_at<=unixepoch('now')
        AND NOT EXISTS (SELECT 1 FROM league_matchday_mvp_selections old
          WHERE old.competition_id=competition.id AND old.phase_id=contest.phase_id
            AND old.round_number=contest.round_number)`)
      .bind(officialId, candidate.id, contest.id, expectedStatus));
  }
  statements.push(db.prepare(`UPDATE mvp_contests SET status='finalized', winner_player_id=?,
      finalized_at=unixepoch('now'), official_matchday_selection_id=?, updated_at=unixepoch('now')
    WHERE id=? AND status=? AND closes_at<=unixepoch('now')
      AND selection_method='app_poll'
      AND EXISTS (SELECT 1 FROM mvp_candidates WHERE id=? AND contest_id=mvp_contests.id AND player_id=?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM league_matchday_mvp_selections
        WHERE id=? AND phase_id=mvp_contests.phase_id AND round_number=mvp_contests.round_number
          AND player_id=?))`)
    .bind(candidate.player_id, officialId, contest.id, expectedStatus, candidate.id, candidate.player_id,
      officialId, officialId, candidate.player_id));
  statements.push(audit(db, contest.id, actorEmail, reason === null ? "mvp_auto_finalized" : "mvp_operator_resolved",
    { candidateId: candidate.id, playerId: candidate.player_id, resolution: reason ?? "unique_vote_winner",
      scopeType: contest.scope_type, officialSelectionId: officialId }));
  await db.batch(statements);
}

/** Called by genuine MVP reads. D1's transaction and guarded UPDATE allow one winning transition. */
export async function reconcileMvpContestIfDue(db: D1DatabaseBinding, id: string): Promise<Contest> {
  const contest = await contestById(db, id);
  if (contest.status !== "open" || contest.selection_method !== "app_poll"
    || contest.closes_at > await serverTime(db)) return contest;
  const votes = await tally(db, id);
  const maximum = votes[0]?.votes ?? 0;
  try {
    if (maximum === 0 || votes.filter((candidate) => candidate.votes === maximum).length > 1) {
      const status: Status = maximum === 0 ? "needs_operator_decision" : "tie_requires_resolution";
      await db.prepare(`UPDATE mvp_contests SET status=?, updated_at=unixepoch('now')
        WHERE id=? AND status='open' AND closes_at<=unixepoch('now')`)
        .bind(status, id).run();
    } else {
      await finalizeWinner(db, contest, votes[0], "open", "", null);
    }
  } catch (error) {
    const current = await contestById(db, id);
    if (current.status === "open") throw error;
  }
  const current = await contestById(db, id);
  if (current.status === "open") throw new MvpFinalizationError("CONFLICT");
  return current;
}

/** Future Platform integration; never exposed through a public route. */
export async function resolveMvpContestWithDb(db: D1DatabaseBinding, actor: CanonicalAppUser | null,
  input: { contestId: string; candidateId: string; reason: string }): Promise<Contest> {
  if (!input.contestId?.trim() || !input.candidateId?.trim()
    || !input.reason?.trim() || input.reason.trim().length > 1000) throw new MvpFinalizationError("INVALID_RESOLUTION");
  let contest = await contestById(db, input.contestId);
  await requirePhaseAccessWithDb(db, actor, contest.phase_id, "manage");
  contest = await reconcileMvpContestIfDue(db, input.contestId);
  if (contest.status === "finalized") throw new MvpFinalizationError("ALREADY_FINALIZED");
  if (contest.status !== "tie_requires_resolution" && contest.status !== "needs_operator_decision") {
    throw new MvpFinalizationError("INVALID_RESOLUTION");
  }
  const votes = await tally(db, contest.id);
  const candidate = votes.find((item) => item.id === input.candidateId);
  if (!candidate || (contest.status === "tie_requires_resolution"
    && (candidate.votes === 0 || candidate.votes !== votes[0].votes))) {
    throw new MvpFinalizationError("INVALID_RESOLUTION");
  }
  try {
    await finalizeWinner(db, contest, candidate, contest.status, actor!.email, input.reason.trim());
  } catch (error) {
    const current = await contestById(db, contest.id);
    if (current.status === "finalized") throw new MvpFinalizationError("ALREADY_FINALIZED");
    throw error;
  }
  return contestById(db, contest.id);
}
