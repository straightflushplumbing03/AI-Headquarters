/**
 * GET   /api/ai-authority/settings  -- budget, pause state, integration config
 * PATCH /api/ai-authority/settings  -- configure the site origin, property, etc.
 *
 * Settings are intentionally narrow. In particular the endpoint can:
 *   - record the site origin to crawl
 *   - record the Search Console property and GBP location reference
 *   - pause or resume monitoring
 *
 * It CANNOT accept credentials. API keys and OAuth refresh tokens are read from
 * the server environment only, so a compromised session can never exfiltrate or
 * replace them through this API.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
  requireApprover,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'
import { AuthorityBudgetService } from '@/lib/authority/cost-control'
import {
  GoogleAnalyticsIntegration,
  GoogleBusinessProfileIntegration,
  SearchConsoleIntegration,
  missingCredentialEnvVars,
  type IntegrationProvider,
} from '@/lib/authority/integrations'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const store = new AuthorityStore(auth.supabase)
    const budgets = new AuthorityBudgetService(auth.supabase)

    const [budget, usage, integrations, engines] = await Promise.all([
      budgets.getBudget(auth.organizationId),
      budgets.getUsage(auth.organizationId),
      store.listIntegrations(auth.organizationId),
      store.listEngines(auth.organizationId),
    ])

    const globalPaused = await budgets.getGlobalPausedState()

    return NextResponse.json({
      budget,
      usage,
      role: auth.role,
      integrations: integrations.map((row) => {
        const provider = String(row.provider)
        const missing =
          provider === 'google_search_console' ||
          provider === 'google_business_profile' ||
          provider === 'google_analytics_4'
            ? missingCredentialEnvVars(provider as IntegrationProvider)
            : []
        return {
          provider,
          displayName: row.display_name,
          status: missing.length > 0 ? 'unconfigured' : row.status,
          propertyOrLocation: row.property_or_location ?? null,
          lastSyncAt: row.last_sync_at ?? null,
          lastError: row.last_error ?? null,
          missingEnvVars: missing,
        }
      }),
      engines: engines.map((engine) => ({
        key: engine.key,
        displayName: engine.display_name,
        credentialEnvVar: engine.credential_env_var,
        enabled: engine.enabled,
      })),
      killSwitches: {
        organizationPaused: budget.paused,
        globalPaused,
        globalPausedNote:
          globalPaused === null
            ? 'Not determinable with the current credentials. The authoritative global gate is ' +
              'claim_background_jobs(), which refuses to hand out any job while the switch is on.'
            : undefined,
      },
      credentialPolicy:
        'Credentials are read from the server environment only and can never be set through this API.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'settings.get')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = organizationIdFromRequest(request, body)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    // Reject any attempt to pass credentials through the API, loudly.
    const forbiddenKeys = Object.keys(body ?? {}).filter((key) =>
      /(secret|token|key|password|credential)/i.test(key) && key !== 'organizationId'
    )
    if (forbiddenKeys.length > 0) {
      return NextResponse.json(
        {
          error:
            'Credentials cannot be set through this API. Configure them as server environment ' +
            'variables and redeploy.',
          rejectedFields: forbiddenKeys,
        },
        { status: 400 }
      )
    }

    const store = new AuthorityStore(auth.supabase)
    const budgets = new AuthorityBudgetService(auth.supabase)
    const applied: string[] = []

    if (typeof body?.siteOrigin === 'string' && body.siteOrigin.length > 0) {
      await store.updateIntegration(auth.organizationId, 'website', {
        property_or_location: body.siteOrigin.slice(0, 500),
      })
      applied.push('siteOrigin')
    }

    for (const provider of [
      'google_search_console',
      'google_business_profile',
      'google_analytics_4',
    ] as const) {
      const value =
        body?.[
          provider === 'google_search_console'
            ? 'searchConsoleProperty'
            : provider === 'google_business_profile'
              ? 'gbpLocationRef'
              : 'ga4PropertyId'
        ]
      if (typeof value === 'string' && value.length > 0) {
        await store.updateIntegration(auth.organizationId, provider, {
          property_or_location: value.slice(0, 500),
        })
        applied.push(provider)
      }
    }

    if (typeof body?.paused === 'boolean') {
      const reason =
        typeof body?.pauseReason === 'string' ? body.pauseReason.slice(0, 500) : 'Paused by operator'
      await budgets.setPaused(auth.organizationId, body.paused, reason)
      applied.push('paused')
    }

    if (applied.length === 0) {
      return NextResponse.json({ error: 'No supported settings provided' }, { status: 400 })
    }

    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: 'ai_authority.settings_updated',
      resource: 'authority_settings',
      details: `Updated: ${applied.join(', ')}`,
      metadata: { applied },
    })

    // Report the resulting integration status honestly after the change.
    const [gsc, gbp, ga4] = await Promise.all([
      new SearchConsoleIntegration(auth.supabase).status(auth.organizationId),
      new GoogleBusinessProfileIntegration(auth.supabase).status(auth.organizationId),
      new GoogleAnalyticsIntegration(auth.supabase).status(auth.organizationId),
    ])

    return NextResponse.json({ success: true, applied, integrations: { gsc, gbp, ga4 } })
  } catch (error) {
    return authorityErrorResponse(error, 'settings.patch')
  }
}