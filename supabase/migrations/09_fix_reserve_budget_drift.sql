-- 09_fix_reserve_budget_drift.sql
--
-- Sprint 5.3 integration: the live znpqosbwdgrtfediqvwt DB evolved the
-- budget_reservations table past the schema 08_sprint5_reservation_engine.sql
-- created.  The live table uses:
--     id, organization_id, agent_id, task_id, reserved_amount,
--     settled_amount, status, reference, created_at, settled_at,
--     action_idempotency_key
-- while 08's reserve_budget(uuid,numeric,text,interval) still inserted into
--     (organization_id, amount, idempotency_key, expires_at, requested_by)
-- which no longer exist -> any call fails with 42703 (column "amount").
--
-- This migration DROPs that broken overload and re-creates it against the
-- live column set, preserving the atomic/idempotent reservation contract.
-- It does NOT touch the newer functions (reserve_budget_idempotent,
-- settle_budget_clamped, release_budget, ...) which are already built for
-- the live schema, and it makes no data changes.
-- Additive + idempotent + re-runnable.

-- =====================================================================
-- 1. Drop the drift-broken overload(s).
--    Base reserve_budget(name, amount, idempotency_key, ttl) is dead in
--    the live schema; leave reserve_budget_idempotent alone.
-- =====================================================================
DROP FUNCTION IF EXISTS public.reserve_budget(uuid, numeric, text, interval);

-- =====================================================================
-- 1b. Guarantee an exact-once arbiter for the re-created function.
--     The live table relies on (organization_id, action_idempotency_key)
--     for idempotent replays. Create idempotently so the migration is
--     self-contained and re-runnable regardless of prior state.
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_reservations_org_key
  ON budget_reservations (organization_id, action_idempotency_key);

-- =====================================================================
-- 2. Reserve budget against the live budget_reservations schema.
--    Uses action_idempotency_key for exactly-once reservation replay, the
--    same unique-enforcement approach as reserve_budget_idempotent, but
--    exposed through the classic 4-arg signature for backwards compat with
--    the Sprint 5 validation suite.
-- =====================================================================
CREATE OR REPLACE FUNCTION reserve_budget(
  p_organization_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_ttl interval DEFAULT '1 hour'::interval
) RETURNS TABLE (reservation_id uuid, ok boolean, reason text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_reservation_id uuid;
  v_limits ai_usage_limits%ROWTYPE;
  v_available numeric;
  v_expires_at timestamptz;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, false, 'amount must be positive'::text; RETURN;
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT NULL::uuid, false, 'idempotency_key is required'::text; RETURN;
  END IF;
  IF p_ttl IS NULL OR p_ttl <= INTERVAL '0' THEN
    RETURN QUERY SELECT NULL::uuid, false, 'ttl must be positive'::text; RETURN;
  END IF;

  v_expires_at := now() + p_ttl;

  -- Exact-once: attempt insert; on collision resolve to existing row.
  -- Live status vocabulary: 'reserved' | 'settled' | 'released'.
  INSERT INTO budget_reservations (
    organization_id, reserved_amount, status, reference,
    action_idempotency_key, created_at
  )
  VALUES (
    p_organization_id, p_amount, 'reserved', p_idempotency_key,
    p_idempotency_key, v_expires_at
  )
  ON CONFLICT (organization_id, action_idempotency_key) DO NOTHING
  RETURNING id INTO v_reservation_id;

  IF v_reservation_id IS NULL THEN
    SELECT r.id INTO v_reservation_id
    FROM budget_reservations r
    WHERE r.organization_id = p_organization_id
      AND r.action_idempotency_key = p_idempotency_key;

    IF v_reservation_id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, false, 'idempotency_key race'::text; RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM budget_reservations r
      WHERE r.id = v_reservation_id AND r.status <> 'reserved'
    ) THEN
      RETURN QUERY SELECT v_reservation_id, false, 'reservation already settled'::text; RETURN;
    END IF;

    RETURN QUERY SELECT v_reservation_id, true, 'idempotent replay'::text; RETURN;
  END IF;

  -- Concurrency: single-row lock serializes reservation attempts per org.
  SELECT * INTO v_limits
  FROM ai_usage_limits aul
  WHERE aul.organization_id = p_organization_id
  FOR UPDATE;

  IF v_limits.organization_id IS NULL THEN
    DELETE FROM budget_reservations r WHERE r.id = v_reservation_id;
    RETURN QUERY SELECT NULL::uuid, false, 'budget not initialized'::text; RETURN;
  END IF;

  IF v_limits.paused THEN
    DELETE FROM budget_reservations r WHERE r.id = v_reservation_id;
    RETURN QUERY SELECT v_reservation_id, false,
      COALESCE(v_limits.pause_reason, 'kill switch active')::text; RETURN;
  END IF;

  v_available := v_limits.monthly_budget
    - COALESCE(v_limits.current_spend, 0)
    - COALESCE(v_limits.reserved_amount, 0);

  IF p_amount > v_available THEN
    DELETE FROM budget_reservations r WHERE r.id = v_reservation_id;
    RETURN QUERY SELECT NULL::uuid, false,
      'insufficient budget: ' || v_available::text; RETURN;
  END IF;

  UPDATE ai_usage_limits aul
  SET reserved_amount = COALESCE(aul.reserved_amount, 0) + p_amount,
      updated_at = now()
  WHERE aul.organization_id = p_organization_id;

  RETURN QUERY SELECT v_reservation_id, true, 'reserved'::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reserve_budget(uuid, numeric, text, interval)
  TO authenticated, service_role;

-- =====================================================================
-- 3. Re-create the classic settle_reservation(uuid) for the live schema.
--    The original 08 body looked for status='pending' (old vocabulary) and
--    decremented `amount`, both of which no longer exist.  This re-created
--    version speaks the live vocabulary and mirrors the live engine's
--    accounting (spend = sum of settled; the org's reserved_amount is a
--    hold watermark, not decremented on settle).
-- =====================================================================
CREATE OR REPLACE FUNCTION settle_reservation(
  p_reservation_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_reservation budget_reservations%ROWTYPE;
  v_org_id uuid;
BEGIN
  SELECT * INTO v_reservation
  FROM budget_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_reservation.id IS NULL OR v_reservation.status <> 'reserved' THEN
    RETURN false;
  END IF;

  v_org_id := v_reservation.organization_id;

  UPDATE budget_reservations
  SET status = 'settled',
      settled_at = now(),
      settled_amount = COALESCE(settled_amount, reserved_amount)
  WHERE id = p_reservation_id
    AND status = 'reserved';

  UPDATE ai_usage_limits
  SET current_spend = COALESCE(current_spend, 0) + v_reservation.reserved_amount,
      updated_at = now()
  WHERE organization_id = v_org_id;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.settle_reservation(uuid) TO authenticated, service_role;