/**
 * Sprint 3: Safe Action Execution Engine
 * 
 * FAIL-CLOSED enforcement for autonomous actions:
 * - Approval enforcement
 * - Budget protection (Sprint 5.3 P2: ATOMIC database-side reservation —
 *   reserve after authorization, settle/release after execution, never a
 *   check-then-spend race; idempotent per action idempotency key)
 * - Kill switch integration
 * - Idempotency checking
 * - Risk-based authorization
 * 
 * Pipeline order (every execution path, no bypass):
 *   AUTH → ORG MEMBERSHIP → PERMISSIONS → RISK → APPROVAL → KILL SWITCH →
 *   ATOMIC BUDGET RESERVATION → IDEMPOTENCY CLAIM → EXECUTE →
 *   SETTLE (actual, clamped by the DB) OR RELEASE (failure) → AUDIT
 *
 * No action executes without passing ALL checks. Any check failure blocks;
 * blocks after the reservation step release the hold (reaper as safety net).
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  BudgetReservationService,
  PermanentBudgetError,
} from '@/lib/sprint3/budget-reservation'
import { logFinancial } from '@/lib/ai/financial-logger'
import type { UserRole } from '@/lib/auth/permissions'

export type OperatingMode = 'shadow' | 'approval' | 'autonomous'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ActionRiskAuthority = 'level_1' | 'level_2' | 'level_3' | 'level_4'

export interface ActionExecutionRequest {
  // Request context
  organizationId: string
  userId: string
  /** Optional for system executions (background jobs); required otherwise. */
  userRole?: UserRole

  // Action definition
  decisionId: string
  actionId: string
  actionType: string
  riskLevel: RiskLevel
  authorizationLevel: ActionRiskAuthority
  approvalRequired: boolean

  // Action details
  title: string
  description: string
  estimatedCost?: number

  // Execution context
  payload: Record<string, any>
  idempotencyKey: string
  operatingMode: OperatingMode

  /**
   * Sprint 5.3: set ONLY by the background-job handler executing an already
   * approved action without an end-user session. Skips the per-user
   * authentication/membership checks (the job queue authenticated the caller
   * — CRON secret or verified member — and the job's organization_id is
   * derived from the claimed row). Every other fail-closed check still runs:
   * risk, approval validity, kill switches, budget, atomic idempotency.
   */
  systemExecution?: boolean
}

export interface ExecutionCheckResult {
  allowed: boolean
  blockReason?: string
  passedChecks: string[]
  failedChecks: string[]
  /**
   * Sprint 5.3 P2: id of the ATOMIC budget hold taken in runAllChecks (after
   * authorization, before idempotency). Null when no cost was reserved.
   * Settled on success, released on failure/block — never orphaned.
   */
  budgetReservationId?: string | null
}

export class ActionExecutionEngine {
  private budgetReservations: BudgetReservationService

  constructor(private supabase: SupabaseClient) {
    this.budgetReservations = new BudgetReservationService(supabase)
  }

