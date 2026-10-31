import { Edges, Grid, Html, MeshReflectorMaterial, OrbitControls, RoundedBox, Sparkles, Stars } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Agent, Dashboard, STATUS_LABEL } from "../api";
import { BUILDING, CameraPreset, DEPARTMENTS, Dept, STATUS_COLOR, Vec3, deskFor } from "./layout";
import { flowTexture, holoTexture, signTexture, textTexture } from "./textures";

const PIPE_Y = 6.3;
const MAIN_Z = -1.5;
const CYAN = "#22D3EE";
const BRAND_RED = "#FF4B36";
const COPPER = "#E08A4B";

/** Brighter-than-white colour so bloom picks it up. */
const glow = (hex: string, k = 2.2) => new THREE.Color(hex).multiplyScalar(k);

interface Props {
  agents: Agent[]; dashboard: Dashboard | null; handoffs: { id: number; from: string; to: string; at: number }[];
  selected: string | null; onSelect: (id: string) => void; camera: CameraPreset; reducedMotion: boolean;
}

export default function HQScene(p: Props) {
  const screenRef = useRef<THREE.Mesh>(null!);
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: p.camera.pos, fov: 42, near: 0.1, far: 500 }}
      gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.15; }}>
      <color attach="background" args={["#040815"]} />
      <fog attach="fog" args={["#060B1E", 60, 190]} />
      <ambientLight intensity={0.35} color="#7FA7FF" />
      <hemisphereLight args={["#3B5BA8", "#0A0F20", 0.6]} />
      <directionalLight position={[-30, 45, 20]} intensity={0.7} color="#9DB8FF" />
      <pointLight position={[0, 9, 4]} intensity={60} distance={40} color="#6FD3FF" />
      <pointLight position={[-15, 6, -2]} intensity={30} distance={22} color="#5B7BFF" />
      <pointLight position={[15, 6, -2]} intensity={30} distance={22} color="#FF7A55" />
      <Stars radius={180} depth={60} count={2500} factor={5} fade speed={p.reducedMotion ? 0 : 0.4} />
      <CameraRig preset={p.camera} reducedMotion={p.reducedMotion} />
      <Grounds />
      <Building reducedMotion={p.reducedMotion} />
      <Lobby />
      <OperationsCore dashboard={p.dashboard} screenRef={screenRef} reducedMotion={p.reducedMotion} />
      <PipeNetwork reducedMotion={p.reducedMotion} />
      {p.agents.map((a, i) => (
        <Workstation key={a.id} agent={a} dept={deskFor(a.id, i)} selected={p.selected === a.id}
          onSelect={p.onSelect} reducedMotion={p.reducedMotion} occluders={[screenRef]} />
      ))}
      {p.handoffs.map((h) => <WaterPulse key={h.id} from={h.from} to={h.to} start={h.at} />)}
      <HoverVan reducedMotion={p.reducedMotion} />
      {!p.reducedMotion && <Sparkles count={140} scale={[42, 6, 26]} position={[0, 3.4, 0]} size={2.4} speed={0.25} color="#8FE6FF" opacity={0.6} />}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.75} />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
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
    maxDistance={120} onStart={() => { goal.current.active = false; }} />;
}

