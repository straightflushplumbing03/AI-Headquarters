/**
 * Engine adapters, one per monitored surface.
 *
 * Each adapter names the surface it measures and declares its capability from
 * the live environment. None of them scrape consumer UIs.
 */

import {
  BaseEngineAdapter,
  NEUTRAL_SYSTEM_PROMPT,
  adapterTimeout,
  skippedResult,
  type ProviderCallResult,
} from './base'
import { callChatCompletion, ProviderHttpError } from './chat-completions'
import type { AdapterQueryRequest, AdapterResult, EngineCapability, EngineKey } from '../types'

/**
 * ChatGPT surface, via the OpenAI API the operator owns.
 *
 * Honest limitation recorded in the adapter itself: the public API models the
 * model's behaviour, not every consumer ChatGPT surface (which can include
 * personalised or tool-augmented context we cannot observe). The engine treats
 * these responses as ONE measurable signal, not as ground truth about what any
 * individual customer sees.
 */
export class ChatGptAdapter extends BaseEngineAdapter {
  readonly key: EngineKey = 'chatgpt'
  readonly displayName = 'ChatGPT'
  readonly vendor = 'OpenAI'
  readonly credentialEnvVar = 'OPENAI_API_KEY'
  protected readonly defaultModel = process.env.AUTHORITY_CHATGPT_MODEL ?? 'gpt-4o'

  constructor(timeoutMs?: number) {
    super(timeoutMs ?? adapterTimeout())
  }

  protected async callProvider(
    request: AdapterQueryRequest,
    model: string,
    timeoutMs: number
  ): Promise<ProviderCallResult> {
    const result = await callChatCompletion({
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      apiKey: process.env.OPENAI_API_KEY!,
      model,
      timeoutMs,
      maxTokens: request.maxTokens ?? 1200,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: 'system', content: NEUTRAL_SYSTEM_PROMPT },
        { role: 'user', content: request.query },
      ],
    })
    return {
      text: result.text,
      citations: result.citations,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      model: result.model ?? model,
    }
  }
}

/** Gemini surface, via the Google Generative Language API. */
export class GeminiAdapter extends BaseEngineAdapter {
  readonly key: EngineKey = 'gemini'
  readonly displayName = 'Gemini'
  readonly vendor = 'Google'
  readonly credentialEnvVar = 'GEMINI_API_KEY'
  protected readonly defaultModel = process.env.AUTHORITY_GEMINI_MODEL ?? 'gemini-1.5-pro'

  constructor(timeoutMs?: number) {
    super(timeoutMs ?? adapterTimeout())
  }

