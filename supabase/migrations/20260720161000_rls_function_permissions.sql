-- RLS policies invoke these functions on behalf of authenticated KomoControl users.
GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION has_match_role(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION can_view_match(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_score_match(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_correct_match(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_approve_match(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION match_is_editable(UUID) TO authenticated;
