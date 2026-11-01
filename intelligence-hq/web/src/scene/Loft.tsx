// The HQ building: an industrial loft (exposed ducts, steel beams, concrete floor, ocean-facing window wall) with two
// office storeys above it. Inside: the logo wall and live command screen, lounge, pool table, bar, ping-pong, the
// values board, the logo rug and the company SUV. The agents' desks are drawn by HQScene's Workstation.
import { RoundedBox } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import type { Agent, Dashboard } from "../api";
import { BUILDING, DEPARTMENTS, Vec3 } from "./layout";
import { OfficeChair, Pendant, Plant, PoolTable, SUV, Sofa, WOOD, WOOD_LIGHT, glow } from "./props";
import { canvas, commandTexture, logoSignTexture, neonTexture, rugTexture, signTexture, toTexture, useBrand, useCanvasTexture } from "./screens";

const { w: W, d: D, h: H } = BUILDING;
const FLOOR_Y = 0.2;
const LED = "#2F8CFF";

function concreteTexture() {
  const { c, g } = canvas(512, 512);
  g.fillStyle = "#6B655E"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 90 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.18)`;
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 14, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = "rgba(40,36,32,0.35)"; g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(512, x); g.stroke(); }
  const t = toTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 8, D / 8); return t;
}
function slatTexture(base: string, line: string, vertical = true) {
  const { c, g } = canvas(512, 512);
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 32) {
    g.fillStyle = line; vertical ? g.fillRect(i, 0, 4, 512) : g.fillRect(0, i, 512, 4);
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`; vertical ? g.fillRect(i + 6, 0, 22, 512) : g.fillRect(0, i + 6, 512, 22);
  }
  const t = toTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function brickTexture() {
  const { c, g } = canvas(512, 512);
  g.fillStyle = "#2B1F1A"; g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 16; row++) for (let col = 0; col < 5; col++) {
    const x = col * 104 + (row % 2) * 52, y = row * 32;
    const v = 70 + Math.random() * 30;
    g.fillStyle = `rgb(${v + 20},${v - 15},${v - 30})`; g.fillRect(x + 3, y + 3, 98, 26);
  }
  const t = toTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ------------------------------------------------------------------------------------------------ shell
function Mullions({ length, axis, at, height, step, y0 = FLOOR_Y, transoms = [3.6] }:
  { length: number; axis: "x" | "z"; at: number; height: number; step: number; y0?: number; transoms?: number[] }) {
  const n = Math.round(length / step);
  const mat = <meshStandardMaterial color="#0E0F11" metalness={0.75} roughness={0.35} />;
  const pos = (u: number, y: number): Vec3 => (axis === "x" ? [u, y, at] : [at, y, u]);
  return (
    <group>
      {Array.from({ length: n + 1 }, (_, i) => -length / 2 + i * (length / n)).map((u) => (
        <mesh key={u} position={pos(u, y0 + height / 2)}><boxGeometry args={axis === "x" ? [0.14, height, 0.18] : [0.18, height, 0.14]} />{mat}</mesh>
      ))}
      {transoms.map((t) => (
        <mesh key={t} position={pos(0, y0 + t)}><boxGeometry args={axis === "x" ? [length, 0.1, 0.16] : [0.16, 0.1, length]} />{mat}</mesh>
      ))}
    </group>
  );
}

