-- ============================================================================
-- Migration 018: Fix first-member bootstrap for organization onboarding.
--
-- INTEGRATION DEFECT (proven live, S53-APP-INTEGRATION smoke, 2026-09-11):
--
-- 1. organization_members INSERT requires is_org_owner(organization_id)
--    (migration 002 policy). For a BRAND-NEW organization there are zero
--    members, so is_org_owner is false for everyone — the FIRST owner can
--    never be created. Onboarding was structurally impossible on a fresh
--    org; no earlier migration created a bootstrap path (no trigger, no RPC).
--
-- 2. The onboarding UI inserts the org with .select() read-back. PostgREST
--    emits INSERT ... RETURNING, and RETURNING rows must also pass the table
--    SELECT policy ("Users can view their organizations" — EXISTS over
--    organization_members). A user creating their FIRST org has no membership
--    yet, so the read-back is filtered and PostgREST reports 42501 even
--    though the INSERT policy (auth.role() = 'authenticated') passed.
--
-- FIX: a single SECURITY DEFINER RPC that atomically creates the organization
-- AND its first owner membership (definer bypasses RLS for exactly these two
-- inserts), returning the new org id. No read-back is needed, so the
-- RETURNING trap cannot occur. All other RLS behavior is unchanged.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_org_id uuid;
  v_slug text;
BEGIN
  -- Fail closed: must be a real authenticated user.
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: organization creation requires an authenticated user';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME: organization name is required';
  END IF;

  v_slug := NULLIF(btrim(coalesce(p_slug, '')), '');
  IF v_slug IS NULL THEN
    v_slug := lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := btrim(v_slug, '-');
  END IF;
  IF v_slug IS NULL OR length(v_slug) = 0 THEN
    RAISE EXCEPTION 'INVALID_SLUG: could not derive a slug from the organization name';
  END IF;

  INSERT INTO public.organizations (name, slug)
  VALUES (btrim(p_name), v_slug)
  RETURNING id INTO v_org_id;

  -- First owner membership. SECURITY DEFINER bypasses RLS here by design:
  -- this is THE bootstrap path that is_org_owner cannot satisfy.
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user, 'owner')
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN v_org_id;
END;
$$;

-- Only authenticated users may create organizations through this path.
REVOKE ALL ON FUNCTION public.create_organization(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;

COMMENT ON FUNCTION public.create_organization(text, text) IS
  'Onboarding bootstrap: atomically creates an organization plus its first owner (the calling user). SECURITY DEFINER because the first owner membership cannot satisfy the is_org_owner RLS policy.';

COMMIT;
