/**
 * Sprint 3.1: Hardened Safe Action Execution Engine
 *
 * FAIL-CLOSED enforcement for autonomous actions.
 * Client input may only identify an action by actionId.
 * All authoritative data (risk, approval status, agent, mode) is loaded server-side.
 *
 * Pipeline order (enforced):
 *   authentication → org membership → authoritative action/decision load →
 *   risk mapping → operating mode (persistent) → approval → authorization →
 *   global/org/agent kill switches → budget → atomic idempotency claim →
 *   execute internal handler → record result → audit
 *
 * Risk mapping (Phase 6 schema values):
 *   low      → LOW            (level_1, autonomous)
 *   medium   → CONTROLLED     (level_2, controlled)
 *   high     → APPROVAL_REQUIRED (level_3, approval_required)
 *   critical → PROHIBITED     (level_4, human_only — never autonomous)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { AICostController } from '@/lib/ai/cost-controller'
import type { UserRole } from '@/lib/auth/permissions'
import { OperatingModeManager, OperatingMode } from '@/lib/sprint3/operating-modes'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ActionRiskAuthority = 'level_1' | 'level_2' | 'level_3' | 'level_4'

/** Only the actionId is trusted from the caller. Everything else is loaded server-side. */
export interface ActionExecutionRequest {
  actionId: string
  userId: string          // from authenticated session — not client body
}

export interface ExecutionCheckResult {
  allowed: boolean
  blockReason?: string
  passedChecks: string[]
  failedChecks: string[]
}

/** Authoritative action record loaded from DB */
interface AuthoritativeAction {
  id: string
  organization_id: string
  decision_id: string | null
  action_type: string
  title: string
  description: string | null
  authorization_level: ActionRiskAuthority
  risk_level: RiskLevel
  execution_status: string
  idempotency_key: string | null
  executed_by_agent_id: string | null
  payload: Record<string, any>
}

/** Authoritative decision record loaded from DB */
interface AuthoritativeDecision {
  id: string
  organization_id: string
  approval_required: boolean
  approval_status: string
  risk_level: RiskLevel
  approval_level: string | null
}

/** Authoritative approval record loaded from DB */
interface AuthoritativeApproval {
  id: string
  approval_status: string
  response_deadline: string | null
}

export class ActionExecutionEngine {
  private costController: AICostController
  private modeManager: OperatingModeManager

  constructor(private supabase: SupabaseClient) {
    this.costController = new AICostController(supabase)
    this.modeManager = new OperatingModeManager(supabase)
  }