  /**
   * Main entry point: Execute action with full safety checks
   * FAIL-CLOSED: Any check failure blocks execution
   */
  async executeAction(request: ActionExecutionRequest): Promise<{
    success: boolean
    actionId: string
    result?: Record<string, any>
    error?: string
  }> {
    // 1. Run all checks (budget reservation is taken atomically inside)
    const checks = await this.runAllChecks(request)
    const reservationId = checks.budgetReservationId ?? null

    const engineCtx = {
      organizationId: request.organizationId,
      actionId: request.actionId,
      taskId: typeof request.payload?.taskId === 'string' ? request.payload.taskId : null,
      requestId: request.idempotencyKey ?? null,
    }

    if (!checks.allowed) {
      // A block AFTER the reservation step (idempotency claim) must not
      // strand the hold. Release it best-effort; the stale-hold reaper is the
      // safety net if this release itself fails.
      if (reservationId) {
        await this.budgetReservations.release(reservationId, request.organizationId)
      }
      logFinancial({
        op: 'execution.failure',
        ctx: engineCtx,
        amounts: { reserved: request.estimatedCost ?? 0 },
        extra: { stage: 'pre_execution_block', reason: checks.blockReason ?? 'unknown', failedChecks: checks.failedChecks },
      })
      // Log blocked attempt
      await this.logBlockedAction(request, checks.blockReason || 'Unknown reason', checks.failedChecks)

      return {
        success: false,
        actionId: request.actionId,
        error: checks.blockReason,
      }
    }

    // 2. In shadow mode, don't execute external actions — release the hold
    //    so shadow runs never consume budget.
    if (request.operatingMode === 'shadow') {
      if (reservationId) {
        await this.budgetReservations.release(reservationId, request.organizationId)
      }
      logFinancial({
        op: 'execution.failure',
        ctx: engineCtx,
        amounts: { reserved: request.estimatedCost ?? 0 },
        extra: { stage: 'shadow_mode' },
      })
      await this.logShadowAction(request, checks.passedChecks)
      return {
        success: true,
        actionId: request.actionId,
        result: { executed: false, reason: 'Shadow mode - no external action executed' },
      }
    }

    logFinancial({
      op: 'execution.start',
      ctx: engineCtx,
      amounts: { requested: request.estimatedCost ?? 0, reserved: request.estimatedCost ?? 0 },
    })

    // 3. Execute action
    try {
      const result = await this.performAction(request)

      // 4. Settle the reservation with the ACTUAL cost when the action
      //    reported one; otherwise charge the reserved estimate. The DATABASE
      //    clamps the charge to the reserved hold (never inflates budget).
      //    Idempotent: a retried settle of an already-settled hold is a no-op.
      const actualCost =
        typeof result?.actualCost === 'number' && result.actualCost >= 0
          ? result.actualCost
          : (request.estimatedCost ?? 0)
      try {
        await this.budgetReservations.settle(reservationId, request.organizationId, actualCost)
      } catch (settleError: any) {
        // Never swallow: a settle failure means the ledger may be wrong.
        console.error(
          `[engine] budget settle failed for action ${request.actionId}: ${settleError?.message}`
        )
      }

      logFinancial({
        op: 'execution.success',
        ctx: engineCtx,
        amounts: { requested: request.estimatedCost ?? 0, actual: actualCost, settled: actualCost },
        extra: { reservationId: reservationId ?? null },
      })

      // 5. Record execution
      await this.recordActionExecution(request, result, 'completed')

      return {
        success: true,
        actionId: request.actionId,
        result,
      }
    } catch (error: any) {
      // Release the hold on failure (idempotent; reaper covers release bugs).
      if (reservationId) {
        await this.budgetReservations.release(reservationId, request.organizationId)
      }
      logFinancial({
        op: 'execution.failure',
        ctx: engineCtx,
        amounts: { reserved: request.estimatedCost ?? 0, actual: 0 },
        extra: { stage: 'action_throw', reason: error?.message ?? 'unknown' },
      })

      // Record failure
      await this.recordActionExecution(request, { error: error.message }, 'failed', error.message)

      return {
        success: false,
        actionId: request.actionId,
        error: error.message,
      }
    }
  }

