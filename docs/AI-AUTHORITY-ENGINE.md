# AI Authority Engine — Completion Handoff

**Repo:** `straightflushplumbing03/AI-Headquarters`
**Branch:** `main` · **Commit:** `0dec35c` · pushed and in sync with `origin/main`
**Builder:** OpenHands agent · **Audience:** Freebuff (or any engineer picking this up)

Read this before touching anything. It records what exists, what has actually
been verified, what has *not*, and the exact steps to close the gap. It also
records the mistakes that were already made so you don't repeat them.

---

## 1. Where the project stands

The AI Authority Engine is **built end to end** — schema, adapters, parser,
intelligence services, jobs, API, and UI. It is **not** finished in one specific
sense: it has never processed a real AI response, and its RLS has never been
exercised against the hosted Supabase project. Those two things are what remain.

Phases 1–4 are committed:

| Commit | Scope |
|---|---|
| `b1d68e2` | P1 — audit, schema, engines, scoring core |
| `4582bbc` | P2 — jobs, scheduling, crawler, integrations, orchestrator |
| `56bb60b` | P3 — API routes, query-generator guard, unit tests |
| `0dec35c` | P4 — UI section, approver-gated seed, migration/RLS validation |

Current gates, all passing at `0dec35c`:

```
tsc --noEmit   clean
next lint      clean (only pre-existing warnings in untouched files)
next build     succeeds
vitest         253 passed | 15 skipped (392 total)
```

---

## 2. What is actually verified, and how

Do not take the following on faith — it was executed, and you can reproduce it.
See `docs/ai-authority/VALIDATION.md` for the full write-up.

**Verified:**

- The full migration chain applies to a real Postgres and reaches a fixpoint.
- `seed_ai_authority_engine` is genuinely idempotent and produces exactly
  5 cities × 4 services = 20 markets.
- RLS isolation works. The real policy was executed with a JWT subject claim:
  a member sees only their own org and cannot read/insert/update/delete another
  org's rows; `anon` sees nothing.
- All 25 authority fixture table/column references match the live schema.
- The seed RPC is `SECURITY INVOKER` (`prosecdef = f`), so RLS genuinely
  constrains it — the route comment claiming this is accurate.

**Not verified — this is your job:**

- Live RLS against the hosted Supabase project.
- `supabase db push` against the hosted project.
- Any AI response flowing through the parser (no key has ever been configured).
- PostgREST / GoTrue behaviour (schema cache, auth hooks, default grants).

---

## 3. Reproducing the migration validation

The hosted DB needs no credentials to validate the SQL. Recreate the harness:

```bash
docker run -d --name pgval \
  -e POSTGRES_PASSWORD=pgval -e POSTGRES_DB=pgval \
  -p 55432:5432 pgvector/pgvector:pg16
```

Apply a shim providing the Supabase objects the migrations reference
(`auth.uid()`, `auth.role()`, `auth.jwt()`, `auth.users`, `storage.*`, and the
`anon`/`authenticated`/`service_role` roles), then apply
`supabase/migrations/*.sql`.

### Gotcha #1 — alphabetical order is not the migration order

`ls *.sql | sort` interleaves the numeric prefixes badly (`021` sorts before
`02_phase2_ai_tables.sql`). Expect spurious `relation does not exist` errors on
a first pass. Loop the whole set repeatedly until it reaches a fixpoint rather
than trusting a single sorted run. Two message categories remain on a second
pass and are **expected, not defects**:

- `NOTICE: relation "..." already exists, skipping` — intended `IF NOT EXISTS` behaviour.
- `ERROR: policy "user_roles_self_select" ... already exists` in
  `010_sprint51_core_tables.sql` — pre-existing re-run artifact, harmless on a
  first application to a clean database.

### Gotcha #2 — plain Postgres has no default grants

`SET ROLE authenticated` fails with `permission denied` until you reproduce
Supabase's default privileges:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
```

Grant table-wide on purpose. RLS — not the GRANT — is what restricts which
*rows* each role touches. That is precisely what the isolation test proves.

---

## 4. Bugs already found this way — watch for the pattern

Running fixtures against the real schema caught three defects that would
otherwise have surfaced as confusing live-only failures:

| Table | Defect | Fix |
|---|---|---|
| `authority_citation_gaps` | fixture referenced non-existent `priority` column | use `gap_severity` |
| `authority_alerts` | `alert_type` value outside the CHECK list | use `visibility_drop` |
| `authority_integrations` | `provider` value outside the CHECK list | use `google_search_console` |

**Check fixture payloads against `information_schema` and the CHECK constraints
before blaming the database.** The unit tests cannot catch this class of error,
because they mock Supabase.

---

## 5. Task A — close out live validation

Requires a **dedicated test project**. Never run this against production.

```bash
supabase db push          # apply 021 + 022 to the test project

SUPABASE_TEST_URL=... \
SUPABASE_TEST_ANON_KEY=... \
SUPABASE_TEST_SERVICE_KEY=... \
  npm run test:live
