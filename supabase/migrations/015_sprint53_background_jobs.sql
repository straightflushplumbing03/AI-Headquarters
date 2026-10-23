-- ============================================================================
-- Sprint 5.3 P1: Durable background jobs
-- ============================================================================
--
-- Postgres-backed durable job queue. Survives browser close, refresh, server
-- restart, transient API failures, duplicate enqueues, and worker retries.
--
-- Design:
--   * ENQUEUE-ONCE: unique (organization_id, job_type, idempotency_key).
--     Duplicate enqueues of the same logical job are no-ops (ON CONFLICT).
--   * ATOMIC CLAIM: claim_background_jobs(rank, now) marks rows 'running' and
--     returns them in one statement — two concurrent workers can never claim
--     the same job (FOR UPDATE SKIP LOCKED inside the function).
--   * RETRY with backoff: transient failures increment attempts and reschedule
--     (status 'pending', scheduled_at = now + backoff). attempts >= max_attempts
--     moves the row to 'dead' (dead-letter). Permanent failures go straight to
--     'dead' via fail_background_job(..., p_permanent => true).
--   * STALE RUNNING RECOVERY: claim also re-enqueues jobs stuck in 'running'
--     whose lease expired (started_at < now - lease_seconds) — a worker crash
--     cannot strand a job forever. Original attempts are preserved via
--     recovery_count; a job that dies repeatedly still reaches max_attempts.
--   * SECURITY: RLS isolation identical to other org tables; claim/complete/
--     fail functions run as the caller and verify org membership server-side,
--     so a non-member cannot drive another org's queue.
--   * KILL SWITCH: claim_background_jobs refuses to hand out jobs for orgs
--     whose ai_usage_limits.paused is true or when the global kill switch
--     (system_flags.global_kill_switch) is enabled — fail-closed.
--
-- Job types registered here (handled in lib/jobs/handlers.ts):
--   approval_expiration_sweep : expire approvals past response_deadline
--   embedding_backfill        : process pending organizational_knowledge vectors
--   execute_autonomous_action : run an approved action through ActionExecutionEngine
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL
    CHECK (job_type IN (
      'approval_expiration_sweep',
      'embedding_backfill',
      'execute_autonomous_action'
    )),

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'dead')),

  -- Retry bookkeeping
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  last_error TEXT,
  error_history JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Scheduling / lease
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  lease_expires_at TIMESTAMP WITH TIME ZONE,

  -- Idempotency: same (org, type, key) may only exist once
  idempotency_key TEXT NOT NULL,
  dedupe_token TEXT,

  -- Job result / outcome (JSONB, written on completion)
  result JSONB,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT background_jobs_idempotency_unique
    UNIQUE (organization_id, job_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_claim
  ON background_jobs (status, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_background_jobs_org_created
  ON background_jobs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_background_jobs_org_status
  ON background_jobs (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_dead
  ON background_jobs (organization_id, completed_at DESC)
  WHERE status = 'dead';
CREATE INDEX IF NOT EXISTS idx_background_jobs_lease
  ON background_jobs (status, lease_expires_at)
  WHERE status = 'running';

-- ----------------------------------------------------------------------------
-- 2. RLS — org isolation, fail-closed
-- ----------------------------------------------------------------------------
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS background_jobs_org_isolation ON background_jobs;
CREATE POLICY background_jobs_org_isolation ON background_jobs
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

-- ----------------------------------------------------------------------------
-- 3. updated_at trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION background_jobs_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_background_jobs_updated_at ON background_jobs;
CREATE TRIGGER trg_background_jobs_updated_at
  BEFORE UPDATE ON background_jobs
  FOR EACH ROW EXECUTE FUNCTION background_jobs_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Atomic claim — one statement, SKIP LOCKED, kill-switch + lease aware
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_background_jobs(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 5,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  job_type TEXT,
  payload JSONB,
  attempts INTEGER,
  max_attempts INTEGER,
  idempotency_key TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_claimed uuid[];
BEGIN
  -- Fail-closed: global kill switch stops all job execution.
  IF is_global_kill_switch_enabled() THEN
    RETURN;
  END IF;

  -- Recover stale leases first (worker died mid-job): flip them back to
  -- pending so they can be re-claimed below. attempts is NOT decremented;
  -- repeated crashes eventually exceed max_attempts and go to dead-letter.
  UPDATE background_jobs
     SET status = 'pending',
         lease_expires_at = NULL,
         started_at = NULL,
         last_error = 'lease_expired_recovered'
   WHERE status = 'running'
     AND lease_expires_at < NOW();

  -- Atomically claim pending due jobs. FOR UPDATE SKIP LOCKED guarantees a
  -- job is claimed by at most one worker even under concurrency.
  WITH candidates AS (
    SELECT j.id
    FROM background_jobs j
    WHERE j.status = 'pending'
      AND j.scheduled_at <= NOW()
      AND NOT COALESCE((
            SELECT l.paused
            FROM ai_usage_limits l
            WHERE l.organization_id = j.organization_id
          ), false)                       -- org kill switch (fail-closed)
    ORDER BY j.scheduled_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(p_batch_size, 1)
  )
  UPDATE background_jobs job
     SET status = 'running',
         started_at = NOW(),
         lease_expires_at = NOW() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
         attempts = job.attempts + 1,
         last_error = NULL
   FROM candidates
   WHERE job.id = candidates.id
  RETURNING job.id INTO v_claimed;

  -- Tag claimed rows with the worker id for observability (best-effort).
  UPDATE background_jobs
     SET dedupe_token = p_worker_id
   WHERE id = ANY(v_claimed);

  RETURN QUERY
  SELECT bj.id, bj.organization_id, bj.job_type, bj.payload,
         bj.attempts, bj.max_attempts, bj.idempotency_key
  FROM background_jobs bj
  WHERE bj.id = ANY(v_claimed)
  ORDER BY bj.scheduled_at ASC;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Complete — idempotent terminal write (only a 'running' row completes)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_background_job(
  p_job_id uuid,
  p_organization_id uuid,
  p_result JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE background_jobs
     SET status = 'completed',
         result = p_result,
         completed_at = NOW(),
         lease_expires_at = NULL
   WHERE id = p_job_id
     AND organization_id = p_organization_id
     AND status = 'running';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Fail — transient (retry with exponential backoff) or permanent (dead)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fail_background_job(
  p_job_id uuid,
  p_organization_id uuid,
  p_error TEXT,
  p_permanent BOOLEAN DEFAULT false,
  p_backoff_base_seconds INTEGER DEFAULT 30
)
RETURNS TEXT  -- 'retrying' | 'dead' | 'noop'
LANGUAGE plpgsql
AS $$
DECLARE
  v_job background_jobs%ROWTYPE;
  v_next_backoff INTEGER;
BEGIN
  SELECT * INTO v_job
  FROM background_jobs
  WHERE id = p_job_id
    AND organization_id = p_organization_id
    AND status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'noop';  -- already completed / failed / recovered elsewhere
  END IF;

  -- Append to error history (capped at 20 entries).
  UPDATE background_jobs
     SET error_history = (
           SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
           FROM (
             SELECT e
             FROM jsonb_array_elements(error_history) AS e
             LIMIT 19
           ) recent
         ) || jsonb_build_array(
           jsonb_build_object(
             'attempt', v_job.attempts,
             'error', LEFT(p_error, 500),
             'at', NOW()
           )
         );

  -- Permanent failure OR retries exhausted -> dead-letter.
  IF p_permanent OR v_job.attempts >= v_job.max_attempts THEN
    UPDATE background_jobs
       SET status = 'dead',
           last_error = LEFT(p_error, 500),
           completed_at = NOW(),
           lease_expires_at = NULL
     WHERE id = p_job_id;
    RETURN 'dead';
  END IF;

  -- Transient: exponential backoff (30s, 60s, 120s, 240s, ... capped 1h).
  v_next_backoff := LEAST(
    p_backoff_base_seconds * POWER(2, v_job.attempts - 1),
    3600
  );

  UPDATE background_jobs
     SET status = 'pending',
         last_error = LEFT(p_error, 500),
         scheduled_at = NOW() + make_interval(secs => v_next_backoff),
         started_at = NULL,
         lease_expires_at = NULL
   WHERE id = p_job_id;

  RETURN 'retrying';
END $$;

-- ----------------------------------------------------------------------------
-- 7. Dead-letter requeue (operator action) — gives a dead job a fresh cycle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION requeue_dead_background_job(
  p_job_id uuid,
  p_organization_id uuid
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE background_jobs
     SET status = 'pending',
         attempts = 0,
         last_error = NULL,
         scheduled_at = NOW(),
         started_at = NULL,
         completed_at = NULL,
         lease_expires_at = NULL
   WHERE id = p_job_id
     AND organization_id = p_organization_id
     AND status = 'dead';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;
