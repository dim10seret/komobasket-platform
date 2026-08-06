-- =====================================================
-- LINEUPS
-- FIBA LiveStats Lineup Engine
-- =====================================================

CREATE TABLE lineups (

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

    ----------------------------------------------------
    -- Lineup Lifetime
    ----------------------------------------------------

    started_event_sequence INTEGER NOT NULL,

    ended_event_sequence INTEGER,

    started_clock_seconds INTEGER NOT NULL,

    ended_clock_seconds INTEGER,

    ----------------------------------------------------
    -- Status
    ----------------------------------------------------

    is_active BOOLEAN
        NOT NULL
        DEFAULT TRUE,

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
    -- Foreign Keys
    ----------------------------------------------------

    CONSTRAINT fk_lineups_period
        FOREIGN KEY (
            period_id,
            match_id
        )
        REFERENCES game_periods (
            id,
            match_id
        )
        ON DELETE CASCADE,

    ----------------------------------------------------
    -- Constraints
    ----------------------------------------------------

    CONSTRAINT chk_lineup_start_sequence
        CHECK (
            started_event_sequence >= 0
        ),

    CONSTRAINT chk_lineup_end_sequence
        CHECK (
            ended_event_sequence IS NULL
            OR ended_event_sequence >= started_event_sequence
        ),

    CONSTRAINT chk_lineup_start_clock
        CHECK (
            started_clock_seconds >= 0
        ),

    CONSTRAINT chk_lineup_end_clock
        CHECK (
            ended_clock_seconds IS NULL
            OR ended_clock_seconds >= 0
        ),

    CONSTRAINT uq_lineup_match_team_start
        UNIQUE (
            match_id,
            team_registration_id,
            started_event_sequence
        )

);

-- =====================================================
-- LINEUP PLAYERS
-- Players participating in a lineup
-- =====================================================

CREATE TABLE lineup_players (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    ----------------------------------------------------
    -- Relations
    ----------------------------------------------------

    lineup_id UUID NOT NULL
        REFERENCES lineups(id)
        ON DELETE CASCADE,

    match_player_id UUID NOT NULL,

    match_id UUID NOT NULL,

    team_registration_id UUID NOT NULL,

    ----------------------------------------------------
    -- Audit
    ----------------------------------------------------

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    ----------------------------------------------------
    -- Foreign Keys
    ----------------------------------------------------

    CONSTRAINT fk_lineup_players_match_player
        FOREIGN KEY (
            match_player_id,
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

    CONSTRAINT uq_lineup_player
        UNIQUE (
            lineup_id,
            match_player_id
        ),

    CONSTRAINT uq_lineup_team_player
        UNIQUE (
            lineup_id,
            team_registration_id,
            match_player_id
        )

);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_lineups_match
ON lineups(match_id);

CREATE INDEX idx_lineups_period
ON lineups(period_id);

CREATE INDEX idx_lineups_team
ON lineups(team_registration_id);

CREATE INDEX idx_lineups_active
ON lineups(match_id, team_registration_id, is_active);

CREATE INDEX idx_lineups_start_sequence
ON lineups(match_id, started_event_sequence);

CREATE INDEX idx_lineups_end_sequence
ON lineups(match_id, ended_event_sequence);

CREATE INDEX idx_lineup_players_lineup
ON lineup_players(lineup_id);

CREATE INDEX idx_lineup_players_match_player
ON lineup_players(match_player_id);

CREATE INDEX idx_lineup_players_team
ON lineup_players(team_registration_id);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE lineups
IS 'Represents a lineup (five players on the court) for a team during a match.';

COMMENT ON TABLE lineup_players
IS 'Players belonging to a specific lineup.';

COMMENT ON COLUMN lineups.started_event_sequence
IS 'Event sequence where the lineup became active.';

COMMENT ON COLUMN lineups.ended_event_sequence
IS 'Event sequence where the lineup stopped being active.';

COMMENT ON COLUMN lineups.started_clock_seconds
IS 'Game clock remaining when the lineup became active.';

COMMENT ON COLUMN lineups.ended_clock_seconds
IS 'Game clock remaining when the lineup ended.';

COMMENT ON COLUMN lineups.is_active
IS 'True while this lineup is currently on the court.';

COMMENT ON COLUMN lineup_players.lineup_id
IS 'Reference to the lineup.';

COMMENT ON COLUMN lineup_players.match_player_id
IS 'Reference to the participating player in the match.';

ALTER TABLE match_events
ADD CONSTRAINT fk_match_events_lineup
FOREIGN KEY (lineup_id)
REFERENCES lineups(id);
