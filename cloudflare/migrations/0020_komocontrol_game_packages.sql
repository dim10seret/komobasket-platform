PRAGMA foreign_keys = ON;

CREATE TABLE league_komocontrol_game_packages (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES league_organizations(id) ON DELETE RESTRICT,
  package_version INTEGER NOT NULL CHECK (package_version >= 1),
  status TEXT NOT NULL CHECK (status IN ('published', 'superseded', 'revoked')),
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  superseded_at TEXT,
  published_by_user_id TEXT REFERENCES league_app_users(id) ON DELETE SET NULL,
  UNIQUE(game_id, package_version)
);

CREATE UNIQUE INDEX idx_komocontrol_game_packages_current_published
  ON league_komocontrol_game_packages(game_id)
  WHERE status = 'published';

CREATE INDEX idx_komocontrol_game_packages_organization_status_published_at
  ON league_komocontrol_game_packages(organization_id, status, published_at);
