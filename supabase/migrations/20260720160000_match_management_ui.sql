-- Administrative creation of matches and match rosters from KomoControl.
CREATE POLICY matches_admin_insert ON matches
FOR INSERT TO authenticated
WITH CHECK (is_platform_admin());

CREATE POLICY match_players_admin_manage ON match_players
FOR ALL TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());
