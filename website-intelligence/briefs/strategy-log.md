# Strategy Log — Straight Flush Plumbing & Leak Detection

Reverse-chronological. One entry per run. Fields: date, change, reason, target,
competitor insight, expected outcome, result, keep/modify/revert.

---

## 2026-10-16 (fix) — Retired Gemini slug was silently zeroing AI visibility; sitemap ordering normalised

**Status:** Tooling and generated metadata only. **No website page, schema, claim or copy changed.**
Branch `intelligence-hq/daily-2026-10-16`.

**Change 1 — Gemini model slug (High).** The committed default `gemini-2.5-flash` now
answers **HTTP 404 "no longer available to new users"** for new API keys. Every grounded
AI query was failing and was recorded `inconclusive` — the measurement apparatus had
stopped measuring while still looking like a clean day. Replaced with
`gemini-flash-latest` and added a bounded retired-model fallback chain so a future
retirement surfaces as a fallback, not as silence. 9 regression tests added.

**Change 2 — sitemap ordering (Medium).** Committed `sitemap.xml` had `/guides/` at
index 59; the generator's canonical order places it ~10. `refresh_sitemap.py` rewrote
the file every run, so `check_sitemap_idempotent` reported `sitemap_dirty: true` on a
clean tree. Committed the generator's own output; second run is byte-identical. URL set,
lastmods, changefreq and priority are unchanged — pure ordering.

**Verification.** Full suite 286 pass. Live probe: `gemini-2.5-flash` → 404,
`gemini-3.5-flash` resolves (grounding now 429 quota for all models today — a separate,
honest blocker). Generator 2nd run byte-identical.

**Target:** `growth-engine/gemini_search_client.py`, `sitemap.xml`.
**Result:** COMPLETED. **Keep.**
**Blocker (owner):** Gemini grounding quota exhausted (429); two owned duplicate hosts
remain indexable and need removal by the owner, not linkage.

## 2026-10-15 (reliability) — Daily-run failures: corrected root cause + watchdog narrowed