// ------------------------------------------------------------------------------------------------------------ site
function Grounds() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[420, 420]} />
        <MeshReflectorMaterial blur={[300, 80]} resolution={512} mixBlur={1} mixStrength={18} roughness={0.9}
          depthScale={1.1} minDepthThreshold={0.4} maxDepthThreshold={1.4} color="#060A18" metalness={0.6} mirror={0.6} />
      </mesh>
      <Grid position={[0, 0.005, 0]} args={[200, 200]} cellSize={2} cellThickness={0.6} cellColor="#12305A"
        sectionSize={10} sectionThickness={1.1} sectionColor="#1F6FD6" fadeDistance={130} fadeStrength={1.4} infiniteGrid />
      {/* light road with dashed lane glow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 34]}>
        <planeGeometry args={[420, 10]} />
        <meshStandardMaterial color="#070B18" metalness={0.4} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} rotation-x={-Math.PI / 2} position={[0, 0.02, 34 + s * 4.8]}>
          <planeGeometry args={[420, 0.12]} />
          <meshBasicMaterial color={glow(s > 0 ? CYAN : BRAND_RED, 1.6)} toneMapped={false} />
        </mesh>
      ))}
      {Array.from({ length: 14 }, (_, i) => -91 + i * 14).map((x) => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.02, 34]}>
          <planeGeometry args={[5, 0.18]} />
          <meshBasicMaterial color={glow("#BDF4FF", 1.2)} toneMapped={false} />
        </mesh>
      ))}
      {[[-30, -4], [-30, 6], [30, -4], [30, 6], [-24, 18], [24, 18]].map(([x, z]) => <LightPylon key={`${x}${z}`} pos={[x, 0, z]} />)}
    </group>
  );
}

function LightPylon({ pos }: { pos: Vec3 }) {
  return (
    <group position={pos}>
      <mesh position={[0, 2.2, 0]}><cylinderGeometry args={[0.08, 0.14, 4.4, 12]} /><meshStandardMaterial color="#0B1226" metalness={0.8} roughness={0.3} /></mesh>
      <mesh position={[0, 4.5, 0]}><sphereGeometry args={[0.22, 16, 16]} /><meshBasicMaterial color={glow(CYAN, 2.5)} toneMapped={false} /></mesh>
      <pointLight position={[0, 4.4, 0]} color={CYAN} intensity={8} distance={12} />
    </group>
  );
}

function Building({ reducedMotion }: { reducedMotion: boolean }) {
  const { w, d, h } = BUILDING;
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setLogo(img);
    img.src = "/logo.jpg";
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1));
  }, []);
  const sign = useMemo(() => signTexture(logo), [logo, fontsReady]);
  const signRef = useRef<THREE.Group>(null);
  const crown = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.elapsedTime;
    if (signRef.current) signRef.current.position.y = h + 3 + Math.sin(t * 0.8) * 0.15;
    if (crown.current) crown.current.rotation.y = t * 0.06;
  });
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#5FB8E6", transparent: true, opacity: 0.1,
    roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false }), []);
  const fins: [number, number][] = [];
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 8) { if (Math.abs(x) > 2) fins.push([x, d / 2]); fins.push([x, -d / 2]); }
  for (let z = -d / 2 + d / 4; z < d / 2; z += d / 4) { fins.push([-w / 2, z]); fins.push([w / 2, z]); }
  const strip = (pos: Vec3, size: Vec3, color: string, k = 2) => (
    <mesh position={pos}><boxGeometry args={size} /><meshBasicMaterial color={glow(color, k)} toneMapped={false} /></mesh>
  );
  return (
    <group>
      {/* floating floor slab with neon edges */}
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[w + 1, 0.2, d + 1]} />
        <meshStandardMaterial color="#0A1124" metalness={0.75} roughness={0.22} /></mesh>
      {strip([0, 0.21, d / 2 + 0.5], [w + 1, 0.06, 0.06], BRAND_RED, 2.4)}
      {strip([0, 0.21, -d / 2 - 0.5], [w + 1, 0.06, 0.06], CYAN)}
      {strip([-w / 2 - 0.5, 0.21, 0], [0.06, 0.06, d + 1], CYAN)}
      {strip([w / 2 + 0.5, 0.21, 0], [0.06, 0.06, d + 1], CYAN)}
      {/* glass volume with glowing outline */}
      <mesh position={[0, h / 2 + 0.2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges threshold={15} color={glow(CYAN, 1.6)} />
      </mesh>
      <mesh position={[0, h / 2 + 0.2, d / 2]} material={glass}><planeGeometry args={[w, h]} /></mesh>
      <mesh position={[-w / 2, h / 2 + 0.2, 0]} rotation-y={Math.PI / 2} material={glass}><planeGeometry args={[d, h]} /></mesh>
      <mesh position={[w / 2, h / 2 + 0.2, 0]} rotation-y={-Math.PI / 2} material={glass}><planeGeometry args={[d, h]} /></mesh>
      <mesh position={[0, h / 2 + 0.2, -d / 2]}><boxGeometry args={[w, h, 0.3]} /><meshStandardMaterial color="#0B1430" metalness={0.5} roughness={0.4} /></mesh>
      {[-16, -8, 0, 8, 16].map((x) => strip([x, h / 2 + 0.2, -d / 2 + 0.17], [0.08, h - 0.6, 0.02], "#3D6BFF", 1.4))}
      {fins.map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2 + 0.2, z]}><boxGeometry args={[0.12, h, 0.12]} />
          <meshBasicMaterial color={glow(i % 3 ? "#2A5FD0" : CYAN, 0.9)} toneMapped={false} /></mesh>
      ))}
      {/* entrance arch */}
      {strip([-2.2, 1.9, d / 2 + 0.1], [0.07, 3.6, 0.07], BRAND_RED, 2)}
      {strip([2.2, 1.9, d / 2 + 0.1], [0.07, 3.6, 0.07], BRAND_RED, 2)}
      {strip([0, 3.7, d / 2 + 0.1], [4.47, 0.07, 0.07], BRAND_RED, 2)}
      {/* floating crown rings */}
      <group ref={crown} position={[0, h + 1.6, 0]}>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[13, 0.07, 8, 160]} /><meshBasicMaterial color={glow(CYAN, 1.8)} toneMapped={false} /></mesh>
        <mesh rotation-x={Math.PI / 2} position={[0, 0.6, 0]}><torusGeometry args={[11.4, 0.04, 8, 160]} /><meshBasicMaterial color={glow(BRAND_RED, 1.8)} toneMapped={false} /></mesh>
        {Array.from({ length: 24 }, (_, i) => (i / 24) * Math.PI * 2).map((a) => (
          <mesh key={a} position={[Math.cos(a) * 13, 0, Math.sin(a) * 13]}><boxGeometry args={[0.18, 0.18, 0.18]} />
            <meshBasicMaterial color={glow("#BDF4FF", 2)} toneMapped={false} /></mesh>
        ))}
      </group>
      {/* floating holographic sign */}
      <group ref={signRef} position={[0, h + 3, d / 2 + 0.6]}>
        <mesh><planeGeometry args={[20, 3.71]} /><meshBasicMaterial map={sign} transparent toneMapped={false} /></mesh>
        <mesh position={[0, -2.2, 0]}><boxGeometry args={[20, 0.06, 0.06]} /><meshBasicMaterial color={glow(BRAND_RED, 2.5)} toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

