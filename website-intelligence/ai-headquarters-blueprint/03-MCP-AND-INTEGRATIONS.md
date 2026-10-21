# Straight Flush AI Headquarters — MCP Servers & Integrations

**What this is:** the MCP configuration that makes the master prompt actually useful, plus the
non-MCP integrations that must be wired through secrets. Everything here is free unless marked.

---

## 1. How MCP fits into an OpenHands automation

A **prompt-preset** automation runs inside a sandbox with your configured LLM, your stored
secrets, and your **MCP server integrations**. The prompt itself cannot add an MCP server — the
servers are configured at the account level (and, for repo-scoped tools, by a `.mcp.json` in the
repository). So there are two places to configure:

1. **Account-level MCP** in OpenHands (applies to every conversation and every automation run).
2. **Repo-level `.mcp.json`** committed to a repository (applies when that repo is cloned into
   the sandbox). `AI-Headquarters` already ships one:

```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=lxcrqbrjezsqrowajmsz"
    }
  }
}
```

Keep that file. Add the servers below **in the OpenHands account settings**, not by overwriting it.

---

## 2. MCP servers to enable

### Tier 1 — required for the system to be useful

| MCP server | Why it matters here | Auth |
|---|---|---|
| **GitHub** | The daily run clones, branches, commits, and opens PRs against `AI-Headquarters` and `-Up2datewebsiteseo`. Without it, nothing persists. | `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN` |
| **Supabase** | Reads and writes the AI Authority Engine schema: engines, queries, responses, citations, scores, markets, experiments. Already referenced by `.mcp.json`. | Supabase project access token for `lxcrqbrjezsqrowajmsz` |
| **Web search (Tavily)** | The honest conventional-search proxy and the research tool for platform behaviour. Your growth engine currently scrapes Brave/DuckDuckGo and hits HTTP 429 — a real search API removes that whole class of failure. | `TAVILY_API_KEY` (free tier available) |

Tavily remote MCP endpoint per Tavily's own documentation:

```json
{
  "mcpServers": {
    "tavily": {
      "type": "http",
      "url": "https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}"
    }
  }
}
```

Prefer OAuth where your client supports it so the key is not embedded in a URL.

### Tier 2 — enable when the account access exists

| MCP server | Why | Notes |
|---|---|---|
| **Google Search Console** | Organic impressions, clicks, queries, coverage. The single most valuable measurement unlock. | **No official Google GSC MCP server exists.** Use the official Search Console API (already wired in `lib/authority/integrations.ts`) or a community MCP server, authenticated with a service account. |
| **Google Analytics 4** | GA4 has an official Google-managed MCP server. Add it once the GA4 tag is on the site. | Free |
| **Slack** | Notification channel for the daily report and for critical alerts. Until then the report and PR are the channel. | `SLACK_BOT_TOKEN`; needs `chat.postMessage` |
| **Filesystem / Git (local)** | Only if you want repo-scoped tooling beyond the built-in bash tools. Usually unnecessary — the sandbox already has bash and file editing. | — |

### Tier 3 — deliberately NOT enabled

| Surface | Reason |
|---|---|
| Google Search / Maps / AI Overviews | No authorized programmatic API. The existing `GoogleAiSurfaceAdapter` returns `unsupported` on purpose. Do not add a scraper. |
| ChatGPT consumer UI, Claude web, Copilot UI, Apple Maps, Yelp, Yellow Pages | No authorized automated query interface. Mark `unverified`. |
| Any "rank tracker" that requires scraping Google SERPs | Violates terms and produces unreliable data. Use GSC instead. |

---

## 3. Secrets to register

Register these in OpenHands **Settings → Secrets**. Never paste them into a prompt or a file.

