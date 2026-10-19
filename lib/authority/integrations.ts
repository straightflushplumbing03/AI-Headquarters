/**
 * AI Authority Engine -- external integrations (Search Console, GBP, GA4).
 *
 * All integrations are credential-gated and report their state HONESTLY.
 * There is no synthetic fallback data: if credentials are absent, the
 * integration reports `unconfigured` and syncs nothing. The rest of the engine
 * keeps working on the data it does have, which is the required behaviour when
 * one external source is unavailable.
 *
 * REQUIRED CREDENTIALS (documented, never committed):
 *
 *   Google Search Console
 *     GOOGLE_SEARCH_CONSOLE_CLIENT_ID
 *     GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
 *     GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
 *     (plus the verified property, stored per-org as
 *      authority_integrations.property_or_location)
 *
 *   Google Business Profile
 *     GOOGLE_BUSINESS_PROFILE_CLIENT_ID
 *     GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET
 *     GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN
 *     (plus the location reference stored per-org)
 *
 *   Google Analytics 4
 *     GOOGLE_ANALYTICS_CLIENT_ID
 *     GOOGLE_ANALYTICS_CLIENT_SECRET
 *     GOOGLE_ANALYTICS_REFRESH_TOKEN
 *     (plus the numeric property id stored per-org)
 *
 * The OAuth authorization-code exchange is intentionally NOT automated here:
 * obtaining a refresh token requires a human consent screen. Once the operator
 * supplies a refresh token as a secret, these adapters work without code
 * changes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthorityStore } from './store'

export type IntegrationProvider =
  | 'google_search_console'
  | 'google_business_profile'
  | 'google_analytics_4'

export interface IntegrationCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export interface IntegrationStatus {
  provider: IntegrationProvider
  status: 'unconfigured' | 'configured' | 'connected' | 'error' | 'revoked'
  missingEnvVars: string[]
  message: string
}

const CREDENTIAL_ENV_VARS: Record<IntegrationProvider, string[]> = {
  google_search_console: [
    'GOOGLE_SEARCH_CONSOLE_CLIENT_ID',
    'GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET',
    'GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN',
  ],
  google_business_profile: [
    'GOOGLE_BUSINESS_PROFILE_CLIENT_ID',
    'GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET',
    'GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN',
  ],
  google_analytics_4: [
    'GOOGLE_ANALYTICS_CLIENT_ID',
    'GOOGLE_ANALYTICS_CLIENT_SECRET',
    'GOOGLE_ANALYTICS_REFRESH_TOKEN',
  ],
}

/** Which credential env vars are missing in this process. */
export function missingCredentialEnvVars(provider: IntegrationProvider): string[] {
  return CREDENTIAL_ENV_VARS[provider].filter((name) => {
    const value = process.env[name]
    return !value || value.trim().length === 0
  })
}

export function credentialsFor(provider: IntegrationProvider): IntegrationCredentials | null {
  const missing = missingCredentialEnvVars(provider)
  if (missing.length > 0) return null

  if (provider === 'google_search_console') {
    return {
      clientId: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET!,
      refreshToken: process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN!,
    }
  }
  if (provider === 'google_analytics_4') {
    return {
      clientId: process.env.GOOGLE_ANALYTICS_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET!,
      refreshToken: process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN!,
    }
  }
  return {
    clientId: process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN!,
  }
}

