-- sprint5_validation.sql
-- Behavioral validation for 08_sprint5_reservation_engine.sql.
-- Run AFTER: seed, 002, 02, 03, 06, 08.
-- Integer-only fixtures (no decimal literals) so the script stays byte-clean.

-- Sprint5 validation fixture: budget limits for the two seeded orgs
INSERT INTO ai_usage_limits (organization_id, monthly_budget, current_spend, reserved_amount, reset_date)
VALUES
  ('00000000-0000-0000-0000-000000000001', 100, 50, 0, date_trunc('month', current_date)),
  ('00000000-0000-0000-0000-000000000002', 200, 0, 0, date_trunc('month', current_date))
ON CONFLICT (organization_id) DO NOTHING;




DO $t1$
DECLARE v_id uuid; v_id2 uuid; v_ok boolean; v_reason text;
BEGIN
  SELECT * INTO v_id, v_ok, v_reason FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001', 30, 't1-key-1', '1 hour');
  IF NOT v_ok THEN RAISE EXCEPTION 'T1 fail first reserve: %', v_reason; END IF;

  SELECT * INTO v_id2, v_ok, v_reason FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001',  40, 't1-key-2', '1 hour');
	 IF v_ok THEN RAISE EXCEPTION 'T1 fail oversubscription'; END IF;

	 SELECT * INTO v_id2, v_ok, v_reason FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001',  15, 't1-key-3', '1 hour');
	 IF NOT v_ok THEN RAISE EXCEPTION 'T1 fail small reserve'; END IF;

	 SELECT * INTO v_id2, v_ok, v_reason FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001',  30, 't1-key-1', '1 hour');
	 IF NOT v_ok OR v_id2 IS DISTINCT FROM v_id THEN RAISE EXCEPTION 'T1 fail idempotent replay'; END IF;

	 IF (SELECT COALESCE(SUM(amount),0) FROM budget_reservations
       WHERE organization_id = '00000000-0000-0000-0000-000000000001'
         AND status = 'pending') <> 45 THEN
    RAISE EXCEPTION 'T1 fail pending total';
  END IF;
  RAISE NOTICE 'T1 PASS';
END;
$t1$;



DO $t2$
DECLARE v_id uuid; v_ok boolean; v_spend integer;
BEGIN
  SELECT id INTO v_id FROM budget_reservations
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND idempotency_key = 't1-key-1';
  v_ok := settle_reservation(v_id);
	if NOT v_ok THEN RAISE EXCEPTION 'T2 fail settle'; END IF;

	 SELECT current_spend INTO v_spend FROM ai_usage_limits
  WHERE organization_id = '00000000-0000-0000-0000-000000000001';
	 IF v_spend <>  80 THEN RAISE EXCEPTION 'T2 fail spend 80'; END IF;
	 IF (SELECT reserved_amount FROM ai_usage_limits
       WHERE organization_id = '00000000-0000-0000-0000-000000000001') <> 15 THEN
    RAISE EXCEPTION 'T2 fail reserved 15';
  END IF;
	if settle_reservation(v_id) THEN RAISE EXCEPTION 'T2 fail double settle'; END IF;
  RAISE NOTICE 'T2 PASS';
END;
$t2$;



DO $t3$
DECLARE v_id uuid; v_expired integer;
BEGIN
  SELECT * INTO v_id FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001',  5, 't3-key-expire', '1 hour');
	if NOT EXISTS (SELECT 1 FROM budget_reservations WHERE idempotency_key = 't3-key-expire') THEN RAISE EXCEPTION 'T3 fail no reserve'; END IF;

	 UPDATE budget_reservations SET expires_at = now() - interval '1 minute'
  WHERE idempotency_key = 't3-key-expire';

	 v_expired := expire_reservations('00000000-0000-0000-0000-000000000001');
	 IF v_expired <>  1 THEN RAISE EXCEPTION 'T3 fail count'; END IF;
	 IF (SELECT reserved_amount FROM ai_usage_limits
       WHERE organization_id = '00000000-0000-0000-0000-000000000001') <> 15 THEN
    RAISE EXCEPTION 'T3 fail refund';
  END IF;
	 IF EXISTS (SELECT 1 FROM budget_reservations
            WHERE idempotency_key = 't3-key-expire' AND status <> 'expired') THEN
    RAISE EXCEPTION 'T3 fail direct expiry';
  END IF;
	 v_expired := expire_reservations('00000000-0000-0000-0000-000000000001');
	 IF v_expired <>  0 THEN RAISE EXCEPTION 'T3 fail exactly once'; END IF;
	RAISE NOTICE 'T3 PASS';
