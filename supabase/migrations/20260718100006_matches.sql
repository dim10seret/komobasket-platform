-- =====================================================
-- MATCHES
-- FIBA LiveStats Architecture
-- =====================================================

CREATE TABLE matches (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ----------------------------------------------------
    -- Competition
    ----------------------------------------------------

    competition_id UUID NOT NULL
        REFERENCES competitions(id)
        ON DELETE CASCADE,

    season_id UUID NOT NULL
        REFERENCES seasons(id)
        ON DELETE CASCADE,

    ----------------------------------------------------
    -- Teams
    ----------------------------------------------------

    home_team_registration_id UUID NOT NULL
        REFERENCES team_registrations(id)
        ON DELETE RESTRICT,

    away_team_registration_id UUID NOT NULL
        REFERENCES team_registrations(id)
        ON DELETE RESTRICT,

    ----------------------------------------------------
    -- Venue
    ----------------------------------------------------

    venue_id UUID
        REFERENCES venues(id)
        ON DELETE SET NULL,

    ----------------------------------------------------
    -- Scheduling
    ----------------------------------------------------

    match_number INTEGER,

    round INTEGER,

    group_name TEXT,

    stage TEXT,

    match_date DATE NOT NULL,

    match_time TIME,

    ----------------------------------------------------
    -- Live Game State
    ----------------------------------------------------

    status match_status
        NOT NULL
        DEFAULT 'scheduled',

    current_period_id UUID,

    clock_running BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    possession_team_registration_id UUID,

    last_event_sequence INTEGER
        NOT NULL
        DEFAULT 0,

    ----------------------------------------------------
    -- Cached Score
    ----------------------------------------------------

    home_score INTEGER
        NOT NULL
        DEFAULT 0,

    away_score INTEGER
        NOT NULL
        DEFAULT 0,

    ----------------------------------------------------
    -- Current Period Score
    ----------------------------------------------------

    home_period_score INTEGER
        NOT NULL
        DEFAULT 0,

    away_period_score INTEGER
        NOT NULL
        DEFAULT 0,

    ----------------------------------------------------
    -- Administration
    ----------------------------------------------------

    attendance INTEGER,

    is_neutral BOOLEAN
        NOT NULL
        DEFAULT FALSE,

    notes TEXT,

    approved_at TIMESTAMPTZ,

    approved_by UUID
        REFERENCES officials(id)
        ON DELETE SET NULL,

    locked_at TIMESTAMPTZ,

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

    CONSTRAINT chk_match_different_teams
        CHECK (
            home_team_registration_id <>
            away_team_registration_id
        ),

    CONSTRAINT chk_match_home_score
        CHECK (
            home_score >= 0
        ),

    CONSTRAINT chk_match_away_score
        CHECK (
            away_score >= 0
        ),

    CONSTRAINT chk_home_period_score
        CHECK (
            home_period_score >= 0
        ),

    CONSTRAINT chk_away_period_score
        CHECK (
            away_period_score >= 0
        ),

    CONSTRAINT chk_last_event_sequence
        CHECK (
            last_event_sequence >= 0
        ),

    CONSTRAINT chk_attendance
        CHECK (
            attendance IS NULL
            OR attendance >= 0
        )

);

-- =====================================================
-- MATCH OFFICIALS
-- =====================================================

CREATE TABLE match_officials (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    match_id UUID
        NOT NULL
        REFERENCES matches(id)
        ON DELETE CASCADE,

    official_id UUID
        NOT NULL
        REFERENCES officials(id)
        ON DELETE RESTRICT,

    role official_role
        NOT NULL,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    UNIQUE (
        match_id,
        official_id,
        role
    )

);

-- =====================================================
-- MATCH TEAMS
-- Team-specific match information
-- =====================================================

CREATE TABLE match_teams (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    ----------------------------------------------------
    -- Relations
    ----------------------------------------------------

    match_id UUID
        NOT NULL
        REFERENCES matches(id)
        ON DELETE CASCADE,

    team_registration_id UUID
        NOT NULL
        REFERENCES team_registrations(id)
        ON DELETE CASCADE,

    ----------------------------------------------------
    -- Bench
    ----------------------------------------------------

    captain_player_registration_id UUID,

    coach_name TEXT,

    assistant_coach_name TEXT,

    ----------------------------------------------------
    -- Administrative
    ----------------------------------------------------

    bench_side SMALLINT,

    is_home_team BOOLEAN
        NOT NULL,

    created_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    updated_at TIMESTAMPTZ
        NOT NULL
        DEFAULT now(),

    ----------------------------------------------------
    -- Constraints
    ----------------------------------------------------

    CONSTRAINT uq_match_team
        UNIQUE (
            match_id,
            team_registration_id
        ),

    CONSTRAINT chk_bench_side
        CHECK (
            bench_side IS NULL
            OR bench_side IN (1,2)
        )

);

--------------------------------------------------------
-- Captain belongs to this team
--------------------------------------------------------

ALTER TABLE match_teams
ADD CONSTRAINT fk_match_team_captain
FOREIGN KEY (

    captain_player_registration_id,
    team_registration_id

)
REFERENCES player_registrations (

    id,
    team_registration_id

)
ON DELETE SET NULL;

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_matches_competition
ON matches(competition_id);

CREATE INDEX idx_matches_season
ON matches(season_id);

CREATE INDEX idx_matches_status
ON matches(status);

CREATE INDEX idx_matches_date
ON matches(match_date);

CREATE INDEX idx_matches_match_number
ON matches(match_number);

CREATE INDEX idx_matches_round
ON matches(round);

CREATE INDEX idx_matches_home
ON matches(home_team_registration_id);

CREATE INDEX idx_matches_away
ON matches(away_team_registration_id);

CREATE INDEX idx_matches_current_period
ON matches(current_period_id);

CREATE INDEX idx_matches_possession
ON matches(possession_team_registration_id);

CREATE INDEX idx_match_officials_match
ON match_officials(match_id);

CREATE INDEX idx_match_officials_official
ON match_officials(official_id);

CREATE INDEX idx_match_teams_match
ON match_teams(match_id);

CREATE INDEX idx_match_teams_registration
ON match_teams(team_registration_id);

CREATE INDEX idx_match_teams_home
ON match_teams(is_home_team);

CREATE INDEX idx_match_teams_captain
ON match_teams(captain_player_registration_id);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE matches
IS 'Basketball matches following the FIBA LiveStats model.';

COMMENT ON TABLE match_officials
IS 'Officials assigned to a basketball match.';

COMMENT ON TABLE match_teams
IS 'Team-specific information for a basketball match.';
