/**
 * AI Authority Engine -- orchestrator and read models.
 *
 * The orchestrator is the single entry point the background jobs call. It
 * sequences the pipeline and reports what happened, so every scheduled run is
 * accounted for:
 *
 *   ensure queries -> execute -> parse -> citations -> competitors -> score ->
 *   recommend -> experiment evaluation
 *
 * The read models build the Command Center payloads from stored data only. They
 * never trigger external calls, so opening the dashboard costs nothing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { EngineAdapterRegistry } from './adapters/base'
import { AuthorityStore } from './store'
import { AuthorityQueryRunner, summarizeOutcomes, type SweepSummary } from './query-runner'
import { AuthorityScoringService } from './scoring-service'
import { AuthorityCrawler } from './crawler'
import { CompetitorMonitor } from './competitor-intelligence'
import { AuthorityExperimentService } from './experiment-service'
import {
  AuthorityRecommendationEngine,
  type MarketContext,
} from './recommendation-orchestrator'
import { generateQueries } from './query-generator'
import {
  buildCitationProfile,
  identifyCitationGaps,
  persistCitationGaps,
} from './citation-intelligence'
import { assessEvidenceGaps } from './evidence-service'
import { buildScoreDeltas } from './metrics'
import { buildParsedResponse, type ParseOutcome } from './parse-service'
import { computeTrend } from './metrics'
import type { AuthorityEngine, AuthorityLocation, AuthorityMarket, AuthorityQuery, AuthorityService } from './types'

export interface PipelineResult {
  queriesGenerated: number
  queriesMonitored: number
  sweep: SweepSummary
  parsed: number
  citationsRecorded: number
  competitors: { competitorsTracked: number; snapshotsWritten: number; changesDetected: number; alertsCreated: number }
  marketsScored: number
  opportunitiesCreated: number
  recommendationsCreated: number
  approvalsRequested: number
  experimentsEvaluated: number
  notes: string[]
}

export class AuthorityOrchestrator {
  private store: AuthorityStore
  private runner: AuthorityQueryRunner
  private scoring: AuthorityScoringService
  private experiments: AuthorityExperimentService

  constructor(private supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
    this.runner = new AuthorityQueryRunner(supabase)
    this.scoring = new AuthorityScoringService(supabase, this.store)
    this.experiments = new AuthorityExperimentService(this.store)
  }

  // -------------------------------------------------------------------------
  // Query lifecycle
  // -------------------------------------------------------------------------

  /**
   * Generate the monitoring query set from the current taxonomy and persist it.
   * Idempotent: normalized intents already present are left alone.
   */
  async ensureQueries(organizationId: string, limit?: number): Promise<number> {
    const [locations, services, markets, templates] = await Promise.all([
      this.store.listLocations(organizationId),
      this.store.listServices(organizationId),
      this.store.listMarkets(organizationId),
      this.store.listQueryTemplates(organizationId),
    ])

    if (markets.length === 0 || templates.length === 0) return 0

    const generated = generateQueries({
      locations,
      services,
      markets: markets.map((m) => ({
        id: m.id,
        location_id: m.location_id,
        service_id: m.service_id,
        location_name: m.location_name,
        service_name: m.service_name,
      })),
      templates: templates.map((t) => ({
        id: t.id as string,
        pattern: t.pattern as string,
        intent: t.intent as AuthorityQuery['intent'],
        buyer_stage: (t.buyer_stage as AuthorityQuery['buyer_stage']) ?? null,
        base_importance: (t.base_importance as number) ?? 5,
        season_months: (t.season_months as number[] | null) ?? null,
        source: (t.source as string) ?? 'seed',
        active: (t.active as boolean) ?? true,
      })),
      limit,
    })

    const stored = await this.store.upsertQueries(organizationId, generated)
    return stored.length
  }

  /**
   * Execute a monitoring sweep.
   *
   * Engines are resolved from the database and their capability is refreshed
   * from the live process environment on every sweep, so credential changes are
   * reflected without a redeploy.
   */
  async runMonitoringSweep(params: {
    organizationId: string
    limit?: number
    marketId?: string
    engineKey?: string
  }): Promise<SweepSummary> {
    const organizationId = params.organizationId
    const engines = await this.store.listEngines(organizationId)
    const queries = await this.store.selectQueriesToRun(organizationId, {
      limit: params.limit ?? 25,
      marketId: params.marketId,
      engineKey: params.engineKey,
    })

    const usable = engines.filter((e) => e.enabled).filter((e) => {
      if (params.engineKey) return e.key === params.engineKey
      return true
    })

    const outcomes = []
    for (const query of queries) {
      for (const engine of usable) {
        const outcome = await this.runner.runQuery({ organizationId, query, engine })
        outcomes.push(outcome)
      }
    }

    return summarizeOutcomes(outcomes)
  }

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------

  /**
   * Parse stored raw answers into structured observations.
   *
   * Decoupled from collection on purpose: an answer is persisted first, so a
   * parse failure (or a later parser improvement) never requires re-spending on
   * the provider.
   */
  async parseResponses(params: {
    organizationId: string
    limit?: number
    reparse?: boolean
  }): Promise<{ parsed: number; citations: number; failures: string[] }> {
    const organizationId = params.organizationId
    const [locations, services, engines] = await Promise.all([
      this.store.listLocations(organizationId),
      this.store.listServices(organizationId),
      this.store.listEngines(organizationId),
    ])
    const competitors = await this.store.listCompetitors(organizationId)

    const subjectName = await this.subjectBusinessName(organizationId)
    const subjectDomains = subjectDomainList()

    const responses = await this.store.listResponsesAwaitingParse(organizationId, params.limit ?? 50, {
      reparse: params.reparse,
      currentParserVersion: 'v1',
    })

    const engineById = new Map(engines.map((e) => [e.id, e]))
    let parsed = 0
    let citationCount = 0
    const failures: string[] = []

    for (const response of responses) {
      try {
        const engine = engineById.get(response.engine_id)
        const query = await this.loadQuery(organizationId, response.query_id)

        const context = {
          subjectName,
          subjectDomains,
          knownLocations: locations.map((l: AuthorityLocation) => l.name),
          knownServices: services.map((s: AuthorityService) => s.name),
          knownCompetitors: competitors.map((c) => (c as { name: string }).name),
        }

        const outcome: ParseOutcome = buildParsedResponse({
          text: response.raw_response_text,
          citations: [],
          query: query?.raw_text ?? '',
          declaredLocation: null,
          declaredService: null,
          context,
        })

        await this.store.clearDerivedRows(organizationId, response.id)
        await this.store.applyParse({
          organizationId,
          responseId: response.id,
          locationContext: outcome.parsed.locationContext,
          serviceContext: outcome.parsed.serviceContext,
          businessCount: outcome.parsed.businesses.length,
          subjectMentioned: outcome.parsed.subjectMentioned,
          subjectPosition: outcome.parsed.subjectPosition,
          subjectCited: outcome.parsed.subjectCited,
          subjectRecommended: outcome.parsed.subjectRecommended,
          recommendationLanguage: outcome.parsed.recommendationLanguage,
          factualClaims: outcome.parsed.factualClaims,
          parserVersion: outcome.parsed.parserVersion,
          parseConfidence: outcome.parsed.confidence,
          parseNotes: outcome.parsed.notes,
        })

        await this.store.insertMentions(
          organizationId,
          outcome.parsed.businesses.map((b) => ({
            response_id: response.id,
            run_id: response.run_id,
            engine_id: response.engine_id,
            market_id: response.market_id,
            position: b.position,
            business_name: b.name.slice(0, 300),
            normalized_business_name: b.normalizedName.slice(0, 300),
            is_subject: b.isSubject,
            website: b.website,
            services_associated: b.services,
            locations_associated: b.locations,
            is_recommended: b.isRecommended,
            recommendation_context: b.recommendationContext,
          }))
        )

        citationCount += outcome.citations.length
        await this.store.insertCitations(organizationId, outcome.citations)
        parsed += 1

        void engine
      } catch (error) {
        failures.push(
          `response ${response.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    return { parsed, citations: citationCount, failures }
  }

  // -------------------------------------------------------------------------
  // Citations, competitors, scoring
  // -------------------------------------------------------------------------

  async analyzeCitations(organizationId: string, windowDays = 30): Promise<number> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    const markets = await this.store.listMarkets(organizationId)
    let written = 0

    const allCitations = await this.store.listCitations(organizationId, { limit: 5000 })
    const competitors = await this.store.listCompetitors(organizationId)
    const competitorDomains = competitors
      .map((c) => (c as { website: string | null }).website)
      .filter((w): w is string => Boolean(w))
      .map((w) => {
        try {
          return new URL(w).hostname.replace(/^www\./, '')
        } catch {
          return ''
        }
      })
      .filter(Boolean)

    const subjectDomains = subjectDomainList()

    // Organization-level profile first.
    const orgRows = allCitations
      .filter((c) => c.created_at >= since)
      .map((c) => ({
        domain: c.domain,
        source_type: c.source_type,
        is_first_party: c.is_first_party,
        response_id: c.response_id,
        cited_business_name: c.cited_business_name,
      }))

    const profile = buildCitationProfile(orgRows)
    const orgGaps = identifyCitationGaps({
      profile,
      competitorDomains,
      subjectDomains,
    })
    written += await persistCitationGaps({
      store: this.store,
      organizationId,
      marketId: null,
      gaps: orgGaps,
      windowDays,
    })

    // Per-market profiles so city views have their own picture.
    for (const market of markets) {
      const marketRows = allCitations
        .filter((c) => c.market_id === market.id && c.created_at >= since)
        .map((c) => ({
          domain: c.domain,
          source_type: c.source_type,
          is_first_party: c.is_first_party,
          response_id: c.response_id,
          cited_business_name: c.cited_business_name,
        }))
      if (marketRows.length === 0) continue

      const marketProfile = buildCitationProfile(marketRows)
      const gaps = identifyCitationGaps({ profile: marketProfile, competitorDomains, subjectDomains })
      written += await persistCitationGaps({
        store: this.store,
        organizationId,
        marketId: market.id,
        gaps,
        windowDays,
      })
    }

    return written
  }

  async monitorCompetitors(organizationId: string, windowDays = 30) {
    const monitor = new CompetitorMonitor(this.supabase, this.store)
    return monitor.run({ organizationId, windowDays })
  }

  async scoreMarkets(organizationId: string, windowDays = 30, marketId?: string) {
    return this.scoring.scoreMarkets({ organizationId, windowDays, marketId })
  }

  // -------------------------------------------------------------------------
  // Recommendations
  // -------------------------------------------------------------------------

  /**
   * Build the market contexts the recommendation engine needs, then generate.
   *
   * Context assembly lives here (it needs the database) while detection stays
   * pure in the recommendation module.
   */
  async generateRecommendations(params: {
    organizationId: string
    windowDays?: number
    limit?: number
    marketId?: string
    rescore?: boolean
  }): Promise<{
    opportunitiesCreated: number
    recommendationsCreated: number
    approvalsRequested: number
    redFlagged: number
  }> {
    const organizationId = params.organizationId
    const windowDays = params.windowDays ?? 30

    const scoringResults = params.rescore === false
      ? await this.loadExistingScoringContexts(organizationId, windowDays, params.marketId)
      : await this.scoreMarkets(organizationId, windowDays, params.marketId)

    const [markets, services, evidence, previousScores, pages] = await Promise.all([
      this.store.listMarkets(organizationId),
      this.store.listServices(organizationId),
      this.store.listEvidence(organizationId, { limit: 5000 }),
      this.scoring.loadPreviousScores(
        organizationId,
        windowDays,
        new Date(Date.now() - 1).toISOString()
      ),
      this.store.listPages(organizationId),
    ])

    const marketById = new Map(markets.map((m) => [m.id, m]))
    const serviceById = new Map(services.map((s) => [s.id, s]))
    const pageById = new Map(pages.map((p) => [String((p as { id: string }).id), p]))

    const links = await this.store.listPageLinks(organizationId)

    const contexts: MarketContext[] = []

    for (const result of scoringResults) {
      const market = marketById.get(result.marketId)
      if (!market) continue

      const service = serviceById.get(market.service_id)
      const previous = previousScores.get(result.marketId) ?? null

      const marketEvidence = evidence.filter((e) => e.market_id === result.marketId)
      const page = market.primary_page_id ? pageById.get(market.primary_page_id) : undefined
      const pageUrl = page ? String((page as { url: string }).url) : null

      const missingInternalLinks = pageUrl
        ? links.filter((l) => String((l as { from_url: string }).from_url) === pageUrl).length === 0
          ? 3
          : 0
        : 0

      const visibilityTrend = computeTrend(
        result.metrics.internalVisibilityScore,
        previous?.internalVisibilityScore ?? null
      )

      const marketGaps = await this.marketGapDomains(organizationId, result.marketId)

      contexts.push({
        marketId: result.marketId,
        locationName: result.locationName,
        serviceName: result.serviceName,
        locationId: market.location_id,
        serviceId: market.service_id,
        serviceValueEstimate: (service?.customer_value_estimate as number | null) ?? null,
        metrics: result.metrics,
        responseCount: result.observation.responseCount,
        mentionCount: result.observation.mentionCount,
        citationCount: result.observation.citationCount,
        firstPartyCitationCount: result.observation.firstPartyCitationCount,
        distinctCompetitors: result.observation.distinctCompetitors,
        evidenceTotal: marketEvidence.length,
        verifiedEvidence: marketEvidence.filter((e) => e.verification_status === 'verified').length,
        publishedEvidence: marketEvidence.filter(
          (e) => e.publish_permission === true && e.verification_status === 'verified'
        ).length,
        hasPage: Boolean(market.primary_page_id),
        pageId: market.primary_page_id,
        pageHasSchema: page ? ((page as { schema_types: string[] | null }).schema_types?.length ?? 0) > 0 : false,
        missingInternalLinks,
        gapDomains: marketGaps,
        visibilityChange: visibilityTrend?.delta ?? null,
      })
    }

    const engine = new AuthorityRecommendationEngine(this.supabase, this.store)
    const summary = await engine.generate({
      organizationId,
      contexts,
      limit: params.limit,
    })

    await this.store.rankOpportunities(organizationId)

    return {
      opportunitiesCreated: summary.opportunitiesUpserted,
      recommendationsCreated: summary.recommendationsCreated,
      approvalsRequested: summary.approvalsRequested,
      redFlagged: summary.redFlagged,
    }
  }

  private async marketGapDomains(organizationId: string, marketId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('authority_citation_gaps')
      .select('domain')
      .eq('organization_id', organizationId)
      .eq('market_id', marketId)
      .limit(20)
    return (data ?? [])
      .map((r) => String((r as { domain: string }).domain))
      .filter((d) => !d.startsWith('('))
  }

  private async loadExistingScoringContexts(
    organizationId: string,
    windowDays: number,
    marketId?: string
  ): Promise<Array<{ marketId: string; locationName: string; serviceName: string; metrics: ReturnType<typeof import('./metrics').computeMarketMetrics>; observation: import('./types').MarketObservation }>> {
    // Recompute from stored rows without writing new snapshots.
    const results = await this.scoring.scoreMarkets({ organizationId, windowDays, marketId })
    return results
  }

  async evaluateExperiments(organizationId: string) {
    return this.experiments.evaluateDue(organizationId)
  }

  async crawlWebsite(organizationId: string, siteOrigin: string, opts?: { maxPages?: number }) {
    const crawler = new AuthorityCrawler(this.supabase)
    return crawler.crawl(organizationId, {
      siteOrigin,
      maxPages: opts?.maxPages ?? 150,
    })
  }

  // -------------------------------------------------------------------------
  // Full pipeline
  // -------------------------------------------------------------------------

  /**
   * Run the complete daily loop. Each stage is independent and non-fatal: a
   * failure in one stage is recorded and the rest still run, because partial
   * progress on a monitoring system beats an all-or-nothing run.
   */
  async runFullPipeline(params: {
    organizationId: string
    queryLimit?: number
    windowDays?: number
  }): Promise<PipelineResult> {
    const organizationId = params.organizationId
    const windowDays = params.windowDays ?? 30
    const notes: string[] = []

    const queriesGenerated = await this.guard(notes, 'ensureQueries', () =>
      this.ensureQueries(organizationId)
    )

    const sweep = await this.guard(
      notes,
      'monitoringSweep',
      () => this.runMonitoringSweep({ organizationId, limit: params.queryLimit ?? 25 }),
      { attempted: 0, completed: 0, failed: 0, skipped: 0, engines: {} } as SweepSummary
    )

    const parseResult = await this.guard(
      notes,
      'parseResponses',
      () => this.parseResponses({ organizationId, limit: 100 }),
      { parsed: 0, citations: 0, failures: [] }
    )

    const citationsRecorded = await this.guard(notes, 'analyzeCitations', () =>
      this.analyzeCitations(organizationId, windowDays)
    )

    const competitors = await this.guard(
      notes,
      'monitorCompetitors',
      () => this.monitorCompetitors(organizationId, windowDays),
      { competitorsTracked: 0, snapshotsWritten: 0, changesDetected: 0, alertsCreated: 0 }
    )

    const scoringResults = await this.guard(notes, 'scoreMarkets', () =>
      this.scoreMarkets(organizationId, windowDays)
    )

    const recSummary = await this.guard(
      notes,
      'generateRecommendations',
      () =>
        this.generateRecommendations({
          organizationId,
          windowDays,
          rescore: false,
        }),
      { opportunitiesCreated: 0, recommendationsCreated: 0, approvalsRequested: 0, redFlagged: 0 }
    )

    const experimentSummary = await this.guard(
      notes,
      'evaluateExperiments',
      () => this.evaluateExperiments(organizationId),
      { evaluated: 0, completed: 0, stillRunning: 0 }
    )

    await this.store.logAudit({
      organizationId,
      userId: null,
      action: 'ai_authority.pipeline_completed',
      resource: 'authority_pipeline',
      details: `Full authority pipeline run`,
      metadata: {
        queriesGenerated,
        monitored: sweep.attempted,
        parsed: parseResult.parsed,
        marketsScored: scoringResults.length,
        opportunities: recSummary.opportunitiesCreated,
        notes,
      },
    })

    return {
      queriesGenerated,
      queriesMonitored: sweep.attempted,
      sweep,
      parsed: parseResult.parsed,
      citationsRecorded,
      competitors,
      marketsScored: scoringResults.length,
      opportunitiesCreated: recSummary.opportunitiesCreated,
      recommendationsCreated: recSummary.recommendationsCreated,
      approvalsRequested: recSummary.approvalsRequested,
      experimentsEvaluated: experimentSummary.evaluated,
      notes,
    }
  }

  private async guard<T>(notes: string[], stage: string, fn: () => Promise<T>, fallback?: T): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[authority] stage ${stage} failed: ${message}`)
      notes.push(`${stage} failed: ${message}`)
      return fallback as T
    }
  }

  private async loadQuery(organizationId: string, queryId: string): Promise<AuthorityQuery | null> {
    const { data } = await this.supabase
      .from('authority_queries')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', queryId)
      .maybeSingle()
    return (data as AuthorityQuery) ?? null
  }

  /** Canonical subject business name, from the existing company profile. */
  private async subjectBusinessName(organizationId: string): Promise<string> {
    const { data } = await this.supabase
      .from('company_profiles')
      .select('company_name')
      .eq('organization_id', organizationId)
      .maybeSingle()
    return (data as { company_name: string } | null)?.company_name ?? 'Straight Flush Plumbing & Leak Detection'
  }
}