END;
$t3$;



DO $t4$
DECLARE v_id uuid; v_ok boolean; v_reason text;
BEGIN
  UPDATE ai_usage_limits SET paused = true, pause_reason = 'Scheduled maintenance'
  WHERE organization_id = '00000000-0000-0000-0000-000000000001';

	 SELECT * INTO v_id, v_ok, v_reason FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001',  1, 't4-key', '1 hour');
	 IF v_ok OR v_reason IS DISTINCT FROM 'Scheduled maintenance' THEN RAISE EXCEPTION 'T4 fail kill switch'; END IF;
	if check_budget_available('00000000-0000-0000-0000-000000000001', 1) THEN RAISE EXCEPTION 'T4 fail paused check'; END IF;

	 UPDATE ai_usage_limits SET paused = false, pause_reason = NULL
  WHERE organization_id = '00000000-0000-0000-0000-000000000001';
	RAISE NOTICE 'T4 PASS';
END;
$t4$;



INSERT INTO autonomous_actions (
  organization_id, action_type, title, payload, authorization_level,
  execution_status, started_at, retry_count, max_retries
  ) VALUES
  ('00000000-0000-0000-0000-000000000001', 'create_task', 'stale-requeue', '{}'::jsonb, 'level_1', 'executing', now() - interval '2 hours',  0,  3),
  ('00000000-0000-0000-0000-000000000002', 'create_task', 'stale-fail', '{}'::jsonb, 'level_1', 'executing', now() - interval '2 hours',  3,  3);

INSERT INTO action_queue (organization_id, action_id, queue_status, processing_started_at)

SELECT '00000000-0000-0000-0000-000000000001', id, 'processing', now() - interval '2 hours'
FROM autonomous_actions WHERE title = 'stale-requeue';



DO $t5$
DECLARE v_recovered integer;
BEGIN
  v_recovered := recover_stale_jobs(interval '30 minutes');
	if v_recovered <>  3 THEN RAISE EXCEPTION 'T5 fail recover count'; END IF;
	if EXISTS (SELECT 1 FROM action_queue WHERE queue_status = 'processing') THEN RAISE EXCEPTION 'T5 fail queue requeue'; END IF;
	if NOT EXISTS (SELECT 1 FROM autonomous_actions WHERE title = 'stale-requeue' AND execution_status = 'queued' AND retry_count = 1) THEN RAISE EXCEPTION 'T5 fail action requeue'; END IF;
	if NOT EXISTS (SELECT 1 FROM autonomous_actions WHERE title = 'stale-fail' AND execution_status = 'failed') THEN RAISE EXCEPTION 'T5 fail action fail'; END IF;
	RAISE NOTICE 'T5 PASS';
END;
$t5$;



INSERT INTO organizational_knowledge (
  organization_id, knowledge_type, category, title, content, embeddings_pending
) VALUES
  ('00000000-0000-0000-0000-000000000002', 'finding', 'c', 'w1', 'alpha', true),
	 ('00000000-0000-0000-0000-000000000002', 'finding', 'c', 'w2', 'beta', true);



DO $t6$
DECLARE v_claimed integer;
BEGIN
  SELECT count(*) INTO v_claimed FROM claim_pending_embeddings('00000000-0000-0000-0000-000000000002', 2
);
	if v_claimed <>  2 THEN RAISE EXCEPTION 'T6 fail claim'; END IF;
	BEGIN
    INSERT INTO organizational_knowledge (
      organization_id, knowledge_type, category, title, content, embeddings_pending
    ) VALUES (
      '00000000-0000-0000-0000-000000000002', 'finding', 'c', 'w3', 'alpha', true
    );
    RAISE EXCEPTION 'T6 fail dedupe accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
	RAISE NOTICE 'T6 PASS';
END;
$t6$;



