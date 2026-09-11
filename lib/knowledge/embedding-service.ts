/**
 * Sprint 5.2 Part 6: Embedding Pipeline Service
 *
 * Generates vector embeddings for organizational_knowledge rows using the
 * OpenAI embeddings API (text-embedding-3-small, 1536 dims by default).
 *
 * Design guarantees:
 * - IDEMPOTENT: embedding an already-embedded row with the same model is a
 *   no-op unless `force` is set. Duplicate ingestion of the same content
 *   hashes to the same content_hash and is deduplicated at ingestion.
 * - FAIL-SAFE: failures are RECORDED on the row (embedding_error, attempts)
 *   and never thrown past the caller unless `throwOnError` — a failed
 *   embedding must not break a knowledge write.
 * - RETRY: rows marked failed/pending can be re-processed by re-calling
 *   processEmbeddings; attempts are counted and surfaced.
 * - ORG ISOLATION: every query is scoped by organization_id and callers are
 *   expected to pass a user-scoped Supabase client (RLS applies).
 *
 * NOTE (Sprint 5.3 dependency): this service is SYNCHRONOUS by design today.
 * `processEmbeddings` is safe to call inline after ingestion for small
 * batches, but production-grade throughput/queueing/retry-backoff requires
 * the Sprint 5.3 background infrastructure. Do not treat inline embedding as
 * a production async pipeline yet.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSION = 1536
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const MAX_ATTEMPTS = 3
const BATCH_SIZE = 20

export interface EmbeddingResult {
  processed: number
  embedded: number
  failed: number
  skipped: number
  errors: Array<{ id: string; error: string }>
}

interface KnowledgeRow {
  id: string
  organization_id: string
  title: string | null
  content: string | null
  embedding_model: string | null
  embedding_error: string | null
  embedding_attempts: number
}

/** Normalize text for deduplication hashing. */
export function normalizeContent(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Stable content hash used for duplicate prevention. */
export function hashContent(text: string): string {
  return createHash('sha256').update(normalizeContent(text)).digest('hex')
}

/**
 * Generate one embedding via OpenAI. Exported for testing with mocks.
 */
export async function generateEmbedding(
  apiKey: string,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<number[]> {
  const res = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // ~8k chars guard; model limit is 8191 tokens
      dimensions: EMBEDDING_DIMENSION,
      encoding_format: 'float',
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI embeddings API error ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> }
  const embedding = data.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Unexpected embedding response: expected ${EMBEDDING_DIMENSION} dims, got ${
        Array.isArray(embedding) ? embedding.length : 'non-array'
      }`
    )
  }
  return embedding
}

export class EmbeddingService {
  constructor(private supabase: SupabaseClient) {}

  private apiKey(): string | null {
    const key = process.env.OPENAI_API_KEY
    return key && key.length > 0 ? key : null
  }

  /**
   * Embed a single knowledge row (idempotent). Used right after ingestion.
   */
  async embedKnowledgeRow(rowId: string, organizationId: string): Promise<EmbeddingResult> {
    return this.processEmbeddings(organizationId, { rowIds: [rowId] })
  }

  /**
   * Process all pending/failed knowledge rows for an organization.
   * Safe to call repeatedly (idempotent); capped per invocation.
   */
  async processEmbeddings(
    organizationId: string,
    opts?: { rowIds?: string[]; force?: boolean; batchSize?: number }
  ): Promise<EmbeddingResult> {
    const result: EmbeddingResult = { processed: 0, embedded: 0, failed: 0, skipped: 0, errors: [] }

    const apiKey = this.apiKey()
    if (!apiKey) {
      result.errors.push({
        id: '*',
        error: 'OPENAI_API_KEY not configured; embeddings deferred (rows remain pending)',
      })
      return result
    }

    let query = this.supabase
      .from('organizational_knowledge')
      .select(
        'id, organization_id, title, content, embedding_model, embedding_error, embedding_attempts'
      )
      .eq('organization_id', organizationId)

    if (opts?.rowIds && opts.rowIds.length > 0) {
      query = query.in('id', opts.rowIds)
    } else {
      // Pending = never embedded OR previously failed (attempts < MAX_ATTEMPTS).
      query = query.or(
        `embeddings_pending.eq.true,embedding_error.neq.null`
      )
    }

    const { data: rows, error } = await query.limit(opts?.batchSize ?? BATCH_SIZE)
    if (error) {
      result.errors.push({ id: '*', error: error.message })
      return result
    }

    for (const row of (rows || []) as KnowledgeRow[]) {
      result.processed++

      // IDEMPOTENCY: already embedded with the current model and no error.
      if (
        !opts?.force &&
        row.embedding_model === EMBEDDING_MODEL &&
        !row.embedding_error
      ) {
        result.skipped++
        continue
      }

      // Retry cap.
      if (!opts?.force && (row.embedding_attempts ?? 0) >= MAX_ATTEMPTS) {
        result.skipped++
        continue
      }

      const text = `${row.title ?? ''}\n\n${row.content ?? ''}`.trim()
      if (!text) {
        await this.markFailed(row, organizationId, 'Empty content; cannot embed')
        result.failed++
        continue
      }

      try {
        const embedding = await generateEmbedding(apiKey, text)
        const { error: updateError } = await this.supabase
          .from('organizational_knowledge')
          .update({
            embedding: JSON.stringify(embedding),
            embedding_model: EMBEDDING_MODEL,
            embedding_version: '1',
            embedding_dimension: EMBEDDING_DIMENSION,
            embedded_at: new Date().toISOString(),
            embedding_error: null,
            embeddings_pending: false,
            embedding_attempts: (row.embedding_attempts ?? 0) + 1,
          })
          .eq('id', row.id)
          .eq('organization_id', organizationId)

        if (updateError) {
          await this.markFailed(row, organizationId, `DB update failed: ${updateError.message}`)
          result.failed++
        } else {
          result.embedded++
        }
      } catch (e: any) {
        await this.markFailed(row, organizationId, e?.message || 'Unknown embedding error')
        result.failed++
        result.errors.push({ id: row.id, error: e?.message || 'Unknown error' })
      }
    }

    return result
  }

  private async markFailed(row: KnowledgeRow, organizationId: string, error: string) {
    await this.supabase
      .from('organizational_knowledge')
      .update({
        embedding_error: error.slice(0, 500),
        embedding_attempts: (row.embedding_attempts ?? 0) + 1,
      })
      .eq('id', row.id)
      .eq('organization_id', organizationId)
  }
}
