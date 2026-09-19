/**
 * AI Authority Engine -- experiment engine.
 *
 * A controlled before/after measurement framework. Its single most important
 * property is LANGUAGE DISCIPLINE: a change happening and a metric moving
 * afterwards is not proof of causation. Every result string is generated here,
 * once, so the same cautious phrasing is used everywhere and cannot drift.
 *
 * We also refuse to report a result when there is not enough data to say
 * anything. "Inconclusive" is a real, useful answer and is preferred over a
 * confident-sounding sentence built on two data points.
 */

import { computeTrend } from './metrics'
import type { AuthorityStore } from './store'

export type ExperimentOutcome = 'improved' | 'declined' | 'neutral' | 'inconclusive'

export interface ExperimentMeasurement {
  metrics: Record<string, number | null>
  capturedAt: string
  responseCount: number
}

export interface ExperimentEvaluation {
  outcome: ExperimentOutcome
  confidence: number | null
  summary: string
  delta: Record<string, { before: number | null; after: number | null; change: number | null }>
}

/** Minimum observations required before we will state an outcome at all. */
export const MIN_RESPONSES_FOR_EVALUATION = 5
/** Relative change below this is treated as noise, not movement. */
export const NOISE_THRESHOLD_PERCENT = 3

/**
 * Evaluate a before/after pair.
 *
 * Deterministic and pure, so the reasoning can be unit tested and the same
 * inputs always produce the same conclusion.
 */
export function evaluateExperiment(params: {
  metric: string
  before: ExperimentMeasurement | null
  after: ExperimentMeasurement | null
}): ExperimentEvaluation {
  const { metric, before, after } = params

  if (!before || !after) {
    return {
      outcome: 'inconclusive',
      confidence: null,
      summary:
        'Not enough measurement windows to compare. A baseline and a post-change measurement are both required.',
      delta: {},
    }
  }

  if (
    before.responseCount < MIN_RESPONSES_FOR_EVALUATION ||
    after.responseCount < MIN_RESPONSES_FOR_EVALUATION
  ) {
    return {
      outcome: 'inconclusive',
      confidence: null,
      summary:
        `Insufficient data: ${before.responseCount} response(s) before and ${after.responseCount} after, ` +
        `against a minimum of ${MIN_RESPONSES_FOR_EVALUATION} each. No conclusion is drawn.`,
      delta: {},
    }
  }

  const delta: ExperimentEvaluation['delta'] = {}
  const tracked = Object.keys(after.metrics).filter(
    (key) => before.metrics[key] !== undefined || after.metrics[key] !== undefined
  )

  let improved = 0
  let declined = 0
  let compared = 0

  for (const key of tracked) {
    const beforeValue = before.metrics[key] ?? null
    const afterValue = after.metrics[key] ?? null
    const trend = computeTrend(afterValue, beforeValue)

    delta[key] = { before: beforeValue, after: afterValue, change: trend?.delta ?? null }

    if (beforeValue === null || afterValue === null) continue
    compared += 1

    const baseline = Math.abs(beforeValue)
    const relative = baseline > 0 ? (Math.abs(trend?.delta ?? 0) / baseline) * 100 : 0
    if (relative < NOISE_THRESHOLD_PERCENT) continue

    if ((trend?.delta ?? 0) > 0) improved += 1
    else if ((trend?.delta ?? 0) < 0) declined += 1
  }

  const primary = delta[metric]
  const primaryChange = primary?.change ?? null

  let outcome: ExperimentOutcome
  if (compared === 0) outcome = 'inconclusive'
  else if (primaryChange !== null && Math.abs(primaryChange) < 0.01 && improved === 0 && declined === 0) {
    outcome = 'neutral'
  } else if (improved > declined) outcome = 'improved'
  else if (declined > improved) outcome = 'declined'
  else outcome = 'neutral'

  // Confidence reflects how much data stood behind the comparison, not how
  // favourable it was.
  const confidence = Math.min(
    90,
    Math.round(
      30 +
        Math.min(before.responseCount, 40) * 0.5 +
        Math.min(after.responseCount, 40) * 0.5 +
        compared * 2
    )
  )

  return {
    outcome,
    confidence,
    summary: buildResultSummary({ outcome, metric, primaryChange, improved, declined, compared }),
    delta,
  }
}

/**
 * The ONLY place a result sentence is produced. Deliberately says "after the
 * change", never "caused by".
 */
