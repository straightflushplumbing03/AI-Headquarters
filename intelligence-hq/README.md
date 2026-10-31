# Straight Flush Plumbing — Intelligence HQ (prototype)

A 3D headquarters for Straight Flush Plumbing & Leak Detection where seven AI agents take real tasks,
hand work to each other, review each other, and bring recommendations to Lance for approval. Every
light, status tag and number in the office comes from the database. Nothing is animated for show.

![Exterior](docs/screenshots/exterior.jpg)

**Status: working prototype, tested, not deployed.** Nothing here touches the live website, the existing
Next.js/Supabase app, customers, or any paid service. It runs on your machine with the **simulated** model
provider until you add an API key.

| | |
|---|---|
| ![Agents working](docs/screenshots/operations-working.jpg) | ![Approvals](docs/screenshots/approvals.jpg) |
| ![Agent desk](docs/screenshots/agent-desk.jpg) | ![Owner controls](docs/screenshots/controls.jpg) |

## Run it

Needs Python 3.11+ and Node 20+.

```bash
cd intelligence-hq
export HQ_OWNER_TOKEN="choose-a-long-random-string"   # your owner password for the control buttons
export HQ_SIMULATED_LATENCY_S=2                       # optional: slows the simulated model so you can watch agents work
./run.sh                                              # builds the 3D front end once, then serves everything
```

Open http://127.0.0.1:8000, click **Owner sign-in** and paste the token. Without the token the office is
read-only. Try **Objectives → Start objective** (e.g. "Get more slab leak calls from Mission Viejo") and
watch Harper plan, the specialists work and review, and the recommendation land in **Approvals**.

Data is stored in `backend/hq.db` (SQLite). For PostgreSQL:
`export HQ_DATABASE_URL=postgresql+psycopg://user:pass@host/dbname` (tables are created on start).

Front-end development with hot reload: run the backend, then `cd web && npm run dev` (proxies to port 8000).

## Connect a real AI model

Keys live only in the server environment. The browser never sees them and the API refuses to accept them.

```bash
# Anthropic
export HQ_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-...  HQ_LLM_MODEL=claude-sonnet-4-5
# or any OpenAI-compatible endpoint (OpenAI, Vercel AI Gateway, OpenRouter, a local model server)
export HQ_LLM_PROVIDER=openai OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.openai.com/v1 HQ_LLM_MODEL=gpt-4o
```

You can also switch provider and model from **Controls → Model provider** (the key must already be in the
environment). Each agent can have its own model via `PATCH /api/agents/{id}` (`model_override`).
Set **Controls → Limits** first: daily tasks, tokens and dollars are capped (defaults: 200 tasks, 2M tokens,
$10 per day). Costs are estimated from real token counts and the editable price table.

With a real model, agents can read public web pages they ask for (`web.fetch`, up to 3 per task, private
and internal addresses blocked) and Nova can audit straightflushplumbingoc.com from its sitemap
(`site.audit`, read-only, approved origins only).

## The workforce

| Agent | Role | Tools | Can hand work to |
|---|---|---|---|
| Harper | Executive Operations Manager | plan objectives, consolidate, delegate | anyone |
| Nova | Local SEO & Google Business | read web pages, site audit, delegate | Paige, Scout, Harper |
| Scout | Competitor Intelligence | read web pages, delegate | Nova, Paige, Harper |
| Paige | Marketing & Content | read web pages, draft content for approval, delegate | Nova, Tess, Harper |
| Cora | Customer Operations | draft customer messages for approval | Harper |
| Tess | Plumbing Technical Research | read web pages, delegate | Paige, Harper |
| Miles | Business Growth & Opportunity | read web pages, delegate | Scout, Nova, Harper |

Each has a system prompt (`backend/hq/agents.py`) with company facts, its role, a personality and hard
rules: never fabricate, only verified services and claims, draft and recommend only. Each also has
persistent memory, a task queue and a full history. Add an agent with `POST /api/agents`; it gets a desk
automatically.

**There is no tool that sends a message, publishes, spends money or changes a website.** Those only exist
as approval requests. Approving a customer message marks it approved; you still send it yourself.

## How the improvement loop works

1. Lance sets an objective. Harper plans it into 2 to 5 tasks for the right specialists.
2. Specialists work. Any of them can create follow-up tasks for agents they're allowed to hand work to
   (shown as a water pulse travelling through the pipes between departments).
3. Each finished task is peer-reviewed (Nova reviews Scout, Paige reviews Nova, and so on).
4. Reviews that find problems send correction tasks back to the original agent.
5. Harper consolidates everything into one recommendation, which goes to **Approvals**.
6. Lance approves or rejects it. Either way it's logged.

Guards, all owner-editable: chain depth 3, 20 tasks per objective, 3 follow-ups per task, 1 review round,
1 correction round, duplicate-task blocking (normalized title per agent and objective), daily task, token
and spend caps, 3 attempts with exponential backoff for transient errors. Every block is written to the
audit log and shows up under **Alerts**.

## What is real and what is simulated

**Genuinely operational (tested):**
- Task queue, background worker, per-agent execution with real status (idle, working, researching,
  reviewing, error, stopped) shown in the office, roster and dashboard