function Lobby() {
  const wall = useMemo(() => textTexture([
    { text: "STRAIGHT FLUSH PLUMBING & LEAK DETECTION", size: 66, color: "#E6FBFF", weight: 700 },
    { text: "Intelligence headquarters · Laguna Niguel, California", size: 40, color: "#7FD8FF", weight: 500 },
  ], 1600, 260, null, CYAN), []);
  return (
    <group position={[0, 0, 9]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.22, 1]}><circleGeometry args={[4.5, 64]} />
        <meshStandardMaterial color="#0E1834" metalness={0.8} roughness={0.2} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.23, 1]}><ringGeometry args={[4.4, 4.55, 96]} />
        <meshBasicMaterial color={glow(CYAN, 1.8)} toneMapped={false} /></mesh>
      <RoundedBox args={[5, 1.1, 1.1]} radius={0.3} smoothness={6} position={[0, 0.8, 0]}>
        <meshPhysicalMaterial color="#0C1430" metalness={0.6} roughness={0.15} clearcoat={1} />
      </RoundedBox>
      <mesh position={[0, 0.3, 0.56]}><boxGeometry args={[4.6, 0.05, 0.02]} /><meshBasicMaterial color={glow(CYAN, 2.4)} toneMapped={false} /></mesh>
      <mesh position={[0, 1.36, 0]}><boxGeometry args={[5.05, 0.02, 1.15]} /><meshBasicMaterial color={glow(COPPER, 0.7)} toneMapped={false} /></mesh>
      <mesh position={[0, 2.8, -3.2]}><planeGeometry args={[10, 1.63]} /><meshBasicMaterial map={wall} transparent toneMapped={false} /></mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------- operations core
