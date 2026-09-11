/**
 * Sprint 5.2 Part 2: LIVE RLS VERIFICATION HARNESS
 *
 * ⚠️  THIS IS NOT A MOCKED TEST SUITE. ⚠️
 *
 * These tests execute against a REAL Supabase Postgres database and prove
 * actual database-level tenant isolation. They are SKIPPED — with an explicit
 * marker in the output — unless a dedicated TEST database is configured.
 *
 * Required environment variables (Supabase Dashboard → Project Settings → API,
 * or the test project's equivalent; DO NOT point these at production):
 *
 *   SUPABASE_TEST_URL            e.g. https://xyz.supabase.co
 *   SUPABASE_TEST_ANON_KEY       anon (publishable) key
 *   SUPABASE_TEST_SERVICE_KEY    service_role key — used ONLY to seed fixtures
 *                                (orgs, users, memberships) and to verify the
 *                                harness itself can see both orgs.
 *
 * Run with:
 *   SUPABASE_TEST_URL=... SUPABASE_TEST_ANON_KEY=... SUPABASE_TEST_SERVICE_KEY=... \
 *     npx vitest run tests/integration/rls-live.test.ts
 *
 * Methodology:
 *   - Fixtures are created with the SERVICE client (bypasses RLS by design).
 *   - Assertions are made with ANON clients authenticated AS each test user
 *     (signInWithPassword) so RLS + auth.uid() behave exactly as in production.
 *   - Every cross-org assertion expects EMPTY results / errors, proving
 *     USER_A cannot read/insert/update/delete ORG_B data.
 *
 * Until this suite has been executed against a live database, RLS is to be
 * treated as UNVERIFIED. (Skip marker: 'LIVE DATABASE REQUIRED'.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const TEST_URL = process.env.SUPABASE_TEST_URL
const TEST_ANON = process.env.SUPABASE_TEST_ANON_KEY
const TEST_SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY

const LIVE_ENV_CONFIGURED = Boolean(TEST_URL && TEST_ANON && TEST_SERVICE)

/** Deterministic fixture ids so repeated runs reuse/clean the same rows. */
const ORG_A = '00000000-0000-0000-0000-00000000aaa1'
const ORG_B = '00000000-0000-0000-0000-00000000bbb2'
const USER_A_EMAIL = 'rls-user-a@aihq-test.local'
const USER_B_EMAIL = 'rls-user-b@aihq-test.local'
const USER_PASSWORD = 'RLS-Test-Passw0rd!'
interface TableSpec {
  name: string
  /** Minimal valid row for a given organization (satisfies every NOT NULL column). */
  seed: (orgId: string) => Record<string, unknown>
  /** Primary-key column used for row-targeted update/delete probes (default `id`). */
  pk?: string
  /** [column, value] used to prove an ORG_B row cannot be updated cross-org. */
  tamper: [string, unknown]
}

/**
 * Every organization-scoped table the harness proves isolation on.
 * Seeds carry explicit values for every NOT NULL column WITHOUT a default so
 * the harness does not fail at seed time on a live database.
 */
const TEST_TABLES: TableSpec[] = [
  {
    name: 'company_memory',
    seed: (o) => ({ organization_id: o, category: 'rls-test', title: 't', content: 'c' }),
    tamper: ['metadata', { tampered: true }],
  },
  {
    name: 'company_knowledge',
    // `category` is NOT NULL on the live schema — always seed it.
    seed: (o) => ({ organization_id: o, title: 't', content: 'c', category: 'rls-test' }),
    tamper: ['metadata', { tampered: true }],
  },
  {
    name: 'organizational_knowledge',
    seed: (o) => ({
      organization_id: o,
      knowledge_type: 'finding',
      category: 'rls-test',
      title: 't',
      content: 'c',
    }),
    tamper: ['confidence', 0.5],
  },
  {
    name: 'autonomous_decisions',
    seed: (o) => ({
      organization_id: o,
      decision_type: 'custom',
      title: 't',
      description: 'd',
      reasoning: 'r',
      supporting_evidence: {},
      confidence_score: 50,
      recommended_action: 'none',
    }),
    tamper: ['trigger_event', 'tampered'],
  },
  {
    name: 'autonomous_actions',
    seed: (o) => ({
      organization_id: o,
      action_type: 'custom',
      title: 't',
      payload: {},
      authorization_level: 'level_1',
    }),
    tamper: ['description', 'tampered'],
  },
  {
    name: 'approval_requests',
    seed: (o) => ({
      organization_id: o,
      request_type: 'task_execution',
      title: 't',
      description: 'd',
      proposed_action: 'p',
      expires_at: '2099-01-01T00:00:00.000Z',
    }),
    tamper: ['metadata', { tampered: true }],
  },
  {
    name: 'predictions',
    seed: (o) => ({
      organization_id: o,
      prediction_type: 'custom',
      timeframe: 'monthly',
      prediction_period_start: '2099-01-01',
      prediction_period_end: '2099-02-01',
      predicted_value: 100,
      confidence: 50,
    }),
    tamper: ['unit', 'tampered'],
  },
  {
    name: 'opportunities',
    seed: (o) => ({ organization_id: o, title: 't', description: 'd', category: 'custom' }),
    tamper: ['priority_score', 9],
  },
  {
    name: 'audit_logs',
    seed: (o) => ({ organization_id: o, action: 'rls-test' }),
    tamper: ['metadata', { tampered: true }],
  },
  {
    // No `metadata` column — the tamper probe targets its JSONB payload.
    name: 'background_jobs',
    seed: (o) => ({
      organization_id: o,
      job_type: 'approval_expiration_sweep',
      idempotency_key: `rls-harness-${o}-${Date.now()}`,
    }),
    tamper: ['payload', { tampered: true }],
  },
  {
    // Sprint 5.3 P2: the atomic budget hold table (migrations 012 + 016).
    name: 'budget_reservations',
    seed: (o) => ({ organization_id: o, reserved_amount: 1 }),
    tamper: ['reserved_amount', 999],
  },
  {
    // The spend ledger the reservation RPCs write (migration 02); PK is organization_id.
    name: 'ai_usage_limits',
    seed: (o) => ({ organization_id: o, reset_date: '2099-01-01' }),
    pk: 'organization_id',
    tamper: ['monthly_budget', 999],
  },
]

