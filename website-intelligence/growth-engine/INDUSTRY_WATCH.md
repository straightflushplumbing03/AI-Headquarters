# Industry Watch — Straight Flush Plumbing & Leak Detection

Rolling, dated record of **plumbing-industry developments**, **official search-engine
guidance**, **homeowner questions**, and **diagnostic technology**. Every entry cites
its source URL and carries a confidence level. Nothing here is invented: if a claim
cannot be traced to a fetched source, it is not written down.

**Rules**
- Official guidance comes only from primary sources (Google Search Central, Bing
  Webmaster Guidelines, schema.org, CSLB, EPA/WaterSense, etc.) — never from a
  content-marketing blog paraphrasing them.
- Confidence: `high` (primary source, fetched) · `medium` (reputable secondary,
  fetched) · `low` (single weak source / inference) · `unverified` (not fetched).
- Industry claims about *our* business go through `APPROVED_CLAIMS.md`.

---

## 2026-10-13 — Google Search Central deprecates the FAQ rich result

- **What changed / observed:** Google Search Central removed the FAQ rich-result
  documentation; the feature "is no longer shown in Google Search results"
  (announced in the Search Central changelog in May 2026). Any `FAQPage`
  structured data now earns **no** rich-result eligibility. A separate, older
  changelog entry also states the FAQ feature "is only shown for well-known,
  authoritative government and health websites" — which for a residential plumbing
  business means **no eligibility at all** either way. Fetched directly from the
  primary source (page emitted Oct 2026; page `Last updated 2026-10-08`).
- **Why it matters to Straight Flush:** Several site pages and ideas (e.g.
  `idea-2026-10-12-07`, and pages carrying `FAQPage` JSON-LD) were justified, in
  part, by FAQ rich-result eligibility. That justification is now void. The FAQ
  *content* can still help readers and AI answer engines (AEO), but it must no
  longer be described as producing a Google FAQ rich result. This is a
  documentation/reporting correctness matter — not a reason to delete FAQ pages.
- **Source(s):** https://developers.google.com/search/blog (Search Central
  changelog, FAQ entries) · https://developers.google.com/search/docs/appearance/structured-data/faqpage
  · **Confidence:** high (primary source, fetched).
- **Proposed action (if any):** Update `idea-2026-10-12-07` scoring/notes and the
  FAQ-related framing; keep answer-first FAQ content for AEO/human value. No code
  change warranted this run (re-scoring is a knowledge-base edit, not a website edit).

## 2026-10-13 — EPA WaterSense household-leak statistics (primary source)

- **What changed / observed:** EPA WaterSense states the average family can waste
  **180 gallons per week / 9,400 gallons annually** from household leaks (≈ 300
  loads of laundry), and that household leaks waste **~900 billion gallons
  annually nationwide**. Fetched directly from EPA.
- **Why it matters to Straight Flush:** These are *primary-source* figures usable in
  leak-detection education content without inventing statistics or crossing into
  Level-3 claims. They are the EPA's numbers, cite EPA, and are safe to attribute.
- **Source(s):** https://www.epa.gov/watersense/statistics-and-facts · **Confidence:** high (fetched).
- **Proposed action (if any):** cite EPA figures on an education page (candidate;
  owner review for any local framing). See `INNOVATION_IDEAS.md` idea-2026-10-13-04.

---

## 2026-10-12

### 2026-10-12 — Phase 2 inspection: HQ-D run budget + automation consolidation (infrastructure)
- **What changed / observed:** Phase-2 inspection of OpenHands Cloud / Intelligence
  HQ. Root-caused the HQ-D failure (run `2026-10-12T05:33:52Z`, "Timed out: command
  timed out"): the platform **hard-caps automation `timeout` at 1800 s (30 min)** —
  a 3600 request returns HTTP 422 `value_error: timeout must not exceed 1800
  seconds`. The successful run (`2026-10-12T06:09:19Z`) needed longer than 30 min,
  so open-ended research can exceed the wall clock before the report is committed.
- **Why it matters to Straight Flush:** a research run that never persists is a
  silent intelligence gap — the durable knowledge base stops growing even though the
  automation reports "enabled".
- **Remediation:** the canonical HQ-D prompt now carries a mandatory time budget
  (~40% research / 60% write+commit) and a reduced query count (15–25). The live
  automation prompt was re-synced to the committed canonical file (prompt_chars
  10443) so the live definition and the repo no longer drift.
- **Consolidation:** legacy `Scout: Daily Competitor Intel`,
  `Strategist: Daily SEO Action Plan`, and `Sentinel: Scout Auto-Retry` are disabled
  (redundant with HQ-D/HQ-W); `Automation A` was already disabled when HQ-D was
  enabled.
- **Source(s):** repository files + OpenHands automation API (fetched 2026-10-12).
  **Confidence:** high (repo/API-verified).
- **Proposed action:** none new; tracked as `KNOWN_ISSUES.md` ISSUE-005/ISSUE-006.

### Supplementary entries (concurrent 2026-10-12 run — additive, not merged)

- **Google: "AI Features and Your Website"** — primary source
  https://developers.google.com/search/docs/appearance/ai-features (page **last
  updated 2025-12-10 UTC**). States SEO best practices remain relevant for AI
  Overviews / AI Mode; **"You don't need to create new machine readable files, AI
  text files, or markup to appear in these features"**; a supporting link must be
  indexed and snippet-eligible. *Relevance:* SF's `llms.txt` / `llms-full.txt` /
  `/md/**` are harmless but **not a Google lever** — crawlability + helpful content
  is. Confidence: **high**.
