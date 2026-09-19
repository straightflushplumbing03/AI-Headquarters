/**
 * GET /api/ai-authority/markets
 *
 * The city x service authority matrix, plus the per-market rollout tiers.
 * Optionally returns full detail for a single market via ?marketId=.
 *
 * READ-ONLY.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'
import { AuthorityOverviewService } from '@/lib/authority/orchestrator'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const marketId = url.searchParams.get('marketId')
    const service = new AuthorityOverviewService(auth.supabase)

    if (marketId) {
      const detail = await service.marketDetail(auth.organizationId, marketId)
      if (!detail) {
        return NextResponse.json({ error: 'Market not found' }, { status: 404 })
      }
      return NextResponse.json(detail)
    }

    const store = new AuthorityStore(auth.supabase)
    const [locations, services, markets] = await Promise.all([
      store.listLocations(auth.organizationId),
      store.listServices(auth.organizationId),
      store.listMarkets(auth.organizationId),
    ])

    // Group into the matrix, preserving each dimension's own ordering so the UI
    // does not have to guess at a layout.
    const matrix = locations.map((location) => ({
      locationId: location.id,
      locationName: location.name,
      tier: location.tier,
      services: services.map((svc) => {
        const market = markets.find(
          (m) => m.location_id === location.id && m.service_id === svc.id
        )
        return market
          ? {
              marketId: market.id,
              serviceId: svc.id,
              serviceName: svc.name,
              // Tier lives on the location/service dimension, not the market
              // join row, because expansion is decided per city or per service.
              tier: location.tier,
              active: market.active,
              hasPage: Boolean(market.primary_page_id),
            }
          : null
      }),
    }))

    return NextResponse.json({
      locations,
      services,
      markets,
      matrix,
      metricDisclosure:
        'Market membership reflects configured monitoring targets. Scores are Business Brain ' +
        'internal metrics and are not an AI platform ranking.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'markets')
  }
}