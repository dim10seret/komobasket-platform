CREATE TABLE league_player_movements_addition (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES league_players(id),
  season_id TEXT NOT NULL REFERENCES league_seasons(id),
  from_team_id TEXT REFERENCES league_teams(id),
  to_team_id TEXT REFERENCES league_teams(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('registration','transfer','departure','return','addition')),
  effective_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL
);

INSERT INTO league_player_movements_addition
  (id, player_id, season_id, from_team_id, to_team_id, movement_type, effective_on, note, created_at, competition_id)
SELECT
  id, player_id, season_id, from_team_id, to_team_id, movement_type, effective_on, note, created_at, competition_id
FROM league_player_movements;

DROP TABLE league_player_movements;

ALTER TABLE league_player_movements_addition RENAME TO league_player_movements;

CREATE INDEX idx_player_movements_competition
  ON league_player_movements(competition_id);
