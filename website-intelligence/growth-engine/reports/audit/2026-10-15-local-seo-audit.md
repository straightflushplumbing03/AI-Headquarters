# Local SEO Audit — Straight Flush Plumbing & Leak Detection

**Date:** 2026-10-15 (America/Los_Angeles)
**Scope:** Full technical + local-SEO audit of the production website, requested
by the owner ("Local SEO Audit and Fix Master Task").
**Verifier:** OpenHands agent, working from a fresh clone of the production repo.
**Branch:** `intelligence-hq/site-audit-2026-10-15` (report + tooling fixes only;
no page/schema/copy change).
**Approval scope:** Level 1 (research/reporting) + Level 2 (branch/PR/tooling).

> This report separates **confirmed problems** (reproduced with evidence) from
> **unverified concerns** (not reproducible here). Nothing is reported as fixed
> unless re-verified in this run.

---

## 1. Repository and website architecture discovered

| Item | Finding | Evidence |
|---|---|---|
| Production repo | `straightflushplumbing03/-Up2datewebsiteseo` (public, branch `main`) | `git remote`; GitHub API |
| Live domain | `https://straightflushplumbingoc.com` | `CNAME` = `straightflushplumbingoc.com` |
| Framework | Static HTML/CSS/JS — **no build step** (Python generator scripts are optional tooling, not required to serve) | repo layout; `serve.sh` |
| Hosting / deploy | GitHub Pages **legacy** build from `main` `/` | Pages API: `build_type: legacy`, `source {branch: main, path: /}` |
| CDN / edge | Cloudflare | `server: cloudflare` response header |
| HTTPS + redirects | `http://` → `https://` (301); `www.` → apex (301) | curl |
| Pages served | 133 HTML files total; **74 indexable** (in sitemap) + **59 root `noindex` stubs** + `404.html` | `scripts/seo_audit.py` |
| Business | Laguna Niguel, CA owner-operator (Lance); South OC service area | `growth-engine/BUSINESS_PROFILE.md` |
| AI HQ repo | `straightflushplumbing03/AI-Headquarters` — Next.js/TypeScript/Supabase platform; **separate app**, not the website, no `next` build of the static site | `ai-hq/package.json` |

**Important architecture clarification:** two distinct systems exist.
- The **website** is the static repo above (GitHub Pages).
- The **AI Headquarters automation system** the owner refers to is the
  `growth-engine/` knowledge base + the OpenHands Cloud automations
  (`SFPL Intelligence HQ Daily 6 AM`, weekly) that operate on the website repo —
  **not** the `AI-Headquarters` Next.js app. See `growth-engine/INTEGRATION_STATUS.md`.

## 2. Confirmed issues and evidence

| # | Severity | Issue | Evidence | Impact | Status |
|---|---|---|---|---|---|
| A-1 | low (tooling) | `scripts/refresh_sitemap.py` removed the 4 directory-hub sitemap URLs (`academy/`, `services/`, `case-studies/`, `insurance/`) and re-added them as `…/index.html` — which conflicts with those pages' canonical (`…/`) | Ran script on a copy: `to add: ['academy/index.html', …]`, `to remove: ['academy/', …]` | A future sitemap refresh would list non-canonical hub URLs | **FIXED** this run |
| A-2 | low | Sitemap `<lastmod>` values stale (all `2026-09-24`), though files changed through `2026-10-11` | `grep lastmod sitemap.xml`; git last-commit dates | Weaker crawl-scheduling signal | **FIXED** this run (git-date based) |
| A-3 | low | `growth-engine/tests/validate_knowledge_base.py` had no sitemap cross-check | reading the test | Sitemap drift could go unnoticed | **FIXED** this run |
| A-4 | info | `_headers` (CSP/HSTS/X-Frame-Options/…) is **not honored by GitHub Pages** and no HTTP security headers are sent | `curl -sI` → no CSP/HSTS/X-Frame-Options | File is inert; headers effectively come only from in-page `<meta http-equiv>` CSP | Open (needs host config; not a ranking blocker) |
| A-5 | info | `about.html` links to `about/straight-flush-plumbing-orange-county.html`, which is `noindex,follow` | grep; page meta | Minor: a link to a de-indexed page; harmless but not ideal | Open |
| A-6 | info | Two `<input>` `title` attributes use a placeholder example phone `(949) 555-0123` | `index.html:549`, `contact.html:120` | Cosmetic only; not the real NAP | Open |

## 3. Issues that could NOT be verified (do not treat as facts)

