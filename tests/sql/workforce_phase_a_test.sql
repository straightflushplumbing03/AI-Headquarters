-- tests/sql/workforce_phase_a_test.sql
-- Phase A enforcement tests. Run against a LOCAL scratch database that has
-- tests/sql/supabase_shim.sql and all migrations applied
-- (scripts/apply-migrations-local.sh). Every check prints "PASS: ..." and any
-- failure aborts with "FAIL: ...". Roles are switched with SET ROLE so RLS,
-- grants and triggers behave exactly as they do for Supabase API callers.
\set ON_ERROR_STOP 1
\set VERBOSITY terse
SET client_min_messages = notice;

-- ---------------------------------------------------------------- harness
DROP TABLE IF EXISTS wf_test_ctx;
CREATE TABLE wf_test_ctx (k text PRIMARY KEY, v uuid);
GRANT SELECT, INSERT, UPDATE ON wf_test_ctx TO PUBLIC;  -- test harness only

CREATE OR REPLACE FUNCTION ctx(p text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT v FROM wf_test_ctx WHERE k = p $$;
CREATE OR REPLACE FUNCTION ctx_put(p text, val uuid) RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO wf_test_ctx VALUES (p, val) ON CONFLICT (k) DO UPDATE SET v = excluded.v RETURNING v $$;

CREATE OR REPLACE FUNCTION wf_check(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END $$;

-- Runs a statement as the current role and asserts it fails with a message
-- matching the pattern.
CREATE OR REPLACE FUNCTION wf_expect_error(stmt text, pattern text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* pattern THEN RAISE NOTICE 'PASS: %', label; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error: %)', label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (statement succeeded)', label;
END $$;

-- Switches the JWT claims; follow with SET ROLE <role>.
CREATE OR REPLACE FUNCTION wf_as(p_role text, p_user text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.role', COALESCE(p_role, ''), false),
         set_config('request.jwt.claim.sub', COALESCE((SELECT v::text FROM wf_test_ctx WHERE k = p_user), ''), false);
$$;
GRANT EXECUTE ON FUNCTION ctx(text), wf_check(boolean, text), wf_expect_error(text, text, text) TO PUBLIC;

-- ---------------------------------------------------------------- fixtures (internal owner session)
SELECT ctx_put('orgA', gen_random_uuid()), ctx_put('orgB', gen_random_uuid()),
       ctx_put('u_owner', gen_random_uuid()), ctx_put('u_member', gen_random_uuid()),
       ctx_put('u_outsider', gen_random_uuid());
INSERT INTO auth.users (id) SELECT v FROM wf_test_ctx WHERE k LIKE 'u_%';
INSERT INTO organizations (id, name, slug) VALUES
  (ctx('orgA'), 'Straight Flush Test A', 'sf-test-a-' || ctx('orgA')),
  (ctx('orgB'), 'Other Org B', 'sf-test-b-' || ctx('orgB'));
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  (ctx('orgA'), ctx('u_owner'), 'owner'),
  (ctx('orgA'), ctx('u_member'), 'member'),
  (ctx('orgB'), ctx('u_outsider'), 'owner');
INSERT INTO agents (id, organization_id, name, role) VALUES
  (ctx_put('seo', gen_random_uuid()), ctx('orgA'), 'SEO Lead', 'SEO and Search Intelligence'),
  (ctx_put('junior', gen_random_uuid()), ctx('orgA'), 'Content Junior', 'Marketing and Content Studio'),
  (ctx_put('agentB', gen_random_uuid()), ctx('orgB'), 'Other Agent', 'Other');

-- Grants are made by an owner session; SEO may write reports freely and may
-- deploy only with approval. The junior agent has no grants at all.
SELECT workforce_grant_permission(ctx('seo'), 'report.write', '*', false);
SELECT ctx_put('deploy_grant', (workforce_grant_permission(ctx('seo'), 'website.deploy', 'site:main', true) ->> 'permission_id')::uuid);

-- ================================================================ 1. valid task creation
SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT ctx_put('t_report', (r ->> 'task_id')::uuid) FROM (
  SELECT workforce_create_task(ctx('orgA'), ctx('seo'), 'Weekly SEO report', 'report.write', 'reports/weekly',
                               'Summarise rankings', 'high', 'seo-report:2026-W43') r) s;
SELECT wf_check(ctx('t_report') IS NOT NULL, '1a owner creates a task through workforce_create_task');
SELECT wf_check((SELECT status = 'queued' AND assigned_by_type = 'user' AND assigned_by_id = ctx('u_owner')
                        AND required_tool = 'report.write' FROM tasks WHERE id = ctx('t_report')),
                '1b task is queued and records the real assigner');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_report') AND event_type = 'workforce.task_created'),
                '1c task creation is recorded as an event');
SELECT wf_expect_error($$SELECT workforce_create_task(ctx('orgA'), ctx('seo'), '  ', 'report.write')$$,
                       'title is required', '1d blank title is rejected');
SELECT wf_expect_error($$SELECT workforce_create_task(ctx('orgA'), ctx('seo'), 'No tool', '')$$,
                       'required_tool', '1e task without a declared tool is rejected (deny by default)');
SELECT wf_expect_error($$SELECT workforce_create_task(ctx('orgA'), ctx('agentB'), 'Wrong org agent', 'report.write')$$,
                       'not an active agent of this organization', '1f assignee must belong to the organization');

-- ================================================================ 2. duplicate prevention
SELECT wf_check((SELECT r ->> 'reason' = 'duplicate' AND (r ->> 'task_id')::uuid = ctx('t_report')
                 FROM (SELECT workforce_create_task(ctx('orgA'), ctx('seo'), 'Weekly SEO report again', 'report.write',
                       'reports/weekly', NULL, 'high', 'seo-report:2026-W43') r) s),
                '2a same dedupe key returns the existing open task');
SELECT wf_check((SELECT count(*) = 1 FROM tasks WHERE organization_id = ctx('orgA') AND dedupe_key = 'seo-report:2026-W43'),
                '2b only one task exists for the dedupe key');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_report') AND event_type = 'workforce.task_duplicate_rejected'),
                '2c rejected duplicate is recorded');
SELECT wf_expect_error(format($$INSERT INTO tasks (organization_id, agent_id, title, dedupe_key) VALUES (%L, %L, 'raw dup', 'seo-report:2026-W43')$$,
                              ctx('orgA'), ctx('seo')),
                       'duplicate key|unique', '2d direct insert with the same key is blocked by the unique index');

-- ================================================================ 3. status transitions
SELECT wf_expect_error(format($$UPDATE tasks SET status = 'completed' WHERE id = %L$$, ctx('t_report')),
                       'TASK_TRANSITION_REJECTED', '3a queued -> completed is rejected');
SELECT wf_expect_error(format($$UPDATE tasks SET status = 'working' WHERE id = %L$$, ctx('t_report')),
                       'must go through the workforce engine', '3b an admin cannot start work by editing the row');
SELECT wf_expect_error(format($$UPDATE tasks SET required_tool = 'website.deploy' WHERE id = %L$$, ctx('t_report')),
                       'TASK_FIELD_PROTECTED', '3c scope fields cannot be changed after creation');
SELECT ctx_put('t_cancel', (workforce_create_task(ctx('orgA'), ctx('seo'), 'Throwaway', 'report.write', 'reports/x') ->> 'task_id')::uuid);
SELECT wf_check((workforce_transition_task(ctx('t_cancel'), 'cancelled', 'not needed') ->> 'ok')::boolean,
                '3d queued -> cancelled is allowed');
SELECT wf_expect_error($$SELECT workforce_transition_task(ctx('t_cancel'), 'queued')$$,
                       'not an allowed transition', '3e cancelled -> queued is rejected');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_cancel') AND event_type = 'workforce.task_status_changed'
                        AND metadata ->> 'to' = 'cancelled' AND actor_id = ctx('u_owner')),
                '3f status change is recorded with the acting user');