- Agent-to-agent hand-offs and messages, the full objective loop, and approvals
- Permission enforcement (tools, delegation targets, approval kinds, owner-only endpoints)
- Loop, duplicate, follow-up and budget limits; retries; failure handling
- Persistent storage (SQLite and PostgreSQL), agent memory, append-only audit log, usage and cost records
- Live updates over WebSocket; pause, resume, per-agent stop and start, emergency stop
- Anthropic and OpenAI-compatible adapters (tested against mocked HTTP; first live call needs your key)
- Read-only web fetch and site audit tools
- Schedules (weekly site audit, daily report; both off by default) and operating hours

**Simulated until you connect a model:** the content of agent work. The simulated provider moves tasks
through every real step but writes placeholder text that says `[SIMULATED]`. Everything it produces is
stored with `simulated = true` and badged "Simulated" in the UI, and the dashboard warns while it's active.

**Not built yet:** Google Business Profile, Search Console, Analytics, Joist and email integrations; user
accounts (one owner token today); a hosted deployment.

## Tests

```bash
cd backend && python -m pytest            # 48 tests; the PostgreSQL test runs when PG 16 binaries exist
# browser end-to-end against a running server:
HQ_E2E_URL=http://localhost:8000 HQ_E2E_TOKEN=$HQ_OWNER_TOKEN python -m pytest e2e
cd web && npm run typecheck
```

Last run, 2026-10-30: **backend 48/48 passed** (including a full loop and restart on PostgreSQL 16),
**browser end-to-end 6/6 passed**, TypeScript clean. Coverage of the required areas:

| Area | Tests |
|---|---|
| Agent creation | `test_seven_agents_seeded…`, `test_owner_can_add_an_agent…` |
| Assignment, execution, completion | `test_manual_task_assignment_executes_and_completes`, `test_agent_status_reflects_real_execution` |
| Agent-to-agent communication | `test_agent_follow_up_creates_task_and_message…` |
| Failures and retries | `test_transient_failure_retries_then_succeeds`, `test_failure_after_max_attempts…`, `test_non_transient_failure_is_not_retried`, `test_malformed_model_output…` |
| Memory persistence | `test_memory_is_saved_and_fed_into_later_tasks` |
| Database persistence | `test_state_survives_restart`, `test_full_loop_and_restart_on_postgresql` |
| Dashboard updates | `test_dashboard_is_honest_when_empty…`, `test_websocket_streams_live_events`, e2e `test_dashboard_matches_backend` |
| Permission enforcement | `test_owner_endpoints_require_token`, `test_agent_cannot_delegate…`, `test_agent_without_web_fetch…`, `test_site_audit_requires_permission…`, `test_agents_cannot_decide_approvals`, `test_api_keys_cannot_be_set…` |
| Human approval | `test_customer_message_needs_owner_approval_and_is_never_sent`, `test_agent_cannot_request_approval_kinds…`, e2e approval from the UI |
| Improvement loop | `test_full_objective_loop…`, `test_owner_rejection_closes_objective`, `test_consolidation_without_explicit_request…`, `test_simulated_provider_runs_whole_loop…` |
| Duplicate prevention | `test_duplicate_open_tasks_are_blocked`, `test_agents_cannot_ping_pong_the_same_task` |
| Infinite-loop prevention | `test_endless_delegation_chain_is_cut…`, `test_follow_ups_per_task_are_capped`, `test_daily_budget_stops_the_worker` |
| API failure handling | provider adapter tests, `test_network_errors_are_transient`, `test_tool_fetch_failure_is_reported…` |
| Owner controls | pause/resume, emergency stop (incl. discarding in-flight results), stop/start agent, cancel, schedules, costs |

## Design decisions

- **Separate module, same repo.** The existing Next.js/Supabase app in this repo is deployed. This
  prototype lives in `intelligence-hq/` and shares no code or database with it, so it cannot affect
  production. Its rules (deny-by-default tools, owner-only approvals, append-only audit) mirror the
  workforce core in `supabase/migrations/025–027`. See the roadmap for merging the two.
- **A small explicit engine instead of an agent framework.** LangGraph was the strongest candidate,
  but the hard requirements here are enforceable limits, permissions and approvals with an audit trail.
  Those are clearer and easier to test as ~600 lines of plain Python. OpenHands is built for coding agents
  and was not a fit. The engine's provider and tool interfaces make it straightforward to put LangGraph
  behind a single agent later if it earns its place.
- **No Redis yet.** One worker thread and the database as the queue are enough for seven agents. A
  separate queue only makes sense with several worker processes.
- **Expansion.** Agents carry a `building` field and departments are data (`web/src/scene/layout.ts`), so a
  Stock Market Intelligence Center is a new building record, its agents and a layout entry, not a rewrite.

## Roadmap to production

1. Add a real model key, set limits, run one objective and review the output quality with Lance.
2. Turn on the weekly site audit and the daily report schedules.
3. Connect read-only data: Google Search Console, GA4, Google Business Profile (via existing connectors).
4. Replace the single owner token with real sign-in (Supabase Auth, as the main app uses).
5. Point `HQ_DATABASE_URL` at a managed Postgres, and decide whether to merge these tables into the
   existing workforce schema or keep them separate.
6. Deploy behind HTTPS on the reserved subdomain `aiheadquarter.straightflushplumbingoc.com`. Keep it out
   of the main site's Cloudflare cache rule; it is already scoped to the apex domain only.
7. Only then consider write integrations (e.g. drafting into Joist or email), each behind its own approval
   kind.
