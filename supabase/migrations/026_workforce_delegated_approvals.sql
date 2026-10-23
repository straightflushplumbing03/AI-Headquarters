-- ============================================================================
-- 026_workforce_delegated_approvals.sql
-- Controlled agent autonomy: owner-configured delegated approval authority,
-- business-value justification, risk-based escalation, full audit trail.
--
-- Additive on top of 025. Rules (all enforced here, not in prompts):
--   * An approval request must carry a business justification, expected
--     benefit, declared risk, estimated cost and rollback plan before any
--     agent may decide it. Missing value => escalate to the owner.
--   * Owners configure, in advance:
--       - action policies (per tool/resource): a risk FLOOR the requester
--         cannot lower, and an owner_only flag for spending, legal, customer
--         data, security, production and irreversible categories;
--       - approval delegations: which agent may approve which tool/resource,
--         up to which risk (low or medium only) and which cost.
--     Only owners/admins (or a direct owner DB session) can write either.
--     The service role (agents) cannot.
--   * No policy for an action => no delegated approval (fail safe).
--   * A reviewer can never approve a request it made, or one for a task
--     assigned to it, and must itself hold a grant for the same action.
--   * Delegated approvals are re-checked at execution time: if the
--     delegation was revoked or expired, a fresh decision is required.
--   * Approvals never grant permissions; the requesting agent still needs
--     its own grant at execution time (025).
-- ============================================================================

CREATE OR REPLACE FUNCTION workforce_risk_rank(p text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END
$$;

-- ---------------------------------------------------------------------------
-- 1. Owner-configured policy and delegation tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workforce_action_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool            text NOT NULL CHECK (length(btrim(tool)) > 0),
  resource        text NOT NULL DEFAULT '*' CHECK (length(btrim(resource)) > 0),
  risk_floor      text NOT NULL DEFAULT 'medium' CHECK (risk_floor IN ('low', 'medium', 'high', 'critical')),
  owner_only      boolean NOT NULL DEFAULT true,
  category        text NOT NULL DEFAULT 'general' CHECK (category IN (
                    'general', 'website', 'seo', 'content', 'advertising', 'spending', 'legal',
                    'customer_data', 'security', 'production', 'irreversible')),
  set_by          uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Escalation categories are always owner-only.
  CONSTRAINT workforce_action_policies_sensitive_owner_only CHECK (
    owner_only OR category NOT IN ('spending', 'legal', 'customer_data', 'security', 'production', 'irreversible')),
  CONSTRAINT workforce_action_policies_uniq UNIQUE (organization_id, tool, resource)
);

CREATE TABLE IF NOT EXISTS workforce_approval_delegations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delegate_agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool              text NOT NULL CHECK (length(btrim(tool)) > 0),
  resource          text NOT NULL DEFAULT '*' CHECK (length(btrim(resource)) > 0),
  -- Agents may never approve high or critical risk.
  max_risk          text NOT NULL DEFAULT 'low' CHECK (max_risk IN ('low', 'medium')),
  max_cost_usd      numeric(12, 2) NOT NULL DEFAULT 0 CHECK (max_cost_usd >= 0),
  granted_by        uuid,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  revoked_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_approval_delegations_active_uniq
  ON workforce_approval_delegations (delegate_agent_id, tool, resource) WHERE revoked_at IS NULL;

CREATE OR REPLACE TRIGGER workforce_engine_only_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_action_policies
  FOR EACH ROW EXECUTE FUNCTION workforce_engine_only_guard();
CREATE OR REPLACE TRIGGER workforce_engine_only_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_approval_delegations
  FOR EACH ROW EXECUTE FUNCTION workforce_engine_only_guard();

ALTER TABLE workforce_action_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_approval_delegations ENABLE ROW LEVEL SECURITY;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workforce_action_policies' AND policyname = 'workforce_action_policies_member_read') THEN
    CREATE POLICY workforce_action_policies_member_read ON workforce_action_policies
  FOR SELECT TO authenticated USING (workforce_is_org_member(organization_id));
  END IF;
END $pol$;
DO $pol$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workforce_approval_delegations' AND policyname = 'workforce_approval_delegations_member_read') THEN
    CREATE POLICY workforce_approval_delegations_member_read ON workforce_approval_delegations
  FOR SELECT TO authenticated USING (workforce_is_org_member(organization_id));
  END IF;
END $pol$;

