import { Html, OrbitControls, RoundedBox } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Agent, Dashboard, STATUS_LABEL } from "../api";
import { BUILDING, CameraPreset, DEPARTMENTS, Dept, STATUS_COLOR, Vec3, deskFor } from "./layout";
import { signTexture, textTexture } from "./textures";

const PIPE_Y = 6.3;
const MAIN_Z = -1.5;
const COPPER = "#B87333";

interface Props {
  agents: Agent[]; dashboard: Dashboard | null; handoffs: { id: number; from: string; to: string; at: number }[];
  selected: string | null; onSelect: (id: string) => void; camera: CameraPreset; reducedMotion: boolean;
}

export default function HQScene(p: Props) {
  const screenRef = useRef<THREE.Mesh>(null!);
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: p.camera.pos, fov: 42, near: 0.1, far: 400 }}
      gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
      <color attach="background" args={["#BFD3E6"]} />
      <fog attach="fog" args={["#BFD3E6", 70, 170]} />
      <hemisphereLight args={["#EAF2FF", "#5A6170", 0.85]} />
      <directionalLight position={[30, 40, 25]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <CameraRig preset={p.camera} reducedMotion={p.reducedMotion} />
      <Grounds />
      <Building />
      <Lobby />
      <OperationsDisplay dashboard={p.dashboard} screenRef={screenRef} />
      <PipeNetwork />
      {p.agents.map((a, i) => (
        <Workstation key={a.id} agent={a} dept={deskFor(a.id, i)} selected={p.selected === a.id}
          onSelect={p.onSelect} reducedMotion={p.reducedMotion} occluders={[screenRef]} />
      ))}
      {p.handoffs.map((h) => <WaterPulse key={h.id} from={h.from} to={h.to} start={h.at} />)}
      <ServiceVan />
    </Canvas>
  );
}

// ------------------------------------------------------------------------------------------------------------ camera
function CameraRig({ preset, reducedMotion }: { preset: CameraPreset; reducedMotion: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const goal = useRef({ pos: new THREE.Vector3(...preset.pos), target: new THREE.Vector3(...preset.target), active: true });
  useEffect(() => {
    goal.current = { pos: new THREE.Vector3(...preset.pos), target: new THREE.Vector3(...preset.target), active: true };
  }, [preset]);
  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls.current;
    if (!g.active || !c) return;
    const k = reducedMotion ? 1 : 1 - Math.pow(0.02, dt);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.05 && c.target.distanceTo(g.target) < 0.05) g.active = false;
  });
  return <OrbitControls ref={controls} makeDefault enableDamping maxPolarAngle={Math.PI / 2.05} minDistance={3}
    maxDistance={110} onStart={() => { goal.current.active = false; }} />;
}

// ------------------------------------------------------------------------------------------------------------ site
function Grounds() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#7E9A6A" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 4]} receiveShadow>
        <planeGeometry args={[60, 46]} />
        <meshStandardMaterial color="#C9CDD3" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 34]} receiveShadow>
        <planeGeometry args={[400, 12]} />
        <meshStandardMaterial color="#3B4049" />
      </mesh>
      {[-24, -16, -8, 8, 16, 24].map((x) => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.01, 34]}>
          <planeGeometry args={[4, 0.25]} />
          <meshStandardMaterial color="#E8E2C8" />
        </mesh>
      ))}
      {[-26, 26].map((x) => [-6, 4].map((z) => <Tree key={`${x}${z}`} pos={[x, 0, z]} />))}
    </group>
  );
}

function Tree({ pos }: { pos: Vec3 }) {
  return (
    <group position={pos}>
      <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[0.2, 0.28, 2.4]} /><meshStandardMaterial color="#6B4E32" /></mesh>
      <mesh position={[0, 3.3, 0]} castShadow><icosahedronGeometry args={[1.8, 1]} /><meshStandardMaterial color="#4F7A45" flatShading /></mesh>
    </group>
  );
}

