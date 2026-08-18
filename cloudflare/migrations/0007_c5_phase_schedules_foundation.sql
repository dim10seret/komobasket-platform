-- C5.1 Phase schedule foundation
-- Adds the canonical Schedule container for a persisted Phase.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS league_phase_schedules (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL UNIQUE REFERENCES league_phases(id) ON DELETE RESTRICT,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN ('draft', 'published')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_league_phase_schedules_competition_id
  ON league_phase_schedules(competition_id);

CREATE INDEX IF NOT EXISTS idx_league_phase_schedules_lifecycle_status
  ON league_phase_schedules(lifecycle_status);