RESET ROLE; SELECT wf_as(NULL, NULL);

-- ================================================================ 4. dependencies
SELECT ctx_put('t_dep_parent', (workforce_create_task(ctx('orgA'), ctx('seo'), 'Crawl site', 'report.write', 'reports/crawl') ->> 'task_id')::uuid);
SELECT ctx_put('t_dep_child', (workforce_create_task(ctx('orgA'), ctx('seo'), 'Report on crawl', 'report.write', 'reports/crawl-summary',
                                                     NULL, 'medium', NULL, ARRAY[ctx('t_dep_parent')]) ->> 'task_id')::uuid);
SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'dependencies_incomplete' FROM (SELECT workforce_claim_task(ctx('t_dep_child'), ctx('seo')) r) s),
                '4a task with an incomplete dependency cannot be claimed');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('t_dep_child')) = 'queued', '4b blocked claim leaves the task queued');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_dep_child') AND event_type = 'workforce.claim_denied'
                        AND metadata ->> 'reason' = 'dependencies_incomplete'),
                '4c dependency denial is recorded');
-- finish the parent, then the child becomes claimable
SELECT workforce_claim_task(ctx('t_dep_parent'), ctx('seo'));
SELECT ctx_put('auth_parent', (workforce_authorize_action(ctx('t_dep_parent'), ctx('seo'), 'report.write', 'reports/crawl') ->> 'authorization_event_id')::uuid);
SELECT workforce_record_tool_result(ctx('t_dep_parent'), ctx('seo'), ctx('auth_parent'), true, '{}'::jsonb, 0.01);
SELECT workforce_complete_task(ctx('t_dep_parent'), ctx('seo'), 'completed', 'crawl done');
SELECT wf_check((workforce_claim_task(ctx('t_dep_child'), ctx('seo')) ->> 'ok')::boolean,
                '4d task is claimable once its dependency is completed');

