/**
 * Centralized AI Provider Pricing Configuration
 */

export type ProviderName = 'openai' | 'anthropic'
export type ModelName = string

export interface ModelPricing {
  provider: ProviderName
  model: ModelName
  inputPricePerMTok: number
  outputPricePerMTok: number
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
}

export function calculateModelCost(
  provider: ProviderName,
  model: ModelName,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PROVIDER_PRICING[provider]?.[model]
  if (!pricing) throw new Error(`Unknown model: ${provider}/${model}`)
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMTok
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMTok
  return inputCost + outputCost
}

export function getDefaultModel(provider: ProviderName): ModelName {
  return provider === 'openai' ? 'gpt-4-turbo' : 'claude-3-sonnet'
}