function OperationsCore({ dashboard, screenRef, reducedMotion }:
  { dashboard: Dashboard | null; screenRef: React.MutableRefObject<THREE.Mesh>; reducedMotion: boolean }) {
  const tex = useMemo(() => {
    if (!dashboard) return holoTexture([{ text: "Connecting to headquarters…", size: 56, color: "#9FE8FF" }]);
    const d = dashboard;
    const empty = d.tasks_completed + d.tasks_in_progress + d.tasks_pending + d.tasks_failed === 0;
    return holoTexture(empty
      ? [{ text: "LIVE COMPANY INTELLIGENCE", size: 58, color: "#E6FBFF", weight: 700 },
         { text: "No work recorded yet", size: 50, color: "#9FE8FF" },
         { text: `${d.agents_online} of ${d.agents_total} agents online`, size: 44, color: "#5BF0D2" }]
      : [{ text: "LIVE COMPANY INTELLIGENCE", size: 54, color: "#E6FBFF", weight: 700 },
         { text: `${d.agents_working} working · ${d.agents_idle} idle · ${d.agents_error} error`, size: 46, color: "#5BF0D2" },
         { text: `${d.tasks_completed} done · ${d.tasks_in_progress} running · ${d.tasks_pending} queued`, size: 46, color: "#BDF4FF" },
         { text: `${d.tasks_failed} failed · ${d.pending_approvals} awaiting Lance`, size: 46, color: d.tasks_failed ? "#FF8A7A" : "#BDF4FF" },
         { text: d.controls.emergency_stop ? "EMERGENCY STOP ACTIVE" : d.controls.paused ? "Operations paused" : `Model: ${d.provider}`,
           size: 40, color: d.controls.emergency_stop ? BRAND_RED : "#7FD8FF" }]);
  }, [dashboard]);
  useEffect(() => () => tex.dispose(), [tex]);
  const rings = useRef<THREE.Group>(null);
  const busy = (dashboard?.agents_working ?? 0) > 0;
  useFrame(({ clock }) => {
    if (!rings.current || reducedMotion) return;
    const t = clock.elapsedTime;
    rings.current.children.forEach((c, i) => { c.rotation.z = t * (busy ? 0.9 : 0.25) * (i % 2 ? -1 : 1); });
  });
  return (
    <group position={[0, 0, MAIN_Z]}>
      <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[3.6, 3.9, 0.4, 64]} /><meshStandardMaterial color="#0B1430" metalness={0.8} roughness={0.25} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.61, 0]}><ringGeometry args={[3.3, 3.5, 96]} />
        <meshBasicMaterial color={glow(busy ? "#5BF0D2" : CYAN, busy ? 2.4 : 1.4)} toneMapped={false} /></mesh>
      <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.18, 0.18, 1.6, 16]} /><meshBasicMaterial color={glow(CYAN, 1.6)} toneMapped={false} transparent opacity={0.8} /></mesh>
      <group ref={rings} position={[0, 1.4, 0]}>
        {[2.6, 2.2, 1.8].map((r, i) => (
          <mesh key={r} rotation-x={Math.PI / 2} position={[0, i * 0.35, 0]}>
            <torusGeometry args={[r, 0.025, 6, 120, Math.PI * (1.2 + i * 0.25)]} />
            <meshBasicMaterial color={glow(i === 1 ? COPPER : CYAN, 2)} toneMapped={false} />
          </mesh>
        ))}
      </group>
      {[0, Math.PI].map((r) => (
        <group key={r} rotation-y={r}>
          <mesh position={[0, 4, 0.04]}><planeGeometry args={[6.4, 3.6]} />
            <meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.FrontSide} /></mesh>
        </group>
      ))}
      <mesh ref={screenRef} position={[0, 4, 0]}><boxGeometry args={[6.4, 3.6, 0.04]} />
        <meshBasicMaterial color="#03101F" transparent opacity={0.55} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------- plumbing