-- ================================================================ 5. unauthorized tool execution
RESET ROLE; SELECT wf_as(NULL, NULL);
SELECT ctx_put('t_junior', (workforce_create_task(ctx('orgA'), ctx('junior'), 'Draft blog post', 'report.write', 'reports/blog') ->> 'task_id')::uuid);
SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'permission_denied' FROM (SELECT workforce_claim_task(ctx('t_junior'), ctx('junior')) r) s),
                '5a agent without a grant cannot claim the task');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('t_junior')) = 'queued', '5b denied task is not started');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_junior') AND event_type = 'workforce.permission_denied'
                        AND metadata ->> 'reason' = 'no_grant'),
                '5c permission denial is recorded');
SELECT wf_check((SELECT r ->> 'reason' = 'permission_denied'
                 FROM (SELECT workforce_authorize_action(ctx('t_dep_child'), ctx('seo'), 'email.send', 'customer:*') r) s),
                '5d a working agent is denied a tool it was never granted');
SELECT wf_check((SELECT r ->> 'reason' = 'not_assignee'
                 FROM (SELECT workforce_authorize_action(ctx('t_dep_child'), ctx('junior'), 'report.write', 'reports/crawl-summary') r) s),
                '5e an agent cannot act on a task assigned to another agent');
SELECT wf_expect_error(format($$INSERT INTO workforce_agent_permissions (organization_id, agent_id, tool) VALUES (%L, %L, 'report.write')$$,
                              ctx('orgA'), ctx('junior')),
                       'permission denied|WORKFORCE_FORBIDDEN', '5f the service role cannot write grants directly');
SELECT wf_expect_error($$SELECT workforce_grant_permission(ctx('junior'), 'report.write')$$,
                       'permission denied', '5g the service role (agents) cannot call the grant function');

-- ================================================================ 6. approval required before execution
RESET ROLE; SELECT wf_as(NULL, NULL);
SELECT ctx_put('t_deploy', (workforce_create_task(ctx('orgA'), ctx('seo'), 'Deploy title-tag fix', 'website.deploy', 'site:main') ->> 'task_id')::uuid);
SELECT wf_check((SELECT approval_required FROM tasks WHERE id = ctx('t_deploy')), '6a task is flagged as needing approval');
SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'approval_required' FROM (SELECT workforce_claim_task(ctx('t_deploy'), ctx('seo')) r) s),
                '6b approval-gated task cannot be claimed before approval');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('t_deploy')) = 'waiting_approval', '6c task moves to waiting_approval');
SELECT ctx_put('ap1', (SELECT id FROM approval_requests WHERE task_id = ctx('t_deploy') AND status = 'pending'));
SELECT wf_check(ctx('ap1') IS NOT NULL, '6d one pending approval request is recorded');
SELECT workforce_claim_task(ctx('t_deploy'), ctx('seo'));
SELECT wf_check((SELECT count(*) = 1 FROM approval_requests WHERE task_id = ctx('t_deploy')), '6e retrying the claim does not duplicate the request');
SELECT wf_expect_error($$SELECT workforce_decide_approval(ctx('ap1'), 'approved')$$,
                       'permission denied', '6f the service role (agents) cannot approve');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_expect_error(format($$UPDATE tasks SET status = 'queued' WHERE id = %L$$, ctx('t_deploy')),
                       'must go through the workforce engine', '6g UI-style release (waiting_approval -> queued) is rejected');
SELECT wf_expect_error(format($$UPDATE approval_requests SET status = 'approved', approval_status = 'approved' WHERE id = %L$$, ctx('ap1')),
                       'APPROVAL_FORBIDDEN', '6h approval cannot be forged by editing the row');