/** Exchange a refresh token for a short-lived access token. */
export async function fetchAccessToken(credentials: IntegrationCredentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`token exchange failed (HTTP ${response.status}): ${truncate(raw, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('token endpoint returned non-JSON body')
  }

  const token = (parsed as Record<string, unknown>).access_token
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('token response did not include an access_token')
  }
  return token
}

export interface SearchConsoleRow {
  date: string
  query: string
  page: string | null
  country: string | null
  device: string | null
  clicks: number
  impressions: number
  ctr: number | null
  position: number | null
}

/**
 * Query the Search Console API for query-level rows.
 *
 * Returns raw rows; classification and market attribution happen in the caller
 * so this stays a thin, testable transport layer.
 */
export async function fetchSearchAnalytics(params: {
  accessToken: string
  siteUrl: string
  startDate: string
  endDate: string
  rowLimit?: number
}): Promise<SearchConsoleRow[]> {
  const url =
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(params.siteUrl)}` +
    `/searchAnalytics/query`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: params.startDate,
      endDate: params.endDate,
      dimensions: ['date', 'query', 'page', 'country', 'device'],
      rowLimit: params.rowLimit ?? 5000,
      type: 'web',
    }),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`Search Console query failed (HTTP ${response.status}): ${truncate(raw, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Search Console returned non-JSON body')
  }

  const rows = (parsed as { rows?: unknown[] }).rows ?? []
  return rows.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const keys = Array.isArray(row.keys) ? (row.keys as string[]) : []
    return {
      date: keys[0] ?? '',
      query: keys[1] ?? '',
      page: keys[2] ?? null,
      country: keys[3] ?? null,
      device: keys[4] ?? null,
      clicks: toInt(row.clicks),
      impressions: toInt(row.impressions),
      ctr: toNumber(row.ctr),
      position: toNumber(row.position),
    }
  })
}

export class SearchConsoleIntegration {
  private store: AuthorityStore

  constructor(supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
  }

  /** Current honest status, derived from the environment plus stored config. */
  async status(organizationId: string): Promise<IntegrationStatus> {
    const missing = missingCredentialEnvVars('google_search_console')
    const row = await this.store.getIntegration(organizationId, 'google_search_console')
    const property = (row?.property_or_location as string | null) ?? null

    if (missing.length > 0) {
      return {
        provider: 'google_search_console',
        status: 'unconfigured',
        missingEnvVars: missing,
        message:
          `Cannot sync Google Search Console: missing ${missing.join(', ')}. ` +
          `The rest of the AI Authority Engine continues to operate on collected data.`,
      }
    }
    if (!property) {
      return {
        provider: 'google_search_console',
        status: 'configured',
        missingEnvVars: [],
        message:
          'Credentials are present but no verified property is configured. Set ' +
          'authority_integrations.property_or_location (for example "sc-domain:example.com").',
      }
    }
    return {
      provider: 'google_search_console',
      status: (row?.status as IntegrationStatus['status']) ?? 'connected',
      missingEnvVars: [],
      message: `Configured for property ${property}.`,
    }
  }

  /**
   * Sync a date window. Returns a summary rather than throwing for the common
   * "not configured" case, so a scheduled job records an honest skip.
   */
  async sync(params: {
    organizationId: string
    days?: number
    startDate?: string
    endDate?: string
  }): Promise<{ synced: boolean; rows: number; reason?: string }> {
    const organizationId = params.organizationId
    const row = await this.store.getIntegration(organizationId, 'google_search_console')
    const property = (row?.property_or_location as string | null) ?? null
    const credentials = credentialsFor('google_search_console')

    if (!credentials || !property) {
      const status = await this.status(organizationId)
      await this.store.updateIntegration(organizationId, 'google_search_console', {
        status: 'unconfigured',
        last_error: status.message,
      })
      return { synced: false, rows: 0, reason: status.message }
    }

    const end = params.endDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const start =
      params.startDate ??
      new Date(Date.now() - (params.days ?? 7) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    try {
      const accessToken = await fetchAccessToken(credentials)
      const rows = await fetchSearchAnalytics({
        accessToken,
        siteUrl: property,
        startDate: start,
        endDate: end,
      })

      let written = 0
      for (const rowData of rows) {
        const ok = await this.store.upsertSearchMetric({
          organization_id: organizationId,
          provider: 'google_search_console',
          metric_date: rowData.date || start,
          query_text: rowData.query.slice(0, 500),
          page_url: rowData.page,
          country: rowData.country ?? 'unknown',
          device: rowData.device ?? 'unknown',
          clicks: rowData.clicks,
          impressions: rowData.impressions,
          ctr: rowData.ctr,
          position: rowData.position,
        })
        if (ok) written += 1
      }

      await this.store.updateIntegration(organizationId, 'google_search_console', {
        status: 'connected',
        last_sync_at: new Date().toISOString(),
        last_error: null,
      })

      await this.store.logAudit({
        organizationId,
        userId: null,
        action: 'ai_authority.search_console_synced',
        resource: 'authority_integration:google_search_console',
        details: `Synced ${written} row(s) for ${start}..${end}`,
        metadata: { start, end, rows: written },
      })

      return { synced: true, rows: written }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.updateIntegration(organizationId, 'google_search_console', {
        status: 'error',
        last_error: message.slice(0, 500),
      })
      return { synced: false, rows: 0, reason: message }
    }
  }
}

export interface GbpMetricRow {
  date: string
  locationRef: string
  impressionsSearch: number | null
  impressionsMaps: number | null
  websiteClicks: number | null
  phoneCalls: number | null
  directionRequests: number | null
  conversations: number | null
  bookings: number | null
  raw: Record<string, unknown>
}

/**
 * Fetch GBP performance metrics.
 *
 * The Business Profile Performance API requires the location's
 * `locationReference`. We use the documented daily-metrics endpoint with the
 * metric set the API supports. NOTE: the API does not expose review text; only
 * aggregate review counts and ratings, which is all this adapter attempts.
 */
export async function fetchGbpMetrics(params: {
  accessToken: string
  locationRef: string
  startDate: string
  endDate: string
}): Promise<GbpMetricRow[]> {
  const metrics = [
    'WEBSITE_CLICKS',
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_CONVERSATIONS',
    'BUSINESS_BOOKINGS',
  ]

  const url = new URL(
    `https://businessprofileperformance.googleapis.com/v1/locations/${encodeURIComponent(params.locationRef)}:fetchMultiDailyMetricsTimeSeries`
  )
  for (const metric of metrics) url.searchParams.append('dailyMetrics', metric)
  url.searchParams.set('dailyRange.start_date.year', params.startDate.slice(0, 4))
  url.searchParams.set('dailyRange.start_date.month', String(Number(params.startDate.slice(5, 7))))
  url.searchParams.set('dailyRange.start_date.day', String(Number(params.startDate.slice(8, 10))))
  url.searchParams.set('dailyRange.end_date.year', params.endDate.slice(0, 4))
  url.searchParams.set('dailyRange.end_date.month', String(Number(params.endDate.slice(5, 7))))
  url.searchParams.set('dailyRange.end_date.day', String(Number(params.endDate.slice(8, 10))))

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`GBP metrics query failed (HTTP ${response.status}): ${truncate(raw, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GBP returned non-JSON body')
  }

  const series = (parsed as { multiDailyMetricTimeSeries?: unknown[] }).multiDailyMetricTimeSeries ?? []
  const byDate = new Map<string, GbpMetricRow>()

  for (const entry of series) {
    const wrapper = (entry ?? {}) as Record<string, unknown>
    const daily = (wrapper.dailyMetricTimeSeries ?? {}) as Record<string, unknown>
    const metric = String(daily.dailyMetric ?? '')
    const values = Array.isArray(daily.timeSeries)
      ? (daily.timeSeries as unknown[])
      : []

    for (const valueEntry of values) {
      const v = (valueEntry ?? {}) as Record<string, unknown>
      const dateObj = (v.date ?? {}) as Record<string, unknown>
      const date = `${String(dateObj.year).padStart(4, '0')}-${String(dateObj.month).padStart(2, '0')}-${String(
        dateObj.day
      ).padStart(2, '0')}`
      const value = toNumber(v.value)

      const row =
        byDate.get(date) ??
        ({
          date,
          locationRef: params.locationRef,
          impressionsSearch: null,
          impressionsMaps: null,
          websiteClicks: null,
          phoneCalls: null,
          directionRequests: null,
          conversations: null,
          bookings: null,
          raw: {},
        } as GbpMetricRow)

      if (metric.includes('SEARCH')) {
        row.impressionsSearch = (row.impressionsSearch ?? 0) + (value ?? 0)
      } else if (metric.includes('MAPS')) {
        row.impressionsMaps = (row.impressionsMaps ?? 0) + (value ?? 0)
      } else if (metric === 'WEBSITE_CLICKS') {
        row.websiteClicks = value
      } else if (metric === 'CALL_CLICKS') {
        row.phoneCalls = value
      } else if (metric === 'BUSINESS_DIRECTION_REQUESTS') {
        row.directionRequests = value
      } else if (metric === 'BUSINESS_CONVERSATIONS') {
        row.conversations = value
      } else if (metric === 'BUSINESS_BOOKINGS') {
        row.bookings = value
      }

      row.raw[metric] = value
      byDate.set(date, row)
    }
  }

  return [...byDate.values()]
}

export class GoogleBusinessProfileIntegration {
  private store: AuthorityStore

  constructor(supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
  }

  async status(organizationId: string): Promise<IntegrationStatus> {
    const missing = missingCredentialEnvVars('google_business_profile')
    const row = await this.store.getIntegration(organizationId, 'google_business_profile')
    const location = (row?.property_or_location as string | null) ?? null

    if (missing.length > 0) {
      return {
        provider: 'google_business_profile',
        status: 'unconfigured',
        missingEnvVars: missing,
        message:
          `Cannot sync Google Business Profile: missing ${missing.join(', ')}. ` +
          `Profile information is NOT modified automatically, with or without credentials.`,
      }
    }
    if (!location) {
      return {
        provider: 'google_business_profile',
        status: 'configured',
        missingEnvVars: [],
        message:
          'Credentials are present but no location reference is configured. Set ' +
          'authority_integrations.property_or_location to the GBP location id.',
      }
    }
    return {
      provider: 'google_business_profile',
      status: (row?.status as IntegrationStatus['status']) ?? 'connected',
      missingEnvVars: [],
      message: `Configured for location ${location}.`,
    }
  }

  /**
   * Sync GBP metrics.
   *
   * READ-ONLY by design. No method in this class ever writes to the profile;
   * changing GBP information requires explicit human approval (RED class) and is
   * not automated anywhere in this subsystem.
   */
  async sync(params: {
    organizationId: string
    days?: number
    startDate?: string
    endDate?: string
  }): Promise<{ synced: boolean; rows: number; reason?: string }> {
    const organizationId = params.organizationId
    const row = await this.store.getIntegration(organizationId, 'google_business_profile')
    const location = (row?.property_or_location as string | null) ?? null
    const credentials = credentialsFor('google_business_profile')

    if (!credentials || !location) {
      const status = await this.status(organizationId)
      await this.store.updateIntegration(organizationId, 'google_business_profile', {
        status: 'unconfigured',
        last_error: status.message,
      })
      return { synced: false, rows: 0, reason: status.message }
    }

    const end = params.endDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const start =
      params.startDate ??
      new Date(Date.now() - (params.days ?? 7) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    try {
      const accessToken = await fetchAccessToken(credentials)
      const metrics = await fetchGbpMetrics({
        accessToken,
        locationRef: location,
        startDate: start,
        endDate: end,
      })

      let written = 0
      for (const metric of metrics) {
        const ok = await this.store.upsertGbpMetric({
          organization_id: organizationId,
          metric_date: metric.date,
          location_ref: metric.locationRef,
          impressions_search: metric.impressionsSearch,
          impressions_maps: metric.impressionsMaps,
          website_clicks: metric.websiteClicks,
          phone_calls: metric.phoneCalls,
          direction_requests: metric.directionRequests,
          conversations: metric.conversations,
          bookings: metric.bookings,
          raw: metric.raw,
        })
        if (ok) written += 1
      }

      await this.store.updateIntegration(organizationId, 'google_business_profile', {
        status: 'connected',
        last_sync_at: new Date().toISOString(),
        last_error: null,
      })

      await this.store.logAudit({
        organizationId,
        userId: null,
        action: 'ai_authority.gbp_synced',
        resource: 'authority_integration:google_business_profile',
        details: `Synced ${written} day(s) of GBP metrics for ${start}..${end}`,
        metadata: { start, end, rows: written },
      })

      return { synced: true, rows: written }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.updateIntegration(organizationId, 'google_business_profile', {
        status: 'error',
        last_error: message.slice(0, 500),
      })
      return { synced: false, rows: 0, reason: message }
    }
  }
}

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------

export interface Ga4MetricRow {
  date: string
  sessions: number | null
  totalUsers: number | null
  newUsers: number | null
  engagedSessions: number | null
  engagementRate: number | null
  screenPageViews: number | null
  averageSessionDuration: number | null
  conversions: number | null
  conversionsAvailable: boolean
  raw: Record<string, unknown>
}

/** Metric name -> output key. Absent metrics stay null, never zero. */
const GA4_METRICS: Array<{ api: string; key: keyof Ga4MetricRow }> = [
  { api: 'sessions', key: 'sessions' },
  { api: 'totalUsers', key: 'totalUsers' },
  { api: 'newUsers', key: 'newUsers' },
  { api: 'engagedSessions', key: 'engagedSessions' },
  { api: 'engagementRate', key: 'engagementRate' },
  { api: 'screenPageViews', key: 'screenPageViews' },
  { api: 'averageSessionDuration', key: 'averageSessionDuration' },
  { api: 'conversions', key: 'conversions' },
]

/**
 * Query the GA4 Data API (runReport) for daily property metrics.
 *
 * Read-only. The API returns rows keyed by the requested dimensions/metrics;
 * a metric that the property cannot report is simply absent from the response,
 * and we preserve that as null rather than inventing a zero.
 */
export async function fetchGa4Metrics(params: {
  accessToken: string
  propertyId: string
  startDate: string
  endDate: string
}): Promise<Ga4MetricRow[]> {
  const property = params.propertyId.startsWith('properties/')
    ? params.propertyId
    : `properties/${params.propertyId}`
  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
      dimensions: [{ name: 'date' }],
      metrics: GA4_METRICS.map((m) => ({ name: m.api })),
    }),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`GA4 runReport failed (HTTP ${response.status}): ${truncate(raw, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GA4 returned non-JSON body')
  }

  const body = (parsed ?? {}) as { rows?: unknown[] }
  const rows = Array.isArray(body.rows) ? body.rows : []

  return rows.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const dimensionValues = Array.isArray(row.dimensionValues) ? (row.dimensionValues as unknown[]) : []
    const metricValues = Array.isArray(row.metricValues) ? (row.metricValues as unknown[]) : []

    const rawDate = valueOf(dimensionValues[0])
    const result: Ga4MetricRow = {
      date: normalizeGa4Date(rawDate),
      sessions: null,
      totalUsers: null,
      newUsers: null,
      engagedSessions: null,
      engagementRate: null,
      screenPageViews: null,
      averageSessionDuration: null,
      conversions: null,
      conversionsAvailable: false,
      raw: row,
    }

    GA4_METRICS.forEach((metric, index) => {
      const value = ga4Number(valueOf(metricValues[index]))
      if (value === null) return
      const key = metric.key
      if (key === 'conversions') result.conversions = Math.round(value)
      else if (key === 'date' || key === 'raw' || key === 'conversionsAvailable') return
      else result[key] = value
    })
    result.conversionsAvailable = result.conversions !== null
    return result
  })
}

