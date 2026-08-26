CREATE TABLE IF NOT EXISTS league_komocontrol_gameplay_game_claims (
  game_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  scorer_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES league_games(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES league_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (scorer_id) REFERENCES league_komocontrol_scorers(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS league_komocontrol_match_engine_snapshots_v1 (
  run_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_version INTEGER NOT NULL CHECK (package_version >= 1),
  package_hash TEXT NOT NULL CHECK (length(package_hash) = 64),
  organization_id TEXT NOT NULL,
  scorer_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  configuration_revision INTEGER NOT NULL CHECK (configuration_revision >= 1),
  configuration_hash TEXT NOT NULL CHECK (length(configuration_hash) = 64),
  snapshot_schema_version INTEGER NOT NULL CHECK (snapshot_schema_version = 1),
  match_event_schema_version INTEGER NOT NULL CHECK (match_event_schema_version = 2),
  initial_state_json TEXT NOT NULL,
  initial_state_hash TEXT NOT NULL CHECK (length(initial_state_hash) = 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES league_games(id) ON DELETE RESTRICT,
  FOREIGN KEY (package_id) REFERENCES league_komocontrol_game_packages(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id) REFERENCES league_organizations(id) ON DELETE RESTRICT,
  FOREIGN KEY (scorer_id) REFERENCES league_komocontrol_scorers(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_komocontrol_gameplay_snapshots_owner
  ON league_komocontrol_match_engine_snapshots_v1 (organization_id, scorer_id, device_id);

CREATE TABLE IF NOT EXISTS league_komocontrol_current_game_configurations_v1 (
  run_id TEXT PRIMARY KEY,
  configuration_revision INTEGER NOT NULL CHECK (configuration_revision >= 1),
  configuration_hash TEXT NOT NULL CHECK (length(configuration_hash) = 64),
  configuration_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES league_komocontrol_match_engine_snapshots_v1(run_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS league_komocontrol_gameplay_heads (
  run_id TEXT PRIMARY KEY,
  event_history_revision INTEGER NOT NULL CHECK (event_history_revision >= 1),
  last_accepted_sequence INTEGER NOT NULL CHECK (last_accepted_sequence >= 1),
  history_hash TEXT NOT NULL CHECK (length(history_hash) = 64),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('live', 'finalized')),
  finalization_hash TEXT CHECK (finalization_hash IS NULL OR length(finalization_hash) = 64),
  official_result_applied_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES league_komocontrol_match_engine_snapshots_v1(run_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS league_komocontrol_match_events_v2 (
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  event_schema_version INTEGER NOT NULL CHECK (event_schema_version = 2),
  event_json TEXT NOT NULL,
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),
  PRIMARY KEY (run_id, event_id),
  UNIQUE (run_id, sequence),
  FOREIGN KEY (run_id) REFERENCES league_komocontrol_match_engine_snapshots_v1(run_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS league_komocontrol_match_finalizations_v1 (
  run_id TEXT PRIMARY KEY,
  finalized_history_revision INTEGER NOT NULL CHECK (finalized_history_revision >= 1),
  finalized_history_hash TEXT NOT NULL CHECK (length(finalized_history_hash) = 64),
  final_state_json TEXT NOT NULL,
  final_state_hash TEXT NOT NULL CHECK (length(final_state_hash) = 64),
  finalization_json TEXT NOT NULL,
  finalization_hash TEXT NOT NULL CHECK (length(finalization_hash) = 64),
  finalized_at_utc TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES league_komocontrol_match_engine_snapshots_v1(run_id) ON DELETE CASCADE
) STRICT;