function Building() {
  const { w, d, h } = BUILDING;
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = "/logo.jpg";
    if (document.fonts) document.fonts.ready.then(() => setLogo((l) => l)); // redraw sign once fonts are in
  }, []);
  const sign = useMemo(() => signTexture(logo), [logo]);
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#A9D2EC", transparent: true, opacity: 0.18,
    roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }), []);
  const frame = <meshStandardMaterial color="#1C2B4D" metalness={0.4} roughness={0.5} />;
  const cols: [number, number][] = [];
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 8) { if (Math.abs(x) > 2) cols.push([x, d / 2]); cols.push([x, -d / 2]); }
  for (let z = -d / 2 + d / 4; z < d / 2; z += d / 4) { cols.push([-w / 2, z]); cols.push([w / 2, z]); }
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow><boxGeometry args={[w, 0.12, d]} /><meshStandardMaterial color="#E9E6E0" /></mesh>
      {/* glass curtain walls; the back wall is solid so the interior reads clearly */}
      <mesh position={[0, h / 2, d / 2]} material={glass}><planeGeometry args={[w, h]} /></mesh>
      <mesh position={[-w / 2, h / 2, 0]} rotation-y={Math.PI / 2} material={glass}><planeGeometry args={[d, h]} /></mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation-y={-Math.PI / 2} material={glass}><planeGeometry args={[d, h]} /></mesh>
      <mesh position={[0, h / 2, -d / 2]} receiveShadow><boxGeometry args={[w, h, 0.3]} /><meshStandardMaterial color="#EFEAE1" /></mesh>
      {cols.map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]} castShadow><boxGeometry args={[0.35, h, 0.35]} />{frame}</mesh>
      ))}
      {/* roof fascia ring (open roof so the office is visible from above) */}
      {[[0, d / 2, w, 0.6], [0, -d / 2, w, 0.6]].map(([x, z, len, dep], i) => (
        <mesh key={`f${i}`} position={[x, h + 0.5, z]} castShadow><boxGeometry args={[len + 0.6, 1, dep]} />{frame}</mesh>
      ))}
      {[-w / 2, w / 2].map((x) => (
        <mesh key={`s${x}`} position={[x, h + 0.5, 0]} castShadow><boxGeometry args={[0.6, 1, d]} />{frame}</mesh>
      ))}
      {/* entrance canopy + sign */}
      <mesh position={[0, h - 0.4, d / 2 + 2]} castShadow><boxGeometry args={[14, 0.3, 4]} />{frame}</mesh>
      <mesh position={[0, h + 1.9, d / 2 + 0.36]}>
        <planeGeometry args={[19, 3.34]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      <mesh position={[0, h + 1.9, d / 2 + 0.3]}><boxGeometry args={[19.4, 3.7, 0.1]} /><meshStandardMaterial color="#0F1830" /></mesh>
      <mesh position={[0, 1.6, d / 2 + 0.05]}><boxGeometry args={[4, 3.2, 0.08]} /><meshStandardMaterial color="#2A3C63" transparent opacity={0.5} /></mesh>
    </group>
  );
}

function Lobby() {
  const wall = useMemo(() => textTexture([
    { text: "Straight Flush Plumbing & Leak Detection", size: 70, color: "#FFFFFF", weight: 700 },
    { text: "Intelligence headquarters · Laguna Niguel, California", size: 40, color: "#9FB0CC", weight: 500 },
  ], 1400, 260), []);
  return (
    <group position={[0, 0, 9]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.13, 1]} receiveShadow><planeGeometry args={[12, 7]} /><meshStandardMaterial color="#D8D2C6" /></mesh>
      <RoundedBox args={[5, 1.1, 1.1]} radius={0.15} position={[0, 0.65, 0]} castShadow>
        <meshStandardMaterial color="#16213E" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 1.21, 0]}><boxGeometry args={[5.1, 0.04, 1.2]} /><meshStandardMaterial color={COPPER} metalness={0.8} roughness={0.3} /></mesh>
      <mesh position={[0, 2.6, -3.2]}><planeGeometry args={[9, 1.67]} /><meshBasicMaterial map={wall} toneMapped={false} /></mesh>
      {[-5, 5].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.45, 0]} castShadow><cylinderGeometry args={[0.45, 0.35, 0.9]} /><meshStandardMaterial color="#F7F5F1" /></mesh>
          <mesh position={[0, 1.4, 0]} castShadow><icosahedronGeometry args={[0.7, 1]} /><meshStandardMaterial color="#4F7A45" flatShading /></mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------- operations display
