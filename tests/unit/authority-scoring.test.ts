/**
 * AI Authority Engine -- scoring, opportunity prioritisation, and approval
 * routing tests.
 *
 * Two things are being protected here:
 *
 * 1. METRIC INTEGRITY. These functions decide what the dashboard reports and
 *    which market the business works on next. An off-by-one or a missing guard
 *    produces confident, wrong guidance.
 *
 * 2. SAFETY ROUTING. The approval-class mapping is what stands between a
 *    recommendation and live customer-facing publication. It is asserted
 *    exhaustively so a new category cannot silently default to automatic.
 */

import { describe, it, expect } from 'vitest'
import {
  approvalClassFor,
  computeEvidenceAvailability,
  computeOpportunityScore,
  computeProbabilityOfImprovement,
  normalizeCustomerValue,
  priorityFromScore,
} from '@/lib/authority/opportunity-engine'
import { computeTrend } from '@/lib/authority/metrics'
import { evaluateExperiment, MIN_RESPONSES_FOR_EVALUATION } from '@/lib/authority/experiment-service'
import type { MarketMetrics, OpportunityCategory } from '@/lib/authority/types'

function metrics(overrides: Partial<MarketMetrics> = {}): MarketMetrics {
  return {
    internalMentionRate: 50,
    internalFirstMentionRate: 10,
    internalCitationRate: 25,
    internalWebsiteCitationRate: 10,
    internalVisibilityScore: 50,
    contentCoverage: 50,
    citationCoverage: 50,
    reviewCoverage: 50,
    projectCoverage: 50,
    internalAuthorityScore: 50,
    competitorPressure: 50,
    components: {},
    ...overrides,
  }
}

