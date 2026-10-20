-- tests/sql/workforce_delegation_test.sql
-- Delegated agent approval (migration 026). Same harness and preconditions as
-- workforce_phase_a_test.sql: LOCAL scratch database only.
\set ON_ERROR_STOP 1
\set VERBOSITY terse
SET client_min_messages = notice;

DROP TABLE IF EXISTS wf_test_ctx;
CREATE TABLE wf_test_ctx (k text PRIMARY KEY, v uuid);
GRANT SELECT, INSERT, UPDATE ON wf_test_ctx TO PUBLIC;  -- test harness only
CREATE OR REPLACE FUNCTION ctx(p text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM wf_test_ctx WHERE k = p $$;
CREATE OR REPLACE FUNCTION ctx_put(p text, val uuid) RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO wf_test_ctx VALUES (p, val) ON CONFLICT (k) DO UPDATE SET v = excluded.v RETURNING v $$;
CREATE OR REPLACE FUNCTION wf_check(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE OR REPLACE FUNCTION wf_expect_error(stmt text, pattern text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RAISE NOTICE 'PASS: %', label; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error: %)', label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (statement succeeded)', label;
END $$;
CREATE OR REPLACE FUNCTION wf_as(p_role text, p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', COALESCE(p_role, ''), false),
         set_config('request.jwt.claim.sub', COALESCE((SELECT v::text FROM wf_test_ctx WHERE k = p_user), ''), false);
$$;
-- Executor helper: create + claim a task, return the approval it raised.
CREATE OR REPLACE FUNCTION wf_gated(p_name text, p_agent text, p_tool text, p_resource text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_task uuid; r jsonb;
BEGIN
  v_task := (workforce_create_task(ctx('org'), ctx(p_agent), p_name, p_tool, p_resource) ->> 'task_id')::uuid;
  PERFORM ctx_put('task_' || p_name, v_task);
  r := workforce_claim_task(v_task, ctx(p_agent));
  RETURN (r ->> 'approval_id')::uuid;
END $$;
-- Executor helper: justify an approval as its requester.
CREATE OR REPLACE FUNCTION wf_justify(p_ap uuid, p_agent text, p_risk text, p_cost numeric) RETURNS jsonb LANGUAGE sql AS $$
  SELECT workforce_justify_approval(p_ap, ctx(p_agent),
    'Fixes missing title tags on service pages, which lowers click-through from Google.',
    'Higher organic click-through and more leak-detection calls.', p_risk, p_cost,
    'Revert the commit; previous titles are stored in the deliverable.')
$$;
GRANT EXECUTE ON FUNCTION ctx(text), wf_check(boolean, text), wf_expect_error(text, text, text) TO PUBLIC;

-- ---------------------------------------------------------------- fixtures (owner DB session)
SELECT ctx_put('org', gen_random_uuid()), ctx_put('u_owner', gen_random_uuid()), ctx_put('u_member', gen_random_uuid());
INSERT INTO auth.users (id) VALUES (ctx('u_owner')), (ctx('u_member'));
INSERT INTO organizations (id, name, slug) VALUES (ctx('org'), 'Delegation Test Org', 'deleg-' || ctx('org'));
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  (ctx('org'), ctx('u_owner'), 'owner'), (ctx('org'), ctx('u_member'), 'member');
INSERT INTO agents (id, organization_id, name, role) VALUES
  (ctx_put('seo', gen_random_uuid()),   ctx('org'), 'SEO Lead',     'SEO'),
  (ctx_put('qa', gen_random_uuid()),    ctx('org'), 'QA Reviewer',  'Security and Quality Assurance'),
  (ctx_put('rogue', gen_random_uuid()), ctx('org'), 'Other Agent',  'Content'),
  (ctx_put('nogrant', gen_random_uuid()), ctx('org'), 'Delegate Without Access', 'Operations');

SELECT workforce_grant_permission(ctx('seo'), 'website.edit', 'site:main', true);
SELECT workforce_grant_permission(ctx('seo'), 'ads.budget', 'google-ads', true);
SELECT workforce_grant_permission(ctx('seo'), 'content.publish', 'blog', true);
SELECT workforce_grant_permission(ctx('qa'),  'website.edit', 'site:main', false);
SELECT workforce_grant_permission(ctx('qa'),  'ads.budget', 'google-ads', false);
SELECT workforce_grant_permission(ctx('qa'),  'content.publish', 'blog', false);
SELECT workforce_grant_permission(ctx('seo'), 'website.edit', 'site:staging', true);

-- ================================================================ D1 configuration is owner-only
SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_expect_error($$SELECT workforce_grant_approval_delegation(ctx('qa'), 'website.edit', 'site:main', 'low', 50)$$,
                       'permission denied', 'D1a an agent (service role) cannot grant approval authority');
SELECT wf_expect_error($$SELECT workforce_set_action_policy(ctx('org'), 'website.edit', 'site:main', 'low', false, 'website')$$,
                       'permission denied', 'D1b an agent cannot set action policies');
SELECT wf_expect_error(format($$INSERT INTO workforce_approval_delegations (organization_id, delegate_agent_id, tool) VALUES (%L, %L, 'website.edit')$$, ctx('org'), ctx('qa')),
                       'permission denied|WORKFORCE_FORBIDDEN', 'D1c an agent cannot insert a delegation directly');
RESET ROLE; SELECT wf_as('authenticated', 'u_member'); SET ROLE authenticated;
SELECT wf_expect_error($$SELECT workforce_grant_approval_delegation(ctx('qa'), 'website.edit', 'site:main', 'low', 50)$$,
                       'only an owner or admin', 'D1d an ordinary member cannot grant approval authority');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_expect_error($$SELECT workforce_set_action_policy(ctx('org'), 'ads.budget', 'google-ads', 'low', false, 'spending')$$,
                       'sensitive_owner_only', 'D1e spending actions can never be made delegable');
SELECT wf_expect_error($$SELECT workforce_grant_approval_delegation(ctx('qa'), 'website.edit', 'site:main', 'high', 50)$$,
                       'max_risk', 'D1f agents can never be given high-risk approval authority');
SELECT wf_check((workforce_set_action_policy(ctx('org'), 'website.edit', 'site:main', 'low', false, 'website') ->> 'ok')::boolean,
                'D1g owner sets a delegable website policy');
SELECT workforce_set_action_policy(ctx('org'), 'ads.budget', 'google-ads', 'medium', true, 'spending');
SELECT ctx_put('del_qa', (workforce_grant_approval_delegation(ctx('qa'), 'website.edit', 'site:main', 'low', 50) ->> 'delegation_id')::uuid);
SELECT workforce_grant_approval_delegation(ctx('qa'), 'ads.budget', 'google-ads', 'low', 50);
SELECT workforce_grant_approval_delegation(ctx('qa'), 'content.publish', 'blog', 'low', 50);
SELECT workforce_grant_approval_delegation(ctx('nogrant'), 'website.edit', 'site:main', 'low', 50);
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE organization_id = ctx('org') AND event_type = 'workforce.delegation_granted'
                        AND actor_id = ctx('u_owner')),
                'D1h delegation grants are recorded with the owner as actor');

-- ================================================================ D2 business case required
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT ctx_put('ap1', wf_gated('fix_titles', 'seo', 'website.edit', 'site:main'));
SELECT wf_check(ctx('ap1') IS NOT NULL, 'D2a gated task raises an approval request');
SELECT wf_check((SELECT r ->> 'detail' = 'business_case_missing'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap1'), ctx('qa'), 'approved', 'Looks fine to me.') r) s),
                'D2b approval without a business case is escalated, not approved');
SELECT wf_check((SELECT status = 'pending' AND escalation_reason = 'business_case_missing' FROM approval_requests WHERE id = ctx('ap1')),
                'D2c escalated request stays pending for the owner');
SELECT wf_check((SELECT r ->> 'reason' = 'not_requester' FROM (SELECT wf_justify(ctx('ap1'), 'qa', 'low', 10) r) s),
                'D2d only the requesting agent can submit the business case');
SELECT wf_expect_error($$SELECT workforce_justify_approval(ctx('ap1'), ctx('seo'), 'helps', 'more calls please', 'low', 1, 'revert')$$,
                       'INVALID_JUSTIFICATION', 'D2e a thin justification is rejected');
SELECT wf_check((wf_justify(ctx('ap1'), 'seo', 'low', 10) ->> 'ok')::boolean, 'D2f requester submits a full business case');

-- ================================================================ D3 no self-authorization
SELECT wf_check((SELECT r ->> 'reason' = 'self_approval_forbidden'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap1'), ctx('seo'), 'approved', 'I approve my own change.') r) s),
                'D3a an agent cannot approve its own request');
SELECT wf_check((SELECT status = 'pending' FROM approval_requests WHERE id = ctx('ap1')), 'D3b self-approval leaves the request pending');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE event_type = 'workforce.approval_review_denied'
                        AND metadata ->> 'reason' = 'self_approval_forbidden'),
                'D3c the refused self-approval is recorded');
SELECT wf_check((SELECT r ->> 'detail' = 'no_delegated_authority'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap1'), ctx('rogue'), 'approved', 'Approving outside my scope.') r) s),
                'D3d an agent without delegated authority cannot approve');
SELECT wf_check((SELECT r ->> 'detail' = 'reviewer_lacks_permission'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap1'), ctx('nogrant'), 'approved', 'Delegated but no own access.') r) s),
                'D3e a delegate cannot approve an action it holds no permission for');
SELECT wf_expect_error($$SELECT workforce_decide_approval(ctx('ap1'), 'approved')$$,
                       'permission denied', 'D3f agents cannot use the owner decision path');

-- ================================================================ D4 delegated approval inside scope
SELECT wf_check((workforce_agent_review_approval(ctx('ap1'), ctx('qa'), 'approved',
                 'Checked diff: title tags only, no layout or tracking changes.') ->> 'ok')::boolean,
                'D4a delegate approves a low-risk, low-cost, justified action');
SELECT wf_check((SELECT status = 'approved' AND decided_by_type = 'agent' AND reviewed_by_agent_id = ctx('qa')
                        AND approved_under_delegation_id = ctx('del_qa') AND effective_risk = 'low'
                 FROM approval_requests WHERE id = ctx('ap1')),
                'D4b approval records reviewer, delegation and risk');
SELECT wf_check((SELECT metadata ->> 'business_justification' IS NOT NULL AND metadata ->> 'delegation_id' = ctx('del_qa')::text
                        AND metadata ->> 'rollback_plan' IS NOT NULL AND metadata ->> 'decision' = 'approved'
                        AND actor_id = ctx('qa')
                 FROM activity_events WHERE event_type = 'workforce.approval_decided' AND metadata ->> 'approval_id' = ctx('ap1')::text),
                'D4c audit event holds reviewer, permission used, justification, risk, decision, rollback');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('task_fix_titles')) = 'queued', 'D4d task is released');
SELECT wf_check((workforce_claim_task(ctx('task_fix_titles'), ctx('seo')) ->> 'ok')::boolean, 'D4e requester can now claim');
SELECT wf_check((workforce_authorize_action(ctx('task_fix_titles'), ctx('seo'), 'website.edit', 'site:main') ->> 'ok')::boolean,
                'D4f action is authorized at execution time');
SELECT wf_check((SELECT r ->> 'reason' = 'not_assignee'
                 FROM (SELECT workforce_authorize_action(ctx('task_fix_titles'), ctx('rogue'), 'website.edit', 'site:main') r) s),
                'D4g the approval does not let another agent act');

-- ================================================================ D5 revocation re-checked at execution time
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_check((workforce_revoke_approval_delegation(ctx('del_qa')) ->> 'ok')::boolean, 'D5a owner revokes the delegation');
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'approval_required'
                 FROM (SELECT workforce_authorize_action(ctx('task_fix_titles'), ctx('seo'), 'website.edit', 'site:main') r) s),
                'D5b approval granted under a revoked delegation no longer authorizes execution');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT ctx_put('del_qa', (workforce_grant_approval_delegation(ctx('qa'), 'website.edit', 'site:main', 'low', 50) ->> 'delegation_id')::uuid);

