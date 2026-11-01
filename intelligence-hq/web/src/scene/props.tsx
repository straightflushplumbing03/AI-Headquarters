// Furniture and vehicles shared by the loft and the plaza.
import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec3 } from "./layout";

export const glow = (hex: string, k = 2.2) => new THREE.Color(hex).multiplyScalar(k);
export const WOOD = "#3B2618";
export const WOOD_LIGHT = "#6B4A30";
export const LEATHER = "#5A3420";
export const STEEL = "#1B1D21";

/** Generic black off-road SUV with a spare wheel and light bar. */
export function SUV({ position, rotation = 0, scale = 1 }: { position: Vec3; rotation?: number; scale?: number }) {
  const paint = <meshPhysicalMaterial color="#0B0C0F" metalness={0.55} roughness={0.28} clearcoat={1} clearcoatRoughness={0.1} />;
  const wheels: Vec3[] = [[-1.45, 0.55, 0.98], [-1.45, 0.55, -0.98], [1.5, 0.55, 0.98], [1.5, 0.55, -0.98]];
  return (
    <group position={position} rotation-y={rotation} scale={scale}>
      <RoundedBox args={[4.4, 1.0, 2.0]} radius={0.16} position={[0, 1.15, 0]}>{paint}</RoundedBox>
      <RoundedBox args={[2.7, 0.95, 1.86]} radius={0.12} position={[-0.35, 2.05, 0]}>{paint}</RoundedBox>
      <mesh position={[-0.35, 2.08, 0]}><boxGeometry args={[2.5, 0.62, 1.88]} />
        <meshPhysicalMaterial color="#111823" metalness={0.3} roughness={0.05} clearcoat={1} /></mesh>
      <mesh position={[1.75, 1.62, 0]}><boxGeometry args={[0.9, 0.1, 1.9]} /><meshStandardMaterial color="#0B0C0F" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[-0.35, 2.58, 0]}><boxGeometry args={[1.9, 0.08, 1.6]} /><meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.4} /></mesh>
      <mesh position={[0.5, 2.62, 0]}><boxGeometry args={[0.12, 0.12, 1.5]} /><meshBasicMaterial color={glow("#FFF6E0", 2)} toneMapped={false} /></mesh>
      {wheels.map((p, i) => (
        <group key={i} position={p}>
          <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.55, 0.55, 0.46, 28]} /><meshStandardMaterial color="#0A0A0A" roughness={0.95} /></mesh>
          <mesh rotation-x={Math.PI / 2} position={[0, 0, Math.sign(p[2]) * 0.24]}><cylinderGeometry args={[0.3, 0.3, 0.03, 18]} />
            <meshStandardMaterial color="#2A2D33" metalness={0.8} roughness={0.3} /></mesh>
        </group>
      ))}
      <group position={[-2.32, 1.45, 0]} rotation-z={Math.PI / 2}>
        <mesh><cylinderGeometry args={[0.5, 0.5, 0.3, 24]} /><meshStandardMaterial color="#0A0A0A" roughness={0.95} /></mesh>
      </group>
      {[-0.65, 0.65].map((z) => (
        <mesh key={z} position={[2.21, 1.32, z]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.15, 0.15, 0.04, 20]} />
          <meshBasicMaterial color={glow("#FFF6E0", 2.4)} toneMapped={false} /></mesh>
      ))}
      {[-0.82, 0.82].map((z) => (
        <mesh key={z} position={[-2.21, 1.4, z]}><boxGeometry args={[0.04, 0.3, 0.18]} /><meshBasicMaterial color={glow("#FF2020", 1.6)} toneMapped={false} /></mesh>
      ))}
    </group>
  );
}

export function Sofa({ position, rotation = 0, width = 3.2 }: { position: Vec3; rotation?: number; width?: number }) {
  const m = <meshStandardMaterial color={LEATHER} roughness={0.55} metalness={0.05} />;
  return (
    <group position={position} rotation-y={rotation}>
      <RoundedBox args={[width, 0.45, 1.0]} radius={0.12} position={[0, 0.42, 0]}>{m}</RoundedBox>
      <RoundedBox args={[width, 0.75, 0.3]} radius={0.12} position={[0, 0.85, -0.38]}>{m}</RoundedBox>
      {[-1, 1].map((s) => <RoundedBox key={s} args={[0.3, 0.6, 1.0]} radius={0.1} position={[s * (width / 2 - 0.12), 0.62, 0]}>{m}</RoundedBox>)}
      {Array.from({ length: Math.round(width / 1.1) }, (_, i, n = Math.round(width / 1.1)) => (
        <RoundedBox key={i} args={[width / n - 0.1, 0.16, 0.8]} radius={0.07} position={[-width / 2 + (i + 0.5) * (width / n), 0.7, 0.05]}>{m}</RoundedBox>
      ))}
    </group>
  );
}

