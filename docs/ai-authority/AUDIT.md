# AI Authority Engine — Architecture Audit (Phase 1)

Baseline commit: `20c4950` (S53-FINANCIAL-AUDIT)
Audit date: 2026-09-19
Auditor: OpenHands agent, on behalf of Straight Flush Plumbing & Leak Detection

This document is the required Phase 1 audit. It records what already exists in
Business Brain, what can be reused, and what genuinely has to be added before a
single line of the AI Authority Engine is written.

---

## 1. Stack and shape of the existing application

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | `app/` routes, `components/` UI |
| Language | TypeScript 5.3 | strict-ish; `tsc --noEmit` is a gate |
| Data | Supabase (Postgres + RLS + Auth) | migrations in `supabase/migrations/` |
| AI | Vercel AI SDK v4 (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) | `lib/ai/providers.ts` |
| Tests | Vitest (unit + integration) | `vitest.config.ts` includes `tests/unit/**`, `tests/integration/**` |
| Unit runner | Vitest | `npm test` |
| Lint | ESLint (`next lint`) | `.eslintrc.json` |
| Styling | Tailwind + local primitives (`Card`, `Button`, `Container`, `Input`) | dark slate design system |
| Scheduling | External cron → `POST /api/jobs/tick` | `vercel.json` |

Multi-tenant model: every business table carries `organization_id` → `organizations(id)`, and RLS grants access via the membership subquery

```sql
organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
```

A handful of intentionally non-org-scoped tables exist (`user_roles`,
`founder_ai_budgets`) because founder is a platform-level role.

---

## 2. Existing capability inventory

### 2.1 Identity, auth, authorization — REUSE AS-IS

- `organizations`, `organization_members` (roles: owner/admin/member/viewer)
- `lib/auth/permissions.ts` — `hasPermission`, `requirePermission`, fail-closed
- `lib/auth/session.ts`, `lib/supabase/server.ts` (`createClient()` cookie-scoped),
  `lib/supabase/middleware.ts`, root `middleware.ts` (protected-route list)
- API convention: identity comes **only** from the session cookie; membership is
  re-verified server-side; org id from the body is trusted only *after* the check;
  RLS is the second line of defence.

**Reuse:** the AI Authority API routes follow this exact posture. No new auth code.

### 2.2 Durable background jobs — REUSE AS-IS

- `background_jobs` table (migration `015`, claim fixed by `019`)
- `claim_background_jobs()` — atomic `FOR UPDATE SKIP LOCKED`, stale-lease
  recovery, kill-switch aware (returns nothing when global kill switch is on or
  `ai_usage_limits.paused` is true), lease + worker tagging
- `complete_background_job()`, `fail_background_job()` (exponential backoff →
  dead-letter), `requeue_dead_background_job()`
- `lib/jobs/queue.ts` (`BackgroundJobQueue`), `lib/jobs/worker.ts`
  (`BackgroundWorker`, per-job timeout, graceful stop), `lib/jobs/handlers.ts`
  (handler registry + `PermanentJobError`), `lib/jobs/maintenance.ts`
  (`MaintenanceScheduler`, time-bucketed idempotency keys)
- `POST /api/jobs/tick` — CRON_SECRET-guarded, timing-safe compare, fail-closed
  when unset; schedules sweeps then drains one batch
- `POST /api/jobs/enqueue` — session-authenticated, per-type payload validation
- `job_type` CHECK constraint is **widened by drop/recreate** in `016`; that is
  the established pattern for registering new job types.

**Reuse:** all AI Authority work runs as new `background_jobs` job types plus new
handlers. **No second job engine is created.**

### 2.3 Approval state machine — REUSE AS-IS

- `approval_requests` (created `06`, reconciled `011`): `approval_status` ∈
  `pending | approved | rejected | modified | deferred | cancelled | expired`;
  `decision_id` FK; `response_deadline`; `approved_by`; `approval_notes`
- `expire_stale_approvals()` — deterministic DB-level expiry, `SKIP LOCKED`,
  writes `audit_logs`
- `lib/sprint3/approval-manager.ts` — `checkApprovalValid`, `canUserApprove`
  (owner/admin only), `approveAction` (**enqueues `execute_autonomous_action`**),
  `rejectAction`, `cancelAction`
