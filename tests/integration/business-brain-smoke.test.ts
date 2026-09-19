/**
 * Business Brain live smoke test.
 *
 * Validates the Sprint 5.3 app<->Supabase integration against the live
 * project (znpqosbwdgrtfediqvwt) through the REAL engine code path
 * (AIExecutionService -> BudgetReservationService -> live RPCs).
 *
 * GATED LIKE THE OTHER LIVE SUITES: the whole suite SKIPS unless the smoke
 * env is explicitly set (BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER=1 AND the live
 * Supabase env). Never runs in CI or on a bare `npx vitest run`.
 *
 * Destructive-safe: uses a dedicated org UUID + cleanup in afterAll. Never
 * touches the three production orgs. The AI provider is the env-gated
 * FakeProvider (BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER=1), so no real tokens
 * are consumed and no OPENAI/ANTHROPIC key is required. If the flag is set
 * but the namespace guard refuses the fake (production NODE_ENV), the suite
 * FAILS closed rather than risking a real provider call.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { AIExecutionService } from '@/lib/ai/execution-service'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const FAKE = process.env.BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER === '1'
// Only 'test'/'development'/local app URL are allowed for the fake provider —
// this same gate is enforced inside getAIProvider (fakeProviderAllowed).
// @types/node narrows NODE_ENV to 'development' | 'production' | 'test', but
// the harness also runs with NODE_ENV=smoke. Compare through a widened local so
// the check reflects the runtime value rather than the declared union.
const nodeEnv: string | undefined = process.env.NODE_ENV
const SAFE_FAKE_ENV =
  nodeEnv === 'test' ||
  nodeEnv === 'development' ||
  nodeEnv === 'smoke' ||
  /localhost|127\.0\.0\.1|\.test\.|:3\d{3}/.test(process.env.NEXT_PUBLIC_APP_URL ?? '')
const CONFIGURED = Boolean(FAKE && url && serviceKey)

const ORG = 'f2222222-0000-4000-8000-000000000009'
const AGENT = 'f2222222-0000-4000-8000-00000000000a'
const TASK = 'f2222222-0000-4000-8000-00000000000b'
const TASK2 = 'f2222222-0000-4000-8000-00000000000c'

let supa: SupabaseClient
let engine: AIExecutionService

beforeAll(async () => {
  if (!CONFIGURED) return
  if (!SAFE_FAKE_ENV) {
    throw new Error('SMOKE test refuses untrusted namespace: set NODE_ENV=test (or localhost app URL) to run')
  }
  supa = createClient(url!, serviceKey!, { auth: { persistSession: false } })

  // fixture org + agent + task + budget
  const { error: orgErr } = await supa.from('organizations').insert({
    id: ORG,
    name: 'smoke-test-org',
    slug: 'smoke-test-org',
  })
  if (orgErr) throw orgErr
  const { error: agentErr } = await supa.from('agents').insert({
    id: AGENT,
    organization_id: ORG,
    name: 'smoke-agent',
    active: true,
  })
  if (agentErr) throw agentErr
  const { error: taskErr } = await supa.from('tasks').insert({
    id: TASK,
    organization_id: ORG,
    title: 'smoke-task',
    status: 'pending',
  })
  if (taskErr) throw taskErr

  // Tight budget: first run settles 0.1234, leaving ~0.0766 which is less
  // than the second run's ~0.159 estimate -> deterministic budget rejection.
  const { error: limitsErr } = await supa.from('ai_usage_limits').upsert(
    {
      organization_id: ORG,
      monthly_budget: 0.2,
      current_spend: 0,
      reserved_amount: 0,
      reset_date: '2026-09-11',
    },
    { onConflict: 'organization_id' }
  )
  if (limitsErr) throw limitsErr

  engine = new AIExecutionService(supa)
})

afterAll(async () => {
  // Full cleanup of fixture org. RLS is not an issue for the service role.
  await supa?.from('ai_execution_logs').delete().in('agent_id', [AGENT]).then(() => {})
  await supa?.from('budget_reservations').delete().eq('organization_id', ORG)
  await supa?.from('ai_usage_limits').delete().eq('organization_id', ORG)
  await supa?.from('tasks').delete().eq('id', TASK)
  await supa?.from('agents').delete().eq('id', AGENT)
  await supa?.from('organizations').delete().eq('id', ORG)
})

describe.skipIf(!CONFIGURED)('Business Brain live integration (Sprint 5.3)', () => {
  it('reserves budget, executes fake provider, then settles spend', async () => {
    const res = await engine.execute({
      organizationId: ORG,
      agentId: AGENT,
      taskId: TASK,
      systemPrompt: 'Reserve me a tiny token budget and settle after success.',
      userMessage: 'Execute a deterministic fake AI call so the lifecycle is exercised.',
      maxTokens: 50,
    })

    expect(res.success).toBe(true)
    expect(res.content).toBe('FAKE_OK')
    expect(res.actualCost).toBeGreaterThan(0)

    // Reservation was settled -> status settled + spend booked.
    const { data: row } = await supa
      .from('budget_reservations')
      .select('status, reserved_amount, settled_amount')
      .eq('organization_id', ORG)
      .eq('action_idempotency_key', `exec:${TASK}`)
      .single()
    expect(row?.status).toBe('settled')
    expect(Number(row?.settled_amount)).toBeGreaterThan(0)

    const { data: limits } = await supa
      .from('ai_usage_limits')
      .select('current_spend, reserved_amount')
      .eq('organization_id', ORG)
      .single()
    expect(Number(limits?.current_spend)).toBeGreaterThan(0)
    // reserved_amount is a hold watermark; for a settled run it may equal the
    // settled amount (live engine semantics), so we only assert monotonic spend.
    expect(Number(limits?.reserved_amount)).toBeGreaterThanOrEqual(0)
  })

  it('rejects second execution when budget is exhausted', async () => {
    // monthly_budget is 0.2; first run settled 0.1234, so the remaining
    // ~0.0766 cannot cover this run's ~0.159 estimate.
    const res = await engine.execute({
      organizationId: ORG,
      agentId: AGENT,
      taskId: TASK2, // different idempotency key -> separate reservation
      systemPrompt: 'A very long system prompt to push the estimated cost up: '.repeat(60),
      userMessage: 'x'.repeat(4000),
      maxTokens: 5000,
    })

    // Either the preflight or the reserve rejects (budget exhausted).
    expect(res.success).toBe(false)
    expect(res.errorType).toBe('budget_exceeded')
  })
})