  /**
   * Main entry point: Execute action with full safety checks.
   * FAIL-CLOSED: any failure blocks execution.
   *
   * @param actionId  Identifies the action to execute (only trusted client input)
   * @param userId    Authenticated user id from the session (never from client body)
   */
  async executeAction(actionId: string, userId: string): Promise<{
    success: boolean
    actionId: string
    result?: Record<string, any>
    error?: string
  }> {
    const passedChecks: string[] = []
    const failedChecks: string[] = []

    const blockWith = async (reason: string, check: string) => {
      failedChecks.push(check)
      await this.audit(null, userId, 'action_execution_blocked', `action:${actionId}`, reason, { failedChecks })
      return { success: false, actionId, error: reason }
    }

    // ── 1. Authentication ────────────────────────────────────────────────────
    if (!userId || !actionId) {
      return blockWith('User not authenticated or actionId missing', 'authentication_missing')
    }
    passedChecks.push('authentication')

    // ── 2. Authoritative action load ─────────────────────────────────────────
    const action = await this.loadAction(actionId)
    if (!action) {
      return blockWith('Action not found', 'action_not_found')
    }
    passedChecks.push('action_loaded')

    const orgId = action.organization_id

    // ── 3. Organisation membership (cross-tenant guard) ───────────────────────
    const memberRole = await this.getOrgRole(userId, orgId)
    if (!memberRole) {
      failedChecks.push('organization_unauthorized')
      await this.audit(orgId, userId, 'action_execution_blocked', `action:${actionId}`, 'Cross-tenant access denied', { failedChecks })
      return { success: false, actionId, error: 'Not a member of the action\'s organization' }
    }
    passedChecks.push('organization_access')

    // ── 4. Authoritative decision load ───────────────────────────────────────
    let decision: AuthoritativeDecision | null = null
    if (action.decision_id) {
      decision = await this.loadDecision(action.decision_id, orgId)
      if (!decision) {
        failedChecks.push('decision_not_found')
        await this.audit(orgId, userId, 'action_execution_blocked', `action:${actionId}`, 'Linked decision not found', { failedChecks })
        return { success: false, actionId, error: 'Linked decision not found' }
      }
    }
    passedChecks.push('decision_loaded')

    // ── 5. Risk mapping (authoritative from DB, never from client) ───────────
    const riskLevel: RiskLevel = action.risk_level
    const authLevel: ActionRiskAuthority = action.authorization_level

    // PROHIBITED: critical risk never executes autonomously
    if (riskLevel === 'critical') {
      return { ...(await blockWith('Critical/prohibited actions cannot execute autonomously', 'prohibited_risk')), actionId }
    }
    passedChecks.push('risk_mapped')

    // ── 6. Kill switches (persistent DB — global, org, agent) ─────────────────
    // Checked before operating mode so a kill switch always blocks hard,
    // regardless of mode.
    const ksCheck = await this.checkKillSwitchesPersistent(orgId, action.executed_by_agent_id)
    if (!ksCheck.allowed) {
      failedChecks.push('kill_switch_active')
      await this.audit(orgId, userId, 'kill_switch_blocked_execution', `action:${actionId}`, ksCheck.reason!, { failedChecks })
      return { success: false, actionId, error: ksCheck.reason }
    }
    passedChecks.push('kill_switches_clear')

    // ── 7. Authoritative operating mode (from DB, never from client) ─────────
    const operatingMode: OperatingMode = await this.modeManager.getModePersistent(orgId)
    passedChecks.push('operating_mode_loaded')

    // Shadow mode: record "would execute" and stop
    if (operatingMode === 'shadow') {
      await this.audit(orgId, userId, 'action_shadow_mode', `action:${actionId}`, 'Shadow mode — no handler invoked', { passedChecks, operatingMode })
      return { success: true, actionId, result: { executed: false, reason: 'Shadow mode — no external action executed' } }
    }

    // ── 7. Approval check ────────────────────────────────────────────────────
    const needsApproval = decision?.approval_required ?? true // fail closed: assume required
    const authLevelNum = this.authLevelToNum(authLevel)
    const modeRequiresApproval = this.modeManager.requiresApproval(operatingMode, authLevelNum, riskLevel)

    if (needsApproval || modeRequiresApproval) {
      const approval = decision ? await this.loadApproval(decision.id, orgId) : null
      const approvalCheck = this.checkApprovalRecord(approval)
      if (!approvalCheck.valid) {
        failedChecks.push('approval_invalid')
        await this.audit(orgId, userId, 'action_execution_blocked', `action:${actionId}`, approvalCheck.reason!, { failedChecks })
        return { success: false, actionId, error: approvalCheck.reason }
      }
      passedChecks.push('approval_valid')
    } else {
      passedChecks.push('approval_not_required')
    }

    // ── 8. Authorization (role check against DB role, not client-supplied) ────
    const permCheck = this.checkPermission(memberRole, authLevel)
    if (!permCheck) {
      return { ...(await blockWith('Insufficient permissions for this action', 'insufficient_permissions')), actionId }
    }
    passedChecks.push('permissions')

    // ── 9. Budget ────────────────────────────────────────────────────────────
    const estimatedCost = (action.payload?.estimatedCost as number | undefined) ?? 0
    if (estimatedCost > 0) {
      // Use real agent id from the action record; never 'action-engine'
      const agentIdForBudget = action.executed_by_agent_id ?? action.id
      const budgetCheck = await this.costController.checkBudget(orgId, agentIdForBudget, estimatedCost)
      if (!budgetCheck.allowed) {
        failedChecks.push('budget_exceeded')
        await this.audit(orgId, userId, 'budget_blocked_execution', `action:${actionId}`, budgetCheck.reason!, { failedChecks })
        return { success: false, actionId, error: budgetCheck.reason }
      }
      passedChecks.push('budget_available')
    } else {
      passedChecks.push('no_budget_cost')
    }

    // ── 11. Atomic idempotency claim ──────────────────────────────────────────
    const idempKey = action.idempotency_key
    if (!idempKey) {
      return { ...(await blockWith('Action has no idempotency key', 'idempotency_key_missing')), actionId }
    }
    const claimResult = await this.atomicClaim(actionId, orgId)
    if (!claimResult.claimed) {
      failedChecks.push('duplicate_execution')
      await this.audit(orgId, userId, 'duplicate_execution_blocked', `action:${actionId}`, claimResult.reason!, { failedChecks })
      return { success: false, actionId, error: claimResult.reason }
    }
    passedChecks.push('idempotency_claimed')

    // ── 12. Execute internal mocked handler ───────────────────────────────────
    await this.audit(orgId, userId, 'execution_started', `action:${actionId}`, 'Execution started', { passedChecks })
    try {
      const result = await this.performAction(action)
      await this.recordActionExecution(actionId, orgId, result, 'completed')
      await this.audit(orgId, userId, 'execution_completed', `action:${actionId}`, 'Execution completed', { result })
      return { success: true, actionId, result }
    } catch (err: any) {
      const msg = err?.message ?? 'Execution failed'
      await this.recordActionExecution(actionId, orgId, { error: msg }, 'failed', msg)
      await this.audit(orgId, userId, 'execution_failed', `action:${actionId}`, msg, { error: msg })
      return { success: false, actionId, error: msg }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async loadAction(actionId: string): Promise<AuthoritativeAction | null> {
    const { data } = await this.supabase
      .from('autonomous_actions')
      .select('id, organization_id, decision_id, action_type, title, description, authorization_level, risk_level, execution_status, idempotency_key, executed_by_agent_id, payload')
      .eq('id', actionId)
      .single()
    return data ?? null
  }

  private async loadDecision(decisionId: string, orgId: string): Promise<AuthoritativeDecision | null> {
    const { data } = await this.supabase
      .from('autonomous_decisions')
      .select('id, organization_id, approval_required, approval_status, risk_level, approval_level')
      .eq('id', decisionId)
      .eq('organization_id', orgId)
      .single()
    return data ?? null
  }

  private async loadApproval(decisionId: string, orgId: string): Promise<AuthoritativeApproval | null> {
    const { data } = await this.supabase
      .from('approval_requests')
      .select('id, approval_status, response_deadline')
      .eq('decision_id', decisionId)
      .eq('organization_id', orgId)
      .single()
    return data ?? null
  }

  private checkApprovalRecord(approval: AuthoritativeApproval | null): { valid: boolean; reason?: string } {
    if (!approval) return { valid: false, reason: 'No approval request found for this decision' }
    if (approval.approval_status !== 'approved') {
      return { valid: false, reason: `Approval not approved (status: ${approval.approval_status})` }
    }
    if (approval.response_deadline && new Date() > new Date(approval.response_deadline)) {
      return { valid: false, reason: 'Approval has expired' }
    }
    return { valid: true }
  }

  private async getOrgRole(userId: string, orgId: string): Promise<UserRole | null> {
    const { data } = await this.supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', orgId)
      .single()
    return (data?.role as UserRole) ?? null
  }

  private checkPermission(role: UserRole, authLevel: ActionRiskAuthority): boolean {
    if (role === 'viewer') return false
    if (role === 'member' && authLevel !== 'level_1') return false
    return role === 'admin' || role === 'owner' || authLevel === 'level_1'
  }

  /**
   * Persistent kill-switch checks (DB-backed, not in-memory).
   * Checks global (all orgs paused), org, and agent stop.
   * Fails closed on DB errors.
   */
  private async checkKillSwitchesPersistent(
    orgId: string,
    agentId: string | null
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      // Global stop: any record with paused=true and global scope marker
      // In this schema, global stop sets all orgs paused via AICostController.
      // We check the org row (set by global and org-level kill switches).
      const { data: orgLimits } = await this.supabase
        .from('ai_usage_limits')
        .select('paused, pause_reason')
        .eq('organization_id', orgId)
        .single()

      if (orgLimits?.paused) {
        return { allowed: false, reason: orgLimits.pause_reason || 'Organization or global kill switch active' }
      }

      // Agent stop: check agent.active
      if (agentId) {
        const { data: agent } = await this.supabase
          .from('agents')
          .select('active')
          .eq('id', agentId)
          .single()
        if (agent && !agent.active) {
          return { allowed: false, reason: 'Agent kill switch active' }
        }
      }

      return { allowed: true }
    } catch {
      // Fail closed if DB is unavailable
      return { allowed: false, reason: 'Kill-switch state could not be verified — execution blocked (fail-closed)' }
    }
  }

  /**
   * Atomically claim execution by transitioning action to 'executing'.
   * Uses a conditional UPDATE so only one request wins.
   */
  private async atomicClaim(actionId: string, orgId: string): Promise<{ claimed: boolean; reason?: string }> {
    // Transition allowed from: queued, scheduled
    // Already completed/cancelled/executing → block
    const { data, error } = await this.supabase
      .from('autonomous_actions')
      .update({ execution_status: 'executing', started_at: new Date().toISOString() })
      .eq('id', actionId)
      .eq('organization_id', orgId)
      .in('execution_status', ['queued', 'scheduled'])
      .select('id')
      .single()

    if (error || !data) {
      // Determine why — check current status
      const { data: current } = await this.supabase
        .from('autonomous_actions')
        .select('execution_status')
        .eq('id', actionId)
        .single()

      if (current?.execution_status === 'completed') {
        return { claimed: false, reason: 'Action already completed successfully (duplicate blocked)' }
      }
      if (current?.execution_status === 'executing') {
        return { claimed: false, reason: 'Action already executing (concurrent duplicate blocked)' }
      }
      if (current?.execution_status === 'cancelled' || current?.execution_status === 'failed') {
        return { claimed: false, reason: `Action cannot execute in status: ${current.execution_status}` }
      }
      return { claimed: false, reason: 'Could not claim execution — action in non-executable state' }
    }

    return { claimed: true }
  }

  /**
   * Internal mocked action handler.
   * Real external integrations remain disabled.
   * Only handles synthetic/internal action types.
   */
  private async performAction(action: AuthoritativeAction): Promise<Record<string, any>> {
    const internalHandlers: Record<string, (a: AuthoritativeAction) => Record<string, any>> = {
      generate_report: (a) => ({ report: `Mock report for: ${a.title}`, generatedAt: new Date().toISOString() }),
      create_task:     (a) => ({ taskCreated: true, title: a.title }),
      send_alert:      (a) => ({ alertSent: true, description: a.description }),
      update_priority: (a) => ({ priorityUpdated: true }),
      custom:          (a) => ({ handled: true, actionType: a.action_type }),
    }

    const handler = internalHandlers[action.action_type] ?? internalHandlers['custom']
    return {
      ...handler(action),
      executedAt: new Date().toISOString(),
      actionType: action.action_type,
      status: 'success',
    }
  }

  private async recordActionExecution(
    actionId: string,
    orgId: string,
    result: Record<string, any>,
    status: 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    await this.supabase
      .from('autonomous_actions')
      .update({
        execution_status: status,
        completed_at: new Date().toISOString(),
        result,
        success: status === 'completed',
        last_error: error ?? null,
      })
      .eq('id', actionId)
      .eq('organization_id', orgId)
  }

  private async audit(
    orgId: string | null,
    userId: string,
    action: string,
    resource: string,
    details: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await this.supabase.from('audit_logs').insert({
        organization_id: orgId,
        user_id: userId,
        action,
        resource,
        details,
        metadata: metadata ?? {},
        timestamp: new Date().toISOString(),
      })
    } catch {
      // Audit failure must not create a safety bypass
    }
  }

  private authLevelToNum(level: ActionRiskAuthority): 1 | 2 | 3 | 4 {
    const map: Record<ActionRiskAuthority, 1 | 2 | 3 | 4> = {
      level_1: 1, level_2: 2, level_3: 3, level_4: 4,
    }
    return map[level] ?? 4
  }
}
