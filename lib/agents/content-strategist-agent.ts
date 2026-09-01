import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from '@/lib/ai/providers'

/**
 * Content Strategist Agent
 */
export class ContentStrategistAgent {
  private systemPrompt: string

  constructor(private agentId: string, private organizationId: string) {
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the Content Strategist Agent for Straight Flush Plumbing.

Transform SEO opportunities into high-quality content plans.

Content priorities:
1. Search intent alignment
2. Customer usefulness
3. Expertise and trust
4. Local relevance
5. Conversion potential
6. AI search discoverability

Content types:
1. Service pages
2. Educational articles
3. FAQ pages
4. Comparison pages
5. Location pages
6. Problem/symptom pages
7. How-to guides
8. Checklists
9. Resource pages
10. Case studies

Content must NOT be:
- Thin, AI-generated filler
- Duplicate
- Keyword stuffed
- Misleading

CONTENT BRIEF:
Topic: [title]
Type: [article/guide/page/etc.]
Target Keywords: [keywords]
Intent: [informational/commercial/transactional]
Outline:
  1. [Section]
  2. [Section]
Length: [word count range]
CTA: [call-to-action]
Internal Links: [related pages]
Priority: [high/medium/low]

Content must help customers AND rank.`
  }

  async createContentPlan(userId: string, topic: string): Promise<AIExecutionResult> {
    const userMessage = `Create a comprehensive content plan for: ${topic}

Include:
1. Primary content piece
2. Supporting content pieces
3. Keyword targets
4. Content types
5. Internal linking strategy
6. Timeline
7. Success metrics`
    return await this.executeStrategy(userId, userMessage)
  }

  async generateContentBrief(userId: string, topic: string, keywords?: string[]): Promise<AIExecutionResult> {
    const userMessage = `Generate a detailed content brief for: ${topic}${keywords?.length ? `\nTarget keywords: ${keywords.join(', ')}` : ''}

Provide a complete content brief in the specified format. Make it actionable.`
    return await this.executeStrategy(userId, userMessage)
  }

  private async executeStrategy(_userId: string, userMessage: string): Promise<AIExecutionResult> {
    const provider = getAIProvider()
    const request: AIExecutionRequest = {
      organizationId: this.organizationId,
      agentId: this.agentId,
      taskId: this.agentId,
      systemPrompt: this.systemPrompt,
      userMessage,
    }

    try {
      return await provider.execute(request)
    } catch (error: any) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        executionTimeMs: 0,
        error: error.message,
      }
    }
  }
}
