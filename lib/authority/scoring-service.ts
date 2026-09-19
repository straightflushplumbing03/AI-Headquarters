/**
 * AI Authority Engine -- scoring service.
 *
 * Gathers observations for each market, computes the internal metrics, and
 * stores a point-in-time snapshot. Also computes the opportunity score and
 * writes/refreshes the scored inputs on opportunities.
 *
 * WHY SNAPSHOTS ARE APPEND-ONLY
 *
 * Every sweep writes a NEW score row rather than overwriting the previous one.
 * Trend analysis needs history, and the Command Center compares the current
 * window against the previous one. Overwriting would make trends unknowable.
 * Idempotency comes from bucketing `measured_at` to the hour, so a retried job
 * within the same hour updates its own row instead of duplicating it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeMarketMetrics } from './metrics'
import { AUTHORITY_SCORE_VERSION } from './types'
import type { AuthorityStore } from './store'
import type { MarketMetrics, MarketObservation } from './types'

/** Truncate to the hour so retries within a bucket are idempotent. */
export function scoreBucket(at: Date = new Date()): string {
  const bucket = new Date(at)
  bucket.setUTCMinutes(0, 0, 0)
  return bucket.toISOString()
}

export interface MarketScoringResult {
  marketId: string
  locationName: string
  serviceName: string
  metrics: MarketMetrics
  observation: MarketObservation
}

export class AuthorityScoringService {
  constructor(
    private supabase: SupabaseClient,
    private store: AuthorityStore
  ) {}

  /**
   * Score every active market (or one market) over a window.
   *
   * Returns the computed metrics alongside what was observed, so the caller can
   * build opportunities and recommendations without re-querying.
   */
  async scoreMarkets(params: {
    organizationId: string
    windowDays?: number
    marketId?: string
  }): Promise<MarketScoringResult[]> {
    const organizationId = params.organizationId
    const windowDays = params.windowDays ?? 30
    const measuredAt = scoreBucket()

    const markets = await this.store.listMarkets(organizationId)
    const selected = params.marketId ? markets.filter((m) => m.id === params.marketId) : markets

    if (selected.length === 0) return []

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

    const [evidence, pages, links] = await Promise.all([
      this.store.listEvidence(organizationId, { limit: 5000 }),
      this.loadPages(organizationId),
      this.loadInternalLinks(organizationId),
    ])

    const mentionRows = await this.loadMentionRows(organizationId, since)
    const citationRows = await this.loadCitationRows(organizationId, since)
    const responseRows = await this.loadResponseRows(organizationId, since)

    const results: MarketScoringResult[] = []

    for (const market of selected) {
      const marketResponses = responseRows.filter((r) => r.market_id === market.id)
      const marketMentions = mentionRows.filter((m) => m.market_id === market.id)
      const marketCitations = citationRows.filter((c) => c.market_id === market.id)
      const marketEvidence = evidence.filter((e) => e.market_id === market.id)

      const subjectMentions = marketMentions.filter((m) => m.is_subject)
      const competitorMentions = marketMentions.filter((m) => !m.is_subject)

      // Page linkage runs markets -> page (authority_markets.primary_page_id),
      // because website_pages has no market column and adding one would
      // duplicate the relationship the authority schema already models.
      const linkedPages = market.primary_page_id
        ? pages.filter((p) => p.id === market.primary_page_id)
        : []

      const observation: MarketObservation = {
        windowDays,
        responseCount: marketResponses.length,
        mentionCount: subjectMentions.length,
        firstMentionCount: subjectMentions.filter((m) => m.position === 1).length,
        citationCount: marketCitations.length,
        firstPartyCitationCount: marketCitations.filter((c) => c.is_first_party).length,
        competitorMentionTotal: competitorMentions.length,
        distinctCompetitors: new Set(competitorMentions.map((m) => m.normalized_business_name)).size,
        evidenceCount: marketEvidence.length,
        publishedEvidenceCount: marketEvidence.filter(
          (e) => e.publish_permission === true && e.verification_status === 'verified'
        ).length,
        reviewEvidenceCount: marketEvidence.filter((e) => e.evidence_type === 'customer_review').length,
        projectEvidenceCount: marketEvidence.filter((e) =>
          ['completed_project', 'slab_leak', 'water_line_reroute', 'repipe', 'leak_detection', 'plumbing_repair'].includes(
            String(e.evidence_type)
          )
        ).length,
        linkedPageCount: linkedPages.length,
        pageCountWithSchema: linkedPages.filter((p) => (p.schema_types?.length ?? 0) > 0).length,
        internalLinkInboundCount: links.filter((l) => linkedPages.some((p) => p.url === l.to_url)).length,
      }

      const metrics = computeMarketMetrics(observation)

      const wrote = await this.store.upsertScore({
        organization_id: organizationId,
        market_id: market.id,
        measured_at: measuredAt,
        window_days: windowDays,
        response_count: observation.responseCount,
        internal_mention_rate: metrics.internalMentionRate,
        internal_first_mention_rate: metrics.internalFirstMentionRate,
        internal_citation_rate: metrics.internalCitationRate,
        internal_website_citation_rate: metrics.internalWebsiteCitationRate,
        internal_visibility_score: metrics.internalVisibilityScore,
        evidence_count: observation.evidenceCount,
        published_evidence_count: observation.publishedEvidenceCount,
        content_coverage: metrics.contentCoverage,
        citation_coverage: metrics.citationCoverage,
        review_coverage: metrics.reviewCoverage,
        project_coverage: metrics.projectCoverage,
        internal_authority_score: metrics.internalAuthorityScore,
        competitor_pressure: metrics.competitorPressure,
        internal_opportunity_score: null,
        components: { ...metrics.components, scoreVersion: AUTHORITY_SCORE_VERSION },
      })

      void wrote

      results.push({
        marketId: market.id,
        locationName: market.location_name,
        serviceName: market.service_name,
        metrics,
        observation,
      })
    }

    return results
  }

