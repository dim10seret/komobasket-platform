import "server-only";

import { MVP_CHALLENGE_TTL_SECONDS, MVP_GUEST_PROTOCOL_VERSION, mvpRequestHash,
  newChallenge, parseP256PublicKey, verifyMvpSignature, type MvpGuestAction } from "@/services/mvp-guest-crypto";
import { readMobileCompetitionWithDb } from "@/services/public-mobile-catalogue.service";
import { castMvpVoteWithDb } from "@/services/mvp-vote.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export class MvpGuestError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONTEST_UNAVAILABLE" | "CREDENTIAL_UNAVAILABLE"
    | "CHALLENGE_CONFLICT" | "INVALID_PROOF") {
    super(code);
    this.name = "MvpGuestError";
  }
}

export type MvpIntegrityVerifier = { verify(token: string, requestHash: string): Promise<void> };
type Contest = { competition_id: string };
type Credential = {
  id: string; platform: string; public_key_spki: string; public_key_sha256: string;
  verification_status: string; challenge_hash: string | null; challenge_expires_at: number | null;
};
type ChallengeInput = { action: MvpGuestAction; contestId: string; candidateId: string; publicKeySpki: string };
type ProofInput = { contestId: string; candidateId: string; credentialId: string;
  challenge: string; signature: string; integrityToken: string };

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value);
}

function validProof(input: ProofInput): boolean {
  return !!input && validId(input.contestId) && validId(input.candidateId)
    && validId(input.credentialId) && typeof input.challenge === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(input.challenge)
    && typeof input.signature === "string" && input.signature.length <= 128
    && typeof input.integrityToken === "string" && input.integrityToken.length >= 20
    && input.integrityToken.length <= 16_384;
}

export class MvpGuestVotingService {
  constructor(private readonly db: D1DatabaseBinding, private readonly integrity: MvpIntegrityVerifier) {}

  private async contest(contestId: string, candidateId: string): Promise<Contest> {
    const row = await this.db.prepare(`SELECT phase.competition_id
      FROM mvp_contests contest
      JOIN league_phases phase ON phase.id=contest.phase_id AND phase.mvp_enabled=1
      JOIN mvp_candidates candidate ON candidate.contest_id=contest.id AND candidate.id=?
      WHERE contest.id=? AND contest.selection_method='app_poll' AND contest.status='open'
        AND contest.opens_at<=unixepoch('now') AND contest.closes_at>unixepoch('now')`)
      .bind(candidateId, contestId).first<Contest>();
    if (!row || !await readMobileCompetitionWithDb(this.db, row.competition_id)) {
      throw new MvpGuestError("CONTEST_UNAVAILABLE");
    }
    return row;
  }

