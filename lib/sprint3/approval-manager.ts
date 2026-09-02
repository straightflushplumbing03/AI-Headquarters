/**
 * Approval Management Service
 *
 * Server-side enforcement:
 * - Approval is REQUIRED before execution (if approval_required = true)
 * - Only authorized users can approve
 * - Approvals can expire
 * - Cross-org approvals are impossible (RLS enforced)
 * - Client cannot bypass approval status
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/auth/permissions'

export interface ApprovalCheckResult {
  valid: boolean
  status?: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
  approvedBy?: string
  approvedAt?: string
  reason?: string
}

export class ApprovalManager {
  constructor(private supabase: SupabaseClient) {}

  async checkApprovalValid(decisionId: string, organizationId: string): Promise<ApprovalCheckResult> {
    const { data: approval, error } = await this.supabase
      .from('approval_requests')
      .select('approval_status, approved_at, response_deadline, approved_by')
      .eq('decision_id', decisionId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !approval) {
      return { valid: false, status: 'pending', reason: 'No approval request found' }
    }

    const status = approval.approval_status as 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'

    if (status === 'pending') return { valid: false, status: 'pending', reason: 'Approval still pending' }
    if (status === 'rejected') return { valid: false, status: 'rejected', reason: 'Approval was rejected' }
    if (status === 'expired' || status === 'cancelled') return { valid: false, status, reason: `Approval ${status}` }

    if (approval.response_deadline) {
      const deadline = new Date(approval.response_deadline)
      if (new Date() > deadline) {
        return { valid: false, status: 'expired', reason: 'Approval expired' }
      }
    }

    return { valid: true, status: 'approved', approvedBy: approval.approved_by, approvedAt: approval.approved_at }
  }

  async canUserApprove(userId: string, organizationId: string): Promise<{ can: boolean; reason?: string }> {
    const { data: member, error } = await this.supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !member) return { can: false, reason: 'User is not a member of this organization' }

    const role = member.role as UserRole

    if (role === 'owner' || role === 'admin') return { can: true }

    return { can: false, reason: `Users with role '${role}' cannot approve actions. Only owner and admin can approve.` }
  }

  async approveAction(
    approvalId: string,
    userId: string,
    organizationId: string,
    notes?: string
  ): Promise<{ success: boolean; error?: string }> {
    const canApprove = await this.canUserApprove(userId, organizationId)
    if (!canApprove.can) return { success: false, error: canApprove.reason }

    const { data: approval, error: loadError } = await this.supabase
      .from('approval_requests')
      .select('id, approval_status, organization_id')
      .eq('id', approvalId)
      .eq('organization_id', organizationId)
      .single()

    if (loadError || !approval) return { success: false, error: 'Approval not found' }
    if (approval.approval_status !== 'pending') return { success: false, error: `Cannot approve: status is ${approval.approval_status}` }

    const { error: updateError } = await this.supabase
      .from('approval_requests')
      .update({
        approval_status: 'approved',
        approved_by: userId,
        approval_notes: notes,
        approved_at: new Date().toISOString(),
      })
      .eq('id', approvalId)
      .eq('organization_id', organizationId)

    if (updateError) return { success: false, error: updateError.message }

    await this.logApprovalAction(userId, organizationId, approvalId, 'approved', notes)
    return { success: true }
  }

  async rejectAction(
    approvalId: string,
    userId: string,
    organizationId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    const canApprove = await this.canUserApprove(userId, organizationId)
    if (!canApprove.can) return { success: false, error: canApprove.reason }

    const { data: approval, error: loadError } = await this.supabase
      .from('approval_requests')
      .select('id, approval_status, organization_id')
      .eq('id', approvalId)
      .eq('organization_id', organizationId)
      .single()

    if (loadError || !approval) return { success: false, error: 'Approval not found' }
    if (approval.approval_status !== 'pending') return { success: false, error: `Cannot reject: status is ${approval.approval_status}` }

    const { error: updateError } = await this.supabase
      .from('approval_requests')
      .update({
        approval_status: 'rejected',
        approved_by: userId,
        approval_notes: reason,
        approved_at: new Date().toISOString(),
      })
      .eq('id', approvalId)
      .eq('organization_id', organizationId)

    if (updateError) return { success: false, error: updateError.message }

    await this.logApprovalAction(userId, organizationId, approvalId, 'rejected', reason)
    return { success: true }
  }

  async getPendingApprovals(organizationId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('approval_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('approval_status', 'pending')
      .order('requested_at', { ascending: true })

    if (error) {
      console.error('Error fetching approvals:', error)
      return []
    }

    return data || []
  }

  async cancelAction(
    approvalId: string,
    userId: string,
    organizationId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    const canApprove = await this.canUserApprove(userId, organizationId)
    if (!canApprove.can) return { success: false, error: canApprove.reason }

    const { data: approval, error: loadError } = await this.supabase
      .from('approval_requests')
      .select('id, approval_status, organization_id')
      .eq('id', approvalId)
      .eq('organization_id', organizationId)
      .single()

    if (loadError || !approval) return { success: false, error: 'Approval not found' }
    if (approval.approval_status !== 'pending') return { success: false, error: `Cannot cancel: status is ${approval.approval_status}` }

    const { error: updateError } = await this.supabase
      .from('approval_requests')
      .update({
        approval_status: 'cancelled',
        approved_by: userId,
        approval_notes: reason,
        approved_at: new Date().toISOString(),
      })
      .eq('id', approvalId)
      .eq('organization_id', organizationId)

    if (updateError) return { success: false, error: updateError.message }

    await this.logApprovalAction(userId, organizationId, approvalId, 'cancelled', reason)
    return { success: true }
  }

  async getActionStatus(actionId: string, organizationId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('autonomous_actions')
      .select('*')
      .eq('id', actionId)
      .eq('organization_id', organizationId)
      .single()

    if (error) return null
    return data
  }

  async getApprovalDetails(approvalId: string, organizationId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('approval_requests')
      .select('*')
      .eq('id', approvalId)
      .eq('organization_id', organizationId)
      .single()

    if (error) return null
    return data
  }

  private async logApprovalAction(
    userId: string,
    organizationId: string,
    approvalId: string,
    action: 'approved' | 'rejected' | 'cancelled',
    details?: string
  ): Promise<void> {
    try {
      await this.supabase.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: userId,
        action: `approval_${action}`,
        resource: `approval:${approvalId}`,
        details: details,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      console.error('Failed to log approval action:', error)
    }
  }
}
