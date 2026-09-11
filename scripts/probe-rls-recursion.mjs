/**
 * One-off diagnostic probe (run manually, not part of the test suite):
 * signs in as the RLS-harness USER_A and prints the RAW error for
 * organization_members + a few org tables, to classify the sanity failure.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_TEST_URL
const ANON = process.env.SUPABASE_TEST_ANON_KEY
const EMAIL = 'rls-user-a@aihq-test.local'
const PASSWORD = 'RLS-Test-Passw0rd!'

if (!URL || !ANON) {
  console.error('SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY required')
  process.exit(1)
}

const client = createClient(URL, ANON, { auth: { persistSession: false } })
const { error: signInError } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
console.log('sign-in:', signInError ? `ERROR ${signInError.message}` : 'ok')

for (const table of ['organization_members', 'organizations', 'company_memory', 'audit_logs']) {
  const { data, error } = await client.from(table).select('*').limit(5)
  if (error) console.log(`${table}: ERROR ${error.code ?? ''} ${error.message}`)
  else console.log(`${table}: OK rows=${data?.length ?? 0}`)
}
