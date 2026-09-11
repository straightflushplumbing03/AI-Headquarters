-- Sprint 5.3 P3 (live verification follow-up):
-- Fix 42P17 "infinite recursion detected in policy" on organization_members.
--
-- PROVEN LIVE (2026-09): every authenticated read of organization_members —
-- and of ANY table whose RLS policy queries organization_members, i.e. every
-- org-scoped table (organizations, departments, agents, tasks, company_*,
-- autonomous_*, approval_requests, background_jobs, budget_reservations, …) —
-- fails with:
--
--   ERROR 42P17 infinite recursion detected in policy for relation
--   "organization_members"
--
-- Root cause (migration 002): the policies ON organization_members queried
-- organization_members itself:
--
--   create policy "Users can view their organization members"
--     on public.organization_members for select
--     using (exists (select 1 from public.organization_members om2 where …));
--
--   create policy "Org owners can manage members"
--     on public.organization_members for all
--     using (exists (select 1 from public.organization_members om2 where …));
--
-- Postgres evaluates a table's own policy while scanning that table inside the
-- policy subquery → infinite recursion.
--
-- Fix (standard Supabase pattern): SECURITY DEFINER membership helpers. The
-- function owner (postgres) is the table owner, so RLS is not applied to the
-- helper's internal read — breaking the cycle — while every caller still only
-- ever learns a boolean about THEIR OWN membership (the helper filters on
-- auth.uid()), so the security boundary is preserved. Cross-org tables keep
-- their existing policies; their subqueries hit organization_members' RLS,
-- which now evaluates via the definer helper instead of recursing.

-- ============================================================================
-- 1. Membership helpers (definer rights break the recursion)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_org_member(p_organization_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_organization_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(p_organization_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- Functions default to EXECUTE for PUBLIC; keep that surface explicit.
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO anon, authenticated;

-- ============================================================================
-- 2. Replace the two recursive policies with helper-based ones
--    (semantics preserved; recursion eliminated)
-- ============================================================================

DROP POLICY IF EXISTS "Users can view their organization members"
  ON public.organization_members;
CREATE POLICY "Users can view their organization members"
  ON public.organization_members FOR SELECT
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Org owners can manage members"
  ON public.organization_members;
CREATE POLICY "Org owners can manage members"
  ON public.organization_members FOR ALL
  USING (public.is_org_owner(organization_id))
  WITH CHECK (public.is_org_owner(organization_id));
