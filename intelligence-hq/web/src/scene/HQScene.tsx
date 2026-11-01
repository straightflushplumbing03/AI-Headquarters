import { Html, OrbitControls, RoundedBox, Sparkles } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Agent, Dashboard, STATUS_LABEL } from "../api";
import { CameraPreset, DEPARTMENTS, Dept, STATUS_COLOR, Vec3, deskFor } from "./layout";
import Loft from "./Loft";
import Oceanfront from "./Oceanfront";
import { OfficeChair, Plant, WOOD, WOOD_LIGHT, glow } from "./props";
import { monitorTexture, plaqueTexture, sideMonitorTexture, useBrand, useCanvasTexture } from "./screens";
import { flowTexture } from "./textures";

const PIPE_Y = 6.1;
const MAIN_Z = 1.25;
const BRAND_RED = "#FF4B36";
const COPPER = "#C9874B";
const FLOOR_Y = 0.2;

interface Props {
  agents: Agent[]; dashboard: Dashboard | null; handoffs: { id: number; from: string; to: string; at: number }[];
  selected: string | null; onSelect: (id: string) => void; camera: CameraPreset; reducedMotion: boolean; onEnter: () => void;
}

export default function HQScene(p: Props) {
  const screenRef = useRef<THREE.Mesh>(null!);
  return (
    <Canvas dpr={[1, 1.75]} camera={{ position: p.camera.pos, fov: 42, near: 0.1, far: 1800 }}
      gl={{ antialias: true }} onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.1; }}>
      <color attach="background" args={["#2A2340"]} />
      <fog attach="fog" args={["#5A3A4A", 260, 1300]} />
      <ambientLight intensity={0.28} color="#B9A6C8" />
      <hemisphereLight args={["#9C7FB8", "#2A1E16", 0.55]} />
      <directionalLight position={[20, 40, -220]} intensity={1.6} color="#FFA460" />
      <directionalLight position={[80, 60, 140]} intensity={0.35} color="#8FA8FF" />
      <CameraRig preset={p.camera} reducedMotion={p.reducedMotion} />
      <Oceanfront reducedMotion={p.reducedMotion} />
      <Loft dashboard={p.dashboard} agents={p.agents} screenRef={screenRef} onEnter={p.onEnter} />
      <PipeNetwork reducedMotion={p.reducedMotion} />
      {p.agents.map((a, i) => (
        <Workstation key={a.id} agent={a} agents={p.agents} dept={deskFor(a.id, i)} selected={p.selected === a.id}
          onSelect={p.onSelect} reducedMotion={p.reducedMotion} occluders={[screenRef]} />
      ))}
      {p.handoffs.map((h) => <WaterPulse key={h.id} from={h.from} to={h.to} start={h.at} />)}
      {!p.reducedMotion && <Sparkles count={90} scale={[40, 5, 24]} position={[0, 3.6, 0]} size={1.6} speed={0.15} color="#FFD9A0" opacity={0.35} />}
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.9} luminanceSmoothing={0.2} radius={0.7} />
        <Vignette eskil={false} offset={0.22} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}

// ------------------------------------------------------------------------------------------------------------ camera
/** Glides to a preset, or flies a path through `via` points (used to walk in through the front doors). */
function CameraRig({ preset, reducedMotion }: { preset: CameraPreset; reducedMotion: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; active: boolean; path?: THREE.CatmullRomCurve3; t0?: number; from?: THREE.Vector3 }>(
    { pos: new THREE.Vector3(...preset.pos), target: new THREE.Vector3(...preset.target), active: true });
  useEffect(() => {
    const pos = new THREE.Vector3(...preset.pos), target = new THREE.Vector3(...preset.target);
    if (preset.via && !reducedMotion) {
      const pts = [camera.position.clone(), ...preset.via.map((v) => new THREE.Vector3(...v)), pos];
      goal.current = { pos, target, active: true, path: new THREE.CatmullRomCurve3(pts, false, "centripetal"), t0: performance.now(),
        from: controls.current?.target.clone() ?? target.clone() };
    } else goal.current = { pos, target, active: true };
  }, [preset, camera, reducedMotion]);
  useFrame((_, dt) => {
    const g = goal.current, c = controls.current;
    if (!g.active || !c) return;
    if (g.path && g.t0 !== undefined) {
      const raw = Math.min(1, (performance.now() - g.t0) / 4200);
      const s = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      camera.position.copy(g.path.getPointAt(s));
      const ahead = g.path.getPointAt(Math.min(1, s + 0.06)).setY(camera.position.y - 0.4);
      c.target.copy(s < 0.7 ? ahead : ahead.lerp(g.target, (s - 0.7) / 0.3));
      c.update();
      if (raw >= 1) { c.target.copy(g.target); g.active = false; }
      return;
    }
    const k = reducedMotion ? 1 : 1 - Math.pow(0.02, dt);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.05 && c.target.distanceTo(g.target) < 0.05) g.active = false;
  });
  return <OrbitControls ref={controls} makeDefault enableDamping maxPolarAngle={Math.PI / 2.02} minDistance={1.5}
    maxDistance={260} onStart={() => { goal.current.active = false; }} />;
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
        <meshPhysicalMaterial color="#9FDFFF" transparent opacity={0.25} roughness={0.05} metalness={0.1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      {tex && <mesh><cylinderGeometry args={[r * 0.55, r * 0.55, len, 12, 1, true]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} color={glow("#7FE8FF", 1.4)} depthWrite={false} /></mesh>}
    </group>
  );
}