function OperationsDisplay({ dashboard, screenRef }: { dashboard: Dashboard | null; screenRef: React.MutableRefObject<THREE.Mesh> }) {
  const tex = useMemo(() => {
    if (!dashboard) return textTexture([{ text: "Connecting to headquarters…", size: 56, color: "#9FB0CC" }], 1024, 576, "#0E1730");
    const d = dashboard;
    const empty = d.tasks_completed + d.tasks_in_progress + d.tasks_pending + d.tasks_failed === 0;
    const lines = empty
      ? [{ text: "Live company intelligence", size: 62, color: "#FFFFFF", weight: 700 },
         { text: "No work recorded yet", size: 54, color: "#9FB0CC" },
         { text: `${d.agents_online} of ${d.agents_total} agents online`, size: 46, color: "#2FC1AE" }]
      : [{ text: "Live company intelligence", size: 56, color: "#FFFFFF", weight: 700 },
         { text: `${d.agents_working} working · ${d.agents_idle} idle · ${d.agents_error} error`, size: 46, color: "#2FC1AE" },
         { text: `${d.tasks_completed} done · ${d.tasks_in_progress} running · ${d.tasks_pending} queued`, size: 46, color: "#C9D3E3" },
         { text: `${d.tasks_failed} failed · ${d.pending_approvals} awaiting Lance`, size: 46, color: d.tasks_failed ? "#FF8A7A" : "#C9D3E3" },
         { text: d.controls.emergency_stop ? "EMERGENCY STOP ACTIVE" : d.controls.paused ? "Operations paused" : `Model: ${d.provider}`,
           size: 40, color: d.controls.emergency_stop ? "#FF4B36" : "#9FB0CC" }];
    return textTexture(lines, 1024, 576, "#0E1730");
  }, [dashboard]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <group position={[0, 0, MAIN_Z]}>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow><cylinderGeometry args={[3.4, 3.6, 1, 48]} /><meshStandardMaterial color="#1C2B4D" /></mesh>
      <mesh position={[0, 1.02, 0]}><cylinderGeometry args={[3.42, 3.42, 0.04, 48]} /><meshStandardMaterial color={COPPER} metalness={0.8} roughness={0.3} /></mesh>
      {[0, Math.PI].map((r) => (
        <group key={r} rotation-y={r}>
          <mesh position={[0, 3.6, 0.06]}><planeGeometry args={[6.4, 3.6]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
        </group>
      ))}
      <mesh ref={screenRef} position={[0, 3.6, 0]}><boxGeometry args={[6.7, 3.9, 0.1]} /><meshStandardMaterial color="#0A1022" /></mesh>
      <mesh position={[0, 1.6, 0]}><cylinderGeometry args={[0.12, 0.12, 1.2]} /><meshStandardMaterial color="#0A1022" /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------- plumbing
function Pipe({ a, b, color = COPPER, r = 0.14 }: { a: Vec3; b: Vec3; color?: string; r?: number }) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return (
    <mesh position={mid} quaternion={q} castShadow>
      <cylinderGeometry args={[r, r, len, 12]} />
      <meshStandardMaterial color={color} metalness={color === COPPER ? 0.85 : 0.1} roughness={color === COPPER ? 0.32 : 0.5} />
    </mesh>
  );
}

function PipeNetwork() {
  const segs: [Vec3, Vec3][] = [
    [[-15, PIPE_Y, 7.5], [-15, PIPE_Y, -10.5]], [[15, PIPE_Y, 7.5], [15, PIPE_Y, -10.5]],
    [[-15, PIPE_Y, MAIN_Z], [15, PIPE_Y, MAIN_Z]], [[0, PIPE_Y, MAIN_Z], [0, PIPE_Y, -9.5]],
  ];
  return (
    <group>
      {segs.map(([a, b], i) => <Pipe key={i} a={a} b={b} />)}
      {segs.map(([a, b], i) => <Pipe key={`px${i}`} a={[a[0] + 0.4, a[1] + 0.25, a[2] + 0.4]} b={[b[0] + 0.4, b[1] + 0.25, b[2] + 0.4]} color="#2F6FD6" r={0.07} />)}
      {segs.map(([a, b], i) => <Pipe key={`pr${i}`} a={[a[0] - 0.4, a[1] + 0.25, a[2] - 0.4]} b={[b[0] - 0.4, b[1] + 0.25, b[2] - 0.4]} color="#C8432E" r={0.07} />)}
      {DEPARTMENTS.map((d) => <Pipe key={`drop-${d.id}`} a={[d.pos[0], PIPE_Y, d.pos[2]]} b={[d.pos[0], 3.4, d.pos[2]]} r={0.1} />)}
      {DEPARTMENTS.map((d) => (
        <mesh key={`v-${d.id}`} position={[d.pos[0], PIPE_Y, d.pos[2]]}><sphereGeometry args={[0.24, 16, 16]} /><meshStandardMaterial color="#8A5A2B" metalness={0.8} roughness={0.35} /></mesh>
      ))}
    </group>
  );
}

function routeBetween(from: Dept, to: Dept): THREE.Vector3[] {
  const up = (d: Dept) => new THREE.Vector3(d.pos[0], PIPE_Y, d.pos[2]);
  const pts: THREE.Vector3[] = [new THREE.Vector3(from.pos[0], 3.4, from.pos[2]), up(from)];
  const toMain = (d: Dept) => new THREE.Vector3(d.id === "executive" ? 0 : d.pos[0], PIPE_Y, MAIN_Z);
  pts.push(toMain(from));
  if (from.id === "executive" || to.id === "executive") pts.push(new THREE.Vector3(0, PIPE_Y, MAIN_Z));
  pts.push(toMain(to), up(to), new THREE.Vector3(to.pos[0], 3.4, to.pos[2]));
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.01);
}

/** A real hand-off between two agents travels through the pipes as a pulse of water. */
function WaterPulse({ from, to, start }: { from: string; to: string; start: number }) {
  const a = DEPARTMENTS.find((d) => d.id === from), b = DEPARTMENTS.find((d) => d.id === to);
  const ref = useRef<THREE.Group>(null);
  const curve = useMemo(() => (a && b ? new THREE.CatmullRomCurve3(routeBetween(a, b), false, "catmullrom", 0.05) : null), [a, b]);
  useFrame(() => {
    if (!ref.current || !curve) return;
    const t = (performance.now() - start) / 3200;
    ref.current.visible = t >= 0 && t <= 1;
    if (!ref.current.visible) return;
    ref.current.children.forEach((c, i) => c.position.copy(curve.getPointAt(Math.max(0, t - i * 0.025))));
  });
  if (!curve) return null;
  return (
    <group ref={ref}>
      {[0.32, 0.24, 0.17, 0.11].map((r, i) => (
        <mesh key={i}><sphereGeometry args={[r, 16, 16]} /><meshBasicMaterial color="#7FD8FF" transparent opacity={1 - i * 0.2} toneMapped={false} /></mesh>
      ))}
      <pointLight color="#7FD8FF" intensity={6} distance={6} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------- workstation
function Workstation({ agent, dept, selected, onSelect, reducedMotion, occluders }:
  { agent: Agent; dept: Dept; selected: boolean; onSelect: (id: string) => void; reducedMotion: boolean;
    occluders: React.RefObject<THREE.Object3D>[] }) {
  const color = STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle;
  const active = ["working", "researching", "reviewing"].includes(agent.status);
  const halo = useRef<THREE.Mesh>(null);
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  const body = useRef<THREE.Group>(null);
  const [hover, setHover] = useState(false);
  const label = useMemo(() => textTexture([{ text: dept.label, size: 64, color: "#FFFFFF", weight: 700 }], 1024, 140, dept.color), [dept]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (halo.current) {
      halo.current.rotation.z = reducedMotion ? 0 : t * (active ? 2 : 0.3);
      const s = active && !reducedMotion ? 1 + Math.sin(t * 5) * 0.08 : 1;
      halo.current.scale.setScalar(s);
    }
    if (screen.current) {
      screen.current.emissiveIntensity = agent.status === "stopped" ? 0 : active ? 1.4 + (reducedMotion ? 0 : Math.sin(t * 9) * 0.3) : 0.35;
    }
    if (body.current) body.current.position.y = active && !reducedMotion ? Math.abs(Math.sin(t * 3)) * 0.06 : 0;
  });
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(agent.id); };
  return (
    <group position={dept.pos} rotation-y={dept.facing}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.13, 0]} receiveShadow>
        <planeGeometry args={[7, 5.6]} />
        <meshStandardMaterial color={dept.color} transparent opacity={selected ? 0.45 : 0.22} />
      </mesh>
      <mesh position={[0, 4.4, -2.4]}><planeGeometry args={[5.6, 0.77]} /><meshBasicMaterial map={label} toneMapped={false} side={THREE.DoubleSide} /></mesh>
      {/* desk */}
      <RoundedBox args={[3, 0.12, 1.4]} radius={0.04} position={[0, 0.95, -0.6]} castShadow receiveShadow>
        <meshStandardMaterial color="#F2EEE8" roughness={0.6} />
      </RoundedBox>
      {[-1.35, 1.35].map((x) => <mesh key={x} position={[x, 0.47, -0.6]} castShadow><boxGeometry args={[0.08, 0.9, 1.2]} /><meshStandardMaterial color="#2A3C63" /></mesh>)}
      {/* monitor shows live state */}
      <mesh position={[0, 1.55, -1.05]} castShadow><boxGeometry args={[1.6, 0.95, 0.06]} /><meshStandardMaterial color="#0A1022" /></mesh>
      <mesh position={[0, 1.55, -1.015]}>
        <planeGeometry args={[1.5, 0.85]} />
        <meshStandardMaterial ref={screen} color="#0A1022" emissive={color} emissiveIntensity={0.35} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.1, -1.05]}><boxGeometry args={[0.1, 0.3, 0.1]} /><meshStandardMaterial color="#0A1022" /></mesh>
      {/* chair */}
      <mesh position={[0, 0.55, 0.45]} castShadow><boxGeometry args={[0.7, 0.1, 0.7]} /><meshStandardMaterial color="#16213E" /></mesh>
      <mesh position={[0, 0.95, 0.78]} castShadow><boxGeometry args={[0.7, 0.8, 0.08]} /><meshStandardMaterial color="#16213E" /></mesh>
      {/* agent */}
      <group ref={body} onClick={click} onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}>
        <mesh position={[0, 1.15, 0.35]} castShadow>
          <capsuleGeometry args={[0.32, 0.6, 6, 16]} />
          <meshStandardMaterial color={dept.color} roughness={0.45} emissive={selected || hover ? dept.color : "#000"} emissiveIntensity={0.25} />
        </mesh>
        <mesh position={[0, 1.95, 0.35]} castShadow>
          <sphereGeometry args={[0.27, 24, 24]} />
          <meshStandardMaterial color="#F2E3D2" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.98, 0.1]}><boxGeometry args={[0.36, 0.08, 0.04]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
        <mesh ref={halo} position={[0, 2.65, 0.35]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.36, 0.05, 8, 40, active ? Math.PI * 1.5 : Math.PI * 2]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.5, 0.35]} visible={false}><boxGeometry args={[1.4, 3, 1.4]} /></mesh>
      </group>
      {agent.status === "error" && <pointLight position={[0, 2.6, 0.35]} color="#FF4B36" intensity={4} distance={5} />}
      <Html position={[0, 3.25, 0.35]} center distanceFactor={16} zIndexRange={[10, 0]} occlude={occluders} style={{ pointerEvents: "none" }}>
        <div className={`tag tag-${agent.status}${selected ? " tag-selected" : ""}`}>
          <strong>{agent.name}</strong><span>{STATUS_LABEL[agent.status]}</span>
        </div>
      </Html>
    </group>
  );
}

