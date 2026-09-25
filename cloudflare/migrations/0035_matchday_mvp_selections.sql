CREATE TABLE IF NOT EXISTS league_matchday_mvp_selections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (competition_id, phase_id, round_number),
  FOREIGN KEY (organization_id) REFERENCES league_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (competition_id) REFERENCES league_competitions(id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id) REFERENCES league_phases(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES league_games(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES league_players(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_matchday_mvp_organization_competition
  ON league_matchday_mvp_selections (organization_id, competition_id, phase_id, round_number);
