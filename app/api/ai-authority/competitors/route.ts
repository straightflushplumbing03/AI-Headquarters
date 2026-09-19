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
 * GET /api/ai-authority/competitors
 *
 * Competitor cards: who appears in answers, with what services and cities, how
 * their observed presence is trending, and which sources they are cited from.
 *
 * No endpoint in this subsystem attacks, impersonates, or publishes anything
 * about a competitor. This is observation only.
 *
 * READ-ONLY.
 */
export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const store = new AuthorityStore(auth.supabase)
    const [competitors, snapshots, changes] = await Promise.all([
      store.listCompetitors(auth.organizationId),
      store.listCompetitorSnapshots(auth.organizationId, { limit: 500 }),
      store.listCompetitorChanges(auth.organizationId, 100),
    ])

    const cards = (competitors as Array<Record<string, unknown>>).map((competitor) => {
      const id = String(competitor.id)
      const own = snapshots
        .filter((s) => String((s as Record<string, unknown>).competitor_id) === id)
        .sort((a, b) =>
          String((b as Record<string, unknown>).snapshot_date).localeCompare(
            String((a as Record<string, unknown>).snapshot_date)
          )
        )
      const current = own[0] as Record<string, unknown> | undefined
      const previous = own[1] as Record<string, unknown> | undefined

      return {
        id,
        name: competitor.name,
        website: competitor.website,
        discoverySource: competitor.discovery_source,
        locations: competitor.locations ?? [],
        services: competitor.services ?? [],
        firstSeenAt: competitor.first_seen_at,
        lastSeenAt: competitor.last_seen_at,
        current: current
          ? {
              mentionCount: current.ai_mention_count,
              firstPositionCount: current.ai_first_position_count,
              citationCount: current.ai_citation_count,
              distinctSourceDomains: current.distinct_source_domains,
              internalShareOfVoice: current.internal_share_of_voice,
              topSourceDomains: current.top_source_domains,
              snapshotDate: current.snapshot_date,
            }
          : null,
        mentionDelta:
          current && previous
            ? Number(current.ai_mention_count) - Number(previous.ai_mention_count)
            : null,
        recentChanges: changes
          .filter((c) => String((c as Record<string, unknown>).competitor_id) === id)
          .slice(0, 5),
      }
    })

    return NextResponse.json({
      competitors: cards,
      metricDisclosure:
        'Each competitor’s share of voice is computed only over the answers THIS system collected. ' +
        'It is an internal metric and is not a market measurement.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'competitors')
  }
}
