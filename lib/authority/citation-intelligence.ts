/**
 * AI Authority Engine -- citation intelligence.
 *
 * Answers two questions the owner actually asks:
 *   "Where are we being cited from?"
 *   "Where are competitors being cited from that we are not?"
 *
 * Reading the second answer as "go buy links there" would be wrong and is
 * explicitly forbidden. The output is an OPPORTUNITY TO EVALUATE, and the
 * recommended approach is always a legitimate eligibility question ("could this
 * business genuinely appear on this kind of source?") rather than an acquisition
 * instruction.
 */

import { classifySourceDomain } from './response-parser'
import type { AuthorityStore } from './store'
import type { SourceType } from './types'

export interface CitationObservation {
  domain: string
  sourceType: SourceType
  isFirstParty: boolean
  citationCount: number
  competitorNames: string[]
  responseIds: string[]
}

export interface CitationGap {
  domain: string
  sourceType: SourceType
  competitorCitationCount: number
  subjectCitationCount: number
  gapSeverity: 'low' | 'medium' | 'high' | 'critical'
  gapType: 'missing_third_party' | 'citation_diversification' | 'lost_citation' | 'weak_source'
  assessment: string
  recommendedApproach: string
}

export interface CitationProfile {
  totalCitations: number
  distinctDomains: number
  firstPartyCitations: number
  thirdPartyCitations: number
  /** Share of citations coming from the business's own site, 0-100. */
  firstPartyShare: number
  bySourceType: Array<{ sourceType: SourceType; citations: number; domains: number }>
  observations: CitationObservation[]
}

/**
 * Build the citation profile for a market (or the whole organization) over a
 * window. Pure aggregation over rows the caller already fetched, so it is
 * testable without a database.
 */
export function buildCitationProfile(
  rows: Array<{
    domain: string
    source_type: string
    is_first_party: boolean
    response_id: string
    cited_business_name: string | null
  }>
): CitationProfile {
  const byDomain = new Map<string, CitationObservation>()
  const byType = new Map<SourceType, { citations: number; domains: Set<string> }>()

  let firstParty = 0
  let thirdParty = 0

  for (const row of rows) {
    const domain = (row.domain ?? '').toLowerCase()
    if (!domain) continue

    const sourceType = (row.source_type as SourceType) ?? 'other'
    const isFirstParty = Boolean(row.is_first_party)

    if (isFirstParty) firstParty += 1
    else thirdParty += 1

    const existing = byDomain.get(domain)
    if (existing) {
      existing.citationCount += 1
      if (!existing.responseIds.includes(row.response_id)) existing.responseIds.push(row.response_id)
      if (row.cited_business_name && !existing.competitorNames.includes(row.cited_business_name)) {
        existing.competitorNames.push(row.cited_business_name)
      }
    } else {
      byDomain.set(domain, {
        domain,
        sourceType,
        isFirstParty,
        citationCount: 1,
        competitorNames: row.cited_business_name ? [row.cited_business_name] : [],
        responseIds: [row.response_id],
      })
    }

    const typeBucket = byType.get(sourceType) ?? { citations: 0, domains: new Set<string>() }
    typeBucket.citations += 1
    typeBucket.domains.add(domain)
    byType.set(sourceType, typeBucket)
  }

  const total = firstParty + thirdParty

  return {
    totalCitations: total,
    distinctDomains: byDomain.size,
    firstPartyCitations: firstParty,
    thirdPartyCitations: thirdParty,
    firstPartyShare: total > 0 ? round2((firstParty / total) * 100) : 0,
    bySourceType: [...byType.entries()]
      .map(([sourceType, v]) => ({
        sourceType,
        citations: v.citations,
        domains: v.domains.size,
      }))
      .sort((a, b) => b.citations - a.citations),
    observations: [...byDomain.values()].sort((a, b) => b.citationCount - a.citationCount),
  }
}

/**
 * Identify gaps.
 *
 * The `citation_diversification` case is the important one for a business whose
 * AI presence currently rests almost entirely on its own website: that is
 * fragile, because a third party saying the same thing is stronger evidence
 * than the company saying it about itself.
 */