- REST: `/api/sprint3/approvals/pending`, `/.../[approvalId]/approve|reject|cancel`
- UI: `components/sprint3/Sprint3ApprovalCenter.tsx`

**Reuse:** AI Authority recommendations create `autonomous_decisions` →
`autonomous_actions` → `approval_requests` triples, so the existing approval
REST routes, the existing approval UI, and the existing approval→execution
bridge all work unchanged.

### 2.4 Safe action execution — REUSE, WITH ONE ADDITIVE EXTENSION

- `lib/sprint3/action-execution-engine.ts` (`ActionExecutionEngine`), pipeline:
  AUTH → ORG MEMBERSHIP → PERMISSIONS → RISK → APPROVAL → KILL SWITCH →
  ATOMIC BUDGET RESERVATION → IDEMPOTENCY CLAIM → EXECUTE → SETTLE/RELEASE → AUDIT
- Risk: `critical` is **never** auto-approved; medium/high require admin/owner
- Shadow mode executes nothing and releases budget; `operatingMode` ∈
  `shadow | approval | autonomous`
- **Finding:** `performAction()` is a placeholder that returns
  `{ status: 'success' }` and performs no real work. Every "execution" in the
  system today is therefore inert.

**Plan:** register an executor lookup inside `performAction` with the existing
placeholder as the fallback. Unknown action types behave exactly as today, so
nothing regresses; AI Authority action types gain real implementations
(content briefs, page updates, internal-link plans, citation opportunities)
behind the *same* fail-closed pipeline. No safety check is weakened.

### 2.5 Budget and cost control — REUSE AS-IS

- `ai_usage_limits` (`monthly_budget`, `current_spend` at 6dp, `paused`, `pause_reason`)
- `budget_reservations` (`reserved_amount`/`settled_amount` widened to
  `NUMERIC(12,6)` by `020`), unique `(organization_id, idempotency_key)`
- `reserve_budget_idempotent()`, `settle_budget_clamped()`, `release_budget_hold()`
- `lib/sprint3/budget-reservation.ts`, `lib/ai/cost-manager.ts`,
  `lib/ai/config/pricing.ts` (`calculateModelCost`)
- `lib/ai/financial-logger.ts` — structured financial ops log
- `budget_reconciliation_sweep` job reaps orphaned holds

**Reuse:** every AI Authority external call is reserved/settled through this
engine, and the AI Authority migration adds *per-query and per-engine* budget
ceilings on top. No parallel money path.

### 2.6 Audit logging — REUSE AS-IS

- `audit_logs(organization_id, user_id, action, resource, details, metadata, timestamp)`
- Writers: `ActionExecutionEngine`, `ApprovalManager`, `expire_stale_approvals()`

**Reuse:** AI Authority writes `ai_authority.*` actions into `audit_logs`.
No new log table.

### 2.7 Knowledge and memory — REUSE, DOES NOT FIT THE DOMAIN

- `company_memory`, `company_knowledge`, `organizational_knowledge` (with
  `embedding`/`embeddings_pending`), `lib/knowledge/*`, `EmbeddingService`
- `business_memory`, `strategic_learnings`, `discovered_patterns`

These are free-text/vector knowledge stores. They are reused for narrative
learnings. They are **not** a substitute for the structured AI-visibility tables
(mentions, citations, source domains, per-engine query runs) because those need
relational integrity, per-query joins, and index-backed aggregation.

### 2.8 Website / SEO / competitive — PARTIALLY EXISTS, EXTEND

| Table | Migration | What it holds | Verdict |
|---|---|---|---|
| `website_pages` | `04` | url, title, meta_description, headers, word count, internal/external link counts, has_schema, has_canonical, indexable, rank, impressions, clicks, issues, content_gaps | **EXTEND** — add org-scoped crawl graph columns (status code, canonical target, headings, structured data, content hash, orphan flag, service/city linkage) |
| `seo_experiments` | `04` | hypothesis, change, baseline, result, significance, learning | **EXTEND** — add AI-visibility metrics + authority experiment linkage |
| `seo_opportunities` | `05` | keyword-level opportunities | **KEEP**, distinct from authority opportunities |
| `opportunities` | `03` **and** `05` | two different shapes, same name | **CONFLICT — see §4** |
| `recommendations` | `05` | title, reasoning, priority, confidence, evidence | **REUSE** — authority recommendations extend with component scores |
| `competitor_alerts` | `04` | competitor_name, alert_type, severity, status | **REUSE** for alerts |
| `competitive_intelligence` | `07` | finding_type, threat_level, response, status | **REUSE** for narrative findings |
| `agent_registry`, `agent_performance`, `daily_briefings`, `company_profiles` | phase3/4 | workforce + profile | **REUSE** for Business Brain integration |

