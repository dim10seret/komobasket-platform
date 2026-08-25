PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_game_run_configurations (
    run_id TEXT PRIMARY KEY
        REFERENCES local_game_runs(run_id) ON DELETE CASCADE,
    configuration_schema_version INTEGER NOT NULL
        CHECK (configuration_schema_version = 1),
    revision INTEGER NOT NULL
        CHECK (revision >= 1),
    status TEXT NOT NULL
        CHECK (status IN ('draft', 'ready')),
    configuration_json TEXT NOT NULL,
    configuration_hash TEXT NOT NULL
        CHECK (
            length(configuration_hash) = 64
            AND configuration_hash = lower(configuration_hash)
            AND configuration_hash NOT GLOB '*[^0-9a-f]*'
        ),
    ready_at_utc TEXT,
    created_at_utc TEXT NOT NULL,
    updated_at_utc TEXT NOT NULL,
    CHECK (
        (status = 'draft' AND ready_at_utc IS NULL)
        OR (status = 'ready' AND ready_at_utc IS NOT NULL)
    )
);

CREATE TRIGGER IF NOT EXISTS local_game_run_configurations_pre_engine_insert
BEFORE INSERT ON local_game_run_configurations
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1
    FROM local_game_runs
    WHERE run_id = NEW.run_id
      AND status = 'active'
      AND started_at_utc IS NULL
      AND last_accepted_sequence = 0
)
BEGIN
    SELECT RAISE(ABORT, 'configuration requires an active pre-engine Run');
END;

CREATE TRIGGER IF NOT EXISTS local_game_run_configurations_pre_engine_update
BEFORE UPDATE ON local_game_run_configurations
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1
    FROM local_game_runs
    WHERE run_id = NEW.run_id
      AND status = 'active'
      AND started_at_utc IS NULL
      AND last_accepted_sequence = 0
)
BEGIN
    SELECT RAISE(ABORT, 'configuration requires an active pre-engine Run');
END;

CREATE TRIGGER IF NOT EXISTS local_game_run_configurations_immutable_identity
BEFORE UPDATE OF run_id, configuration_schema_version, created_at_utc
ON local_game_run_configurations
FOR EACH ROW
WHEN NEW.run_id <> OLD.run_id
  OR NEW.configuration_schema_version <> OLD.configuration_schema_version
  OR NEW.created_at_utc <> OLD.created_at_utc
BEGIN
    SELECT RAISE(ABORT, 'configuration identity is immutable');
END;
