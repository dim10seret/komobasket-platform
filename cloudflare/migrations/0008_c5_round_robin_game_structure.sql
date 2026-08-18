-- C5.2B round-robin game structure metadata

PRAGMA foreign_keys = ON;

ALTER TABLE league_games ADD COLUMN schedule_id TEXT REFERENCES league_phase_schedules(id) ON DELETE RESTRICT;
ALTER TABLE league_games ADD COLUMN cycle_number INTEGER;
ALTER TABLE league_games ADD COLUMN round_number INTEGER;
ALTER TABLE league_games ADD COLUMN game_order INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_games_schedule_slot
  ON league_games(schedule_id, round_number, game_order);

INSERT OR IGNORE INTO league_schema_migrations (version, name)
VALUES ('0008', 'c5_round_robin_game_structure');
