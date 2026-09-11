/**
 * Probe: why does an authenticated user's organizations INSERT fail on the live DB?
 * Isolates: (a) org insert alone, (b) membership insert on an existing org,
 * (c) the session JWT's role claim.
 *
 * Usage: node scripts/probe-auth-bootstrap.mjs <url> <anonKey> <serviceKey>
 * Creates and deletes one throwaway probe user + org. Safe for the TEST project only.
 */
import { createClient } from '@supabase/supabase-js'

const [url, anon, serviceKey] = process.argv.slice(2)
if (!url || !anon || !serviceKey) {
  console.error('usage: node scripts/probe-auth-bootstrap.mjs <url> <anonKey> <serviceKey>')
  process.exit(2)
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const c = createClient(url, anon, { auth: { persistSession: false } })
const email = `probe-${Date.now()}@example.com`
const password = `Px${Date.now()}!zq`

console.log('1) create user (admin API; anon signup endpoint rejects test domains)...')
const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (cu.error) { console.log('   create error:', cu.error.message); process.exit(1) }
const userId = cu.data.user.id
console.log('   user =', userId)

console.log('2) password sign-in on anon client (real user JWT path)...')
const si = await c.auth.signInWithPassword({ email, password })
if (si.error) { console.log('   signin error:', si.error.message); process.exit(1) }

const sess = (await c.auth.getSession()).data.session
if (!sess) { console.log('   NO SESSION after signin'); process.exit(1) }
const claims = JSON.parse(Buffer.from(sess.access_token.split('.')[1], 'base64').toString())
console.log('3) JWT claims: role =', claims.role, '| sub =', (claims.sub || '').slice(0, 8))

console.log('4) organizations insert (authenticated user client)...')
const ins = await c.from('organizations')
  .insert({ name: 'Bootstrap Probe Org ' + Date.now(), slug: 'bootstrap-probe-' + Date.now() })
  .select('id')
if (ins.error) {
  console.log('   ORG INSERT ERROR:', ins.error.message, '| code =', ins.error.code, '| hint =', ins.error.hint ?? '-', '| details =', ins.error.details ?? '-')
  process.exitCode = 1
} else {
  const orgId = ins.data[0].id
  console.log('   org created =', orgId)
  console.log('5) organization_members insert (first owner)...')
  const mem = await c.from('organization_members')
    .insert({ organization_id: orgId, user_id: userId, role: 'owner' })
  console.log(mem.error
    ? '   MEMBER INSERT ERROR (expected — is_org_owner bootstrap gap): ' + mem.error.message
    : '   member insert OK (unexpected!)')
  // cleanup via user client only works if RLS lets them; try, else leave for service cleanup
  await c.from('organizations').delete().eq('id', orgId).then(r => {
    console.log(r.error ? '   org cleanup skipped: ' + r.error.message : '   org cleanup ok')
  })
}

await admin.auth.admin.deleteUser(userId).then(() => console.log('6) probe user deleted'))
