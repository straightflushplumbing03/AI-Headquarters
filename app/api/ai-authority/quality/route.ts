/**
 * GET /api/ai-authority/quality
 *
 * Technical SEO and data-quality findings, plus the internal-link plan.
 *
 * Everything here is a FINDING or a RECOMMENDATION. Nothing in this subsystem
 * edits the production site: the crawler reads, the analyser reports, and a
 * human decides. Findings carry the evidence that produced them so they can be
 * checked rather than trusted.
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
  auditPageMetadata,
  findBrokenLinks,
  findDoorwayRisk,
  findOrphanPages,
  recommendInternalLinks,
  type LinkEdge,
  type PageForAudit,
} from '@/lib/authority/technical-seo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const marketId = url.searchParams.get('marketId') ?? undefined
    const store = new AuthorityStore(auth.supabase)

    const [pages, links, markets, issues] = await Promise.all([
      store.listPages(auth.organizationId, 2000),
      store.listPageLinks(auth.organizationId, 5000),
      store.listMarkets(auth.organizationId),
      store.listTechnicalIssues(auth.organizationId, { status: 'open', limit: 500 }),
    ])

    const marketByPageId = new Map(
      markets
        .filter((m) => m.primary_page_id)
        .map((m) => [String(m.primary_page_id), m])
    )

    const pagesForAudit: Array<PageForAudit & { locationName?: string | null }> = pages.map((p) => {
      const row = p as Record<string, unknown>
      const pageMarket = marketByPageId.get(String(row.id))
      return {
        url: String(row.url),
        status_code: (row.status_code as number | null) ?? null,
        title: (row.title as string | null) ?? null,
        meta_description: (row.meta_description as string | null) ?? null,
        h1: (row.h1 as string | null) ?? null,
        canonical_url: (row.canonical_url as string | null) ?? null,
        indexable: (row.indexable as boolean | null) ?? null,
        content_word_count: (row.content_word_count as number | null) ?? null,
        schema_types: (row.schema_types as string[] | null) ?? null,
        content_hash: (row.content_hash as string | null) ?? null,
        content_sample: (row.content_sample as string | null) ?? null,
        locationName: pageMarket?.location_name ?? null,
      }
    })

    const linkEdges: LinkEdge[] = links.map((l) => {
      const row = l as Record<string, unknown>
      return {
        from_url: String(row.from_url),
        to_url: String(row.to_url),
        anchor_text: (row.anchor_text as string | null) ?? null,
      }
    })

    const findings = [
      ...findBrokenLinks(pagesForAudit, linkEdges),
      ...auditPageMetadata(pagesForAudit),
      ...findOrphanPages(pagesForAudit, linkEdges),
      ...findDoorwayRisk(pagesForAudit),
    ]

    // Internal-link plan for one market, or for every market with a mapped page.
    const targets = marketId
      ? markets.filter((m) => m.id === marketId)
      : markets.filter((m) => m.primary_page_id)

    const linkPlan = targets.flatMap((market) => {
      const page = pages.find((p) => String((p as Record<string, unknown>).id) === market.primary_page_id)
      if (!page) return []
      const pageUrl = String((page as Record<string, unknown>).url)

      return recommendInternalLinks({
        marketPageUrl: pageUrl,
        locationName: market.location_name,
        serviceName: market.service_name,
        pages: pages.map((p) => {
          const row = p as Record<string, unknown>
          return {
            url: String(row.url),
            title: (row.title as string | null) ?? null,
            content_word_count: (row.content_word_count as number | null) ?? null,
          }
        }),
        existingLinks: linkEdges,
      }).map((rec) => ({
        marketId: market.id,
        locationName: market.location_name,
        serviceName: market.service_name,
        ...rec,
      }))
    })

    const bySeverity: Record<string, number> = {}
    for (const finding of findings) {
      bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1
    }

    return NextResponse.json({
      findings: findings.slice(0, 500),
      findingTotals: { total: findings.length, bySeverity },
      persistedIssues: issues,
      internalLinkPlan: linkPlan.slice(0, 200),
      doorwayPolicy:
        'City pages that are interchangeable with the city name swapped are prohibited. The ' +
        'doorway_page_risk finding measures similarity with the city name removed and flags pages that ' +
        'are effectively the same page.',
      mutationPolicy:
        'This endpoint NEVER modifies the website. Findings become recommendations; applying them goes ' +
        'through review and approval.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'quality')
  }
}