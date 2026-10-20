/**
 * Phase A: runs tests/sql/workforce_phase_a_test.sql against a LOCAL scratch
 * Postgres prepared by scripts/apply-migrations-local.sh.
 *
 * Skipped unless WORKFORCE_TEST_DATABASE_URL is set. Refuses any host other
 * than localhost, so it can never touch a hosted Supabase project.
 *
 *   WORKFORCE_TEST_DATABASE_URL=postgres://user:pass@localhost/sfi_test npx vitest run tests/integration/workforce-db.test.ts
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'

const url = process.env.WORKFORCE_TEST_DATABASE_URL
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)

describe.skipIf(!isLocal)('workforce Phase A database enforcement', () => {
  it('passes every check in workforce_phase_a_test.sql', () => {
    const file = path.resolve(__dirname, '../sql/workforce_phase_a_test.sql')
    let output = ''
    try {
      output = execFileSync('psql', [url!, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e: any) {
      const failure = String(e.stderr ?? '').split('\n').find((l) => l.includes('FAIL') || l.includes('ERROR'))
      throw new Error(failure ?? 'workforce SQL suite failed')
    }
    expect(output).toContain('WORKFORCE PHASE A: ALL CHECKS PASSED')
  }, 60_000)
})
