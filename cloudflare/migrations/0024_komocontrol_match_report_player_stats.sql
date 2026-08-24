PRAGMA foreign_keys = ON;

CREATE TABLE league_match_report_player_stats (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES league_match_reports(id) ON DELETE CASCADE,
  lineup_player_id TEXT NOT NULL REFERENCES league_match_report_lineup_players(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES league_players(id) ON DELETE SET NULL,
  side TEXT NOT NULL CHECK (side IN ('HOME', 'AWAY')),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('SIMPLE', 'FULL')),
  availability_json TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  personal_fouls INTEGER NOT NULL CHECK (personal_fouls >= 0),
  played_seconds INTEGER NOT NULL CHECK (played_seconds >= 0),
  one_point_made INTEGER NOT NULL CHECK (one_point_made >= 0),
  two_point_made INTEGER NOT NULL CHECK (two_point_made >= 0),
  three_point_made INTEGER NOT NULL CHECK (three_point_made >= 0),
  ft_made INTEGER CHECK (ft_made IS NULL OR ft_made >= 0),
  ft_attempted INTEGER CHECK (ft_attempted IS NULL OR ft_attempted >= 0),
  two_pt_made INTEGER CHECK (two_pt_made IS NULL OR two_pt_made >= 0),
  two_pt_attempted INTEGER CHECK (two_pt_attempted IS NULL OR two_pt_attempted >= 0),
  three_pt_made INTEGER CHECK (three_pt_made IS NULL OR three_pt_made >= 0),
  three_pt_attempted INTEGER CHECK (three_pt_attempted IS NULL OR three_pt_attempted >= 0),
  offensive_rebounds INTEGER CHECK (offensive_rebounds IS NULL OR offensive_rebounds >= 0),
  defensive_rebounds INTEGER CHECK (defensive_rebounds IS NULL OR defensive_rebounds >= 0),
  assists INTEGER CHECK (assists IS NULL OR assists >= 0),
  steals INTEGER CHECK (steals IS NULL OR steals >= 0),
  turnovers INTEGER CHECK (turnovers IS NULL OR turnovers >= 0),
  blocks_made INTEGER CHECK (blocks_made IS NULL OR blocks_made >= 0),
  blocks_received INTEGER CHECK (blocks_received IS NULL OR blocks_received >= 0),
  plus_minus INTEGER,
  efficiency INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, lineup_player_id),
  CHECK (ft_made IS NULL OR ft_attempted IS NULL OR ft_made <= ft_attempted),
  CHECK (two_pt_made IS NULL OR two_pt_attempted IS NULL OR two_pt_made <= two_pt_attempted),
  CHECK (three_pt_made IS NULL OR three_pt_attempted IS NULL OR three_pt_made <= three_pt_attempted)
);
CREATE INDEX idx_match_report_player_stats_report_side
  ON league_match_report_player_stats(report_id, side);
CREATE INDEX idx_match_report_player_stats_player_report
  ON league_match_report_player_stats(player_id, report_id);
