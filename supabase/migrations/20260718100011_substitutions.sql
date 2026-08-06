-- =====================================================
-- SUBSTITUTIONS
-- FIBA LiveStats Substitution Engine
-- =====================================================

CREATE TABLE substitutions (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    ----------------------------------------------------
    -- Relations
    ----------------------------------------------------

    match_id UUID NOT NULL
        REFERENCES matches(id)
        ON DELETE CASCADE,

    period_id UUID NOT NULL,

    team_registration_id UUID NOT NULL
        REFERENCES team_registrations(id)
        ON DELETE RESTRICT,

    lineup_id UUID NOT NULL
        REFERENCES lineups(id)
        ON DELETE RESTRICT,

    ----------------------------------------------------
    -- Players
    ----------------------------------------------------

    player_out_id UUID NOT NULL,

    player_in_id UUID NOT NULL,

    ----------------------------------------------------
    -- Game Position
    ----------------------------------------------------

    event_sequence INTEGER NOT NULL,

    clock_seconds INTEGER NOT NULL,

    ----------------------------------------------------
    -- Audit
    ----------------------------------------------------

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    ----------------------------------------------------
    -- Foreign Keys
    ----------------------------------------------------

    CONSTRAINT fk_substitutions_period
        FOREIGN KEY (
            period_id,
            match_id
        )
        REFERENCES game_periods (
            id,
            match_id
        )
        ON DELETE CASCADE,

    CONSTRAINT fk_substitutions_player_out
        FOREIGN KEY (
            player_out_id,
            match_id,
            team_registration_id
        )
        REFERENCES match_players (
            id,
            match_id,
            team_registration_id
        )
        ON DELETE RESTRICT,

    CONSTRAINT fk_substitutions_player_in
        FOREIGN KEY (
            player_in_id,
            match_id,
            team_registration_id
        )
        REFERENCES match_players (
            id,
            match_id,
            team_registration_id
        )
        ON DELETE RESTRICT,

    ----------------------------------------------------
    -- Constraints
    ----------------------------------------------------

    CONSTRAINT chk_substitution_players
        CHECK (
            player_out_id <> player_in_id
        ),

    CONSTRAINT chk_substitution_sequence
        CHECK (
            event_sequence >= 0
        ),

    CONSTRAINT chk_substitution_clock
        CHECK (
            clock_seconds >= 0
        ),

    CONSTRAINT uq_substitution_event
        UNIQUE (
            match_id,
            event_sequence,
            team_registration_id
        )

);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_substitutions_match
ON substitutions(match_id);

CREATE INDEX idx_substitutions_period
ON substitutions(period_id);

CREATE INDEX idx_substitutions_team
ON substitutions(team_registration_id);

CREATE INDEX idx_substitutions_lineup
ON substitutions(lineup_id);

CREATE INDEX idx_substitutions_event_sequence
ON substitutions(
    match_id,
    event_sequence
);

CREATE INDEX idx_substitutions_player_out
ON substitutions(player_out_id);

CREATE INDEX idx_substitutions_player_in
ON substitutions(player_in_id);

CREATE INDEX idx_substitutions_clock
ON substitutions(
    match_id,
    period_id,
    clock_seconds
);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE substitutions
IS 'Player substitutions recorded during a basketball match following the FIBA LiveStats model.';

COMMENT ON COLUMN substitutions.match_id
IS 'Reference to the basketball match.';

COMMENT ON COLUMN substitutions.period_id
IS 'Reference to the game period in which the substitution occurred.';

COMMENT ON COLUMN substitutions.team_registration_id
IS 'Team performing the substitution.';

COMMENT ON COLUMN substitutions.lineup_id
IS 'Lineup active immediately before the substitution.';

COMMENT ON COLUMN substitutions.player_out_id
IS 'Player leaving the court.';

COMMENT ON COLUMN substitutions.player_in_id
IS 'Player entering the court.';

COMMENT ON COLUMN substitutions.event_sequence
IS 'Sequential event number within the match.';

COMMENT ON COLUMN substitutions.clock_seconds
IS 'Remaining game clock when the substitution occurred.';

COMMENT ON COLUMN substitutions.created_at
IS 'Timestamp when the substitution record was created.';

-- =====================================================
-- VALIDATION SUPPORT INDEXES
-- =====================================================

CREATE INDEX idx_substitutions_match_team_period
ON substitutions (
    match_id,
    team_registration_id,
    period_id
);

CREATE INDEX idx_substitutions_match_clock
ON substitutions (
    match_id,
    clock_seconds
);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE substitutions
IS 'Records every player substitution during a match. Each substitution closes the current lineup and starts a new lineup.';

COMMENT ON COLUMN substitutions.lineup_id
IS 'The lineup that was active immediately before this substitution.';

COMMENT ON COLUMN substitutions.player_out_id
IS 'Match player leaving the court.';

COMMENT ON COLUMN substitutions.player_in_id
IS 'Match player entering the court.';

COMMENT ON COLUMN substitutions.event_sequence
IS 'Sequential order of the substitution within the match.';

COMMENT ON COLUMN substitutions.clock_seconds
IS 'Game clock (remaining seconds) when the substitution occurred.';