import { SupabaseClient } from '@supabase/supabase-js'
import type { GitHubChange } from '@/types/phase4'

/**
 * GitHub Integration & Risk Management
 * Manages changes with approval workflow, risk assessment, and audit trail
 */
export class GitHubIntegration {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create change request
   */
  async createChangeRequest(
    organizationId: string,
    change: Omit<GitHubChange, 'id' | 'organization_id' | 'created_at' | 'updated_at' | 'deployment_status' | 'merged' | 'result_measured'>
  ): Promise<GitHubChange> {
    const { data, error } = await this.supabase
      .from('github_changes')
      .insert([
        {
          ...change,
          organization_id: organizationId,
          merged: false,
          deployment_status: 'pending',
          result_measured: false,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get risk level based on content
   */
  assessRiskLevel(filesChanged: string[], _riskLevel?: string): 'low' | 'medium' | 'high' {
    // High-risk patterns
    if (
      filesChanged.some(
        (f) => f.includes('database') || f.includes('schema') || f.includes('security') || f.includes('auth')
      )
    ) {
      return 'high'
    }

    // Medium-risk patterns
    if (
      filesChanged.some(
        (f) => f.includes('config') || f.includes('api') || f.includes('integration') || f.includes('service')
      )
    ) {
      return 'medium'
    }

    // Low-risk: content, styling, documentation
    return 'low'
  }

  /**
   * Check if approval required
   */
  isApprovalRequired(riskLevel: 'low' | 'medium' | 'high'): boolean {
    return riskLevel !== 'low'
  }

  /**
   * Get changes awaiting approval
   */
  async getChangesAwaitingApproval(organizationId: string): Promise<GitHubChange[]> {
    const { data } = await this.supabase
      .from('github_changes')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: true })

    return data || []
  }

  /**
   * Approve change
   */
  async approveChange(changeId: string, approvedBy: string): Promise<GitHubChange> {
    const { data, error } = await this.supabase
      .from('github_changes')
      .update({
        approval_status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq('id', changeId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Reject change
   */
  async rejectChange(changeId: string, reason: string): Promise<GitHubChange> {
    const { data, error } = await this.supabase
      .from('github_changes')
      .update({
        approval_status: 'rejected',
        updated_at: new Date().toISOString(),
        diff: `Rejection reason: ${reason}`,
      })
      .eq('id', changeId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Mark as merged
   */
  async markAsMerged(changeId: string, prNumber: number, prUrl: string): Promise<GitHubChange> {
    const { data, error } = await this.supabase
      .from('github_changes')
      .update({
        merged: true,
        merged_at: new Date().toISOString(),
        pr_number: prNumber,
        pr_url: prUrl,
      })
      .eq('id', changeId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Mark as deployed
   */
  async markAsDeployed(changeId: string): Promise<GitHubChange> {
    const { data, error } = await this.supabase
      .from('github_changes')
      .update({
        deployment_status: 'deployed',
        deployed_at: new Date().toISOString(),
      })
      .eq('id', changeId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Record deployment result
   */
  async recordDeploymentResult(changeId: string, result: string, resultMeasured: boolean = false): Promise<GitHubChange> {
    const { data, error } = await this.supabase
      .from('github_changes')
      .update({
        result,
        result_measured: resultMeasured,
      })
      .eq('id', changeId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get change audit trail
   */
  async getChangeAuditTrail(changeId: string): Promise<any> {
    const { data } = await this.supabase
      .from('github_changes')
      .select('*')
      .eq('id', changeId)
      .single()

    if (!data) return null

    return {
      id: data.id,
      reason: data.reason,
      agent: data.agent_id,
      risk_level: data.risk_level,
      files_changed: data.files_changed,
      created_at: data.created_at,
      approval: {
        status: data.approval_status,
        approved_by: data.approved_by,
        approved_at: data.approved_at,
      },
      github: {
        branch: data.branch_name,
        pr_number: data.pr_number,
        pr_url: data.pr_url,
        merged: data.merged,
        merged_at: data.merged_at,
      },
      deployment: {
        status: data.deployment_status,
        deployed_at: data.deployed_at,
      },
      result: {
        measured: data.result_measured,
        outcome: data.result,
      },
    }
  }

  /**
   * Get deployment history
   */
  async getDeploymentHistory(organizationId: string, limit: number = 20): Promise<GitHubChange[]> {
    const { data } = await this.supabase
      .from('github_changes')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('merged', true)
      .order('merged_at', { ascending: false })
      .limit(limit)

    return data || []
  }
}
