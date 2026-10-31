"""Persistent storage. SQLite for local development, PostgreSQL in production (set HQ_DATABASE_URL)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine,
                        event as sa_event)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(160))
    department: Mapped[str] = mapped_column(String(64))
    building: Mapped[str] = mapped_column(String(64), default="plumbing-hq")
    system_prompt: Mapped[str] = mapped_column(Text)
    personality: Mapped[str] = mapped_column(Text, default="")
    responsibilities: Mapped[list] = mapped_column(JSON, default=list)
    permissions: Mapped[list] = mapped_column(JSON, default=list)   # tool names this agent may use
    can_delegate_to: Mapped[list] = mapped_column(JSON, default=list)  # agent ids, or ["*"]
    model_override: Mapped[str | None] = mapped_column(String(120), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # idle | working | researching | reviewing | error | stopped
    status: Mapped[str] = mapped_column(String(24), default="idle")
    current_task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Objective(Base):
    __tablename__ = "objectives"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="owner")
    # planning | in_progress | review | correcting | consolidating | awaiting_owner | completed | rejected | failed | cancelled
    status: Mapped[str] = mapped_column(String(24), default="planning")
    review_rounds_done: Mapped[int] = mapped_column(Integer, default=0)
    correction_rounds_done: Mapped[int] = mapped_column(Integer, default=0)
    final_report: Mapped[str | None] = mapped_column(Text, nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    created_by: Mapped[str] = mapped_column(String(64))  # "owner" | "system" | "schedule" | agent id
    objective_id: Mapped[int | None] = mapped_column(ForeignKey("objectives.id"), nullable=True)
    parent_task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    # plan | research | analysis | content | review | correction | consolidate | manual | draft
    kind: Mapped[str] = mapped_column(String(24), default="manual")
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    # pending | running | awaiting_approval | completed | failed | cancelled | rejected
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=5)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(64), index=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    agent = relationship("Agent")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_agent: Mapped[str] = mapped_column(String(64))
    to_agent: Mapped[str] = mapped_column(String(64))
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    objective_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(24))  # handoff | review | correction | report
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    objective_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    agent_id: Mapped[str] = mapped_column(String(64))
    # recommendation | customer_message | publish_content | spend
    kind: Mapped[str] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | approved | rejected
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MemoryItem(Base):
    __tablename__ = "memory"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    source_task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Event(Base):
    """Append-only audit log. Nothing in the application updates or deletes these rows."""
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(48), index=True)
    agent_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    objective_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Usage(Base):
    __tablename__ = "usage"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_id: Mapped[str] = mapped_column(String(64))
    task_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(120))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)


def make_engine(url: str):
    kwargs: dict[str, Any] = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    eng = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @sa_event.listens_for(eng, "connect")
        def _pragma(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return eng


def make_sessionmaker(url: str):
    eng = make_engine(url)
    Base.metadata.create_all(eng)
    return eng, sessionmaker(bind=eng, expire_on_commit=False, future=True)
