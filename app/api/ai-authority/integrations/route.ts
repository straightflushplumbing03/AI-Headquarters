/**
 * GET /api/ai-authority/integrations
 *
 * Honest integration status for every external data source, including the
 * credential environment variable names that are missing.
 *
 * There is no mock mode and no sample data path. An unconfigured integration
 * reports exactly that, and the rest of the engine continues on the data it has.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'
import {
  GoogleAnalyticsIntegration,
  GoogleBusinessProfileIntegration,
  SearchConsoleIntegration,
} from '@/lib/authority/integrations'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const store = new AuthorityStore(auth.supabase)
    const [rows, gsc, gbp, ga4, engines, latestMetrics] = await Promise.all([
      store.listIntegrations(auth.organizationId),
      new SearchConsoleIntegration(auth.supabase).status(auth.organizationId),
      new GoogleBusinessProfileIntegration(auth.supabase).status(auth.organizationId),
      new GoogleAnalyticsIntegration(auth.supabase).status(auth.organizationId),
      store.listEngines(auth.organizationId),
      loadLatestMetricDates(auth.supabase, auth.organizationId),
    ])

    return NextResponse.json({
      integrations: [
        {
          provider: 'google_search_console',
          displayName: 'Google Search Console',
          status: gsc.status,
          message: gsc.message,
          missingEnvVars: gsc.missingEnvVars,
          lastSyncAt:
            (rows.find((r) => r.provider === 'google_search_console')?.last_sync_at as string | null) ??
            null,
          latestMetricDate: latestMetrics.searchConsole,
          purpose:
            'Real search demand: queries, impressions, clicks and position, used to improve query ' +
            'generation and identify high-impression/low-click opportunities.',
        },
        {
          provider: 'google_business_profile',
          displayName: 'Google Business Profile',
          status: gbp.status,
          message: gbp.message,
          missingEnvVars: gbp.missingEnvVars,
          lastSyncAt:
            (rows.find((r) => r.provider === 'google_business_profile')?.last_sync_at as string | null) ??
            null,
          latestMetricDate: latestMetrics.gbp,
          purpose:
            'Local performance: impressions, calls, direction requests. Read-only. Profile information ' +
            'is never modified automatically.',
        },
        {
          provider: 'google_analytics_4',
          displayName: 'Google Analytics 4',
          status: ga4.status,
          message: ga4.message,
          missingEnvVars: ga4.missingEnvVars,
          lastSyncAt:
            (rows.find((r) => r.provider === 'google_analytics_4')?.last_sync_at as string | null) ??
            null,
          latestMetricDate: latestMetrics.ga4,
          purpose:
            'Site traffic and engagement: sessions, users, conversions. Read-only. Metrics the ' +
            'property cannot report are left null, never estimated.',
        },
        {
          provider: 'website',
          displayName: 'Website crawl',
          status: 'connected',
          message: 'The crawler is internal and needs no credential; it requires robots.txt compliance.',
          missingEnvVars: [],
          lastSyncAt: latestMetrics.crawl,
          latestMetricDate: latestMetrics.crawl,
          purpose: 'Page inventory, internal links, metadata, structured data, technical findings.',
        },
        {
          provider: 'ai_engines',
          displayName: 'AI search engines',
          status: engines.some((e) => e.capability === 'supported') ? 'connected' : 'unconfigured',
          message: `${engines.filter((e) => e.capability === 'supported').length} of ${
            engines.length
          } engines monitorable in this build.`,
          missingEnvVars: engines
            .filter((e) => e.capability !== 'supported' && e.credential_env_var)
            .flatMap((e) => (e.credential_env_var ? [e.credential_env_var] : [])),
          lastSyncAt: engines
            .map((e) => e.last_query_at)
            .filter((d): d is string => Boolean(d))
            .sort()
            .reverse()[0] ?? null,
          latestMetricDate: null,
          purpose:
            'Direct monitoring of AI answers. Only providers with an authorized API are monitored; ' +
            'surfaces with no authorized access report as unsupported rather than being approximated.',
        },
      ],
      policy:
        'No synthetic fallback data exists anywhere in this subsystem. An unavailable source reduces ' +
        'coverage and is reported as such; it is never simulated.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'integrations')
  }
}

async function loadLatestMetricDates(
  supabase: Awaited<ReturnType<typeof authenticateAuthorityRequest>> extends infer T
    ? T extends { supabase: infer S }
      ? S
      : never
    : never,
  organizationId: string
): Promise<{ searchConsole: string | null; gbp: string | null; ga4: string | null; crawl: string | null }> {
  const [gsc, gbp, ga4, crawl] = await Promise.all([
    supabase
      .from('authority_search_metrics')
      .select('metric_date')
      .eq('organization_id', organizationId)
      .order('metric_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('authority_gbp_metrics')
      .select('metric_date')
      .eq('organization_id', organizationId)
      .order('metric_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('authority_ga4_metrics')
      .select('metric_date')
      .eq('organization_id', organizationId)
      .order('metric_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('authority_crawl_runs')
      .select('started_at')
      .eq('organization_id', organizationId)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    searchConsole: (gsc.data as { metric_date?: string } | null)?.metric_date ?? null,
    gbp: (gbp.data as { metric_date?: string } | null)?.metric_date ?? null,
    ga4: (ga4.data as { metric_date?: string } | null)?.metric_date ?? null,
    crawl: (crawl.data as { started_at?: string } | null)?.started_at ?? null,
  }
}