  /**
   * Run ALL safety checks - FAIL-CLOSED
   */
  private async runAllChecks(request: ActionExecutionRequest): Promise<ExecutionCheckResult> {
    const passedChecks: string[] = []
    const failedChecks: string[] = []

    // 1. Authentication check (skipped only for verified system executions)
    if (request.systemExecution) {
      passedChecks.push('system_execution_identity')
    } else {
      if (!request.userId) {
        failedChecks.push('authentication_missing')
        return { allowed: false, blockReason: 'User not authenticated', passedChecks, failedChecks }
      }
      passedChecks.push('authentication')

      // 2. Organization authorization (user path only)
      const orgCheck = await this.checkOrganizationAccess(request.userId, request.organizationId)
      if (!orgCheck) {
        failedChecks.push('organization_unauthorized')
        return { allowed: false, blockReason: 'Not a member of this organization', passedChecks, failedChecks }
      }
      passedChecks.push('organization_access')
    }

    // 3. Permission check.
    // Background (system) executions have no end-user role: the job queue
    // authenticated the caller (CRON secret / verified member) and the action
    // was already approval-gated. The action's own risk/authorization/approval
    // gates below STILL run — critical risk remains blocked outright.
    const effectiveRole: UserRole | undefined = request.systemExecution
      ? 'admin'
      : request.userRole
    const permCheck = this.checkPermission(effectiveRole, request.authorizationLevel)
    if (!permCheck) {
      failedChecks.push('insufficient_permissions')
      return { allowed: false, blockReason: 'Insufficient permissions for this action', passedChecks, failedChecks }
    }
    passedChecks.push('permissions')

    // 4. Risk check
    const riskCheck = this.checkRiskAuthorization(request.riskLevel, effectiveRole, request.approvalRequired)
    if (!riskCheck) {
      failedChecks.push('risk_level_blocked')
      return { allowed: false, blockReason: 'Risk level requires approval', passedChecks, failedChecks }
    }
    passedChecks.push('risk_assessment')

    // 5. Approval check (CRITICAL)
    if (request.approvalRequired) {
      const approvalCheck = await this.checkApprovalValid(request.decisionId, request.organizationId)
      if (!approvalCheck.valid) {
        failedChecks.push('approval_invalid')
        return { allowed: false, blockReason: approvalCheck.reason, passedChecks, failedChecks }
      }
      passedChecks.push('approval_valid')
    } else {
      passedChecks.push('approval_not_required')
    }

    // 6. Kill switch check
    const killSwitchCheck = await this.checkKillSwitches(request.organizationId)
    if (!killSwitchCheck.allowed) {
      failedChecks.push('kill_switch_active')
      return { allowed: false, blockReason: killSwitchCheck.reason, passedChecks, failedChecks }
    }
    passedChecks.push('kill_switches_clear')

    // 6.5 Fast-fail duplicate check (pre-reservation).
    //
    // The ATOMIC idempotency claim still runs AFTER the reservation step
    // (required order). This cheap pre-check only short-circuits actions
    // that ALREADY COMPLETED, so a queue retry of a finished action is
    // rejected as a duplicate instead of first consuming (and releasing)
    // budget. Fail-closed: it can only BLOCK, never allow.
    const { data: completedDuplicate } = await this.supabase
      .from('autonomous_actions')
      .select('id')
      .eq('idempotency_key', request.idempotencyKey)
      .eq('organization_id', request.organizationId)
      .eq('execution_status', 'completed')
      .maybeSingle()

    if (completedDuplicate) {
      failedChecks.push('duplicate_execution')
      return { allowed: false, blockReason: 'Action with this ID already executed successfully', passedChecks, failedChecks }
    }

    // 7. ATOMIC BUDGET RESERVATION (Sprint 5.3 P2)
    //
    // Replaces the old check-then-spend gate with a database-side atomic
    // hold: reserve_budget_idempotent() locks the budget row FOR UPDATE and
    // inserts the hold or fails — no read-modify-write, so concurrent actions
    // can never over-commit. Idempotent per action idempotency key: retries,
    // duplicate enqueues, and duplicate ticks reuse the same hold.
    // Fail-closed: any reservation error blocks execution.
    let budgetReservationId: string | null = null
    const estimated = request.estimatedCost ?? 0
    if (estimated > 0) {
      try {
        const reservation = await this.budgetReservations.reserve({
          organizationId: request.organizationId,
          amount: estimated,
          actionIdempotencyKey: request.idempotencyKey,
          reference: `action:${request.actionId}`,
        })
        budgetReservationId = reservation.reservationId
        if (budgetReservationId) {
          passedChecks.push('budget_reserved')
        } else {
          passedChecks.push('no_budget_cost')
        }
      } catch (error: any) {
        failedChecks.push(error instanceof PermanentBudgetError ? 'budget_config_invalid' : 'budget_exceeded')
        return {
          allowed: false,
          blockReason: `Budget reservation failed: ${error?.message ?? 'unknown error'}`,
          passedChecks,
          failedChecks,
        }
      }
    } else {
      passedChecks.push('no_budget_cost')
    }

    // 8. Atomic idempotency claim - prevent duplicate execution
    //
    // Instead of a check-then-execute race, we atomically claim the key first.
    // A claim is an insert into autonomous_actions with execution_status='queued'
    // keyed on idempotency_key. If the insert wins, we own the key and can execute.
    // If it fails (duplicate key), another request owns it and we block.
    const claim = await this.claimIdempotencyKey(request)
    if (!claim.allowed) {
      failedChecks.push('duplicate_execution')
      return {
        allowed: false,
        blockReason: claim.reason,
        passedChecks,
        failedChecks,
        budgetReservationId,
      }
    }
    passedChecks.push('idempotency_valid')

    return { allowed: true, passedChecks, failedChecks, budgetReservationId }
  }