const DROP_Y = 3.1;
function PipeNetwork({ reducedMotion }: { reducedMotion: boolean }) {
  const flow = useMemo(() => flowTexture(), []);
  const xs = DEPARTMENTS.map((d) => d.pos[0]);
  return (
    <group>
      <Pipe a={[Math.min(...xs) - 1, PIPE_Y, MAIN_Z]} b={[Math.max(...xs) + 1, PIPE_Y, MAIN_Z]} flow={flow} reducedMotion={reducedMotion} />
      {DEPARTMENTS.map((d) => (
        <group key={d.id}>
          <Pipe a={[d.pos[0], PIPE_Y, MAIN_Z]} b={[d.pos[0], PIPE_Y, d.pos[2] - 0.9]} r={0.11} flow={flow} reducedMotion={reducedMotion} />
          <Pipe a={[d.pos[0], PIPE_Y, d.pos[2] - 0.9]} b={[d.pos[0], DROP_Y, d.pos[2] - 0.9]} r={0.08} flow={flow} reducedMotion={reducedMotion} />
          <mesh position={[d.pos[0], PIPE_Y, MAIN_Z]}><sphereGeometry args={[0.24, 18, 18]} />
            <meshStandardMaterial color={COPPER} emissive={COPPER} emissiveIntensity={0.35} metalness={0.9} roughness={0.25} /></mesh>
        </group>
      ))}
    </group>
  );
}

