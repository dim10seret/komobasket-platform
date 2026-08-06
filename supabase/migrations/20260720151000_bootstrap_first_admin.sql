-- Allows the first authenticated KomoControl user to initialize administration once.

CREATE OR REPLACE FUNCTION claim_first_admin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(2026072015);

    IF EXISTS (SELECT 1 FROM user_global_roles) THEN
        RAISE EXCEPTION 'The first administrator has already been assigned.' USING ERRCODE = '23505';
    END IF;

    INSERT INTO user_global_roles (user_id, role)
    VALUES (auth.uid(), 'admin');
END;
$$;

GRANT EXECUTE ON FUNCTION claim_first_admin() TO authenticated;

COMMENT ON FUNCTION claim_first_admin() IS
'One-time bootstrap for the first authenticated KomoControl administrator.';