  async issueChallenge(input: ChallengeInput) {
    if (!input || (input.action !== "register" && input.action !== "vote")
      || !validId(input.contestId) || !validId(input.candidateId)
      || typeof input.publicKeySpki !== "string") throw new MvpGuestError("INVALID_INPUT");
    let publicKeySha256: string;
    try { ({ sha256: publicKeySha256 } = await parseP256PublicKey(input.publicKeySpki)); }
    catch { throw new MvpGuestError("INVALID_INPUT"); }
    await this.contest(input.contestId, input.candidateId);
    const current = await this.db.prepare(`SELECT id, platform, public_key_spki, public_key_sha256,
      verification_status, challenge_hash, challenge_expires_at
      FROM anonymous_voter_credentials WHERE public_key_sha256=?`)
      .bind(publicKeySha256).first<Credential>();
    if (current && (current.platform !== "android" || current.public_key_spki !== input.publicKeySpki
      || current.verification_status !== (input.action === "vote" ? "verified" : "pending"))) {
      throw new MvpGuestError("CREDENTIAL_UNAVAILABLE");
    }
    if (!current && input.action === "vote") throw new MvpGuestError("CREDENTIAL_UNAVAILABLE");
    const credentialId = current?.id ?? `mvp_guest_${crypto.randomUUID()}`;
    const challenge = newChallenge();
    const requestHash = await mvpRequestHash({ action: input.action, contestId: input.contestId,
      candidateId: input.candidateId, credentialId, publicKeySha256, challenge });
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + MVP_CHALLENGE_TTL_SECONDS;
    const saved = current
      ? await this.db.prepare(`UPDATE anonymous_voter_credentials
          SET challenge_hash=?, challenge_expires_at=?, updated_at=unixepoch('now')
          WHERE id=? AND (challenge_hash IS NULL OR challenge_expires_at<=unixepoch('now'))
          RETURNING id`).bind(requestHash, expiresAt, credentialId).first<{ id: string }>()
      : await this.db.prepare(`INSERT INTO anonymous_voter_credentials
          (id,platform,public_key_spki,public_key_sha256,attestation_provider,verification_status,
           assertion_counter,challenge_hash,challenge_expires_at,created_at,updated_at)
          VALUES (?,'android',?,?,'play_integrity','pending',0,?,?,unixepoch('now'),unixepoch('now'))
          RETURNING id`).bind(credentialId, input.publicKeySpki, publicKeySha256, requestHash, expiresAt)
        .first<{ id: string }>();
    if (!saved) throw new MvpGuestError("CHALLENGE_CONFLICT");
    return { protocolVersion: MVP_GUEST_PROTOCOL_VERSION, credentialId, challenge,
      requestHash, expiresAt };
  }

  private async verifiedProof(action: MvpGuestAction, input: ProofInput) {
    if (!validProof(input)) throw new MvpGuestError("INVALID_INPUT");
    await this.contest(input.contestId, input.candidateId);
    const credential = await this.db.prepare(`SELECT id, platform, public_key_spki, public_key_sha256,
      verification_status, challenge_hash, challenge_expires_at
      FROM anonymous_voter_credentials WHERE id=?`)
      .bind(input.credentialId).first<Credential>();
    if (!credential || credential.platform !== "android"
      || credential.verification_status !== (action === "vote" ? "verified" : "pending")) {
      throw new MvpGuestError("CREDENTIAL_UNAVAILABLE");
    }
    const binding = { action, contestId: input.contestId, candidateId: input.candidateId,
      credentialId: credential.id, publicKeySha256: credential.public_key_sha256, challenge: input.challenge };
    const requestHash = await mvpRequestHash(binding);
    if (credential.challenge_hash !== requestHash || credential.challenge_expires_at === null
      || credential.challenge_expires_at <= Math.floor(Date.now() / 1000)) throw new MvpGuestError("INVALID_PROOF");
    if (!await verifyMvpSignature(credential.public_key_spki, input.signature, binding)) {
      throw new MvpGuestError("INVALID_PROOF");
    }
    await this.integrity.verify(input.integrityToken, requestHash);
    return { credential, requestHash };
  }

  async register(input: ProofInput) {
    const { credential, requestHash } = await this.verifiedProof("register", input);
    const verified = await this.db.prepare(`UPDATE anonymous_voter_credentials
      SET verification_status='verified', verified_at=unixepoch('now'),
        challenge_hash=NULL, challenge_expires_at=NULL, updated_at=unixepoch('now')
      WHERE id=? AND verification_status='pending' AND challenge_hash=?
        AND challenge_expires_at>unixepoch('now') RETURNING id`)
      .bind(credential.id, requestHash).first<{ id: string }>();
    if (!verified) throw new MvpGuestError("INVALID_PROOF");
    return { credentialId: verified.id, platform: "android" as const, verified: true };
  }

  async vote(input: ProofInput) {
    return castMvpVoteWithDb(this.db, { verify: async () => {
      const { credential, requestHash } = await this.verifiedProof("vote", input);
      return { credentialId: credential.id, contestId: input.contestId,
        candidateId: input.candidateId, platform: "android" as const,
        publicKeySha256: credential.public_key_sha256, challengeHash: requestHash,
        assertionCounter: null };
    } }, { contestId: input.contestId, candidateId: input.candidateId, evidence: input });
  }
}
