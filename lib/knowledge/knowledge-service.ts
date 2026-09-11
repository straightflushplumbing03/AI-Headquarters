/**
 * Sprint 5.2 Part 4 + 7: Knowledge Ingestion & Semantic Retrieval
 *
 * Responsibilities (architecture, Part 4):
 *   - INGESTION: normalized, deduplicated knowledge records into the canonical
 *     store (organizational_knowledge) with quality metadata (Part 8).
 *   - RETRIEVAL: `searchKnowledge()` — org-scoped semantic search backed by
 *     the search_org_knowledge RPC (pgvector), with hybrid keyword blending
 *     and metadata filters.
 *
 * Defense in depth (Part 11):
 *   1. Caller must pass a user-scoped Supabase client (session-derived).
 *   2. application-layer authorization is enforced by the CALLER's route
 *      (this module is service code, not a route).
 *   3. RLS on organizational_knowledge constrains every query.
 *   4. The RPC itself filters organization_id — a wrong org id returns zero
 *      rows, never another tenant's data.
 *
 * The organizationId parameter of every method MUST be resolved server-side
 * from the authenticated session (e.g. via organization_members lookup) and
 * NEVER taken from request bodies.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  EmbeddingService,
  hashContent,
  normalizeContent,
} from './embedding-service'

export type KnowledgeSourceType =
  | 'ai_generated'
  | 'task_outcome'
  | 'human_input'
  | 'external'
  | 'system'

export interface IngestKnowledgeInput {
  title: string
  content: string
  knowledgeType:
    | 'finding'
    | 'strategy'
    | 'learning'
    | 'outcome'
    | 'best_practice'
    | 'warning'
  category: string
  source?: string
  sourceType?: KnowledgeSourceType
  sourceTaskId?: string
  /** 0–1. How sure are we this knowledge is correct? */
  confidence?: number
  /** 0–1. How much does this matter to the business? */
  importance?: number
  tags?: string[]
  created_by?: string
  /** Optional review date: after this the memory is flagged for re-validation. */
  reviewAfter?: Date
}

export interface IngestResult {
  id: string | null
  duplicate: boolean
  embedded: boolean
  embeddingError?: string
}

export interface KnowledgeSearchResult {
  id: string
  title: string
  content: string
  knowledgeType: string
  category: string
  tags: string[] | null
  confidence: number | null
  importance: number | null
  source: string | null
  sourceType: string | null
  similarity: number
  keywordRank: number | null
  combinedScore: number
  embeddingModel: string | null
  embeddedAt: string | null
  createdAt: string
  metadata: Record<string, unknown> | null
}

export interface SearchOptions {
  /** Enable hybrid keyword+semantic blending (default true when query text used). */
  hybrid?: boolean
  matchCount?: number
  minSimilarity?: number
  minConfidence?: number
  categories?: string[]
  tags?: string[]
}

export class KnowledgeService {
  private embeddingService: EmbeddingService

  constructor(private supabase: SupabaseClient) {
    this.embeddingService = new EmbeddingService(supabase)
  }

  // ==========================================================================
  // INGESTION (normalize → dedupe → record → embed)
  // ==========================================================================

