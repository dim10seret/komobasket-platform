PRAGMA foreign_keys = ON;

CREATE TABLE local_live_run_authorizations (
    run_id TEXT PRIMARY KEY
        REFERENCES local_match_engine_snapshots(run_id) ON DELETE CASCADE,
    authorization_schema_version INTEGER NOT NULL CHECK (authorization_schema_version = 1),
    encrypted_authorization TEXT NOT NULL CHECK (length(encrypted_authorization) > 0),
    suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
    created_at_utc TEXT NOT NULL CHECK (length(created_at_utc) > 0),
    updated_at_utc TEXT NOT NULL CHECK (length(updated_at_utc) > 0)
) STRICT;

CREATE TABLE local_gameplay_sync_state (
    run_id TEXT PRIMARY KEY
        REFERENCES local_match_engine_snapshots(run_id) ON DELETE CASCADE,
    sync_schema_version INTEGER NOT NULL CHECK (sync_schema_version = 1),
    last_acknowledged_history_revision INTEGER NOT NULL DEFAULT 0
        CHECK (last_acknowledged_history_revision >= 0),
    last_acknowledged_history_hash TEXT CHECK (
        last_acknowledged_history_hash IS NULL
        OR (
            length(last_acknowledged_history_hash) = 64
            AND last_acknowledged_history_hash = lower(last_acknowledged_history_hash)
        )
    ),
    last_acknowledged_finalization_hash TEXT CHECK (
        last_acknowledged_finalization_hash IS NULL
        OR (
            length(last_acknowledged_finalization_hash) = 64
            AND last_acknowledged_finalization_hash = lower(last_acknowledged_finalization_hash)
        )
    ),
    last_attempted_revision INTEGER CHECK (
        last_attempted_revision IS NULL OR last_attempted_revision >= 1
    ),
    last_attempt_at_utc TEXT,
    last_success_at_utc TEXT,
    last_error_code TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    next_retry_at_utc TEXT,
    updated_at_utc TEXT NOT NULL CHECK (length(updated_at_utc) > 0)
) STRICT;

CREATE INDEX local_gameplay_sync_state_retry
    ON local_gameplay_sync_state(next_retry_at_utc)
    WHERE next_retry_at_utc IS NOT NULL;

CREATE TABLE local_match_finalizations (
    run_id TEXT PRIMARY KEY
        REFERENCES local_match_engine_snapshots(run_id) ON DELETE RESTRICT,
    finalization_schema_version INTEGER NOT NULL CHECK (finalization_schema_version = 1),
    finalized_history_revision INTEGER NOT NULL CHECK (finalized_history_revision >= 2),
    finalized_history_hash TEXT NOT NULL CHECK (
        length(finalized_history_hash) = 64
        AND finalized_history_hash = lower(finalized_history_hash)
    ),
    final_state_json TEXT NOT NULL CHECK (length(final_state_json) > 0),
    final_state_hash TEXT NOT NULL CHECK (
        length(final_state_hash) = 64
        AND final_state_hash = lower(final_state_hash)
    ),
    finalization_json TEXT NOT NULL CHECK (length(finalization_json) > 0),
    finalization_hash TEXT NOT NULL UNIQUE CHECK (
        length(finalization_hash) = 64
        AND finalization_hash = lower(finalization_hash)
    ),
    finalized_at_utc TEXT NOT NULL CHECK (length(finalized_at_utc) > 0)
) STRICT;

CREATE TRIGGER local_match_finalizations_immutable
BEFORE UPDATE ON local_match_finalizations
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Local Match finalization is immutable.');
END;
