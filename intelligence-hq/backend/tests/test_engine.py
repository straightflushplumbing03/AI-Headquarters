"""Behavioural tests for the agent engine, run through the public API wherever possible."""
import threading

import pytest
from sqlalchemy import select

from conftest import FlakyProvider, ScriptedProvider, reply
from hq.db import Event, MemoryItem, Task
from hq.engine import LimitExceeded
from hq.llm import LLMError
from hq.tools import PermissionDenied


# 1. Agent creation ----------------------------------------------------------------------------------------------
def test_seven_agents_seeded_with_identity_prompt_and_permissions(make):
    _, c, _ = make()
    agents = c.get("/api/agents").json()
    assert {a["id"] for a in agents} == {"executive", "seo", "competitor", "marketing", "customer", "technical", "growth"}
    for a in agents:
        full = c.get(f"/api/agents/{a['id']}").json()
        assert full["name"] and full["title"] and full["department"]
        assert "Never fabricate" in full["system_prompt"] and "Straight Flush" in full["system_prompt"]
        assert full["responsibilities"] and "llm.reason" in full["permissions"]
        assert full["status"] == "idle"


def test_owner_can_add_an_agent_without_code_changes(make, owner):
    _, c, _ = make()
    r = c.post("/api/agents", headers=owner, json={"id": "stock-analyst", "name": "Ira", "title": "Market Analyst",
                                                    "building": "stock-intel", "permissions": ["llm.reason", "launch.rockets"]})
    assert r.status_code == 201
    assert r.json()["building"] == "stock-intel"
    assert r.json()["permissions"] == ["llm.reason"]  # unknown permission silently dropped
    assert len(c.get("/api/agents").json()) == 8


# 2-3, 5. Assignment, execution, completion --------------------------------------------------------------------------
def test_manual_task_assignment_executes_and_completes(make, owner):
    prov = ScriptedProvider({"technical": reply(summary="PEX-A vs PEX-B compared", findings=["MANUFACTURER SPEC: x"])})
    hq, c, _ = make(prov)
    r = c.post("/api/tasks", headers=owner, json={"agent_id": "technical", "title": "Compare PEX-A and PEX-B"})
    assert r.status_code == 201 and r.json()["created"]
    tid = r.json()["task"]["id"]
    assert c.get(f"/api/tasks/{tid}").json()["status"] == "pending"
    assert hq.run_until_idle() == 1
    t = c.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "completed" and t["result"]["summary"] == "PEX-A vs PEX-B compared"
    assert t["simulated"] is False and t["attempts"] == 1
    assert [e["type"] for e in t["events"]] == ["task.created", "task.started", "task.completed"]
    assert c.get("/api/agents/technical").json()["status"] == "idle"


def test_agent_status_reflects_real_execution(make, owner):
    seen = {}
    hq_ref = {}

    def during(meta):
        with hq_ref["hq"].tx() as s:
            from hq.db import Agent
            seen["status"] = s.get(Agent, "competitor").status
            seen["current"] = s.get(Agent, "competitor").current_task_id
        return reply()
    hq, c, _ = make(ScriptedProvider({"competitor": during}))
    hq_ref["hq"] = hq
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "competitor", "title": "Scan rivals",
                                                    "kind": "research"}).json()["task"]["id"]
    hq.run_until_idle()
    assert seen == {"status": "researching", "current": tid}
    assert c.get("/api/agents/competitor").json()["status"] == "idle"


# 4. Agent-to-agent communication ---------------------------------------------------------------------------------------
def test_agent_follow_up_creates_task_and_message_for_other_agent(make, owner):
    prov = ScriptedProvider({"competitor": reply(summary="3 rivals publish slab leak content",
                                                 follow_ups=[{"agent": "seo", "title": "Audit our slab leak content",
                                                              "description": "Rivals are publishing on this"}])})
    hq, c, _ = make(prov)
    c.post("/api/tasks", headers=owner, json={"agent_id": "competitor", "title": "Weekly competitor scan"})
    hq.run_until_idle()
    seo_tasks = c.get("/api/agents/seo/tasks").json()
    assert len(seo_tasks) == 1 and seo_tasks[0]["created_by"] == "competitor" and seo_tasks[0]["status"] == "completed"
    assert seo_tasks[0]["depth"] == 1
    msgs = c.get("/api/messages").json()
    assert any(m["from_agent"] == "competitor" and m["to_agent"] == "seo" and m["kind"] == "handoff" for m in msgs)


