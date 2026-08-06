-- =====================================================
-- SCHEMA PERMISSIONS
-- =====================================================

-- Allow all application roles to use the public schema

GRANT USAGE
ON SCHEMA public
TO anon,
   authenticated,
   service_role;

-- =====================================================
-- DEFAULT SEQUENCE PERMISSIONS
-- =====================================================

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO authenticated,
   service_role;

-- =====================================================
-- DEFAULT FUNCTION DISCOVERY
-- =====================================================

GRANT EXECUTE
ON ALL FUNCTIONS IN SCHEMA public
TO authenticated,
   service_role;

   -- =====================================================
-- TABLE PERMISSIONS
-- =====================================================

-- -----------------------------------------------------
-- Anonymous users
-- -----------------------------------------------------

GRANT SELECT
ON ALL TABLES IN SCHEMA public
TO anon;

-- -----------------------------------------------------
-- Authenticated users
-- -----------------------------------------------------

GRANT SELECT
ON ALL TABLES IN SCHEMA public
TO authenticated;

-- -----------------------------------------------------
-- Service Role
-- -----------------------------------------------------

GRANT ALL PRIVILEGES
ON ALL TABLES IN SCHEMA public
TO service_role;

-- =====================================================
-- VIEW PERMISSIONS
-- =====================================================

GRANT SELECT ON v_match_summary
TO anon,
   authenticated;

GRANT SELECT ON v_match_roster
TO authenticated;

GRANT SELECT ON v_active_lineups
TO authenticated;

GRANT SELECT ON v_scoreboard
TO anon,
   authenticated;

GRANT SELECT ON v_matches_today
TO anon,
   authenticated;

GRANT SELECT ON v_current_period
TO authenticated;

GRANT SELECT ON v_active_match_players
TO authenticated;

GRANT SELECT ON v_active_lineup_players
TO authenticated;

GRANT SELECT ON v_match_player_count
TO authenticated;

GRANT SELECT ON v_active_lineup_count
TO authenticated;

GRANT SELECT ON v_active_lineups_only
TO authenticated;

GRANT SELECT ON v_match_status_summary
TO authenticated;

-- =====================================================
-- SERVICE ROLE
-- =====================================================

GRANT ALL PRIVILEGES
ON ALL TABLES IN SCHEMA public
TO service_role;

-- =====================================================
-- FUNCTION PERMISSIONS
-- =====================================================

-- Remove default execute permissions

REVOKE EXECUTE
ON ALL FUNCTIONS IN SCHEMA public
FROM PUBLIC;

REVOKE EXECUTE
ON ALL FUNCTIONS IN SCHEMA public
FROM anon;

REVOKE EXECUTE
ON ALL FUNCTIONS IN SCHEMA public
FROM authenticated;

-- =====================================================
-- SERVICE ROLE
-- =====================================================

GRANT EXECUTE
ON ALL FUNCTIONS IN SCHEMA public
TO service_role;
