import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { calculateModelCost, ProviderName, ModelName, getDefaultModel, PROVIDER_PRICING } from './config/pricing'
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

export abstract class AIProvider {
  abstract name: ProviderName
  abstract isConfigured: boolean
  abstract status: 'active' | 'pending' | 'error'
  abstract errorMessage?: string
  abstract execute(request: AIExecutionRequest): Promise<AIExecutionResult>
  abstract estimateCost(inputTokens: number, outputTokens: number): number
}

/** Map AI SDK usage (v5: inputTokens/outputTokens; v4: promptTokens/completionTokens) to the repo's token fields. */
function usageTokens(usage: unknown): { inputTokens: number; outputTokens: number } {
  const u = (usage ?? {}) as Record<string, unknown>
  const input = Number(u.inputTokens ?? u.promptTokens ?? 0)
  const output = Number(u.outputTokens ?? u.completionTokens ?? 0)
  return { inputTokens: Number.isFinite(input) ? input : 0, outputTokens: Number.isFinite(output) ? output : 0 }
}

/** Map a thrown error to the repo's errorType semantics. */
function classifyError(error: unknown): { message: string; errorType: string } {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined
    const message = typeof e.message === 'string' && e.message ? e.message : 'Unknown AI provider error'
    if (statusCode === 401 || statusCode === 403) return { message, errorType: 'authentication_failed' }
    return { message, errorType: 'unknown_error' }
  }
  return { message: String(error ?? 'Unknown AI provider error'), errorType: 'unknown_error' }
}

export class OpenAIProvider extends AIProvider {
  name: ProviderName = 'openai'
  isConfigured: boolean
  status: 'active' | 'pending' | 'error'
  errorMessage?: string
  private apiKey?: string
  private model: ModelName = 'gpt-4-turbo'

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
      const openai = createOpenAI({ apiKey: this.apiKey })
      const result = await generateText({
        model: openai(this.model),
        system: request.systemPrompt,
        prompt: request.userMessage,
        maxOutputTokens: request.maxTokens || 2000,
        temperature: request.temperature ?? 0.7,
      })

      const executionTimeMs = Date.now() - startTime
      const { inputTokens, outputTokens } = usageTokens(result.usage)
      if (!inputTokens && !outputTokens) {
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

      const actualCost = calculateModelCost('openai', this.model, inputTokens, outputTokens)

      return {
        success: true,
        content: result.text || '',
        inputTokens,
        outputTokens,
        estimatedCost: actualCost,
        actualCost,
        executionTimeMs,
        provider: 'openai',
        model: this.model,
      }
    } catch (error: unknown) {
      const { message, errorType } = classifyError(error)
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
        error: message,
        errorType,
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

  constructor(apiKey?: string, model?: ModelName) {
    super()
    this.apiKey = apiKey
    this.model = model || getDefaultModel('anthropic')
    this.isConfigured = !!apiKey
    this.status = apiKey ? 'active' : 'pending'
    if (!apiKey) this.errorMessage = 'ANTHROPIC_API_KEY not configured'
  }

  /** API-facing model id: pricing config maps display names (claude-3-sonnet) to real ids (claude-3-sonnet-20240229). */
  private apiModelId(): ModelName {
    return PROVIDER_PRICING['anthropic']?.[this.model]?.model || this.model
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
      const anthropic = createAnthropic({ apiKey: this.apiKey })
      const result = await generateText({
        model: anthropic(this.apiModelId()),
        system: request.systemPrompt,
        prompt: request.userMessage,
        maxOutputTokens: request.maxTokens || 2000,
        temperature: request.temperature ?? 0.7,
      })

      const executionTimeMs = Date.now() - startTime
      const { inputTokens, outputTokens } = usageTokens(result.usage)
      if (!inputTokens && !outputTokens) {
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

      const actualCost = calculateModelCost('anthropic', this.model, inputTokens, outputTokens)

      return {
        success: true,
        content: result.text || '',
        inputTokens,
        outputTokens,
        estimatedCost: actualCost,
        actualCost,
        executionTimeMs,
        provider: 'anthropic',
        model: this.model,
      }
    } catch (error: unknown) {
      const { message, errorType } = classifyError(error)
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
        error: message,
        errorType,
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

  async execute(_request: AIExecutionRequest): Promise<AIExecutionResult> {
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

export class FakeProvider extends AIProvider {
  name: ProviderName = 'openai'
  isConfigured = true
  status = 'active' as const
  errorMessage?: string
  private failNext: boolean

  constructor(failNext = false) {
    super()
    this.failNext = failNext
  }

  // Fixed non-zero cost so the integration test deterministically observes a
  // non-trivial settlement, regardless of prompt length.
  private static readonly FIXED_COST = 0.1234

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    const tokensIn = Math.ceil((request.systemPrompt.length + request.userMessage.length) / 4)
    const out = 100
    const cost = FakeProvider.FIXED_COST
    if (this.failNext) {
      return {
        success: false,
        content: '',
        inputTokens: tokensIn,
        outputTokens: 0,
        estimatedCost: cost,
        actualCost: 0,
        executionTimeMs: 1,
        provider: 'openai',
        model: 'gpt-4-turbo',
        error: 'fake provider failure',
        errorType: 'unknown_error',
      }
    }
    return {
      success: true,
      content: 'FAKE_OK',
      inputTokens: tokensIn,
      outputTokens: out,
      estimatedCost: cost,
      actualCost: cost,
      executionTimeMs: 2,
      provider: 'openai',
      model: 'gpt-4-turbo',
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return FakeProvider.FIXED_COST
  }
}

export function getAIProvider(preferredProvider?: ProviderName): AIProvider {
  // Deterministic provider ONLY for the integration smoke test. This is
  // guarded by an explicit env flag so it can never be selected in prod;
  // production always returns real providers (or PendingProvider).
  if (process.env.BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER === '1') {
    return new FakeProvider(false)
  }

  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (preferredProvider === 'openai' && openaiKey) return new OpenAIProvider(openaiKey)
  if (preferredProvider === 'anthropic' && anthropicKey) return new AnthropicProvider(anthropicKey)
  if (openaiKey) return new OpenAIProvider(openaiKey)
  if (anthropicKey) return new AnthropicProvider(anthropicKey)
  return new PendingProvider()
}