- **EPA WaterSense household-leak statistics** — primary sources
  https://www.epa.gov/watersense/statistics-and-facts and
  https://www.epa.gov/watersense/fix-leak-week. Fetched: average family can waste
  **180 gal/week / 9,400 gal/year** from leaks; a 1-drip/second faucet wastes
  **>3,000 gal/year**; **a family of four exceeding 12,000 gal/month may have
  serious leaks**; fixing leaks can save **~10% on water bills**. *Relevance:*
  citable figures (with EPA attribution) for high-water-bill / hidden-leak pages —
  no invented stats. Confidence: **high**.
- **Note:** Brave Search was rate-limited (**HTTP 429**) this run; competitor
  observations used DuckDuckGo HTML as the single permitted alternate.


### Search guidance — Google Search Central (primary sources)

- **New learning paths: curated YouTube playlists for Search fundamentals and
  Technical SEO** (published 2026-10). Google added curated YouTube learning
  paths for Search fundamentals and technical SEO. *Relevance:* free, authoritative
  training material for keeping the site's technical SEO current; the technical
  path is directly applicable to crawl/index/schema hygiene on a static site.
  Confidence: **high** (primary source).
  Source: https://developers.google.com/search/blog/2026/10/seo-learning-paths
- **Announcing web multimodal Search performance reporting in Search Console**
  (published 2026-09). Search Console now reports performance for web multimodal
  Search, i.e. results that include images/video-style surfaces. *Relevance:* once
  GSC access exists, local-image and video assets on service pages become
  measurable, not just text queries. Confidence: **high**.
  Source: https://developers.google.com/search/blog/2026/09/web-multimodal-in-sc
- **Introducing Search Generative AI performance reports in Search Console**
  (published 2026-06). Search Console added Generative AI performance reporting.
  *Relevance:* this is the first first-party way to measure AI-surface impressions
  without third-party AI-platform testing; still requires GSC access (blocked —
  see `INTEGRATION_STATUS.md`). Confidence: **high**.
  Source: https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports
- **A new resource for optimizing for generative AI in Google Search**
  (published 2026-05). Google published guidance on optimizing for generative AI
  in Search. *Relevance:* primary-source guidance to align the site's
  content/AEO approach; read and map to the Academy pages. Confidence: **high**.
  Source: https://developers.google.com/search/blog/2026/05/a-new-resource-for-optimizing
- **Update to the Site Reputation Policy** (published 2026-08). Google updated
  its site-reputation policy (third-party/parasite content on host sites).
  *Relevance:* confirms that thin, syndicated or parasite content is a risk; the
  knowledge base's "no thin/doorway pages" rule matches current policy.
  Confidence: **high**.
  Source: https://developers.google.com/search/blog/2026/08/update-site-reputation-policy
- **New Location for the Google Crawlers' IP Range Files** (published 2026-03).
  Google moved the published crawler IP-range files. *Relevance:* if the owner
  later adds server-side crawler allowlisting, use the new location; do not
  hardcode the old path. Confidence: **high**.
  Source: https://developers.google.com/search/blog/2026/03/crawler-ip-ranges

### Plumbing-industry developments

- **Rheem "strengthens leadership to advance AI and digital transformation"**
  (phcppros, 2026-10). A major water-heater manufacturer is publicly investing in
  AI/digital transformation. *Relevance:* a hypothesis worth watching — manufacturer
  diagnostic/AI tooling and connected water-heater data may reach homeowners, which
  could shift what "water heater service" pages should explain. Confidence: **medium**
  (headline-level; article body not fully parsed).
  Source: https://www.phcppros.com/articles/24275-rheem-strengthens-leadership-to-advance-ai-and-digital-transformation
- **"Code changes due for the 2030 model plumbing and mechanical codes"**
  (phcppros). Code-cycle news relevant to repipe/water-heater content accuracy.
  *Relevance:* do not publish code claims; monitor only, and route any code
  statement to the owner for verification. Confidence: **medium**.
  Source: https://www.phcppros.com/articles/24118-code-changes-due-for-the-2030-model-plumbing-and-mechanical-codes
- **Watsco Q3 conference call** (phcppros) — HVAC/plumbing distribution earnings
  cadence; a weak-demand/industry-health signal, not directly actionable for SEO.
  Confidence: **low** (headline only).
  Source: https://www.phcppros.com/articles/24274-watsco-schedules-third-quarter-conference-call
- **phcppros maintains a dedicated "AI Technology" topic hub** — evidence the
  trade press treats AI in the trades as a standing beat. *Relevance:* useful
  standing feed for future INDUSTRY_WATCH entries. Confidence: **high** (page exists).
  Source: https://www.phcppros.com/topics/780-ai-technology

