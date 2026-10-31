"""Runtime configuration. Secrets come only from the environment and never leave the server."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("HQ_DATABASE_URL", "sqlite:///./hq.db"))
    # Owner token protects every mutating endpoint. If unset, a random one is generated per process
    # and printed once at startup, so a fresh install is never left open.
    owner_token: str = field(default_factory=lambda: os.environ.get("HQ_OWNER_TOKEN") or secrets.token_urlsafe(24))
    owner_token_generated: bool = field(default_factory=lambda: not os.environ.get("HQ_OWNER_TOKEN"))

    # Model provider: simulated | anthropic | openai (any OpenAI-compatible endpoint)
    llm_provider: str = field(default_factory=lambda: os.environ.get("HQ_LLM_PROVIDER", "simulated"))
    llm_model: str = field(default_factory=lambda: os.environ.get("HQ_LLM_MODEL", ""))
    anthropic_api_key: str = field(default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY", ""))
    openai_api_key: str = field(default_factory=lambda: os.environ.get("OPENAI_API_KEY", ""))
    openai_base_url: str = field(default_factory=lambda: os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"))
    llm_timeout_s: float = field(default_factory=lambda: _float("HQ_LLM_TIMEOUT_S", 60.0))
    # Seconds the simulated provider waits per call, so the office visibly works during demos. 0 in tests.
    simulated_latency_s: float = field(default_factory=lambda: _float("HQ_SIMULATED_LATENCY_S", 0.0))

    # Worker
    run_worker: bool = field(default_factory=lambda: os.environ.get("HQ_RUN_WORKER", "1") == "1")
    tick_seconds: float = field(default_factory=lambda: _float("HQ_TICK_SECONDS", 2.0))

    # Static frontend build to serve at "/"
    web_dist: str = field(default_factory=lambda: os.environ.get(
        "HQ_WEB_DIST", os.path.join(os.path.dirname(__file__), "..", "..", "web", "dist")))


# Defaults for owner-editable limits (stored in the settings table, editable from the control center).
DEFAULT_LIMITS = {
    "max_depth": 3,                 # how many hops of agent -> agent follow-ups an objective may chain
    "max_tasks_per_objective": 20,  # hard cap on tasks one objective can spawn
    "max_follow_ups_per_task": 3,   # an agent may create at most this many follow-ups from one task
    "review_rounds": 1,             # peer-review passes per objective
    "correction_rounds": 1,         # correction passes per objective
    "daily_task_limit": 200,        # tasks the worker may start per UTC day
    "daily_token_limit": 2_000_000, # LLM tokens per UTC day across all agents
    "daily_cost_limit_usd": 10.0,   # estimated LLM spend per UTC day
    "max_attempts": 3,              # 1 try + 2 retries on transient failures
    "max_concurrent_tasks": 3,
}

# USD per million tokens (input, output). Owner can edit in settings. Used for cost estimates only.
DEFAULT_PRICING = {
    "simulated": [0.0, 0.0],
    "anthropic": [3.0, 15.0],
    "openai": [2.5, 10.0],
}

settings = Settings()
