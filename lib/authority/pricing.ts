/**
 * AI Authority Engine -- monitoring cost estimation.
 *
 * Deliberately separate from lib/ai/config/pricing.ts. That module's
 * `calculateModelCost` THROWS on an unknown model, which is the right
 * behaviour for the generative pipeline (a misconfigured model should be loud)
 * but the wrong behaviour for a monitoring sweep: one unpriced engine must not
 * abort a whole query batch.
 *
 * Here an unknown model costs its best-known estimate or, failing that, zero --
 * and the adapter records that the cost is unknown so the run is auditable
 * rather than silently free.
 *
 * These are published list prices used only to bound spend. They are not
 * authoritative invoicing figures.
 */

export interface MonitoringModelPrice {
  inputPerMTok: number
  outputPerMTok: number
}

/** Keyed by `engineKey` then model id. */
export const MONITORING_PRICING: Record<string, Record<string, MonitoringModelPrice>> = {
  chatgpt: {
    'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
    'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
    'gpt-4-turbo': { inputPerMTok: 10, outputPerMTok: 30 },
  },
  gemini: {
    'gemini-1.5-pro': { inputPerMTok: 1.25, outputPerMTok: 5 },
    'gemini-1.5-flash': { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  },
  perplexity: {
    // Perplexity bills a per-request fee plus tokens; the request fee dominates
    // and is modelled as a fixed floor in estimateMonitoringCost.
    sonar: { inputPerMTok: 1, outputPerMTok: 1 },
    'sonar-pro': { inputPerMTok: 3, outputPerMTok: 15 },
  },
  grok: {
    'grok-2': { inputPerMTok: 2, outputPerMTok: 10 },
    'grok-beta': { inputPerMTok: 5, outputPerMTok: 15 },
  },
}

/** Fixed per-request fees (USD) for providers that charge per call. */
const PER_REQUEST_FEE: Record<string, number> = {
  perplexity: 0.005,
}

export interface CostEstimate {
  cost: number
  /** False when the model was unknown and the estimate is a floor, not a price. */
  priced: boolean
  note?: string
}

export function estimateMonitoringCost(
  engineKey: string,
  model: string | null,
  inputTokens: number,
  outputTokens: number
): CostEstimate {
  const fee = PER_REQUEST_FEE[engineKey] ?? 0
  const price = model ? MONITORING_PRICING[engineKey]?.[model] : undefined

  if (!price) {
    return {
      cost: round6(fee),
      priced: false,
      note: model
        ? `no price entry for ${engineKey}/${model}; token cost not estimated`
        : `no model reported by ${engineKey}; token cost not estimated`,
    }
  }

  const tokenCost =
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok

  return { cost: round6(tokenCost + fee), priced: true }
}

/**
 * Upper bound used for the pre-call budget reservation. Reserving a floor and
 * settling the actual is how the existing sprint-3 engine works, so the
 * estimate must be genuinely conservative.
 */
export function estimateUpperBoundCost(
  engineKey: string,
  model: string | null,
  assumedInputTokens: number,
  assumedOutputTokens: number
): number {
  const { cost } = estimateMonitoringCost(engineKey, model, assumedInputTokens, assumedOutputTokens)
  const fee = PER_REQUEST_FEE[engineKey] ?? 0
  // Guarantee a non-zero hold when the provider bills per request.
  return Math.max(cost, fee > 0 ? fee : 0)
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}