Existing SEO agents (`lib/agents/seo-strategist-agent.ts`,
`local-seo-agent.ts`, `content-strategist-agent.ts`,
`competitive-intelligence-agent.ts`, `website-optimization-agent.ts`) are
prompt-driven consultants. The AI Authority Engine supplies them with real,
measured data rather than replacing them.

### 2.9 AI invocation — REUSE THE SERVICE, NOT THE PROVIDER SET

- `lib/ai/providers.ts` — `OpenAIProvider`, `AnthropicProvider`,
  `PendingProvider`, guarded `FakeProvider`
- `lib/ai/execution-service.ts`, `lib/ai/execution-pipeline.ts`,
  `lib/ai/cost-controller.ts`

These are **generative** providers (Business Brain makes text). AI Authority
needs a different thing: a *monitor* that asks each AI search surface a customer
question and records what came back. That is a distinct concern with distinct
capabilities and distinct compliance constraints, so it gets its own adapter
interface. It deliberately reuses the cost/pricing/audit plumbing underneath.

---

## 3. Missing capability (what the engine must add)

1. Structured AI-search visibility data: engines, models, query families,
   query runs, raw responses, parsed mentions, citations, source domains.
2. A city × service authority matrix with per-market scores and trends.
3. A query generator (intent dimensions) + normalizer (intent dedupe).
4. An `AIEngineAdapter` abstraction with per-provider implementations.
5. A response parser producing structured mentions/citations/positions.
6. Citation-gap analytics and source classification.
7. Competitor entity discovery, snapshots, and change detection.
8. A first-party evidence ledger with verification/publish permissions.
9. A respectful website crawler + technical SEO + internal-link graph.
10. Explainable opportunity scoring and recommendation generation.
11. Search Console / GBP integrations (credential-gated).
12. An AI Authority Command Center UI inside Business Brain.
13. Per-engine/per-day cost ceilings specific to monitoring volume.

---

## 4. Conflicting capability (must be resolved, not duplicated)

**`opportunities` is defined twice with incompatible shapes.**

- `03_phase3_autonomous_workforce.sql`: `(title, description, category, source,
  potential_impact, confidence_score, effort_estimate, priority_score)`
- `05_phase5_predictive_intelligence.sql`: `(title, description, category
  CHECK(...), source_system, source_record_id, opportunity_score …)`

Because both use `CREATE TABLE IF NOT EXISTS`, whichever migration runs first
wins and the second is silently skipped. Any code written against the losing
shape fails at runtime. This is a pre-existing latent defect.

**Decision:** the AI Authority Engine does **not** add fields to
`opportunities`. Authority opportunities get their own
`authority_opportunities` table. This avoids deepening the conflict, keeps the
authority scoring components self-contained and explainable, and leaves the
existing ambiguity for a separate, explicitly-scoped cleanup task.

**Other overlaps reviewed and judged non-conflicting:**

- `seo_opportunities` (keyword-level) vs `authority_opportunities` (city×service
  authority-level) — different grains, both kept.
- `recommendations` (phase5) is reused, not shadowed.
- `competitor_alerts` / `competitive_intelligence` reused for alerts/findings;
  deep structured competitor state goes in new `authority_competitors` +
  snapshots.

---

## 5. Required changes summary

| # | Change | Type |
|---|---|---|
| 1 | New migration `021_ai_authority_engine.sql` | additive |
| 2 | Widen `background_jobs.job_type` CHECK (drop/recreate, as `016` does) | additive |
| 3 | Widen `autonomous_actions.action_type` CHECK (drop/recreate, as `011` does) | additive |
| 4 | Add nullable authority columns to `website_pages` | additive |
| 5 | Add nullable AI-visibility columns to `seo_experiments` | additive |
| 6 | Executor registry inside `ActionExecutionEngine.performAction` | additive, fallback = today's behaviour |
| 7 | New `lib/authority/*` subsystem | new |
| 8 | New `app/api/ai-authority/*` routes | new |
| 9 | New AI Authority UI section | new |
| 10 | New job types + handlers + schedules | new |

