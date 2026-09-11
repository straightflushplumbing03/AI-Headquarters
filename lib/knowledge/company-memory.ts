/**
 * Sprint 5.2 Part 9: Company Memory Service
 *
 * company_memory is the DURABLE ORGANIZATIONAL MEMORY LEDGER — curated,
 * high-confidence business knowledge learned from actual activity
 * (strategies that worked/failed, customer patterns, business rules,
 * decision outcomes, operational lessons).
 *
 * It is NOT an automatic AI-response dump:
 *  - writes require a source, explicit confidence, and evidence,
 *  - low-confidence memories are stored as 'under_review', not 'active',
 *  - duplicate content is rejected via hash,
 *  - stale memories expire via the expire_stale_memories RPC (worker in 5.3).
 *
 * ORGANIZATION SCOPING: as with KnowledgeService, the organizationId passed
 * here MUST be resolved server-side from the authenticated session. RLS on
 * company_memory enforces isolation at the database level as well.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { hashContent, normalizeContent } from './embedding-service'

export type MemorySourceType =
  | 'ai_generated'
  | 'task_outcome'
  | 'human_input'
  | 'external'
  | 'system'

export interface MemoryRecord {
  id: string
  organization_id: string
  category: string
  title: string
  content: string
  source_type: MemorySourceType
  source_ref: string | null
  source_knowledge_id: string | null
  evidence: Record<string, unknown> | null
  confidence: number | null
  importance: number
  status: 'active' | 'under_review' | 'validated' | 'retired' | 'expired'
  review_after: string | null
  last_validated_at: string | null
  content_hash: string | null
  created_at: string
  updated_at: string
}

export interface AddMemoryInput {
  category: string
  title: string
  content: string
  sourceType: MemorySourceType
  sourceRef?: string
  sourceKnowledgeId?: string
  /** 0–1. Evidence-backed confidence. REQUIRED for ai_generated memories. */
  confidence?: number
  /** 0–1. Default 0.5. */
  importance?: number
  evidence?: Record<string, unknown>
  reviewAfter?: Date
}

/** Memories below this confidence require human review before becoming 'active'. */
const AUTO_ACTIVE_CONFIDENCE = 0.7

export class CompanyMemoryService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Add a memory. Quality rules (Part 8/9):
   *  - content must be meaningful (>= 30 normalized chars)
   *  - identical content per org is rejected as a duplicate
   *  - ai_generated memories without confidence, or confidence < 0.7,
   *    land as 'under_review' instead of 'active'
   */
  async addMemory(organizationId: string, input: AddMemoryInput): Promise<{
    id: string | null
    duplicate: boolean
    status: MemoryRecord['status'] | null
  }> {
    if (!input.title?.trim() || !input.content?.trim()) {
      throw new Error('Memory title and content are required')
    }
    if (normalizeContent(input.content).length < 30) {
      throw new Error('Memory content too short to be durable business memory (min 30 chars)')
    }
    if (input.sourceType === 'ai_generated' && input.confidence == null) {
      throw new Error('ai_generated memories require explicit confidence')
    }

    const contentHash = hashContent(`${input.title}\n${input.content}`)

    // Duplicate prevention.
    const { data: existing } = await this.supabase
      .from('company_memory')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('content_hash', contentHash)
      .maybeSingle()
    if (existing) return { id: existing.id, duplicate: true, status: null }

    const confidence = input.confidence ?? null
    const needsReview =
      input.sourceType === 'ai_generated' &&
      (confidence == null || confidence < AUTO_ACTIVE_CONFIDENCE)
    const status: MemoryRecord['status'] = needsReview ? 'under_review' : 'active'

    const insert = {
      organization_id: organizationId,
      category: input.category,
      title: input.title.trim(),
      content: input.content.trim(),
      metadata: input.evidence ?? null, // legacy column: keep evidence visible there too
      source_type: input.sourceType,
      source_ref: input.sourceRef ?? null,
      source_knowledge_id: input.sourceKnowledgeId ?? null,
      evidence: input.evidence ?? null,
      confidence,
      importance: input.importance ?? 0.5,
      status,
      review_after: input.reviewAfter?.toISOString() ?? null,
      content_hash: contentHash,
    }

    const { data, error } = await this.supabase
      .from('company_memory')
      .insert(insert)
      .select('id, status')
      .single()

    if (error) {
      if (error.code === '23505') {
        // Concurrent duplicate insert — return idempotent success.
        return { id: null, duplicate: true, status: null }
      }
      throw error
    }

    return { id: data.id, duplicate: false, status: data.status as MemoryRecord['status'] }
  }

  /**
   * Retrieve active memories for an org, highest importance first, with
   * optional category filter and limit. Org scoping is enforced here AND by RLS.
   */
  async getMemories(
    organizationId: string,
    opts?: { category?: string; limit?: number; includeUnderReview?: boolean }
  ): Promise<MemoryRecord[]> {
    let query = this.supabase
      .from('company_memory')
      .select('*')
      .eq('organization_id', organizationId)

    if (opts?.includeUnderReview) {
      query = query.in('status', ['active', 'under_review'])
    } else {
      query = query.eq('status', 'active')
    }

    if (opts?.category) query = query.eq('category', opts.category)

    query = query
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 50)

    const { data, error } = await query
    if (error) throw new Error(`Memory retrieval failed: ${error.message}`)
    return (data || []) as MemoryRecord[]
  }

  /**
   * Validate a memory: confirms it is still true/relevant. Updates confidence
   * and the validation timestamp; validated memories outlive review_after.
   */
  async validateMemory(
    organizationId: string,
    memoryId: string,
    validatedBy: string,
    confidence?: number
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('company_memory')
      .update({
        status: 'validated',
        last_validated_at: new Date().toISOString(),
        ...(confidence != null ? { confidence } : {}),
      })
      .eq('id', memoryId)
      .eq('organization_id', organizationId)
      .select('id')

    if (error) throw error
    void validatedBy
    return (data?.length ?? 0) > 0
  }

  /**
   * Retire a memory that is no longer true or relevant.
   */
  async retireMemory(organizationId: string, memoryId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('company_memory')
      .update({ status: 'retired', updated_at: new Date().toISOString() })
      .eq('id', memoryId)
      .eq('organization_id', organizationId)
      .select('id')

    if (error) throw error
    return (data?.length ?? 0) > 0
  }

  /**
   * Promote a knowledge item into durable memory (learning-loop integration
   * point for Phase 7). Copies quality metadata and links the source.
   */
  async promoteFromKnowledge(
    organizationId: string,
    knowledgeId: string,
    overrides?: Partial<AddMemoryInput>
  ): Promise<{ id: string | null; duplicate: boolean; status: MemoryRecord['status'] | null }> {
    const { data: k, error } = await this.supabase
      .from('organizational_knowledge')
      .select('*')
      .eq('id', knowledgeId)
      .eq('organization_id', organizationId)
      .single()

    if (error || !k) throw new Error('Knowledge item not found in this organization')

    return this.addMemory(organizationId, {
      category: k.category,
      title: k.title,
      content: k.content,
      sourceType: (k.source_type as MemorySourceType) ?? 'system',
      sourceRef: k.source,
      sourceKnowledgeId: k.id,
      confidence: k.confidence ?? undefined,
      importance: k.importance ?? 0.5,
      evidence: { promoted_from: 'organizational_knowledge', knowledge_id: k.id },
      ...overrides,
    })
  }
}
