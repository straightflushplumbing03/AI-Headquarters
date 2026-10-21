# AI Headquarters Blueprint — Straight Flush Plumbing & Leak Detection

Copy-paste deployment for the autonomous SEO, local-search, competitor-intelligence, and
AI-recommendation system.

| File | What it is |
|---|---|
| `01-MASTER-AGENT-PROMPT.md` | The operating prompt. Paste this into the automation. |
| `02-IMPLEMENTATION-SKETCH.md` | The build plan, grounded in what already exists. |
| `03-MCP-AND-INTEGRATIONS.md` | The MCP servers and secrets that make it useful. |
| `README.md` | This file — deployment commands and live ids. |

---

## Live automation ids

Record the id here after creation so future runs can self-inspect.

| Automation | id | Cron (America/Los_Angeles) | State |
|---|---|---|---|
| SFPL AI Headquarters Daily | `1485d659-8663-4776-a507-db0fefed8483` | `0 6 * * 1,3,5` | **ACTIVE** — Mon/Wed/Fri 06:00 PT (trigger changed 2026-10-16) |
| SFPL AI Headquarters Daily (superseded) | `e6684830-a9a5-43d8-9d5a-34fed5257bbf` | `0 6 * * *` | disabled — rollback point only |
| Daily Retry Watchdog | `b946624c-79c2-40a6-be1b-258388a15fb4` | `30 6,9,12,15,18 * * *` | **ACTIVE** — re-dispatches the daily job once on a sandbox failure |
| "New Automation" (legacy) | `df4bcd68-75f3-46f4-ab6f-a4027e5bf8a9` | `0 6 * * 1-5` | disabled — empty prompt, never succeeded |
| GitHub delivery watchdog | `718ce55b-5824-430d-82b0-5cef65349763` | `*/5 * * * *` | disabled |
| GitHub code review | `6bc3be1b-187b-49a9-93d9-9ee4f24f0d5e` | `*/5 * * * *` (UTC) | disabled |

**Exactly one *content* automation should be enabled.** Two jobs on `0 6 * * *` in the
same timezone means two full runs racing on the same branch names. The retry
watchdog is the one permitted second job: it runs off-peak, dispatches only, and
does none of the SEO work.

### Deployed 2026-10-15 (revision 2)

`SFPL AI Headquarters Daily` re-created via `POST /api/automation/v1/preset/prompt`
(HTTP 201, id `1485d659-8663-4776-a507-db0fefed8483`). Payload built by
`build_payload.py` from `01-MASTER-AGENT-PROMPT.md` — 29,846 prompt chars,
`timeout: 1800`, both repositories attached (`AI-Headquarters` +
`-Up2datewebsiteseo`, ref `main`).

