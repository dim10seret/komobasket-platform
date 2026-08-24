PRAGMA foreign_keys = ON;

CREATE TABLE league_competition_komocontrol_defaults (
  competition_id TEXT PRIMARY KEY
    REFERENCES league_competitions(id) ON DELETE CASCADE,
  game_mode TEXT NOT NULL DEFAULT 'SIMPLE'
    CHECK (game_mode IN ('SIMPLE', 'FULL')),
  min_players INTEGER NOT NULL CHECK (min_players >= 1),
  max_players INTEGER NOT NULL CHECK (max_players >= 1),
  starting_players INTEGER NOT NULL CHECK (starting_players >= 1),
  regulation_periods INTEGER NOT NULL CHECK (regulation_periods >= 1),
  regulation_period_seconds INTEGER NOT NULL CHECK (regulation_period_seconds > 0),
  overtime_seconds INTEGER NOT NULL CHECK (overtime_seconds > 0),
  tie_allowed INTEGER NOT NULL DEFAULT 0 CHECK (tie_allowed IN (0, 1)),
  winner_required INTEGER NOT NULL DEFAULT 1 CHECK (winner_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE league_game_komocontrol_overrides (
  game_id TEXT PRIMARY KEY
    REFERENCES league_games(id) ON DELETE CASCADE,
  game_mode TEXT CHECK (game_mode IS NULL OR game_mode IN ('SIMPLE', 'FULL')),
  min_players INTEGER CHECK (min_players IS NULL OR min_players >= 1),
  max_players INTEGER CHECK (max_players IS NULL OR max_players >= 1),
  starting_players INTEGER CHECK (starting_players IS NULL OR starting_players >= 1),
  regulation_periods INTEGER CHECK (regulation_periods IS NULL OR regulation_periods >= 1),
  regulation_period_seconds INTEGER CHECK (
    regulation_period_seconds IS NULL OR regulation_period_seconds > 0
  ),
  overtime_seconds INTEGER CHECK (overtime_seconds IS NULL OR overtime_seconds > 0),
  tie_allowed INTEGER CHECK (tie_allowed IS NULL OR tie_allowed IN (0, 1)),
  winner_required INTEGER CHECK (winner_required IS NULL OR winner_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE league_komocontrol_scorers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES league_organizations(id) ON DELETE RESTRICT,
  username TEXT NOT NULL,
  normalized_username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TEXT
);

CREATE INDEX idx_komocontrol_scorers_organization_status
  ON league_komocontrol_scorers(organization_id, status);

CREATE TABLE league_referees (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES league_organizations(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  organization TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_referees_organization_active_name
  ON league_referees(organization_id, active, last_name, first_name);

CREATE TABLE league_table_officials (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL
    REFERENCES league_organizations(id) ON DELETE RESTRICT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  organization TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_table_officials_organization_active_name
  ON league_table_officials(organization_id, active, last_name, first_name);