RESET ROLE; SELECT wf_as('authenticated', 'u_member'); SET ROLE authenticated;
SELECT wf_check((SELECT r ->> 'reason' = 'forbidden' FROM (SELECT workforce_decide_approval(ctx('ap1'), 'approved') r) s),
                '6i an ordinary member cannot approve');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_check((workforce_decide_approval(ctx('ap1'), 'approved', 'Looks right') ->> 'ok')::boolean, '6j owner approves');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('t_deploy')) = 'queued', '6k approval releases the task to queued');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_deploy') AND event_type = 'workforce.approval_decided'
                        AND actor_id = ctx('u_owner')),
                '6l the decision is recorded with the owner as actor');
SELECT wf_check(EXISTS (SELECT 1 FROM activity_events WHERE task_id = ctx('t_deploy') AND event_type = 'workforce.approval_decision_denied'),
                '6m the member''s refused decision is recorded');

-- ================================================================ 7. approval re-checked at execution time
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((workforce_claim_task(ctx('t_deploy'), ctx('seo')) ->> 'ok')::boolean, '7a approved task can be claimed');
SELECT wf_check((workforce_authorize_action(ctx('t_deploy'), ctx('seo'), 'website.deploy', 'site:main') ->> 'ok')::boolean,
                '7b approved action is authorized');
SELECT wf_check((SELECT r ->> 'reason' = 'permission_denied'
                 FROM (SELECT workforce_authorize_action(ctx('t_deploy'), ctx('seo'), 'website.deploy', 'site:staging') r) s),
                '7c grant and approval for site:main do not cover another resource');
RESET ROLE; SELECT wf_as(NULL, NULL);
-- The approval expires mid-run; the next action needs a fresh decision.
UPDATE approval_requests SET expires_at = now() - interval '1 minute' WHERE id = ctx('ap1');
SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'approval_required'
                 FROM (SELECT workforce_authorize_action(ctx('t_deploy'), ctx('seo'), 'website.deploy', 'site:main') r) s),
                '7d expired approval is rejected at execution time');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('t_deploy')) = 'waiting_approval', '7e task returns to waiting_approval');
-- Approve again, then revoke the grant: execution must stop even though approval exists.
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT workforce_decide_approval((SELECT id FROM approval_requests WHERE task_id = ctx('t_deploy') AND status = 'pending'), 'approved');
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((workforce_claim_task(ctx('t_deploy'), ctx('seo')) ->> 'ok')::boolean, '7f re-approved task is claimed again');
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_check((workforce_revoke_permission(ctx('deploy_grant')) ->> 'ok')::boolean, '7g owner revokes the deploy grant');
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'permission_denied'
                 FROM (SELECT workforce_authorize_action(ctx('t_deploy'), ctx('seo'), 'website.deploy', 'site:main') r) s),
                '7h approved action is denied after the grant is revoked');

-- ================================================================ 8. no permission inheritance from the assigner
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT ctx_put('t_owner_assigned', (workforce_create_task(ctx('orgA'), ctx('junior'), 'Deploy as junior', 'website.deploy', 'site:main') ->> 'task_id')::uuid);
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((SELECT r ->> 'reason' = 'permission_denied' FROM (SELECT workforce_claim_task(ctx('t_owner_assigned'), ctx('junior')) r) s),
                '8a a task assigned by the owner does not give the agent the owner''s access');
SELECT ctx_put('t_agent_assigned', (workforce_create_task(ctx('orgA'), ctx('junior'), 'Report delegated by SEO lead', 'report.write',
                                                          'reports/delegated', NULL, 'medium', NULL, '{}', NULL, ctx('seo')) ->> 'task_id')::uuid);
SELECT wf_check((SELECT assigned_by_type = 'agent' AND assigned_by_id = ctx('seo') FROM tasks WHERE id = ctx('t_agent_assigned')),
                '8b agent-to-agent assignment is recorded');
SELECT wf_check((SELECT r ->> 'reason' = 'permission_denied' FROM (SELECT workforce_claim_task(ctx('t_agent_assigned'), ctx('junior')) r) s),
                '8c the junior does not inherit the assigning agent''s grant');

-- ================================================================ 9. event history is append-only
RESET ROLE; SELECT wf_as('authenticated', 'u_owner'); SET ROLE authenticated;
SELECT wf_expect_error($$UPDATE activity_events SET title = 'rewritten' WHERE organization_id = ctx('orgA')$$,
                       'permission denied', '9a owner cannot edit events');
