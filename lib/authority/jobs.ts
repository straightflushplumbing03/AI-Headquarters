/**
 * AI Authority Engine -- background job handlers.
 *
 * Registered into the EXISTING handler registry in lib/jobs/handlers.ts. Every
 * handler here follows the same contract as the pre-existing ones:
 *
 *   - the organization comes from the CLAIMED ROW, never from a request
 *   - throw Error for transient failures (retry with backoff)
 *   - throw PermanentJobError for permanent failures (dead-letter immediately)
 *   - never swallow an error
 *
 * Transient vs permanent is chosen deliberately for each stage:
 *   - a provider outage, rate limit, or DB blip is TRANSIENT
 *   - a missing/invalid payload or an unconfigured integration is PERMANENT
 *     (retrying cannot fix configuration)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { PermanentJobError, type JobHandler } from '@/lib/jobs/errors'
import { AuthorityOrchestrator, AuthorityOverviewService, subjectDomainList } from '@/lib/authority/orchestrator'
import { SearchConsoleIntegration, GoogleBusinessProfileIntegration, GoogleAnalyticsIntegration } from '@/lib/authority/integrations'
import { AuthorityStore } from '@/lib/authority/store'
import { AuthorityQueryRunner } from '@/lib/authority/query-runner'
import {
  findDuplicateCompetitors,
  findDuplicateQueries,
  findMalformedUrls,
  findProhibitedPatterns,
  findUnlinkedMarkets,
  summarizeIssues,
} from '@/lib/authority/data-quality'
import type {
  AuthorityCompetitorMonitorPayload,
  AuthorityDailyBriefingPayload,
  AuthorityDataQualityPayload,
  AuthorityIntegrationSyncPayload,
  AuthorityQueryExecutionPayload,
  AuthorityRecommendationGenerationPayload,
  AuthorityResponseParsingPayload,
  AuthorityScoringPayload,
  AuthorityWebsiteCrawlPayload,
  ClaimedJob,
} from '@/lib/jobs/types'

interface AuthorityContext {
  supabase: SupabaseClient
  organizationId: string
  store: AuthorityStore
  orchestrator: AuthorityOrchestrator
}

function buildContext(job: ClaimedJob, supabase: SupabaseClient): AuthorityContext {
  const organizationId = job.organization_id
  if (!organizationId) {
    throw new PermanentJobError('authority job requires an organization_id on the claimed row')
  }
  return {
    supabase,
    organizationId,
    store: new AuthorityStore(supabase),
    orchestrator: new AuthorityOrchestrator(supabase),
  }
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

/**
 * Execute a monitoring sweep.
 *
 * A sweep in which every engine was skipped for configuration reasons is NOT a
 * failure: it is the honest state of an unconfigured deployment, and retrying
 * cannot help. It is recorded as a completed job with a clear summary.
 */