function Pipe({ a, b, flow, reducedMotion, r = 0.16 }: { a: Vec3; b: Vec3; flow?: THREE.Texture; reducedMotion?: boolean; r?: number }) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  const tex = useMemo(() => {
    if (!flow) return null;
    const t = flow.clone();
    t.needsUpdate = true;
    t.repeat.set(1, Math.max(1, len / 3));
    t.rotation = Math.PI / 2;
    return t;
  }, [flow, len]);
  useFrame((_, dt) => { if (tex && !reducedMotion) tex.offset.y -= dt * 0.35; });
  return (
    <group position={mid} quaternion={q}>
      <mesh><cylinderGeometry args={[r, r, len, 16, 1, true]} />
        <meshPhysicalMaterial color="#9FDFFF" transparent opacity={0.22} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      {tex && <mesh><cylinderGeometry args={[r * 0.55, r * 0.55, len, 12, 1, true]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} color={glow("#7FE8FF", 1.6)} depthWrite={false} /></mesh>}
    </group>
  );
}

function PipeNetwork({ reducedMotion }: { reducedMotion: boolean }) {
  const flow = useMemo(() => flowTexture(), []);
  const segs: [Vec3, Vec3][] = [
    [[-15, PIPE_Y, 7.5], [-15, PIPE_Y, -10.5]], [[15, PIPE_Y, 7.5], [15, PIPE_Y, -10.5]],
    [[-15, PIPE_Y, MAIN_Z], [15, PIPE_Y, MAIN_Z]], [[0, PIPE_Y, MAIN_Z], [0, PIPE_Y, -9.5]],
  ];
  return (
    <group>
      {segs.map(([a, b], i) => <Pipe key={i} a={a} b={b} flow={flow} reducedMotion={reducedMotion} />)}
      {DEPARTMENTS.map((d) => <Pipe key={`drop-${d.id}`} a={[d.pos[0], PIPE_Y, d.pos[2]]} b={[d.pos[0], 3.6, d.pos[2]]} r={0.1} flow={flow} reducedMotion={reducedMotion} />)}
      {DEPARTMENTS.map((d) => (
        <mesh key={`v-${d.id}`} position={[d.pos[0], PIPE_Y, d.pos[2]]}><sphereGeometry args={[0.28, 20, 20]} />
          <meshStandardMaterial color={COPPER} emissive={COPPER} emissiveIntensity={0.6} metalness={0.9} roughness={0.25} /></mesh>
      ))}
    </group>
  );
}

function routeBetween(from: Dept, to: Dept): THREE.Vector3[] {
  const up = (d: Dept) => new THREE.Vector3(d.pos[0], PIPE_Y, d.pos[2]);
  const pts: THREE.Vector3[] = [new THREE.Vector3(from.pos[0], 3.6, from.pos[2]), up(from)];
  const toMain = (d: Dept) => new THREE.Vector3(d.id === "executive" ? 0 : d.pos[0], PIPE_Y, MAIN_Z);
  pts.push(toMain(from));
  if (from.id === "executive" || to.id === "executive") pts.push(new THREE.Vector3(0, PIPE_Y, MAIN_Z));
  pts.push(toMain(to), up(to), new THREE.Vector3(to.pos[0], 3.6, to.pos[2]));
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.01);
}