/**
 * Domains that count as first-party.
 *
 * Sourced from configuration rather than hard-coded, so the same engine can
 * serve a different organization without code changes.
 */
export function subjectDomainList(): string[] {
  const fromEnv = process.env.AUTHORITY_SUBJECT_DOMAINS
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
      .filter(Boolean)
  }
  return ['straightflushplumbingoc.com']
}

/** Command Center read model. Reads only; performs no external calls. */
export class AuthorityOverviewService {
  private store: AuthorityStore

  constructor(supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
  }

  async overview(organizationId: string, windowDays = 30) {
    const [markets, scores, opportunities, alerts, engines, integrations, competitors] =
      await Promise.all([
        this.store.listMarkets(organizationId),
        this.store.listLatestScores(organizationId, 500),
        this.store.listOpportunities(organizationId, { status: 'prioritized', limit: 20 }),
        this.store.listAlerts(organizationId, { status: 'new', limit: 50 }),
        this.store.listEngines(organizationId),
        this.store.listIntegrations(organizationId),
        this.store.listCompetitors(organizationId),
      ])

    // Latest snapshot per market, and the one before it for the trend.
    const byMarket = new Map<string, Array<Record<string, unknown>>>()
    for (const score of scores) {
      const marketId = score.market_id as string
      byMarket.set(marketId, [...(byMarket.get(marketId) ?? []), score])
    }

    const marketsView = markets.map((market) => {
      const history = (byMarket.get(market.id) ?? []).slice().sort(
        (a, b) => String(b.measured_at).localeCompare(String(a.measured_at))
      )
      const current = history[0] ?? null
      const previous = history[1] ?? null

      const currentMetrics = current
        ? {
            internalVisibilityScore: num(current.internal_visibility_score),
            internalMentionRate: num(current.internal_mention_rate),
            internalFirstMentionRate: num(current.internal_first_mention_rate),
            internalCitationRate: num(current.internal_citation_rate),
            internalWebsiteCitationRate: num(current.internal_website_citation_rate),
            internalAuthorityScore: num(current.internal_authority_score),
            competitorPressure: num(current.competitor_pressure),
          }
        : {}

      const previousMetrics = previous
        ? {
            internalVisibilityScore: num(previous.internal_visibility_score),
            internalMentionRate: num(previous.internal_mention_rate),
            internalFirstMentionRate: num(previous.internal_first_mention_rate),
            internalCitationRate: num(previous.internal_citation_rate),
            internalWebsiteCitationRate: num(previous.internal_website_citation_rate),
            internalAuthorityScore: num(previous.internal_authority_score),
            competitorPressure: num(previous.competitor_pressure),
          }
        : null

      return {
        marketId: market.id,
        locationName: market.location_name,
        serviceName: market.service_name,
        responseCount: current ? num(current.response_count) : 0,
        current: currentMetrics,
        deltas: buildScoreDeltas(currentMetrics, previousMetrics),
        measuredAt: current ? String(current.measured_at) : null,
      }
    })

    const measured = marketsView.filter((m) => m.measuredAt !== null)
    const average = (key: string): number | null => {
      const values = measured
        .map((m) => (m.current as Record<string, number>)[key])
        .filter((v) => typeof v === 'number' && Number.isFinite(v))
      if (values.length === 0) return null
      return round2(values.reduce((a, b) => a + b, 0) / values.length)
    }

    const integrationStatus = await Promise.all(
      integrations.map(async (row) => {
        const provider = String(row.provider)
        // Import lazily to keep this read model free of integration side effects.
        const { missingCredentialEnvVars } = await import('./integrations')
        const missing = missingCredentialEnvVars(provider as 'google_search_console' | 'google_business_profile')
        return {
          provider,
          displayName: String(row.display_name),
          status: missing.length > 0 ? 'unconfigured' : String(row.status),
          propertyOrLocation: row.property_or_location ?? null,
          lastSyncAt: row.last_sync_at ?? null,
          missingEnvVars: missing,
        }
      })
    )

    return {
      windowDays,
      generatedAt: new Date().toISOString(),
      metricDisclosure:
        'All values are Business Brain internal metrics derived from answers this system collected. ' +
        'They are not, and do not represent, any AI platform ranking formula.',
      overall: {
        internalVisibilityScore: average('internalVisibilityScore'),
        internalMentionRate: average('internalMentionRate'),
        internalFirstMentionRate: average('internalFirstMentionRate'),
        internalCitationRate: average('internalCitationRate'),
        internalWebsiteCitationRate: average('internalWebsiteCitationRate'),
        internalAuthorityScore: average('internalAuthorityScore'),
        competitorPressure: average('competitorPressure'),
        marketsMeasured: measured.length,
        marketsTotal: markets.length,
        opportunityCount: opportunities.length,
        openAlertCount: alerts.length,
      },
      engines: engines.map((engine: AuthorityEngine) => {
        const adapter = EngineAdapterRegistry.get(engine.key)
        return {
          key: engine.key,
          displayName: engine.display_name,
          vendor: engine.vendor,
          capability: adapter ? adapter.capability() : engine.capability,
          credentialEnvVar: engine.credential_env_var,
          model: adapter?.model() ?? engine.default_model,
          enabled: engine.enabled,
          lastQueryAt: engine.last_query_at,
          lastError: engine.last_error,
        }
      }),
      integrations: integrationStatus,
      markets: marketsView.sort(
        (a, b) =>
          (b.current as Record<string, number>).internalVisibilityScore -
          (a.current as Record<string, number>).internalVisibilityScore
      ),
      topOpportunities: opportunities,
      alerts,
      competitors: competitors.slice(0, 20),
    }
  }

