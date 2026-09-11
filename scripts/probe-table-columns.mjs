/**
 * One-off diagnostic probe (run manually, not part of the test suite):
 * prints the live column list of a table from the linked test project's REST
 * surface, so drift between migrations and the database can be confirmed.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_TEST_URL
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY
if (!URL || !SERVICE) {
  console.error('SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY required')
  process.exit(1)
}

const table = process.argv[2] ?? 'organizations'
const res = await fetch(`${URL}/rest/v1/`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
})
const spec = await res.json()
const props = spec.definitions?.[table]?.properties
if (!props) {
  console.log(`${table}: NOT FOUND in schema cache`)
} else {
  console.log(`${table} columns: ${Object.keys(props).join(', ')}`)
}
