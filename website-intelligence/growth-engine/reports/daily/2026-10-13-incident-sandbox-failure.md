# Incident Report — daily runs die at the wall-clock ceiling; the platform mislabels it "Sandbox not available" (ISSUE-009)

Timezone: America/Los_Angeles · Approval: Level 2 (tooling + automation config) ·
Branch `intelligence-hq/fix-sandbox-failure-2026-10-13`

> This is an **incident/reliability report**, not the regular morning intelligence
> sweep. It records why a scheduled daily run can fail and what was shipped to
> recover it. No website page, schema, claim or copy was changed.

## URGENT marker — none on the site

`crawler_access_check.sh` → **PASS** (exit 0). All crawler UAs return **200** with no
`cf-mitigated` header; **ISSUE-001 remains RESOLVED.** No downtime, noindex, or
crawler block. The failure below is a run-budget issue, not a site issue.

## What failed

Four runs across two automation generations failed, every one of them at the
**wall-clock ceiling** (`started_at → timeout_at` ≈ 1920 s):

| Date | Automation | Run | Elapsed | Platform error | `sandbox_id` |
|---|---|---|---|---|---|
| 2026-10-13 | HQ-D `5dc89b41` (retired) | `67e154d9` | 1926 s | `environment_unavailable` / "Sandbox not available" | none |
| 2026-10-15 | `e6684830` (superseded) | `010cf8d9` | 1941 s | `timeout` | present |
| 2026-10-15 | `e6684830` (superseded) | `4f9c7df0` | 2004 s | `timeout` | present |
| 2026-10-15 | `1485d659` (live) | `1cda9bca` | 1954 s | `environment_unavailable` / "Sandbox not available" | present |

The one run that **fit** its budget — `0883b889`, a manual dispatch of the live
automation — **COMPLETED** in 947 s and did real work.

## Root cause (corrected)

The run **runs out of its budget**. The enforced ceiling is **start + ~1920 s**
(~32 min), not the 1800 s in the config — measured as `timeout_at - started_at`
across all four failures. When the platform kills the run it tears down the sandbox,
and its post-run **verification** step then finds no sandbox and records
`environment_unavailable` / "Timed out: Sandbox not available". **That string is a
symptom of the timeout, not a provisioning failure.** The failing runs carried a
`sandbox_id` (except `67e154d9`, which still ran 1926 s).

The first diagnosis on this branch read that string as a transient
sandbox-provisioning failure and proposed a retry. That was wrong: **a retry cannot
fix a budget overrun** — it burns another ~30 min and can race the first run's
branch. The discriminator is **elapsed time**, not the error string.

## The real fix (landed on `main` 2026-10-15, commit `897e7be`)

- `scripts/daily_measure.py` — a deterministic pre-stage (~5 s) that runs every
  check and writes `growth-engine/data/daily_context.json`, so the agent no longer
  spends the clock deciding how to measure.
- The master prompt was restructured around the real ~1920 s ceiling.
- **Proven:** a dispatched run completed in **947 s** (half the ceiling).

## What this branch still adds

- **Retry watchdog** `SFPL AI Headquarters Daily Retry Watchdog` (prompt
  `automations/ai-headquarters-daily-watchdog.prompt.md`,
  `30 6,9,12,15,18 * * *` PT) — re-dispatches **once** only on a *fast* failure that
  never reached the ceiling. It explicitly does **not** re-dispatch a run that
  consumed its clock.
- **Classifier + regression test** `tests/classify_automation_run.py`,
  `tests/test_classify_automation_run.py`, fixtures in `tests/fixtures/`. The
  classifier keys on **elapsed time vs. the ceiling**, with the real `67e154d9`
  (no sandbox, but 1926 s → `budget_overrun`) as the regression case that a naive
  "sandbox marker → retry" rule would get wrong.

## Diagnostic rule — tell the classes apart

| `status` / `elapsed` | `conversation_id` | Meaning | Action |
|---|---|---|---|
| `FAILED`, `elapsed ≥ ~1500 s` | any | budget overrun | **fix the prompt**; do NOT retry |
| `FAILED`, `elapsed` ≪ ceiling, sandbox marker | `null` | provisioning failure | **retry once** |
| `execution_error` + `KeyError: 'AUTOMATION_AGENT_PROFILE_ID'` | any | automation mis-configured | **fix the config**; retry cannot help |

Helper: `python3 growth-engine/tests/classify_automation_run.py <runs.json>`.

## Tests

- `python3 growth-engine/tests/validate_knowledge_base.py` → OK.
- `bash growth-engine/tests/crawler_access_check.sh` → PASS.
- `python3 -m unittest discover -s growth-engine/tests` → all pass (includes the
  corrected classifier tests).

## Integration & data limitations

- Google Search Console, GA4, GBP remain **not connected** (P-002).
- No notification channel (P-005) — the report and PR are the channel.
- No visibility sweep was run in this incident pass.

## Next priorities

1. Confirm the next scheduled run fits its budget now that `daily_measure.py` is the
   first action.
2. Keep the watchdog's target id in sync with the live daily automation.
3. Revisit the watchdog only if a genuine fast sandbox-provisioning failure recurs.
