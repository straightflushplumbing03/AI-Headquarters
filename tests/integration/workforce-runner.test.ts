/**
 * End-to-end: the real runner + executors against a LOCAL Postgres with
 * migrations 025-027 applied (scripts/apply-migrations-local.sh). The runner
 * talks to the database as the service role, exactly as in production; the
 * owner-side setup runs as the database owner.
 *
 *   WORKFORCE_TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run tests/integration/workforce-runner.test.ts
 *
 * Skipped without that variable; refuses any non-localhost database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { runWorkforceBatch, type Executor } from '@/lib/workforce/runner'
import { reportExecutor, makeSiteAuditExecutor } from '@/lib/workforce/executors'
import type { WorkforceClient } from '@/lib/workforce/service'

const url = process.env.WORKFORCE_TEST_DATABASE_URL
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)

/** Minimal supabase-js-shaped client: rpc() only, which is all the runner uses. */
function rpcClient(pg: Client): WorkforceClient {
  return {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      if (!/^[a-z_]+$/.test(fn)) throw new Error('bad function name')
      const keys = Object.keys(args)
      const sql = `SELECT ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`
      const values = keys.map((k) => {
        const v = args[k]
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
      })
      try {
        const res = await pg.query(sql, values)
        return { data: res.rows[0]?.r ?? null, error: null }
      } catch (e: any) {
        return { data: null, error: { message: String(e.message) } }
      }
    },
    from() { throw new Error('runner must not query tables directly') },
  }
}

