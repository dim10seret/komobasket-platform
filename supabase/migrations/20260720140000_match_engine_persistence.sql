-- Full typed payloads allow the KomoControl MatchEngine to replay every event exactly.
ALTER TABLE match_events
ADD COLUMN IF NOT EXISTS engine_event_id TEXT;

ALTER TABLE match_events
ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_match_events_engine_event
ON match_events (match_id, engine_event_id)
WHERE engine_event_id IS NOT NULL;

INSERT INTO lookup_event_types
    (code, name, category, points, affects_score, affects_player_stats, affects_team_stats, requires_player, requires_secondary_player, requires_coordinates, sort_order)
SELECT code, code, 'ENGINE', 0, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 1000
FROM unnest(ARRAY[
    'MATCH_START', 'MATCH_END', 'QUARTER_START', 'QUARTER_END', 'OVERTIME_START',
    'ALTERNATING_POSSESSION', 'CLOCK_START', 'CLOCK_STOP', 'CLOCK_SET', 'LINEUP_SET',
    'TWO_POINT', 'TWO_POINT_MISSED', 'THREE_POINT', 'THREE_POINT_MISSED',
    'FREE_THROW', 'SHOOTING_FOUL', 'REBOUND'
]) AS code
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS match_engine_snapshots (
    match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    initial_state JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE match_engine_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON match_engine_snapshots TO authenticated;
GRANT INSERT, UPDATE ON match_events TO authenticated;

COMMENT ON COLUMN match_events.payload
IS 'Complete typed KomoControl event payload used for deterministic MatchEngine replay.';
