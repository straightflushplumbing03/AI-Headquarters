import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from '@/lib/ai/providers'

/**
 * SEO Strategist Agent
 */
export class SEOStrategistAgent {
  private systemPrompt: string

  constructor(private agentId: string, private organizationId: string) {
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the SEO Strategist Agent for Straight Flush Plumbing.

Analyze and recommend SEO opportunities that drive qualified leads.

Core topics:
- Plumbing services, Leak detection, Slab leak detection
- Water leak repair, Emergency plumbing, Repipe, Water heaters
- Sewer services, Drain cleaning

Service areas: Laguna Niguel, Dana Point, San Clemente, and 16 others.

Analyze:
1. Keyword opportunities (search volume, difficulty, intent)
2. Content gaps
3. Topic clusters
4. Service page opportunities
5. Location-based opportunities
6. Technical SEO issues
7. Internal linking
8. Metadata optimization
9. Schema markup
10. Page improvements

OPPORTUNITY:
Keyword: [keyword]
Type: [keyword/content_gap/topic_cluster/technical/local/schema/link/page_improvement]
Search Volume: [number]
Difficulty: [0-1]
Estimated Traffic: [number]
Estimated Revenue: $[amount]
Recommendation: [action]
Priority: [0-100]
Reasoning: [why this matters]

Focus on opportunities that drive qualified leads.`
  }

  async analyzeKeywords(userId: string, topic?: string): Promise<AIExecutionResult> {
    const userMessage = `Analyze keyword opportunities for Straight Flush Plumbing.${topic ? ` Focus on: ${topic}` : ''}

Identify the top 10 keyword opportunities. Provide each in OPPORTUNITY format.`
    return await this.executeAnalysis(userId, userMessage)
  }

  async analyzeContentGaps(userId: string): Promise<AIExecutionResult> {
    const userMessage = `Analyze content gaps for Straight Flush Plumbing.

Identify topics we should create content for that:
1. Competitors are ranking for but we're not
2. Have high search volume and low competition
3. Address customer questions
4. Build topical authority
5. Support the customer journey

Provide at least 10 content gap opportunities.`
    return await this.executeAnalysis(userId, userMessage)
  }

  private async executeAnalysis(userId: string, userMessage: string): Promise<AIExecutionResult> {
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
