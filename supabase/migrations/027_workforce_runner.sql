-- ============================================================================
-- 027_workforce_runner.sql
-- Database side of the agent runner (lib/workforce/runner.ts).
--
-- Additive only. Three functions, all executor-only (service
-- role); no API role but service_role may call them:
--   workforce_next_tasks(limit)            queued work, highest priority first
--   workforce_requeue_stale(minutes, max)  recover tasks whose runner died
--   workforce_activity_summary(org, days)  read-only figures for reports
--   workforce_schedule_recurring(tools)    one task per ISO week per active,
--                                          approval-free grant of a listed tool
-- ============================================================================

CREATE OR REPLACE FUNCTION workforce_priority_rank(p text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END
$$;

-- Claimable candidates only. Claiming (and every permission, approval and
-- dependency check) still happens in workforce_claim_task.
CREATE OR REPLACE FUNCTION workforce_next_tasks(p_limit int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM workforce_require_executor();
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.rank, x.created_at), '[]'::jsonb) INTO v
  FROM (
    SELECT t.id, t.organization_id, t.agent_id, t.title, t.description, t.priority,
           t.required_tool, t.required_resource, t.input, t.attempt, t.created_at,
           workforce_priority_rank(t.priority) AS rank
    FROM tasks t
    JOIN agents a ON a.id = t.agent_id AND a.active
    WHERE t.status IN ('queued', 'pending') AND t.required_tool IS NOT NULL AND t.agent_id IS NOT NULL
    ORDER BY workforce_priority_rank(t.priority), t.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50)
  ) x;
  RETURN v;
END $$;

-- A task stuck in 'working' longer than p_stale_minutes lost its runner.
-- Requeue it, or fail it once it has used p_max_attempts claims.
CREATE OR REPLACE FUNCTION workforce_requeue_stale(p_stale_minutes int DEFAULT 30, p_max_attempts int DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t tasks%ROWTYPE; v_requeued int := 0; v_failed int := 0;
BEGIN
  PERFORM workforce_require_executor();
  PERFORM workforce_set_actor('system', NULL);
  FOR t IN
    SELECT * FROM tasks
    WHERE status = 'working'
      AND claimed_at < now() - make_interval(mins => GREATEST(COALESCE(p_stale_minutes, 30), 5))
    FOR UPDATE SKIP LOCKED
  LOOP
    IF t.attempt >= GREATEST(COALESCE(p_max_attempts, 3), 1) THEN
      UPDATE tasks SET status = 'failed', completed_at = now(),
                       error = format('Runner stopped responding; gave up after %s attempts', t.attempt)
      WHERE id = t.id;
      v_failed := v_failed + 1;
    ELSE
      UPDATE tasks SET status = 'queued' WHERE id = t.id;
      v_requeued := v_requeued + 1;
    END IF;
    PERFORM workforce_log_event(t.organization_id, 'workforce.task_recovered', t.id, t.agent_id,
      'system', NULL, format('Stale task %s', CASE WHEN t.attempt >= p_max_attempts THEN 'failed' ELSE 'requeued' END),
      jsonb_build_object('claimed_at', t.claimed_at, 'attempt', t.attempt, 'stale_minutes', p_stale_minutes));
  END LOOP;
  RETURN jsonb_build_object('requeued', v_requeued, 'failed', v_failed);
END $$;

-- Figures only (counts, sums, reasons); never task inputs or event metadata.
CREATE OR REPLACE FUNCTION workforce_activity_summary(p_org uuid, p_days int DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_since timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 7), 1), 90));
BEGIN
  PERFORM workforce_require_executor();
  RETURN jsonb_build_object(
    'since', v_since,
    'tasks_by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (
        SELECT status, count(*) n FROM tasks WHERE organization_id = p_org AND created_at >= v_since GROUP BY status) s), '{}'),
    'tasks_completed', (SELECT count(*) FROM tasks WHERE organization_id = p_org AND status = 'completed' AND completed_at >= v_since),
    'tasks_failed', (SELECT count(*) FROM tasks WHERE organization_id = p_org AND status = 'failed' AND completed_at >= v_since),
    'events_by_type', COALESCE((SELECT jsonb_object_agg(event_type, n) FROM (
        SELECT event_type, count(*) n FROM activity_events
        WHERE organization_id = p_org AND created_at >= v_since AND event_type LIKE 'workforce.%' GROUP BY event_type) s), '{}'),
    'denials_by_reason', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (
        SELECT COALESCE(metadata ->> 'reason', 'unknown') reason, count(*) n FROM activity_events
        WHERE organization_id = p_org AND created_at >= v_since
          AND event_type IN ('workforce.permission_denied', 'workforce.claim_denied') GROUP BY 1) s), '{}'),
    'cost_usd', (SELECT COALESCE(sum(cost_usd), 0) FROM activity_events WHERE organization_id = p_org AND created_at >= v_since),
    'deliverables', (SELECT count(*) FROM workforce_deliverables WHERE organization_id = p_org AND created_at >= v_since),
    'deliverables_verified', (SELECT count(*) FROM workforce_deliverables WHERE organization_id = p_org AND created_at >= v_since AND verified),
    'approvals_pending', (SELECT count(*) FROM approval_requests WHERE organization_id = p_org AND requested_action IS NOT NULL AND status = 'pending'),
    'approvals_escalated', (SELECT count(*) FROM approval_requests WHERE organization_id = p_org AND requested_action IS NOT NULL AND status = 'pending' AND escalated_at IS NOT NULL),
    'agents_active', (SELECT count(*) FROM agents WHERE organization_id = p_org AND active)
  );
END $$;

-- Owner-granted recurring work. For each active grant of one of p_tools that
-- needs no approval, create (at most) one task per ISO week, assigned to the
-- granted agent. Duplicate-safe through the task dedupe key; every created
-- task goes through workforce_create_task and is recorded as an event.
CREATE OR REPLACE FUNCTION workforce_schedule_recurring(p_tools text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record; r jsonb; v_created int := 0; v_week text := to_char(now(), 'IYYY-"W"IW');
BEGIN
  PERFORM workforce_require_executor();
  FOR g IN
    SELECT p.organization_id, p.agent_id, p.tool, p.resource
    FROM workforce_agent_permissions p JOIN agents a ON a.id = p.agent_id AND a.active
    WHERE p.tool = ANY (COALESCE(p_tools, '{}')) AND p.resource <> '*'
      AND NOT p.requires_approval AND p.revoked_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > now())
  LOOP
    r := workforce_create_task(g.organization_id, g.agent_id,
      CASE g.tool WHEN 'site.audit' THEN 'Weekly site audit: ' || g.resource
                  WHEN 'report.write' THEN 'Weekly workforce report'
                  ELSE 'Weekly ' || g.tool || ': ' || g.resource END,
      g.tool, g.resource, 'Recurring weekly task created from an owner grant.', 'low',
      format('recurring:%s:%s:%s:%s', g.agent_id, g.tool, g.resource, v_week));
    IF (r ->> 'ok')::boolean THEN v_created := v_created + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'week', v_week);
END $$;

REVOKE EXECUTE ON FUNCTION
  workforce_next_tasks(int),
  workforce_requeue_stale(int, int),
  workforce_activity_summary(uuid, int),
  workforce_schedule_recurring(text[])
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  workforce_next_tasks(int),
  workforce_requeue_stale(int, int),
  workforce_activity_summary(uuid, int),
  workforce_schedule_recurring(text[])
TO service_role;
