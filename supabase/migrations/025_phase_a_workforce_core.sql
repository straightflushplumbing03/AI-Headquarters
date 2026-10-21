-- ============================================================================
-- 025_phase_a_workforce_core.sql
-- Phase A: enforced agent / task / event / deliverable / approval core.
--
-- Additive only: no DROP TABLE, no data rewrites. Reuses the existing tables:
--   agents            + budget_daily_usd
--   tasks             + creator_id (production drift: code already writes it),
--                       assigned_by_*, dedupe_key, required_tool/resource,
--                       claimed_at, attempt; status CHECK (NOT VALID) and
--                       transition enforcement
--   activity_events   becomes the append-only audit log (+ the columns the app
--                       already writes: agent_id, user_id, title, description,
--                       metadata; + task_id, actor_*, cost_usd)
--   approval_requests + requested_action, scope, requested_by_*
-- New tables (no existing equivalent):
--   workforce_agent_permissions, task_dependencies, workforce_deliverables,
--   workforce_task_transitions (reference data)
--
-- Trust model
--   * Every rule is enforced in the database. Direct table writes from the
--     anon / authenticated / service_role API roles cannot start, finish or
--     approve work; only the SECURITY DEFINER workforce_* functions can.
--   * Events whose type starts with 'workforce.' can only be written by those
--     functions, so dashboards can treat them as execution truth.
--   * Agents run with the service role. The service role can claim and execute
--     tasks but can never grant permissions or decide approvals, so an agent
--     cannot widen its own access, and assignment never transfers privileges.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- The API role of the caller as seen by PostgREST ('anon' | 'authenticated' |
-- 'service_role'), or 'internal' for a direct database session (migrations,
-- SQL editor, local tests).
CREATE OR REPLACE FUNCTION workforce_caller_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    'internal')
$$;

-- True when the current statement runs inside a SECURITY DEFINER workforce
-- function (or a direct owner session), false for the API roles.
CREATE OR REPLACE FUNCTION workforce_is_trusted_db_path()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator')
$$;