| Secret name | Used by | Required? |
|---|---|---|
| `GITHUB_TOKEN` | GitHub MCP, git clone/push, PR creation | Yes — already present |
| `OPENHANDS_API_KEY` | Automation API (list/update runs), self-inspection | Yes — already present |
| `TAVILY_API_KEY` | Tavily MCP (search + extract) | Strongly recommended |
| `PERPLEXITY_API_KEY` | Perplexity adapter — best real AI-visibility signal | Strongly recommended |
| `OPENAI_API_KEY` | ChatGPT adapter | Optional |
| `GEMINI_API_KEY` | Gemini adapter (returns grounding sources) | Optional |
| `XAI_API_KEY` | Grok adapter | Optional |
| `SUPABASE_SERVICE_ROLE_KEY` | Authority schema writes | Yes, if writing to Supabase |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Search Console API | When GSC is connected |
| `BING_WEBMASTER_API_KEY` | Bing Webmaster Tools API | When Bing is connected |
| `SLACK_BOT_TOKEN` | Daily report notification | Optional |

The adapters read these exact names — see `AI-Headquarters/lib/authority/adapters/index.ts`
(`credentialEnvVar` on each adapter class). Adding a key is what flips an engine from
`unverified` to measurable; no code change is needed.

---

## 4. Model / engine mapping

| Adapter class | Engine key | Endpoint | Citation support |
|---|---|---|---|
| `ChatGptAdapter` | `chatgpt` | `api.openai.com/v1/chat/completions` | Limited |
| `PerplexityAdapter` | `perplexity` | `api.perplexity.ai/chat/completions` | **Native citations** |
| `GeminiAdapter` | `gemini` | `generativelanguage.googleapis.com/v1beta` | Grounding sources |
| `GrokAdapter` | `grok` | `api.x.ai/v1/chat/completions` | Limited |
| `GoogleAiSurfaceAdapter` | `google_ai` | none | Returns `unsupported` by design |

Enable in that order. Perplexity first because it returns citations, which is the strongest
evidence you can get that a source is influencing an answer.

---

## 5. Integrations that are not MCP

These are plain HTTP APIs. `AI-Headquarters/lib/authority/integrations.ts` already implements
token fetching and the two primary callers.

| Integration | Endpoint | Scope / key | Free? |
|---|---|---|---|
| Google Search Console | `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` | `webmasters.readonly` (OAuth 2.0 or service account; no static API key) | Free |
| Google Business Profile | `https://mybusinessbusinessinformation.googleapis.com/v1/...` | Requires an approved GBP API quota (0 until requested) | Free |
| Bing Webmaster Tools | Bing Webmaster API | API key generated in Bing Webmaster Tools, or OAuth 2.0 | Free |
| Slack | `https://slack.com/api/chat.postMessage` | `SLACK_BOT_TOKEN` with `chat:write` | Free |

---

## 6. Verification checklist before the first scheduled run

Run each of these once, by hand, and record the result. Do not assume.

```bash
# 1. Automation API reachable for this org
curl -s -H "Authorization: Bearer ${OPENHANDS_API_KEY}" \
  "https://app.all-hands.dev/api/automation/v1?limit=5" | head -c 400

# 2. GitHub write access
git clone "https://${GITHUB_TOKEN}@github.com/straightflushplumbing03/-Up2datewebsiteseo.git" /tmp/verify-site

# 3. Live site healthy
curl -s -o /dev/null -w "home=%{http_code} robots=%{http_code}\n" https://straightflushplumbingoc.com/
bash /tmp/verify-site/growth-engine/tests/crawler_access_check.sh; echo "crawler_check_exit=$?"

# 4. AI engine keys actually work (one cheap call each, only if the key exists)
[ -n "$PERPLEXITY_API_KEY" ] && curl -s -X POST https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"sonar","messages":[{"role":"user","content":"plumber in Laguna Niguel CA"}]}' \
  | head -c 200
```

Anything that fails is a **BLOCKED** line in the first report — not a silent gap.

---

## 7. What "useful" means here, concretely

Without MCP and integrations, the daily run can only crawl your own site and read your own
repos. That is a website audit, not an intelligence system.

With the Tier 1 set enabled, the same run can: search the live web for how each platform
describes local plumbers; read competitor pages; read platform documentation; store structured
observations; and open a reviewed pull request with the findings. That is the difference
between a report and a system.

The single highest-value action is **one API key**: `PERPLEXITY_API_KEY`. It converts the AI
Authority Engine from "never processed a real AI response" into a working AI-visibility
measurement loop with citations.
