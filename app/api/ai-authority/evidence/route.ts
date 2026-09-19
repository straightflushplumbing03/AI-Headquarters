/**
 * GET  /api/ai-authority/evidence  -- list first-party evidence and gaps
 * POST /api/ai-authority/evidence  -- import evidence records
 *
 * THE RULE THIS ENDPOINT ENFORCES:
 *
 * Evidence is IMPORTED, never invented. Every imported record carries safe
 * defaults -- `verification_status: unverified`, `publish_permission: false`,
 * `customer_permission_status: unknown` -- and there is deliberately NO field in
 * the request body that can set those. Verification and publish permission are
 * granted by a human through a separate, audited action, and nothing becomes
 * publishable without one.
 *
 * This is what stops the subsystem from becoming a content generator that
 * fabricates projects and reviews.
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
import { assessEvidenceGaps, importEvidence, type EvidenceImportRow } from '@/lib/authority/evidence-service'
import { mapEvidenceType } from '@/lib/authority/evidence-service'

export const dynamic = 'force-dynamic'

/** Fields a caller may NEVER set on import, regardless of what they send. */
const PROTECTED_EVIDENCE_FIELDS = [
  'verification_status',
  'publish_permission',
  'customer_permission_status',
  'verified_by',
  'verified_at',
] as const

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const marketId = url.searchParams.get('marketId') ?? undefined
    const store = new AuthorityStore(auth.supabase)

    const [evidence, markets] = await Promise.all([
      store.listEvidence(auth.organizationId, { marketId, limit: 500 }),
      store.listMarkets(auth.organizationId),
    ])

    const gaps = assessEvidenceGaps({
      markets: markets.map((m) => ({
        id: m.id,
        location_name: m.location_name,
        service_name: m.service_name,
        primary_page_id: m.primary_page_id,
      })),
      evidence: evidence.map((e) => ({
        market_id: (e.market_id as string | null) ?? null,
        verification_status: String(e.verification_status),
        publish_permission: Boolean(e.publish_permission),
        evidence_type: String(e.evidence_type),
      })),
    })

    return NextResponse.json({
      evidence,
      gaps,
      policy:
        'Evidence is imported from real records or entered by a human. The system never fabricates a ' +
        'project, review, or photo, and nothing is publishable until a human verifies it AND grants ' +
        'publish permission.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'evidence.list')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = organizationIdFromRequest(request, body)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    const rawRows = Array.isArray(body?.rows) ? body.rows : null
    if (!rawRows || rawRows.length === 0) {
      return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
    }
    if (rawRows.length > 500) {
      return NextResponse.json({ error: 'rows must contain at most 500 entries' }, { status: 400 })
    }

    const store = new AuthorityStore(auth.supabase)
    const markets = await store.listMarkets(auth.organizationId)

    const rows: EvidenceImportRow[] = []
    const rejected: string[] = []

    for (const raw of rawRows) {
      const row = (raw ?? {}) as Record<string, unknown>

      // Refuse rows that attempt to set a protected field. Silently dropping it
      // would hide an attempt to skip verification, so we reject the row and say
      // which field was refused.
      const attempted = PROTECTED_EVIDENCE_FIELDS.filter((field) => field in row)
      if (attempted.length > 0) {
        rejected.push(
          `row with title "${String(row.title ?? '(untitled)')}" attempted to set ${attempted.join(', ')}`
        )
        continue
      }

      const title = typeof row.title === 'string' ? row.title.trim() : ''
      const sourceRecordId = typeof row.sourceRecordId === 'string' ? row.sourceRecordId.trim() : ''
      if (!title || !sourceRecordId) {
        rejected.push('row missing title or sourceRecordId')
        continue
      }

      const marketId = typeof row.marketId === 'string' ? row.marketId : null
      const market = marketId ? markets.find((m) => m.id === marketId) : undefined

      rows.push({
        evidence_type: mapEvidenceType(
          typeof row.evidenceType === 'string' ? row.evidenceType : (row.title as string)
        ),
        title,
        description: typeof row.description === 'string' ? row.description : null,
        location_id: market?.location_id ?? (typeof row.locationId === 'string' ? row.locationId : null),
        service_id: market?.service_id ?? (typeof row.serviceId === 'string' ? row.serviceId : null),
        market_id: marketId,
        occurred_on: typeof row.occurredOn === 'string' ? row.occurredOn : null,
        city_text: typeof row.city === 'string' ? row.city : (market?.location_name ?? null),
        neighborhood: typeof row.neighborhood === 'string' ? row.neighborhood : null,
        material: typeof row.material === 'string' ? row.material : null,
        problem: typeof row.problem === 'string' ? row.problem : null,
        resolution: typeof row.resolution === 'string' ? row.resolution : null,
        source: 'manual',
        source_record_id: sourceRecordId,
        media_urls: Array.isArray(row.mediaUrls) ? row.mediaUrls.map(String).slice(0, 20) : [],
        metadata: typeof row.metadata === 'object' && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {},
      })
    }

    const result = await importEvidence({
      store,
      organizationId: auth.organizationId,
      rows,
    })

    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: 'ai_authority.evidence_imported',
      resource: 'authority_evidence',
      details: `Imported ${result.imported} evidence record(s); skipped ${result.skipped}`,
      metadata: { imported: result.imported, skipped: result.skipped, rejected },
    })

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      rejected,
      note:
        'Imported evidence is UNVERIFIED and NOT publishable. Verify it and grant publish permission ' +
        'through a separate audited action before it can support published content.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'evidence.import')
  }
}