export class GoogleAnalyticsIntegration {
  private store: AuthorityStore

  constructor(supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
  }

  async status(organizationId: string): Promise<IntegrationStatus> {
    const missing = missingCredentialEnvVars('google_analytics_4')
    const row = await this.store.getIntegration(organizationId, 'google_analytics_4')
    const property = (row?.property_or_location as string | null) ?? null

    if (missing.length > 0) {
      return {
        provider: 'google_analytics_4',
        status: 'unconfigured',
        missingEnvVars: missing,
        message:
          `Cannot sync Google Analytics 4: missing ${missing.join(', ')}. ` +
          `Traffic metrics are reported as unavailable, never estimated.`,
      }
    }
    if (!property) {
      return {
        provider: 'google_analytics_4',
        status: 'configured',
        missingEnvVars: [],
        message:
          'Credentials are present but no GA4 property is configured. Set ' +
          'authority_integrations.property_or_location to the numeric property id.',
      }
    }
    return {
      provider: 'google_analytics_4',
      status: (row?.status as IntegrationStatus['status']) ?? 'connected',
      missingEnvVars: [],
      message: `Configured for GA4 property ${property}.`,
    }
  }

  /**
   * Sync a date window of GA4 metrics.
   *
   * Returns a summary instead of throwing for the common "not configured" case
   * so a scheduled job records an honest skip rather than a retry storm.
   */
  async sync(params: {
    organizationId: string
    days?: number
    startDate?: string
    endDate?: string
  }): Promise<{ synced: boolean; rows: number; reason?: string }> {
    const organizationId = params.organizationId
    const row = await this.store.getIntegration(organizationId, 'google_analytics_4')
    const property = (row?.property_or_location as string | null) ?? null
    const credentials = credentialsFor('google_analytics_4')

    if (!credentials || !property) {
      const status = await this.status(organizationId)
      await this.store.updateIntegration(organizationId, 'google_analytics_4', {
        status: 'unconfigured',
        last_error: status.message,
      })
      return { synced: false, rows: 0, reason: status.message }
    }

    const end = params.endDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const start =
      params.startDate ??
      new Date(Date.now() - (params.days ?? 7) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    try {
      const accessToken = await fetchAccessToken(credentials)
      const metrics = await fetchGa4Metrics({
        accessToken,
        propertyId: property,
        startDate: start,
        endDate: end,
      })

      let written = 0
      for (const metric of metrics) {
        const ok = await this.store.upsertGa4Metric({
          organization_id: organizationId,
          property_id: property,
          metric_date: metric.date || start,
          sessions: metric.sessions,
          total_users: metric.totalUsers,
          new_users: metric.newUsers,
          engaged_sessions: metric.engagedSessions,
          engagement_rate: metric.engagementRate,
          screen_page_views: metric.screenPageViews,
          average_session_duration: metric.averageSessionDuration,
          conversions: metric.conversions,
          conversions_available: metric.conversionsAvailable,
          raw: metric.raw,
        })
        if (ok) written += 1
      }

      await this.store.updateIntegration(organizationId, 'google_analytics_4', {
        status: 'connected',
        last_sync_at: new Date().toISOString(),
        last_error: null,
      })

      await this.store.logAudit({
        organizationId,
        userId: null,
        action: 'ai_authority.ga4_synced',
        resource: 'authority_integration:google_analytics_4',
        details: `Synced ${written} day(s) of GA4 metrics for ${start}..${end}`,
        metadata: { start, end, rows: written },
      })

      return { synced: true, rows: written }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.updateIntegration(organizationId, 'google_analytics_4', {
        status: 'error',
        last_error: message.slice(0, 500),
      })
      return { synced: false, rows: 0, reason: message }
    }
  }
}

function valueOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const obj = value as Record<string, unknown>
  const raw = typeof obj === 'object' && 'value' in obj ? obj.value : value
  return raw === null || raw === undefined ? null : String(raw)
}

/** GA4 returns dates as YYYYMMDD; normalise to YYYY-MM-DD for the DATE column. */
function normalizeGa4Date(value: string | null): string {
  if (!value) return ''
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  return value
}

/**
 * Parse a GA4 metric value.
 *
 * Distinct from toNumber because `Number(null) === 0` would turn a metric the
 * property never reported into a real zero. An absent value must stay null.
 */
function ga4Number(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}