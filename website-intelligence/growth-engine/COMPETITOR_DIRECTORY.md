# Competitor Directory — Straight Flush Plumbing

Rolling list built from **actual observations** (raw rows in
`data/competitor_observations.jsonl`). Only companies observed appearing for
real queries are listed. Correlation ≠ causation: a feature being present is
*evidence a competitor has it*, not proof it caused a recommendation.

**Baseline observation date:** 2026-10-09 · **Latest daily run:** 2026-10-13 (`reports/daily/2026-10-13.md`)
**Platform:** Brave Search (2026-10-09/10/11/13) and DuckDuckGo Lite (2026-10-12) — conventional proxies, **not** AI answer engines.
**Baseline queries:** plumber in Laguna Niguel · slab leak detection Laguna Niguel · emergency plumber Laguna Niguel · leak detection Orange County · best plumber in Laguna Niguel
**2026-10-09 daily queries (11 succeeded):** plumber in {Dana Point, San Clemente, Mission Viejo, Aliso Viejo} · leak detection {Laguna Niguel, Mission Viejo, Aliso Viejo} · slab leak repair Laguna Niguel · slab leak detection {Dana Point, San Clemente} · water heater repair Laguna Niguel
**2026-10-10 daily queries (6 succeeded):** plumber in {Irvine, Laguna Hills, Laguna Beach, Ladera Ranch, Rancho Santa Margarita, Lake Forest}
**2026-10-12 daily queries (36 succeeded):** DuckDuckGo Lite sweep across 7 services × 12 cities.
**2026-10-13 daily queries (9 succeeded):** Brave returned HTTP 429 after 9; best plumber in Laguna Niguel · slab leak detection Dana Point · slab leak repair San Clemente · leak detection Mission Viejo · emergency plumber Aliso Viejo · PEX repipe Dana Point · water heater repair Mission Viejo · slab leak specialist Orange County · hidden water leak detection Orange County.
*(5+10 further queued queries across 2026-10-10 and 2026-10-13 were not executed — rate limits; see daily report limitations.)*

---

## 2026-10-13 update — 9-query Brave sweep (conventional proxy; rate-limited)

9 queries across 6 core services and 6 cities/county. Brave returned **HTTP 429**
after query 9, so the sweep stopped per the Brave-only rule; raw rows in
`data/competitor_observations.jsonl` (+88) and per-query sets in
`data/ai_visibility_history.jsonl` (+9). **Straight Flush was absent from all 9**
(0/9 recommended, 0/9 mentioned, 0/9 cited). Frequency = distinct queries (of 9) in
which the domain appeared in the top-10 organic results. Presence is evidence a
competitor has a feature; it is **not** proof the feature caused a ranking.

### Appeared for ≥3 of 9 queries

| Competitor | Domain | # queries | Observed feature | Claim status |
|---|---|---|---|---|
| Yelp (directory) | yelp.com | 7 | Aggregator/local-pack channel | visibility channel, not a competitor |
| Scott English Plumbing | scottenglishplumbing.net | 6 | Per-city `/service-area/plumber-in-{city}` pages | feature **verified** (repeat) |
| Bill Metzger Plumbing | billmetzgerplumbing.com | 5 | Service-area city pages; `WebSite`/`WebPage` schema | feature **verified** (repeat) |
| Roto-Rooter | rotorooter.com | 4 | National franchise per-city pages | feature **verified** (repeat) |
| Cal's Choice | calischoice.com | 4 | Slab-leak/leak-detection location pages | feature **verified** (repeat) |
| Barker and Sons | barkerandsonsplumbing.com | 4 | `/city/{city}-ca-plumber/` city pages | feature **verified** (repeat) |
| Evans Leak Detection | evansleakdetection.com | 4 | Dedicated slab-leak pages; rich `FAQPage`(12 Q/A)+`Plumber`+`GeoCoordinates` | feature **verified** (repeat); FAQ rich result now deprecated by Google |
| Efficient Plumbing | efficientplumbing.com | 3 | `/laguna-niguel-plumbers/` city landing | feature **verified** (repeat) |
| Leak Detection Plumbers | leakdetectionplumbers.com | 3 | Leak-detection pages (site 403 to our fetch) | presence **verified**; features **unverified** |
| Pristine Plumbing | pristineplumbinginc.com | 3 | Leak-detection pages | feature **verified** (repeat) |