Everything else is reused untouched.

---

## 6. Migration risks

| Risk | Assessment | Mitigation |
|---|---|---|
| Migration numbering collision | `0000`/`000`/`001`/`02`…`09`/`010`…`020` are already irregular and `03`/`04`/`05`/`06`/`07` overlap by prefix. `021` is unused at any width. | Use `021_ai_authority_engine.sql` |
| Duplicate `opportunities` definition | Real, pre-existing | Do not touch `opportunities`; new table instead |
| `CREATE TABLE IF NOT EXISTS` silently skipping | Real | Every new table has a unique name, verified against the full table list |
| RLS left disabled on a new table | High severity if missed | Every new table: `ENABLE ROW LEVEL SECURITY` + single `FOR ALL` org-isolation policy with `USING` **and** `WITH CHECK` |
| `claim_background_jobs` returning new job types | Claim is type-agnostic | No change needed beyond the CHECK constraint |
| Widening a CHECK constraint | Drops a constraint momentarily | Exactly the pattern used by `011` and `016`, which are verified live |
| Non-ASCII / non-idempotent SQL | Repo convention is ASCII + `IF NOT EXISTS` | Follow that convention throughout |
| Seed data leaking between orgs | Seed runs per explicit `organization_id` | Seed function takes the org id; upserts are `ON CONFLICT DO NOTHING` |
| Applying to live DB | Cannot verify live state from here | Migration is additive and re-runnable; validation steps in `docs/ai-authority/VALIDATION.md` |

## 7. Dependency risks

| Risk | Assessment | Mitigation |
|---|---|---|
| No AI-search provider exposes an official "what does ChatGPT recommend" API for arbitrary third-party queries | **Confirmed.** There is no supported endpoint that returns consumer AI-search recommendations for a business. | Build the adapter interface and honest `unconfigured`/`unsupported` states. Never fabricate results. Perplexity's public API and Gemini/OpenAI model APIs are wired as monitorable surfaces where a key exists. |
| Google Search Console / GBP OAuth not present | Expected | Credential-gated adapters that report `unconfigured` and record nothing fake |
| Vercel AI SDK v4 API differences | Already handled in `lib/ai/providers.ts` (`usageTokens`) | Reuse the same defensive token mapping |
| Node version / build | `engines.node` 20.x | Verified locally |

## 8. Environment variables

Present convention (`.env.example`, `.env.local.example`): Supabase URL/anon/service,
`OPENAI_API_KEY`, optional `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_APP_URL`,
`BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER`, and `CRON_SECRET` for the tick endpoint.

AI Authority adds **optional** keys — absence is a supported state, never a crash:

```
PERPLEXITY_API_KEY        # AI search surface with a public API + citations
GEMINI_API_KEY            # Google AI surface
XAI_API_KEY               # Grok
AI_AUTHORITY_CRON_SECRET  # optional separate secret for monitoring ticks
GOOGLE_SEARCH_CONSOLE_*   # OAuth client/refresh token (credential-gated)
GOOGLE_BUSINESS_PROFILE_* # OAuth client/refresh token (credential-gated)
```

`OPENAI_API_KEY` already exists and doubles as the ChatGPT surface.

## 9. Conclusion

Business Brain already provides — and the engine will reuse without
modification — multi-tenant org scoping with RLS, session-based auth with
server-side membership checks, a durable idempotent background job queue with
retries/leases/dead-letters, an approval state machine with DB-level expiry, a
fail-closed action execution pipeline with atomic budget reservation, structured
financial logging, and `audit_logs`.

The genuine gaps are the AI-search visibility domain, the city×service authority
matrix, the query generator/normalizer, the engine adapter layer, the response
parser, citation and competitor intelligence, the evidence ledger, the crawler
and technical-SEO graph, explainable opportunity/recommendation scoring, the
Command Center UI, and per-engine cost ceilings.

One pre-existing conflict (`opportunities` defined twice) is documented and
deliberately routed around rather than duplicated or silently patched.

Proceeding to Phase 2.