describe('computeOpportunityScore', () => {
  it('returns a score in the documented 0-100 range', () => {
    const result = computeOpportunityScore({
      metrics: metrics(),
      customerValueNormalized: 50,
      evidenceAvailability: 50,
      probabilityOfImprovement: 50,
    })

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('scores a weak, well-evidenced market above a strong, poorly-evidenced one', () => {
    const weakButReady = computeOpportunityScore({
      metrics: metrics({ internalVisibilityScore: 10, competitorPressure: 20 }),
      customerValueNormalized: 80,
      evidenceAvailability: 90,
      probabilityOfImprovement: 80,
    })

    const strongAndThin = computeOpportunityScore({
      metrics: metrics({ internalVisibilityScore: 90, competitorPressure: 80 }),
      customerValueNormalized: 80,
      evidenceAvailability: 5,
      probabilityOfImprovement: 80,
    })

    expect(weakButReady.score).toBeGreaterThan(strongAndThin.score)
  })

  it('keeps competitive opportunity above the floor even under maximum pressure', () => {
    // Beating an incumbent is still possible, so a fully saturated market must
    // not collapse the whole score to zero on that factor alone.
    const saturated = computeOpportunityScore({
      metrics: metrics({ competitorPressure: 100 }),
      customerValueNormalized: 100,
      evidenceAvailability: 100,
      probabilityOfImprovement: 100,
    })
    expect(saturated.competitiveOpportunity).toBeGreaterThanOrEqual(10)
  })

  it('is monotonic: more visibility gap never lowers the score', () => {
    const base = {
      customerValueNormalized: 60,
      evidenceAvailability: 60,
      probabilityOfImprovement: 60,
    }
    const lowGap = computeOpportunityScore({ ...base, metrics: metrics({ internalVisibilityScore: 80 }) })
    const highGap = computeOpportunityScore({ ...base, metrics: metrics({ internalVisibilityScore: 20 }) })
    expect(highGap.score).toBeGreaterThan(lowGap.score)
  })

  it('produces an explanation naming every component', () => {
    const result = computeOpportunityScore({
      metrics: metrics(),
      customerValueNormalized: 50,
      evidenceAvailability: 50,
      probabilityOfImprovement: 50,
    })

    expect(result.explanation).toContain('Visibility gap')
    expect(result.explanation).toContain('Evidence availability')
    // The explanation must state the heuristic is not an external ranking.
    expect(result.explanation.toLowerCase()).toContain('not a ranking')
  })

  it('clamps out-of-range inputs instead of producing an impossible score', () => {
    const result = computeOpportunityScore({
      metrics: metrics({ internalVisibilityScore: -50 }),
      customerValueNormalized: 500,
      evidenceAvailability: 500,
      probabilityOfImprovement: -20,
    })

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(Number.isFinite(result.score)).toBe(true)
  })
})

describe('computeEvidenceAvailability', () => {
  it('is zero when there is no evidence at all', () => {
    expect(
      computeEvidenceAvailability({
        totalEvidence: 0,
        publishedEvidence: 0,
        verifiedEvidence: 0,
        hasPage: true,
      })
    ).toBe(0)
  })

  it('does not credit unverified evidence toward publishable availability', () => {
    const unverified = computeEvidenceAvailability({
      totalEvidence: 10,
      publishedEvidence: 0,
      verifiedEvidence: 0,
      hasPage: true,
    })
    const verified = computeEvidenceAvailability({
      totalEvidence: 10,
      publishedEvidence: 0,
      verifiedEvidence: 4,
      hasPage: true,
    })

    expect(unverified).toBe(0)
    expect(verified).toBeGreaterThan(unverified)
  })

  it('caps at 100', () => {
    const result = computeEvidenceAvailability({
      totalEvidence: 100,
      publishedEvidence: 100,
      verifiedEvidence: 100,
      hasPage: true,
    })
    expect(result).toBeLessThanOrEqual(100)
  })
})

describe('computeProbabilityOfImprovement', () => {
  it('favours mid-range visibility over already-saturated markets', () => {
    const midRange = computeProbabilityOfImprovement({
      responseCount: 10,
      currentVisibility: 40,
      hasPage: true,
      hasEvidence: true,
    })
    const saturated = computeProbabilityOfImprovement({
      responseCount: 10,
      currentVisibility: 95,
      hasPage: true,
      hasEvidence: true,
    })
    expect(midRange).toBeGreaterThan(saturated)
  })

  it('requires a page to be considered highly likely to improve', () => {
    const noPage = computeProbabilityOfImprovement({
      responseCount: 10,
      currentVisibility: 40,
      hasPage: false,
      hasEvidence: true,
    })
    const withPage = computeProbabilityOfImprovement({
      responseCount: 10,
      currentVisibility: 40,
      hasPage: true,
      hasEvidence: true,
    })
    expect(withPage).toBeGreaterThan(noPage)
  })

  it('stays within 0-100', () => {
    const result = computeProbabilityOfImprovement({
      responseCount: 500,
      currentVisibility: 50,
      hasPage: true,
      hasEvidence: true,
    })
    expect(result).toBeLessThanOrEqual(100)
    expect(result).toBeGreaterThanOrEqual(0)
  })
})

describe('normalizeCustomerValue', () => {
  it('treats unknown value as neutral, not as worthless', () => {
    // Scoring an unknown-value service as zero would permanently hide it from
    // prioritisation, which is worse than a neutral guess.
    expect(normalizeCustomerValue(null, 1000)).toBe(50)
    expect(normalizeCustomerValue(0, 1000)).toBe(50)
  })

  it('normalizes against the maximum', () => {
    expect(normalizeCustomerValue(500, 1000)).toBe(50)
    expect(normalizeCustomerValue(1000, 1000)).toBe(100)
  })

  it('returns neutral when the maximum is unknown', () => {
    expect(normalizeCustomerValue(500, null)).toBe(50)
  })
})

describe('priorityFromScore', () => {
  it('is monotonic across the documented thresholds', () => {
    const order = ['monitor', 'low', 'medium', 'high', 'critical']
    let previousIndex = -1
    for (const score of [0, 5, 15, 30, 60]) {
      const index = order.indexOf(priorityFromScore(score))
      expect(index).toBeGreaterThanOrEqual(previousIndex)
      previousIndex = index
    }
  })
})

describe('approval class routing', () => {
  const ALL_CATEGORIES: OpportunityCategory[] = [
    'authority_gap',
    'content_gap',
    'citation_gap',
    'evidence_gap',
    'technical_seo',
    'internal_linking',
    'competitor_pressure',
    'expansion',
  ]

  it('assigns exactly one class to every category', () => {
    for (const category of ALL_CATEGORIES) {
      const value = approvalClassFor(category)
      expect(['green', 'yellow', 'red']).toContain(value)
    }
  })

  it('requires approval for anything that changes customer-facing content', () => {
    expect(approvalClassFor('authority_gap')).toBe('yellow')
    expect(approvalClassFor('content_gap')).toBe('yellow')
    expect(approvalClassFor('citation_gap')).toBe('yellow')
    expect(approvalClassFor('technical_seo')).toBe('yellow')
    expect(approvalClassFor('expansion')).toBe('yellow')
  })

  it('allows monitoring-only categories to run automatically', () => {
    expect(approvalClassFor('evidence_gap')).toBe('green')
    expect(approvalClassFor('internal_linking')).toBe('green')
    expect(approvalClassFor('competitor_pressure')).toBe('green')
  })

  it('defaults an unknown category to the SAFER class, not to green', () => {
    // A category added without updating the map must never become automatic.
    expect(approvalClassFor('some_future_category' as OpportunityCategory)).toBe('yellow')
  })

  it('never assigns red to a routine category', () => {
    // Red is reserved for money, business identity, and legal exposure. If a
    // routine category starts mapping to red, the approval queue becomes noise
    // and humans begin rubber-stamping.
    for (const category of ALL_CATEGORIES) {
      expect(approvalClassFor(category)).not.toBe('red')
    }
  })
})

describe('computeTrend', () => {
  it('reports direction and delta', () => {
    const up = computeTrend(60, 50)
    expect(up?.delta).toBe(10)
    expect(up?.direction).toBe('up')
  })

  it('reports a decline', () => {
    const down = computeTrend(40, 50)
    expect(down?.delta).toBe(-10)
    expect(down?.direction).toBe('down')
  })

  it('handles equal values as flat', () => {
    const flat = computeTrend(50, 50)
    expect(flat?.delta).toBe(0)
    expect(flat?.direction).toBe('flat')
  })

  it('returns null when either side is unknown rather than inventing a trend', () => {
    expect(computeTrend(null, 50)).toBeNull()
    expect(computeTrend(50, null)).toBeNull()
  })
})

describe('experiment evaluation', () => {
  const before = {
    metrics: { internal_visibility_score: 40 },
    capturedAt: '2026-01-01T00:00:00Z',
    responseCount: 20,
  }
  const after = {
    metrics: { internal_visibility_score: 55 },
    capturedAt: '2026-02-01T00:00:00Z',
    responseCount: 20,
  }

  it('refuses to conclude anything without a baseline', () => {
    const result = evaluateExperiment({
      metric: 'internal_visibility_score',
      before: null,
      after,
    })
    expect(result.outcome).toBe('inconclusive')
    expect(result.confidence).toBeNull()
  })

  it('refuses to conclude anything below the minimum sample size', () => {
    const result = evaluateExperiment({
      metric: 'internal_visibility_score',
      before: { ...before, responseCount: MIN_RESPONSES_FOR_EVALUATION - 1 },
      after,
    })

    expect(result.outcome).toBe('inconclusive')
    expect(result.summary.toLowerCase()).toContain('insufficient')
  })

  it('reports improvement when the metric rises on adequate data', () => {
    const result = evaluateExperiment({
      metric: 'internal_visibility_score',
      before,
      after,
    })
    expect(result.outcome).toBe('improved')
    expect(result.delta.internal_visibility_score.change).toBe(15)
  })

  it('reports decline honestly', () => {
    const result = evaluateExperiment({
      metric: 'internal_visibility_score',
      before: after,
      after: before,
    })
    expect(result.outcome).toBe('declined')
  })

  it('treats a change under the noise threshold as neutral', () => {
    const result = evaluateExperiment({
      metric: 'internal_visibility_score',
      before: { ...before, metrics: { internal_visibility_score: 50 } },
      after: { ...after, metrics: { internal_visibility_score: 51 } },
    })
    expect(result.outcome).toBe('neutral')
  })

  it('never states causation with an affirmative connector', () => {
    // The summary may reference causation only to DENY it. Affirmative causal
    // connectors are what a reader would take as a claim, and these inputs
    // cannot establish causation.
    const affirmativeConnectors = [
      'because of the change',
      'due to the change',
      'caused by the change',
      'as a result of the change',
      'proves that the change',
      'confirms that the change',
    ]

    for (const [label, pair] of [
      ['improved', { before, after }],
      ['declined', { before: after, after: before }],
      ['neutral', {
        before: { ...before, metrics: { internal_visibility_score: 50 } },
        after: { ...after, metrics: { internal_visibility_score: 51 } },
      }],
    ] as const) {
      const result = evaluateExperiment({
        metric: 'internal_visibility_score',
        before: pair.before,
        after: pair.after,
      })
      const summary = result.summary.toLowerCase()

      for (const connector of affirmativeConnectors) {
        expect(summary, `${label} summary used affirmative connector "${connector}"`).not.toContain(
          connector
        )
      }
    }
  })

  it('explicitly disclaims causation when it reports movement', () => {
    const improved = evaluateExperiment({ metric: 'internal_visibility_score', before, after })
    const declined = evaluateExperiment({
      metric: 'internal_visibility_score',
      before: after,
      after: before,
    })

    // Any movement report must carry an explicit caveat, so a reader cannot
    // mistake an observed sequence for an established cause.
    expect(improved.summary).toContain('not proof')
    expect(declined.summary.toLowerCase()).toContain('not established')
  })

  it('is deterministic', () => {
    const a = evaluateExperiment({ metric: 'internal_visibility_score', before, after })
    const b = evaluateExperiment({ metric: 'internal_visibility_score', before, after })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('keeps confidence within bounds', () => {
    const result = evaluateExperiment({
      metric: 'internal_visibility_score',
      before: { ...before, responseCount: 1000 },
      after: { ...after, responseCount: 1000 },
    })
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence!).toBeLessThanOrEqual(100)
  })
})