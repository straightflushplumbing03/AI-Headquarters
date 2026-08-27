-- Sprint 3.1: Hardening Pass — Idempotent migration
-- Safe to run multiple times. Does not create duplicate tables.
-- Only updates existing constraints/indexes.

-- 1. Safely extend approval_requests.approval_status to include 'cancelled' and 'expired'.
--    Existing Phase 6 constraint: ('pending', 'approved', 'rejected', 'modified', 'deferred')
--    Sprint 3 needs:              ('pending', 'approved', 'rejected', 'cancelled', 'expired')
--    We replace the constraint idempotently.

DO $$
BEGIN
  -- Drop old constraint if it exists (idempotent — won't error if already removed)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approval_requests_approval_status_check'
      AND conrelid = 'approval_requests'::regclass
  ) THEN
    ALTER TABLE approval_requests DROP CONSTRAINT approval_requests_approval_status_check;
  END IF;

  -- Add updated constraint supporting Sprint 3 states
  -- Keeps 'modified' and 'deferred' for backward compatibility
  ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_approval_status_check
    CHECK (approval_status IN (
      'pending', 'approved', 'rejected',
      'modified', 'deferred',       -- Phase 6 legacy states
      'cancelled', 'expired'        -- Sprint 3 additions
    ));
END $$;

-- 2. Ensure audit_logs table exists (from sprint3_safe_execution.sql — idempotent)
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid,
  action      TEXT NOT NULL,
  resource    TEXT,
  details     TEXT,
  metadata    JSONB,
  timestamp   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS (idempotent)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs'
      AND policyname = 'audit_logs_org_isolation'
  ) THEN
    CREATE POLICY audit_logs_org_isolation ON audit_logs
      FOR ALL USING (
        organization_id IN (
          SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- 3. Indexes for audit_logs (idempotent)
CREATE INDEX IF NOT EXISTS idx_audit_logs_org        ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action     ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs(timestamp DESC);

-- 4. Composite index on autonomous_actions for idempotency + status queries
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_idempotency
  ON autonomous_actions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_exec_status
  ON autonomous_actions(organization_id, execution_status);

-- 5. Index on approval_requests for faster decision lookups
CREATE INDEX IF NOT EXISTS idx_approval_requests_decision_org
  ON approval_requests(decision_id, organization_id);

-- 6. Grant permissions (idempotent)
GRANT ALL ON audit_logs TO authenticated;