-- Redact secret-looking keys and values from event metadata, recursively.
CREATE OR REPLACE FUNCTION workforce_scrub_secrets(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k text; v jsonb; result jsonb;
BEGIN
  IF p IS NULL THEN RETURN '{}'::jsonb; END IF;
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      result := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(p) LOOP
        IF k ~* '(^|[_-])(password|passwd|secret|token|apikey|api_?key|authorization|bearer|credentials?|private_?key|cookie)([_-]|$)' THEN
          result := result || jsonb_build_object(k, '[redacted]');
        ELSE
          result := result || jsonb_build_object(k, workforce_scrub_secrets(v));
        END IF;
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      SELECT COALESCE(jsonb_agg(workforce_scrub_secrets(e)), '[]'::jsonb) INTO result
      FROM jsonb_array_elements(p) e;
      RETURN result;
    WHEN 'string' THEN
      IF (p #>> '{}') ~* '^(bearer\s+\S+|sk-[a-z0-9_-]{8,}|ghp_[a-z0-9]{8,}|github_pat_\S+|xox[abp]-\S+|eyJ[a-zA-Z0-9_-]{10,}\.)' THEN
        RETURN to_jsonb('[redacted]'::text);
      END IF;
      RETURN p;
    ELSE
      RETURN p;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION workforce_is_org_admin(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = p_org AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin'))
$$;

CREATE OR REPLACE FUNCTION workforce_is_org_member(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM organization_members m
    WHERE m.organization_id = p_org AND m.user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 1. Agents
-- ---------------------------------------------------------------------------
-- Hosted databases that were bootstrapped from the minimal 001 base schema
-- lack columns the app and this migration use (verified on project
-- znpqosbwdgrtfediqvwt, 2026-10-21). Added here, nullable or defaulted, so
-- they are no-ops where 0000_phase0_base_schema already created them.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS budget_daily_usd numeric(12, 4)
    CHECK (budget_daily_usd IS NULL OR budget_daily_usd >= 0);

-- ---------------------------------------------------------------------------
-- 2. Tasks
-- ---------------------------------------------------------------------------
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS input jsonb,
  ADD COLUMN IF NOT EXISTS result text,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS creator_id uuid,
  ADD COLUMN IF NOT EXISTS assigned_by_type text,
  ADD COLUMN IF NOT EXISTS assigned_by_id uuid,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS required_tool text,
  ADD COLUMN IF NOT EXISTS required_resource text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assigned_by_type_valid') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_by_type_valid
      CHECK (assigned_by_type IS NULL OR assigned_by_type IN ('user', 'agent', 'system'));
  END IF;
  -- NOT VALID: enforced for new and updated rows without rejecting any
  -- pre-existing production row. 'pending' and 'in_progress' are legacy values.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_status_valid') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_status_valid
      CHECK (status IN ('queued', 'pending', 'blocked', 'waiting_approval', 'working',
                        'in_progress', 'completed', 'failed', 'cancelled')) NOT VALID;
  END IF;
END $$;

-- Duplicate prevention: one OPEN task per (organization, dedupe_key).
CREATE UNIQUE INDEX IF NOT EXISTS tasks_open_dedupe_key_uniq
  ON tasks (organization_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS tasks_agent_status_idx ON tasks (agent_id, status);

CREATE TABLE IF NOT EXISTS workforce_task_transitions (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO workforce_task_transitions (from_status, to_status) VALUES
  ('queued', 'working'), ('queued', 'waiting_approval'), ('queued', 'blocked'), ('queued', 'cancelled'),
  ('pending', 'working'), ('pending', 'waiting_approval'), ('pending', 'blocked'), ('pending', 'cancelled'),
  ('blocked', 'queued'), ('blocked', 'cancelled'),
  ('waiting_approval', 'queued'), ('waiting_approval', 'cancelled'),
  ('working', 'completed'), ('working', 'failed'), ('working', 'waiting_approval'),
  ('working', 'queued'), ('working', 'cancelled'),
  ('failed', 'queued'),
  ('in_progress', 'completed'), ('in_progress', 'failed'), ('in_progress', 'cancelled')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS task_dependencies_depends_on_idx ON task_dependencies (depends_on_task_id);

-- ---------------------------------------------------------------------------
-- 3. Agent permissions (explicit grants, deny by default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workforce_agent_permissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool              text NOT NULL CHECK (length(btrim(tool)) > 0),
  resource          text NOT NULL DEFAULT '*' CHECK (length(btrim(resource)) > 0),
  requires_approval boolean NOT NULL DEFAULT false,
  granted_by        uuid,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  revoked_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_agent_permissions_active_uniq
  ON workforce_agent_permissions (agent_id, tool, resource) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Events: activity_events becomes the append-only audit log
-- ---------------------------------------------------------------------------
ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS agent_id    uuid,
  ADD COLUMN IF NOT EXISTS user_id     uuid,
  ADD COLUMN IF NOT EXISTS title       text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS metadata    jsonb,
  -- task_id / agent_id carry no FK on purpose: audit rows must outlive the
  -- task or agent they describe, and FK actions would have to rewrite them.
  ADD COLUMN IF NOT EXISTS task_id     uuid,
  ADD COLUMN IF NOT EXISTS actor_type  text,
  ADD COLUMN IF NOT EXISTS actor_id    uuid,
  ADD COLUMN IF NOT EXISTS cost_usd    numeric(12, 6);

ALTER TABLE activity_events ALTER COLUMN created_at SET DEFAULT now();
CREATE INDEX IF NOT EXISTS activity_events_task_idx ON activity_events (task_id, created_at);
CREATE INDEX IF NOT EXISTS activity_events_org_created_idx ON activity_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_agent_created_idx ON activity_events (agent_id, created_at DESC);

CREATE OR REPLACE FUNCTION workforce_activity_events_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.event_type LIKE 'workforce.%' AND NOT workforce_is_trusted_db_path() THEN
      RAISE EXCEPTION 'EVENT_FORBIDDEN: workforce.* events are written only by the workforce engine'
        USING ERRCODE = '42501';
    END IF;
    NEW.metadata := workforce_scrub_secrets(NEW.metadata);
    NEW.created_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'EVENT_IMMUTABLE: activity_events is append-only' USING ERRCODE = '42501';
  ELSE -- DELETE: only as part of deleting the whole organization
    IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.organization_id) THEN
      RAISE EXCEPTION 'EVENT_IMMUTABLE: activity_events is append-only' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
END $$;

DROP TRIGGER IF EXISTS workforce_activity_events_guard ON activity_events;
CREATE TRIGGER workforce_activity_events_guard
  BEFORE INSERT OR UPDATE OR DELETE ON activity_events
  FOR EACH ROW EXECUTE FUNCTION workforce_activity_events_guard();

-- The only writer of workforce.* events. Not executable by any API role.
CREATE OR REPLACE FUNCTION workforce_log_event(
  p_org uuid, p_type text, p_task uuid, p_agent uuid,
  p_actor_type text, p_actor_id uuid, p_title text,
  p_metadata jsonb DEFAULT '{}'::jsonb, p_cost numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_type NOT LIKE 'workforce.%' THEN
    RAISE EXCEPTION 'workforce_log_event only writes workforce.* events';
  END IF;
  INSERT INTO activity_events (organization_id, event_type, task_id, agent_id, user_id,
                               actor_type, actor_id, title, metadata, cost_usd)
  VALUES (p_org, p_type, p_task, p_agent,
          CASE WHEN p_actor_type = 'user' THEN p_actor_id END,
          p_actor_type, p_actor_id, p_title, COALESCE(p_metadata, '{}'::jsonb), p_cost)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Deliverables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workforce_deliverables (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id              uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id             uuid,
  event_id             uuid NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('file', 'report', 'commit', 'pull_request', 'page', 'other')),
  uri                  text NOT NULL CHECK (length(btrim(uri)) > 0),
  checksum             text,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified             boolean NOT NULL DEFAULT false,
  verified_at          timestamptz,
  verified_by_event_id uuid REFERENCES activity_events(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workforce_deliverables_verified_has_evidence
    CHECK (verified = (verified_by_event_id IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT workforce_deliverables_task_uri_uniq UNIQUE (task_id, kind, uri)
);
CREATE INDEX IF NOT EXISTS workforce_deliverables_task_idx ON workforce_deliverables (task_id);

-- ---------------------------------------------------------------------------
-- 6. Approvals: extend the existing approval_requests table
-- ---------------------------------------------------------------------------
ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS requested_action      text,
  ADD COLUMN IF NOT EXISTS scope                 text,
  ADD COLUMN IF NOT EXISTS requested_by_type     text,
  ADD COLUMN IF NOT EXISTS requested_by_agent_id uuid;

-- One open request per task + action + scope.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_workforce_pending_uniq
  ON approval_requests (task_id, requested_action, scope)
  WHERE requested_action IS NOT NULL AND status = 'pending';

-- ---------------------------------------------------------------------------
-- 7. Guards on direct writes (fire for every write path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workforce_tasks_before_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_trusted boolean := workforce_is_trusted_db_path();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted THEN
      IF NEW.status NOT IN ('queued', 'pending') THEN
        RAISE EXCEPTION 'TASK_TRANSITION_REJECTED: new tasks start as queued' USING ERRCODE = '42501';
      END IF;
      -- The assigner is whoever is actually signed in; it cannot be claimed.
      IF auth.uid() IS NOT NULL THEN
        NEW.assigned_by_type := 'user';
        NEW.assigned_by_id   := auth.uid();
        NEW.creator_id       := auth.uid();
      ELSE
        NEW.assigned_by_type := 'system';
        NEW.assigned_by_id   := NULL;
      END IF;
      NEW.claimed_at := NULL;
      NEW.attempt    := 0;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM workforce_task_transitions
                   WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION 'TASK_TRANSITION_REJECTED: % -> % is not an allowed transition', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
    -- Starting, finishing, or releasing work from an approval gate is the
    -- workforce engine's job; the API roles may only cancel or requeue.
    IF NOT v_trusted AND (
         NEW.status IN ('working', 'completed', 'failed', 'waiting_approval')
         OR (OLD.status = 'waiting_approval' AND NEW.status = 'queued')
         OR (OLD.status = 'working' AND NEW.status <> 'cancelled')) THEN
      RAISE EXCEPTION 'TASK_TRANSITION_REJECTED: % -> % must go through the workforce engine', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT v_trusted AND (
       NEW.organization_id   IS DISTINCT FROM OLD.organization_id
    OR NEW.agent_id          IS DISTINCT FROM OLD.agent_id AND OLD.status NOT IN ('queued', 'pending', 'blocked')
    OR NEW.dedupe_key        IS DISTINCT FROM OLD.dedupe_key
    OR NEW.required_tool     IS DISTINCT FROM OLD.required_tool
    OR NEW.required_resource IS DISTINCT FROM OLD.required_resource
    OR NEW.assigned_by_type  IS DISTINCT FROM OLD.assigned_by_type
    OR NEW.assigned_by_id    IS DISTINCT FROM OLD.assigned_by_id
    OR NEW.claimed_at        IS DISTINCT FROM OLD.claimed_at
    OR NEW.attempt           IS DISTINCT FROM OLD.attempt) THEN
    RAISE EXCEPTION 'TASK_FIELD_PROTECTED: assignment, scope and execution fields are engine-managed'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workforce_tasks_before_write ON tasks;
CREATE TRIGGER workforce_tasks_before_write
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION workforce_tasks_before_write();

-- Who is acting, for the audit trail: set by workforce functions, otherwise
-- the signed-in user, otherwise the system.
CREATE OR REPLACE FUNCTION workforce_current_actor(OUT actor_type text, OUT actor_id uuid)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  actor_type := NULLIF(current_setting('workforce.actor_type', true), '');
  actor_id   := NULLIF(current_setting('workforce.actor_id', true), '')::uuid;
  IF actor_type IS NULL THEN
    IF auth.uid() IS NOT NULL THEN actor_type := 'user'; actor_id := auth.uid();
    ELSE actor_type := 'system'; actor_id := NULL; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION workforce_set_actor(p_type text, p_id uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('workforce.actor_type', p_type, true),
         set_config('workforce.actor_id', COALESCE(p_id::text, ''), true);
$$;

-- Every task creation and status change is recorded, whatever the write path.
CREATE OR REPLACE FUNCTION workforce_tasks_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM workforce_current_actor();
  IF TG_OP = 'INSERT' THEN
    PERFORM workforce_log_event(NEW.organization_id, 'workforce.task_created', NEW.id, NEW.agent_id,
      COALESCE(NEW.assigned_by_type, a.actor_type), COALESCE(NEW.assigned_by_id, a.actor_id),
      'Task created: ' || NEW.title,
      jsonb_build_object('status', NEW.status, 'priority', NEW.priority,
                         'required_tool', NEW.required_tool, 'required_resource', NEW.required_resource,
                         'dedupe_key', NEW.dedupe_key, 'assigned_to', NEW.agent_id,
                         'assigned_by_type', NEW.assigned_by_type, 'assigned_by_id', NEW.assigned_by_id));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM workforce_log_event(NEW.organization_id, 'workforce.task_status_changed', NEW.id, NEW.agent_id,
      a.actor_type, a.actor_id, format('Task %s -> %s', OLD.status, NEW.status),
      jsonb_build_object('from', OLD.status, 'to', NEW.status, 'attempt', NEW.attempt));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS workforce_tasks_after_write ON tasks;
CREATE TRIGGER workforce_tasks_after_write
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION workforce_tasks_after_write();

-- Permissions, dependencies and deliverables are engine-written only.
CREATE OR REPLACE FUNCTION workforce_engine_only_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT workforce_is_trusted_db_path() THEN
    RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: % is written only through workforce_* functions', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS workforce_engine_only_guard ON workforce_agent_permissions;
CREATE TRIGGER workforce_engine_only_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_agent_permissions
  FOR EACH ROW EXECUTE FUNCTION workforce_engine_only_guard();
DROP TRIGGER IF EXISTS workforce_engine_only_guard ON task_dependencies;
CREATE TRIGGER workforce_engine_only_guard BEFORE INSERT OR UPDATE OR DELETE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION workforce_engine_only_guard();
DROP TRIGGER IF EXISTS workforce_engine_only_guard ON workforce_deliverables;
CREATE TRIGGER workforce_engine_only_guard BEFORE INSERT OR UPDATE OR DELETE ON workforce_deliverables
  FOR EACH ROW EXECUTE FUNCTION workforce_engine_only_guard();

-- Workforce approvals cannot be created, decided or removed by direct writes.
-- Rows without requested_action (Sprint 3 decision approvals) are untouched.
CREATE OR REPLACE FUNCTION workforce_approvals_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF workforce_is_trusted_db_path() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF (TG_OP IN ('UPDATE', 'DELETE') AND OLD.requested_action IS NOT NULL)
     OR (TG_OP IN ('INSERT', 'UPDATE') AND NEW.requested_action IS NOT NULL) THEN
    RAISE EXCEPTION 'APPROVAL_FORBIDDEN: workforce approvals are decided only through workforce_decide_approval'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS workforce_approvals_guard ON approval_requests;
CREATE TRIGGER workforce_approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION workforce_approvals_guard();

-- ---------------------------------------------------------------------------
-- 8. Authorization core (internal)
-- ---------------------------------------------------------------------------

-- Checks the ACTING agent's own grant for one action, and its approval when
-- the grant requires one. Records denials and approval requests as events.
-- Returns {ok, reason, grant_id, approval_id}.
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

  -- Most restrictive matching grant wins (any match requiring approval => approval).
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

  -- Latest decision for exactly this task + action + scope.
  SELECT * INTO v_approval FROM approval_requests a
  WHERE a.task_id = t.id AND a.requested_action = p_tool AND a.scope = p_resource
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF FOUND AND v_approval.status = 'approved' AND v_approval.expires_at > now() THEN
    RETURN jsonb_build_object('ok', true, 'grant_id', g.id, 'approval_id', v_approval.id);
  END IF;

  IF FOUND AND v_approval.status = 'rejected' THEN
    PERFORM workforce_log_event(t.organization_id, 'workforce.permission_denied', t.id, p_agent_id,
      'agent', p_agent_id, 'Denied: the owner rejected this action',
      v_meta || jsonb_build_object('reason', 'approval_rejected', 'approval_id', v_approval.id));
    RETURN jsonb_build_object('ok', false, 'reason', 'approval_rejected', 'approval_id', v_approval.id);
  END IF;

  IF FOUND AND v_approval.status = 'pending' AND v_approval.expires_at > now() THEN
    v_approval_id := v_approval.id;
  ELSE
    -- Approved-but-expired, expired, or none: a fresh owner decision is needed.
    IF FOUND AND v_approval.status = 'pending' THEN
      UPDATE approval_requests SET status = 'expired', approval_status = 'expired' WHERE id = v_approval.id;
    END IF;
    INSERT INTO approval_requests (organization_id, task_id, agent_id, request_type, title, description,
                                   proposed_action, metadata, status, approval_status, expires_at,
                                   requested_at, requested_action, scope, requested_by_type, requested_by_agent_id)
    VALUES (t.organization_id, t.id, p_agent_id, 'external_action',
            format('Approve %s on %s', p_tool, p_resource),
            format('Task "%s" needs owner approval before running %s on %s.', t.title, p_tool, p_resource),
            p_tool, v_meta, 'pending', 'pending', now() + interval '7 days',
            now(), p_tool, p_resource, 'agent', p_agent_id)
    RETURNING id INTO v_approval_id;
    PERFORM workforce_log_event(t.organization_id, 'workforce.approval_requested', t.id, p_agent_id,
      'agent', p_agent_id, format('Approval requested: %s on %s', p_tool, p_resource),
      v_meta || jsonb_build_object('approval_id', v_approval_id));
  END IF;

  IF t.status IN ('queued', 'pending', 'working') THEN
    PERFORM workforce_set_actor('agent', p_agent_id);
    UPDATE tasks SET status = 'waiting_approval' WHERE id = t.id;
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'approval_required', 'approval_id', v_approval_id);
END $$;

CREATE OR REPLACE FUNCTION workforce_require_executor()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF workforce_caller_role() NOT IN ('service_role', 'internal') THEN
    RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: only the workforce executor may run tasks' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION workforce_kill_switch_on()
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF to_regproc('is_global_kill_switch_enabled') IS NULL THEN RETURN false; END IF;
  RETURN is_global_kill_switch_enabled();
END $$;

-- ---------------------------------------------------------------------------
-- 9. Public workforce API (called through supabase.rpc)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION workforce_create_task(
  p_organization_id uuid, p_agent_id uuid, p_title text,
  p_required_tool text, p_required_resource text DEFAULT '*',
  p_description text DEFAULT NULL, p_priority text DEFAULT 'medium',
  p_dedupe_key text DEFAULT NULL, p_depends_on uuid[] DEFAULT '{}',
  p_input jsonb DEFAULT NULL, p_assigned_by_agent_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text := workforce_caller_role();
  v_by_type text; v_by_id uuid;
  v_task_id uuid; v_existing uuid; v_dep uuid;
  v_hint boolean;
BEGIN
  IF v_role = 'authenticated' THEN
    IF NOT workforce_is_org_member(p_organization_id) THEN
      RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: not a member of this organization' USING ERRCODE = '42501';
    END IF;
    IF p_assigned_by_agent_id IS NOT NULL THEN
      RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: users cannot assign on behalf of an agent' USING ERRCODE = '42501';
    END IF;
    v_by_type := 'user'; v_by_id := auth.uid();
  ELSIF v_role IN ('service_role', 'internal') THEN
    IF p_assigned_by_agent_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM agents WHERE id = p_assigned_by_agent_id
                     AND organization_id = p_organization_id AND active) THEN
        RAISE EXCEPTION 'INVALID_TASK: assigning agent is not an active agent of this organization' USING ERRCODE = '22023';
      END IF;
      v_by_type := 'agent'; v_by_id := p_assigned_by_agent_id;
    ELSE
      v_by_type := 'system'; v_by_id := NULL;
    END IF;
  ELSE
    RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: sign in required' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'INVALID_TASK: title is required' USING ERRCODE = '22023';
  END IF;
  IF p_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN
    RAISE EXCEPTION 'INVALID_TASK: priority must be low, medium, high or urgent' USING ERRCODE = '22023';
  END IF;
  IF p_required_tool IS NULL OR btrim(p_required_tool) = ''
     OR p_required_resource IS NULL OR btrim(p_required_resource) = '' THEN
    RAISE EXCEPTION 'INVALID_TASK: required_tool and required_resource are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agents WHERE id = p_agent_id AND organization_id = p_organization_id AND active) THEN
    RAISE EXCEPTION 'INVALID_TASK: assignee is not an active agent of this organization' USING ERRCODE = '22023';
  END IF;
  FOREACH v_dep IN ARRAY COALESCE(p_depends_on, '{}') LOOP
    IF NOT EXISTS (SELECT 1 FROM tasks WHERE id = v_dep AND organization_id = p_organization_id) THEN
      RAISE EXCEPTION 'INVALID_TASK: dependency % is not a task of this organization', v_dep USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM workforce_set_actor(v_by_type, v_by_id);

  IF p_dedupe_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM tasks
    WHERE organization_id = p_organization_id AND dedupe_key = p_dedupe_key
      AND status NOT IN ('completed', 'failed', 'cancelled')
    LIMIT 1;
  END IF;

  IF v_existing IS NULL THEN
    -- Informational only: the authoritative check happens at execution time.
    SELECT EXISTS (SELECT 1 FROM workforce_agent_permissions p
                   WHERE p.agent_id = p_agent_id AND p.tool = p_required_tool
                     AND (p.resource = p_required_resource OR p.resource = '*')
                     AND p.revoked_at IS NULL AND p.requires_approval) INTO v_hint;
    BEGIN
      INSERT INTO tasks (organization_id, agent_id, title, description, priority, status, input,
                         approval_required, creator_id, assigned_by_type, assigned_by_id,
                         dedupe_key, required_tool, required_resource)
      VALUES (p_organization_id, p_agent_id, btrim(p_title), p_description, p_priority, 'queued', p_input,
              v_hint, CASE WHEN v_by_type = 'user' THEN v_by_id END, v_by_type, v_by_id,
              p_dedupe_key, btrim(p_required_tool), btrim(p_required_resource))
      RETURNING id INTO v_task_id;
    EXCEPTION WHEN unique_violation THEN
      -- Lost a race with an identical submission.
      SELECT id INTO v_existing FROM tasks
      WHERE organization_id = p_organization_id AND dedupe_key = p_dedupe_key
        AND status NOT IN ('completed', 'failed', 'cancelled')
      LIMIT 1;
    END;
  END IF;

  IF v_existing IS NOT NULL THEN
    PERFORM workforce_log_event(p_organization_id, 'workforce.task_duplicate_rejected', v_existing, p_agent_id,
      v_by_type, v_by_id, 'Duplicate task rejected: ' || btrim(p_title),
      jsonb_build_object('dedupe_key', p_dedupe_key, 'existing_task_id', v_existing));
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate', 'task_id', v_existing);
  END IF;

  INSERT INTO task_dependencies (task_id, depends_on_task_id, organization_id)
  SELECT v_task_id, d, p_organization_id FROM unnest(COALESCE(p_depends_on, '{}')) d
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'task_id', v_task_id);
END $$;

CREATE OR REPLACE FUNCTION workforce_claim_task(p_task_id uuid, p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tasks%ROWTYPE;
  v_blockers uuid[];
  v_check jsonb;
  v_deny text;
BEGIN
  PERFORM workforce_require_executor();
  SELECT * INTO t FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'task_not_found');
  END IF;
  PERFORM workforce_set_actor('agent', p_agent_id);

  -- Safe retry: a repeated claim by the same agent is a no-op.
  IF t.status = 'working' AND t.agent_id = p_agent_id THEN
    RETURN jsonb_build_object('ok', true, 'task_id', t.id, 'already_claimed', true);
  END IF;

  IF t.agent_id IS DISTINCT FROM p_agent_id THEN
    v_deny := 'not_assignee';
  ELSIF t.status NOT IN ('queued', 'pending') THEN
    v_deny := 'not_claimable';
  ELSIF workforce_kill_switch_on() THEN
    v_deny := 'kill_switch_active';
  ELSIF NOT EXISTS (SELECT 1 FROM agents WHERE id = p_agent_id AND organization_id = t.organization_id AND active) THEN
    v_deny := 'agent_inactive';
  END IF;

  IF v_deny IS NULL THEN
    SELECT array_agg(dep_id) INTO v_blockers FROM (
      SELECT d.depends_on_task_id AS dep_id FROM task_dependencies d
      JOIN tasks dt ON dt.id = d.depends_on_task_id
      WHERE d.task_id = t.id AND dt.status <> 'completed'
      UNION
      SELECT t.depends_on FROM tasks dt
      WHERE t.depends_on IS NOT NULL AND dt.id = t.depends_on AND dt.status <> 'completed'
    ) s;
    IF v_blockers IS NOT NULL THEN
      v_deny := 'dependencies_incomplete';
    END IF;
  END IF;

  IF v_deny IS NOT NULL THEN
    PERFORM workforce_log_event(t.organization_id, 'workforce.claim_denied', t.id, p_agent_id,
      'agent', p_agent_id, 'Claim denied: ' || v_deny,
      jsonb_build_object('reason', v_deny, 'status', t.status, 'blocking_tasks', to_jsonb(v_blockers)));
    RETURN jsonb_build_object('ok', false, 'reason', v_deny, 'blocking_tasks', to_jsonb(v_blockers));
  END IF;

  v_check := workforce_check_action(t.id, p_agent_id, t.required_tool, t.required_resource);
  IF NOT (v_check ->> 'ok')::boolean THEN
    RETURN v_check;
  END IF;

  UPDATE tasks SET status = 'working', claimed_at = now(), started_at = COALESCE(started_at, now()),
                   attempt = attempt + 1
  WHERE id = t.id;
  PERFORM workforce_log_event(t.organization_id, 'workforce.task_claimed', t.id, p_agent_id,
    'agent', p_agent_id, 'Task claimed: ' || t.title,
    jsonb_build_object('grant_id', v_check -> 'grant_id', 'approval_id', v_check -> 'approval_id',
                       'attempt', t.attempt + 1));
  RETURN jsonb_build_object('ok', true, 'task_id', t.id);
END $$;

-- Execution-time check before every tool call. Re-verifies grant, approval,
-- kill switch and daily budget at the moment of execution.
CREATE OR REPLACE FUNCTION workforce_authorize_action(p_task_id uuid, p_agent_id uuid, p_tool text, p_resource text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tasks%ROWTYPE;
  a agents%ROWTYPE;
  v_spent numeric;
  v_deny text;
  v_check jsonb;
  v_event uuid;
  v_meta jsonb := jsonb_build_object('tool', p_tool, 'resource', p_resource);
BEGIN
  PERFORM workforce_require_executor();
  SELECT * INTO t FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'task_not_found');
  END IF;
  PERFORM workforce_set_actor('agent', p_agent_id);
  SELECT * INTO a FROM agents WHERE id = p_agent_id AND organization_id = t.organization_id;

  IF t.agent_id IS DISTINCT FROM p_agent_id THEN
    v_deny := 'not_assignee';
  ELSIF t.status <> 'working' THEN
    v_deny := 'task_not_in_progress';
  ELSIF a.id IS NULL OR NOT a.active THEN
    v_deny := 'agent_inactive';
  ELSIF workforce_kill_switch_on() THEN
    v_deny := 'kill_switch_active';
  ELSIF a.budget_daily_usd IS NOT NULL THEN
    SELECT COALESCE(sum(cost_usd), 0) INTO v_spent FROM activity_events
    WHERE agent_id = p_agent_id AND event_type LIKE 'workforce.tool_%' AND created_at >= date_trunc('day', now());
    IF v_spent >= a.budget_daily_usd THEN
      v_deny := 'budget_exceeded';
    END IF;
  END IF;

  IF v_deny IS NOT NULL THEN
    PERFORM workforce_log_event(t.organization_id, 'workforce.permission_denied', t.id, p_agent_id,
      'agent', p_agent_id, 'Denied: ' || v_deny, v_meta || jsonb_build_object('reason', v_deny));
    RETURN jsonb_build_object('ok', false, 'reason', v_deny);
  END IF;

  v_check := workforce_check_action(t.id, p_agent_id, p_tool, p_resource);
  IF NOT (v_check ->> 'ok')::boolean THEN
    RETURN v_check;
  END IF;

  v_event := workforce_log_event(t.organization_id, 'workforce.tool_authorized', t.id, p_agent_id,
    'agent', p_agent_id, format('Authorized %s on %s', p_tool, p_resource),
    v_meta || jsonb_build_object('grant_id', v_check -> 'grant_id', 'approval_id', v_check -> 'approval_id'));
  RETURN jsonb_build_object('ok', true, 'authorization_event_id', v_event);
END $$;

-- Records what actually happened after an authorized tool call.
CREATE OR REPLACE FUNCTION workforce_record_tool_result(
  p_task_id uuid, p_agent_id uuid, p_authorization_event_id uuid,
  p_success boolean, p_metadata jsonb DEFAULT '{}'::jsonb, p_cost_usd numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  auth_ev activity_events%ROWTYPE;
  v_existing uuid;
  v_event uuid;
BEGIN
  PERFORM workforce_require_executor();
  IF p_cost_usd IS NOT NULL AND p_cost_usd < 0 THEN
    RAISE EXCEPTION 'INVALID_RESULT: cost cannot be negative' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO auth_ev FROM activity_events
  WHERE id = p_authorization_event_id AND event_type = 'workforce.tool_authorized'
    AND task_id = p_task_id AND agent_id = p_agent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_matching_authorization');
  END IF;

  -- Safe retry: one result per authorization.
  SELECT id INTO v_existing FROM activity_events
  WHERE task_id = p_task_id AND event_type IN ('workforce.tool_succeeded', 'workforce.tool_failed')
    AND metadata ->> 'authorized_by_event_id' = p_authorization_event_id::text
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'event_id', v_existing, 'duplicate', true);
  END IF;

  v_event := workforce_log_event(auth_ev.organization_id,
    CASE WHEN p_success THEN 'workforce.tool_succeeded' ELSE 'workforce.tool_failed' END,
    p_task_id, p_agent_id, 'agent', p_agent_id,
    format('%s %s on %s', CASE WHEN p_success THEN 'Ran' ELSE 'Failed' END,
           auth_ev.metadata ->> 'tool', auth_ev.metadata ->> 'resource'),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'authorized_by_event_id', p_authorization_event_id,
      'tool', auth_ev.metadata ->> 'tool', 'resource', auth_ev.metadata ->> 'resource'),
    p_cost_usd);
  RETURN jsonb_build_object('ok', true, 'event_id', v_event);
END $$;

CREATE OR REPLACE FUNCTION workforce_complete_task(
  p_task_id uuid, p_agent_id uuid, p_outcome text, p_result text DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t tasks%ROWTYPE;
BEGIN
  PERFORM workforce_require_executor();
  IF p_outcome NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME: outcome must be completed or failed' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'task_not_found'); END IF;
  IF t.status = p_outcome AND t.agent_id = p_agent_id THEN
    RETURN jsonb_build_object('ok', true, 'already_done', true);
  END IF;
  IF t.agent_id IS DISTINCT FROM p_agent_id OR t.status <> 'working' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'task_not_in_progress');
  END IF;
  PERFORM workforce_set_actor('agent', p_agent_id);
  UPDATE tasks SET status = p_outcome, result = COALESCE(p_result, result), error = p_error,
                   completed_at = now()
  WHERE id = t.id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION workforce_add_deliverable(
  p_task_id uuid, p_agent_id uuid, p_kind text, p_uri text,
  p_checksum text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tasks%ROWTYPE;
  v_existing uuid;
  v_event uuid;
  v_id uuid;
BEGIN
  PERFORM workforce_require_executor();
  SELECT * INTO t FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'task_not_found'); END IF;
  IF t.agent_id IS DISTINCT FROM p_agent_id OR t.status NOT IN ('working', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'task_not_in_progress');
  END IF;
  SELECT id INTO v_existing FROM workforce_deliverables
  WHERE task_id = p_task_id AND kind = p_kind AND uri = btrim(p_uri);
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'deliverable_id', v_existing, 'duplicate', true);
  END IF;

  v_event := workforce_log_event(t.organization_id, 'workforce.deliverable_created', t.id, p_agent_id,
    'agent', p_agent_id, format('Deliverable (%s): %s', p_kind, btrim(p_uri)),
    jsonb_build_object('kind', p_kind, 'uri', btrim(p_uri), 'checksum', p_checksum, 'verified', false));
  INSERT INTO workforce_deliverables (organization_id, task_id, agent_id, event_id, kind, uri, checksum, metadata)
  VALUES (t.organization_id, t.id, p_agent_id, v_event, p_kind, btrim(p_uri), p_checksum,
          workforce_scrub_secrets(p_metadata))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'deliverable_id', v_id, 'event_id', v_event);
END $$;

-- Marks a deliverable verified only together with a recorded verification event.
CREATE OR REPLACE FUNCTION workforce_verify_deliverable(p_deliverable_id uuid, p_method text, p_evidence jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d workforce_deliverables%ROWTYPE; v_event uuid;
BEGIN
  PERFORM workforce_require_executor();
  IF p_method IS NULL OR btrim(p_method) = '' THEN
    RAISE EXCEPTION 'INVALID_VERIFICATION: a verification method is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM workforce_deliverables WHERE id = p_deliverable_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'deliverable_not_found'); END IF;
  IF d.verified THEN RETURN jsonb_build_object('ok', true, 'already_verified', true); END IF;
  v_event := workforce_log_event(d.organization_id, 'workforce.deliverable_verified', d.task_id, d.agent_id,
    'system', NULL, 'Deliverable verified: ' || d.uri,
    jsonb_build_object('deliverable_id', d.id, 'method', p_method, 'evidence', p_evidence));
  UPDATE workforce_deliverables SET verified = true, verified_at = now(), verified_by_event_id = v_event
  WHERE id = d.id;
  RETURN jsonb_build_object('ok', true, 'event_id', v_event);
END $$;

-- Owner/admin decision. Never callable by the service role (agents).
CREATE OR REPLACE FUNCTION workforce_decide_approval(p_approval_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ap approval_requests%ROWTYPE;
  t tasks%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_DECISION: decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;
  IF workforce_caller_role() <> 'authenticated' OR v_uid IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_FORBIDDEN: approvals require a signed-in owner or admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ap FROM approval_requests WHERE id = p_approval_id AND requested_action IS NOT NULL FOR UPDATE;
  IF NOT FOUND OR NOT workforce_is_org_member(ap.organization_id) THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  PERFORM workforce_set_actor('user', v_uid);

  IF NOT workforce_is_org_admin(ap.organization_id) THEN
    PERFORM workforce_log_event(ap.organization_id, 'workforce.approval_decision_denied', ap.task_id, ap.agent_id,
      'user', v_uid, 'Approval decision denied: owner or admin role required',
      jsonb_build_object('approval_id', ap.id, 'attempted_decision', p_decision));
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF ap.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_decided', 'status', ap.status);
  END IF;
  IF ap.expires_at <= now() THEN
    UPDATE approval_requests SET status = 'expired', approval_status = 'expired' WHERE id = ap.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;

  UPDATE approval_requests
  SET status = p_decision, approval_status = p_decision, responded_by = v_uid, responded_at = now(),
      response_notes = p_note, approval_notes = p_note, approved_by = v_uid::text,
      approved_at = CASE WHEN p_decision = 'approved' THEN now() END
  WHERE id = ap.id;
  PERFORM workforce_log_event(ap.organization_id, 'workforce.approval_decided', ap.task_id, ap.agent_id,
    'user', v_uid, format('Owner %s %s on %s', p_decision, ap.requested_action, ap.scope),
    jsonb_build_object('approval_id', ap.id, 'decision', p_decision, 'note', p_note));

  SELECT * INTO t FROM tasks WHERE id = ap.task_id FOR UPDATE;
  IF FOUND AND t.status = 'waiting_approval' THEN
    UPDATE tasks SET status = CASE WHEN p_decision = 'approved' THEN 'queued' ELSE 'cancelled' END
    WHERE id = t.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END $$;

-- Grants come only from an owner/admin (or a direct owner DB session for
-- seeding). Never from the service role, so an agent cannot grant itself.
CREATE OR REPLACE FUNCTION workforce_grant_permission(
  p_agent_id uuid, p_tool text, p_resource text DEFAULT '*',
  p_requires_approval boolean DEFAULT false, p_expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a agents%ROWTYPE;
  v_role text := workforce_caller_role();
  v_id uuid;
BEGIN
  SELECT * INTO a FROM agents WHERE id = p_agent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT (v_role = 'internal' OR (v_role = 'authenticated' AND workforce_is_org_admin(a.organization_id))) THEN
    RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: only an owner or admin can grant permissions' USING ERRCODE = '42501';
  END IF;
  IF p_tool IS NULL OR btrim(p_tool) = '' OR p_resource IS NULL OR btrim(p_resource) = '' THEN
    RAISE EXCEPTION 'INVALID_GRANT: tool and resource are required' USING ERRCODE = '22023';
  END IF;
  PERFORM workforce_set_actor(CASE WHEN v_role = 'authenticated' THEN 'user' ELSE 'system' END, auth.uid());
  UPDATE workforce_agent_permissions SET revoked_at = now()
  WHERE agent_id = p_agent_id AND tool = btrim(p_tool) AND resource = btrim(p_resource) AND revoked_at IS NULL;
  INSERT INTO workforce_agent_permissions (organization_id, agent_id, tool, resource, requires_approval, granted_by, expires_at)
  VALUES (a.organization_id, a.id, btrim(p_tool), btrim(p_resource), p_requires_approval, auth.uid(), p_expires_at)
  RETURNING id INTO v_id;
  PERFORM workforce_log_event(a.organization_id, 'workforce.permission_granted', NULL, a.id,
    CASE WHEN v_role = 'authenticated' THEN 'user' ELSE 'system' END, auth.uid(),
    format('Granted %s on %s%s', btrim(p_tool), btrim(p_resource),
           CASE WHEN p_requires_approval THEN ' (approval required)' ELSE '' END),
    jsonb_build_object('permission_id', v_id, 'tool', btrim(p_tool), 'resource', btrim(p_resource),
                       'requires_approval', p_requires_approval, 'expires_at', p_expires_at));
  RETURN jsonb_build_object('ok', true, 'permission_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION workforce_revoke_permission(p_permission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p workforce_agent_permissions%ROWTYPE; v_role text := workforce_caller_role();
BEGIN
  SELECT * INTO p FROM workforce_agent_permissions WHERE id = p_permission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT (v_role = 'internal' OR (v_role = 'authenticated' AND workforce_is_org_admin(p.organization_id))) THEN
    RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: only an owner or admin can revoke permissions' USING ERRCODE = '42501';
  END IF;
  IF p.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_revoked', true); END IF;
  UPDATE workforce_agent_permissions SET revoked_at = now() WHERE id = p.id;
  PERFORM workforce_log_event(p.organization_id, 'workforce.permission_revoked', NULL, p.agent_id,
    CASE WHEN v_role = 'authenticated' THEN 'user' ELSE 'system' END, auth.uid(),
    format('Revoked %s on %s', p.tool, p.resource),
    jsonb_build_object('permission_id', p.id, 'tool', p.tool, 'resource', p.resource));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Human/system cancel or requeue. Never starts, finishes or un-gates work.
CREATE OR REPLACE FUNCTION workforce_transition_task(p_task_id uuid, p_to_status text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t tasks%ROWTYPE; v_role text := workforce_caller_role();
BEGIN
  SELECT * INTO t FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NOT (v_role IN ('service_role', 'internal') OR (v_role = 'authenticated' AND workforce_is_org_admin(t.organization_id))) THEN
    RAISE EXCEPTION 'WORKFORCE_FORBIDDEN: owner or admin required' USING ERRCODE = '42501';
  END IF;
  IF p_to_status NOT IN ('cancelled', 'queued', 'blocked') THEN
    RAISE EXCEPTION 'TASK_TRANSITION_REJECTED: use claim, complete or approval decisions for %', p_to_status
      USING ERRCODE = '42501';
  END IF;
  IF t.status = 'waiting_approval' AND p_to_status = 'queued' THEN
    RAISE EXCEPTION 'TASK_TRANSITION_REJECTED: a waiting task is released only by an approval decision'
      USING ERRCODE = '42501';
  END IF;
  IF t.status = p_to_status THEN RETURN jsonb_build_object('ok', true, 'unchanged', true); END IF;
  PERFORM workforce_set_actor(CASE WHEN v_role = 'authenticated' THEN 'user' ELSE 'system' END, auth.uid());
  UPDATE tasks SET status = p_to_status WHERE id = t.id;  -- transition table enforced by trigger
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------------------------------------------------------------------------
-- 10. Row level security and privileges
-- ---------------------------------------------------------------------------
ALTER TABLE workforce_agent_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_deliverables      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce_task_transitions  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workforce_agent_permissions_member_read ON workforce_agent_permissions;
CREATE POLICY workforce_agent_permissions_member_read ON workforce_agent_permissions
  FOR SELECT TO authenticated USING (workforce_is_org_member(organization_id));
DROP POLICY IF EXISTS task_dependencies_member_read ON task_dependencies;
CREATE POLICY task_dependencies_member_read ON task_dependencies
  FOR SELECT TO authenticated USING (workforce_is_org_member(organization_id));
DROP POLICY IF EXISTS workforce_deliverables_member_read ON workforce_deliverables;
CREATE POLICY workforce_deliverables_member_read ON workforce_deliverables
  FOR SELECT TO authenticated USING (workforce_is_org_member(organization_id));
DROP POLICY IF EXISTS workforce_task_transitions_read ON workforce_task_transitions;
CREATE POLICY workforce_task_transitions_read ON workforce_task_transitions
  FOR SELECT TO authenticated USING (true);

-- Idempotent privilege setup; re-run after any blanket GRANT.
CREATE OR REPLACE FUNCTION workforce_apply_privileges()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REVOKE UPDATE, DELETE, TRUNCATE ON activity_events FROM anon, authenticated, service_role;
  REVOKE ALL ON workforce_agent_permissions, task_dependencies, workforce_deliverables, workforce_task_transitions
    FROM anon, authenticated, service_role;
  GRANT SELECT ON workforce_agent_permissions, task_dependencies, workforce_deliverables, workforce_task_transitions
    TO authenticated, service_role;

  REVOKE EXECUTE ON FUNCTION
    workforce_log_event(uuid, text, uuid, uuid, text, uuid, text, jsonb, numeric),
    workforce_check_action(uuid, uuid, text, text),
    workforce_create_task(uuid, uuid, text, text, text, text, text, text, uuid[], jsonb, uuid),
    workforce_claim_task(uuid, uuid),
    workforce_authorize_action(uuid, uuid, text, text),
    workforce_record_tool_result(uuid, uuid, uuid, boolean, jsonb, numeric),
    workforce_complete_task(uuid, uuid, text, text, text),
    workforce_add_deliverable(uuid, uuid, text, text, text, jsonb),
    workforce_verify_deliverable(uuid, text, jsonb),
    workforce_decide_approval(uuid, text, text),
    workforce_grant_permission(uuid, text, text, boolean, timestamptz),
    workforce_revoke_permission(uuid),
    workforce_transition_task(uuid, text, text),
    workforce_apply_privileges()
  FROM PUBLIC, anon, authenticated, service_role;

  GRANT EXECUTE ON FUNCTION
    workforce_create_task(uuid, uuid, text, text, text, text, text, text, uuid[], jsonb, uuid),
    workforce_transition_task(uuid, text, text)
  TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION
    workforce_decide_approval(uuid, text, text),
    workforce_grant_permission(uuid, text, text, boolean, timestamptz),
    workforce_revoke_permission(uuid)
  TO authenticated;
  GRANT EXECUTE ON FUNCTION
    workforce_claim_task(uuid, uuid),
    workforce_authorize_action(uuid, uuid, text, text),
    workforce_record_tool_result(uuid, uuid, uuid, boolean, jsonb, numeric),
    workforce_complete_task(uuid, uuid, text, text, text),
    workforce_add_deliverable(uuid, uuid, text, text, text, jsonb),
    workforce_verify_deliverable(uuid, text, jsonb)
  TO service_role;
END $$;

SELECT workforce_apply_privileges();
