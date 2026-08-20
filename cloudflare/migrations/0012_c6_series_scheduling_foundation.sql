ALTER TABLE league_games
  ADD COLUMN series_matchup_id TEXT;

ALTER TABLE league_games
  ADD COLUMN series_round_number INTEGER
    CHECK (series_round_number IS NULL OR series_round_number >= 1);

CREATE TABLE IF NOT EXISTS league_series_planning_slots (
  id TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL REFERENCES league_phases(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES league_phase_schedules(id) ON DELETE CASCADE,
  matchup_id TEXT NOT NULL,
  series_round_number INTEGER NOT NULL CHECK (series_round_number >= 1),
  scheduled_date TEXT,
  scheduled_time TEXT CHECK (scheduled_time IS NULL OR scheduled_date IS NOT NULL),
  venue TEXT NOT NULL DEFAULT '',
  real_game_id TEXT REFERENCES league_games(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(schedule_id, matchup_id, series_round_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_series_identity
  ON league_games(phase_id, series_matchup_id, series_round_number)
  WHERE series_matchup_id IS NOT NULL AND series_round_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_series_planning_slots_schedule
  ON league_series_planning_slots(schedule_id, matchup_id, series_round_number);

CREATE INDEX IF NOT EXISTS idx_series_planning_slots_phase
  ON league_series_planning_slots(phase_id, schedule_id);
