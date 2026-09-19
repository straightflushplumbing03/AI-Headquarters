/**
 * AI Authority Engine -- authority / visibility metrics.
 *
 * Produces Business Brain INTERNAL metrics from observable counts. Two things
 * this module deliberately does NOT do:
 *
 *   1. It does not produce a single "AI Rank". AI systems have no single
 *      ranking function, so a number presented as one would be a fiction. We
 *      keep the individual families (mention rate, first-mention rate,
 *      citation rate, first-party citation rate) and combine them only into a
 *      clearly-labelled internal composite.
 *
 *   2. It does not present anything as an external platform's score. Every
 *      output is prefixed `internal` in the schema and in the UI.
 *
 * All functions are pure: given the same observations they return the same
 * metrics. That is what makes the Command Center reproducible and testable.
 */

import type { MarketMetrics, MarketObservation } from './types'

/**
 * Denominators are floored at 1 to avoid division by zero. A market with zero
 * collected responses reports 0% rates rather than null, which is the honest
 * representation of "we have observed nothing yet" and keeps dashboards stable.
 */
const MIN_DENOM = 1

function rate(numerator: number, denominator: number): number {
  return round2((Math.max(0, numerator) / Math.max(denominator, MIN_DENOM)) * 100)
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Diminishing-returns curve so the first few units of coverage matter most. */
function saturating(value: number, fullAt: number): number {
  if (fullAt <= 0) return 0
  return clamp((value / fullAt) * 100)
}

export function computeMarketMetrics(obs: MarketObservation): MarketMetrics {
  const responseCount = Math.max(0, Math.round(obs.responseCount))

  const internalMentionRate = rate(obs.mentionCount, responseCount)
  const internalFirstMentionRate = rate(obs.firstMentionCount, responseCount)
  const internalCitationRate = rate(obs.citationCount, responseCount)
  const internalWebsiteCitationRate = rate(obs.firstPartyCitationCount, responseCount)

  /**
   * Visibility composite.
   *
   * Weighting rationale:
   *   - being recommended at all is the primary signal (40)
   *   - being named first is strong but secondary (20)
   *   - being cited at all, by anyone, is third (25)
   *   - being cited from our OWN site is weakest, because it is the easiest to
   *     achieve and is the least independent evidence (15)
   *
   * These are internal weights, chosen for business relevance, and are versioned
   * via AUTHORITY_SCORE_VERSION rather than being presented as objective truth.
   */
  const internalVisibilityScore = round2(
    internalMentionRate * 0.4 +
      internalFirstMentionRate * 0.2 +
      internalCitationRate * 0.25 +
      internalWebsiteCitationRate * 0.15
  )

  // Coverage families. The "full" thresholds are the point at which we consider
  // the market adequately evidenced; beyond that, additional evidence is
  // welcome but no longer the bottleneck.
  const contentCoverage = saturating(obs.linkedPageCount, 2)
  const projectCoverage = saturating(obs.projectEvidenceCount, 3)
  const reviewCoverage = saturating(obs.reviewEvidenceCount, 3)
  const citationCoverage = saturating(obs.citationCount, 5)

  /**
   * Authority composite: what the business itself controls (evidence, content,
   * coverage), as opposed to visibility, which depends on third parties.
   */
  const internalAuthorityScore = round2(
    contentCoverage * 0.3 + projectCoverage * 0.25 + reviewCoverage * 0.25 + citationCoverage * 0.2
  )

  /**
   * Competitive pressure: how crowded the answers are. Reported as a pressure
   * indicator, never as a ranking. A market where competitors are named
   * repeatedly is harder to win, which is the only thing this number claims.
   */
  const avgCompetitorsPerResponse = obs.competitorMentionTotal / Math.max(responseCount, MIN_DENOM)
  const competitorPressure = round2(
    clamp(saturating(avgCompetitorsPerResponse, 6) * 0.6 + saturating(obs.distinctCompetitors, 8) * 0.4)
  )

  return {
    internalMentionRate,
    internalFirstMentionRate,
    internalCitationRate,
    internalWebsiteCitationRate,
    internalVisibilityScore,
    contentCoverage: round2(contentCoverage),
    citationCoverage: round2(citationCoverage),
    reviewCoverage: round2(reviewCoverage),
    projectCoverage: round2(projectCoverage),
    internalAuthorityScore,
    competitorPressure,
    components: {
      scoreVersion: 'v1',
      responseCount,
      mentionCount: obs.mentionCount,
      firstMentionCount: obs.firstMentionCount,
      citationCount: obs.citationCount,
      firstPartyCitationCount: obs.firstPartyCitationCount,
      competitorMentionTotal: obs.competitorMentionTotal,
      distinctCompetitors: obs.distinctCompetitors,
      evidenceCount: obs.evidenceCount,
      publishedEvidenceCount: obs.publishedEvidenceCount,
      reviewEvidenceCount: obs.reviewEvidenceCount,
      projectEvidenceCount: obs.projectEvidenceCount,
      linkedPageCount: obs.linkedPageCount,
      internalLinkInboundCount: obs.internalLinkInboundCount,
      avgCompetitorsPerResponse: round2(avgCompetitorsPerResponse),
      weights: {
        visibility: { mention: 0.4, firstMention: 0.2, citation: 0.25, firstPartyCitation: 0.15 },
        authority: { content: 0.3, project: 0.25, review: 0.25, citation: 0.2 },
      },
      note:
        'Business Brain internal metrics. These are not, and do not represent, ' +
        'any AI platform ranking formula. No such formula is published.',
    },
  }
}

/**
 * Trend between two measurements of the same metric.
 *
 * Returns null when there is no prior measurement: an unknown trend must not be
 * rendered as "flat".
 */
export function computeTrend(
  current: number | null | undefined,
  previous: number | null | undefined
): { delta: number; direction: 'up' | 'down' | 'flat' } | null {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null
  }
  const delta = round2(current - previous)
  if (Math.abs(delta) < 0.01) return { delta: 0, direction: 'flat' }
  return { delta, direction: delta > 0 ? 'up' : 'down' }
}

