// Thin client for the HQ backend. Every number the UI shows comes from these calls.
import { useCallback, useEffect, useRef, useState } from "react";

export type AgentStatus = "idle" | "working" | "researching" | "reviewing" | "error" | "stopped";
export interface Agent {
  id: string; name: string; title: string; department: string; building: string; status: AgentStatus;
  enabled: boolean; current_task_id: number | null; last_error: string | null; last_active_at: string | null;
  permissions: string[]; can_delegate_to: string[]; model_override: string | null;
}
export interface AgentDetail extends Agent {
  system_prompt: string; personality: string; responsibilities: string[];
  task_counts: Record<string, number>; current_task: Task | null;
}
export interface Task {
  id: number; title: string; description: string; agent_id: string; created_by: string; objective_id: number | null;
  parent_task_id: number | null; depth: number; kind: string; status: string; attempts: number; max_attempts: number;
  error: string | null; result: Record<string, any> | null; simulated: boolean; created_at: string;
  started_at: string | null; finished_at: string | null; events?: { type: string; message: string; created_at: string }[];
}
export interface Objective {
  id: number; title: string; description: string; status: string; review_rounds_done: number;
  correction_rounds_done: number; final_report: string | null; simulated: boolean; created_at: string; tasks?: Task[];
}
export interface Approval {
  id: number; task_id: number | null; objective_id: number | null; agent_id: string; kind: string; summary: string;
  payload: Record<string, any>; status: string; simulated: boolean; created_at: string; decision_note: string | null;
}
export interface HQEvent {
  id: number; type: string; agent_id: string | null; task_id: number | null; objective_id: number | null;
  message: string; data: Record<string, any>; created_at: string;
}
export interface Message {
  id: number; from_agent: string; to_agent: string; task_id: number | null; objective_id: number | null;
  kind: string; body: string; created_at: string;
}
export interface Dashboard {
  agents_total: number; agents_online: number; agents_working: number; agents_idle: number; agents_error: number;
  tasks_completed: number; tasks_in_progress: number; tasks_pending: number; tasks_failed: number;
  pending_approvals: number; simulated_tasks: number; provider: string;
  daily_activity: { date: string; completed: number; failed: number }[];
  today: { tasks_started: number; tokens: number; cost_usd: number };
  current_projects: { id: number; title: string; status: string; simulated: boolean }[];
  latest_research: { id: number; agent_id: string; title: string; status: string; summary: string; simulated: boolean; finished_at: string | null }[];
  alerts: { id: number; type: string; message: string; created_at: string }[];
  opportunities: { id: number; title: string; summary: string; simulated: boolean }[];
  website_monitoring: null | { task_id: number; status: string; finished_at: string | null; pages_checked: number | null; issues: number };
  controls: { paused: boolean; emergency_stop: boolean };
}

const TOKEN_KEY = "hq-owner-token";
export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function setToken(t: string) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = getToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) } });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not json */ }
    throw new ApiError(r.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return r.json();
}
export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface HQState {
  agents: Agent[]; dashboard: Dashboard | null; approvals: Approval[]; events: HQEvent[]; messages: Message[];
  objectives: Objective[]; connected: boolean; error: string | null; handoffs: { id: number; from: string; to: string; at: number }[];
}

/** Live headquarters state: initial load, then refresh whenever the backend pushes an event over the WebSocket. */
export function useHQ(): HQState & { refresh: () => void } {
  const [s, setS] = useState<HQState>({ agents: [], dashboard: null, approvals: [], events: [], messages: [],
    objectives: [], connected: false, error: null, handoffs: [] });
  const pending = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [agents, dashboard, approvals, events, messages, objectives] = await Promise.all([
        api<Agent[]>("/api/agents"), api<Dashboard>("/api/dashboard"), api<Approval[]>("/api/approvals"),
        api<HQEvent[]>("/api/events?limit=80"), api<Message[]>("/api/messages?limit=60"), api<Objective[]>("/api/objectives"),
      ]);
      setS((p) => ({ ...p, agents, dashboard, approvals, events, messages, objectives, error: null }));
    } catch (e) {
      setS((p) => ({ ...p, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  const schedule = useCallback(() => {
    if (pending.current) return;
    pending.current = window.setTimeout(() => { pending.current = null; load(); }, 150);
  }, [load]);

  useEffect(() => {
    load();
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setS((p) => ({ ...p, connected: true }));
      ws.onclose = () => {
        setS((p) => ({ ...p, connected: false }));
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data) as HQEvent;
        if (ev.type === "hello") return;
        if (ev.type === "task.created" && ev.data?.created_by && !["owner", "system", "schedule"].includes(ev.data.created_by)) {
          const h = { id: ev.id, from: ev.data.created_by as string, to: ev.agent_id ?? "", at: performance.now() };
          setS((p) => ({ ...p, handoffs: [...p.handoffs.slice(-12), h] }));
        }
        schedule();
      };
    };
    connect();
    const poll = window.setInterval(load, 15000); // safety net if the socket drops silently
    return () => { closed = true; ws?.close(); window.clearTimeout(retry); window.clearInterval(poll); };
  }, [load, schedule]);

  return { ...s, refresh: load };
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Idle", working: "Working", researching: "Researching", reviewing: "Reviewing", error: "Error", stopped: "Stopped",
};

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