function Shell({ onEnter }: { onEnter: () => void }) {
  const floorTex = useMemo(concreteTexture, []);
  const westTex = useMemo(() => { const t = slatTexture("#4A3324", "#2A1C13"); t.repeat.set(6, 1); return t; }, []);
  const eastTex = useMemo(() => { const t = brickTexture(); t.repeat.set(5, 2); return t; }, []);
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#9FC4D8", transparent: true, opacity: 0.12, roughness: 0.04,
    metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }), []);
  const enter = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onEnter(); };
  return (
    <group>
      {/* slab + polished concrete floor */}
      <mesh position={[0, 0.1, 0]}><boxGeometry args={[W + 0.6, 0.2, D + 0.6]} /><meshStandardMaterial color="#2A2724" roughness={0.6} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, FLOOR_Y + 0.003, 0]}><planeGeometry args={[W, D]} />
        <meshStandardMaterial map={floorTex} color="#B9B1A6" roughness={0.32} metalness={0.15} /></mesh>
      {/* ceiling */}
      <mesh position={[0, H + 0.2, 0]}><boxGeometry args={[W + 0.6, 0.4, D + 0.6]} /><meshStandardMaterial color="#1C1C1F" roughness={0.85} /></mesh>
      {/* west wall: dark wood slats inside, charcoal outside */}
      <mesh position={[-W / 2 - 0.15, H / 2 + FLOOR_Y, 0]}><boxGeometry args={[0.3, H, D]} /><meshStandardMaterial color="#202227" roughness={0.7} /></mesh>
      <mesh position={[-W / 2 + 0.01, H / 2 + FLOOR_Y, 0]} rotation-y={Math.PI / 2}><planeGeometry args={[D, H]} />
        <meshStandardMaterial map={westTex} roughness={0.7} /></mesh>
      {/* east wall: brick inside */}
      <mesh position={[W / 2 + 0.15, H / 2 + FLOOR_Y, 0]}><boxGeometry args={[0.3, H, D]} /><meshStandardMaterial color="#202227" roughness={0.7} /></mesh>
      <mesh position={[W / 2 - 0.01, H / 2 + FLOOR_Y, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[D, H]} />
        <meshStandardMaterial map={eastTex} roughness={0.85} /></mesh>
      {/* ocean-facing window wall (back) and street glass (front) */}
      <mesh position={[0, H / 2 + FLOOR_Y, -D / 2]} material={glass}><planeGeometry args={[W, H]} /></mesh>
      <Mullions length={W} axis="x" at={-D / 2} height={H} step={3.67} transoms={[3.7]} />
      <mesh position={[-12.25, H / 2 + FLOOR_Y, D / 2]} material={glass}><planeGeometry args={[19.5, H]} /></mesh>
      <mesh position={[12.25, H / 2 + FLOOR_Y, D / 2]} material={glass}><planeGeometry args={[19.5, H]} /></mesh>
      <mesh position={[0, 5.5 + FLOOR_Y, D / 2]} material={glass}><planeGeometry args={[5, H - 3.6]} /></mesh>
      <Mullions length={W} axis="x" at={D / 2} height={H} step={2.75} transoms={[3.6, 5.6]} />
      {/* front doors: click to walk in */}
      <group position={[0, FLOOR_Y, D / 2]} onClick={enter}
        onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
        {[-1.1, 1.1].map((x) => (
          <mesh key={x} position={[x, 1.75, 0.02]} material={glass}><planeGeometry args={[2.1, 3.4]} /></mesh>
        ))}
        {[-1.1, 1.1].map((x) => (
          <mesh key={`h${x}`} position={[x * 0.25, 1.7, 0.12]}><boxGeometry args={[0.06, 1.4, 0.06]} />
            <meshStandardMaterial color="#C9A46A" metalness={0.9} roughness={0.25} /></mesh>
        ))}
        <mesh position={[0, 1.75, 0]} visible={false}><boxGeometry args={[4.4, 3.5, 0.6]} /></mesh>
      </group>
      {/* exterior blue LED trim, as in the plaza image */}
      {[[0, FLOOR_Y + 0.02, D / 2 + 0.32, W + 0.6, 0.06], [0, FLOOR_Y + 0.02, -D / 2 - 0.32, W + 0.6, 0.06]].map(([x, y, z, w, h], i) => (
        <mesh key={i} position={[x, y, z]}><boxGeometry args={[w, h, 0.06]} /><meshBasicMaterial color={glow(LED, 2)} toneMapped={false} /></mesh>
      ))}
      <mesh position={[0, H + 0.42, D / 2 + 0.31]}><boxGeometry args={[W + 0.6, 0.06, 0.06]} /><meshBasicMaterial color={glow(LED, 2)} toneMapped={false} /></mesh>
    </group>
  );
}

