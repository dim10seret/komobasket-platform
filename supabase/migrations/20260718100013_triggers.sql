-- =====================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    NEW.updated_at := NOW();

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION trg_set_updated_at()
IS 'Automatically updates the updated_at timestamp before UPDATE operations.';

-- =====================================================
-- MATCHES
-- =====================================================

CREATE TRIGGER trg_matches_updated_at

BEFORE UPDATE
ON matches

FOR EACH ROW

EXECUTE FUNCTION trg_set_updated_at();

-- =====================================================
-- GAME PERIODS
-- =====================================================

CREATE TRIGGER trg_game_periods_updated_at

BEFORE UPDATE
ON game_periods

FOR EACH ROW

EXECUTE FUNCTION trg_set_updated_at();

-- =====================================================
-- MATCH PLAYERS
-- =====================================================

CREATE TRIGGER trg_match_players_updated_at

BEFORE UPDATE
ON match_players

FOR EACH ROW

EXECUTE FUNCTION trg_set_updated_at();

-- =====================================================
-- LINEUPS
-- =====================================================

CREATE TRIGGER trg_lineups_updated_at

BEFORE UPDATE
ON lineups

FOR EACH ROW

EXECUTE FUNCTION trg_set_updated_at();

-- =====================================================
-- STARTING FIVE VALIDATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION trg_validate_starting_five()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_starting_count INTEGER;
BEGIN

    -- Count current starting five players
    SELECT COUNT(*)
      INTO v_starting_count
      FROM match_players
     WHERE match_id = NEW.match_id
       AND team_registration_id = NEW.team_registration_id
       AND is_starting_five = TRUE;

    -- Reject more than five starters
    IF NEW.is_starting_five = TRUE
       AND v_starting_count >= 5 THEN

        RAISE EXCEPTION
            'A team cannot have more than five starting players.';

    END IF;

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION trg_validate_starting_five()
IS 'Ensures that a team cannot register more than five starting players.';

-- =====================================================
-- TRIGGER
-- =====================================================

CREATE TRIGGER trg_validate_starting_five

BEFORE INSERT OR UPDATE
ON match_players

FOR EACH ROW

EXECUTE FUNCTION trg_validate_starting_five();

-- =====================================================
-- LINEUP MANAGEMENT
-- =====================================================

CREATE OR REPLACE FUNCTION trg_manage_lineup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE

    v_new_lineup UUID;

BEGIN

    ----------------------------------------------------
    -- Close current lineup
    ----------------------------------------------------

    PERFORM close_lineup(

        NEW.lineup_id,
        NEW.event_sequence,
        NEW.clock_seconds

    );

    ----------------------------------------------------
    -- Create next lineup
    ----------------------------------------------------

    v_new_lineup := create_lineup(

        NEW.match_id,
        NEW.period_id,
        NEW.team_registration_id,
        NEW.event_sequence,
        NEW.clock_seconds

    );

    ----------------------------------------------------
    -- Copy players from previous lineup
    ----------------------------------------------------

    INSERT INTO lineup_players (

        lineup_id,
        match_player_id,
        match_id,
        team_registration_id

    )

    SELECT

        v_new_lineup,
        match_player_id,
        match_id,
        team_registration_id

    FROM lineup_players

    WHERE lineup_id = NEW.lineup_id;

    ----------------------------------------------------
    -- Remove player leaving
    ----------------------------------------------------

    DELETE FROM lineup_players

    WHERE lineup_id = v_new_lineup

      AND match_player_id = NEW.player_out_id;

    ----------------------------------------------------
    -- Add player entering
    ----------------------------------------------------

    INSERT INTO lineup_players (

        lineup_id,
        match_player_id,
        match_id,
        team_registration_id

    )

    VALUES (

        v_new_lineup,
        NEW.player_in_id,
        NEW.match_id,
        NEW.team_registration_id

    );

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION trg_manage_lineup()
IS 'Closes the current lineup, creates the next lineup and transfers players after a substitution.';