# 6-7. Failures and retries ---------------------------------------------------------------------------------------------
def test_transient_failure_retries_then_succeeds(make, owner):
    prov = FlakyProvider(failures=2)
    hq, c, _ = make(prov)
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "growth", "title": "Find underserved areas"}).json()["task"]["id"]
    hq.run_until_idle()
    t = c.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "completed" and t["attempts"] == 3 and prov.calls == 3
    assert sum(e["type"] == "task.retry" for e in t["events"]) == 2
    assert c.get("/api/agents/growth").json()["status"] == "idle"


def test_failure_after_max_attempts_marks_task_and_agent_failed(make, owner):
    hq, c, _ = make(FlakyProvider(failures=99))
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "growth", "title": "Doomed task"}).json()["task"]["id"]
    hq.run_until_idle()
    t = c.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "failed" and t["attempts"] == 3 and "503" in t["error"]
    a = c.get("/api/agents/growth").json()
    assert a["status"] == "error" and "503" in a["last_error"]
    d = c.get("/api/dashboard").json()
    assert d["tasks_failed"] == 1 and d["agents_error"] == 1
    assert any(al["type"] == "task.failed" for al in d["alerts"])


def test_non_transient_failure_is_not_retried(make, owner):
    prov = FlakyProvider(failures=99, transient=False)
    hq, c, _ = make(prov)
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Bad key"}).json()["task"]["id"]
    hq.run_until_idle()
    assert c.get(f"/api/tasks/{tid}").json()["status"] == "failed" and prov.calls == 1


def test_malformed_model_output_is_a_failure_not_a_success(make, owner):
    hq, c, _ = make(ScriptedProvider(default="I think the answer is probably fine"))
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Garbage reply"}).json()["task"]["id"]
    hq.run_until_idle()
    t = c.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "failed" and "JSON" in t["error"]


# 8. Memory persistence ------------------------------------------------------------------------------------------------
def test_memory_is_saved_and_fed_into_later_tasks(make, owner):
    prov = ScriptedProvider({"seo": lambda m: reply(memory=["Laguna Niguel city page has 503 words"])
                             if "first" in m["title"] else reply()})
    hq, c, _ = make(prov)
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "first audit"})
    hq.run_until_idle()
    assert [m["content"] for m in c.get("/api/agents/seo/memory").json()] == ["Laguna Niguel city page has 503 words"]
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "second audit"})
    hq.run_until_idle()
    assert "Laguna Niguel city page has 503 words" in prov.prompts[-1][1]


# 9. Database persistence (restart) ---------------------------------------------------------------------------------------
def test_state_survives_restart(make, owner, tmp_path):
    url = f"sqlite:///{tmp_path}/persist.db"
    hq, c, _ = make(ScriptedProvider({"seo": reply(memory=["remember me"])}), db_url=url)
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "persist me"})
    hq.run_until_idle()
    c.post("/api/control/pause", headers=owner)
    del hq, c
    hq2, c2, _ = make(db_url=url)  # brand-new engine + app on the same database
    assert c2.get("/api/agents/seo/tasks").json()[0]["status"] == "completed"
    assert c2.get("/api/agents/seo/memory").json()[0]["content"] == "remember me"
    assert c2.get("/api/settings").json()["paused"] is True
    assert len(c2.get("/api/agents").json()) == 7  # seeding is idempotent


# 10. Dashboard updates ----------------------------------------------------------------------------------------------------
def test_dashboard_is_honest_when_empty_and_tracks_real_work(make, owner):
    hq, c, _ = make(ScriptedProvider())
    d = c.get("/api/dashboard").json()
    assert d["tasks_completed"] == 0 and d["latest_research"] == [] and d["website_monitoring"] is None
    assert d["agents_total"] == 7 and d["agents_idle"] == 7 and d["opportunities"] == []
    c.post("/api/tasks", headers=owner, json={"agent_id": "growth", "title": "Opportunity scan"})
    assert c.get("/api/dashboard").json()["tasks_pending"] == 1
    hq.run_until_idle()
    d = c.get("/api/dashboard").json()
    assert d["tasks_completed"] == 1 and d["tasks_pending"] == 0 and d["latest_research"][0]["title"] == "Opportunity scan"
    assert d["opportunities"][0]["title"] == "Opportunity scan"
    assert sum(day["completed"] for day in d["daily_activity"]) == 1


