import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/ai-authority/services
 *
 * Service authority view: for each tracked service, its coverage across cities,
 * its internal visibility, evidence support, and citation posture.
 *
 * READ-ONLY.
 */
export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const store = new AuthorityStore(auth.supabase)
    const [services, markets, scores, evidence] = await Promise.all([
      store.listServices(auth.organizationId),
      store.listMarkets(auth.organizationId),
      store.listLatestScores(auth.organizationId, 1000),
      store.listEvidence(auth.organizationId, { limit: 5000 }),
    ])

    // Latest score per market.
    const latestByMarket = new Map<string, Record<string, unknown>>()
    for (const score of scores) {
      const marketId = String(score.market_id)
      const existing = latestByMarket.get(marketId)
      if (!existing || String(score.measured_at) > String(existing.measured_at)) {
        latestByMarket.set(marketId, score)
      }
    }

    const view = services.map((service) => {
      const serviceMarkets = markets.filter((m) => m.service_id === service.id)
      const marketScores = serviceMarkets
        .map((m) => latestByMarket.get(m.id))
        .filter((s): s is Record<string, unknown> => Boolean(s))

      const visibilityValues = marketScores
        .map((s) => Number(s.internal_visibility_score))
        .filter((n) => Number.isFinite(n))

      const serviceEvidence = evidence.filter((e) => e.service_id === service.id)

      return {
        serviceId: service.id,
        name: service.name,
        tier: service.tier,
        customerValueEstimate: service.customer_value_estimate ?? null,
        citiesTracked: serviceMarkets.length,
        citiesMeasured: marketScores.length,
        averageInternalVisibility:
          visibilityValues.length > 0
            ? Math.round((visibilityValues.reduce((a, b) => a + b, 0) / visibilityValues.length) * 100) / 100
            : null,
        markets: serviceMarkets.map((m) => {
          const score = latestByMarket.get(m.id)
          return {
            marketId: m.id,
            locationName: m.location_name,
            internalVisibilityScore: score ? Number(score.internal_visibility_score) : null,
            evidenceCount: evidence.filter((e) => e.market_id === m.id).length,
            hasPage: Boolean(m.primary_page_id),
          }
        }),
        evidenceTotal: serviceEvidence.length,
        evidencePublished: serviceEvidence.filter(
          (e) => e.publish_permission === true && e.verification_status === 'verified'
        ).length,
      }
    })

    return NextResponse.json({
      services: view,
      metricDisclosure:
        'Internal visibility is a Business Brain metric computed from answers this system collected, ' +
        'not an AI platform ranking.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'services')
  }
}
