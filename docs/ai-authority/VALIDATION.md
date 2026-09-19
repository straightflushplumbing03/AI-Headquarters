# AI Authority Engine — Migration Validation

Referenced from `AUDIT.md` §6, row "Applying to live DB".

This document records what was actually executed, against what, and what the
result was. It exists because the audit's migration risk table claims the
migration is additive and re-runnable; that claim is only worth as much as the
evidence behind it.

## Why a plain-Postgres harness

The real database is Supabase, and no service credentials are available from a
build environment. Waiting for them would leave the migration unverified
indefinitely. Instead the full migration chain was applied to a throwaway
`pgvector/pgvector:pg16` container with a small shim providing the Supabase
objects the migrations reference (`auth.uid()`, `auth.role()`, `auth.jwt()`,
`auth.users`, `storage.*`, and the `anon`/`authenticated`/`service_role` roles).

This validates SQL correctness, constraint definitions, RLS policy expressions,
and the seed function. It does **not** validate Supabase-specific behaviour that
only exists on the hosted platform (GoTrue user provisioning, PostgREST schema
cache, Storage internals).

## What was run

### 1. Full migration chain applies

All migrations were applied in order. The chain reaches a fixpoint: re-running
every file produces no new errors.

Two categories of message appear on a second pass and are expected, not defects:

- `NOTICE: relation "..." already exists, skipping` — the intended effect of the
  repo's `IF NOT EXISTS` convention.
- `ERROR: policy "user_roles_self_select" for table "user_roles" already exists`
  in `010_sprint51_core_tables.sql` — a pre-existing re-run artifact. The policy
  is created unconditionally there and again via `000_missing_core_tables.sql`.

**Result: pass.** Neither category affects a first application to a database.

### 2. Authority schema present

31 `authority_*` tables created. Spot-checked definitions:

- `authority_technical_issues.issue_type` CHECK includes both
  `duplicate_meta_description` and `missing_meta_description` after migration
  `022`, confirming the constraint is widened rather than replaced.
- `seed_ai_authority_engine(uuid)` exists.

### 3. Seed function behaviour

```
SELECT seed_ai_authority_engine('<org>');
→ {"seeded": true, "cities": 5, "services": 4, "markets": 20,
   "engines": 5, "templates": 22, "organization_id": "..."}
```

Run twice against the same org; row counts after the second run were unchanged:

```
locations=5 services=4 markets=20 engines=5 templates=22
```

**Result: pass.** The function is genuinely idempotent and produces exactly the
5 city × 4 service = 20 market matrix the specification requires. It reports no
fabricated projects, reviews, or AI results.

### 4. RLS effectively isolates tenants

All 31 authority tables carry exactly one RLS policy. `authority_locations`:

```sql
organization_id IN (
  SELECT organization_members.organization_id
  FROM organization_members
  WHERE organization_members.user_id = auth.uid()
)
```

This expression was executed against real Postgres with two orgs and two users,
acting as `authenticated` with a `request.jwt.claim.sub` claim — the same
mechanism PostgREST uses. One org's user:

| Probe | Expected | Observed |
|---|---|---|
| SELECT | sees own org only | own org only |
| INSERT into the other org | rejected | rejected |
| UPDATE the other org's rows | 0 rows | 0 rows |
| DELETE the other org's rows | 0 rows | 0 rows |
| other org's data after tampering | unchanged | unchanged |
| `anon` role, no JWT | 0 rows | 0 rows |

**Result: pass.**

### 5. Test fixtures match the live schema

Every table and column referenced by the fixtures in
`tests/integration/rls-live.test.ts` was checked against
`information_schema.columns`: **25/25 match.**

The literal fixture payloads and tamper values were then inserted and updated
for real, so CHECK-constraint violations would surface here. **Pass.**

The FK-chained fixtures (`authority_markets`, `authority_queries`,
`authority_query_runs`, `authority_responses`, `authority_mentions`,
`authority_citations`, `authority_competitor_snapshots`,
`authority_competitor_changes`) were built in dependency order and exercised
identically. **Pass.**

This step caught three genuine bugs in the fixture set before any live run:

| Table | Defect | Fix |
|---|---|---|
| `authority_citation_gaps` | fixture used a non-existent `priority` column | use `gap_severity` |
| `authority_alerts` | `alert_type` value not in the CHECK list | use `visibility_drop` |
| `authority_integrations` | `provider` value not in the CHECK list | use `google_search_console` |

## Still unverified

- **Live RLS on Supabase.** The `tests/integration/rls-live.test.ts` suite still
  reports `LIVE DATABASE REQUIRED` and must be executed against a real test
  project. The plain-Postgres harness above proves the policy expressions are
  correct; it does not prove the hosted project's migrations are applied.
- **`supabase db push` against the live database.** No credentials available.
- **PostgREST and GoTrue behaviour** — schema cache, auth hooks, default grants.

## How to finish validation

Against a dedicated test project (never production):

```bash
SUPABASE_TEST_URL=... \
SUPABASE_TEST_ANON_KEY=... \
SUPABASE_TEST_SERVICE_KEY=... \
  npm run test:live
```

RLS on the authority tables remains **unverified in production** until that
suite has been run.