import { SupabaseClient } from '@supabase/supabase-js'
import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from './providers'

/**
 * Secure AI Execution Pipeline
 * 15-step process: AUTH → AUTHORIZE → LOAD → CHECK → EXECUTE → STORE → LEARN
 */
export class AIExecutionPipeline {
  constructor(private supabase: SupabaseClient) {}

  async execute(request: AIExecutionRequest & { userId: string }): Promise<AIExecutionResult> {
    try {
      // 1. AUTHENTICATE
      if (!request.userId) throw new Error('Authentication required')

      // 2. AUTHORIZE
      await this.authorizeOrganization(request.userId, request.organizationId)

      // 3. LOAD CONTEXT
      const org = await this.loadOrganizationContext(request.organizationId)
      if (!org) throw new Error('Organization not found')

      // 4. LOAD AGENT
      const agent = await this.loadAgentConfig(request.agentId)
      if (!agent) throw new Error('Agent not found')

      // 5. LOAD TASK
      const task = await this.loadTask(request.taskId)
      if (!task) throw new Error('Task not found')

      // 6. CHECK BUDGET
      const canExecute = await this.checkBudget(request.organizationId)
      if (!canExecute) {
        return this.budgetExceededResult()
      }

      // 7. CHECK PERMISSIONS
      await this.checkPermissions(request.agentId, request.organizationId)

      // 8. EXECUTE AI
      const provider = getAIProvider()
      const result = await provider.execute(request)

      if (!result.success) return result
      if (!result.content?.trim()) {
        return {
          ...result,
          success: false,
          error: 'AI returned empty response',
        }
      }

      // 9. VALIDATE (already done in step 8 checks)

      // 10. STORE RESULT
      await this.storeExecutionLog(request, result)

      // 11. UPDATE TASK
      await this.updateTask(request.taskId, result.content)

      // 12. LOG ACTIVITY
      await this.logActivity(request.organizationId, request.agentId, request.taskId, result)

      // 13. STORE KNOWLEDGE
      await this.storeKnowledge(request.organizationId, result)

      // 14. DETERMINE ACTION
      const needsApproval = result.content.includes('APPROVAL_REQUIRED')

      // 15. REQUEST APPROVAL or CONTINUE
      if (needsApproval) {
        await this.createApprovalRequest(request.taskId, request.agentId, result)
      }

      return result
    } catch (error: any) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        error: error.message,
      }
    }
  }

  private async authorizeOrganization(
    userId: string,
    organizationId: string
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !data) {
      throw new Error('Not authorized to access this organization')
    }
  }

  private async loadOrganizationContext(organizationId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .single()

    if (error) throw error
    return data
  }

  private async loadAgentConfig(agentId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single()

    if (error) throw error
    return data
  }

  private async loadTask(taskId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()

    if (error) throw error
    return data
  }

  private async checkBudget(organizationId: string): Promise<boolean> {
    const { data: limits } = await this.supabase
      .from('ai_usage_limits')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    if (!limits) return true // No limit set
    if (limits.paused) return false
    if (limits.current_spend >= limits.monthly_budget) return false

    return true
  }

  private async checkPermissions(agentId: string, organizationId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('agents')
      .select('organization_id')
      .eq('id', agentId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !data) {
      throw new Error('Agent not authorized for this organization')
    }
  }

  private async storeExecutionLog(
    request: AIExecutionRequest,
    result: AIExecutionResult
  ): Promise<void> {
    await this.supabase.from('ai_execution_logs').insert([
      {
        organization_id: request.organizationId,
        agent_id: request.agentId,
        task_id: request.taskId,
        provider: 'openai',
        model: 'gpt-4-turbo',
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        estimated_cost: result.estimatedCost,
        execution_time_ms: result.executionTimeMs,
        status: result.success ? 'success' : 'failed',
        error_message: result.error,
      },
    ])
  }

  private async updateTask(taskId: string, result: string): Promise<void> {
    await this.supabase
      .from('tasks')
      .update({
        result,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', taskId)
  }

  private async logActivity(
    organizationId: string,
    agentId: string,
    taskId: string,
    result: AIExecutionResult
  ): Promise<void> {
    await this.supabase.from('activity_events').insert([
      {
        organization_id: organizationId,
        agent_id: agentId,
        task_id: taskId,
        event_type: 'ai_task_completed',
        title: 'AI task executed',
        description: `AI generated ${result.outputTokens} output tokens at $${result.estimatedCost.toFixed(4)}`,
        metadata: {
          tokens_output: result.outputTokens,
          cost: result.estimatedCost,
          time_ms: result.executionTimeMs,
        },
      },
    ])
  }

  private async storeKnowledge(
    organizationId: string,
    result: AIExecutionResult
  ): Promise<void> {
    if (result.content.includes('KNOWLEDGE:')) {
      const knowledge = result.content.split('KNOWLEDGE:')[1]?.trim() || ''
      if (knowledge) {
        await this.supabase.from('company_memory').insert([
          {
            organization_id: organizationId,
            category: 'ai_learned',
            title: 'AI Learning',
            content: knowledge,
          },
        ])
      }
    }
  }

  private async createApprovalRequest(
    taskId: string,
    agentId: string,
    result: AIExecutionResult
  ): Promise<void> {
    await this.supabase.from('approval_requests').insert([
      {
        task_id: taskId,
        agent_id: agentId,
        request_type: 'task_execution',
        title: 'AI Task Requires Approval',
        description: 'AI has completed task and requests approval before proceeding',
        proposed_action: result.content,
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ])
  }

  private budgetExceededResult(): AIExecutionResult {
    return {
      success: false,
      content: '[BUDGET LIMIT] AI execution blocked. Organization monthly budget exceeded.',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      executionTimeMs: 0,
      error: 'Budget exceeded',
    }
  }
}
