-- C1 competition workspace metadata fields
-- Added: competition metadata extensions for C1 workspace

PRAGMA foreign_keys = ON;

ALTER TABLE league_competitions
  ADD COLUMN IF NOT EXISTS custom_type_label TEXT;

ALTER TABLE league_competitions
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

CREATE INDEX IF NOT EXISTS idx_league_competitions_custom_type
  ON league_competitions(custom_type_label);

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0003', 'c1_competitions_workspace');