def test_websocket_streams_live_events(make, owner):
    hq, c, _ = make(ScriptedProvider())
    with c.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "hello"
        c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Live update check"})
        assert ws.receive_json()["type"] == "task.created"
        t = threading.Thread(target=hq.run_until_idle)
        t.start()
        t.join()
        types = [ws.receive_json()["type"] for _ in range(2)]
        assert types == ["task.started", "task.completed"]


# 11. Permission enforcement ----------------------------------------------------------------------------------------------
def test_owner_endpoints_require_token(make, owner):
    _, c, _ = make()
    assert c.post("/api/tasks", json={"agent_id": "seo", "title": "no token"}).status_code == 401
    assert c.post("/api/tasks", headers={"Authorization": "Bearer wrong"}, json={"agent_id": "seo", "title": "bad"}).status_code == 401
    for path in ("/api/control/pause", "/api/control/emergency-stop", "/api/agents/seo/stop", "/api/approvals/1/approve"):
        assert c.post(path, json={}).status_code == 401
    assert c.put("/api/settings", json={"limits": {"max_depth": 99}}).status_code == 401


def test_agent_cannot_delegate_outside_its_permissions(make, owner):
    prov = ScriptedProvider({"customer": reply(follow_ups=[{"agent": "marketing", "title": "Write ads"},
                                                           {"agent": "customer", "title": "Self loop"}])})
    hq, c, _ = make(prov)
    c.post("/api/tasks", headers=owner, json={"agent_id": "customer", "title": "Inbox triage"})
    hq.run_until_idle()
    assert c.get("/api/agents/marketing/tasks").json() == []
    ev = c.get("/api/events").json()
    assert sum(e["type"] == "guard.permission" for e in ev) == 2


def test_agent_without_web_fetch_cannot_read_urls(make, owner):
    prov = ScriptedProvider({"customer": reply(fetch_urls=["https://example.com"])})
    hq, c, _ = make(prov)
    c.post("/api/tasks", headers=owner, json={"agent_id": "customer", "title": "Try to browse"})
    hq.run_until_idle()
    assert len(prov.prompts) == 1  # no second, URL-enriched call
    assert any(e["type"] == "guard.permission" for e in c.get("/api/events").json())


def test_site_audit_requires_permission_and_approved_origin(make, owner):
    hq, c, _ = make(ScriptedProvider())
    t1 = c.post("/api/tasks", headers=owner, json={"agent_id": "marketing", "title": "Audit as marketing",
                                                   "input": {"tool": "site.audit", "origin": "https://straightflushplumbingoc.com"}}).json()["task"]["id"]
    t2 = c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Audit someone else",
                                                   "input": {"tool": "site.audit", "origin": "https://evil.example"}}).json()["task"]["id"]
    hq.run_until_idle()
    a, b = c.get(f"/api/tasks/{t1}").json(), c.get(f"/api/tasks/{t2}").json()
    assert a["status"] == "failed" and "site.audit" in a["error"]
    assert b["status"] == "failed" and "not an approved audit origin" in b["error"]
    assert a["attempts"] == 1 and b["attempts"] == 1  # permission errors are not retried


def test_agents_cannot_decide_approvals(make):
    hq, _, _ = make()
    with hq.tx() as s:
        with pytest.raises(PermissionDenied):
            hq.decide(s, 1, True, decided_by="executive")


def test_api_keys_cannot_be_set_or_read_through_api(make, owner):
    _, c, _ = make()
    r = c.put("/api/settings", headers=owner, json={"provider": {"name": "simulated", "api_key": "sk-x"}})
    assert r.status_code == 400
    body = c.get("/api/settings").json()
    assert "sk-" not in str(body) and set(body["provider"]["configured_keys"]) == {"anthropic", "openai"}


