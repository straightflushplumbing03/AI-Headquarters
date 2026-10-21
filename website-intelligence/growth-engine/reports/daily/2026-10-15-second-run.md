# Daily Report — 2026-10-15 (second run)

Timezone: America/Los_Angeles · Run: Intelligence HQ daily (cron `0 6 * * *`) ·
Duration: ~16 min · **Supplementary run — see note**

> **Why this file exists.** The 06:00 run already wrote
> `growth-engine/reports/daily/2026-10-15.md` and its PR **#41**
> (branch `intelligence-hq/daily-2026-10-15`) was **merged at 17:23Z**. This is a
> deliberate same-day second run, matching the precedent of PRs #23 and #26. The
> primary report stands; this file records only what the second run measured and
> changed, and does not overwrite it.

## Run record

| Field | Value |
|---|---|
| Run date | 2026-10-15 (America/Los_Angeles) |
| Start (UTC) | 2026-10-15T19:20:51Z |
| Completion status | `COMPLETED` |
| Elapsed | ~16 min (~960 s) |
| Approached the 1800 s cap? | No — well inside budget |
| Previous run succeeded? | Yes — 06:00 run `COMPLETED`, PR #41 merged 17:23Z |
| Killed-run check | No branch matching `intelligence-hq/daily-2026-10-15` left unmerged; PR #41 merged, nothing to resume |

## What changed since the last run

1. **A second live duplicate host was found that the entity check had been
   calling "gone".** `straightflushplumb8.wixsite.com` 404s at its root but serves
   `/straightflushplumb-1` with HTTP 200, no `robots` meta, and a self-canonical —
   and it ranked **#1** for the brand query. The check probed only the root, so it
   recorded `verdict: gone` in **8** consecutive records today. Fixed; see
   ISSUE-018. **This is the substantive change of the run.**
2. **Brand-control validation now passes against live data.** Two brand queries
   return the business and its owned hosts, confirming the visibility matcher
   reports `cited` when it should. All 10 target service+city queries remain
   `absent` — the ISSUE-015 baseline is unchanged.
3. Everything else is flat: 74/74 sitemap URLs 200, all crawler user-agents 200,
   entity check exit 1 (now for the correct, larger reason), 130 tests pass.

## Daily executive summary

- **Website health:** `VERIFIED` — crawler access OK for Googlebot, Bingbot,
  GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Applebot; `robots.txt`,
  `sitemap.xml`, `llms.txt` all 200. `sitemap.xml` valid, 74 `<url>` entries.
- **Platforms successfully tested:** Tavily conventional search proxy (12 queries:
  10 target + 2 brand controls). Perplexity / ChatGPT / Gemini / Grok **not
  tested** — keys absent (`BLOCKED`).
- **Queries executed:** 12 successful / 0 failed (`test_type: conventional_proxy`).
- **Services & cities covered:** 10 target intents across Laguna Niguel, Mission
  Viejo, Dana Point, Laguna Hills, Aliso Viejo, South Orange County + 2 brand.
- **Changes since last comparable run:** entity-consistency control corrected
  (ISSUE-018); no website page, schema, claim or copy touched.

## AI visibility

