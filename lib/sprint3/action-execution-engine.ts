/**
 * Sprint 3: Safe Action Execution Engine
 * 
 * FAIL-CLOSED enforcement for autonomous actions:
 * - Approval enforcement
 * - Budget protection
 * - Kill switch integration
 * - Idempotency checking
 * - Risk-based authorization
 * 
 * No action executes without passing ALL checks.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { AICostController } from '@/lib/ai/cost-controller'
import type { UserRole } from '@/lib/auth/permissions'
import { hasPermission } from '@/lib/auth/permissions'

export type OperatingMode = 'shadow' | 'approval' | 'autonomous'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ActionRiskAuthority = 'level_1' | 'level_2' | 'level_3' | 'level_4'

export interface ActionExecutionRequest {
  // Request context
  organizationId: string
  userId: string
  userRole: UserRole

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
}

export interface ExecutionCheckResult {
  allowed: boolean
  blockReason?: string
  passedChecks: string[]
  failedChecks: string[]
}

export class ActionExecutionEngine {
  private costController: AICostController

  constructor(private supabase: SupabaseClient) {
    this.costController = new AICostController(supabase)
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
    // 1. Run all checks
    const checks = await this.runAllChecks(request)

    if (!checks.allowed) {
      // Log blocked attempt
      await this.logBlockedAction(request, checks.blockReason || 'Unknown reason', checks.failedChecks)

      return {
        success: false,
        actionId: request.actionId,
        error: checks.blockReason,
      }
    }

    // 2. In shadow mode, don't execute external actions
    if (request.operatingMode === 'shadow') {
      await this.logShadowAction(request, checks.passedChecks)
      return {
        success: true,
        actionId: request.actionId,
        result: { executed: false, reason: 'Shadow mode - no external action executed' },
      }
    }

    // 3. Execute action
    try {
      const result = await this.performAction(request)

      // 4. Record execution
      await this.recordActionExecution(request, result, 'completed')

      return {
        success: true,
        actionId: request.actionId,
        result,
      }
    } catch (error: any) {
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

    // 1. Authentication check
    if (!request.userId) {
      failedChecks.push('authentication_missing')
      return { allowed: false, blockReason: 'User not authenticated', passedChecks, failedChecks }
    }
    passedChecks.push('authentication')

    // 2. Organization authorization
    const orgCheck = await this.checkOrganizationAccess(request.userId, request.organizationId)
    if (!orgCheck) {
      failedChecks.push('organization_unauthorized')
      return { allowed: false, blockReason: 'Not a member of this organization', passedChecks, failedChecks }
    }
    passedChecks.push('organization_access')

    // 3. Permission check
    const permCheck = this.checkPermission(request.userRole, request.authorizationLevel)
    if (!permCheck) {
      failedChecks.push('insufficient_permissions')
      return { allowed: false, blockReason: 'Insufficient permissions for this action', passedChecks, failedChecks }
    }
    passedChecks.push('permissions')

    // 4. Risk check
    const riskCheck = this.checkRiskAuthorization(request.riskLevel, request.userRole, request.approvalRequired)
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

    // 7. Budget check (if applicable)
    if (request.estimatedCost && request.estimatedCost > 0) {
      const budgetCheck = await this.costController.checkBudget(
        request.organizationId,
        'action-engine',
        request.estimatedCost
      )
      if (!budgetCheck.allowed) {
        failedChecks.push('budget_exceeded')
        return { allowed: false, blockReason: budgetCheck.reason, passedChecks, failedChecks }
      }
      passedChecks.push('budget_available')
    } else {
      passedChecks.push('no_budget_cost')
    }

    // 8. Idempotency check
    const idempotencyCheck = await this.checkIdempotency(request.idempotencyKey, request.organizationId)
    if (!idempotencyCheck.allowed) {
      failedChecks.push('duplicate_execution')
      return { allowed: false, blockReason: idempotencyCheck.reason, passedChecks, failedChecks }
    }
    passedChecks.push('idempotency_valid')

    return { allowed: true, passedChecks, failedChecks }
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
   * 6. Check idempotency - prevent duplicate execution
   */
  private async checkIdempotency(
    idempotencyKey: string,
    organizationId: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!idempotencyKey) {
      return { allowed: false, reason: 'Idempotency key required' }
    }

    // Check if action with this idempotency key already executed successfully
    const { data: existing } = await this.supabase
      .from('autonomous_actions')
      .select('id, execution_status')
      .eq('idempotency_key', idempotencyKey)
      .eq('organization_id', organizationId)
      .single()

    if (existing) {
      if (existing.execution_status === 'completed') {
        return { allowed: false, reason: 'Action with this ID already executed successfully' }
      }
      // Allow retry if previous attempt failed
      if (existing.execution_status === 'failed') {
        return { allowed: true }
      }
      // Executing or queued - don't allow concurrent execution
      return { allowed: false, reason: 'Action already in progress' }
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
      user_id: request.userId,
      action: 'action_execution_blocked',
      resource: `action:${request.actionId}`,
      reason,
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
      user_id: request.userId,
      action: 'action_shadow_mode',
      resource: `action:${request.actionId}`,
      reason: 'Executed in shadow mode - no external action performed',
      metadata: { passedChecks, operatingMode: request.operatingMode },
      timestamp: new Date().toISOString(),
    })
  }
}