SELECT wf_expect_error($$DELETE FROM activity_events WHERE organization_id = ctx('orgA')$$,
                       'permission denied', '9b owner cannot delete events');
SELECT wf_expect_error(format($$INSERT INTO activity_events (organization_id, event_type, title) VALUES (%L, 'workforce.task_claimed', 'fake work')$$, ctx('orgA')),
                       'EVENT_FORBIDDEN', '9c clients cannot fabricate workforce events');
INSERT INTO activity_events (organization_id, event_type, title, metadata)
VALUES (ctx('orgA'), 'note_added', 'legacy client event', '{"api_key":"sk-abcdefghijklmnop","nested":{"password":"x","count":3},"tokens_output":12}');
SELECT wf_check((SELECT metadata ->> 'api_key' = '[redacted]' AND metadata #>> '{nested,password}' = '[redacted]'
                        AND metadata #>> '{nested,count}' = '3' AND metadata ->> 'tokens_output' = '12'
                 FROM activity_events WHERE title = 'legacy client event'),
                '9d secrets are stripped from event metadata, ordinary fields kept');
RESET ROLE; SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_expect_error($$UPDATE activity_events SET title = 'rewritten' WHERE organization_id = ctx('orgA')$$,
                       'permission denied', '9e service role cannot edit events');
RESET ROLE; SELECT wf_as(NULL, NULL);
SELECT wf_expect_error($$UPDATE activity_events SET title = 'rewritten' WHERE organization_id = ctx('orgA')$$,
                       'EVENT_IMMUTABLE', '9f even the database owner cannot rewrite events');
SELECT wf_expect_error($$DELETE FROM activity_events WHERE organization_id = ctx('orgA')$$,
                       'EVENT_IMMUTABLE', '9g even the database owner cannot delete events');

-- ================================================================ 10. deliverables
SELECT wf_as('service_role', NULL); SET ROLE service_role;
SELECT wf_check((workforce_claim_task(ctx('t_report'), ctx('seo')) ->> 'ok')::boolean, '10a report task claimed');
SELECT ctx_put('auth_report', (workforce_authorize_action(ctx('t_report'), ctx('seo'), 'report.write', 'reports/weekly') ->> 'authorization_event_id')::uuid);
SELECT wf_check((workforce_record_tool_result(ctx('t_report'), ctx('seo'), ctx('auth_report'), true,
                 '{"pages": 12, "authorization": "Bearer abc.def"}'::jsonb, 0.0425) ->> 'ok')::boolean,
                '10b tool result recorded against its authorization');
SELECT wf_check((workforce_record_tool_result(ctx('t_report'), ctx('seo'), ctx('auth_report'), true) ->> 'duplicate')::boolean,
                '10c retried result is not recorded twice');
SELECT wf_check((SELECT r ->> 'reason' = 'no_matching_authorization'
                 FROM (SELECT workforce_record_tool_result(ctx('t_report'), ctx('seo'), gen_random_uuid(), true) r) s),
                '10d a result without a real authorization is refused');
SELECT ctx_put('deliv', (workforce_add_deliverable(ctx('t_report'), ctx('seo'), 'report', 'storage://reports/2026-W43.md', 'sha256:abc') ->> 'deliverable_id')::uuid);
SELECT wf_check((SELECT d.task_id = ctx('t_report') AND e.task_id = ctx('t_report') AND e.event_type = 'workforce.deliverable_created'
                        AND d.verified = false
                 FROM workforce_deliverables d JOIN activity_events e ON e.id = d.event_id WHERE d.id = ctx('deliv')),
                '10e deliverable references its task and the event that produced it, unverified');
SELECT wf_check((workforce_add_deliverable(ctx('t_report'), ctx('seo'), 'report', 'storage://reports/2026-W43.md') ->> 'deliverable_id')::uuid = ctx('deliv'),
                '10f retried deliverable returns the same record');
SELECT wf_expect_error(format($$INSERT INTO workforce_deliverables (organization_id, task_id, event_id, kind, uri, verified) SELECT organization_id, task_id, event_id, 'file', 'x', false FROM workforce_deliverables WHERE id = %L$$, ctx('deliv')),
                       'permission denied|WORKFORCE_FORBIDDEN', '10g deliverables cannot be inserted directly');
SELECT wf_check((workforce_verify_deliverable(ctx('deliv'), 'checksum_match', '{"sha256":"abc"}') ->> 'ok')::boolean,
                '10h verification is recorded');
