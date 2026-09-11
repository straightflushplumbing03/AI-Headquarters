-- Sprint 5.3 P2: Atomic budget reservation integration — hardening additive to
-- migration 012 (never rewritten).
--
-- Gaps in 012 that this migration closes:
--   1. reserve_budget() had no idempotency tied to action identity: a retry,
--      duplicate enqueue, or duplicate cron tick could reserve the same funds
--      twice for one action. Add: action_idempotency_key column + partial
--      unique index + idempotent reservation RPC (returns the existing hold).
--   2. settle_budget() charged the RAW p_actual_amount. A caller passing an
--      actual cost above the reserved hold (or a negative amount) could
--      INCREASE available budget or corrupt the ledger. Add: settled RPC that
--      clamps to [0, reserved_amount] server-side.
--   3. Orphaned holds: if a process died between reserve and settle/release,
--      the hold reduced available budget forever. Add: reaper RPC that
--      releases holds older than a configurable age (the engine's normal
--      failure path releases promptly; this is the safety net).
--
-- Policy: additive only (ADD COLUMN / CREATE POLICY IF NOT EXISTS / CREATE OR
-- REPLACE FUNCTION). Fresh databases running 012 -> 016 in order and existing
-- databases both converge to the same schema.

-- ============================================================================
-- 1. Action-tied idempotency for reservations
-- ============================================================================
ALTER TABLE budget_reservations
  ADD COLUMN IF NOT EXISTS action_idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_budget_reservations_action_key
  ON budget_reservations(action_idempotency_key)
  WHERE action_idempotency_key IS NOT NULL;

-- One OPEN reservation per action identity, per organization. Partial index:
-- historical settled/released rows do not block a legitimate later action
-- (e.g. retry of a released action).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'budget_reservations_open_per_action_unique'
  ) THEN
    CREATE UNIQUE INDEX budget_reservations_open_per_action_unique
      ON budget_reservations (organization_id, action_idempotency_key)
      WHERE action_idempotency_key IS NOT NULL
        AND status = 'reserved';
  END IF;
END $$;

-- ============================================================================
-- 2. Idempotent reservation RPC
--
-- Mirrors reserve_budget() fail-closed checks (global kill switch, org pause,
-- FOR UPDATE row lock, remaining = budget - spend - open holds) but:
--   * returns the EXISTING open reservation when one already exists for
--     (organization_id, p_action_idempotency_key) — a retry or duplicate
--     enqueue reuses the same hold instead of double-reserving;
--   * refuses a DIFFERENT action from reusing an in-flight hold.
-- ============================================================================
CREATE OR REPLACE FUNCTION reserve_budget_idempotent(
  p_organization_id uuid,
  p_agent_id uuid,
  p_task_id uuid,
  p_amount NUMERIC,
  p_action_idempotency_key TEXT,
  p_reference TEXT DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing budget_reservations%ROWTYPE;
  v_reservation uuid;
  v_budget_row ai_usage_limits%ROWTYPE;
  v_remaining NUMERIC;
BEGIN
  IF p_action_idempotency_key IS NULL OR p_action_idempotency_key = '' THEN
    RAISE EXCEPTION 'INVALID_RESERVATION_KEY: action idempotency key required';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_RESERVATION_AMOUNT: amount must be >= 0';
  END IF;

  -- Idempotent path first (no locks taken beyond the index lookup): if this
  -- action already holds funds, verify org and return that reservation.
  SELECT * INTO v_existing
  FROM budget_reservations
  WHERE organization_id = p_organization_id
    AND action_idempotency_key = p_action_idempotency_key
    AND status = 'reserved'
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing.id;
  END IF;

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
    (organization_id, agent_id, task_id, reserved_amount, status,
     reference, action_idempotency_key)
  VALUES
    (p_organization_id, p_agent_id, p_task_id, p_amount, 'reserved',
     p_reference, p_action_idempotency_key)
  RETURNING id INTO v_reservation;

  RETURN v_reservation;
END $$;

-- ============================================================================
-- 3. Clamped settlement
--
-- The database (not the caller) bounds the charged amount:
--   * negative actuals are rejected outright (fail-closed);
--   * actuals above the reserved hold are clamped to the hold — a caller can
--     never INCREASE available budget by settling more than it reserved;
--   * idempotent: only 'reserved' rows settle; a second call is a no-op
--     returning false.
-- ============================================================================
CREATE OR REPLACE FUNCTION settle_budget_clamped(
  p_reservation_id uuid,
  p_organization_id uuid,
  p_actual_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation budget_reservations%ROWTYPE;
  v_charge NUMERIC;
BEGIN
  IF p_actual_amount IS NULL OR p_actual_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_SETTLEMENT_AMOUNT: actual amount must be >= 0';
  END IF;

  SELECT * INTO v_reservation
  FROM budget_reservations
  WHERE id = p_reservation_id
    AND organization_id = p_organization_id
    AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false; -- already settled/released (idempotent) or not ours
  END IF;

  -- Clamp to the reserved hold. Over-reserve releases the difference; an
  -- over-run actual never charges more than was held.
  v_charge := LEAST(p_actual_amount, v_reservation.reserved_amount);

  UPDATE budget_reservations
    SET settled_amount = v_charge,
        status = 'settled',
        settled_at = NOW()
    WHERE id = p_reservation_id
      AND organization_id = p_organization_id
      AND status = 'reserved';

  UPDATE ai_usage_limits
    SET current_spend = COALESCE(current_spend, 0) + v_charge
    WHERE organization_id = p_organization_id;

  RETURN true;
END $$;

-- ============================================================================
-- 4. Stale-hold reaper (safety net for crashed processes)
--
-- Releases reservations older than p_max_age_seconds. Only 'reserved' rows
-- are touched (idempotent). Settled/released history is never modified.
-- ============================================================================
CREATE OR REPLACE FUNCTION release_stale_budget_reservations(
  p_organization_id uuid,
  p_max_age_seconds INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_max_age_seconds IS NULL OR p_max_age_seconds <= 0 THEN
    RAISE EXCEPTION 'INVALID_REAPER_AGE: max age must be positive';
  END IF;

  UPDATE budget_reservations
    SET status = 'released',
        settled_at = NOW()
    WHERE organization_id = p_organization_id
      AND status = 'reserved'
      AND created_at < NOW() - make_interval(secs => p_max_age_seconds);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- ============================================================================
-- 5. Reconciliation sweep job type (additive to 015's CHECK constraint)
-- ============================================================================
ALTER TABLE background_jobs DROP CONSTRAINT background_jobs_job_type_check;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_job_type_check
  CHECK (job_type IN (
    'approval_expiration_sweep',
    'embedding_backfill',
    'execute_autonomous_action',
    'budget_reconciliation_sweep'
  ));

-- ============================================================================
-- 6. RLS hardening: WITH CHECK on budget_reservations
--
-- 012 created the org-isolation policy with USING only; every write was
-- therefore accepted for any org id the client supplied. The policy already
-- exists on existing databases, so add WITH CHECK via drop/recreate guarded
-- to keep 012 -> 016 idempotent.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'budget_reservations'
      AND policyname = 'budget_reservations_org_isolation'
  ) THEN
    DROP POLICY budget_reservations_org_isolation ON budget_reservations;
  END IF;
END $$;

CREATE POLICY budget_reservations_org_isolation ON budget_reservations
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
