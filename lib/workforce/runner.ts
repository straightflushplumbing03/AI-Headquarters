/**
 * Agent runner: turns queued workforce tasks into recorded, verified work.
 *
 * Every step goes through the enforced database functions (migrations
 * 025-027); this file makes no authorization decision of its own and never
 * writes a table directly:
 *
 *   1. recover tasks whose runner died           workforce_requeue_stale
 *   2. pick claimable work, highest priority      workforce_next_tasks
 *   3. claim (grant, approval, deps, kill switch) workforce_claim_task
 *      - approval needed -> attach the executor's business case and stop
 *   4. before EVERY action: authorize it           workforce_authorize_action
 *      then record what actually happened          workforce_record_tool_result
 *   5. attach deliverables, verify them, finish    workforce_add_deliverable / _verify_ / _complete_
 *
 * Runs with the service-role client (agents are the service role). The
 * database refuses grants and approval decisions from that role, so the
 * runner cannot widen an agent's access.
 */

import { createHash } from 'crypto'
import type { WorkforceClient, Denial, RiskLevel, DeliverableKind } from './service'
import {
  claimTask, authorizeAction, recordToolResult, completeTask,
  addDeliverable, verifyDeliverable, justifyApproval, toWorkforceError,
} from './service'

export interface RunnableTask {
  id: string
  organization_id: string
  agent_id: string
  title: string
  description: string | null
  priority: string
  required_tool: string
  required_resource: string
  input: Record<string, unknown> | null
  attempt: number
}

export interface BusinessCase {
  businessJustification: string
  expectedBenefit: string
  declaredRisk: RiskLevel
  estimatedCostUsd: number
  rollbackPlan: string
}

export interface ActionOutcome<T> {
  value: T
  metadata?: Record<string, unknown>
  costUsd?: number
}

export interface ExecutorContext {
  task: RunnableTask
  client: WorkforceClient
  /**
   * Runs one action. Authorizes it first (throws ActionRefused if the
   * database says no), then records success or failure with its cost.
   */
  act<T>(tool: string, resource: string, fn: () => Promise<ActionOutcome<T>>): Promise<T>
  /** Records a deliverable produced by this task. */
  deliver(d: { kind: DeliverableKind; uri: string; content?: string; metadata?: Record<string, unknown> }): Promise<string | null>
}

export interface ExecutorResult {
  /** Stored on the task; deliverables with `content` are verified against it. */
  result: string
}

export interface Executor {
  tool: string
  /** Used when the agent's grant requires approval for this tool. */
  businessCase?(task: RunnableTask): BusinessCase | null
  run(ctx: ExecutorContext): Promise<ExecutorResult>
}

export class ActionRefused extends Error {
  constructor(readonly denial: Denial) {
    super(`Action refused: ${denial.reason}`)
    this.name = 'ActionRefused'
  }
}

export type TaskOutcome =
  | 'completed' | 'failed' | 'waiting_approval' | 'denied' | 'no_executor' | 'skipped'

export interface RunReport {
  recovered: { requeued: number; failed: number }
  scheduled: { created: number; week?: string }
  considered: number
  outcomes: Array<{ taskId: string; tool: string; outcome: TaskOutcome; detail?: string }>
}

export const sha256 = (s: string) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex')

async function rpc<T>(client: WorkforceClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw toWorkforceError(error)
  return data as T
}

/** Errors are stored on tasks and events; keep them short and free of stack traces. */
function safeMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.split('\n')[0].slice(0, 300)
}

