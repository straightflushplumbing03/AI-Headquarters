import { Agent, Dashboard, ago } from "../api";
import { AgentName, Empty, Section, Sim } from "./common";

export default function DashboardPanel({ d, agents, openTask }: { d: Dashboard | null; agents: Agent[]; openTask: (id: number) => void }) {
  if (!d) return <Empty>Loading live data from the headquarters…</Empty>;
  const maxDay = Math.max(1, ...d.daily_activity.map((x) => x.completed + x.failed));
  const nothing = d.tasks_completed + d.tasks_failed + d.tasks_in_progress + d.tasks_pending === 0;
  return (
    <div className="panel-body">
      {d.provider === "simulated" && (
        <p className="banner">
          Running on the simulated model provider. Work moves through the real queue, review and approval steps,
          but no model is called and results are placeholders. Connect a provider in Controls for real research.
        </p>
      )}
      <div className="stats">
        <Stat n={d.agents_online} of={d.agents_total} label="agents online" />
        <Stat n={d.agents_working} label="working now" />
        <Stat n={d.agents_idle} label="idle" />
        <Stat n={d.tasks_completed} label="tasks done" />
        <Stat n={d.tasks_in_progress} label="in progress" />
        <Stat n={d.tasks_failed} label="failed" warn={d.tasks_failed > 0} />
        <Stat n={d.pending_approvals} label="need your approval" warn={d.pending_approvals > 0} />
        <Stat n={d.tasks_pending} label="queued" />
      </div>

      <Section title="Activity, last 14 days">
        {nothing ? <Empty>No tasks have run yet. Start an objective or assign a task and it will show up here.</Empty> : (
          <svg className="bars" viewBox={`0 0 ${d.daily_activity.length * 20} 64`} role="img"
            aria-label="Completed and failed tasks per day">
            {d.daily_activity.map((x, i) => {
              const hc = (x.completed / maxDay) * 56, hf = (x.failed / maxDay) * 56;
              return (
                <g key={x.date}>
                  <title>{`${x.date}: ${x.completed} done, ${x.failed} failed`}</title>
                  <rect x={i * 20 + 3} y={60 - hc} width={14} height={hc} className="bar-ok" />
                  <rect x={i * 20 + 3} y={60 - hc - hf} width={14} height={hf} className="bar-fail" />
                </g>
              );
            })}
            <line x1="0" x2={d.daily_activity.length * 20} y1="60.5" y2="60.5" className="axis" />
          </svg>
        )}
        <p className="muted small">Today: {d.today.tasks_started} tasks started, {d.today.tokens.toLocaleString()} tokens, ${d.today.cost_usd.toFixed(2)} estimated</p>
      </Section>

      <Section title="Current projects">
        {d.current_projects.length === 0 ? <Empty>No objectives yet.</Empty> : (
          <ul className="rows">{d.current_projects.map((o) => (
            <li key={o.id}><span>{o.title}</span><span className={`pill pill-obj-${o.status}`}>{o.status === "awaiting_owner" ? "Waiting for you" : o.status.replace("_", " ")}</span><Sim on={o.simulated} /></li>
          ))}</ul>
        )}
      </Section>

      <Section title="Latest research and results">
        {d.latest_research.length === 0 ? <Empty>Nothing finished yet.</Empty> : (
          <ul className="rows">{d.latest_research.map((t) => (
            <li key={t.id}>
              <button className="linklike" onClick={() => openTask(t.id)}>
                <strong><AgentName id={t.agent_id} agents={agents} />:</strong> {t.title}
                <span className="muted small"> · {ago(t.finished_at)}</span> <Sim on={t.simulated} />
                {t.summary && <span className="clip">{t.summary}</span>}
              </button>
            </li>
          ))}</ul>
        )}
      </Section>

      <Section title="Alerts">
        {d.alerts.length === 0 ? <Empty>No failures, limit hits or permission blocks.</Empty> : (
          <ul className="rows alerts">{d.alerts.map((a) => <li key={a.id}><span>{a.message}</span><span className="muted small">{ago(a.created_at)}</span></li>)}</ul>
        )}
      </Section>

      <Section title="Business opportunities">
        {d.opportunities.length === 0 ? <Empty>Miles hasn't completed any opportunity research yet.</Empty> : (
          <ul className="rows">{d.opportunities.map((o) => (
            <li key={o.id}><button className="linklike" onClick={() => openTask(o.id)}>{o.title} <Sim on={o.simulated} />
              <span className="clip">{o.summary}</span></button></li>
          ))}</ul>
        )}
      </Section>

      <Section title="Website and SEO monitoring">
        {!d.website_monitoring ? <Empty>No site audit has run. Turn on the weekly audit schedule in Controls, or ask Nova for one.</Empty> : (
          <p><button className="linklike" onClick={() => openTask(d.website_monitoring!.task_id)}>
            Last audit {ago(d.website_monitoring.finished_at)}: {d.website_monitoring.status}, {d.website_monitoring.pages_checked ?? 0} pages checked,
            {" "}{d.website_monitoring.issues} issues</button></p>
        )}
      </Section>
    </div>
  );
}

function Stat({ n, of, label, warn }: { n: number; of?: number; label: string; warn?: boolean }) {
  return (
    <div className={`stat${warn ? " stat-warn" : ""}`}>
      <span className="stat-n">{n}{of !== undefined && <small>/{of}</small>}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}
