import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'

/**
 * Abstract AI Provider Interface
 * Allows switching between OpenAI, Anthropic, or other providers
 */
export abstract class AIProvider {
  abstract name: string
  abstract isConfigured: boolean
  abstract status: 'active' | 'pending' | 'error'

  abstract execute(request: AIExecutionRequest): Promise<AIExecutionResult>
  abstract estimateCost(inputTokens: number, outputTokens: number): number
}

/**
 * OpenAI Provider Implementation
 */
export class OpenAIProvider extends AIProvider {
  name = 'openai'
  isConfigured: boolean
  status: 'active' | 'pending' | 'error' = 'pending'
  private apiKey?: string
  private model = 'gpt-4-turbo'
  private baseURL = 'https://api.openai.com/v1'

  constructor(apiKey?: string) {
    super()
    this.apiKey = apiKey
    this.isConfigured = !!apiKey
    this.status = apiKey ? 'active' : 'pending'
  }

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    if (!this.isConfigured) {
      throw new Error('OpenAI provider not configured. Set OPENAI_API_KEY environment variable.')
    }

    const startTime = Date.now()

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userMessage },
          ],
          max_tokens: request.maxTokens || 2000,
          temperature: request.temperature || 0.7,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`)
      }

      const data = await response.json()
      const usage = data.usage
      const content = data.choices[0]?.message?.content || ''

      const executionTimeMs = Date.now() - startTime
      const estimatedCost = this.estimateCost(usage.prompt_tokens, usage.completion_tokens)

      return {
        success: true,
        content,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        estimatedCost,
        executionTimeMs,
      }
    } catch (error: any) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        executionTimeMs: Date.now() - startTime,
        error: error.message,
      }
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    // GPT-4 Turbo pricing
    // Input: $0.01 per 1K tokens
    // Output: $0.03 per 1K tokens
    const inputCost = (inputTokens / 1000) * 0.01
    const outputCost = (outputTokens / 1000) * 0.03
    return inputCost + outputCost
  }
}

/**
 * Pending Provider (No-op for development without credentials)
 */
export class PendingProvider extends AIProvider {
  name = 'pending'
  isConfigured = false
  status = 'pending' as const

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    return {
      success: false,
      content: `[PROVIDER PENDING] AI execution not available. Configure OpenAI API key in .env.local`,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      executionTimeMs: 0,
      error: 'Provider not configured',
    }
  }

  estimateCost(): number {
    return 0
  }
}

/**
 * AI Provider Factory
 */
export function getAIProvider(): AIProvider {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (apiKey) {
    return new OpenAIProvider(apiKey)
  }

  return new PendingProvider()
}