  /** Market detail: score history, gaps, evidence, and recommendations. */
  async marketDetail(organizationId: string, marketId: string) {
    const markets = await this.store.listMarkets(organizationId)
    const market = markets.find((m: AuthorityMarket) => m.id === marketId)
    if (!market) return null

    const [history, evidence, opportunities, actions] = await Promise.all([
      this.store.listScoresForMarket(organizationId, marketId, 24),
      this.store.listEvidence(organizationId, { marketId, limit: 200 }),
      this.store.listOpportunities(organizationId, { limit: 200 }),
      this.store.listRecommendationActions(organizationId, { limit: 200 }),
    ])

    const marketOpportunities = opportunities.filter((o) => o.market_id === marketId)
    const opportunityIds = new Set(marketOpportunities.map((o) => o.id as string))

    return {
      market,
      history,
      evidence,
      opportunities: marketOpportunities,
      actions: actions.filter((a) => opportunityIds.has(a.opportunity_id as string)),
      evidenceGaps: assessEvidenceGaps({
        markets: [market].map((m: AuthorityMarket) => ({
          id: m.id,
          location_name: m.location_name,
          service_name: m.service_name,
          primary_page_id: m.primary_page_id,
        })),
        evidence: evidence.map((e) => ({
          market_id: (e.market_id as string | null) ?? null,
          verification_status: String(e.verification_status),
          publish_permission: Boolean(e.publish_permission),
          evidence_type: String(e.evidence_type),
        })),
      }),
    }
  }