### Newly observed 2026-10-13 (first time in this directory)

`leakstar.com` (per-city `/slab-leak-detection-service-{city}.html`, **verified fetched
200**, `Organization`+`BreadcrumbList` schema) · `waterheatersonly.com` ·
`usawaterheaters.us` · `repipe1.com` · `repipe-dana-point.com` · `repipe-specialist.com` ·
`pexrepipe-repiping.com` · `pipease.com` · `ezleakdetection.com` ·
`integrityrepipe.com` · `247leakmasters.com` · `pacificcoastcopperrepipe.com` ·
`allstarplumbingservice.com` · `deltaplumbingoc.com` · `aaronandsonsplumbing.com` ·
`veteranairusa.net` · `slableakfix.com` · `levelupplumbinginc.com` ·
`moffettplumbing.com` · `thepassionateplumber.com`.

### Pattern (hypothesis, medium)

Repipe intent ("PEX repipe Dana Point") returns **repipe-specialist** domains
(ocrepipes, repipe1, repipe-dana-point, pexrepipe-repiping, pipease) plus
`integrityrepipe.com`/`socalrepipes.com`; general plumbers are largely absent. Slab
intent returns **leak specialists** with a *dedicated per-city slab page*
(leakstar, evans). Both patterns support idea-2026-10-13-01/-02.

---

## 2026-10-13 update — 22-query sweep (Brave conventional proxy; Bing fallback unparseable)

22 queries across core services and Tier-1/2 cities, weighted to commercially
valuable, historically weak, and not-recently-tested queries. **14 returned
parseable organic results (Brave); 8 fell through to Bing after Brave HTTP 429
and returned unparseable markup → recorded `inconclusive` (not zero).**
**Straight Flush was absent from all 14 successful result sets**
(0 recommended / 0 mentioned / 0 cited). Frequency = number of the 14 successful
queries in which the domain appeared in the observed organic results (counted
from `data/ai_visibility_history.jsonl`, not estimated). All findings are
*observations of presence* — an observed feature is evidence a competitor has it,
**not** proof it caused any ranking or recommendation.

### Appeared for 4+ of 14 successful queries

| Competitor | Domain | # queries | Observed feature | Claim status |
|---|---|---|---|---|
| Yelp (aggregator) | yelp.com | 13 | Category/city listing pages dominate local "plumber/best plumber" queries | Aggregator — directory presence, not a claim about SF |
| Scott English Plumbing | scottenglishplumbing.net | 10 | City × service pages, review widgets | Conventional result; no SF claim |
| Roto-Rooter (franchise) | rotorooter.com | 9 | National brand + local landing pages | Franchise — not a single-operator peer |
| Bill Metzger Plumbing | billmetzgerplumbing.com | 9 | Service pages, local trust signals | Conventional result; no SF claim |
| Barker & Sons Plumbing | barkerandsonsplumbing.com | 7 | Service pages, emergency positioning | Conventional result; no SF claim |
| Cal's Choice Plumbing | calischoice.com | 7 | City × leak-detection pages | Conventional result; no SF claim |
| Efficient Plumbing | efficientplumbing.com | 7 | Service pages | Conventional result; no SF claim |
| Rooter Hero | rooterhero.com | 5 | National brand + local pages | Franchise — not a single-operator peer |
| Evans Leak Detection | evansleakdetection.com | 5 | **Specialist leak-detection positioning** — direct niche peer | Conventional result; no SF claim |
| Mr. Rooter (franchise) | mrrooter.com | 4 | National brand + local pages | Franchise — not a single-operator peer |
| Emergency Response Plumbers | emergencyresponseplumbers.com | 4 | Emergency positioning | Conventional result; no SF claim |
| Clearwater Plumbing OC | clearwaterplumbingoc.com | 4 | OC-local service pages | Conventional result; no SF claim |