| Platform | Tested | Recommendation rate | Mention rate | Citation rate | Sample | Confidence |
|---|---|---|---|---|---|---|
| Tavily (conventional proxy, **not** an AI surface) | Yes | `UNMEASURED` | 0/10 targets (absent); 2/2 brand controls cited | 0/10 | 12 | High (controls cited) |
| Perplexity Agent API | No — `BLOCKED` (no `PERPLEXITY_API_KEY`) | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` | 0 | — |
| ChatGPT / OpenAI | No — `BLOCKED` (no `OPENAI_API_KEY`) | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` | 0 | — |
| Gemini | No — `BLOCKED` (no `GEMINI_API_KEY`) | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` | 0 | — |
| Grok (xAI) | No — `BLOCKED` (no `XAI_API_KEY`) | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` | 0 | — |
| Google Search / Maps / AI Overviews | No authorized programmatic API | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` | 0 | `unsupported` — preserved, **not** a zero |
| Copilot / Bing, Apple Maps, Claude, Yelp, YP | No authorized interface | `UNMEASURED` | `UNMEASURED` | `UNMEASURED` | 0 | `unverified` |

**Notable queries where SF appeared:** only the two brand controls
(`Straight Flush Plumbing & Leak Detection`, `Straight Flush Plumbing Laguna
Niguel`). On the first, the **top result was the Wix duplicate**, not the real
site; `straightflushplumbingoc.com/about.html` was #1 on the second.

**Notable queries where SF was absent:** all 10 target queries, unchanged from the
06:00 run — including `plumber in Laguna Niguel`, `slab leak detection Mission
Viejo`, `emergency plumber South Orange County`.

**Source URLs cited** (domain frequency across today's 52 result rows):
`yelp.com` 81, `facebook.com` 43, `efficientplumbing.com` 40,
`barkerandsonsplumbing.com` 20, `clearwaterplumbingoc.com` 19, `rotorooter.com` 15,
`leakstar.com` 15.

> **Interpretation limit:** Tavily is a conventional search proxy. It says nothing
> about AI recommendation behaviour. Absence here is not evidence of AI absence.

## Competitor intelligence

- **Newly discovered:** none beyond the 06:00 run's set.
- **Appearing repeatedly (aggregators):** `yelp.com` and `facebook.com` again
  outrank every single plumbing company in raw frequency — re-confirming the
  06:00 finding that **directory presence, not page quality, is the dominant
  lever** in this market.
- **Dropouts:** none.
- **New evidence on the entity problem:** the highest-ranking result for the
  business *name* is a property the business owns but does not want indexed. That
  is a competitor-shaped loss caused by our own stale asset — cheaper to fix than
  outranking Efficient Plumbing.
- **Gaps to address:** unchanged — no `straightflushplumbingoc.com` page ranks for
  any target intent.

## Technical findings

| Severity | URL | Evidence | Impact | Fix | Status |
|---|---|---|---|---|---|
| High | `straightflushplumb8.wixsite.com/straightflushplumb-1` | HTTP 200, no `robots` meta, self-canonical, `tel:9493746524`; ranked **#1** for the brand query. Entity check recorded `gone` (404 root) in 8 records on 2026-10-15 | Splits entity signals; a duplicate outranks the canonical site for the business name | **Owner action (Level 3)** — unpublish the page/site. Report only; no external change made | `BLOCKED` (needs owner) |
| High | `scripts/entity_consistency_check.py` | Probed only `https://<host>/`, so a 404 root masked an indexable page; `summarize()` reported the host clean | Primary control for ISSUE-014 gave a false negative on an owned duplicate | `DUPLICATE_HOST_PATHS` + most-severe-verdict selection in `check_host()` | **FIXED** — live run now flags both hosts; 5 regression tests |
| Medium | `sitemap.xml` vs. indexable pages | 74 `<loc>` vs 133 HTML files; 5 indexable pages absent from the sitemap: `index.html`, `academy/index.html`, `case-studies/index.html`, `insurance/index.html`, `services/index.html` | Directory hubs may be under-discovered | Confirm intent (deliberate exclusion vs. gap) before changing | `IN PROGRESS` |
| Medium | 52 duplicate-description clusters; 40 AEO-weak pages | `seo_audit.py` §6/§7 | Diluted snippet differentiation; weaker answer-engine eligibility | Address in the content queue, not today | `UNMEASURED` (queued) |
| Info | `main` | 74/74 sitemap URLs 200; crawler check OK; `validate_knowledge_base.py` OK (133 files); 130 tests pass | None | — | `VERIFIED` |

## Open PR triage (this run's explicit constraint)

