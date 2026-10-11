-- MVP4A: public Google voter identity, one-time login state, sessions, and reserved ballots.
-- No account or ballot rows are created by this migration.
CREATE TABLE mvp_google_voters (
  id TEXT PRIMARY KEY,
  subject_hash TEXT NOT NULL UNIQUE CHECK (
    length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL CHECK (created_at>0)
) STRICT;

CREATE TABLE mvp_google_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login','voter')),
  voter_id TEXT REFERENCES mvp_google_voters(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  nonce TEXT,
  code_verifier TEXT,
  return_path TEXT,
  created_at INTEGER NOT NULL CHECK (created_at>0),
  expires_at INTEGER NOT NULL CHECK (expires_at>created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at>=created_at),
  CHECK ((kind='login' AND voter_id IS NULL AND nonce IS NOT NULL
      AND code_verifier IS NOT NULL AND return_path IS NOT NULL AND revoked_at IS NULL)
    OR (kind='voter' AND voter_id IS NOT NULL AND nonce IS NULL
      AND code_verifier IS NULL AND return_path IS NULL))
) STRICT;
CREATE INDEX idx_mvp_google_sessions_voter ON mvp_google_sessions(voter_id,expires_at);
CREATE INDEX idx_mvp_google_sessions_expiry ON mvp_google_sessions(expires_at);

-- Reserved for MVP4A.2. No write route is introduced in MVP4A.1.
CREATE TABLE mvp_google_votes (
  id TEXT PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES mvp_contests(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL,
  voter_id TEXT NOT NULL REFERENCES mvp_google_voters(id) ON DELETE RESTRICT,
  accepted_at INTEGER NOT NULL CHECK (accepted_at>0),
  UNIQUE (contest_id,voter_id),
  FOREIGN KEY (contest_id,candidate_id)
    REFERENCES mvp_candidates(contest_id,id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX idx_mvp_google_votes_contest_candidate
  ON mvp_google_votes(contest_id,candidate_id);
CREATE TRIGGER mvp_google_votes_immutable_update BEFORE UPDATE ON mvp_google_votes
BEGIN SELECT RAISE(ABORT,'accepted Google MVP votes are immutable'); END;
CREATE TRIGGER mvp_google_votes_immutable_delete BEFORE DELETE ON mvp_google_votes
BEGIN SELECT RAISE(ABORT,'accepted Google MVP votes are immutable'); END;
