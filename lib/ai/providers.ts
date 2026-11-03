import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { calculateModelCost, ProviderName, ModelName, getDefaultModel, getModelPricing, PROVIDER_PRICING } from './config/pricing'
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGateway } from '@ai-sdk/gateway'

/**
 * Hard failsafe: the deterministic FakeProvider is ONLY selectable when the
 * process is running under an explicitly smoke-test-env identifier AND the
 * opt-in env flag is exactly "1". This double guard makes an accidental
 * production-selection of the fake provider effectively impossible, even if a
 * deployment mistakenly sets the env var.
 */
function fakeProviderAllowed(): boolean {
  if (process.env.BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER !== '1') return false
  const nodeEnv = process.env.NODE_ENV
  const allowedNs = ['test', 'development', 'smoke']
  if (nodeEnv && !allowedNs.includes(nodeEnv)) return false
  // Belts and suspenders: also require the app URL to be a localhost/dev host
  // when NODE_ENV is unset (e.g. some vitest runners) — never a prod domain.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (!nodeEnv && appUrl && !/localhost|127\.0\.0\.1|\.test\.|:3\d{3}/.test(appUrl)) return false
  return true
}

export abstract class AIProvider {
  abstract name: ProviderName
  abstract isConfigured: boolean
  abstract status: 'active' | 'pending' | 'error'
  abstract errorMessage?: string
  abstract execute(request: AIExecutionRequest): Promise<AIExecutionResult>
  abstract estimateCost(inputTokens: number, outputTokens: number): number
}

