# Entity Consolidation Plan — Straight Flush Plumbing & Leak Detection

**Created:** 2026-10-15
**Owner decision:** confirmed — the Wix account and the base44 URL are owned by
Straight Flush Plumbing & Leak Detection.
**Status:** findings captured and verified. **No external change applied.**
Awaiting owner go-ahead before touching either property.

---

## 1. Why this matters

Search engines and AI answer engines resolve a business to **one entity**. When
several web properties claim the same business name, phone number and city, the
engine has to choose which one is authoritative. The result is:

- split authority — links, reviews and signals are spread across properties
  instead of concentrating on `straightflushplumbingoc.com`;
- a real risk that an AI answer engine cites a stale duplicate instead of the
  real site;
- conflicting public claims about the business.

This is the failure mode the master prompt names in §8 ("old domains, abandoned
site-builder URLs, and conflicting canonical references") and §7C ("conflicting
business names, addresses, phone numbers, or URLs").

---

## 2. Verified findings

All checks below were run 2026-10-15 against the live properties.

### 2a. Wix property — `straightflushplumb8.wixsite.com`  [already dead]

| Check | Result |
|---|---|
| `GET /` | **HTTP 404** |
| `GET /home` | **HTTP 404** |
| `GET /straightflushplumbing` | **HTTP 404** |
| `<meta name="robots">` | `noindex` |
| Links to the real site | none |

The Wix site is **unpublished or deleted already**. Every page returns 404 and the
404 page is `noindex`. Low risk.

**But** it still surfaced in a Tavily brand-name query, so the URL is still in
some index. Deleting the site from the Wix account removes the URL from Wix's
serving entirely, which is the cleanest signal.

### 2b. base44 property — `straight-flush-plumbing-7fb7cf71.base44.app`  [LIVE DUPLICATE]

This is the real problem. It is a **live, indexable, full duplicate** of the
business.

| Check | Result |
|---|---|
| `GET /` | **HTTP 200**, 34 KB |
| `<meta name="robots">` | `index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1` |
| `<link rel="canonical">` | `https://straight-flush-plumbing-7fb7cf71.base44.app` (self-referencing) |
| `robots.txt` | `User-agent: *` / `Allow: /` + declares its own sitemap |
| `sitemap.xml` | **48 URLs** |
| `<title>` | `Straight Flush Plumbing` |
| Links to the real site | **0** |
| Phone found on page | `(949) 374-6524` — matches the real NAP |
| City mentions | Laguna Niguel (26), Orange County (37), Irvine (8), Mission Viejo (7) |

**Page set (48 URLs)** — mirrors the real site and adds its own:

- Service pages: `/leak-detection`, `/slab-leak-repair`, `/drain-cleaning`,
  `/water-heater`, `/gas-line`, `/sewer-line`, `/pipe-repair`, `/repiping-orange-county`,
  `/water-main-repair`, `/emergency-plumbing`
- City pages: `/plumber-laguna-niguel`, `/plumber-mission-viejo`, `/plumber-irvine`,
  `/plumber-aliso-viejo`, `/plumber-dana-point`, `/plumber-laguna-beach`,
  `/plumber-laguna-hills`, `/plumber-newport-beach`, `/plumber-san-clemente`,
  `/plumber-san-juan-capistrano`, `/plumber-costa-mesa`,
  `/plumber-rancho-santa-margarita`, `/plumber-ladera-ranch`, `/plumber-dove-canyon`,
  `/plumber-foothill-ranch`, `/plumber-coto-de-caza`, `/plumber-lake-forest`,
  `/plumber-laguna-woods`
- **5 blog posts targeting the same keywords:**
  `/blog/how-to-detect-slab-leak-orange-county`,
  `/blog/why-water-bill-high-laguna-niguel`,
  `/blog/signs-hidden-plumbing-leaks-california-homes`,
  `/blog/emergency-plumbing-checklist-homeowners`,
  `/blog/how-leak-detection-works`

**Leftover template pages still live and in the sitemap:**

- `/million-dollar-bet` — HTTP 200, 34.7 KB
- `/analytics` — HTTP 200, 34.6 KB

These are almost certainly unused app-builder scaffolding, not business content.

**Unverified claims on the page** (must not be published without evidence — see
master prompt §2):

- "24/7 emergency service"
- "Orange County's premier leak detection and emergency plumbing specialists"
- "same-day slab leak detection"

**A third domain is declared in its structured data.** The JSON-LD on the base44
site does **not** use its own host. It declares:

```
"@id":  "https://flush-pro-flow.base44.app/#business"
"url":  "https://flush-pro-flow.base44.app"
"name": "Straight Flush Plumbing & Leak Detection"
"telephone": "+19493746524"
"email": "straightflushplumbing03@gmail.com"
```

`flush-pro-flow.base44.app` currently returns **HTTP 404** on `/` (its
`robots.txt` still returns 200). So the entity is being declared under a domain
that no longer serves a page — a dangling reference.

### 2c. The real site

`straightflushplumbingoc.com` carries 3 JSON-LD blocks and **zero** references to
either duplicate property. So the duplicates are not being disavowed from the
real site's side either.

---

## 3. The entity fragmentation, in one picture

```
                   "Straight Flush Plumbing & Leak Detection"
                        +1 949 374 6524 · Laguna Niguel, CA
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
  straightflushplumbingoc.com   straight-flush-plumbing-     flush-pro-flow
  (REAL — keep)                 -7fb7cf71.base44.app         .base44.app
                                 (LIVE DUPLICATE — 48 URLs)   (404, but still
                                                               declared as the
                                                               business @id)
                                                              │
                                                     straightflushplumb8
                                                     .wixsite.com
                                                     (404, noindex)
```

Four hosts, one business, three of them competing or dangling.

---

## 4. Recommended order of operations

Do these **in order**. Each step is independently reversible until step 3.

### Step 1 — base44: unpublish or delete the app  [highest value]

In your base44 dashboard, find the app serving
`straight-flush-plumbing-7fb7cf71.base44.app` and either delete it or take it
offline. Deleting is better than leaving it live with a redirect, because a live
duplicate keeps competing for the same queries.

Before deleting, check whether the blog posts contain anything worth keeping.
If they do, the content can be rewritten for the real site (as original content,
not copied) — but note §10 of the master prompt forbids publishing claims the
business cannot support.

Do **not** redirect the base44 domain to the real site unless you control DNS for
it. A `410 Gone` is the correct signal for content that is intentionally
removed. A redirect from a duplicate passes its (low) authority to the real site,
which is mildly positive, but only if you genuinely control the domain.

### Step 2 — Wix: delete the site from the account

Every page already 404s, so this is cleanup rather than damage control. Deleting
the site (rather than leaving it unpublished) removes the Wix-hosted URL so it
can drop out of search indexes.

### Step 3 — Request removal from search indexes

Once the properties stop serving:

- **Google:** use the Removals tool in Search Console for the base44 and Wix
  URLs, so they drop out faster than natural recrawl.
- **Bing:** the equivalent URL removal in Bing Webmaster Tools.
- Do **not** use any automated mass-indexing or link-spam tooling.

### Step 4 — Verify

Re-run the checks and confirm the duplicates are gone:

```bash
# Each of these should stop returning HTTP 200 with indexable content
curl -sL -o /dev/null -w "%{http_code}\n" https://straight-flush-plumbing-7fb7cf71.base44.app/
curl -sL -o /dev/null -w "%{http_code}\n" https://straightflushplumb8.wixsite.com/
curl -sL -o /dev/null -w "%{http_code}\n" https://flush-pro-flow.base44.app/
```

Then re-run the brand-name control query and confirm only the real domain
appears:

```bash
python3 scripts/tavily_search.py --smoke \
  --query "Straight Flush Plumbing & Leak Detection Laguna Niguel"
```

### Step 5 — Keep it from happening again

Run the entity consistency check as part of the daily cycle. It re-tests all four
hosts and flags any that start serving indexable content again:

```bash
python3 scripts/entity_consistency_check.py --run --append
```

---

## 5. What must NOT be done

- **Do not** add `sameAs` links from the real site's schema to the duplicates.
  `sameAs` asserts "this is also me" — it would **strengthen** the association
  with the stale properties rather than consolidate away from them. Consolidation
  here means removal, not linkage.
- **Do not** copy the base44 blog posts verbatim onto the real site. Duplicate
  content between two of your own properties is the same problem in a new place.
- **Do not** publish the unverified claims ("24/7", "premier", "same-day")
  without evidence. See the business facts registry requirement in §2 of the
  master prompt.
- **Do not** attempt a takedown of a property you do not own. You own both, so
  this does not apply — but it is the reason ISSUE-014 was held pending your
  ownership answer.

---

## 6. Approval and status

| Item | Status |
|---|---|
| Ownership confirmed by owner | ✅ 2026-10-15 |
| Findings verified | ✅ 2026-10-15 |
| External properties changed | ❌ not started — needs go-ahead |
| Real-site files changed | ❌ none (no change is correct here) |
| Verification method ready | ✅ `scripts/entity_consistency_check.py` |

Steps 1–3 change external accounts and search-index state. Per the master prompt
§14, those require explicit approval and are not performed automatically. Steps 4
and 5 are automated and already wired.

See `KNOWN_ISSUES.md` ISSUE-014 for the tracked issue.
