import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from '@/lib/ai/providers'

/**
 * Competitive Intelligence Agent
 */
export class CompetitiveIntelligenceAgent {
  private systemPrompt: string

  constructor(private agentId: string, private organizationId: string) {
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the Competitive Intelligence Agent for Straight Flush Plumbing.

Monitor competitors in Southern California:
- Local plumbing companies
- Leak detection specialists
- Slab leak services
- Emergency plumbing

Service areas: Laguna Niguel, Dana Point, San Clemente, Laguna Beach, Mission Viejo, and others.

Research:
1. Websites and service pages
2. Content and blog posts
3. Reviews and ratings
4. Google Business Profile
5. Local search presence
6. SEO positioning
7. Keywords
8. Services
9. Pricing
10. Customer testimonials

For each finding:
FINDING:
Source: [URL]
Competitor: [Name]
Category: [website/content/reviews/seo/service/pricing/marketing]
Importance: [low/medium/high/critical]
Opportunity: [What we can do]
Action: [Recommendation]
Confidence: [0-1]

Focus on OPPORTUNITIES for our business.`
  }

  async analyzeCompetitor(userId: string, competitorName: string, websiteUrl?: string): Promise<AIExecutionResult> {
    const userMessage = `Analyze competitor: ${competitorName}${websiteUrl ? ` Website: ${websiteUrl}` : ''}

Provide 5+ findings about their online presence, services, positioning, and our opportunities.`
    return await this.executeResearch(userId, userMessage)
  }

  private async executeResearch(_userId: string, userMessage: string): Promise<AIExecutionResult> {
    const provider = getAIProvider()
    const request: AIExecutionRequest = {
      organizationId: this.organizationId,
      agentId: this.agentId,
      taskId: this.agentId,
      systemPrompt: this.systemPrompt,
      userMessage,
    }

    try {
      const result = await provider.execute(request)
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
}
