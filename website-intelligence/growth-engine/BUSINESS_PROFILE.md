# Business Profile — Straight Flush Plumbing & Leak Detection

**Purpose:** Single source of truth for verified business facts used by every
growth-engine automation and any content/code change. If a fact here conflicts
with the live website, the discrepancy is flagged in `KNOWN_ISSUES.md` — do not
silently pick a value.

**Structure:** field · value · source · verified date · confidence

**Verification method:** Values marked `site JSON-LD` / `site page` / `llms.txt`
were read directly from files in this repository on 2026-10-09. Anything that
requires owner confirmation is marked **UNVERIFIED — owner input required**.

---

## Identity

| Field | Value | Source | Verified | Confidence |
|---|---|---|---|---|
| Legal / brand name | Straight Flush Plumbing & Leak Detection | `index.html` JSON-LD `Plumber.name`; `llms.txt` | 2026-10-09 | high |
| Slogan | Always A Safe Bet | `index.html` JSON-LD `slogan`; `llms.txt` | 2026-10-09 | high |
| Canonical website | https://straightflushplumbingoc.com/ | `CNAME`; `sitemap.xml`; `index.html` JSON-LD `url` | 2026-10-09 | high |
| Phone | (949) 374-6524 / `+1-949-374-6524` | `index.html` JSON-LD `telephone`; site-wide footer | 2026-10-09 | high |
| Email | straightflushplumbing03@gmail.com | `index.html` JSON-LD `email`; `llms.txt` | 2026-10-09 | high |
| Founded | 2019 | `index.html` JSON-LD `foundingDate`; `llms.txt` | 2026-10-09 | high |
| Owner / lead technician | Lance (owner-operator; answers the phone directly) | `index.html` JSON-LD `founder`; `llms.txt` | 2026-10-09 | high |
| Business model | Owner-operated residential plumbing | `llms.txt`; About page | 2026-10-09 | high |

## Location / NAP

| Field | Value | Source | Verified | Confidence |
|---|---|---|---|---|
| Street address | 78 Cameray Heights, Laguna Niguel, CA 92677, US | `index.html` JSON-LD `address`; site-wide footer | 2026-10-09 | high (as published) |
| Published as | Address, not marked as a service-area business | `index.html` JSON-LD (no `serviceArea` type flag) | 2026-10-09 | medium |
| Google Maps link | https://share.google/WcJBYE3uu5FsppBTR | `index.html` JSON-LD `sameAs` | 2026-10-09 | medium |
| Yelp | https://www.yelp.com/biz/straight-flush-plumbing-and-leak-detection-laguna-niguel-3 | `index.html` JSON-LD `sameAs` | 2026-10-09 | medium |

> Note: phone, email and address are **consistent across the repo** as of
> 2026-10-09 (footer appears on every page). Any future NAP edit is Level 3
> (approval required).

## Hours

| Field | Value | Source | Verified | Confidence |
|---|---|---|---|---|
| Mon–Fri | 08:00–19:00 | `index.html` JSON-LD `openingHoursSpecification` | 2026-10-09 | high |
| Saturday | 09:00–18:00 | `index.html` JSON-LD `openingHoursSpecification` | 2026-10-09 | high |
| Sunday | Closed; 24/7 for emergency calls | `index.html` JSON-LD `description`; `llms.txt` | 2026-10-09 | high |

## Credentials

| Field | Value | Source | Verified | Confidence |
|---|---|---|---|---|
| "Licensed & Fully Insured" claim | Present as a trust badge on `index.html` | `index.html` | 2026-10-09 | high (claim published) |
| License number | Not found on the site | grep of repo, 2026-10-09 | 2026-10-09 | **none — owner input required** |
| Bond / insurance details | Not found on the site | grep of repo, 2026-10-09 | 2026-10-09 | **none — owner input required** |

> Do **not** add a CSLB license number or insurance carrier to schema or copy
> until the owner supplies and verifies it. Publishing an unverified license
> number is a Level 3, legally-sensitive change.

## Reputation (as published on-site)

| Field | Value | Source | Verified | Confidence |
|---|---|---|---|---|
| Google rating | 5.0 / 5 | `llms.txt` | 2026-10-09 | **medium — on-site claim, not independently verified** |
| Yelp rating | 4.8 / 5, 74+ reviews | `index.html` JSON-LD `aggregateRating`; `llms.txt` | 2026-10-09 | **medium — self-reported** |
| Reviews markup | `aggregateRating` + `review` present on `index.html` | `index.html` JSON-LD | 2026-10-09 | high |

> Self-reported review counts must be kept in sync with the actual profiles.
> Google's structured-data policy discourages self-serving `aggregateRating`
> on `LocalBusiness` when the ratings are not independently verifiable. Flagged
> in `KNOWN_ISSUES.md` — verify against the live profiles before changing.

## Areas served (published, 21 cities)

Source: `index.html` JSON-LD `areaServed` and `service-areas.html`, verified 2026-10-09.
This list is **published**; whether every city is actively serviced day-to-day is
**owner-confirmable** (see `SERVICE_AREAS.md`).

Laguna Niguel (HQ), Dana Point, San Clemente, Mission Viejo, Laguna Hills,
Aliso Viejo, Ladera Ranch, Rancho Santa Margarita, Coto de Caza, Dove Canyon,
Lake Forest, Foothill Ranch, Irvine, Newport Beach, Laguna Beach, Laguna Woods,
San Juan Capistrano, Costa Mesa, Huntington Beach, Tustin, Orange.

---

## Verification debt (owner input required)

1. CSLB license number and classification.
2. Insurance / bonding details (general liability, workers' comp).
3. Confirmation the published street address should be presented publicly vs.
   as a service-area business (affects GBP + schema).
4. Confirmation of the 21-city list as *actively* served.
5. Confirmation of whether "24/7 emergency" means live dispatch or call-back.
6. Warranty terms (if any) the owner is willing to publish.
