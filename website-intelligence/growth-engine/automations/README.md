# Growth Engine Automations

Canonical prompts and schedule definitions for the OpenHands automations that
operate this growth engine. Keep each `.prompt.md` here in sync with the live
automation definition (record the live automation id below once created).

All schedules use **America/Los_Angeles** so they follow daylight saving.

| ID | Automation | Schedule (PT) | Scope | Live automation id |
|----|-----------|---------------|-------|--------------------|
| **D** | **SFPL AI Headquarters Daily** | `0 6 * * 1,3,5` (Mon/Wed/Fri) | L1 + L2 (PRs) | `1485d659-8663-4776-a507-db0fefed8483` (created 2026-10-15; trigger changed to Mon/Wed/Fri 2026-10-16, ACTIVE) |
| **R** | **SFPL AI Headquarters Daily Retry Watchdog** | `30 6,9,12,15,18 * * *` | L1 + re-dispatch | `b946624c-79c2-40a6-be1b-258388a15fb4` (created 2026-10-13; recreated 2026-10-15, ACTIVE) |
| **S** | **SFPL AI Headquarters System Supervisor** | `0 7 * * 2,6` (Tue/Sat) | L1 + L2 (report PR) | `c1b547c8-da3b-4fa1-ba8a-e99a55e0f59e` (created 2026-10-16, ACTIVE) |
| **HQ-D** | **SFPL Intelligence HQ Daily 6 AM** | `0 6 * * *` (daily incl. weekends) | L1 + L2 (PRs) | `df8e3c2d-1fac-47fb-9af2-38d59c8239c5` (**created 2026-10-19, ACTIVE**) |
| **HQ-W** | **SFPL Intelligence HQ Weekly Review** | `0 6 * * 1` (Mondays) | L1 + L2 (PRs) | `d948c2e2-e4a4-49f1-a2e4-40fdf815faea` (**created 2026-10-19, ACTIVE**) |
| ~~HQ-D (gen-1)~~ | ~~SFPL Intelligence HQ Daily 6 AM~~ | `0 6 * * *` | L1 + L2 (PRs) | `5dc89b41-6880-40e6-950c-14a635f7bd62` (**retired 2026-10-15 — 404**) |
| ~~HQ-W (gen-1)~~ | ~~SFPL Intelligence HQ Weekly Review~~ | `0 6 * * 1` | L1 + L2 (PRs) | `0582d219-de15-42c2-83b5-4bc92995edce` (**retired 2026-10-15 — 404**) |
| A | Morning AI Search Visibility & Competitor Intelligence | `0 6 * * *` | L1 + L2 (PRs) | `4c5213f7-080c-4edd-97a2-30962419bd14` (created 2026-10-09; **disabled 2026-10-12**, superseded by HQ-D) |
| B | Daily Technical Health Check | `20 6 * * *` | L1 + L2 | _(planned)_ |
| C | Controlled Website Improvement | `0 7 * * 1-5` | L2 (branch/PR only) | _(planned)_ |
| D | Weekly Strategy Review | `30 7 * * 1` | L1 + L2 | _(planned — superseded by HQ-W)_ |
| E | Monthly Growth Audit | `0 8 1 * *` | L1 + L2 | _(planned)_ |

> **One daily content job.** The system was redeployed on 2026-10-15 as
> `SFPL AI Headquarters Daily` (see `ai-headquarters-blueprint/README.md`); the
> generation-1 HQ-D/HQ-W ids now return `404`. The retry watchdog (`HQ-R`) is a
> **reliability** job and the system supervisor (`HQ-S`) is an **oversight** job —
> neither does the daily work. Exactly one *content* automation should be enabled
> at a time; `scripts/system_supervisor.py` fails if that stops being true.

## Oversight — the system supervisor (HQ-S)

`ai-headquarters-supervisor.prompt.md`, `0 7 * * 2,6` PT (Tue + Sat). Because the
daily content job runs Mon/Wed/Fri at 06:00, supervision lands the **next
morning** and reviews what those runs actually produced. It runs
`scripts/system_supervisor.py`, a deterministic drift detector (no LLM until the
report), which checks that exactly one content automation is enabled, the schedule
is intact, the live prompt matches the repo, the AI surface is measured (not just
a conventional-search proxy), no PR was self-merged, the open-PR backlog is
bounded, change volume is within budget, and no unexplained branch appeared. It
writes `growth-engine/reports/supervisor/<date>.md` and opens a PR — never merges.
History: `growth-engine/data/supervisor_history.jsonl`.

## Reliability — runs that overrun the wall-clock ceiling (ISSUE-009)

A scheduled run can fail with `environment_unavailable` /
`error_detail: "Timed out: Sandbox not available"`
(`status_detail.phase: verification`). **Do not read that string as a provisioning
failure.** Every run we have observed failed at the **enforced ceiling**
(`started_at → timeout_at` ≈ 1920 s, ~32 min, not the 1800 s in the config): the
platform kills the run for running out of clock, tears down the sandbox, and its
post-run verification then finds no sandbox and records `environment_unavailable`.
The string is a *symptom of the timeout*, not proof the sandbox was never
provisioned. Seen 2026-10-13 (`67e154d9`, 1926 s) and 2026-10-15 (`1cda9bca`,
1954 s, and two `kind: timeout` runs at 1941/2004 s). The one run that fit its
budget (`0883b889`, 947 s) COMPLETED.

