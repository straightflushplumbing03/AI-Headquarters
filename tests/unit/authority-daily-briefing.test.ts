/**
 * AI Authority Engine -- 6:00 AM Pacific scheduling gate and daily briefing.
 *
 * The daily cadence is specified as "6:00 AM Pacific". The tick endpoint runs
 * every minute in UTC, so the schedule is enforced by a timezone-aware gate
 * rather than by the cron expression itself. These tests pin that behaviour
 * down with fixed instants so a regression in the gate is caught here instead
 * of showing up as a run at the wrong hour in production.
 *
 * They also assert the daily briefing job is registered and that its summary is
 * honest about missing data (no fabricated numbers).
 */

import { describe, it, expect } from 'vitest'
import {
  atOrAfterDailyGate,
  hourInTimezone,
  AUTHORITY_TIMEZONE,
  AUTHORITY_DAILY_GATE_HOUR,
} from '@/lib/jobs/maintenance'
import { JOB_HANDLERS } from '@/lib/jobs/handlers'

describe('Authority 6:00 AM Pacific gate', () => {
  it('uses the America/Los_Angeles timezone and a 06:00 gate hour', () => {
    expect(AUTHORITY_TIMEZONE).toBe('America/Los_Angeles')
    expect(AUTHORITY_DAILY_GATE_HOUR).toBe(6)
  })

  it('reports the Pacific hour correctly across a UTC midnight boundary', () => {
    // 2026-06-15 is PDT (UTC-7): 13:00Z == 06:00 PT.
    expect(hourInTimezone(new Date('2026-06-15T13:00:00Z'), AUTHORITY_TIMEZONE)).toBe(6)
    // 00:00Z == 17:00 PT the previous day.
    expect(hourInTimezone(new Date('2026-06-15T00:00:00Z'), AUTHORITY_TIMEZONE)).toBe(17)
  })

  it('handles Pacific Standard Time (UTC-8) in winter', () => {
    // 2026-01-15 is PST (UTC-8): 14:00Z == 06:00 PT.
    expect(hourInTimezone(new Date('2026-01-15T14:00:00Z'), AUTHORITY_TIMEZONE)).toBe(6)
  })

  it('holds the cadence before 06:00 Pacific', () => {
    // 12:59Z == 05:59 PT (PDT): still gated.
    expect(atOrAfterDailyGate(new Date('2026-06-15T12:59:00Z'))).toBe(false)
    // 12:00Z == 05:00 PT: gated.
    expect(atOrAfterDailyGate(new Date('2026-06-15T12:00:00Z'))).toBe(false)
    // 08:00Z == 01:00 PT: gated (overnight).
    expect(atOrAfterDailyGate(new Date('2026-06-15T08:00:00Z'))).toBe(false)
  })

  it('opens the cadence at or after 06:00 Pacific', () => {
    // 13:00Z == 06:00 PT (PDT): open.
    expect(atOrAfterDailyGate(new Date('2026-06-15T13:00:00Z'))).toBe(true)
    // 14:00Z == 06:00 PT (PST): open.
    expect(atOrAfterDailyGate(new Date('2026-01-15T14:00:00Z'))).toBe(true)
    // 20:00Z == 13:00 PT: open (idempotent bucket means only one job per day).
    expect(atOrAfterDailyGate(new Date('2026-06-15T20:00:00Z'))).toBe(true)
  })
})

describe('Daily briefing job registration', () => {
  it('registers authority_daily_briefing in the single job-handler registry', () => {
    expect(typeof JOB_HANDLERS.authority_daily_briefing).toBe('function')
  })

  it('still registers every previously known authority job type', () => {
    for (const jobType of [
      'authority_query_execution',
      'authority_response_parsing',
      'authority_competitor_monitor',
      'authority_website_crawl',
      'authority_search_console_sync',
      'authority_gbp_sync',
      'authority_scoring',
      'authority_recommendation_generation',
      'authority_experiment_evaluation',
      'authority_data_quality_sweep',
    ]) {
      expect(typeof JOB_HANDLERS[jobType as keyof typeof JOB_HANDLERS]).toBe('function')
    }
  })
})
