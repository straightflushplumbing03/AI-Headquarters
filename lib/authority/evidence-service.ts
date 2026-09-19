/**
 * AI Authority Engine -- evidence and entity-graph services.
 *
 * THE MOST IMPORTANT RULE IN THIS FILE:
 * Nothing here invents a project, a review, a photo, or a customer. Evidence is
 * only ever imported from a real record or entered by a human. The permission
 * fields (`verification_status`, `publish_permission`,
 * `customer_permission_status`) default to the SAFE state, and nothing becomes
 * publishable without an explicit human decision.
 *
 * This is what separates "AI authority" from "AI content generation": the
 * system's job is to find and connect evidence that already exists, and to make
 * the gaps visible, not to fill gaps with plausible text.
 */

import type { EvidenceEntityType, EvidenceType } from './types'
import type { AuthorityStore } from './store'

export interface EvidenceGap {
  marketId: string
  locationName: string
  serviceName: string
  evidenceCount: number
  verifiedCount: number
  publishableCount: number
  hasPage: boolean
  gapSeverity: 'low' | 'medium' | 'high' | 'critical'
  summary: string
}

/**
 * Coverage of a market by its evidence, from already-fetched rows. Pure.
 *
 * Severity intentionally escalates with intent to act: a market with no page
 * AND no evidence is the most expensive gap to close but also the least
 * misleading, because it is obvious there is nothing there yet.
 */
export function assessEvidenceGaps(params: {
  markets: Array<{
    id: string
    location_name: string
    service_name: string
    primary_page_id: string | null
  }>
  evidence: Array<{
    market_id: string | null
    verification_status: string
    publish_permission: boolean
    evidence_type: string
  }>
}): EvidenceGap[] {
  const byMarket = new Map<string, { total: number; verified: number; publishable: number }>()

  for (const item of params.evidence) {
    if (!item.market_id) continue
    const bucket = byMarket.get(item.market_id) ?? { total: 0, verified: 0, publishable: 0 }
    bucket.total += 1
    if (item.verification_status === 'verified') bucket.verified += 1
    if (item.publish_permission && item.verification_status === 'verified') bucket.publishable += 1
    byMarket.set(item.market_id, bucket)
  }

  const gaps: EvidenceGap[] = []

  for (const market of params.markets) {
    const bucket = byMarket.get(market.id) ?? { total: 0, verified: 0, publishable: 0 }
    const hasPage = Boolean(market.primary_page_id)

    let severity: EvidenceGap['gapSeverity'] = 'low'
    if (bucket.total === 0) severity = hasPage ? 'high' : 'medium'
    else if (bucket.verified === 0) severity = 'high'
    else if (bucket.publishable === 0) severity = 'medium'

    if (severity === 'low') continue

    const summaryParts: string[] = []
    if (bucket.total === 0) summaryParts.push('no linked evidence at all')
    else {
      summaryParts.push(`${bucket.total} evidence item(s)`)
      if (bucket.verified === 0) summaryParts.push('none verified')
      else if (bucket.publishable === 0) summaryParts.push('none publishable')
    }
    if (!hasPage) summaryParts.push('no mapped page')

    gaps.push({
      marketId: market.id,
      locationName: market.location_name,
      serviceName: market.service_name,
      evidenceCount: bucket.total,
      verifiedCount: bucket.verified,
      publishableCount: bucket.publishable,
      hasPage,
      gapSeverity: severity,
      summary: `${market.location_name} / ${market.service_name}: ${summaryParts.join(', ')}.`,
    })
  }

  return gaps.sort((a, b) => severityRank(b.gapSeverity) - severityRank(a.gapSeverity))
}

function severityRank(severity: EvidenceGap['gapSeverity']): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity]
}

/**
 * Link evidence to an entity. Idempotent via the schema's unique constraint.
 */
export async function linkEvidence(params: {
  store: AuthorityStore
  organizationId: string
  evidenceId: string
  entityType: EvidenceEntityType
  entityId: string
  relation?: 'supports' | 'mentions' | 'illustrates' | 'documents' | 'contradicts'
}): Promise<boolean> {
  return params.store.linkEvidence({
    organization_id: params.organizationId,
    evidence_id: params.evidenceId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    relation: params.relation ?? 'supports',
  })
}

