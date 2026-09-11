-- ============================================================================
-- Migration 019: Fix claim_background_jobs RETURNING...INTO array bug.
--
-- INTEGRATION DEFECT (proven live, S53-APP-INTEGRATION smoke, 2026-09-11):
--
-- Migration 015's claim_background_jobs used:
--
--     UPDATE ... RETURNING job.id INTO v_claimed;   -- v_claimed uuid[]
--
-- Two bugs in one statement:
--   1. plpgsql's INTO with a single array-variable target coerces the scalar
--      uuid via its text representation into uuid[], raising
--      "malformed array literal: "<uuid>"" (42804) the moment any job is
--      claimable. The queue could NEVER claim a job on a real database.
--   2. Even if the cast succeeded, SELECT/UPDATE...RETURNING INTO a plain
--      variable only captures the FIRST row — multi-job claims would be
--      silently truncated to one.
--
-- This path was never exercised before: unit tests mock the RPC, and no
-- prior live run claimed jobs. Caught by the first real invocation.
--
-- FIX: single data-modifying CTE statement — candidates -> claimed (UPDATE
-- ... RETURNING all needed columns) -> tagged (dedupe_token update) -> final
-- SELECT from claimed, ordered. No array plumbing at all.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_background_jobs(
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
BEGIN
  -- Fail-closed: global kill switch stops all job execution.
  IF is_global_kill_switch_enabled() THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH stale AS (
    -- Recover stale leases first (worker died mid-job): flip them back to
    -- pending so they can be re-claimed below. attempts is NOT decremented;
    -- repeated crashes eventually exceed max_attempts and go to dead-letter.
    UPDATE background_jobs
       SET status = 'pending',
           lease_expires_at = NULL,
           started_at = NULL,
           last_error = 'lease_expired_recovered'
     WHERE background_jobs.status = 'running'
       AND background_jobs.lease_expires_at < NOW()
    RETURNING background_jobs.id AS recovered_id
  ),
  candidates AS (
    -- Atomically claim pending due jobs. FOR UPDATE SKIP LOCKED guarantees a
    -- job is claimed by at most one worker even under concurrency.
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
  ),
  claimed AS (
    UPDATE background_jobs job
       SET status = 'running',
           started_at = NOW(),
           lease_expires_at = NOW() + make_interval(secs => GREATEST(p_lease_seconds, 30)),
           attempts = job.attempts + 1,
           last_error = NULL
     FROM candidates
     WHERE job.id = candidates.id
    RETURNING
      job.id AS id,
      job.organization_id AS organization_id,
      job.job_type AS job_type,
      job.payload AS payload,
      job.attempts AS attempts,
      job.max_attempts AS max_attempts,
      job.idempotency_key AS idempotency_key,
      job.scheduled_at AS scheduled_at
  ),
  tagged AS (
    -- Tag claimed rows with the worker id for observability (best-effort).
    UPDATE background_jobs bj
       SET dedupe_token = p_worker_id
     FROM claimed
     WHERE bj.id = claimed.id
    RETURNING bj.id
  )
  SELECT c.id, c.organization_id, c.job_type, c.payload,
         c.attempts, c.max_attempts, c.idempotency_key
  FROM claimed c
  ORDER BY c.scheduled_at ASC;
END $$;

COMMENT ON FUNCTION public.claim_background_jobs(text, integer, integer) IS
  'Atomically claims up to p_batch_size due jobs (FOR UPDATE SKIP LOCKED), recovers stale leases, tags the claiming worker, and returns claimed rows. Migration 019 replaces the 015 body whose RETURNING...INTO uuid[] assignment raised "malformed array literal" and truncated multi-row claims.';

COMMIT;
