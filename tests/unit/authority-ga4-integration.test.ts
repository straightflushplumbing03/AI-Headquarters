/**
 * AI Authority Engine -- Google Analytics 4 adapter tests.
 *
 * The GA4 adapter must never invent a number. A metric the property cannot
 * report stays null (reported as "unavailable"), never zero, and a missing
 * credential leaves the integration `unconfigured` rather than faking a sync.
 * These tests pin that honest-evidence contract plus the transport parsing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchGa4Metrics,
  missingCredentialEnvVars,
  credentialsFor,
} from '@/lib/authority/integrations'

const ENV_VARS = [
  'GOOGLE_ANALYTICS_CLIENT_ID',
  'GOOGLE_ANALYTICS_CLIENT_SECRET',
  'GOOGLE_ANALYTICS_REFRESH_TOKEN',
] as const

function clearGa4Env() {
  for (const name of ENV_VARS) delete process.env[name]
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return fn
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearGa4Env()
})

describe('GA4 credential gating', () => {
  it('reports every missing env var when nothing is configured', () => {
    clearGa4Env()
    expect(missingCredentialEnvVars('google_analytics_4')).toEqual([...ENV_VARS])
    expect(credentialsFor('google_analytics_4')).toBeNull()
  })

  it('returns credentials only when all three vars are present', () => {
    clearGa4Env()
    process.env.GOOGLE_ANALYTICS_CLIENT_ID = 'id'
    process.env.GOOGLE_ANALYTICS_CLIENT_SECRET = 'secret'
    expect(credentialsFor('google_analytics_4')).toBeNull()
    process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN = 'refresh'
    expect(credentialsFor('google_analytics_4')).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'refresh',
    })
  })
})

describe('fetchGa4Metrics transport', () => {
  it('normalises YYYYMMDD dates and reads each metric', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({
        rows: [
          {
            dimensionValues: [{ value: '20260901' }],
            metricValues: [
              { value: '120' }, // sessions
              { value: '90' }, // totalUsers
              { value: '40' }, // newUsers
              { value: '75' }, // engagedSessions
              { value: '0.625' }, // engagementRate
              { value: '300' }, // screenPageViews
              { value: '88.5' }, // averageSessionDuration
              { value: '3' }, // conversions
            ],
          },
        ],
      })
    )

    const rows = await fetchGa4Metrics({
      accessToken: 'token',
      propertyId: '123456789',
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-09-01')
    expect(rows[0].sessions).toBe(120)
    expect(rows[0].engagementRate).toBeCloseTo(0.625)
    expect(rows[0].conversions).toBe(3)
    expect(rows[0].conversionsAvailable).toBe(true)

    // The numeric property id is expanded to the API's `properties/N` form.
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('properties/123456789:runReport')
  })

  it('preserves a metric the API omitted as null, never zero', async () => {
    mockFetch(async () =>
      jsonResponse({
        rows: [
          {
            dimensionValues: [{ value: '20260902' }],
            metricValues: [{ value: '10' }], // only sessions reported
          },
        ],
      })
    )

    const rows = await fetchGa4Metrics({
      accessToken: 'token',
      propertyId: 'properties/999',
      startDate: '2026-09-02',
      endDate: '2026-09-02',
    })

    expect(rows[0].sessions).toBe(10)
    expect(rows[0].totalUsers).toBeNull()
    expect(rows[0].conversions).toBeNull()
    expect(rows[0].conversionsAvailable).toBe(false)
  })

  it('returns an empty array when the property has no rows', async () => {
    mockFetch(async () => jsonResponse({}))
    const rows = await fetchGa4Metrics({
      accessToken: 'token',
      propertyId: '555',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    })
    expect(rows).toEqual([])
  })

  it('throws with the HTTP status on an API error', async () => {
    mockFetch(async () => jsonResponse({ error: { message: 'permission denied' } }, 403))
    await expect(
      fetchGa4Metrics({
        accessToken: 'token',
        propertyId: '555',
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      })
    ).rejects.toThrow(/HTTP 403/)
  })

  it('throws on a non-JSON body', async () => {
    mockFetch(async () => ({ ok: true, status: 200, text: async () => '<html>oops</html>' }))
    await expect(
      fetchGa4Metrics({
        accessToken: 'token',
        propertyId: '555',
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      })
    ).rejects.toThrow(/non-JSON/)
  })
})
