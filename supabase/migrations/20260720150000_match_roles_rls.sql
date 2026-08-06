-- KomoControl role-based access for live scoring and match approval.

CREATE TABLE user_global_roles (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

CREATE TABLE match_user_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'scorer', 'corrector', 'approver')),
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, user_id, role)
);

CREATE INDEX idx_match_user_assignments_user_match
ON match_user_assignments (user_id, match_id);

ALTER TABLE match_events
ADD COLUMN IF NOT EXISTS correction_reason TEXT;

ALTER TABLE matches
ADD COLUMN IF NOT EXISTS approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE match_event_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_id UUID,
    action TEXT NOT NULL CHECK (action IN ('UPDATE', 'DELETE')),
    previous_event JSONB NOT NULL,
    next_event JSONB,
    correction_reason TEXT,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_event_audit_match_created
ON match_event_audit (match_id, created_at DESC);

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_global_roles
        WHERE user_id = auth.uid()
          AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION has_match_role(
    p_match_id UUID,
    p_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT public.is_platform_admin()
        OR EXISTS (
            SELECT 1
            FROM public.match_user_assignments
            WHERE match_id = p_match_id
              AND user_id = auth.uid()
              AND role = ANY (p_roles)
        );
$$;

CREATE OR REPLACE FUNCTION can_view_match(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT public.has_match_role(
        p_match_id,
        ARRAY['viewer', 'scorer', 'corrector', 'approver']::TEXT[]
    );
$$;

CREATE OR REPLACE FUNCTION can_score_match(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT public.has_match_role(p_match_id, ARRAY['scorer']::TEXT[]);
$$;

CREATE OR REPLACE FUNCTION can_correct_match(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT public.has_match_role(p_match_id, ARRAY['corrector']::TEXT[]);
$$;

CREATE OR REPLACE FUNCTION can_approve_match(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT public.has_match_role(p_match_id, ARRAY['approver']::TEXT[]);
$$;

CREATE OR REPLACE FUNCTION match_is_editable(p_match_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.matches
        WHERE id = p_match_id
          AND locked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION audit_match_event_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    INSERT INTO public.match_event_audit (
        match_id,
        event_id,
        action,
        previous_event,
        next_event,
        correction_reason,
        actor_id
    ) VALUES (
        OLD.match_id,
        OLD.id,
        TG_OP,
        to_jsonb(OLD),
        CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END,
        CASE WHEN TG_OP = 'UPDATE' THEN NEW.correction_reason ELSE OLD.correction_reason END,
        auth.uid()
    );

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_events_audit ON match_events;
CREATE TRIGGER trg_match_events_audit
AFTER UPDATE OR DELETE ON match_events
FOR EACH ROW EXECUTE FUNCTION audit_match_event_change();

CREATE OR REPLACE FUNCTION approve_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NOT can_approve_match(p_match_id) THEN
        RAISE EXCEPTION 'You are not allowed to approve this match.' USING ERRCODE = '42501';
    END IF;

    UPDATE matches
    SET approved_at = now(),
        approved_by_user_id = auth.uid(),
        locked_at = now()
    WHERE id = p_match_id
      AND status = 'finished'
      AND locked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Only an unlocked finished match may be approved.' USING ERRCODE = '23514';
    END IF;
END;
$$;

ALTER TABLE user_global_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_user_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_event_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_engine_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS matches_public_read ON matches;
DROP POLICY IF EXISTS game_periods_public_read ON game_periods;
DROP POLICY IF EXISTS match_players_public_read ON match_players;
DROP POLICY IF EXISTS lineups_public_read ON lineups;
DROP POLICY IF EXISTS lineup_players_public_read ON lineup_players;
DROP POLICY IF EXISTS substitutions_public_read ON substitutions;

DROP POLICY IF EXISTS matches_edit ON matches;
DROP POLICY IF EXISTS game_periods_edit ON game_periods;
DROP POLICY IF EXISTS match_players_edit ON match_players;
DROP POLICY IF EXISTS lineups_edit ON lineups;
DROP POLICY IF EXISTS lineup_players_edit ON lineup_players;
DROP POLICY IF EXISTS substitutions_edit ON substitutions;

CREATE POLICY global_roles_admin_manage ON user_global_roles
FOR ALL TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY assignments_admin_manage ON match_user_assignments
FOR ALL TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY assignments_user_read ON match_user_assignments
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR is_platform_admin());

CREATE POLICY matches_role_read ON matches
FOR SELECT TO authenticated
USING (can_view_match(id));

CREATE POLICY periods_role_read ON game_periods
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY periods_scorer_insert ON game_periods
FOR INSERT TO authenticated
WITH CHECK (can_score_match(match_id) AND match_is_editable(match_id));

CREATE POLICY match_players_role_read ON match_players
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY lineups_role_read ON lineups
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY lineup_players_role_read ON lineup_players
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY substitutions_role_read ON substitutions
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY events_role_read ON match_events
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY snapshots_role_read ON match_engine_snapshots
FOR SELECT TO authenticated
USING (can_view_match(match_id));

CREATE POLICY events_scorer_insert ON match_events
FOR INSERT TO authenticated
WITH CHECK (
    can_score_match(match_id)
    AND match_is_editable(match_id)
);

CREATE POLICY events_corrector_update ON match_events
FOR UPDATE TO authenticated
USING (can_correct_match(match_id) AND match_is_editable(match_id))
WITH CHECK (
    can_correct_match(match_id)
    AND match_is_editable(match_id)
    AND correction_reason IS NOT NULL
    AND length(trim(correction_reason)) > 0
);

CREATE POLICY events_admin_manage ON match_events
FOR ALL TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY snapshots_scorer_manage ON match_engine_snapshots
FOR INSERT TO authenticated
WITH CHECK (can_score_match(match_id) AND match_is_editable(match_id));

CREATE POLICY snapshots_corrector_update ON match_engine_snapshots
FOR UPDATE TO authenticated
USING (can_correct_match(match_id) AND match_is_editable(match_id))
WITH CHECK (can_correct_match(match_id) AND match_is_editable(match_id));

CREATE POLICY snapshots_admin_manage ON match_engine_snapshots
FOR ALL TO authenticated
USING (is_platform_admin())
WITH CHECK (is_platform_admin());

CREATE POLICY audit_role_read ON match_event_audit
FOR SELECT TO authenticated
USING (can_correct_match(match_id) OR can_approve_match(match_id));

GRANT SELECT, INSERT, UPDATE ON user_global_roles, match_user_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON match_events, match_engine_snapshots TO authenticated;
GRANT SELECT ON match_event_audit TO authenticated;
GRANT EXECUTE ON FUNCTION approve_match(UUID) TO authenticated;

COMMENT ON TABLE match_user_assignments IS
'Per-match roles: viewer, scorer, corrector and approver.';
