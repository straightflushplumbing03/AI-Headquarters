/**
 * Centralized AI Provider Pricing Configuration
 */

export type ProviderName = 'openai' | 'anthropic' | 'gateway'
export type ModelName = string

export interface ModelPricing {
  provider: ProviderName
  model: ModelName
  inputPricePerMTok: number
  outputPricePerMTok: number
  /**
   * Discounted rate for input served from the vendor's prompt cache. Absent
   * means the vendor publishes no cache discount, so cached input bills at the
   * standard input rate.
   */
  cacheReadPricePerMTok?: number
  maxTokens: number
  costEfficiency: 'budget' | 'standard' | 'premium'
}

export const PROVIDER_PRICING: Record<ProviderName, Record<ModelName, ModelPricing>> = {
  openai: {
    'gpt-4-turbo': {
      provider: 'openai',
      model: 'gpt-4-turbo',
      inputPricePerMTok: 10,
      outputPricePerMTok: 30,
      maxTokens: 128000,
      costEfficiency: 'premium',
    },
    'gpt-3.5-turbo': {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      inputPricePerMTok: 0.5,
      outputPricePerMTok: 1.5,
      maxTokens: 4096,
      costEfficiency: 'budget',
    },
  },
  anthropic: {
    'claude-3-sonnet': {
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      inputPricePerMTok: 3,
      outputPricePerMTok: 15,
      maxTokens: 200000,
      costEfficiency: 'standard',
    },
  },
  // Vercel AI Gateway. The gateway adds no markup of its own, so these are the
  // upstream vendor rates, keyed by the gateway's "vendor/model" model id.
  // Only models listed here can be costed; an unlisted model is reported as
  // unpriced rather than silently costing zero (see GatewayProvider).
  gateway: {
    'moonshotai/kimi-k3': {
      provider: 'gateway',
      model: 'moonshotai/kimi-k3',
      inputPricePerMTok: 3,
      outputPricePerMTok: 15,
      cacheReadPricePerMTok: 0.3,
      maxTokens: 1048576,
      costEfficiency: 'premium',
    },
    'moonshotai/kimi-k2.6': {
      provider: 'gateway',
      model: 'moonshotai/kimi-k2.6',
      inputPricePerMTok: 0.95,
      outputPricePerMTok: 4,
      cacheReadPricePerMTok: 0.16,
      maxTokens: 262144,
      costEfficiency: 'standard',
    },
  },
}

/**
 * Look up pricing without throwing.
 *
 * calculateModelCost throws on an unknown model, which callers then classify as
 * a generic provider error. A model we simply have no rate for is a different
 * condition from a provider fault, so callers that need to tell them apart use
 * this.
 */
export function getModelPricing(provider: ProviderName, model: ModelName): ModelPricing | undefined {
  return PROVIDER_PRICING[provider]?.[model]
}

export function calculateModelCost(
  provider: ProviderName,
  model: ModelName,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0
): number {
  const pricing = PROVIDER_PRICING[provider]?.[model]
  if (!pricing) throw new Error(`Unknown model: ${provider}/${model}`)
  // Cached input bills at a discount when the vendor publishes one. Clamped so
  // a provider reporting more cached tokens than input cannot yield negative
  // uncached volume (which would under-report cost).
  const cached = Math.min(Math.max(cachedInputTokens, 0), Math.max(inputTokens, 0))
  const uncached = Math.max(inputTokens - cached, 0)
  const inputCost =
    (uncached / 1_000_000) * pricing.inputPricePerMTok +
    (cached / 1_000_000) * (pricing.cacheReadPricePerMTok ?? pricing.inputPricePerMTok)
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMTok
  return inputCost + outputCost
}

export function getDefaultModel(provider: ProviderName): ModelName {
  if (provider === 'openai') return 'gpt-4-turbo'
  if (provider === 'anthropic') return 'claude-3-sonnet'
  return 'moonshotai/kimi-k3'
}
