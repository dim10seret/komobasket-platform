-- C5.3B-1 scheduling storage foundation + competition venue suggestions

PRAGMA foreign_keys = ON;

ALTER TABLE league_games ADD COLUMN scheduled_date TEXT;
ALTER TABLE league_games ADD COLUMN scheduled_time TEXT CHECK (scheduled_time IS NULL OR scheduled_date IS NOT NULL);

CREATE TABLE IF NOT EXISTS league_competition_venues (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  map_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, name)
);

CREATE INDEX IF NOT EXISTS idx_competition_venues_competition_sort
  ON league_competition_venues(competition_id, sort_order, name);

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0009', 'c5_scheduling_storage_and_competition_venues');
