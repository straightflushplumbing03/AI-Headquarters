import { SupabaseClient } from '@supabase/supabase-js'
import { AICEOAgent } from './ceo-agent'
import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { AIExecutionPipeline } from '../execution-pipeline'

/**
 * Agent Orchestration Engine
 * Coordinates AI agents to work together
 */
export class AgentOrchestrator {
  private ceoAgent: AICEOAgent
  private pipeline: AIExecutionPipeline

  constructor(
    private supabase: SupabaseClient,
    agentId: string,
    organizationId: string
  ) {
    this.ceoAgent = new AICEOAgent(agentId, organizationId)
    this.pipeline = new AIExecutionPipeline(supabase)
  }

  /**
   * Run CEO agent to analyze situation and create tasks
   */
  async runCEO(
    userId: string,
    organizationId: string,
    agentId: string,
    taskId: string
  ): Promise<AIExecutionResult> {
    // Load context
    const companyInfo = await this.loadCompanyInfo(organizationId)
    const goals = await this.loadGoals(organizationId)
    const agents = await this.loadAgents(organizationId)
    const recentTasks = await this.loadRecentTasks(organizationId)
    const budget = await this.loadBudget(organizationId)

    // Build CEO context
    const context = await this.ceoAgent.buildContext(
      this.supabase,
      companyInfo,
      goals,
      agents,
      recentTasks,
      budget
    )

    // Create execution request
    const request: AIExecutionRequest & { userId: string } = {
      userId,
      organizationId,
      agentId,
      taskId,
      systemPrompt: this.ceoAgent.systemPrompt,
      userMessage: context,
    }

    // Execute through pipeline
    return await this.pipeline.execute(request)
  }

  private async loadCompanyInfo(organizationId: string): Promise<any> {
    const { data } = await this.supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()
    return data
  }

  private async loadGoals(organizationId: string): Promise<any[]> {
    const { data } = await this.supabase
      .from('company_goals')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('priority', { ascending: false })
    return data || []
  }

  private async loadAgents(organizationId: string): Promise<any[]> {
    const { data } = await this.supabase
      .from('agents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('active', true)
    return data || []
  }

  private async loadRecentTasks(organizationId: string): Promise<any[]> {
    const { data } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(10)
    return data || []
  }

  private async loadBudget(organizationId: string): Promise<any> {
    const { data } = await this.supabase
      .from('ai_usage_limits')
      .select('*')
      .eq('organization_id', organizationId)
      .single()
    return data || { monthly_budget: 100, current_spend: 0 }
  }
}