The real fix is to make the run fit: `scripts/daily_measure.py` is a deterministic
pre-stage (~5 s) that runs every check and writes
`growth-engine/data/daily_context.json`, and the master prompt is budgeted around the
real ~1920 s ceiling (commit `897e7be`).

**`HQ-R` watchdog** (`ai-headquarters-daily-watchdog.prompt.md`, `30 6,9,12,15,18 * * *` PT)
is a narrow safety net: it re-dispatches the daily run **once**, and only on a *fast*
failure that never reached the ceiling (a genuine provisioning blip). It explicitly
does **not** re-dispatch a run that consumed its clock. It never edits an
automation, never merges, and never touches the site.

**Tell the failure classes apart** — the key is **elapsed time**, not the error:

| `status` / `elapsed` | `conversation_id` | Meaning | Action |
|---|---|---|---|
| `FAILED`, `elapsed ≥ ~1500 s` | any | budget overrun | **fix the prompt**; do NOT retry |
| `FAILED`, `elapsed` ≪ ceiling, sandbox marker | `null` | provisioning failure | **retry once** (HQ-R) |
| `execution_error` + `KeyError: 'AUTOMATION_AGENT_PROFILE_ID'` | any | automation mis-configured | **fix the config**; retry cannot help |

Helper: `python3 growth-engine/tests/classify_automation_run.py <runs.json>`.

## Intelligence HQ (re-created 2026-10-19)

The owner requested a single named, persistent system — **Straight Flush Plumbing
Intelligence HQ** — under OpenHands Cloud. Both automations are deployed from the
canonical prompts in this directory by
`deploy_intelligence_hq.py` (dry-run by default; `--deploy` applies):

| Automation | id | Cron (America/Los_Angeles) | Timeout | State |
|---|---|---|---|---|
| `SFPL Intelligence HQ Daily 6 AM` | `df8e3c2d-1fac-47fb-9af2-38d59c8239c5` | `0 6 * * *` (daily incl. weekends) | 1800 s | **ACTIVE** |
| `SFPL Intelligence HQ Weekly Review` | `d948c2e2-e4a4-49f1-a2e4-40fdf815faea` | `0 6 * * 1` (Mondays) | 1800 s | **ACTIVE** |

Both use the prompt preset with `repos` = this repository (`main`), so each run
starts from the latest committed knowledge base. Both are read-mostly: they commit
research/reports to a dated `intelligence-hq/…` branch and open PRs, never touching
the production branch directly. Verified 2026-10-19 via `GET /api/automation/v1/{id}`:
`enabled: True`, `state: ACTIVE`, `trigger.timezone: America/Los_Angeles`,
`preset_metadata.repos` set, prompt length matching the repo file.

**Generation history.** The generation-1 pair (`5dc89b41…`, `0582d219…`) was retired
on 2026-10-15 and returns `404`; the 2026-10-15 redeploy ran as `SFPL AI Headquarters
Daily` (`1485d659…`, Mon/Wed/Fri). The 2026-10-19 re-creation restores the requested
**daily incl. weekends** cadence under the original Intelligence HQ name.

**Overlap note.** `SFPL AI Headquarters Daily` (`1485d659…`, Mon/Wed/Fri) and the
retry watchdog (`b946624c…`) are currently **INACTIVE**, so there is exactly one
enabled daily content job. Do not enable `1485d659…` while HQ-D runs — two jobs at
06:00 PT would race on the same branch names.

**Relationship to Automation A:** A already covered the morning visibility +
competitor research loop at the same 06:00 PT slot. HQ-D supersedes A and adds the
industry-watch, ≥5-idea generation, and durable-knowledge requirements. Automation A
is disabled while HQ-D is enabled. This is the consolidation of ISSUE-005.

## Decision on B–E (deliberate, documented)

The environment **already runs three daily agents** (Scout competitor intel,
Strategist SEO plan, Sentinel retry). Creating B–E immediately would add
overlapping runs that can conflict and burn tokens for little gain. Per the
master spec ("create the highest-priority automations first", "prevent
overlapping runs from making conflicting changes"), only **Automation A** was
created autonomously. B–E are documented and proposed for owner approval in
`proposals/2026-10-09-priority-actions.md` (P-004), to be scheduled **after**
the existing agents are consolidated.

- **B (Technical Health)** is a deterministic check — implement it as a *custom
  no-LLM script* (`growth-engine/tests/crawler_access_check.sh` + a small
  runner) rather than an LLM agent, so it costs no tokens.
- **D/E** fold naturally into A + the existing Strategist weekly/monthly cadence.

## Pre-existing automations (to be reconciled — see KNOWN_ISSUES ISSUE-005)

- `Scout: Daily Competitor Intel` — `30 5 * * *` — overlaps A/D
- `Strategist: Daily SEO Action Plan` — `30 6 * * *` — overlaps A/C
- `Sentinel: Scout Auto-Retry` — `30 7,11 * * *` — retry wrapper
- `Implementer: Approved Page Changes [MANUAL ONLY]` — disabled — keep for L2/L3

## Safety

- A and B are **read-mostly** and may open PRs; they never merge and never
  touch website pages.
- C applies **pre-approved** Level 2 changes on a branch/PR.
- Anything Level 3 (identity, prices, phone, claims, DNS/hosting, deletions,
  business profiles, spend) is proposed to the owner, never executed.