# 12. Human approval requirements -------------------------------------------------------------------------------------------
def test_customer_message_needs_owner_approval_and_is_never_sent(make, owner):
    prov = ScriptedProvider({"customer": reply(summary="Drafted reply", approval_request={
        "kind": "customer_message", "summary": "Reply to Mission Viejo slab leak inquiry", "draft": "Hi ..."})})
    hq, c, _ = make(prov)
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "customer", "title": "Reply to inquiry"}).json()["task"]["id"]
    hq.run_until_idle()
    assert c.get(f"/api/tasks/{tid}").json()["status"] == "awaiting_approval"
    ap = c.get("/api/approvals?status=pending").json()
    assert len(ap) == 1 and ap[0]["kind"] == "customer_message"
    assert "no sending" in ap[0]["payload"]["delivery"]
    assert c.post(f"/api/approvals/{ap[0]['id']}/approve", json={}).status_code == 401
    assert c.post(f"/api/approvals/{ap[0]['id']}/approve", headers=owner, json={"note": "send it"}).status_code == 200
    assert c.get(f"/api/tasks/{tid}").json()["status"] == "completed"
    assert c.post(f"/api/approvals/{ap[0]['id']}/reject", headers=owner, json={}).status_code == 400  # already decided


def test_agent_cannot_request_approval_kinds_it_is_not_allowed(make, owner):
    prov = ScriptedProvider({"seo": reply(approval_request={"kind": "customer_message", "summary": "x"}),
                             "growth": reply(approval_request={"kind": "spend", "summary": "Buy ads $500"})})
    hq, c, _ = make(prov)
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Sneaky draft"})
    c.post("/api/tasks", headers=owner, json={"agent_id": "growth", "title": "Spend money"})
    hq.run_until_idle()
    assert c.get("/api/approvals").json() == []
    assert sum(e["type"] == "guard.permission" for e in c.get("/api/events").json()) == 2


# 13. Continuous improvement loop -----------------------------------------------------------------------------------------
def loop_script():
    return ScriptedProvider({
        ("executive", "plan"): reply(summary="plan", follow_ups=[
            {"agent": "competitor", "title": "Who publishes slab leak content", "description": "public pages only"}]),
        ("competitor", "research"): reply(summary="3 competitors publish slab leak guides", findings=["url a", "url b"],
                                          follow_ups=[{"agent": "seo", "title": "Review our slab leak page"}]),
        ("seo", "research"): reply(summary="Our page lacks a cost section", follow_ups=[
            {"agent": "marketing", "title": "Draft slab leak cost section"}]),
        ("marketing", "research"): reply(summary="Draft written"),
        ("seo", "review"): lambda m: reply(review_verdict={"approved": False, "corrections": ["cite each URL"]}),
        ("marketing", "review"): reply(review_verdict={"approved": True, "corrections": []}),
        ("technical", "review"): reply(review_verdict={"approved": True, "corrections": []}),
        ("competitor", "correction"): reply(summary="Added URLs"),
        ("executive", "consolidate"): reply(summary="Publish a cost section on the slab leak page",
                                            approval_request={"kind": "recommendation",
                                                              "summary": "Add a cost section to the slab leak page"}),
    })


def test_full_objective_loop_plan_work_review_correct_consolidate_approve(make, owner):
    prov = loop_script()
    hq, c, _ = make(prov)
    oid = c.post("/api/objectives", headers=owner, json={"title": "Win slab leak searches"}).json()["id"]
    hq.run_until_idle()
    o = c.get(f"/api/objectives/{oid}").json()
    kinds = [(t["kind"], t["agent_id"]) for t in o["tasks"]]
    assert kinds[:4] == [("plan", "executive"), ("research", "competitor"), ("research", "seo"), ("research", "marketing")]
    assert ("review", "seo") in kinds and ("correction", "competitor") in kinds and kinds[-1] == ("consolidate", "executive")
    assert o["status"] == "awaiting_owner" and o["review_rounds_done"] == 1 and o["correction_rounds_done"] == 1
    corr = [t for t in o["tasks"] if t["kind"] == "correction"][0]
    assert "cite each URL" in corr["description"]
    consolidate_prompt = [p for p in prov.prompts if p[2]["kind"] == "consolidate"][0][1]
    assert "3 competitors publish slab leak guides" in consolidate_prompt and "Added URLs" in consolidate_prompt
    ap = c.get("/api/approvals?status=pending").json()
    assert [a["kind"] for a in ap] == ["recommendation"]
    c.post(f"/api/approvals/{ap[0]['id']}/approve", headers=owner, json={"note": "go"})
    assert c.get(f"/api/objectives/{oid}").json()["status"] == "completed"
    statuses = [e["data"].get("status") for e in reversed(c.get("/api/events?limit=200").json()) if e["type"] == "objective.status"]
    assert statuses == ["in_progress", "review", "correcting", "consolidating", "awaiting_owner", "completed"]


