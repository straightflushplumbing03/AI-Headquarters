"""The headquarters engine: task queue, execution, agent-to-agent hand-offs, the objective improvement loop,
limits, approvals and owner controls. Every state change is written to the database and to the audit log;
the 3D office and dashboard only ever display what is stored here."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterator
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import agents as agent_defs
from .config import DEFAULT_LIMITS, DEFAULT_PRICING
from .db import Agent, Approval, Event, MemoryItem, Message, Objective, Setting, Task, Usage, utcnow
from .llm import LLMError, LLMResult, Provider, parse_agent_json
from .tools import PermissionDenied, ToolError, Tools, require

OPEN = ("pending", "running", "awaiting_approval")
TERMINAL = ("completed", "failed", "cancelled", "rejected")
WORK_KINDS = ("research", "analysis", "content", "manual", "draft", "report", "audit")
STATUS_FOR_KIND = {"research": "researching", "audit": "researching", "review": "reviewing", "plan": "working",
                   "consolidate": "working"}
REVIEWER = {"seo": "marketing", "marketing": "technical", "competitor": "seo", "technical": "executive",
            "growth": "executive", "customer": "executive", "executive": "executive"}
APPROVAL_PERMISSION = {"customer_message": "customer.draft", "publish_content": "content.draft",
                       "recommendation": "objective.consolidate", "spend": None}


class LimitExceeded(Exception):
    pass


class EventBus:
    """Fan-out of committed events to WebSocket listeners. Thread-safe; listeners are plain callables."""

    def __init__(self) -> None:
        self._listeners: list[Callable[[dict], None]] = []
        self._lock = threading.Lock()

    def subscribe(self, fn: Callable[[dict], None]) -> Callable[[], None]:
        with self._lock:
            self._listeners.append(fn)

        def unsubscribe() -> None:
            with self._lock:
                if fn in self._listeners:
                    self._listeners.remove(fn)
        return unsubscribe

    def publish(self, payload: dict) -> None:
        with self._lock:
            listeners = list(self._listeners)
        for fn in listeners:
            try:
                fn(payload)
            except Exception:  # a broken listener must never break the engine
                pass


def _norm(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def dedupe_key(agent_id: str, objective_id: int | None, title: str) -> str:
    return hashlib.sha1(f"{agent_id}|{objective_id}|{_norm(title)}".encode()).hexdigest()


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


class HQ:
    def __init__(self, sessionmaker, provider_factory: Callable[[Agent | None, dict], Provider],
                 tools: Tools | None = None, bus: EventBus | None = None, retry_base_seconds: float = 2.0):
        self.Session = sessionmaker
        self.provider_factory = provider_factory
        self.tools = tools or Tools()
        self.bus = bus or EventBus()
        self.retry_base_seconds = retry_base_seconds
        self._tick_lock = threading.Lock()

    # ---------------------------------------------------------------------------------------------------- plumbing
    @contextmanager
    def tx(self) -> Iterator[Session]:
        s = self.Session()
        s.info["pending_events"] = []
        try:
            yield s
            s.commit()
            for payload in s.info["pending_events"]:
                self.bus.publish(payload)
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    def log(self, s: Session, type_: str, message: str, agent_id: str | None = None, task_id: int | None = None,
            objective_id: int | None = None, data: dict | None = None) -> Event:
        ev = Event(type=type_, agent_id=agent_id, task_id=task_id, objective_id=objective_id, message=message,
                   data=data or {})
        s.add(ev)
        s.flush()
        s.info.setdefault("pending_events", []).append(
            {"id": ev.id, "type": type_, "agent_id": agent_id, "task_id": task_id, "objective_id": objective_id,
             "message": message, "data": data or {}, "created_at": _iso(ev.created_at)})
        return ev

    def get(self, s: Session, key: str, default=None):
        row = s.get(Setting, key)
        return row.value if row else default

    def put(self, s: Session, key: str, value) -> None:
        row = s.get(Setting, key)
        if row:
            row.value = value
        else:
            s.add(Setting(key=key, value=value))

    def limits(self, s: Session) -> dict:
        return {**DEFAULT_LIMITS, **(self.get(s, "limits", {}) or {})}

    # -------------------------------------------------------------------------------------------------------- seed
    def seed(self) -> None:
        with self.tx() as s:
            for d in agent_defs.AGENTS:
                if not s.get(Agent, d["id"]):
                    s.add(Agent(id=d["id"], name=d["name"], title=d["title"], department=d["department"],
                                system_prompt=agent_defs.system_prompt(d), personality=d["personality"],
                                responsibilities=d["responsibilities"], permissions=d["permissions"],
                                can_delegate_to=d["can_delegate_to"]))
                    s.flush()
                    self.log(s, "agent.created", f"{d['name']} ({d['title']}) joined the headquarters", d["id"])
                else:
                    # Built-in identities live in code: keep name, prompt and personality in sync on start-up.
                    # Permissions and delegation are owner-editable and are left alone.
                    a = s.get(Agent, d["id"])
                    if a.name != d["name"]:
                        self.log(s, "agent.renamed", f"{a.name} is now {d['name']}", a.id)
                    a.name, a.title, a.personality = d["name"], d["title"], d["personality"]
                    a.system_prompt, a.responsibilities = agent_defs.system_prompt(d), d["responsibilities"]
            defaults = {
                "limits": DEFAULT_LIMITS, "pricing": DEFAULT_PRICING, "paused": False, "emergency_stop": False,
                "provider": {"name": None, "model": None},  # None = use environment config
                "operating_hours": {"enabled": False, "start_hour": 6, "end_hour": 20, "tz": "America/Los_Angeles"},
                "audit_origins": ["https://straightflushplumbingoc.com"],
                "schedules": [
                    {"id": "weekly-site-audit", "agent_id": "seo", "title": "Weekly on-page SEO audit",
                     "description": "Audit straightflushplumbingoc.com from its sitemap and report issues.",
                     "kind": "audit", "input": {"tool": "site.audit", "origin": "https://straightflushplumbingoc.com"},
                     "every_hours": 168, "enabled": False, "last_run_at": None},
                    {"id": "daily-report", "agent_id": "executive", "title": "Daily headquarters report",
                     "description": "Summarize what the agents did in the last 24 hours from the activity log.",
                     "kind": "report", "input": {}, "every_hours": 24, "enabled": False, "last_run_at": None},
                ],
            }
            for k, v in defaults.items():
                if s.get(Setting, k) is None:
                    s.add(Setting(key=k, value=v))

    def register_agent(self, s: Session, data: dict) -> Agent:
        if s.get(Agent, data["id"]):
            raise ValueError(f"agent {data['id']} exists")
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,40}", data["id"]):
            raise ValueError("agent id must be lowercase letters, digits and dashes")
        defn = {"prompt": data.get("prompt", ""), "personality": data.get("personality", "")}
        a = Agent(id=data["id"], name=data["name"], title=data["title"], department=data.get("department") or data["id"],
                  building=data.get("building", "plumbing-hq"), system_prompt=agent_defs.system_prompt(defn),
                  personality=defn["personality"], responsibilities=data.get("responsibilities", []),
                  permissions=[p for p in data.get("permissions", ["llm.reason"]) if p in KNOWN_PERMISSIONS],
                  can_delegate_to=data.get("can_delegate_to", []))
        s.add(a)
        s.flush()
        self.log(s, "agent.created", f"{a.name} ({a.title}) joined the headquarters", a.id)
        return a

    # ------------------------------------------------------------------------------------------------ task creation
    def create_task(self, s: Session, *, agent_id: str, title: str, description: str = "", created_by: str = "owner",
                    kind: str = "manual", objective_id: int | None = None, parent: Task | None = None,
                    input: dict | None = None, priority: int = 5) -> tuple[Task, bool]:
        target = s.get(Agent, agent_id)
        if not target:
            raise ValueError(f"unknown agent {agent_id}")
        title = (title or "").strip()[:240] or "Untitled task"
        lim = self.limits(s)
        if created_by not in ("owner", "system", "schedule"):
            creator = s.get(Agent, created_by)
            if not creator:
                raise PermissionDenied(f"unknown creator {created_by}")
            require(creator, "task.delegate")
            allowed = creator.can_delegate_to or []
            if "*" not in allowed and agent_id not in allowed:
                raise PermissionDenied(f"{created_by} may not assign work to {agent_id}")
            if agent_id == created_by:
                raise PermissionDenied("agents cannot assign follow-ups to themselves")
        depth = (parent.depth + 1) if parent else 0
        if depth > lim["max_depth"]:
            self.log(s, "guard.loop", f"Blocked task '{title}' for {agent_id}: depth {depth} exceeds limit "
                     f"{lim['max_depth']}", agent_id, parent.id if parent else None, objective_id)
            raise LimitExceeded(f"depth {depth} > {lim['max_depth']}")
        if objective_id is not None:
            n = s.scalar(select(func.count()).select_from(Task).where(Task.objective_id == objective_id)) or 0
            if n >= lim["max_tasks_per_objective"]:
                self.log(s, "guard.cap", f"Blocked task '{title}': objective already has {n} tasks (limit "
                         f"{lim['max_tasks_per_objective']})", agent_id, parent.id if parent else None, objective_id)
                raise LimitExceeded("objective task cap reached")
        key = dedupe_key(agent_id, objective_id, title)
        q = select(Task).where(Task.dedupe_key == key)
        q = q.where(Task.status.in_(OPEN)) if objective_id is None else q.where(Task.status.notin_(("failed", "cancelled")))
        existing = s.scalars(q).first()
        if existing:
            self.log(s, "guard.duplicate", f"Duplicate of task #{existing.id} blocked: '{title}'", agent_id,
                     existing.id, objective_id)
            return existing, False
        t = Task(title=title, description=description or "", agent_id=agent_id, created_by=created_by, kind=kind,
                 objective_id=objective_id, parent_task_id=parent.id if parent else None, depth=depth,
                 input=input or {}, priority=priority, max_attempts=lim["max_attempts"], dedupe_key=key)
        s.add(t)
        s.flush()
        who = "Lance" if created_by == "owner" else created_by
        self.log(s, "task.created", f"{who} assigned '{title}' to {target.name}", agent_id, t.id, objective_id,
                 {"kind": kind, "created_by": created_by, "depth": depth})
        if created_by not in ("owner", "system", "schedule"):
            s.add(Message(from_agent=created_by, to_agent=agent_id, task_id=t.id, objective_id=objective_id,
                          kind="handoff", body=f"{title}\n\n{description}".strip()))
        return t, True

    # ---------------------------------------------------------------------------------------------------- objectives
    def start_objective(self, s: Session, title: str, description: str = "", created_by: str = "owner") -> Objective:
        o = Objective(title=title.strip()[:240], description=description, created_by=created_by)
        s.add(o)
        s.flush()
        self.log(s, "objective.created", f"New objective: {o.title}", None, None, o.id)
        self.create_task(s, agent_id="executive", title=f"Plan: {o.title}", description=description,
                         created_by="system", kind="plan", objective_id=o.id, priority=3)
        return o

    def _objective_tasks(self, s: Session, oid: int) -> list[Task]:
        return list(s.scalars(select(Task).where(Task.objective_id == oid).order_by(Task.id)))

    def advance_objective(self, s: Session, oid: int | None) -> None:
        """Move an objective through plan -> work -> review -> correction -> consolidation -> owner approval.
        Re-evaluates after each transition so one completed task can carry the objective as far as it can go."""
        if oid is None:
            return
        for _ in range(8):
            o = s.get(Objective, oid)
            before = o.status if o else None
            self._advance_once(s, oid)
            o = s.get(Objective, oid)
            if not o or o.status == before:
                return

    def _advance_once(self, s: Session, oid: int) -> None:
        o = s.get(Objective, oid)
        if not o or o.status in ("awaiting_owner", "completed", "rejected", "failed", "cancelled"):
            return
        s.flush()
        tasks = self._objective_tasks(s, oid)
        lim = self.limits(s)
        by_kind = lambda *k: [t for t in tasks if t.kind in k]  # noqa: E731
        if o.status == "planning":
            plan = by_kind("plan")
            if plan and plan[-1].status in OPEN:
                return
            if not plan or plan[-1].status != "completed":
                self._set_obj(s, o, "failed", "planning task did not complete")
                return
            work = [t for t in tasks if t.kind not in ("plan",)]
            if not work:
                self._set_obj(s, o, "failed", "the plan produced no tasks")
                return
            self._set_obj(s, o, "in_progress", f"{len(work)} tasks assigned")
            return
        if o.status == "consolidating":
            c = by_kind("consolidate")
            if c and c[-1].status in ("pending", "running"):
                return
            if not c or c[-1].status not in ("completed", "awaiting_approval"):
                self._set_obj(s, o, "failed", "consolidation did not complete")
                return
            res = c[-1].result or {}
            o.final_report = json.dumps(res)
            o.simulated = bool(c[-1].simulated)
            if not s.scalars(select(Approval).where(Approval.objective_id == oid, Approval.kind == "recommendation")).first():
                self._create_approval(s, c[-1], {"kind": "recommendation", "summary": res.get("summary", o.title),
                                                 "draft": res})
            self._set_obj(s, o, "awaiting_owner", "final recommendation sent to Lance for approval")
            return
        if any(t.status in OPEN for t in tasks):
            return  # wait until the current stage settles
        if o.status == "in_progress":
            work = [t for t in by_kind(*WORK_KINDS) if t.status == "completed"]
            if o.review_rounds_done < lim["review_rounds"] and work:
                o.review_rounds_done += 1
                for t in work:
                    reviewer = REVIEWER.get(t.agent_id, "executive")
                    try:
                        self.create_task(s, agent_id=reviewer, title=f"Review #{t.id}: {t.title}"[:240],
                                         description="Check the work for accuracy, evidence and missing information.",
                                         created_by="system", kind="review", objective_id=oid, parent=t,
                                         input={"reviewed_task_id": t.id, "review_round": o.review_rounds_done})
                    except LimitExceeded:
                        pass
                self._set_obj(s, o, "review", f"review round {o.review_rounds_done}")
                return
            self._consolidate(s, o)
            return
        if o.status == "review":
            corrections = []
            for r in by_kind("review"):
                verdict = (r.result or {}).get("review_verdict") or {}
                if r.status == "completed" and verdict and not verdict.get("approved", True):
                    corrections.append((r, verdict.get("corrections") or []))
            if corrections and o.correction_rounds_done < lim["correction_rounds"]:
                o.correction_rounds_done += 1
                for r, items in corrections:
                    original = s.get(Task, r.input.get("reviewed_task_id"))
                    if not original:
                        continue
                    try:
                        t, _ = self.create_task(
                            s, agent_id=original.agent_id, title=f"Correct #{original.id}: {original.title}"[:240],
                            description="Reviewer requested corrections:\n- " + "\n- ".join(items),
                            created_by="system", kind="correction", objective_id=oid, parent=r,
                            input={"original_task_id": original.id, "corrections": items})
                        s.add(Message(from_agent=r.agent_id, to_agent=original.agent_id, task_id=t.id, objective_id=oid,
                                      kind="correction", body="\n".join(items) or "Corrections requested"))
                    except LimitExceeded:
                        pass
                self._set_obj(s, o, "correcting", f"{len(corrections)} correction request(s)")
                return
            self._consolidate(s, o)
            return
        if o.status == "correcting":
            self._consolidate(s, o)
            return

    def _consolidate(self, s: Session, o: Objective) -> None:
        try:
            self.create_task(s, agent_id="executive", title=f"Consolidate: {o.title}"[:240],
                             description="Merge the team's results into one recommendation for Lance.",
                             created_by="system", kind="consolidate", objective_id=o.id, priority=3)
        except LimitExceeded:
            self._set_obj(s, o, "failed", "task cap reached before consolidation")
            return
        self._set_obj(s, o, "consolidating", "executive is consolidating results")

    def _set_obj(self, s: Session, o: Objective, status: str, why: str) -> None:
        o.status = status
        o.updated_at = utcnow()
        self.log(s, "objective.status", f"Objective '{o.title}' → {status}: {why}", None, None, o.id, {"status": status})

    # --------------------------------------------------------------------------------------------------- approvals
    def _create_approval(self, s: Session, task: Task, req: dict) -> Approval | None:
        kind = req.get("kind", "recommendation")
        agent = s.get(Agent, task.agent_id)
        needed = APPROVAL_PERMISSION.get(kind, "__never__")
        if needed is None or needed == "__never__":
            self.log(s, "guard.permission", f"{agent.name} requested an unsupported approval kind '{kind}'",
                     agent.id, task.id, task.objective_id)
            return None
        try:
            require(agent, needed)
        except PermissionDenied as e:
            self.log(s, "guard.permission", str(e), agent.id, task.id, task.objective_id)
            return None
        draft = req.get("draft")
        a = Approval(task_id=task.id, objective_id=task.objective_id, agent_id=agent.id, kind=kind,
                     summary=str(req.get("summary") or task.title)[:2000],
                     payload={"draft": draft, "delivery": "manual — this system has no sending or publishing integration"},
                     simulated=task.simulated)
        s.add(a)
        s.flush()
        self.log(s, "approval.requested", f"{agent.name} needs Lance's approval: {a.summary[:120]}", agent.id, task.id,
                 task.objective_id, {"approval_id": a.id, "kind": kind})
        return a

    def decide(self, s: Session, approval_id: int, approve: bool, note: str = "", decided_by: str = "owner") -> Approval:
        if decided_by != "owner":
            raise PermissionDenied("only the owner can decide approvals")
        a = s.get(Approval, approval_id)
        if not a:
            raise ValueError("approval not found")
        if a.status != "pending":
            raise ValueError(f"approval already {a.status}")
        a.status = "approved" if approve else "rejected"
        a.decided_by, a.decision_note, a.decided_at = decided_by, note, utcnow()
        t = s.get(Task, a.task_id) if a.task_id else None
        if t and t.status == "awaiting_approval":
            t.status = "completed" if approve else "rejected"
            t.finished_at = utcnow()
        self.log(s, "approval.decided", f"Lance {a.status} {a.kind}: {a.summary[:120]}", a.agent_id, a.task_id,
                 a.objective_id, {"approval_id": a.id, "status": a.status})
        if a.objective_id and a.kind == "recommendation":
            o = s.get(Objective, a.objective_id)
            if o and o.status == "awaiting_owner":
                self._set_obj(s, o, "completed" if approve else "rejected", note or a.status)
        elif a.objective_id:
            self.advance_objective(s, a.objective_id)
        return a

    # ----------------------------------------------------------------------------------------------- owner controls
    def set_paused(self, s: Session, paused: bool) -> None:
        self.put(s, "paused", paused)
        self.log(s, "control.pause" if paused else "control.resume",
                 "Lance paused all agents" if paused else "Lance resumed operations")

    def emergency_stop(self, s: Session, active: bool) -> None:
        self.put(s, "emergency_stop", active)
        for a in s.scalars(select(Agent)):
            if active and a.status != "working":
                a.status = "stopped"
            elif not active and a.status == "stopped" and a.enabled:
                a.status = "idle"
        self.log(s, "control.emergency_stop" if active else "control.emergency_clear",
                 "EMERGENCY STOP: all agent execution halted" if active else "Emergency stop cleared")

    def set_agent_enabled(self, s: Session, agent_id: str, enabled: bool) -> Agent:
        a = s.get(Agent, agent_id)
        if not a:
            raise ValueError("agent not found")
        a.enabled = enabled
        if not enabled and a.status != "working":
            a.status = "stopped"
        elif enabled and a.status == "stopped":
            a.status = "idle"
        self.log(s, "agent.started" if enabled else "agent.stopped",
                 f"Lance {'started' if enabled else 'stopped'} {a.name}", a.id)
        return a

    def cancel_task(self, s: Session, task_id: int) -> Task:
        t = s.get(Task, task_id)
        if not t:
            raise ValueError("task not found")
        if t.status in TERMINAL:
            raise ValueError(f"task already {t.status}")
        if t.status == "running":
            t.input = {**(t.input or {}), "cancel_requested": True}
        else:
            t.status = "cancelled"
            t.finished_at = utcnow()
        self.log(s, "task.cancelled", f"Lance cancelled task #{t.id} '{t.title}'", t.agent_id, t.id, t.objective_id)
        return t

    # ------------------------------------------------------------------------------------------------------- worker
    def _within_hours(self, s: Session) -> bool:
        oh = self.get(s, "operating_hours", {}) or {}
        if not oh.get("enabled"):
            return True
        now = datetime.now(ZoneInfo(oh.get("tz", "America/Los_Angeles")))
        return int(oh.get("start_hour", 0)) <= now.hour < int(oh.get("end_hour", 24))

    def _daily_usage(self, s: Session) -> tuple[int, int, float]:
        start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        started = s.scalar(select(func.count()).select_from(Task).where(Task.started_at >= start)) or 0
        tok = s.scalar(select(func.coalesce(func.sum(Usage.input_tokens + Usage.output_tokens), 0))
                       .where(Usage.created_at >= start)) or 0
        cost = s.scalar(select(func.coalesce(func.sum(Usage.cost_usd), 0.0)).where(Usage.created_at >= start)) or 0.0
        return int(started), int(tok), float(cost)

    def _run_schedules(self, s: Session) -> None:
        scheds = self.get(s, "schedules", []) or []
        changed = False
        now = utcnow()
        for sc in scheds:
            if not sc.get("enabled"):
                continue
            last = datetime.fromisoformat(sc["last_run_at"]) if sc.get("last_run_at") else None
            if last and now - last < timedelta(hours=float(sc.get("every_hours", 24))):
                continue
            try:
                self.create_task(s, agent_id=sc["agent_id"], title=sc["title"], description=sc.get("description", ""),
                                 created_by="schedule", kind=sc.get("kind", "manual"), input=sc.get("input", {}))
            except (ValueError, LimitExceeded, PermissionDenied) as e:
                self.log(s, "schedule.error", f"Schedule {sc['id']} failed: {e}", sc.get("agent_id"))
            sc["last_run_at"] = now.isoformat()
            changed = True
        if changed:
            self.put(s, "schedules", [dict(x) for x in scheds])

    def tick(self, max_tasks: int = 10) -> int:
        """One scheduler pass. Returns how many tasks were executed. Safe to call from several threads."""
        if not self._tick_lock.acquire(blocking=False):
            return 0
        try:
            ran = 0
            while ran < max_tasks:
                with self.tx() as s:
                    if self.get(s, "emergency_stop") or self.get(s, "paused") or not self._within_hours(s):
                        return ran
                    if ran == 0:
                        self._run_schedules(s)
                    lim = self.limits(s)
                    started, tokens, cost = self._daily_usage(s)
                    if started >= lim["daily_task_limit"] or tokens >= lim["daily_token_limit"] \
                            or cost >= lim["daily_cost_limit_usd"]:
                        if not self.get(s, "budget_block_logged") == utcnow().date().isoformat():
                            self.put(s, "budget_block_logged", utcnow().date().isoformat())
                            self.log(s, "guard.budget", f"Daily limit reached (tasks {started}, tokens {tokens}, "
                                     f"${cost:.2f}); work resumes tomorrow or when Lance raises the limit")
                        return ran
                    busy = set(s.scalars(select(Task.agent_id).where(Task.status == "running")))
                    now = utcnow()
                    cand = s.scalars(
                        select(Task).join(Agent, Agent.id == Task.agent_id)
                        .where(Task.status == "pending", Agent.enabled.is_(True))
                        .where((Task.next_attempt_at.is_(None)) | (Task.next_attempt_at <= now))
                        .order_by(Task.priority, Task.id)).all()
                    task = next((t for t in cand if t.agent_id not in busy), None)
                    if not task:
                        return ran
                    task.status, task.started_at = "running", now
                    task.attempts += 1
                    agent = s.get(Agent, task.agent_id)
                    agent.status = STATUS_FOR_KIND.get(task.kind, "working")
                    agent.current_task_id, agent.last_active_at, agent.last_error = task.id, now, None
                    self.log(s, "task.started", f"{agent.name} started '{task.title}' (attempt {task.attempts})",
                             agent.id, task.id, task.objective_id, {"agent_status": agent.status})
                    tid = task.id
                self.run_task(tid)
                ran += 1
            return ran
        finally:
            self._tick_lock.release()

    def run_until_idle(self, max_steps: int = 200) -> int:
        """Test/demo helper: keep ticking until nothing is runnable (retries with a future next_attempt_at wait)."""
        total = 0
        for _ in range(max_steps):
            n = self.tick()
            total += n
            if n == 0:
                break
        return total

    # ------------------------------------------------------------------------------------------------- execution
    def _prompt(self, s: Session, task: Task, agent: Agent, extra: str = "") -> str:
        parts = [f"TASK #{task.id} ({task.kind}): {task.title}"]
        if task.description:
            parts.append(f"DETAILS:\n{task.description}")
        if task.input:
            parts.append("INPUT:\n" + json.dumps({k: v for k, v in task.input.items() if k != 'cancel_requested'})[:4000])
        if task.objective_id:
            o = s.get(Objective, task.objective_id)
            parts.append(f"OBJECTIVE #{o.id}: {o.title}\n{o.description}".strip())
            if task.kind in ("review", "consolidate", "correction"):
                related = []
                ids = [task.input.get("reviewed_task_id"), task.input.get("original_task_id")]
                pool = [s.get(Task, i) for i in ids if i] if task.kind != "consolidate" else [
                    t for t in self._objective_tasks(s, o.id) if t.status == "completed" and t.kind != "plan"]
                for t in pool:
                    if t and t.result:
                        related.append({"task": t.id, "agent": t.agent_id, "title": t.title,
                                        "summary": t.result.get("summary"), "findings": t.result.get("findings"),
                                        "recommendations": t.result.get("recommendations"),
                                        "review_verdict": t.result.get("review_verdict")})
                parts.append("TEAM RESULTS:\n" + json.dumps(related)[:12000])
        if agent.id == "executive":
            parts.append("COMPANY SNAPSHOT (from the database, real):\n" + json.dumps(self.snapshot(s)))
        mem = s.scalars(select(MemoryItem).where(MemoryItem.agent_id == agent.id).order_by(MemoryItem.id.desc()).limit(10)).all()
        if mem:
            parts.append("YOUR MEMORY:\n- " + "\n- ".join(m.content for m in reversed(mem)))
        others = s.scalars(select(Agent).where(Agent.id != agent.id)).all()
        parts.append("AGENTS YOU MAY HAND WORK TO: " + ", ".join(
            f"{a.id} ({a.title})" for a in others if "*" in agent.can_delegate_to or a.id in agent.can_delegate_to)
            if "task.delegate" in agent.permissions else "You cannot hand work to other agents.")
        if extra:
            parts.append(extra)
        return "\n\n".join(parts)

    def _call(self, s: Session, agent: Agent, task: Task, prompt: str, meta: dict) -> tuple[dict, LLMResult]:
        require(agent, "llm.reason")
        provider = self.provider_factory(agent, self.get(s, "provider", {}) or {})
        res = provider.complete(agent.system_prompt, prompt, meta, agent.model_override)
        pricing = self.get(s, "pricing", DEFAULT_PRICING) or DEFAULT_PRICING
        pin, pout = pricing.get(res.provider or provider.name, [0.0, 0.0])
        cost = (res.input_tokens * pin + res.output_tokens * pout) / 1_000_000
        s.add(Usage(agent_id=agent.id, task_id=task.id, provider=res.provider or provider.name, model=res.model or "",
                    input_tokens=res.input_tokens, output_tokens=res.output_tokens, cost_usd=cost))
        return parse_agent_json(res.text), res

    def run_task(self, task_id: int) -> None:
        with self.tx() as s:
            task = s.get(Task, task_id)
            agent = s.get(Agent, task.agent_id)
            meta = {"kind": task.kind, "agent_id": agent.id, "title": task.title, "description": task.description,
                    "task_id": task.id, **{k: v for k, v in (task.input or {}).items() if k in ("force_follow_up",)}}
            if task.objective_id:
                o = s.get(Objective, task.objective_id)
                lim = self.limits(s)
                meta.update(objective_title=o.title, review_round=o.review_rounds_done,
                            correction_rounds_left=lim["correction_rounds"] - o.correction_rounds_done)
            try:
                extra = ""
                if (task.input or {}).get("tool") == "site.audit":
                    require(agent, "site.audit")
                    origin = task.input.get("origin", "")
                    if origin.rstrip("/") not in [o_.rstrip("/") for o_ in self.get(s, "audit_origins", [])]:
                        raise PermissionDenied(f"{origin} is not an approved audit origin")
                    self.log(s, "tool.call", f"{agent.name} is auditing {origin}", agent.id, task.id, task.objective_id,
                             {"tool": "site.audit"})
                    audit = self.tools.site_audit(origin)
                    extra = "SITE AUDIT DATA (real, collected just now):\n" + json.dumps(audit)[:12000]
                    task.result = {"audit": audit}
                data, res = self._call(s, agent, task, self._prompt(s, task, agent, extra), meta)
                fetched = []
                urls = [u for u in (data.get("fetch_urls") or []) if isinstance(u, str)][:3]
                if urls and "web.fetch" in agent.permissions and not res.simulated:
                    texts = []
                    for u in urls:
                        try:
                            page = self.tools.fetch(u)
                            fetched.append({"url": page["url"], "status": page["status"], "title": page["title"]})
                            texts.append(f"URL: {page['url']} (HTTP {page['status']})\nTITLE: {page['title']}\n{page['text']}")
                            self.log(s, "tool.call", f"{agent.name} read {page['url']}", agent.id, task.id,
                                     task.objective_id, {"tool": "web.fetch", "status": page["status"]})
                        except ToolError as e:
                            texts.append(f"URL: {u}\nFETCH FAILED: {e}")
                            self.log(s, "tool.error", f"{agent.name} could not read {u}: {e}", agent.id, task.id,
                                     task.objective_id)
                    extra2 = (extra + "\n\n" if extra else "") + "PAGES YOU REQUESTED (real content):\n\n" + \
                        "\n\n---\n\n".join(texts)[:20000] + "\n\nNow answer the task. Do not request more URLs."
                    data, res = self._call(s, agent, task, self._prompt(s, task, agent, extra2), meta)
                elif urls and "web.fetch" not in agent.permissions:
                    self.log(s, "guard.permission", f"{agent.name} asked to read URLs but lacks web.fetch",
                             agent.id, task.id, task.objective_id)
            except PermissionDenied as e:
                self._fail(s, task, agent, f"permission denied: {e}", retry=False)
                return
            except (LLMError, ToolError) as e:
                self._fail(s, task, agent, str(e), retry=getattr(e, "transient", True))
                return
            except Exception as e:  # unexpected bug: fail loudly, never mark success
                self._fail(s, task, agent, f"internal error: {type(e).__name__}: {e}", retry=False)
                return

            fresh = s.get(Task, task.id)
            if self.get(s, "emergency_stop") or (fresh.input or {}).get("cancel_requested"):
                task.status, task.finished_at = "cancelled", utcnow()
                task.result = {**(task.result or {}), **data, "discarded": True}
                agent.status = "stopped" if self.get(s, "emergency_stop") else "idle"
                agent.current_task_id = None
                self.log(s, "task.cancelled", f"{agent.name}'s result for '{task.title}' was discarded "
                         "(stopped by Lance)", agent.id, task.id, task.objective_id)
                return
            self._apply(s, task, agent, data, res, fetched)

    def _apply(self, s: Session, task: Task, agent: Agent, data: dict, res: LLMResult, fetched: list) -> None:
        lim = self.limits(s)
        task.simulated = bool(res.simulated)
        task.result = {**(task.result or {}), **data, "fetched": fetched, "provider": res.provider, "model": res.model,
                       "simulated": task.simulated}
        task.error = None
        if "memory.write" in agent.permissions:
            for m in [m for m in (data.get("memory") or []) if isinstance(m, str) and m.strip()][:5]:
                s.add(MemoryItem(agent_id=agent.id, content=m.strip()[:1000], source_task_id=task.id,
                                 simulated=task.simulated))
        created = 0
        for f in (data.get("follow_ups") or []):
            if not isinstance(f, dict) or not f.get("agent") or not f.get("title"):
                continue
            if created >= lim["max_follow_ups_per_task"]:
                self.log(s, "guard.cap", f"{agent.name} asked for more than {lim['max_follow_ups_per_task']} "
                         "follow-ups; extras dropped", agent.id, task.id, task.objective_id)
                break
            try:
                _, made = self.create_task(s, agent_id=str(f["agent"]), title=str(f["title"]),
                                           description=str(f.get("description", "")), created_by=agent.id,
                                           kind=str(f.get("kind", "research")) if f.get("kind") in WORK_KINDS else "research",
                                           objective_id=task.objective_id, parent=task)
                created += int(made)
            except PermissionDenied as e:
                self.log(s, "guard.permission", f"{agent.name} tried to hand work to {f['agent']}: {e}", agent.id,
                         task.id, task.objective_id)
            except (LimitExceeded, ValueError) as e:
                self.log(s, "guard.cap", f"Follow-up from {agent.name} not created: {e}", agent.id, task.id,
                         task.objective_id)
        approval = None
        if isinstance(data.get("approval_request"), dict):
            approval = self._create_approval(s, task, data["approval_request"])
        task.status = "awaiting_approval" if approval else "completed"
        task.finished_at = utcnow()
        agent.status, agent.current_task_id, agent.last_active_at = "idle", None, utcnow()
        if not agent.enabled:
            agent.status = "stopped"
        if task.objective_id and task.kind in ("review", "consolidate", "plan", "correction") or created:
            s.add(Message(from_agent=agent.id, to_agent="executive" if agent.id != "executive" else "owner",
                          task_id=task.id, objective_id=task.objective_id,
                          kind="review" if task.kind == "review" else "report",
                          body=str(data.get("summary", ""))[:2000]))
        self.log(s, "task.completed" if not approval else "task.awaiting_approval",
                 f"{agent.name} finished '{task.title}'" + (" — waiting for Lance's approval" if approval else ""),
                 agent.id, task.id, task.objective_id, {"simulated": task.simulated, "follow_ups": created})
        self.advance_objective(s, task.objective_id)

    def _fail(self, s: Session, task: Task, agent: Agent, error: str, retry: bool) -> None:
        task.error = error[:2000]
        agent.status, agent.last_error, agent.current_task_id = "error", error[:500], None
        if retry and task.attempts < task.max_attempts:
            delay = self.retry_base_seconds * (2 ** (task.attempts - 1))
            task.status, task.next_attempt_at = "pending", utcnow() + timedelta(seconds=delay)
            self.log(s, "task.retry", f"{agent.name} hit an error on '{task.title}' (attempt {task.attempts}/"
                     f"{task.max_attempts}); retrying in {delay:.0f}s: {error[:160]}", agent.id, task.id,
                     task.objective_id, {"error": error[:500]})
            return
        task.status, task.finished_at = "failed", utcnow()
        self.log(s, "task.failed", f"{agent.name} failed '{task.title}': {error[:200]}", agent.id, task.id,
                 task.objective_id, {"error": error[:500], "attempts": task.attempts})
        self.advance_objective(s, task.objective_id)

    # -------------------------------------------------------------------------------------------------- read models
    def snapshot(self, s: Session) -> dict:
        counts = dict(s.execute(select(Task.status, func.count()).group_by(Task.status)).all())
        return {"tasks_by_status": counts,
                "agents": {a.id: a.status for a in s.scalars(select(Agent))},
                "pending_approvals": s.scalar(select(func.count()).select_from(Approval).where(Approval.status == "pending")) or 0,
                "objectives_by_status": dict(s.execute(select(Objective.status, func.count()).group_by(Objective.status)).all())}

    def dashboard(self, s: Session) -> dict:
        agents = s.scalars(select(Agent)).all()
        counts = dict(s.execute(select(Task.status, func.count()).group_by(Task.status)).all())
        since = utcnow() - timedelta(days=13)
        rows = s.execute(select(Task.finished_at, Task.status).where(Task.finished_at >= since.replace(hour=0, minute=0))).all()
        daily: dict[str, dict] = {}
        for i in range(14):
            d = (since + timedelta(days=i)).date().isoformat()
            daily[d] = {"date": d, "completed": 0, "failed": 0}
        for fin, st in rows:
            d = fin.date().isoformat()
            if d in daily and st in ("completed", "failed"):
                daily[d][st] += 1
        started, tok, cost = self._daily_usage(s)
        latest = s.scalars(select(Task).where(Task.status.in_(("completed", "awaiting_approval")))
                           .order_by(Task.finished_at.desc()).limit(6)).all()
        alerts = s.scalars(select(Event).where(Event.type.in_((
            "task.failed", "guard.loop", "guard.budget", "guard.permission", "control.emergency_stop", "tool.error",
            "schedule.error", "guard.cap"))).order_by(Event.id.desc()).limit(8)).all()
        objectives = s.scalars(select(Objective).order_by(Objective.id.desc()).limit(8)).all()
        audits = s.scalars(select(Task).where(Task.kind == "audit", Task.status.in_(("completed", "failed")))
                           .order_by(Task.id.desc()).limit(1)).all()
        sims = s.scalar(select(func.count()).select_from(Task).where(Task.simulated.is_(True))) or 0
        opps = s.scalars(select(Task).where(Task.agent_id == "growth", Task.status == "completed")
                         .order_by(Task.id.desc()).limit(5)).all()
        return {
            "agents_total": len(agents),
            "agents_online": sum(1 for a in agents if a.enabled and a.status != "stopped"),
            "agents_working": sum(1 for a in agents if a.status in ("working", "researching", "reviewing")),
            "agents_idle": sum(1 for a in agents if a.status == "idle"),
            "agents_error": sum(1 for a in agents if a.status == "error"),
            "tasks_completed": counts.get("completed", 0), "tasks_in_progress": counts.get("running", 0),
            "tasks_pending": counts.get("pending", 0), "tasks_failed": counts.get("failed", 0),
            "pending_approvals": s.scalar(select(func.count()).select_from(Approval).where(Approval.status == "pending")) or 0,
            "simulated_tasks": sims,
            "daily_activity": list(daily.values()),
            "today": {"tasks_started": started, "tokens": tok, "cost_usd": round(cost, 4)},
            "current_projects": [{"id": o.id, "title": o.title, "status": o.status, "simulated": o.simulated}
                                 for o in objectives],
            "latest_research": [{"id": t.id, "agent_id": t.agent_id, "title": t.title, "status": t.status,
                                 "summary": (t.result or {}).get("summary", ""), "simulated": t.simulated,
                                 "finished_at": _iso(t.finished_at)} for t in latest],
            "alerts": [{"id": e.id, "type": e.type, "message": e.message, "created_at": _iso(e.created_at)} for e in alerts],
            "opportunities": [{"id": t.id, "title": t.title, "summary": (t.result or {}).get("summary", ""),
                               "simulated": t.simulated} for t in opps],
            "website_monitoring": ({"task_id": audits[0].id, "status": audits[0].status,
                                    "finished_at": _iso(audits[0].finished_at),
                                    "pages_checked": ((audits[0].result or {}).get("audit") or {}).get("pages_checked"),
                                    "issues": len(((audits[0].result or {}).get("audit") or {}).get("issues", []))}
                                   if audits else None),
            "controls": {"paused": bool(self.get(s, "paused")), "emergency_stop": bool(self.get(s, "emergency_stop"))},
        }


KNOWN_PERMISSIONS = {"llm.reason", "web.fetch", "site.audit", "task.delegate", "objective.plan",
                     "objective.consolidate", "customer.draft", "content.draft", "memory.write"}


class Worker(threading.Thread):
    """Background loop that ticks the engine. Stopping it never interrupts a model call mid-flight."""

    def __init__(self, hq: HQ, interval: float = 2.0):
        super().__init__(daemon=True, name="hq-worker")
        self.hq, self.interval = hq, interval
        self._stop = threading.Event()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self.hq.tick()
            except Exception as e:  # keep the worker alive; record the failure
                try:
                    with self.hq.tx() as s:
                        self.hq.log(s, "worker.error", f"Worker error: {type(e).__name__}: {e}")
                except Exception:
                    pass
            self._stop.wait(self.interval)

    def stop(self) -> None:
        self._stop.set()
