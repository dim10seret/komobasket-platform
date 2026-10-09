-- MVP2A: local-only guest voting foundation. No credentials or votes are created.
CREATE TABLE anonymous_voter_credentials (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  public_key_spki TEXT NOT NULL CHECK (length(public_key_spki) > 0),
  public_key_sha256 TEXT NOT NULL UNIQUE CHECK (
    length(public_key_sha256) = 64 AND public_key_sha256 NOT GLOB '*[^0-9a-f]*'),
  attestation_provider TEXT NOT NULL CHECK (
    (platform = 'android' AND attestation_provider = 'play_integrity') OR
    (platform = 'ios' AND attestation_provider = 'app_attest')),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'revoked')),
  assertion_counter INTEGER NOT NULL DEFAULT 0 CHECK (assertion_counter >= 0),
  challenge_hash TEXT CHECK (challenge_hash IS NULL OR
    (length(challenge_hash) = 64 AND challenge_hash NOT GLOB '*[^0-9a-f]*')),
  challenge_expires_at INTEGER CHECK (challenge_expires_at IS NULL OR challenge_expires_at > 0),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  verified_at INTEGER CHECK (verified_at IS NULL OR verified_at >= created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  CHECK ((challenge_hash IS NULL) = (challenge_expires_at IS NULL)),
  CHECK ((verification_status = 'pending' AND verified_at IS NULL AND revoked_at IS NULL) OR
         (verification_status = 'verified' AND verified_at IS NOT NULL AND revoked_at IS NULL) OR
         (verification_status = 'revoked' AND verified_at IS NOT NULL AND revoked_at IS NOT NULL))
) STRICT;

CREATE TABLE mvp_votes (
  id TEXT PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES mvp_contests(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL,
  voter_credential_id TEXT NOT NULL REFERENCES anonymous_voter_credentials(id) ON DELETE RESTRICT,
  accepted_at INTEGER NOT NULL CHECK (accepted_at > 0),
  UNIQUE (contest_id, voter_credential_id),
  FOREIGN KEY (contest_id, candidate_id)
    REFERENCES mvp_candidates(contest_id, id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_mvp_votes_contest_candidate ON mvp_votes(contest_id, candidate_id);

CREATE TRIGGER mvp_votes_immutable_update BEFORE UPDATE ON mvp_votes
BEGIN SELECT RAISE(ABORT, 'accepted MVP votes are immutable'); END;
CREATE TRIGGER mvp_votes_immutable_delete BEFORE DELETE ON mvp_votes
BEGIN SELECT RAISE(ABORT, 'accepted MVP votes are immutable'); END;