### Notable recurring new domains (2026-10-13)

`twinplumbing.com`, `repipepro.net`, `ocplumber.com`, `repipesoc.com` appeared on
the pinhole/copper-pipe leak query; `socalrepipes.com`, `allstarplumbingservice.com`
on slab/leak queries; `splashplumbing.com` (2). Full raw rows in
`data/competitor_observations.jsonl` (ts `2026-10-13T17:05:00Z`).

**Interpretation (hypothesis, medium confidence):** the recurring pattern is
**city × service page coverage** plus a specialist-leak-detection positioning
(Evans). SF's own `/leak-detection/` cluster is the closest match; the gap is
city-level coverage for Aliso Viejo / San Clemente / Mission Viejo
(idea-2026-10-13-01).

---

## 2026-10-12 update — 36-query sweep (DuckDuckGo Lite conventional proxy)

36 queries across 7 core services and 12 cities/counties (Tier 1–3), weighted to
commercially valuable, historically weak, and not-recently-tested queries. Raw
rows in `data/competitor_observations.jsonl`; per-query result sets in
`data/ai_visibility_history.jsonl`. **Straight Flush was absent from all 36**
(0 recommended / 0 mentioned / 0 cited). Frequency = number of the 36 queries in
which the domain appeared in the top-10 organic results (counted from
`ai_visibility_history.jsonl`, not estimated). All findings are
*observations of presence* — an observed feature is evidence a competitor has it,
**not** proof it caused any ranking or recommendation.

### Tier A — appeared for 5+ of 36 queries

| Competitor | Domain | # queries | Observed feature | Claim status |
|---|---|---|---|---|
| ProPlumber Laguna Niguel | proplumberlagunaniguel.com | 8 | Exact-match city domain; dedicated leak-detection / slab-leak / water-heater pages | feature **verified**; cause = hypothesis |
| Evans Leak Detection | evansleakdetection.com | 8 | Dedicated slab-leak detection pages | feature **verified** (repeat) |
| Roto-Rooter | rotorooter.com | 7 | National franchise, per-city location pages | feature **verified** |
| Scott English Plumbing | scottenglishplumbing.net | 6 | Per-city `/service-area/plumber-in-{city}` pages | feature **verified** (repeat) |
| American Leak Detection | americanleakdetection.com | 6 | National leak-detection franchise (ALDI); county + per-city pages | feature **verified** |
| Olson Superior | olsonsuperior.com | 5 | Per-city emergency-plumber pages | feature **verified** (repeat) |
| Coast Plumbing | coastplumbing.com | 5 | Per-city `/areas-we-serve/{city}/` pages + FAQPage schema | feature **verified**; **new repeat competitor** |
| Laguna Niguel CA Plumbing Pros | lagunaniguelcaplumbingpros.com | 5 | Exact-match city domain; slab-leak + leak-detection pages | feature **verified**; **new** |
| Primewest Plumbing | primewestplumbing.com | 5 | Per-city service URLs (`/plumbing/{city}/slab-leak-repair`, `…/leak-detection`) | feature **verified**; **new repeat competitor** |
| Pristine Plumbing | pristineplumbinginc.com | 5 | Leak-detection pages | feature **verified** (repeat) |
| Mr. Rooter | mrrooter.com | 5 | National franchise, per-city pages | feature **verified** |
| Barker and Sons | barkerandsonsplumbing.com | 5 | `/city/{city}-ca-plumber/` city pages; long-established OC brand | feature **verified** (repeat) |

### Tier B — appeared for 3–4 of 36 queries

leakstar.com (4), leak-detection-pro.com (4, verified `/location/{city}-ca.html` + FAQPage),
calischoice.com (4), plumbingsolutionspecialist.com (4), dialonesonshine.com (4),
repipesoc.com (3), ocrepipes.com (3, repipe specialist; site 403 to our fetch),
drains4less.com (3), aslplumbing.com (3), splashplumbing.com (3),
hummelplumbing.com (3), doitrightplumbers.com (3), delatorresplumbing.com (3),
integrityrepipeinc.com (3), ocproplumbers.com (3), americanleakcompany.com (3).

