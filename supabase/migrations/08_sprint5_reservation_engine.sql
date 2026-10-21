-- =====================================================================
-- 08_sprint5_reservation_engine.sql
-- Sprint 5.3 - Budget Reservation Engine, Stale-Job Recovery,
-- Embedding-Worker Dedupe, and Schema Reconciliation
--
-- Design invariants (per pre-push review checklist):
--   * SECURITY INVOKER on EVERY function (NO SECURITY DEFINER anywhere).
--   * `SET search_path` pinned to (public, extensions) on EVERY function
--     to harden against search-path injection.
--   * Idempotent / re-runnable: CREATE OR REPLACE FUNCTION, IF NOT EXISTS,
--     DROP POLICY IF EXISTS, DO-block guarded constraints/indexes. No DROP TABLE.
--   * Reservation lifecycle: pending -> completed (settle) OR pending -> expired
--     (exactly-once refund in the same transition; NO intermediate `released` state).
--   * Concurrency: per-organization row lock (FOR UPDATE) on ai_usage_limits
--     serializes all reservations for an org; the available budget is recomputed
--     after acquiring the lock, so combined reservations can never exceed
--     monthly_budget - current_spend.
--   * recover_stale_jobs() RETURNS integer using GET DIAGNOSTICS ... ROW_COUNT
--     accumulators. FOUND is never used as the return value.
--   * Multi-tenant isolation: RLS policies with WITH CHECK mirror the existing
--     house style (organization_members lookup). Workers/service-role bypass RLS
--     via the Supabase role model (documented, intentional).
--   * Kill-switch aware: reserve_budget()/check_budget_available() refuse when
--     ai_usage_limits.paused (global kill switch sets paused=true organization-wide;
--     org kill switch sets paused=true + pause_reason).
-- =====================================================================

-- =====================================================================
-- SECTION 0 - Schema reconciliation (additive, idempotent,
-- =====================================================================

-- 0.a) company_memory: generated types (types/supabase.ts) reference it,
--               but NO migration ever created the table. Create it to match the types.
CREATE TABLE IF NOT EXISTS company_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  CONSTRAINT company_memory_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_company_memory_org ON company_memory(organization_id);
CREATE INDEX IF NOT EXISTS idx_company_memory_org_category ON company_memory(organization_id, category);

ALTER TABLE company_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_memory_org_isolation ON company_memory;
CREATE POLICY company_memory_org_isolation ON company_memory
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

GRANT SELECT, INSERT, UPDATE, DELETE ON company_memory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON company_memory TO service_role;

-- 0.b) approval_requests: Phase 2 created this table first((IF NOT EXISTS
--               means Phase 6's stricter DDL was a no-op on live DBs that ran 02
--               before 06). Reconcile: add the Phase 6-only columns idempotently.
--               (Legacy `status` column + phase-6 `approval_status` column both kept -
--               status-migration warrant ans explicit product decision.)
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approval_status TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP WITH TIME ZONE DEFAULT now();
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approval_notes TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS modifications JSONB;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS modified_by TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS modified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS ai_recommendation TEXT;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS recommendation_confidence NUMERIC(5, 2);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS alternative_options JSONB;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS decision_id UUID;

-- Index for the phase-6-only decision_id column (once it exists via this
-- reconciliation). (See ALSO 06's idx_approval_requests_task - which indexes
-- the phase-2-era column;both lookups are covered.)
CREATE INDEX IF NOT EXISTS idx_approval_requests_decision ON approval_requests(decision_id);

-- 0.c) organizational_knowledge: embedding-worker dedupe support
--               (content_hash + partial unique index: the meaningful concurrency
--               invariant for multiple embedding workers - dedupe on content,
--               NOT on the already-unique PK id).
ALTER TABLE organizational_knowledge ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- 0.d) ai_usage_limits: add held-money column for reservations
ALTER TABLE ai_usage_limits ADD COLUMN IF NOT EXISTS reserved_amount NUMERIC(10, 6) NOT NULL DEFAULT 0;