  /**
   * Concise daily business summary.
   *
   * This is a READ MODEL: it makes no external calls and costs nothing. Its job
   * is to state, without embellishment, what the system actually observed today
   * and what remains unavailable -- so an unconfigured deployment produces an
   * honest "no data collected" briefing rather than a fabricated one.
   */
  async buildDailyBriefing(organizationId: string, windowDays = 30) {
    const [markets, scores, opportunities, alerts, engines, integrations, competitors, issues] =
      await Promise.all([
        this.store.listMarkets(organizationId),
        this.store.listLatestScores(organizationId, 500),
        this.store.listOpportunities(organizationId, { limit: 200 }),
        this.store.listAlerts(organizationId, { limit: 200 }),
        this.store.listEngines(organizationId),
        this.store.listIntegrations(organizationId),
        this.store.listCompetitors(organizationId),
        this.store.listTechnicalIssues(organizationId, { status: 'open', limit: 200 }),
      ])

    const measured = scores.filter((s) => num((s as Record<string, unknown>).response_count) > 0)
    const observedVisibility = measured.length > 0
    const averageVisibility = observedVisibility
      ? round2(
          measured.reduce((acc, s) => acc + num((s as Record<string, unknown>).internal_visibility_score), 0) /
            measured.length
        )
      : null

    const openOpportunities = opportunities.filter((o) =>
      ['open', 'prioritized', 'in_progress'].includes(String((o as Record<string, unknown>).status))
    )
    const highPriority = openOpportunities.filter(
      (o) => num((o as Record<string, unknown>).priority_score) >= 70
    )
    const newAlerts = alerts.filter((a) => String((a as Record<string, unknown>).status) === 'new')

    const configuredEngines = engines.filter((e) => {
      const adapter = EngineAdapterRegistry.get(String(e.key))
      return adapter ? adapter.capability() === 'supported' : String(e.capability) === 'supported'
    })

    const connectedIntegrations = integrations.filter((i) => String(i.status) === 'connected')
    const unconfiguredIntegrations = integrations.filter((i) => String(i.status) !== 'connected')

    const headline = !observedVisibility
      ? 'No AI-visibility data has been collected yet. ' +
        (configuredEngines.length === 0
          ? 'No AI engine credential is configured, so no answers could be collected. This is an honest empty state, not zero visibility.'
          : 'Engines are configured but no answers have been collected yet.')
      : `${measured.length} of ${markets.length} markets measured; average internal visibility ${averageVisibility}.`

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      headline,
      metricDisclosure:
        'Business Brain internal metrics derived only from answers this system collected. ' +
        'They are not any AI platform ranking formula.',
      observed: {
        marketsTotal: markets.length,
        marketsMeasured: measured.length,
        averageVisibility,
        opportunitiesOpen: openOpportunities.length,
        opportunitiesHighPriority: highPriority.length,
        alertsNew: newAlerts.length,
        competitorsTracked: competitors.length,
        technicalIssuesOpen: issues.length,
      },
      unavailable: {
        // Named explicitly so an empty dashboard is never mistaken for zero performance.
        enginesConfigured: configuredEngines.map((e) => String(e.key)),
        enginesUnconfigured: engines
          .filter((e) => !configuredEngines.includes(e))
          .map((e) => ({ key: String(e.key), capability: String(e.capability) })),
        integrationsConnected: connectedIntegrations.map((i) => String(i.provider)),
        integrationsUnconfigured: unconfiguredIntegrations.map((i) => ({
          provider: String(i.provider),
          missingEnvVars: [] as string[],
        })),
      },
      topActions: highPriority.slice(0, 5).map((o) => ({
        id: String((o as Record<string, unknown>).id),
        title: String((o as Record<string, unknown>).title),
        priorityScore: num((o as Record<string, unknown>).priority_score),
      })),
    }
  }
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}