| PR | Branch | State | Decision |
|---|---|---|---|
| #41 | `intelligence-hq/daily-2026-10-15` | **Merged 17:23Z** | Done — base for this run |
| #38 | `technical-seo/2026-10-15-audit-fixes` | Open, 68 files | **Do NOT merge as-is.** Its `refresh_sitemap.py` lacks the shallow-clone guard and its own `sitemap.xml` stamps 54/74 URLs with the run date (regression of ISSUE-016). Rebase onto `main` and regenerate the sitemap, or land only its page-level metadata changes |
| #36 | `intelligence-hq/fix-sandbox-failure-2026-10-13` | Open, stale (2 days) | Triage: superseded by the 06:00 run's ISSUE-016/017 fixes on `main`. Recommend close after confirming no unique content |
| #35 | `intelligence-hq/blockers-verification-2026-10-13` | Open, stale | Triage: same as #36 |
| #34/#33/#32 | `intelligence-hq/*-2026-10-1[23]` | Open, stale | Prior-run artifacts; superseded. Recommend close |

> The agent's token cannot write PR/issue comments (`403 Resource not accessible by
> personal access token`), so the repository is the durable channel for this triage.
> No PR was merged, closed, or modified by this run.

## Website changes

| Files/pages | Reason | Tests | PR/deploy ref | Verification | Rollback |
|---|---|---|---|---|---|
| `scripts/entity_consistency_check.py` | Probe known duplicate-host paths, not just the root (ISSUE-018) | `TestDuplicateHostPaths` (5 cases) + full suite 130 pass | PR #42 (branch `intelligence-hq/daily-2026-10-15b`) | Live `--run --append` at 19:30:24Z flags **both** duplicates with the Wix URL and HTTP 200 evidence | `git revert` |
| `growth-engine/tests/test_entity_consistency_check.py` | Regression tests for the above | 30 tests in file, 130 suite-wide | PR #42 | `OK` | `git revert` |
| `growth-engine/KNOWN_ISSUES.md` | Correct the ISSUE-014 Wix verdict; add ISSUE-018 | `validate_knowledge_base.py` OK | PR #42 | — | — |
| `growth-engine/data/*.jsonl`, this report, `briefs/strategy-log.md` | Records | Validators pass | PR #42 | — | — |

No page, schema, claim, price, or customer-facing copy was changed this run.

## Priority queue

| # | Action | Impact | Evidence | Effort | Risk |
|---|---|---|---|---|---|
| 1 | **Owner unpublishes the Wix page `straightflushplumb8.wixsite.com/straightflushplumb-1`** (and the base44 host) | High | Live 200, no noindex, **#1 for the brand query**; 2 live duplicates confirmed 19:30:24Z | Owner action | None (removal) |
| 2 | Reconcile PR #38: rebase, regenerate `sitemap.xml` with the guarded tool, or land only its page metadata | High | 54/74 URLs stamped `2026-10-15` vs. none on `main`; ISSUE-016 | Low | Low |
| 3 | Provision one AI-surface key (Perplexity is code-ready) so the visibility programme stops being blind | High | 0 AI-surface rows in every run to date | Low (credential) | None |
| 4 | Decide the 5 indexable pages missing from `sitemap.xml` (deliberate or gap) | Medium | `seo_audit.py` §5 | Low | Low |
| 5 | Close stale PRs #32–#36 | Low | Superseded by merged #41 | Low | Low |

## Integration & data limitations

Not connected / unavailable this run: Perplexity, OpenAI, Gemini, xAI (keys absent
from the sandbox); Google Search Console, GA4, Google Business Profile, call
tracking (`INTEGRATION_STATUS.md`); Bing Webmaster, Apple Business Connect.
Google/Bing/Apple/Copilot surfaces are `unsupported`/`unverified` by policy and
recorded as such, **never as zeros**.

Tavily is a conventional search proxy and is labelled as one. A missing platform is
`UNMEASURED`.

No notification channel is configured, so this report and its PR are the channel.

## Alerts

- **Entity split now confirmed twice over (HIGH):** two owned hosts serve indexable
  content under the business name, and the Wix page currently **outranks the real
  site** for the business name. Owner action required; the engine will not modify
  an external property.
- **Do not merge PR #38 as-is.** It regresses the shallow-clone `lastmod` fix.
- **Credential gap (HIGH):** no AI-surface key present, so AI-visibility remains
  `BLOCKED` rather than measured.

No secrets are reproduced in this report. No spend was incurred (all sources free or
already available).

---

## Continuation (same run, after PR #42 was opened)

Timezone: America/Los_Angeles - Run: Intelligence HQ daily (2nd of 2026-10-15),
continuation - Branch intelligence-hq/daily-2026-10-15b

### Run record

| Field | Value |
|---|---|
| Date | 2026-10-15 |
| Start (UTC) | 19:43:56 |
| Status | COMPLETED |
| Elapsed at report | ~13 min (~780 s) |
| Approached ~1920 s ceiling? | No - comfortable margin |
| Previous run succeeded? | Yes (PR #41 merged 17:23Z) |

### What changed since the first half of this run

1. **PR #42 was mergeable: false (dirty) and is now clean.** main advanced by two
   commits (897e7be pre-stage, 412f485 PATCH claim) after PR #42 branched. The only
   real conflict was the append-only
   growth-engine/data/entity_consistency_history.jsonl; resolved by union plus
   timestamp dedupe (10 rows). Merge commit 21ecad4. No authored content was
   dropped. Root cause of the earlier stall: git identity was unset in the fresh
   sandbox (unable to auto-detect email address).
2. **The blocked visibility sweep has a durable fix** (commit 78caaaa). The sweep
   was not broken by a missing credential - the key is registered. The platform
   injects a secret only into a shell command whose text names the key, so a bare
   python3 scripts/daily_measure.py started its child with Tavily_api_key unset and
   the run recorded a FALSE BLOCKED. Fixes: name the secret in the pre-stage
   command and explain why in the master agent prompt; carry the remedy in the
   blocked note so the next run self-corrects; one regression test. Suite now
   141 tests, OK (was 140).
3. **The entity check ran live and exit-1 confirmed** (not inherited from a prior
   record): canonical straightflushplumbingoc.com HTTP 200;
   straight-flush-plumbing-7fb7cf71.base44.app live_duplicate HTTP 200,
   index, follow, self-canonical; straightflushplumb8.wixsite.com live_duplicate
   HTTP 200, self-canonical; flush-pro-flow.base44.app gone 404. Recorded
   --run --append at 19:50:48Z.

### Corrected visibility figures

The first half reported "50 rows, straight_flush absent in all 50". The corrected
sweep records **62 rows**, of which **60 absent and 2 cited**. The two cited rows
are the brand controls, and they matter:

| Query | Where SF appeared | Rank of the canonical site |
|---|---|---|
| Straight Flush Plumbing Laguna Niguel | straightflushplumbingoc.com present | 1st |
| Straight Flush Plumbing & Leak Detection | Wix duplicate **1st**, base44 duplicate **2nd**, canonical **5th** | 5th |

This is the strongest evidence yet for the entity problem: on a pure brand query
the two owned duplicates occupy positions 1-2 and the canonical site is pushed to
position 5. All 10 target service+city queries remain absent - the ISSUE-015
baseline is unchanged.

### Integration & data limitations

Unchanged from the first half: Perplexity, OpenAI, Gemini and xAI are BLOCKED
(no key), not zero. Tavily is a conventional search proxy, not an AI surface.

### Alerts

- **Entity split (HIGH) - owner action.** Two owned hosts serve indexable content
  under the business name; the Wix page outranks the real site. Requested change:
  unpublish straightflushplumb8.wixsite.com/straightflushplumb-1 and the
  straight-flush-plumbing-7fb7cf71.base44.app site, or set them noindex.
  Evidence: live HTTP 200, index, follow, self-canonical, rank #1/#2 on the brand
  query (19:24Z). The engine will not modify an external property.
- **Do not merge PR #38 as-is** (regresses the shallow-clone lastmod fix).
