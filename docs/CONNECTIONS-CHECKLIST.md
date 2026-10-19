# Real business data — connection checklist

This file lists every external data connection the AI Headquarters platform is
meant to have, its **actual** current state in the code, and the exact
credential or consent only the owner (Lance) can provide.

It is written to be checked, not trusted. Each row names the code that
implements the connection so the claim can be verified with a search.

Last audited: 2026-10-13 against `main` @ `c65463e` plus the
`intelligence-hq/phase-1-4-automation-hardening` branch.

---

## Status legend

| Status | Meaning |
|---|---|
| **Implemented / unconfigured** | Code exists and works once a credential is set. Until then it reports `unconfigured` and syncs nothing. |
| **Not built** | No code path exists. Nothing is collected, estimated, or simulated. |
| **No credential needed** | Internal; reads only, honours robots.txt. |

Nothing in this system fabricates data. An unconfigured source reduces coverage
and is reported as such.

---

## 1. Google Search Console

**Status: implemented / unconfigured.**

- Code: `lib/authority/integrations.ts` (`SearchConsoleIntegration`,
  `fetchSearchAnalytics`), `authority_search_metrics` table, job
  `authority_search_console_sync`, route `GET /api/ai-authority/integrations`.
- What it does: reads query / page / device rows (impressions, clicks, CTR,
  position) for a verified property. Read-only.

**Owner must provide** (set as environment variables — never committed):

| Variable | Where to get it |
|---|---|
| `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth client (Desktop or Web) |
| `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` | Same OAuth client |
| `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN` | From the one-time consent flow below |

Steps only the owner can do:

1. In Google Cloud Console, enable the **Search Console API**.
2. Create an OAuth client ID (type: Desktop app is simplest for a refresh token).
3. Run the consent flow once with the Google account that owns the Search
   Console property, requesting scope
   `https://www.googleapis.com/auth/webmasters.readonly`.
4. Capture the `refresh_token` and set it as `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN`.
5. Set the verified property per organization in
   `authority_integrations.property_or_location` — for example
   `sc-domain:straightflushplumbing.com` (domain property) or
   `https://straightflushplumbing.com/` (URL-prefix property).

The authorization-code exchange is deliberately **not** automated: obtaining a
refresh token requires a human consent screen. Once the token is a secret, the
adapter works with no code change.

---

## 2. Google Business Profile

**Status: implemented / unconfigured.**

- Code: `lib/authority/integrations.ts`
  (`GoogleBusinessProfileIntegration`, `fetchGbpMetrics`),
  `authority_gbp_metrics` table, job `authority_gbp_sync`.
- What it does: reads local performance (impressions, calls, direction
  requests). Read-only. The profile is **never** modified automatically.

**Owner must provide:**

| Variable | Where to get it |
|---|---|
| `GOOGLE_BUSINESS_PROFILE_CLIENT_ID` | Google Cloud Console OAuth client with the Business Profile API enabled |
| `GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET` | Same OAuth client |
| `GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN` | One-time consent flow with scope `https://www.googleapis.com/auth/business.manage` |

Steps:

1. Request access to the **Google Business Profile API** (Google requires a
   short access-request form for this API).
2. Create an OAuth client and run the consent flow with the account that manages
   the Straight Flush Plumbing Business Profile listing.
3. Set the refresh token, then store the location reference in
   `authority_integrations.property_or_location` (the `locations/{id}` form).

---

## 3. Google Analytics 4

**Status: adapter built, awaiting credentials.**

- Code: `lib/authority/integrations.ts` (`GoogleAnalyticsIntegration`,
  `fetchGa4Metrics`), table `authority_ga4_metrics`, job `authority_ga4_sync`
  (monthly), route `GET /api/ai-authority/integrations`.
- Read-only: a single read-only POST to the GA4 Data API `runReport`; no
  configuration is changed. Metrics the property cannot report are stored as
  `NULL`, never zero.
- Nothing is collected or estimated until the owner supplies credentials. The
  integration reports `unconfigured` until then.

**Owner must provide:**

| Variable | Where to get it |
|---|---|
| `GOOGLE_ANALYTICS_CLIENT_ID` | Google Cloud Console OAuth client with the Analytics Data API enabled |
| `GOOGLE_ANALYTICS_CLIENT_SECRET` | Same OAuth client |
| `GOOGLE_ANALYTICS_REFRESH_TOKEN` | One-time consent flow, scope `https://www.googleapis.com/auth/analytics.readonly` |
| GA4 property id | Analytics → Admin → Property settings (a numeric id); store in `authority_integrations.property_or_location` for provider `google_analytics_4` |

---

## 4. Website crawl and sitemap monitoring

**Status: no credential needed — implemented.**

- Code: `lib/authority/crawler.ts`, `lib/authority/technical-seo.ts`, job
  `authority_website_crawl`, route `GET /api/ai-authority/quality`.
- Reads the site, honours `robots.txt`, records page inventory, internal links,
  metadata, structured data, and technical findings.
- Set `AUTHORITY_SITE_ORIGIN` (for example
  `https://straightflushplumbing.com`) or rely on
  `organizations.website`.
- The crawler **never** edits the site. Findings become recommendations that
  require approval.

---

## 5. GitHub — pull requests, deployment status, CI checks

**Status: read-only adapter built, awaiting token.**

- Code: `lib/authority/repository-status.ts` (`RepositoryStatusService`,
  `fetchRepositoryStatus`), route `GET /api/ai-authority/repository-status`.
- READ-ONLY: only GET requests are issued (branches, check-runs, open PRs).
  It cannot open, merge, comment on, or close anything.
- `lib/phase4/github-integration.ts` remains the unrelated change-request
  bookkeeping module and is unchanged.
- Reports `unconfigured` with no token; CI status is never assumed green.

**Owner must provide:**

| Variable | Where to get it |
|---|---|
| `GITHUB_STATUS_TOKEN` (read-only, scoped to the repo) | GitHub → Settings → Developer settings → Fine-grained tokens → Contents / Pull requests / Actions: **read** |
| Repository ref | store `owner/repo` in `authority_integrations.property_or_location` for provider `github_repository` |

`GITHUB_TOKEN` is used as a fallback when `GITHUB_STATUS_TOKEN` is unset.

---

## 6. AI search monitoring surfaces

Not a "business data" source, but listed here because it gates visibility data.

| Surface | Env var | Status |
|---|---|---|
| ChatGPT (OpenAI API) | `OPENAI_API_KEY` | implemented / unconfigured |
| Perplexity | `PERPLEXITY_API_KEY` | implemented / unconfigured |
| Gemini | `GEMINI_API_KEY` | implemented / unconfigured |
| Grok (xAI) | `XAI_API_KEY` | implemented / unconfigured |
| Google AI search surfaces | — | **unsupported by design** — no authorized API; never scraped |

See `lib/authority/adapters/base.ts` for the compliance posture.

---

## What the owner must do, in one list

1. Decide which AI monitoring provider to fund first (Perplexity returns
   citations natively and is the highest-signal single choice).
2. Run the one-time Google consent flow(s) and set the refresh tokens for
   Search Console and Business Profile.
3. Set `CRON_SECRET` in the hosting environment so `/api/jobs/tick` runs.
4. Create a **dedicated Supabase test project** (never production) for the live
   RLS/integration test run described in `docs/ai-authority/VALIDATION.md`.

Everything else proceeds without the owner. The platform reports every missing
connection honestly in `GET /api/ai-authority/integrations`.