function ServiceVan() {
  const side = useMemo(() => textTexture([
    { text: "Straight Flush", size: 110, color: "#16213E", weight: 700 },
    { text: "Plumbing & Leak Detection  ·  (949) 374-6524", size: 54, color: "#D9432E", weight: 600 },
  ], 1400, 340, "#FFFFFF"), []);
  return (
    <group position={[-12, 0, 22]} rotation-y={0.12}>
      <RoundedBox args={[6.2, 2.6, 2.4]} radius={0.3} position={[0, 1.7, 0]} castShadow><meshStandardMaterial color="#FFFFFF" /></RoundedBox>
      <mesh position={[0, 1.8, 1.21]}><planeGeometry args={[4.6, 1.12]} /><meshBasicMaterial map={side} toneMapped={false} /></mesh>
      <mesh position={[2.95, 2.1, 0]}><boxGeometry args={[0.4, 1, 2.2]} /><meshStandardMaterial color="#2A3C63" /></mesh>
      {[[-2, -1.15], [-2, 1.15], [2, -1.15], [2, 1.15]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.45, z]} rotation-x={Math.PI / 2} castShadow><cylinderGeometry args={[0.45, 0.45, 0.35, 20]} /><meshStandardMaterial color="#1B1E24" /></mesh>
      ))}
      {[0, 1].map((i) => <Pipe key={i} a={[-2.9, 3.1 + i * 0.12, -0.6 + i * 0.3]} b={[2.4, 3.1 + i * 0.12, -0.6 + i * 0.3]} color={i ? "#2F6FD6" : COPPER} r={0.07} />)}
    </group>
  );
}
