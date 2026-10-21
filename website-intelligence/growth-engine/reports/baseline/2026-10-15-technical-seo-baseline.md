# Technical SEO & Local SEO Baseline — 2026-10-15

**Purpose.** Pre-change baseline captured before any file in this working branch
was modified. Every value below was measured directly on 2026-10-15 (UTC) against
the repo working tree at `main` (`dc70c00`) and the live origin
`https://straightflushplumbingoc.com`. Nothing here is estimated or carried over
from an earlier report unless the source is named.

**Branch:** `technical-seo/2026-10-15-audit-fixes` (from `main` `dc70c00`)
**Scope of audit:** site-wide crawl/technical audit (everything) + deep local-SEO
pass on the 10 requested priority queries.
**Approval level:** baseline + Level 1/2 changes only. No Level 3 change made.

> **Honesty rule.** Where a measurement requires an account we do not have
> (Search Console, GA4, GBP, PageSpeed API, AI answer engines), the value is
> recorded as **not measurable here**, never as zero.

---

## 1. Architecture discovered (verified)

| Item | Finding | How verified |
|---|---|---|
| Production repo | `straightflushplumbing03/-Up2datewebsiteseo` (public, default `main`) | GitHub API `GET /repos/...`, live headers |
| Other repos | 20 other same-owner repos (`AI-Headquarters`, `Uptodatestraightflushwebsite`, `SEO-AI*`, `WebsiteMasterFile`, …) are **not** production | cloned + inspected `AI-Headquarters` (Next.js/TypeScript app — the separate "AI Headquarters" system), `Uptodatestraightflushwebsite` (older copy of the site) |
| Website framework | **Static HTML/CSS/JS, no build step, no framework, no dependencies** | repo README + tree; 133 HTML files |
| Pages | **133 HTML files**: 74 indexable + **59 intentional `noindex` root stubs** + `404.html` | `scripts/seo_audit.py` |
| Deploy | **GitHub Pages** legacy build from branch `main`, path `/`; custom domain via `CNAME` = `straightflushplumbingoc.com` | GitHub Pages API (`status: built`), live `x-github-request-id` / Fastly headers |
| Edge/CDN | **Cloudflare** in front of Pages (`server: cloudflare`) | live response headers |
| Automation system | `growth-engine/` knowledge base + 2 **active** OpenHands Cloud automations: HQ-D `SFPL Intelligence HQ Daily 6 AM` (`5dc89b41-…`, `0 6 * * *` PT) and HQ-W `SFPL Intelligence HQ Weekly Review` (`0582d219-…`, `0 6 * * 1` PT) | `growth-engine/automations/README.md`, `INTEGRATION_STATUS.md` |
| Existing SEO tooling | `scripts/seo_audit.py` (133-page audit), `scripts/refresh_sitemap.py`, `growth-engine/tests/crawler_access_check.sh`, `growth-engine/tests/validate_knowledge_base.py`, `growth-engine/tests/cloudflare_audit.py` | repo tree |
| Existing scheduled checks | daily/weekly intelligence loops; a deterministic health check (Automation B) is **planned but not created** | `growth-engine/automations/README.md` |

**No new system was created in this task that duplicates existing functionality.**
The audit reuses `scripts/seo_audit.py`; sitemap work reuses
`scripts/refresh_sitemap.py`.

---

## 2. Live HTTP / technical baseline (verified)

