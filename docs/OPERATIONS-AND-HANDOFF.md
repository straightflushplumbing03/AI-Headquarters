# AI Headquarters — operations, cost, and handoff

How the finished system runs, what it costs, and how to operate it. Written so
the owner can run the platform without the person who built it.

Verified 2026-10-13 against `main` @ `c65463e` plus PR #15.

---

## 1. What runs, and when

All scheduled work goes through **one** engine. There is no second scheduler and
no second approval system to learn.

```
Vercel Cron: 0 14 * * *            ──►  GET  /api/jobs/tick  (Authorization: Bearer $CRON_SECRET)
GitHub Actions jobs-tick (15 min) ──►  POST /api/jobs/tick  (optional; needs repo secrets)
                                   │
                                   ├─ MaintenanceScheduler  (approval sweeps, embedding backfill,
                                   │                         budget reconciliation)
                                   ├─ AuthorityScheduler    (the authority cadence)
                                   └─ BackgroundWorker.processBatch()  ──►  job handlers
```

- The tick endpoint **fails closed**: with no `CRON_SECRET` it returns 503 and
  does nothing. This is intentional — it can never run unauthenticated.
- **Schedule (2026-10-20):** Vercel Hobby rejects any cron more frequent than daily, and
  the old `* * * * *` entry failed every deployment from 2026-09-11 on. Vercel now ticks
  once a day at 14:00 UTC (lands 06:00–07:59 Pacific in both DST states, after the
  06:00 gate). `.github/workflows/jobs-tick.yml` adds a tick every 15 minutes once the
  `JOBS_TICK_URL` and `CRON_SECRET` repository secrets are set; on a Pro plan the Vercel
  cron can go back to `* * * * *` instead.
- However often the tick runs, "daily" and "weekly" work is idempotent with **bucket
  keys** (`authority-query-YYYY-MM-DD`, etc.), so it produces **at most one** of each
  job per day.
- **Retries do not duplicate work:** the enqueue is an upsert on
  `(organization_id, job_type, idempotency_key)`, so a re-scheduled job with the
  same key is a no-op.

### The 6:00 AM Pacific cadence

| Job | Bucket | Notes |
|---|---|---|
| `authority_query_execution` | daily | Bounded by the org's own budget. |
| `authority_response_parsing` | daily | Parses collected answers into mentions/citations. |
| `authority_competitor_monitor` | daily | Competitor snapshot + change detection. |
| `authority_daily_briefing` | daily | Read-only business summary (new in PR #15). |
| `authority_scoring` → `authority_recommendation_generation` → `authority_experiment_evaluation` | weekly (Monday) | Ordering matters: recommendations read the fresh scores. |

The daily and weekly cadences are **gated** to the first tick at or after 06:00
in `America/Los_Angeles` (`atOrAfterDailyGate`). Without the gate, the daily
bucket fired at 00:00 UTC — 4–5 PM Pacific. The gate is deterministic and
covered by tests, including the PST/PDT boundary.

---

## 2. What is honest, and what is not

The engine has **no mock or sample-data path**. An unconfigured source reduces
coverage and is reported as such; it is never simulated, estimated, or filled
with zeros.

| Connection | State | Needs from the owner |
|---|---|---|
| Website crawl + sitemap | works, no credential | `AUTHORITY_SITE_ORIGIN` (or `organizations.website`) |
| Google Search Console | implemented, credential-gated | OAuth client + refresh token (see checklist) |
| Google Business Profile | implemented, credential-gated | OAuth client + refresh token (see checklist) |
| Google Analytics 4 | **not built** | build first, then OAuth + property id |
| GitHub PR / CI / deploy status | **not built** | build first, then a read-only token |
| AI answer monitoring | implemented, credential-gated | one provider key |

`GET /api/ai-authority/integrations` reports live status and the exact missing
environment variable names. See `docs/CONNECTIONS-CHECKLIST.md` for the step by
step.

---

## 3. Cost breakdown

### Free

- **Hosting + cron:** Vercel (existing plan) — no change to the project's cost.
- **Database, auth, storage:** Supabase (existing plan).
- **Website crawl, sitemap, technical SEO checks:** internal, no external calls.
- **Scheduling, retries, idempotency, audit log:** internal.
- **Daily briefing:** a read model — zero external calls, zero tokens.

### Paid (only when you enable a source)

| Source | Billing model | Rough shape | Control |
|---|---|---|---|
| AI monitoring provider | per API call | Perplexity `sonar` is the lowest-cost high-signal option; each query = one call | `authority_budgets` per org, enforced **before** spend |
| Google APIs | free within quotas | Search Console + GBP are free at this volume | n/a |
| GA4 Data API | free within quota | free at this volume | n/a |

The one real recurring cost is the AI provider. It is capped by
`AuthorityBudgetService` (`lib/authority/cost-control.ts`) before any call:
`daily_query_limit` (default 200), `monthly_query_limit` (default 4000) and
`monthly_cost_ceiling` (default $50), plus an org-level kill switch. The daily
query job also passes `limit: 40`, so a misconfigured schedule degrades rather
than overspends.

---

## 4. Emergency stop

The engine already supports a persistent stop, and it must not be bypassed:

1. **Stop scheduled work:** unset `CRON_SECRET` (the tick returns 503), or remove
   the cron entry. Nothing schedules.
2. **Stop AI spend immediately:** set `ai_usage_limits.paused = true` for the
   org — the query runner checks this kill switch before every call. Lowering
   `daily_query_limit` / `monthly_query_limit` / `monthly_cost_ceiling` throttles
   instead of halting; removing the provider key also stops all calls.
3. **Stop a single automation:** disable it in the OpenHands automation list.

These are server-side controls. Do not replace them with a client-side flag.

---

## 5. How to operate it

### Daily

- Open `GET /api/ai-authority/briefing` (or the dashboard) for the business
  summary. It labels each line **observed** or **unavailable** — trust the label.
- Check `GET /api/ai-authority/integrations` if a metric went quiet; it names the
  missing credential.

### After a change

1. Baseline and evidence recorded.
2. Change on its own branch (`intelligence-hq/...`).
3. All four gates pass: `tsc --noEmit`, `next lint`, `next build`, `vitest run`.
4. Pull request with the test output in the description.
5. **Owner approves** before merge/deploy.
6. Measure the real outcome afterwards and store it for the next decision.

### Verifying a scheduled run actually happened

The API does not expose `next_run_at`. Prove it with a real run:
`GET /api/automation/v1/{id}/runs` and look for `trigger_source: cron` with a
`started_at` matching the schedule in the automation's timezone.

---

## 6. What is still blocked on the owner

1. A **dedicated Supabase test project** (never production) for the live RLS and
   real-query integration run.
2. **One AI provider key** (Perplexity preferred) for the first real query batch.
3. **`CRON_SECRET`** set in hosting, or nothing scheduled runs.
4. Google OAuth refresh tokens for Search Console and Business Profile.

Everything else proceeds without the owner.