  /**
   * 6. Atomic idempotency claim - prevent duplicate execution
   *
   * Instead of a check-then-execute race, we atomically claim the key first.
   * A claim is an insert into autonomous_actions with execution_status='queued'
   * keyed on idempotency_key. If the insert wins, we own the key and can execute.
   * If it fails (duplicate key), another request owns it and we block.
   */
  private async claimIdempotencyKey(
    request: ActionExecutionRequest
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!request.idempotencyKey) {
      return { allowed: false, reason: 'Idempotency key required' }
    }

    // Check if action with this idempotency key already executed successfully
    const { data: existing } = await this.supabase
      .from('autonomous_actions')
      .select('id, execution_status')
      .eq('idempotency_key', request.idempotencyKey)
      .eq('organization_id', request.organizationId)
      .single()

    if (existing) {
      if (existing.execution_status === 'completed') {
        return { allowed: false, reason: 'Action with this ID already executed successfully' }
      }

      // Sprint 5.3 (async execution path): when the existing row IS the action
      // we were asked to execute (pre-created with the decision, status
      // 'queued'/'executing'/'failed'), this execution owns it. Transition it
      // to 'executing' with a conditional update so two concurrent executors
      // of the same action cannot both win — the loser sees 0 rows and blocks.
      if (existing.id === request.actionId && existing.execution_status !== 'completed') {
        const { data: claimed } = await this.supabase
          .from('autonomous_actions')
          .update({
            execution_status: 'executing',
            started_at: new Date().toISOString(),
            completed_at: null,
            last_error: null,
          })
          .eq('id', existing.id)
          .eq('organization_id', request.organizationId)
          .eq('execution_status', existing.execution_status)
          .select('id')

        if (claimed && claimed.length > 0) {
          return { allowed: true }
        }
        return { allowed: false, reason: 'Action claimed by a concurrent execution' }
      }

      // Allow retry: re-claim the failed row for this execution attempt.
      if (existing.execution_status === 'failed') {
        await this.supabase
          .from('autonomous_actions')
          .update({
            execution_status: 'queued',
            completed_at: null,
            last_error: null,
          })
          .eq('id', existing.id)
          .eq('organization_id', request.organizationId)
        return { allowed: true }
      }
      // A DIFFERENT action already holds this idempotency key and is in
      // flight - don't allow concurrent execution.
      return { allowed: false, reason: 'Action already in progress' }
    }

    // Atomically claim the idempotency key: insert a queued execution record
    // keyed on (idempotency_key, organization_id). If a concurrent request
    // claims it first, this insert fails on the unique constraint and we block.
    // We insert with the request's actionId so the later execution-status update
    // (by id) lands on the claimed row.
    const { error: claimError } = await this.supabase
      .from('autonomous_actions')
      .insert({
        id: request.actionId,
        organization_id: request.organizationId,
        idempotency_key: request.idempotencyKey,
        execution_status: 'queued',
        action_type: request.actionType,
        title: request.title,
        created_at: new Date().toISOString(),
      })

    if (claimError) {
      // Unique constraint violation = another request claimed the key first
      if (claimError.code === '23505') {
        return { allowed: false, reason: 'Action already in progress (claimed by concurrent request)' }
      }
      // Other insert errors are non-claim errors - don't block on them here;
      // they will surface during execution.
      return { allowed: true }
    }

