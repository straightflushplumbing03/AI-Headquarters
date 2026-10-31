"""Model providers. Credentials stay on the server; the provider is chosen by config, not hard-coded.

simulated  - deterministic offline stand-in. Every output is labeled SIMULATED and stored with simulated=True.
anthropic  - Anthropic Messages API (ANTHROPIC_API_KEY).
openai     - any OpenAI-compatible Chat Completions endpoint (OPENAI_API_KEY, OPENAI_BASE_URL): OpenAI,
             Vercel AI Gateway, OpenRouter, a local model server, etc.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

import httpx


class LLMError(Exception):
    def __init__(self, message: str, transient: bool = True):
        super().__init__(message)
        self.transient = transient


@dataclass
class LLMResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    provider: str = ""
    model: str = ""
    simulated: bool = False
    raw: dict = field(default_factory=dict)


class Provider:
    name = "base"
    simulated = False

    def __init__(self, model: str = ""):
        self.model = model

    def complete(self, system: str, prompt: str, meta: dict, model: str | None = None) -> LLMResult:
        raise NotImplementedError


def _transient_status(code: int) -> bool:
    return code == 429 or code >= 500


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "", timeout: float = 60.0, transport: httpx.BaseTransport | None = None):
        super().__init__(model or "claude-sonnet-4-5")
        if not api_key:
            raise LLMError("ANTHROPIC_API_KEY is not set", transient=False)
        self._client = httpx.Client(base_url="https://api.anthropic.com", timeout=timeout, transport=transport,
                                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"})

    def complete(self, system, prompt, meta, model=None):
        body = {"model": model or self.model, "max_tokens": 1500, "system": system,
                "messages": [{"role": "user", "content": prompt}]}
        try:
            r = self._client.post("/v1/messages", json=body)
        except httpx.HTTPError as e:
            raise LLMError(f"network error: {e}") from e
        if r.status_code != 200:
            raise LLMError(f"anthropic HTTP {r.status_code}: {r.text[:300]}", transient=_transient_status(r.status_code))
        j = r.json()
        text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
        u = j.get("usage", {})
        return LLMResult(text, u.get("input_tokens", 0), u.get("output_tokens", 0), self.name, body["model"])


class OpenAICompatibleProvider(Provider):
    name = "openai"

    def __init__(self, api_key: str, base_url: str, model: str = "", timeout: float = 60.0,
                 transport: httpx.BaseTransport | None = None):
        super().__init__(model or "gpt-4o")
        if not api_key:
            raise LLMError("OPENAI_API_KEY is not set", transient=False)
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport,
                                    headers={"Authorization": f"Bearer {api_key}"})

    def complete(self, system, prompt, meta, model=None):
        body = {"model": model or self.model, "max_tokens": 1500,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
        try:
            r = self._client.post("/chat/completions", json=body)
        except httpx.HTTPError as e:
            raise LLMError(f"network error: {e}") from e
        if r.status_code != 200:
            raise LLMError(f"openai-compatible HTTP {r.status_code}: {r.text[:300]}", transient=_transient_status(r.status_code))
        j = r.json()
        text = j["choices"][0]["message"]["content"] or ""
        u = j.get("usage", {})
        return LLMResult(text, u.get("prompt_tokens", 0), u.get("completion_tokens", 0), self.name, body["model"])


# ---------------------------------------------------------------------------------------------------------------
# Simulated provider: lets the whole system run end to end with no credentials. Its output is honest about being
# simulated and never contains invented facts, numbers or competitor details.

KEYWORDS = {
    "seo": ["seo", "google", "rank", "search", "local", "listing", "index", "website", "page", "visibility"],
    "competitor": ["competitor", "competition", "compete", "rival", "other plumb", "market"],
    "marketing": ["content", "article", "blog", "social", "campaign", "marketing", "conversion", "post"],
    "customer": ["customer", "inquiry", "estimate", "invoice", "follow-up", "follow up", "reply", "review request"],
    "technical": ["pex", "copper", "propress", "code", "valve", "water heater", "equipment", "tool", "spec", "technical"],
    "growth": ["revenue", "growth", "opportunit", "profit", "partner", "new service", "expand", "underserved"],
}


class SimulatedProvider(Provider):
    name = "simulated"
    simulated = True

    def __init__(self, model: str = "", latency_s: float = 0.0):
        super().__init__(model or "simulated-v1")
        self.latency_s = latency_s

    def complete(self, system, prompt, meta, model=None):
        if self.latency_s > 0:
            import time
            time.sleep(self.latency_s)
        kind = meta.get("kind", "manual")
        agent = meta.get("agent_id", "")
        title = meta.get("title", "")
        text_l = (meta.get("objective_title", "") + " " + title + " " + meta.get("description", "")).lower()
        out: dict = {
            "summary": f"[SIMULATED] {agent} processed '{title}'. No model was called and no real research was done; "
                       f"connect a model provider to get real results.",
            "findings": [], "recommendations": [], "fetch_urls": [], "follow_ups": [], "memory": [],
            "approval_request": None, "review_verdict": None,
        }
        if kind == "plan":
            chosen = [a for a, words in KEYWORDS.items() if any(w in text_l for w in words)]
            if not chosen:
                chosen = ["seo", "growth"]
            goal = meta.get("objective_title") or title
            out["follow_ups"] = [{"agent": a, "title": f"{a.upper()} input: {goal[:80]}",
                                  "description": f"Contribute the {a} perspective on: {goal}"} for a in chosen[:4]]
            out["summary"] = f"[SIMULATED] Plan: split objective into {len(out['follow_ups'])} tasks."
        elif kind == "review":
            first = meta.get("review_round", 1) == 1 and meta.get("correction_rounds_left", 0) > 0
            out["review_verdict"] = {"approved": not first,
                                     "corrections": ["[SIMULATED] Add the evidence source for each finding."] if first else []}
        elif kind == "consolidate":
            out["recommendations"] = ["[SIMULATED] Placeholder recommendation; real content requires a model provider."]
            out["approval_request"] = {"kind": "recommendation", "summary": f"[SIMULATED] Final report for: {title}",
                                       "draft": "[SIMULATED] consolidated report"}
        elif agent == "customer" and kind in ("manual", "draft"):
            out["approval_request"] = {"kind": "customer_message", "summary": f"[SIMULATED] Draft reply: {title}",
                                       "draft": "[SIMULATED] Hi, thanks for reaching out to Straight Flush Plumbing..."}
        elif meta.get("force_follow_up"):
            out["follow_ups"] = [meta["force_follow_up"]]
        out["findings"] = out["findings"] or [f"[SIMULATED] no real {agent} data collected"]
        text = json.dumps(out)
        return LLMResult(text, input_tokens=len(system + prompt) // 4, output_tokens=len(text) // 4,
                         provider=self.name, model=self.model, simulated=True)


def build_provider(name: str, cfg) -> Provider:
    name = (name or "simulated").lower()
    if name == "simulated":
        return SimulatedProvider(cfg.llm_model if cfg.llm_model.startswith("simulated") else "",
                                 getattr(cfg, "simulated_latency_s", 0.0))
    if name == "anthropic":
        return AnthropicProvider(cfg.anthropic_api_key, cfg.llm_model, cfg.llm_timeout_s)
    if name in ("openai", "openai-compatible", "gateway"):
        return OpenAICompatibleProvider(cfg.openai_api_key, cfg.openai_base_url, cfg.llm_model, cfg.llm_timeout_s)
    raise LLMError(f"unknown provider {name!r}", transient=False)


_JSON_BLOCK = re.compile(r"\{.*\}", re.S)


def parse_agent_json(text: str) -> dict:
    """Agents must answer with one JSON object. Tolerate code fences / prose around it; reject anything else."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = _JSON_BLOCK.search(text)
        if not m:
            raise LLMError("model did not return JSON", transient=True)
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            raise LLMError(f"model returned malformed JSON: {e}", transient=True) from e
    if not isinstance(data, dict):
        raise LLMError("model JSON was not an object", transient=True)
    for key, default in (("summary", ""), ("findings", []), ("recommendations", []), ("fetch_urls", []),
                         ("follow_ups", []), ("memory", [])):
        data.setdefault(key, default)
    data.setdefault("approval_request", None)
    data.setdefault("review_verdict", None)
    return data
