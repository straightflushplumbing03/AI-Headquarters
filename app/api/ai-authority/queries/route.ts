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
 * GET /api/ai-authority/queries
 *
 * The monitored question set, with how often each has been run and what the
 * most recent outcome was.
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
    const limit = clamp(Number(url.searchParams.get('limit') ?? 200), 1, 1000)

    const store = new AuthorityStore(auth.supabase)
    const queries = marketId
      ? await store.listQueriesForMarket(auth.organizationId, marketId)
      : await store.selectQueriesToRun(auth.organizationId, { limit })

    const responses = await store.listResponses(auth.organizationId, { limit: 2000 })
    const responseByQuery = new Map<string, typeof responses[number]>()
    for (const response of responses) {
      if (!responseByQuery.has(response.query_id)) responseByQuery.set(response.query_id, response)
    }

    return NextResponse.json({
      queries: queries.slice(0, limit).map((q) => {
        const latest = responseByQuery.get(q.id)
        return {
          id: q.id,
          rawText: q.raw_text,
          normalizedText: q.normalized_text,
          intent: q.intent,
          buyerStage: q.buyer_stage,
          marketId: q.market_id,
          importance: q.importance,
          runCount: q.run_count,
          lastRunAt: q.last_run_at,
          latest: latest
            ? {
                capturedAt: latest.captured_at,
                mentioned: latest.straight_flush_mentioned,
                position: latest.straight_flush_position,
                cited: latest.straight_flush_cited,
              }
            : null,
        }
      }),
      total: queries.length,
    })
  } catch (error) {
    return authorityErrorResponse(error, 'queries')
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}