### New repeat competitors (≥3, not in the 2026-10-11 directory)

primewestplumbing.com (5) · coastplumbing.com (5) · lagunaniguelcaplumbingpros.com (5) ·
leak-detection-pro.com (4) · dialonesonshine.com (4) · drains4less.com (3) ·
aslplumbing.com (3) · splashplumbing.com (3) · hummelplumbing.com (3) ·
doitrightplumbers.com (3) · delatorresplumbing.com (3) · integrityrepipeinc.com (3) ·
ocproplumbers.com (3) · americanleakcompany.com (3).

### Directory/aggregator dominance (visibility channels, not competitors)

yelp.com 32/36 queries · angi.com 12 · yellowpages.com 11 · thumbtack.com 10 ·
todayshomeowner.com 3 · superpages.com 3 · expertise.com 3 · homeguide.com 2.
Yelp again appears in nearly every local query — the "best plumber" queries
remain an aggregator/GBP-reviews problem, not a website-content problem.

---


## 2026-10-11 update — 28-query sweep (Brave conventional proxy)

28 queries across all 7 core services and 11 cities (Tier 1–3). Raw rows in
`data/competitor_observations.jsonl`; per-query result sets in
`data/ai_visibility_history.jsonl`. **Straight Flush was absent from all 28**
(0 recommended / 0 mentioned / 0 cited). Frequency = number of the 28 queries in
which the domain appeared in the top-10 organic results. All findings are
*observations of presence* — an observed feature is evidence a competitor has it,
**not** proof it caused any ranking or recommendation.

### Tier A — appeared for 10+ of 28 queries

| Competitor | Domain | # queries | Observed feature | Claim status |
|---|---|---|---|---|
| Scott English Plumbing | scottenglishplumbing.net | 22 | Per-city `/service-area/plumber-in-{city}` pages | feature **verified** (URLs seen); rank cause = hypothesis |
| Barker and Sons | barkerandsonsplumbing.com | 19 | `/city/{city}-ca-plumber/` city pages; long-established OC brand | feature **verified**; cause = hypothesis |
| Roto-Rooter | rotorooter.com | 15 | National franchise, per-city location pages | feature **verified** |
| Bill Metzger Plumbing | billmetzgerplumbing.com | 13 | Service-area city pages | feature **verified** |
| Efficient Plumbing | efficientplumbing.com | 12 | `/laguna-niguel-plumbers/` city landing + water-leak-detection page | feature **verified** |
| Rooter Hero | rooterhero.com | 11 | Franchise, per-city service pages | feature **verified** |
| All Clear Plumbing Pros | allclearplumbingpros.com | 11 | Slab-leak detection page | feature **verified** |
| Parzival Plumbing | parzivalplumbing.com | 10 | Laguna Niguel service page | feature **verified** |
| Cal's Choice | calischoice.com | 10 | Slab-leak repair location pages | feature **verified** |
| Evans Leak Detection | evansleakdetection.com | 10 | Dedicated slab-leak detection pages per city | feature **verified** |

### Tier B — appeared for 4–9 of 28 queries

pristineplumbinginc.com (9), eyplumbing.com (8), emergencyresponseplumbers.com
(8), olsonsuperior.com (7), lagunaniguelplumber.org (7, exact-match domain),
mckplumb.com (6, `/areas-we-serve/{city}` pages), moffettplumbing.com (5),
proplumberlagunaniguel.com (5, exact-match domain), benjaminfranklinplumbing.com
(5), sosplumbingrooter.com (5), orangecoastplumbing.net (4),
johnstevensonplumbing.com (4), ezplumbingusa.com (4), prostarplumbingca.com (4),
murphyandsonsplumbing.com (4), socalrepipes.com (4), streamlineplumbing.org (4),
leakstar.com (4), americanleakdetection.com (4), clearwaterplumbingoc.com (4),
boothneyandsonsplumbing.com (4), biardandcrockett.com (4).

