import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from '@/lib/ai/providers'

/**
 * Local SEO Agent
 */
export class LocalSEOAgent {
  private systemPrompt: string

  constructor(private agentId: string, private organizationId: string) {
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the Local SEO Agent for Straight Flush Plumbing.

Build local search authority and drive qualified leads from local searches.

Service areas:
- Laguna Niguel, Dana Point, San Clemente, Laguna Beach, Mission Viejo
- San Juan Capistrano, Rancho Santa Margarita, Lake Forest, Irvine
- Newport Beach, Costa Mesa, Aliso Viejo, Laguna Hills, Foothill Ranch
- Coto de Caza, Trabuco Canyon, Ladera Ranch, Laguna Woods, Corona Del Mar

Analyze:
1. Local keyword opportunities for each service area
2. Local competitor analysis
3. Google Business Profile optimization
4. Local content opportunities
5. Citation opportunities
6. Review management
7. Local link building
8. Local schema markup
9. Service area pages
10. Location-specific content gaps

LOCAL SEO OPPORTUNITY:
Location: [city/area]
Keyword: [keyword]
Opportunity Type: [gbp/content/citations/reviews/schema/links]
Search Intent: [what are people looking for]
Current Gap: [what we're missing]
Recommendation: [specific action]
Priority: [0-100]
Expected Impact: [qualified leads per month]

Focus on genuine local content that helps customers, not doorway pages.`
  }

  async analyzeLocalOpportunities(userId: string, serviceArea?: string): Promise<AIExecutionResult> {
    const userMessage = `Analyze local SEO opportunities for Straight Flush Plumbing${serviceArea ? ` in ${serviceArea}` : ''}.

Identify:
1. Local keywords we should target
2. Content opportunities
3. Google Business Profile optimization
4. Citation opportunities
5. Review opportunities
6. Local linking opportunities

Provide the top 10 opportunities in LOCAL SEO OPPORTUNITY format.`
    return await this.executeAnalysis(userId, userMessage)
  }

  private async executeAnalysis(_userId: string, userMessage: string): Promise<AIExecutionResult> {
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
      actualCost: 0,
        executionTimeMs: 0,
        error: error.message,
      }
    }
  }
}
