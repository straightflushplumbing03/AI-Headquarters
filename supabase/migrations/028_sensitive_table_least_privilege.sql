-- 028_sensitive_table_least_privilege.sql
-- Tighten grants and row access for sensitive legacy tables.
-- This migration intentionally preserves service_role grants and owner access.
-- It does not change the public plumbing website or any deployment settings.

BEGIN;

-- Remove all inherited/direct API-role access first. Re-grant only the
-- operations required by the application. PUBLIC is included so an inherited
-- grant cannot silently restore access.
REVOKE ALL PRIVILEGES ON TABLE
  public.ai_execution_logs,
  public.ai_provider_config,
  public.audit_logs,
  public.external_connectors,
  public.organization_members
FROM PUBLIC, anon, authenticated;

-- Credential-bearing configuration is restricted to organization owners/admins.
-- The helper was introduced in migration 017 and is SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated;

DROP POLICY IF EXISTS ai_provider_org_isolation
  ON public.ai_provider_config;
DROP POLICY IF EXISTS ai_provider_admin_only
  ON public.ai_provider_config;
CREATE POLICY ai_provider_admin_only
  ON public.ai_provider_config
  FOR ALL
  TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

DROP POLICY IF EXISTS external_connectors_org_isolation
  ON public.external_connectors;
DROP POLICY IF EXISTS external_connectors_admin_only
  ON public.external_connectors;
CREATE POLICY external_connectors_admin_only
  ON public.external_connectors
  FOR ALL
  TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- Execution and audit history is readable within the member's organization
-- and insertable by authenticated application flows, but not mutable/deletable.
GRANT SELECT, INSERT ON TABLE public.ai_execution_logs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO authenticated;

-- Existing application session/onboarding and owner membership-management
-- flows still need these operations; existing RLS policies remain authoritative.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_members
  TO authenticated;

-- Provider and connector configuration remains manageable by authenticated
-- admins/owners only, enforced by the policies above.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.ai_provider_config, public.external_connectors
  TO authenticated;

-- Explicitly retain only the operations the app needs on these tables.
-- In particular, authenticated cannot TRUNCATE, create triggers, maintain,
-- or add foreign-key references. RLS does not protect TRUNCATE.
-- service_role grants are deliberately untouched.

DO $verify$
BEGIN
  IF has_table_privilege('anon', 'public.ai_provider_config', 'SELECT')
     OR has_table_privilege('anon', 'public.external_connectors', 'SELECT')
     OR has_table_privilege('anon', 'public.audit_logs', 'INSERT')
     OR has_table_privilege('anon', 'public.organization_members', 'SELECT') THEN
    RAISE EXCEPTION '028 security check failed: anon retains access to a private table';
  END IF;

  IF has_table_privilege('authenticated', 'public.ai_execution_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.ai_execution_logs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.audit_logs', 'DELETE')
     OR has_table_privilege('authenticated', 'public.audit_logs', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.ai_provider_config', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.external_connectors', 'TRUNCATE') THEN
    RAISE EXCEPTION '028 security check failed: authenticated retains a prohibited privilege';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.ai_execution_logs', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.ai_execution_logs', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.organization_members', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.ai_provider_config', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.external_connectors', 'SELECT') THEN
    RAISE EXCEPTION '028 security check failed: a required application/service privilege is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_provider_config'
      AND policyname = 'ai_provider_admin_only'
      AND cmd = 'ALL'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'external_connectors'
      AND policyname = 'external_connectors_admin_only'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION '028 security check failed: admin-only credential policies are missing';
  END IF;
END;
$verify$;

COMMIT;
