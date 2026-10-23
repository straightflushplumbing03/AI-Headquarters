/**
 * Phase A workforce service.
 *
 * Thin, typed wrappers over the workforce_* database functions in
 * supabase/migrations/025_phase_a_workforce_core.sql. All rules (permissions,
 * approvals, dependencies, transitions, dedupe, append-only events) are
 * enforced in the database; nothing here is an authorization decision.
 *
 * Two kinds of caller:
 * - Owner side (signed-in user client): createTask, decideApproval,
 *   grant/revokePermission, transitionTask, getTaskTimeline.
 * - Executor side (service-role client, i.e. an agent run): claimTask,
 *   authorizeAction, recordToolResult, completeTask, addDeliverable,
 *   verifyDeliverable. The database refuses these from user sessions, and
 *   refuses grants and approval decisions from the service role.
 */

export interface RpcResult<T = unknown> {
  data: T | null
  error: { message: string; code?: string } | null
}

/** The subset of the Supabase client this module needs. */
export interface WorkforceClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult<any>>
  from(table: string): any
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus =
  | 'queued' | 'blocked' | 'waiting_approval' | 'working'
  | 'completed' | 'failed' | 'cancelled'
export type DeliverableKind = 'file' | 'report' | 'commit' | 'pull_request' | 'page' | 'other'

/** A refusal from the engine, recorded as an event, returned as data. */
export interface Denial {
  ok: false
  reason: string
  [key: string]: unknown
}

export class WorkforceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
    this.name = 'WorkforceError'
  }
}

const ERROR_MAP: Array<[RegExp, number, string]> = [
  [/WORKFORCE_FORBIDDEN|APPROVAL_FORBIDDEN|EVENT_FORBIDDEN|permission denied/i, 403, 'forbidden'],
  [/NOT_FOUND/i, 404, 'not_found'],
  [/violates check constraint/i, 400, 'invalid_request'],
  [/TASK_TRANSITION_REJECTED|TASK_FIELD_PROTECTED|EVENT_IMMUTABLE/i, 409, 'conflict'],
  [/INVALID_[A-Z]+/i, 400, 'invalid_request'],
]

/** Maps a database error to an HTTP-friendly error without leaking internals. */
export function toWorkforceError(error: { message: string }): WorkforceError {
  for (const [pattern, status, code] of ERROR_MAP) {
    if (pattern.test(error.message)) {
      // Keep the engine's own message (it names the rule), drop SQL context.
      const message = error.message.split('\n')[0].replace(/^ERROR:\s*/, '')
      return new WorkforceError(message, status, code)
    }
  }
  return new WorkforceError('Workforce request failed', 500, 'internal')
}

async function call<T>(client: WorkforceClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw toWorkforceError(error)
  return data as T
}

// ---------------------------------------------------------------- owner side

export interface CreateTaskInput {
  organizationId: string
  agentId: string
  title: string
  requiredTool: string
  requiredResource?: string
  description?: string
  priority?: TaskPriority
  dedupeKey?: string
  dependsOn?: string[]
  input?: Record<string, unknown>
  /** Executor only: the agent delegating this task. Ignored for users by the DB. */
  assignedByAgentId?: string
}

export type CreateTaskResult =
  | { ok: true; taskId: string; duplicate: false }
  | { ok: false; taskId: string; duplicate: true }

export async function createTask(client: WorkforceClient, input: CreateTaskInput): Promise<CreateTaskResult> {
  const r = await call<{ ok: boolean; task_id: string; reason?: string }>(client, 'workforce_create_task', {
    p_organization_id: input.organizationId,
    p_agent_id: input.agentId,
    p_title: input.title,
    p_required_tool: input.requiredTool,
    p_required_resource: input.requiredResource ?? '*',
    p_description: input.description ?? null,
    p_priority: input.priority ?? 'medium',
    p_dedupe_key: input.dedupeKey ?? null,
    p_depends_on: input.dependsOn ?? [],
    p_input: input.input ?? null,
    p_assigned_by_agent_id: input.assignedByAgentId ?? null,
  })
  return r.ok
    ? { ok: true, taskId: r.task_id, duplicate: false }
    : { ok: false, taskId: r.task_id, duplicate: true }
}

