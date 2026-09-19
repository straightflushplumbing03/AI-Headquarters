/**
 * AI Authority Engine -- browser API client.
 *
 * Thin, typed wrappers over /api/ai-authority/*. Every endpoint requires an
 * organizationId; it is sent explicitly rather than inferred so the server can
 * verify the caller's membership against it (the server never trusts it as
 * authority, only as a target to check).
 *
 * Errors are normalized into a thrown Error carrying the server's message, so
 * components render one honest failure state instead of guessing.
 */

export interface ApiFailure {
  error: string
  requiredRole?: string
  approvalClass?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })

  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const failure = payload as ApiFailure | null
    throw new Error(failure?.error ?? `Request failed (${response.status})`)
  }

  return payload as T
}

export function authorityQuery(organizationId: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams({ organizationId })
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  return search.toString()
}

// ---------------------------------------------------------------------------
// Payload types -- the subset the UI actually renders.
// ---------------------------------------------------------------------------

export interface MetricDisclosure {
  metricDisclosure?: string
  policy?: string
  note?: string
}

export interface MarketDelta {
  metric: string
  previous: number | null
  current: number | null
  change: number | null
  direction: 'up' | 'down' | 'flat' | null
}

export interface MarketView {
  marketId: string
  locationName: string
  serviceName: string
  responseCount: number
  current: Record<string, number>
  deltas: MarketDelta[]
  measuredAt: string | null
}

export interface EngineView {
  key: string
  displayName: string
  vendor: string
  capability: string
  credentialEnvVar: string | null
  model: string | null
  enabled: boolean
  lastQueryAt: string | null
  lastError: string | null
  stats: {
    runsAttempted: number
    completed: number
    skipped: number
    failed: number
    responsesCollected: number
    mentionRate: number
    firstMentionRate: number
    citationRate: number
    distinctSourceDomains: number
  }
}

export interface ServiceView {
  serviceId: string
  name: string
  tier: string
  citiesTracked: number
  citiesMeasured: number
  averageInternalVisibility: number | null
  evidenceTotal: number
  evidencePublished: number
  markets: Array<{
    marketId: string
    locationName: string
    internalVisibilityScore: number | null
    evidenceCount: number
    hasPage: boolean
  }>
}

export interface OpportunityCard {
  id: string
  market_id: string | null
  title: string
  category: string
  priority: string
  status: string
  opportunity_score: number
  score_explanation: string | null
  what: string | null
  why: string | null
  evidence: string | null
  impact: string | null
  action: string | null
  risk: string | null
  measurement: string | null
  approval_class: string
  location_name?: string | null
  service_name?: string | null
  created_at: string
}

export interface RecommendationView {
  action_id: string | null
  id: string
  title: string
  description: string | null
  status: string
  approval_class: string
  decided_at: string | null
  decision_reason: string | null
  opportunity: {
    title: string
    category: string
    what: string | null
    why: string | null
    impact: string | null
    risk: string | null
    measurement: string | null
    opportunityScore: number
    scoreExplanation: string | null
  } | null
  approval: { approval_status: string; response_reason: string | null } | null
}

export interface AlertView {
  id: string
  alert_type: string
  severity: string
  title: string
  detail: string | null
  status: string
  created_at: string
}

export interface CitationDomain {
  domain: string
  sourceType: string
  firstParty: boolean
  count: number
}

export interface CitationGap {
  id: string
  source_type: string | null
  detail: string | null
  competitor_share: number | null
  our_share: number | null
  status: string
}

export interface CompetitorCard {
  id: string
  name: string
  website: string | null
  discoverySource: string | null
  locations: string[]
  services: string[]
  firstSeenAt: string | null
  lastSeenAt: string | null
  current: {
    mentionCount: number | null
    firstPositionCount: number | null
    citationCount: number | null
    distinctSourceDomains: number | null
    internalShareOfVoice: number | null
    topSourceDomains: unknown
    snapshotDate: string | null
  } | null
  mentionDelta: number | null
  recentChanges: Array<Record<string, unknown>>
}

export interface ExperimentView {
  id: string
  name: string
  hypothesis: string
  status: string
  metric: string
  started_at: string | null
  ended_at: string | null
  baseline: Record<string, unknown>
  results: Array<{
    id: string
    outcome: string
    confidence: number | null
    summary: string | null
    measured_at?: string | null
    [key: string]: unknown
  }>
}

export interface ResponseView {
  id: string
  queryId: string | null
  engineKey: string | null
  model: string | null
  capturedAt: string
  mentioned: boolean | null
  position: number | null
  cited: boolean | null
  recommendationLanguage: unknown
}

export interface OverviewPayload extends MetricDisclosure {
  windowDays: number
  generatedAt: string
  overall: {
    internalVisibilityScore: number | null
    internalMentionRate: number | null
    internalFirstMentionRate: number | null
    internalCitationRate: number | null
    internalWebsiteCitationRate: number | null
    internalAuthorityScore: number | null
    competitorPressure: number | null
    marketsMeasured: number
    marketsTotal: number
    opportunityCount: number
    openAlertCount: number
  }
  engines: EngineView[]
  integrations: Array<{
    provider: string
    displayName: string
    status: string
    propertyOrLocation: string | null
    lastSyncAt: string | null
    missingEnvVars: string[]
  }>
  markets: MarketView[]
  topOpportunities: OpportunityCard[]
  alerts: AlertView[]
  competitors: CompetitorCard[]
}