/** A real hand-off between two agents travels through the pipes as a pulse of light-water. */
function WaterPulse({ from, to, start }: { from: string; to: string; start: number }) {
  const a = DEPARTMENTS.find((d) => d.id === from), b = DEPARTMENTS.find((d) => d.id === to);
  const ref = useRef<THREE.Group>(null);
  const curve = useMemo(() => (a && b ? new THREE.CatmullRomCurve3(routeBetween(a, b), false, "catmullrom", 0.05) : null), [a, b]);
  useFrame(() => {
    if (!ref.current || !curve) return;
    const t = (performance.now() - start) / 3200;
    ref.current.visible = t >= 0 && t <= 1;
    if (!ref.current.visible) return;
    ref.current.children.forEach((c, i) => c.position.copy(curve.getPointAt(Math.min(1, Math.max(0, t - i * 0.02)))));
  });
  if (!curve) return null;
  return (
    <group ref={ref}>
      {[0.34, 0.26, 0.2, 0.15, 0.1].map((r, i) => (
        <mesh key={i}><sphereGeometry args={[r, 16, 16]} /><meshBasicMaterial color={glow("#9FF0FF", 3 - i * 0.4)} transparent opacity={1 - i * 0.15} toneMapped={false} /></mesh>
      ))}
      <pointLight color="#7FD8FF" intensity={14} distance={8} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------- workstation
const screenTextures = new Map<string, THREE.CanvasTexture>();
function statusScreen(status: string): THREE.CanvasTexture {
  if (!screenTextures.has(status)) {
    const c = STATUS_COLOR[status] ?? STATUS_COLOR.idle;
    screenTextures.set(status, holoTexture([{ text: STATUS_LABEL[status as keyof typeof STATUS_LABEL]?.toUpperCase() ?? status, size: 120, color: c, weight: 700 }], 640, 360, c));
  }
  return screenTextures.get(status)!;
}

// Each agent gets its own colour; agents added later get one from the palette.
const BOT_COLORS: Record<string, string> = {
  executive: "#FFE81A",   // Ace: neon yellow
  seo: "#FF2A2A",         // Pipeline: neon red
  competitor: "#1FA9FF",  // Bluff: electric blue
  marketing: "#A9B6C2",   // Wildcard: battleship-grey steel, lit up
  customer: "#39FF14",    // Dealer: neon green
  technical: "#FF7A00",   // Torque: neon orange
  growth: "#00E676",      // Jackpot: money green
};
const PALETTE = ["#00F0FF", "#FFE81A", "#FF2A2A", "#1FA9FF", "#39FF14", "#FF7A00"];
function botColorFor(id: string): string {
  if (BOT_COLORS[id]) return BOT_COLORS[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function Workstation({ agent, dept, selected, onSelect, reducedMotion, occluders }:
  { agent: Agent; dept: Dept; selected: boolean; onSelect: (id: string) => void; reducedMotion: boolean;
    occluders: React.RefObject<THREE.Object3D>[] }) {
  const color = STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle;
  const active = ["working", "researching", "reviewing"].includes(agent.status);
  const off = agent.status === "stopped";
  const halo = useRef<THREE.Mesh>(null);
  const screen = useRef<THREE.MeshBasicMaterial>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const padRing = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const botColor = botColorFor(agent.id);
  const eyeColor = agent.status === "error" ? BRAND_RED : active ? color : "#BFF6FF";
  const [hover, setHover] = useState(false);
  const label = useMemo(() => textTexture([{ text: dept.label.toUpperCase(), size: 60, color: "#FFFFFF", weight: 700 }], 1200, 120, null, dept.color), [dept]);
  const screenTex = statusScreen(agent.status);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const m = reducedMotion ? 0 : 1;
    if (halo.current) {
      halo.current.rotation.z = t * (active ? 2.2 : 0.4) * m;
      halo.current.scale.setScalar(active ? 1 + Math.sin(t * 5) * 0.1 * m : 1);
    }
    if (screen.current) screen.current.opacity = off ? 0.15 : active ? 0.85 + Math.sin(t * 12) * 0.08 * m : 0.55;
    if (beam.current) beam.current.opacity = active ? 0.16 + Math.sin(t * 4) * 0.06 * m : 0;
    if (body.current) body.current.position.y = 1.75 + (active ? 0.1 + Math.sin(t * 2.4) * 0.08 * m : Math.sin(t * 1.2 + dept.pos[0]) * 0.07 * m);
    if (head.current && body.current?.parent) {
      // idle bots turn to look at the camera; busy bots face their screen (yaw 0)
      let target = 0;
      if (!active && !off) {
        const local = body.current.parent.worldToLocal(camera.position.clone());
        target = Math.atan2(-(local.x - body.current.position.x), -(local.z - body.current.position.z));
      }
      let diff = target - head.current.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      head.current.rotation.y += diff * (reducedMotion ? 1 : 0.08);
      head.current.rotation.x = off ? 0.35 : 0;
    }
    if (eyes.current) {
      const blink = !active && !off && m && (t + dept.pos[2]) % 4.2 < 0.12 ? 0.12 : 1;
      eyes.current.scale.y = agent.status === "error" ? 0.45 : off ? 0.3 : blink;
      eyes.current.position.x = active ? Math.sin(t * 3) * 0.07 * m : 0;
    }
    if (padRing.current) padRing.current.rotation.z = -t * 0.3 * m;
  });
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(agent.id); };
  const ringColor = selected || hover ? glow(dept.color, 3) : glow(dept.color, active ? 2.2 : 1.2);
  return (
    <group position={dept.pos} rotation-y={dept.facing}>
      {/* department pad */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.22, 0]}><circleGeometry args={[2.9, 64]} />
        <meshStandardMaterial color="#0A1226" metalness={0.8} roughness={0.25} emissive={dept.color} emissiveIntensity={selected ? 0.25 : 0.08} /></mesh>
      <mesh ref={padRing} rotation-x={-Math.PI / 2} position={[0, 0.23, 0]}>
        <ringGeometry args={[2.8, 2.92, 96, 1, 0, Math.PI * 1.75]} />
        <meshBasicMaterial color={ringColor} toneMapped={false} />
      </mesh>
      <mesh position={[0, 4.6, -2.4]}><planeGeometry args={[6.2, 0.62]} /><meshBasicMaterial map={label} transparent toneMapped={false} side={THREE.DoubleSide} /></mesh>
      {/* floating desk */}
      <RoundedBox args={[3, 0.1, 1.2]} radius={0.05} position={[0, 0.98, -0.6]}>
        <meshPhysicalMaterial color="#0D1838" metalness={0.5} roughness={0.12} clearcoat={1} />
      </RoundedBox>
      <mesh position={[0, 0.93, -0.0]}><boxGeometry args={[2.9, 0.025, 0.025]} /><meshBasicMaterial color={glow(color, off ? 0.3 : 2.2)} toneMapped={false} /></mesh>
      <mesh position={[0, 0.5, -0.6]}><cylinderGeometry args={[0.08, 0.3, 0.9, 16]} /><meshStandardMaterial color="#0B1226" metalness={0.9} roughness={0.2} /></mesh>
      {/* holographic monitor shows the agent's real state */}
      <mesh position={[0, 1.75, -1.0]} rotation-x={-0.08}>
        <planeGeometry args={[1.9, 1.07]} />
        <meshBasicMaterial ref={screen} map={screenTex} transparent opacity={0.6} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* round robot agent: hovers over the pad, looks at you when idle and at its screen while working */}
      <group ref={body} position={[0, 1.75, 0.55]} onClick={click}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}>
        <group ref={head}>
          <mesh>
            <sphereGeometry args={[0.55, 48, 48]} />
            <meshPhysicalMaterial color={botColor} metalness={0.2} roughness={0.25} clearcoat={0.8} clearcoatRoughness={0.15}
              emissive={botColor} emissiveIntensity={selected || hover ? 0.9 : off ? 0.03 : 0.55} />
          </mesh>
          {/* glass face */}
          <mesh>
            <sphereGeometry args={[0.565, 48, 32, Math.PI * 1.5 - 0.95, 1.9, 0.92, 1.25]} />
            <meshPhysicalMaterial color="#05070F" metalness={0.6} roughness={0.05} clearcoat={1} side={THREE.DoubleSide} />
          </mesh>
          <group ref={eyes} position={[0, 0.06, -0.56]}>
            {[-0.17, 0.17].map((x) => (
              <mesh key={x} position={[x, 0, 0]} scale={[1, 1.35, 0.45]}>
                <sphereGeometry args={[0.075, 20, 20]} />
                <meshBasicMaterial color={glow(eyeColor, off ? 0.25 : 2.8)} toneMapped={false} />
              </mesh>
            ))}
          </group>
          {/* side pods */}
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * 0.55, 0, 0]} scale={[0.45, 1, 1]}>
              <sphereGeometry args={[0.14, 20, 20]} />
              <meshPhysicalMaterial color="#3A4048" metalness={0.85} roughness={0.35} />
            </mesh>
          ))}
          {/* antenna */}
          <mesh position={[0, 0.68, 0]}><cylinderGeometry args={[0.02, 0.02, 0.28, 8]} /><meshStandardMaterial color="#C9D6EA" metalness={0.8} roughness={0.3} /></mesh>
          <mesh position={[0, 0.85, 0]}><sphereGeometry args={[0.07, 16, 16]} /><meshBasicMaterial color={glow(color, off ? 0.3 : 3)} toneMapped={false} /></mesh>
        </group>
        {/* status orbit ring */}
        <mesh ref={halo} rotation-x={Math.PI / 2 - 0.25}>
          <torusGeometry args={[0.82, 0.03, 8, 64, active ? Math.PI * 1.4 : Math.PI * 2]} />
          <meshBasicMaterial color={glow(color, off ? 0.4 : 2.4)} toneMapped={false} />
        </mesh>
        {/* hover thruster glow */}
        <mesh position={[0, -0.62, 0]} rotation-x={Math.PI / 2}>
          <circleGeometry args={[0.32, 32]} />
          <meshBasicMaterial color={glow(botColor, off ? 0.2 : 1.8)} transparent opacity={0.55} toneMapped={false}
            blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh visible={false}><sphereGeometry args={[0.9, 8, 8]} /></mesh>
      </group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.24, 0.55]}>
        <circleGeometry args={[0.55, 32]} />
        <meshBasicMaterial color={glow(botColor, off ? 0.1 : 0.9)} transparent opacity={0.35} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* light beam while working */}
      <mesh position={[0, 3.2, 0.55]}><cylinderGeometry args={[0.6, 1, 6, 32, 1, true]} />
        <meshBasicMaterial ref={beam} color={glow(color, 1.5)} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide}
          depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      {agent.status === "error" && <pointLight position={[0, 2.4, 0.55]} color={BRAND_RED} intensity={10} distance={6} />}
      {active && <pointLight position={[0, 2.2, 0.55]} color={color} intensity={6} distance={5} />}
      <Html position={[0, 3.35, 0.55]} center distanceFactor={16} zIndexRange={[10, 0]} occlude={occluders} style={{ pointerEvents: "none" }}>
        <div className={`tag tag-${agent.status}${selected ? " tag-selected" : ""}`}>
          <strong>{agent.name}</strong><span>{STATUS_LABEL[agent.status]}</span>
        </div>
      </Html>
    </group>
  );
}

