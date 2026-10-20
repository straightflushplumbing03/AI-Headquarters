/**
 * Sprint 5.3 P1: Worker tick endpoint
 *
 * POST /api/jobs/tick  (GET is identical: Vercel Cron invokes routes with GET)
 *
 * The durable execution entry point that does not depend on a browser being
 * open. Drive it with any external scheduler (Vercel Cron, GitHub Actions
 * cron, an uptime pinger, Supabase pg_cron + pg_net, etc.) every minute:
 *
 *   curl -X POST https://<host>/api/jobs/tick -H "Authorization: Bearer $CRON_SECRET"
 *
 * SECURITY:
 * - Requires Authorization: Bearer <CRON_SECRET> (server-side env; never
 *   exposed to clients). Returns 401/403 fail-closed otherwise.
 * - Organization scope is NEVER taken from the request: the scheduler
 *   discovers orgs needing sweeps server-side, and the worker only processes
 *   rows claimed from background_jobs.
 *
 * WHAT ONE TICK DOES:
 *  1. Schedules maintenance jobs (approval sweeps, embedding backfills,
 *     budget reconciliation) and AI Authority jobs (daily collection,
 *     weekly scoring/recommendations, monthly crawl/integration sync) —
 *     idempotent per time bucket, so a frequent cron cannot over-schedule.
 *  2. Claims and processes one worker batch (default 5 jobs).
 *
 * NOTE ON USER-SCOPED ACCESS: handlers run under the anon-key client, so RLS
 * row visibility depends on the policies for background_jobs and the tables
 * handlers touch. All policies in this repo grant access to members of the
 * owning organization; a worker is a system actor and is expected to run with
 * a key that can see queued rows (service client) — pass a service client
 * when constructing BackgroundWorker for cron use, as done below.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { BackgroundWorker } from '@/lib/jobs/worker'
import { MaintenanceScheduler, AuthorityScheduler } from '@/lib/jobs/maintenance'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''

  if (!secret) {
    // Fail-closed: no secret configured => endpoint disabled.
    return NextResponse.json({ error: 'jobs endpoint not configured' }, { status: 503 })
  }
  if (!token || !timingSafeEqual(token, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !(serviceKey || anonKey)) {
    return NextResponse.json({ error: 'supabase not configured' }, { status: 503 })
  }

  // The worker is a system actor. Prefer the service key (RLS bypassed for
  // queue plumbing); fall back to anon when a deployment intentionally runs
  // keyless (claims will simply return nothing it cannot see).
  const client = createClient(url, serviceKey ?? anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const scheduler = new MaintenanceScheduler(client)
  const authorityScheduler = new AuthorityScheduler(client)
  const worker = new BackgroundWorker(client, { jobTimeoutMs: 45_000 })

  const [approvalSweeps, embeddingBackfills, budgetReconciliation, authority] = await Promise.all([
    scheduler.scheduleApprovalSweeps(),
    scheduler.scheduleEmbeddingBackfills(),
    scheduler.scheduleBudgetReconciliation(),
    // Authority scheduling is bucket-idempotent, so running the tick every
    // minute still produces at most one collection per day, one scoring pass
    // per week, and one crawl per month.
    authorityScheduler.scheduleAll(),
  ])

  const batch = await worker.processBatch()

  return NextResponse.json({
    ok: true,
    maintenance: { approvalSweeps, embeddingBackfills, budgetReconciliation },
    authority,
    worker: batch,
  })
}

// Vercel Cron calls the configured path with GET and sends
// "Authorization: Bearer $CRON_SECRET". Same handler, same fail-closed auth.
export const GET = POST
