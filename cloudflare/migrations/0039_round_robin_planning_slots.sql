CREATE TABLE IF NOT EXISTS league_round_robin_planning_slots (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES league_phase_schedules(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL CHECK (cycle_number >= 1),
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  game_order INTEGER NOT NULL CHECK (game_order >= 1),
  home_participant_key TEXT NOT NULL CHECK (length(trim(home_participant_key)) > 0),
  away_participant_key TEXT NOT NULL CHECK (length(trim(away_participant_key)) > 0),
  scheduled_date TEXT,
  scheduled_time TEXT CHECK (scheduled_time IS NULL OR scheduled_date IS NOT NULL),
  venue TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (schedule_id, round_number, game_order),
  CHECK (home_participant_key <> away_participant_key)
);

CREATE INDEX IF NOT EXISTS idx_league_round_robin_planning_slots_schedule
  ON league_round_robin_planning_slots(schedule_id, round_number, game_order);
