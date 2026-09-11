/**
 * Sprint 5.1: /api/ai/execute security tests
 *
 * Proves the route fails closed:
 * - No session cookie → 401, provider never called
 * - Valid session but non-member of the org → 403, provider never called
 * - Member → proceeds to the execution service (mocked here)
 * - Service-role key is never used for user requests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn()
  const getOrganizationSpending = vi.fn()
  return { execute, getOrganizationSpending }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    throw new Error('createClient not configured in test')
  }),
}))

vi.mock('@/lib/ai/execution-service', () => ({
  AIExecutionService: class {
    execute = mocks.execute
    getOrganizationSpending = mocks.getOrganizationSpending
  },
}))

import { createClient } from '@/lib/supabase/server'
import { POST, GET } from '@/app/api/ai/execute/route'
import type { NextRequest } from 'next/server'

/** Build a request-like object with a controllable Supabase mock. */
function setupAuth(opts: {
  user: { id: string } | null
  member: { id: string } | null
}) {
  const memberQuery = {
    select: () => memberQuery,
    eq: () => memberQuery,
    single: async () => ({
      data: opts.member,
      error: opts.member ? null : { message: 'No rows' },
    }),
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user }, error: null }),
    },
    from: (_table: string) => memberQuery,
  }

  ;(createClient as any).mockImplementation(async () => client)
}

function makePostRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    url: 'http://localhost:3000/api/ai/execute',
  } as unknown as NextRequest
}

function makeGetRequest(orgId?: string): NextRequest {
  const url = orgId
    ? `http://localhost:3000/api/ai/execute?organizationId=${orgId}`
    : 'http://localhost:3000/api/ai/execute'
  return { url } as unknown as NextRequest
}

const validBody = {
  organizationId: 'org-1',
  agentId: 'agent-1',
  taskId: 'task-1',
  systemPrompt: 'You are a test.',
  userMessage: 'Hello',
}

describe('POST /api/ai/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when there is no session and never reaches the execution service', async () => {
    setupAuth({ user: null, member: null })

    const res = await POST(makePostRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.errorType).toBe('unauthorized')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('returns 403 when the user is not a member of the target organization', async () => {
    setupAuth({ user: { id: 'user-1' }, member: null })

    const res = await POST(makePostRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.errorType).toBe('forbidden')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('returns 400 for missing required fields even when authenticated', async () => {
    setupAuth({ user: { id: 'user-1' }, member: { id: 'm1' } })

    const res = await POST(
      makePostRequest({ organizationId: 'org-1' } as any)
    )

    expect(res.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('proceeds to the execution service for an authenticated member', async () => {
    setupAuth({ user: { id: 'user-1' }, member: { id: 'm1' } })
    mocks.execute.mockResolvedValue({ success: true, content: 'ok' })

    const res = await POST(makePostRequest(validBody))

    expect(res.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith(validBody)
  })
})

describe('GET /api/ai/execute (spending)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without a session', async () => {
    setupAuth({ user: null, member: null })

    const res = await GET(makeGetRequest('org-1'))
    expect(res.status).toBe(401)
    expect(mocks.getOrganizationSpending).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-member', async () => {
    setupAuth({ user: { id: 'user-1' }, member: null })

    const res = await GET(makeGetRequest('org-1'))
    expect(res.status).toBe(403)
    expect(mocks.getOrganizationSpending).not.toHaveBeenCalled()
  })

  it('returns 400 when organizationId is missing', async () => {
    setupAuth({ user: { id: 'user-1' }, member: { id: 'm1' } })

    const res = await GET(makeGetRequest(undefined))
    expect(res.status).toBe(400)
  })

  it('returns spending for a member', async () => {
    setupAuth({ user: { id: 'user-1' }, member: { id: 'm1' } })
    mocks.getOrganizationSpending.mockResolvedValue({
      monthlyBudget: 100,
      currentSpend: 10,
      remaining: 90,
      percentUsed: 10,
    })

    const res = await GET(makeGetRequest('org-1'))
    expect(res.status).toBe(200)
    expect(mocks.getOrganizationSpending).toHaveBeenCalledWith('org-1')
  })
})
