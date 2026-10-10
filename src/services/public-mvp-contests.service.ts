import "server-only";

import { MOBILE_COMPETITION_VISIBLE_BINDINGS, MOBILE_COMPETITION_VISIBLE_SQL } from "@/services/public-mobile-catalogue.service";
import { readCompetitionDetailWithDb } from "@/services/public-mobile-competition.service";
import { reconcileMvpContestIfDue } from "@/services/mvp-finalization.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

type ContestRow = {
  id: string; phase_id: string; scope_type: "round" | "series"; round_number: number | null;
  matchup_id: string | null; selection_method: "manual" | "app_poll";
  status: "open" | "tie_requires_resolution" | "needs_operator_decision" | "finalized";
  results_visibility: "live" | "after_close"; opens_at: number; closes_at: number;
  finalized_at: number | null; winner_player_id: string | null; body_text: string | null;
  photo_asset_key: string | null; photo_caption: string | null;
  sponsor_name: string | null; gift_description: string | null;
};
type CandidateRow = {
  contest_id: string; id: string; player_id: string; player_name: string; team_id: string;
  team_name: string; points: number; rebounds: number; assists: number; efficiency: number;
  votes: number;
};
type ProjectionRow = ContestRow & {
  server_time: number;
  candidate_id: string | null; candidate_player_id: string | null;
  candidate_player_name: string | null; candidate_team_id: string | null;
  candidate_team_name: string | null; candidate_points: number | null;
  candidate_rebounds: number | null; candidate_assists: number | null;
  candidate_efficiency: number | null; candidate_votes: number;
};

export class PublicMvpContestError extends Error {
  constructor(readonly code: "CONTEXT_NOT_FOUND") { super(code); }
}

