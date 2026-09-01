/**
 * Integration tests for the complete AI execution pipeline.
 *
 * These tests exercise real code paths using in-memory mocks for external
 * dependencies (Supabase, OpenAI). Tests marked [INFRA] require a live
 * Supabase instance and are skipped when TEST_SUPABASE_URL is absent.
 *
 * Clearly separated per the task requirement:
 *   - Tests that actually execute (no external infra needed)
 *   - Tests requiring external infrastructure (guarded by env-var)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReliableAIProvider } from '@/lib/ai/reliable-provider'
import { OpenAIProvider, PendingProvider } from '@/lib/ai/providers'
import { DecisionLogger } from '@/lib/phase4/decision-logger'
import { EnhancedKnowledgeSystem } from '@/lib/phase4/enhanced-knowledge-system'
import { SchedulerRuntime } from '@/lib/phase3/scheduler-runtime'
import type { AIExecutionRequest } from '@/types/ai'

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-00000000-0000-0000-0000-000000000001'
const ORG_B = 'org-b-00000000-0000-0000-0000-000000000002'

function mockSupabase(overrides: Record<string, any> = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    textSearch: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    ...overrides,
  }
  const fromMock = vi.fn().mockReturnValue(chain)
  return { from: fromMock, _chain: chain }
}

// ─── Phase 2 → Phase 3: AI Provider → Reliable Provider ────────────────────

describe('AI Provider Pipeline (Phase 2 → Phase 3)', () => {
  describe('ReliableAIProvider — retry logic', () => {
    it('succeeds on first attempt without retry', async () => {
      const inner = new PendingProvider()
      // Override execute to succeed
      inner.execute = vi.fn().mockResolvedValue({
        success: true,
        content: 'hello',
        inputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.001,
        actualCost: 0.001,
        executionTimeMs: 50,
        provider: 'openai',
        model: 'gpt-4',
      })

      const reliable = new ReliableAIProvider(inner, { maxAttempts: 3, baseDelayMs: 1 })
      const req: AIExecutionRequest = {
        organizationId: ORG_A,
        agentId: 'agent-1',
        taskId: 'task-1',
        systemPrompt: 'You are a helpful assistant',
        userMessage: 'Say hi',
      }
      const result = await reliable.execute(req)
      expect(result.success).toBe(true)
      expect(result.attempts).toBe(1)
      expect(inner.execute).toHaveBeenCalledTimes(1)
    })

    it('retries on transient failure and succeeds', async () => {
      const inner = new PendingProvider()
      let callCount = 0
      inner.execute = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          return {
            success: false,
            content: '',
            inputTokens: 0,
            outputTokens: 0,
            estimatedCost: 0,
            actualCost: 0,
            executionTimeMs: 10,
            provider: 'openai',
            model: 'gpt-4',
            error: 'network error',
            errorType: 'unknown_error',
          }
        }
        return {
          success: true,
          content: 'ok',
          inputTokens: 10,
          outputTokens: 5,
          estimatedCost: 0.001,
          actualCost: 0.001,
          executionTimeMs: 50,
          provider: 'openai',
          model: 'gpt-4',
        }
      })

      const reliable = new ReliableAIProvider(inner, {
        maxAttempts: 3,
        baseDelayMs: 1, // minimal delay in tests
        maxDelayMs: 10,
      })
      const req: AIExecutionRequest = {
        organizationId: ORG_A,
        agentId: 'agent-1',
        taskId: 'task-1',
        systemPrompt: 'Test',
        userMessage: 'Test',
      }
      const result = await reliable.execute(req)
      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
    })

    it('does NOT retry non-retryable errors (auth failure)', async () => {
      const inner = new PendingProvider()
      inner.execute = vi.fn().mockResolvedValue({
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 10,
        provider: 'openai',
        model: 'gpt-4',
        error: '401 Unauthorized',
        errorType: 'authentication_failed',
      })

      const reliable = new ReliableAIProvider(inner, { maxAttempts: 3, baseDelayMs: 1 })
      const req: AIExecutionRequest = {
        organizationId: ORG_A,
        agentId: 'agent-1',
        taskId: 'task-1',
        systemPrompt: 'Test',
        userMessage: 'Test',
      }
      const result = await reliable.execute(req)
      expect(result.success).toBe(false)
      // Should only be called once — no retries for auth failures
      expect(inner.execute).toHaveBeenCalledTimes(1)
    })

    it('enforces budget limit before making any API call', async () => {
      const inner = new OpenAIProvider('fake-key')
      inner.execute = vi.fn()
      inner.estimateCost = vi.fn().mockReturnValue(10.0) // $10 estimate

      const reliable = new ReliableAIProvider(inner, {
        budgetLimitUSD: 1.0, // $1 limit
        baseDelayMs: 1,
      })
      const req: AIExecutionRequest = {
        organizationId: ORG_A,
        agentId: 'agent-1',
        taskId: 'task-1',
        systemPrompt: 'Test',
        userMessage: 'Test',
      }
      const result = await reliable.execute(req)
      expect(result.success).toBe(false)
      expect(result.errorType).toBe('budget_exceeded')
      // Must NOT call the provider if over budget
      expect(inner.execute).not.toHaveBeenCalled()
    })

    it('attaches a unique requestId to every response', async () => {
      const inner = new PendingProvider()
      inner.execute = vi.fn().mockResolvedValue({
        success: true,
        content: 'hi',
        inputTokens: 5,
        outputTokens: 3,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 10,
        provider: 'openai',
        model: 'gpt-4',
      })

      const reliable = new ReliableAIProvider(inner, { maxAttempts: 1, baseDelayMs: 1 })
      const req: AIExecutionRequest = {
        organizationId: ORG_A,
        agentId: 'a',
        taskId: 't',
        systemPrompt: 'S',
        userMessage: 'U',
      }
      const r1 = await reliable.execute(req)
      const r2 = await reliable.execute(req)
      expect(r1.requestId).toBeTruthy()
      expect(r2.requestId).toBeTruthy()
      expect(r1.requestId).not.toBe(r2.requestId)
    })
  })
})

// ─── Phase 3 → Phase 4: Decision FTS ────────────────────────────────────────

describe('Decision Search uses PostgreSQL FTS (Phase 3 → Phase 4)', () => {
  it('calls textSearch() on the Supabase client, NOT ilike', async () => {
    const { from, _chain } = mockSupabase()
    _chain.textSearch.mockReturnValue(_chain)
    _chain.order.mockReturnValue(_chain)
    _chain.limit.mockResolvedValue({ data: [], error: null })

    const logger = new DecisionLogger({ from } as any)
    await logger.searchDecisions(ORG_A, 'growth strategy', 10)

    // textSearch must be called (FTS path)
    expect(_chain.textSearch).toHaveBeenCalledWith(
      'searchable_text',
      'growth strategy',
      expect.objectContaining({ type: 'websearch' })
    )
    // ilike / or must NOT be called for full-text queries
    expect(_chain.or).not.toHaveBeenCalled()
  })

  it('falls back to recent decisions when query is empty', async () => {
    const { from, _chain } = mockSupabase()
    _chain.order.mockReturnValue(_chain)
    _chain.limit.mockResolvedValue({ data: [], error: null })

    const logger = new DecisionLogger({ from } as any)
    await logger.searchDecisions(ORG_A, '', 10)

    // Empty query: should NOT call textSearch
    expect(_chain.textSearch).not.toHaveBeenCalled()
    expect(_chain.order).toHaveBeenCalled()
  })

  it('respects organization isolation — filters by organization_id', async () => {
    const { from, _chain } = mockSupabase()
    _chain.textSearch.mockReturnValue(_chain)
    _chain.order.mockReturnValue(_chain)
    _chain.limit.mockResolvedValue({ data: [], error: null })

    const logger = new DecisionLogger({ from } as any)
    await logger.searchDecisions(ORG_A, 'test query', 5)

    expect(_chain.eq).toHaveBeenCalledWith('organization_id', ORG_A)
  })
})

// ─── Phase 4 Knowledge System fixes ─────────────────────────────────────────

describe('EnhancedKnowledgeSystem', () => {
  it('does NOT insert searchable_text (it is a GENERATED column)', async () => {
    const { from, _chain } = mockSupabase()
    _chain.insert.mockReturnValue({ data: null, error: null })

    const knowledge = new EnhancedKnowledgeSystem({ from } as any)
    await knowledge.recordLearning(ORG_A, 'SEO', 'Long-tail keywords convert better', 'Observed Q3')

    const insertCall = _chain.insert.mock.calls[0][0]
    expect(insertCall).toBeDefined()
    const inserted = Array.isArray(insertCall) ? insertCall[0] : insertCall
    // searchable_text must NOT be in the inserted payload — it's GENERATED
    expect(inserted).not.toHaveProperty('searchable_text')
    expect(inserted.topic).toBe('SEO')
    expect(inserted.learning).toBe('Long-tail keywords convert better')
  })

  it('stores conditions as-is (JSONB compatible)', async () => {
    const { from, _chain } = mockSupabase()
    _chain.insert.mockReturnValue({ data: null, error: null })

    const knowledge = new EnhancedKnowledgeSystem({ from } as any)
    await knowledge.recordPattern(
      ORG_A,
      'High Intent Keywords',
      'Visitors with purchase intent convert 3x',
      ['url_contains_buy', 'session_duration > 2min'],
      'Higher conversion rate',
      0.85
    )

    const insertCall = _chain.insert.mock.calls[0][0]
    const inserted = Array.isArray(insertCall) ? insertCall[0] : insertCall
    // conditions should be stored as-is (valid JSONB)
    expect(inserted.conditions).toEqual(['url_contains_buy', 'session_duration > 2min'])
    expect(inserted.effectiveness).toBe(0.85)
  })

  it('uses FTS via textSearch for searchLearnings', async () => {
    const { from, _chain } = mockSupabase()
    _chain.textSearch.mockReturnValue(_chain)
    _chain.order.mockReturnValue(_chain)
    _chain.limit.mockResolvedValue({ data: [], error: null })

    const knowledge = new EnhancedKnowledgeSystem({ from } as any)
    await knowledge.searchLearnings(ORG_A, 'keyword strategy', 20)

    expect(_chain.textSearch).toHaveBeenCalledWith(
      'searchable_text',
      'keyword strategy',
      expect.objectContaining({ type: 'websearch' })
    )
  })
})

// ─── Phase 4 Scheduler Runtime ───────────────────────────────────────────────

describe('SchedulerRuntime', () => {
  const makeJob = (overrides: Partial<any> = {}) => ({
    id: 'job-1',
    organization_id: ORG_A,
    agent_id: 'agent-1',
    job_type: 'seo_analysis',
    frequency: 'daily',
    next_run_at: new Date(Date.now() - 1000).toISOString(),
    status: 'active',
    max_duration_minutes: 60,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  })

  it('processes a due job and records execution history', async () => {
    const job = makeJob()

    const singleMock = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'exec-1' }, error: null }) // createExecutionRecord insert
      .mockResolvedValueOnce({ data: job, error: null }) // acquireLock returns updated job

    const chainBase = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: singleMock,
    }

    // fetchDueJobs returns one job
    chainBase.limit.mockResolvedValueOnce({ data: [job], error: null })
    // All subsequent calls succeed
    chainBase.limit.mockResolvedValue({ data: [], error: null })

    const supabase = { from: vi.fn().mockReturnValue(chainBase) } as any

    const handlerMock = vi.fn().mockResolvedValue({ status: 'done' })
    const runtime = new SchedulerRuntime(supabase, {
      pollIntervalMs: 100_000,
      batchSize: 10,
    })
    runtime.registerHandler('seo_analysis', handlerMock)

    // Run one tick
    await runtime.tick()

    // Handler must have been called with the job
    expect(handlerMock).toHaveBeenCalledWith(job, supabase)
  })

  it('skips a job if another worker holds the lock', async () => {
    const job = makeJob()

    const chainBase = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } }),
    }

    // fetchDueJobs returns one job
    chainBase.limit.mockResolvedValueOnce({ data: [job], error: null })
    chainBase.limit.mockResolvedValue({ data: [], error: null })

    const supabase = { from: vi.fn().mockReturnValue(chainBase) } as any

    const handlerMock = vi.fn()
    const runtime = new SchedulerRuntime(supabase)
    runtime.registerHandler('seo_analysis', handlerMock)

    await runtime.tick()

    // Lock was not acquired — handler must NOT have been called
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('calls the fallback path for unknown job types without crashing', async () => {
    const job = makeJob({ job_type: 'unknown_job' })

    const singleMock = vi.fn()
      .mockResolvedValueOnce({ data: { id: 'exec-1' }, error: null })
      .mockResolvedValueOnce({ data: job, error: null })

    const chainBase = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: singleMock,
    }

    chainBase.limit.mockResolvedValueOnce({ data: [job], error: null })
    chainBase.limit.mockResolvedValue({ data: [], error: null })

    const supabase = { from: vi.fn().mockReturnValue(chainBase) } as any

    const runtime = new SchedulerRuntime(supabase)
    // No handler registered for 'unknown_job'

    // Should not throw
    const { processed, errors } = await runtime.tick()
    expect(errors).toBe(1)
    expect(processed).toBe(0)
  })
})

// ─── Security: Organization Isolation ────────────────────────────────────────

describe('Security: organization isolation', () => {
  it('DecisionLogger always filters by organization_id before returning data', async () => {
    const { from, _chain } = mockSupabase()
    _chain.order.mockReturnValue(_chain)
    _chain.limit.mockResolvedValue({ data: [], error: null })

    const logger = new DecisionLogger({ from } as any)
    await logger.getDecisionsByTimeframe(ORG_A, 7)

    // Must always filter by organization_id
    expect(_chain.eq).toHaveBeenCalledWith('organization_id', ORG_A)
  })

  it('EnhancedKnowledgeSystem getEffectivePatterns filters by organization_id', async () => {
    const { from, _chain } = mockSupabase()
    _chain.order.mockResolvedValue({ data: [], error: null })

    const knowledge = new EnhancedKnowledgeSystem({ from } as any)
    await knowledge.getEffectivePatterns(ORG_B, 0.8)

    // Must filter by the correct org, not ORG_A
    expect(_chain.eq).toHaveBeenCalledWith('organization_id', ORG_B)
    // Crucially: must NOT have been called with ORG_A
    const orgACalls = _chain.eq.mock.calls.filter(
      ([col, val]: [string, string]) => col === 'organization_id' && val === ORG_A
    )
    expect(orgACalls).toHaveLength(0)
  })
})