| Check | Result |
|---|---|
| Homepage `https://straightflushplumbingoc.com/` | **200** |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | **200 / 200 / 200** |
| `/services/leak-detection.html`, `/services/slab-leak-detection.html`, `/services/emergency-plumbing.html`, `/services/pex-repiping.html`, `/services/water-heater-services.html` | **200** (all) |
| `/cities/laguna-niguel.html` | **200** |
| `/laguna-niguel.html` (root stub) | **200** — `noindex, nofollow`, canonical → `/cities/laguna-niguel.html` |
| `/md/services/leak-detection.md` | **200** |
| `/nonexistent-page-xyz` | **404** (correct) |
| `http://` → `https://` | **301** ✅ |
| `http://www.` → apex https | **301** ✅ |
| `https://www.` → apex https | **301** ✅ |
| `/services` → `/services/` | **301** ✅ |
| Canonicals | 1 on every indexable page; 0 anomalies (`seo_audit.py`) |
| HTTPS/TLS | valid; GitHub Pages cert (`growth-engine` baseline: expires 2026-11-30) |
| Broken internal links | **0** |
| Orphan pages | **0** (indexable set) |
| Duplicate titles / descriptions (indexable) | **0** exact clusters |
| Pages ≠ 1 `<h1>` / missing `<title>` / missing description / missing canonical | **0** |
| Invalid JSON-LD | **0** |
| Mobile viewport present | 133/133 |
| `tel:` link present | 133/133 |
| Sitemap URLs | **74** |

### Live response headers (verified) — security headers are NOT applied

`curl -I https://straightflushplumbingoc.com/` returns only:
`content-type`, Cloudflare/Fastly cache headers, `speculation-rules`, and
`access-control-allow-origin: *`.

**Absent from live responses:** `Strict-Transport-Security`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Content-Security-Policy` (response header form), `Cross-Origin-*`.

The repo ships `_headers` (with the intended values) and every page carries an
equivalent meta CSP, but **GitHub Pages ignores `_headers`**, so the response
headers are not live. `README.md` documents that a **Cloudflare Transform Rule →
Modify Response Header** is required; the evidence shows it has not been applied.
This is a real, confirmed gap affecting the public site. **Level 3 (hosting)** —
script prepared, not executed (see §7).

---

## 3. Local SEO baseline — priority queries

The 10 requested priority query families, mapped to the page that currently owns
each intent (cannibalization check) and its 2026-10-15 metadata state.

| # | Query | Owning page(s) | 2026-10-15 status |
|---|---|---|---|
| 1 | Plumber Laguna Niguel | `cities/laguna-niguel.html` | title `<60` ok, unique; desc templated (shared with 20 cities) |
| 2 | Leak detection Laguna Niguel | `cities/laguna-niguel.html` + `services/leak-detection.html` | desc templated |
| 3 | Slab leak detection Laguna Niguel | `services/slab-leak-detection.html` + `cities/laguna-niguel.html` | strong page (913 words) |
| 4 | Water leak detection South Orange County | `services/leak-detection.html` | generic OC title |
| 5 | Emergency plumber Laguna Niguel | `services/emergency-plumbing.html` | title is "…in Orange County" (city intent not covered) |
| 6 | Repiping Laguna Niguel | `services/pex-repiping.html` | desc templated |
| 7 | Slab leak repair Mission Viejo | `cities/mission-viejo.html` | title "Leak Detection & Plumbing…" (repair intent weak) |
| 8 | Plumber Laguna Hills | `cities/laguna-hills.html` | title "Leak Detection & Plumbing…" |
| 9 | Leak detection Aliso Viejo | `cities/aliso-viejo.html` | title "Leak Detection & Plumbing…"; **only 1 city internal link** |
| 10 | Water heater repair Laguna Niguel | `services/water-heater-services.html` | desc templates Dana Point/San Clemente, not Laguna Niguel |

**Confirmed metadata deficiency:** all 21 city pages share the **identical meta
description**, `"Acoustic slab leak detection and plumbing services in {City},
CA. Local, family-owned, diagnose-first. Call (949) 374-6524."` (1 template, 21
instances). Titles are unique but also follow one template. Each city page
already contains genuinely unique, city-specific prose (construction era, soils,
housing stock) that is not reflected in its metadata.

**Priority-page H1s are on-brand and non-spammy** but several are brand-led slogans
rather than the service+city phrase the target query uses (not a defect — noted for
the Phase 3 content recommendations).

**Rich results already present:** FAQPage on the homepage, all 6 service pages,
and all 21 city pages (43 indexable pages); BreadcrumbList on 110 pages;
`Plumber`/`Service`/`Offer`/`Article`/`WebPage`/`Organization`/`City` types present.