function routeBetween(from: Dept, to: Dept): THREE.Vector3[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const pts = [v(from.pos[0], DROP_Y, from.pos[2] - 0.9), v(from.pos[0], PIPE_Y, from.pos[2] - 0.9), v(from.pos[0], PIPE_Y, MAIN_Z),
    v(to.pos[0], PIPE_Y, MAIN_Z), v(to.pos[0], PIPE_Y, to.pos[2] - 0.9), v(to.pos[0], DROP_Y, to.pos[2] - 0.9)];
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
      {[0.3, 0.23, 0.18, 0.13, 0.09].map((r, i) => (
        <mesh key={i}><sphereGeometry args={[r, 16, 16]} /><meshBasicMaterial color={glow("#9FF0FF", 3 - i * 0.4)} transparent opacity={1 - i * 0.15} toneMapped={false} /></mesh>
      ))}
      <pointLight color="#7FD8FF" intensity={10} distance={7} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------------- workstation
// Each agent gets its own colour; agents added later get one from the palette.
const BOT_COLORS: Record<string, string> = {
  executive: "#FFE81A",   // Ace: neon yellow
  seo: "#00FFC8",         // Pipeline: plasma teal
  competitor: "#1FA9FF",  // Bluff: electric blue
  marketing: "#A9B6C2",   // Wildcard: battleship-grey steel, lit up
  customer: "#39FF14",    // Dealer: neon green
  technical: "#FF7A00",   // Torque: neon orange
  growth: "#FF1F1F",      // Jackpot: hot-rod red (the only red)
};
const PALETTE = ["#00F0FF", "#FFE81A", "#00FFC8", "#1FA9FF", "#39FF14", "#FF7A00"];
function botColorFor(id: string): string {
  if (BOT_COLORS[id]) return BOT_COLORS[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Dark-wood desk pod with three monitors (live agent data), a plaque, a chair, and the agent's round bot. */
function Workstation({ agent, agents, dept, selected, onSelect, reducedMotion, occluders }:
  { agent: Agent; agents: Agent[]; dept: Dept; selected: boolean; onSelect: (id: string) => void; reducedMotion: boolean;
    occluders: React.RefObject<THREE.Object3D>[] }) {
  const color = STATUS_COLOR[agent.status] ?? STATUS_COLOR.idle;
  const active = ["working", "researching", "reviewing"].includes(agent.status);
  const off = agent.status === "stopped";
  const halo = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const botColor = botColorFor(agent.id);
  const eyeColor = agent.status === "error" ? BRAND_RED : active ? color : "#BFF6FF";
  const [hover, setHover] = useState(false);
  const { fonts } = useBrand();
  const minute = Math.floor(Date.now() / 60000);
  const main = useCanvasTexture(() => monitorTexture(agent, dept.role, botColor),
    [agent.status, agent.current_task_id, agent.last_active_at, agent.last_error, agent.enabled, agent.name, fonts, minute]);
  const teamKey = agents.map((a) => a.id + a.status).join();
  const side = useCanvasTexture(() => sideMonitorTexture(agent, agents, botColor), [teamKey, fonts]);
  const plaque = useCanvasTexture(() => plaqueTexture(dept.role, agent.name, botColor), [dept.role, agent.name, fonts]);
  const BOT = new THREE.Vector3(0, 1.75, 0.95);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const m = reducedMotion ? 0 : 1;
    if (halo.current) {
      halo.current.rotation.z = t * (active ? 2.2 : 0.4) * m;
      halo.current.scale.setScalar(active ? 1 + Math.sin(t * 5) * 0.1 * m : 1);
    }
    if (beam.current) beam.current.opacity = active ? 0.12 + Math.sin(t * 4) * 0.05 * m : 0;
    if (body.current) body.current.position.y = BOT.y + (active ? 0.08 + Math.sin(t * 2.4) * 0.06 * m : Math.sin(t * 1.2 + dept.pos[0]) * 0.06 * m);
    if (head.current && body.current?.parent) {
      // idle bots turn to look at the camera; busy bots face their screens (yaw 0)
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
  });
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(agent.id); };
  const screenGlow = off ? 0.25 : active ? 1.05 : 0.8;
  return (
    <group position={[dept.pos[0], FLOOR_Y, dept.pos[2]]} rotation-y={dept.facing}>
      {/* desk: dark wood top, drawer pedestals, plaque on the front edge */}
      <RoundedBox args={[5.4, 0.09, 1.7]} radius={0.03} position={[0, 0.98, -0.75]}><meshStandardMaterial color={WOOD} roughness={0.45} /></RoundedBox>
      {[-2.25, 2.25].map((x) => (
        <RoundedBox key={x} args={[0.8, 0.94, 1.55]} radius={0.03} position={[x, 0.47, -0.75]}><meshStandardMaterial color="#2A1A10" roughness={0.6} /></RoundedBox>
      ))}
      <mesh position={[0, 0.55, -1.56]}><boxGeometry args={[3.7, 0.8, 0.04]} /><meshStandardMaterial color="#2A1A10" roughness={0.6} /></mesh>
      <mesh position={[0, 0.82, 0.13]}><planeGeometry args={[2.2, 0.46]} /><meshBasicMaterial map={plaque} toneMapped={false} /></mesh>
      <mesh position={[0, 1.035, 0.1]}><boxGeometry args={[5.3, 0.012, 0.02]} /><meshBasicMaterial color={glow(botColor, selected || hover ? 2.4 : 1.1)} toneMapped={false} /></mesh>
      {/* three monitors: live status in the middle, hand-off team on the sides */}
      {[[-1.75, 0.42, side], [0, 0, main], [1.75, -0.42, side]].map(([x, r, tex], i) => (
        <group key={i} position={[x as number, 1.03, -1.25]} rotation-y={r as number}>
          <mesh position={[0, 0.05, 0]}><boxGeometry args={[0.35, 0.04, 0.25]} /><meshStandardMaterial color="#1B1D21" /></mesh>
          <mesh position={[0, 0.3, 0]}><boxGeometry args={[0.06, 0.5, 0.06]} /><meshStandardMaterial color="#1B1D21" /></mesh>
          <mesh position={[0, 0.82, 0]}><boxGeometry args={[i === 1 ? 1.62 : 1.34, i === 1 ? 0.95 : 0.8, 0.06]} /><meshStandardMaterial color="#0C0D10" metalness={0.4} roughness={0.4} /></mesh>
          <mesh position={[0, 0.82, 0.032]}><planeGeometry args={[i === 1 ? 1.54 : 1.26, i === 1 ? 0.87 : 0.72]} />
            <meshBasicMaterial map={tex as THREE.Texture} color={new THREE.Color().setScalar(screenGlow)} toneMapped={false} /></mesh>
        </group>
      ))}
      <mesh position={[0, 1.05, -0.45]}><boxGeometry args={[1.2, 0.03, 0.38]} /><meshStandardMaterial color="#202226" /></mesh>
      <mesh position={[0.95, 1.05, -0.45]}><boxGeometry args={[0.18, 0.03, 0.26]} /><meshStandardMaterial color="#202226" /></mesh>
      <Plant position={[2.35, 1.03, -1.15]} size={0.42} pot={WOOD_LIGHT} />
      <OfficeChair position={[0, 0, 0.95]} rotation={0} />
      {/* round robot agent: hovers at its chair, looks at you when idle and at its screens while working */}
      <group ref={body} position={BOT.toArray()} onClick={click}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}>
        <group ref={head}>
          <mesh>
            <sphereGeometry args={[0.5, 48, 48]} />
            <meshPhysicalMaterial color={botColor} metalness={0.2} roughness={0.25} clearcoat={0.8} clearcoatRoughness={0.15}
              emissive={botColor} emissiveIntensity={selected || hover ? 0.9 : off ? 0.03 : 0.5} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.515, 48, 32, Math.PI * 1.5 - 0.95, 1.9, 0.92, 1.25]} />
            <meshPhysicalMaterial color="#05070F" metalness={0.6} roughness={0.05} clearcoat={1} side={THREE.DoubleSide} />
          </mesh>
          <group ref={eyes} position={[0, 0.055, -0.51]}>
            {[-0.15, 0.15].map((x) => (
              <mesh key={x} position={[x, 0, 0]} scale={[1, 1.35, 0.45]}>
                <sphereGeometry args={[0.068, 20, 20]} />
                <meshBasicMaterial color={glow(eyeColor, off ? 0.25 : 2.8)} toneMapped={false} />
              </mesh>
            ))}
          </group>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * 0.5, 0, 0]} scale={[0.45, 1, 1]}>
              <sphereGeometry args={[0.13, 20, 20]} />
              <meshPhysicalMaterial color="#3A4048" metalness={0.85} roughness={0.35} />
            </mesh>
          ))}
          <mesh position={[0, 0.62, 0]}><cylinderGeometry args={[0.02, 0.02, 0.26, 8]} /><meshStandardMaterial color="#C9D6EA" metalness={0.8} roughness={0.3} /></mesh>
          <mesh position={[0, 0.78, 0]}><sphereGeometry args={[0.065, 16, 16]} /><meshBasicMaterial color={glow(color, off ? 0.3 : 3)} toneMapped={false} /></mesh>
        </group>
        <mesh ref={halo} rotation-x={Math.PI / 2 - 0.25}>
          <torusGeometry args={[0.75, 0.028, 8, 64, active ? Math.PI * 1.4 : Math.PI * 2]} />
          <meshBasicMaterial color={glow(color, off ? 0.4 : 2.4)} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.57, 0]} rotation-x={Math.PI / 2}>
          <circleGeometry args={[0.3, 32]} />
          <meshBasicMaterial color={glow(botColor, off ? 0.2 : 1.8)} transparent opacity={0.55} toneMapped={false}
            blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh visible={false}><sphereGeometry args={[0.85, 8, 8]} /></mesh>
      </group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0.95]}>
        <ringGeometry args={[1.05, 1.13, 64]} />
        <meshBasicMaterial color={glow(botColor, selected || hover ? 2.2 : off ? 0.2 : 0.9)} toneMapped={false} />
      </mesh>
      <mesh position={[0, 3.6, 0.95]}><cylinderGeometry args={[0.45, 0.8, 3.6, 32, 1, true]} />
        <meshBasicMaterial ref={beam} color={glow(color, 1.4)} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide}
          depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      {agent.status === "error" && <pointLight position={[0, 2.4, 0.95]} color={BRAND_RED} intensity={8} distance={5} />}
      {active && <pointLight position={[0, 2.1, 0.6]} color={color} intensity={5} distance={4} />}
      <Html position={[0, 3.05, 0.95]} center distanceFactor={14} zIndexRange={[10, 0]} occlude={occluders} style={{ pointerEvents: "none" }}>
        <div className={`tag tag-${agent.status}${selected ? " tag-selected" : ""}`}>
          <strong>{agent.name}</strong><span>{STATUS_LABEL[agent.status]}</span>
        </div>
      </Html>
    </group>
  );
}

