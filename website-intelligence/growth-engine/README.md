# Growth Engine — Straight Flush Plumbing & Leak Detection

Permanent, version-controlled knowledge base and operating system for the
autonomous AI-visibility / SEO / AEO / competitor-intelligence / website-quality
effort. This directory adapts the master spec's suggested structure to the
existing repository (an established static HTML site) rather than duplicating it.

## Read order for any automation run

1. `BUSINESS_PROFILE.md` — verified company facts (never contradict these)
2. `APPROVED_CLAIMS.md` + `BRAND_VOICE.md` — what may be said and how
3. `SERVICE_CATALOG.md` + `SERVICE_AREAS.md` — what is actually offered/covered
4. `KNOWN_ISSUES.md` — open problems (read ISSUE-001 first)
5. `AI_VISIBILITY_METHODOLOGY.md` + `KEYWORD_UNIVERSE.md` — how to test
6. `INTEGRATION_STATUS.md` — what is connected and what is not
7. `INDUSTRY_WATCH.md` + `INNOVATION_IDEAS.md` — industry findings and idea register
8. `EXPERIMENT_LOG.md` + `data/*.jsonl` — history and prior experiments
9. `reports/` — prior outputs

## Files

| File | Purpose |
|---|---|
| `BUSINESS_PROFILE.md` | Verified identity, NAP, hours, credentials, repute |
| `SERVICE_CATALOG.md` | Verified services + pages; unverified claims flagged |
| `SERVICE_AREAS.md` | 21 published cities; stub caveats |
| `APPROVED_CLAIMS.md` | Allowed / restricted / forbidden claims |
| `BRAND_VOICE.md` | Tone and phrasing rules |
| `COMPETITOR_DIRECTORY.md` | Rolling, evidence-based competitor map |
| `KEYWORD_UNIVERSE.md` | Query library + priority sweep list |
| `AI_VISIBILITY_METHODOLOGY.md` | Reproducible measurement rules + platform access |
| `INTEGRATION_STATUS.md` | Connected / missing integrations |
| `KNOWN_ISSUES.md` | Issue register (severity, evidence, fix, approval) |
| `INDUSTRY_WATCH.md` | Dated industry + official-guidance + diagnostic-tech findings |
| `INNOVATION_IDEAS.md` | Internal idea register (≥5 new/day, evidence-scored) |
| `EXPERIMENT_LOG.md` | Experiment records and outcomes |
| `CHANGELOG.md` | Changes to this knowledge base |
| `data/*.jsonl` | Raw observations (append-only) |
| `citation_engine.py` | AI citation sweep planner, recorder and gap analyzer |
| `reports/` | baseline / daily / weekly / monthly reports |
| `proposals/` | Items needing owner approval |
| `tests/` | Validation helpers |

## Non-negotiables (mirror of the master spec)

- Evidence before changes; separate facts from hypotheses; label confidence.
- Never label a conventional search result as an AI-platform result.
- Missing data ≠ zero visibility. State limitations honestly.
- Never fabricate reviews, licenses, prices, statistics, or case studies.
- Never advertise guaranteed rankings, recommendations, or lead volume.
- Production changes go through branches/PRs; identity/pricing/contact/claims
  changes require explicit owner approval (Level 3).

## Automation schedule (Claude — from 2026-10-20)

Runs moved from OpenHands to **Claude scheduled tasks** on 2026-10-19 (owner
decision; the OpenHands daily reported success while its AI tests failed):

- `SFPL Claude Daily 6 AM` — every day 6 AM America/Los_Angeles → `automations/claude-daily.prompt.md`
- `SFPL Claude Weekly Review` — Mondays 7 AM America/Los_Angeles → `automations/claude-weekly.prompt.md`
- GitHub Action `Weekly site audits` — Mondays: Lighthouse CI + lychee broken links (`.github/workflows/site-audits.yml`)

A run only counts as successful when its commit is confirmed on `origin/main`.
The OpenHands prompts (`intelligence-hq-*.prompt.md`) are kept for history;
**pause the OpenHands automations** so two agents don't write at once.

### AI Citation Engine (`citation_engine.py`)

AI assistants recommend local plumbers by copying from a small set of trusted
sources. The engine records, per query × engine, whether Straight Flush was
recommended and **which URLs the answer relied on**, then ranks every source that
was cited when we lost into an owner/agent action (claim listing, get onto a
listicle, answer a forum thread, out-answer a competitor or lead-gen page).
Data: `data/citation_observations.jsonl` · actions: `data/citation_actions.json`
(owner sets `"status": "done"`) · reports: `reports/citation-gaps/`. Owner's manual
ChatGPT / Google AI / Copilot tests: drop the tracker CSV in `data/manual/`.

## Deployment (verified 2026-10-13)

Static HTML/CSS/JS, **no build step**. Origin is **GitHub Pages** (legacy build
from `main` `/`; `CNAME` = `straightflushplumbingoc.com`), **fronted by Cloudflare**
(DNS + proxy + Transform Rules applying `_headers`, since Pages ignores `_headers`).
A Cloudflare Git build integration also runs on PRs ("Workers Builds"), but there is
no `wrangler`/Workers config in the repo. Production changes go through
branches → PRs; nothing is deployed from this knowledge base.

## Access blockers (owner action — see `proposals/`)

The loop runs fully today but two classes of signal are missing; both are Level 3
and cannot be fixed from the repo:
1. **Measurement** (P-002): Google Search Console, GA4, GBP — so organic/local
   performance is measurable. Until connected, every run records these `unverified`.
2. **Notification** (P-005): no alert channel, so a critical finding is only visible
   in the report/PR.

Also degraded (not owner-fixable): Brave Search returns HTTP 429 and DuckDuckGo HTML
202 to our egress IP; the runs fall through to **DuckDuckGo Lite**, the one
confirmed-working endpoint.
