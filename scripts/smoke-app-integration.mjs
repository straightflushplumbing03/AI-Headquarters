#!/usr/bin/env node
/**
 * S53-APP-INTEGRATION smoke test — Business Brain workflow against the LIVE test project.
 *
 * Proves the app's own integration path (not just raw SQL):
 *   S1  Service-side user provisioning (auth admin API)
 *   S2  Real sign-in via anon client (the browser-equivalent path)
 *   S3  Onboarding: create org + owner membership (user client, RLS applies)
 *   S4  Budget provisioning (ai_usage_limits) — founder route equivalent
 *   S5  Hire agent (user client)
 *   S6  Create task (user client)
 *   S7  Company memory write (user client)
 *   S8  Sprint 5.3 budget RPCs exactly as BudgetReservationService calls them
 *       (reserve → idempotent re-reserve → settle clamped → release)
 *   S9  Background job queue exactly as BackgroundJobQueue calls it
 *       (enqueue → dedupe → claim (worker) → complete → verify row)
 *   S10 RLS isolation: a second, non-member user cannot read or write org data
 *   S11 Cleanup (service)
 *
 * Required env (inline only — never written to files, never echoed):
 *   SMOKE_URL      https://<ref>.supabase.co   (dedicated TEST project ONLY)
 *   SMOKE_ANON     legacy anon JWT (RLS applies — same as the app's anon key)
 *   SMOKE_SERVICE  legacy service_role JWT (fixtures/cleanup/worker only)
 *
 * Usage:
 *   SMOKE_URL=... SMOKE_ANON=... SMOKE_SERVICE=... node scripts/smoke-app-integration.mjs
 */

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SMOKE_URL
const ANON = process.env.SMOKE_ANON
const SERVICE = process.env.SMOKE_SERVICE

if (!URL || !ANON || !SERVICE) {
  console.error('SMOKE_URL, SMOKE_ANON and SMOKE_SERVICE are required (inline env only).')
  process.exit(2)
}

const service = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

const results = []
let currentLayer = 'UNKNOWN'
let cleanupFns = []

