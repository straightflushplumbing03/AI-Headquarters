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
  assessRiskLevel(filesChanged: string[], riskLevel: string): 'low' | 'medium' | 'high' {
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

  /**
   * Execute an approved GitHub change by calling the GitHub API.
   *
   * Flow:
   *   1. Verify the change exists and is approved
   *   2. For changes that require PR creation: create a PR via GitHub API
   *   3. For auto-merge eligible low-risk changes: attempt to merge
   *   4. Record the result and create an audit log entry
   *   5. Never exposes the GitHub token to the client
   *
   * Requires GITHUB_TOKEN environment variable (server-side only).
   * Requires GITHUB_REPO environment variable in "owner/repo" format.
   */
  async executeApprovedChange(
    changeId: string,
    executedBy: string,
    githubToken?: string,
    githubRepo?: string
  ): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
    // Resolve credentials from env (server-side); never accept from client
    const token = githubToken ?? process.env.GITHUB_TOKEN
    const repo = githubRepo ?? process.env.GITHUB_REPO

    if (!token) {
      return { success: false, error: 'GITHUB_TOKEN is not configured' }
    }
    if (!repo) {
      return { success: false, error: 'GITHUB_REPO is not configured (expected "owner/repo")' }
    }

    // Fetch the change record
    const { data: change, error: fetchError } = await this.supabase
      .from('github_changes')
      .select('*')
      .eq('id', changeId)
      .single()

    if (fetchError || !change) {
      return { success: false, error: 'Change not found' }
    }

    // Verify approval
    if (change.approval_required && change.approval_status !== 'approved') {
      return {
        success: false,
        error: `Change requires approval but status is "${change.approval_status}"`,
      }
    }

    const [owner, repoName] = repo.split('/')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
    }

    try {
      // Attempt to create a Pull Request if branch info is available
      if (change.branch_name) {
        // Determine base branch (default: main)
        const defaultBranchRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, { headers })
        const repoData = defaultBranchRes.ok ? ((await defaultBranchRes.json()) as any) : null
        const baseBranch: string = repoData?.default_branch ?? 'main'

        // Create the PR
        const prRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            title: `[AI HQ] ${change.reason ?? 'Automated change'}`,
            head: change.branch_name,
            base: baseBranch,
            body: [
              `**Reason:** ${change.reason}`,
              `**Risk Level:** ${change.risk_level}`,
              `**Approved by:** ${change.approved_by ?? executedBy}`,
              `**Change ID:** ${change.id}`,
              change.diff ? `\n\`\`\`diff\n${change.diff}\n\`\`\`` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            draft: false,
          }),
        })

        if (!prRes.ok) {
          const errBody = await prRes.json().catch(() => ({}))
          const errMsg = (errBody as any)?.message ?? `GitHub API error ${prRes.status}`

          // 422 Unprocessable: PR may already exist or branch has no commits — record and return
          if (prRes.status === 422) {
            await this.recordExecutionResult(changeId, executedBy, false, null, errMsg)
            return { success: false, error: errMsg }
          }

          await this.recordExecutionResult(changeId, executedBy, false, null, errMsg)
          return { success: false, error: errMsg }
        }

        const pr = (await prRes.json()) as any
        const prNumber: number = pr.number
        const prUrl: string = pr.html_url

        // For low-risk auto-approved changes, attempt to merge immediately
        let merged = false
        if (change.risk_level === 'low' && change.approval_status === 'approved') {
          const mergeRes = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/merge`,
            {
              method: 'PUT',
              headers,
              body: JSON.stringify({
                commit_title: `[AI HQ] ${change.reason ?? 'Automated change'}`,
                merge_method: 'squash',
              }),
            }
          )
          merged = mergeRes.ok
        }

        await this.recordExecutionResult(changeId, executedBy, true, prNumber, undefined, prUrl, merged)
        return { success: true, prUrl, prNumber }
      }

      // No branch — nothing actionable
      await this.recordExecutionResult(changeId, executedBy, false, null, 'No branch_name specified on change record')
      return { success: false, error: 'No branch_name specified on change record' }
    } catch (err: any) {
      const errorMessage = err?.message ?? 'Unknown error'
      await this.recordExecutionResult(changeId, executedBy, false, null, errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Update the change record after execution and write an audit log entry.
   */
  private async recordExecutionResult(
    changeId: string,
    executedBy: string,
    success: boolean,
    prNumber: number | null,
    errorMessage?: string,
    prUrl?: string,
    merged = false
  ): Promise<void> {
    const update: Record<string, any> = {
      deployment_status: success ? 'deployed' : 'failed',
      deployed_at: success ? new Date().toISOString() : undefined,
      result: success ? `PR created${merged ? ' and merged' : ''}` : errorMessage,
      result_measured: true,
      updated_at: new Date().toISOString(),
    }
    if (prNumber) update.pr_number = prNumber
    if (prUrl) update.pr_url = prUrl
    if (merged) {
      update.merged = true
      update.merged_at = new Date().toISOString()
    }

    await this.supabase.from('github_changes').update(update).eq('id', changeId)

    // Write audit log via activity_events (always record, never skip)
    await this.supabase.from('activity_events').insert([{
      event_type: 'github_change_executed',
      description: success
        ? `GitHub change executed successfully${prNumber ? ` — PR #${prNumber}` : ''}`
        : `GitHub change execution failed: ${errorMessage}`,
      metadata: {
        change_id: changeId,
        executed_by: executedBy,
        success,
        pr_number: prNumber,
        pr_url: prUrl,
        merged,
        error: errorMessage,
      },
    }]).catch(() => {
      // Audit log failure must not block the execution result
    })
  }
}