/** Severity of a visibility change, used for alerting thresholds. */
export function classifyVisibilityChange(
  previous: number | null | undefined,
  current: number | null | undefined
): 'none' | 'minor' | 'moderate' | 'major' {
  const trend = computeTrend(current, previous)
  if (!trend) return 'none'
  const magnitude = Math.abs(trend.delta)
  if (magnitude >= 20) return 'major'
  if (magnitude >= 10) return 'moderate'
  if (magnitude >= 3) return 'minor'
  return 'none'
}

/** Prior-window comparison helper used by the Command Center. */
export interface ScoreDelta {
  metric: string
  current: number | null
  previous: number | null
  delta: number | null
  direction: 'up' | 'down' | 'flat' | 'unknown'
}

export function buildScoreDeltas(
  current: Partial<MarketMetrics>,
  previous: Partial<MarketMetrics> | null
): ScoreDelta[] {
  const watch: Array<{ key: keyof MarketMetrics; label: string }> = [
    { key: 'internalVisibilityScore', label: 'Internal visibility score' },
    { key: 'internalMentionRate', label: 'Mention rate' },
    { key: 'internalFirstMentionRate', label: 'First-mention rate' },
    { key: 'internalCitationRate', label: 'Citation rate' },
    { key: 'internalWebsiteCitationRate', label: 'Website citation rate' },
    { key: 'internalAuthorityScore', label: 'Internal authority score' },
    { key: 'competitorPressure', label: 'Competitor pressure' },
  ]

  return watch.map(({ key, label }) => {
    const cur = (current[key] as number | undefined) ?? null
    const prev = previous ? ((previous[key] as number | undefined) ?? null) : null
    const trend = computeTrend(cur, prev)
    return {
      metric: label,
      current: cur,
      previous: prev,
      delta: trend?.delta ?? null,
      direction: trend?.direction ?? 'unknown',
    }
  })
}