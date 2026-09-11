-- Sprint 5.1: Fix approval_requests schema for Sprint 3 flows
--
-- Problem 1: approval_requests was created by BOTH 02_phase2_ai_tables.sql and
-- 06_phase6_autonomous_engine.sql. 02 wins (IF NOT EXISTS), so the table lacks
-- the decision_id / approval_status / response_deadline / approved_by /
-- approval_notes / requested_at columns that every Sprint 3 query depends on.
--
-- Problem 2: the 06 CHECK constraint on approval_status does not include
-- 'cancelled' or 'expired', but ApprovalManager.cancelAction() writes
-- 'cancelled' and the expiry sweeper semantics need 'expired'.

-- 1. Add the Sprint 3 columns the 02-created table is missing.
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS approval_status TEXT,
  ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Backfill approval_status from the legacy 'status' column.
UPDATE approval_requests
SET approval_status = status
WHERE approval_status IS NULL AND status IS NOT NULL;

-- 3. Default for new rows with no legacy status.
ALTER TABLE approval_requests
  ALTER COLUMN approval_status SET DEFAULT 'pending';

-- 4. Backfill requested_at for pre-existing rows.
UPDATE approval_requests
SET requested_at = created_at
WHERE requested_at IS NULL;

-- 5. Replace the restrictive CHECK (from 06, if that variant of the table
--    exists on a deployment) with the Sprint 3 status set. The DO block makes
--    this migration idempotent and safe whether or not the constraint exists.
DO $$
DECLARE
  c TEXT;
BEGIN
  -- Find any CHECK constraint on approval_requests.approval_status.
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'approval_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%approval_status%'
  LIMIT 1;

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE approval_requests DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_status_valid
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'modified', 'deferred', 'cancelled', 'expired'));

-- 6. Indexes Sprint 3 relies on.
CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON approval_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(approval_status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_decision ON approval_requests(decision_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_requested ON approval_requests(requested_at);

-- 7. Ensure RLS with org isolation (02 already enabled RLS and created a
--    policy; 06 may also have created one. Add ours only if none exists is
--    handled by IF NOT EXISTS semantics below for Postgres 15+; otherwise
--    the policy create is wrapped in a DO block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'approval_requests'::regclass
      AND polname = 'approval_requests_org_isolation'
  ) THEN
    CREATE POLICY approval_requests_org_isolation ON approval_requests
      FOR ALL USING (
        organization_id IN (
          SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;