### Diagnostic technology (acoustic, electronic, thermal, camera)

- No new diagnostic-technology product launch was verified this run (searches of
  the trade press surfaced only the leadership/finance items above). The site's
  existing three-method explainer set (acoustic, electronic pipe locating, thermal
  imaging) remains the differentiator; treat new-equipment claims as **unverified**
  until a primary source is fetched. Confidence: **low** (absence of evidence).

### Recurring homeowner questions (from 2026-10-12 result titles)

Question-shaped pages recur across the sweep, indicating durable homeowner intent:
"how to locate a hidden water leak" (Dana Point query returned
`plumbingsolutionspecialist.com/leak-detection-dana-point-ca/` and
`leak-detection-pro.com` location pages), plus the site's own Academy cluster
already covers "water meter still moving everything off", "warm spot on floor",
"sound of running water in wall". *Opportunity:* these map cleanly to
answer-first Academy/FAQ content. Confidence: **medium**.

### Legitimate local-search opportunities

- **Repipe queries are dominated by specialists, not generalists.** `ocrepipes.com`
  and `repipesoc.com` appeared on the repipe-family queries; the site has a
  verified `/services/pex-repiping.html` page but no per-city repipe framing.
  *Opportunity (proposal only):* a repipe education/eligibility page — not a
  doorway page — is a candidate. Confidence: **medium**.
- **"Near me" queries returned non-localized sets** (cities = `""`), consistent
  with prior runs: near-me results are device-location driven and not measurable
  from a sandbox. Treat as **inconclusive**, not as an SF failure. Confidence: **medium**.

---

## 2026-10-11 (seeded from the 2026-10-11 run)

- Google Search Central published/updated the Search Console AI (generative)
  performance reporting and multimodal reporting surfaces (see 2026-10-12 entries
  for URLs). Confidence: **high**.
- Trade press (phcppros, contractormag.com) continued coverage of AI adoption and
  workforce/industry events in plumbing. Confidence: **medium**.

<!--
New entries are prepended directly under this line, newest first, using:

### YYYY-MM-DD — <short title>
- **What changed / observed:**
- **Why it matters to Straight Flush:**
- **Source(s):** <exact URL(s)>  · **Confidence:** high|medium|low|unverified
- **Proposed action (if any):** <idea id / PR / none>
-->
## Dated entries

### 2026-10-12 — Knowledge base extended for Intelligence HQ (infrastructure)
- **What:** Added `INDUSTRY_WATCH.md`, `INNOVATION_IDEAS.md`, weekly-report
  structure, and the Intelligence HQ automation. No external claims added.
- **Sources:** repository files only. **Confidence:** high (repo-verified).
- **Follow-up:** daily runs populate dated findings below.

### 2026-10-12 — Official Google guidance re-verified (primary sources, fetched)
- **What:** Fetched and confirmed live (HTTP 200) two primary Google Search Central
  references used by every run:
  - *AI features and your website* — https://developers.google.com/search/docs/appearance/ai-features
  - *Local business (LocalBusiness) structured data* — https://developers.google.com/search/docs/appearance/structured-data/local-business
- **Why it matters to Straight Flush:** AI-feature guidance confirms that appearing
  in AI features depends on standard Search fundamentals (crawlability, helpful
  content, structured data) — consistent with this repo's diagnose-first strategy.
  The LocalBusiness page is the authority for the ISSUE-002 `aggregateRating`
  hygiene question.
- **Source(s):** the two URLs above (fetched 2026-10-12, HTTP 200).
  **Confidence:** high (primary source).
- **Proposed action:** none new; supports idea-2026-10-12-02 (rating hygiene).

## Standing official references (stable primary sources)

| Topic | Source | URL | Verified | Confidence |
|---|---|---|---|---|
| Google Search Essentials | Google Search Central | https://developers.google.com/search/docs/essentials | 2026-10-11 | high |
| Structured data policies | Google Search Central | https://developers.google.com/search/docs/appearance/structured-data/sd-policies | 2026-10-11 | high |
| Local business structured data | Google Search Central | https://developers.google.com/search/docs/appearance/structured-data/local-business | 2026-10-11 | high |
| Helpful content / people-first | Google Search Central | https://developers.google.com/search/docs/fundamentals/creating-helpful-content | 2026-10-11 | high |
| AI features & your site | Google Search Central | https://developers.google.com/search/docs/appearance/ai-features | 2026-10-11 | high |
| Search Console performance report | Google Search Central | https://support.google.com/webmasters/answer/7576553 | 2026-10-11 | high |
| Schema.org LocalBusiness | schema.org | https://schema.org/LocalBusiness | 2026-10-11 | high |
| CSLB license lookup (CA) | CA Contractors State License Board | https://www.cslb.ca.gov/onlineServices/CheckLicenseII/CheckLicense.aspx | 2026-10-11 | high |

> These are seeded, stable references used by every run. Daily/weekly runs append
> dated entries below and refresh `Verified` when a page changes materially.

---