**Why revision 2 exists.** The revision-1 run took **1941 s** and was killed at the
1800 s platform ceiling, *after* it had pushed its branch and opened PR #41. The
prompt was restructured for the cap (see the commit "Trim master prompt for the
1800 s cap"): a per-phase time budget, a 20-minute checkpoint rule, and a
steady-state daily loop replacing the completed first-run scaffolding.

The API **does** accept `prompt` on `PATCH /api/automation/v1/<id>`, so the live job
was updated in place rather than replaced. Verified 2026-10-15: patching a
prompt-preset automation with `{"name","prompt","trigger","timeout"}` returned
HTTP 200 and the new prompt length, with `preset_metadata.preset_type` still
`"prompt"`.

(An earlier revision of this file claimed there was no endpoint to update a
preset's prompt. That was wrong — it came from the endpoint table rather than a
test. The table lists only `name, trigger, enabled, timeout` for PATCH.)

`PATCH {"enabled": false}` is the pause/rollback control; re-enable with
`{"enabled": true}`.

### The retry watchdog

A second automation, **`SFPL AI Headquarters Daily Retry Watchdog`**
(`b946624c-79c2-40a6-be1b-258388a15fb4`, cron `30 6,9,12,15,18 * * *`
America/Los_Angeles, timeout 600), watches the daily job and re-dispatches it
**once** — but only on a *fast* failure that never reached the run's ceiling. It
never does the SEO work itself, so it does not violate the one-daily-content-job
rule. It dispatches only; it never edits, enables, or disables anything.

**Do not confuse the two failure classes.** A failed run can carry
`environment_unavailable` / "Timed out: Sandbox not available" and still be a
**budget overrun**: when a run exceeds its wall clock the platform kills it, tears
down the sandbox, and its post-run verification then reports no sandbox. Every run
we have observed failed at the **enforced ceiling** (`started_at → timeout_at` ≈
1920 s, ~32 min, not the 1800 s in the config): `67e154d9` (2026-10-13, 1926 s) and
`1cda9bca` (2026-10-15, 1954 s), plus two `kind: timeout` runs at 1941/2004 s. The
one run that fit its budget (`0883b889`, 947 s) completed. So the watchdog fires on
**elapsed time**, not on the error string, and a budget overrun is fixed by making
the run fit — the deterministic `scripts/daily_measure.py` pre-stage (commit
`897e7be`) — never by a retry.

### The legacy 6 AM automation

`df4bcd68-...` ("New Automation") was `enabled=true` with an **empty `prompt`
field** — a custom-tarball automation whose script never carried instructions. It
failed every run at `current_phase: "Starting automation"`. It is now disabled.
A prompt preset cannot fail this way, because the instructions live in `prompt`.

### The legacy 6 AM automation (diagnosis, kept for reference)

`GET /api/automation/v1` returned one enabled job named **"New Automation"**:

| Field | Value |
|---|---|
| id | `df4bcd68-75f3-46f4-ab6f-a4027e5bf8a9` |
| cron | `0 6 * * 1-5` in `America/Los_Angeles` (**weekdays only** — the spec asks for all 7 days) |
| enabled | `true` |
| timeout | `600` s (10 min — too short for this workload) |
| `prompt` | **empty string** — it is a custom-tarball automation, not a prompt preset |
| `tarball_path` | `oh-internal://uploads/890a9e31-…` |
| `entrypoint` | `python3 main.py` |
| created / last triggered | `2026-10-15T05:35:09Z` / `2026-10-15T05:35:57Z` |

Both runs it has ever made **FAILED**:

```
status: FAILED
current_phase: "Starting automation"
conversation_id: None          <-- no conversation was ever started
cost: None
error_detail: exit_code=1
  File "main.py", line 21, in fire_callback
    urllib.request.urlopen(request, timeout=10)
urllib.error.HTTPError: HTTP Error 401: Unauthorized
```

**Diagnosis:** the wrapper died in its completion-callback helper with a `401`
before any agent conversation ran. The run stalled ~13 minutes in
`Starting automation` and was then marked FAILED. So the automation has been
**enabled and failing silently** — it has never once done the SEO work. An
enabled schedule is not a working system.

**Recommended replacement:** delete this automation and deploy the prompt-preset
automation below. A prompt preset carries its instructions in the `prompt` field,
so it cannot silently lose them the way an empty-prompt tarball job does.

> Note: an earlier generation of automations existed
> (`SFPL Intelligence HQ Daily 6 AM` = `5dc89b41-…`, `SFPL Intelligence HQ Weekly Review` =
> `0582d219-…`, `Growth Engine A` = `4c5213f7-…`). Those ids returned **404** when checked on
> 2026-10-15, so they no longer exist in this org. The authoritative live list is whatever
> `GET /api/automation/v1` returns. Always re-check rather than trusting this table.

---

## Preflight — the code must be on `main` first

The automation clones the repositories at run time. Anything not committed and
pushed to `main` does not exist for the automation.

**Verified gap on 2026-10-15:** `origin/main` of `-Up2datewebsiteseo` does **not**
contain `scripts/tavily_search.py`, `scripts/entity_consistency_check.py`,
`scripts/perplexity_agent.py`, `growth-engine/ai_agent_client.py`,
`growth-engine/tavily_search.py`, or `.mcp.json`. They are untracked working-tree
files. Deploying the automation before committing them would give every run a
clone that lacks its own tooling.

Order of operations is therefore: **commit → push → verify on `main` → then deploy.**

Also required for the run to do anything useful:

| Item | Needed for | Status 2026-10-15 |
|---|---|---|
| `GITHUB_TOKEN` | clone + push + PR | set |
| `TAVILY_API_KEY` | conventional-search sweeps | **not set in this environment** — must be added to the automation's secrets |
| `PERPLEXITY_API_KEY` | genuine AI-surface testing | not set — that surface stays `unmeasured` until it is |

`OPENHANDS_API_KEY` is present and the automation API answered `HTTP 200`.

---

## Deploy in three steps

### Step 1 — create the daily automation

Copy the whole prompt from `01-MASTER-AGENT-PROMPT.md` (everything between the two `---`
markers) into `$PROMPT`, then:

```bash
export OPENHANDS_HOST="https://app.all-hands.dev"
PROMPT="$(sed -n '/^## THE PROMPT/,/^## END OF PROMPT/p' 01-MASTER-AGENT-PROMPT.md \
  | sed '1d;$d' | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')"

curl -s -X POST "${OPENHANDS_HOST}/api/automation/v1/preset/prompt" \
  -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "name": "SFPL AI Headquarters Daily",
  "prompt": ${PROMPT},
  "trigger": {"type": "cron", "schedule": "0 6 * * *", "timezone": "America/Los_Angeles"},
  "timeout": 1800,
  "repos": [
    {"url": "https://github.com/straightflushplumbing03/AI-Headquarters", "ref": "main"},
    {"url": "https://github.com/straightflushplumbing03/-Up2datewebsiteseo", "ref": "main"}
  ]
}
EOF
)" | python3 -m json.tool
```

`timeout` is capped at 1800 seconds on this platform (a `PATCH {"timeout": 3600}` was previously
observed to return HTTP 422). `0 6 * * *` in `America/Los_Angeles` handles daylight saving
automatically, because the timezone is an IANA name rather than a fixed UTC offset.

**On the `repos` field:** the exact JSON schema for `repos` is documented in the OpenHands
automation skill, not on the public docs pages (the public Automations overview page describes
prompt- and plugin-based automations but not this request body). The shape used above was
validated against the live endpoint, which returned `422` only for missing top-level fields
(`name`, `prompt`, `trigger`) and accepted the nested objects. If a future API version rejects
`repos`, drop the field and let the prompt clone the repositories itself — the master prompt
already does exactly that in its Step 0.

### Step 2 — create the weekly review

Same command with these two fields changed:

```json
"name": "SFPL AI Headquarters Weekly",
"trigger": {"type": "cron", "schedule": "0 6 * * 1", "timezone": "America/Los_Angeles"}
```

### Step 3 — verify, then dispatch once

```bash
# List what actually exists
curl -s -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  "${OPENHANDS_HOST}/api/automation/v1?limit=20" | python3 -m json.tool

# Inspect one automation (replace the id)
curl -s -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  "${OPENHANDS_HOST}/api/automation/v1/<ID>" | python3 -m json.tool

# Trigger a run now, do not wait for 06:00
curl -s -X POST -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  "${OPENHANDS_HOST}/api/automation/v1/<ID>/dispatch"

# Watch the runs
curl -s -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  "${OPENHANDS_HOST}/api/automation/v1/<ID>/runs?limit=5" | python3 -m json.tool
```

Run statuses: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` (inspect `error_detail`).

**A configuration file is not proof that automation runs.** Only `COMPLETED` on a real run is.

---

## Pause and resume (emergency stop)

```bash
# Pause without deleting — keeps the definition and history
curl -s -X PATCH "${OPENHANDS_HOST}/api/automation/v1/<ID>" \
  -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  -H "Content-Type: application/json" -d '{"enabled": false}'

# Resume
curl -s -X PATCH "${OPENHANDS_HOST}/api/automation/v1/<ID>" \
  -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  -H "Content-Type: application/json" -d '{"enabled": true}'
```

The application-level kill switch already exists in the platform and is independent of this:
`POST /api/founder/emergency-stop` in `AI-Headquarters`.

---

## Known blocker at deploy time

On 2026-10-15 two automations in this org were already failing on every run with:

```
HTTP Error 401: Unauthorized   (in fire_callback)
stdout: Automation prompt:
```

The script ran but the prompt was empty and the completion callback was rejected. Both were
`github-delivery-watchdog` / `github-pr-reviewer` template automations, not the AI Headquarters
prompt. Worth knowing before you assume a new automation is healthy — always dispatch once and
read `/runs`.

---

## Order of operations (do not skip)

1. Register `PERPLEXITY_API_KEY` — one key flips AI visibility from `unverified` to measured.
2. Enable the GitHub, Supabase, and Tavily MCP servers.
3. Deploy the daily automation and dispatch it once by hand.
4. Read the first report. Expect many `BLOCKED` / `UNMEASURED` lines. That is correct and honest.
5. Then work Phase 4 in `02-IMPLEMENTATION-SKETCH.md` (Search Console, Bing, GA4) to convert
   `UNMEASURED` into real numbers.

---

## Review-before-merge checklist (owner)

The daily agent opens PRs and requests review; it never merges. For the gate to be real and
not self-restraint, the repository must enforce it. Fail closed if any box is unchecked.

**Known gap:** the agent runs as the `straightflushplumbing03` account, which is also the only
account with access. GitHub will not let a PR's author be its reviewer, and branch protection
cannot require "a different account approved" when there is only one account. So today the gate
is the agent's own instruction. To make it enforced:

- [ ] **Add a second GitHub account as a collaborator** (even a spare account you control).
      Until then, Copilot review is the only automated reviewer available.
- [ ] Branch protection on `main`: **Require a pull request before merging**.
- [ ] Branch protection: **Require approvals >= 1**, and do **not** enable "Allow specified
      actors to bypass required pull requests".
- [ ] Branch protection: **Dismiss stale approvals** when new commits are pushed.
- [ ] Required status checks: `unittest discover`, `validate_knowledge_base.py`, `seo_audit.py`
      (needs a CI workflow; the repo has none yet).
- [ ] Optional: enable **Copilot code review** so every PR gets an automated pass; request it
      with `POST /repos/{owner}/{repo}/pulls/{n}/requested_reviewers`
      `{"reviewers":["copilot-pull-request-reviewer[bot]"]}`.
- [ ] Confirm the agent cannot bypass: after rules are active, a self-merge attempt must fail.

Request an available review when you open a PR (the owner account cannot review its own PR):

```bash
# Copilot (works today if Copilot review is enabled on the repo)
curl -s -X POST -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/straightflushplumbing03/-Up2datewebsiteseo/pulls/<N>/requested_reviewers" \
  -d '{"reviewers":["copilot-pull-request-reviewer[bot]"]}'
```

