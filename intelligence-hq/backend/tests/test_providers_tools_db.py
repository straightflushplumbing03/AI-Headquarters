"""Provider adapters (no network: httpx MockTransport), tools, and PostgreSQL persistence."""
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time

import httpx
import pytest

from hq.llm import AnthropicProvider, LLMError, OpenAICompatibleProvider, parse_agent_json
from hq.tools import ToolError, Tools


def test_anthropic_adapter_parses_text_and_usage():
    def handler(req: httpx.Request):
        body = json.loads(req.content)
        assert req.headers["x-api-key"] == "k" and body["system"] == "SYS" and body["model"] == "m1"
        return httpx.Response(200, json={"content": [{"type": "text", "text": '{"summary":"hi"}'}],
                                         "usage": {"input_tokens": 11, "output_tokens": 7}})
    p = AnthropicProvider("k", "m1", transport=httpx.MockTransport(handler))
    r = p.complete("SYS", "PROMPT", {})
    assert (r.text, r.input_tokens, r.output_tokens, r.provider, r.simulated) == ('{"summary":"hi"}', 11, 7, "anthropic", False)


def test_openai_compatible_adapter_and_error_classification():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, text="rate limited")
        if calls["n"] == 2:
            return httpx.Response(401, text="bad key")
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"summary":"x"}'}}],
                                         "usage": {"prompt_tokens": 3, "completion_tokens": 2}})
    p = OpenAICompatibleProvider("k", "https://gateway.example/v1", "gpt-x", transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError) as e1:
        p.complete("s", "p", {})
    assert e1.value.transient is True
    with pytest.raises(LLMError) as e2:
        p.complete("s", "p", {})
    assert e2.value.transient is False
    assert p.complete("s", "p", {}).input_tokens == 3


def test_network_errors_are_transient():
    def handler(req):
        raise httpx.ReadTimeout("timed out")
    p = AnthropicProvider("k", transport=httpx.MockTransport(handler))
    with pytest.raises(LLMError) as e:
        p.complete("s", "p", {})
    assert e.value.transient


def test_missing_key_is_a_configuration_error():
    with pytest.raises(LLMError) as e:
        AnthropicProvider("")
    assert not e.value.transient


def test_parse_agent_json_tolerates_fences_and_rejects_prose():
    assert parse_agent_json('```json\n{"summary": "a"}\n```')["summary"] == "a"
    assert parse_agent_json('Here you go: {"summary": "b"} thanks')["follow_ups"] == []
    with pytest.raises(LLMError):
        parse_agent_json("no json at all")


def test_fetch_blocks_private_and_non_http_targets():
    t = Tools()
    for url in ("file:///etc/passwd", "http://127.0.0.1:8000/api/control/emergency-stop", "http://localhost/",
                "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/"):
        with pytest.raises(ToolError):
            t.fetch(url)


def test_site_audit_reports_real_issues_from_sitemap():
    pages = {
        "/sitemap.xml": "<urlset><url><loc>https://site.test/</loc></url><url><loc>https://site.test/b</loc></url>"
                        "<url><loc>https://other.test/x</loc></url></urlset>",
        "/": '<title>Good title</title><meta name="description" content="fine"><h1>One</h1>',
        "/b": "<title>" + "x" * 70 + "</title><h1>a</h1><h1>b</h1>",
    }

    def handler(req):
        body = pages.get(req.url.path)
        return httpx.Response(200 if body else 404, text=body or "nope")
    audit = Tools(transport=httpx.MockTransport(handler), resolve_hosts=False).site_audit("https://site.test")
    assert audit["sitemap_urls"] == 3 and audit["pages_checked"] == 2  # other-origin URL skipped
    issues = {(i["url"], i["issue"]) for i in audit["issues"]}
    assert ("https://site.test/b", "title 70 chars (>60)") in issues
    assert ("https://site.test/b", "missing meta description") in issues
    assert ("https://site.test/b", "2 <h1> tags") in issues
    assert not any(u == "https://site.test/" for u, _ in issues)


# ------------------------------------------------------------------------------------------------- PostgreSQL persistence
def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


@pytest.fixture(scope="module")
def postgres_url():
    bindir = os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin")
    if not os.path.exists(os.path.join(bindir, "initdb")):
        pytest.skip("PostgreSQL binaries not available")
    d = tempfile.mkdtemp()
    data = os.path.join(d, "data")
    run_as = ["runuser", "-u", "nobody", "--"] if os.geteuid() == 0 else []
    if run_as:
        shutil.chown(d, "nobody")
    subprocess.run(run_as + [f"{bindir}/initdb", "-D", data, "-U", "hq", "--auth=trust"], check=True,
                   capture_output=True)
    port = _free_port()
    proc = subprocess.Popen(run_as + [f"{bindir}/postgres", "-D", data, "-p", str(port), "-k", d, "-h", "127.0.0.1"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"postgresql+psycopg://hq@127.0.0.1:{port}/postgres"
    for _ in range(50):
        try:
            import psycopg
            psycopg.connect(f"host=127.0.0.1 port={port} user=hq dbname=postgres").close()
            break
        except Exception:
            time.sleep(0.2)
    yield url
    proc.terminate()
    proc.wait(timeout=10)
    shutil.rmtree(d, ignore_errors=True)


def test_full_loop_and_restart_on_postgresql(make, owner, postgres_url):
    from test_engine import loop_script
    hq, c, _ = make(loop_script(), db_url=postgres_url)
    oid = c.post("/api/objectives", headers=owner, json={"title": "Postgres slab leak objective"}).json()["id"]
    hq.run_until_idle()
    assert c.get(f"/api/objectives/{oid}").json()["status"] == "awaiting_owner"
    hq2, c2, _ = make(db_url=postgres_url)
    o = c2.get(f"/api/objectives/{oid}").json()
    assert o["status"] == "awaiting_owner" and len(o["tasks"]) >= 7
    assert c2.get("/api/dashboard").json()["pending_approvals"] == 1