def test_owner_rejection_closes_objective(make, owner):
    hq, c, _ = make(loop_script())
    oid = c.post("/api/objectives", headers=owner, json={"title": "Win slab leak searches"}).json()["id"]
    hq.run_until_idle()
    ap = c.get("/api/approvals?status=pending").json()[0]
    c.post(f"/api/approvals/{ap['id']}/reject", headers=owner, json={"note": "not now"})
    assert c.get(f"/api/objectives/{oid}").json()["status"] == "rejected"


def test_consolidation_without_explicit_request_still_reaches_owner(make, owner):
    prov = loop_script()
    prov.script[("executive", "consolidate")] = reply(summary="final")
    hq, c, _ = make(prov)
    oid = c.post("/api/objectives", headers=owner, json={"title": "x objective"}).json()["id"]
    hq.run_until_idle()
    assert c.get(f"/api/objectives/{oid}").json()["status"] == "awaiting_owner"
    assert c.get("/api/approvals").json()[0]["kind"] == "recommendation"


def test_failed_planning_fails_objective(make, owner):
    prov = ScriptedProvider({("executive", "plan"): LLMError("bad key", transient=False)})
    hq, c, _ = make(prov)
    oid = c.post("/api/objectives", headers=owner, json={"title": "Doomed objective"}).json()["id"]
    hq.run_until_idle()
    assert c.get(f"/api/objectives/{oid}").json()["status"] == "failed"


def test_simulated_provider_runs_whole_loop_and_labels_everything(make, owner):
    hq, c, _ = make()  # default = SimulatedProvider
    oid = c.post("/api/objectives", headers=owner, json={"title": "Improve Google ranking for water heater repair"}).json()["id"]
    hq.run_until_idle()
    o = c.get(f"/api/objectives/{oid}").json()
    assert o["status"] == "awaiting_owner" and o["simulated"] is True
    assert all(t["simulated"] for t in o["tasks"])
    assert all("[SIMULATED]" in t["result"]["summary"] for t in o["tasks"])
    assert c.get("/api/approvals").json()[0]["simulated"] is True
    assert c.get("/api/dashboard").json()["simulated_tasks"] == len(o["tasks"])


# 14. Duplicate-task prevention ---------------------------------------------------------------------------------------------
def test_duplicate_open_tasks_are_blocked(make, owner):
    _, c, _ = make()
    a = c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Check GBP listing"}).json()
    b = c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "  check gbp LISTING!! "}).json()
    assert a["created"] and not b["created"] and a["task"]["id"] == b["task"]["id"]
    assert len(c.get("/api/tasks").json()) == 1
    other = c.post("/api/tasks", headers=owner, json={"agent_id": "marketing", "title": "Check GBP listing"}).json()
    assert other["created"]  # same title for a different agent is a different task


def test_agents_cannot_ping_pong_the_same_task(make, owner):
    prov = ScriptedProvider({
        "seo": reply(follow_ups=[{"agent": "marketing", "title": "Rewrite slab page"}]),
        "marketing": reply(follow_ups=[{"agent": "seo", "title": "Rewrite slab page"}]),
        ("executive", "plan"): reply(follow_ups=[{"agent": "seo", "title": "Rewrite slab page"}]),
    })
    hq, c, _ = make(prov)
    oid = c.post("/api/objectives", headers=owner, json={"title": "Ping pong"}).json()["id"]
    hq.run_until_idle()
    work = [t for t in c.get(f"/api/objectives/{oid}").json()["tasks"] if t["kind"] == "research"]
    assert sorted(t["agent_id"] for t in work) == ["marketing", "seo"]
    assert any(e["type"] == "guard.duplicate" for e in c.get("/api/events?limit=200").json())


