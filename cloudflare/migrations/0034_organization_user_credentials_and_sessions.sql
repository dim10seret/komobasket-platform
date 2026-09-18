PRAGMA foreign_keys = ON;

CREATE TABLE league_user_credentials (
  user_id TEXT PRIMARY KEY
    REFERENCES league_app_users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1
    CHECK (credential_version >= 1),
  password_set_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE league_user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL
    REFERENCES league_app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (length(token_hash) = 64),
  credential_version INTEGER NOT NULL
    CHECK (credential_version >= 1),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_league_user_sessions_user_revoked
  ON league_user_sessions(user_id, revoked_at);

CREATE INDEX idx_league_user_sessions_expires_at
  ON league_user_sessions(expires_at);
