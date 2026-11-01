// Floor plan of the headquarters (metres). Departments are data, so new ones slot in without touching the scene.
// The HQ is an industrial loft: x -22..22, z -14 (ocean-facing window wall) .. 14 (street front, entrance at x 0).
export type Vec3 = [number, number, number];

/** label = the plaque on the desk ("SEO AGENT"); facing 0 = monitors face the front door. */
export interface Dept { id: string; label: string; role: string; pos: Vec3; color: string; facing: number }

export const BUILDING = { w: 44, d: 28, h: 7.4, floors: 2, floorH: 4 };

const BACK = -2.5, FRONT = 5;
export const DEPARTMENTS: Dept[] = [
  { id: "competitor", label: "Competitor Intelligence", role: "RESEARCH AGENT", pos: [-15, 0, BACK], color: "#1FA9FF", facing: 0 },
  { id: "executive", label: "Executive Operations", role: "EXECUTIVE AGENT", pos: [-8, 0, BACK], color: "#FFE81A", facing: 0 },
  { id: "customer", label: "Customer Operations", role: "OPERATIONS AGENT", pos: [-1, 0, BACK], color: "#39FF14", facing: 0 },
  { id: "growth", label: "Business Growth", role: "GROWTH AGENT", pos: [6, 0, BACK], color: "#FF1F1F", facing: 0 },
  { id: "seo", label: "Local SEO & Google Business", role: "SEO AGENT", pos: [-15, 0, FRONT], color: "#00FFC8", facing: 0 },
  { id: "technical", label: "Plumbing Research & Technical", role: "TECHNICAL AGENT", pos: [-8, 0, FRONT], color: "#FF7A00", facing: 0 },
  { id: "marketing", label: "Marketing & Content", role: "MARKETING AGENT", pos: [-1, 0, FRONT], color: "#A9B6C2", facing: 0 },
];

export const deptById = (id: string) => DEPARTMENTS.find((d) => d.id === id);

/** Extra agents (added at runtime) get the next free desk in the rows, then a third row. */
const OVERFLOW: Vec3[] = [[6, 0, FRONT], [13, 0, BACK], [-15, 0, 11], [-8, 0, 11], [-1, 0, 11]];
export function deskFor(agentId: string, index: number): Dept {
  const known = deptById(agentId);
  if (known) return known;
  const pos = OVERFLOW[Math.max(0, index - DEPARTMENTS.length) % OVERFLOW.length];
  return { id: agentId, label: agentId, role: `${agentId.toUpperCase()} AGENT`, pos, color: "#5B6B82", facing: 0 };
}

export const STATUS_COLOR: Record<string, string> = {
  idle: "#8A94A6", working: "#3D8BFF", researching: "#2FC1AE", reviewing: "#E0A23B", error: "#FF4B36", stopped: "#3A4457",
};

/** `via` makes the camera fly a path (e.g. through the front doors) instead of gliding straight there. */
export interface CameraPreset { id: string; label: string; pos: Vec3; target: Vec3; via?: Vec3[] }

export const CAMERAS: CameraPreset[] = [
  { id: "campus", label: "Plaza", pos: [30, 11, 82], target: [34, 7, -20] },
  { id: "exterior", label: "Outside", pos: [14, 9, 58], target: [2, 8, 4] },
  { id: "enter", label: "Enter HQ", pos: [4, 4.4, 13.2], target: [-5, 1.6, -4], via: [[3, 3.4, 30], [0, 2.8, 16.5], [1.5, 3.6, 13.6]] },
  { id: "command", label: "Command wall", pos: [-6, 3.3, 3.0], target: [-21.6, 3.9, 2.0] },
  { id: "executive", label: "Executive desk", pos: [-5.5, 3.4, 4], target: [-8, 1.6, BACK - 0.6] },
  { id: "lounge", label: "Lounge", pos: [3, 3.4, -4], target: [-12, 1.0, -10.5] },
];

export function focusOn(d: Dept): CameraPreset {
  const [x, , z] = d.pos;
  return { id: `agent-${d.id}`, label: d.label, pos: [x + 2.2, 3.4, z + 6.2], target: [x, 1.6, z - 0.6] };
}
