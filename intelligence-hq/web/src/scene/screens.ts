// Canvas textures for every screen and sign in the HQ. Screens draw only real API data; anything not connected says so.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Agent, Dashboard, STATUS_LABEL, ago } from "../api";
import { DISPLAY } from "./textures";

const BODY = "'Barlow', sans-serif";
const ICE = "#4FC3FF";

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return { c, g: c.getContext("2d")! };
}
export function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** The company logo (and fonts) as they load; textures re-draw when either arrives. */
export function useBrand() {
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const img = new Image(); img.onload = () => setLogo(img); img.src = "/logo.jpg";
    document.fonts?.ready.then(() => setFonts((n) => n + 1));
  }, []);
  return { logo, fonts };
}
/** Optional photo the owner can drop in at web/public/<name>; null when absent. */
export function useOptionalImage(src: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.onerror = () => setImg(null); i.src = src; }, [src]);
  return img;
}
/** Re-creates a canvas texture when inputs change and frees the old one. */
export function useCanvasTexture(draw: () => THREE.CanvasTexture, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(draw, deps);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.save(); g.fillStyle = color; g.shadowColor = color; g.shadowBlur = r * 2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
}
const STATUS_HEX: Record<string, string> = {
  idle: "#8FA3BF", working: "#3D8BFF", researching: "#2FE0C4", reviewing: "#F2B544", error: "#FF5A48", stopped: "#5B6B82",
};