/** Exposed ducts, steel beams and pendants: the loft ceiling from the reference image. */
function Ceiling() {
  const duct = <meshStandardMaterial color="#9EA3AA" metalness={0.85} roughness={0.38} />;
  return (
    <group>
      {[-9, 0.5, 9].map((z) => (
        <group key={z}>
          <mesh position={[0, H - 0.75, z]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.42, 0.42, W - 1, 24]} />{duct}</mesh>
          {Array.from({ length: 11 }, (_, i) => -W / 2 + 2 + i * 4).map((x) => (
            <mesh key={x} position={[x, H - 0.75, z]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.45, 0.45, 0.08, 24]} />{duct}</mesh>
          ))}
        </group>
      ))}
      {Array.from({ length: 9 }, (_, i) => -W / 2 + 2 + i * 5).map((x) => (
        <group key={x}>
          <mesh position={[x, H - 0.15, 0]}><boxGeometry args={[0.32, 0.5, D]} /><meshStandardMaterial color="#141416" metalness={0.6} roughness={0.5} /></mesh>
        </group>
      ))}
      {DEPARTMENTS.map((d) => [-1.4, 1.4].map((dx) => (
        <Pendant key={`${d.id}${dx}`} position={[d.pos[0] + dx, H, d.pos[2] - 0.4]} drop={2.3} />
      )))}
      {[[-13, -9.5], [-2, -10], [10, -9.5], [19.5, -7], [16, 9]].map(([x, z]) => <Pendant key={`${x}${z}`} position={[x, H, z]} drop={2.6} />)}
      {[[-11.5, -0.5, 1.2], [3, -0.5, 1.2], [-11.5, 5.5, 1.1], [-4.5, -10, 1.1], [18.5, -6, 1.1], [14, 8.5, 0.9]].map(([x, z, k], i) => (
        <pointLight key={i} position={[x, H - 2.8, z]} color="#FFC27A" intensity={38 * k} distance={16} decay={1.6} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ feature walls
function CommandWall({ dashboard, agents, screenRef }: { dashboard: Dashboard | null; agents: Agent[]; screenRef: React.MutableRefObject<THREE.Mesh> }) {
  const { logo, fonts } = useBrand();
  const sign = useCanvasTexture(() => logoSignTexture(logo), [logo, fonts]);
  const agentKey = agents.map((a) => a.id + a.status).join();
  const screen = useCanvasTexture(() => commandTexture(dashboard, agents), [dashboard, agentKey, fonts]);
  const x = -W / 2 + 0.06;
  return (
    <group>
      {/* backlit logo sign */}
      <group position={[x, 4.7, -6.2]} rotation-y={Math.PI / 2}>
        <mesh position={[0, 0, -0.02]}><boxGeometry args={[7.2, 4.6, 0.1]} /><meshStandardMaterial color="#141210" roughness={0.6} /></mesh>
        <mesh position={[0, 0, 0.04]}><planeGeometry args={[6.9, 4.31]} /><meshBasicMaterial map={sign} toneMapped={false} /></mesh>
        <pointLight position={[0, 0, 1.5]} color="#FFD9A0" intensity={16} distance={8} />
      </group>
      {/* live command screen */}
      <group position={[x, 3.95, 4.2]} rotation-y={Math.PI / 2}>
        <mesh position={[0, 0, -0.04]}><boxGeometry args={[10.6, 6.1, 0.12]} /><meshStandardMaterial color="#0A0B0D" metalness={0.5} roughness={0.4} /></mesh>
        <mesh ref={screenRef} position={[0, 0, 0.04]}><planeGeometry args={[10.2, 5.74]} /><meshBasicMaterial map={screen} toneMapped={false} /></mesh>
      </group>
      {/* low shelves with plants along the wall */}
      <RoundedBox args={[0.6, 0.9, 20]} radius={0.04} position={[x + 0.35, FLOOR_Y + 0.45, -0.5]}><meshStandardMaterial color={WOOD} roughness={0.5} /></RoundedBox>
      {[-9.5, -6, -2.5, 1, 4.5, 8].map((z) => <Plant key={z} position={[x + 0.35, FLOOR_Y + 0.9, z]} size={0.7} />)}
    </group>
  );
}

function Bar() {
  const neon = useMemo(() => neonTexture(["Always", "a safe bet"], "#FF3B2F", 1024, 600), []);
  const bottles = useMemo(() => Array.from({ length: 30 }, (_, i) => ({ z: -12 + (i % 15) * 0.7, y: i < 15 ? 2.25 : 3.05,
    c: ["#7A4A1E", "#2E5E3A", "#B88A3C", "#5A2020", "#C9D6DF"][i % 5] })), []);
  const x = W / 2 - 0.2;
  return (
    <group>
      {/* counter */}
      <RoundedBox args={[1.3, 1.1, 10.5]} radius={0.05} position={[18.4, FLOOR_Y + 0.55, -7]}><meshStandardMaterial color={WOOD} roughness={0.5} /></RoundedBox>
      <RoundedBox args={[1.6, 0.1, 10.9]} radius={0.04} position={[18.4, FLOOR_Y + 1.15, -7]}><meshStandardMaterial color="#1A1817" roughness={0.25} metalness={0.2} /></RoundedBox>
      <mesh position={[17.74, FLOOR_Y + 0.12, -7]}><boxGeometry args={[0.04, 0.05, 10.5]} /><meshBasicMaterial color={glow("#FFB65C", 1.8)} toneMapped={false} /></mesh>
      {[-11, -9, -7, -5, -3].map((z) => (
        <group key={z} position={[17.1, FLOOR_Y, z]}>
          <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.04, 0.12, 0.8, 10]} /><meshStandardMaterial color="#1B1D21" metalness={0.8} /></mesh>
          <mesh position={[0, 0.85, 0]}><cylinderGeometry args={[0.26, 0.24, 0.1, 18]} /><meshStandardMaterial color="#5A3420" roughness={0.5} /></mesh>
        </group>
      ))}
      {/* back shelves with bottles */}
      {[2.1, 2.9].map((y) => <mesh key={y} position={[x - 0.25, FLOOR_Y + y, -6.8]}><boxGeometry args={[0.5, 0.06, 11]} /><meshStandardMaterial color={WOOD_LIGHT} roughness={0.5} /></mesh>)}
      {bottles.map((b, i) => (
        <mesh key={i} position={[x - 0.25, FLOOR_Y + b.y, b.z]}><cylinderGeometry args={[0.07, 0.08, 0.32, 10]} />
          <meshStandardMaterial color={b.c} roughness={0.15} metalness={0.1} emissive={b.c} emissiveIntensity={0.25} /></mesh>
      ))}
      {/* glass-door fridge */}
      <group position={[x - 0.45, FLOOR_Y, 0.4]}>
        <RoundedBox args={[0.9, 2.3, 1.1]} radius={0.04} position={[0, 1.15, 0]}><meshStandardMaterial color="#1A1C20" metalness={0.6} roughness={0.35} /></RoundedBox>
        <mesh position={[-0.46, 1.2, 0]} rotation-y={-Math.PI / 2}><planeGeometry args={[0.95, 2.0]} />
          <meshBasicMaterial color={glow("#DDEBFF", 0.9)} toneMapped={false} /></mesh>
      </group>
      {/* red neon: "Always a safe bet" */}
      <mesh position={[x - 0.02, 5.1, -6.5]} rotation-y={-Math.PI / 2}><planeGeometry args={[6, 3.5]} />
        <meshBasicMaterial map={neon} transparent toneMapped={false} depthWrite={false} /></mesh>
      <pointLight position={[x - 1.5, 5, -6.5]} color="#FF3B2F" intensity={14} distance={9} />
    </group>
  );
}

function Lounge() {
  const rug = useMemo(() => { const t = slatTexture("#3A3532", "#2E2A27", false); t.repeat.set(2, 1); return t; }, []);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[-13, FLOOR_Y + 0.01, -10]}><planeGeometry args={[9, 5]} />
        <meshStandardMaterial map={rug} roughness={0.95} /></mesh>
      <Sofa position={[-13, FLOOR_Y, -12.2]} width={4.4} />
      <Sofa position={[-17.2, FLOOR_Y, -9.6]} rotation={Math.PI / 2} width={3.2} />
      <Sofa position={[-8.8, FLOOR_Y, -9.6]} rotation={-Math.PI / 2} width={3.2} />
      <RoundedBox args={[2.6, 0.4, 1.3]} radius={0.06} position={[-13, FLOOR_Y + 0.35, -9.6]}><meshStandardMaterial color={WOOD} roughness={0.4} /></RoundedBox>
      <Plant position={[-20.6, FLOOR_Y, -12.8]} size={1.6} />
      <Plant position={[-6.8, FLOOR_Y, -12.8]} size={1.3} />
      <PoolTable position={[-1.5, FLOOR_Y, -10.2]} />
      <SUV position={[10.5, FLOOR_Y, -9.8]} rotation={-0.32} />
    </group>
  );
}

