/**
 * AI Authority Engine -- recommendation generation.
 *
 * Turns a scored opportunity into an explainable recommendation with concrete,
 * individually-approvable steps. Each step carries the same approval class as
 * its category, and every customer-facing step routes through the EXISTING
 * approval machine (approval_requests) rather than a bespoke gate.
 *
 * Language discipline (enforced by tests):
 *   - We never claim a change caused a result.
 *   - We never claim a change will achieve a ranking.
 *   - We never suggest buying links, generating reviews, or fabricating
 *     projects.
 */

import { approvalClassFor, priorityFromScore } from './opportunity-engine'
import type {
  ApprovalClass,
  OpportunityCategory,
  GeneratedRecommendation,
  MarketMetrics,
  OpportunityScoreComponents,
  RecommendationAction,
} from './types'

export interface RecommendationInput {
  opportunityId: string
  marketId: string | null
  category: OpportunityCategory
  title: string
  locationName: string
  serviceName: string
  scores: OpportunityScoreComponents
  metrics: MarketMetrics
  /** Observable facts used to justify the recommendation. */
  facts: {
    responseCount: number
    mentionCount: number
    citationCount: number
    firstPartyCitationCount: number
    distinctCompetitors: number
    verifiedEvidence: number
    publishedEvidence: number
    hasPage: boolean
    hasSchema: boolean
    missingInternalLinks: number
    gapDomains: string[]
  }
}

/**
 * Build the ordered step list for a category.
 *
 * Steps are deliberately SMALL and ordered so that each one is independently
 * useful and independently approvable: the owner can approve the evidence work
 * and decline the page rewrite without losing both.
 */
export function buildActionsForCategory(input: RecommendationInput): RecommendationAction[] {
  const approvalClass = approvalClassFor(input.category)
  const { locationName, serviceName, facts } = input
  const actions: RecommendationAction[] = []
  let order = 0

  const push = (title: string, description: string, actionType: string, cls: ApprovalClass = approvalClass) => {
    order += 1
    actions.push({ stepOrder: order, title, description, actionType, approvalClass: cls })
  }

  // Internal linking is GREEN: it changes our own site structure, is trivially
  // reversible, and touches no customer-facing claim.
  if (input.category === 'internal_linking' || facts.missingInternalLinks > 0) {
    push(
      'Plan internal links for this market page',
      `Connect the ${locationName} ${serviceName} page to the ${serviceName} service page, ` +
        `the ${locationName} city page, and the most relevant verified project. This is a ` +
        `recommendation for review, not an automatic site change.`,
      'authority_internal_link_plan',
      'green'
    )
  }

  if (input.category === 'evidence_gap') {
    push(
      'Collect and verify first-party evidence',
      `Link existing verified ${locationName} ${serviceName} projects, reviews, and media to this ` +
        `market. Evidence must be real; nothing may be invented to fill the gap.`,
      'authority_evidence_publish',
      'green'
    )
  }

  if (input.category === 'citation_gap') {
    push(
      'Review citation diversification opportunities',
      facts.gapDomains.length > 0
        ? `Competitors appear through ${facts.gapDomains.slice(0, 5).join(', ')} while this business ` +
            `appears mainly through its own site. Identify legitimate eligibility for those source ` +
            `types (directory listings, association membership, genuinely newsworthy work). No paid ` +
            `links and no mass submissions.`
        : `Identify legitimate third-party source types this business could genuinely qualify for. ` +
            `No paid links and no mass submissions.`,
      'authority_citation_opportunity',
      'yellow'
    )
  }

  if (input.category === 'content_gap' || input.category === 'authority_gap' || input.category === 'expansion') {
    push(
      'Create a content brief from verified evidence',
      `Draft a brief for the ${locationName} ${serviceName} page using only verified first-party ` +
        `evidence (${facts.verifiedEvidence} item(s) currently verified). Flag any claim in the brief ` +
        `that the evidence does not support.`,
      'authority_content_brief',
      'yellow'
    )
    push(
      'Update the market page copy',
      `Apply the approved brief to the ${locationName} ${serviceName} page. Requires explicit ` +
        `approval before publishing; the system does not publish on its own.`,
      'authority_page_update',
      'yellow'
    )
  }

  if (input.category === 'technical_seo') {
    push(
      `Review ${locationName} page technical findings`,
      facts.hasSchema
        ? `Address the detected technical issues on this market page. Changes are recommendations; ` +
            `production is not modified automatically.`
        : `This market page has no structured data. Review whether appropriate, truthful schema ` +
            `(Service / LocalBusiness / FAQPage) is warranted for content that is actually visible.`,
      'authority_page_update',
      'yellow'
    )
  }

  if (input.category === 'competitor_pressure') {
    push(
      'Review competitor movement in this market',
      `${facts.distinctCompetitors} competitor(s) appear in this market's answers. Review what ` +
        `sources they are cited from and whether the business has legitimate comparable evidence. ` +
        `Do not attack competitors or make unsupported claims about them.`,
      'authority_content_brief',
      'green'
    )
  }

  // Always close the loop: measuring is what makes the next decision better.
  push(
    'Measure visibility after the change',
    `Re-run this market's query set and compare the internal mention, citation, and first-mention ` +
      `rates against the baseline. Report the change; do not claim causation unless the evidence ` +
      `supports it.`,
    'generate_report',
    'green'
  )

  return actions
}

export function generateRecommendation(input: RecommendationInput): GeneratedRecommendation {
  const actions = buildActionsForCategory(input)
  const priority = priorityFromScore(input.scores.score)

  const reasoning = [
    `Market: ${input.locationName} / ${input.serviceName}.`,
    `Internal visibility ${input.metrics.internalVisibilityScore}/100 with ` +
      `${input.facts.responseCount} collected answer(s), ${input.facts.mentionCount} mention(s), ` +
      `and ${input.facts.citationCount} citation(s) (${input.facts.firstPartyCitationCount} first-party).`,
    `Verified evidence available: ${input.facts.verifiedEvidence}; published: ${input.facts.publishedEvidence}.`,
    `Competitors observed in this market: ${input.facts.distinctCompetitors}.`,
    `Opportunity score ${input.scores.score} (internal heuristic).`,
    input.scores.explanation,
  ].join(' ')

  return {
    opportunityId: input.opportunityId,
    marketId: input.marketId,
    title: input.title,
    reasoning,
    actions,
    priority,
    confidence: confidenceFromFacts(input),
    approvalRequired: actions.some((a) => a.approvalClass !== 'green'),
  }
}

/**
 * Confidence in the RECOMMENDATION, driven by how much real evidence supports
 * it. A recommendation built on one response is low confidence and says so.
 */
export function confidenceFromFacts(input: RecommendationInput): number {
  let score = 25
  if (input.facts.responseCount >= 3) score += 15
  if (input.facts.responseCount >= 8) score += 10
  if (input.facts.verifiedEvidence >= 1) score += 15
  if (input.facts.verifiedEvidence >= 3) score += 10
  if (input.facts.hasPage) score += 10
  if (input.facts.distinctCompetitors > 0) score += 5
  return Math.min(100, Math.max(0, score))
}