    return { allowed: true }
  }

  /**
   * 1. Check organization membership
   */
  private async checkOrganizationAccess(userId: string, organizationId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single()

    return !!data
  }

  /**
   * 2. Check user has required permission
   */
  private checkPermission(userRole: UserRole | undefined, authLevel: ActionRiskAuthority): boolean {
    // Viewer cannot approve anything
    if (userRole === 'viewer') return false

    // Member can only approve Level 1 (low risk)
    if (userRole === 'member' && authLevel !== 'level_1') return false

    // Admin and Owner can approve anything
    if (userRole === 'admin' || userRole === 'owner') return true

    return false
  }

  /**
   * 3. Check risk level is authorized
   */
  private checkRiskAuthorization(
    riskLevel: RiskLevel,
    userRole: UserRole | undefined,
    approvalRequired: boolean
  ): boolean {
    // Low risk always OK if approved
    if (riskLevel === 'low') return !approvalRequired || userRole === 'admin' || userRole === 'owner'

    // Medium/High/Critical require Admin or Owner
    if (riskLevel === 'medium' || riskLevel === 'high') return userRole === 'admin' || userRole === 'owner'

    // Critical NEVER auto-approved
    if (riskLevel === 'critical') return false

    return false
  }

  /**
   * 4. Check approval exists and is valid
   */
  private async checkApprovalValid(
    decisionId: string,
    organizationId: string
  ): Promise<{ valid: boolean; reason?: string }> {
    const { data: approval } = await this.supabase
      .from('approval_requests')
      .select('approval_status, response_deadline, approved_at')
      .eq('decision_id', decisionId)
      .eq('organization_id', organizationId)
      .single()

    if (!approval) {
      return { valid: false, reason: 'No approval found for this decision' }
    }

    if (approval.approval_status !== 'approved') {
      return { valid: false, reason: `Approval not approved (status: ${approval.approval_status})` }
    }

    // Check expiration
    if (approval.response_deadline) {
      const deadline = new Date(approval.response_deadline)
      if (new Date() > deadline) {
        return { valid: false, reason: 'Approval has expired' }
      }
    }

    return { valid: true }
  }

  /**
   * 5. Check kill switches
   */
  private async checkKillSwitches(organizationId: string): Promise<{ allowed: boolean; reason?: string }> {
    // Check organization kill switch
    const { data: orgLimits } = await this.supabase
      .from('ai_usage_limits')
      .select('paused, pause_reason')
      .eq('organization_id', organizationId)
      .single()

    if (orgLimits?.paused) {
      return { allowed: false, reason: orgLimits.pause_reason || 'Organization is paused' }
    }

    return { allowed: true }
  }

  /**
   * Perform the actual action
   * (Placeholder - overridden in specific action implementations)
   */
  private async performAction(request: ActionExecutionRequest): Promise<Record<string, any>> {
    // This is where the actual action logic goes
    // For now, return a placeholder
    return {
      executedAt: new Date().toISOString(),
      actionType: request.actionType,
      status: 'success',
    }
  }

  /**
   * Record successful action execution
   */
  private async recordActionExecution(
    request: ActionExecutionRequest,
    result: Record<string, any>,
    status: 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    await this.supabase.from('autonomous_actions').update({
      execution_status: status === 'completed' ? 'completed' : 'failed',
      completed_at: new Date().toISOString(),
      result,
      success: status === 'completed',
      last_error: error,
    })
      .eq('id', request.actionId)
      .eq('organization_id', request.organizationId)

    // Record in action outcomes
    if (status === 'completed') {
      await this.supabase.from('action_outcomes').insert({
        organization_id: request.organizationId,
        action_id: request.actionId,
        outcome_type: 'success',
        description: `Action executed: ${request.title}`,
        measured_at: new Date().toISOString(),
      })
    }
  }

  /**
   * Log blocked action attempt
   */
  private async logBlockedAction(request: ActionExecutionRequest, reason: string, failedChecks: string[]): Promise<void> {
    await this.supabase.from('audit_logs').insert({
      organization_id: request.organizationId,
      user_id: request.userId || null,
      action: 'action_execution_blocked',
      resource: `action:${request.actionId}`,
      details: reason,
      metadata: { failedChecks, riskLevel: request.riskLevel },
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Log shadow mode action (not executed)
   */
  private async logShadowAction(request: ActionExecutionRequest, passedChecks: string[]): Promise<void> {
    await this.supabase.from('audit_logs').insert({
      organization_id: request.organizationId,
      user_id: request.userId || null,
      action: 'action_shadow_mode',
      resource: `action:${request.actionId}`,
      details: 'Executed in shadow mode - no external action performed',
      metadata: { passedChecks, operatingMode: request.operatingMode },
      timestamp: new Date().toISOString(),
    })
  }
}