function GameZone() {
  const values = useMemo(() => signTexture([
    { text: "TEAMWORK", size: 70, color: "#F4ECDD" }, { text: "INNOVATION", size: 70, color: "#F4ECDD" },
    { text: "INTEGRITY", size: 70, color: "#F4ECDD" }, { text: "EXCELLENCE", size: 70, color: "#F4ECDD" },
    { text: "CUSTOMER FIRST", size: 70, color: "#F4ECDD" }, { text: "♠", size: 120, color: "#F4ECDD" },
  ], 640, 1200, "#0E0F12", "#3A3530"), []);
  const { logo, fonts } = useBrand();
  const rug = useCanvasTexture(() => rugTexture(logo), [logo, fonts]);
  return (
    <group>
      {/* ping-pong */}
      <group position={[15.5, FLOOR_Y, 6.2]}>
        <mesh position={[0, 0.76, 0]}><boxGeometry args={[2.74, 0.06, 1.52]} /><meshStandardMaterial color="#13284A" roughness={0.5} /></mesh>
        <mesh position={[0, 0.795, 0]}><boxGeometry args={[2.74, 0.005, 0.03]} /><meshBasicMaterial color="#FFFFFF" /></mesh>
        <mesh position={[0, 0.86, 0]}><boxGeometry args={[0.02, 0.15, 1.6]} /><meshStandardMaterial color="#DDDDDD" transparent opacity={0.7} /></mesh>
        {[[-1.1, -0.6], [1.1, -0.6], [-1.1, 0.6], [1.1, 0.6]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.37, z]}><boxGeometry args={[0.08, 0.74, 0.08]} /><meshStandardMaterial color="#1B1D21" /></mesh>
        ))}
      </group>
      {/* values board */}
      <group position={[20.2, FLOOR_Y, 11.8]} rotation-y={-0.9}>
        <RoundedBox args={[1.5, 2.9, 0.12]} radius={0.04} position={[0, 1.65, 0]}><meshStandardMaterial color="#0E0F12" roughness={0.5} /></RoundedBox>
        <mesh position={[0, 1.65, 0.07]}><planeGeometry args={[1.4, 2.6]} /><meshBasicMaterial map={values} toneMapped={false} /></mesh>
        <mesh position={[0, 0.1, 0]}><boxGeometry args={[1.2, 0.2, 0.6]} /><meshStandardMaterial color="#1B1D21" /></mesh>
      </group>
      {/* logo rug by the entrance */}
      <mesh rotation-x={-Math.PI / 2} position={[8.5, FLOOR_Y + 0.012, 10.2]} rotation-z={-0.12}><planeGeometry args={[7, 3.5]} />
        <meshStandardMaterial map={rug} roughness={0.95} /></mesh>
      <OfficeChair position={[19, FLOOR_Y, 3]} rotation={-1.2} />
      {[[21, 13], [-21, 13], [21, 2.5], [2.8, 13]].map(([x, z]) => <Plant key={`${x}${z}`} position={[x, FLOOR_Y, z]} size={1.5} />)}
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ upper storeys
function UpperFloors({ dashboard, agents }: { dashboard: Dashboard | null; agents: Agent[] }) {
  const { logo, fonts } = useBrand();
  const sign = useCanvasTexture(() => logoSignTexture(logo), [logo, fonts]);
  const agentKey = agents.map((a) => a.id + a.status).join();
  const screen = useCanvasTexture(() => commandTexture(dashboard, agents), [dashboard, agentKey, fonts]);
  const windows = useMemo(() => {
    const list: { p: Vec3; r: number; lit: number }[] = [];
    for (let f = 0; f < BUILDING.floors; f++) {
      const y = H + 0.4 + f * BUILDING.floorH + 1.9;
      for (let x = -20; x <= 20; x += 2.5) {
        if (x > 2) continue;                                    // the right half of the front carries the sign
        list.push({ p: [x, y, D / 2 - 1.18], r: 0, lit: (x * 7 + f * 3) % 5 === 0 ? 0.35 : 1 });
      }
      for (let x = -20; x <= 20; x += 2.5) list.push({ p: [x, y, -D / 2 + 0.02], r: Math.PI, lit: 0.8 });
      for (let z = -11; z <= 11; z += 2.5) list.push({ p: [W / 2 + 0.02, y, z], r: Math.PI / 2, lit: 0.9 });
    }
    return list;
  }, []);
  const top = H + 0.4 + BUILDING.floors * BUILDING.floorH;
  return (
    <group>
      <mesh position={[0, (H + 0.4 + top) / 2, -0.6]}><boxGeometry args={[W, top - H - 0.4, D - 1.2]} />
        <meshStandardMaterial color="#1E2024" roughness={0.6} metalness={0.3} /></mesh>
      {windows.map((w, i) => (
        <mesh key={i} position={w.p} rotation-y={w.r}><planeGeometry args={[2.0, 2.6]} />
          <meshBasicMaterial color={glow("#FFC98A", 0.55 * w.lit)} toneMapped={false} /></mesh>
      ))}
      {/* balconies with glass rails and blue LED edges */}
      {Array.from({ length: BUILDING.floors }, (_, f) => H + 0.4 + f * BUILDING.floorH).map((y) => (
        <group key={y}>
          <mesh position={[-9.5, y + 0.1, D / 2 - 0.2]}><boxGeometry args={[25, 0.2, 2.4]} /><meshStandardMaterial color="#2A2C30" roughness={0.6} /></mesh>
          <mesh position={[-9.5, y + 0.75, D / 2 + 0.95]}><planeGeometry args={[25, 1.1]} />
            <meshPhysicalMaterial color="#9FC4D8" transparent opacity={0.18} roughness={0.05} side={THREE.DoubleSide} depthWrite={false} /></mesh>
          <mesh position={[-9.5, y + 0.02, D / 2 + 1.0]}><boxGeometry args={[25, 0.06, 0.06]} /><meshBasicMaterial color={glow(LED, 2.2)} toneMapped={false} /></mesh>
          {[-19, -12, -5, 1].map((x) => <Plant key={x} position={[x, y + 0.2, D / 2 + 0.3]} size={0.9} />)}
        </group>
      ))}
      <mesh position={[0, top + 0.05, D / 2 - 1.2]}><boxGeometry args={[W, 0.08, 0.08]} /><meshBasicMaterial color={glow(LED, 2.2)} toneMapped={false} /></mesh>
      {/* facade logo sign and the outside command screen */}
      <group position={[8.6, H + 0.4 + 4.3, D / 2 - 1.12]}>
        <mesh position={[0, 0, -0.05]}><boxGeometry args={[11.6, 7.4, 0.12]} /><meshStandardMaterial color="#141210" /></mesh>
        <mesh position={[0, 0, 0.04]}><planeGeometry args={[11.2, 7.0]} /><meshBasicMaterial map={sign} toneMapped={false} /></mesh>
      </group>
      <group position={[18.3, H + 0.4 + 4.3, D / 2 - 1.12]}>
        <mesh position={[0, 0, -0.05]}><boxGeometry args={[6.9, 4.1, 0.12]} /><meshStandardMaterial color="#0A0B0D" /></mesh>
        <mesh position={[0, 0, 0.04]}><planeGeometry args={[6.6, 3.71]} /><meshBasicMaterial map={screen} toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

export default function Loft({ dashboard, agents, screenRef, onEnter }:
  { dashboard: Dashboard | null; agents: Agent[]; screenRef: React.MutableRefObject<THREE.Mesh>; onEnter: () => void }) {
  return (
    <group>
      <Shell onEnter={onEnter} />
      <Ceiling />
      <CommandWall dashboard={dashboard} agents={agents} screenRef={screenRef} />
      <Bar />
      <Lounge />
      <GameZone />
      <UpperFloors dashboard={dashboard} agents={agents} />
    </group>
  );
}

