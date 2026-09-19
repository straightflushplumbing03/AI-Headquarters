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
 * GET /api/ai-authority/responses
 *
 * The AI Response Explorer. Without ?responseId= it lists recorded answers;
 * with it, returns the full observation: the verbatim answer, every business
 * named in order, every citation, and what the parser concluded.
 *
 * This endpoint is the transparency surface: it is how a human verifies that
 * the numbers on the dashboard came from real answers.
 *
 * READ-ONLY.
 */
export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const responseId = url.searchParams.get('responseId')
    const store = new AuthorityStore(auth.supabase)

    if (responseId) {
      const response = await store.getResponse(auth.organizationId, responseId)
      if (!response) return NextResponse.json({ error: 'Response not found' }, { status: 404 })

      const [mentions, citations, query, engines] = await Promise.all([
        store.listMentionsForResponse(responseId),
        store.listCitations(auth.organizationId, { limit: 500 }),
        store.listQueriesForMarket(auth.organizationId, response.market_id ?? '').catch(() => []),
        store.listEngines(auth.organizationId),
      ])

      return NextResponse.json({
        response,
        mentions,
        citations: citations.filter((c) => c.response_id === responseId),
        engine: engines.find((e) => e.id === response.engine_id) ?? null,
        query: query.find((q) => q.id === response.query_id) ?? null,
        note:
          'raw_response_text is verbatim provider output as received. The parser never rewrites ' +
          'the answer; parsing results are stored separately.',
      })
    }

    const marketId = url.searchParams.get('marketId') ?? undefined
    const engineId = url.searchParams.get('engineId') ?? undefined
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200)

    const responses = await store.listResponses(auth.organizationId, { limit, marketId, engineId })

    return NextResponse.json({
      responses: responses.map((r) => ({
        id: r.id,
        queryId: r.query_id,
        engineId: r.engine_id,
        engineKey: r.engine_key,
        model: r.model,
        marketId: r.market_id,
        capturedAt: r.captured_at,
        businessCount: r.business_count,
        mentioned: r.straight_flush_mentioned,
        position: r.straight_flush_position,
        cited: r.straight_flush_cited,
        parserVersion: r.parser_version,
        parseConfidence: r.parse_confidence,
        excerpt: r.raw_response_text.slice(0, 400),
      })),
      total: responses.length,
    })
  } catch (error) {
    return authorityErrorResponse(error, 'responses')
  }
}
