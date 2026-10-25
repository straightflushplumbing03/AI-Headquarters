import { describe, it, expect, vi, afterEach } from 'vitest'
import { GatewayProvider, getAIProvider, PendingProvider } from '@/lib/ai/providers'
import { calculateModelCost, getModelPricing } from '@/lib/ai/config/pricing'
import type { AIExecutionRequest } from '@/types/ai'

const request: AIExecutionRequest = {
  organizationId: 'test-org',
  agentId: 'test-agent',
  taskId: 'test-task',
  systemPrompt: 'You are a plumbing assistant.',
  userMessage: 'Summarise this month.',
}

/**
 * Only the network boundary is mocked. Everything under test — credential
 * gating, pricing lookup, cost arithmetic, usage parsing and error mapping —
 * is the real implementation.
 */
const generateTextMock = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({ generateText: generateTextMock }))

function usage(inputTokens: number, outputTokens: number, cacheReadTokens?: number) {
  return {
    inputTokens,
    outputTokens,
    inputTokenDetails:
      cacheReadTokens === undefined ? {} : { cacheReadTokens },
  }
}

afterEach(() => {
  generateTextMock.mockReset()
  delete process.env.OPENAI_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.AI_GATEWAY_API_KEY
  delete process.env.AUTHORITY_GATEWAY_MODEL
})

describe('GatewayProvider', () => {
  it('reports itself unconfigured without a key', () => {
    const provider = new GatewayProvider()
    expect(provider.isConfigured).toBe(false)
    expect(provider.status).toBe('pending')
    expect(provider.errorMessage).toContain('AI_GATEWAY_API_KEY')
  })

  it('is configured when given a key', () => {
    const provider = new GatewayProvider('test-key')
    expect(provider.isConfigured).toBe(true)
    expect(provider.status).toBe('active')
  })

  it('fails honestly when not configured, without calling the network', async () => {
    const result = await new GatewayProvider().execute(request)
    expect(result.success).toBe(false)
    expect(result.errorType).toBe('provider_not_configured')
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('refuses an unpriced model instead of recording zero cost', async () => {
    const provider = new GatewayProvider('test-key', 'vendor/unpriced-model')
    const result = await provider.execute(request)

    expect(result.success).toBe(false)
    expect(result.errorType).toBe('model_not_priced')
    // The critical property: no spend happened, and nothing was reported as free.
    expect(result.actualCost).toBe(0)
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('costs a priced model at the published rate', async () => {
    generateTextMock.mockResolvedValue({ text: 'ok', usage: usage(1000, 500) })
    const provider = new GatewayProvider('test-key', 'moonshotai/kimi-k3')
    const result = await provider.execute(request)

    expect(result.success).toBe(true)
    expect(result.provider).toBe('gateway')
    // 1000 @ $3/M + 500 @ $15/M = 0.003 + 0.0075
    expect(result.actualCost).toBeCloseTo(0.0105, 6)
    expect(result.cachedInputTokens).toBeUndefined()
  })

  it('bills cached input at the discounted rate', async () => {
    generateTextMock.mockResolvedValue({ text: 'ok', usage: usage(1000, 500, 1000) })
    const provider = new GatewayProvider('test-key', 'moonshotai/kimi-k3')
    const result = await provider.execute(request)

    expect(result.success).toBe(true)
    expect(result.cachedInputTokens).toBe(1000)
    // All input cached: 1000 @ $0.30/M = 0.0003, plus 500 @ $15/M = 0.0075
    expect(result.actualCost).toBeCloseTo(0.0078, 6)
  })

  it('never lets a cached count exceed input and under-report cost', () => {
    // More cached than input is nonsense; it must not produce a negative
    // uncached term that discounts the bill below the true minimum.
    const cost = calculateModelCost('gateway', 'moonshotai/kimi-k3', 100, 0, 999)
    expect(cost).toBeCloseTo((100 / 1_000_000) * 0.3, 9)
    expect(cost).toBeGreaterThan(0)
  })

  it('reports no-usage responses as invalid rather than free', async () => {
    generateTextMock.mockResolvedValue({ text: 'ok', usage: usage(0, 0) })
    const result = await new GatewayProvider('test-key').execute(request)
    expect(result.success).toBe(false)
    expect(result.errorType).toBe('invalid_response')
  })

  it('maps an auth failure to authentication_failed', async () => {
    const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    generateTextMock.mockRejectedValue(error)
    const result = await new GatewayProvider('test-key').execute(request)
    expect(result.success).toBe(false)
    expect(result.errorType).toBe('authentication_failed')
  })

  it('surfaces a timeout as a failure rather than a silent success', async () => {
    generateTextMock.mockRejectedValue(new Error('The operation was aborted due to timeout'))
    const result = await new GatewayProvider('test-key').execute(request)
    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
  })

  it('estimateCost matches the executed cost for the same usage', () => {
    const provider = new GatewayProvider('test-key', 'moonshotai/kimi-k3')
    expect(provider.estimateCost(1000, 500)).toBeCloseTo(0.0105, 6)
  })

  it('has pricing registered for every model it defaults to', () => {
    const provider = new GatewayProvider('test-key')
    // A default model with no rate would make the provider unusable, so the
    // default must always be a priced one.
    expect(getModelPricing("gateway", provider.modelId)).toBeDefined()
  })
})

describe('getAIProvider precedence', () => {
  it('prefers a directly configured provider over the gateway', () => {
    process.env.OPENAI_API_KEY = 'sk-openai'
    process.env.AI_GATEWAY_API_KEY = 'gw-key'
    expect(getAIProvider().name).toBe('openai')
  })

  it('uses the gateway only when no direct provider is configured', () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-key'
    const provider = getAIProvider()
    expect(provider).toBeInstanceOf(GatewayProvider)
  })

  it('honours AUTHORITY_GATEWAY_MODEL', () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-key'
    process.env.AUTHORITY_GATEWAY_MODEL = 'moonshotai/kimi-k2.6'
    const provider = getAIProvider()
    expect(provider).toBeInstanceOf(GatewayProvider)
    expect((provider as GatewayProvider).modelId).toBe('moonshotai/kimi-k2.6')
  })

  it('falls back to PendingProvider when nothing is configured', () => {
    expect(getAIProvider()).toBeInstanceOf(PendingProvider)
  })
})