export async function decideApproval(
  client: WorkforceClient, approvalId: string, decision: 'approved' | 'rejected', note?: string,
): Promise<{ ok: true; decision: string } | Denial> {
  return call(client, 'workforce_decide_approval', {
    p_approval_id: approvalId, p_decision: decision, p_note: note ?? null,
  })
}

export async function grantPermission(
  client: WorkforceClient,
  agentId: string, tool: string, resource = '*', requiresApproval = false, expiresAt?: string,
): Promise<{ ok: true; permission_id: string }> {
  return call(client, 'workforce_grant_permission', {
    p_agent_id: agentId, p_tool: tool, p_resource: resource,
    p_requires_approval: requiresApproval, p_expires_at: expiresAt ?? null,
  })
}

export async function revokePermission(client: WorkforceClient, permissionId: string): Promise<{ ok: true }> {
  return call(client, 'workforce_revoke_permission', { p_permission_id: permissionId })
}

export async function transitionTask(
  client: WorkforceClient, taskId: string, to: 'cancelled' | 'queued' | 'blocked', reason?: string,
): Promise<{ ok: true }> {
  return call(client, 'workforce_transition_task', { p_task_id: taskId, p_to_status: to, p_reason: reason ?? null })
}

export interface TaskTimeline {
  task: Record<string, any>
  events: Record<string, any>[]
  deliverables: Record<string, any>[]
  approvals: Record<string, any>[]
  dependencies: Record<string, any>[]
}

/**
 * Reads a task and its full history. Row-level security decides visibility:
 * a task outside the caller's organizations reads as not found.
 */
export async function getTaskTimeline(client: WorkforceClient, taskId: string): Promise<TaskTimeline | null> {
  const task = await client.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (task.error) throw toWorkforceError(task.error)
  if (!task.data) return null

  const [events, deliverables, approvals, dependencies] = await Promise.all([
    client.from('activity_events').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    client.from('workforce_deliverables').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    client.from('approval_requests')
      .select('id, status, requested_action, scope, requested_by_agent_id, created_at, expires_at, responded_by, responded_at, response_notes')
      .eq('task_id', taskId).not('requested_action', 'is', null).order('created_at', { ascending: true }),
    client.from('task_dependencies').select('depends_on_task_id').eq('task_id', taskId),
  ])
  for (const r of [events, deliverables, approvals, dependencies]) {
    if (r.error) throw toWorkforceError(r.error)
  }
  return {
    task: task.data,
    events: events.data ?? [],
    deliverables: deliverables.data ?? [],
    approvals: approvals.data ?? [],
    dependencies: dependencies.data ?? [],
  }
}

// ---------------------------------------------------------------- executor side

export async function claimTask(client: WorkforceClient, taskId: string, agentId: string):
  Promise<{ ok: true; task_id: string; already_claimed?: boolean } | Denial> {
  return call(client, 'workforce_claim_task', { p_task_id: taskId, p_agent_id: agentId })
}

/** Must be called immediately before every tool call; never cache the result. */
export async function authorizeAction(
  client: WorkforceClient, taskId: string, agentId: string, tool: string, resource: string,
): Promise<{ ok: true; authorization_event_id: string } | Denial> {
  return call(client, 'workforce_authorize_action', {
    p_task_id: taskId, p_agent_id: agentId, p_tool: tool, p_resource: resource,
  })
}

export async function recordToolResult(
  client: WorkforceClient,
  args: { taskId: string; agentId: string; authorizationEventId: string; success: boolean;
          metadata?: Record<string, unknown>; costUsd?: number },
): Promise<{ ok: true; event_id: string; duplicate?: boolean } | Denial> {
  return call(client, 'workforce_record_tool_result', {
    p_task_id: args.taskId, p_agent_id: args.agentId,
    p_authorization_event_id: args.authorizationEventId, p_success: args.success,
    p_metadata: args.metadata ?? {}, p_cost_usd: args.costUsd ?? null,
  })
}

export async function completeTask(
  client: WorkforceClient, taskId: string, agentId: string,
  outcome: 'completed' | 'failed', result?: string, error?: string,
): Promise<{ ok: true } | Denial> {
  return call(client, 'workforce_complete_task', {
    p_task_id: taskId, p_agent_id: agentId, p_outcome: outcome,
    p_result: result ?? null, p_error: error ?? null,
  })
}