- **Core Web Vitals / Lighthouse.** Google PageSpeed Insights API returned
  **HTTP 429 (daily quota exceeded)** for this environment's API project, so no
  fresh field/lab score could be produced. Not claimed. (Site is a small static
  site with lazy-loaded images; no measurement taken.)
- **Google Search Console / GA4 / Google Business Profile data.** **Not
  connected** (no credentials/exports in this environment). Organic
  impressions/clicks/positions, indexed-vs-excluded pages, Maps visibility and
  call/lead data are therefore **unknown, not zero**. (See §7.)
- **All 74 sitemap URLs return 200 live** — verified. But whether Google has
  *indexed* them cannot be confirmed without GSC.
- **Reviews/ratings markup.** `index.html` carries self-reported
  `aggregateRating` 4.8/74 as a `Plumber` type (flagged as ISSUE-002). Whether it
  matches the live Yelp/Google profiles was not independently confirmed.
- **No obsolete former-website domains found** in the site source (grep for
  `uptodate`, `wix`, `squarespace`, `github.io`, etc. → only internal IP-HQ
  naming). So "obsolete links to previous website versions" = **not present**
  as far as the repo shows.

## 4. Changes made and files affected

| File | Change | Reversible |
|---|---|---|
| `scripts/refresh_sitemap.py` | (1) `url_of()` now maps `X/index.html` → `X/` so directory hubs keep their canonical URL; (2) added `rel_of()` and used it for parsing + verification; (3) `<lastmod>` now derives from the file's **last git commit date** (falls back to mtime) instead of "today"; (4) added `subprocess` import | Yes — revert commit |
| `sitemap.xml` | `<lastmod>` refreshed for 74 URLs to their real last-change dates (git). **No URL added/removed** | Yes |
| `growth-engine/tests/validate_knowledge_base.py` | Added a sitemap-consistency check (indexable pages ⇄ sitemap `<loc>` set) | Yes |
| `growth-engine/reports/audit/2026-10-15-local-seo-audit.md` | This report | Yes |
| `growth-engine/KNOWN_ISSUES.md`, `CHANGELOG.md`, `data/technical_health_history.jsonl`, `INTEGRATION_STATUS.md` | Audit findings recorded | Yes |

**No website page, schema, title, description, or copy was changed.**

## 5. Tests run and actual results

| Test | Command | Result |
|---|---|---|
| Knowledge base + site invariants + sitemap | `python3 growth-engine/tests/validate_knowledge_base.py` | **OK** — 133 HTML files, exit 0 (also negative-tested: injecting a ghost sitemap URL → FAIL as intended) |
| SEO/AEO audit engine | `python3 scripts/seo_audit.py` | 0 broken internal links, 0 orphan pages, 0 canonical anomalies, 0 duplicate titles on indexable pages, 0 missing alt, 74 sitemap URLs all resolvable |
| Crawler accessibility | `bash growth-engine/tests/crawler_access_check.sh` | **OK** — Googlebot/Bingbot/GPTBot/OAI-SearchBot/ClaudeBot/PerplexityBot/Applebot + curl all 200, no `cf-mitigated` |
| Live HTTP sweep of all 74 sitemap URLs | curl loop | **all 200** |
| Redirects/HTTPS | curl | `http`→`https` 301, `www`→apex 301 |
| JSON-LD parse | Python scan | 338 blocks, 0 parse errors |
| Sitemap XML validity | `xml.dom.minidom` | valid |

## 6. Changes awaiting owner approval

None required for the tooling fixes (Level 2, branch/PR only). Items needing
**Level 3** decisions are unchanged and listed in §7/§9:
connect measurement tools, verify license/insurance/address facts, confirm
"24/7" meaning, decide public-vs-service-area address (affects GBP + schema).

## 7. Missing permissions and exact steps to provide them

| # | Needed | Exact steps |
|---|---|---|
| P-002a | **Google Search Console** read access | Verify a property for `straightflushplumbingoc.com` (DNS or HTML-file method), then either grant a service-account/API credential or export the Performance + Pages (Coverage) reports. Without it, impressions/clicks/positions/indexing are measurable only by the owner. |
| P-002b | **Google Analytics 4** (if any) | **No GA4/gtag tag is present on the site** (verified: no `G-`/`gtag` in any page). To measure site calls/form submits, add a GA4 property + measurement ID and approve adding the tag. |
| P-002c | **Google Business Profile** performance | Grant manager access or export the performance report (calls, searches, direction requests). |
| P-002d | **Call tracking** (optional) | Provider + credentials, to attribute phone calls to organic vs. Maps. |
| P-003 | **Business facts** | Provide CSLB license number/class, insurance/bond details, whether the address is public or a service-area business, and confirmation of the 21-city service list. `APPROVED_CLAIMS.md` blocks these from being published until confirmed. |
| P-005 | **Notification channel** | Owner-approved email/Slack target for urgent alerts. |

