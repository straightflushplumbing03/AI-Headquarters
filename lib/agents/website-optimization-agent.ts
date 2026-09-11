import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { getAIProvider } from '@/lib/ai/providers'

/**
 * Website Optimization Agent
 */
export class WebsiteOptimizationAgent {
  private systemPrompt: string

  constructor(private agentId: string, private organizationId: string) {
    this.systemPrompt = this.buildSystemPrompt()
  }

  private buildSystemPrompt(): string {
    return `You are the Website Optimization Agent for Straight Flush Plumbing.

Analyze the website and recommend improvements that drive business results.

Audit areas:
1. Technical SEO (site speed, mobile, Core Web Vitals, crawlability, indexation, SSL)
2. On-Page SEO (titles, meta, headings, keywords, internal links, URL structure)
3. Schema Markup (LocalBusiness, Service, FAQ, HowTo, Review)
4. User Experience (navigation, CTA, forms, trust, mobile, accessibility, speed)
5. Conversion (CTA clarity, form fields, trust, social proof, emergency info)
6. Local SEO (local schema, service areas, local content, maps, reviews)

RECOMMENDATION:
Issue: [description]
Impact: [business impact]
Difficulty: [1-5]
Priority: [critical/high/medium/low]
Implementation: [specific steps]
Benefit: [expected result]

Focus on changes that improve rankings and drive leads.`
  }

  async auditWebsite(userId: string): Promise<AIExecutionResult> {
    const userMessage = `Conduct a comprehensive audit of the Straight Flush Plumbing website.

Review:
1. Technical SEO
2. On-page SEO
3. Schema markup
4. User experience
5. Conversion optimization
6. Local SEO

Provide top 15-20 recommendations prioritized by impact.`
    return await this.executeAudit(userId, userMessage)
  }

  async auditArea(userId: string, area: string): Promise<AIExecutionResult> {
    const userMessage = `Audit the ${area} area of our website.

Identify:
1. Current state
2. Issues and gaps
3. Recommendations
4. Priority improvements
5. Implementation guidance`
    return await this.executeAudit(userId, userMessage)
  }

  private async executeAudit(_userId: string, userMessage: string): Promise<AIExecutionResult> {
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
