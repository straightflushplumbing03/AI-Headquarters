/**
 * Sprint 5.3 P2: LIVE budget concurrency verification
 *
 * ⚠️  LIVE DATABASE REQUIRED — SKIPPED WITHOUT TEST ENV. ⚠️
 *
 * Unit tests (tests/unit/budget-reservation.test.ts) simulate the Postgres
 * RPC semantics. This suite proves the REAL database enforces the budget
 * invariant under true concurrency — the mock cannot prove row-lock
 * behavior, so until this file has been executed against a real Postgres,
 * atomic reservation is IMPLEMENTED + UNIT TESTED but NOT runtime-verified.
 *
 * Required environment variables (dedicated TEST database ONLY — never
 * production; migrations 012 + 015 + 016 must be applied):
 *
 *   SUPABASE_TEST_URL            e.g. https://xyz.supabase.co
 *   SUPABASE_TEST_SERVICE_KEY    service_role key — used ONLY to seed
 *                                fixtures (orgs, budget rows) and to clean up.
 *
 * Run with:
 *   SUPABASE_TEST_URL=... SUPABASE_TEST_SERVICE_KEY=... \
 *     npx vitest run tests/integration/budget-concurrency-live.test.ts
 *
 * What is proven (against real Postgres):
 *   - reserve_budget_idempotent() serializes concurrent reserves via
 *     FOR UPDATE: two $8 reserves against a $10 budget → exactly one wins.
 *   - Idempotency: the same action key returns the SAME reservation id.
 *   - settle_budget_clamped(): charge is clamped to the hold; a settlement
 *     above the hold cannot increase available budget.
 *   - release_budget(): idempotent failure path.
 *   - release_stale_budget_reservations(): reaps only aged holds.
 *
 * The service-role client bypasses RLS BY DESIGN here: the invariant under
 * test is budget ATOMICITY (database-level), not tenant isolation (already
 * covered by tests/integration/rls-live.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const TEST_URL = process.env.SUPABASE_TEST_URL
const TEST_SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY

const LIVE_ENV_CONFIGURED = Boolean(TEST_URL && TEST_SERVICE)

// Deterministic fixture ids (uuid v5-style fixed constants) so repeated runs
// reuse/clean the same rows.
const ORG = '00000000-0000-0000-0000-00000000c0de'
const MONTHLY_BUDGET = 10

let service: SupabaseClient

async function cleanup(): Promise<void> {
  await service.from('budget_reservations').delete().eq('organization_id', ORG)
  await service.from('ai_usage_limits').delete().eq('organization_id', ORG)
}

beforeAll(async () => {
  if (!LIVE_ENV_CONFIGURED) return
  service = createClient(TEST_URL!, TEST_SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await cleanup()
})

afterAll(async () => {
  if (!LIVE_ENV_CONFIGURED) return
  await cleanup()
  await service.from('organizations').delete().eq('id', ORG)
})

describe.skipIf(!LIVE_ENV_CONFIGURED)('LIVE budget concurrency (real Postgres)', () => {
  it('seeded org with $10 budget', async () => {
    // The org row must exist first: ai_usage_limits.organization_id is an FK
    // to organizations(id) and the budget RPCs fail closed on NO_BUDGET_ROW.
    await service.from('organizations').upsert({
      id: ORG,
      name: 'BUDGET LIVE TEST ORG',
      slug: 'budget-live-test-org',
    })
    const { error } = await service.from('ai_usage_limits').upsert({
      organization_id: ORG,
      monthly_budget: MONTHLY_BUDGET,
      current_spend: 0,
      reset_date: new Date().toISOString().slice(0, 10),
      paused: false,
    })
    expect(error).toBeNull()
  })

  it('MANDATORY: two concurrent $8 reserves against $10 — exactly ONE wins', async () => {
    const reserve = (key: string) =>
      service.rpc('reserve_budget_idempotent', {
        p_organization_id: ORG,
        p_agent_id: null,
        p_task_id: null,
        p_amount: 8,
        p_action_idempotency_key: key,
      })

    // Fire truly concurrently.
    const [a, b] = await Promise.allSettled([reserve('live-concurrent-A'), reserve('live-concurrent-B')])

    const winners = [a, b].filter((r) => r.status === 'fulfilled' && r.value.data)
    const losers = [a, b].filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)
    )

    expect(winners.length).toBe(1)
    expect(losers.length).toBe(1)
    if (losers[0].status === 'fulfilled') {
      expect(losers[0].value.error?.message).toContain('BUDGET_EXCEEDED')
    } else {
      expect(String(losers[0].reason)).toContain('BUDGET_EXCEEDED')
    }

    // Exactly one open hold, of $8.
    const { data: holds } = await service
      .from('budget_reservations')
      .select('id, reserved_amount, status')
      .eq('organization_id', ORG)
      .eq('status', 'reserved')
    expect(holds?.length).toBe(1)
    expect(Number(holds?.[0]?.reserved_amount)).toBe(8)

    // Cleanup for the next case.
    await service.from('budget_reservations').delete().eq('organization_id', ORG)
  })

  it('idempotent reserve: the same action key returns the SAME reservation id', async () => {
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
    await service.from('budget_reservations').delete().eq('organization_id', ORG)
  })

  it('settlement is CLAMPED: a $999 actual against a $5 hold charges exactly $5', async () => {
    const reserve = await service.rpc('reserve_budget_idempotent', {
      p_organization_id: ORG,
      p_agent_id: null,
      p_task_id: null,
      p_amount: 5,
      p_action_idempotency_key: 'live-clamp-1',
    })
    expect(reserve.error).toBeNull()

    const settled = await service.rpc('settle_budget_clamped', {
      p_reservation_id: reserve.data,
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
    expect(Number(budget?.current_spend)).toBe(5) // clamped, NOT 999

    // Idempotent: re-settle is a no-op and does not double-charge.
    const again = await service.rpc('settle_budget_clamped', {
      p_reservation_id: reserve.data,
      p_organization_id: ORG,
      p_actual_amount: 999,
    })
    expect(again.data).toBe(false)
    const { data: budget2 } = await service
      .from('ai_usage_limits')
      .select('current_spend')
      .eq('organization_id', ORG)
      .single()
    expect(Number(budget2?.current_spend)).toBe(5)
    await service.from('budget_reservations').delete().eq('organization_id', ORG)
    await service.from('ai_usage_limits').update({ current_spend: 0 }).eq('organization_id', ORG)
  })

  it('negative settlement is rejected (fail-closed)', async () => {
    const reserve = await service.rpc('reserve_budget_idempotent', {
      p_organization_id: ORG,
      p_agent_id: null,
      p_task_id: null,
      p_amount: 5,
      p_action_idempotency_key: 'live-neg-1',
    })
    expect(reserve.error).toBeNull()

    const settled = await service.rpc('settle_budget_clamped', {
      p_reservation_id: reserve.data,
      p_organization_id: ORG,
      p_actual_amount: -1,
    })
    expect(settled.error?.message).toContain('INVALID_SETTLEMENT_AMOUNT')
    await service.from('budget_reservations').delete().eq('organization_id', ORG)
  })

  it('release is idempotent; reaper releases only aged holds', async () => {
    const reserve = await service.rpc('reserve_budget_idempotent', {
      p_organization_id: ORG,
      p_agent_id: null,
      p_task_id: null,
      p_amount: 2,
      p_action_idempotency_key: 'live-release-1',
    })
    expect(reserve.error).toBeNull()

    const released = await service.rpc('release_budget', {
      p_reservation_id: reserve.data,
      p_organization_id: ORG,
    })
    expect(released.data).toBe(true)
    // Second release: no-op.
    const again = await service.rpc('release_budget', {
      p_reservation_id: reserve.data,
      p_organization_id: ORG,
    })
    expect(again.data).toBe(false)

    // Reaper with a huge age releases nothing fresh; backdate then reap.
    const fresh = await service.rpc('reserve_budget_idempotent', {
      p_organization_id: ORG,
      p_agent_id: null,
      p_task_id: null,
      p_amount: 2,
      p_action_idempotency_key: 'live-reap-1',
    })
    expect(fresh.error).toBeNull()
    const reapNone = await service.rpc('release_stale_budget_reservations', {
      p_organization_id: ORG,
      p_max_age_seconds: 60 * 60,
    })
    expect(reapNone.data).toBe(0)

    await service
      .from('budget_reservations')
      .update({ created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() })
      .eq('id', fresh.data)
    const reaped = await service.rpc('release_stale_budget_reservations', {
      p_organization_id: ORG,
      p_max_age_seconds: 60 * 60,
    })
    expect(reaped.data).toBe(1)
  })
})