describe.skipIf(!isLocal)('workforce runner (end to end)', () => {
  const owner = new Client({ connectionString: url })
  const agentConn = new Client({ connectionString: url })
  let svc: WorkforceClient
  const org = randomUUID()
  const reporter = randomUUID(), auditor = randomUUID(), noGrant = randomUUID(), gated = randomUUID(), crasher = randomUUID()
  const ids: Record<string, string> = {}

  const createTask = async (agent: string, title: string, tool: string, resource: string, input: object | null = null, priority = 'medium') => {
    const r = await owner.query(
      `SELECT workforce_create_task($1, $2, $3, $4, $5, NULL, $6, NULL, '{}', $7) AS r`,
      [org, agent, title, tool, resource, priority, input ? JSON.stringify(input) : null])
    return r.rows[0].r.task_id as string
  }
  const task = async (id: string) => (await owner.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0]
  const events = async (id: string) =>
    (await owner.query('SELECT event_type, metadata FROM activity_events WHERE task_id = $1 ORDER BY created_at', [id])).rows

  beforeAll(async () => {
    await owner.connect()
    await agentConn.connect()
    await agentConn.query("SET ROLE service_role")
    await agentConn.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)")
    svc = rpcClient(agentConn)

    await owner.query("INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, 'Runner Test Org', 'runner-' || $1::text)", [org])
    await owner.query(
      `INSERT INTO agents (id, organization_id, name, role) VALUES
        ($2, $1, 'Report Agent', 'Analytics'), ($3, $1, 'SEO Auditor', 'SEO'),
        ($4, $1, 'No Grant Agent', 'Ops'), ($5, $1, 'Gated Agent', 'Web'), ($6, $1, 'Crash Agent', 'QA')`,
      [org, reporter, auditor, noGrant, gated, crasher])
    for (const [agent, tool, res, approval] of [
      [reporter, 'report.write', '*', false], [auditor, 'site.audit', 'https://plumbing.example', false],
      [gated, 'website.edit', 'site:main', true], [crasher, 'crash.test', '*', false],
    ] as const) {
      await owner.query('SELECT workforce_grant_permission($1, $2, $3, $4)', [agent, tool, res, approval])
    }

    ids.report = await createTask(reporter, 'Weekly workforce report', 'report.write', 'reports/weekly', { days: 7 }, 'high')
    ids.audit = await createTask(auditor, 'Audit live site', 'site.audit', 'https://plumbing.example', { maxPages: 10 })
    ids.unknown = await createTask(reporter, 'Tool with no executor yet', 'email.send', 'customers')
    ids.denied = await createTask(noGrant, 'Report without a grant', 'report.write', 'reports/x')
    ids.gated = await createTask(gated, 'Edit the homepage title', 'website.edit', 'site:main')
    ids.crash = await createTask(crasher, 'Executor that throws', 'crash.test', 'x')
    ids.badOrigin = await createTask(auditor, 'Audit with bad resource', 'site.audit', 'https://plumbing.example/path')
    await owner.query('SELECT workforce_grant_permission($1, $2, $3, false)', [auditor, 'site.audit', 'https://plumbing.example/path'])
  })

  afterAll(async () => {
    await owner.query('DELETE FROM organizations WHERE id = $1', [org])
    await agentConn.end()
    await owner.end()
  })

  const fetched: string[] = []
  const pages: Record<string, { status: number; body: string }> = {
    'https://plumbing.example/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
    'https://plumbing.example/sitemap.xml': { status: 200, body:
      '<urlset><url><loc>https://plumbing.example/</loc></url><url><loc>https://plumbing.example/leak-detection</loc></url>' +
      '<url><loc>https://evil.example/steal</loc></url></urlset>' },
    'https://plumbing.example/': { status: 200, body:
      '<html><head><title>Leak Detection in Orange County | Straight Flush</title>' +
      '<meta name="description" content="Non-invasive leak detection and slab leak repair across South and Central Orange County, CA. Call today.">' +
      '<link rel="canonical" href="https://plumbing.example/"></head><body><h1>Leak detection</h1></body></html>' },
    'https://plumbing.example/leak-detection': { status: 200, body: '<html><head><title>Hi</title></head><body><h1>a</h1><h1>b</h1></body></html>' },
  }
  const fakeFetch = async (u: string) => {
    fetched.push(u)
    const p = pages[u]
    return new Response(p?.body ?? 'not found', { status: p?.status ?? 404 })
  }
  const businessCase = {
    businessJustification: 'Homepage title is missing the primary service keyword for Orange County.',
    expectedBenefit: 'Better click-through from local search results.',
    declaredRisk: 'low' as const, estimatedCostUsd: 0, rollbackPlan: 'Restore the previous title from the deliverable.',
  }
  const gatedExecutor: Executor = { tool: 'website.edit', businessCase: () => businessCase, run: async () => ({ result: 'unused' }) }
  const crashExecutor: Executor = {
    tool: 'crash.test',
    run: async (ctx) => {
      await ctx.act('crash.test', '*', async () => { throw new Error('upstream API returned 502') })
      return { result: 'unreachable' }
    },
  }

  it('runs a batch: completes, refuses, gates and fails tasks exactly as recorded', async () => {
    const report = await runWorkforceBatch(svc,
      [reportExecutor, makeSiteAuditExecutor(fakeFetch as any), gatedExecutor, crashExecutor], { limit: 20 })
    const by = Object.fromEntries(report.outcomes.map((o) => [o.taskId, o]))

    expect(by[ids.report].outcome).toBe('completed')
    expect(by[ids.audit].outcome).toBe('completed')
    expect(by[ids.unknown].outcome).toBe('no_executor')
    expect(by[ids.denied]).toMatchObject({ outcome: 'denied', detail: 'permission_denied' })
    expect(by[ids.gated].outcome).toBe('waiting_approval')
    expect(by[ids.crash]).toMatchObject({ outcome: 'failed', detail: 'upstream API returned 502' })
    expect(by[ids.badOrigin].outcome).toBe('failed')
    // Highest priority first (among this test's tasks; others may share the database).
    const mine = new Set(Object.values(ids))
    expect(report.outcomes.filter((o) => mine.has(o.taskId))[0].taskId).toBe(ids.report)
  })

  it('stores a verified report deliverable backed by its events', async () => {
    const t = await task(ids.report)
    expect(t.status).toBe('completed')
    expect(t.result).toContain('# Workforce activity report (last 7 days)')
    const d = (await owner.query('SELECT * FROM workforce_deliverables WHERE task_id = $1', [ids.report])).rows
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'report', verified: true })
    const types = (await events(ids.report)).map((e) => e.event_type)
    expect(types).toEqual(expect.arrayContaining([
      'workforce.task_claimed', 'workforce.tool_authorized', 'workforce.tool_succeeded',
      'workforce.deliverable_created', 'workforce.deliverable_verified']))
  })

  it('audits only the granted origin and reports real issues', async () => {
    expect(fetched).not.toContain('https://evil.example/steal')
    expect(fetched.every((u) => u.startsWith('https://plumbing.example/'))).toBe(true)
    const t = await task(ids.audit)
    expect(t.status).toBe('completed')
    expect(t.result).toContain('Pages with no issues: **1** of 2')
    expect(t.result).toContain('| https://plumbing.example/leak-detection | 200 | title too short (2 chars); missing meta description; 2 H1 tags; no canonical |')
    const ok = (await events(ids.audit)).find((e) => e.event_type === 'workforce.tool_succeeded')
    expect(ok.metadata).toMatchObject({ pages_checked: 2, pages_in_sitemap: 2, pages_with_issues: 1 })
  })

  it('leaves untouched what it cannot run, and records refusals', async () => {
    expect((await task(ids.unknown)).status).toBe('queued')
    expect((await task(ids.denied)).status).toBe('queued')
    expect((await events(ids.denied)).some((e) => e.event_type === 'workforce.permission_denied')).toBe(true)
  })

  it('attaches the business case to an approval-gated task and stops', async () => {
    expect((await task(ids.gated)).status).toBe('waiting_approval')
    const ap = (await owner.query('SELECT * FROM approval_requests WHERE task_id = $1', [ids.gated])).rows
    expect(ap).toHaveLength(1)
    expect(ap[0]).toMatchObject({ status: 'pending', declared_risk: 'low', rollback_plan: businessCase.rollbackPlan })
  })

  it('fails a task whose action throws, with the failure recorded', async () => {
    const t = await task(ids.crash)
    expect(t).toMatchObject({ status: 'failed', error: 'upstream API returned 502' })
    const failed = (await events(ids.crash)).find((e) => e.event_type === 'workforce.tool_failed')
    expect(failed.metadata.error).toBe('upstream API returned 502')
  })

  it('recovers a task whose runner died, then gives up after max attempts', async () => {
    const id = await createTask(reporter, 'Stuck task', 'report.write', 'reports/stuck')
    await owner.query("UPDATE tasks SET status = 'working', claimed_at = now() - interval '2 hours', attempt = 1 WHERE id = $1", [id])
    const first = await runWorkforceBatch(svc, [], { limit: 1, maxAttempts: 3 })
    expect(first.recovered.requeued).toBeGreaterThanOrEqual(1)
    expect((await task(id)).status).toBe('queued')

    await owner.query("UPDATE tasks SET status = 'working', claimed_at = now() - interval '2 hours', attempt = 3 WHERE id = $1", [id])
    const second = await runWorkforceBatch(svc, [], { limit: 1, maxAttempts: 3 })
    expect(second.recovered.failed).toBeGreaterThanOrEqual(1)
    expect((await task(id)).status).toBe('failed')
    expect((await events(id)).filter((e) => e.event_type === 'workforce.task_recovered')).toHaveLength(2)
  })

  it('creates one recurring task per week per approval-free grant, never more', async () => {
    const first = await runWorkforceBatch(svc, [], { limit: 1, recurringTools: ['site.audit', 'report.write'] })
    const again = await runWorkforceBatch(svc, [], { limit: 1, recurringTools: ['site.audit', 'report.write'] })
    const rows = (await owner.query(
      "SELECT title, required_tool, required_resource, assigned_by_type FROM tasks WHERE organization_id = $1 AND dedupe_key LIKE 'recurring:%' ORDER BY title",
      [org])).rows
    // The auditor holds two site.audit grants; report.write on '*' is not a recurring target.
    expect(rows.map((r) => r.required_resource).sort()).toEqual(['https://plumbing.example', 'https://plumbing.example/path'])
    expect(rows.every((r) => r.assigned_by_type === 'system' && r.required_tool === 'site.audit')).toBe(true)
    expect(first.scheduled.created).toBeGreaterThanOrEqual(2)
    expect(again.scheduled.created).toBe(0)
  })

  it('refuses the runner functions to signed-in users', async () => {
    const userConn = new Client({ connectionString: url })
    await userConn.connect()
    try {
      await userConn.query('SET ROLE authenticated')
      await expect(userConn.query('SELECT workforce_next_tasks(5)')).rejects.toThrow(/permission denied/)
      await expect(userConn.query(`SELECT workforce_activity_summary('${org}', 7)`)).rejects.toThrow(/permission denied/)
      await expect(userConn.query("SELECT workforce_schedule_recurring(ARRAY['site.audit'])")).rejects.toThrow(/permission denied/)
    } finally {
      await userConn.end()
    }
  })
})
