# Experiment Log — Straight Flush Growth Engine

One entry per experiment. Raw rows in `data/content_experiments.jsonl`.
Distinguish genuine trends from normal AI-answer variability: repeat tests on
fixed query wording before declaring a trend. Never attribute an AI-recommendation
change to a website edit without sufficient evidence.

Templates for new entries:
- Date · Hypothesis · Evidence · Target pages/queries · Change made ·
  Deployment date · Baseline metric · Follow-up dates · Observed result ·
  Confounders · Confidence · Decision (keep / revise / revert)

---

## exp-2026-10-07-schema-orphans — schema + de-orphan city pages
- **Hypothesis:** BreadcrumbList/FAQPage schema and de-orphaning 3 city pages
  improve crawl discovery and rich-result eligibility.
- **Evidence:** `briefs/strategy-log.md` 2026-10-07.
- **Change:** schema + internal links + sitemap hub URLs. PR #14.
- **Baseline:** 0 indexable orphans after change; schema coverage partial.
- **Follow-up:** 2026-10-14, 2026-11-07.
- **Result:** pending.
- **Confounder (decisive):** Cloudflare returns 403 to all crawlers → no SERP
  or AI-search effect can be measured until lifted.
- **Confidence:** low. **Decision:** keep.

---

## exp-2026-10-09-cloudflare-crawler-access — (RESOLVED 2026-10-11)
> **Outcome (recorded 2026-10-12, weekly review):** **confirmed / closed.**
> Owner applied `PATCH /zones/{id}/settings/security_level` → `medium`
> 2026-10-11T07:27:51Z. Verified 2026-10-11T07:28:05Z and again 2026-10-12:
> all crawler UAs + curl → 200, no `cf-mitigated`. Hypothesis confirmed.
> **Decision: keep** (no revert — the block was the bug). See `KNOWN_ISSUES.md`
> ISSUE-001.
- **Hypothesis:** ~100% of the site's organic/AI discoverability is currently
  suppressed by the Cloudflare managed challenge; lifting it restores crawl
  access and is the single highest-impact change available.
- **Evidence:** live 403 `cf-mitigated: challenge` to 7 crawler UAs + curl on
  all paths, 2026-10-09 (`data/technical_health_history.jsonl`); independently
  logged 2026-10-07 in `briefs/strategy-log.md`.
- **Change:** owner applies Cloudflare settings per `CLOUDFLARE-SETUP.md` §2a–2c.
  **Not a repo change** — cannot be executed autonomously (hosting/DNS = Level 3).
- **Baseline metric:** crawler-accessible pages = 0; 403 rate = 100%.
- **Follow-up:** re-run `/tmp` crawler check after owner confirms; expect 200
  and no `cf-mitigated` header.
- **Confidence:** high. **Decision:** escalate to owner (see `proposals/`).

---

## exp-2026-10-09-measurement-providers — conventional-proxy sweep (week 2026-10-09 → 10-12)
- **Hypothesis:** a free conventional search proxy (Brave → Bing → DuckDuckGo) can
  measure whether Straight Flush appears in organic results for local-intent queries.
- **Evidence / results (all recorded in `data/ai_visibility_history.jsonl`):**
  - Brave Search — **failed**: HTTP 429 to our egress IP for most of the week.
  - Bing — **failed**: HTTP 200 but **non-localized** results (identical across 5
    cities; dictionaries/ImDb/streaming). Unusable for local intent.
  - DuckDuckGo **HTML** — **failed**: HTTP 202 anti-bot (2026-10-10, 2026-10-12).
  - DuckDuckGo **Lite** — **stalled**: worked 2026-10-12 (36 rows) then returned
    **HTTP 202 anti-bot on all 12 probe queries** in the weekly run.
  - **Observed result:** across 107 executed queries, Straight Flush was **absent
    from every executed query every day** (0 recommended / 0 mentioned / 0 cited).
    Because the channel is degraded and non-localized in part, this is a
    conventional-proxy observation only — **not** a ranking or AI-visibility measure.
- **Confounders:** provider rate-limiting/anti-bot; non-localized result blocks;
  Brave vs DDG samples are not directly comparable.
- **Confidence:** low (channel quality). **Decision:** **revise** — retain a paid
  SerpAPI/Brave API key or a Perplexity key as the path forward (see `proposals/`
  and weekly report §7). Brave kept as fallback only; Bing dropped.