# 15. Infinite-loop prevention ------------------------------------------------------------------------------------------------
def test_endless_delegation_chain_is_cut_by_depth_and_task_cap(make, owner):
    counter = {"n": 0}

    def always_delegate(meta):
        counter["n"] += 1
        nxt = {"executive": "seo", "seo": "competitor", "competitor": "seo", "marketing": "seo"}.get(meta["agent_id"], "executive")
        return reply(follow_ups=[{"agent": nxt, "title": f"step {counter['n']}"},
                                 {"agent": nxt if nxt != "seo" else "marketing", "title": f"fork {counter['n']}"}])
    hq, c, _ = make(ScriptedProvider(default=always_delegate))
    oid = c.post("/api/objectives", headers=owner, json={"title": "Runaway"}).json()["id"]
    hq.run_until_idle(max_steps=500)
    tasks = c.get(f"/api/objectives/{oid}").json()["tasks"]
    assert len(tasks) <= 20
    assert max(t["depth"] for t in tasks) <= 3
    ev = [e["type"] for e in c.get("/api/events?limit=500").json()]
    assert "guard.loop" in ev
    assert c.get(f"/api/objectives/{oid}").json()["status"] in ("awaiting_owner", "failed")
    assert c.get("/api/dashboard").json()["tasks_pending"] == 0  # nothing left spinning


def test_follow_ups_per_task_are_capped(make, owner):
    prov = ScriptedProvider({"executive": reply(follow_ups=[{"agent": "seo", "title": f"t{i}"} for i in range(9)])})
    hq, c, _ = make(prov)
    c.post("/api/tasks", headers=owner, json={"agent_id": "executive", "title": "Fan out"})
    hq.run_until_idle()
    assert len(c.get("/api/agents/seo/tasks").json()) == 3


def test_daily_budget_stops_the_worker(make, owner):
    hq, c, _ = make(ScriptedProvider())
    c.put("/api/settings", headers=owner, json={"limits": {"daily_task_limit": 2}})
    for i in range(4):
        c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": f"task number {i}"})
    hq.run_until_idle()
    d = c.get("/api/dashboard").json()
    assert d["tasks_completed"] == 2 and d["tasks_pending"] == 2
    assert any(a["type"] == "guard.budget" for a in d["alerts"])


# 16. API failure handling -------------------------------------------------------------------------------------------------------
def test_tool_fetch_failure_is_reported_to_agent_not_fatal(make, owner):
    import httpx
    from hq.tools import Tools
    def handler(req):
        raise httpx.ConnectError("connection refused")
    prov = ScriptedProvider({"competitor": lambda m: reply(fetch_urls=["https://rival.example/slab"])
                             if "PAGES YOU REQUESTED" not in prov.prompts[-1][1] else reply(summary="could not read page")})
    hq, c, _ = make(prov, tools=Tools(transport=httpx.MockTransport(handler), resolve_hosts=False))
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "competitor", "title": "Read rival"}).json()["task"]["id"]
    hq.run_until_idle()
    t = c.get(f"/api/tasks/{tid}").json()
    assert t["status"] == "completed" and t["result"]["summary"] == "could not read page"
    assert "FETCH FAILED" in prov.prompts[-1][1]
    assert any(e["type"] == "tool.error" for e in c.get("/api/events").json())


def test_fetched_pages_are_given_to_the_agent(make, owner):
    import httpx
    from hq.tools import Tools
    page = "<html><title>Rival Plumbing</title><body><h1>Slab leaks</h1>We fix slab leaks fast.</body></html>"
    prov = ScriptedProvider({"competitor": lambda m: reply(fetch_urls=["https://rival.example/slab"])
                             if len(prov.prompts) == 1 else reply(summary="read it")})
    hq, c, _ = make(prov, tools=Tools(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=page,
                                      headers={"content-type": "text/html"})), resolve_hosts=False))
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "competitor", "title": "Read rival page"}).json()["task"]["id"]
    hq.run_until_idle()
    assert "We fix slab leaks fast." in prov.prompts[-1][1]
    assert c.get(f"/api/tasks/{tid}").json()["result"]["fetched"][0]["title"] == "Rival Plumbing"