/**
 * Map a free-text evidence type from an external system onto the canonical
 * taxonomy. Unrecognized input becomes 'service_record' rather than being
 * dropped, so imported history is never silently lost.
 */
export function mapEvidenceType(raw: string | null | undefined): EvidenceType {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('slab')) return 'slab_leak'
  if (value.includes('reroute') || value.includes('water line') || value.includes('waterline')) {
    return 'water_line_reroute'
  }
  if (value.includes('repipe') || value.includes('re-pipe')) return 'repipe'
  if (value.includes('leak detection') || value.includes('detection')) return 'leak_detection'
  if (value.includes('review') || value.includes('testimonial')) return 'customer_review'
  if (value.includes('photo') || value.includes('image')) return 'photo'
  if (value.includes('video')) return 'video'
  if (value.includes('invoice')) return 'invoice'
  if (value.includes('estimate') || value.includes('quote')) return 'estimate'
  if (value.includes('before') || value.includes('after')) return 'before_after'
  if (value.includes('repair')) return 'plumbing_repair'
  if (value.includes('project') || value.includes('job') || value.includes('install')) {
    return 'completed_project'
  }
  return 'service_record'
}

/**
 * Determine whether an evidence item may be used to support published content.
 *
 * This is the single gate the content pipeline must consult. All three
 * conditions are required; none is optional and none can be defaulted.
 */
export function isPublishable(evidence: {
  verification_status: string
  publish_permission: boolean
  customer_permission_status: string
}): { publishable: boolean; reason?: string } {
  if (evidence.verification_status !== 'verified') {
    return { publishable: false, reason: 'Evidence has not been verified by a human.' }
  }
  if (!evidence.publish_permission) {
    return { publishable: false, reason: 'Publish permission has not been granted for this evidence.' }
  }
  if (evidence.customer_permission_status === 'denied') {
    return { publishable: false, reason: 'Customer has denied permission to use this evidence.' }
  }
  return { publishable: true }
}

export interface EvidenceImportRow {
  evidence_type: EvidenceType
  title: string
  description?: string | null
  location_id?: string | null
  service_id?: string | null
  market_id?: string | null
  occurred_on?: string | null
  city_text?: string | null
  neighborhood?: string | null
  material?: string | null
  problem?: string | null
  resolution?: string | null
  source: 'manual' | 'business_brain_project' | 'review_import' | 'invoice_import' | 'media_upload'
  source_record_id: string
  media_urls?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Import evidence records.
 *
 * Deliberately import-only: this function cannot create evidence from nothing,
 * and it always writes the safe permission defaults. Verification and publish
 * permission are set by a human through a separate, audited path.
 */
export async function importEvidence(params: {
  store: AuthorityStore
  organizationId: string
  rows: EvidenceImportRow[]
}): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of params.rows) {
    if (!row.title?.trim() || !row.source_record_id?.trim()) {
      skipped += 1
      errors.push(`skipped evidence with missing title or source_record_id`)
      continue
    }

    const ok = await params.store.insertEvidence({
      organization_id: params.organizationId,
      evidence_type: row.evidence_type,
      title: row.title.slice(0, 500),
      description: row.description ?? null,
      location_id: row.location_id ?? null,
      service_id: row.service_id ?? null,
      market_id: row.market_id ?? null,
      occurred_on: row.occurred_on ?? null,
      city_text: row.city_text ?? null,
      neighborhood: row.neighborhood ?? null,
      material: row.material ?? null,
      problem: row.problem ?? null,
      resolution: row.resolution ?? null,
      source: row.source,
      source_record_id: row.source_record_id,
      media_urls: row.media_urls ?? [],
      metadata: row.metadata ?? {},
      // SAFE DEFAULTS. Never anything else on import.
      customer_permission_status: 'unknown',
      publish_permission: false,
      verification_status: 'unverified',
    })

    if (ok) imported += 1
    else skipped += 1
  }

  return { imported, skipped, errors }
}