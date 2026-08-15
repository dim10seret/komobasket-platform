-- R1 staff / roster foundation
-- Added: canonical staff, staff memberships and roster photo support columns.

PRAGMA foreign_keys = ON;

ALTER TABLE league_players
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE TABLE IF NOT EXISTS league_staff (
  id TEXT PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  birth_date TEXT,
  photo_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_staff_normalized ON league_staff(normalized_name);

CREATE TABLE IF NOT EXISTS league_staff_memberships (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES league_staff(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('head_coach','assistant_coach','trainer','physiotherapist','doctor','team_manager','team_official','other')),
  custom_role_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(staff_id, season_id, competition_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_memberships_staff ON league_staff_memberships(staff_id, season_id, competition_id);
CREATE INDEX IF NOT EXISTS idx_staff_memberships_team ON league_staff_memberships(team_id, season_id, competition_id);

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0002', 'r1_staff_foundation');
