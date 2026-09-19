/**
 * GET /api/ai-authority/engines
 *
 * Per-engine monitoring state: whether the adapter is supported in this build,
 * whether credentials are present, model, last run, and last error.
 *
 * This endpoint is the honest answer to "which AI engines are we actually
 * monitoring?". Capability is recomputed from the live process environment, so
 * adding or removing a credential changes the answer without a redeploy.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'
import { EngineAdapterRegistry } from '@/lib/authority/adapters/base'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const store = new AuthorityStore(auth.supabase)
    const engines = await store.listEngines(auth.organizationId)

    const [runs, responses] = await Promise.all([
      store.listRecentRuns(auth.organizationId, { limit: 500 }),
      store.listResponses(auth.organizationId, { limit: 500 }),
    ])

    const view = engines.map((engine) => {
      const adapter = EngineAdapterRegistry.get(engine.key)
      const capability = adapter ? adapter.capability() : engine.capability
      const engineRuns = runs.filter((r) => r.engine_id === engine.id)
      const engineResponses = responses.filter((r) => r.engine_id === engine.id)

      const completed = engineRuns.filter((r) => r.status === 'completed').length
      const skipped = engineRuns.filter((r) => r.status === 'skipped').length
      const failed = engineRuns.filter((r) => r.status === 'failed').length

      const mentioned = engineResponses.filter((r) => r.straight_flush_mentioned).length
      const firstMentioned = engineResponses.filter((r) => r.straight_flush_position === 1).length
      const cited = engineResponses.filter((r) => r.straight_flush_cited).length

      const sourceDomains = new Set(
        engineResponses.flatMap((r) => {
          const claims = r.factual_claims as { sourceDomains?: unknown } | null
          const domains = claims?.sourceDomains
          return Array.isArray(domains) ? domains.map(String) : []
        })
      )

      return {
        key: engine.key,
        displayName: engine.display_name,
        vendor: engine.vendor,
        capability,
        credentialEnvVar: engine.credential_env_var,
        model: adapter?.model() ?? engine.default_model,
        enabled: engine.enabled,
        lastQueryAt: engine.last_query_at,
        lastError: engine.last_error,
        stats: {
          runsAttempted: engineRuns.length,
          completed,
          skipped,
          failed,
          responsesCollected: engineResponses.length,
          mentionRate: rate(mentioned, engineResponses.length),
          firstMentionRate: rate(firstMentioned, engineResponses.length),
          citationRate: rate(cited, engineResponses.length),
          distinctSourceDomains: sourceDomains.size,
        },
      }
    })

    return NextResponse.json({
      engines: view,
      metricDisclosure:
        'Rates are Business Brain internal metrics over answers this system collected. They are ' +
        'not, and do not represent, any AI platform ranking formula.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'engines')
  }
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return Math.round((numerator / denominator) * 10000) / 100
}