export function identifyCitationGaps(params: {
  profile: CitationProfile
  competitorDomains: string[]
  minCompetitorCitations?: number
  subjectDomains?: string[]
}): CitationGap[] {
  const minCompetitor = params.minCompetitorCitations ?? 2
  const subjectDomains = new Set(
    (params.subjectDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ''))
  )
  const competitorDomains = new Set(
    params.competitorDomains.map((d) => d.toLowerCase().replace(/^www\./, ''))
  )

  const gaps: CitationGap[] = []
  const citedByUs = new Set(params.profile.observations.map((o) => o.domain))

  // --- Gap A: third-party source types where competitors appear and we do not.
  const ourTypes = new Set(params.profile.observations.map((o) => o.sourceType))
  const thirdPartyTypes: SourceType[] = [
    'local_publication',
    'directory',
    'review_platform',
    'business_association',
    'trade_organization',
    'news',
    'community_site',
  ]

  for (const sourceType of thirdPartyTypes) {
    if (ourTypes.has(sourceType)) continue
    gaps.push({
      domain: `(no ${sourceType.replace(/_/g, ' ')} citations observed)`,
      sourceType,
      competitorCitationCount: minCompetitor,
      subjectCitationCount: 0,
      gapSeverity: sourceType === 'review_platform' || sourceType === 'directory' ? 'medium' : 'low',
      gapType: 'missing_third_party',
      assessment:
        `The business has no observed citations from ${sourceType.replace(/_/g, ' ')} sources, ` +
        `while these source types commonly influence local recommendation answers.`,
      recommendedApproach:
        `Identify whether the business is genuinely eligible to appear on ${sourceType.replace(/_/g, ' ')} ` +
        `sources (existing listings, memberships, real coverage). Only pursue opportunities the business ` +
        `actually qualifies for. No paid links and no mass submissions.`,
    })
  }

  // --- Gap B: diversification -- we rely too heavily on our own site.
  if (params.profile.distinctDomains > 0 && params.profile.firstPartyShare >= 60) {
    gaps.push({
      domain: '(first-party concentration)',
      sourceType: 'company_website',
      competitorCitationCount: 0,
      subjectCitationCount: params.profile.firstPartyCitations,
      gapSeverity: params.profile.firstPartyShare >= 80 ? 'high' : 'medium',
      gapType: 'citation_diversification',
      assessment:
        `${round2(params.profile.firstPartyShare)}% of observed citations point at the business's own ` +
        `site. Independent corroboration is currently weak, which limits how confidently an AI answer ` +
        `can recommend the business.`,
      recommendedApproach:
        `Prioritise legitimate third-party corroboration: accurate business profiles, genuine reviews, ` +
        `real project coverage in local or trade publications, and relevant association memberships. ` +
        `Do not purchase links or generate reviews.`,
    })
  }

  // --- Gap C: competitor-only domains.
  for (const observation of params.profile.observations) {
    if (!competitorDomains.has(observation.domain)) continue
    if (subjectDomains.has(observation.domain)) continue
    gaps.push({
      domain: observation.domain,
      sourceType: observation.sourceType,
      competitorCitationCount: observation.citationCount,
      subjectCitationCount: 0,
      gapSeverity: observation.citationCount >= 3 ? 'high' : 'low',
      gapType: 'weak_source',
      assessment:
        `${observation.domain} is cited alongside competitor content but never for this business.`,
      recommendedApproach:
        `Review whether this source legitimately covers this business's service area and service type. ` +
        `If so, determine the genuine eligibility path. Do not attempt to manipulate the source.`,
    })
  }

  // --- Gap D: competitor domains surfaced by the caller's watch list.
  for (const domain of competitorDomains) {
    if (citedByUs.has(domain)) continue
    const classification = classifySourceDomain(domain, [], [])
    gaps.push({
      domain,
      sourceType: classification.sourceType,
      competitorCitationCount: Math.max(minCompetitor, 1),
      subjectCitationCount: 0,
      gapSeverity: 'low',
      gapType: 'missing_third_party',
      assessment: `A tracked competitor domain appeared in monitoring but the subject did not.`,
      recommendedApproach:
        `No action against the competitor. Review only whether the business has comparable, truthful ` +
        `evidence it could publish on its own properties.`,
    })
  }

  return gaps
}

/**
 * Persist gap analysis. Idempotent per (org, market, source, gap_type, window).
 *
 * Rows are keyed on the domain TEXT rather than source_id, because some gaps
 * (such as first-party concentration) describe a pattern rather than a single
 * domain and therefore have no source row.
 */
export async function persistCitationGaps(params: {
  store: AuthorityStore
  organizationId: string
  marketId: string | null
  gaps: CitationGap[]
  windowDays: number
}): Promise<number> {
  const { store, organizationId, marketId, gaps, windowDays } = params
  if (gaps.length === 0) return 0

  let written = 0
  const measuredAt = new Date().toISOString()

  for (const gap of gaps) {
    const sourceId = gap.domain.startsWith('(')
      ? null
      : await store.upsertSource(organizationId, gap.domain, gap.sourceType, false)

    written += await store.upsertCitationGap({
      organization_id: organizationId,
      market_id: marketId,
      source_id: sourceId,
      domain: gap.domain,
      source_type: gap.sourceType,
      competitor_citation_count: gap.competitorCitationCount,
      subject_citation_count: gap.subjectCitationCount,
      gap_severity: gap.gapSeverity,
      gap_type: gap.gapType,
      assessment: gap.assessment.slice(0, 2000),
      recommended_approach: gap.recommendedApproach.slice(0, 2000),
      window_days: windowDays,
      measured_at: measuredAt,
    })
  }

  return written
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}