-- =====================================================
-- TRIGGER
-- =====================================================

CREATE TRIGGER trg_manage_lineup

AFTER INSERT
ON substitutions

FOR EACH ROW

EXECUTE FUNCTION trg_manage_lineup();

-- =====================================================
-- SUBSTITUTION VALIDATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION trg_validate_substitution()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    ----------------------------------------------------
    -- Business rule validation
    ----------------------------------------------------

    PERFORM validate_substitution(
        NEW.match_id,
        NEW.team_registration_id,
        NEW.player_out_id,
        NEW.player_in_id
    );

    ----------------------------------------------------
    -- Players cannot be the same
    ----------------------------------------------------

    IF NEW.player_out_id = NEW.player_in_id THEN
        RAISE EXCEPTION
            'Player OUT and Player IN cannot be the same.';
    END IF;

    ----------------------------------------------------
    -- OUT player must currently be on court
    ----------------------------------------------------

    IF NOT is_player_on_court(
        NEW.match_id,
        NEW.team_registration_id,
        NEW.player_out_id
    ) THEN

        RAISE EXCEPTION
            'Player OUT is not currently on the court.';
    END IF;

    ----------------------------------------------------
    -- IN player must not currently be on court
    ----------------------------------------------------

    IF is_player_on_court(
        NEW.match_id,
        NEW.team_registration_id,
        NEW.player_in_id
    ) THEN

        RAISE EXCEPTION
            'Player IN is already on the court.';
    END IF;

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION trg_validate_substitution()
IS 'Validates a substitution before it is recorded.';

-- =====================================================
-- TRIGGER
-- =====================================================

CREATE TRIGGER trg_validate_substitution

BEFORE INSERT
ON substitutions

FOR EACH ROW

EXECUTE FUNCTION trg_validate_substitution();

-- =====================================================
-- LINEUP INTEGRITY VALIDATION
-- =====================================================

CREATE OR REPLACE FUNCTION trg_validate_lineup_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_player_count INTEGER;
BEGIN

    ----------------------------------------------------
    -- Count players in the lineup
    ----------------------------------------------------

    SELECT COUNT(*)
      INTO v_player_count
      FROM lineup_players
     WHERE lineup_id = NEW.lineup_id;

    ----------------------------------------------------
    -- Maximum five players
    ----------------------------------------------------

    IF v_player_count > 5 THEN
        RAISE EXCEPTION
            'A lineup cannot contain more than five players.';
    END IF;

    ----------------------------------------------------
    -- Duplicate player check
    ----------------------------------------------------

    IF EXISTS (
        SELECT 1
          FROM lineup_players
         WHERE lineup_id = NEW.lineup_id
         GROUP BY match_player_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate player detected in lineup.';
    END IF;

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION trg_validate_lineup_integrity()
IS 'Ensures that a lineup contains no duplicate players and no more than five players.';

-- =====================================================
-- ACTIVE LINEUP VALIDATION
-- =====================================================

CREATE OR REPLACE FUNCTION trg_validate_active_lineup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN

    IF NEW.is_active THEN

        IF EXISTS (
            SELECT 1
              FROM lineups
             WHERE match_id = NEW.match_id
               AND team_registration_id = NEW.team_registration_id
               AND is_active = TRUE
               AND id <> NEW.id
        ) THEN

            RAISE EXCEPTION
                'Only one active lineup is allowed per team.';

        END IF;

    END IF;

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION trg_validate_active_lineup()
IS 'Ensures that each team has only one active lineup per match.';

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE TRIGGER trg_validate_lineup_integrity

AFTER INSERT OR UPDATE
ON lineup_players

FOR EACH ROW

EXECUTE FUNCTION trg_validate_lineup_integrity();

CREATE TRIGGER trg_validate_active_lineup

BEFORE INSERT OR UPDATE
ON lineups

FOR EACH ROW

EXECUTE FUNCTION trg_validate_active_lineup();

