/**
 * AI Authority Engine -- AI engine adapter interface and shared helpers.
 *
 * COMPLIANCE POSTURE (read before adding an adapter):
 *
 * There is no official API that returns "what does ChatGPT recommend to a
 * consumer in San Clemente". Consumer AI search surfaces are not exposed as a
 * queryable ranking service. Adapters therefore do one of two honest things:
 *
 *   1. Use an AUTHORIZED, documented provider API (an API key the operator
 *      owns, under the provider's own terms) to ask the same question a
 *      customer would ask, and record whatever comes back.
 *   2. Report `unsupported` when no authorized programmatic path exists.
 *
 * No adapter may scrape a consumer UI, defeat bot protections, or synthesize a
 * plausible-looking answer. Every adapter declares its capability truthfully,
 * and `capability()` reflects the live environment, not an aspiration.
 */

import type {
  AdapterErrorType,
  AdapterQueryRequest,
  AdapterResult,
  AIEngineAdapter,
  EngineCapability,
  EngineKey,
} from '../types'

export const ADAPTER_VERSION = 'v1'

/**
 * Neutral system framing shared by every adapter.
 *
 * The prompt deliberately does NOT mention the monitored business. Priming the
 * model would measure the prompt, not the model's ordinary behaviour. We ask an
 * ordinary local-recommendation question and record the answer.
 */
export const NEUTRAL_SYSTEM_PROMPT =
  'You are a helpful assistant answering a homeowner looking for a local service ' +
  'provider. Answer the question directly and naturally, as you normally would. ' +
  'If you recommend specific businesses, name them. If citing sources is ' +
  'supported, include them.'

export function skippedResult(
  reason: string,
  errorType: AdapterErrorType,
  model: string | null = null
): AdapterResult {
  return {
    ok: false,
    text: '',
    model,
    citations: [],
    latencyMs: 0,
    tokensInput: 0,
    tokensOutput: 0,
    actualCost: 0,
    error: reason,
    errorType,
    skipped: true,
    skipReason: reason,
  }
}

export function failureResult(
  error: string,
  errorType: AdapterErrorType,
  model: string | null,
  latencyMs: number
): AdapterResult {
  return {
    ok: false,
    text: '',
    model,
    citations: [],
    latencyMs,
    tokensInput: 0,
    tokensOutput: 0,
    actualCost: 0,
    error,
    errorType,
    skipped: false,
  }
}

/**
 * Per-query timeout. Bounded so a hung provider cannot pin a worker lease.
 * Configurable, but clamped to a sane range.
 */
export function adapterTimeout(): number {
  const raw = Number(process.env.AUTHORITY_ADAPTER_TIMEOUT_MS)
  if (!Number.isFinite(raw) || raw <= 0) return 30_000
  return Math.min(Math.max(Math.round(raw), 2_000), 120_000)
}

/** True when an API key is present and non-empty after trimming. */
export function hasCredential(envVar: string | null | undefined): boolean {
  if (!envVar) return false
  const value = process.env[envVar]
  return typeof value === 'string' && value.trim().length > 0
}

/** Extract a bare hostname from a URL, tolerating malformed input. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** Map an HTTP status to the repo's adapter error taxonomy. */
export function classifyHttpStatus(status: number): AdapterErrorType {
  if (status === 401 || status === 403) return 'authentication_failed'
  if (status === 429) return 'rate_limited'
  if (status === 408 || status === 504) return 'timeout'
  return 'unknown_error'
}

/** Classify a thrown fetch error without leaking request internals. */
export function classifyThrownError(error: unknown): { message: string; errorType: AdapterErrorType } {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error')
  if (/abort|timeout|timed out/i.test(message)) return { message, errorType: 'timeout' }
  return { message, errorType: 'unknown_error' }
}

export interface ProviderCallResult {
  text: string
  citations: Array<{ url: string; title?: string }>
  tokensInput: number
  tokensOutput: number
  model?: string
}

/**
 * Shared base implementing the parts of AIEngineAdapter that do not vary.
 * Subclasses supply `callProvider`.
 */
export abstract class BaseEngineAdapter implements AIEngineAdapter {
  abstract readonly key: EngineKey
  abstract readonly displayName: string
  abstract readonly vendor: string
  abstract readonly credentialEnvVar: string | null
  protected abstract readonly defaultModel: string | null

  /** Implemented by each provider; must not throw on a normal API error. */
  protected abstract callProvider(
    request: AdapterQueryRequest,
    model: string,
    timeoutMs: number
  ): Promise<ProviderCallResult>

  constructor(protected readonly timeoutMs: number = 30_000) {}

  isConfigured(): boolean {
    return hasCredential(this.credentialEnvVar)
  }

  capability(): EngineCapability {
    return this.isConfigured() ? 'supported' : 'requires_credential'
  }

  model(): string | null {
    return this.defaultModel
  }

  async executeQuery(request: AdapterQueryRequest): Promise<AdapterResult> {
    if (!this.isConfigured()) {
      return skippedResult(
        `${this.displayName} adapter is not configured (missing ${this.credentialEnvVar})`,
        'not_configured',
        this.defaultModel
      )
    }

    const model = this.defaultModel ?? 'unknown'
    const startedAt = Date.now()

    try {
      const response = await this.callProvider(request, model, this.timeoutMs)
      const latencyMs = Date.now() - startedAt
      const text = (response.text ?? '').trim()

      if (!text) {
        return failureResult('provider returned an empty response', 'invalid_response', model, latencyMs)
      }

      return {
        ok: true,
        text,
        model: response.model ?? model,
        citations: (response.citations ?? []).map((c) => ({
          url: c.url,
          title: c.title,
          domain: domainOf(c.url),
        })),
        latencyMs,
        tokensInput: response.tokensInput,
        tokensOutput: response.tokensOutput,
        actualCost: 0, // settled by the cost estimator, not guessed here
      }
    } catch (error) {
      const { message, errorType } = classifyThrownError(error)
      return failureResult(message, errorType, model, Date.now() - startedAt)
    }
  }
}

/**
 * Adapter registry. The registry is a pure function of the process
 * environment: adapters are always constructible so the UI can show an honest
 * `requires_credential` state rather than hiding an engine entirely.
 */
export class EngineAdapterRegistry {
  private static adapters: Map<EngineKey, AIEngineAdapter> | null = null

  static register(adapter: AIEngineAdapter): void {
    if (!EngineAdapterRegistry.adapters) EngineAdapterRegistry.adapters = new Map()
    EngineAdapterRegistry.adapters.set(adapter.key, adapter)
  }

  static get(key: string): AIEngineAdapter | undefined {
    return EngineAdapterRegistry.adapters?.get(key as EngineKey)
  }

  static all(): AIEngineAdapter[] {
    return [...(EngineAdapterRegistry.adapters?.values() ?? [])]
  }

  static clear(): void {
    EngineAdapterRegistry.adapters = null
  }
}