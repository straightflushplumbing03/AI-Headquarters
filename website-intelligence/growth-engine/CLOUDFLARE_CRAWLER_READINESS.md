# Cloudflare AI-Crawler Readiness — Audit & Free-Plan Plan

**Site:** https://straightflushplumbingoc.com · **Repo:** `straightflushplumbing03/-Up2datewebsiteseo`
**Audit date:** 2026-10-09 · **Plan:** Cloudflare **Free** (no Pro/Business/Enterprise, no paid Markdown conversion)

---

## ✅ RESOLVED 2026-10-11 — root cause: Under Attack mode

**Root cause (confirmed via Cloudflare API):** zone `straightflushplumbingoc.com`
(id `0e9dba51558951ac91fadb2c0e28abde`) had **Under Attack mode ON** —
`security_level = "under_attack"`, set `2026-09-20T20:04:22Z`. Under Attack mode
issues a Managed Challenge (`cf-mitigated: challenge`, HTTP 403) to every
request, and crawlers do not run the JavaScript challenge, so all of them were
blocked. Bot Fight Mode was **off**; it was not a factor.

**Fix applied (narrowest, reversible):**
`PATCH /zones/{id}/settings/security_level` → `{"value": "medium"}` at
`2026-10-11T07:27:51Z`. Nothing else was changed — Bot Fight Mode, WAF, and all
other settings left as-is. Reverting is one API call back to `under_attack`.

**Verification (2026-10-11T07:28:05Z):** Googlebot, Bingbot, GPTBot,
OAI-SearchBot, ClaudeBot, PerplexityBot, Applebot and curl all returned
**HTTP 200 with no `cf-mitigated` header** on `/`; `/robots.txt`, `/sitemap.xml`,
`/llms.txt`, `/services/leak-detection.html` all **200**.

**Still outstanding after the fix:** the AI-readable files (`/llms-full.txt`,
`/md/**`) return **404** because this PR is not merged yet. Merge to publish them.

---

## Phase 1 — Audit findings

### Deployment path (confirmed)
- Static HTML on **GitHub Pages**, custom domain via `CNAME` (`straightflushplumbingoc.com`).
- Pages API: `status: built`, source branch `main`, path `/`, `https_enforced: true`, cert approved (expires 2026-11-30).
- Origin `https://straightflushplumbing03.github.io/-Up2datewebsiteseo/` → **301** to the custom domain (so the custom domain is the only host).

### The 403 `cf-mitigated: challenge` (confirmed, critical)
Tested 2026-10-09 with seven crawler User-Agents (Googlebot, Bingbot, GPTBot,
OAI-SearchBot, ClaudeBot, PerplexityBot, Applebot) and plain curl:
- `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/index.html`,
  `/services/leak-detection.html`, `/cities/laguna-niguel.html` → **HTTP/2 403**
  with response header `cf-mitigated: challenge`, `server: cloudflare`.
- **Classification:** this is a **Cloudflare edge security challenge**, not an
  origin error, missing file, or redirect. The origin files exist and are valid
  in the repo; GitHub Pages is healthy. The edge is intercepting the request
  before the origin.
- **Root cause (per official docs):** a **Managed Challenge** is issued when the
  zone is in **Under Attack mode**, or by **Bot Fight Mode** / bot-management
  rules, or by Security Level set high. Crawlers do not run the JavaScript
  challenge, so they receive 403.

### Confirmed vs. requires-account-access
- **Confirmed without account access:** every crawler is challenged on every
  path; the block is at the Cloudflare edge; the repo content is correct.
- **Requires Cloudflare account/API access to confirm:** the exact setting
  (Under Attack toggle vs. Bot Fight Mode vs. a WAF rule), and Security Events
  history. No Cloudflare **API** credential is available in this environment
  (see "Credential note" below), so these could not be inspected.

### Not a repo-fixable problem
`robots.txt` **cannot** override a Cloudflare security challenge. No repository
change can restore crawler access while the challenge is active.

---

## Phase 4 — Cloudflare security (Free-plan-safe fix)

> Applied in the **Cloudflare dashboard** (or via a properly-scoped Cloudflare
> **API token**). Not a repo change. **Level 3 — owner action / explicit approval.**

### 4a. Remove the Managed Challenge
1. **Security → Settings → Under Attack mode: OFF.** Per Cloudflare, Under
   Attack mode presents a Managed Challenge page and should only be used during
   an active L7 DDoS attack.