### New repeat competitors (≥3, not in the 2026-10-09 directory)

integrityrepipe.com (3), dcplumbing.net (3), mikediamondservices.com (3),
thedoneriteplumber.com (3), missionviejoplumbingco.com (3), largeplumbing.com (3).

### Directory/aggregator dominance (visibility channels, not competitors)

yelp.com 27/28 · angi.com 12 · facebook.com 8 · nextdoor.com 6 · thumbtack.com 5 ·
mapquest.com 4 · youtube.com 4 · reddit.com 4 · instagram.com 4 · lagunaniguel.com 2 ·
homeadvisor.com 2 · homeguide.com 2. Yelp appears in nearly every local query —
the "best plumber" queries are dominated by aggregators, a GBP/reviews problem
rather than a website problem.

---

## Baseline Tier A — 2026-10-09 (5-query sample, superseded by the table above)

| Competitor | Domain | Appeared for | Observed feature | Hypothesis (unverified) |
|---|---|---|---|---|
| Scott English Plumbing | scottenglishplumbing.net | general, slab, emergency, leak-detection, water-heater (all cities) | Per-city `/service-area/plumber-in-{city}` pages | Strong city-page + service-page pairing ranks broadly |
| Bill Metzger Plumbing | billmetzgerplumbing.com | general, slab, leak-detection, water-heater, best | Service-area city pages across Tier-1 cities | Broad city-page coverage |
| Cal's Choice Plumbing | calischoice.com | leak-detection, slab, emergency (Laguna Niguel, Dana Point, San Clemente, Mission Viejo, Aliso Viejo) | Slab-leak/leak-detection location pages per city | Dedicated per-city leak pages rank for slab queries |
| Evans Leak Detection | evansleakdetection.com | slab, leak-detection (Laguna Niguel, Dana Point, San Clemente, Aliso Viejo) | Dedicated per-city slab/leak-detection pages | Leak-specialist focus outranks generalists on slab queries |
| Efficient Plumbing | efficientplumbing.com | general, slab, leak-detection | `/laguna-niguel-plumbers/` city landing + water-leak-detection page | Exact "Laguna Niguel Plumbers" title match |
| Barker and Sons | barkerandsonsplumbing.com | general, leak-detection, best | `/city/{city}-ca-plumber/` city pages | Long-established OC brand + city pages |
| Roto-Rooter | rotorooter.com | general, emergency, best, leak-detection, water-heater | Franchise per-city location pages | Brand authority + directory presence |

## Tier B — appeared for one or two queries