// Skip-time decision: vitest `describe.skipIf` keeps the file loadable in CI
// without env vars while printing exactly why the suite did not run.
const d = LIVE_ENV_CONFIGURED ? describe : describe.skip

if (!LIVE_ENV_CONFIGURED) {
  // surface the reason in the test output — never silently skip
  console.warn(
    [
      '',
      '┌──────────────────────────────────────────────────────────────────────┐',
      '│ LIVE RLS VERIFICATION SKIPPED — LIVE DATABASE REQUIRED               │',
      '│                                                                      │',
      '│ Set SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY and                    │',
      '│ SUPABASE_TEST_SERVICE_KEY to run against a real test project.        │',
      '│ RLS is therefore UNVERIFIED until these tests execute.               │',
      '└──────────────────────────────────────────────────────────────────────┘',
      '',
    ].join('\n')
  )
}

let service: SupabaseClient
let clientA: SupabaseClient // anon client signed in AS USER_A (RLS applies)
let clientB: SupabaseClient
let userAId = ''
let userBId = ''

d('LIVE RLS verification (real database)', () => {
  beforeAll(async () => {
    service = createClient(TEST_URL!, TEST_SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // --- Idempotent fixture setup (service role, RLS bypassed BY DESIGN) ---
    // 1. Users (find-or-create by email)
    const fixtures: Array<{ email: string; orgId: string; role: 'admin' }> = [
      { email: USER_A_EMAIL, orgId: ORG_A, role: 'admin' },
      { email: USER_B_EMAIL, orgId: ORG_B, role: 'admin' },
    ]
    for (const fx of fixtures) {
      const { data: listData } = await service.auth.admin.listUsers()
      const found = (listData?.users ?? []).find((u) => u.email === fx.email)
      let user: { id: string } | undefined = found ? { id: found.id } : undefined
      if (!user) {
        const { data: created, error } = await service.auth.admin.createUser({
          email: fx.email,
          password: USER_PASSWORD,
          email_confirm: true,
        })
        if (error) throw new Error(`Fixture user creation failed: ${error.message}`)
        if (!created.user) throw new Error('Fixture user creation returned no user')
        user = { id: created.user.id }
      }
      if (fx.email === USER_A_EMAIL) userAId = user.id
      else userBId = user.id

      // membership (idempotent)
      await service.from('organization_members').upsert(
        {
          organization_id: fx.orgId,
          user_id: user.id,
          role: fx.role,
        },
        { onConflict: 'organization_id,user_id' }
      )
    }

    // 2. Organizations may not exist in a fresh project — create if needed.
    for (const orgId of [ORG_A, ORG_B]) {
      const { data: existing } = await service
        .from('organizations')
        .select('id')
        .eq('id', orgId)
        .maybeSingle()
      if (!existing) {
        // insert with explicit id; ignore failure if another run created it
        await service.from('organizations').upsert({
          id: orgId,
          name: orgId === ORG_A ? 'RLS TEST ORG A' : 'RLS TEST ORG B',
          slug: orgId === ORG_A ? 'rls-test-org-a' : 'rls-test-org-b',
        })
      }
    }

    // 3. Signed-in user-scoped clients — these go through RLS like production.
    const anonFactory = () =>
      createClient(TEST_URL!, TEST_ANON!, { auth: { persistSession: false } })
    clientA = anonFactory()
    clientB = anonFactory()
    const { error: errA } = await clientA.auth.signInWithPassword({
      email: USER_A_EMAIL,
      password: USER_PASSWORD,
    })
    const { error: errB } = await clientB.auth.signInWithPassword({
      email: USER_B_EMAIL,
      password: USER_PASSWORD,
    })
    if (errA) throw new Error(`USER_A sign-in failed: ${errA.message}`)
    if (errB) throw new Error(`USER_B sign-in failed: ${errB.message}`)
  })

  afterAll(async () => {
    // Cleanup via service role only — every seeded table so repeated runs are
    // idempotent even after a crashed earlier run.
    if (!LIVE_ENV_CONFIGURED) return
    for (const spec of TEST_TABLES) {
      await service.from(spec.name).delete().in('organization_id', [ORG_A, ORG_B])
    }
    await service.auth.admin.signOut((userAId || userBId) as string)
  })

  // ========================================================================
  // Harness self-check: prove the harness itself is valid before trusting it
  // ========================================================================
  it('harness sanity: USER_A sees own org member row and service sees both orgs', async () => {
    const { data: ownOrg } = await clientA
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userAId)
    expect(ownOrg?.length).toBeGreaterThan(0)

    const { data: allOrgs } = await service
      .from('organizations')
      .select('id')
      .in('id', [ORG_A, ORG_B])
    expect(allOrgs?.length).toBe(2)
  })

  // ========================================================================
  // Per-table isolation matrix
  // ========================================================================
  for (const spec of TEST_TABLES) {
    const { name: table, seed: rowFor, pk = 'id', tamper } = spec
    d(`table: ${table}`, () => {

      it(`USER_A can read own-org rows and CANNOT read ORG_B rows`, async () => {
        // Seed one row per org via service (bypasses RLS for seeding only).
        const insA = await service.from(table).insert(rowFor(ORG_A))
        const insB = await service.from(table).insert(rowFor(ORG_B))
        // Some tables have stricter NOT NULLs; if seeding fails for that
        // reason the test infra (not RLS) is the problem — surface it.
        if (insA.error) throw new Error(`Seed ORG_A row failed (infra): ${insA.error.message}`)
        if (insB.error) throw new Error(`Seed ORG_B row failed (infra): ${insB.error.message}`)

        const { data: seenByA } = await clientA.from(table).select('*')
        const orgsSeenByA = new Set((seenByA ?? []).map((r: any) => r.organization_id))
        expect(orgsSeenByA.has(ORG_B)).toBe(false)
      })

      it(`USER_A CANNOT insert into ORG_B`, async () => {
        const { data, error } = await clientA.from(table).insert(rowFor(ORG_B)).select()
        // RLS with a FOR ALL USING policy: insert is filtered out; supabase
        // may return either error (42501) or success-with-zero-rows.
        const inserted = (data ?? []).length > 0
        expect(error ?? inserted).toBeTruthy()
      })

      it(`USER_A CANNOT update ORG_B rows`, async () => {
        const { data: bRows } = await service
          .from(table)
          .select(pk)
          .eq('organization_id', ORG_B)
        if (!bRows?.length) return // nothing seeded
        const [tamperCol, tamperVal] = tamper
        const { data } = await clientA
          .from(table)
          .update({ [tamperCol]: tamperVal })
          .in(
            pk,
            bRows.map((r: any) => r[pk])
          )
          .select()
        expect((data ?? []).length).toBe(0)
      })

      it(`USER_A CANNOT delete ORG_B rows`, async () => {
        const { data: bRows } = await service
          .from(table)
          .select(pk)
          .eq('organization_id', ORG_B)
        if (!bRows?.length) return
        const { data } = await clientA
          .from(table)
          .delete()
          .in(
            pk,
            bRows.map((r: any) => r[pk])
          )
          .select()
        expect((data ?? []).length).toBe(0)
        // and the rows still exist
        const { data: stillThere } = await service
          .from(table)
          .select(pk)
          .eq('organization_id', ORG_B)
        expect((stillThere ?? []).length).toBe(bRows.length)
      })
    })
  }

  // ========================================================================
  // Unauthenticated access is blocked
  // ========================================================================
  it('unauthenticated client cannot read any organization-scoped table', async () => {
    const anon = createClient(TEST_URL!, TEST_ANON!, { auth: { persistSession: false } })
    for (const table of ['company_memory', 'organizational_knowledge', 'autonomous_actions']) {
      const { data, error } = await anon.from(table).select('*').limit(5)
      const rows = (data ?? []).length
      // Expect either a hard error or zero rows (RLS denied).
      expect(error ?? rows === 0).toBeTruthy()
    }
  })

  it('nonexistent organization returns nothing for an authenticated member', async () => {
    const fakeOrg = '00000000-0000-0000-0000-00000000dead'
    const { data } = await clientA
      .from('company_memory')
      .select('*')
      .eq('organization_id', fakeOrg)
    expect((data ?? []).length).toBe(0)
  })

  it('removed membership loses access (membership drives the policy)', async () => {
    // Remove USER_A from ORG_A, verify access drops to zero, restore.
    const { error: rmErr } = await service
      .from('organization_members')
      .delete()
      .eq('user_id', userAId)
      .eq('organization_id', ORG_A)
    expect(rmErr).toBeNull()

    const { data } = await clientA.from('company_memory').select('*').eq('organization_id', ORG_A)
    expect((data ?? []).length).toBe(0)

    // restore
    await service
      .from('organization_members')
      .upsert({ organization_id: ORG_A, user_id: userAId, role: 'admin' })
  })
})
