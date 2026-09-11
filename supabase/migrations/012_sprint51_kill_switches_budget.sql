-- Sprint 5.1: Persistent kill switches + atomic budget reservations.
--
-- Replaces the in-memory kill-switch sets in lib/ai/cost-controller.ts with
-- database-backed state, and replaces check-then-spend budget accounting with
-- atomic reservation/consumption/settlement via SQL functions.
--
-- Kill switch design:
--   system_flags: platform-global flag rows (e.g. 'global_kill_switch').
--   Organization stop stays on ai_usage_limits.paused (already persisted and
--   already enforced by the Sprint 3 engine). Agent stop stays on
--   agents.active (persisted). The in-memory sets are removed entirely so a
--   stop set in one process is honored by every process.
--
-- Budget design:
--   reserve_budget(org, agent, amount)   -> atomically reserves funds or fails
--   settle_budget(org, reservation, actual) -> charges actual, releases the rest
--   release_budget(org, reservation)     -> failure path, releases the hold
--   Concurrency: single-row UPDATE ... WHERE remaining >= amount inside a
--   function; the UPDATE takes the row lock, so two concurrent reservations
--   serialize and one fails when funds are insufficient. No read-modify-write.

-- ============================================================================
-- 1. Persistent global kill switch
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- No client-facing policies: the table is managed by service-role only.
ALTER TABLE system_flags ENABLE ROW LEVEL SECURITY;

INSERT INTO system_flags (key, value)
VALUES ('global_kill_switch', '{"enabled": false, "reason": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION is_global_kill_switch_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT (value->>'enabled')::boolean FROM system_flags WHERE key = 'global_kill_switch'),
    false
  )
$$;

-- ============================================================================
-- 2. Budget reservations ledger
--    organization_id FK exists even though founder budgets are user-scoped:
--    AI spend is always attributed to an org in this system.
-- ============================================================================
CREATE TABLE IF NOT EXISTS budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  reserved_amount NUMERIC(12,2) NOT NULL CHECK (reserved_amount >= 0),
  settled_amount NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'released')),
  reference TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settled_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_org_status
  ON budget_reservations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_reservations_org_created
  ON budget_reservations(organization_id, created_at);

ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_reservations_org_isolation ON budget_reservations
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. Atomic reservation / settlement / release
-- ============================================================================

-- Atomically reserve estimated_cost against the org's monthly budget.
-- Raises exception 'BUDGET_EXCEEDED' / 'KILL_SWITCH_ACTIVE' / 'NO_BUDGET_ROW'
-- on failure; returns the reservation id on success.
CREATE OR REPLACE FUNCTION reserve_budget(
  p_organization_id uuid,
  p_agent_id uuid,
  p_task_id uuid,
  p_amount NUMERIC,
  p_reference TEXT DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation uuid;
  v_paused BOOLEAN;
  v_remaining NUMERIC;
  v_budget_row ai_usage_limits%ROWTYPE;
BEGIN
  -- Fail-closed: global stop blocks every reservation.
  IF is_global_kill_switch_enabled() THEN
    RAISE EXCEPTION 'KILL_SWITCH_ACTIVE: global emergency stop enabled';
  END IF;

  SELECT * INTO v_budget_row
  FROM ai_usage_limits
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_BUDGET_ROW: no ai_usage_limits row for organization';
  END IF;

  IF v_budget_row.paused THEN
    RAISE EXCEPTION 'KILL_SWITCH_ACTIVE: %', COALESCE(v_budget_row.pause_reason, 'organization paused');
  END IF;

  -- Remaining budget this month = monthly budget - committed spend - open holds
  SELECT
    v_budget_row.monthly_budget
    - COALESCE(v_budget_row.current_spend, 0)
    - COALESCE((
        SELECT SUM(reserved_amount) FROM budget_reservations
        WHERE organization_id = p_organization_id
          AND status = 'reserved'
      ), 0)
  INTO v_remaining;

  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'BUDGET_EXCEEDED: remaining $%, requested $%', v_remaining, p_amount;
  END IF;

  INSERT INTO budget_reservations
    (organization_id, agent_id, task_id, reserved_amount, status, reference)
  VALUES
    (p_organization_id, p_agent_id, p_task_id, p_amount, 'reserved', p_reference)
  RETURNING id INTO v_reservation;

  RETURN v_reservation;
END $$;

-- Settle a reservation after execution: charge the ACTUAL amount, release the
-- unused hold. Consumes the reservation (idempotent: only 'reserved' rows
-- settle; a second call is a no-op returning false).
CREATE OR REPLACE FUNCTION settle_budget(
  p_reservation_id uuid,
  p_organization_id uuid,
  p_actual_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE budget_reservations
    SET settled_amount = p_actual_amount,
        status = 'settled',
        settled_at = NOW()
    WHERE id = p_reservation_id
      AND organization_id = p_organization_id
      AND status = 'reserved';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;

  UPDATE ai_usage_limits
    SET current_spend = COALESCE(current_spend, 0) + p_actual_amount
    WHERE organization_id = p_organization_id;

  RETURN true;
END $$;

-- Release a reservation on failure (idempotent).
CREATE OR REPLACE FUNCTION release_budget(
  p_reservation_id uuid,
  p_organization_id uuid
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE budget_reservations
    SET status = 'released',
        settled_at = NOW()
    WHERE id = p_reservation_id
      AND organization_id = p_organization_id
      AND status = 'reserved';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;
