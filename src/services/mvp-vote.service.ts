import "server-only";

import {
  MOBILE_COMPETITION_VISIBLE_BINDINGS,
  MOBILE_COMPETITION_VISIBLE_SQL,
} from "@/services/public-mobile-catalogue.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type VerifiedApplicationCredential = Readonly<{
  credentialId: string;
  contestId: string;
  candidateId: string;
  platform: "android" | "ios";
  publicKeySha256: string;
  challengeHash: string;
  assertionCounter: number | null;
}>;

/** MVP2B must supply a real Play Integrity or App Attest verifier. There is no default verifier. */
export type MvpVoteVerifier = {
  verify(input: { contestId: string; candidateId: string; evidence: unknown }): Promise<VerifiedApplicationCredential>;
};

export class MvpVoteError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "UNVERIFIED_VOTER" | "CONTEST_UNAVAILABLE" | "ALREADY_VOTED") {
    super(code);
    this.name = "MvpVoteError";
  }
}

type VoteRow = { id: string; candidate_id: string; accepted_at: number };
type ContestRow = { status: string; results_visibility: "live" | "after_close" };

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validVerifiedCredential(value: unknown): value is VerifiedApplicationCredential {
  if (!value || typeof value !== "object") return false;
  const credential = value as Partial<VerifiedApplicationCredential>;
  return validId(credential.credentialId) && validHash(credential.publicKeySha256)
    && validHash(credential.challengeHash)
    && (credential.platform === "android" && credential.assertionCounter === null
      || credential.platform === "ios" && Number.isSafeInteger(credential.assertionCounter)
        && Number(credential.assertionCounter) > 0);
}

async function existingVote(db: D1DatabaseBinding, contestId: string, credential: VerifiedApplicationCredential) {
  return db.prepare(`SELECT vote.id, vote.candidate_id, vote.accepted_at
    FROM mvp_votes vote JOIN anonymous_voter_credentials voter ON voter.id=vote.voter_credential_id
    WHERE vote.contest_id=? AND voter.id=? AND voter.verification_status='verified'
      AND voter.platform=? AND voter.public_key_sha256=?`)
    .bind(contestId, credential.credentialId, credential.platform, credential.publicKeySha256).first<VoteRow>();
}