```

Then seed once via `POST /api/ai-authority/seed` as an approver, and confirm the
Command Center renders the 20 markets rather than the first-run prompt.

Expected outcome: the authority tables in `tests/integration/rls-live.test.ts`
stop reporting `LIVE DATABASE REQUIRED`.

If a fixture fails here but passed the plain-Postgres harness, the cause is
Supabase-specific (grants, schema cache, auth hooks) — not the SQL you validated.

---

## 6. Task B — the highest-value remaining work

**Wire one AI engine end to end and run a real query batch.**

This matters more than any feature addition. The parser, citation extractor,
competitor discovery, scoring, and opportunity engine are all built and
unit-tested — but they have only ever seen hand-written fixtures. Real model
output will diverge from those fixtures, and that divergence is invisible today.

Adapters, their keys, and current capabilities:

| Engine | Key | Env var | Capability |
|---|---|---|---|
| ChatGPT | `chatgpt` | `OPENAI_API_KEY` | requires credential |
| Gemini | `gemini` | `GEMINI_API_KEY` | requires credential |
| Perplexity | `perplexity` | `PERPLEXITY_API_KEY` | requires credential |
| Grok | `grok` | `XAI_API_KEY` | requires credential |
| Google AI | `google_ai` | *(none)* | `unsupported` — by design |

`google_ai` is deliberately `unsupported`. There is no authorized programmatic
API for consumer AI search surfaces. **Do not "fix" this by scraping.** Read the
compliance comment at the top of `lib/authority/adapters/base.ts` first.

Runbook, once a key is set:

1. Seed the org (Task A) so taxonomy and query templates exist.
2. `POST /api/ai-authority/query-runs` with `{ organizationId, mode: "monitor", limit: N }`.
   Modes map to job types: `monitor`, `parse`, `competitor`, `score`,
   `recommend`, `crawl`, `full`.
3. Drive the queue via `POST /api/jobs/tick`, or let the daily cron do it.
4. Inspect `authority_responses`, `authority_mentions`, `authority_citations`
   for real rows — and check the parser handled them without silent drops.

Start with `limit: 5` and one engine. Budget limits, kill switches, and
per-query deduplication are enforced inside the runner, so the request may
collect less than asked.

**What to look for:** parsing failures, mentions the parser missed, citation
extraction that captured nothing. Harden the parser against real output, then
re-run. That feedback loop is the point of this task.

---

## 7. Task C — small, do it while you're there

`.env.example` and `.env.local.example` document `OPENAI_API_KEY` and nothing
else. None of the authority variables are recorded anywhere. Add the following,
with comments explaining that each is optional and that an absent key yields an
honest `requires_credential` state rather than fabricated data:

```
AUTHORITY_ADAPTER_TIMEOUT_MS
AUTHORITY_CHATGPT_MODEL
AUTHORITY_GEMINI_MODEL
AUTHORITY_GROK_MODEL
AUTHORITY_PERPLEXITY_MODEL
AUTHORITY_SITE_ORIGIN
AUTHORITY_SUBJECT_DOMAINS
GEMINI_API_KEY
GOOGLE_BUSINESS_PROFILE_CLIENT_ID
GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET
GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN
GOOGLE_SEARCH_CONSOLE_CLIENT_ID
GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN
OPENAI_API_KEY
PERPLEXITY_API_KEY
XAI_API_KEY
```

The authoritative list is whatever the code reads -- regenerate it rather than
trusting the transcription above:

```bash
grep -rhoE 'process\.env\.[A-Z_]+' lib/authority/ | sort -u
```

Never commit real values.

---

## 8. Existing-system constraints — do not violate

This subsystem was built to reuse infrastructure, not duplicate it. Preserve that.

- **Do not add a second job engine.** Use `background_jobs` +
  `claim_background_jobs`. Ten `authority_*` types are already registered.
- **Do not add a second approval system.** Route through `approval_requests` and
  the existing state machine.
- **Do not add a second budget system.** Use the existing atomic reservation
  RPCs.
- **Do not create a new design system.** Use `components/Card.tsx`,
  `components/Container.tsx`, and existing Tailwind conventions.
- **Do not fabricate data to fill empty UI.** No fake reviews, projects,
  citations, competitors, or AI responses. Absent configuration must render as
  an honest empty or `unsupported` state. This is a hard product requirement,
  not a stylistic preference.
- **Every new table needs** `ENABLE ROW LEVEL SECURITY` plus one org-isolation
  policy carrying both `USING` and `WITH CHECK`, and org scoping throughout.

---

## 9. Definition of done

Treat the engine as complete when all of these hold:

- [ ] `supabase db push` applied to the target project; migrations `021` + `022` present
- [ ] `npm run test:live` passes with authority tables no longer skipped
- [ ] Org seeded; Command Center renders 20 markets
- [ ] One engine key configured, one real query batch collected
- [ ] Parser reviewed against real output and hardened where it diverged
- [ ] Real rows exist in `authority_responses` / `_mentions` / `_citations`
- [ ] Authority variables documented in `.env.example`, no real values committed
- [ ] `tsc`, `lint`, `build`, `test` all clean
- [ ] Diffs reviewed, committed atomically, pushed

---

## 10. Reading order for a newcomer

1. `docs/ai-authority/AUDIT.md` — what existed, what was reused, what was added, and the risk analysis
2. `docs/ai-authority/VALIDATION.md` — what was executed and what the results were
3. `lib/authority/adapters/base.ts` — the compliance posture; read before writing any adapter
4. `lib/authority/types.ts` — the domain model
5. `supabase/migrations/021_ai_authority_engine.sql` — the schema

**One thing to internalise.** This system does not promise, and must never
promise, guaranteed rankings. Consumer AI search surfaces have no published
ranking formula, and any internal number produced here is a Business Brain
metric — not a platform score. The UI labels them accordingly. Keep it that way.
Persist: measure visibility, detect change, identify opportunity, execute only
what is approved, measure the outcome, and learn.