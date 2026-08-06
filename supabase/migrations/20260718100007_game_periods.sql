-- =====================================================
-- GAME PERIODS
-- FIBA LiveStats Architecture
-- =====================================================

CREATE TABLE game_periods (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    ----------------------------------------------------
    -- Relations
    ----------------------------------------------------

    match_id UUID NOT NULL
        REFERENCES matches(id)
        ON DELETE CASCADE,

    ----------------------------------------------------
    -- Period Definition
    ----------------------------------------------------

    period_number SMALLINT NOT NULL,

    period_type period_type NOT NULL,

    sequence SMALLINT NOT NULL,

    ----------------------------------------------------
    -- State
    ----------------------------------------------------

    status period_status
        NOT NULL
        DEFAULT 'scheduled',

    ----------------------------------------------------
    -- Official Duration
    ----------------------------------------------------

    duration_seconds INTEGER
        NOT NULL,

    ----------------------------------------------------
    -- Runtime
    ----------------------------------------------------

    remaining_seconds INTEGER
        NOT NULL,

    clock_running BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    ----------------------------------------------------
    -- Timeline
    ----------------------------------------------------

    started_at TIMESTAMPTZ,

    ended_at TIMESTAMPTZ,

    ----------------------------------------------------
    -- Audit
    ----------------------------------------------------

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    ----------------------------------------------------
    -- Constraints
    ----------------------------------------------------

    CONSTRAINT uq_game_period_match_number
        UNIQUE (
            match_id,
            period_number
        ),

    CONSTRAINT uq_game_period_match_sequence
        UNIQUE (
            match_id,
            sequence
        ),

    CONSTRAINT uq_game_period_id_match
        UNIQUE (
            id,
            match_id
        ),

    CONSTRAINT chk_period_number
        CHECK (
            period_number >= 1
        ),

    CONSTRAINT chk_sequence
        CHECK (
            sequence >= 1
        ),

    CONSTRAINT chk_duration
        CHECK (
            duration_seconds > 0
        ),

    CONSTRAINT chk_remaining
        CHECK (
            remaining_seconds >= 0
            AND remaining_seconds <= duration_seconds
        )

);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_game_periods_match
ON game_periods(match_id);

CREATE INDEX idx_game_periods_status
ON game_periods(status);

CREATE INDEX idx_game_periods_type
ON game_periods(period_type);

CREATE INDEX idx_game_periods_sequence
ON game_periods(match_id, sequence);

CREATE INDEX idx_game_periods_number
ON game_periods(match_id, period_number);

CREATE INDEX idx_game_periods_running
ON game_periods(clock_running);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE game_periods
IS 'Game periods for a basketball match following the FIBA LiveStats model.';

COMMENT ON COLUMN game_periods.period_number
IS 'Quarter number (1-4) or overtime number (5+).';

COMMENT ON COLUMN game_periods.period_type
IS 'Regular period or overtime.';

COMMENT ON COLUMN game_periods.sequence
IS 'Sequential order of the period within the match.';

COMMENT ON COLUMN game_periods.status
IS 'Current lifecycle status of the period.';

COMMENT ON COLUMN game_periods.duration_seconds
IS 'Official duration of the period in seconds.';

COMMENT ON COLUMN game_periods.remaining_seconds
IS 'Current remaining time on the game clock.';

COMMENT ON COLUMN game_periods.clock_running
IS 'Indicates whether the game clock is currently running.';

COMMENT ON COLUMN game_periods.started_at
IS 'Timestamp when the period started.';

COMMENT ON COLUMN game_periods.ended_at
IS 'Timestamp when the period ended.';

ALTER TABLE matches
ADD CONSTRAINT fk_matches_current_period
FOREIGN KEY (current_period_id)
REFERENCES game_periods(id)
ON DELETE SET NULL;