function HoverVan({ reducedMotion }: { reducedMotion: boolean }) {
  const side = useMemo(() => textTexture([
    { text: "Straight Flush", size: 110, color: "#16213E", weight: 700 },
    { text: "Plumbing & Leak Detection  ·  (949) 374-6524", size: 52, color: "#D9432E", weight: 600 },
  ], 1400, 340, "#F4F8FF"), []);
  const van = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (van.current && !reducedMotion) van.current.position.y = 0.9 + Math.sin(clock.elapsedTime * 1.5) * 0.12; });
  return (
    <group position={[-12, 0, 22]} rotation-y={0.12}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}><planeGeometry args={[6.6, 2.8]} />
        <meshBasicMaterial color={glow(CYAN, 1.2)} transparent opacity={0.35} toneMapped={false} /></mesh>
      <pointLight position={[0, 0.4, 0]} color={CYAN} intensity={10} distance={6} />
      <group ref={van} position={[0, 0.9, 0]}>
        <RoundedBox args={[6.2, 2.4, 2.4]} radius={0.5} smoothness={6} position={[0, 1.2, 0]}>
          <meshPhysicalMaterial color="#F4F8FF" metalness={0.3} roughness={0.15} clearcoat={1} />
        </RoundedBox>
        <mesh position={[0, 1.25, 1.21]}><planeGeometry args={[4.6, 1.12]} /><meshBasicMaterial map={side} toneMapped={false} /></mesh>
        <mesh position={[2.95, 1.6, 0]}><boxGeometry args={[0.4, 0.9, 2.2]} /><meshPhysicalMaterial color="#0B1430" metalness={0.6} roughness={0.05} clearcoat={1} /></mesh>
        <mesh position={[0, 0.02, 1.21]}><boxGeometry args={[6, 0.05, 0.02]} /><meshBasicMaterial color={glow(BRAND_RED, 2.5)} toneMapped={false} /></mesh>
        <mesh position={[0, 0.02, -1.21]}><boxGeometry args={[6, 0.05, 0.02]} /><meshBasicMaterial color={glow(BRAND_RED, 2.5)} toneMapped={false} /></mesh>
        {[-2.2, 2.2].map((x) => (
          <mesh key={x} position={[x, -0.05, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[0.55, 0.06, 8, 32]} />
            <meshBasicMaterial color={glow(CYAN, 2.4)} toneMapped={false} /></mesh>
        ))}
      </group>
    </group>
  );
}
