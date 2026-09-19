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
 * GET /api/ai-authority/citations
 *
 * Citation intelligence: the profile of which domains and source types are
 * being cited, plus the identified gaps.
 *
 * The gap analysis is advisory. The recommended_approach field deliberately
 * frames every gap as an ELIGIBILITY question, never as a link-acquisition
 * instruction, because purchasing links or mass-submitting to directories is
 * prohibited by this system's guardrails.
 *
 * READ-ONLY.
 */
export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const marketId = url.searchParams.get('marketId') ?? undefined
    const store = new AuthorityStore(auth.supabase)

    const citations = await store.listCitations(auth.organizationId, { limit: 5000, marketId })
    const sources = await store.listSources(auth.organizationId)

    // Group by domain so the view shows who is being cited, not raw rows.
    const byDomain = new Map<string, { domain: string; sourceType: string; firstParty: boolean; count: number }>()
    for (const citation of citations) {
      const key = citation.domain
      const existing = byDomain.get(key)
      if (existing) existing.count += 1
      else
        byDomain.set(key, {
          domain: key,
          sourceType: citation.source_type,
          firstParty: citation.is_first_party,
          count: 1,
        })
    }

    const firstPartyTotal = citations.filter((c) => c.is_first_party).length

    const { data: gaps } = await auth.supabase
      .from('authority_citation_gaps')
      .select('*')
      .eq('organization_id', auth.organizationId)
      .order('gap_severity', { ascending: false })
      .limit(200)

    return NextResponse.json({
      totalCitations: citations.length,
      firstPartyCitations: firstPartyTotal,
      thirdPartyCitations: citations.length - firstPartyTotal,
      firstPartyShare:
        citations.length > 0 ? Math.round((firstPartyTotal / citations.length) * 10000) / 100 : 0,
      domains: [...byDomain.values()].sort((a, b) => b.count - a.count),
      sources,
      gaps: gaps ?? [],
      policy:
        'Gap findings are opportunities to EVALUATE eligibility, not instructions to acquire links. ' +
        'Paid links, mass directory submission, and fabricated coverage are prohibited.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'citations')
  }
}
