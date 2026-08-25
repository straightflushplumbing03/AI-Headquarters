import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { calculateModelCost, ProviderName, ModelName, getDefaultModel } from './config/pricing'

export abstract class AIProvider {
  abstract name: ProviderName
  abstract isConfigured: boolean
  abstract status: 'active' | 'pending' | 'error'
  abstract errorMessage?: string
  abstract execute(request: AIExecutionRequest): Promise<AIExecutionResult>
  abstract estimateCost(inputTokens: number, outputTokens: number): number
}

export class OpenAIProvider extends AIProvider {
  name: ProviderName = 'openai'
  isConfigured: boolean
  status: 'active' | 'pending' | 'error'
  errorMessage?: string
  private apiKey?: string
  private model: ModelName = 'gpt-4-turbo'
  private baseURL = 'https://api.openai.com/v1'

  constructor(apiKey?: string, model?: ModelName) {
    super()
    this.apiKey = apiKey
    this.model = model || getDefaultModel('openai')
    this.isConfigured = !!apiKey
    this.status = apiKey ? 'active' : 'pending'
    if (!apiKey) this.errorMessage = 'OPENAI_API_KEY not configured'
  }

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        provider: 'openai',
        model: this.model,
        error: 'OpenAI not configured',
        errorType: 'provider_not_configured',
      }
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

      const executionTimeMs = Date.now() - startTime
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        return {
          success: false,
          content: '',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: 0,
          actualCost: 0,
          executionTimeMs,
          provider: 'openai',
          model: this.model,
          error: (error as any).error?.message || `HTTP ${response.status}`,
          errorType: response.status === 401 ? 'authentication_failed' : 'unknown_error',
        }
      }

      const data = (await response.json()) as any
      const usage = data.usage
      if (!usage) {
        return {
          success: false,
          content: '',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: 0,
          actualCost: 0,
          executionTimeMs,
          provider: 'openai',
          model: this.model,
          error: 'No usage data',
          errorType: 'invalid_response',
        }
      }

      const content = data.choices[0]?.message?.content || ''
      const actualCost = calculateModelCost('openai', this.model, usage.prompt_tokens || 0, usage.completion_tokens || 0)

      return {
        success: true,
        content,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        estimatedCost: actualCost,
        actualCost,
        executionTimeMs,
        provider: 'openai',
        model: this.model,
      }
    } catch (error: any) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: Date.now() - startTime,
        provider: 'openai',
        model: this.model,
        error: error.message,
        errorType: 'unknown_error',
      }
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return calculateModelCost('openai', this.model, inputTokens, outputTokens)
  }
}

export class AnthropicProvider extends AIProvider {
  name: ProviderName = 'anthropic'
  isConfigured: boolean
  status: 'active' | 'pending' | 'error'
  errorMessage?: string
  private apiKey?: string
  private model: ModelName = 'claude-3-sonnet'
  private baseURL = 'https://api.anthropic.com/v1'

  constructor(apiKey?: string, model?: ModelName) {
    super()
    this.apiKey = apiKey
    this.model = model || getDefaultModel('anthropic')
    this.isConfigured = !!apiKey
    this.status = apiKey ? 'active' : 'pending'
    if (!apiKey) this.errorMessage = 'ANTHROPIC_API_KEY not configured'
  }

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    if (!this.isConfigured) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        provider: 'anthropic',
        model: this.model,
        error: 'Anthropic not configured',
        errorType: 'provider_not_configured',
      }
    }

    const startTime = Date.now()
    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens || 2000,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userMessage }],
        }),
      })

      const executionTimeMs = Date.now() - startTime
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        return {
          success: false,
          content: '',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: 0,
          actualCost: 0,
          executionTimeMs,
          provider: 'anthropic',
          model: this.model,
          error: (error as any).error?.message || `HTTP ${response.status}`,
          errorType: response.status === 401 ? 'authentication_failed' : 'unknown_error',
        }
      }

      const data = (await response.json()) as any
      const usage = data.usage
      if (!usage) {
        return {
          success: false,
          content: '',
          inputTokens: 0,
          outputTokens: 0,
          estimatedCost: 0,
          actualCost: 0,
          executionTimeMs,
          provider: 'anthropic',
          model: this.model,
          error: 'No usage data',
          errorType: 'invalid_response',
        }
      }

      const content = data.content[0]?.text || ''
      const actualCost = calculateModelCost('anthropic', this.model, usage.input_tokens || 0, usage.output_tokens || 0)

      return {
        success: true,
        content,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        estimatedCost: actualCost,
        actualCost,
        executionTimeMs,
        provider: 'anthropic',
        model: this.model,
      }
    } catch (error: any) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: Date.now() - startTime,
        provider: 'anthropic',
        model: this.model,
        error: error.message,
        errorType: 'unknown_error',
      }
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return calculateModelCost('anthropic', this.model, inputTokens, outputTokens)
  }
}

export class PendingProvider extends AIProvider {
  name: ProviderName = 'openai'
  isConfigured = false
  status = 'pending' as const
  errorMessage = 'No AI provider configured'

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    return {
      success: false,
      content: '[BUSINESS BRAIN] Configure OPENAI_API_KEY or ANTHROPIC_API_KEY',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      executionTimeMs: 0,
      provider: 'openai',
      model: 'pending',
      error: 'No provider configured',
      errorType: 'provider_not_configured',
    }
  }

  estimateCost(): number {
    return 0
  }
}

export function getAIProvider(preferredProvider?: ProviderName): AIProvider {
  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (preferredProvider === 'openai' && openaiKey) return new OpenAIProvider(openaiKey)
  if (preferredProvider === 'anthropic' && anthropicKey) return new AnthropicProvider(anthropicKey)
  if (openaiKey) return new OpenAIProvider(openaiKey)
  if (anthropicKey) return new AnthropicProvider(anthropicKey)
  return new PendingProvider()
}