export function buildResultSummary(params: {
  outcome: ExperimentOutcome
  metric: string
  primaryChange: number | null
  improved: number
  declined: number
  compared: number
}): string {
  const { outcome, metric, primaryChange, improved, declined, compared } = params
  const metricLabel = metric.replace(/^internal_/, '').replace(/_/g, ' ')

  if (outcome === 'inconclusive') {
    return `No conclusion available: not enough comparable data for ${metricLabel}.`
  }

  const movement =
    primaryChange === null
      ? 'the primary metric did not move measurably'
      : `the primary metric (${metricLabel}) changed by ${primaryChange > 0 ? '+' : ''}${primaryChange}`

  if (outcome === 'improved') {
    return (
      `Visibility improved after the change: ${movement}, with ${improved} of ${compared} compared ` +
      `metric(s) moving up and ${declined} moving down. This is an observed sequence, not proof that ` +
      `the change caused the improvement.`
    )
  }
  if (outcome === 'declined') {
    return (
      `Visibility declined after the change: ${movement}, with ${declined} of ${compared} compared ` +
      `metric(s) moving down and ${improved} moving up. Other factors may be responsible; the cause is ` +
      `not established.`
    )
  }
  return (
    `No meaningful change detected after the change: ${movement}, across ${compared} compared ` +
    `metric(s).`
  )
}

export interface CreateExperimentInput {
  organizationId: string
  marketId: string | null
  opportunityId: string | null
  name: string
  hypothesis: string
  changeDescription: string
  changeType: string
  metric?: string
  plannedDurationDays?: number
  baseline: Record<string, unknown>
  createdBy: string | null
}

export class AuthorityExperimentService {
  constructor(
    private store: AuthorityStore
  ) {}

  /**
   * Create a DRAFT experiment with its baseline captured.
   *
   * The baseline is captured at creation and never rewritten, so the comparison
   * cannot be quietly re-based later.
   */
  async create(input: CreateExperimentInput) {
    return this.store.createExperiment({
      organization_id: input.organizationId,
      market_id: input.marketId,
      opportunity_id: input.opportunityId,
      name: input.name.slice(0, 300),
      hypothesis: input.hypothesis.slice(0, 2000),
      change_description: input.changeDescription.slice(0, 2000),
      change_type: input.changeType,
      metric: input.metric ?? 'internal_visibility_score',
      baseline: input.baseline,
      baseline_captured_at: new Date().toISOString(),
      status: 'draft',
      planned_duration_days: input.plannedDurationDays ?? 30,
      created_by: input.createdBy,
    })
  }

  async start(organizationId: string, experimentId: string): Promise<void> {
    await this.store.updateExperiment(organizationId, experimentId, {
      status: 'running',
      started_at: new Date().toISOString(),
    })
  }

  /**
   * Record a measurement window against an experiment.
   * Idempotent on (experiment, measured_at, phase) via the schema constraint.
   */
  async recordMeasurement(params: {
    organizationId: string
    experimentId: string
    phase: 'before' | 'during' | 'after'
    metrics: Record<string, number | null>
    notes?: string
  }): Promise<void> {
    await this.store.insertExperimentResult({
      organization_id: params.organizationId,
      experiment_id: params.experimentId,
      phase: params.phase,
      metrics: params.metrics,
      notes: params.notes ?? null,
      measured_at: new Date().toISOString(),
    })
  }

  /**
   * Evaluate running experiments whose planned window has elapsed, and write
   * the result. Never marks an experiment complete without a real comparison.
   */
  async evaluateDue(organizationId: string): Promise<{
    evaluated: number
    completed: number
    stillRunning: number
  }> {
    const running = await this.store.listExperiments(organizationId, 'running')
    let evaluated = 0
    let completed = 0

    for (const experiment of running) {
      const results = await this.store.listExperimentResults(organizationId, experiment.id)
      const before = results.find((r) => r.phase === 'before')
      const after = results.filter((r) => r.phase === 'after').slice(-1)[0]

      const startedAt = experiment.started_at ? new Date(experiment.started_at) : null
      const dueAt = startedAt
        ? new Date(startedAt.getTime() + experiment.planned_duration_days * 24 * 60 * 60 * 1000)
        : null

      if (!dueAt || new Date() < dueAt) continue

      const evaluation = evaluateExperiment({
        metric: experiment.metric,
        before: before
          ? {
              metrics: before.metrics as Record<string, number | null>,
              capturedAt: before.measured_at,
              responseCount: numberFrom(before.metrics, 'responseCount'),
            }
          : null,
        after: after
          ? {
              metrics: after.metrics as Record<string, number | null>,
              capturedAt: after.measured_at,
              responseCount: numberFrom(after.metrics, 'responseCount'),
            }
          : null,
      })

      evaluated += 1

      await this.store.updateExperiment(organizationId, experiment.id, {
        status: evaluation.outcome === 'inconclusive' ? 'running' : 'completed',
        ended_at: evaluation.outcome === 'inconclusive' ? null : new Date().toISOString(),
        result: { outcome: evaluation.outcome, delta: evaluation.delta },
        result_summary: evaluation.summary.slice(0, 2000),
        confidence: evaluation.confidence,
      })

      if (evaluation.outcome !== 'inconclusive') completed += 1
    }

    return { evaluated, completed, stillRunning: running.length - completed }
  }
}

function numberFrom(metrics: Record<string, unknown>, key: string): number {
  const value = metrics?.[key]
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}