| Competitor | Domain | Appeared for | Observed feature |
|---|---|---|---|
| Bill Metzger Plumbing | billmetzgerplumbing.com | general, best | Service-area city pages |
| Parzival Plumbing | parzivalplumbing.com | general, emergency | Laguna Niguel service page |
| Olsons Superior Plumbing | olsonsuperior.com | general | Service-area pages |
| Evans Leak Detection | evansleakdetection.com | slab, leak-detection OC | Dedicated Laguna Niguel slab-leak page |
| American Leak Detection | americanleakdetection.com | leak-detection OC | National leak-detection specialist |
| Leak Star | leakstar.com | slab | Leak-detection specialist |
| All Clear Plumbing Pros | allclearplumbingpros.com | slab | Slab-leak detection page |
| Streamline Plumbing | streamlineplumbing.org | slab | `/city/laguna-niguel/slab-leak-repair` page |
| EZ Plumbing USA | ezplumbingusa.com | slab | Slab-leak detection page |
| Pro Star Plumbing | prostarplumbingca.com | slab | — |
| Rooter Hero | rooterhero.com | slab, emergency | Franchise |
| Mr. Rooter | mrrooter.com | emergency | Franchise |
| Cal's Choice | calischoice.com | slab, emergency | Slab-leak repair location pages |
| Murphy & Sons | murphyandsonsplumbing.com | slab | — |
| Socal Repipes | socalrepipes.com | slab | Repipe specialist |
| E&Y Plumbing | eyplumbing.com | slab | — |
| Pro Plumber Laguna Niguel | proplumberlagunaniguel.com | general, slab | Exact-match local domain |
| Laguna Niguel Plumber (Champions) | lagunaniguelplumberchampions.com | emergency | Exact-match local domain |
| Laguna Niguel Plumber | lagunaniguelplumber.org | slab, emergency | Exact-match local domain |
| Equity Plumbing OC | equityplumbingoc.com | emergency | — |
| Rapid Plumbing | rapidplumbing.net | emergency | — |
| Emergency Response Plumbers | emergencyresponseplumbers.com | emergency | — |
| Service First | callservicefirst.com | leak-detection OC | — |
| Water Intrusion Specialist | waterintrusionspecialist.com | leak-detection OC | — |
| John Christopher Construction | johnchristopherconstruction.com | leak-detection OC | — |
| County Leak Services | countyleakservices.com | leak-detection OC | — |
| Plumber Orange County CA | plumberorangecountyca.com | best | — |
| Laguna Niguel Plumbing Co | lagunaniguelplumbingco.com | best | — |
| John Stevenson Plumbing | johnstevensonplumbing.com | general | — |
| Reliable Rooter | reliablerooter.com | general (Irvine) | Per-city `/service-areas/{city}-plumber/` pages |
| Biard & Crockett | biardandcrockett.com | general (Laguna Hills) | Established OC brand |
| Andrus Plumbing | andrusplumbing.com | general (Laguna Beach) | First observation 2026-10-10 |

## Newly observed 2026-10-10 daily run (13 domains not previously in directory)

First-time observations from six Tier-2 *general* queries (Irvine, Laguna Hills,
Laguna Beach, Ladera Ranch, Rancho Santa Margarita, Lake Forest). Every row is a
**hypothesis** that the entity competes in that city; the only *verified* fact is
that its domain appeared in a Brave organic result for the query on 2026-10-10.
Source: Brave organic results — **not** an AI-answer-engine result.

- **Irvine:** reliablerooter.com, patriotrooter.com, theirvineplumbers.com.
- **Laguna Hills:** biardandcrockett.com, equityplumbingoc.com.
- **Laguna Beach:** andrusplumbing.com, bensonplumbinglagunabeach.com.
- **Ladera Ranch:** hhsplumbing.com.
- **Rancho Santa Margarita:** santamargaritaplumbing.com, partnersplumbingco.com,
  integrityoc.com, ranchoheatingandair.com.
- **Lake Forest:** fourseasonsheatingcooling.com.

**Repeat Tiers refreshed 2026-10-10:** barkerandsonsplumbing.com (5 of 6 queries),
scottenglishplumbing.net (5), rotorooter.com (6), billmetzgerplumbing.com (3),
johnstevensonplumbing.com (3), moffettplumbing.com (2), olsonsuperior.com (2).

**Competitive reality (verified, not an action):** SF did not appear in the top-10
organic domains of any of the six executed queries on 2026-10-10. Note the confounder:
the live domain returns HTTP 403 `cf-mitigated: challenge` to all crawlers
(ISSUE-001), so conventional-search absence is expected while the block persists.

## Directories / aggregators appearing (not competitors, but visibility channels)

yelp.com, angi.com, thumbtack.com, homeguide.com, homeadvisor.com, nextdoor.com,
buildzoom.com, mapquest.com, lagunaniguel.com (city portal), reddit.com, facebook.com.

> These matter for **citation/NAP consistency** and reviews, not for out-ranking.

## Gap analysis (evidence-backed)

1. **City × service page pairing.** Tier A competitors pair a *city* page with a
   *specific service* page (e.g. Scott English `/service-area/plumber-in-laguna-niguel`,
   Efficient `/laguna-niguel-plumbers/` + water-leak-detection). Straight Flush has
   strong city pages and strong service pages but few *city+service* combinations
   beyond 4 Laguna Niguel case studies.
