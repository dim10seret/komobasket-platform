CREATE TABLE local_game_runs (
    run_id TEXT PRIMARY KEY,
    run_schema_version INTEGER NOT NULL CHECK (run_schema_version = 1),
    game_id TEXT NOT NULL CHECK (length(trim(game_id)) > 0),
    package_id TEXT NOT NULL REFERENCES local_game_packages(package_id) ON DELETE RESTRICT,
    package_version INTEGER NOT NULL CHECK (package_version > 0),
    package_schema_version INTEGER NOT NULL CHECK (package_schema_version = 1),
    package_hash TEXT NOT NULL CHECK (
        length(package_hash) = 64
        AND package_hash NOT GLOB '*[^0-9a-f]*'
    ),
    organization_id TEXT NOT NULL CHECK (length(trim(organization_id)) > 0),
    scorer_id TEXT NOT NULL CHECK (length(trim(scorer_id)) > 0),
    device_id TEXT NOT NULL CHECK (length(trim(device_id)) > 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'finalized', 'abandoned')),
    setup_snapshot_json TEXT NOT NULL CHECK (length(trim(setup_snapshot_json)) > 0),
    last_accepted_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_accepted_sequence >= 0),
    started_at_utc TEXT,
    created_at_utc TEXT NOT NULL CHECK (length(created_at_utc) >= 20),
    updated_at_utc TEXT NOT NULL CHECK (length(updated_at_utc) >= 20)
) STRICT;

CREATE UNIQUE INDEX idx_local_game_runs_one_active_per_game
    ON local_game_runs(game_id)
    WHERE status = 'active';

CREATE INDEX idx_local_game_runs_package
    ON local_game_runs(package_id);

CREATE INDEX idx_local_game_runs_owner_status
    ON local_game_runs(organization_id, scorer_id, device_id, status);

CREATE TRIGGER trg_local_game_runs_immutable_context
BEFORE UPDATE OF
    run_id,
    run_schema_version,
    game_id,
    package_id,
    package_version,
    package_schema_version,
    package_hash,
    organization_id,
    scorer_id,
    device_id,
    setup_snapshot_json,
    created_at_utc
ON local_game_runs
BEGIN
    SELECT RAISE(ABORT, 'Local Game Run immutable context cannot be changed.');
END;