  protected async callProvider(
    request: AdapterQueryRequest,
    model: string,
    timeoutMs: number
  ): Promise<ProviderCallResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`

    try {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: NEUTRAL_SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: request.query }] }],
            generationConfig: {
              maxOutputTokens: request.maxTokens ?? 1200,
              temperature: request.temperature ?? 0.2,
            },
          }),
          signal: controller.signal,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isAbort = /abort|timeout/i.test(message)
        throw new ProviderHttpError(
          isAbort ? `request timed out after ${timeoutMs}ms` : message,
          isAbort ? 408 : 0,
          isAbort ? 'timeout' : 'unknown_error'
        )
      }

      const raw = await response.text()
      if (!response.ok) {
        throw new ProviderHttpError(
          `Gemini returned HTTP ${response.status}`,
          response.status,
          response.status === 401 || response.status === 403
            ? 'authentication_failed'
            : response.status === 429
              ? 'rate_limited'
              : 'unknown_error'
        )
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new ProviderHttpError('Gemini returned non-JSON body', response.status, 'invalid_response')
      }

      const body = (parsed ?? {}) as Record<string, unknown>
      const candidates = Array.isArray(body.candidates) ? body.candidates : []
      const first = (candidates[0] ?? {}) as Record<string, unknown>
      const content = (first.content ?? {}) as Record<string, unknown>
      const parts = Array.isArray(content.parts) ? content.parts : []
      const text = parts
        .map((p) => {
          const part = (p ?? {}) as Record<string, unknown>
          return typeof part.text === 'string' ? part.text : ''
        })
        .join('')

      const usage = (body.usageMetadata ?? {}) as Record<string, unknown>
      const citations = extractGeminiGrounding(first)

      return {
        text,
        citations,
        tokensInput: toInt(usage.promptTokenCount),
        tokensOutput: toInt(usage.candidatesTokenCount),
        model,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Gemini returns grounding sources when search grounding is enabled. */
function extractGeminiGrounding(candidate: Record<string, unknown>): Array<{ url: string; title?: string }> {
  const meta = (candidate.groundingMetadata ?? {}) as Record<string, unknown>
  const chunks = Array.isArray(meta.groundingChunks) ? meta.groundingChunks : []
  const out: Array<{ url: string; title?: string }> = []
  for (const chunk of chunks) {
    const c = (chunk ?? {}) as Record<string, unknown>
    const web = (c.web ?? {}) as Record<string, unknown>
    if (typeof web.uri === 'string') {
      out.push({ url: web.uri, title: typeof web.title === 'string' ? web.title : undefined })
    }
  }
  return out
}

/**
 * Perplexity surface. This provider returns citations natively, which makes it
 * the highest-signal monitoring source when configured.
 */
export class PerplexityAdapter extends BaseEngineAdapter {
  readonly key: EngineKey = 'perplexity'
  readonly displayName = 'Perplexity'
  readonly vendor = 'Perplexity AI'
  readonly credentialEnvVar = 'PERPLEXITY_API_KEY'
  protected readonly defaultModel = process.env.AUTHORITY_PERPLEXITY_MODEL ?? 'sonar'

  constructor(timeoutMs?: number) {
    super(timeoutMs ?? adapterTimeout())
  }

  protected async callProvider(
    request: AdapterQueryRequest,
    model: string,
    timeoutMs: number
  ): Promise<ProviderCallResult> {
    const result = await callChatCompletion({
      baseUrl: 'https://api.perplexity.ai/chat/completions',
      apiKey: process.env.PERPLEXITY_API_KEY!,
      model,
      timeoutMs,
      maxTokens: request.maxTokens ?? 1200,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: 'system', content: NEUTRAL_SYSTEM_PROMPT },
        { role: 'user', content: request.query },
      ],
    })
    return {
      text: result.text,
      citations: result.citations,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      model: result.model ?? model,
    }
  }
}

/** Grok surface, via the xAI OpenAI-compatible endpoint. */
export class GrokAdapter extends BaseEngineAdapter {
  readonly key: EngineKey = 'grok'
  readonly displayName = 'Grok'
  readonly vendor = 'xAI'
  readonly credentialEnvVar = 'XAI_API_KEY'
  protected readonly defaultModel = process.env.AUTHORITY_GROK_MODEL ?? 'grok-2'

  constructor(timeoutMs?: number) {
    super(timeoutMs ?? adapterTimeout())
  }

  protected async callProvider(
    request: AdapterQueryRequest,
    model: string,
    timeoutMs: number
  ): Promise<ProviderCallResult> {
    const result = await callChatCompletion({
      baseUrl: 'https://api.x.ai/v1/chat/completions',
      apiKey: process.env.XAI_API_KEY!,
      model,
      timeoutMs,
      maxTokens: request.maxTokens ?? 1200,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: 'system', content: NEUTRAL_SYSTEM_PROMPT },
        { role: 'user', content: request.query },
      ],
    })
    return {
      text: result.text,
      citations: result.citations,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
      model: result.model ?? model,
    }
  }
}

/**
 * Google AI search surfaces (AI Overviews, the search app's AI responses).
 *
 * There is no authorized programmatic access to these consumer surfaces. This
 * adapter exists so the engine can report the gap HONESTLY: it is registered,
 * it is visible in the Engines view, and it returns `unsupported` rather than a
 * fabricated or scraped answer. If Google later publishes authorized access,
 * this is the single place to implement it.
 */
export class GoogleAiSurfaceAdapter extends BaseEngineAdapter {
  readonly key: EngineKey = 'google_ai'
  readonly displayName = 'Google AI / Search surfaces'
  readonly vendor = 'Google'
  readonly credentialEnvVar: string | null = null
  protected readonly defaultModel: string | null = null

  isConfigured(): boolean {
    return false
  }

  capability(): EngineCapability {
    return 'unsupported'
  }

  protected async callProvider(): Promise<ProviderCallResult> {
    throw new ProviderHttpError(
      'Google AI search surfaces expose no authorized programmatic API; monitoring is not possible',
      0,
      'unsupported'
    )
  }

  async executeQuery(): Promise<AdapterResult> {
    return skippedResult(
      'No authorized programmatic API exists for Google AI search surfaces. ' +
        'Recorded as unsupported rather than estimated or scraped.',
      'unsupported'
    )
  }
}

/** Maximum time any single monitored query may take. */
export { adapterTimeout } from './base'

function toInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}