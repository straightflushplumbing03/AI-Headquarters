-- ============================================================================
-- Migration 020: Budget monetary precision — micro-cost exactness
--
-- INTEGRATION DEFECT (audit, S53-APP-INTEGRATION):
-- The live budget_reservations table stores reserved/settled amounts at
-- NUMERIC(12,2). The Sprint 5.3 engine's stochastic AI costs are computed at
-- 6-decimal precision (ai_usage_limits.current_spend/reserved_amount are
-- NUMERIC(10,6)) — e.g. estimate 0.1234 -> Postgres ROUNDs the hold to 0.12,
-- so the DB clamps settlement to the HOLD (0.12), under-charging the org by
-- the rounded 0.0034 and weakening the pre-authorization invariant.
--
-- FIX: widen budget_reservations.reserved_amount / settled_amount to
-- NUMERIC(12,6) so a hold always exactly covers the estimated micro-cost and
-- the clamped settle is exact. This is ADDITIVE + re-runnable and safe:
--   * ALTER of the numeric precision never drops data or changes values.
--   * No CHECK constraint on these columns exists, so no constraint needs
--     rewriting (verified live: only reserved_amount >= 0).
--   * Existing rows keep their value; new hires just compute/round at 6dp.
--
-- Compatible with every verified migration (012, 016, 09_) and with
-- reserve_budget_idempotent / settle_budget_clamped which INSERT/UPDATE by
-- p_amount/p_actual_amount — the widening only makes clamping exact.
-- ============================================================================

BEGIN;

-- Guarded: the earliest lineage of budget_reservations (08 / 012) has no
-- reserved_amount / settled_amount. Widen only when the column exists, so this
-- migration is safe to run at any point in the fixpoint loop.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='budget_reservations'
               AND column_name='reserved_amount') THEN
    ALTER TABLE budget_reservations ALTER COLUMN reserved_amount TYPE NUMERIC(12, 6);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='budget_reservations'
               AND column_name='settled_amount') THEN
    ALTER TABLE budget_reservations ALTER COLUMN settled_amount TYPE NUMERIC(12, 6);
  END IF;
END $$;

COMMIT;
