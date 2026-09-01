CREATE TABLE local_resumable_live_flows (
    run_id TEXT PRIMARY KEY REFERENCES local_match_engine_snapshots(run_id) ON DELETE CASCADE,
    flow_schema_version INTEGER NOT NULL CHECK (flow_schema_version = 1),
    flow_kind TEXT NOT NULL CHECK (flow_kind = 'SHOOTING_FOUL'),
    stage TEXT NOT NULL CHECK (stage = 'PENALTY'),
    root_event_id TEXT NOT NULL CHECK (length(root_event_id) > 0),
    source_foul_event_id TEXT NOT NULL CHECK (length(source_foul_event_id) > 0),
    selected_free_throw_shooter_id TEXT NOT NULL CHECK (length(selected_free_throw_shooter_id) > 0),
    event_history_revision INTEGER NOT NULL CHECK (event_history_revision >= 1),
    state_json TEXT NOT NULL CHECK (length(state_json) > 0),
    state_hash TEXT NOT NULL CHECK (length(state_hash) = 64 AND state_hash = lower(state_hash)),
    created_at_utc TEXT NOT NULL CHECK (length(created_at_utc) > 0),
    updated_at_utc TEXT NOT NULL CHECK (length(updated_at_utc) > 0)
) STRICT;

CREATE INDEX local_resumable_live_flows_source_foul_idx ON local_resumable_live_flows(source_foul_event_id);