---

## 4. Confirmed issues (evidence-backed)

| ID | Severity | Issue | Evidence |
|---|---|---|---|
| BASE-01 | medium | **Self-reported `aggregateRating` (4.8/74) + 3 `review` objects on the site-wide `Plumber` node** — Google policy discourages self-serving review markup for a business | `index.html` JSON-LD; `growth-engine/KNOWN_ISSUES.md` ISSUE-002 |
| BASE-02 | medium | **Case studies assert they are real completed jobs with no disclaimer** — the KB states case studies may never be fabricated and the owner must confirm | `case-studies/*.html` ("Real Slab Leak Detection work … based on a completed local job", "recently completed … (September 2026)"); `APPROVED_CLAIMS.md` FORBIDDEN list |
| BASE-03 | medium | **Security response headers not live** (HSTS, XFO, XCTO, Referrer-Policy, Permissions-Policy, CSP, COOP/CORP) | live `curl -I` (§2); `_headers` present but ignored by Pages; README documents the missing Transform Rule |
| BASE-04 | low | **`case-studies/index.html` missing from `sitemap.xml`** (its 4 child case studies are listed) | `grep case-studies sitemap.xml` → children only |
| BASE-05 | low | **`sitemap.xml` `lastmod` is stale** for 72/74 URLs (`2026-09-24`) though pages were edited through `2026-10-12`; Pages/DNS fixes are not reflected | `grep <lastmod>` |
| BASE-06 | low | **All 21 city meta descriptions identical** (templated) | `seo_audit.py` / direct grep (§3) |
| BASE-07 | low | **`llms.txt` publishes "5.0/5 on Google"** plus Yelp 4.8/74 as flat facts with no source/caveat | `llms.txt` |
| BASE-08 | low | **`access-control-allow-origin: *`** on all responses from GitHub Pages | live headers |
| BASE-09 | info | 72 root-level legacy duplicate files render live (5 KB) and are `noindex` stubs canonicalizing to `cities/`/`services/`/`academy/` — crawl-budget waste, but intentional per KB | `seo_audit.py`; `SERVICE_AREAS.md` |

---

## 5. Could not be verified in this environment (recorded, not zero)

| Item | Why | Exact unlock needed |
|---|---|---|
| Organic impressions/clicks/positions | GSC not connected | owner OAuth or export (P-002) |
| Indexed vs excluded pages | GSC not connected | same |
| GA4 traffic/conversions | GA4 not connected | GA4 property ID + API creds |
| GBP Insights / local-pack visibility | GBP not connected | GBP API access or owner export |
| **Core Web Vitals / Lighthouse** | **PageSpeed Insights API returns HTTP 429 no-key quota** | API key, or run Lighthouse locally with Chrome |
| AI answer-engine visibility (ChatGPT/Claude/Gemini/Perplexity/AI Overviews) | no API keys; apps 403/JS-only | Perplexity API key (cheapest real signal) |
| Call tracking / lead counts | not connected | provider + creds |

---

## 6. Phase 2–3 changes made in this branch

See `growth-engine/reports/daily/2026-10-15.md` and the PR for the full change
list, the tests run, and their actual results. Summary: 4 focused changes
(BASE-01, BASE-02, BASE-04, BASE-05) plus a city-metadata differentiation
(BASE-06) and the `llms.txt` honesty fix (BASE-07). BASE-03 (headers) is
approval-gated; BASE-08/BASE-09 are recommendations only.

## 7. Awaiting owner approval

- **BASE-03** — apply the `_headers` security headers via a Cloudflare Transform
  Rule (script prepared at `growth-engine/proposals/`, not executed).
- **BASE-02** — confirm the case studies are real, or approve the honest
  disclosure wording now shipped; if they are illustrative, they must be reworded.
- **BASE-01** — confirm the 4.8/74 rating against the live Yelp/Google profiles
  before any rating markup is re-introduced.
- Any Google Business Profile edit; any listing submission (Level 3).
