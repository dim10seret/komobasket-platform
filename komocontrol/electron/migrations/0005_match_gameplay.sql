PRAGMA foreign_keys = ON;

CREATE TABLE local_match_engine_snapshots (
    run_id TEXT PRIMARY KEY
        REFERENCES local_game_runs(run_id) ON DELETE CASCADE,
    snapshot_schema_version INTEGER NOT NULL CHECK (snapshot_schema_version = 1),
    match_event_schema_version INTEGER NOT NULL CHECK (match_event_schema_version = 2),
    configuration_revision INTEGER NOT NULL CHECK (configuration_revision >= 1),
    configuration_hash TEXT NOT NULL CHECK (
        length(configuration_hash) = 64
        AND configuration_hash = lower(configuration_hash)
    ),
    initial_state_json TEXT NOT NULL CHECK (length(initial_state_json) > 0),
    initial_state_hash TEXT NOT NULL CHECK (
        length(initial_state_hash) = 64
        AND initial_state_hash = lower(initial_state_hash)
    ),
    event_history_revision INTEGER NOT NULL CHECK (event_history_revision >= 1),
    created_at_utc TEXT NOT NULL CHECK (length(created_at_utc) > 0)
) STRICT;

CREATE TRIGGER local_match_engine_snapshots_immutable
BEFORE UPDATE OF
    run_id,
    snapshot_schema_version,
    match_event_schema_version,
    configuration_revision,
    configuration_hash,
    initial_state_json,
    initial_state_hash,
    created_at_utc
ON local_match_engine_snapshots
FOR EACH ROW
WHEN
    NEW.run_id IS NOT OLD.run_id
    OR NEW.snapshot_schema_version IS NOT OLD.snapshot_schema_version
    OR NEW.match_event_schema_version IS NOT OLD.match_event_schema_version
    OR NEW.configuration_revision IS NOT OLD.configuration_revision
    OR NEW.configuration_hash IS NOT OLD.configuration_hash
    OR NEW.initial_state_json IS NOT OLD.initial_state_json
    OR NEW.initial_state_hash IS NOT OLD.initial_state_hash
    OR NEW.created_at_utc IS NOT OLD.created_at_utc
BEGIN
    SELECT RAISE(ABORT, 'Local MatchEngine initial snapshot is immutable.');
END;

CREATE TABLE local_match_events (
    run_id TEXT NOT NULL
        REFERENCES local_match_engine_snapshots(run_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL CHECK (length(event_id) > 0),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    event_schema_version INTEGER NOT NULL CHECK (event_schema_version = 2),
    event_json TEXT NOT NULL CHECK (length(event_json) > 0),
    event_hash TEXT NOT NULL CHECK (
        length(event_hash) = 64
        AND event_hash = lower(event_hash)
    ),
    persisted_at_utc TEXT NOT NULL CHECK (length(persisted_at_utc) > 0),
    PRIMARY KEY (run_id, event_id),
    UNIQUE (run_id, sequence)
) STRICT;

CREATE TRIGGER local_match_events_immutable
BEFORE UPDATE ON local_match_events
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Local MatchEvent rows are immutable; rewrite authoritative history instead.');
END;
