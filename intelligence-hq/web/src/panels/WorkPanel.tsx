import { FormEvent, useEffect, useState } from "react";
import { Agent, Approval, Message, Objective, Task, ago, api, post } from "../api";
import { AgentName, Empty, Section, Sim, TaskRow } from "./common";

const OBJ_LABEL: Record<string, string> = {
  planning: "Planning", in_progress: "Agents working", review: "Peer review", correcting: "Corrections",
  consolidating: "Consolidating", awaiting_owner: "Waiting for you", completed: "Approved", rejected: "Rejected",
  failed: "Failed", cancelled: "Cancelled",
};

export function ObjectivesPanel({ objectives, agents, owner, tick, openTask, notify }: {
  objectives: Objective[]; agents: Agent[]; owner: boolean; tick: number; openTask: (t: Task) => void;
  notify: (m: string, err?: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [open, setOpen] = useState<number | null>(objectives[0]?.id ?? null);
  const [detail, setDetail] = useState<Objective | null>(null);

  useEffect(() => {
    if (open == null) { setDetail(null); return; }
    api<Objective>(`/api/objectives/${open}`).then(setDetail).catch(() => setDetail(null));
  }, [open, tick]);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const o = await post<Objective>("/api/objectives", { title, description: desc });
      notify("Ace is planning the objective"); setTitle(""); setDesc(""); setOpen(o.id);
    } catch (err) { notify(String(err), true); }
  };

  return (
    <div className="panel-body">
      {owner && (
        <form className="form" onSubmit={start}>
          <label htmlFor="obj-title">Set a business objective</label>
          <input id="obj-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required
            placeholder="e.g. Get more slab leak calls from Mission Viejo" />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} aria-label="Objective details"
            placeholder="Anything the team should know (optional)" />
          <button type="submit">Start objective</button>
          <p className="muted small">Ace splits it into tasks, the specialists work and review each other, and the final recommendation comes back to you for approval.</p>
        </form>
      )}
      {objectives.length === 0 ? <Empty>No objectives yet.</Empty> : (
        <ul className="objectives">
          {objectives.map((o) => (
            <li key={o.id} className={open === o.id ? "open" : ""}>
              <button className="obj-head" aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>
                <span>{o.title}</span>
                <span className={`pill pill-obj-${o.status}`}>{OBJ_LABEL[o.status] ?? o.status}</span>
              </button>
              {open === o.id && detail?.id === o.id && (
                <div className="obj-body">
                  <ObjectiveSteps o={detail} />
                  <ul className="tasks">{(detail.tasks ?? []).map((t) => (
                    <TaskRow key={t.id} t={{ ...t, title: `${"↳ ".repeat(Math.min(t.depth, 3))}${t.title}` }} agents={agents} onOpen={openTask} />
                  ))}</ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ObjectiveSteps({ o }: { o: Objective }) {
  const order = ["planning", "in_progress", "review", "correcting", "consolidating", "awaiting_owner", "completed"];
  const at = order.indexOf(o.status);
  return (
    <ol className="steps" aria-label="Objective progress">
      {order.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? "here" : ""}>{OBJ_LABEL[s]}</li>
      ))}
    </ol>
  );
}

export function MessagesPanel({ messages, agents }: { messages: Message[]; agents: Agent[] }) {
  if (messages.length === 0) return <div className="panel-body"><Empty>No agent-to-agent messages yet. They appear when agents hand off work, request corrections or report results.</Empty></div>;
  return (
    <div className="panel-body">
      <ul className="messages">
        {messages.map((m) => (
          <li key={m.id}>
            <p className="msg-head"><strong><AgentName id={m.from_agent} agents={agents} /></strong> to{" "}
              <strong><AgentName id={m.to_agent} agents={agents} /></strong>
              <span className="muted small"> · {m.kind}{m.task_id ? ` · task #${m.task_id}` : ""} · {ago(m.created_at)}</span></p>
            <p className="pre clip3">{m.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApprovalsPanel({ approvals, agents, owner, notify, openTaskId }: {
  approvals: Approval[]; agents: Agent[]; owner: boolean; notify: (m: string, err?: boolean) => void; openTaskId: (id: number) => void;
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending").slice(0, 20);
  const decide = async (a: Approval, ok: boolean) => {
    try {
      await post(`/api/approvals/${a.id}/${ok ? "approve" : "reject"}`, { note: notes[a.id] ?? "" });
      notify(ok ? "Approved" : "Rejected");
    } catch (e) { notify(String(e), true); }
  };
  const KIND: Record<string, string> = { recommendation: "Recommendation", customer_message: "Customer message draft",
    publish_content: "Content to publish", spend: "Spending" };
  return (
    <div className="panel-body">
      <Section title={`Waiting for you (${pending.length})`}>
        {pending.length === 0 ? <Empty>Nothing needs your approval.</Empty> : (
          <ul className="approvals">
            {pending.map((a) => (
              <li key={a.id}>
                <p className="msg-head"><strong>{KIND[a.kind] ?? a.kind}</strong> from <AgentName id={a.agent_id} agents={agents} />
                  <span className="muted small"> · {ago(a.created_at)}</span> <Sim on={a.simulated} /></p>
                <p>{a.summary}</p>
                {a.payload?.draft && <pre className="prompt">{typeof a.payload.draft === "string" ? a.payload.draft : JSON.stringify(a.payload.draft, null, 2)}</pre>}
                {a.kind === "customer_message" && <p className="muted small">Approving does not send anything. This system has no email or SMS connection; copy the draft and send it yourself.</p>}
                {a.task_id && <button className="linklike small" onClick={() => openTaskId(a.task_id!)}>Open the task behind this</button>}
                {owner ? (
                  <div className="row-actions">
                    <input aria-label="Note" placeholder="Note (optional)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                    <button onClick={() => decide(a, true)}>Approve</button>
                    <button className="ghost" onClick={() => decide(a, false)}>Reject</button>
                  </div>
                ) : <p className="muted small">Sign in as owner to decide.</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Decided">
        {decided.length === 0 ? <Empty>No decisions yet.</Empty> : (
          <ul className="rows">{decided.map((a) => <li key={a.id}><span>{a.summary}</span><span className={`pill pill-${a.status}`}>{a.status}</span></li>)}</ul>
        )}
      </Section>
    </div>
  );
}
