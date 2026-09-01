/**
 * Embedding Service — Semantic Knowledge Retrieval Foundation
 *
 * Architecture:
 *   Knowledge → Embedding → Vector Storage → Similarity Search → Relevant Context
 *
 * Design principles:
 * - Embedding generation is OPTIONAL. Normal application functionality works
 *   without an embedding provider.
 * - If a provider is unavailable, embeddings_pending remains accurate and
 *   records remain retryable.
 * - Provider is selected from the existing AI provider infrastructure.
 * - No fake embeddings are ever created.
 * - All failures are observable and records are retryable.
 *
 * Database requirement:
 *   See migration 09_embeddings.sql for the required schema changes
 *   (pgvector extension, embedding column on organizational_knowledge, etc.)
 */

import { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly name: string
  readonly model: string
  readonly dimensions: number
  /** Generate an embedding vector for the given text. */
  embed(text: string): Promise<number[]>
}

export interface KnowledgeRecord {
  id: string
  organization_id: string
  content: string
  [key: string]: unknown
}

export interface SemanticSearchResult<T extends KnowledgeRecord = KnowledgeRecord> {
  record: T
  similarity: number
}

// ─── OpenAI Embedding Provider ─────────────────────────────────────────────

/**
 * OpenAIEmbeddingProvider wraps the OpenAI embeddings API.
 * Falls back gracefully if the API key is not configured.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai'
  readonly model: string
  readonly dimensions: number

  constructor(
    private readonly apiKey: string,
    options: { model?: string; dimensions?: number } = {}
  ) {
    this.model = options.model ?? 'text-embedding-3-small'
    this.dimensions = options.dimensions ?? 1536
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey,
      },
      body: JSON.stringify({ input: text.slice(0, 8191), model: this.model }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(`OpenAI embeddings error ${response.status}: ${(err as any)?.error?.message ?? 'unknown'}`)
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> }
    return data.data[0].embedding
  }
}

// ─── EmbeddingService ──────────────────────────────────────────────────────

/**
 * EmbeddingService manages:
 * - Generating embeddings for knowledge records
 * - Storing embeddings in the database
 * - Tracking pending / failed embeddings
 * - Vector similarity search with organization filtering
 * - Retry of previously failed records
 */
export class EmbeddingService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly provider: EmbeddingProvider | null = null
  ) {}

  get isAvailable(): boolean {
    return this.provider !== null
  }

  /**
   * Generate and store an embedding for a single knowledge record.
   * If the provider is unavailable, marks the record as pending without error.
   */
  async embedRecord(
    table: string,
    recordId: string,
    content: string,
    organizationId: string
  ): Promise<{ embedded: boolean; reason?: string }> {
    if (!this.provider) {
      // No provider — mark pending so it can be retried later
      await this.supabase
        .from(table)
        .update({ embeddings_pending: true, embedding_error: null })
        .eq('id', recordId)
        .eq('organization_id', organizationId)
      return { embedded: false, reason: 'No embedding provider configured; marked as pending' }
    }

    try {
      const vector = await this.provider.embed(content)
      await this.supabase
        .from(table)
        .update({
          embedding: JSON.stringify(vector),
          embeddings_pending: false,
          embedding_model: this.provider.model,
          embedding_error: null,
          embedded_at: new Date().toISOString(),
        })
        .eq('id', recordId)
        .eq('organization_id', organizationId)

      return { embedded: true }
    } catch (err: any) {
      // Record failure so it is observable and retryable
      await this.supabase
        .from(table)
        .update({
          embeddings_pending: true,
          embedding_error: err?.message ?? 'Unknown error',
        })
        .eq('id', recordId)
        .eq('organization_id', organizationId)

      return { embedded: false, reason: err?.message ?? 'Embedding failed' }
    }
  }

  /**
   * Process all records that have embeddings_pending = true for an organization.
   * Returns counts of successes and failures.
   */
  async processPending(
    table: string,
    contentColumn: string,
    organizationId: string,
    limit = 50
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (!this.provider) {
      return { processed: 0, succeeded: 0, failed: 0 }
    }

    const { data: records } = await this.supabase
      .from(table)
      .select(`id, organization_id, ${contentColumn}`)
      .eq('organization_id', organizationId)
      .eq('embeddings_pending', true)
      .limit(limit)

    if (!records?.length) return { processed: 0, succeeded: 0, failed: 0 }

    let succeeded = 0
    let failed = 0

    for (const record of records) {
      const content: string = record[contentColumn] ?? ''
      if (!content) {
        failed++
        continue
      }
      const result = await this.embedRecord(table, record.id, content, organizationId)
      if (result.embedded) succeeded++
      else failed++
    }

    return { processed: records.length, succeeded, failed }
  }

  /**
   * Semantic similarity search via pgvector.
   *
   * Requires the pgvector extension and an `embedding` column (vector type)
   * on the target table. Falls back to empty results if not available.
   */
  async similaritySearch<T extends KnowledgeRecord>(
    table: string,
    queryText: string,
    organizationId: string,
    options: { limit?: number; threshold?: number } = {}
  ): Promise<SemanticSearchResult<T>[]> {
    if (!this.provider) return []

    const { limit = 10, threshold = 0.7 } = options

    let queryVector: number[]
    try {
      queryVector = await this.provider.embed(queryText)
    } catch {
      return []
    }

    // Use Supabase's RPC for vector similarity search.
    // The function `match_knowledge_by_embedding` must exist (see migration 09_embeddings.sql).
    const { data, error } = await this.supabase.rpc('match_knowledge_by_embedding', {
      p_table: table,
      p_organization_id: organizationId,
      p_embedding: JSON.stringify(queryVector),
      p_match_threshold: threshold,
      p_match_count: limit,
    })

    if (error) {
      // pgvector may not be enabled — silently return empty
      return []
    }

    return (data ?? []).map((row: any) => ({
      record: row as T,
      similarity: row.similarity ?? 0,
    }))
  }
}

/**
 * Factory: creates an EmbeddingService from environment variables.
 * Returns a service with no provider if credentials are absent.
 */
export function createEmbeddingService(supabase: SupabaseClient): EmbeddingService {
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    return new EmbeddingService(supabase, new OpenAIEmbeddingProvider(openaiKey))
  }
  // No provider available — service still works, embeddings are deferred
  return new EmbeddingService(supabase, null)
}
