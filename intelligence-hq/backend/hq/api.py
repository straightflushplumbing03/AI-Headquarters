"""HTTP + WebSocket API. Reads are open on the local network; every change requires the owner token."""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from .config import DEFAULT_LIMITS, Settings, settings as default_settings
from .db import Agent, Approval, Event, MemoryItem, Message, Objective, Task, Usage, make_sessionmaker
from .engine import HQ, KNOWN_PERMISSIONS, LimitExceeded, Worker, _iso
from .llm import LLMError, build_provider
from .tools import PermissionDenied, Tools


def agent_dict(a: Agent, full: bool = False) -> dict:
    d = {"id": a.id, "name": a.name, "title": a.title, "department": a.department, "building": a.building,
         "status": a.status, "enabled": a.enabled, "current_task_id": a.current_task_id, "last_error": a.last_error,
         "last_active_at": _iso(a.last_active_at), "permissions": a.permissions, "can_delegate_to": a.can_delegate_to,
         "model_override": a.model_override}
    if full:
        d.update(system_prompt=a.system_prompt, personality=a.personality, responsibilities=a.responsibilities)
    return d


def task_dict(t: Task) -> dict:
    return {"id": t.id, "title": t.title, "description": t.description, "agent_id": t.agent_id,
            "created_by": t.created_by, "objective_id": t.objective_id, "parent_task_id": t.parent_task_id,
            "depth": t.depth, "kind": t.kind, "status": t.status, "priority": t.priority, "attempts": t.attempts,
            "max_attempts": t.max_attempts, "error": t.error, "result": t.result, "simulated": t.simulated,
            "input": t.input, "created_at": _iso(t.created_at), "started_at": _iso(t.started_at),
            "finished_at": _iso(t.finished_at)}


def obj_dict(o: Objective) -> dict:
    return {"id": o.id, "title": o.title, "description": o.description, "status": o.status,
            "review_rounds_done": o.review_rounds_done, "correction_rounds_done": o.correction_rounds_done,
            "final_report": o.final_report, "simulated": o.simulated, "created_at": _iso(o.created_at),
            "updated_at": _iso(o.updated_at)}


def appr_dict(a: Approval) -> dict:
    return {"id": a.id, "task_id": a.task_id, "objective_id": a.objective_id, "agent_id": a.agent_id, "kind": a.kind,
            "summary": a.summary, "payload": a.payload, "status": a.status, "decided_by": a.decided_by,
            "decision_note": a.decision_note, "simulated": a.simulated, "created_at": _iso(a.created_at),
            "decided_at": _iso(a.decided_at)}


class TaskIn(BaseModel):
    agent_id: str
    title: str = Field(min_length=3, max_length=240)
    description: str = ""
    kind: str = "manual"
    priority: int = 5
    input: dict[str, Any] = {}


