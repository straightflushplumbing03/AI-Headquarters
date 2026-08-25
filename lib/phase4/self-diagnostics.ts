import { SupabaseClient } from '@supabase/supabase-js'
import { ExecutiveDashboard } from '@/lib/phase4/executive-dashboard'
import { WebsiteIntelligence } from '@/lib/phase4/website-intelligence'
import { AgentPerformanceTracker } from '@/lib/phase4/agent-performance-tracker'
import { GitHubIntegration } from '@/lib/phase4/github-integration'

/**
 * Self-Diagnostics System
 * Automated health checks and system status reporting
 */
export class SelfDiagnosticsSystem {
  private dashboard: ExecutiveDashboard
  private website: WebsiteIntelligence
  private agentPerf: AgentPerformanceTracker
  private github: GitHubIntegration

  constructor(private supabase: SupabaseClient) {
    this.dashboard = new ExecutiveDashboard(supabase)
    this.website = new WebsiteIntelligence(supabase)
    this.agentPerf = new AgentPerformanceTracker(supabase)
    this.github = new GitHubIntegration(supabase)
  }

  /**
   * Run comprehensive system diagnostics
   */
  async runFullDiagnostics(organizationId: string): Promise<any> {
    const startTime = Date.now()

    const [executiveState, websiteHealth, agentComparison, pendingApprovals, errors] = await Promise.all([
      this.checkExecutiveState(organizationId),
      this.checkWebsiteHealth(organizationId),
      this.checkAgentHealth(organizationId),
      this.checkPendingApprovals(organizationId),
      this.checkSystemErrors(organizationId),
    ])

    const diagnostics = {
      timestamp: new Date().toISOString(),
      execution_time_ms: Date.now() - startTime,
      overall_status: this.calculateOverallStatus([executiveState, websiteHealth, agentComparison]),
      components: {
        executive_command_center: executiveState,
        website_intelligence: websiteHealth,
        agent_workforce: agentComparison,
        approval_workflow: pendingApprovals,
      },
      alerts: errors.filter((e) => e.severity === 'critical' || e.severity === 'high'),
      warnings: errors.filter((e) => e.severity === 'medium'),
      info: errors.filter((e) => e.severity === 'low'),
    }

    return diagnostics
  }

  /**
   * Check executive state
   */
  private async checkExecutiveState(organizationId: string): Promise<any> {
    try {
      const state = await this.dashboard.getExecutiveState(organizationId)
      return {
        status: 'healthy',
        data: state,
        metrics: {
          active_workflows: state.active_workflows,
          pending_approvals: state.pending_approvals,
          competitive_threats: state.competitive_threats,
        },
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check website health
   */
  private async checkWebsiteHealth(organizationId: string): Promise<any> {
    try {
      const health = await this.website.getWebsiteHealthSummary(organizationId)
      return {
        status: health.status,
        health_score: health.health_score,
        pages_analyzed: health.total_pages,
        critical_issues: health.critical_issues_count,
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check agent health
   */
  private async checkAgentHealth(organizationId: string): Promise<any> {
    try {
      const topPerformers = await this.agentPerf.getTopPerformers(organizationId, 3)
      const underperformers = await this.agentPerf.getUnderperformers(organizationId, 3)

      return {
        status: topPerformers.length > 0 ? 'healthy' : 'degraded',
        top_performers: topPerformers.length,
        underperformers: underperformers.length,
        top_performer_success_rate: topPerformers[0]?.success_rate || 0,
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check pending approvals
   */
  private async checkPendingApprovals(organizationId: string): Promise<any> {
    try {
      const pending = await this.github.getChangesAwaitingApproval(organizationId)
      return {
        status: pending.length === 0 ? 'healthy' : pending.length > 5 ? 'attention_needed' : 'healthy',
        pending_count: pending.length,
        oldest_pending_age_hours: pending.length > 0 ? this.getAgeInHours(pending[0].created_at) : 0,
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check for system errors
   */
  private async checkSystemErrors(organizationId: string): Promise<any[]> {
    const errors: any[] = []

    // Check for deployment failures
    const { data: failures } = await this.supabase
      .from('github_changes')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('deployment_status', 'failed')
      .limit(5)

    if (failures && failures.length > 0) {
      errors.push({
        severity: 'high',
        component: 'deployment',
        message: `${failures.length} recent deployment failures detected`,
        count: failures.length,
      })
    }

    // Check for agents with low success rates
    const underperformers = await this.agentPerf.getUnderperformers(organizationId, 5)
    if (underperformers.length > 2) {
      errors.push({
        severity: 'medium',
        component: 'agents',
        message: `${underperformers.length} agents with below-target performance`,
        count: underperformers.length,
      })
    }

    // Check for stale approvals
    const pending = await this.github.getChangesAwaitingApproval(organizationId)
    const stale = pending.filter((p) => this.getAgeInHours(p.created_at) > 24)
    if (stale.length > 0) {
      errors.push({
        severity: 'medium',
        component: 'approvals',
        message: `${stale.length} changes pending approval for >24 hours`,
        count: stale.length,
      })
    }

    return errors
  }

  /**
   * Calculate overall system status
   */
  private calculateOverallStatus(components: any[]): 'operational' | 'degraded' | 'offline' {
    const errors = components.filter((c) => c.status === 'error').length
    const unhealthy = components.filter((c) => c.status && c.status !== 'healthy' && c.status !== 'error').length

    if (errors >= components.length) return 'offline'
    if (errors > 0 || unhealthy > 1) return 'degraded'
    return 'operational'
  }

  /**
   * Get age in hours
   */
  private getAgeInHours(dateString: string): number {
    const date = new Date(dateString)
    const now = new Date()
    return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
  }
}