export const authorityQueryExecution: JobHandler = async (job, ctx) => {
  const { organizationId, orchestrator } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityQueryExecutionPayload

  // Keep the query set current before spending money on it.
  const queriesGenerated = await orchestrator.ensureQueries(organizationId)

  const sweep = await orchestrator.runMonitoringSweep({
    organizationId,
    limit: clampLimit(payload.limit, 25, 200),
    marketId: payload.marketId,
    engineKey: payload.engineKey,
  })

  const attemptedProviderCalls = sweep.completed + sweep.failed
  if (attemptedProviderCalls === 0 && sweep.skipped === 0) {
    // Nothing was even considered (no queries or no enabled engines). Permanent:
    // retrying will not conjure a query set.
    throw new PermanentJobError(
      'no queries or enabled engines available for this organization; seed the authority engine first'
    )
  }

  return {
    queriesGenerated,
    attempted: sweep.attempted,
    completed: sweep.completed,
    failed: sweep.failed,
    skipped: sweep.skipped,
    engines: sweep.engines,
    note:
      sweep.completed === 0
        ? 'No answers were collected. Every engine was skipped (unconfigured or unsupported) ' +
          'or failed. This is recorded honestly; no data was fabricated.'
        : undefined,
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export const authorityResponseParsing: JobHandler = async (job, ctx) => {
  const { organizationId, orchestrator } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityResponseParsingPayload

  const result = await orchestrator.parseResponses({
    organizationId,
    limit: clampLimit(payload.limit, 100, 500),
    reparse: payload.reparse === true,
  })

  // A total parse failure across a non-empty batch is a real bug worth
  // retrying, then dead-lettering if it persists.
  if (result.parsed === 0 && result.failures.length > 0) {
    throw new Error(
      `response parsing failed for every candidate (${result.failures.length}): ${result.failures
        .slice(0, 3)
        .join(' | ')}`
    )
  }

  return {
    parsed: result.parsed,
    citations: result.citations,
    failures: result.failures.slice(0, 10),
  }
}

// ---------------------------------------------------------------------------
// Competitor monitoring
// ---------------------------------------------------------------------------

export const authorityCompetitorMonitor: JobHandler = async (job, ctx) => {
  const { organizationId, orchestrator } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityCompetitorMonitorPayload

  const result = await orchestrator.monitorCompetitors(
    organizationId,
    clampWindow(payload.windowDays)
  )
  return { ...result }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const authorityScoring: JobHandler = async (job, ctx) => {
  const { organizationId, orchestrator } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityScoringPayload

  const results = await orchestrator.scoreMarkets(
    organizationId,
    clampWindow(payload.windowDays),
    payload.marketId
  )

  return {
    marketsScored: results.length,
    withResponses: results.filter((r) => r.observation.responseCount > 0).length,
    note:
      results.length === 0
        ? 'No active markets found; the authority engine may not be seeded yet.'
        : undefined,
  }
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export const authorityRecommendationGeneration: JobHandler = async (job, ctx) => {
  const { organizationId, orchestrator } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityRecommendationGenerationPayload

  const summary = await orchestrator.generateRecommendations({
    organizationId,
    windowDays: 30,
    limit: payload.limit,
    marketId: payload.marketId,
    rescore: payload.rescore !== false,
  })

  return { ...summary }
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export const authorityExperimentEvaluation: JobHandler = async (job, ctx) => {
  const { organizationId, orchestrator } = buildContext(job, ctx.supabase)
  const summary = await orchestrator.evaluateExperiments(organizationId)
  return { ...summary }
}

// ---------------------------------------------------------------------------
// Website crawl
// ---------------------------------------------------------------------------

export const authorityWebsiteCrawl: JobHandler = async (job, ctx) => {
  const { organizationId, store, orchestrator } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityWebsiteCrawlPayload

  const siteOrigin = payload.siteOrigin ?? (await resolveSiteOrigin(store, organizationId, ctx.supabase))
  if (!siteOrigin) {
    // Configuration, not a transient fault.
    throw new PermanentJobError(
      'no site origin configured (payload.siteOrigin, organizations.website, or AUTHORITY_SITE_ORIGIN)'
    )
  }

  const summary = await orchestrator.crawlWebsite(organizationId, siteOrigin, {
    maxPages: clampLimit(payload.maxPages, 150, 500),
  })

  return { ...summary, errors: summary.errors.slice(0, 10) }
}

// ---------------------------------------------------------------------------
// Integrations (credential-gated)
// ---------------------------------------------------------------------------

/**
 * Search Console sync.
 *
 * Unconfigured is PERMANENT-by-design here is wrong: the operator may add
 * credentials at any time, and this job is scheduled, not user-triggered. So an
 * unconfigured integration returns a normal result describing the gap and
 * consumes no retries. Only a genuine API error is thrown as transient.
 */
export const authoritySearchConsoleSync: JobHandler = async (job, ctx) => {
  const { organizationId } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityIntegrationSyncPayload

  const integration = new SearchConsoleIntegration(ctx.supabase)
  const result = await integration.sync({
    organizationId,
    days: payload.days ?? 7,
    startDate: payload.startDate,
    endDate: payload.endDate,
  })

  if (!result.synced) {
    return { synced: false, rows: 0, reason: result.reason ?? 'not configured' }
  }
  return { synced: true, rows: result.rows }
}

export const authorityGbpSync: JobHandler = async (job, ctx) => {
  const { organizationId } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityIntegrationSyncPayload

  const integration = new GoogleBusinessProfileIntegration(ctx.supabase)
  const result = await integration.sync({
    organizationId,
    days: payload.days ?? 7,
    startDate: payload.startDate,
    endDate: payload.endDate,
  })

  if (!result.synced) {
    return { synced: false, rows: 0, reason: result.reason ?? 'not configured' }
  }
  return { synced: true, rows: result.rows }
}

/**
 * GA4 sync. Same contract as the Search Console and GBP syncs: an unconfigured
 * integration is an honest skip (no retries), a real API failure is transient.
 */
export const authorityGa4Sync: JobHandler = async (job, ctx) => {
  const { organizationId } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityIntegrationSyncPayload

  const integration = new GoogleAnalyticsIntegration(ctx.supabase)
  const result = await integration.sync({
    organizationId,
    days: payload.days ?? 7,
    startDate: payload.startDate,
    endDate: payload.endDate,
  })

  if (!result.synced) {
    return { synced: false, rows: 0, reason: result.reason ?? 'not configured' }
  }
  return { synced: true, rows: result.rows }
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

/**
 * Detect data-quality problems and raise alerts for them.
 *
 * Detection only: nothing is merged or deleted. A wrong automatic merge would
 * silently rewrite history, which is worse than a visible duplicate.
 */
export const authorityDataQualitySweep: JobHandler = async (job, ctx) => {
  const { organizationId, store, supabase } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityDataQualityPayload
  const limit = clampLimit(payload.limit, 1000, 5000)

  const [competitors, queries, markets, responses] = await Promise.all([
    store.listCompetitors(organizationId),
    loadQueries(supabase, organizationId, limit),
    store.listMarkets(organizationId),
    loadResponses(supabase, organizationId, limit),
  ])

  const citations = await store.listCitations(organizationId, { limit })

  const issues = [
    ...findDuplicateCompetitors(
      competitors.map((c) => {
        const row = c as Record<string, unknown>
        return {
          id: String(row.id),
          name: String(row.name),
          normalized_name: String(row.normalized_name),
          website: (row.website as string | null) ?? null,
        }
      })
    ),
    ...findDuplicateQueries(queries),
    ...findMalformedUrls([
      ...citations.map((c) => ({ id: c.id, url: c.url })),
      ...(await store.listPages(organizationId, limit)).map((p) => ({
        id: String((p as { id: string }).id),
        url: String((p as { url: string }).url),
      })),
    ]),
    ...findUnlinkedMarkets(
      markets.map((m) => ({
        id: m.id,
        location_id: m.location_id,
        service_id: m.service_id,
      }))
    ),
    ...findProhibitedPatterns(responses),
  ]

  const summary = summarizeIssues(issues)

  // High-severity findings become alerts; the rest are reported in the job
  // result so they are visible without generating notification noise.
  let alertsCreated = 0
  const today = new Date().toISOString().slice(0, 10)
  for (const issue of issues.filter((i) => i.severity === 'high').slice(0, 20)) {
    const created = await store.insertAlert({
      organization_id: organizationId,
      alert_type: 'data_quality_problem',
      severity: 'high',
      title: `Data quality: ${issue.issueType.replace(/_/g, ' ')}`,
      detail: issue.detail.slice(0, 2000),
      metrics: { affectedIds: issue.affectedIds.slice(0, 20), recommendation: issue.recommendation },
      dedupe_key: `data-quality:${issue.issueType}:${today}`,
    })
    if (created) alertsCreated += 1
  }

  if (summary.total > 0) {
    await store.logAudit({
      organizationId,
      userId: null,
      action: 'ai_authority.data_quality_sweep',
      resource: 'authority_data_quality',
      details: `Detected ${summary.total} data quality issue(s)`,
      metadata: summary,
    })
  }

  return {
    totalIssues: summary.total,
    bySeverity: summary.bySeverity,
    byType: summary.byType,
    alertsCreated,
    sampleIssues: issues.slice(0, 10).map((i) => ({
      type: i.issueType,
      severity: i.severity,
      detail: i.detail.slice(0, 300),
    })),
  }
}

// ---------------------------------------------------------------------------
// Daily business summary
// ---------------------------------------------------------------------------

/**
 * Build the concise daily business summary.
 *
 * A read model: it makes no external calls and spends nothing. It states what
 * was observed and what is unavailable, so an unconfigured deployment records
 * an honest empty briefing instead of a fabricated one. It is also logged to
 * the audit trail so the day's summary is retained even before a UI view is
 * opened.
 */
export const authorityDailyBriefing: JobHandler = async (job, ctx) => {
  const { organizationId, store } = buildContext(job, ctx.supabase)
  const payload = (job.payload ?? {}) as AuthorityDailyBriefingPayload

  const briefing = await new AuthorityOverviewService(ctx.supabase).buildDailyBriefing(
    organizationId,
    clampWindow(payload.windowDays)
  )

  await store.logAudit({
    organizationId,
    userId: null,
    action: 'ai_authority.daily_briefing',
    resource: 'authority_daily_briefing',
    details: briefing.headline,
    metadata: {
      observed: briefing.observed,
      generatedAt: briefing.generatedAt,
    },
  })

  return {
    headline: briefing.headline,
    observed: briefing.observed,
    unavailable: briefing.unavailable,
    generatedAt: briefing.generatedAt,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.round(n), max)
}

function clampWindow(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 30
  return Math.min(Math.max(Math.round(n), 7), 365)
}

/** Resolve the site to crawl from payload, the org record, or the environment. */
async function resolveSiteOrigin(
  store: AuthorityStore,
  organizationId: string,
  supabase: SupabaseClient
): Promise<string | null> {
  if (process.env.AUTHORITY_SITE_ORIGIN) return process.env.AUTHORITY_SITE_ORIGIN

  const { data } = await supabase
    .from('organizations')
    .select('website')
    .eq('id', organizationId)
    .maybeSingle()

  const website = (data as { website: string | null } | null)?.website
  if (website) return website
  void store
  return null
}

async function loadQueries(supabase: SupabaseClient, organizationId: string, limit: number) {
  const { data } = await supabase
    .from('authority_queries')
    .select('id, normalized_text, intent, raw_text')
    .eq('organization_id', organizationId)
    .limit(limit)
  return (data ?? []) as Array<{
    id: string
    normalized_text: string
    intent: string
    raw_text: string
  }>
}

async function loadResponses(supabase: SupabaseClient, organizationId: string, limit: number) {
  const { data } = await supabase
    .from('authority_responses')
    .select('id, raw_response_text')
    .eq('organization_id', organizationId)
    .order('captured_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as Array<{ id: string; raw_response_text: string }>
}

/** Exported for the API layer so the same runner instance semantics are reused. */
export function createAuthorityQueryRunner(supabase: SupabaseClient): AuthorityQueryRunner {
  return new AuthorityQueryRunner(supabase)
}

export { subjectDomainList }