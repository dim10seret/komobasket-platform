CREATE TABLE IF NOT EXISTS league_game_administrative_results (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  game_id TEXT NOT NULL UNIQUE,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('correction','interruption')),
  official_home_score INTEGER NOT NULL CHECK (official_home_score >= 0),
  official_away_score INTEGER NOT NULL CHECK (official_away_score >= 0),
  home_standings_points_override INTEGER CHECK (home_standings_points_override IS NULL OR home_standings_points_override >= 0),
  away_standings_points_override INTEGER CHECK (away_standings_points_override IS NULL OR away_standings_points_override >= 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES league_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES league_games(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_game_administrative_results_organization
  ON league_game_administrative_results (organization_id, updated_at, game_id);