export const authorityApi = {
  overview: (organizationId: string, windowDays = 30) =>
    request<OverviewPayload>(`/api/ai-authority/overview?${authorityQuery(organizationId, { windowDays })}`),

  markets: (organizationId: string) =>
    request<{
      locations: Array<{ id: string; name: string; tier: string; is_service_area: boolean }>
      services: Array<{ id: string; name: string; tier: string }>
      markets: Array<Record<string, unknown>>
      matrix: Array<{
        locationId: string
        locationName: string
        tier: string
        services: Array<{
          marketId: string
          serviceId: string
          serviceName: string
          tier: string
          active: boolean
          hasPage: boolean
        } | null>
      }>
      metricDisclosure: string
    }>(`/api/ai-authority/markets?${authorityQuery(organizationId)}`),

  marketDetail: (organizationId: string, marketId: string) =>
    request<Record<string, unknown>>(
      `/api/ai-authority/markets?${authorityQuery(organizationId, { marketId })}`
    ),

  engines: (organizationId: string) =>
    request<{ engines: EngineView[] } & MetricDisclosure>(`/api/ai-authority/engines?${authorityQuery(organizationId)}`),

  services: (organizationId: string) =>
    request<{ services: ServiceView[] } & MetricDisclosure>(
      `/api/ai-authority/services?${authorityQuery(organizationId)}`
    ),

  opportunities: (organizationId: string, status?: string, limit?: number) =>
    request<{ opportunities: OpportunityCard[] } & MetricDisclosure>(
      `/api/ai-authority/opportunities?${authorityQuery(organizationId, { status, limit })}`
    ),

  recommendations: (organizationId: string, limit?: number, marketId?: string) =>
    request<{ recommendations: RecommendationView[]; pendingApprovalCount: number } & MetricDisclosure>(
      `/api/ai-authority/recommendations?${authorityQuery(organizationId, { limit, marketId })}`
    ),

  decide: (organizationId: string, actionId: string, decision: 'approve' | 'reject', reason?: string) =>
    request<{ success: boolean; note: string }>(`/api/ai-authority/recommendations/decision`, {
      method: 'POST',
      body: JSON.stringify({ organizationId, actionId, decision, reason }),
    }),

  alerts: (organizationId: string, status?: string) =>
    request<{ alerts: AlertView[]; total: number }>(
      `/api/ai-authority/alerts?${authorityQuery(organizationId, { status })}`
    ),

  updateAlert: (organizationId: string, alertId: string, status: string) =>
    request<{ success: boolean }>(`/api/ai-authority/alerts`, {
      method: 'PATCH',
      body: JSON.stringify({ organizationId, alertId, status }),
    }),

  citations: (organizationId: string) =>
    request<{
      totalCitations: number
      firstPartyCitations: number
      thirdPartyCitations: number
      firstPartyShare: number
      domains: CitationDomain[]
      gaps: CitationGap[]
    } & MetricDisclosure>(`/api/ai-authority/citations?${authorityQuery(organizationId)}`),

  competitors: (organizationId: string) =>
    request<{ competitors: CompetitorCard[] } & MetricDisclosure>(
      `/api/ai-authority/competitors?${authorityQuery(organizationId)}`
    ),

  responses: (organizationId: string, limit?: number) =>
    request<{ responses: ResponseView[] } & MetricDisclosure>(
      `/api/ai-authority/responses?${authorityQuery(organizationId, { limit })}`
    ),

  responseDetail: (organizationId: string, responseId: string) =>
    request<Record<string, unknown>>(
      `/api/ai-authority/responses?${authorityQuery(organizationId, { responseId })}`
    ),

  experiments: (organizationId: string, status?: string) =>
    request<{ experiments: ExperimentView[]; interpretation?: string } & MetricDisclosure>(
      `/api/ai-authority/experiments?${authorityQuery(organizationId, { status })}`
    ),

  quality: (organizationId: string) =>
    request<{
      findings: Array<{
        url: string
        issueType: string
        severity: string
        detail: string
        recommendation: string
      }>
      findingTotals: { total: number; bySeverity: Record<string, number> }
      persistedIssues: Array<Record<string, unknown>>
      internalLinkPlan: Array<Record<string, unknown>>
      doorwayPolicy: string
      mutationPolicy: string
    }>(`/api/ai-authority/quality?${authorityQuery(organizationId)}`),

  crawl: (organizationId: string) =>
    request<{
      pages: Array<Record<string, unknown>>
      lastCrawlAt: string | null
      robotsPolicy?: string
    }>(`/api/ai-authority/crawl?${authorityQuery(organizationId)}`),

  seed: (organizationId: string) =>
    request<{
      success: boolean
      result: { cities: number; services: number; markets: number; engines: number; templates: number; note: string }
      note: string
    }>('/api/ai-authority/seed', {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    }),

  settings: (organizationId: string) =>
    request<{
      budget: {
        daily_query_limit: number
        monthly_query_limit: number
        monthly_cost_ceiling: number
        paused: boolean
        pause_reason: string | null
      }
      usage: { queriesToday: number; queriesThisMonth: number; costThisMonth: number }
      role: string
      integrations: Array<Record<string, unknown>>
      engines: Array<Record<string, unknown>>
      killSwitches: {
        organizationPaused: boolean
        globalPaused: boolean | null
        globalPausedNote?: string
      }
      credentialPolicy: string
    }>(`/api/ai-authority/settings?${authorityQuery(organizationId)}`),

  integrations: (organizationId: string) =>
    request<{
      integrations: Array<{
        provider: string
        displayName: string
        status: string
        propertyOrLocation: string | null
        lastSyncAt: string | null
        missingEnvVars: string[]
      }>
    }>(`/api/ai-authority/integrations?${authorityQuery(organizationId)}`),
}