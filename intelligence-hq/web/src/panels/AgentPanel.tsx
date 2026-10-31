import { FormEvent, useEffect, useState } from "react";
import { Agent, AgentDetail, STATUS_LABEL, Task, ago, api, post } from "../api";
import { Empty, Section, StatusDot, TaskRow } from "./common";

interface Props {
  agentId: string; agents: Agent[]; tick: number; owner: boolean; openTask: (t: Task) => void;
  notify: (m: string, err?: boolean) => void;
}

export default function AgentPanel({ agentId, agents, tick, owner, openTask, notify }: Props) {
  const [a, setA] = useState<AgentDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memory, setMemory] = useState<{ id: number; content: string; simulated: boolean; created_at: string }[]>([]);
  const [tab, setTab] = useState<"work" | "memory" | "profile">("work");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([api<AgentDetail>(`/api/agents/${agentId}`), api<Task[]>(`/api/agents/${agentId}/tasks`),
      api<typeof memory>(`/api/agents/${agentId}/memory`)])
      .then(([x, t, m]) => { if (live) { setA(x); setTasks(t); setMemory(m); } })
      .catch((e) => notify(String(e), true));
    return () => { live = false; };
  }, [agentId, tick, notify]);

  if (!a) return <Empty>Loading agent…</Empty>;

  const toggle = async () => {
    try { await post(`/api/agents/${a.id}/${a.enabled ? "stop" : "start"}`); notify(`${a.name} ${a.enabled ? "stopped" : "started"}`); }
    catch (e) { notify(String(e), true); }
  };
  const assign = async (ev: FormEvent) => {
    ev.preventDefault();
    try {
      const r = await post<{ created: boolean; task: Task }>("/api/tasks", { agent_id: a.id, title, description: desc });
      notify(r.created ? `Assigned to ${a.name}` : `${a.name} already has that task (#${r.task.id})`);
      setTitle(""); setDesc("");
    } catch (e) { notify(String(e), true); }
  };

  return (
    <div className="panel-body">
      <div className="agent-head">
        <div>
          <h2>{a.name}</h2>
          <p className="muted">{a.title}</p>
        </div>
        <span className={`status status-${a.status}`}><StatusDot status={a.status} />{STATUS_LABEL[a.status]}</span>
      </div>
      {a.current_task && (
        <p className="now">Now: <button className="linklike" onClick={() => openTask(a.current_task!)}>#{a.current_task.id} {a.current_task.title}</button></p>
      )}
      {a.status === "error" && a.last_error && <p className="error">Last error: {a.last_error}</p>}
      <p className="muted small">Last active {ago(a.last_active_at)} · {a.task_counts.completed} done · {a.task_counts.failed} failed ·{" "}
        {a.task_counts.pending} queued · {a.task_counts.awaiting_approval} awaiting approval</p>

      {owner && (
        <div className="row-actions">
          <button onClick={toggle} className={a.enabled ? "ghost" : ""}>{a.enabled ? `Stop ${a.name}` : `Start ${a.name}`}</button>
        </div>
      )}

      <nav className="subtabs" role="tablist">
        {(["work", "memory", "profile"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === "work" ? "Task history" : t === "memory" ? "Memory" : "Role & permissions"}
          </button>
        ))}
      </nav>

      {tab === "work" && (
        <>
          {owner && (
            <form className="form" onSubmit={assign}>
              <label htmlFor="assign-title">Give {a.name} a task</label>
              <input id="assign-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required
                placeholder={`e.g. ${a.id === "competitor" ? "Review the top 3 slab leak competitors in Mission Viejo" : "What should " + a.name + " work on?"}`} />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Details (optional)" aria-label="Task details" />
              <button type="submit">Assign task</button>
            </form>
          )}
          {tasks.length === 0 ? <Empty>{a.name} hasn't been given any work yet.</Empty> : (
            <ul className="tasks">{tasks.map((t) => <TaskRow key={t.id} t={t} agents={agents} onOpen={openTask} />)}</ul>
          )}
        </>
      )}

      {tab === "memory" && (memory.length === 0 ? <Empty>No memories saved yet. Agents save facts they want to reuse in later tasks.</Empty> : (
        <ul className="rows">{memory.map((m) => <li key={m.id}><span>{m.content}</span><span className="muted small">{ago(m.created_at)}{m.simulated ? " · simulated" : ""}</span></li>)}</ul>
      ))}

      {tab === "profile" && (
        <>
          <Section title="Responsibilities"><ul className="bullets">{a.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul></Section>
          <Section title="Personality"><p>{a.personality}</p></Section>
          <Section title="Tools allowed"><p>{a.permissions.join(", ")}</p>
            <p className="muted small">Can hand work to: {a.can_delegate_to.length ? a.can_delegate_to.join(", ").replace("*", "any agent") : "nobody"}</p></Section>
          <Section title="System prompt"><pre className="prompt">{a.system_prompt}</pre></Section>
        </>
      )}
    </div>
  );
}