// ------------------------------------------------------------------------------------------------ big logo sign
/** Lit sign: the real logo on a white plate, used on the loft wall and the building facade. */
export function logoSignTexture(logo: HTMLImageElement | null, tagline = "ALWAYS A SAFE BET") {
  const { c, g } = canvas(1600, 1000);
  g.fillStyle = "#1A1612"; g.fillRect(0, 0, 1600, 1000);
  const grad = g.createRadialGradient(800, 420, 50, 800, 420, 900);
  grad.addColorStop(0, "rgba(255,214,150,0.35)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 1600, 1000);
  if (logo?.naturalWidth) {
    const cropH = logo.naturalHeight * 0.7;           // mark + name; the tagline is drawn larger below
    const w = 1300, h = w * (cropH / logo.naturalWidth);
    g.shadowColor = "rgba(255,226,170,0.9)"; g.shadowBlur = 60; g.fillStyle = "#FFFFFF";
    rrect(g, (1600 - w) / 2 - 30, 70, w + 60, h + 40, 30); g.fill();
    g.shadowBlur = 0;
    g.drawImage(logo, 0, 0, logo.naturalWidth, cropH, (1600 - w) / 2, 90, w, h);
  }
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.shadowColor = "#FFD08A"; g.shadowBlur = 30; g.fillStyle = "#FFF6E6";
  g.font = `700 150px ${DISPLAY}`; g.fillText(tagline, 800, 940, 1500);
  return toTexture(c);
}

// ------------------------------------------------------------------------------------------------ command wall
/** "AI Headquarters" wall screen. Every figure is live from the API; integrations not built say "Not connected". */
export function commandTexture(d: Dashboard | null, agents: Agent[]) {
  const W = 2048, H = 1152;
  const { c, g } = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#0A1A33"); bg.addColorStop(1, "#06101F");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,0.03)"; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.fillStyle = "#FFFFFF"; g.font = `700 64px ${DISPLAY}`; g.fillText("AI HEADQUARTERS", 60, 96);
  g.fillStyle = "#7FD8FF"; g.font = `500 34px ${BODY}`; g.fillText("Straight Flush Plumbing & Leak Detection · live", 60, 142);
  if (!d) { g.fillStyle = "#CFE9FF"; g.font = `500 60px ${BODY}`; g.fillText("Connecting to headquarters…", 60, 560); return toTexture(c); }
  const simulated = d.provider === "simulated";
  if (simulated) {
    g.font = `600 34px ${BODY}`; const t = "Simulated model · results are placeholders"; const tw = g.measureText(t).width;
    g.fillStyle = "rgba(255,176,32,0.18)"; g.strokeStyle = "#FFB020"; g.lineWidth = 3;
    rrect(g, W - tw - 110, 52, tw + 60, 60, 12); g.fill(); g.stroke();
    g.fillStyle = "#FFCF70"; g.fillText(t, W - tw - 80, 94);
  }
  // KPI tiles
  const tiles: [string, string, string][] = [
    ["Total agents", String(d.agents_total), `${d.agents_online} online`],
    ["Active tasks", String(d.tasks_in_progress + d.tasks_pending), `${d.tasks_pending} queued`],
    ["In progress", String(d.tasks_in_progress), `${d.agents_working} agents busy`],
    ["Completed", String(d.tasks_completed), `${d.tasks_failed} failed`],
    ["Waiting for Lance", String(d.pending_approvals), d.pending_approvals ? "open Approvals" : "nothing to approve"],
  ];
  const tw = (W - 120 - 4 * 24) / 5;
  tiles.forEach(([label, value, sub], i) => {
    const x = 60 + i * (tw + 24), y = 180;
    g.fillStyle = "rgba(20,52,96,0.75)"; g.strokeStyle = "rgba(79,195,255,0.6)"; g.lineWidth = 2;
    rrect(g, x, y, tw, 210, 18); g.fill(); g.stroke();
    g.fillStyle = "#BFD8F2"; g.font = `500 32px ${BODY}`; g.fillText(label, x + 28, y + 54);
    g.fillStyle = "#FFFFFF"; g.font = `700 96px ${DISPLAY}`; g.fillText(value, x + 28, y + 150);
    g.fillStyle = i === 3 && d.tasks_failed ? "#FFB070" : "#5BE3A4"; g.font = `500 28px ${BODY}`; g.fillText(sub, x + 28, y + 192);
  });
  // three columns
  const top = 430, ch = H - top - 50, cw = (W - 120 - 48) / 3;
  const col = (i: number, title: string) => {
    const x = 60 + i * (cw + 24);
    g.fillStyle = "rgba(14,36,70,0.75)"; g.strokeStyle = "rgba(79,195,255,0.4)"; g.lineWidth = 2;
    rrect(g, x, top, cw, ch, 18); g.fill(); g.stroke();
    g.fillStyle = "#7FD8FF"; g.font = `700 34px ${DISPLAY}`; g.fillText(title, x + 28, top + 56);
    return x + 28;
  };
  let x = col(0, "AGENT ACTIVITY");
  agents.slice(0, 9).forEach((a, i) => {
    const y = top + 112 + i * 62;
    dot(g, x + 10, y - 10, 10, STATUS_HEX[a.status] ?? "#8FA3BF");
    g.fillStyle = "#FFFFFF"; g.font = `600 34px ${BODY}`; g.fillText(a.name, x + 36, y);
    g.fillStyle = STATUS_HEX[a.status] ?? "#8FA3BF"; g.font = `500 30px ${BODY}`;
    g.textAlign = "right"; g.fillText(STATUS_LABEL[a.status], x + cw - 56, y); g.textAlign = "left";
  });
  x = col(1, "RECENT WORK");
  const recent = d.latest_research.slice(0, 7);
  if (!recent.length) { g.fillStyle = "#9FB6D6"; g.font = `500 32px ${BODY}`; g.fillText("No finished work yet.", x, top + 118); }
  recent.forEach((r, i) => {
    const y = top + 112 + i * 70;
    g.fillStyle = "#E6F4FF"; g.font = `500 30px ${BODY}`; g.fillText(r.title, x, y, cw - 80);
    g.fillStyle = r.simulated ? "#FFCF70" : "#7FD8FF"; g.font = `500 24px ${BODY}`;
    g.fillText(`${r.agent_id} · ${r.status}${r.simulated ? " · simulated" : ""}`, x, y + 30, cw - 80);
  });
  x = col(2, "INTEGRATIONS");
  const integ: [string, string, boolean][] = [
    ["AI model", simulated ? "Simulated" : d.provider, !simulated],
    ["Website audit (read-only)", d.website_monitoring ? `${d.website_monitoring.issues} issues` : "Ready", true],
    ["Work queue", d.controls.emergency_stop ? "Emergency stop" : d.controls.paused ? "Paused" : "Running", !d.controls.paused && !d.controls.emergency_stop],
    ["Google Business Profile", "Not connected", false],
    ["Search Console", "Not connected", false],
    ["Joist", "Not connected", false],
  ];
  integ.forEach(([name, val, ok], i) => {
    const y = top + 112 + i * 76;
    dot(g, x + 10, y - 10, 10, ok ? "#39E07A" : "#5B6B82");
    g.fillStyle = "#FFFFFF"; g.font = `500 32px ${BODY}`; g.fillText(name, x + 36, y, cw - 300);
    g.fillStyle = ok ? "#5BE3A4" : "#8FA3BF"; g.font = `500 28px ${BODY}`;
    g.textAlign = "right"; g.fillText(val, x + cw - 56, y); g.textAlign = "left";
  });
  return toTexture(c);
}

// ------------------------------------------------------------------------------------------------ desk monitors
/** Main monitor: who the agent is, live status, current task, last activity, last error. */
export function monitorTexture(a: Agent, role: string, color: string) {
  const W = 1024, H = 576;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#0B1526"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#13233D"; g.fillRect(0, 0, W, 86);
  dot(g, 46, 43, 14, color);
  g.fillStyle = "#FFFFFF"; g.font = `700 44px ${DISPLAY}`; g.textBaseline = "middle"; g.fillText(a.name.toUpperCase(), 78, 46);
  g.fillStyle = "#9FB6D6"; g.font = `500 28px ${BODY}`; g.textAlign = "right"; g.fillText(role, W - 36, 46); g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const st = STATUS_HEX[a.status] ?? "#8FA3BF";
  g.fillStyle = st + "33"; rrect(g, 36, 120, 330, 72, 36); g.fill();
  g.strokeStyle = st; g.lineWidth = 3; g.stroke();
  g.fillStyle = st; g.font = `700 40px ${DISPLAY}`; g.textAlign = "center"; g.fillText(STATUS_LABEL[a.status].toUpperCase(), 201, 170); g.textAlign = "left";
  g.fillStyle = "#E6F4FF"; g.font = `500 36px ${BODY}`;
  g.fillText(a.current_task_id ? `Working on task #${a.current_task_id}` : a.enabled ? "No task assigned" : "Stopped by owner", 36, 270, W - 72);
  g.fillStyle = "#9FB6D6"; g.font = `500 30px ${BODY}`;
  g.fillText(a.last_active_at ? `Last active ${ago(a.last_active_at)}` : "Not active yet", 36, 330);
  g.fillText(`Tools: ${a.permissions.filter((p) => p !== "llm.reason").join(", ") || "reasoning only"}`, 36, 390, W - 72);
  if (a.last_error) { g.fillStyle = "#FF8A7A"; g.fillText(`Last error: ${a.last_error}`, 36, 450, W - 72); }
  g.fillStyle = color; g.fillRect(0, H - 10, W, 10);
  return toTexture(c);
}

/** Side monitor: who this agent can hand work to (real delegation rules). */
export function sideMonitorTexture(a: Agent, agents: Agent[], color: string) {
  const W = 768, H = 576;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#0B1526"; g.fillRect(0, 0, W, H);
  g.fillStyle = color; g.font = `700 34px ${DISPLAY}`; g.fillText("HANDS WORK TO", 36, 70);
  const targets = a.can_delegate_to.includes("*") ? agents.filter((x) => x.id !== a.id) : agents.filter((x) => a.can_delegate_to.includes(x.id));
  g.font = `500 32px ${BODY}`;
  if (!targets.length) { g.fillStyle = "#9FB6D6"; g.fillText("Nobody (reports to Lance)", 36, 140); }
  targets.slice(0, 6).forEach((t, i) => {
    const y = 140 + i * 66;
    dot(g, 52, y - 10, 10, STATUS_HEX[t.status] ?? "#8FA3BF");
    g.fillStyle = "#E6F4FF"; g.fillText(t.name, 80, y);
    g.fillStyle = "#7F96B3"; g.textAlign = "right"; g.fillText(STATUS_LABEL[t.status], W - 36, y); g.textAlign = "left";
  });
  return toTexture(c);
}

// ------------------------------------------------------------------------------------------------ signage
export function plaqueTexture(role: string, name: string, color: string) {
  const { c, g } = canvas(768, 160);
  g.fillStyle = "#0E0F12"; rrect(g, 0, 0, 768, 160, 18); g.fill();
  g.strokeStyle = "#5C5346"; g.lineWidth = 4; rrect(g, 6, 6, 756, 148, 14); g.stroke();
  g.textAlign = "center"; g.fillStyle = "#F4ECDD"; g.font = `700 58px ${DISPLAY}`; g.fillText(role, 384, 78, 720);
  g.fillStyle = color; g.font = `600 38px ${BODY}`; g.fillText(name.toUpperCase(), 384, 128, 720);
  return toTexture(c);
}

/** Neon script sign (transparent background). */
export function neonTexture(lines: string[], color: string, w = 1024, h = 512) {
  const { c, g } = canvas(w, h);
  g.textAlign = "center"; g.textBaseline = "middle";
  const size = Math.min(150, (h * 0.8) / lines.length);
  lines.forEach((l, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * size * 1.05;
    g.font = `italic 600 ${size}px ${DISPLAY}`;
    for (const [blur, alpha] of [[60, 0.9], [24, 1], [6, 1]] as const) {
      g.shadowColor = color; g.shadowBlur = blur; g.globalAlpha = alpha; g.fillStyle = blur === 6 ? "#FFE9E6" : color;
      g.fillText(l, w / 2, y, w - 40);
    }
  });
  g.globalAlpha = 1;
  return toTexture(c);
}

/** Floor mat with the logo, like the one at the door. */
export function rugTexture(logo: HTMLImageElement | null, tagline = "ALWAYS A SAFE BET") {
  const { c, g } = canvas(1600, 800);
  g.fillStyle = "#101318"; rrect(g, 0, 0, 1600, 800, 40); g.fill();
  g.strokeStyle = "#2E3440"; g.lineWidth = 16; rrect(g, 24, 24, 1552, 752, 30); g.stroke();
  if (logo?.naturalWidth) {
    const cropH = logo.naturalHeight * 0.7, w = 1100, h = w * (cropH / logo.naturalWidth);
    g.fillStyle = "#F7F7F5"; rrect(g, (1600 - w) / 2 - 24, 70, w + 48, h + 30, 22); g.fill();
    g.drawImage(logo, 0, 0, logo.naturalWidth, cropH, (1600 - w) / 2, 85, w, h);
  }
  g.textAlign = "center"; g.fillStyle = "#F4F4F2"; g.font = `700 120px ${DISPLAY}`; g.fillText(tagline, 800, 735, 1450);
  return toTexture(c);
}

/** Generic sign: title + optional lines, for plaza screens. */
export function signTexture(lines: { text: string; size: number; color: string; weight?: number; font?: string }[],
  w = 1600, h = 600, bg = "#0B1630", border = ICE) {
  const { c, g } = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = border; g.lineWidth = 10; g.shadowColor = border; g.shadowBlur = 24; g.strokeRect(10, 10, w - 20, h - 20); g.shadowBlur = 0;
  const total = lines.reduce((a, l) => a + l.size * 1.25, 0);
  let y = (h - total) / 2 + lines[0].size;
  g.textAlign = "center";
  for (const l of lines) {
    g.font = `${l.weight ?? 600} ${l.size}px ${l.font ?? DISPLAY}`;
    g.shadowColor = l.color; g.shadowBlur = 16; g.fillStyle = l.color; g.fillText(l.text, w / 2, y, w - 80);
    y += l.size * 1.25;
  }
  return toTexture(c);
}
