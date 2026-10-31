import { FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { STATUS_LABEL, Task, api, getToken, post, setToken, useHQ } from "./api";
import AgentPanel from "./panels/AgentPanel";
import ControlPanel from "./panels/ControlPanel";
import DashboardPanel from "./panels/DashboardPanel";
import { ApprovalsPanel, MessagesPanel, ObjectivesPanel } from "./panels/WorkPanel";
import { StatusDot, TaskDetail } from "./panels/common";
import { CAMERAS, CameraPreset, deskFor, focusOn } from "./scene/layout";

const HQScene = lazy(() => import("./scene/HQScene"));
type Tab = "dashboard" | "agent" | "objectives" | "messages" | "approvals" | "controls";

export default function App() {
  const hq = useHQ();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selected, setSelected] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraPreset>(CAMERAS[0]);
  const [task, setTask] = useState<Task | null>(null);
  const [toast, setToast] = useState<{ m: string; err: boolean } | null>(null);
  const [owner, setOwner] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [showSignin, setShowSignin] = useState(false);
  const reducedMotion = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const tick = hq.events[0]?.id ?? 0;

  const notify = useCallback((m: string, err = false) => {
    setToast({ m: m.replace(/^Error: /, ""), err });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api("/api/auth/check").then(() => setOwner(true)).catch(() => { setToken(""); setOwner(false); });
  }, []);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setToken(tokenInput.trim());
    try { await api("/api/auth/check"); setOwner(true); setShowSignin(false); setTokenInput(""); notify("Signed in as owner"); }
    catch { setToken(""); notify("That owner token was not accepted", true); }
  };

  const selectAgent = useCallback((id: string) => {
    setSelected(id);
    setTab("agent");
    const idx = hq.agents.findIndex((a) => a.id === id);
    setCamera(focusOn(deskFor(id, Math.max(0, idx))));
  }, [hq.agents]);

  const openTaskId = useCallback((id: number) => {
    api<Task>(`/api/tasks/${id}`).then(setTask).catch((e) => notify(String(e), true));
  }, [notify]);
  const openTask = useCallback((t: Task) => openTaskId(t.id), [openTaskId]);

  const d = hq.dashboard;
  const pendingApprovals = hq.approvals.filter((a) => a.status === "pending").length;
  const estop = d?.controls.emergency_stop, paused = d?.controls.paused;

  const tabs: [Tab, string, number?][] = [
    ["dashboard", "Dashboard"], ["agent", "Agents"], ["objectives", "Objectives"],
    ["messages", "Messages"], ["approvals", "Approvals", pendingApprovals], ["controls", "Controls"],
  ];

  return (
    <div className={`app${estop ? " is-estop" : ""}`}>
      <header className="topbar">
        <a className="brand" href="https://straightflushplumbingoc.com" target="_blank" rel="noreferrer">
          <img src="/logo.jpg" alt="Straight Flush Plumbing & Leak Detection" />
          <span><b>Straight Flush</b> Intelligence HQ</span>
        </a>
        <div className="live">
          <span className={`conn ${hq.connected ? "on" : "off"}`}>{hq.connected ? "Live" : "Reconnecting"}</span>
          {d && <span className={d.provider === "simulated" ? "provider sim" : "provider"}>
            {d.provider === "simulated" ? "Simulated model" : `Model: ${d.provider}`}</span>}
          {estop && <span className="estop-flag">Emergency stop</span>}
          {!estop && paused && <span className="paused-flag">Paused</span>}
        </div>
        <div className="top-actions">
          {owner ? (
            <>
              {!estop && <button className="danger" onClick={() => post("/api/control/emergency-stop").then(() => notify("Emergency stop engaged"))}>Emergency stop</button>}
              <button className="ghost" onClick={() => { setToken(""); setOwner(false); notify("Signed out"); }}>Sign out</button>
            </>
          ) : <button onClick={() => setShowSignin(true)}>Owner sign-in</button>}
        </div>
      </header>

      <main className="stage">
        <div className="scene" aria-label="3D view of the headquarters. Click an agent to open their desk.">
          <Suspense fallback={<div className="scene-loading">Building the headquarters…</div>}>
            <HQScene agents={hq.agents} dashboard={d} handoffs={hq.handoffs} selected={selected} onSelect={selectAgent}
              camera={camera} reducedMotion={reducedMotion} />
          </Suspense>
          <nav className="camdock" aria-label="Go to">
            {CAMERAS.map((c) => (
              <button key={c.id} aria-pressed={camera.id === c.id} onClick={() => setCamera(c)}>{c.label}</button>
            ))}
          </nav>
          <ul className="roster" aria-label="Agents">
            {hq.agents.map((a) => (
              <li key={a.id}>
                <button aria-pressed={selected === a.id} onClick={() => selectAgent(a.id)} title={`${a.title}: ${STATUS_LABEL[a.status]}`}>
                  <StatusDot status={a.status} />{a.name}<small>{STATUS_LABEL[a.status]}</small>
                </button>
              </li>
            ))}
          </ul>
          <ol className="ticker" aria-live="polite" aria-label="Latest activity">
            {hq.events.slice(0, 4).map((e) => <li key={e.id}>{e.message}</li>)}
          </ol>
          {hq.error && <p className="scene-error">Can't reach the headquarters server: {hq.error}</p>}
        </div>

        <aside className="side">
          <nav className="tabs" role="tablist">
            {tabs.map(([id, label, badge]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}{badge ? <><span className="badge" aria-hidden>{badge}</span><span className="sr-only"> ({badge} waiting)</span></> : null}
              </button>
            ))}
          </nav>
          {tab === "dashboard" && <DashboardPanel d={d} agents={hq.agents} openTask={openTaskId} />}
          {tab === "agent" && (selected
            ? <AgentPanel agentId={selected} agents={hq.agents} tick={tick} owner={owner} openTask={openTask} notify={notify} />
            : <div className="panel-body"><p className="empty">Pick an agent in the office or from the list on the left.</p>
                <ul className="rows">{hq.agents.map((a) => <li key={a.id}><button className="linklike" onClick={() => selectAgent(a.id)}>
                  <StatusDot status={a.status} /> {a.name}, {a.title}</button></li>)}</ul></div>)}
          {tab === "objectives" && <ObjectivesPanel objectives={hq.objectives} agents={hq.agents} owner={owner} tick={tick} openTask={openTask} notify={notify} />}
          {tab === "messages" && <MessagesPanel messages={hq.messages} agents={hq.agents} />}
          {tab === "approvals" && <ApprovalsPanel approvals={hq.approvals} agents={hq.agents} owner={owner} notify={notify} openTaskId={openTaskId} />}
          {tab === "controls" && <ControlPanel agents={hq.agents} dashboard={d} owner={owner} tick={tick} notify={notify} />}
        </aside>
      </main>

      {task && <div className="overlay" onClick={() => setTask(null)}><div onClick={(e) => e.stopPropagation()}>
        <TaskDetail t={task} agents={hq.agents} onClose={() => setTask(null)} /></div></div>}

      {showSignin && (
        <div className="overlay" onClick={() => setShowSignin(false)}>
          <form className="detail signin" onClick={(e) => e.stopPropagation()} onSubmit={signIn}>
            <h3>Owner sign-in</h3>
            <p className="muted">Paste the owner token from the server (HQ_OWNER_TOKEN, or the one printed when the server started). Everyone else gets a read-only view.</p>
            <input autoFocus type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} aria-label="Owner token" required />
            <div className="row-actions"><button type="submit">Sign in</button><button type="button" className="ghost" onClick={() => setShowSignin(false)}>Cancel</button></div>
          </form>
        </div>
      )}
      {toast && <div className={`toast${toast.err ? " toast-err" : ""}`} role="status">{toast.m}</div>}
    </div>
  );
}