export function Plant({ position, size = 1, pot = "#2A2522" }: { position: Vec3; size?: number; pot?: string }) {
  const leaves = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    a: (i / 7) * Math.PI * 2, tilt: 0.5 + (i % 3) * 0.18, h: 0.9 + (i % 2) * 0.3,
  })), []);
  return (
    <group position={position} scale={size}>
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.32, 0.25, 0.6, 18]} /><meshStandardMaterial color={pot} roughness={0.7} /></mesh>
      {leaves.map((l, i) => (
        <mesh key={i} position={[Math.cos(l.a) * 0.15, 0.6 + l.h / 2, Math.sin(l.a) * 0.15]}
          rotation={[Math.sin(l.a) * l.tilt, 0, -Math.cos(l.a) * l.tilt]} scale={[1, 1, 0.25]}>
          <coneGeometry args={[0.16, l.h, 5]} />
          <meshStandardMaterial color={i % 2 ? "#2F6B33" : "#3E8A3C"} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

export function PoolTable({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const balls = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
    x: -0.4 + (i % 3) * 0.13 + Math.floor(i / 3) * 0.065, z: -0.13 + Math.floor(i / 3) * 0.12,
    c: ["#F2C230", "#1E4FD0", "#D6332A", "#5B2A86", "#E8761E", "#1E8A4A", "#7A2020", "#111111", "#F5F5F0"][i],
  })), []);
  return (
    <group position={position} rotation-y={rotation}>
      <RoundedBox args={[3.1, 0.3, 1.75]} radius={0.06} position={[0, 0.82, 0]}><meshStandardMaterial color={WOOD} roughness={0.4} /></RoundedBox>
      <mesh position={[0, 0.98, 0]}><boxGeometry args={[2.7, 0.04, 1.35]} /><meshStandardMaterial color="#14593A" roughness={0.9} /></mesh>
      {[[-1.3, -0.7], [1.3, -0.7], [-1.3, 0.7], [1.3, 0.7]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.35, z]}><boxGeometry args={[0.24, 0.7, 0.24]} /><meshStandardMaterial color={WOOD} roughness={0.5} /></mesh>
      ))}
      {balls.map((b, i) => <mesh key={i} position={[b.x, 1.05, b.z]}><sphereGeometry args={[0.055, 12, 12]} /><meshStandardMaterial color={b.c} roughness={0.2} /></mesh>)}
      <mesh position={[0.7, 1.05, 0]}><sphereGeometry args={[0.055, 12, 12]} /><meshStandardMaterial color="#FAFAF6" roughness={0.2} /></mesh>
    </group>
  );
}

export function OfficeChair({ position, rotation = 0 }: { position: Vec3; rotation?: number }) {
  const m = <meshStandardMaterial color="#141518" roughness={0.6} />;
  return (
    <group position={position} rotation-y={rotation}>
      <RoundedBox args={[0.62, 0.12, 0.6]} radius={0.05} position={[0, 0.55, 0]}>{m}</RoundedBox>
      <RoundedBox args={[0.6, 0.78, 0.1]} radius={0.05} position={[0, 1.0, 0.3]}>{m}</RoundedBox>
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[0.04, 0.04, 0.5, 10]} /><meshStandardMaterial color="#5E6670" metalness={0.8} roughness={0.3} /></mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos(i * 1.257) * 0.22, 0.06, Math.sin(i * 1.257) * 0.22]} rotation-y={-i * 1.257}>
          <boxGeometry args={[0.44, 0.04, 0.05]} /><meshStandardMaterial color="#2A2D33" metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/** Industrial pendant: black shade, warm bulb. */
export function Pendant({ position, drop = 1.8 }: { position: Vec3; drop?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, -drop / 2, 0]}><cylinderGeometry args={[0.012, 0.012, drop, 6]} /><meshBasicMaterial color="#111" /></mesh>
      <mesh position={[0, -drop - 0.18, 0]}><coneGeometry args={[0.38, 0.4, 24, 1, true]} />
        <meshStandardMaterial color="#121214" metalness={0.7} roughness={0.35} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, -drop - 0.3, 0]}><sphereGeometry args={[0.13, 16, 16]} /><meshBasicMaterial color={glow("#FFC77A", 3)} toneMapped={false} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ palms (instanced)
function palmGeometries() {
  const trunk: THREE.BufferGeometry[] = [], fronds: THREE.BufferGeometry[] = [];
  const segs = 10, H = 9;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, y = t * H, lean = Math.pow(t, 2) * 1.4;
    const r = 0.26 - t * 0.09;
    const g = new THREE.CylinderGeometry(r * 0.92, r, H / segs + 0.02, 9);
    g.translate(lean, y + H / segs / 2, 0);
    trunk.push(g);
  }
  const top = new THREE.Vector3(1.4, H, 0);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + (i % 2) * 0.2;
    const L = 3.4 + (i % 3) * 0.4, droop = 1.3 + (i % 4) * 0.35;
    const g = new THREE.PlaneGeometry(L, 0.9, 12, 2);
    g.rotateX(-Math.PI / 2);
    g.translate(L / 2, 0, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const t = p.getX(k) / L;
      p.setZ(k, p.getZ(k) * (1 - t * 0.85) * (0.55 + Math.sin(t * Math.PI) * 0.6));
      p.setY(k, t * L * 0.38 - t * t * droop * 1.6 - Math.abs(p.getZ(k)) * 0.25);
    }
    g.computeVertexNormals();
    g.rotateY(a);
    g.translate(top.x, top.y, top.z);
    fronds.push(g);
  }
  return { trunk: mergeGeometries(trunk)!, fronds: mergeGeometries(fronds)! };
}

export function Palms({ spots }: { spots: [number, number, number?][] }) {
  const geo = useMemo(palmGeometries, []);
  const matrices = useMemo(() => spots.map(([x, z, s = 1], i) => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i * 2.399) % (Math.PI * 2), 0)),
      new THREE.Vector3(s, s, s));
    return m;
  }), [spots]);
  const setup = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  };
  return (
    <group>
      <instancedMesh ref={setup} args={[geo.trunk, undefined, spots.length]}><meshStandardMaterial color="#6E5236" roughness={0.9} /></instancedMesh>
      <instancedMesh ref={setup} args={[geo.fronds, undefined, spots.length]}><meshStandardMaterial color="#2C5A2A" roughness={0.75} side={THREE.DoubleSide} /></instancedMesh>
    </group>
  );
}
