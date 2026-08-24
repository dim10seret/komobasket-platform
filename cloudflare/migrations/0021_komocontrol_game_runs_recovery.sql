PRAGMA foreign_keys = ON;

CREATE TABLE league_komocontrol_game_runs (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES league_games(id) ON DELETE RESTRICT,
  package_id TEXT NOT NULL REFERENCES league_komocontrol_game_packages(id) ON DELETE RESTRICT,
  scorer_id TEXT NOT NULL REFERENCES league_komocontrol_scorers(id) ON DELETE RESTRICT,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'finalized', 'abandoned')),
  started_at TEXT,
  last_sync_at TEXT,
  last_accepted_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_accepted_sequence >= 0),
  recovery_state_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_komocontrol_game_runs_game_status
  ON league_komocontrol_game_runs(game_id, status);
CREATE INDEX idx_komocontrol_game_runs_scorer_status_last_sync
  ON league_komocontrol_game_runs(scorer_id, status, last_sync_at);
CREATE INDEX idx_komocontrol_game_runs_package
  ON league_komocontrol_game_runs(package_id);

CREATE TABLE league_komocontrol_recovery_events (
  run_id TEXT NOT NULL REFERENCES league_komocontrol_game_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, sequence)
);
