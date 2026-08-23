import { SupabaseClient } from '@supabase/supabase-js'
import type { AgentSystemPrompt } from '@/types/ai'

/**
 * AI CEO Agent
 * The first genuinely functional AI employee
 * Orchestrates other agents, manages goals, creates tasks
 */
export class AICEOAgent {
  id: string
  organizationId: string
  systemPrompt: string

  constructor(agentId: string, organizationId: string) {
    this.id = agentId
    this.organizationId = organizationId
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the AI CEO of [Company Name].

Your role is to lead the AI workforce toward company goals.
You have access to:
- Company information
- Company goals and priorities
- Available AI employees and their capabilities
- Recent task results and outcomes
- Company knowledge base and learnings
- Current budget and spending limits

Your responsibilities:
1. Read and understand company goals
2. Review available AI employees and their skills
3. Analyze recent task results and learnings
4. Identify opportunities and priorities
5. Create detailed tasks for specialized AI employees
6. Assign tasks to the most capable employee
7. Prioritize work based on company goals
8. Review completed work and extract learnings
9. Store useful knowledge for future reference
10. Make recommendations for strategic direction
11. Request human approval for high-risk decisions
12. Respect all budget limits and autonomy levels
13. Never access other organizations' data
14. Never expose secrets or sensitive information
15. Log all decisions and reasoning

Constraints:
- Only create tasks for employees that exist
- Always respect autonomy levels (1-5)
- Budget is sacred - never exceed it
- Always provide reasoning for decisions
- Ask for approval before external actions
- Store learnings in company memory
- Be transparent about limitations

When creating tasks for employees, include:
- Clear objective
- Specific success criteria
- Required information
- Expected output format
- Deadline if applicable

Always respond with structured output.
`
  }

  /**
   * Build context for AI CEO
   */
  async buildContext(
    supabase: SupabaseClient,
    companyInfo: any,
    goals: any[],
    agents: any[],
    recentTasks: any[],
    budget: any
  ): Promise<string> {
    return `
=== COMPANY CONTEXT ===
Name: ${companyInfo.name}
Industry: ${companyInfo.industry || 'Not specified'}
Description: ${companyInfo.description || 'Not specified'}

=== COMPANY GOALS ===
${goals.map((g) => `- [${g.priority}] ${g.title}: ${g.description}`).join('\n')}

=== AVAILABLE AI EMPLOYEES ===
${agents
  .filter((a) => a.active)
  .map((a) => `- ${a.name} (${a.role}): ${a.description || 'No description'}`)
  .join('\n')}

=== RECENT TASK RESULTS ===
${recentTasks
  .slice(0, 5)
  .map((t) => `- ${t.title}: ${t.status} (${t.result || 'No result'})`)
  .join('\n')}

=== BUDGET STATUS ===
Monthly Budget: $${budget.monthly_budget}
Spent: $${budget.current_spend.toFixed(2)}
Remaining: $${(budget.monthly_budget - budget.current_spend).toFixed(2)}
Percentage Used: ${((budget.current_spend / budget.monthly_budget) * 100).toFixed(1)}%

=== YOUR TASK ===
Analyze the current situation and recommend the next steps.
`
  }

  /**
   * Extract task creation from CEO response
   */
  extractTasksFromResponse(response: string): Array<{
    title: string
    description: string
    assignedAgent: string
    priority: string
  }> {
    const tasks: Array<{
      title: string
      description: string
      assignedAgent: string
      priority: string
    }> = []

    // Parse structured output format
    const taskPattern = /TASK:(.+?)\n(?=TASK:|$)/gs
    const matches = response.matchAll(taskPattern)

    for (const match of matches) {
      const taskText = match[1]
      const titleMatch = taskText.match(/Title:(.+?)\n/)
      const agentMatch = taskText.match(/Agent:(.+?)\n/)
      const priorityMatch = taskText.match(/Priority:(.+?)\n/)

      if (titleMatch && agentMatch) {
        tasks.push({
          title: titleMatch[1].trim(),
          description: taskText,
          assignedAgent: agentMatch[1].trim(),
          priority: priorityMatch ? priorityMatch[1].trim() : 'medium',
        })
      }
    }

    return tasks
  }

  /**
   * Check if response requires approval
   */
  requiresApproval(response: string): boolean {
    const approvalKeywords = [
      'APPROVAL_REQUIRED',
      'needs approval',
      'requires approval',
      'external action',
      'high risk',
    ]

    return approvalKeywords.some((keyword) =>
      response.toUpperCase().includes(keyword)
    )
  }
}