# Owner controls -----------------------------------------------------------------------------------------------------------------
def test_pause_and_resume(make, owner):
    hq, c, _ = make(ScriptedProvider())
    c.post("/api/control/pause", headers=owner)
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "while paused"})
    assert hq.run_until_idle() == 0
    c.post("/api/control/resume", headers=owner)
    assert hq.run_until_idle() == 1


def test_emergency_stop_halts_everything_and_discards_in_flight_results(make, owner):
    hq_ref = {}

    def hit_stop(meta):
        with hq_ref["hq"].tx() as s:
            hq_ref["hq"].emergency_stop(s, True)
        return reply(follow_ups=[{"agent": "seo", "title": "should never exist"}],
                     approval_request={"kind": "customer_message", "summary": "should never exist"})
    hq, c, _ = make(ScriptedProvider({"customer": hit_stop}))
    hq_ref["hq"] = hq
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "customer", "title": "In flight"}).json()["task"]["id"]
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Queued behind"})
    hq.run_until_idle()
    assert c.get(f"/api/tasks/{tid}").json()["status"] == "cancelled"
    assert c.get("/api/approvals").json() == []
    assert len(c.get("/api/agents/seo/tasks").json()) == 1 and c.get("/api/agents/seo/tasks").json()[0]["status"] == "pending"
    assert {a["status"] for a in c.get("/api/agents").json()} == {"stopped"}
    c.post("/api/control/emergency-clear", headers=owner)
    hq.run_until_idle()
    assert c.get("/api/agents/seo/tasks").json()[0]["status"] == "completed"


def test_stopped_agent_does_not_run_until_started(make, owner):
    hq, c, _ = make(ScriptedProvider())
    c.post("/api/agents/marketing/stop", headers=owner)
    c.post("/api/tasks", headers=owner, json={"agent_id": "marketing", "title": "Write post"})
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Other work"})
    assert hq.run_until_idle() == 1
    assert c.get("/api/agents/marketing").json()["status"] == "stopped"
    c.post("/api/agents/marketing/start", headers=owner)
    assert hq.run_until_idle() == 1


def test_cancel_pending_task(make, owner):
    hq, c, _ = make(ScriptedProvider())
    tid = c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Cancel me"}).json()["task"]["id"]
    assert c.post(f"/api/tasks/{tid}/cancel", headers=owner).json()["status"] == "cancelled"
    assert hq.run_until_idle() == 0


def test_schedule_creates_one_task_per_period(make, owner):
    hq, c, _ = make(ScriptedProvider())
    sched = c.get("/api/settings").json()["schedules"]
    for s_ in sched:
        s_["enabled"] = s_["id"] == "daily-report"
    c.put("/api/settings", headers=owner, json={"schedules": sched})
    hq.run_until_idle()
    hq.run_until_idle()
    tasks = c.get("/api/agents/executive/tasks").json()
    assert len(tasks) == 1 and tasks[0]["created_by"] == "schedule" and tasks[0]["status"] == "completed"


def test_usage_and_costs_are_recorded(make, owner):
    hq, c, _ = make(ScriptedProvider())
    c.put("/api/settings", headers=owner, json={"pricing": {"scripted": [1000.0, 2000.0]}})
    c.post("/api/tasks", headers=owner, json={"agent_id": "seo", "title": "Costed task"})
    hq.run_until_idle()
    u = c.get("/api/usage").json()
    assert u["calls"] == 1 and u["by_agent"]["seo"]["input_tokens"] == 100
    assert u["total_cost_usd"] == pytest.approx((100 * 1000 + 50 * 2000) / 1_000_000)


def test_audit_log_is_append_only_in_application_code(make):
    import pathlib
    import re
    src = "".join(p.read_text() for p in pathlib.Path(__file__).parents[1].joinpath("hq").glob("*.py"))
    assert not re.search(r"delete\(\s*Event", src) and "Event.message =" not in src
