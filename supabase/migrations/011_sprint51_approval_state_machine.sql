-- Sprint 5.1: Approval state machine hardening.
--
-- Fixes the confirmed runtime bug: lib/sprint3/approval-manager.ts writes
-- approval_status='cancelled' and treats 'expired' as a terminal state, but
-- migration 06 constrained approval_requests.approval_status to
-- ('pending','approved','rejected','modified','deferred') — so every cancel
-- (and any future expiry write) fails with a DB check violation (HTTP 500).
--
-- Also drops the duplicated approval_requests policies (02 and 06 both create
-- one) and replaces them with a single fail-closed org-isolation policy.
--
-- Expiry is deterministic at the DATABASE level: expire_stale_approvals()
-- flips pending approvals past their response_deadline to 'expired' and logs
-- each one to audit_logs. The Sprint 3 engine additionally refuses to execute
-- against an expired deadline, so execution stays impossible even before any
-- worker runs. A scheduled worker (Sprint 5.3) will simply call the RPC.

-- ============================================================================
-- 1. Widen the approval_status constraint
-- ============================================================================
ALTER TABLE approval_requests
  DROP CONSTRAINT IF EXISTS approval_requests_approval_status_check;

-- The original constraint in 06 may have a generated name; drop by search too.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'approval_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%approval_status%'
  LOOP
    EXECUTE format('ALTER TABLE approval_requests DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'modified', 'deferred', 'cancelled', 'expired'));

-- ============================================================================
-- 2. Single fail-closed org-isolation policy for approval_requests
--    (removes duplicate policies created by 02 and 06; FOR ALL covers
--    SELECT/INSERT/UPDATE/DELETE, per repo convention)
-- ============================================================================
DROP POLICY IF EXISTS "approvals_org_isolation" ON approval_requests;
DROP POLICY IF EXISTS approval_requests_org_isolation ON approval_requests;

CREATE POLICY approval_requests_org_isolation ON approval_requests
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. Deterministic expiration (database-level, idempotent)
--    Returns the number of approvals expired. Safe to call repeatedly and
--    concurrently: rows are selected FOR UPDATE SKIP LOCKED, so two workers
--    never expire the same approval twice.
-- ============================================================================
CREATE OR REPLACE FUNCTION expire_stale_approvals()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, organization_id
    FROM approval_requests
    WHERE approval_status = 'pending'
      AND response_deadline IS NOT NULL
      AND response_deadline < NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE approval_requests
      SET approval_status = 'expired',
          approved_at = NOW()
      WHERE id = r.id;

    INSERT INTO audit_logs (organization_id, user_id, action, resource, details, timestamp)
    VALUES (
      r.organization_id,
      NULL,
      'approval_expired',
      'approval:' || r.id::text,
      'Response deadline passed; approval expired by system',
      NOW()
    );

    affected := affected + 1;
  END LOOP;

  RETURN affected;
END $$;
