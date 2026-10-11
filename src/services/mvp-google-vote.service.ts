import "server-only";

import { MOBILE_COMPETITION_VISIBLE_BINDINGS, MOBILE_COMPETITION_VISIBLE_SQL } from
  "@/services/public-mobile-catalogue.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export class MvpGoogleVoteError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONTEST_UNAVAILABLE" | "ALREADY_VOTED") {
    super(code);
  }
}

export function validMvpGoogleVoteId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

type VoterSession = { voterId: string; tokenHash: string };
type Ballot = { candidate_id: string; accepted_at: number };

async function ballot(db: D1DatabaseBinding, contestId: string, voterId: string) {
  return db.prepare(`SELECT candidate_id, accepted_at FROM mvp_google_votes
    WHERE contest_id=? AND voter_id=?`).bind(contestId, voterId).first<Ballot>();
}

/** A candidate is the canonical immutable snapshot admitted to this contest by Platform. */
export async function castMvpGoogleVoteWithDb(db: D1DatabaseBinding, session: VoterSession,
  input: { contestId: string; candidateId: string }) {
  if (!validMvpGoogleVoteId(input?.contestId) || !validMvpGoogleVoteId(input?.candidateId)) {
    throw new MvpGoogleVoteError("INVALID_INPUT");
  }
  const prior = await ballot(db, input.contestId, session.voterId);
  if (prior) {
    if (prior.candidate_id !== input.candidateId) throw new MvpGoogleVoteError("ALREADY_VOTED");
    return { contestId: input.contestId, candidateId: prior.candidate_id,
      acceptedAt: prior.accepted_at, alreadyVoted: true };
  }

  const id = `mvp_google_vote_${crypto.randomUUID()}`;
  // This is the authoritative eligibility check. A preliminary read cannot authorize a ballot.
  const insert = db.prepare(`INSERT INTO mvp_google_votes (id,contest_id,candidate_id,voter_id,accepted_at)
    SELECT ?, contest.id, candidate.id, voter.id, unixepoch('now')
    FROM mvp_contests contest
    JOIN mvp_candidates candidate ON candidate.contest_id=contest.id AND candidate.id=?
    JOIN league_phases phase ON phase.id=contest.phase_id AND phase.mvp_enabled=1
    JOIN league_competitions c ON c.id=phase.competition_id
    JOIN league_seasons s ON s.id=c.season_id
    JOIN league_organizations o ON o.id=c.organization_id
    LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
    JOIN mvp_google_voters voter ON voter.id=?
    JOIN mvp_google_sessions session ON session.voter_id=voter.id AND session.token_hash=?
      AND session.kind='voter' AND session.revoked_at IS NULL
      AND session.expires_at>unixepoch('now')
    WHERE contest.id=? AND contest.selection_method='app_poll' AND contest.status='open'
      AND contest.opens_at<=unixepoch('now') AND contest.closes_at>unixepoch('now')
      AND ${MOBILE_COMPETITION_VISIBLE_SQL}
      AND NOT EXISTS (SELECT 1 FROM mvp_google_votes previous
        WHERE previous.contest_id=contest.id AND previous.voter_id=voter.id)`)
    .bind(id, input.candidateId, session.voterId, session.tokenHash, input.contestId,
      ...MOBILE_COMPETITION_VISIBLE_BINDINGS);
  try {
    await insert.run();
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
  }
  const accepted = await db.prepare(`SELECT candidate_id, accepted_at FROM mvp_google_votes WHERE id=?`)
    .bind(id).first<Ballot>();
  if (accepted) return { contestId: input.contestId, candidateId: accepted.candidate_id,
    acceptedAt: accepted.accepted_at, alreadyVoted: false };
  const raced = await ballot(db, input.contestId, session.voterId);
  if (raced) {
    if (raced.candidate_id !== input.candidateId) throw new MvpGoogleVoteError("ALREADY_VOTED");
    return { contestId: input.contestId, candidateId: raced.candidate_id,
      acceptedAt: raced.accepted_at, alreadyVoted: true };
  }
  throw new MvpGoogleVoteError("CONTEST_UNAVAILABLE");
}

export async function readMyMvpGoogleVoteWithDb(db: D1DatabaseBinding, voterId: string, contestId: string) {
  if (!validMvpGoogleVoteId(contestId)) throw new MvpGoogleVoteError("INVALID_INPUT");
  const visible = await db.prepare(`SELECT contest.id FROM mvp_contests contest
    JOIN league_phases phase ON phase.id=contest.phase_id
    JOIN league_competitions c ON c.id=phase.competition_id
    JOIN league_seasons s ON s.id=c.season_id
    JOIN league_organizations o ON o.id=c.organization_id
    LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
    WHERE contest.id=? AND contest.selection_method='app_poll'
      AND ${MOBILE_COMPETITION_VISIBLE_SQL}`)
    .bind(contestId, ...MOBILE_COMPETITION_VISIBLE_BINDINGS).first<{ id: string }>();
  if (!visible) throw new MvpGoogleVoteError("CONTEST_UNAVAILABLE");
  const prior = await ballot(db, contestId, voterId);
  return { contestId, voted: Boolean(prior), candidateId: prior?.candidate_id ?? null };
}
