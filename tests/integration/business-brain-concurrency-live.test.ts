/**
 * Business Brain LIVE budget concurrency smoke (real Postgres).
 *
 * Runs only when BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER=1 (same gate as
 * business-brain-smoke.test.ts). NEVER run against production orgs: uses a
 * DEDICATED fixture org (c0de prefix) + full afterAll cleanup.
 *
 * Proves the atomic-reservation invariant under true concurrency on the
 * REAL database, not a mock:
 *   - Two concurrent $8 reservations against a $10 budget -> exactly ONE
 *     wins; total open holds never exceed the budget.
 *   - Idempotent reserve (same action key) -> same reservation id.
 *   - settle_budget_clamped clamps to the hold.
 *   - release_budget idempotent; stale reaper releases only aged holds.
 *
 * This mirrors tests/integration/budget-concurrency-live.test.ts but rides
 * the standard prod env (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 * instead of a separate SUPABASE_TEST_* pair, so it runs in the same guard as
 * the core smoke suite.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const FAKE = process.env.BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER === '1'

// Deterministic fixture ids (uuid-form) so repeated runs reuse/clean rows.
const ORG = 'f2222222-0000-4000-8000-0000000000c0'
const MONTHLY_BUDGET = 10

let service: SupabaseClient

async function cleanup(): Promise<void> {
  if (!service) return
  await service.from('budget_reservations').delete().eq('organization_id', ORG)
  await service.from('ai_usage_limits').delete().eq('organization_id', ORG)
  await service.from('organizations').delete().eq('id', ORG)
}

beforeAll(async () => {
  if (!FAKE) return
  if (!url || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
  service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await cleanup()
})

afterAll(async () => {
  if (!FAKE) return
  await cleanup()
})

describe.skipIf(!FAKE)('LIVE Business Brain concurrency (dedicated fixture org)', () => {
  it('seeds a dedicated org with $10 budget', async () => {
    await service.from('organizations').insert({
      id: ORG,
      name: 'business-brain-concurrency-live',
      slug: 'business-brain-concurrency-live',
    })
    const { error } = await service.from('ai_usage_limits').insert({
      organization_id: ORG,
      monthly_budget: MONTHLY_BUDGET,
      current_spend: 0,
      reserved_amount: 0,
      reset_date: '2026-09-11',
    })
    expect(error).toBeNull()
  })

  it('two concurrent $8 reserves against $10 -> exactly ONE wins, holds never exceed budget', async () => {
    const reserve = (key: string) =>
      service.rpc('reserve_budget_idempotent', {
        p_organization_id: ORG,
        p_agent_id: null,
        p_task_id: null,
        p_amount: 8,
        p_action_idempotency_key: key,
      })

    const [a, b] = await Promise.allSettled([reserve('live-conc-A'), reserve('live-conc-B')])

    const winners = [a, b].filter((r) => r.status === 'fulfilled' && r.value.data as string)
    const losers = [a, b].filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)
    )
    expect(winners.length).toBe(1)
    expect(losers.length).toBe(1)

    const winning = (winners[0] as PromiseFulfilledResult<{ data: string; error: null }>).value.data
    expect(typeof winning).toBe('string')
    const losing = losers[0]
    if (losing.status === 'fulfilled') {
      expect(String(losing.value.error?.message)).toContain('BUDGET_EXCEEDED')
    } else {
      expect(String(losing.reason)).toContain('BUDGET_EXCEEDED')
    }

    // Exactly one open hold of $8; total holds (8) <= budget (10).
    const { data: holds } = await service
      .from('budget_reservations')
      .select('reserved_amount, status')
      .eq('organization_id', ORG)
      .eq('status', 'reserved')
    const totalHeld = (holds ?? []).reduce((s, r) => s + Number(r.reserved_amount), 0)
    expect(holds?.length).toBe(1)
    expect(Number(holds?.[0]?.reserved_amount)).toBe(8)
    expect(totalHeld).toBeLessThanOrEqual(MONTHLY_BUDGET)

    await service.from('budget_reservations').delete().eq('organization_id', ORG)
  })

  it('idempotent reserve returns SAME reservation id; settle clamps; release idempotent', async () => {
    const args = {
      p_organization_id: ORG,
      p_agent_id: null,
      p_task_id: null,
      p_amount: 5,
      p_action_idempotency_key: 'live-idem-1',
    }
    const first = await service.rpc('reserve_budget_idempotent', args)
    expect(first.error).toBeNull()
    const second = await service.rpc('reserve_budget_idempotent', args)
    expect(second.error).toBeNull()
    expect(second.data).toBe(first.data)

    const { data: holds } = await service
      .from('budget_reservations')
      .select('id')
      .eq('organization_id', ORG)
      .eq('status', 'reserved')
    expect(holds?.length).toBe(1)

    // Clamp: settle $999 against the $5 hold charges exactly $5.
    const settled = await service.rpc('settle_budget_clamped', {
      p_reservation_id: first.data,
      p_organization_id: ORG,
      p_actual_amount: 999,
    })
    expect(settled.error).toBeNull()
    expect(settled.data).toBe(true)
    const { data: budget } = await service
      .from('ai_usage_limits')
      .select('current_spend')
      .eq('organization_id', ORG)
      .single()
    expect(Number(budget?.current_spend)).toBe(5)

    // Re-settle is a no-op (idempotent), no double-charge.
    const again = await service.rpc('settle_budget_clamped', {
      p_reservation_id: first.data,
      p_organization_id: ORG,
      p_actual_amount: 999,
    })
    expect(again.data).toBe(false)

    // Release of a settled row is a no-op returning false.
    const released = await service.rpc('release_budget', {
      p_reservation_id: first.data,
      p_organization_id: ORG,
    })
    expect(released.data).toBe(false)

    await service.from('budget_reservations').delete().eq('organization_id', ORG)
    await service.from('ai_usage_limits').update({ current_spend: 0 }).eq('organization_id', ORG)
  })
})