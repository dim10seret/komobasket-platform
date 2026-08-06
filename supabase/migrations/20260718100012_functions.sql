-- =====================================================
-- TIME & PERIOD FUNCTIONS
-- =====================================================

-- -----------------------------------------------------
-- Returns the current active period
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION get_current_period(
    p_match_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT id
    FROM game_periods
    WHERE match_id = p_match_id
      AND status = 'live'
    LIMIT 1;
$$;

COMMENT ON FUNCTION get_current_period(UUID)
IS 'Returns the currently active period for a match.';

-- -----------------------------------------------------
-- Returns remaining game clock (seconds)
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION get_remaining_time(
    p_period_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT remaining_seconds
    FROM game_periods
    WHERE id = p_period_id;
$$;

COMMENT ON FUNCTION get_remaining_time(UUID)
IS 'Returns the remaining seconds of the specified period.';

-- -----------------------------------------------------
-- Checks whether the current period has ended
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_period_finished(
    p_period_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT status = 'finished'
    FROM game_periods
    WHERE id = p_period_id;
$$;

COMMENT ON FUNCTION is_period_finished(UUID)
IS 'Returns TRUE if the specified period has finished.';

-- -----------------------------------------------------
-- Checks whether the match has finished
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_match_finished(
    p_match_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT status = 'finished'
    FROM matches
    WHERE id = p_match_id;
$$;

COMMENT ON FUNCTION is_match_finished(UUID)
IS 'Returns TRUE if the specified match has finished.';

-- =====================================================
-- LINEUP FUNCTIONS
-- =====================================================

-- -----------------------------------------------------
-- Returns the currently active lineup
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION get_active_lineup(
    p_match_id UUID,
    p_team_registration_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT id
    FROM lineups
    WHERE match_id = p_match_id
      AND team_registration_id = p_team_registration_id
      AND is_active = TRUE
    LIMIT 1;
$$;

COMMENT ON FUNCTION get_active_lineup(UUID, UUID)
IS 'Returns the currently active lineup for a team.';

-- -----------------------------------------------------
-- Closes the active lineup
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION close_lineup(
    p_lineup_id UUID,
    p_event_sequence INTEGER,
    p_clock_seconds INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN

    UPDATE lineups
       SET ended_event_sequence = p_event_sequence,
           ended_clock_seconds   = p_clock_seconds,
           is_active             = FALSE,
           updated_at            = now()
     WHERE id = p_lineup_id;

END;
$$;

COMMENT ON FUNCTION close_lineup(UUID, INTEGER, INTEGER)
IS 'Closes an active lineup.';

-- -----------------------------------------------------
-- Creates a new lineup
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION create_lineup(

    p_match_id UUID,
    p_period_id UUID,
    p_team_registration_id UUID,
    p_event_sequence INTEGER,
    p_clock_seconds INTEGER

)
RETURNS UUID
LANGUAGE plpgsql
AS $$

DECLARE

    v_lineup_id UUID;

BEGIN

    INSERT INTO lineups (

        match_id,
        period_id,
        team_registration_id,
        started_event_sequence,
        started_clock_seconds,
        is_active

    )

    VALUES (

        p_match_id,
        p_period_id,
        p_team_registration_id,
        p_event_sequence,
        p_clock_seconds,
        TRUE

    )

    RETURNING id
    INTO v_lineup_id;

    RETURN v_lineup_id;

END;
$$;

COMMENT ON FUNCTION create_lineup(UUID, UUID, UUID, INTEGER, INTEGER)
IS 'Creates a new active lineup.';

-- -----------------------------------------------------
-- Validates that a lineup exists
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION validate_lineup(
    p_lineup_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM lineups
        WHERE id = p_lineup_id
    );
$$;

COMMENT ON FUNCTION validate_lineup(UUID)
IS 'Checks whether a lineup exists.';

-- =====================================================
-- VALIDATION FUNCTIONS
-- =====================================================

-- -----------------------------------------------------
-- Checks whether a player is currently on the court
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_player_on_court(
    p_lineup_id UUID,
    p_match_player_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM lineup_players
         WHERE lineup_id = p_lineup_id
           AND match_player_id = p_match_player_id
    );
$$;

COMMENT ON FUNCTION is_player_on_court(UUID, UUID)
IS 'Returns TRUE if the player belongs to the specified lineup.';

-- -----------------------------------------------------
-- Validates a substitution request
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION validate_substitution(
    p_lineup_id UUID,
    p_player_out UUID,
    p_player_in UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

    -- Same player
    IF p_player_out = p_player_in THEN
        RETURN FALSE;
    END IF;

    -- Player leaving must be on the court
    IF NOT is_player_on_court(
        p_lineup_id,
        p_player_out
    ) THEN
        RETURN FALSE;
    END IF;

    -- Player entering must NOT already be on the court
    IF is_player_on_court(
        p_lineup_id,
        p_player_in
    ) THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;

END;
$$;

COMMENT ON FUNCTION validate_substitution(UUID, UUID, UUID)
IS 'Validates a substitution before it is applied.';

-- -----------------------------------------------------
-- Validates starting five
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION validate_starting_five(
    p_match_id UUID,
    p_team_registration_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*) = 5
      FROM match_players
     WHERE match_id = p_match_id
       AND team_registration_id = p_team_registration_id
       AND is_starting_five = TRUE
       AND is_available = TRUE;
$$;

COMMENT ON FUNCTION validate_starting_five(UUID, UUID)
IS 'Checks that exactly five available players are marked as the starting five.';

-- =====================================================
-- UTILITY FUNCTIONS
-- =====================================================

-- -----------------------------------------------------
-- Returns the next event sequence number
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION next_event_sequence(
    p_match_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(last_event_sequence, 0) + 1
    FROM matches
    WHERE id = p_match_id;
$$;

COMMENT ON FUNCTION next_event_sequence(UUID)
IS 'Returns the next available event sequence number for the match.';

-- -----------------------------------------------------
-- Returns the current match clock
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION match_clock(
    p_period_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT remaining_seconds
    FROM game_periods
    WHERE id = p_period_id;
$$;

COMMENT ON FUNCTION match_clock(UUID)
IS 'Returns the remaining game clock in seconds.';

-- -----------------------------------------------------
-- Returns TRUE if the match clock is running
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_clock_running(
    p_period_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT clock_running
    FROM game_periods
    WHERE id = p_period_id;
$$;

COMMENT ON FUNCTION is_clock_running(UUID)
IS 'Returns TRUE if the game clock is currently running.';

-- -----------------------------------------------------
-- Refresh updated_at timestamp
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    NEW.updated_at := now();

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION touch_updated_at()
IS 'Generic trigger function that refreshes updated_at before update.';

-- =====================================================
-- MATCH STATE FUNCTIONS
-- =====================================================

-- -----------------------------------------------------
-- Returns the active lineup for a team
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION get_active_lineup_id(
    p_match_id UUID,
    p_team_registration_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT id
      FROM lineups
     WHERE match_id = p_match_id
       AND team_registration_id = p_team_registration_id
       AND is_active = TRUE
     LIMIT 1;
$$;

COMMENT ON FUNCTION get_active_lineup_id(UUID, UUID)
IS 'Returns the active lineup id for a team.';

-- -----------------------------------------------------
-- Returns the number of active players in a lineup
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION lineup_player_count(
    p_lineup_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*)
      FROM lineup_players
     WHERE lineup_id = p_lineup_id;
$$;

COMMENT ON FUNCTION lineup_player_count(UUID)
IS 'Returns the number of players assigned to a lineup.';

-- -----------------------------------------------------
-- Checks whether a lineup is complete
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_complete_lineup(
    p_lineup_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT COUNT(*) = 5
      FROM lineup_players
     WHERE lineup_id = p_lineup_id;
$$;

COMMENT ON FUNCTION is_complete_lineup(UUID)
IS 'Returns TRUE when a lineup contains exactly five players.';

-- -----------------------------------------------------
-- Checks whether a team currently has an active lineup
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION has_active_lineup(
    p_match_id UUID,
    p_team_registration_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM lineups
         WHERE match_id = p_match_id
           AND team_registration_id = p_team_registration_id
           AND is_active = TRUE
    );
$$;

COMMENT ON FUNCTION has_active_lineup(UUID, UUID)
IS 'Returns TRUE if the team currently has an active lineup.';