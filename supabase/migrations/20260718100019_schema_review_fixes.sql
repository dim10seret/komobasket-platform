-- ============================================================
-- KomoBasket
-- Migration 019
-- Schema Review Fixes
-- ============================================================

BEGIN;

-- ============================================================
-- Function
-- Validate Match Integrity
-- ============================================================

CREATE OR REPLACE FUNCTION validate_match_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
DECLARE
    v_season_competition_id UUID;
    v_home_season_id UUID;
    v_away_season_id UUID;
BEGIN

    --------------------------------------------------------------------
    -- Validate Season exists
    --------------------------------------------------------------------

    SELECT competition_id
      INTO v_season_competition_id
      FROM seasons
     WHERE id = NEW.season_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Season (%) does not exist.',
            NEW.season_id;
    END IF;

    --------------------------------------------------------------------
    -- Season belongs to Competition
    --------------------------------------------------------------------

    IF v_season_competition_id <> NEW.competition_id THEN
        RAISE EXCEPTION
            'Season (%) does not belong to Competition (%).',
            NEW.season_id,
            NEW.competition_id;
    END IF;

    --------------------------------------------------------------------
    -- Home Team Registration
    --------------------------------------------------------------------

    SELECT season_id
      INTO v_home_season_id
      FROM team_registrations
     WHERE id = NEW.home_team_registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Home Team Registration (%) does not exist.',
            NEW.home_team_registration_id;
    END IF;

    --------------------------------------------------------------------
    -- Away Team Registration
    --------------------------------------------------------------------

    SELECT season_id
      INTO v_away_season_id
      FROM team_registrations
     WHERE id = NEW.away_team_registration_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Away Team Registration (%) does not exist.',
            NEW.away_team_registration_id;
    END IF;

    --------------------------------------------------------------------
    -- Team Registrations belong to Match Season
    --------------------------------------------------------------------

    IF v_home_season_id <> NEW.season_id THEN
        RAISE EXCEPTION
            'Home Team Registration belongs to another Season.';
    END IF;

    IF v_away_season_id <> NEW.season_id THEN
        RAISE EXCEPTION
            'Away Team Registration belongs to another Season.';
    END IF;

    --------------------------------------------------------------------
    -- Home and Away cannot be the same team
    --------------------------------------------------------------------

    IF NEW.home_team_registration_id =
       NEW.away_team_registration_id THEN

        RAISE EXCEPTION
            'Home and Away Team Registrations cannot be the same.';
    END IF;

    RETURN NEW;

END;
$$;

COMMENT ON FUNCTION validate_match_integrity()
IS 'Validates competition, season and team registration consistency before saving a match.';

-- ============================================================
-- Trigger
-- ============================================================

DROP TRIGGER IF EXISTS trg_validate_match_integrity
ON matches;

CREATE TRIGGER trg_validate_match_integrity
BEFORE INSERT OR UPDATE
ON matches
FOR EACH ROW
EXECUTE FUNCTION validate_match_integrity();

COMMIT;