**Status:** Tooling and records only. **No website page, schema, claim or copy changed.**
Branch `intelligence-hq/fix-sandbox-failure-2026-10-13` (PR #36).

**Corrected diagnosis.** A failed run can carry `environment_unavailable` / "Timed
out: Sandbox not available" and yet not be a sandbox-provisioning failure. Four runs
failed at the **enforced ceiling** (`started_at → timeout_at` ≈ 1920 s, ~32 min, not
the 1800 s in the config): `67e154d9` (1926 s), `1cda9bca` (1954 s), and two
`kind: timeout` runs at 1941/2004 s. The platform kills the run for running out of
clock, tears down the sandbox, and its post-run verification then reports no sandbox.
The error is a *symptom*, not a cause. The discriminator is **elapsed time**, not the
error string.

**Change 1 — real fix (already on `main`, commit `897e7be`).** `scripts/daily_measure.py`
is a deterministic pre-stage (~5 s) that runs every check and writes
`growth-engine/data/daily_context.json`; the master prompt is budgeted around the real
ceiling. A dispatched run then COMPLETED in **947 s**.

**Change 2 — retry watchdog narrowed.** `automations/ai-headquarters-daily-watchdog.prompt.md`
now re-dispatches only on a *fast* failure that never reached the ceiling. Previously it
would have re-dispatched any `environment_unavailable` run — i.e. every budget overrun —
which wastes ~30 min of sandbox and can race the first run's branch.

**Change 3 — classifier.** `tests/classify_automation_run.py` keys on elapsed time vs.
the ceiling (`budget_overrun` = do NOT retry; `sandbox` = retry once), with the real
`67e154d9` as the regression fixture a naive "sandbox marker → retry" rule gets wrong.

**Expected outcome:** daily failures are read correctly, the watchdog stops amplifying
overruns, and a genuine provisioning blip still gets one retry.

**Result / next:** confirm the next scheduled run fits its budget.
## 2026-10-15 (daily, third run) - The sitemap "gap" was our own audit bug, not the site

**Status:** Tooling and records only. **No website page, schema, claim or copy changed.**
Branch `intelligence-hq/daily-2026-10-15c`.

**Change - `scripts/seo_audit.py` + `growth-engine/tests/test_seo_audit_sitemap.py`
(ISSUE-020, medium, fixed).** The sitemap cross-check built one set from filesystem
paths (`services/index.html`) and the other from sitemap URL paths (`/services/`), so
no directory hub ever matched. It reported 5 indexable pages missing from
`sitemap.xml` and 59 absent pages, and flagged the same hubs as non-self-canonical.
Both sides are now normalized to URL space and `noindex` stubs are excluded. Live
cross-check: 74 sitemap URLs, 0 in-sitemap-without-a-file, 0 indexable-not-in-sitemap,
0 non-self-canonical. 14 regression tests; suite 155 pass.

**Reason:** the second run's priority #4 asked the owner to decide on 5 missing pages
that do not exist - an owner action item raised against a defect in our own tool. The
59 "absent" pages are `noindex` legacy mirrors and are correctly absent.

**Target:** the audit control itself, not the site. A false positive here both wastes
owner attention and would hide a genuine missing page.

**Competitor insight:** `efficientplumbing.com` appeared in 54 of today's 72 sweep
rows - the most persistent single competitor recorded to date. One day is not a trend;
no page change is justified on it.

**Entity insight:** re-probed both duplicates by hand. `straightflushplumb8.wixsite.com`
404s at its root but serves `/straightflushplumb-1` at HTTP 200, indexable, title
`Home | Straight Flush Plumbing & Leak Detection`. The second run's ISSUE-018 fix
holds. Owner action, not ours.

**Expected outcome:** the next run's audit reports zero sitemap gaps, so any future
gap is real.

**Result:** `VERIFIED` - `seo_audit.py` exits 0 and reports 0/0/0; full suite 155 pass;
`entity_consistency_check.py --run --append` exit 1 with two named live duplicates.

**Keep / modify / revert:** keep.



## 2026-10-15 (daily, second run - continuation) - False BLOCKED on the visibility sweep: secret injection depends on the command text

**Status:** Tooling and records only. **No website page, schema, claim or copy changed.**
Branch `intelligence-hq/daily-2026-10-15b` (PR #42). Continues the entry below.

**Change - pre-stage command + `scripts/daily_measure.py` (ISSUE-019, high, fixed).**
The platform injects a registered secret only into a shell command whose text names
the key. The documented pre-stage is a bare `python3 scripts/daily_measure.py`,
which names no secret, so the child started with `Tavily_api_key` unset and the
sweep was recorded `blocked` - a false blocker, because the key was registered and
working. The master agent prompt now names the secret
(`export Tavily_api_key="${Tavily_api_key}"`) and explains why; `check_visibility()`
now carries that remedy in its `blocked` note so the next run self-corrects. One
regression test; suite 141 pass.

**Reason:** two consecutive runs reported a credential gap that did not exist, and
the sweep is the only evidence stream for ISSUE-015. ISSUE-017 fixed the client's
env-name casing but could not help when the value was never injected.

**Result:** pre-stage with the secret named recorded `visibility_sweep | ok=True`
and 62 real rows - **60 absent, 2 cited**. The two `cited` rows are the brand
controls and are the sharpest entity evidence yet: for
`Straight Flush Plumbing & Leak Detection` the **Wix duplicate ranked #1** and the
**base44 duplicate #2**, pushing the canonical site to **#5**. All 10 target
service+city queries remain `absent` (ISSUE-015 baseline unchanged).

**Keep/modify/revert:** keep. Also merged `origin/main` into PR #42 (commit
`21ecad4`) so it is mergeable again; the only conflict was the append-only
`entity_consistency_history.jsonl`.

---

## 2026-10-15 (daily, second run) — Entity control false negative: a duplicate was hiding behind a 404 root

**Status:** Tooling and records only. **No website page, schema, claim or copy changed.**
Branch `intelligence-hq/daily-2026-10-15b` (PR #42). Supplementary to the 06:00 run
(PR #41, merged 17:23Z).

**Change — `scripts/entity_consistency_check.py` (ISSUE-018, high, fixed).**
`check_host()` probed only `https://<host>/`. `straightflushplumb8.wixsite.com`
returns **404** at its root, so the check classified it `gone` and `summarize()`
reported it clean — in **8** consecutive records today (`10:31:18Z` … `19:26:07Z`).
But `https://straightflushplumb8.wixsite.com/straightflushplumb-1` returns **200**
with no `robots` meta and a self-referencing canonical, and it ranked **#1** for the
brand query `Straight Flush Plumbing & Leak Detection` in today's Tavily sweep —
ahead of the real site's own pages. A 404 root was masking a live indexable duplicate.
`DUPLICATE_HOST_PATHS` now registers known published paths per duplicate host, and
`check_host()` probes the root plus those paths and keeps the most severe verdict
(`_VERDICT_RANK`), returning that URL's evidence. Five regression tests
(`TestDuplicateHostPaths`); full suite 130 tests pass.

**Reason:** the automated control guarding ISSUE-014 was giving a false negative on
one of the two owned duplicate hosts. Site-builder hosts routinely 404 their root
while serving published pages, so this is structural, not a one-off.

**Target:** the entity-consistency control and the daily report's technical-findings
table.

**Competitor insight:** the highest-ranking result for the business *name* is an asset
the business owns but does not want indexed. That loss is self-inflicted and cheaper
to remove than any ranking campaign against Efficient Plumbing. Separately,
`yelp.com` (81) and `facebook.com` (43) again exceed every single plumbing company in
raw frequency across 52 result rows — directory presence remains the dominant lever.

**Expected outcome:** the entity check reports `live_duplicates` for every owned host
serving indexable content, so an owner-facing alert is never suppressed by a 404 root.

**Result:** verified live — `--run --append` at `2026-10-15T19:30:24Z` reports
`live_duplicates: ['straight-flush-plumbing-7fb7cf71.base44.app',
'straightflushplumb8.wixsite.com']`, the Wix entry carrying
`url: .../straightflushplumb-1`, `http_status: 200`. Prior records for the same host
all read `gone` / `404`.

**Keep/modify/revert:** **Keep.** Revert path is `git revert` on PR #42.

**Open item:** PR #38 must not be merged as-is (its `sitemap.xml` regresses the
shallow-clone `lastmod` fix, 54/74 URLs stamped with the run date). PRs #32–#36 are
stale and superseded by merged #41.

## 2026-10-15 (daily) — Automation-integrity run: lastmod idempotency + key resolution

**Status:** Tooling and records only. **No website page, schema, claim or copy changed.**
Branch `intelligence-hq/daily-2026-10-15` (PR #41).

**Change 1 — `scripts/refresh_sitemap.py` (ISSUE-016, medium, fixed).**
The `lastmod` fix landed earlier the same day was measured to be non-idempotent.
The sandbox checks the repo out with `--depth 1`, where `git log --name-only HEAD`
returns a single grafted commit, so every path resolves to the same date. Evidence:
PR #38's head has `<lastmod>2026-10-15</lastmod>` on 54 of 74 URLs; `main` has none dated `2026-10-15`.
The tool now detects a shallow repo, derives each URL's date from its own commit,
falls back to mtime **only** for files the working tree actually changed, and
otherwise preserves the existing value. Rerun in a real depth-1 clone → 0 refreshed,
no diff. A genuinely edited page still bumps (`2026-09-25 → 2026-10-15`).

**Change 2 — `growth-engine/tavily_search.py`, `growth-engine/ai_agent_client.py` (ISSUE-017, high, fixed).**
Both clients read only the vendor-documented all-caps env names, but the platform
injects secrets case-sensitively (`Tavily_api_key`, `Perplexity_api_key`). A
scheduled run therefore reported "no key" and skipped the sweep while appearing to
succeed — a silent loss of the primary evidence stream. Both now accept a list of
names, with the canonical all-caps form still winning when both are set.

**Target:** the automation's own reliability, not the site. **Reason:** a daily
engine whose evidence stream silently disappears and whose sitemap churns is worse
than no engine, because the reports look healthy.

**Competitor insight:** across 40 conventional-proxy queries, the two aggregators
(`yelp.com` 61, `facebook.com` 33) appear in more result sets than any single
plumbing company. **Aggregator/profile presence, not page quality, is the dominant
visibility lever in this market.** `barkerandsonsplumbing.com` (16) is newly
tracked. `straightflushplumbingoc.com` was absent from all 40 — the ISSUE-015
baseline re-confirmed.

**Expected outcome:** the sitemap stops churning (reproducible diffs), and the
visibility sweep resumes as soon as a key is provisioned. **Result:** sitemap
idempotent (`VERIFIED`); sweep still `BLOCKED` — the code fix corrects name
resolution, it does not provision a key.

**Keep/modify/revert:** **KEEP.** Both fixes verified by test and by live rerun.

**Open blockers:** (1) live duplicate host `straight-flush-plumbing-7fb7cf71.base44.app`
returns 200 — entity check exit 1, owner action required, no external change made;
(2) no AI-surface credential present; (3) **PR #38 and PR #41 conflict** on
`scripts/refresh_sitemap.py` and `sitemap.xml` — do not merge both; land the
guarded version and regenerate `sitemap.xml` from it.

---

## 2026-10-13 — Blocker verification & fix pass

**Status:** Additive docs + prompt config only. **No website page/schema/copy changed.**
Branch `intelligence-hq/blockers-verification-2026-10-13`.

- **Change:** (1) Verified the **scheduled** (not manual) runs fired and completed —
  daily cron `1afcbefd` at 06:00:54 PDT, weekly cron `ff3478a3` at 06:00:43 PDT,
  both COMPLETED; the daily run persisted its report and opened PR #33. (2) Made the
  daily prompt's search policy explicit — **Brave → DuckDuckGo Lite → Bing**, fall
  through once on 429/202 — so a blocked provider no longer stalls the sweep. (3)
  Named the exact credential secrets for P-002 and forbade reporting an unavailable
  metric as zero. (4) Corrected the deployment record to **GitHub Pages origin
  fronted by Cloudflare** (with a Cloudflare Workers build check on PRs, no
  `wrangler` config in the repo). (5) Refreshed `README.md` with live schedule,
  deployment, and blocker sections.
- **Reason:** owner asked to fix the PR/access-blocker reporting and confirm the loop
  is genuinely autonomous.
- **Target:** knowledge base + automation prompt config only.
- **Competitor insight:** none (no new sweep this pass).
- **Expected outcome:** accurate reporting; a daily sweep that returns evidence even
  when the primary provider is blocked; blockers tracked with exact owner actions.
- **Result:** scheduled runs verified; prompts in parity with repo after edit;
  `validate_knowledge_base.py` → OK (133 HTML files, exit 0).
- **Keep/modify/revert:** **keep.** No production change to revert.

---

## 2026-10-13 (second pass) — provider lock-out confirmed challenge-based; additive records

**Status:** Additive records only. **No website page/schema/copy changed.**
Branch `intelligence-hq/daily-2026-10-13` (same day/PR; nothing removed).

- **Change:** A second, independent observation pass (different query set) to test
  provider resilience. Brave parsed **8** result pages then served an **anti-bot
  challenge page** for every later query — a **more specific failure mode** than
  the earlier `HTTP 429`. Fallback chain all failed (DDG Lite/HTML **202**, Bing
  HTTP 200 with **no organic anchors**, Mojeek/Ecosia **403**). Result: 8 parsed,
  12 `inconclusive` (never "absent"). Appended the addendum to
  `reports/daily/2026-10-13.md`; added **6 short-form ideas**
  (idea-2026-10-13-15…20) + a second-pass prioritization table.
- **Reason:** confirm whether provider behaviour is stable across query sets and
  record the challenge-page mode so future runs treat it as inconclusive, not absence.
- **Target:** `growth-engine/**` records + daily report only.
- **Competitor insight:** `evansleakdetection.com` and `scottenglishplumbing.net`
  independently **re-confirmed on 6/8** parsed queries; emergency queries again
  franchise-dominated (`rotorooter.com`, `mrrooter.com`). Newly observed:
  `slableakfix.com`, `orange-county.repipe.com`, `proplumberalisoviejo.com`,
  `proplumberirvine.com`, `thedoneriteplumber.com`, `drakewillsplumbing.net`.
- **Expected outcome:** a recorded, reproducible statement of provider behaviour;
  no false "SF absent" from a blocked query.
- **Result:** SF 0/8 recommended/mentioned/cited — same conclusion as the first
  pass. Two new ideas **scored**: GSC measurement runbook (idea-18) and sweep
  provider-fallback/challenge detection (idea-17).
- **Keep/modify/revert:** keep (additive records only).

---

## 2026-10-13 — Daily research run (Brave, rate-limited to 9 queries)

**Status:** Knowledge-base + report only. **No website page/schema/copy changed.**
Branch `intelligence-hq/daily-2026-10-13`.

- **Change:** Daily HQ-D run. Technical health re-verified (all crawler UAs + key
  paths 200; ISSUE-001 still RESOLVED; AI-readable files `/llms.txt`,
  `/llms-full.txt`, `/md/index.md` now live 200). Ran a 9-query Brave conventional
  sweep (rate-limited — 429 after 9). Appended +9 `ai_visibility_history.jsonl`,
  +88 `competitor_observations.jsonl`, +2 `technical_health_history.jsonl`. Added
  two `INDUSTRY_WATCH.md` entries, 7 new + 1 re-scored `INNOVATION_IDEAS.md` ideas,
  a `COMPETITOR_DIRECTORY.md` 2026-10-13 section, and `reports/daily/2026-10-13.md`.
- **Reason:** Standing daily intelligence loop; evidence before conclusions.
- **Target:** knowledge base + report only.
- **Competitor insight:** slab intent → leak specialists with dedicated **per-city**
  slab pages (`leakstar.com` `/slab-leak-detection-service-laguna-niguel.html`,
  verified 200); repipe intent → repipe-specialist domains; "best" queries →
  aggregators (Yelp 3/20 on "best plumber in Laguna Niguel"). SF absent 0/9.
- **Key guideline finding:** Google **deprecated the FAQ rich result** (docs
  removed; feature no longer shown; historically limited to well-known gov/health
  sites). FAQ *content* stays for AEO, but `FAQPage` no longer yields a Google rich
  result — idea-2026-10-12-07 re-scored.
- **Expected outcome:** durable dated record; next run resumes the deferred queries.
- **Result:** research committed; no code change warranted (evidence supports
  proposals, not immediate safe edits). `validate_knowledge_base.py` run on KB edits.
- **Keep/modify/revert:** keep.

---

## 2026-10-13 (run 2) — Daily run: 22-query Brave sweep, 3 industry entries, 7 ideas, no code change

- **Change:** research + reporting only. Appended 22 rows to
  `data/ai_visibility_history.jsonl` (14 successful / 8 inconclusive), 37 rows to
  `data/competitor_observations.jsonl`, one row to
  `data/technical_health_history.jsonl`; added 3 dated entries to
  `INDUSTRY_WATCH.md`; added 7 ideas (`idea-2026-10-13-01..07`) to
  `INNOVATION_IDEAS.md`; updated `COMPETITOR_DIRECTORY.md`; wrote
  `reports/daily/2026-10-13.md`. **No website code change** (no evidence
  justified one).
- **Reason:** daily Intelligence HQ cadence — load knowledge, measure, research,
  prioritize, persist.
- **Target:** AI visibility / AEO / competitor intelligence.
- **Competitor insight:** city × service page coverage plus specialist
  leak-detection positioning recur (evansleakdetection.com 5/14;
  scottenglishplumbing.net 10/14; yelp.com 13/14 aggregator dominance). SF absent
  from all 14 parseable result sets.
- **Expected outcome:** durable evidence for the Tier-1 city coverage gap.
- **Result:** 14/22 queries parseable; SF 0 recommended / 0 mentioned / 0 cited;
  site health OK (all crawler UAs 200, no `cf-mitigated`); KB validation OK
  (133 HTML files).
- **Keep/modify/revert:** **keep**. Next: idea-2026-10-13-01 (city × slab/leak
  pages), idea-2026-10-13-02 (byte-size check), idea-2026-10-13-03 (cost-driver
  explainer, proposal).
- **Branch:** `intelligence-hq/daily-2026-10-13`.

---

## 2026-10-12 (Phase 2) — Intelligence HQ inspection, consolidation & drift fix

**Status:** Additive docs + corrections only. **No website page/schema/copy changed.**
Branch `intelligence-hq/setup-2026-10-12`.

- **Change:** Phase-2 inspection of OpenHands Cloud / Intelligence HQ. (1) Disabled
  the three legacy overlapping automations — Scout (`30 5 * * *`), Strategist
  (`30 6 * * *`), Sentinel (`30 7,11 * * *`) — leaving HQ-D (daily) + HQ-W (weekly)
  as the only active intelligence loops. (2) Re-synced the **live HQ-D prompt** to
  the committed canonical `automations/intelligence-hq-daily.prompt.md`
  (`prompt_chars` 10443) after confirming it had drifted; verified HQ-W was already
  identical. (3) De-duplicated a merge-artifact preamble block in `INDUSTRY_WATCH.md`
  (no dated entry removed). (4) Added Phase-2 entries to `INDUSTRY_WATCH.md`,
  `INNOVATION_IDEAS.md` (IDEA-12/13/14) and the 2026-10-12 daily report.
- **Reason:** owner-requested inspection/reporting; reconcile live vs. repo state
  and close the automation-redundancy gap without touching production.
- **Target:** automation config + knowledge base only.
- **Competitor insight:** none new this phase (no new SERP sweep); re-verified the
  three Google Search Central primary sources cited in the daily run (all HTTP 200).
- **Expected outcome:** one daily loop, no drift between live prompt and repo, clean
  knowledge-base structure.
- **Result:** `validate_knowledge_base.py` → OK (133 HTML files, exit 0); Google
  Search Central sources 200; timeout cap re-confirmed HTTP 422 at 1800 s.
- **Keep/modify/revert:** **keep.** No production change to revert.

---

## 2026-10-12 — Intelligence HQ setup + first-run verification

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `intelligence-hq/setup-2026-10-12`.

- **Change:** Created the persistent **Straight Flush Plumbing Intelligence HQ** —
  new `INDUSTRY_WATCH.md`, `INNOVATION_IDEAS.md`, `reports/weekly/TEMPLATE.md`, and
  canonical automation prompts; two OpenHands Cloud automations created
  (`SFPL Intelligence HQ Daily 6 AM`, `0 6 * * *`, America/Los_Angeles;
  `SFPL Intelligence HQ Weekly Review`, `0 6 * * 1`, America/Los_Angeles).
  Automation A (duplicate 06:00 slot) disabled to avoid overlapping runs.
- **Reason:** Owner request for a named, persistent, continuously improving SEO +
  competitor intelligence system with durable GitHub-backed memory.
- **Target:** knowledge base + automation config (no production pages).
- **Competitor insight:** 7-query Brave sweep — SF absent 0/7; scottenglishplumbing.net
  6/7, efficientplumbing.com 5/7; new repipe-domain observations
  (allamericanrepipe.com, repipe1.com, pexrepipe-repiping.com) on the PEX query.
- **Expected outcome:** each 06:00 PT run loads latest committed knowledge, researches,
  records dated evidence, generates ≥5 scored ideas, and persists via PR.
- **Result:** pending (first scheduled run will confirm). Manual first run produced
  `reports/daily/2026-10-12.md` and committed knowledge.
- **Keep/modify/revert:** keep.
## 2026-10-12 — HQ-D Morning AI Search & Competitor Intelligence (daily run)

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `growth-engine/daily-2026-10-12` (Level 2). Executed 2026-10-11 Sun 22:35 PDT.

- **Trigger context:** canonical HQ-D prompt (`0 6 * * *`, America/Los_Angeles).
  `repos` = this repository, `main`. Approval scope L1 + L2 only; no L3 actions.
- **Technical health:** ISSUE-001 **still RESOLVED** — homepage + `/`, `/robots.txt`,
  `/sitemap.xml`, `/llms.txt` return **200** to all 10 crawler UAs; no
  `cf-mitigated`. `crawler_access_check.sh` exit 0; `validate_knowledge_base.py`
  exit 0 (133 HTML files). 3 rows appended to `data/technical_health_history.jsonl`.
- **Queries:** **36/36 succeeded** on **DuckDuckGo Lite** (conventional proxy) —
  Brave returned HTTP **429** to our egress IP, Bing 200 but unreliable. 7 services
  × 12 cities/counties + 2 "near me".
- **SF visibility:** **absent on all 36** (0 recommended / 0 mentioned / 0 cited).
  AI answer engines remain **unverified** (no credentials) — not zero.
- **Competitors:** 35 domain rows appended to `data/competitor_observations.jsonl`
  (≥3 appearances), counts **recomputed from raw results** (correcting an earlier
  inflated estimate). New repeat competitors: primewestplumbing.com,
  coastplumbing.com, lagunaniguelcaplumbingpros.com, leak-detection-pro.com,
  dialonesonshine.com, americanleakcompany.com + 8 more. Aggregators dominate
  (yelp.com 32/36). `COMPETITOR_DIRECTORY.md` updated.
- **Knowledge files created:** `INDUSTRY_WATCH.md` (dated Google Search Central +
  trade-press entries, all cited), `INNOVATION_IDEAS.md` (6 new ideas, prioritized).
- **Change made:** none — no safe reversible edit was warranted.
- **Top next actions:** (1) owner unlocks GSC/GA4/GBP (P-002); (2) ship IDEA-01
  leak-or-no-leak tool (L2 PR); (3) ship IDEA-03 FAQPage schema on the 3 method pages.
- **Process insight:** the Brave egress IP is now rate-limited (429); rotate to
  DuckDuckGo Lite as the primary conventional proxy, keeping Brave as a fallback.

---

## 2026-10-12 — HQ-W Weekly Strategic Review (second dispatch, 16:26 UTC, run `f0e419f6`)

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `intelligence-hq/weekly-2026-10-12` (Level 1 + Level 2) — **amends the
existing weekly PR #32, not a new PR.**

- **Change:** Re-verified the week's findings for the same Monday job. Appended an
  Appendix to `growth-engine/reports/weekly/2026-10-12.md`; appended this entry;
  added one `technical_health_history.jsonl` row for the 16:26Z crawler re-check.
- **Reason:** The HQ-W job was dispatched twice on 2026-10-12 (13:00 UTC → `ff3478a3`
  wrote the review; 16:26 UTC → `f0e419f6` this run). Single-PR rule → update the
  existing branch/PR rather than duplicate.
- **Re-verified (evidence-first):** crawler access **PASS** (7 crawler UAs + curl on
  `/`, `robots.txt`, `sitemap.xml`, `llms.txt` all **200**, no `cf-mitigated`;
  ISSUE-001 stays **RESOLVED**); `/llms-full.txt` and `/md/services/leak-detection.md`
  → **200**; live-vs-canonical weekly prompt → **no drift**; `validate_knowledge_base.py`
  → **OK (133 files)**.
- **New dated observation:** the measurement channel is now **fully degraded** —
  Brave answered a lone request with 200 but returned **HTTP 429 on all 10 sweep
  queries**, and DuckDuckGo **Lite and HTML both returned HTTP 202** (anti-bot).
  No new visibility rows could be honestly collected this dispatch. Recorded as
  `inconclusive` (provider failure) — **missing ≠ zero**.
- **Competitor insight:** none new this dispatch (no usable result sets). §3 of the
  review stands unchanged.
- **Expected outcome / result:** no change to the §5 ranking or §6 top-three
  priorities; provider-degradation item reinforced. **Keep.**
- **Decision:** keep; no experiment or status change.

---

## 2026-10-12 — HQ-W Weekly Strategic Review (first weekly; week of 2026-10-09 → 10-12)

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `intelligence-hq/weekly-2026-10-12` (Level 1 + Level 2).

- **Change:** First weekly strategic review. Wrote
  `growth-engine/reports/weekly/2026-10-12.md`; prepended this entry; updated
  `EXPERIMENT_LOG.md` outcomes and `INNOVATION_IDEAS.md` statuses.
- **Reason:** Monday cadence — evaluate the week's progress, measure, rank
  opportunities, and set the week's top three priorities.
- **Target:** knowledge base + review report only.
- **Shipped this week (verified):** ISSUE-001 (Cloudflare block) **fixed and
  verified** (security_level → medium 2026-10-11; all crawler UAs 200, re-verified
  this run); PR #19 (KB), #24 (AI-readable files — `/llms-full.txt` + `/md/**` now
  live 200), #27/#28 (consolidation), #29/#30/#31 (Intelligence HQ setup, daily,
  Phase 2). PRs #20–#26 closed unmerged as superseded; only **#11** remains open.
- **Measured:** crawler-accessible pages **0/7 → 10/10 (200)**; HTTP 403 rate
  **100% → 0%**. Conventional-proxy visibility: SF **absent from every executed
  query every day** (0 recommended / 0 mentioned / 0 cited). GSC/GA4/GBP and all AI
  answer engines remain **`unverified`** (not connected / not testable) — missing
  data is not zero.
- **Competitor insight:** Tier A stable (proplumberlagunaniguel.com 8/36,
  evansleakdetection.com 8/36 on 2026-10-12); new repeat competitors
  primewestplumbing.com, coastplumbing.com, lagunaniguelcaplumbingpros.com,
  leak-detection-pro.com, dialonesonshine.com, americanleakcompany.com; verified
  features = per-city pages + FAQPage schema (leak-detection-pro.com,
  coastplumbing.com). Aggregators dominate (yelp.com 32/36).
- **Process finding:** the conventional-proxy channel is degrading — Brave 429 for
  most of the week and **DuckDuckGo Lite returned HTTP 202 on all 12 probe queries
  this run**. Live-vs-canonical HQ-W prompt check: **no drift** (diff clean).
- **Expected outcome:** one reviewed week with ranked opportunities and three
  evidence-backed priorities.
- **Result:** `crawler_access_check.sh` exit 0; `/llms-full.txt` + `/md/**` 200.
- **Keep/modify/revert:** **keep.** No production change to revert.

---

## 2026-10-12 (HQ-D run #2) — Brave sweep: 28 queries, SF absent, competitor map refreshed

**Status:** additive docs + research only. **No website page/schema/copy changed.**

- **Date:** 2026-10-12 (06:00 PDT slot; executed ≈13:00–13:40 UTC).
- **Change:** ran a 28-query **Brave Search** conventional-organic sweep across
  10 South-OC cities and 8 service families; appended 28 rows to
  `data/ai_visibility_history.jsonl` and new competitor rows to
  `data/competitor_observations.jsonl`; added 2 dated entries to `INDUSTRY_WATCH.md`;
  added 6 ideas (IDEA-15…20) to `INNOVATION_IDEAS.md`; appended a run-#2 section to
  the daily report.
- **Reason:** execute the daily Intelligence HQ protocol; refresh the competitive
  picture now that Brave is reachable again (it was HTTP 429 on run #1, which fell
  back to DuckDuckGo Lite).
- **Target:** local-search visibility for commercially valuable South-OC plumbing
  queries.
- **Competitor insight:** **scottenglishplumbing.net (12/28)**, billmetzgerplumbing
  (9), barkerandsonsplumbing (8), rotorooter (7) lead repeat presence; dedicated
  repipe specialists own the repipe family; **aggregators (yelp 14/28) own
  "best/nearest" intent** — website content alone cannot win those.
- **Expected outcome:** the competitor map and idea backlog reflect current reality;
  the three prioritized ideas target the clearest observed gaps.
- **Result:** **SF absent from all 28** Brave organic top-10 sets (consistent with
  every prior run). No 429 this run. No site change made (no evidence justified one).
- **Keep/modify/revert:** **keep** the rotating query set; **modify** the sweep to
  keep a longer inter-query delay (9 of 28 returned empty on first pass before
  recovering).
- **Next three priorities:** (1) repipe decision page (IDEA-17); (2) detection-method
  comparison hub (IDEA-15); (3) FAQPage schema on Tier-1 city pages (IDEA-18).

## 2026-10-11 (supplementary run)

**Status:** Independent second sample on the same day; branch
`growth-engine/daily-2026-10-11-run2` (an earlier run today produced PR #25).
Read-only research + additive documentation. **No website page/schema/copy changed.**

### ✅ ISSUE-001 (Cloudflare crawler block) confirmed RESOLVED

`bash growth-engine/tests/crawler_access_check.sh` → **OK**. All 7 crawler UAs
(Googlebot, Bingbot, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Applebot)
and plain curl return **200 with no `cf-mitigated` header** on `/`, `/robots.txt`,
`/sitemap.xml`, `/llms.txt`. The AI-readable files (`/llms-full.txt`,
`/md/services/leak-detection.md`) are now **200** (PR #24 merged). On-page work is
no longer inert.

### Visibility sweep — 28 queries, Brave conventional proxy

Expanded the sample from 5 → 28 queries covering all 7 core services and 11
cities (Tier 1–3). **Straight Flush was absent from all 28** (0 recommended /
0 mentioned / 0 cited). Highest-intent queries where SF does not surface:
*slab leak detection Laguna Niguel*, *slab leak repair Laguna Niguel*,
*PEX repipe Laguna Niguel*, *PEX repiping Orange County*, *emergency plumber
Laguna Niguel*, *best plumber in Laguna Niguel*. Data:
`growth-engine/data/ai_visibility_history.jsonl`.

### Competitor intelligence (evidence-based, not proof)

Tier A (≥10/28): scottenglishplumbing.net (22), barkerandsonsplumbing.com (19),
rotorooter.com (15), billmetzgerplumbing.com (13), efficientplumbing.com (12),
rooterhero.com (11), allclearplumbingpros.com (11), parzivalplumbing.com (10),
calischoice.com (10), evansleakdetection.com (10). New repeats:
integrityrepipe.com, dcplumbing.net, mikediamondservices.com,
thedoneriteplumber.com, missionviejoplumbingco.com, largeplumbing.com.
Directory dominance: yelp.com 27/28, angi.com 12/28 → the "best plumber" queries
are an aggregator/GBP problem, not a website-only problem. Directory updated:
`growth-engine/COMPETITOR_DIRECTORY.md`.

### Evidence-backed gaps (page + city + missing element)

1. **Per-city slab-leak sections** — competitors surface a dedicated slab-leak
   page per city (Evans, Cal's Choice, Streamline, EZ); SF city pages cover leak
   detection generically. Target: `cities/{laguna-niguel,dana-point,san-clemente,
   mission-viejo,aliso-viejo}.html`.
2. **Repipe content** — `PEX repipe Laguna Niguel` / `PEX repiping Orange County`
   are dominated by repipe specialists; SF has no repipe page in those results.
   Target: a `/services/pex-repiping.html`-linked city × repipe asset.
3. **AI-engine visibility is unverified** — no credentials in this environment;
   recorded `unverified`, never 0%.

### AI answer engines — still unverified

No AI answer engine could be executed (no credentials; sites 403/JS-only).
Recorded as `unverified` per `AI_VISIBILITY_METHODOLOGY.md`. Cheapest unlock:
a Perplexity/SerpAPI key (owner, Level 3).

### Verification

`crawler_access_check.sh` → OK; 2 technical-health rows + 28 visibility rows +
34 competitor rows appended to `data/*.jsonl`.

**Branch:** `growth-engine/daily-2026-10-11-run2` (PR opened for owner review).
**Report:** `growth-engine/reports/daily/2026-10-11.md`.

---

## 2026-10-10 (later trigger) — duplicate-trigger reconciliation run

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `growth-engine/daily-2026-10-10-run2`.

- **Trigger context:** A scheduled 2026-10-10 run already **completed** earlier
  (run `fa99f549`, PR #21). This invocation was a **second same-day trigger**;
  runs `c31f1743` (this) and `64a5ca2b` were **concurrently active**. Used a
  separate branch and appended to `reports/daily/2026-10-10.md` rather than
  overwriting the morning record.
- **Technical health:** ISSUE-001 **still OPEN** — domain 403
  (`cf-mitigated: challenge`) to all crawlers/AI bots + curl on `/`, `/robots.txt`,
  `/sitemap.xml`, `/llms.txt`, `/services/leak-detection.html`. Severity
  **critical**; 8 rows appended to `data/technical_health_history.jsonl`.
- **Queries:** the **24 backlog queries** from the morning run were re-attempted
  on **Bing** (alternate provider). Brave was HTTP **429** on every attempt
  (egress IP shared with the parallel run); DuckDuckGo HTML HTTP **202**. All 24
  Bing queries returned 200 but **non-localized** (identical across cities;
  dictionaries/IMDb/streaming) → recorded **`inconclusive`**, not "absent".
- **SF visibility:** **no valid measurement** this run (0 usable SERPs).
- **Competitors:** no new verified competitor. Three domains
  (crowleyplumbingandheatinginc.com, crossplumbingandgas.com,
  stewartsplumbinginc.com) were flagged **AMBIGUOUS** (identical across 5 cities)
  and deliberately **withheld** from the directory.
- **Process insight (new):** duplicate same-day triggers contend for one egress
  IP and can race the same branch/PR → recommend serializing automation A.
- **Top next actions:** (1) owner lifts Cloudflare block (P-001/ISSUE-001);
  (2) serialize automation A / stop duplicate triggers; (3) merge baseline PR #19.

---

## 2026-10-10 — Morning AI Search Visibility & Competitor Intelligence (daily run)

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `growth-engine/daily-2026-10-10`.

- **Technical health:** ISSUE-001 **still OPEN** — live domain 403
  (`cf-mitigated: challenge`) to all crawlers/AI bots + curl on `/`, `/robots.txt`,
  `/sitemap.xml`, `/llms.txt`, `/services/leak-detection.html`. Severity
  **critical**; all on-page work inert. DNS = Cloudflare proxy; TLS cert valid to
  2026-12-06; GitHub Pages origin reachable (301 → apex).
- **Queries:** 6 of 30 Brave conventional-proxy queries executed (Brave then
  HTTP 429 / IP-blocked — tighter budget than 2026-10-09's 11). 24 recorded
  `inconclusive`. AI engines: 0 testable.
- **SF visibility:** absent from all 6 executed queries (recommended 0,
  mentioned 0, cited 0).
- **Competitors:** 13 newly observed domains (Tier-2 cities: Irvine, Laguna
  Hills, Laguna Beach, Ladera Ranch, Rancho Santa Margarita, Lake Forest).
  Repeat leaders barkerandsons (5/6), scottenglish (5/6), rotorooter (6/6),
  billmetzger, johnstevenson. Directories Yelp/Angi recur on every general query.
- **Process gap:** `growth-engine/` is absent on `main` because baseline PR #19
  is unmerged — a run from `main` finds no KB.
- **Top next actions:** (1) owner lifts Cloudflare block (P-001); (2) merge
  baseline PR #19; (3) connect GSC/GBP + Perplexity API key.
- **Report:** `growth-engine/reports/daily/2026-10-10.md`.

---

## 2026-10-10

**Status:** AEO FAQ + inbound internal link deployed (branch
`sfge/aeo-leak-detection-faq-2026-10-10`). Site-wide indexing blocker still live.

### 🚨 BLOCKER UNCHANGED — Cloudflare managed challenge (403 to all crawlers)

Re-verified today: `https://straightflushplumbingoc.com/`, `/robots.txt`,
`/sitemap.xml` all return `HTTP 403` with `cf-mitigated: challenge` for a
Googlebot UA. **Every on-page change below is inert until Cloudflare is fixed.**
Actions remain the same as 2026-10-07 (Security Level: Medium; Bot Fight Mode
OFF; WAF skip rule for `cf.client.bot`). See `CLOUDFLARE-SETUP.md` §2a-2b. This
is a dashboard action that cannot be performed from the repository.

### Changes deployed (SAFE)

| # | Change | Target | Reason | Expected outcome |
|---|--------|--------|--------|------------------|
| 1 | Added visible **FAQ section** + matching `FAQPage` JSON-LD (5 Q&A, text verbatim) | `services/leak-detection.html` | This was the **only** service page with no FAQ block and no FAQPage schema | FAQ/AI-answer eligibility on the top leak query; closes gap vs. city pages which already had it |
| 2 | Added missing `Service` JSON-LD | `services/slab-leak-detection.html` | Page had FAQPage + Breadcrumb but no Service schema (flagship service, inconsistency vs. pex/water-heater) | Service-level entity clarity for SERP + AI |
| 3 | Fixed 2 wrong related-reading links | `services/leak-detection.html` | "Does Insurance Cover This?" and "Repair vs. Reroute vs. Repipe" cards pointed at generic `../contact.html`; the real guides were orphaned from the service page | Sends service traffic to the correct guide (deeper engagement), builds Service→Guide internal linking |
| 4 | Added 3rd related card → `../guides/leak-detection-cost.html` | `services/leak-detection.html` | Cost is a top commercial-investigation intent for detection | Captures cost-intent users |
| 5 | Corrected `BreadcrumbList` URL | `services/slab-leak-detection.html` | Position-2 pointed at `/leak-detection.html` (a `noindex` stub) instead of the canonical `/services/leak-detection.html` | Breadcrumb points at the real indexable page |

### Competitor intelligence (2026-10-08, Brave results)

Money queries surfaced: `evansleakdetection.com`, `leakstar.com`,
`efficientplumbing.com`, `allclearplumbingpros.com`, `scottenglishplumbing.net`,
`streamlineplumbing.org`, plus `rooterhero.com`, `calischoice.com`,
`ezplumbingusa.com`, `pacificcoastcopperrepipe.com`,
`americanleakdetection.com`, `precisionplumbingoc.com`.

- **evansleakdetection.com** `/laguna-niguel-slab-leak-detection/` — ~3,255
  words, but **no FAQPage, no Service, no LocalBusiness, no HowTo schema** and
  only 5 generic H2s. Strong on raw length, weak on structure → Straight Flush's
  structured, schema-rich pages are the better AEO play. **No copying needed.**
- `rooterhero.com`, `calischoice.com` etc. are large multi-city franchises with
  templated city pages — exactly the doorway-page pattern SF must avoid.
- Takeaway: competitors compete on **page length and city coverage**; SF's moat
  is **diagnostic depth + clean structured data**, which we reinforced today.

### Verification performed

- All JSON-LD on both changed pages parses; `services/leak-detection.html` now
  carries `Service` + `FAQPage` + `BreadcrumbList`; slab page adds `Service`.
- Each changed page: exactly one `<title>`, one meta description, one canonical,
  one `<h1>`. FAQ visible Q&A matches schema `name` verbatim.
- Full-site relative-link sweep: **0 broken internal `.html` links**.
- `scripts/seo_audit.py`: 0 broken links, 0 indexable orphans, 0 canonical
  anomalies, 0 duplicate titles on indexable pages, 0 missing alt.

### Not changed (correct as-is)

- The `about/straight-flush-plumbing-orange-county.html` page is `noindex,follow`
  and intentionally excluded from the sitemap — leaving alone.
- 59 root-level `noindex` stubs with canonicals → intentional; not duplicate
  content.

### Growth opportunity / moat

Highest-value durable asset once crawling is restored: the **slab-leak diagnostic
decision tool** (symptom → likely cause → detection method → repair/reroute/
repipe), extending `plumbing-health-score.html`. Competitors cannot fake it.

### Strategic insight

The site's structured-data and internal-linking posture now exceeds every
competitor inspected; the company's actual bottleneck remains the Cloudflare
edge block, which makes all of it invisible.

**Strategy confidence:** HIGH on findings, but growth outcome is **blocked** on
the Cloudflare fix (owner action required).
| 1 | Breadcrumb label truncation removed | `scripts/gen_academy_articles.py` (`h1[:28]+"..."`), `scripts/gen_academy_batch2a.py`, `scripts/gen_academy_batch2b.py` (`trail_label = h1`) | Generated breadcrumbs and BreadcrumbList JSON-LD `name` values were being cut mid-string (e.g. “Why do two plumbers give dif...”) | Clean, full breadcrumb labels in visible UI **and** structured data; no mid-word truncation in SERPs |
| 2 | Regenerated 38 HTML pages + hand-fixed 2 academy pages | `academy/*.html` and other generated pages | Carry the corrected breadcrumb + JSON-LD strings | Parity between visible breadcrumb and `BreadcrumbList` |
| 3 | Added 3 diagnostic FAQs (visible + `FAQPage` JSON-LD) | `services/slab-leak-detection.html` | Competitor `barkerandsonsplumbing.com/slab-leak-repair/` (~3,000 words, `BlogPosting`+`BreadcrumbList` schema) surfaces questions our page did not answer; AI answer engines key on exact-match Q&A | Capture “slab leak vs underground leak”, “detect under tile/hardwood”, “does insurance cover slab leaks”; eligible for FAQ rich results + AI extraction |
| 4 | Added two contextual internal links in the new insurance FAQ | `services/slab-leak-detection.html` → `insurance/documentation-checklist.html`, `insurance/does-insurance-cover-slab-leaks.html` | Service → Insurance internal-link relationship | Stronger topical clustering + crawl paths |

**Generator root cause:** the `build.py` `breadcrumbs(prefix, trail)` helper
truncated labels; the academy generators also fed a truncated `trail_label`.
Both paths are now patched so the fix cannot regress on the next build.

**Verification performed:** zero invalid JSON-LD across all HTML; zero breadcrumb
truncation `...` artifacts; 0 broken internal links on all 74 indexable pages
(59 root-level stubs remain intentional `noindex`); all 6 FAQ Q&A pairs on the
slab-leak page parse and match visible copy.

### Competitor watch

- `barkerandsonsplumbing.com` — `/slab-leak-repair/` is ~3,000 words with
  `BlogPosting` + `BreadcrumbList` schema and a video, but **no `FAQPage`
  markup**, and its H2 structure is dominated by boilerplate (“Enjoy our video”,
  “Please complete and submit”). Our page already wins on FAQ schema; we now
  also close part of the content-depth gap.
- `saddlebackplumbing.com` — currently has **no reachable slab-leak or
  leak-detection page**; `/slab-leak-detection/`, `/leak-detection/`,
  `/plumbing-repair/` all 404. Weak live footprint for the leak intent.
- Note: sandbox search engines were geo-misleading (returned out-of-market
  results), so SERP claims are deliberately limited; only directly-fetched
  competitor site facts are recorded.

### 🚨 BLOCKER (unchanged)

Cloudflare managed challenge still returns `HTTP/2 403 cf-mitigated: challenge`
to all crawlers. All on-page work above is **inert until Cloudflare Security →
Settings exposes the site to Googlebot/Bingbot/AI crawlers** (see 2026-10-07
entry and `CLOUDFLARE-SETUP.md` §2a–2b). This remains the single highest-value
action and cannot be fixed from the repo.

### Strategic insight

Our on-page markup and FAQ coverage now match or exceed the strongest visible
local competitor; the business is still capped by the edge block, so the
Cloudflare fix remains worth more than any further page work.
| 1 | Homepage link → `/case-studies/` | `index.html` | Case-study hub had **zero** homepage inbound links; real documented jobs are the strongest E-E-A-T asset | Crawl discovery + stronger proof-of-work signal |
| 2 | "Related reading" block linking each case study → its matching service page + hub | `case-studies/laguna-niguel-{slab-leak-detection-1, slab-leak-detection-6, leak-detection-5, pex-repiping-4}.html` | Case studies had no path back to the money pages they prove | Commercial relevance + link equity toward services |
| 3 | Slab-leak-detection → case studies link | `services/slab-leak-detection.html` | Flagship page had no proof-of-work link; ties diagnosis claim to real local jobs | Conversion aid + topical reinforcement |
| 4 | Title shortened into SERP-friendly range | 13 indexable pages (about, plumbing-health-score, south-oc-slab-leak-specialist, 10 academy articles) | Titles ran 65–96 chars; several led with repetitive "Leak Detection Academy" boilerplate | Better CTR + less truncation; titles now 45–55 chars |

**Verification performed:** all 74 indexable pages — exactly one `<title>`, one
meta description, one canonical, one `<h1>`; zero duplicate titles/descriptions;
0 broken internal links; 0 section/div tag imbalances; all JSON-LD parses;
sitemap covers all 74 indexable pages; canonical↔sitemap parity.

### Not actioned this run

- **City title lengths (16 pages, 65–81 chars).** The title exactly mirrors the
  `<h1>` and the pattern is uniform; trimming risks H1/title divergence for a
  marginal gain, so left as-is pending a pattern-level decision (REVIEW).
- **28 titles remain >70 chars** overall; the worst non-city offender is
  `case-studies/laguna-niguel-slab-leak-detection-6.html` (89 chars) — left for
  the next pass so this PR stays within one objective group.

### Growth opportunity / weekly moat

The slab-leak diagnostic decision tool (symptom → likely cause → detection method
→ repair-vs-reroute-vs-repipe), extending `plumbing-health-score.html`, remains
the highest-value durable asset. All case studies now route into it naturally.

### Strategic insight

On-page work is already strong; **crawler access is the entire bottleneck** — the
site is invisible to Google, Bing, and every AI answer engine until Cloudflare
stops challenging verified bots, so edge configuration outranks any content work.

### Weekly priority

Get verified crawlers unblocked at Cloudflare and confirm a 200 to a Googlebot UA.
| 1 | Added 5-question diagnostic FAQ (visible, verbatim text) | `services/leak-detection.html` | Page had no FAQ block; competitors own the "how does detection work / will you break my tile" question space | AEO extraction, People-Also-Ask coverage, AI-answer grounding |
| 2 | Added matching `FAQPage` JSON-LD | `services/leak-detection.html` | Schema/text parity with #1 | FAQ rich-result eligibility |
| 3 | Added contextual inbound internal link to specialist page | `services/slab-leak-detection.html` | Specialist page had only 2 inbound links and 0 from its own service hub | Link equity + topical relationship |
| 4 | Added contextual inbound internal link to specialist page | `cities/laguna-niguel.html` (local-knowledge paragraph) | City pages are the strongest local entry points; specialist page now reachable from the flagship city | Internal discovery from priority local page |
| 5 | `lastmod` bumped to 2026-10-10 | `sitemap.xml` (2 service URLs) | Reflect real content change | Correct recrawl signal |

**Verification performed:** both edited service pages parse; all JSON-LD valid
(Service, BreadcrumbList, FAQPage); exactly one H1 each; 5 FAQ items match 5
schema Questions; 0 broken internal links site-wide; all links resolve; sitemap
XML well-formed.

### Competitor watch (observed today, DuckDuckGo SERP for "slab leak detection Laguna Niguel")

- **Evans Leak Detection** (`evansleakdetection.com/laguna-niguel-slab-leak-detection/`):
  1,502 words, dedicated city+service page, Plumber schema, H1 "Laguna Niguel's
  Top Company for Slab Leak Detection & Repair" — the benchmark to beat locally.
- **lagunaniguelcaplumbingpros.com** (exact-match domain): 1,459 words, FAQPage
  schema, city+service page — thinner expertise signal but strong local
  targeting, and it beats us on the exact city/service phrase.
- **Leak Star** (`leakstar.com`): 752 words, no FAQ/no H1, Organization schema
  only — sustainable to outrank once crawl access exists.
- **ProPlumberLagunaNiguel.com** and **lagunaniguelcaplumbingpros.com** are
  keyword-exact domains: a reminder that a strong branded domain plus genuine
  local content (not a matching domain) is the differentiator.

### Growth opportunity / weekly moat (unchanged)

Build the **slab-leak diagnostic decision tool** (symptom → likely cause →
detection method → repair-vs-reroute-vs-repipe), extending
`plumbing-health-score.html`. Hard to copy; embodies the first-hand-diagnostic
moat.

### Strategic insight

The site's on-page SEO/AEO is already above local competitor quality; the only
thing keeping Straight Flush invisible to Google, Maps and AI engines is the
Cloudflare crawler block. Fixing that single dashboard setting is worth more
than any amount of new content this month.

**Keep/modify/revert:** KEEP — no results measurable until the Cloudflare block
is lifted.

---

## 2026-10-09 — Morning AI Search Visibility & Competitor Intelligence (daily run)

**Status:** Additive documentation/data only. **No website page/schema/copy changed.**
Branch `growth-engine/daily-2026-10-09`.

- **Technical health:** ISSUE-001 **still OPEN** — live domain 403
  (`cf-mitigated: challenge`) to all crawlers/AI bots + curl on `/`, `/robots.txt`,
  `/sitemap.xml`, `/llms.txt`. Severity **critical**; all on-page work inert.
- **Queries:** 11 of 32 Brave conventional-proxy queries executed (Brave then
  HTTP 429 / IP-blocked). 21 recorded `inconclusive`. AI engines: 0 testable.
- **SF visibility:** absent from all 11 executed queries (recommended 0,
  mentioned 0, cited 0).
- **Competitors:** 54 newly observed domains; repeat leaders scottenglish,
  billmetzger, calischoice, evansleakdetection, efficient, barkerandsons,
  rotorooter. New pattern (hypothesis): non-local per-city **subdomain
  directories** surfacing for local intent.
- **Process gap:** `growth-engine/` is absent on `main` because baseline PR #19
  is unmerged — a run from `main` finds no KB.
- **Top next actions:** (1) owner lifts Cloudflare block (P-001); (2) merge
  baseline PR #19; (3) connect GSC/GBP + Perplexity API key.
- **Report:** `growth-engine/reports/daily/2026-10-09.md`.
## 2026-10-09

**Status:** Master growth-engine baseline established. Read-only research +
additive documentation. **No website page/schema/copy changed.**

### Created — permanent knowledge base (`growth-engine/`)

Verified business profile, service catalog, service areas, approved-claims and
brand-voice rules, keyword universe, AI-visibility methodology, integration
status, issue register, experiment log, changelog, JSONL observation data, and
a baseline report. See `growth-engine/README.md` for the read order.

### 🚨 BLOCKER re-confirmed — Cloudflare still returns 403 to every crawler

Re-verified 2026-10-09: `HTTP/2 403` with `cf-mitigated: challenge` on `/`,
`/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/index.html`,
`/services/leak-detection.html`, `/cities/laguna-niguel.html` — for Googlebot,
Bingbot, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Applebot and plain
curl. Identical to the 2026-10-07 finding; still **unresolved**. Tracked as
`growth-engine/KNOWN_ISSUES.md` ISSUE-001. Owner action in the Cloudflare
dashboard is required (Level 3); it cannot be fixed from the repo. This remains
the single highest-impact item — all on-page work is inert until lifted.

### Baseline visibility (conventional-search proxy only)

Tested 5 queries via Brave Search (the only working conventional proxy in this
environment; **not** an AI-platform result). Straight Flush was **absent from
all 5** (plumber/slab-leak/emergency/best in Laguna Niguel; leak detection OC).
Repeat competitors: scottenglishplumbing.net (5/5), efficientplumbing.com,
barkerandsonsplumbing.com, rotorooter.com. Full data in
`growth-engine/data/ai_visibility_history.jsonl`.

### AI answer engines — unverified, honestly

No AI answer engine (ChatGPT/Claude/Gemini/Copilot/Grok/Perplexity/Google AIO)
could be executed in this environment (no credentials; sites 403/JS-only to
scripted clients). Recorded as **unverified**, never as zero visibility. See
`growth-engine/AI_VISIBILITY_METHODOLOGY.md` and `INTEGRATION_STATUS.md`.

### Evidence-backed gap

Tier-A competitors pair a **city page with a specific service page** (e.g.
Scott English `/service-area/plumber-in-laguna-niguel`; Efficient
`/laguna-niguel-plumbers/` + water-leak page). SF has strong city and service
pages but few city×service combinations. Candidate work once crawlers can reach
us (real content only; no thin doorway pages).

### Verification

`growth-engine/tests/validate_knowledge_base.py` → OK (133 HTML files, one
title/description/canonical/h1 each; JSONL + baseline JSON parse). Crawler
health reproducible via `growth-engine/tests/crawler_access_check.sh`.

**Branch:** `growth-engine/baseline-2026-10-09` (PR opened for owner review).
**Proposals:** `growth-engine/proposals/2026-10-09-priority-actions.md` (P-001
Cloudflare = urgent).
## 2026-10-08

**Status:** Breadcrumb/schema truncation bug fixed across all generated pages and
root-cause patched in the generators. Slab-leak service page strengthened with a
diagnostic FAQ cluster.
**Status:** Internal-linking de-orphaning + title-length hygiene deployed.
Cloudflare crawler blocker **still active** (see carried-forward blocker).

### 🚨 BLOCKER (carried forward) — Cloudflare challenge still returns 403

- Re-tested `https://straightflushplumbingoc.com/` today: **403 `cf-mitigated: challenge`**
  for Googlebot, GPTBot, and plain curl. `/robots.txt` also 403.
- Nothing has changed since 2026-10-07. All on-page work remains inert to
  crawlers until the Cloudflare dashboard fix (Security Level Medium, Bot Fight
  Mode OFF, allow-verified-crawlers WAF skip rule) is applied. **Requires human action.**

### Intelligence

- No `briefs/latest.md` (Scout output) present; no live SERP/competitor scraping
  available from this sandbox (Google/Bing/Mojeek/DDG blocked or unresolved).
  Competitor claims are therefore **not** asserted this run — repo-only audit.
## 2026-10-07

**Status:** Site-wide indexing blocker confirmed (see Blockers). Safe schema +
sitemap fixes deployed.

### 🚨 BLOCKER — Cloudflare managed challenge returns 403 to all crawlers

- Every request to `https://straightflushplumbingoc.com/*` returns
  `HTTP/2 403` with `cf-mitigated: challenge` — homepage, `/robots.txt`,
  `/sitemap.xml`, `/llms.txt`, `/index.html`.
- Confirmed with Googlebot, Bingbot, GPTBot, Safari and plain curl UAs: all 403.
- This is a **Cloudflare "Under Attack Mode" / Bot Fight Mode managed
  challenge**. Because crawlers do not execute the JS challenge, Google, Bing,
  and every AI answer engine cannot read the site at all.
- Origin GitHub Pages (`straightflushplumbing03.github.io/-Up2datewebsiteseo/`)
  redirects 301 to the custom domain, so the custom domain is the only host.
- **Action required in Cloudflare dashboard (cannot be fixed from the repo):**
  1. Security → Settings → **Security Level: Medium** (not "I'm Under Attack").
  2. Security → Settings → **Bot Fight Mode: OFF** (or add the WAF skip rule).
  3. Security → WAF → Custom rules → add `allow-verified-crawlers`
     (expression `(cf.client.bot)`, action Skip → All remaining custom rules).
  `CLOUDFLARE-SETUP.md` §2a–2b documents these exact steps; they were evidently
  never applied (or were reverted).
- Impact of inaction: **zero organic, Maps, or AI-search traffic.** All on-page
  work below is inert until this is fixed.

### Changes deployed (SAFE)

| # | Change | Target | Reason | Expected outcome |
|---|--------|--------|--------|------------------|
| 1 | Added `BreadcrumbList` JSON-LD | `case-studies/index.html`, `insurance/dos-and-donts-talking-to-insurance.html`, `service-areas.html`, `south-oc-slab-leak-specialist.html` | Pages show visible breadcrumbs but had no BreadcrumbList | Breadcrumb rich result / SERP path |
| 2 | Added `FAQPage` JSON-LD (text matches visible FAQ verbatim) | `case-studies/laguna-niguel-slab-leak-detection-1.html`, `…-pex-repiping-4.html`, `…-leak-detection-5.html`, `…-slab-leak-detection-6.html` | Visible FAQ accordions had no FAQPage schema | Eligibility for FAQ rich results + AI answer extraction |
| 3 | Fixed stray double period | `case-studies/laguna-niguel-pex-repiping-4.html` | Visible FAQ text had `pressure tested..` | Clean copy + schema/text parity |
| 4 | Sitemap hub URLs de-indexed-file fix | `sitemap.xml` | `/academy/index.html`, `/case-studies/index.html`, `/insurance/index.html`, `/services/index.html` pointed at `index.html` paths instead of clean directory URLs | Matches canonicals, avoids redundant URL signals |
| 5 | Surfaced 3 orphan city pages (Laguna Woods, Dove Canyon, Foothill Ranch) | `index.html` city pills, `service-areas.html` grid + footer | These 3 pages had **zero** internal inbound links (true orphans) | Crawl discovery + internal link equity |

**Verification performed:** all 74 indexable pages have exactly one `<title>`,
one `<meta name="description">`, one canonical, one `<h1>`; zero duplicate
titles/descriptions; 0 broken internal links; all JSON-LD parses; sitemap XML
well-formed; 0 remaining indexable orphans.

### Duplicate-content finding (no action — correct as-is)

Root-level `laguna-niguel.html`, `aliso-viejo.html`, `what-is-a-slab-leak.html`,
`leak-detection.html`, `pex-repiping.html`, `slab-leak-detection.html`,
`drain-services.html`, `water-heater-services.html`, `plumbing-repair.html` etc.
are **intentional `noindex, nofollow` stubs** with canonicals pointing to the
real `/cities/…`, `/services/…`, `/academy/…` pages. Not duplicate content;
leave alone.

### Growth opportunity / weekly moat

When the Cloudflare block is lifted, the highest-value durable asset is a
**slab-leak diagnostic decision tool** (interactive: symptom → likely cause →
detection method → repair-vs-reroute-vs-repipe), extending the existing
`plumbing-health-score.html`. It is hard for competitors to copy and is exactly
the "first-hand diagnostic experience" moat.

### Strategic insight

The site's on-page SEO/AEO work is already at a high standard; the company's
real bottleneck is a **deployment/edge misconfiguration**, not content. Fixing
Cloudflare crawler access is worth more than any month of new pages.

**PR:** #14 — https://github.com/straightflushplumbing03/-Up2datewebsiteseo/pull/14
**Note:** PR #11 (`chore/repo-hygiene-and-domain-fix`) is stale since 2026-09-28, mergeable=false, and contains ~10k lines of unrelated churn (committed `.git-2/`). Recommend closing it; re-land any wanted pieces in small PRs.
