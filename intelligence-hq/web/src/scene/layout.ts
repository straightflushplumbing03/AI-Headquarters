// Floor plan of the headquarters (metres). Departments are data, so new ones slot in without touching the scene.
export type Vec3 = [number, number, number];

export interface Dept { id: string; label: string; pos: Vec3; color: string; facing: number }

export const BUILDING = { w: 44, d: 28, h: 7.2 };

export const DEPARTMENTS: Dept[] = [
  { id: "executive", label: "Executive Office", pos: [0, 0, -9.5], color: "#FFE81A", facing: 0 },
  { id: "seo", label: "Local SEO & Google Business", pos: [-15, 0, 6], color: "#00FFC8", facing: Math.PI / 2 },
  { id: "competitor", label: "Competitor Intelligence", pos: [-15, 0, -1.5], color: "#1FA9FF", facing: Math.PI / 2 },
  { id: "technical", label: "Plumbing Research & Technical", pos: [-15, 0, -9], color: "#FF7A00", facing: Math.PI / 2 },
  { id: "marketing", label: "Marketing & Content", pos: [15, 0, 6], color: "#A9B6C2", facing: -Math.PI / 2 },
  { id: "customer", label: "Customer Operations", pos: [15, 0, -1.5], color: "#39FF14", facing: -Math.PI / 2 },
  { id: "growth", label: "Business Growth", pos: [15, 0, -9], color: "#FF1F1F", facing: -Math.PI / 2 },
];

export const deptById = (id: string) => DEPARTMENTS.find((d) => d.id === id);

/** Extra agents (added at runtime) get a desk in the overflow row along the back wall. */
export function deskFor(agentId: string, index: number): Dept {
  return deptById(agentId) ?? { id: agentId, label: agentId, pos: [-6 + (index % 5) * 3, 0, -12], color: "#5B6B82", facing: 0 };
}

export const STATUS_COLOR: Record<string, string> = {
  idle: "#8A94A6", working: "#3D8BFF", researching: "#2FC1AE", reviewing: "#E0A23B", error: "#FF4B36", stopped: "#3A4457",
};

export interface CameraPreset { id: string; label: string; pos: Vec3; target: Vec3 }

export const CAMERAS: CameraPreset[] = [
  { id: "campus", label: "Campus", pos: [12, 7, 84], target: [-2, 9, 12] },
  { id: "exterior", label: "Outside", pos: [26, 17, 46], target: [0, 5, 0] },
  { id: "lobby", label: "Lobby", pos: [6, 6, 26], target: [0, 2.2, 6] },
  { id: "operations", label: "Operations room", pos: [0, 4.6, 8.5], target: [0, 3.3, -1.5] },
  { id: "executive", label: "Executive office", pos: [7, 4.2, -3.5], target: [0, 1.8, -9.5] },
  { id: "west", label: "Research wing", pos: [-4, 8, 6], target: [-15, 1.5, -2] },
  { id: "east", label: "Growth wing", pos: [4, 8, 6], target: [15, 1.5, -2] },
];

export function focusOn(d: Dept): CameraPreset {
  const [x, , z] = d.pos;
  const dx = Math.sign(-x) * 7 || 0;
  return { id: `agent-${d.id}`, label: d.label, pos: [x + dx, 4.2, z + (x === 0 ? 7 : 3.5)], target: [x, 1.4, z] };
}
