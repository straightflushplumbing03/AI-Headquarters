import { describe, it, expect } from 'vitest'
import { OpenAIProvider, PendingProvider } from '@/lib/ai/providers'
import type { AIExecutionRequest } from '@/types/ai'

describe('AI Providers', () => {
  describe('OpenAIProvider', () => {
    it('should initialize with API key', () => {
      const provider = new OpenAIProvider('test-key')
      expect(provider.isConfigured).toBe(true)
      expect(provider.status).toBe('active')
    })

    it('should initialize without API key', () => {
      const provider = new OpenAIProvider()
      expect(provider.isConfigured).toBe(false)
      expect(provider.status).toBe('pending')
    })

    it('should calculate cost correctly', () => {
      const provider = new OpenAIProvider('test-key')
      const cost = provider.estimateCost(1000, 500)
      // 1000 tokens @ $0.01/1K = $0.01
      // 500 tokens @ $0.03/1K = $0.015
      // Total = $0.025
      expect(cost).toBeCloseTo(0.025, 3)
    })

    it('should throw error when executing without API key', async () => {
      const provider = new OpenAIProvider()
      const request: AIExecutionRequest = {
        organizationId: 'test-org',
        agentId: 'test-agent',
        taskId: 'test-task',
        systemPrompt: 'Test',
        userMessage: 'Test',
      }

      const result = await provider.execute(request)
      expect(result.success).toBe(false)
      expect(result.error).toContain('not configured')
    })
  })

  describe('PendingProvider', () => {
    it('should always return not configured', () => {
      const provider = new PendingProvider()
      expect(provider.isConfigured).toBe(false)
      expect(provider.status).toBe('pending')
    })

    it('should return pending message on execution', async () => {
      const provider = new PendingProvider()
      const request: AIExecutionRequest = {
        organizationId: 'test-org',
        agentId: 'test-agent',
        taskId: 'test-task',
        systemPrompt: 'Test',
        userMessage: 'Test',
      }

      const result = await provider.execute(request)
      expect(result.success).toBe(false)
      expect(result.content).toContain('BUSINESS BRAIN')
    })
  })
})