2. **Slab-leak specialist pages for each Tier-1 city.** Evans, Streamline, Cal's
   Choice, EZ Plumbing all surface a dedicated slab-leak page per city. SF has one
   `/services/slab-leak-detection.html` and a `/south-oc-slab-leak-specialist.html`.
3. **Exact-match local domains rank** (proplumberlagunaniguel.com,
   lagunaniguelplumber.org). Cannot be replicated; noted as a competitive reality,
   not an action.
4. **Directory/aggregator dominance** for "best" queries (Yelp, Angi, Thumbtack).
   This is a **GBP + reviews** problem, not only a website problem.

**Not measurable today:** whether any competitor is *recommended by an AI answer
engine* — no AI-platform access in this environment (see `AI_VISIBILITY_METHODOLOGY.md`).

## Newly observed 2026-10-09 daily run (54 domains, not previously in directory)

First-time observations from the four Tier-1 *general* queries and the
city×service leak/slab/water-heater queries. Every row below is a **hypothesis**
that the entity competes in that city; the only *verified* fact is that its domain
appeared in a Brave organic result for the query on 2026-10-09. Raw rows:
`data/competitor_observations.jsonl`. Source: Brave organic results — **not** an
AI-answer-engine result.

- **General plumbing (Tier-1 cities):** mckplumb.com, jeffshafferplumbing.com,
  bestplumberindanapoint.com, joetheplumberoc.com, plumbing-serve.com,
  graham-plumbing.com, moderncultureplumbing.com, dansplumbingandsewer.com,
  protechplumbingrepair.com, dcplumbing.net (Dana Point); thepassionateplumber.com,
  aw-sons.com, lomonacocoast.com, benjaminfranklinplumbing.com, drakewillsplumbing.net,
  splashplumbing.com (San Clemente); missionviejoplumbingco.com, thedoneriteplumber.com,
  largeplumbing.com, boothneyandsonsplumbing.com, swellplumbing.com, mikediamondservices.com,
  moffettplumbing.com (Mission Viejo); sosplumbingrooter.com, alisoviejoplumbingprosca.com,
  ocplumbingandrestoration.com, plumberinalisoviejo247.com (Aliso Viejo).
- **Leak detection:** pristineplumbinginc.com, jetresto.com,
  laguna-niguel.los-angeles-plumbers.com (Laguna Niguel); xpressleakdetection.com,
  missionplumbingandrooter.com (Mission Viejo); proplumberalisoviejo.com,
  aliso-viejo-ca.caleak.com, alisoviejoplumbing.net, pacificstarplumbinginc.com (Aliso Viejo).
- **Slab leak:** pacificcoastcopperrepipe.com, integrityrepipe.com,
  aboveandbeyond-plumbing.com, plumbingsolutionspecialist.com (Laguna Niguel);
  allstarplumbingservice.com, leakdetectionplumbers.com, deltaplumbingoc.com (Dana Point);
  theleaklocators.com, clearwaterplumbingoc.com, repipesoc.com, atozleakdetection.com
  (San Clemente).
- **Water heaters:** usawaterheaters.us, aterheatermaninc.com, powerproplumbing.com,
  plumbinganaheimca.net, jnbplumbing.com (Laguna Niguel).

**Notable pattern (hypothesis, medium confidence):** two multi-city programmed
directories — `los-angeles-plumbers.com` and `anytimeplumbingaustin.com` /
`powellplumbing.net` — publish per-*city* subdomains (e.g.
`laguna-niguel.los-angeles-plumbers.com`, `laguna-niguel-ca.anytimeplumbingaustin.com`).
They surface for local intent despite being non-local. This is a directory/programmatic
pattern, not a single competitor; treat as a visibility channel to monitor, not a
company to out-content.

## Next investigation queue

For each Tier A competitor, when crawlers can reach us (post-Cloudflare fix):
fetch homepage, one city page, one service page; extract title/meta/H1 patterns,
service list, schema types, FAQ presence, review display, and CTA; record in
`data/competitor_observations.jsonl`. Do not scrape private data or impersonate.
