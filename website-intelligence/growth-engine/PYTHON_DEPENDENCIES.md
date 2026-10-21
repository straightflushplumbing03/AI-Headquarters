# Python tooling dependencies

The website itself is static HTML and has **no** runtime dependencies. This
document covers only the Python tooling in `scripts/` and `growth-engine/`.

## Install

```bash
python3 -m pip install -r requirements.txt
```

## What needs what

| Package | Needed by | Notes |
|---|---|---|
| `perplexityai` | `growth-engine/ai_agent_client.py`, `scripts/perplexity_agent.py` | Official Perplexity SDK, required for the Agent API integration. |
| `pytest` | optional | Only to run the new test file with pytest. The suite is stdlib `unittest`, so pytest is **not** required. |

Everything else in `scripts/` and `growth-engine/tests/` uses the standard
library only (`json`, `re`, `urllib`, `html.parser`, `unittest`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PERPLEXITY_API_KEY` | for Agent API calls | Read from the environment. Never passed on the command line, logged, or committed. |
| `TAVILY_API_KEY` | for conventional-search sweeps | Read from the environment. Tavily needs **no** Python package — the client uses stdlib `urllib`. |
| `PERPLEXITY_AGENT_PRESET` | optional | Default preset when no model is pinned (default: `low`). |
| `PERPLEXITY_AGENT_MODEL` | optional | Pin an Agent API model slug instead of using a preset. |

Create a Perplexity key at https://console.perplexity.ai and a Tavily key at
https://app.tavily.com, then export them in your own terminal. Do not paste
either into a chat, an issue, or a repository file.

## Running the tests

```bash
# The Agent API integration suite (no network, no key needed)
python3 -m unittest discover -s growth-engine/tests -p "test_perplexity_agent.py" -v

# The Tavily integration suite (no network, no key needed)
python3 -m unittest discover -s growth-engine/tests -p "test_tavily_search.py" -v

# Both integration suites at once
python3 -m unittest discover -s growth-engine/tests -v

# Existing knowledge-base / site-invariant suite
python3 growth-engine/tests/validate_knowledge_base.py

# SEO audit (stdlib only)
python3 scripts/seo_audit.py

# Live crawler accessibility
bash growth-engine/tests/crawler_access_check.sh
```
