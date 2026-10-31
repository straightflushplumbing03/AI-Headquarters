import { useEffect, useState } from "react";
import { Agent, Dashboard, api, post } from "../api";
import { Empty, Section } from "./common";

interface SettingsData {
  limits: Record<string, number>; pricing: Record<string, [number, number]>; paused: boolean; emergency_stop: boolean;
  provider: { name: string; model: string | null; configured_keys: Record<string, boolean> };
  operating_hours: { enabled: boolean; start_hour: number; end_hour: number; tz: string };
  schedules: { id: string; agent_id: string; title: string; every_hours: number; enabled: boolean; last_run_at: string | null }[];
  audit_origins: string[]; permissions: string[];
}
interface Usage { by_agent: Record<string, { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>; total_cost_usd: number; calls: number }

const LIMIT_LABEL: Record<string, string> = {
  max_depth: "Hand-off chain depth", max_tasks_per_objective: "Tasks per objective", max_follow_ups_per_task: "Follow-ups per task",
  review_rounds: "Review rounds", correction_rounds: "Correction rounds", daily_task_limit: "Tasks per day",
  daily_token_limit: "Model tokens per day", daily_cost_limit_usd: "Spend per day (USD)", max_attempts: "Attempts per task",
  max_concurrent_tasks: "Concurrent tasks",
};

export default function ControlPanel({ agents, dashboard, owner, tick, notify }: {
  agents: Agent[]; dashboard: Dashboard | null; owner: boolean; tick: number; notify: (m: string, err?: boolean) => void;
}) {
  const [s, setS] = useState<SettingsData | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [prov, setProv] = useState({ name: "", model: "" });

  useEffect(() => {
    api<SettingsData>("/api/settings").then((x) => { setS(x); setLimits(x.limits); setProv({ name: x.provider.name, model: x.provider.model ?? "" }); });
    api<Usage>("/api/usage").then(setUsage);
  }, [tick]);

  if (!s) return <Empty>Loading controls…</Empty>;
  const save = async (body: Record<string, unknown>, msg: string) => {
    try { await api("/api/settings", { method: "PUT", body: JSON.stringify(body) }); notify(msg); }
    catch (e) { notify(String(e), true); }
  };
  const act = async (path: string, msg: string) => {
    try { await post(path); notify(msg); } catch (e) { notify(String(e), true); }
  };
  const togglePerm = (a: Agent, p: string) => {
    const next = a.permissions.includes(p) ? a.permissions.filter((x) => x !== p) : [...a.permissions, p];
    api(`/api/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ permissions: next }) })
      .then(() => notify(`Updated ${a.name}`)).catch((e) => notify(String(e), true));
  };
  const lock = !owner;

  return (
    <div className="panel-body">
      {lock && <p className="banner">Read-only. Sign in with the owner token to change anything here.</p>}
      <Section title="Operations">
        <div className="row-actions wrap">
          {s.paused ? <button disabled={lock} onClick={() => act("/api/control/resume", "Operations resumed")}>Resume all agents</button>
            : <button disabled={lock} className="ghost" onClick={() => act("/api/control/pause", "All agents paused")}>Pause all agents</button>}
          {s.emergency_stop
            ? <button disabled={lock} onClick={() => act("/api/control/emergency-clear", "Emergency stop cleared")}>Clear emergency stop</button>
            : <button disabled={lock} className="danger" onClick={() => act("/api/control/emergency-stop", "Emergency stop engaged")}>Emergency stop</button>}
        </div>
        <ul className="rows">
          {agents.map((a) => (
            <li key={a.id}><span>{a.name} <span className="muted small">{a.title}</span></span>
              <button disabled={lock} className="ghost small" onClick={() => act(`/api/agents/${a.id}/${a.enabled ? "stop" : "start"}`, `${a.name} ${a.enabled ? "stopped" : "started"}`)}>
                {a.enabled ? "Stop" : "Start"}</button></li>
          ))}
        </ul>
      </Section>

      <Section title="Model provider">
        <p className="muted small">API keys live only in the server environment (ANTHROPIC_API_KEY, OPENAI_API_KEY). Keys found:{" "}
          Anthropic {s.provider.configured_keys.anthropic ? "yes" : "no"}, OpenAI-compatible {s.provider.configured_keys.openai ? "yes" : "no"}.</p>
        <div className="grid2">
          <label>Provider
            <select disabled={lock} value={prov.name} onChange={(e) => setProv({ ...prov, name: e.target.value })}>
              <option value="simulated">Simulated (offline, no model)</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI-compatible</option>
            </select></label>
          <label>Model<input disabled={lock} value={prov.model} placeholder="provider default" onChange={(e) => setProv({ ...prov, model: e.target.value })} /></label>
        </div>
        <button disabled={lock} onClick={() => save({ provider: { name: prov.name, model: prov.model || null } }, "Provider saved")}>Save provider</button>
      </Section>

      <Section title="Limits">
        <div className="grid2">
          {Object.keys(limits).map((k) => (
            <label key={k}>{LIMIT_LABEL[k] ?? k}
              <input disabled={lock} type="number" min={0} step={k.includes("usd") ? 0.5 : 1} value={limits[k]}
                onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) })} /></label>
          ))}
        </div>
        <button disabled={lock} onClick={() => save({ limits }, "Limits saved")}>Save limits</button>
      </Section>

      <Section title="Schedules and hours">
        <ul className="rows">
          {s.schedules.map((sc) => (
            <li key={sc.id}>
              <label className="check"><input type="checkbox" disabled={lock} checked={sc.enabled}
                onChange={() => save({ schedules: s.schedules.map((x) => x.id === sc.id ? { ...x, enabled: !x.enabled } : x) }, "Schedule updated")} />
                {sc.title} <span className="muted small">every {sc.every_hours} h · {agents.find((a) => a.id === sc.agent_id)?.name}</span></label>
            </li>
          ))}
        </ul>
        <label className="check"><input type="checkbox" disabled={lock} checked={s.operating_hours.enabled}
          onChange={() => save({ operating_hours: { ...s.operating_hours, enabled: !s.operating_hours.enabled } }, "Hours updated")} />
          Only work between {s.operating_hours.start_hour}:00 and {s.operating_hours.end_hour}:00 Pacific</label>
      </Section>

      <Section title="Costs">
        {!usage || usage.calls === 0 ? <Empty>No model calls recorded yet.</Empty> : (
          <ul className="rows">
            {Object.entries(usage.by_agent).map(([id, u]) => (
              <li key={id}><span>{agents.find((a) => a.id === id)?.name ?? id}</span>
                <span className="muted small">{u.calls} calls · {(u.input_tokens + u.output_tokens).toLocaleString()} tokens · ${u.cost_usd.toFixed(4)}</span></li>
            ))}
            <li><strong>Total</strong><strong>${usage.total_cost_usd.toFixed(4)}</strong></li>
          </ul>
        )}
        <p className="muted small">Estimates from token counts and the price table in settings.</p>
      </Section>

      <Section title="Errors">
        {!dashboard || dashboard.alerts.length === 0 ? <Empty>No errors.</Empty> : (
          <ul className="rows alerts">{dashboard.alerts.map((a) => <li key={a.id}><span>{a.message}</span></li>)}</ul>
        )}
      </Section>

      <Section title="Permissions">
        <div className="perm-scroll">
          <table className="perms">
            <thead><tr><th scope="col">Agent</th>{s.permissions.map((p) => <th key={p} scope="col">{p}</th>)}</tr></thead>
            <tbody>{agents.map((a) => (
              <tr key={a.id}><th scope="row">{a.name}</th>{s.permissions.map((p) => (
                <td key={p}><input type="checkbox" aria-label={`${a.name} ${p}`} disabled={lock} checked={a.permissions.includes(p)} onChange={() => togglePerm(a, p)} /></td>
              ))}</tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted small">There is no permission for sending messages, publishing or spending. Those only happen when you approve them and do them yourself.</p>
      </Section>
    </div>
  );
}
