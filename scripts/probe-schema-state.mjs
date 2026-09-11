/**
 * One-off diagnostic probe (run manually, not part of the test suite):
 * uses the service client to check which org tables and Sprint 5.x SQL
 * functions exist on the test database, so we know exactly which migrations
 * still need to be applied.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_TEST_URL
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY
if (!URL || !SERVICE) {
  console.error('SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY required')
  process.exit(1)
}

const service = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Fetch the REST API surface (tables + views + rpc names).
const res = await fetch(`${URL}/rest/v1/`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
})
const spec = await res.json()

const wantTables = [
  'organizations', 'organization_members', 'departments', 'agents', 'tasks',
  'activity_events', 'company_memory', 'company_knowledge',
  'organizational_knowledge', 'autonomous_decisions', 'autonomous_actions',
  'approval_requests', 'predictions', 'opportunities', 'audit_logs',
  'background_jobs', 'budget_reservations', 'ai_usage_limits', 'system_flags',
]
console.log('== TABLES ==')
for (const t of wantTables) {
  console.log(`${spec.definitions?.[t] ? 'EXISTS' : 'MISSING'}  ${t}`)
}

console.log('== FUNCTIONS (RPC) ==')
const wantRpcs = [
  'reserve_budget', 'reserve_budget_idempotent', 'settle_budget',
  'settle_budget_clamped', 'release_budget', 'release_stale_budget_reservations',
  'claim_background_jobs', 'complete_background_job', 'fail_background_job',
  'requeue_dead_background_job', 'is_global_kill_switch_enabled',
]
for (const f of wantRpcs) {
  console.log(`${spec.definitions?.['pg_function'] ? '' : ''}${spec.paths?.[`/rpc/${f}`] ? 'EXISTS' : 'MISSING'}  ${f}`)
}