SELECT wf_check((SELECT d.verified AND e.event_type = 'workforce.deliverable_verified' AND e.task_id = ctx('t_report')
                 FROM workforce_deliverables d JOIN activity_events e ON e.id = d.verified_by_event_id WHERE d.id = ctx('deliv')),
                '10i deliverable is verified only together with its verification event');
SELECT wf_check((workforce_complete_task(ctx('t_report'), ctx('seo'), 'completed', 'storage://reports/2026-W43.md') ->> 'ok')::boolean,
                '10j engine accepts completion');
SELECT wf_check((SELECT status FROM tasks WHERE id = ctx('t_report')) = 'completed', '10k task is completed');
SELECT wf_check((SELECT sum(cost_usd) = 0.0425 FROM activity_events WHERE task_id = ctx('t_report')),
                '10l recorded cost is attributable to the task');
SELECT wf_check((SELECT metadata ->> 'authorization' = '[redacted]' FROM activity_events
                 WHERE task_id = ctx('t_report') AND event_type = 'workforce.tool_succeeded'),
                '10m secrets in tool results are not stored');

-- ================================================================ 11. private records
RESET ROLE; SELECT wf_as('authenticated', 'u_outsider'); SET ROLE authenticated;
SELECT wf_check((SELECT count(*) FROM tasks WHERE organization_id = ctx('orgA')) = 0, '11a outsider sees no tasks of another org');
SELECT wf_check((SELECT count(*) FROM activity_events WHERE organization_id = ctx('orgA')) = 0, '11b outsider sees no events of another org');
SELECT wf_check((SELECT count(*) FROM workforce_deliverables WHERE organization_id = ctx('orgA')) = 0, '11c outsider sees no deliverables');
SELECT wf_check((SELECT count(*) FROM workforce_agent_permissions WHERE organization_id = ctx('orgA')) = 0, '11d outsider sees no grants');
SELECT wf_check((SELECT count(*) FROM approval_requests WHERE organization_id = ctx('orgA')) = 0, '11e outsider sees no approvals');
SELECT wf_expect_error($$SELECT workforce_create_task(ctx('orgA'), ctx('seo'), 'Sneaky', 'report.write')$$,
                       'not a member', '11f outsider cannot create tasks in another org');
SELECT wf_expect_error($$SELECT workforce_decide_approval(ctx('ap1'), 'approved')$$,
                       'APPROVAL_NOT_FOUND', '11g outsider cannot decide another org''s approvals');
SELECT wf_expect_error($$SELECT workforce_grant_permission(ctx('junior'), 'report.write')$$,
                       'only an owner or admin', '11h outsider cannot grant on another org''s agent');
RESET ROLE; SELECT wf_as('anon', NULL); SET ROLE anon;
SELECT wf_check((SELECT count(*) FROM tasks) = 0 AND (SELECT count(*) FROM activity_events) = 0, '11i anonymous callers see nothing');
SELECT wf_expect_error($$SELECT * FROM workforce_deliverables$$, 'permission denied', '11j anonymous callers cannot read deliverables');
SELECT wf_expect_error($$SELECT workforce_create_task(ctx('orgA'), ctx('seo'), 'Anon task', 'report.write')$$,
                       'permission denied', '11k anonymous callers cannot create tasks');
RESET ROLE; SELECT wf_as('authenticated', 'u_member'); SET ROLE authenticated;
SELECT wf_check((SELECT count(*) FROM activity_events WHERE task_id = ctx('t_report')) > 0, '11l members of the org can read its history');

-- ================================================================ 12. org deletion still works
RESET ROLE; SELECT wf_as(NULL, NULL);
SELECT workforce_create_task(ctx('orgB'), ctx('agentB'), 'Org B task', 'report.write');
DELETE FROM organizations WHERE id = ctx('orgB');
SELECT wf_check(NOT EXISTS (SELECT 1 FROM activity_events WHERE organization_id = ctx('orgB')),
                '12a deleting an organization removes its history with it');

-- ---------------------------------------------------------------- cleanup
DELETE FROM organizations WHERE id = ctx('orgA');
DELETE FROM auth.users WHERE id IN (SELECT v FROM wf_test_ctx WHERE k LIKE 'u_%');
DROP FUNCTION wf_check(boolean, text), wf_expect_error(text, text, text), wf_as(text, text),
              ctx(text), ctx_put(text, uuid);
DROP TABLE wf_test_ctx;
\echo 'WORKFORCE PHASE A: ALL CHECKS PASSED'