-- =====================================================================
-- SECTION  1 - budget_reservations table
-- =====================================================================
CREATE TABLE IF NOT EXISTS budget_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Reservation details
  amount NUMERIC(10, 6) NOT NULL CHECK (amount > 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),

  -- Lifecycle timestamps
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  expired_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,

  -- Caller context (for auditability)
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  refund_audit JSONB DEFAULT '{}'::jsonb,

  CONSTRAINT budget_reservations_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Unique idempotency enforcement (UNIQUE index supports ON CONFLICT inference)
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_reservations_org_idem
  ON budget_reservations (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_budget_reservations_org_status
  ON budget_reservations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_reservations_expiry_pending
  ON budget_reservations (expires_at) WHERE status = 'pending';

ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_reservations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_reservations_org_isolation ON budget_reservations;
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

GRANT SELECT, INSERT, UPDATE, DELETE ON budget_reservations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON budget_reservations TO service_role;

-- =====================================================================
-- SECTION 2 - reserve_budget()
--   Atomic + idempotent budget reservation.
 -- Proves the concurrency invariant:
--   any two concurrent reservations for the same org serialize on the
--   ai_usage_limits row lock, and each recomputes `available` from the
--   latest committed state - combined reservations can never exceed
--   monthly_budget - current_spend.
-- =====================================================================
-- Drop any prior definition of this exact signature (e.g. the live-schema
-- variant recreated by 09_fix_reserve_budget_drift.sql) so the fixpoint
-- loop converges: CREATE OR REPLACE cannot change an OUT-column list.
DROP FUNCTION IF EXISTS public.reserve_budget(uuid, numeric, text, interval);

CREATE OR REPLACE FUNCTION reserve_budget(
  p_organization_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_ttl interval DEFAULT '1 hour'::interval
) RETURNS TABLE (id uuid, ok boolean, reason text)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_reservation_id uuid;
  v_limits ai_usage_limits%ROWTYPE;
  v_available numeric;
BEGIN
  -- Input validation
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, false, 'amount must be positive'::text;RETURN;
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT NULL::uuid, false, 'idempotency_key is required'::text;RETURN;
  END IF;
  IF p_ttl IS NULL OR p_ttl <= INTERVAL '0' THEN
    RETURN QUERY SELECT NULL::uuid, false, 'ttl must be positive'::text;RETURN;
  END IF;

  -- Idempotency:the unique (organization_id, idempotency_key) index makes
  -- duplicate-key attempts atomic no-ops. Replay of an active reservation
  -- returns the original reservation id.
  INSERT INTO budget_reservations (organization_id, amount, idempotency_key, expires_at, requested_by)
  VALUES (p_organization_id, p_amount, p_idempotency_key, now() + p_ttl, auth.uid())
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING budget_reservations.id INTO v_reservation_id;

  IF v_reservation_id IS NULL THEN
    SELECT r.id INTO v_reservation_id
    FROM budget_reservations r
    WHERE r.organization_id = p_organization_id AND r.idempotency_key = p_idempotency_key;
    IF v_reservation_id IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, false, 'idempotency_key race'::text;RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM budget_reservations WHERE budget_reservations.id = v_reservation_id AND status <> 'pending') THEN
      RETURN QUERY SELECT v_reservation_id, false, 'reservation already settled'::text;RETURN;
    END IF;
    RETURN QUERY SELECT v_reservation_id, true, 'idempotent replay'::text;RETURN;
  END IF;

  -- Concurrency: single row lock serializes all reservation attempts for
  -- this org. Available is recomputed from latest committed state efter lock.

  SELECT * INTO v_limits
  FROM ai_usage_limits
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF v_limits.organization_id IS NULL THEN
    DELETE FROM budget_reservations WHERE budget_reservations.id = v_reservation_id;
    RETURN QUERY SELECT NULL::uuid, false, 'budget not initialized'::text;RETURN;
  END IF;

  IF v_limits.paused THEN
    DELETE FROM budget_reservations WHERE budget_reservations.id = v_reservation_id;
    RETURN QUERY SELECT v_reservation_id, false, COALESCE(v_limits.pause_reason,'kill switch active')::text;RETURN;
 END IF;
 v_available := v_limits.monthly_budget - COALESCE(v_limits.current_spend, 0) - COALESCE(v_limits.reserved_amount, 0);
 IF p_amount > v_available THEN
    DELETE FROM budget_reservations WHERE budget_reservations.id = v_reservation_id;
    RETURN QUERY SELECT NULL::uuid, false,'insufficient budget: ' || v_available::text;RETURN;
  END IF;

  UPDATE ai_usage_limits
  SET reserved_amount = COALESCE(reserved_amount, 0) + p_amount, updated_at = now()
  WHERE organization_id = p_organization_id;

  RETURN QUERY SELECT v_reservation_id, true, 'reserved'::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reserve_budget(uuid,numeric,text,interval) TO authenticated, service_role;-- =====================================================================
-- SECTION 3 - settle_reservation()
--   exactly-once:reserved -> completed moves the money from reserved_amount
--   into current_spend in ONE statement pair guarded by the pending status.
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
  v_affected integer;