/** Internal only. A future route must first provide a server-side evidence verifier. */
export async function castMvpVoteWithDb(db: D1DatabaseBinding, verifier: MvpVoteVerifier, input: {
  contestId: string; candidateId: string; evidence: unknown;
}) {
  if (!validId(input?.contestId) || !validId(input?.candidateId)) throw new MvpVoteError("INVALID_INPUT");
  if (!verifier || typeof verifier.verify !== "function") throw new MvpVoteError("UNVERIFIED_VOTER");
  const credential = await verifier.verify(input);
  if (!validVerifiedCredential(credential) || credential.contestId !== input.contestId
    || credential.candidateId !== input.candidateId) throw new MvpVoteError("UNVERIFIED_VOTER");

  const previous = await existingVote(db, input.contestId, credential);
  if (previous) {
    if (previous.candidate_id !== input.candidateId) throw new MvpVoteError("ALREADY_VOTED");
    return { id: previous.id, contestId: input.contestId, candidateId: previous.candidate_id,
      acceptedAt: previous.accepted_at, existing: true };
  }

  const id = `mvp_vote_${crypto.randomUUID()}`;
  const provider = credential.platform === "android" ? "play_integrity" : "app_attest";
  // The INSERT itself checks every eligibility condition against current DB/server time.
  // The batch also consumes the one outstanding challenge (and advances an iOS counter) atomically.
  const insert = db.prepare(`INSERT INTO mvp_votes (id, contest_id, candidate_id, voter_credential_id, accepted_at)
    SELECT ?, contest.id, candidate.id, voter.id, unixepoch('now')
    FROM mvp_contests contest
    JOIN mvp_candidates candidate ON candidate.contest_id=contest.id AND candidate.id=?
    JOIN league_phases phase ON phase.id=contest.phase_id
    JOIN anonymous_voter_credentials voter ON voter.id=?
    WHERE contest.id=? AND contest.selection_method='app_poll' AND contest.status='open'
      AND contest.opens_at<=unixepoch('now') AND contest.closes_at>unixepoch('now')
      AND phase.mvp_enabled=1 AND voter.verification_status='verified'
      AND voter.platform=? AND voter.attestation_provider=? AND voter.public_key_sha256=?
      AND voter.challenge_hash=? AND voter.challenge_expires_at>unixepoch('now')
      AND (? IS NULL OR (voter.platform='ios' AND ?>voter.assertion_counter))
      AND EXISTS (
        SELECT 1 FROM league_competitions c
        JOIN league_seasons s ON s.id=c.season_id
        JOIN league_organizations o ON o.id=c.organization_id
        LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
        WHERE c.id=phase.competition_id AND ${MOBILE_COMPETITION_VISIBLE_SQL}
      )
      AND NOT EXISTS (SELECT 1 FROM mvp_votes old
        WHERE old.contest_id=contest.id AND old.voter_credential_id=voter.id)`)
    .bind(id, input.candidateId, credential.credentialId, input.contestId, credential.platform,
      provider, credential.publicKeySha256, credential.challengeHash,
      credential.assertionCounter, credential.assertionCounter,
      ...MOBILE_COMPETITION_VISIBLE_BINDINGS);
  const consume = db.prepare(`UPDATE anonymous_voter_credentials
    SET challenge_hash=NULL, challenge_expires_at=NULL,
      assertion_counter=CASE WHEN platform='ios' THEN ? ELSE assertion_counter END,
      updated_at=unixepoch('now')
    WHERE id=? AND challenge_hash=? AND EXISTS (SELECT 1 FROM mvp_votes WHERE id=?)`)
    .bind(credential.assertionCounter, credential.credentialId, credential.challengeHash, id);

  try {
    await db.batch([insert, consume]);
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE constraint failed/i.test(error.message)) throw error;
  }
  const accepted = await db.prepare("SELECT id, candidate_id, accepted_at FROM mvp_votes WHERE id=?")
    .bind(id).first<VoteRow>();
  if (accepted) return { id: accepted.id, contestId: input.contestId,
    candidateId: accepted.candidate_id, acceptedAt: accepted.accepted_at, existing: false };
  const raced = await existingVote(db, input.contestId, credential);
  if (raced) {
    if (raced.candidate_id !== input.candidateId) throw new MvpVoteError("ALREADY_VOTED");
    return { id: raced.id, contestId: input.contestId, candidateId: raced.candidate_id,
      acceptedAt: raced.accepted_at, existing: true };
  }
  throw new MvpVoteError("CONTEST_UNAVAILABLE");
}

/** No public API exists in MVP2A; hidden contests never run the grouped count query. */
export async function readMvpVoteResultsWithDb(db: D1DatabaseBinding, contestId: string) {
  if (!validId(contestId)) throw new MvpVoteError("INVALID_INPUT");
  const contest = await db.prepare("SELECT status, results_visibility FROM mvp_contests WHERE id=?")
    .bind(contestId).first<ContestRow>();
  if (!contest) throw new MvpVoteError("CONTEST_UNAVAILABLE");
  if (contest.results_visibility === "after_close" && contest.status !== "finalized") {
    return { contestId, visibility: "hidden" as const };
  }
  const rows = (await db.prepare(`SELECT candidate.id AS candidate_id, COUNT(vote.id) AS votes
    FROM mvp_candidates candidate LEFT JOIN mvp_votes vote
      ON vote.contest_id=candidate.contest_id AND vote.candidate_id=candidate.id
    WHERE candidate.contest_id=? GROUP BY candidate.id ORDER BY candidate.id`)
    .bind(contestId).all<{ candidate_id: string; votes: number }>()).results ?? [];
  return { contestId, visibility: "visible" as const,
    totalVotes: rows.reduce((total, row) => total + row.votes, 0),
    candidates: rows.map((row) => ({ candidateId: row.candidate_id, votes: row.votes })) };
}