## 8. Current SEO baseline & available performance metrics

- **Technical baseline (this run):** crawler access OK; all 74 sitemap URLs 200;
  canonical/HTTPS/redirects correct; robots.txt open and explicitly welcomes AI
  crawlers; sitemap present, valid, now with accurate `<lastmod>`.
- **Content baseline:** 74 indexable pages / median 408 words; every indexable
  page has exactly one title, one meta description, one canonical, one `<h1>`,
  and alt text on all images; 93/133 pages have FAQ structure; strong schema
  coverage (Plumber, FAQPage, BreadcrumbList, Service, OfferCatalog, Article…).
- **Ranking/traffic baseline: UNAVAILABLE.** No GSC/GA4/GBP. The growth-engine's
  prior *conventional-search proxy* sweeps (DuckDuckGo Lite, 2026-10-12,
  36 queries) recorded Straight Flush **absent from all 36** — a conventional
  SERP snapshot, **not** an AI-engine result and **not** a ranking claim.
- **AI-answer-engine visibility: unverified** (no accessible engine in this
  environment). Recorded as unverified, never as zero.

## 9. Remaining work, prioritized by impact × difficulty

| # | Action | Impact | Difficulty | Notes |
|---|---|---|---|---|
| 1 | Connect **Google Search Console** (P-002a) | Highest | Low (owner action) | Only reliable source of impressions/clicks/indexing; unlocks all measurement |
| 2 | Connect **Google Business Profile** performance (P-002c) | High | Low (owner action) | Maps/local pack is a primary channel |
| 3 | Owner verifies **license/insurance/address/24-7/service-area** facts (P-003) | High | Low (owner action) | Unblocks trust badges, schema accuracy, GBP category/area tuning |
| 4 | Remove or corroborate self-reported `aggregateRating` (ISSUE-002) | Medium | Low | Policy hygiene; verify against live profiles first |
| 5 | Fix `about.html` → `noindex` company-profile link (A-5); replace placeholder input `title` phone (A-6) | Low | Low | Cosmetic/cleanliness |
| 6 | Add real HTTP security headers at the edge (A-4) | Low–Med | Med | Needs Cloudflare rules or a host that honors `_headers`; meta CSP already present |
| 7 | Deepen priority city/service pages with original local content + real photos | Medium–High | High | Only with owner-supplied facts/photos; avoid thin doorways (see §Quality guard) |
| 8 | Build the slab-leak diagnostic decision tool (existing growth-engine idea) | Medium | High | Durable AEO moat; evidence-gated |

**Quality guard (per the brief):** do **not** mass-generate city/service pages.
The site already has 21 city pages; the win is depth + verified facts on the
priority pages (`laguna-niguel`, `mission-viejo`, `laguna-hills`,
`aliso-viejo`, `slab-leak-detection`, `leak-detection`), not more thin pages.

## 10. Does daily automation already exist?

**Yes.** A daily 06:00 PT Pacific review already exists and is the intended
home for this ongoing work:
- `SFPL Intelligence HQ Daily 6 AM` — `0 6 * * *`, America/Los_Angeles
- `SFPL Intelligence HQ Weekly Review` — `0 6 * * 1`, America/Los_Angeles
- Canonical prompts: `growth-engine/automations/intelligence-hq-{daily,weekly}.prompt.md`
- Retry watchdog for transient sandbox failures: `SFPL Intelligence HQ Daily Retry Watchdog`.

> **Caveat (unverified this run):** querying the automation API from *this*
> environment returned **0 automations** (`GET /api/automation/v1` → `total: 0`)
> and the known IDs → `404`. That is an **API-scope/auth difference** for this
> session, **not** proof the automations were deleted. The authoritative record
> is `growth-engine/INTEGRATION_STATUS.md` (last verified 2026-10-12: both
> ACTIVE). The owner should confirm in the OpenHands Cloud UI.

No new automation was created (none needed; avoid duplicates per the brief).
The daily prompt already covers crawl health, competitor/local trends, content
opportunities, and a concise dated report with completed work/blockers.