  /** Previous score snapshot per market, for trend comparison. */
  async loadPreviousScores(
    organizationId: string,
    windowDays: number,
    beforeMeasuredAt: string
  ): Promise<Map<string, MarketMetrics>> {
    const { data, error } = await this.supabase
      .from('authority_scores')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('window_days', windowDays)
      .lt('measured_at', beforeMeasuredAt)
      .order('measured_at', { ascending: false })
      .limit(1000)

    if (error || !data) return new Map()

    const latest = new Map<string, Record<string, unknown>>()
    for (const row of data) {
      const marketId = row.market_id as string
      if (!latest.has(marketId)) latest.set(marketId, row as Record<string, unknown>)
    }

    const out = new Map<string, MarketMetrics>()
    for (const [marketId, row] of latest) {
      out.set(marketId, {
        internalMentionRate: num(row.internal_mention_rate),
        internalFirstMentionRate: num(row.internal_first_mention_rate),
        internalCitationRate: num(row.internal_citation_rate),
        internalWebsiteCitationRate: num(row.internal_website_citation_rate),
        internalVisibilityScore: num(row.internal_visibility_score),
        contentCoverage: num(row.content_coverage),
        citationCoverage: num(row.citation_coverage),
        reviewCoverage: num(row.review_coverage),
        projectCoverage: num(row.project_coverage),
        internalAuthorityScore: num(row.internal_authority_score),
        competitorPressure: num(row.competitor_pressure),
        components: {},
      })
    }
    return out
  }

  private async loadPages(organizationId: string) {
    const { data, error } = await this.supabase
      .from('website_pages')
      .select('id, url, schema_types')
      .eq('organization_id', organizationId)
      .limit(2000)
    if (error) return [] as Array<{ id: string; url: string; schema_types: string[] | null }>
    return (data ?? []) as Array<{ id: string; url: string; schema_types: string[] | null }>
  }

  private async loadInternalLinks(organizationId: string) {
    const { data, error } = await this.supabase
      .from('authority_page_links')
      .select('from_url, to_url')
      .eq('organization_id', organizationId)
      .limit(5000)
    if (error) return [] as Array<{ from_url: string; to_url: string }>
    return (data ?? []) as Array<{ from_url: string; to_url: string }>
  }

  private async loadMentionRows(organizationId: string, since: string) {
    const { data, error } = await this.supabase
      .from('authority_mentions')
      .select('market_id, is_subject, position, normalized_business_name')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .limit(10000)
    if (error) return []
    return (data ?? []) as Array<{
      market_id: string | null
      is_subject: boolean
      position: number
      normalized_business_name: string
    }>
  }

  private async loadCitationRows(organizationId: string, since: string) {
    const { data, error } = await this.supabase
      .from('authority_citations')
      .select('market_id, is_first_party')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .limit(10000)
    if (error) return []
    return (data ?? []) as Array<{ market_id: string | null; is_first_party: boolean }>
  }

  private async loadResponseRows(organizationId: string, since: string) {
    const { data, error } = await this.supabase
      .from('authority_responses')
      .select('market_id')
      .eq('organization_id', organizationId)
      .gte('captured_at', since)
      .limit(10000)
    if (error) return []
    return (data ?? []) as Array<{ market_id: string | null }>
  }
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}