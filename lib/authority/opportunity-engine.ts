/**
 * AI Authority Engine -- opportunity scoring and prioritisation.
 *
 * The score is an INTERNAL PRIORITISATION HEURISTIC. It is not a ranking, and
 * it makes no claim about what any AI platform will do. What it does claim is
 * narrower and checkable: given the evidence we hold, which market most
 * deserves the next unit of effort.
 *
 * The model is multiplicative, so a near-zero factor suppresses the whole
 * opportunity. That is intentional: a market with plenty of visibility but no
 * evidence to publish is not an opportunity, it is a content-fabrication trap,
 * and the model should not push us toward it.
 *
 * Opportunity Score =
 *     visibility_gap
 *   x customer_value
 *   x competitive_opportunity
 *   x evidence_availability
 *   x probability_of_improvement
 *
 * Every factor is stored separately on the opportunity row, so the UI can show
 * each one and the system can explain why something was prioritised.
 */

import type {
  ApprovalClass,
  MarketMetrics,
  OpportunityCategory,
  OpportunityScoreComponents,
} from './types'

/** Normalize a 0-100 factor into a 0-1 multiplier. */
function factor(value: number): number {
  const clamped = Math.min(100, Math.max(0, value))
  return clamped / 100
}

export interface OpportunityScoreInput {
  metrics: MarketMetrics
  /** Service value relative to the highest-value service, 0-100. */
  customerValueNormalized: number
  /** Evidence available and permitted for publication, 0-100. */
  evidenceAvailability: number
  /**
   * How likely a content/evidence action is to move the needle here.
   * High when there IS demand and there IS a page, low when there is neither.
   */
  probabilityOfImprovement: number
}

export function computeOpportunityScore(input: OpportunityScoreInput): OpportunityScoreComponents {
  const visibilityGap = Math.min(100, Math.max(0, 100 - input.metrics.internalVisibilityScore))

  /**
   * Competitive opportunity is INVERTED pressure: a market with no competitors
   * named is an open field (high opportunity), while a saturated answer set is
   * expensive to enter. Floor of 10 keeps strong markets from zeroing out
   * entirely, because beating an incumbent is still possible.
   */
  const competitiveOpportunity = Math.min(100, Math.max(10, 100 - input.metrics.competitorPressure))

  const product =
    factor(visibilityGap) *
    factor(input.customerValueNormalized) *
    factor(competitiveOpportunity) *
    factor(input.evidenceAvailability) *
    factor(input.probabilityOfImprovement)

  // Product of five 0-1 factors is tiny; scale back to 0-100.
  const score = Math.round(product * 100 * 100) / 100

  const explanation = [
    `Visibility gap ${round2(visibilityGap)}/100 (internal visibility ${input.metrics.internalVisibilityScore}).`,
    `Customer value ${round2(input.customerValueNormalized)}/100.`,
    `Competitive opportunity ${round2(competitiveOpportunity)}/100 (competitor pressure ${input.metrics.competitorPressure}).`,
    `Evidence availability ${round2(input.evidenceAvailability)}/100.`,
    `Probability of improvement ${round2(input.probabilityOfImprovement)}/100.`,
    `Multiplicative score ${score}.`,
    'Internal prioritisation heuristic only; not a ranking or a prediction.',
  ].join(' ')

  return {
    visibilityGap: round2(visibilityGap),
    customerValue: round2(input.customerValueNormalized),
    competitiveOpportunity: round2(competitiveOpportunity),
    evidenceAvailability: round2(input.evidenceAvailability),
    probabilityOfImprovement: round2(input.probabilityOfImprovement),
    score,
    explanation,
  }
}

/**
 * Evidence availability.
 *
 * Publication permission and verification are hard gates: unverified evidence
 * counts for a fraction of its weight because it cannot be used until someone
 * confirms it. This is what stops the system from recommending content built on
 * evidence nobody has checked.
 */
export function computeEvidenceAvailability(params: {
  totalEvidence: number
  publishedEvidence: number
  verifiedEvidence: number
  hasPage: boolean
}): number {
  if (params.totalEvidence <= 0) return 0

  // Verified, publishable evidence is what can actually support a page.
  const usable = params.verifiedEvidence
  const base = Math.min(100, usable * 25)
  const publishBonus = params.publishedEvidence > 0 ? 15 : 0
  const pagePenalty = params.hasPage ? 0 : 10
  return Math.min(100, Math.max(0, base + publishBonus - pagePenalty))
}

/**
 * Probability of improvement.
 *
 * Grounded in observable structure rather than optimism:
 *   - demand exists (responses were collected for this market)
 *   - the market is not already saturated with our mentions
 *   - there is somewhere for the improvement to live (a page)
 *   - we are not already at the ceiling
 */
export function computeProbabilityOfImprovement(params: {
  responseCount: number
  currentVisibility: number
  hasPage: boolean
  hasEvidence: boolean
}): number {
  let score = 20

  if (params.responseCount > 0) score += 20
  if (params.responseCount >= 5) score += 10

  // Mid-range visibility has the most headroom. Already-strong markets have
  // little room to grow; completely unmeasured markets are uncertain, not easy.
  const v = params.currentVisibility
  if (v >= 10 && v < 60) score += 25
  else if (v >= 60 && v < 85) score += 10
  else if (v >= 85) score -= 15

  if (params.hasPage) score += 15
  if (params.hasEvidence) score += 10

  return Math.min(100, Math.max(0, score))
}

/** Normalize a service's value against the highest value in the taxonomy. */
export function normalizeCustomerValue(value: number | null, maxValue: number | null): number {
  if (value === null || value === undefined || value <= 0) {
    // Unknown value is not zero value. Return a neutral mid-low figure rather
    // than pretending a service is worthless or maximally valuable.
    return 50
  }
  if (maxValue === null || maxValue <= 0) return 50
  return Math.min(100, Math.max(0, (value / maxValue) * 100))
}

/** Map a score to a priority label used by the existing recommendations table. */
export function priorityFromScore(score: number): 'critical' | 'high' | 'medium' | 'low' | 'monitor' {
  if (score >= 45) return 'critical'
  if (score >= 25) return 'high'
  if (score >= 12) return 'medium'
  if (score >= 4) return 'low'
  return 'monitor'
}

/**
 * Approval class for a category.
 *
 * GREEN  : nothing leaves the building -- monitoring, analysis, internal plans.
 * YELLOW : customer-facing content changes -- human approval required.
 * RED    : money, external profiles, customer contact, legal exposure.
 *
 * This mapping is the single source of truth for routing, and it is asserted by
 * tests so a new category cannot silently default to automatic execution.
 */
export const CATEGORY_APPROVAL_CLASS: Record<OpportunityCategory, ApprovalClass> = {
  authority_gap: 'yellow',
  content_gap: 'yellow',
  citation_gap: 'yellow',
  evidence_gap: 'green',
  technical_seo: 'yellow',
  internal_linking: 'green',
  competitor_pressure: 'green',
  expansion: 'yellow',
}

export function approvalClassFor(category: OpportunityCategory): ApprovalClass {
  return CATEGORY_APPROVAL_CLASS[category] ?? 'yellow'
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}