  /**
   * Ingest one knowledge item. Idempotent per (organization, content hash):
   * re-ingesting identical content returns the existing row without duplicating.
   *
   * Embedding happens inline (best-effort) — see EmbeddingService for the
   * Sprint 5.3 note on background processing.
   */
  async ingestKnowledge(
    organizationId: string,
    input: IngestKnowledgeInput
  ): Promise<IngestResult> {
    if (!input.title?.trim() || !input.content?.trim()) {
      throw new Error('Knowledge title and content are required')
    }

    // Quality gate: reject trivially short content (junk prevention, Part 8).
    if (normalizeContent(input.content).length < 20) {
      throw new Error('Knowledge content too short to be meaningful (min 20 chars)')
    }

    const contentHash = hashContent(`${input.title}\n${input.content}`)

    // DEDUPLICATION: check hash first (the unique index backs this up).
    const { data: existing } = await this.supabase
      .from('organizational_knowledge')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('content_hash', contentHash)
      .maybeSingle()

    if (existing) {
      return { id: existing.id, duplicate: true, embedded: false }
    }

    const insert = {
      organization_id: organizationId,
      knowledge_type: input.knowledgeType,
      category: input.category,
      title: input.title.trim(),
      content: input.content.trim(),
      source: input.source ?? null,
      source_type: input.sourceType ?? 'system',
      source_task_id: input.sourceTaskId ?? null,
      confidence: input.confidence ?? 0.5,
      importance: input.importance ?? 0.5,
      tags: input.tags ?? [],
      created_by: input.created_by ?? null,
      embeddings_pending: true,
      content_hash: contentHash,
      review_after: input.reviewAfter?.toISOString() ?? null,
    }

    const { data: row, error } = await this.supabase
      .from('organizational_knowledge')
      .insert(insert)
      .select('id')
      .single()

    if (error) {
      // Unique hash violation under concurrency = another request won; treat
      // as duplicate (idempotent behavior).
      if (error.code === '23505') {
        const { data: winner } = await this.supabase
          .from('organizational_knowledge')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('content_hash', contentHash)
          .maybeSingle()
        return { id: winner?.id ?? null, duplicate: true, embedded: false }
      }
      throw error
    }

    // BEST-EFFORT inline embedding; failure never fails the ingestion.
    let embedded = false
    let embeddingError: string | undefined
    try {
      const emb = await this.embeddingService.embedKnowledgeRow(row.id, organizationId)
      embedded = emb.embedded > 0
      if (emb.errors.length > 0) embeddingError = emb.errors[0].error
    } catch (e: any) {
      embeddingError = e?.message || 'Embedding failed'
    }

    return { id: row.id, duplicate: false, embedded, embeddingError }
  }

  // ==========================================================================
  // SEMANTIC RETRIEVAL (Part 7)
  // ==========================================================================

  /**
   * searchKnowledge — semantic (vector) search with optional hybrid keyword
   * blending and metadata filters. ORGANIZATION ISOLATION IS ENFORCED IN THE
   * DATABASE via the RPC's organization filter AND RLS.
   *
   * `queryEmbedding` is produced by the caller via `embedQuery()` — this keeps
   * this service DB-only and testable, and lets routes reuse one embedding for
   * multiple queries.
   */
  async searchKnowledge(
    queryEmbedding: number[],
    organizationId: string,
    queryText?: string,
    options?: SearchOptions
  ): Promise<KnowledgeSearchResult[]> {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      throw new Error('queryEmbedding must be a non-empty vector')
    }

    const { data, error } = await this.supabase.rpc('search_org_knowledge', {
      p_query_embedding: queryEmbedding,
      p_organization_id: organizationId,
      p_query_text: options?.hybrid === false ? null : (queryText ?? null),
      p_match_count: Math.min(options?.matchCount ?? 8, 50),
      p_min_similarity: options?.minSimilarity ?? 0.2,
      p_min_confidence: options?.minConfidence ?? 0.0,
      p_statuses: ['active'],
      p_categories: options?.categories ?? null,
      p_tags: options?.tags ?? null,
    })

    if (error) throw new Error(`Knowledge search failed: ${error.message}`)
    return (data || []) as KnowledgeSearchResult[]
  }

  /**
   * Embed a query string for search. Uses the same model as document
   * embeddings (required for comparable vector spaces).
   */
  async embedQuery(text: string): Promise<number[]> {
    const { generateEmbedding } = await import('./embedding-service')
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured; semantic search unavailable')
    return generateEmbedding(apiKey, text)
  }

  /**
   * Convenience one-shot search: embeds the text then searches.
   */
  async searchByText(
    text: string,
    organizationId: string,
    options?: SearchOptions
  ): Promise<KnowledgeSearchResult[]> {
    const embedding = await this.embedQuery(text)
    return this.searchKnowledge(embedding, organizationId, text, options)
  }

  /**
   * Record that knowledge was used (retrieval-quality signal, Part 8).
   */
  async recordAccess(knowledgeIds: string[]): Promise<void> {
    if (knowledgeIds.length === 0) return
    await this.supabase.rpc('record_knowledge_access', { p_knowledge_ids: knowledgeIds })
  }
}
