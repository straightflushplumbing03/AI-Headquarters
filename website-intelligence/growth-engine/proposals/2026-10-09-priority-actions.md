# Proposals — Owner Approval Required

Created 2026-10-09. Each item states what is asked, why, the approval level, and
what the automation may do once approved. Nothing here has been executed.

---

## P-001 — Lift the Cloudflare crawler block  [LEVEL 3 · URGENT]

**Ask:** Owner applies Cloudflare settings (dashboard) per `CLOUDFLARE-SETUP.md`:

1. Security → Settings → **Security Level: Medium** (not "I'm Under Attack").
2. **Bot Fight Mode: OFF** (or WAF skip rule for verified bots).
3. WAF → Custom rules → `allow-verified-crawlers` = `(cf.client.bot)`,
   action Skip → All remaining custom rules.
4. Scrape Shield → **Email Address Obfuscation: OFF**; Speed → **Rocket Loader: OFF**.

**Why:** Live domain returns 403 to every crawler and AI bot. No organic,
Maps, or AI-search visibility is possible until fixed. This is worth more than
any content work.

**Why not autonomous:** hosting/DNS/security configuration is Level 3 and the
domain is not managed from the repo.

**Verification after fix:**
`curl -sI https://straightflushplumbingoc.com/ | grep -i cf-mitigated` → empty;
homepage and `/robots.txt` → 200.

---

## P-006 — Confirm the four `/case-studies/` pages reflect real completed jobs  [LEVEL 2 · INTEGRITY]

**Ask:** Confirm whether each of the four `/case-studies/` pages
(`laguna-niguel-slab-leak-detection-1`/`-6`, `laguna-niguel-leak-detection-5`,
`laguna-niguel-pex-repiping-4`) describes a genuine completed job.

**Why:** `growth-engine/APPROVED_CLAIMS.md` forbids fabricated case studies, and
the pages assert specifics (a "recently completed … (September 2026)" claim, a
customer quote "shared with the homeowner's permission", and a published cost
range "$2,500–$25,000"). The knowledge base cannot corroborate them, and published
price ranges are marked RESTRICTED (owner confirmation required). A false
"completed job" or attributed quote is a real integrity/consumer-trust risk.

**What was done (reversible, least-intrusive):** a single honest disclosure line
was added to each of the four pages —
"*Illustrative example of the kind of work we perform in this area. Individual
results, timelines, and pricing vary by home, and pricing is confirmed only after
on-site diagnosis.*" — and the `case-studies/` index cards were softened from
"Real … based on a completed local job" to "Examples of … work we do in Laguna
Niguel." No case-study specifics were deleted.

**Owner options:** (a) confirm the jobs are real → this PR's note can be removed
and the specifics kept; (b) confirm they are illustrative → remove the fabricated
specifics (quote, dates, price) and keep the disclosure.

**Approval:** Level 2 (content integrity). Disclosure applied; specifics await
confirmation.

---

## P-007 — Apply Cloudflare response security headers (HSTS + CSP + more)  [LEVEL 3 · BLOCKED ON TOKEN]

**Ask:** Provide a Cloudflare API token with `Zone:Zone:Read` +
`Zone:Transform Rules:Edit`, then approve running
`python3 scripts/cloudflare_add_security_headers.py --apply`. Alternatively apply
the same values by hand in Cloudflare → Rules → Transform Rules → Modify Response
Header.

**Why:** GitHub Pages ignores the repo's `_headers` file, so the live site sends
no HSTS, CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, or `Cross-Origin-*` headers (ISSUE-007).

**Why not autonomous:** hosting/security configuration is Level 3 and requires a
token that is not present in this environment (the script is otherwise ready and
runs read-only by default).

**Verification after apply:**
`curl -sI https://straightflushplumbingoc.com/ | grep -iE 'strict-transport|content-security'`.

---

## P-002 — Connect measurement integrations  [LEVEL 3 · HIGH]

**Status (2026-10-13):** open — no measurement credentials present. Intended
OpenHands Cloud secret names (add via Settings → Secrets, then re-run the daily job):
- `GOOGLE_SEARCH_CONSOLE_CREDENTIALS` (service-account JSON) + property
  `sc-domain:straightflushplumbingoc.com`
- `GA4_PROPERTY_ID` + `GOOGLE_ANALYTICS_CREDENTIALS`
- `GOOGLE_BUSINESS_PROFILE_CREDENTIALS`
- `PERPLEXITY_API_KEY` (optional but the cheapest real AI-answer signal)

**Ask:** Provide access (or exports) for:
- **Google Search Console** (property verified for the domain).
- **Google Analytics 4** (if present).
- **Google Business Profile** performance.
- Optionally a **Perplexity API key** for real AI-answer visibility in-automation.

**Why:** Without these, organic/indexing/local-pack performance cannot be
measured, and the growth loop cannot verify its own changes. Every daily run
currently records these as `unverified` (never as zero).

---

## P-003 — Verify reputation & credential facts  [LEVEL 3 · MEDIUM]

**Ask:** Confirm:
- CSLB license number + classification (to publish/schema).
- Insurance/bond details.
- Whether the published street address should be public or presented as a
  service-area business (affects GBP + schema).
- Whether all 21 published cities are actively serviced.
- Warranty terms if any.

**Why:** These gate trust signals and prevent unverified claims. `APPROVED_CLAIMS.md`
lists them as restricted until confirmed.

---

## P-004 — Consolidate automations to the A–E schedule  [LEVEL 2 · MEDIUM]

**Ask:** Approve replacing the current overlapping automations
(Scout 05:30, Strategist 06:30, Sentinel retries) with the master schedule:

- **A** Morning AI Search & Competitor Intelligence — 06:00 PT daily
- **B** Daily Technical Health Check — 06:20 PT daily
- **C** Controlled Website Improvement — 07:00 PT weekdays
- **D** Weekly Strategy Review — 07:30 PT Mondays
- **E** Monthly Growth Audit — 08:00 PT on the 1st

**Why:** Removes duplicate coverage, reduces token cost, prevents conflicting
edits. Keeps the useful parts (Scout's competitor deep-dive, Strategist's gap
engine) inside A/D.

---

## P-005 — Notification channel  [LEVEL 3 · MEDIUM]

**Status (2026-10-13):** open — no channel configured; Slack MCP not enabled.

**Ask:** Provide an owner-approved notification target (email address or Slack
channel/webhook) for urgent alerts (downtime, site-wide noindex, business-info
errors).

**Why:** `INTEGRATION_STATUS.md` shows no channel configured; urgent issues
currently cannot be pushed to the owner. Until then the daily report and PR are
the only channel, and a critical issue found at 06:00 PT may not be seen for hours.