function step(id, name, layer, fn) {
  currentLayer = layer
  return (async () => {
    try {
      const detail = await fn()
      results.push({ id, name, ok: true, layer, detail: detail ?? '' })
      console.log(`PASS ${id} ${name}${detail ? ' — ' + detail : ''}`)
    } catch (err) {
      const msg = err?.message || String(err)
      results.push({ id, name, ok: false, layer, detail: msg })
      console.error(`FAIL ${id} ${name} [${layer}] — ${msg}`)
    }
  })()
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const ts = Date.now()
  const OWNER_EMAIL = `smoke-owner-${ts}@smoke-test.invalid`
  const INTRUDER_EMAIL = `smoke-intruder-${ts}@smoke-test.invalid`
  const PASSWORD = `Sx${ts}!vB${Math.random().toString(36).slice(2, 10)}qZ`
  const ORG_NAME = `Smoke Test Org ${ts}`
  const ORG_SLUG = `smoke-test-org-${ts}`

  let owner, ownerId, intruderId, orgId, agentId, taskId, jobId

  // ---------------------------------------------------------------- S1 auth
  await step('S1', 'provision users (auth admin)', 'AUTH', async () => {
    const o = await service.auth.admin.createUser({
      email: OWNER_EMAIL, password: PASSWORD, email_confirm: true,
    })
    assert(o.data?.user?.id, `owner create failed: ${o.error?.message ?? 'no user'}`)
    ownerId = o.data.user.id
    cleanupFns.push(() => service.auth.admin.deleteUser(ownerId))

    const i = await service.auth.admin.createUser({
      email: INTRUDER_EMAIL, password: PASSWORD, email_confirm: true,
    })
    assert(i.data?.user?.id, `intruder create failed: ${i.error?.message ?? 'no user'}`)
    intruderId = i.data.user.id
    cleanupFns.push(() => service.auth.admin.deleteUser(intruderId))
    return `owner=${ownerId.slice(0, 8)}… intruder=${intruderId.slice(0, 8)}…`
  })

  // ---------------------------------------------------------------- S2 signin
  await step('S2', 'real sign-in via anon client (browser path)', 'AUTH', async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } })
    const { data, error } = await anon.auth.signInWithPassword({ email: OWNER_EMAIL, password: PASSWORD })
    assert(!error, `sign-in failed: ${error?.message}`)
    const u = await anon.auth.getUser()
    assert(u.data?.user?.id === ownerId, 'session user id mismatch')
    owner = anon
    return 'session cookie-equivalent established'
  })

  // ---------------------------------------------------------------- S3 onboarding
  await step('S3', 'onboarding: create_organization RPC + owner bootstrap (app path)', 'RPC', async () => {
    // Mirrors the fixed app flow (app/onboarding/create-org/page.tsx):
    // one atomic RPC creates the org AND the first owner membership.
    const rpc = await owner.rpc('create_organization', { p_name: ORG_NAME, p_slug: ORG_SLUG })
    assert(!rpc.error, `create_organization failed: ${rpc.error?.message}`)
    orgId = rpc.data
    assert(!!orgId, 'create_organization returned no org id')
    cleanupFns.push(() => service.from('organizations').delete().eq('id', orgId))

    // Verify the bootstrap membership actually landed (owner can now read members).
    const mem = await owner.from('organization_members')
      .select('role').eq('organization_id', orgId).eq('user_id', ownerId).single()
    assert(!mem.error, `owner membership not visible after bootstrap: ${mem.error?.message}`)
    assert(mem.data?.role === 'owner', `expected role owner, got ${mem.data?.role}`)
    return `org=${orgId.slice(0, 8)}… role=owner`
  })

  // ---------------------------------------------------------------- S4 budget row
  await step('S4', 'provision ai_usage_limits (founder budget route equivalent)', 'DB', async () => {
    const { error } = await service.from('ai_usage_limits').upsert({
      organization_id: orgId, monthly_budget: 50, current_spend: 0, reserved_amount: 0, paused: false,
      reset_date: new Date().toISOString().slice(0, 10),
    })
    assert(!error, `ai_usage_limits upsert failed: ${error?.message}`)
    return 'monthly_budget=50'
  })

  // ---------------------------------------------------------------- S5 agent
  await step('S5', 'hire agent (user client)', 'RLS', async () => {
    const ins = await owner.from('agents').insert({
      organization_id: orgId, name: 'Smoke Agent', active: true,
    }).select('id').single()
    assert(!ins.error, `agents insert failed: ${ins.error?.message}`)
    agentId = ins.data.id
    return `agent=${agentId.slice(0, 8)}…`
  })

  // ---------------------------------------------------------------- S6 task
  await step('S6', 'create task (user client)', 'RLS', async () => {
    const ins = await owner.from('tasks').insert({
      organization_id: orgId, agent_id: agentId, title: 'Smoke task', status: 'pending',
    }).select('id').single()
    assert(!ins.error, `tasks insert failed: ${ins.error?.message}`)
    taskId = ins.data.id
    return `task=${taskId.slice(0, 8)}…`
  })

  // ---------------------------------------------------------------- S7 memory
  await step('S7', 'write company memory (user client)', 'RLS', async () => {
    const ins = await owner.from('company_memory').insert({
      organization_id: orgId, category: 'smoke', title: 'Smoke memory',
      content: 'Integration smoke test memory row', importance: 0.5, status: 'active',
    })
    assert(!ins.error, `company_memory insert failed: ${ins.error?.message}`)
    return 'memory row inserted'
  })

  // ---------------------------------------------------------------- S8 budget RPCs (app path)
  await step('S8', 'Sprint 5.3 budget RPCs as BudgetReservationService calls them', 'RPC', async () => {
    const actionKey = `smoke:exec:${taskId}`
    const r1 = await owner.rpc('reserve_budget_idempotent', {
      p_organization_id: orgId, p_agent_id: agentId, p_task_id: taskId,
      p_amount: 5, p_action_idempotency_key: actionKey, p_reference: 'smoke',
    })
    assert(!r1.error, `reserve failed: ${r1.error?.message}`)
    const resId = r1.data
    assert(!!resId, 'reserve returned no id')

    const r2 = await owner.rpc('reserve_budget_idempotent', {
      p_organization_id: orgId, p_agent_id: agentId, p_task_id: taskId,
      p_amount: 5, p_action_idempotency_key: actionKey, p_reference: 'smoke',
    })
    assert(!r2.error, `re-reserve failed: ${r2.error?.message}`)
    assert(r2.data === resId, 'idempotent reserve returned a different hold')

    const s = await owner.rpc('settle_budget_clamped', {
      p_reservation_id: resId, p_organization_id: orgId, p_actual_amount: 2,
    })
    assert(!s.error, `settle failed: ${s.error?.message}`)
    assert(s.data === true, 'settle returned false')

    const lim = await service.from('ai_usage_limits').select('current_spend').eq('organization_id', orgId).single()
    assert(!lim.error, `limits read failed: ${lim.error?.message}`)
    assert(Number(lim.data.current_spend) === 2, `current_spend expected 2, got ${lim.data.current_spend}`)

    const r3 = await owner.rpc('reserve_budget_idempotent', {
      p_organization_id: orgId, p_agent_id: agentId, p_task_id: taskId,
      p_amount: 4, p_action_idempotency_key: actionKey + ':second', p_reference: 'smoke',
    })
    assert(!r3.error, `second reserve failed: ${r3.error?.message}`)
    const rel = await owner.rpc('release_budget', {
      p_reservation_id: r3.data, p_organization_id: orgId,
    })
    assert(!rel.error, `release failed: ${rel.error?.message}`)
    assert(rel.data === true, 'release returned false')

    return `hold ${String(resId).slice(0, 8)}… reserved→settled $2, second hold released`
  })

  // ---------------------------------------------------------------- S9 job queue (app path)
  await step('S9', 'background job enqueue→dedupe→claim→complete as BackgroundJobQueue calls it', 'QUEUE', async () => {
    const idem = `smoke-sweep-${taskId}`
    // Mirrors the FIXED BackgroundJobQueue.enqueue (lib/jobs/queue.ts):
    // .select('id') without .single(); an empty array means the conflict was
    // ignored (dedupe path) and the existing row must be looked up.
    const en = await owner.from('background_jobs').upsert({
      organization_id: orgId, job_type: 'approval_expiration_sweep', idempotency_key: idem,
      payload: {}, status: 'pending', created_by: ownerId,
    }, { onConflict: 'organization_id,job_type,idempotency_key', ignoreDuplicates: true })
      .select('id')
    assert(!en.error, `enqueue failed: ${en.error?.message}`)
    jobId = en.data?.[0]?.id ?? null

    if (!jobId) {
      const ex = await owner.from('background_jobs').select('id')
        .eq('organization_id', orgId).eq('job_type', 'approval_expiration_sweep')
        .eq('idempotency_key', idem).single()
      jobId = ex.data.id
    }

    const en2 = await owner.from('background_jobs').upsert({
      organization_id: orgId, job_type: 'approval_expiration_sweep', idempotency_key: idem,
      payload: {}, status: 'pending', created_by: ownerId,
    }, { onConflict: 'organization_id,job_type,idempotency_key', ignoreDuplicates: true })
      .select('id')
    assert(!en2.error, `duplicate enqueue errored: ${en2.error?.message}`)
    assert(Array.isArray(en2.data) && en2.data.length === 0, 'duplicate enqueue was not deduplicated (rows returned)')

    const cl = await service.rpc('claim_background_jobs', {
      p_worker_id: 'smoke-worker', p_batch_size: 5, p_lease_seconds: 300,
    })
    assert(!cl.error, `claim failed: ${cl.error?.message}`)
    const claimed = (cl.data ?? []).find((j) => j.id === jobId)
    assert(!!claimed, 'enqueued job was not claimed by worker')

    const co = await service.rpc('complete_background_job', {
      p_job_id: jobId, p_organization_id: orgId, p_result: { expired: 0, sweptAt: new Date().toISOString() },
    })
    assert(!co.error, `complete failed: ${co.error?.message}`)
    assert(co.data === true, 'complete returned false')

    const row = await service.from('background_jobs').select('status').eq('id', jobId).single()
    assert(row.data?.status === 'completed', `job status expected completed, got ${row.data?.status}`)
    return `job ${jobId.slice(0, 8)}… completed`
  })

  // ---------------------------------------------------------------- S10 RLS isolation
  await step('S10', 'RLS isolation: non-member user denied cross-org access', 'RLS', async () => {
    const intruder = createClient(URL, ANON, { auth: { persistSession: false } })
    const si = await intruder.auth.signInWithPassword({ email: INTRUDER_EMAIL, password: PASSWORD })
    assert(!si.error, `intruder sign-in failed: ${si.error?.message}`)

    const read = await intruder.from('organizations').select('id').eq('id', orgId)
    assert(!read.error, `cross-org read errored (should be filtered): ${read.error?.message}`)
    assert((read.data ?? []).length === 0, 'intruder could READ the org — RLS broken')

    const readTasks = await intruder.from('tasks').select('id').eq('organization_id', orgId)
    assert(!readTasks.error, `cross-org task read errored: ${readTasks.error?.message}`)
    assert((readTasks.data ?? []).length === 0, 'intruder could READ tasks — RLS broken')

    const write = await intruder.from('agents').insert({
      organization_id: orgId, name: 'Intruder Agent', active: true,
    })
    if (!write.error) {
      const check = await service.from('agents').select('id').eq('organization_id', orgId).eq('name', 'Intruder Agent')
      assert((check.data ?? []).length === 0, 'intruder INSERT landed — RLS WITH CHECK broken')
    }

    const rpcProbe = await intruder.rpc('reserve_budget_idempotent', {
      p_organization_id: orgId, p_agent_id: agentId, p_task_id: taskId,
      p_amount: 1, p_action_idempotency_key: 'intruder-key', p_reference: 'intruder',
    })
    if (!rpcProbe.error && rpcProbe.data) {
      await service.rpc('release_budget', { p_reservation_id: rpcProbe.data, p_organization_id: orgId })
      throw new Error('intruder could RESERVE budget for a foreign org — isolation broken')
    }
    return 'reads filtered, writes blocked, RPC scoped'
  })

  // ---------------------------------------------------------------- S11 owner reads own spend
  await step('S11', 'owner can read own org spend (member visibility)', 'RLS', async () => {
    const r = await owner.from('ai_usage_limits').select('current_spend,monthly_budget').eq('organization_id', orgId).single()
    assert(!r.error, `owner limits read failed: ${r.error?.message}`)
    return `spend=$${r.data.current_spend}/$${r.data.monthly_budget}`
  })
}

main().catch((err) => {
  results.push({ id: 'RUN', name: 'smoke harness', ok: false, layer: 'HARNESS', detail: err?.message ?? String(err) })
}).finally(async () => {
  // ------------------------------------------------------------- S12 cleanup
  for (const fn of cleanupFns.reverse()) {
    try { await fn() } catch { /* best effort */ }
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n=== SMOKE SUMMARY ===')
  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.id} ${r.name}${r.ok ? '' : `\n    layer=${r.layer}: ${r.detail}`}`)
  }
  const passed = results.filter((r) => r.ok).length
  console.log(`\n${passed}/${results.length} steps passed`)
  process.exit(failed.length ? 1 : 0)
})
