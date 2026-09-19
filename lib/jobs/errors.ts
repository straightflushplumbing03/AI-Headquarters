/**
 * Shared job handler contract.
 *
 * Extracted from lib/jobs/handlers.ts into its own module so domain subsystems
 * (currently the AI Authority Engine) can implement handlers and signal
 * permanent failures WITHOUT importing the handler registry. Importing the
 * registry from a domain module would create a cycle: handlers.ts imports the
 * domain's handlers, and the domain's handlers import handlers.ts.
 *
 * lib/jobs/handlers.ts re-exports everything here, so existing imports of
 * `PermanentJobError` / `JobHandler` from '@/lib/jobs/handlers' keep working.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClaimedJob } from './types'

/**
 * Signal a PERMANENT failure: retrying cannot help (invalid payload, missing
 * resource, absent configuration). The job dead-letters immediately instead of
 * burning through its retry budget.
 *
 * Any other thrown error is treated as transient and retried with backoff.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentJobError'
  }
}

export interface JobContext {
  supabase: SupabaseClient
}

export type JobHandler = (job: ClaimedJob, ctx: JobContext) => Promise<Record<string, unknown>>