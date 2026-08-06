-- =====================================================
-- ENABLE ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE competitions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues                ENABLE ROW LEVEL SECURITY;

ALTER TABLE teams                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE players               ENABLE ROW LEVEL SECURITY;

ALTER TABLE team_registrations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_registrations  ENABLE ROW LEVEL SECURITY;

ALTER TABLE matches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players         ENABLE ROW LEVEL SECURITY;

ALTER TABLE lineups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineup_players        ENABLE ROW LEVEL SECURITY;

ALTER TABLE substitutions         ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- PUBLIC READ POLICIES
-- =====================================================

-- -----------------------------------------------------
-- competitions
-- -----------------------------------------------------

CREATE POLICY competitions_public_read
ON competitions
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- seasons
-- -----------------------------------------------------

CREATE POLICY seasons_public_read
ON seasons
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- venues
-- -----------------------------------------------------

CREATE POLICY venues_public_read
ON venues
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- teams
-- -----------------------------------------------------

CREATE POLICY teams_public_read
ON teams
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- players
-- -----------------------------------------------------

CREATE POLICY players_public_read
ON players
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- team_registrations
-- -----------------------------------------------------

CREATE POLICY team_registrations_public_read
ON team_registrations
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- player_registrations
-- -----------------------------------------------------

CREATE POLICY player_registrations_public_read
ON player_registrations
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- matches
-- -----------------------------------------------------

CREATE POLICY matches_public_read
ON matches
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- game_periods
-- -----------------------------------------------------

CREATE POLICY game_periods_public_read
ON game_periods
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- match_players
-- -----------------------------------------------------

CREATE POLICY match_players_public_read
ON match_players
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- lineups
-- -----------------------------------------------------

CREATE POLICY lineups_public_read
ON lineups
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- lineup_players
-- -----------------------------------------------------

CREATE POLICY lineup_players_public_read
ON lineup_players
FOR SELECT
USING (TRUE);

-- -----------------------------------------------------
-- substitutions
-- -----------------------------------------------------

CREATE POLICY substitutions_public_read
ON substitutions
FOR SELECT
USING (TRUE);

-- =====================================================
-- RLS HELPER FUNCTIONS
-- =====================================================

-- -----------------------------------------------------
-- Is Administrator
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

    /*
      Placeholder implementation.

      Will be replaced when the user_roles
      module is implemented.
    */

    RETURN FALSE;

END;
$$;

COMMENT ON FUNCTION is_admin()
IS 'Returns TRUE when the authenticated user is a system administrator.';

-- -----------------------------------------------------
-- Is Match Operator
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_operator()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

    /*
      Placeholder implementation.
    */

    RETURN FALSE;

END;
$$;

COMMENT ON FUNCTION is_operator()
IS 'Returns TRUE when the authenticated user is a match operator.';

-- -----------------------------------------------------
-- Is Team Manager
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION is_team_manager(
    p_team_registration_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

    /*
      Placeholder implementation.
    */

    RETURN FALSE;

END;
$$;

COMMENT ON FUNCTION is_team_manager(UUID)
IS 'Returns TRUE when the authenticated user manages the specified team.';

-- -----------------------------------------------------
-- Can Edit Match
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION can_edit_match(
    p_match_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

    RETURN

        is_admin()

        OR

        is_operator();

END;
$$;

COMMENT ON FUNCTION can_edit_match(UUID)
IS 'Returns TRUE when the authenticated user may edit the specified match.';

-- -----------------------------------------------------
-- Can View Match
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION can_view_match(
    p_match_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

    /*
      Currently every match is public.
      This function exists for future expansion.
    */

    RETURN TRUE;

END;
$$;

COMMENT ON FUNCTION can_view_match(UUID)
IS 'Returns TRUE when the authenticated user may view the specified match.';

-- =====================================================
-- MATCH EDIT POLICIES
-- =====================================================

-- -----------------------------------------------------
-- matches
-- -----------------------------------------------------

CREATE POLICY matches_edit

ON matches

FOR UPDATE

TO authenticated

USING (
    can_edit_match(id)
)

WITH CHECK (
    can_edit_match(id)
);

COMMENT ON POLICY matches_edit
ON matches
IS 'Allows authorized users to update match information.';

-- -----------------------------------------------------
-- game_periods
-- -----------------------------------------------------

CREATE POLICY game_periods_edit

ON game_periods

FOR ALL

TO authenticated

USING (
    can_edit_match(match_id)
)

WITH CHECK (
    can_edit_match(match_id)
);

COMMENT ON POLICY game_periods_edit
ON game_periods
IS 'Allows authorized users to manage game periods.';

-- -----------------------------------------------------
-- match_players
-- -----------------------------------------------------

CREATE POLICY match_players_edit

ON match_players

FOR ALL

TO authenticated

USING (
    can_edit_match(match_id)
)

WITH CHECK (
    can_edit_match(match_id)
);

COMMENT ON POLICY match_players_edit
ON match_players
IS 'Allows authorized users to manage match players.';

-- -----------------------------------------------------
-- lineups
-- -----------------------------------------------------

CREATE POLICY lineups_edit

ON lineups

FOR ALL

TO authenticated

USING (
    can_edit_match(match_id)
)

WITH CHECK (
    can_edit_match(match_id)
);

COMMENT ON POLICY lineups_edit
ON lineups
IS 'Allows authorized users to manage lineups.';

-- -----------------------------------------------------
-- lineup_players
-- -----------------------------------------------------

CREATE POLICY lineup_players_edit

ON lineup_players

FOR ALL

TO authenticated

USING (
    can_edit_match(match_id)
)

WITH CHECK (
    can_edit_match(match_id)
);

COMMENT ON POLICY lineup_players_edit
ON lineup_players
IS 'Allows authorized users to manage lineup players.';

-- -----------------------------------------------------
-- substitutions
-- -----------------------------------------------------

CREATE POLICY substitutions_edit

ON substitutions

FOR ALL

TO authenticated

USING (
    can_edit_match(match_id)
)

WITH CHECK (
    can_edit_match(match_id)
);

COMMENT ON POLICY substitutions_edit
ON substitutions
IS 'Allows authorized users to manage substitutions.';

-- =====================================================
-- DEFAULT PRIVILEGES
-- =====================================================

-- No INSERT policies are defined for anonymous users.
-- No UPDATE policies are defined for anonymous users.
-- No DELETE policies are defined for anonymous users.

-- Access is denied unless explicitly granted by a policy.

-- =====================================================
-- POLICY DOCUMENTATION
-- =====================================================

COMMENT ON TABLE competitions IS
'Public read. Administrative updates only.';

COMMENT ON TABLE seasons IS
'Public read. Administrative updates only.';

COMMENT ON TABLE venues IS
'Public read. Administrative updates only.';

COMMENT ON TABLE teams IS
'Public read. Administrative updates only.';

COMMENT ON TABLE players IS
'Public read. Administrative updates only.';

COMMENT ON TABLE matches IS
'Public read. Updates allowed only through match edit policies.';

COMMENT ON TABLE game_periods IS
'Public read. Updates allowed only through match edit policies.';

COMMENT ON TABLE match_players IS
'Public read. Updates allowed only through match edit policies.';

COMMENT ON TABLE lineups IS
'Public read. Updates allowed only through match edit policies.';

COMMENT ON TABLE lineup_players IS
'Public read. Updates allowed only through match edit policies.';

COMMENT ON TABLE substitutions IS
'Public read. Updates allowed only through match edit policies.';