2. **Security Level: set to a normal level (Medium).** (In the current
   dashboard, "Security Level" is what turns Under Attack mode on/off.)
3. **Bot Fight Mode: OFF** — its challenge interstitial blocks AI crawlers that
   do not run JavaScript (GPTBot, ClaudeBot, PerplexityBot), which is exactly
   the traffic this site depends on.

### 4b. Allow verified crawlers (if Bot Fight Mode must stay ON)
**Security → WAF → Custom rules → Create rule**, name `allow-verified-crawlers`:

- Expression: `(cf.client.bot)`
- Action: **Skip** → check **All remaining custom rules** (leave Zone Lockdown /
  IP ACL intact).

`cf.client.bot` is a **rules-language field available on Free plans** (verified
against Cloudflare's field reference — it is *not* marked Enterprise-only), and
it matches Cloudflare's **Verified Bots** list (Googlebot, Bingbot, GPTBot,
ClaudeBot, PerplexityBot, Applebot, etc.).

> ⚠️ **Do not** create a blanket allow rule that trusts a **User-Agent string**
> (`http.user_agent contains "Googlebot"`). That is trivially spoofed. Use
> `cf.client.bot`, which reflects Cloudflare's independent bot verification.

### 4c. Other Free-plan HTML-rewriting features to turn OFF (AEO hygiene)
- **Scrape Shield → Email Address Obfuscation: OFF** — it rewrites emails into
  `data-cfemail` blobs, so AI engines read gibberish.
- **Speed → Optimization → Rocket Loader: OFF** — conflicts with the strict
  `script-src 'self'` CSP.
- **Scrape Shield → Mirage: OFF** — HTML rewriting.

### Credential note (security)
A Cloudflare credential pair was provided in the request. It is shaped like a
**Cloudflare Access service-token** (client id ending `.access` + a `cfast_`
secret), **not** a Cloudflare API token. Per the task's own rule, Access
service-token credentials must **never** be used as API credentials, so they
were **not** used. No `CLOUDFLARE_API_TOKEN` is present in this environment.
Because the pair was shared in plaintext, **rotate/revoke it**. To enable
programmatic inspection, provision a **separately scoped Cloudflare API token**
stored in the runtime secrets manager.

### If it cannot be changed on Free / without access
Documented limitation. The only safe repo-side alternative is already in place:
keep `robots.txt` permissive for AI crawlers and publish the AI-readable files
(this change). Crawler access still requires the dashboard fix.

---

## Dated record of official guidance consulted (2026-10-09)

| Topic | Source | Key point |
|---|---|---|
| Verified bots | https://developers.cloudflare.com/bots/concepts/bot/verified-bots/ | A Verified bot is one Cloudflare has confirmed is transparent about who it is; includes search crawlers and user-driven agents |
| Skip rules (WAF custom rule action) | https://developers.cloudflare.com/waf/custom-rules/skip/ | A rule with the Skip action lets specific requests bypass security features that would otherwise block or challenge them |
| Security Level / Under Attack mode | https://developers.cloudflare.com/waf/tools/security-level/ | Under Attack mode performs extra checks and presents a **Managed Challenge** page; use only during an attack |
| Rules-language fields | https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/ | `cf.client.bot` = "request originated from a known good bot or crawler" (available on Free); `cf.bot_management.*` fields are Enterprise-only |

---

## Verification (run after the dashboard fix)

```bash
# 0. Blocker check: expect 200 200 200 and NO cf-mitigated header
curl -s -o /dev/null -w "%{http_code} " -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" https://straightflushplumbingoc.com/
curl -s -o /dev/null -w "%{http_code} " https://straightflushplumbingoc.com/robots.txt
curl -s -o /dev/null -w "%{http_code}\n" https://straightflushplumbingoc.com/sitemap.xml
curl -sI https://straightflushplumbingoc.com/ | grep -i cf-mitigated   # expect: no output

# AI crawlers get a clean 200
for ua in GPTBot ClaudeBot OAI-SearchBot PerplexityBot; do
  printf "%s " "$ua"; curl -s -o /dev/null -w "%{http_code}\n" -A "$ua" https://straightflushplumbingoc.com/llms.txt
done

# AI-readable files served
curl -s -o /dev/null -w "llms-full.txt %{http_code} %{content_type}\n" https://straightflushplumbingoc.com/llms-full.txt
curl -s -o /dev/null -w "md/leak-detection %{http_code} %{content_type}\n" https://straightflushplumbingoc.com/md/services/leak-detection.md
```