DO $t7$
BEGIN
  IF to_regclass('public.company_memory') IS NULL THEN RAISE EXCEPTION 'T7 fail company_memory'; END IF;
	if NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'approval_requests'
               AND column_name IN ('approval_status','decision_id','modified_at')) THEN
    RAISE EXCEPTION 'T7 fail approval columns';
  END IF;
	if NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_approval_requests_task') THEN RAISE EXCEPTION 'T7 fail task index'; END IF;
	INSERT INTO company_memory (organization_id, category, title, content)
  VALUES ('00000000-0000-0000-0000-000000000001', 'brand', 'name', 'Straight Flush Plumbing');
	RAISE NOTICE 'T7 PASS';
END;
$t7$;



DO $t8$
BEGIN
  SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  SET LOCAL ROLE authenticated;
	IF EXISTS (SELECT 1 FROM budget_reservations
           WHERE organization_id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'T8 fail org isolation';
  END IF;
	BEGIN
    PERFORM reserve_budget(
      '00000000-0000-0000-0000-000000000001', 10, 't8-key', '1 hour');
    RAISE EXCEPTION 'T8 fail cross org reserve';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
	END;
	RAISE NOTICE 'T8 PASS';
END;
$t8$;



-- T9: complete execution chain (decision -> approval -> action -> queue -> budget reservation -> worker claim -> engine execute -> settle -> audit -> result)
DO $t9$
DECLARE
  v_decision_id uuid;
  v_approval_id uuid;
  v_action_id uuid;
  v_queue_id uuid;
  v_res_id uuid;
  v_ok boolean;
  v_reason text;
  v_spend numeric;
  v_affected integer;
BEGIN
  INSERT INTO autonomous_decisions (
    organization_id, decision_type, title, description, reasoning,
    supporting_evidence, confidence_score, recommended_action, risk_level,
    approval_required, estimated_cost
  ) VALUES (
    '00000000-0000-0000-0000-000000000001', 'operational', 't9 decision', 'desc', 'reason',
    '{}'::jsonb, 0.90, 'execute create content', 'medium',
    true, 25
  ) RETURNING id INTO v_decision_id;

  INSERT INTO approval_requests (
    organization_id, decision_id, request_type, title, description,
    proposed_action, status, approval_status, approved_by, expires_at, response_deadline
  ) VALUES (
    '00000000-0000-0000-0000-000000000001', v_decision_id, 'execution', 't9 approval', 'desc',
    'create_content', 'approved', 'approved', 't9-approver', now()::timestamp + interval '1 day', now() + interval '1 day'
  ) RETURNING id INTO v_approval_id;

  IF NOT EXISTS (SELECT 1 FROM approval_requests WHERE id = v_approval_id AND approval_status = 'approved' AND status = 'approved') THEN
    RAISE EXCEPTION 'T9 fail approval precondition';
  END IF;

  INSERT INTO autonomous_actions (
    organization_id, decision_id, action_type, title, payload, authorization_level,
    execution_status, risk_level
  ) VALUES (
    '00000000-0000-0000-0000-000000000001', v_decision_id, 'create_content', 't9 action', '{}'::jsonb,
    'level_3', 'queued', 'medium'
  ) RETURNING id INTO v_action_id;

  INSERT INTO action_queue (organization_id, action_id, queue_status, priority)
  VALUES ('00000000-0000-0000-0000-000000000001', v_action_id, 'pending',  50;
  RETURNING id INTO v_queue_id;

  SELECT ok, reason, reservation_id INTO v_ok, v_reason, v_res_id
  FROM reserve_budget(
    '00000000-0000-0000-0000-000000000001',  25, 't9-chain-key', '2 hours'
  );
IF NOT v_ok THEN RAISE EXCEPTION 'T9 fail reserve: %', v_reason; END IF;

  -- Worker claim (atomic: only one worker wins the row)
 UPDATE action_queue
 SET queue_status = 'processing', processing_started_at = now()
 WHERE id = v_queue_id AND queue_status = 'pending';
 GET DIAGNOSTICS v_affected = ROW_COUNT;
 IF v_affected <> 1 THEN RAISE EXCEPTION 'T9 fail worker claim (%)', v_affected; END IF;

 -- Engine executes
 UPDATE autonomous_actions SET execution_status = 'executing', started_at = now() WHERE id = v_action_id;
 UPDATE autonomous_actions SET execution_status = 'completed', completed_at = now() WHERE id = v_action_id;
 UPDATE action_queue SET queue_status = 'completed', completed_at = now() WHERE id = v_queue_id;

 -- Settle (exactly-once;hold moves to spend)
 SELECT ok INTO v_ok FROM settle_reservation(v_res_id);
 IF NOT v_ok THEN RAISE EXCEPTION 'T9 fail settle'; END IF;

 -- Audit + result
 INSERT INTO ai_execution_logs (organization_id, provider, model, execution_time_ms, status)
 VALUES ('00000000-0000-0000-0000-000000000001', 'test', 't9-model',  12, 'success');
 INSERT INTO action_outcomes (organization_id, action_id, decision_id, outcome_type, description, measured_at)
 VALUES ('00000000-0000-0000-0000-000000000001', v_action_id, v_decision_id, 'success', 't9 outcome', now());

 SELECT current_spend INTO v_spend FROM ai_usage_limits WHERE organization_id = '00000000-0000-0000-0000-000000000001';
 IF NOT EXISTS (SELECT 1 FROM action_outcomes WHERE action_id = v_action_id AND outcome_type = 'success') THEN
   RAISE EXCEPTION 'T9 fail outcome';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ai_execution_logs WHERE organization_id = '00000000-0000-0000-0000-000000000001' AND status = 'success') THEN
   RAISE EXCEPTION 'T9 fail audit log';
 END IF;
 IF v_spend <> 25 THEN RAISE EXCEPTION 'T9 fail budget booked: %', v_spend; END IF;

 RAISE NOTICE 'T9 PASS';
END;
$t9$;

-- T10: pending approvals expire and audit
DO $t10$
DECLARE
  v_approval_id uuid;
  v_count integer;
BEGIN
  INSERT INTO approval_requests (
    organization_id, request_type, title, description, proposed_action,
    status, approval_status, expires_at, response_deadline
  ) VALUES (
    '00000000-0000-0000-0000-000000000002', 'execution', 't10 stale approval', 'desc', 'x',
    'pending', 'pending', now()::timestamp - interval '1 day', now() - interval '1 day'
  ) RETURNING id INTO v_approval_id;

  SELECT expire_approvals(interval '1 hour') INTO v_count;
  IF v_count < 1 THEN RAISE EXCEPTION 'T10 fail no expiry'; END IF;

 IF NOT EXISTS (SELECT 1 FROM approval_requests WHERE id = v_approval_id AND status = 'expired' AND approval_status = 'expired') THEN
    RAISE EXCEPTION 'T10 fail status not expired';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM activity_events WHERE organization_id = '00000000-0000-0000-0000-000000000002' AND event_type = 'approval_expired') THEN
    RAISE EXCEPTION 'T10 fail audit missing';
 END IF;

 RAISE NOTICE 'T10 PASS';
END;
$t10$;

-- =====================================================================
-- LIVE-SCHEMA COMPATIBILITY (Sprint 5.3 app integration)
-- =====================================================================
-- The live znpqosbwdgrtfediqvwt project evolved `budget_reservations`
-- past migration 08:
--   * Table columns: reserved_amount / settled_amount (not `amount`),
--     status vocabulary 'reserved' | 'settled' | 'released'
--     (not 'pending' | 'completed' | 'expired').
--   * New canonical engine functions exist (reserve_budget_idempotent,
--     settle_budget, settle_budget_clamped, release_budget,
--     release_stale_budget_reservations, check_budget_available).
--   * The classic set-of reserve_budget(uuid,numeric,text,interval) and
--     settle_reservation(uuid) from migration 08 were DRIFT-BROKEN against
--     the live schema.  Migration 09_fix_reserve_budget_drift.sql drops the
--     broken classic overload and re-creates it (plus settle_reservation)
--     speaking the live vocabulary, so T9/T10-style code works again.
-- Accounting note: the live engine does NOT decrement the org's
-- reserved_amount on settle/release (spend = sum of settled; reserved is a
-- hold watermark).  T9's `current_spend = 25` assertion is compatible.
-- =====================================================================