/** Map AI SDK usage (v5: inputTokens/outputTokens; v4: promptTokens/completionTokens) to the repo's token fields. */
function usageTokens(usage: unknown): {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
} {
  const u = (usage ?? {}) as Record<string, unknown>
  const input = Number(u.inputTokens ?? u.promptTokens ?? 0)
  const output = Number(u.outputTokens ?? u.completionTokens ?? 0)
  // cacheReadTokens is nested under inputTokenDetails in AI SDK v7 and absent
  // on providers that do not report cache detail.
  const details = (u.inputTokenDetails ?? {}) as Record<string, unknown>
  const cached = Number(details.cacheReadTokens ?? 0)
  return {
    inputTokens: Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
    cachedInputTokens: Number.isFinite(cached) && cached > 0 ? cached : 0,
  }
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
      const { inputTokens, outputTokens, cachedInputTokens } = usageTokens(result.usage)
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

      const actualCost = calculateModelCost('openai', this.model, inputTokens, outputTokens, cachedInputTokens)

      return {
        success: true,
        content: result.text || '',
        inputTokens,
        outputTokens,
        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
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
      const { inputTokens, outputTokens, cachedInputTokens } = usageTokens(result.usage)
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

      const actualCost = calculateModelCost('anthropic', this.model, inputTokens, outputTokens, cachedInputTokens)

      return {
        success: true,
        content: result.text || '',
        inputTokens,
        outputTokens,
        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
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

/**
 * Vercel AI Gateway.
 *
 * A routing layer, not a model vendor: it fronts many upstream models behind
 * one key and adds no markup of its own. Two consequences shape this class:
 *
 *   * Cost must come from the per-model pricing table. The gateway bills at
 *     upstream rates, so a model we have no rate for cannot be costed. Such a
 *     call is reported as `model_not_priced` rather than costed at zero —
 *     recording zero would spend real money that never reaches the budget
 *     controls, which is exactly the failure this class exists to avoid.
 *   * Routing is a privacy decision. Prompts pass through the gateway, so it is
 *     opt-in via AI_GATEWAY_API_KEY and never auto-selected ahead of a provider
 *     the operator has configured directly.
 */
export class GatewayProvider extends AIProvider {
  name: ProviderName = 'gateway'
  isConfigured: boolean
  status: 'active' | 'pending' | 'error'
  errorMessage?: string
  private apiKey?: string
  private model: ModelName

  /** The resolved gateway model id, e.g. "moonshotai/kimi-k3". */
  get modelId(): ModelName {
    return this.model
  }

  constructor(apiKey?: string, model?: ModelName) {
    super()
    this.apiKey = apiKey
    this.model = model || getDefaultModel('gateway')
    this.isConfigured = !!apiKey
    this.status = apiKey ? 'active' : 'pending'
    if (!apiKey) this.errorMessage = 'AI_GATEWAY_API_KEY not configured'
  }

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    if (!this.isConfigured) {
      return this.failure('AI Gateway not configured', 'provider_not_configured', 0)
    }

    // Refuse before spending: an unpriced model would produce an untracked cost.
    if (!getModelPricing('gateway', this.model)) {
      return this.failure(
        `No pricing configured for gateway model "${this.model}". Add it to PROVIDER_PRICING before use so spend stays tracked.`,
        'model_not_priced',
        0
      )
    }

    const startTime = Date.now()
    try {
      const gateway = createGateway({ apiKey: this.apiKey })
      const result = await generateText({
        model: gateway(this.model),
        system: request.systemPrompt,
        prompt: request.userMessage,
        maxOutputTokens: request.maxTokens || 2000,
        temperature: request.temperature ?? 0.7,
      })

      const executionTimeMs = Date.now() - startTime
      const { inputTokens, outputTokens, cachedInputTokens } = usageTokens(result.usage)
      if (!inputTokens && !outputTokens) {
        return this.failure('No usage data', 'invalid_response', executionTimeMs)
      }

      const actualCost = calculateModelCost('gateway', this.model, inputTokens, outputTokens, cachedInputTokens)

      return {
        success: true,
        content: result.text || '',
        inputTokens,
        outputTokens,
        ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
        estimatedCost: actualCost,
        actualCost,
        executionTimeMs,
        provider: 'gateway',
        model: this.model,
      }
    } catch (error: unknown) {
      const { message, errorType } = classifyError(error)
      return this.failure(message, errorType, Date.now() - startTime)
    }
  }

  private failure(error: string, errorType: string, executionTimeMs: number): AIExecutionResult {
    return {
      success: false,
      content: '',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      executionTimeMs,
      provider: 'gateway',
      model: this.model,
      error,
      errorType,
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return calculateModelCost('gateway', this.model, inputTokens, outputTokens)
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
      content: '[BUSINESS BRAIN] Configure OPENAI_API_KEY, ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY',
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

  estimateCost(_inputTokens: number, _outputTokens: number): number {
    return FakeProvider.FIXED_COST
  }
}

export function getAIProvider(preferredProvider?: ProviderName): AIProvider {
  // Deterministic provider ONLY for the integration smoke test. Guarded by an
  // explicit env flag AND a namespace check (see fakeProviderAllowed), so it
  // can never be selected in prod; production always returns real providers
  // (or PendingProvider).
  if (fakeProviderAllowed()) {
    return new FakeProvider(false)
  }

  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const gatewayKey = process.env.AI_GATEWAY_API_KEY

  if (preferredProvider === 'openai' && openaiKey) return new OpenAIProvider(openaiKey)
  if (preferredProvider === 'anthropic' && anthropicKey) return new AnthropicProvider(anthropicKey)
  if (preferredProvider === 'gateway' && gatewayKey) return new GatewayProvider(gatewayKey, gatewayModel())
  if (openaiKey) return new OpenAIProvider(openaiKey)
  if (anthropicKey) return new AnthropicProvider(anthropicKey)
  // Gateway is the last resort: it routes prompts through a third party, so a
  // directly-configured provider always wins.
  if (gatewayKey) return new GatewayProvider(gatewayKey, gatewayModel())
  return new PendingProvider()
}

/** Operator override for the gateway model id, e.g. "moonshotai/kimi-k3". */
function gatewayModel(): ModelName | undefined {
  const configured = process.env.AUTHORITY_GATEWAY_MODEL
  return configured && configured.trim().length > 0 ? configured.trim() : undefined
}