-- ================================================================ D6 risk-based escalation
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT ctx_put('ap_cost', wf_gated('big_change', 'seo', 'website.edit', 'site:main'));
SELECT wf_justify(ctx('ap_cost'), 'seo', 'low', 120);
SELECT wf_check((SELECT r ->> 'detail' = 'cost_exceeds_authority'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap_cost'), ctx('qa'), 'approved', 'Value is clear, approving.') r) s),
                'D6a cost above the delegated limit is escalated');
SELECT ctx_put('ap_risk', wf_gated('risky_change', 'seo', 'website.edit', 'site:main'));
SELECT wf_justify(ctx('ap_risk'), 'seo', 'high', 5);
SELECT wf_check((SELECT r ->> 'detail' = 'risk_exceeds_authority'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap_risk'), ctx('qa'), 'approved', 'Value is clear, approving.') r) s),
                'D6b declared high risk is escalated');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT workforce_set_action_policy(ctx('org'), 'website.edit', 'site:main', 'medium', false, 'website');
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT ctx_put('ap_floor', wf_gated('lowball', 'seo', 'website.edit', 'site:main'));
SELECT wf_justify(ctx('ap_floor'), 'seo', 'low', 5);
SELECT wf_check((SELECT r ->> 'detail' = 'risk_exceeds_authority'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap_floor'), ctx('qa'), 'approved', 'Value is clear, approving.') r) s),
                'D6c the owner''s risk floor overrides a lowballed risk declaration');
SELECT wf_check((SELECT effective_risk = 'medium' FROM approval_requests WHERE id = ctx('ap_floor')), 'D6d effective risk is recorded');
SELECT ctx_put('ap_ads', wf_gated('raise_budget', 'seo', 'ads.budget', 'google-ads'));
SELECT wf_justify(ctx('ap_ads'), 'seo', 'low', 5);
SELECT wf_check((SELECT r ->> 'detail' = 'owner_only_action'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap_ads'), ctx('qa'), 'approved', 'Small budget bump, approving.') r) s),
                'D6e advertising spend is owner-only even with a delegation');
SELECT ctx_put('ap_nopol', wf_gated('publish_post', 'seo', 'content.publish', 'blog'));
SELECT wf_justify(ctx('ap_nopol'), 'seo', 'low', 0);
SELECT wf_check((SELECT r ->> 'detail' = 'no_policy_for_action'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap_nopol'), ctx('qa'), 'approved', 'Blog post reviewed, approving.') r) s),
                'D6f actions without an owner policy cannot be agent-approved (fail safe)');
SELECT ctx_put('ap_scope', wf_gated('staging_edit', 'seo', 'website.edit', 'site:staging'));
SELECT wf_justify(ctx('ap_scope'), 'seo', 'low', 0);
SELECT wf_check((SELECT (r ->> 'reason') IN ('escalated') FROM (SELECT workforce_agent_review_approval(ctx('ap_scope'), ctx('qa'), 'approved', 'Staging only, approving.') r) s),
                'D6g a delegation for site:main does not cover site:staging');
SELECT wf_check((SELECT count(*) = 6 FROM activity_events WHERE organization_id = ctx('org') AND event_type = 'workforce.approval_escalated'
                        AND metadata ->> 'reason' IN ('business_case_missing', 'cost_exceeds_authority', 'risk_exceeds_authority', 'owner_only_action', 'no_policy_for_action', 'no_delegated_authority', 'reviewer_lacks_permission')
                        AND metadata ->> 'approval_id' <> ctx('ap1')::text),
                'D6h every escalation is recorded with its reason');

-- ================================================================ D7 owner still decides escalations
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_check((workforce_decide_approval(ctx('ap_ads'), 'approved', 'OK for this week') ->> 'ok')::boolean, 'D7a owner approves an escalated request');
SELECT wf_check((SELECT decided_by_type = 'owner' AND status = 'approved' FROM approval_requests WHERE id = ctx('ap_ads')),
                'D7b owner decision is marked as an owner decision');
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((workforce_agent_review_approval(ctx('ap_risk'), ctx('qa'), 'rejected', 'Risk too high for the benefit described.') ->> 'reason') = 'escalated',
                'D7c a delegate cannot even reject outside its authority; it escalates');
SELECT wf_check((SELECT r ->> 'reason' = 'already_decided'
                 FROM (SELECT workforce_agent_review_approval(ctx('ap_ads'), ctx('qa'), 'rejected', 'Second opinion, rejecting.') r) s),
                'D7d an agent cannot overturn the owner''s decision');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_expect_error(format($$UPDATE approval_requests SET decided_by_type = 'agent' WHERE id = %L$$, ctx('ap_ads')),
                       'APPROVAL_FORBIDDEN', 'D7e decision records cannot be rewritten');

-- ---------------------------------------------------------------- cleanup
RESET ROLE; SELECT wf_as(NULL, NULL);
DELETE FROM organizations WHERE id = ctx('org');
DELETE FROM auth.users WHERE id IN (ctx('u_owner'), ctx('u_member'));
DROP FUNCTION wf_check(boolean, text), wf_expect_error(text, text, text), wf_as(text, text),
              wf_gated(text, text, text, text), wf_justify(uuid, text, text, numeric), ctx_put(text, uuid), ctx(text);
DROP TABLE wf_test_ctx;
\echo 'WORKFORCE DELEGATION: ALL CHECKS PASSED'