-- ---------------------------------------------------------------------------
-- 2. Review fields on approval requests
-- ---------------------------------------------------------------------------
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS business_justification       text,
  ADD COLUMN IF NOT EXISTS expected_benefit             text,
  ADD COLUMN IF NOT EXISTS declared_risk                text,
  ADD COLUMN IF NOT EXISTS effective_risk               text,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd           numeric(12, 2),
  ADD COLUMN IF NOT EXISTS rollback_plan                text,
  ADD COLUMN IF NOT EXISTS decided_by_type              text,
  ADD COLUMN IF NOT EXISTS reviewed_by_agent_id         uuid,
  ADD COLUMN IF NOT EXISTS review_notes                 text,
  ADD COLUMN IF NOT EXISTS approved_under_delegation_id uuid,
  ADD COLUMN IF NOT EXISTS escalated_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_reason            text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_declared_risk_valid') THEN
    ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_declared_risk_valid
      CHECK (declared_risk IS NULL OR declared_risk IN ('low', 'medium', 'high', 'critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_decided_by_type_valid') THEN
    ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_decided_by_type_valid
      CHECK (decided_by_type IS NULL OR decided_by_type IN ('owner', 'agent'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Owner configuration functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workforce_require_owner(p_org uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := workforce_caller_role();
BEGIN
  IF v_role = 'internal' THEN RETURN 'system'; END IF;
  IF v_role = 'authenticated' AND workforce_is_org_admin(p_org) THEN RETURN 'user'; END IF;
  RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: only an owner or admin can change autonomy settings' USING ERRCODE = '42501';
END $$;

CREATE OR REPLACE FUNCTION workforce_set_action_policy(
  p_organization_id uuid, p_tool text, p_resource text, p_risk_floor text,
  p_owner_only boolean, p_category text DEFAULT 'general')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor text := workforce_require_owner(p_organization_id); v_id uuid;
BEGIN
  INSERT INTO workforce_action_policies (organization_id, tool, resource, risk_floor, owner_only, category, set_by)
  VALUES (p_organization_id, btrim(p_tool), btrim(COALESCE(p_resource, '*')), p_risk_floor, p_owner_only,
          COALESCE(p_category, 'general'), auth.uid())
  ON CONFLICT (organization_id, tool, resource) DO UPDATE
    SET risk_floor = excluded.risk_floor, owner_only = excluded.owner_only, category = excluded.category,
        set_by = excluded.set_by, updated_at = now()
  RETURNING id INTO v_id;
  PERFORM workforce_log_event(p_organization_id, 'workforce.policy_set', NULL, NULL, v_actor, auth.uid(),
    format('Policy for %s on %s: risk floor %s, %s', btrim(p_tool), btrim(COALESCE(p_resource, '*')),
           p_risk_floor, CASE WHEN p_owner_only THEN 'owner only' ELSE 'delegable' END),
    jsonb_build_object('policy_id', v_id, 'tool', btrim(p_tool), 'resource', btrim(COALESCE(p_resource, '*')),
                       'risk_floor', p_risk_floor, 'owner_only', p_owner_only, 'category', p_category));
  RETURN jsonb_build_object('ok', true, 'policy_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION workforce_grant_approval_delegation(
  p_delegate_agent_id uuid, p_tool text, p_resource text DEFAULT '*',
  p_max_risk text DEFAULT 'low', p_max_cost_usd numeric DEFAULT 0, p_expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a agents%ROWTYPE; v_actor text; v_id uuid;
BEGIN
  SELECT * INTO a FROM agents WHERE id = p_delegate_agent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_actor := workforce_require_owner(a.organization_id);
  UPDATE workforce_approval_delegations SET revoked_at = now()
  WHERE delegate_agent_id = a.id AND tool = btrim(p_tool) AND resource = btrim(COALESCE(p_resource, '*'))
    AND revoked_at IS NULL;
  INSERT INTO workforce_approval_delegations (organization_id, delegate_agent_id, tool, resource, max_risk,
                                              max_cost_usd, granted_by, expires_at)
  VALUES (a.organization_id, a.id, btrim(p_tool), btrim(COALESCE(p_resource, '*')), p_max_risk,
          COALESCE(p_max_cost_usd, 0), auth.uid(), p_expires_at)
  RETURNING id INTO v_id;
  PERFORM workforce_log_event(a.organization_id, 'workforce.delegation_granted', NULL, a.id, v_actor, auth.uid(),
    format('%s may approve %s on %s up to %s risk / $%s', a.name, btrim(p_tool), btrim(COALESCE(p_resource, '*')),
           p_max_risk, COALESCE(p_max_cost_usd, 0)),
    jsonb_build_object('delegation_id', v_id, 'tool', btrim(p_tool), 'resource', btrim(COALESCE(p_resource, '*')),
                       'max_risk', p_max_risk, 'max_cost_usd', p_max_cost_usd, 'expires_at', p_expires_at));
  RETURN jsonb_build_object('ok', true, 'delegation_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION workforce_revoke_approval_delegation(p_delegation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d workforce_approval_delegations%ROWTYPE; v_actor text;
BEGIN
  SELECT * INTO d FROM workforce_approval_delegations WHERE id = p_delegation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELEGATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_actor := workforce_require_owner(d.organization_id);
  IF d.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_revoked', true); END IF;
  UPDATE workforce_approval_delegations SET revoked_at = now() WHERE id = d.id;
  PERFORM workforce_log_event(d.organization_id, 'workforce.delegation_revoked', NULL, d.delegate_agent_id,
    v_actor, auth.uid(), format('Revoked approval authority for %s on %s', d.tool, d.resource),
    jsonb_build_object('delegation_id', d.id));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------------------
-- 4. Requesting agent attaches the business case
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workforce_justify_approval(
  p_approval_id uuid, p_agent_id uuid, p_business_justification text, p_expected_benefit text,
  p_declared_risk text, p_estimated_cost_usd numeric, p_rollback_plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE ap approval_requests%ROWTYPE;
BEGIN
  PERFORM workforce_require_executor();
  SELECT * INTO ap FROM approval_requests WHERE id = p_approval_id AND requested_action IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'approval_not_found'); END IF;
  IF ap.requested_by_agent_id IS DISTINCT FROM p_agent_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_requester');
  END IF;
  IF ap.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_decided'); END IF;
  IF length(btrim(COALESCE(p_business_justification, ''))) < 20
     OR length(btrim(COALESCE(p_expected_benefit, ''))) < 10 THEN
    RAISE EXCEPTION 'INVALID_JUSTIFICATION: a business justification (20+ chars) and expected benefit (10+ chars) are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_declared_risk NOT IN ('low', 'medium', 'high', 'critical') THEN
    RAISE EXCEPTION 'INVALID_JUSTIFICATION: risk must be low, medium, high or critical' USING ERRCODE = '22023';
  END IF;
  IF p_estimated_cost_usd IS NULL OR p_estimated_cost_usd < 0 THEN
    RAISE EXCEPTION 'INVALID_JUSTIFICATION: estimated cost is required and cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_rollback_plan, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_JUSTIFICATION: a rollback plan is required (state "not reversible" if none)' USING ERRCODE = '22023';
  END IF;

  UPDATE approval_requests
  SET business_justification = btrim(p_business_justification), expected_benefit = btrim(p_expected_benefit),
      declared_risk = p_declared_risk, estimated_cost_usd = p_estimated_cost_usd, rollback_plan = btrim(p_rollback_plan)
  WHERE id = ap.id;
  PERFORM workforce_log_event(ap.organization_id, 'workforce.approval_justified', ap.task_id, p_agent_id,
    'agent', p_agent_id, 'Business case submitted for ' || ap.requested_action,
    jsonb_build_object('approval_id', ap.id, 'business_justification', btrim(p_business_justification),
                       'expected_benefit', btrim(p_expected_benefit), 'declared_risk', p_declared_risk,
                       'estimated_cost_usd', p_estimated_cost_usd, 'rollback_plan', btrim(p_rollback_plan)));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------------------
-- 5. Delegated agent review
-- ---------------------------------------------------------------------------
-- p_decision: 'approved' | 'rejected' | 'escalated'. Anything outside the
-- reviewer's delegated authority is escalated to the owner, never approved.
CREATE OR REPLACE FUNCTION workforce_agent_review_approval(
  p_approval_id uuid, p_reviewer_agent_id uuid, p_decision text, p_review_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ap approval_requests%ROWTYPE;
  t tasks%ROWTYPE;
  r agents%ROWTYPE;
  pol workforce_action_policies%ROWTYPE;
  del workforce_approval_delegations%ROWTYPE;
  v_effective text;
  v_reason text;
  v_audit jsonb;
BEGIN
  PERFORM workforce_require_executor();
  IF p_decision NOT IN ('approved', 'rejected', 'escalated') THEN
    RAISE EXCEPTION 'INVALID_DECISION: decision must be approved, rejected or escalated' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_review_notes, ''))) < 10 THEN
    RAISE EXCEPTION 'INVALID_DECISION: review notes (10+ chars) are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO ap FROM approval_requests WHERE id = p_approval_id AND requested_action IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'approval_not_found'); END IF;
  SELECT * INTO t FROM tasks WHERE id = ap.task_id;
  SELECT * INTO r FROM agents WHERE id = p_reviewer_agent_id AND organization_id = ap.organization_id;
  PERFORM workforce_set_actor('agent', p_reviewer_agent_id);

  IF ap.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', ap.status);
  END IF;
  IF ap.expires_at <= now() THEN
    UPDATE approval_requests SET status = 'expired', approval_status = 'expired' WHERE id = ap.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  -- Hard refusals: never allowed, recorded, request left for the owner.
  IF r.id IS NULL OR NOT r.active THEN
    v_reason := 'reviewer_not_active_in_org';
  ELSIF p_reviewer_agent_id = ap.requested_by_agent_id OR p_reviewer_agent_id = ap.agent_id
        OR p_reviewer_agent_id = t.agent_id THEN
    v_reason := 'self_approval_forbidden';
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM workforce_log_event(ap.organization_id, 'workforce.approval_review_denied', ap.task_id, p_reviewer_agent_id,
      'agent', p_reviewer_agent_id, 'Review refused: ' || v_reason,
      jsonb_build_object('approval_id', ap.id, 'reason', v_reason, 'attempted_decision', p_decision));
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  -- Authority checks. Any failure => escalate to the owner (fail safe).
  SELECT * INTO pol FROM workforce_action_policies p
  WHERE p.organization_id = ap.organization_id AND p.tool = ap.requested_action
    AND (p.resource = ap.scope OR p.resource = '*')
  ORDER BY (p.resource = ap.scope) DESC LIMIT 1;

  SELECT * INTO del FROM workforce_approval_delegations d
  WHERE d.delegate_agent_id = p_reviewer_agent_id AND d.organization_id = ap.organization_id
    AND d.tool = ap.requested_action AND (d.resource = ap.scope OR d.resource = '*')
    AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at > now())
  ORDER BY (d.resource = ap.scope) DESC LIMIT 1;

  IF ap.declared_risk IS NOT NULL THEN
    v_effective := CASE WHEN pol.id IS NOT NULL AND workforce_risk_rank(pol.risk_floor) > workforce_risk_rank(ap.declared_risk)
                        THEN pol.risk_floor ELSE ap.declared_risk END;
  END IF;

  IF p_decision = 'escalated' THEN
    v_reason := 'reviewer_escalated';
  ELSIF ap.business_justification IS NULL OR ap.expected_benefit IS NULL OR ap.declared_risk IS NULL
        OR ap.estimated_cost_usd IS NULL OR ap.rollback_plan IS NULL THEN
    v_reason := 'business_case_missing';
  ELSIF pol.id IS NULL THEN
    v_reason := 'no_policy_for_action';
  ELSIF pol.owner_only THEN
    v_reason := 'owner_only_action';
  ELSIF del.id IS NULL THEN
    v_reason := 'no_delegated_authority';
  ELSIF workforce_risk_rank(v_effective) > workforce_risk_rank(del.max_risk) THEN
    v_reason := 'risk_exceeds_authority';
  ELSIF ap.estimated_cost_usd > del.max_cost_usd THEN
    v_reason := 'cost_exceeds_authority';
  ELSIF NOT EXISTS (SELECT 1 FROM workforce_agent_permissions g
                    WHERE g.agent_id = p_reviewer_agent_id AND g.tool = ap.requested_action
                      AND (g.resource = ap.scope OR g.resource = '*')
                      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())) THEN
    v_reason := 'reviewer_lacks_permission';
  END IF;

  v_audit := jsonb_build_object(
    'approval_id', ap.id, 'requested_action', ap.requested_action, 'scope', ap.scope,
    'requested_by_agent_id', ap.requested_by_agent_id,
    'business_justification', ap.business_justification, 'expected_benefit', ap.expected_benefit,
    'declared_risk', ap.declared_risk, 'effective_risk', v_effective,
    'estimated_cost_usd', ap.estimated_cost_usd, 'rollback_plan', ap.rollback_plan,
    'policy_id', pol.id, 'delegation_id', del.id, 'review_notes', btrim(p_review_notes));

  IF v_reason IS NOT NULL THEN
    UPDATE approval_requests
    SET escalated_at = now(), escalation_reason = v_reason, effective_risk = v_effective,
        reviewed_by_agent_id = p_reviewer_agent_id, review_notes = btrim(p_review_notes)
    WHERE id = ap.id;
    PERFORM workforce_log_event(ap.organization_id, 'workforce.approval_escalated', ap.task_id, p_reviewer_agent_id,
      'agent', p_reviewer_agent_id, format('Escalated to owner: %s', v_reason),
      v_audit || jsonb_build_object('reason', v_reason, 'attempted_decision', p_decision));
    RETURN jsonb_build_object('ok', false, 'reason', 'escalated', 'detail', v_reason);
  END IF;

  UPDATE approval_requests
  SET status = p_decision, approval_status = p_decision, decided_by_type = 'agent',
      reviewed_by_agent_id = p_reviewer_agent_id, review_notes = btrim(p_review_notes),
      effective_risk = v_effective, responded_at = now(),
      approved_at = CASE WHEN p_decision = 'approved' THEN now() END,
      approved_under_delegation_id = CASE WHEN p_decision = 'approved' THEN del.id END
  WHERE id = ap.id;
  PERFORM workforce_log_event(ap.organization_id, 'workforce.approval_decided', ap.task_id, p_reviewer_agent_id,
    'agent', p_reviewer_agent_id,
    format('Agent %s %s %s on %s under delegated authority', r.name, p_decision, ap.requested_action, ap.scope),
    v_audit || jsonb_build_object('decision', p_decision, 'decided_by_type', 'agent'));

  IF t.status = 'waiting_approval' THEN
    UPDATE tasks SET status = CASE WHEN p_decision = 'approved' THEN 'queued' ELSE 'cancelled' END WHERE id = t.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'decision', p_decision, 'effective_risk', v_effective);
END $$;

-- Owner decisions now record who decided.
CREATE OR REPLACE FUNCTION workforce_mark_owner_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requested_action IS NOT NULL AND NEW.status IN ('approved', 'rejected')
     AND OLD.status = 'pending' AND NEW.decided_by_type IS NULL THEN
    NEW.decided_by_type := 'owner';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER workforce_mark_owner_decision BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION workforce_mark_owner_decision();

-- ---------------------------------------------------------------------------
-- 6. Execution-time check: delegated approvals must still be backed by an
--    active delegation. (Replaces the 025 version; only the approved branch
--    changes.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workforce_check_action(p_task_id uuid, p_agent_id uuid, p_tool text, p_resource text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tasks%ROWTYPE;
  g workforce_agent_permissions%ROWTYPE;
  v_approval approval_requests%ROWTYPE;
  v_approval_id uuid;
  v_meta jsonb := jsonb_build_object('tool', p_tool, 'resource', p_resource);
BEGIN
  SELECT * INTO t FROM tasks WHERE id = p_task_id;

  IF p_tool IS NULL OR btrim(p_tool) = '' OR p_resource IS NULL OR btrim(p_resource) = '' THEN
    PERFORM workforce_log_event(t.organization_id, 'workforce.permission_denied', t.id, p_agent_id,
      'agent', p_agent_id, 'Denied: action does not declare a tool and resource',
      v_meta || jsonb_build_object('reason', 'undeclared_action'));
    RETURN jsonb_build_object('ok', false, 'reason', 'permission_denied', 'detail', 'undeclared_action');
  END IF;

  SELECT * INTO g FROM workforce_agent_permissions p
  WHERE p.agent_id = p_agent_id AND p.organization_id = t.organization_id
    AND p.tool = p_tool AND (p.resource = p_resource OR p.resource = '*')
    AND p.revoked_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > now())
  ORDER BY p.requires_approval DESC, (p.resource = p_resource) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    PERFORM workforce_log_event(t.organization_id, 'workforce.permission_denied', t.id, p_agent_id,
      'agent', p_agent_id, format('Denied: agent has no grant for %s on %s', p_tool, p_resource),
      v_meta || jsonb_build_object('reason', 'no_grant'));
    RETURN jsonb_build_object('ok', false, 'reason', 'permission_denied', 'detail', 'no_grant');
  END IF;

  IF NOT g.requires_approval THEN
    RETURN jsonb_build_object('ok', true, 'grant_id', g.id);
  END IF;

  SELECT * INTO v_approval FROM approval_requests a
  WHERE a.task_id = t.id AND a.requested_action = p_tool AND a.scope = p_resource
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF FOUND AND v_approval.status = 'approved' AND v_approval.expires_at > now()
     AND (v_approval.approved_under_delegation_id IS NULL OR EXISTS (
           SELECT 1 FROM workforce_approval_delegations d
           WHERE d.id = v_approval.approved_under_delegation_id
             AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at > now()))) THEN
    RETURN jsonb_build_object('ok', true, 'grant_id', g.id, 'approval_id', v_approval.id,
                              'decided_by_type', v_approval.decided_by_type);
  END IF;

  IF FOUND AND v_approval.status = 'rejected' THEN
    PERFORM workforce_log_event(t.organization_id, 'workforce.permission_denied', t.id, p_agent_id,
      'agent', p_agent_id, 'Denied: this action was rejected',
      v_meta || jsonb_build_object('reason', 'approval_rejected', 'approval_id', v_approval.id));
    RETURN jsonb_build_object('ok', false, 'reason', 'approval_rejected', 'approval_id', v_approval.id);
  END IF;

  IF FOUND AND v_approval.status = 'pending' AND v_approval.expires_at > now() THEN
    v_approval_id := v_approval.id;
  ELSE
    IF FOUND AND v_approval.status = 'pending' THEN
      UPDATE approval_requests SET status = 'expired', approval_status = 'expired' WHERE id = v_approval.id;
    END IF;
    INSERT INTO approval_requests (organization_id, task_id, agent_id, request_type, title, description,
                                   proposed_action, metadata, status, approval_status, expires_at,
                                   requested_at, requested_action, scope, requested_by_type, requested_by_agent_id)
    VALUES (t.organization_id, t.id, p_agent_id, 'external_action',
            format('Approve %s on %s', p_tool, p_resource),
            format('Task "%s" needs approval before running %s on %s.', t.title, p_tool, p_resource),
            p_tool, v_meta, 'pending', 'pending', now() + interval '7 days',
            now(), p_tool, p_resource, 'agent', p_agent_id)
    RETURNING id INTO v_approval_id;
    PERFORM workforce_log_event(t.organization_id, 'workforce.approval_requested', t.id, p_agent_id,
      'agent', p_agent_id, format('Approval requested: %s on %s', p_tool, p_resource),
      v_meta || jsonb_build_object('approval_id', v_approval_id, 'superseded_approval_id', v_approval.id));
  END IF;

  IF t.status IN ('queued', 'pending', 'working') THEN
    PERFORM workforce_set_actor('agent', p_agent_id);
    UPDATE tasks SET status = 'waiting_approval' WHERE id = t.id;
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'approval_required', 'approval_id', v_approval_id);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges (extends 025's idempotent setup)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workforce_apply_delegation_privileges()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM workforce_apply_privileges();
  REVOKE ALL ON workforce_action_policies, workforce_approval_delegations FROM anon, authenticated, service_role;
  GRANT SELECT ON workforce_action_policies, workforce_approval_delegations TO authenticated, service_role;
  REVOKE EXECUTE ON FUNCTION
    workforce_require_owner(uuid),
    workforce_set_action_policy(uuid, text, text, text, boolean, text),
    workforce_grant_approval_delegation(uuid, text, text, text, numeric, timestamptz),
    workforce_revoke_approval_delegation(uuid),
    workforce_justify_approval(uuid, uuid, text, text, text, numeric, text),
    workforce_agent_review_approval(uuid, uuid, text, text),
    workforce_apply_delegation_privileges()
  FROM PUBLIC, anon, authenticated, service_role;
  -- Autonomy settings: owners/admins only. Never the service role (agents).
  GRANT EXECUTE ON FUNCTION
    workforce_set_action_policy(uuid, text, text, text, boolean, text),
    workforce_grant_approval_delegation(uuid, text, text, text, numeric, timestamptz),
    workforce_revoke_approval_delegation(uuid)
  TO authenticated;
  -- Agent-side review: executor only.
  GRANT EXECUTE ON FUNCTION
    workforce_justify_approval(uuid, uuid, text, text, text, numeric, text),
    workforce_agent_review_approval(uuid, uuid, text, text)
  TO service_role;
END $$;

SELECT workforce_apply_delegation_privileges();
