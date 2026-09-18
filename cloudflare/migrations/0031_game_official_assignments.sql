PRAGMA foreign_keys = ON;

CREATE TABLE league_game_official_assignments (
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE CASCADE,
  slot_code TEXT NOT NULL CHECK (slot_code IN ('REFEREE_A', 'REFEREE_B', 'REFEREE_C', 'TABLE_TIMER', 'TABLE_SHOT_CLOCK', 'TABLE_SCORESHEET', 'TABLE_COMMISSIONER')),
  referee_id TEXT REFERENCES league_referees(id) ON DELETE RESTRICT,
  table_official_id TEXT REFERENCES league_table_officials(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, slot_code),
  CHECK (
    (slot_code IN ('REFEREE_A', 'REFEREE_B', 'REFEREE_C') AND referee_id IS NOT NULL AND table_official_id IS NULL)
    OR
    (slot_code IN ('TABLE_TIMER', 'TABLE_SHOT_CLOCK', 'TABLE_SCORESHEET', 'TABLE_COMMISSIONER') AND referee_id IS NULL AND table_official_id IS NOT NULL)
  )
);

CREATE INDEX idx_game_official_assignments_referee ON league_game_official_assignments(referee_id);
CREATE INDEX idx_game_official_assignments_table_official ON league_game_official_assignments(table_official_id);
