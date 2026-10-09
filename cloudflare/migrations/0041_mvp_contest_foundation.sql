-- MVP1 foundation. No existing award, game, or competition rows are changed.
ALTER TABLE league_phases ADD COLUMN mvp_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (mvp_enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS mvp_contests (
  id TEXT PRIMARY KEY,
  phase_id TEXT NOT NULL REFERENCES league_phases(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('round', 'series')),
  round_number INTEGER,
  matchup_id TEXT,
  selection_method TEXT NOT NULL CHECK (selection_method IN ('manual', 'app_poll')),
  status TEXT NOT NULL CHECK (status IN ('open', 'tie_requires_resolution', 'needs_operator_decision', 'finalized')),
  results_visibility TEXT NOT NULL CHECK (results_visibility IN ('live', 'after_close')),
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL CHECK (closes_at > opens_at),
  winner_player_id TEXT REFERENCES league_players(id) ON DELETE RESTRICT,
  finalized_at INTEGER,
  official_matchday_selection_id TEXT UNIQUE REFERENCES league_matchday_mvp_selections(id) ON DELETE RESTRICT,
  photo_asset_key TEXT,
  photo_caption TEXT,
  body_text TEXT,
  sponsor_name TEXT,
  gift_description TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES league_app_users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((scope_type = 'round' AND round_number BETWEEN 1 AND 10000 AND matchup_id IS NULL)
      OR (scope_type = 'series' AND round_number IS NULL AND matchup_id IS NOT NULL AND length(trim(matchup_id)) > 0)),
  CHECK ((status = 'finalized' AND winner_player_id IS NOT NULL AND finalized_at IS NOT NULL)
      OR (status <> 'finalized' AND winner_player_id IS NULL AND finalized_at IS NULL)),
  CHECK (official_matchday_selection_id IS NULL OR scope_type = 'round')
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mvp_contests_round_scope
  ON mvp_contests(phase_id, round_number) WHERE scope_type = 'round';
CREATE UNIQUE INDEX IF NOT EXISTS idx_mvp_contests_series_scope
  ON mvp_contests(phase_id, matchup_id) WHERE scope_type = 'series';
CREATE INDEX IF NOT EXISTS idx_mvp_contests_phase_status
  ON mvp_contests(phase_id, status, closes_at);

CREATE TABLE IF NOT EXISTS mvp_candidates (
  id TEXT PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES mvp_contests(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES league_players(id) ON DELETE RESTRICT,
  supporting_game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  team_id TEXT NOT NULL REFERENCES league_teams(id) ON DELETE RESTRICT,
  player_name TEXT NOT NULL CHECK (length(trim(player_name)) > 0),
  team_name TEXT NOT NULL CHECK (length(trim(team_name)) > 0),
  points INTEGER NOT NULL,
  rebounds INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  efficiency INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('system', 'operator')),
  proposal_rank INTEGER CHECK (proposal_rank IS NULL OR proposal_rank BETWEEN 1 AND 5),
  added_by_user_id TEXT REFERENCES league_app_users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  UNIQUE (contest_id, player_id),
  UNIQUE (contest_id, id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_mvp_candidates_contest
  ON mvp_candidates(contest_id, created_at, id);
