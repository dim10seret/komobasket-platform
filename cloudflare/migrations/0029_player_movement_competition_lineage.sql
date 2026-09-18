ALTER TABLE league_player_movements
  ADD COLUMN competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_player_movements_competition
  ON league_player_movements(competition_id);