BEGIN
  -- Lock the reservation row. RLS (invoker) confines this to the caller's orgs;
  -- service-role workers bypass RLS (documented, intentional).
  SELECT * INTO v_reservation
  FROM budget_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_reservation.id IS NULL OR v_reservation.status <> 'pending' THEN
    RETURN false;
  END IF;

  -- Move held money into spend (both columns guarded so reserved + spend
  -- can never exceed budget;settling is idempotent because status flips first).
  UPDATE budget_reservations
  SET status = 'completed', completed_at = now()
  WHERE id = p_reservation_id AND status = 'pending';
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected = 1 THEN
    UPDATE ai_usage_limits
    SET current_spend = COALESCE(current_spend, 0) + v_reservation.amount,
        reserved_amount = GREATEST(COALESCE(reserved_amount, 0) - v_reservation.amount, 0),
        updated_at = now()
    WHERE organization_id = v_reservation.organization_id;
  END IF;

  RETURN (v_affected = 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.settle_reservation(uuid) TO authenticated, service_role;

-- =====================================================================
-- SECTION 4 - expire_reservations()
--   pending -> expired AN with exactly-once refund (per-org optional filter.
--   No intermediate `released` state:the refund happens in the SAME transition.
;
--   Returns the count of reservations expired (integer;NOT FOUND/boolean).
-- =====================================================================
CREATE OR REPLACE FUNCTION expire_reservations(
  p_organization_id uuid DEFAULT NULL,
  p_max_age interval DEFAULT '6 hours'::interval
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_expired integer := 0;
  v_row record;
  v_affected integer;
BEGIN
  IF p_max_age IS NULL OR p_max_age <= INTERVAL '0' THEN
    RAISE EXCEPTION 'p_max_age must be a positive interval';
  END IF;

  -- Grab every due reservation exactly once. FOR UPDATE row locks serialize
  -- concurrent expire/settle runs:the loser observes the flipped status and skips.

  FOR v_row IN
    SELECT id, organization_id, amount
    FROM budget_reservations
    WHERE status = 'pending'
      AND expires_at <= now()
      AND (p_organization_id IS NULL OR organization_id = p_organization_id)
    FOR UPDATE OF budget_reservations
  LOOP
    -- Exactly-once guard: only a row still 'pending' (under our lock) transitions.
    UPDATE budget_reservations
    SET status = 'expired', expired_at = now(),
        refund_audit = coalesce(refund_audit,'{}'::jsonb) || jsonb_build_object('refunded_at', now(),'expired_by_fn', 'expire_reservations')
    WHERE id = v_row.id AND status = 'pending';
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    IF v_affected = 1 THEN
      -- Refund exactly once, in the same statement that flipped status.

      UPDATE ai_usage_limits
      SET reserved_amount = GREATEST(COALESCE(reserved_amount, 0) - v_row.amount, 0),
          updated_at = now()
      WHERE organization_id = v_row.organization_id;
      v_expired := v_expired + 1;
    END IF;
  END LOOP;

  RETURN v_expired;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.expire_reservations(uuid, interval) TO authenticated, service_role;

-- =====================================================================
-- SECTION 5 - recover_stale_jobs()
--   Returns INTEGER (number of recovered rows;via GET DIAGNOSTICS ROW_COUNT
--   accumulators;FOUND is never used as the return value).
--   action_queue:       processing -> pending (stale processing_started_at).
--   autonomous_actions: executing -> queued (+ retry_count bump) while retries
--                          remain;executing -> failed when retries exhausted.
-- =====================================================================
CREATE OR REPLACE FUNCTION recover_stale_jobs(
  p_max_age interval DEFAULT '30 minutes'::interval
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_recovered integer := 0;
  v_affected integer;
BEGIN
  IF p_max_age IS NULL OR p_max_age <= INTERVAL '0' THEN
    RAISE EXCEPTION 'p_max_age must be a positive interval';
  END IF;

  -- 1) Requeue stale processing queue items((
  UPDATE action_queue
  SET queue_status = 'pending', processing_started_at = NULL
  WHERE queue_status = 'processing'
    AND processing_started_at < now() - p_max_age;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_recovered := v_recovered + v_affected;

  -- 2) Requeue stale executing actions while retries remain;fail otherwise((
  UPDATE autonomous_actions
  SET execution_status = 'queued', started_at = NULL,
      retry_count = retry_count + 1 ,
      last_error = 'Recovered from stale execution'
  WHERE execution_status = 'executing'
    AND started_at < now() - p_max_age
    AND retry_count < max_retries;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_recovered := v_recovered + v_affected;

  UPDATE autonomous_actions
  SET execution_status = 'failed', completed_at = now() ,
      last_error = 'Stale execution; retries exhausted'
  WHERE execution_status = 'executing'
    AND started_at < now() - p_max_age
    AND retry_count >= max_retries;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  v_recovered := v_recovered + v_affected;

  RETURN v_recovered;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recover_stale_jobs(interval) TO authenticated, service_role;

-- =====================================================================
-- SECTION 6 - check_budget_available(
--   Kill-switch aware, non-locking advisory check (reserve_budget remains
--   the authoritative guard;it takes the row lock).
-- =====================================================================
CREATE OR REPLACE FUNCTION check_budget_available(
  p_organization_id uuid,
  p_amount numeric
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_limits ai_usage_limits%ROWTYPE;
  v_available numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_limits
  FROM ai_usage_limits
  WHERE organization_id = p_organization_id;

  IF v_limits.organization_id IS NULL OR v_limits.paused THEN
    RETURN false;
  END IF;

  v_available := v_limits.monthly_budget - COALESCE(v_limits.current_spend, 0) - COALESCE(v_limits.reserved_amount, 0);
  RETURN (p_amount <= v_available);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_budget_available(uuid, numeric) TO authenticated, service_role;

-- =====================================================================
-- SECTION 7 - claim_pending_embeddings(
--   Atomic, contention-free batch claim for multiple embedding workers.
--   FOR UPDATE SKIP LOCKED guarantees each worker gets a disjoint set of
--   pending knowledge rows (no double-processing). Scope is org-isolated by
--   RLS under SECURITY INVOKER ((service_role worker bypasses RLS by design).
-- =====================================================================
CREATE OR REPLACE FUNCTION claim_pending_embeddings(
  p_organization_id uuid,
  p_limit integer DEFAULT 10
) RETURNS SETOF organizational_knowledge
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;

  RETURN QUERY
  SELECT *
  FROM organizational_knowledge
  WHERE organization_id = p_organization_id
    AND embeddings_pending = true
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_pending_embeddings(uuid,integer) TO authenticated, service_role;

-- =====================================================================
-- SECTION  8 - content_hash trigger (embedding-worker dedupe enforcement);
--   Populates organizational_knowledge.content_hash automatically so the
--   partial unique index dedups concurrent identical inserts per org.
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_set_knowledge_content_hash()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS NULL THEN
    NEW.content_hash := md5(NEW.content);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_knowledge_content_hash ON organizational_knowledge;
CREATE TRIGGER trg_knowledge_content_hash
  BEFORE INSERT OR UPDATE OF content ON organizational_knowledge
  FOR EACH ROW EXECUTE FUNCTION trg_set_knowledge_content_hash();

-- =====================================================================
-- SECTION  9 - embedding CONTENT dedupe (unique per org + content);
--   This - not id - is the correct concurrency invariant for parallel
--   embedding workers:two workers inserting identical knowledge for the same
--   org race;exactlyone wins;the loser hits the unique index and treats it as
--   already-embedded(((no duplicate embedding work;no duplicate rows).
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_knowledge_content
  ON organizational_knowledge (organization_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- =====================================================================
-- SECTION 10 - approval_requests new-column CHECK constraints (guarded)
-- =====================================================================
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'approval_requests_approval_status_check'
                    AND conrelid = 'public.approval_requests'::regclass) THEN
    ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired', 'modified', 'deferred'));
  END IF;
END;
$guard$;
-- =====================================================================
-- SECTION 11 - expire_approvals(p_max_age): flip stale pending approvals to
-- 'expired' (both legacy status and phase-6 approval_status),and audit
-- each affected org via activity_events.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.expire_approvals(
  p_max_age interval DEFAULT '24 hours'::interval
) RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_count integer := 0;
  v_org uuid;
  v_rowcount integer;
BEGIN
  IF p_max_age IS NULL OR p_max_age < INTERVAL '0' THEN
    RAISE EXCEPTION 'p_max_age must be a non-negative interval';
  END IF;

  FOR v_org IN
    SELECT DISTINCT organization_id
    FROM approval_requests
    WHERE status = 'pending'
      AND approval_status IS DISTINCT FROM 'expired'
      AND (
        (response_deadline IS NOT NULL AND response_deadline < now() - p_max_age)
        OR (response_deadline IS NULL AND expires_at < now()::timestamp - p_max_age)
      )
  LOOP
    UPDATE approval_requests
      SET status = 'expired', approval_status = 'expired', responded_at = now()::timestamp,
          approval_notes = COALESCE(approval_notes, '') || '; expired by system at ' || now()::text
      WHERE organization_id = v_org
        AND status = 'pending'
        AND approval_status IS DISTINCT FROM 'expired'
        AND (
          (response_deadline IS NOT NULL AND response_deadline < now() - p_max_age)
          OR (response_deadline IS NULL AND expires_at < now()::timestamp - p_max_age)
        );
        GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_count := v_count + v_rowcount;

    INSERT INTO activity_events (organization_id, event_type)
      VALUES (v_org, 'approval_expired')
      ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_count;
END;
$fn$;
-- Grants required by RLS policies and invoker functions (real gaps fixed):
GRANT SELECT ON organization_members TO authenticated, service_role;
GRANT SELECT, UPDATE ON ai_usage_limits TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_approvals(interval) TO authenticated, service_role;
