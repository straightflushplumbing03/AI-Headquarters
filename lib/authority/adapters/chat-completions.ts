/**
 * Shared HTTP plumbing for adapters whose provider exposes an
 * OpenAI-compatible chat-completions endpoint.
 *
 * OpenAI, Perplexity (sonar) and xAI (Grok) all document this shape. Google's
 * Gemini uses a different payload and gets its own helper.
 *
 * Rules enforced here:
 *   - an explicit timeout via AbortController (no hung monitoring jobs)
 *   - the response body is never trusted to be well formed
 *   - HTTP errors are surfaced as errors, never as empty "successful" answers
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionResult {
  text: string
  citations: Array<{ url: string; title?: string }>
  tokensInput: number
  tokensOutput: number
  model: string | null
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorType: string
  ) {
    super(message)
    this.name = 'ProviderHttpError'
  }
}

export interface ChatCompletionOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  timeoutMs: number
  maxTokens?: number
  temperature?: number
  extraHeaders?: Record<string, string>
  /** Extra top-level body fields some providers require. */
  extraBody?: Record<string, unknown>
}

export async function callChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    let response: Response
    try {
      response = await fetch(options.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
          ...(options.extraHeaders ?? {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          max_tokens: options.maxTokens ?? 1200,
          temperature: options.temperature ?? 0.2,
          ...(options.extraBody ?? {}),
        }),
        signal: controller.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isAbort = /abort|timeout/i.test(message)
      throw new ProviderHttpError(
        isAbort ? `request timed out after ${options.timeoutMs}ms` : message,
        isAbort ? 408 : 0,
        isAbort ? 'timeout' : 'unknown_error'
      )
    }

    const raw = await response.text()

    if (!response.ok) {
      throw new ProviderHttpError(
        `provider returned HTTP ${response.status}: ${truncate(raw, 300)}`,
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
      throw new ProviderHttpError('provider returned non-JSON body', response.status, 'invalid_response')
    }

    return extractChatCompletion(parsed)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read a chat-completions payload defensively. Every field is optional as far
 * as we are concerned: the only hard requirement is a non-empty answer, which
 * the adapter base class enforces.
 */
export function extractChatCompletion(parsed: unknown): ChatCompletionResult {
  const body = (parsed ?? {}) as Record<string, unknown>

  const choices = Array.isArray(body.choices) ? body.choices : []
  const firstChoice = (choices[0] ?? {}) as Record<string, unknown>
  const message = (firstChoice.message ?? {}) as Record<string, unknown>

  let text = typeof message.content === 'string' ? message.content : ''
  // Some providers return content as an array of parts.
  if (!text && Array.isArray(message.content)) {
    text = message.content
      .map((part) => {
        const p = (part ?? {}) as Record<string, unknown>
        return typeof p.text === 'string' ? p.text : ''
      })
      .join('')
  }

  const usage = (body.usage ?? {}) as Record<string, unknown>
  const tokensInput = numberOrZero(usage.prompt_tokens ?? usage.input_tokens)
  const tokensOutput = numberOrZero(usage.completion_tokens ?? usage.output_tokens)

  return {
    text,
    citations: extractInlineCitations(body),
    tokensInput,
    tokensOutput,
    model: typeof body.model === 'string' ? body.model : null,
  }
}

/**
 * Citations may arrive either as a dedicated field (Perplexity `citations`,
 * `search_results`) or nested in the message. Collect whatever is present and
 * normalize; duplicates by URL are collapsed.
 */
function extractInlineCitations(body: Record<string, unknown>): Array<{ url: string; title?: string }> {
  const found = new Map<string, { url: string; title?: string }>()

  const push = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    if (!found.has(url)) {
      found.set(url, { url, title: typeof title === 'string' ? title : undefined })
    }
  }

  const visitArray = (value: unknown) => {
    if (!Array.isArray(value)) return
    for (const entry of value) {
      if (typeof entry === 'string') push(entry, undefined)
      else if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>
        push(e.url ?? e.link, e.title ?? e.name)
      }
    }
  }

  visitArray(body.citations)
  visitArray(body.search_results)

  const choices = Array.isArray(body.choices) ? body.choices : []
  for (const choice of choices) {
    const c = (choice ?? {}) as Record<string, unknown>
    const message = (c.message ?? {}) as Record<string, unknown>
    visitArray(message.citations)
    if (Array.isArray(message.annotations)) {
      for (const annotation of message.annotations as unknown[]) {
        const a = (annotation ?? {}) as Record<string, unknown>
        const citation = (a.url_citation ?? {}) as Record<string, unknown>
        push(citation.url, citation.title)
      }
    }
  }

  return [...found.values()]
}

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}