/** Public, tournament-scoped MVP feed. This is the only new read that triggers reconciliation. */
export async function readPublicMvpContestsWithDb(db: D1DatabaseBinding, input: {
  organizationId?: string; competitionId: string; rootPhaseId: string;
}) {
  let competition;
  try { competition = await readCompetitionDetailWithDb(db, input.competitionId); }
  catch { throw new PublicMvpContestError("CONTEXT_NOT_FOUND"); }
  if (input.organizationId && competition.organizationId !== input.organizationId) throw new PublicMvpContestError("CONTEXT_NOT_FOUND");
  const organizationId = competition.organizationId;
  const tournament = competition.tournamentGroups.find((group) => group.id === input.rootPhaseId);
  if (!tournament?.phaseIds.length) throw new PublicMvpContestError("CONTEXT_NOT_FOUND");
  const placeholders = tournament.phaseIds.map(() => "?").join(",");
  const openRows = (await db.prepare(`SELECT id FROM mvp_contests
    WHERE phase_id IN (${placeholders}) AND selection_method='app_poll' AND status='open'
    ORDER BY opens_at DESC, id DESC LIMIT 50`).bind(...tournament.phaseIds).all<{ id: string }>()).results ?? [];
  for (const row of openRows) await reconcileMvpContestIfDue(db, row.id);
  const historyRows = (await db.prepare(`SELECT id FROM mvp_contests
    WHERE phase_id IN (${placeholders}) AND selection_method='app_poll' AND status<>'open'
    ORDER BY opens_at DESC, id DESC LIMIT 20`).bind(...tournament.phaseIds).all<{ id: string }>()).results ?? [];
  const ids = [...new Set([...openRows, ...historyRows].map((row) => row.id))];
  const selectedIds = ids.length ? ids : [""];
  const idSlots = selectedIds.map(() => "?").join(",");
  // One SQLite SELECT snapshot authorizes and projects every externally visible value.
  // The recursive lineage rechecks the current canonical root, not a cached phase list.
  const rows = (await db.prepare(`WITH RECURSIVE tournament_phase(id, competition_id) AS (
      SELECT root.id, root.competition_id FROM league_phases root
      WHERE root.id=? AND root.competition_id=?
        AND root.lifecycle_status IN ('active','finalized')
        AND COALESCE(TRIM(root.previous_phase_id),'')=''
      UNION ALL
      SELECT child.id, child.competition_id FROM league_phases child
      JOIN tournament_phase parent ON TRIM(child.previous_phase_id)=parent.id
      WHERE child.competition_id=parent.competition_id
        AND child.lifecycle_status IN ('active','finalized')
    ), authorized AS (
      SELECT c.id AS competition_id, unixepoch('now') AS server_time
      FROM league_competitions c
      JOIN league_seasons s ON s.id=c.season_id
      JOIN league_organizations o ON o.id=c.organization_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
      JOIN tournament_phase root ON root.id=? AND root.competition_id=c.id
      WHERE c.id=? AND c.organization_id=? AND ${MOBILE_COMPETITION_VISIBLE_SQL}
    )
    SELECT authorized.server_time, contest.id, contest.phase_id, contest.scope_type,
      contest.round_number, contest.matchup_id, contest.selection_method, contest.status,
      contest.results_visibility, contest.opens_at, contest.closes_at, contest.finalized_at,
      contest.winner_player_id, contest.body_text, contest.photo_asset_key,
      contest.photo_caption, contest.sponsor_name, contest.gift_description,
      candidate.id AS candidate_id, candidate.player_id AS candidate_player_id,
      candidate.player_name AS candidate_player_name, candidate.team_id AS candidate_team_id,
      candidate.team_name AS candidate_team_name, candidate.points AS candidate_points,
      candidate.rebounds AS candidate_rebounds, candidate.assists AS candidate_assists,
      candidate.efficiency AS candidate_efficiency, COUNT(vote.id) AS candidate_votes
    FROM authorized
    JOIN tournament_phase phase ON phase.competition_id=authorized.competition_id
    LEFT JOIN mvp_contests contest ON contest.phase_id=phase.id
      AND contest.id IN (${idSlots}) AND contest.selection_method='app_poll'
    LEFT JOIN mvp_candidates candidate ON candidate.contest_id=contest.id
    LEFT JOIN mvp_votes vote ON vote.contest_id=candidate.contest_id
      AND vote.candidate_id=candidate.id
    GROUP BY contest.id, candidate.id
    ORDER BY contest.opens_at DESC, contest.id DESC, candidate.created_at, candidate.id`)
    .bind(input.rootPhaseId, input.competitionId, input.rootPhaseId, input.competitionId,
      organizationId, ...MOBILE_COMPETITION_VISIBLE_BINDINGS, ...selectedIds)
    .all<ProjectionRow>()).results ?? [];
  if (!rows.length) throw new PublicMvpContestError("CONTEXT_NOT_FOUND");
  const contestsById = new Map<string, ContestRow>();
  const candidates: CandidateRow[] = [];
  for (const row of rows) {
    if (!row.id) continue;
    contestsById.set(row.id, row);
    if (!row.candidate_id) continue;
    candidates.push({ contest_id: row.id, id: row.candidate_id,
      player_id: row.candidate_player_id!, player_name: row.candidate_player_name!,
      team_id: row.candidate_team_id!, team_name: row.candidate_team_name!,
      points: row.candidate_points!, rebounds: row.candidate_rebounds!,
      assists: row.candidate_assists!, efficiency: row.candidate_efficiency!,
      votes: row.candidate_votes });
  }
  const contests = [...contestsById.values()].sort((left, right) =>
    right.opens_at - left.opens_at || right.id.localeCompare(left.id));
  const feed = contests.map((contest) => {
    const visible = contest.results_visibility === "live" || contest.status === "finalized";
    const items = candidates.filter((candidate) => candidate.contest_id === contest.id);
    const published = contest.status === "finalized";
    return {
      id: contest.id, phaseId: contest.phase_id, scopeType: contest.scope_type,
      roundNumber: contest.round_number, matchupId: contest.matchup_id,
      title: contest.scope_type === "round" ? `Round ${contest.round_number} MVP` : "Series MVP",
      selectionMethod: contest.selection_method, status: contest.status,
      opensAt: contest.opens_at, closesAt: contest.closes_at, finalizedAt: contest.finalized_at,
      resultsVisibility: visible ? "visible" as const : "hidden" as const,
      totalVotes: visible ? items.reduce((sum, candidate) => sum + candidate.votes, 0) : null,
      candidates: items.map((candidate) => ({
        id: candidate.id, playerId: candidate.player_id, playerName: candidate.player_name,
        teamId: candidate.team_id, teamName: candidate.team_name,
        performance: { points: candidate.points, rebounds: candidate.rebounds,
          assists: candidate.assists, efficiency: candidate.efficiency },
        votes: visible ? candidate.votes : null,
      })),
      official: published ? {
        winnerPlayerId: contest.winner_player_id,
        winner: items.find((candidate) => candidate.player_id === contest.winner_player_id)
          ? (() => {
            const winner = items.find((candidate) => candidate.player_id === contest.winner_player_id)!;
            return { playerId: winner.player_id, playerName: winner.player_name,
              teamId: winner.team_id, teamName: winner.team_name,
              performance: { points: winner.points, rebounds: winner.rebounds,
                assists: winner.assists, efficiency: winner.efficiency },
              performanceScope: "supporting_game" as const };
          })() : null,
        bodyText: contest.body_text, photoAssetKey: contest.photo_asset_key,
        photoCaption: contest.photo_caption, sponsorName: contest.sponsor_name,
        giftDescription: contest.gift_description,
      } : null,
    };
  });
  return { organizationId, competitionId: input.competitionId,
    rootPhaseId: input.rootPhaseId, serverTime: rows[0].server_time,
    active: feed.filter((contest) => contest.status === "open"),
    history: feed.filter((contest) => contest.status !== "open") };
}
