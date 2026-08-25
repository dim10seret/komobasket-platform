PRAGMA foreign_keys = ON;

CREATE TABLE league_komocontrol_scorer_sessions (
  id TEXT PRIMARY KEY,
  scorer_id TEXT NOT NULL
    REFERENCES league_komocontrol_scorers(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
  device_id TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