export async function addDeliverable(
  client: WorkforceClient,
  args: { taskId: string; agentId: string; kind: DeliverableKind; uri: string;
          checksum?: string; metadata?: Record<string, unknown> },
): Promise<{ ok: true; deliverable_id: string; event_id?: string; duplicate?: boolean } | Denial> {
  return call(client, 'workforce_add_deliverable', {
    p_task_id: args.taskId, p_agent_id: args.agentId, p_kind: args.kind, p_uri: args.uri,
    p_checksum: args.checksum ?? null, p_metadata: args.metadata ?? {},
  })
}

/** Only call after actually checking the deliverable (e.g. checksum, HTTP 200, PR exists). */
export async function verifyDeliverable(
  client: WorkforceClient, deliverableId: string, method: string, evidence: Record<string, unknown> = {},
): Promise<{ ok: true; event_id?: string } | Denial> {
  return call(client, 'workforce_verify_deliverable', {
    p_deliverable_id: deliverableId, p_method: method, p_evidence: evidence,
  })
}

// ---------------------------------------------------------------- delegated approval (migration 026)

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type PolicyCategory =
  | 'general' | 'website' | 'seo' | 'content' | 'advertising' | 'spending' | 'legal'
  | 'customer_data' | 'security' | 'production' | 'irreversible'

/** Owner/admin only. Spending, legal, customer data, security, production and irreversible stay owner-only. */
export async function setActionPolicy(
  client: WorkforceClient,
  args: { organizationId: string; tool: string; resource?: string; riskFloor: RiskLevel; ownerOnly: boolean; category?: PolicyCategory },
): Promise<{ ok: true; policy_id: string }> {
  return call(client, 'workforce_set_action_policy', {
    p_organization_id: args.organizationId, p_tool: args.tool, p_resource: args.resource ?? '*',
    p_risk_floor: args.riskFloor, p_owner_only: args.ownerOnly, p_category: args.category ?? 'general',
  })
}

/** Owner/admin only. Agents can be delegated low or medium risk authority, never more. */
export async function grantApprovalDelegation(
  client: WorkforceClient,
  args: { agentId: string; tool: string; resource?: string; maxRisk: 'low' | 'medium'; maxCostUsd: number; expiresAt?: string },
): Promise<{ ok: true; delegation_id: string }> {
  return call(client, 'workforce_grant_approval_delegation', {
    p_delegate_agent_id: args.agentId, p_tool: args.tool, p_resource: args.resource ?? '*',
    p_max_risk: args.maxRisk, p_max_cost_usd: args.maxCostUsd, p_expires_at: args.expiresAt ?? null,
  })
}

export async function revokeApprovalDelegation(client: WorkforceClient, delegationId: string): Promise<{ ok: true }> {
  return call(client, 'workforce_revoke_approval_delegation', { p_delegation_id: delegationId })
}

/** Executor: the requesting agent attaches its business case to a pending approval. */
export async function justifyApproval(
  client: WorkforceClient,
  args: { approvalId: string; agentId: string; businessJustification: string; expectedBenefit: string;
          declaredRisk: RiskLevel; estimatedCostUsd: number; rollbackPlan: string },
): Promise<{ ok: true } | Denial> {
  return call(client, 'workforce_justify_approval', {
    p_approval_id: args.approvalId, p_agent_id: args.agentId,
    p_business_justification: args.businessJustification, p_expected_benefit: args.expectedBenefit,
    p_declared_risk: args.declaredRisk, p_estimated_cost_usd: args.estimatedCostUsd, p_rollback_plan: args.rollbackPlan,
  })
}

/**
 * Executor: a delegated reviewer agent decides. Anything outside its configured
 * authority comes back as { ok: false, reason: 'escalated', detail } and is left
 * pending for the owner.
 */
export async function agentReviewApproval(
  client: WorkforceClient,
  args: { approvalId: string; reviewerAgentId: string; decision: 'approved' | 'rejected' | 'escalated'; reviewNotes: string },
): Promise<{ ok: true; decision: string; effective_risk: RiskLevel } | Denial> {
  return call(client, 'workforce_agent_review_approval', {
    p_approval_id: args.approvalId, p_reviewer_agent_id: args.reviewerAgentId,
    p_decision: args.decision, p_review_notes: args.reviewNotes,
  })
}