export async function runWorkforceBatch(
  client: WorkforceClient,
  executors: Executor[],
  opts: { limit?: number; staleMinutes?: number; maxAttempts?: number; recurringTools?: string[] } = {},
): Promise<RunReport> {
  const registry = new Map(executors.map((e) => [e.tool, e]))

  const recovered = await rpc<{ requeued: number; failed: number }>(client, 'workforce_requeue_stale', {
    p_stale_minutes: opts.staleMinutes ?? 30,
    p_max_attempts: opts.maxAttempts ?? 3,
  })
  // Weekly work the owner granted (read-only tools only; see migration 027).
  const scheduled = opts.recurringTools?.length
    ? await rpc<{ created: number; week: string }>(client, 'workforce_schedule_recurring', { p_tools: opts.recurringTools })
    : { created: 0 }
  const tasks = await rpc<RunnableTask[]>(client, 'workforce_next_tasks', { p_limit: opts.limit ?? 5 })

  const report: RunReport = { recovered, scheduled, considered: tasks.length, outcomes: [] }
  for (const task of tasks) {
    const executor = registry.get(task.required_tool)
    if (!executor) {
      // Left queued, untouched: an executor for this tool may ship later.
      report.outcomes.push({ taskId: task.id, tool: task.required_tool, outcome: 'no_executor' })
      continue
    }
    report.outcomes.push(await runOne(client, executor, task))
  }
  return report
}

async function runOne(client: WorkforceClient, executor: Executor, task: RunnableTask) {
  const base = { taskId: task.id, tool: task.required_tool }

  const claim = await claimTask(client, task.id, task.agent_id)
  if (!claim.ok) {
    if (claim.reason === 'approval_required') {
      const approvalId = String((claim as Denial).approval_id ?? '')
      const bc = executor.businessCase?.(task)
      if (approvalId && bc) {
        await justifyApproval(client, { approvalId, agentId: task.agent_id, ...bc })
      }
      return { ...base, outcome: 'waiting_approval' as const, detail: approvalId || undefined }
    }
    if (claim.reason === 'not_claimable') return { ...base, outcome: 'skipped' as const, detail: claim.reason }
    return { ...base, outcome: 'denied' as const, detail: claim.reason }
  }

  const pending: Array<{ id: string; content: string }> = []
  const ctx: ExecutorContext = {
    task,
    client,
    async act(tool, resource, fn) {
      const auth = await authorizeAction(client, task.id, task.agent_id, tool, resource)
      if (!auth.ok) throw new ActionRefused(auth as Denial)
      const authorizationEventId = (auth as { authorization_event_id: string }).authorization_event_id
      try {
        const out = await fn()
        await recordToolResult(client, {
          taskId: task.id, agentId: task.agent_id, authorizationEventId,
          success: true, metadata: out.metadata, costUsd: out.costUsd,
        })
        return out.value
      } catch (e) {
        await recordToolResult(client, {
          taskId: task.id, agentId: task.agent_id, authorizationEventId,
          success: false, metadata: { error: safeMessage(e) },
        })
        throw e
      }
    },
    async deliver(d) {
      const r = await addDeliverable(client, {
        taskId: task.id, agentId: task.agent_id, kind: d.kind, uri: d.uri,
        checksum: d.content !== undefined ? sha256(d.content) : undefined, metadata: d.metadata,
      })
      if (!r.ok) return null
      const id = (r as { deliverable_id: string }).deliverable_id
      if (d.content !== undefined) pending.push({ id, content: d.content })
      return id
    },
  }

  try {
    const { result } = await executor.run(ctx)
    const done = await completeTask(client, task.id, task.agent_id, 'completed', result)
    if (!done.ok) return { ...base, outcome: 'failed' as const, detail: (done as Denial).reason }
    // Verify each deliverable against what was actually stored on the task.
    for (const p of pending) {
      if (p.content === result) {
        await verifyDeliverable(client, p.id, 'checksum_match', { checksum: sha256(result), stored_on: 'tasks.result' })
      }
    }
    return { ...base, outcome: 'completed' as const }
  } catch (e) {
    if (e instanceof ActionRefused && e.denial.reason === 'approval_required') {
      // The database has already moved the task to waiting_approval.
      const bc = executor.businessCase?.(task)
      const approvalId = String(e.denial.approval_id ?? '')
      if (approvalId && bc) await justifyApproval(client, { approvalId, agentId: task.agent_id, ...bc })
      return { ...base, outcome: 'waiting_approval' as const, detail: approvalId || undefined }
    }
    await completeTask(client, task.id, task.agent_id, 'failed', undefined, safeMessage(e))
    return { ...base, outcome: 'failed' as const, detail: safeMessage(e) }
  }
}