class ObjectiveIn(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    description: str = ""


class DecisionIn(BaseModel):
    note: str = ""


class AgentIn(BaseModel):
    id: str
    name: str
    title: str
    department: str | None = None
    building: str = "plumbing-hq"
    prompt: str = ""
    personality: str = ""
    responsibilities: list[str] = []
    permissions: list[str] = ["llm.reason"]
    can_delegate_to: list[str] = []


class AgentPatch(BaseModel):
    permissions: list[str] | None = None
    can_delegate_to: list[str] | None = None
    model_override: str | None = None


def create_app(cfg: Settings | None = None, hq: HQ | None = None, start_worker: bool | None = None) -> FastAPI:
    cfg = cfg or default_settings
    if hq is None:
        _, Session = make_sessionmaker(cfg.database_url)

        def provider_factory(agent, override: dict):
            name = (override or {}).get("name") or cfg.llm_provider
            p = build_provider(name, cfg)
            if (override or {}).get("model"):
                p.model = override["model"]
            return p
        hq = HQ(Session, provider_factory, Tools())
    hq.seed()
    run_worker = cfg.run_worker if start_worker is None else start_worker
    worker = Worker(hq, cfg.tick_seconds) if run_worker else None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if cfg.owner_token_generated:
            print(f"\n[HQ] Owner token for this session (set HQ_OWNER_TOKEN to fix it): {cfg.owner_token}\n", flush=True)
        if worker:
            worker.start()
        yield
        if worker:
            worker.stop()

    app = FastAPI(title="Straight Flush Intelligence HQ", version="0.1.0", lifespan=lifespan)
    app.state.hq = hq
    app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.environ.get("HQ_CORS", "http://localhost:5173").split(",")],
                       allow_methods=["*"], allow_headers=["*"])

    def owner(authorization: str = Header(default="")) -> str:
        token = authorization.removeprefix("Bearer ").strip()
        if not token or token != cfg.owner_token:
            raise HTTPException(401, "owner token required")
        return "owner"

    def errors(fn):
        try:
            return fn()
        except PermissionDenied as e:
            raise HTTPException(403, str(e))
        except LimitExceeded as e:
            raise HTTPException(429, str(e))
        except ValueError as e:
            raise HTTPException(400, str(e))

    # ------------------------------------------------------------------------------------------------------ reads
    @app.get("/api/health")
    def health():
        with hq.tx() as s:
            prov = hq.get(s, "provider", {}) or {}
        return {"ok": True, "provider": prov.get("name") or cfg.llm_provider,
                "worker": bool(worker and worker.is_alive()), "database": cfg.database_url.split(":")[0]}

    @app.get("/api/dashboard")
    def dashboard():
        with hq.tx() as s:
            d = hq.dashboard(s)
            d["provider"] = (hq.get(s, "provider", {}) or {}).get("name") or cfg.llm_provider
            return d

    @app.get("/api/agents")
    def agents():
        with hq.tx() as s:
            return [agent_dict(a) for a in s.scalars(select(Agent).order_by(Agent.created_at, Agent.id))]

    @app.get("/api/agents/{agent_id}")
    def agent(agent_id: str):
        with hq.tx() as s:
            a = s.get(Agent, agent_id)
            if not a:
                raise HTTPException(404, "agent not found")
            d = agent_dict(a, full=True)
            q = select(Task).where(Task.agent_id == agent_id)
            d["task_counts"] = {st: len(s.scalars(q.where(Task.status == st)).all())
                                for st in ("pending", "running", "awaiting_approval", "completed", "failed")}
            d["current_task"] = task_dict(s.get(Task, a.current_task_id)) if a.current_task_id else None
            return d

    @app.get("/api/agents/{agent_id}/tasks")
    def agent_tasks(agent_id: str, limit: int = 50):
        with hq.tx() as s:
            return [task_dict(t) for t in s.scalars(select(Task).where(Task.agent_id == agent_id)
                                                     .order_by(Task.id.desc()).limit(min(limit, 200)))]

    @app.get("/api/agents/{agent_id}/memory")
    def agent_memory(agent_id: str):
        with hq.tx() as s:
            return [{"id": m.id, "content": m.content, "source_task_id": m.source_task_id, "simulated": m.simulated,
                     "created_at": _iso(m.created_at)} for m in
                    s.scalars(select(MemoryItem).where(MemoryItem.agent_id == agent_id).order_by(MemoryItem.id.desc()))]

    @app.get("/api/tasks")
    def tasks(status: str | None = None, objective_id: int | None = None, limit: int = 100):
        with hq.tx() as s:
            q = select(Task).order_by(Task.id.desc()).limit(min(limit, 500))
            if status:
                q = q.where(Task.status == status)
            if objective_id:
                q = q.where(Task.objective_id == objective_id)
            return [task_dict(t) for t in s.scalars(q)]

    @app.get("/api/tasks/{task_id}")
    def task(task_id: int):
        with hq.tx() as s:
            t = s.get(Task, task_id)
            if not t:
                raise HTTPException(404, "task not found")
            d = task_dict(t)
            d["events"] = [{"type": e.type, "message": e.message, "created_at": _iso(e.created_at)}
                           for e in s.scalars(select(Event).where(Event.task_id == task_id).order_by(Event.id))]
            return d

    @app.get("/api/objectives")
    def objectives():
        with hq.tx() as s:
            return [obj_dict(o) for o in s.scalars(select(Objective).order_by(Objective.id.desc()))]

    @app.get("/api/objectives/{oid}")
    def objective(oid: int):
        with hq.tx() as s:
            o = s.get(Objective, oid)
            if not o:
                raise HTTPException(404, "objective not found")
            d = obj_dict(o)
            d["tasks"] = [task_dict(t) for t in s.scalars(select(Task).where(Task.objective_id == oid).order_by(Task.id))]
            return d

    @app.get("/api/messages")
    def messages(limit: int = 100, agent_id: str | None = None):
        with hq.tx() as s:
            q = select(Message).order_by(Message.id.desc()).limit(min(limit, 500))
            if agent_id:
                q = q.where((Message.from_agent == agent_id) | (Message.to_agent == agent_id))
            return [{"id": m.id, "from_agent": m.from_agent, "to_agent": m.to_agent, "task_id": m.task_id,
                     "objective_id": m.objective_id, "kind": m.kind, "body": m.body, "created_at": _iso(m.created_at)}
                    for m in s.scalars(q)]

    @app.get("/api/approvals")
    def approvals(status: str | None = None):
        with hq.tx() as s:
            q = select(Approval).order_by(Approval.id.desc())
            if status:
                q = q.where(Approval.status == status)
            return [appr_dict(a) for a in s.scalars(q)]

    @app.get("/api/events")
    def events(limit: int = 100, agent_id: str | None = None):
        with hq.tx() as s:
            q = select(Event).order_by(Event.id.desc()).limit(min(limit, 500))
            if agent_id:
                q = q.where(Event.agent_id == agent_id)
            return [{"id": e.id, "type": e.type, "agent_id": e.agent_id, "task_id": e.task_id,
                     "objective_id": e.objective_id, "message": e.message, "data": e.data,
                     "created_at": _iso(e.created_at)} for e in s.scalars(q)]

    @app.get("/api/usage")
    def usage():
        with hq.tx() as s:
            rows = s.scalars(select(Usage).order_by(Usage.id.desc()).limit(1000)).all()
            by_agent: dict[str, dict] = {}
            for u in rows:
                b = by_agent.setdefault(u.agent_id, {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0})
                b["calls"] += 1
                b["input_tokens"] += u.input_tokens
                b["output_tokens"] += u.output_tokens
                b["cost_usd"] = round(b["cost_usd"] + u.cost_usd, 6)
            return {"by_agent": by_agent, "total_cost_usd": round(sum(u.cost_usd for u in rows), 6),
                    "calls": len(rows)}

    @app.get("/api/settings")
    def get_settings():
        with hq.tx() as s:
            prov = hq.get(s, "provider", {}) or {}
            return {"limits": hq.limits(s), "pricing": hq.get(s, "pricing"), "paused": bool(hq.get(s, "paused")),
                    "emergency_stop": bool(hq.get(s, "emergency_stop")),
                    "provider": {"name": prov.get("name") or cfg.llm_provider,
                                 "model": prov.get("model") or cfg.llm_model or None,
                                 "configured_keys": {"anthropic": bool(cfg.anthropic_api_key),
                                                     "openai": bool(cfg.openai_api_key)}},
                    "operating_hours": hq.get(s, "operating_hours"), "schedules": hq.get(s, "schedules"),
                    "audit_origins": hq.get(s, "audit_origins"), "permissions": sorted(KNOWN_PERMISSIONS)}

    @app.get("/api/auth/check")
    def auth_check(_: str = Depends(owner)):
        return {"ok": True}

    # ------------------------------------------------------------------------------------------------ owner writes
    @app.post("/api/tasks", status_code=201)
    def create_task(body: TaskIn, _: str = Depends(owner)):
        def go():
            with hq.tx() as s:
                t, created = hq.create_task(s, agent_id=body.agent_id, title=body.title, description=body.description,
                                            created_by="owner", kind=body.kind, priority=body.priority, input=body.input)
                return {"task": task_dict(t), "created": created}
        return errors(go)

    @app.post("/api/tasks/{task_id}/cancel")
    def cancel_task(task_id: int, _: str = Depends(owner)):
        def go():
            with hq.tx() as s:
                return task_dict(hq.cancel_task(s, task_id))
        return errors(go)

    @app.post("/api/objectives", status_code=201)
    def create_objective(body: ObjectiveIn, _: str = Depends(owner)):
        def go():
            with hq.tx() as s:
                return obj_dict(hq.start_objective(s, body.title, body.description))
        return errors(go)

    @app.post("/api/approvals/{aid}/approve")
    def approve(aid: int, body: DecisionIn, who: str = Depends(owner)):
        def go():
            with hq.tx() as s:
                return appr_dict(hq.decide(s, aid, True, body.note, who))
        return errors(go)

    @app.post("/api/approvals/{aid}/reject")
    def reject(aid: int, body: DecisionIn, who: str = Depends(owner)):
        def go():
            with hq.tx() as s:
                return appr_dict(hq.decide(s, aid, False, body.note, who))
        return errors(go)

    @app.post("/api/agents", status_code=201)
    def create_agent(body: AgentIn, _: str = Depends(owner)):
        def go():
            with hq.tx() as s:
                return agent_dict(hq.register_agent(s, body.model_dump()), full=True)
        return errors(go)

    @app.patch("/api/agents/{agent_id}")
    def patch_agent(agent_id: str, body: AgentPatch, _: str = Depends(owner)):
        with hq.tx() as s:
            a = s.get(Agent, agent_id)
            if not a:
                raise HTTPException(404, "agent not found")
            if body.permissions is not None:
                bad = set(body.permissions) - KNOWN_PERMISSIONS
                if bad:
                    raise HTTPException(400, f"unknown permissions: {sorted(bad)}")
                a.permissions = body.permissions
            if body.can_delegate_to is not None:
                a.can_delegate_to = body.can_delegate_to
            if body.model_override is not None:
                a.model_override = body.model_override or None
            hq.log(s, "agent.updated", f"Lance updated {a.name}'s configuration", a.id,
                   data=body.model_dump(exclude_none=True))
            return agent_dict(a, full=True)

    @app.post("/api/agents/{agent_id}/start")
    def start_agent(agent_id: str, _: str = Depends(owner)):
        return errors(lambda: _with(lambda s: agent_dict(hq.set_agent_enabled(s, agent_id, True))))

    @app.post("/api/agents/{agent_id}/stop")
    def stop_agent(agent_id: str, _: str = Depends(owner)):
        return errors(lambda: _with(lambda s: agent_dict(hq.set_agent_enabled(s, agent_id, False))))

    def _with(fn):
        with hq.tx() as s:
            return fn(s)

    @app.post("/api/control/pause")
    def pause(_: str = Depends(owner)):
        _with(lambda s: hq.set_paused(s, True))
        return {"paused": True}

    @app.post("/api/control/resume")
    def resume(_: str = Depends(owner)):
        _with(lambda s: hq.set_paused(s, False))
        return {"paused": False}

    @app.post("/api/control/emergency-stop")
    def estop(_: str = Depends(owner)):
        _with(lambda s: hq.emergency_stop(s, True))
        return {"emergency_stop": True}

    @app.post("/api/control/emergency-clear")
    def eclear(_: str = Depends(owner)):
        _with(lambda s: hq.emergency_stop(s, False))
        return {"emergency_stop": False}

    @app.put("/api/settings")
    def put_settings(body: dict, _: str = Depends(owner)):
        allowed = {"limits", "pricing", "operating_hours", "schedules", "provider", "audit_origins"}
        bad = set(body) - allowed
        if bad:
            raise HTTPException(400, f"not editable: {sorted(bad)}")
        if "limits" in body:
            unknown = set(body["limits"]) - set(DEFAULT_LIMITS)
            if unknown:
                raise HTTPException(400, f"unknown limits: {sorted(unknown)}")
        if "provider" in body:
            name = (body["provider"] or {}).get("name")
            if name:
                try:
                    build_provider(name, cfg)
                except LLMError as e:
                    raise HTTPException(400, f"provider not usable: {e}")
            if any(k.lower().endswith("key") for k in (body["provider"] or {})):
                raise HTTPException(400, "API keys are configured on the server, not through the API")
        with hq.tx() as s:
            for k, v in body.items():
                if k == "limits":
                    v = {**hq.limits(s), **v}
                hq.put(s, k, v)
            hq.log(s, "settings.updated", f"Lance updated settings: {', '.join(sorted(body))}", data={"keys": sorted(body)})
        return get_settings()

    # ------------------------------------------------------------------------------------------------- websocket
    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)

        def push(payload: dict) -> None:
            loop.call_soon_threadsafe(lambda: queue.put_nowait(payload) if not queue.full() else None)
        unsubscribe = hq.bus.subscribe(push)
        try:
            await socket.send_json({"type": "hello", "message": "connected"})
            while True:
                payload = await queue.get()
                await socket.send_json(payload)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            unsubscribe()

    # ------------------------------------------------------------------------------------------- static frontend
    dist = os.path.abspath(cfg.web_dist)
    if os.path.isdir(dist):
        app.mount("/assets", StaticFiles(directory=os.path.join(dist, "assets")), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            f = os.path.join(dist, path)
            if path and os.path.isfile(f) and os.path.commonpath([dist, os.path.abspath(f)]) == dist:
                return FileResponse(f)
            return FileResponse(os.path.join(dist, "index.html"))
    return app
