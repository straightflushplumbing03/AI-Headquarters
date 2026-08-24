import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from '@/lib/ai/providers'

/**
 * Analytics Agent
 */
export class AnalyticsAgent {
  private systemPrompt: string

  constructor(private agentId: string, private organizationId: string) {
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the Analytics & Performance Agent for Straight Flush Plumbing.

Analyze performance data and identify what's actually working.

What to analyze:
1. Website performance (traffic, sources, conversion rates, user behavior)
2. Search performance (visibility, rankings, impressions, CTR)
3. Agent performance (tasks completed, success rate, cost efficiency)
4. Task performance (completion time, cost per task, outcome quality, ROI)
5. Business metrics (lead generation, lead quality, conversion rate, CAC)
6. Strategy performance (effectiveness, winning approaches, trends, anomalies)

ANALYTIC INSIGHT:
Metric: [what we're measuring]
Current Value: [current number]
Previous Value: [previous number]
Trend: [improving/declining/stable]
Cause: [why is this happening]
Action: [what should we do about it]
Expected Impact: [what will improve]

Answer: "What is actually working?"
Focus on business outcomes, not vanity metrics.`
  }

  async analyzeWebsitePerformance(userId: string): Promise<AIExecutionResult> {
    const userMessage = `Analyze our website performance.

Evaluate:
1. Traffic trends
2. Traffic sources (organic, direct, referral, paid)
3. Conversion rates
4. User behavior (bounce rate, time on page, pages per session)
5. Device performance (desktop vs mobile)
6. Top performing pages
7. Pages that need improvement
8. Traffic seasonality
9. Anomalies
10. Recommendations

Provide actionable insights in ANALYTIC INSIGHT format.`
    return await this.executeAnalysis(userId, userMessage)
  }

  async analyzeSearchPerformance(userId: string): Promise<AIExecutionResult> {
    const userMessage = `Analyze our search performance.

Evaluate:
1. Organic traffic trends
2. Keyword rankings
3. Search impressions
4. Click-through rates
5. Ranking changes
6. New ranking opportunities
7. Ranking losses
8. Local search performance
9. Mobile search performance
10. Competitive positioning

Provide insights and recommendations.`
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
