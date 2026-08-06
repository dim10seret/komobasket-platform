-- =====================================================
-- MATCH PLAYERS
-- Players participating in a specific match
-- =====================================================

CREATE TABLE match_players (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    ----------------------------------------------------
    -- Relations
    ----------------------------------------------------

    match_id UUID NOT NULL
        REFERENCES matches(id)
        ON DELETE CASCADE,

    team_registration_id UUID NOT NULL
        REFERENCES team_registrations(id)
        ON DELETE RESTRICT,

    player_registration_id UUID NOT NULL,

    ----------------------------------------------------
    -- Match Information
    ----------------------------------------------------

    jersey_number SMALLINT NOT NULL,

    is_starting_five BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    is_captain BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    is_available BOOLEAN
        NOT NULL
        DEFAULT TRUE,

    ----------------------------------------------------
    -- Cached Match State
    ----------------------------------------------------

    fouls SMALLINT
        NOT NULL
        DEFAULT 0,

    is_disqualified BOOLEAN
        NOT NULL
        DEFAULT FALSE,

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

    CONSTRAINT fk_match_players_registration
        FOREIGN KEY (
            player_registration_id,
            team_registration_id
        )
        REFERENCES player_registrations (
            id,
            team_registration_id
        )
        ON DELETE RESTRICT,

    ----------------------------------------------------
    -- Unique Constraints
    ----------------------------------------------------

    CONSTRAINT uq_match_player
        UNIQUE (
            match_id,
            player_registration_id
        ),

    CONSTRAINT uq_match_team_jersey
        UNIQUE (
            match_id,
            team_registration_id,
            jersey_number
        ),

    CONSTRAINT uq_match_player_team
        UNIQUE (
            id,
            match_id,
            team_registration_id
        ),

    ----------------------------------------------------
    -- Checks
    ----------------------------------------------------

    CONSTRAINT chk_match_player_fouls
        CHECK (
            fouls BETWEEN 0 AND 5
        ),

    CONSTRAINT chk_match_player_jersey
        CHECK (
            jersey_number BETWEEN 0 AND 199
        )

);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_match_players_match
ON match_players(match_id);

CREATE INDEX idx_match_players_team
ON match_players(team_registration_id);

CREATE INDEX idx_match_players_player_registration
ON match_players(player_registration_id);

CREATE INDEX idx_match_players_match_team
ON match_players(
    match_id,
    team_registration_id
);

CREATE INDEX idx_match_players_starting_five
ON match_players(
    match_id,
    is_starting_five
);

CREATE INDEX idx_match_players_available
ON match_players(
    match_id,
    is_available
);

CREATE INDEX idx_match_players_disqualified
ON match_players(
    match_id,
    is_disqualified
);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE match_players
IS 'Snapshot of all players available for a specific match.';

COMMENT ON COLUMN match_players.match_id
IS 'Reference to the basketball match.';

COMMENT ON COLUMN match_players.team_registration_id
IS 'Team participating in the match.';

COMMENT ON COLUMN match_players.player_registration_id
IS 'Player registration linked to the participating team.';

COMMENT ON COLUMN match_players.jersey_number
IS 'Jersey number used during this match.';

COMMENT ON COLUMN match_players.is_starting_five
IS 'True if the player is part of the starting five.';

COMMENT ON COLUMN match_players.is_captain
IS 'True if the player is the team captain for this match.';

COMMENT ON COLUMN match_players.is_available
IS 'False if the player is unavailable before the game starts.';

COMMENT ON COLUMN match_players.fouls
IS 'Cached personal foul count. Updated automatically from match events.';

COMMENT ON COLUMN match_players.is_disqualified
IS 'True when the player has fouled out or has been disqualified.';

COMMENT ON COLUMN match_players.created_at
IS 'Record creation timestamp.';

COMMENT ON COLUMN match_players.updated_at
IS 'Last update timestamp.';