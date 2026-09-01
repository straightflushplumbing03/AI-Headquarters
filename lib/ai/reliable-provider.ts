import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'
import { AIProvider } from './providers'

export interface ReliabilityConfig {
  /** Maximum number of attempts (initial + retries). Default: 3 */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelayMs?: number
  /** Maximum delay between retries in ms. Default: 30000 */
  maxDelayMs?: number
  /** Request timeout in ms. Default: 30000 */
  timeoutMs?: number
  /** Budget limit in USD for this request. Undefined = no limit enforced here. */
  budgetLimitUSD?: number
}

export interface ReliableExecutionResult extends AIExecutionResult {
  attempts: number
  requestId: string
}

const DEFAULT_CONFIG: Required<ReliabilityConfig> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  timeoutMs: 30_000,
  budgetLimitUSD: Infinity,
}

/** Error types that should NOT be retried */
const NON_RETRYABLE_ERROR_TYPES = new Set([
  'provider_not_configured',
  'authentication_failed',
  'budget_exceeded',
  'invalid_request',
])

/**
 * Classifies HTTP status codes / error types into retryable vs non-retryable.
 */
function isRetryable(result: AIExecutionResult): boolean {
  if (!result.errorType) return false
  if (NON_RETRYABLE_ERROR_TYPES.has(result.errorType)) return false
  // rate_limit, timeout, network errors and unknown_error are retryable
  return true
}

/**
 * Compute exponential backoff delay with jitter.
 */
function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(attempt, 10) // cap exponent
  const delay = Math.min(baseMs * 2 ** exp, maxMs)
  // Add ±20% jitter to avoid thundering herd
  const jitter = delay * 0.2 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(delay + jitter))
}

/**
 * Execute an AI request with a timeout, returning a timeout-failure result if exceeded.
 */
async function executeWithTimeout(
  provider: AIProvider,
  request: AIExecutionRequest,
  timeoutMs: number,
  requestId: string
): Promise<AIExecutionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<AIExecutionResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: timeoutMs,
        provider: provider.name,
        model: 'unknown',
        error: `Request timed out after ${timeoutMs}ms`,
        errorType: 'timeout',
      })
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([provider.execute(request), timeoutPromise])
    clearTimeout(timer)
    return result
  } catch (err: any) {
    clearTimeout(timer)
    return {
      success: false,
      content: '',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      executionTimeMs: 0,
      provider: provider.name,
      model: 'unknown',
      error: err?.message ?? 'Unexpected error',
      errorType: 'unknown_error',
    }
  }
}

/**
 * ReliableAIProvider wraps any AIProvider with:
 * - Request timeout
 * - Automatic retry with exponential backoff and jitter
 * - Distinction between retryable and non-retryable errors
 * - Rate-limit awareness (backs off on rate_limit errors)
 * - Cost / budget enforcement
 * - Structured request IDs for observability
 */
export class ReliableAIProvider {
  private config: Required<ReliabilityConfig>

  constructor(
    private provider: AIProvider,
    config: ReliabilityConfig = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async execute(request: AIExecutionRequest): Promise<ReliableExecutionResult> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const { maxAttempts, baseDelayMs, maxDelayMs, timeoutMs, budgetLimitUSD } = this.config

    // Budget pre-check
    const estimatedCost = this.provider.estimateCost(
      // rough token estimates if not provided
      Math.ceil((request.userMessage.length + (request.systemPrompt?.length ?? 0)) / 4),
      request.maxTokens ?? 2000
    )
    if (estimatedCost > budgetLimitUSD) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost,
        actualCost: 0,
        executionTimeMs: 0,
        provider: this.provider.name,
        model: 'unknown',
        error: `Estimated cost $${estimatedCost.toFixed(4)} exceeds budget limit $${budgetLimitUSD.toFixed(4)}`,
        errorType: 'budget_exceeded',
        attempts: 0,
        requestId,
      }
    }

    let lastResult: AIExecutionResult | undefined
    let totalCost = 0
    let attemptsMade = 0

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Compute and apply pre-attempt delay (skip on first attempt)
      if (attempt > 0) {
        // For rate-limit errors use a longer base delay; otherwise standard exponential backoff
        const isRateLimit = lastResult?.errorType === 'rate_limit'
        const delay = backoffDelay(attempt - 1, isRateLimit ? baseDelayMs * 4 : baseDelayMs, maxDelayMs)
        await new Promise<void>((resolve) => setTimeout(resolve, delay))
      }

      attemptsMade = attempt + 1
      const result = await executeWithTimeout(this.provider, request, timeoutMs, requestId)
      totalCost += result.actualCost ?? 0
      lastResult = result

      if (result.success) {
        return {
          ...result,
          actualCost: totalCost,
          attempts: attemptsMade,
          requestId,
        }
      }

      // Don't retry non-retryable errors
      if (!isRetryable(result)) {
        break
      }
    }

    return {
      ...(lastResult as AIExecutionResult),
      actualCost: totalCost,
      attempts: attemptsMade,
      requestId,
    }
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    return this.provider.estimateCost(inputTokens, outputTokens)
  }

  get name() {
    return this.provider.name
  }

  get isConfigured() {
    return this.provider.isConfigured
  }

  get status() {
    return this.provider.status
  }
}

/**
 * Convenience factory that wraps the given provider with default reliability settings.
 */
export function makeReliable(provider: AIProvider, config?: ReliabilityConfig): ReliableAIProvider {
  return new ReliableAIProvider(provider, config)
}
