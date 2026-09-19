/**
 * AI Authority Engine -- read/write access layer for authority tables.
 *
 * All database access for this subsystem goes through here. Two rules:
 *
 *  1. Every method that touches an org-scoped table REQUIRES an organizationId
 *     and filters on it. A missing org id is an error, never a default. RLS is
 *     the second line of defence, but the code should never rely on being
 *     rescued by it.
 *
 *  2. This class stores and reads observed data. It does not score, classify,
 *     or interpret -- those are pure functions in their own modules, so they
 *     stay testable without a database.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AuthorityCitation,
  AuthorityEngine,
  AuthorityLocation,
  AuthorityMarket,
  AuthorityMention,
  AuthorityQuery,
  AuthorityQueryRun,
  AuthorityResponse,
  AuthorityService,
  AuthoritySource,
  EngineKey,
  GeneratedQuery,
  QueryRunStatus,
  SourceType,
} from './types'

export interface StoreContext {
  organizationId: string
}

function requireOrg(organizationId: string | null | undefined): string {
  if (!organizationId || typeof organizationId !== 'string' || organizationId.trim().length === 0) {
    throw new Error('AI Authority: organizationId is required for every data access call')
  }
  return organizationId
}

export class AuthorityStore {
  constructor(private supabase: SupabaseClient) {}

  // -------------------------------------------------------------------------
  // Taxonomy reads
  // -------------------------------------------------------------------------

  async listLocations(organizationId: string, opts?: { tier?: string }): Promise<AuthorityLocation[]> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_locations')
      .select('*')
      .eq('organization_id', org)
      .eq('active', true)
      .order('name', { ascending: true })

    if (opts?.tier) query = query.eq('tier', opts.tier)

    const { data, error } = await query
    if (error) throw new Error(`listLocations failed: ${error.message}`)
    return (data ?? []) as AuthorityLocation[]
  }

  async listServices(organizationId: string, opts?: { tier?: string }): Promise<AuthorityService[]> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_services')
      .select('*')
      .eq('organization_id', org)
      .eq('active', true)
      .order('name', { ascending: true })

    if (opts?.tier) query = query.eq('tier', opts.tier)

    const { data, error } = await query
    if (error) throw new Error(`listServices failed: ${error.message}`)
    return (data ?? []) as AuthorityService[]
  }

  async listMarkets(organizationId: string, opts?: { activeOnly?: boolean }): Promise<AuthorityMarket[]> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_markets')
      .select('*')
      .eq('organization_id', org)
      .order('location_name', { ascending: true })

    if (opts?.activeOnly !== false) query = query.eq('active', true)

    const { data, error } = await query
    if (error) throw new Error(`listMarkets failed: ${error.message}`)
    return (data ?? []) as AuthorityMarket[]
  }

  async listEngines(organizationId: string): Promise<AuthorityEngine[]> {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_engines')
      .select('*')
      .eq('organization_id', org)
      .order('key', { ascending: true })

    if (error) throw new Error(`listEngines failed: ${error.message}`)
    return (data ?? []) as AuthorityEngine[]
  }

  async getEngine(organizationId: string, key: EngineKey): Promise<AuthorityEngine | null> {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_engines')
      .select('*')
      .eq('organization_id', org)
      .eq('key', key)
      .maybeSingle()

    if (error) throw new Error(`getEngine failed: ${error.message}`)
    return (data as AuthorityEngine) ?? null
  }

  /**
   * Record the live capability of an engine. Called at the start of each
   * monitoring sweep so the stored state never drifts from reality (for
   * example after a credential is added or revoked).
   */
  async syncEngineCapability(
    organizationId: string,
    key: EngineKey,
    capability: AuthorityEngine['capability'],
    model: string | null
  ): Promise<void> {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_engines')
      .update({ capability, default_model: model, updated_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('key', key)

    if (error) throw new Error(`syncEngineCapability failed: ${error.message}`)
  }

  async markEngineError(organizationId: string, key: EngineKey, message: string | null): Promise<void> {
    const org = requireOrg(organizationId)
    await this.supabase
      .from('authority_engines')
      .update({ last_error: message ? message.slice(0, 500) : null })
      .eq('organization_id', org)
      .eq('key', key)
  }

  // -------------------------------------------------------------------------
  // Query templates
  // -------------------------------------------------------------------------

  async listQueryTemplates(organizationId: string) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_query_templates')
      .select('*')
      .eq('organization_id', org)
      .eq('active', true)

    if (error) throw new Error(`listQueryTemplates failed: ${error.message}`)
    return data ?? []
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * Insert generated queries, ignoring ones already present.
   *
   * Idempotent by (organization_id, normalized_text, intent): re-running the
   * generator does not create duplicates. Returns the full set of matching
   * queries so callers have ids without a second round trip.
   */
  async upsertQueries(organizationId: string, generated: GeneratedQuery[]): Promise<AuthorityQuery[]> {
    const org = requireOrg(organizationId)
    if (generated.length === 0) return []

    const rows = generated.map((g) => ({
      organization_id: org,
      raw_text: g.rawText,
      normalized_text: g.normalizedText,
      market_id: g.marketId,
      location_id: g.locationId,
      service_id: g.serviceId,
      intent: g.intent,
      buyer_stage: g.buyerStage,
      template_id: g.templateId,
      source: 'generated',
      importance: g.importance,
      active: true,
    }))

    const { error } = await this.supabase
      .from('authority_queries')
      .upsert(rows, { onConflict: 'organization_id,normalized_text,intent', ignoreDuplicates: true })

    if (error) throw new Error(`upsertQueries failed: ${error.message}`)

    const normalized = [...new Set(generated.map((g) => g.normalizedText))]
    const intents = [...new Set(generated.map((g) => g.intent))]

    const { data, error: readError } = await this.supabase
      .from('authority_queries')
      .select('*')
      .eq('organization_id', org)
      .in('normalized_text', normalized)
      .in('intent', intents)

    if (readError) throw new Error(`upsertQueries read-back failed: ${readError.message}`)
    return (data ?? []) as AuthorityQuery[]
  }

  async listQueriesForMarket(organizationId: string, marketId: string): Promise<AuthorityQuery[]> {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_queries')
      .select('*')
      .eq('organization_id', org)
      .eq('market_id', marketId)
      .eq('active', true)
      .order('importance', { ascending: false })

    if (error) throw new Error(`listQueriesForMarket failed: ${error.message}`)
    return (data ?? []) as AuthorityQuery[]
  }

  /**
   * Select the queries to monitor next, highest importance first.
   * `excludeRunKeyPrefixes` lets the caller skip queries already run in this
   * window, so a daily sweep does not re-spend on the same question.
   */
  async selectQueriesToRun(
    organizationId: string,
    opts: { limit: number; marketId?: string; engineKey?: string }
  ): Promise<AuthorityQuery[]> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_queries')
      .select('*')
      .eq('organization_id', org)
      .eq('active', true)
      .order('importance', { ascending: false })
      .order('last_run_at', { ascending: true, nullsFirst: true })
      .limit(Math.max(1, opts.limit))

    if (opts.marketId) query = query.eq('market_id', opts.marketId)

    const { data, error } = await query
    if (error) throw new Error(`selectQueriesToRun failed: ${error.message}`)
    return (data ?? []) as AuthorityQuery[]
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  /**
   * Create a run row if it does not already exist.
   *
   * Idempotent by (organization_id, query_id, engine_id, run_key). Returns the
   * existing row with `created: false` when the same logical run was already
   * started -- which is what makes a retried sweep safe.
   */
  async ensureQueryRun(params: {
    organizationId: string
    queryId: string
    engineId: string
    marketId: string | null
    runKey: string
    estimatedCost: number
    budgetReservationId?: string | null
  }): Promise<{ run: AuthorityQueryRun; created: boolean }> {
    const org = requireOrg(params.organizationId)

    const { data: inserted, error: insertError } = await this.supabase
      .from('authority_query_runs')
      .insert({
        organization_id: org,
        query_id: params.queryId,
        engine_id: params.engineId,
        market_id: params.marketId,
        run_key: params.runKey,
        status: 'pending',
        estimated_cost: params.estimatedCost,
        budget_reservation_id: params.budgetReservationId ?? null,
      })
      .select('*')
      .single()

    if (!insertError && inserted) {
      return { run: inserted as AuthorityQueryRun, created: true }
    }

    // 23505 = unique violation: the run already exists (idempotent path).
    if (insertError && insertError.code !== '23505') {
      throw new Error(`ensureQueryRun failed: ${insertError.message}`)
    }

    const { data: existing, error: readError } = await this.supabase
      .from('authority_query_runs')
      .select('*')
      .eq('organization_id', org)
      .eq('query_id', params.queryId)
      .eq('engine_id', params.engineId)
      .eq('run_key', params.runKey)
      .single()

    if (readError || !existing) {
      throw new Error(`ensureQueryRun read-back failed: ${readError?.message ?? 'not found'}`)
    }
    return { run: existing as AuthorityQueryRun, created: false }
  }

  async updateQueryRun(
    organizationId: string,
    runId: string,
    patch: Partial<{
      status: QueryRunStatus
      skip_reason: string | null
      error_message: string | null
      attempts: number
      model: string | null
      latency_ms: number | null
      actual_cost: number
      tokens_input: number | null
      tokens_output: number | null
      started_at: string | null
      completed_at: string | null
    }>
  ): Promise<void> {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_query_runs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('id', runId)

    if (error) throw new Error(`updateQueryRun failed: ${error.message}`)
  }

  /** Increment the query's run bookkeeping after a completed observation. */
  async touchQueryRunStats(organizationId: string, queryId: string, currentCount: number): Promise<void> {
    const org = requireOrg(organizationId)
    await this.supabase
      .from('authority_queries')
      .update({ last_run_at: new Date().toISOString(), run_count: currentCount + 1 })
      .eq('organization_id', org)
      .eq('id', queryId)
  }

  async listRecentRuns(
    organizationId: string,
    opts?: { limit?: number; status?: QueryRunStatus }
  ): Promise<AuthorityQueryRun[]> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_query_runs')
      .select('*')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100)

    if (opts?.status) query = query.eq('status', opts.status)

    const { data, error } = await query
    if (error) throw new Error(`listRecentRuns failed: ${error.message}`)
    return (data ?? []) as AuthorityQueryRun[]
  }

  // -------------------------------------------------------------------------
  // Responses
  // -------------------------------------------------------------------------

  /**
   * Stage the raw answer immediately after collection.
   *
   * The raw text is persisted BEFORE parsing, deliberately. If parsing later
   * fails or the parser is improved, the original answer is still on disk and
   * can be re-parsed. Losing an answer we already paid for would be
   * unacceptable.
   *
   * Idempotent per run (unique run_id): a retried execution returns null.
   */
  async insertRawResponse(params: {
    organizationId: string
    runId: string
    queryId: string
    engineId: string
    marketId: string | null
    engineKey: string
    model: string | null
    rawText: string
  }): Promise<AuthorityResponse | null> {
    const org = requireOrg(params.organizationId)

    const { data, error } = await this.supabase
      .from('authority_responses')
      .insert({
        organization_id: org,
        run_id: params.runId,
        query_id: params.queryId,
        engine_id: params.engineId,
        market_id: params.marketId,
        engine_key: params.engineKey,
        model: params.model,
        raw_response_text: params.rawText,
        parser_version: 'pending',
      })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') return null
      throw new Error(`insertRawResponse failed: ${error.message}`)
    }
    return data as AuthorityResponse
  }

  /**
   * Responses whose stored parse is missing or stale (older parser version).
   * Drives the parsing job; `reparse` widens it to every stored response.
   */
  async listResponsesAwaitingParse(
    organizationId: string,
    limit: number,
    opts?: { currentParserVersion?: string; reparse?: boolean }
  ): Promise<AuthorityResponse[]> {
    const org = requireOrg(organizationId)

    let query = this.supabase
      .from('authority_responses')
      .select('*')
      .eq('organization_id', org)
      .order('captured_at', { ascending: true })
      .limit(Math.max(1, limit))

    if (opts?.reparse && opts.currentParserVersion) {
      // Re-parse anything not produced by the current parser build.
      query = query.neq('parser_version', opts.currentParserVersion)
    } else {
      query = query.eq('parser_version', 'pending')
    }

    const { data, error } = await query
    if (error) throw new Error(`listResponsesAwaitingParse failed: ${error.message}`)
    return (data ?? []) as AuthorityResponse[]
  }

  /**
   * Write the parse result onto an existing response.
   *
   * Destructive to prior mentions/citations for this response is intentional:
   * a re-parse replaces its own derived rows so the stored structure always
   * matches the recorded parser version. The raw text is never modified.
   */
  async applyParse(params: {
    organizationId: string
    responseId: string
    locationContext: string | null
    serviceContext: string | null
    businessCount: number
    subjectMentioned: boolean
    subjectPosition: number | null
    subjectCited: boolean
    subjectRecommended: boolean
    recommendationLanguage: string[]
    factualClaims: unknown
    parserVersion: string
    parseConfidence: number
    parseNotes: string[]
  }): Promise<void> {
    const org = requireOrg(params.organizationId)

    const { error } = await this.supabase
      .from('authority_responses')
      .update({
        location_context: params.locationContext,
        service_context: params.serviceContext,
        business_count: params.businessCount,
        straight_flush_mentioned: params.subjectMentioned,
        straight_flush_position: params.subjectPosition,
        straight_flush_cited: params.subjectCited,
        recommendation_language: params.recommendationLanguage,
        factual_claims: params.factualClaims,
        parser_version: params.parserVersion,
        parse_confidence: params.parseConfidence,
        parse_notes: params.parseNotes.join(' | ').slice(0, 2000) || null,
        internal_recommended: params.subjectRecommended,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', org)
      .eq('id', params.responseId)

    if (error) throw new Error(`applyParse failed: ${error.message}`)
  }

  /** Remove derived rows before a re-parse so the result is not doubled. */
  async clearDerivedRows(organizationId: string, responseId: string): Promise<void> {
    const org = requireOrg(organizationId)
    await this.supabase
      .from('authority_mentions')
      .delete()
      .eq('organization_id', org)
      .eq('response_id', responseId)
    await this.supabase
      .from('authority_citations')
      .delete()
      .eq('organization_id', org)
      .eq('response_id', responseId)
  }

  /** Market-scoped counts used to score a market over a window. */
  async countResponsesForMarket(
    organizationId: string,
    marketId: string,
    since: string
  ): Promise<number> {
    const org = requireOrg(organizationId)
    const { count, error } = await this.supabase
      .from('authority_responses')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org)
      .eq('market_id', marketId)
      .gte('captured_at', since)

    if (error) throw new Error(`countResponsesForMarket failed: ${error.message}`)
    return count ?? 0
  }

  async listResponsesForMarket(
    organizationId: string,
    marketId: string,
    since: string,
    limit = 1000
  ): Promise<AuthorityResponse[]> {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_responses')
      .select('*')
      .eq('organization_id', org)
      .eq('market_id', marketId)
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`listResponsesForMarket failed: ${error.message}`)
    return (data ?? []) as AuthorityResponse[]
  }

  async upsertMentionCompetitorLink(
    organizationId: string,
    mentionId: string,
    competitorId: string
  ): Promise<void> {
    const org = requireOrg(organizationId)
    await this.supabase
      .from('authority_mentions')
      .update({ competitor_id: competitorId })
      .eq('organization_id', org)
      .eq('id', mentionId)
  }

  async insertMentions(
    organizationId: string,
    mentions: Array<{
      response_id: string
      run_id: string
      engine_id: string
      market_id: string | null
      position: number
      business_name: string
      normalized_business_name: string
      is_subject: boolean
      website: string | null
      services_associated: string[]
      locations_associated: string[]
      is_recommended: boolean
      recommendation_context: string | null
    }>
  ): Promise<void> {
    const org = requireOrg(organizationId)
    if (mentions.length === 0) return

    const { error } = await this.supabase
      .from('authority_mentions')
      .insert(mentions.map((m) => ({ organization_id: org, ...m })))

    if (error) throw new Error(`insertMentions failed: ${error.message}`)
  }

  async listMentionsForResponse(responseId: string): Promise<AuthorityMention[]> {
    const { data, error } = await this.supabase
      .from('authority_mentions')
      .select('*')
      .eq('response_id', responseId)
      .order('position', { ascending: true })

    if (error) throw new Error(`listMentionsForResponse failed: ${error.message}`)
    return (data ?? []) as AuthorityMention[]
  }

  async listResponses(
    organizationId: string,
    opts?: { limit?: number; marketId?: string; engineId?: string }
  ): Promise<AuthorityResponse[]> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_responses')
      .select('*')
      .eq('organization_id', org)
      .order('captured_at', { ascending: false })
      .limit(opts?.limit ?? 50)

    if (opts?.marketId) query = query.eq('market_id', opts.marketId)
    if (opts?.engineId) query = query.eq('engine_id', opts.engineId)

    const { data, error } = await query
    if (error) throw new Error(`listResponses failed: ${error.message}`)
    return (data ?? []) as AuthorityResponse[]
  }

  async getResponse(organizationId: string, responseId: string): Promise<AuthorityResponse | null> {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_responses')
      .select('*')
      .eq('organization_id', org)
      .eq('id', responseId)
      .maybeSingle()

    if (error) throw new Error(`getResponse failed: ${error.message}`)
    return (data as AuthorityResponse) ?? null
  }

  /**
   * Runs that completed but have no stored response yet. Drives the parsing
   * job, which is decoupled from execution so a parse failure never loses the
   * collected answer.
   */
  async listRunsAwaitingParse(organizationId: string, limit: number): Promise<AuthorityQueryRun[]> {
    const org = requireOrg(organizationId)
    const { data: runs, error } = await this.supabase
      .from('authority_query_runs')
      .select('*')
      .eq('organization_id', org)
      .eq('status', 'completed')
      .order('completed_at', { ascending: true })
      .limit(Math.max(1, Math.min(limit * 3, 300)))

    if (error) throw new Error(`listRunsAwaitingParse failed: ${error.message}`)
    if (!runs || runs.length === 0) return []

    const runIds = runs.map((r) => r.id)
    const { data: existing } = await this.supabase
      .from('authority_responses')
      .select('run_id')
      .eq('organization_id', org)
      .in('run_id', runIds)

    const parsed = new Set((existing ?? []).map((r) => r.run_id))
    return (runs as AuthorityQueryRun[]).filter((r) => !parsed.has(r.id)).slice(0, limit)
  }

  // -------------------------------------------------------------------------
  // Sources and citations
  // -------------------------------------------------------------------------

  /**
   * Upsert a source domain and return its id.
   * `last_seen_at` is refreshed so freshness signals stay meaningful.
   */
  async upsertSource(
    organizationId: string,
    domain: string,
    sourceType: SourceType,
    isFirstParty: boolean
  ): Promise<string | null> {
    const org = requireOrg(organizationId)
    if (!domain) return null

    const now = new Date().toISOString()
    const { data, error } = await this.supabase
      .from('authority_sources')
      .upsert(
        {
          organization_id: org,
          domain,
          source_type: sourceType,
          is_first_party: isFirstParty,
          last_seen_at: now,
        },
        { onConflict: 'organization_id,domain', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (error) {
      // Never fail a monitoring run because a source row could not be written.
      console.error(`[authority] upsertSource failed for ${domain}: ${error.message}`)
      return null
    }
    return data?.id ?? null
  }

  async insertCitations(
    organizationId: string,
    citations: Array<{
      response_id: string
      run_id: string
      engine_id: string
      market_id: string | null
      source_id: string | null
      url: string
      domain: string
      source_type: SourceType
      cited_business_name: string | null
      is_first_party: boolean
      citation_position: number | null
    }>
  ): Promise<void> {
    const org = requireOrg(organizationId)
    if (citations.length === 0) return

    const { error } = await this.supabase
      .from('authority_citations')
      .insert(citations.map((c) => ({ organization_id: org, ...c })))

    if (error && error.code !== '23505') {
      throw new Error(`insertCitations failed: ${error.message}`)
    }
  }

  async listCitations(organizationId: string, opts?: { limit?: number; marketId?: string }) {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_citations')
      .select('*')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 200)

    if (opts?.marketId) query = query.eq('market_id', opts.marketId)

    const { data, error } = await query
    if (error) throw new Error(`listCitations failed: ${error.message}`)
    return (data ?? []) as AuthorityCitation[]
  }

  async listSources(organizationId: string): Promise<AuthoritySource[]> {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_sources')
      .select('*')
      .eq('organization_id', org)
      .order('last_seen_at', { ascending: false })

    if (error) throw new Error(`listSources failed: ${error.message}`)
    return (data ?? []) as AuthoritySource[]
  }

  /**
   * Upsert a citation-gap row.
   *
   * Keyed on (organization_id, market_id, source_id, gap_type, window_days) --
   * note the schema's unique constraint uses `measured_at`, so repeated runs in
   * the same window would otherwise accumulate. We therefore match on the
   * window's date granularity by checking for an existing row for the market
   * and gap type within the same day and updating it in place.
   */
  async upsertCitationGap(row: Record<string, unknown>): Promise<number> {
    const org = requireOrg(row.organization_id as string)
    const measuredAt = String(row.measured_at ?? new Date().toISOString())
    const dayStart = `${measuredAt.slice(0, 10)}T00:00:00.000Z`
    const dayEnd = `${measuredAt.slice(0, 10)}T23:59:59.999Z`

    let existingQuery = this.supabase
      .from('authority_citation_gaps')
      .select('id')
      .eq('organization_id', org)
      .eq('gap_type', row.gap_type as string)
      .eq('window_days', row.window_days as number)
      .gte('measured_at', dayStart)
      .lte('measured_at', dayEnd)

    existingQuery = row.market_id
      ? existingQuery.eq('market_id', row.market_id as string)
      : existingQuery.is('market_id', null)
    existingQuery = row.source_id
      ? existingQuery.eq('source_id', row.source_id as string)
      : existingQuery.is('source_id', null)

    const { data: existing } = await existingQuery.maybeSingle()

    if (existing?.id) {
      const { error } = await this.supabase
        .from('authority_citation_gaps')
        .update(row)
        .eq('organization_id', org)
        .eq('id', existing.id)
      if (error) {
        console.error(`[authority] citation gap update failed: ${error.message}`)
        return 0
      }
      return 1
    }

    const { error } = await this.supabase.from('authority_citation_gaps').insert(row)
    if (error && error.code !== '23505') {
      console.error(`[authority] citation gap insert failed: ${error.message}`)
      return 0
    }
    return 1
  }

  // -------------------------------------------------------------------------
  // Competitors
  // -------------------------------------------------------------------------

  /**
   * Upsert a competitor, returning its id.
   *
   * Only `last_seen_at` and the observed location/service footprint are
   * refreshed on an existing row. A website or phone a human corrected is never
   * overwritten by a machine observation.
   */
  async upsertCompetitor(row: {
    organization_id: string
    name: string
    normalized_name: string
    website: string | null
    discovery_source: string
    locations: string[]
    services: string[]
  }): Promise<string | null> {
    const org = requireOrg(row.organization_id)

    const { data: existing } = await this.supabase
      .from('authority_competitors')
      .select('id, website, locations, services')
      .eq('organization_id', org)
      .eq('normalized_name', row.normalized_name)
      .maybeSingle()

    if (existing?.id) {
      const mergedLocations = [...new Set([...(existing.locations ?? []), ...row.locations])]
      const mergedServices = [...new Set([...(existing.services ?? []), ...row.services])]

      const { error } = await this.supabase
        .from('authority_competitors')
        .update({
          last_seen_at: new Date().toISOString(),
          locations: mergedLocations,
          services: mergedServices,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', org)
        .eq('id', existing.id)

      if (error) {
        console.error(`[authority] competitor update failed: ${error.message}`)
        return null
      }
      return existing.id
    }

    const { data, error } = await this.supabase
      .from('authority_competitors')
      .insert({
        organization_id: org,
        name: row.name,
        normalized_name: row.normalized_name,
        website: row.website,
        discovery_source: row.discovery_source,
        locations: row.locations,
        services: row.services,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        const { data: raced } = await this.supabase
          .from('authority_competitors')
          .select('id')
          .eq('organization_id', org)
          .eq('normalized_name', row.normalized_name)
          .maybeSingle()
        return raced?.id ?? null
      }
      console.error(`[authority] competitor insert failed: ${error.message}`)
      return null
    }
    return data?.id ?? null
  }

  async listCompetitors(organizationId: string) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_competitors')
      .select('*')
      .eq('organization_id', org)
      .order('last_seen_at', { ascending: false })

    if (error) throw new Error(`listCompetitors failed: ${error.message}`)
    return data ?? []
  }

  /** Upsert a snapshot for (competitor, date, window). Idempotent. */
  async upsertCompetitorSnapshot(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_competitor_snapshots')
      .upsert(row, {
        onConflict: 'organization_id,competitor_id,snapshot_date,window_days',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error(`[authority] competitor snapshot failed: ${error.message}`)
      return false
    }
    return true
  }

  async listCompetitorSnapshots(
    organizationId: string,
    opts?: { competitorId?: string; limit?: number }
  ) {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_competitor_snapshots')
      .select('*')
      .eq('organization_id', org)
      .order('snapshot_date', { ascending: false })
      .limit(opts?.limit ?? 200)

    if (opts?.competitorId) query = query.eq('competitor_id', opts.competitorId)

    const { data, error } = await query
    if (error) throw new Error(`listCompetitorSnapshots failed: ${error.message}`)
    return data ?? []
  }

  async insertCompetitorChange(row: Record<string, unknown>): Promise<number> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase.from('authority_competitor_changes').insert(row)
    if (error) {
      if (error.code === '23505') return 0
      console.error(`[authority] competitor change insert failed: ${error.message}`)
      return 0
    }
    return 1
  }

  async listCompetitorChanges(organizationId: string, limit = 100) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_competitor_changes')
      .select('*')
      .eq('organization_id', org)
      .order('detected_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`listCompetitorChanges failed: ${error.message}`)
    return data ?? []
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  /**
   * Insert an alert, deduplicated by `dedupe_key`.
   *
   * Returns false when an alert with the same dedupe key already exists, so a
   * recurring condition does not notify on every sweep.
   */
  async insertAlert(row: {
    organization_id: string
    alert_type: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    title: string
    detail?: string | null
    market_id?: string | null
    competitor_id?: string | null
    metrics?: Record<string, unknown>
    dedupe_key: string
  }): Promise<boolean> {
    const org = requireOrg(row.organization_id)

    const { error } = await this.supabase
      .from('authority_alerts')
      .insert({
        organization_id: org,
        alert_type: row.alert_type,
        severity: row.severity,
        title: row.title.slice(0, 500),
        detail: row.detail ? row.detail.slice(0, 2000) : null,
        market_id: row.market_id ?? null,
        competitor_id: row.competitor_id ?? null,
        metrics: row.metrics ?? {},
        dedupe_key: row.dedupe_key,
      })

    if (error) {
      if (error.code === '23505') return false
      console.error(`[authority] alert insert failed: ${error.message}`)
      return false
    }
    return true
  }

  async listAlerts(organizationId: string, opts?: { status?: string; limit?: number }) {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_alerts')
      .select('*')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 100)

    if (opts?.status) query = query.eq('status', opts.status)

    const { data, error } = await query
    if (error) throw new Error(`listAlerts failed: ${error.message}`)
    return data ?? []
  }

  async acknowledgeAlert(organizationId: string, alertId: string, status: string): Promise<void> {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_alerts')
      .update({ status, acknowledged_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('id', alertId)
    if (error) throw new Error(`acknowledgeAlert failed: ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Evidence and entity graph
  // -------------------------------------------------------------------------

  /**
   * Insert an evidence row. Idempotent on (organization_id, source,
   * source_record_id), so re-importing a source system cannot duplicate.
   * Returns false when the row already existed or failed.
   */
  async insertEvidence(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase.from('authority_evidence').insert(row)
    if (error) {
      if (error.code === '23505') return false
      console.error(`[authority] evidence insert failed: ${error.message}`)
      return false
    }
    return true
  }

  async listEvidence(
    organizationId: string,
    opts?: { marketId?: string; limit?: number }
  ): Promise<Array<Record<string, unknown>>> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_evidence')
      .select('*')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 500)

    if (opts?.marketId) query = query.eq('market_id', opts.marketId)

    const { data, error } = await query
    if (error) throw new Error(`listEvidence failed: ${error.message}`)
    return data ?? []
  }

  async linkEvidence(row: {
    organization_id: string
    evidence_id: string
    entity_type: string
    entity_id: string
    relation: string
  }): Promise<boolean> {
    requireOrg(row.organization_id)
    const { error } = await this.supabase.from('authority_evidence_links').insert(row)
    if (error) {
      if (error.code === '23505') return false
      console.error(`[authority] evidence link failed: ${error.message}`)
      return false
    }
    return true
  }

  /** Count evidence links pointing at a specific entity. */
  async countEvidenceLinks(
    organizationId: string,
    entityType: string,
    entityId: string
  ): Promise<number> {
    const org = requireOrg(organizationId)
    const { count, error } = await this.supabase
      .from('authority_evidence_links')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)

    if (error) return 0
    return count ?? 0
  }

  // -------------------------------------------------------------------------
  // Scores
  // -------------------------------------------------------------------------

  /**
   * Persist a score snapshot for a market.
   *
   * Idempotent on (organization_id, market_id, measured_at, window_days). The
   * caller passes a pre-truncated `measured_at` so a re-run within the same
   * bucket updates rather than accumulating duplicates.
   */
  async upsertScore(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_scores')
      .upsert(row, {
        onConflict: 'organization_id,market_id,measured_at,window_days',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error(`[authority] score upsert failed: ${error.message}`)
      return false
    }
    return true
  }

  async listLatestScores(organizationId: string, limit = 200) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_scores')
      .select('*')
      .eq('organization_id', org)
      .order('measured_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`listLatestScores failed: ${error.message}`)
    return data ?? []
  }

  async listScoresForMarket(organizationId: string, marketId: string, limit = 12) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_scores')
      .select('*')
      .eq('organization_id', org)
      .eq('market_id', marketId)
      .order('measured_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`listScoresForMarket failed: ${error.message}`)
    return data ?? []
  }

  // -------------------------------------------------------------------------
  // Website crawl graph
  // -------------------------------------------------------------------------

  /**
   * Upsert a crawled page into the PRE-EXISTING `website_pages` table.
   *
   * Reuses phase 4's table rather than creating a competing one. Crawl-specific
   * columns were added additively in migration 021; the phase-4 columns this
   * does not own (rank_position, search_impressions, ...) are left untouched so
   * existing SEO logic keeps working.
   */
  async upsertCrawledPage(row: Record<string, unknown>): Promise<boolean> {
    const org = requireOrg(row.organization_id as string)

    const { data: existing } = await this.supabase
      .from('website_pages')
      .select('id')
      .eq('organization_id', org)
      .eq('url', row.url as string)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await this.supabase
        .from('website_pages')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('organization_id', org)
        .eq('id', existing.id)
      if (error) {
        console.error(`[authority] page update failed for ${row.url}: ${error.message}`)
        return false
      }
      return true
    }

    const { error } = await this.supabase.from('website_pages').insert(row)
    if (error) {
      console.error(`[authority] page insert failed for ${row.url}: ${error.message}`)
      return false
    }
    return true
  }

  /** Upsert an internal-link edge. Idempotent on the schema's unique key. */
  async upsertPageLink(row: Record<string, unknown>): Promise<boolean> {
    const org = requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_page_links')
      .upsert(row, {
        onConflict: 'organization_id,from_url,to_url,anchor_text',
        ignoreDuplicates: true,
      })
    if (error) {
      console.error(`[authority] page link upsert failed: ${error.message}`)
      return false
    }
    void org
    return true
  }

  async listPageLinks(organizationId: string, limit = 5000) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_page_links')
      .select('*')
      .eq('organization_id', org)
      .limit(limit)
    if (error) throw new Error(`listPageLinks failed: ${error.message}`)
    return data ?? []
  }

  async listPages(organizationId: string, limit = 2000) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('website_pages')
      .select('*')
      .eq('organization_id', org)
      .limit(limit)
    if (error) throw new Error(`listPages failed: ${error.message}`)
    return data ?? []
  }

  async createCrawlRun(row: Record<string, unknown>): Promise<string | null> {
    const org = requireOrg(row.organization_id as string)
    const { data, error } = await this.supabase
      .from('authority_crawl_runs')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      console.error(`[authority] crawl run insert failed: ${error.message}`)
      return null
    }
    void org
    return data?.id ?? null
  }

  /** Upsert a technical issue. Idempotent on (org, url, issue_type). */
  async upsertTechnicalIssue(row: Record<string, unknown>): Promise<boolean> {
    const org = requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_technical_issues')
      .upsert(row, {
        onConflict: 'organization_id,url,issue_type',
        ignoreDuplicates: false,
      })
    if (error) {
      console.error(`[authority] technical issue upsert failed: ${error.message}`)
      return false
    }
    void org
    return true
  }

  async listTechnicalIssues(organizationId: string, opts?: { status?: string; limit?: number }) {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_technical_issues')
      .select('*')
      .eq('organization_id', org)
      .order('detected_at', { ascending: false })
      .limit(opts?.limit ?? 500)

    if (opts?.status) query = query.eq('status', opts.status)

    const { data, error } = await query
    if (error) throw new Error(`listTechnicalIssues failed: ${error.message}`)
    return data ?? []
  }

  // -------------------------------------------------------------------------
  // Integrations
  // -------------------------------------------------------------------------

  async listIntegrations(organizationId: string) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_integrations')
      .select('*')
      .eq('organization_id', org)
    if (error) throw new Error(`listIntegrations failed: ${error.message}`)
    return data ?? []
  }

  async getIntegration(organizationId: string, provider: string) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_integrations')
      .select('*')
      .eq('organization_id', org)
      .eq('provider', provider)
      .maybeSingle()
    if (error) throw new Error(`getIntegration failed: ${error.message}`)
    return data ?? null
  }

  async updateIntegration(organizationId: string, provider: string, patch: Record<string, unknown>) {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_integrations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('provider', provider)
    if (error) throw new Error(`updateIntegration failed: ${error.message}`)
  }

  /** Upsert search-console metrics. Idempotent on the full natural key. */
  async upsertSearchMetric(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_search_metrics')
      .upsert(row, {
        onConflict: 'organization_id,provider,metric_date,query_text,page_url,country,device',
        ignoreDuplicates: false,
      })
    if (error) {
      console.error(`[authority] search metric upsert failed: ${error.message}`)
      return false
    }
    return true
  }

  async upsertGbpMetric(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_gbp_metrics')
      .upsert(row, {
        onConflict: 'organization_id,metric_date,location_ref',
        ignoreDuplicates: false,
      })
    if (error) {
      console.error(`[authority] GBP metric upsert failed: ${error.message}`)
      return false
    }
    return true
  }

  // -------------------------------------------------------------------------
  // Opportunities, recommendations, experiments
  // -------------------------------------------------------------------------

  /**
   * Upsert a scored opportunity.
   *
   * Idempotent on (organization_id, market_id, category, title), so a weekly
   * regeneration refreshes scores and explanations in place rather than
   * creating a duplicate opportunity for the same finding.
   */
  async upsertOpportunity(row: Record<string, unknown>): Promise<string | null> {
    const org = requireOrg(row.organization_id as string)
    const { data, error } = await this.supabase
      .from('authority_opportunities')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,market_id,category,title', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (error) {
      console.error(`[authority] opportunity upsert failed: ${error.message}`)
      return null
    }
    void org
    return data?.id ?? null
  }

  async listOpportunities(
    organizationId: string,
    opts?: { status?: string; limit?: number }
  ): Promise<Array<Record<string, unknown>>> {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_opportunities')
      .select('*')
      .eq('organization_id', org)
      .order('opportunity_score', { ascending: false })
      .limit(opts?.limit ?? 200)

    if (opts?.status) query = query.eq('status', opts.status)

    const { data, error } = await query
    if (error) throw new Error(`listOpportunities failed: ${error.message}`)
    return data ?? []
  }

  async updateOpportunity(organizationId: string, opportunityId: string, patch: Record<string, unknown>) {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_opportunities')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('id', opportunityId)
    if (error) throw new Error(`updateOpportunity failed: ${error.message}`)
  }

  /** Assign priority ranks by descending score. Deterministic and explainable. */
  async rankOpportunities(organizationId: string): Promise<number> {
    const opportunities = await this.listOpportunities(organizationId, {
      status: 'new',
      limit: 500,
    })
    let ranked = 0
    for (let i = 0; i < opportunities.length; i++) {
      const id = opportunities[i].id as string
      await this.updateOpportunity(organizationId, id, { priority_rank: i + 1, status: 'prioritized' })
      ranked += 1
    }
    return ranked
  }

  /** Create the phase-5 recommendation that the authority actions hang off. */
  async insertRecommendation(row: Record<string, unknown>): Promise<string | null> {
    const org = requireOrg(row.organization_id as string)
    const { data, error } = await this.supabase
      .from('recommendations')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      console.error(`[authority] recommendation insert failed: ${error.message}`)
      return null
    }
    void org
    return data?.id ?? null
  }

  async upsertRecommendationAction(row: Record<string, unknown>): Promise<string | null> {
    requireOrg(row.organization_id as string)
    const { data, error } = await this.supabase
      .from('authority_recommendation_actions')
      .upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,opportunity_id,step_order', ignoreDuplicates: false }
      )
      .select('id')
      .single()
    if (error) {
      console.error(`[authority] recommendation action upsert failed: ${error.message}`)
      return null
    }
    return data?.id ?? null
  }

  async listRecommendationActions(organizationId: string, opts?: { status?: string; limit?: number }) {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_recommendation_actions')
      .select('*')
      .eq('organization_id', org)
      .order('step_order', { ascending: true })
      .limit(opts?.limit ?? 200)

    if (opts?.status) query = query.eq('status', opts.status)

    const { data, error } = await query
    if (error) throw new Error(`listRecommendationActions failed: ${error.message}`)
    return data ?? []
  }

  async updateRecommendationAction(
    organizationId: string,
    actionId: string,
    patch: Record<string, unknown>
  ) {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_recommendation_actions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('id', actionId)
    if (error) throw new Error(`updateRecommendationAction failed: ${error.message}`)
  }

  async createExperiment(row: Record<string, unknown>) {
    const org = requireOrg(row.organization_id as string)
    const { data, error } = await this.supabase
      .from('authority_experiments')
      .insert(row)
      .select('*')
      .single()
    if (error) {
      console.error(`[authority] experiment insert failed: ${error.message}`)
      return null
    }
    void org
    return data
  }

  async listExperiments(organizationId: string, status?: string) {
    const org = requireOrg(organizationId)
    let query = this.supabase
      .from('authority_experiments')
      .select('*')
      .eq('organization_id', org)
      .order('created_at', { ascending: false })
      .limit(200)
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    if (error) throw new Error(`listExperiments failed: ${error.message}`)
    return data ?? []
  }

  async updateExperiment(organizationId: string, experimentId: string, patch: Record<string, unknown>) {
    const org = requireOrg(organizationId)
    const { error } = await this.supabase
      .from('authority_experiments')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('organization_id', org)
      .eq('id', experimentId)
    if (error) throw new Error(`updateExperiment failed: ${error.message}`)
  }

  async insertExperimentResult(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase.from('authority_experiment_results').insert(row)
    if (error) {
      if (error.code === '23505') return false
      console.error(`[authority] experiment result insert failed: ${error.message}`)
      return false
    }
    return true
  }

  async listExperimentResults(organizationId: string, experimentId: string) {
    const org = requireOrg(organizationId)
    const { data, error } = await this.supabase
      .from('authority_experiment_results')
      .select('*')
      .eq('organization_id', org)
      .eq('experiment_id', experimentId)
      .order('measured_at', { ascending: true })
    if (error) throw new Error(`listExperimentResults failed: ${error.message}`)
    return (data ?? []) as Array<{
      phase: 'before' | 'during' | 'after'
      metrics: Record<string, unknown>
      measured_at: string
    }>
  }

  async upsertActionResult(row: Record<string, unknown>): Promise<boolean> {
    requireOrg(row.organization_id as string)
    const { error } = await this.supabase
      .from('authority_action_results')
      .upsert(row, {
        onConflict: 'organization_id,recommendation_action_id,measurement_window_days',
        ignoreDuplicates: false,
      })
    if (error) {
      console.error(`[authority] action result upsert failed: ${error.message}`)
      return false
    }
    return true
  }

  // -------------------------------------------------------------------------
  // Audit (reuses the existing table and helper conventions)
  // -------------------------------------------------------------------------

  async logAudit(params: {
    organizationId: string
    userId: string | null
    action: string
    resource: string
    details: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const org = requireOrg(params.organizationId)
    try {
      await this.supabase.from('audit_logs').insert({
        organization_id: org,
        user_id: params.userId,
        action: params.action,
        resource: params.resource,
        details: params.details.slice(0, 2000),
        metadata: params.metadata ?? null,
        timestamp: new Date().toISOString(),
      })
    } catch (error) {
      // Audit failures must be visible but must not abort the work itself.
      console.error('[authority] audit log failed:', error instanceof Error ? error.message : error)
    }
  }
}