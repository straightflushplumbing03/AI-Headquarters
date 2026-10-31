import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hq.api import create_app  # noqa: E402
from hq.config import Settings  # noqa: E402
from hq.db import make_sessionmaker  # noqa: E402
from hq.engine import HQ  # noqa: E402
from hq.llm import LLMError, LLMResult, Provider, SimulatedProvider  # noqa: E402
from hq.tools import Tools  # noqa: E402

TOKEN = "test-owner-token"


def reply(**kw) -> str:
    base = {"summary": "ok", "findings": [], "recommendations": [], "fetch_urls": [], "follow_ups": [],
            "memory": [], "approval_request": None, "review_verdict": None}
    base.update(kw)
    return json.dumps(base)


class ScriptedProvider(Provider):
    """Real (non-simulated) provider stand-in: answers from a script keyed by agent id / task kind, records prompts."""
    name = "scripted"

    def __init__(self, script=None, default=None):
        super().__init__("scripted-model")
        self.script = script or {}
        self.default = default or (lambda meta: reply(summary=f"done {meta['title']}"))
        self.prompts: list[tuple[str, str, dict]] = []

    def complete(self, system, prompt, meta, model=None):
        self.prompts.append((system, prompt, meta))
        fn = self.script.get((meta["agent_id"], meta["kind"])) or self.script.get(meta["agent_id"]) or self.default
        out = fn(meta) if callable(fn) else fn
        if isinstance(out, Exception):
            raise out
        return LLMResult(out, 100, 50, "scripted", "scripted-model")


class FlakyProvider(ScriptedProvider):
    def __init__(self, failures: int, transient: bool = True):
        super().__init__()
        self.failures, self.transient, self.calls = failures, transient, 0

    def complete(self, system, prompt, meta, model=None):
        self.calls += 1
        if self.calls <= self.failures:
            raise LLMError("HTTP 503 upstream unavailable", transient=self.transient)
        return super().complete(system, prompt, meta, model)


@pytest.fixture
def make(tmp_path):
    """Build an isolated HQ + API on a fresh database. Returns (hq, client, provider)."""
    def _make(provider: Provider | None = None, db_url: str | None = None, tools: Tools | None = None):
        url = db_url or f"sqlite:///{tmp_path}/hq.db"
        _, Session = make_sessionmaker(url)
        prov = provider or SimulatedProvider()
        hq = HQ(Session, lambda agent, override: prov, tools or Tools(resolve_hosts=False), retry_base_seconds=0)
        cfg = Settings(database_url=url, owner_token=TOKEN, owner_token_generated=False, run_worker=False,
                       web_dist="/nonexistent")
        app = create_app(cfg, hq=hq, start_worker=False)
        return hq, TestClient(app), prov
    return _make


@pytest.fixture
def owner():
    return {"Authorization": f"Bearer {TOKEN}"}
