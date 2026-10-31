import { ReactNode, useState } from "react";
import { Agent, STATUS_LABEL, Task, ago } from "../api";

export function StatusDot({ status }: { status: string }) {
  return <span className={`dot dot-${status}`} aria-hidden />;
}

export function AgentName({ id, agents }: { id: string; agents: Agent[] }) {
  if (id === "owner") return <>Lance</>;
  if (id === "system") return <>HQ engine</>;
  if (id === "schedule") return <>Schedule</>;
  const a = agents.find((x) => x.id === id);
  return <>{a ? a.name : id}</>;
}

export function Sim({ on }: { on: boolean }) {
  return on ? <span className="sim" title="Produced by the offline simulated provider, not a real model">Simulated</span> : null;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header><h3>{title}</h3>{aside}</header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

const TASK_STATUS: Record<string, string> = {
  pending: "Queued", running: "Running", awaiting_approval: "Needs approval", completed: "Done", failed: "Failed",
  cancelled: "Cancelled", rejected: "Rejected",
};

export function TaskRow({ t, agents, onOpen }: { t: Task; agents: Agent[]; onOpen?: (t: Task) => void }) {
  return (
    <li className={`task task-${t.status}`}>
      <button className="linklike" onClick={() => onOpen?.(t)}>
        <span className="task-title">#{t.id} {t.title}</span>
        <span className="task-meta">
          <span className={`pill pill-${t.status}`}>{TASK_STATUS[t.status] ?? t.status}</span>
          <AgentName id={t.agent_id} agents={agents} /> · {t.kind} · {ago(t.finished_at ?? t.started_at ?? t.created_at)}
          <Sim on={t.simulated} />
        </span>
      </button>
    </li>
  );
}

export function TaskDetail({ t, agents, onClose }: { t: Task; agents: Agent[]; onClose: () => void }) {
  const r = t.result ?? {};
  const list = (k: string) => (Array.isArray(r[k]) && r[k].length ? (
    <><h4>{k[0].toUpperCase() + k.slice(1)}</h4><ul className="bullets">{r[k].map((x: unknown, i: number) =>
      <li key={i}>{typeof x === "string" ? x : JSON.stringify(x)}</li>)}</ul></>
  ) : null);
  return (
    <div className="detail" role="dialog" aria-label={`Task ${t.id}`}>
      <div className="detail-head">
        <h3>#{t.id} {t.title}</h3>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
      <p className="muted">
        <span className={`pill pill-${t.status}`}>{TASK_STATUS[t.status]}</span> Assigned to <AgentName id={t.agent_id} agents={agents} /> by{" "}
        <AgentName id={t.created_by} agents={agents} /> · attempt {t.attempts}/{t.max_attempts} · depth {t.depth} <Sim on={t.simulated} />
      </p>
      {t.description && <p className="pre">{t.description}</p>}
      {t.error && <p className="error">{t.error}</p>}
      {r.summary && <><h4>Summary</h4><p>{r.summary}</p></>}
      {list("findings")}
      {list("recommendations")}
      {r.review_verdict && <><h4>Review</h4><p>{r.review_verdict.approved ? "Approved" : "Corrections requested"}:{" "}
        {(r.review_verdict.corrections ?? []).join("; ")}</p></>}
      {Array.isArray(r.fetched) && r.fetched.length > 0 && <><h4>Pages read</h4><ul className="bullets">
        {r.fetched.map((f: { url: string; status: number }) => <li key={f.url}>{f.url} (HTTP {f.status})</li>)}</ul></>}
      {r.audit && <><h4>Site audit</h4><p>{r.audit.pages_checked} pages checked, {r.audit.issues.length} issues</p>
        <ul className="bullets">{r.audit.issues.slice(0, 20).map((i: { url: string; issue: string }, k: number) =>
          <li key={k}>{i.url.replace(/^https?:\/\/[^/]+/, "") || "/"}: {i.issue}</li>)}</ul></>}
      {t.events && <><h4>History</h4><ol className="timeline">{t.events.map((e, i) =>
        <li key={i}><time>{new Date(e.created_at).toLocaleTimeString()}</time> {e.message}</li>)}</ol></>}
      {r.provider && <p className="muted small">Model: {r.provider} {r.model}</p>}
    </div>
  );
}

export function useToggle(initial = false): [boolean, () => void] {
  const [v, s] = useState(initial);
  return [v, () => s((x) => !x)];
}

export { STATUS_LABEL };
