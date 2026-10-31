// The campus around the HQ: a dusk mountain valley with pines, a wet stone plaza, the water-drop fountain, the brand
// block, a dashboard wall, the company truck, a monument sign and a holographic model of the service area.
// The dashboard wall and monument sign show live numbers from the API, never invented ones.
import { Edges, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Dashboard } from "../api";
import type { Vec3 } from "./layout";
import { DISPLAY } from "./textures";

const glow = (hex: string, k = 2.2) => new THREE.Color(hex).multiplyScalar(k);
const ICE = "#4FC3FF";
const WARM = "#FFC27A";
const BODY = "'Barlow', sans-serif";

// ------------------------------------------------------------------------------------------------------------ utils
function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return { c, g: c.getContext("2d")! };
}
function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function useLogoAndFonts() {
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    const img = new Image(); img.onload = () => setLogo(img); img.src = "/logo.jpg";
    document.fonts?.ready.then(() => setFonts((n) => n + 1));
  }, []);
  return { logo, fonts };
}
/** Re-creates a canvas texture when its inputs change, and frees the old one. */
function useCanvasTexture(draw: () => THREE.CanvasTexture, deps: unknown[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(draw, deps);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}
function check(g: CanvasRenderingContext2D, x: number, y: number, s: number, ok: boolean) {
  g.save();
  g.strokeStyle = ok ? "#39FF14" : "#FFB020"; g.fillStyle = "rgba(0,0,0,0.35)"; g.lineWidth = s * 0.12;
  g.shadowColor = g.strokeStyle; g.shadowBlur = 12;
  g.beginPath(); g.roundRect(x, y, s, s, s * 0.18); g.fill(); g.stroke();
  g.lineWidth = s * 0.16; g.lineCap = "round"; g.beginPath();
  if (ok) { g.moveTo(x + s * 0.24, y + s * 0.52); g.lineTo(x + s * 0.43, y + s * 0.72); g.lineTo(x + s * 0.78, y + s * 0.3); }
  else { g.moveTo(x + s * 0.5, y + s * 0.24); g.lineTo(x + s * 0.5, y + s * 0.56); g.moveTo(x + s * 0.5, y + s * 0.76); g.lineTo(x + s * 0.5, y + s * 0.77); }
  g.stroke(); g.restore();
}

// ------------------------------------------------------------------------------------------------------------ sky
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vDir;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      float y = vDir.y;
      vec3 horizon = vec3(1.0, 0.56, 0.30), low = vec3(0.86, 0.42, 0.40), mid = vec3(0.30, 0.25, 0.48),
           high = vec3(0.07, 0.10, 0.24), top = vec3(0.02, 0.04, 0.11);
      vec3 c = mix(horizon, low, smoothstep(0.0, 0.07, y));
      c = mix(c, mid, smoothstep(0.06, 0.2, y));
      c = mix(c, high, smoothstep(0.18, 0.42, y));
      c = mix(c, top, smoothstep(0.4, 0.9, y));
      // sunset glow toward the west (left, behind the mountains)
      float sun = pow(max(0.0, dot(normalize(vec3(-0.75, 0.05, -0.65)), vDir)), 8.0);
      c += vec3(1.0, 0.55, 0.25) * sun * 0.45 * (1.0 - smoothstep(0.0, 0.35, y));
      // streaky clouds lit from below
      vec2 uv = vec2(atan(vDir.z, vDir.x) * 3.0, y * 22.0);
      float cl = n(uv * vec2(1.0, 1.0)) * 0.6 + n(uv * vec2(2.3, 2.0)) * 0.4;
      cl = smoothstep(0.55, 0.85, cl) * smoothstep(0.03, 0.12, y) * (1.0 - smoothstep(0.22, 0.38, y));
      c = mix(c, vec3(1.0, 0.62, 0.45), cl * 0.55);
      if (y < 0.0) c = mix(horizon * 0.5, vec3(0.08, 0.07, 0.12), smoothstep(0.0, -0.2, y));
      gl_FragColor = vec4(c * 0.82, 1.0);
    }`,
});

function Sky() {
  return <mesh renderOrder={-10} material={skyMaterial}><sphereGeometry args={[440, 48, 24]} /></mesh>;
}

// ------------------------------------------------------------------------------------------------------------ mountains
function ridged(x: number, y: number, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)); f *= 2.1; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}

/** One continuous range behind the valley, with a single tall snow peak framed behind the brand block. */
function rangeGeometry() {
  const W = 980, D = 330, g = new THREE.PlaneGeometry(W, D, 260, 100);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -150 - D / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const back = Math.min(1, Math.max(0, (-z - 160) / 120));
    let h = Math.pow(ridged(x * 0.006 + 3, z * 0.006), 2.2) * 95 * back;
    const dx = (x + 115) / 95, dz = (z + 340) / 75;
    h += 105 * Math.exp(-(dx * dx + dz * dz)) * (0.8 + 0.3 * ridged(x * 0.02, z * 0.02, 4));
    h += (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 6 * back;
    heights[i] = h - 4;
    pos.setY(i, heights[i]);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = heights[i], ny = nrm.getY(i);
    const snowLine = 58 + (fbm(pos.getX(i) * 0.04, pos.getZ(i) * 0.04, 3) - 0.5) * 26;
    const snow = Math.min(1, Math.max(0, (h - snowLine) / 10)) * Math.min(1, Math.max(0, (ny - 0.22) / 0.2));
    const rock = 0.09 + 0.05 * fbm(pos.getX(i) * 0.1, pos.getZ(i) * 0.1, 2);
    const forest = Math.max(0, 1 - h / 30);
    const r = rock * 0.95 * (1 - forest) + 0.04 * forest, gg = rock * (1 - forest) + 0.07 * forest, b = rock * 1.25 * (1 - forest) + 0.06 * forest;
    colors[i * 3] = r + (0.9 - r) * snow; colors[i * 3 + 1] = gg + (0.92 - gg) * snow; colors[i * 3 + 2] = b + (0.98 - b) * snow;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

function Mountains() {
  const geo = useMemo(rangeGeometry, []);
  return <mesh geometry={geo}><meshStandardMaterial vertexColors roughness={0.92} /></mesh>;
}

// ------------------------------------------------------------------------------------------------------------ pines
function Pines() {
  const foliageRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const { foliage, trunk, trees } = useMemo(() => {
    const cones = [
      new THREE.ConeGeometry(1.7, 3.2, 8).translate(0, 2.8, 0),
      new THREE.ConeGeometry(1.35, 2.8, 8).translate(0, 4.4, 0),
      new THREE.ConeGeometry(0.95, 2.4, 8).translate(0, 5.8, 0),
      new THREE.ConeGeometry(0.5, 1.6, 8).translate(0, 7.0, 0),
    ];
    const foliage = mergeGeometries(cones)!;
    const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2, 6).translate(0, 1, 0);
    const r = rng(11);
    const trees: { x: number; z: number; s: number; rot: number; shade: number }[] = [];
    let guard = 0;
    while (trees.length < 380 && guard++ < 6000) {
      const x = (r() - 0.5) * 360, z = -200 + r() * 290;
      const inPlaza = x > -42 && x < 42 && z > -30 && z < 76;
      const inView = z > 20 && Math.abs(x) < 52;
      const nearRing = Math.hypot(x, z) < 50;
      if (inPlaza || inView || nearRing) continue;
      trees.push({ x, z, s: 1.1 + r() * 1.3 + (z < -60 ? 0.6 : 0), rot: r() * Math.PI, shade: r() });
    }
    // a framing row along both sides of the plaza, like a planted avenue
    for (let z = 4; z < 74; z += 7) for (const x of [-47, 47]) trees.push({ x: x + (r() - 0.5) * 3, z, s: 1.3 + r() * 0.6, rot: r(), shade: r() });
    return { foliage, trunk, trees };
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Object3D();
    const col = new THREE.Color();
    trees.forEach((t, i) => {
      m.position.set(t.x, -0.05, t.z); m.rotation.set(0, t.rot, 0); m.scale.setScalar(t.s); m.updateMatrix();
      foliageRef.current!.setMatrixAt(i, m.matrix); trunkRef.current!.setMatrixAt(i, m.matrix);
      foliageRef.current!.setColorAt(i, col.setHSL(0.38 + t.shade * 0.06, 0.45, 0.07 + t.shade * 0.06));
    });
    foliageRef.current!.instanceMatrix.needsUpdate = trunkRef.current!.instanceMatrix.needsUpdate = true;
    if (foliageRef.current!.instanceColor) foliageRef.current!.instanceColor.needsUpdate = true;
  }, [trees]);
  return (
    <group>
      <instancedMesh ref={foliageRef} args={[foliage, undefined, trees.length]}>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={trunkRef} args={[trunk, undefined, trees.length]}>
        <meshStandardMaterial color="#2B2018" roughness={1} />
      </instancedMesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ ground
const PLAZA = { x0: -40, x1: 40, z0: -26, z1: 76 };

function Ground() {
  const tiles = useMemo(() => {
    const { c, g } = canvas(512, 512);
    g.fillStyle = "#3A4150"; g.fillRect(0, 0, 512, 512);
    const r = rng(3);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      const v = 52 + r() * 14;
      g.fillStyle = `rgb(${v},${v + 4},${v + 14})`;
      g.fillRect(x * 256 + 3, y * 128 + 3, 250, 122);
    }
    const t = toTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set((PLAZA.x1 - PLAZA.x0) / 6, (PLAZA.z1 - PLAZA.z0) / 6);
    return t;
  }, []);
  const w = PLAZA.x1 - PLAZA.x0, d = PLAZA.z1 - PLAZA.z0, cx = (PLAZA.x0 + PLAZA.x1) / 2, cz = (PLAZA.z0 + PLAZA.z1) / 2;
  const edge = (pos: Vec3, size: [number, number]) => (
    <mesh rotation-x={-Math.PI / 2} position={pos}><planeGeometry args={size} />
      <meshBasicMaterial color={glow(ICE, 1.8)} toneMapped={false} /></mesh>
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.06, 0]}>
        <circleGeometry args={[430, 64]} />
        <meshStandardMaterial color="#0C1510" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.01, cz]}>
        <planeGeometry args={[w, d]} />
        <MeshReflectorMaterial map={tiles} blur={[200, 60]} resolution={1024} mixBlur={0.8} mixStrength={22} roughness={0.55}
          depthScale={1} minDepthThreshold={0.5} maxDepthThreshold={1.3} color="#AAB4C8" metalness={0.45} mirror={0.75} />
      </mesh>
      {edge([PLAZA.x0, 0.01, cz], [0.18, d])}
      {edge([PLAZA.x1, 0.01, cz], [0.18, d])}
      {edge([cx, 0.01, PLAZA.z1], [w, 0.18])}
      {/* walkway light lines leading to the fountain */}
      {[-13, 13].map((x) => edge([x, 0.012, 56], [0.08, 40]))}
    </group>
  );
}

function Bollard({ pos }: { pos: Vec3 }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.13, 0.15, 1, 12]} /><meshStandardMaterial color="#1A1F28" metalness={0.7} roughness={0.35} /></mesh>
      <mesh position={[0, 0.92, 0]}><cylinderGeometry args={[0.135, 0.135, 0.14, 12]} /><meshBasicMaterial color={glow(WARM, 2.6)} toneMapped={false} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}><circleGeometry args={[1.1, 24]} />
        <meshBasicMaterial color={glow(WARM, 0.5)} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    </group>
  );
}

function Planter({ pos, size, seed }: { pos: Vec3; size: [number, number]; seed: number }) {
  const shrubs = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: Math.round(size[0] * size[1] * 0.9) }, () => ({
      x: (r() - 0.5) * (size[0] - 0.8), z: (r() - 0.5) * (size[1] - 0.6), s: 0.35 + r() * 0.45, c: r(),
    }));
  }, [seed, size]);
  return (
    <group position={pos}>
      <mesh position={[0, 0.35, 0]}><boxGeometry args={[size[0], 0.7, size[1]]} /><meshStandardMaterial color="#3A3F48" roughness={0.8} /></mesh>
      <mesh position={[0, 0.71, 0]}><boxGeometry args={[size[0] - 0.3, 0.02, size[1] - 0.3]} /><meshStandardMaterial color="#17110C" roughness={1} /></mesh>
      {shrubs.map((s, i) => (
        <mesh key={i} position={[s.x, 0.72 + s.s * 0.7, s.z]} scale={[1, 0.8, 1]}>
          <icosahedronGeometry args={[s.s, 1]} />
          <meshStandardMaterial color={s.c > 0.7 ? "#3E5A2A" : s.c > 0.35 ? "#1F4A2C" : "#2C6B3C"} roughness={0.9} flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.12, size[1] / 2 + 0.01]}><planeGeometry args={[size[0] - 0.4, 0.06]} />
        <meshBasicMaterial color={glow(ICE, 1.6)} toneMapped={false} /></mesh>
    </group>
  );
}

function Rocks({ pos, seed }: { pos: Vec3; seed: number }) {
  const list = useMemo(() => { const r = rng(seed); return Array.from({ length: 4 }, () => ({ x: (r() - 0.5) * 4, z: (r() - 0.5) * 2, s: 0.4 + r() * 0.7, ry: r() * 3 })); }, [seed]);
  return (
    <group position={pos}>
      {list.map((k, i) => (
        <mesh key={i} position={[k.x, k.s * 0.4, k.z]} rotation-y={k.ry} scale={[1.3, 0.75, 1]}>
          <dodecahedronGeometry args={[k.s, 0]} /><meshStandardMaterial color="#5B6068" roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ fountain
function dropGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI;
    pts.push(new THREE.Vector2(Math.sin(a) * Math.pow(Math.sin(a / 2), 1.6), -Math.cos(a)));
  }
  return new THREE.LatheGeometry(pts, 64);
}

const dropShell = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color("#6FD3FF") } },
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal);
    vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
      vec3 c = color * (0.12 + f * 1.25) + vec3(0.8, 0.95, 1.0) * pow(max(dot(vN, normalize(vec3(-0.4, 0.7, 0.6))), 0.0), 60.0) * 0.7;
      gl_FragColor = vec4(c, 0.18 + f * 0.62); }`,
  transparent: true, depthWrite: false, toneMapped: false,
});

function Fountain({ reducedMotion }: { reducedMotion: boolean }) {
  const drop = useMemo(dropGeometry, []);
  const dropRef = useRef<THREE.Group>(null);
  const ripples = useRef<THREE.Mesh[]>([]);
  const { fonts } = useLogoAndFonts();
  const label = useMemo(() => {
    const { c, g } = canvas(2048, 128);
    g.fillStyle = "rgba(10,14,22,1)"; g.fillRect(0, 0, 2048, 128);
    g.font = `600 78px ${DISPLAY}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = ICE; g.shadowBlur = 22; g.fillStyle = "#9EE6FF";
    g.fillText("AI  POWERED  OPERATIONS", 1024, 68);
    return toTexture(c);
  }, [fonts]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (dropRef.current && !reducedMotion) { dropRef.current.position.y = 4.6 + Math.sin(t * 0.9) * 0.18; dropRef.current.rotation.y = t * 0.25; }
    ripples.current.forEach((m, i) => {
      if (!m) return;
      const p = reducedMotion ? 0.4 + i * 0.2 : (t * 0.35 + i / 3) % 1;
      m.scale.setScalar(1.2 + p * 4.2);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - p);
    });
  });
  return (
    <group position={[0, 0, 31]}>
      {/* stone basin */}
      <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[7, 7.2, 0.9, 64, 1, true]} /><meshStandardMaterial color="#2C313B" roughness={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.9, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[6.4, 7.05, 64]} /><meshStandardMaterial color="#3B414C" roughness={0.5} /></mesh>
      <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[7.215, 7.215, 0.5, 64, 1, true, -0.95, 1.9]} />
        <meshBasicMaterial map={label} toneMapped={false} /></mesh>
      <mesh position={[0, 0.05, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[7.4, 7.6, 96]} />
        <meshBasicMaterial color={glow(ICE, 2)} toneMapped={false} /></mesh>
      {/* glowing water */}
      <mesh position={[0, 0.62, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[6.4, 64]} />
        <meshStandardMaterial color="#0A3550" emissive="#0E7FBF" emissiveIntensity={0.9} metalness={0.3} roughness={0.15} /></mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => { if (m) ripples.current[i] = m; }} position={[0, 0.64, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.95, 1, 64]} />
          <meshBasicMaterial color={glow("#BDF4FF", 1.6)} transparent opacity={0.4} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
      {/* upper tier */}
      <mesh position={[0, 1.1, 0]}><cylinderGeometry args={[3.2, 3.5, 1, 48]} /><meshStandardMaterial color="#2C313B" roughness={0.55} /></mesh>
      <mesh position={[0, 1.62, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[3.2, 0.08, 8, 96]} /><meshBasicMaterial color={glow(ICE, 2.4)} toneMapped={false} /></mesh>
      <mesh position={[0, 1.61, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[3.1, 48]} />
        <meshBasicMaterial color={glow("#2FA8FF", 1.1)} toneMapped={false} /></mesh>
      {/* the holographic drop */}
      <group ref={dropRef} position={[0, 4.6, 0]}>
        <mesh geometry={drop} scale={[1.9, 2.7, 1.9]} material={dropShell} />
        <mesh geometry={drop} scale={[0.9, 1.3, 0.9]} position={[0, -0.6, 0]}>
          <meshBasicMaterial color={glow("#3FB8FF", 0.8)} transparent opacity={0.22} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh position={[0, 2.8, 0]}><cylinderGeometry args={[0.9, 2.6, 2.4, 32, 1, true]} />
        <meshBasicMaterial color={glow(ICE, 0.8)} transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} /></mesh>
      <pointLight position={[0, 2.5, 3]} color="#5FC8FF" intensity={40} distance={22} />
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ brand block
function brandTexture(logo: HTMLImageElement | null) {
  const { c, g } = canvas(2048, 760);
  const bg = g.createLinearGradient(0, 0, 0, 760);
  bg.addColorStop(0, "#121722"); bg.addColorStop(1, "#0A0D14");
  g.fillStyle = bg; g.fillRect(0, 0, 2048, 760);
  let x = 90;
  if (logo && logo.naturalWidth) {
    const lh = 470, lw = lh * (logo.naturalWidth / logo.naturalHeight);
    g.shadowColor = ICE; g.shadowBlur = 60; g.fillStyle = "#FFFFFF";
    g.beginPath(); g.roundRect(x, 120, lw + 40, lh + 40, 28); g.fill();
    g.shadowBlur = 0; g.drawImage(logo, x + 20, 140, lw, lh);
    x += lw + 120;
  }
  const right = 2048 - 80;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.shadowColor = "#7FD8FF"; g.shadowBlur = 34; g.fillStyle = "#FFFFFF";
  g.font = `700 220px ${DISPLAY}`; g.fillText("Straight Flush", x, 330, right - x);
  g.shadowBlur = 16; g.fillStyle = "#DCEBFF"; g.font = `600 92px ${DISPLAY}`;
  g.fillText("P L U M B I N G  &  L E A K  D E T E C T I O N", x + 6, 455, right - x);
  g.shadowColor = ICE; g.shadowBlur = 26; g.fillStyle = "#4FC3FF"; g.font = `600 104px ${DISPLAY}`;
  g.fillText("Always a safe bet", x + 4, 610, right - x);
  return toTexture(c);
}

function BrandBlock() {
  const { logo, fonts } = useLogoAndFonts();
  const tex = useCanvasTexture(() => brandTexture(logo), [logo, fonts]);
  // sits on the front-left of the roof like an upper storey
  const W = 20, H = 7.4, D = 7, x = -12, y = 7.4 + H / 2, z = 14.4 - D / 2;
  return (
    <group position={[x, y, z]}>
      <mesh><boxGeometry args={[W, H, D]} /><meshStandardMaterial color="#141820" metalness={0.55} roughness={0.35} />
        <Edges threshold={15} color={glow(ICE, 1.5)} /></mesh>
      <mesh position={[0, 0, D / 2 + 0.02]}><planeGeometry args={[W - 1, (W - 1) * (760 / 2048)]} />
        <meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      {[[0, H / 2 + 0.05, D / 2], [0, -H / 2 - 0.05, D / 2]].map((p, i) => (
        <mesh key={i} position={p as Vec3}><boxGeometry args={[W + 0.2, 0.1, 0.1]} /><meshBasicMaterial color={glow(ICE, 2.4)} toneMapped={false} /></mesh>
      ))}
      <pointLight position={[0, -2, D / 2 + 3]} color="#7FD8FF" intensity={25} distance={16} />
    </group>
  );
}

/** Entrance canopy with a warm soffit, like a lit porte-cochère. */
function Canopy() {
  return (
    <group position={[-13.5, 4.5, 17.2]}>
      <mesh><boxGeometry args={[16, 0.4, 6.4]} /><meshStandardMaterial color="#1A1E26" metalness={0.5} roughness={0.4} /></mesh>
      <mesh position={[0, -0.21, 0]} rotation-x={Math.PI / 2}><planeGeometry args={[15, 5.8]} />
        <meshBasicMaterial color={glow(WARM, 0.75)} toneMapped={false} /></mesh>
      <mesh position={[0, 0.05, 3.22]}><boxGeometry args={[16, 0.08, 0.08]} /><meshBasicMaterial color={glow(ICE, 2.4)} toneMapped={false} /></mesh>
      {[-7.4, 7.4].map((cx) => (
        <mesh key={cx} position={[cx, -2.25, 2.6]}><boxGeometry args={[0.35, 4.5, 0.35]} /><meshStandardMaterial color="#1A1E26" metalness={0.6} roughness={0.35} /></mesh>
      ))}
      <pointLight position={[0, -1.5, 1.5]} color={WARM} intensity={45} distance={16} />
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ dashboard wall
const PANEL = "rgba(14, 34, 66, 0.82)";
function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.save(); g.fillStyle = PANEL; g.strokeStyle = "rgba(79,195,255,0.75)"; g.lineWidth = 3; g.shadowColor = ICE; g.shadowBlur = 18;
  g.beginPath(); g.roundRect(x, y, w, h, 22); g.fill(); g.stroke(); g.restore();
}
function bigStat(g: CanvasRenderingContext2D, x: number, y: number, label: string, value: string, sub: string) {
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = "#CFE9FF"; g.font = `500 44px ${BODY}`; g.fillText(label, x, y);
  g.shadowColor = "#7FD8FF"; g.shadowBlur = 20; g.fillStyle = "#FFFFFF"; g.font = `700 136px ${DISPLAY}`;
  g.fillText(value, x, y + 140); g.shadowBlur = 0;
  g.fillStyle = "#7FE0FF"; g.font = `500 38px ${BODY}`; g.fillText(sub, x, y + 196);
}

function dashboardTexture(d: Dashboard | null) {
  const W = 2560, H = 760;
  const { c, g } = canvas(W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#08142A"); bg.addColorStop(1, "#050B18");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,0.03)"; for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.shadowColor = ICE; g.shadowBlur = 14; g.fillStyle = "#7FD8FF"; g.font = `600 50px ${DISPLAY}`;
  g.fillText("Live company dashboard", 60, 84); g.shadowBlur = 0;
  if (!d) {
    g.fillStyle = "#CFE9FF"; g.font = `500 70px ${BODY}`; g.fillText("Connecting to headquarters…", 60, 400);
    return toTexture(c);
  }
  const simulated = d.provider === "simulated";
  if (simulated) {
    g.font = `600 40px ${BODY}`; const txt = "Simulated model: results are placeholders";
    const tw = g.measureText(txt).width;
    g.fillStyle = "rgba(255,176,32,0.18)"; g.strokeStyle = "#FFB020"; g.lineWidth = 3;
    g.beginPath(); g.roundRect(W - tw - 120, 36, tw + 60, 64, 14); g.fill(); g.stroke();
    g.fillStyle = "#FFCF70"; g.fillText(txt, W - tw - 90, 82);
  }
  const top = 130, ph = 580, gap = 36, x0 = 50;
  const ws = [560, 760, 520, 560];
  let x = x0;
  // agents
  panel(g, x, top, ws[0], ph);
  bigStat(g, x + 46, top + 80, "Agents online", `${d.agents_online}/${d.agents_total}`, `${d.agents_working} working · ${d.agents_idle} idle`);
  g.fillStyle = "#9FB6D6"; g.font = `500 36px ${BODY}`;
  g.fillText(d.agents_error ? `${d.agents_error} with errors` : "No agent errors", x + 46, top + 380);
  x += ws[0] + gap;
  // tasks + 14-day chart (real counts)
  panel(g, x, top, ws[1], ph);
  bigStat(g, x + 46, top + 80, "Tasks completed", String(d.tasks_completed), `${d.tasks_in_progress} in progress · ${d.tasks_pending} queued`);
  const days = d.daily_activity.slice(-14);
  const max = Math.max(1, ...days.map((v) => v.completed + v.failed));
  const cx = x + 46, cy = top + ph - 50, cw = ws[1] - 92, ch = 230, bw = cw / Math.max(14, days.length);
  g.strokeStyle = "rgba(127,216,255,0.25)"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + cw, cy); g.stroke();
  days.forEach((v, i) => {
    const hc = (v.completed / max) * ch, hf = (v.failed / max) * ch;
    g.fillStyle = "#2FA8FF"; g.shadowColor = ICE; g.shadowBlur = 10;
    g.fillRect(cx + i * bw + bw * 0.18, cy - hc, bw * 0.64, Math.max(hc, 3));
    if (hf) { g.fillStyle = "#FFB020"; g.fillRect(cx + i * bw + bw * 0.18, cy - hc - hf, bw * 0.64, hf); }
  });
  g.shadowBlur = 0; g.fillStyle = "#9FB6D6"; g.font = `500 30px ${BODY}`; g.fillText("Last 14 days", cx, cy + 40);
  x += ws[1] + gap;
  // approvals
  panel(g, x, top, ws[2], ph);
  bigStat(g, x + 46, top + 80, "Waiting for Lance", String(d.pending_approvals), d.pending_approvals ? "Open Approvals to decide" : "Nothing to approve");
  g.fillStyle = "#9FB6D6"; g.font = `500 36px ${BODY}`;
  g.fillText(`${d.tasks_failed} failed tasks`, x + 46, top + 380);
  x += ws[2] + gap;
  // agents active checklist
  panel(g, x, top, W - x - 50, ph);
  g.shadowColor = ICE; g.shadowBlur = 16; g.fillStyle = "#FFFFFF"; g.font = `700 64px ${DISPLAY}`;
  g.fillText("AI agents", x + 46, top + 100); g.shadowBlur = 0;
  const running = !d.controls.paused && !d.controls.emergency_stop;
  const rows: [boolean, string][] = [
    [running, d.controls.emergency_stop ? "Emergency stop is on" : d.controls.paused ? "Work queue paused" : "Work queue running"],
    [!simulated, simulated ? "Model: simulated" : `Model: ${d.provider}`],
    [true, `Today: ${d.today.tasks_started} tasks · $${d.today.cost_usd.toFixed(2)}`],
    [d.agents_error === 0, d.agents_error === 0 ? "All agents healthy" : `${d.agents_error} agents need help`],
  ];
  rows.forEach(([ok, text], i) => {
    const ry = top + 170 + i * 98;
    check(g, x + 46, ry, 58, ok);
    g.fillStyle = "#E6F4FF"; g.font = `500 42px ${BODY}`; g.fillText(text, x + 130, ry + 44, W - x - 230);
  });
  return toTexture(c);
}

function DashboardWall({ dashboard }: { dashboard: Dashboard | null }) {
  const { fonts } = useLogoAndFonts();
  const tex = useCanvasTexture(() => dashboardTexture(dashboard), [dashboard, fonts]);
  const W = 23, H = W * (760 / 2560);
  return (
    <group position={[10.4, 7.6 + H / 2 + 0.4, 13.6]}>
      <mesh position={[0, 0, -0.35]}><boxGeometry args={[W + 1, H + 0.9, 0.6]} /><meshStandardMaterial color="#10141C" metalness={0.6} roughness={0.35} />
        <Edges threshold={15} color={glow(ICE, 1.4)} /></mesh>
      <mesh position={[0, 0, 0.01]}><planeGeometry args={[W, H]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      <mesh position={[0, H / 2 + 0.47, 0]}><boxGeometry args={[W + 1, 0.08, 0.08]} /><meshBasicMaterial color={glow(ICE, 2.6)} toneMapped={false} /></mesh>
      <mesh position={[0, -H / 2 - 0.47, 0]}><boxGeometry args={[W + 1, 0.08, 0.08]} /><meshBasicMaterial color={glow(ICE, 2.6)} toneMapped={false} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ monument
function monumentTexture(d: Dashboard | null) {
  const W = 1200, H = 760;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#0B1220"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(79,195,255,0.8)"; g.lineWidth = 6; g.shadowColor = ICE; g.shadowBlur = 20;
  g.strokeRect(10, 10, W - 20, H - 20); g.shadowBlur = 0;
  // skyline glyph
  g.strokeStyle = "#4FC3FF"; g.lineWidth = 6; g.shadowColor = ICE; g.shadowBlur = 16;
  [[60, 300, 40, 150], [110, 250, 50, 200], [170, 320, 36, 130]].forEach(([x, y, w, h]) => g.strokeRect(x, y, w, h));
  g.shadowBlur = 0;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.shadowColor = ICE; g.shadowBlur = 18; g.fillStyle = "#7FD8FF"; g.font = `700 76px ${DISPLAY}`;
  g.fillText("Straight Flush", 260, 120); g.fillStyle = "#FFFFFF"; g.fillText("Intelligence HQ", 260, 205); g.shadowBlur = 0;
  const running = !!d && !d.controls.paused && !d.controls.emergency_stop;
  const rows: [boolean, string][] = d ? [
    [d.agents_online === d.agents_total, `AI agent workforce: ${d.agents_online} of ${d.agents_total} online`],
    [running, `Operations: ${d.controls.emergency_stop ? "emergency stop" : d.controls.paused ? "paused" : "running"}`],
    [d.provider !== "simulated", d.provider === "simulated" ? "Model: simulated (no live AI yet)" : `Model: live (${d.provider})`],
    [true, `Approvals waiting: ${d.pending_approvals}`],
  ] : [[false, "Connecting…"]];
  rows.forEach(([ok, t], i) => {
    const y = 290 + i * 110;
    check(g, 260, y, 64, ok);
    g.fillStyle = "#E6F4FF"; g.font = `500 50px ${BODY}`; g.fillText(t, 350, y + 50, W - 380);
  });
  return toTexture(c);
}

function Monument({ dashboard }: { dashboard: Dashboard | null }) {
  const { fonts } = useLogoAndFonts();
  const tex = useCanvasTexture(() => monumentTexture(dashboard), [dashboard, fonts]);
  return (
    <group position={[-19, 0, 45]} rotation-y={0.3}>
      <mesh position={[0, 2.2, 0]}><boxGeometry args={[10.6, 4.4, 1.2]} /><meshStandardMaterial color="#262A31" roughness={0.75} /></mesh>
      <mesh position={[0, 0.25, 0.2]}><boxGeometry args={[11.6, 0.5, 2]} /><meshStandardMaterial color="#1D2026" roughness={0.8} /></mesh>
      <mesh position={[0.3, 2.35, 0.61]}><planeGeometry args={[9.6, 9.6 * (760 / 1200)]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      <mesh position={[0, 0.52, 1.2]}><boxGeometry args={[11.2, 0.06, 0.06]} /><meshBasicMaterial color={glow(ICE, 2.2)} toneMapped={false} /></mesh>
      <Planter pos={[0, 0, 2.4]} size={[12, 1.8]} seed={21} />
      <Rocks pos={[-5.5, 0, 3.6]} seed={4} />
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ service-area hologram
const CITIES = ["Laguna Niguel", "Mission Viejo", "Aliso Viejo", "Irvine", "Dana Point", "San Juan Capistrano", "Laguna Hills", "San Clemente"];

function ServiceAreaModel({ reducedMotion }: { reducedMotion: boolean }) {
  const { fonts } = useLogoAndFonts();
  const blocks = useMemo(() => {
    const r = rng(77);
    return Array.from({ length: 46 }, (_, i) => {
      const tall = i % 9 === 0;
      return { x: (r() - 0.5) * 8.6, z: (r() - 0.5) * 3.6, w: 0.35 + r() * 0.5, h: tall ? 2.2 + r() * 1.2 : 0.4 + r() * 1.4 };
    });
  }, []);
  const label = useMemo(() => {
    const { c, g } = canvas(1400, 260);
    g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = ICE; g.shadowBlur = 20;
    g.fillStyle = "#FFFFFF"; g.font = `700 92px ${DISPLAY}`; g.fillText("Our service area", 700, 80);
    g.fillStyle = "#7FD8FF"; g.font = `500 46px ${BODY}`;
    g.fillText("South Orange County · 21 cities · " + CITIES.slice(0, 3).join(" · "), 700, 190, 1340);
    return toTexture(c);
  }, [fonts]);
  const holo = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (holo.current && !reducedMotion) holo.current.position.y = 1.25 + Math.sin(clock.elapsedTime * 1.2) * 0.04; });
  return (
    <group position={[21, 0, 45]} rotation-y={-0.3}>
      <mesh position={[0, 0.5, 0]}><boxGeometry args={[11, 1, 5.4]} /><meshStandardMaterial color="#1D2026" roughness={0.7} /></mesh>
      <mesh position={[0, 1.02, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[10.4, 4.8]} />
        <meshBasicMaterial color={glow("#0E3B66", 1)} toneMapped={false} /></mesh>
      <mesh position={[0, 3.2, 0]}><boxGeometry args={[10.6, 4.4, 5]} />
        <meshPhysicalMaterial color="#9EDCFF" transparent opacity={0.07} roughness={0.05} depthWrite={false} />
        <Edges threshold={15} color={glow(ICE, 1.3)} /></mesh>
      <group ref={holo} position={[0, 1.25, 0]}>
        {blocks.map((b, i) => (
          <mesh key={i} position={[b.x, b.h / 2, b.z]}>
            <boxGeometry args={[b.w, b.h, b.w]} />
            <meshBasicMaterial color={glow("#1F6FD6", 0.7)} transparent opacity={0.35} toneMapped={false} depthWrite={false} />
            <Edges threshold={15} color={glow(ICE, 1.9)} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.5, 2.71]}><planeGeometry args={[10.4, 10.4 * (260 / 1400)]} /><meshBasicMaterial map={label} toneMapped={false} /></mesh>
      <pointLight position={[0, 3, 2]} color={ICE} intensity={18} distance={12} />
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ truck
function Truck() {
  const { logo, fonts } = useLogoAndFonts();
  const decal = useMemo(() => {
    const { c, g } = canvas(1024, 300);
    let x = 20;
    if (logo && logo.naturalWidth) {
      const lh = 240, lw = lh * (logo.naturalWidth / logo.naturalHeight);
      g.fillStyle = "#FFFFFF"; g.beginPath(); g.roundRect(x, 30, lw + 20, lh, 16); g.fill();
      g.drawImage(logo, x + 10, 35, lw, lh - 10); x += lw + 50;
    }
    g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = "#FFFFFF";
    g.font = `700 92px ${DISPLAY}`; g.fillText("Straight Flush", x, 140, 1000 - x);
    g.fillStyle = "#9FB6D6"; g.font = `600 44px ${BODY}`; g.fillText("(949) 374-6524", x, 220, 1000 - x);
    return toTexture(c);
  }, [logo, fonts]);
  const paint = <meshPhysicalMaterial color="#0C0F14" metalness={0.6} roughness={0.25} clearcoat={1} clearcoatRoughness={0.08} />;
  const wheels: Vec3[] = [[-2.1, 0.55, 1.05], [-2.1, 0.55, -1.05], [2.05, 0.55, 1.05], [2.05, 0.55, -1.05]];
  return (
    <group position={[-30, 0, 32]} rotation-y={0.55}>
      <mesh position={[0, 1.15, 0]}><boxGeometry args={[6.4, 0.9, 2.2]} />{paint}</mesh>
      <mesh position={[0.9, 2.05, 0]}><boxGeometry args={[2.3, 1.0, 2.05]} />{paint}</mesh>
      <mesh position={[0.9, 2.08, 0]}><boxGeometry args={[2.15, 0.7, 2.08]} />
        <meshPhysicalMaterial color="#1B2A3D" metalness={0.2} roughness={0.05} clearcoat={1} /></mesh>
      <mesh position={[2.7, 1.55, 0]}><boxGeometry args={[1.4, 0.2, 2.15]} />{paint}</mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-1.95, 1.75, s * 1.05]}><boxGeometry args={[2.6, 0.5, 0.1]} />{paint}</mesh>
      ))}
      <mesh position={[-3.2, 1.75, 0]}><boxGeometry args={[0.1, 0.5, 2.2]} />{paint}</mesh>
      {wheels.map((p, i) => (
        <group key={i} position={p}>
          <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.55, 0.55, 0.42, 24]} /><meshStandardMaterial color="#0A0A0C" roughness={0.9} /></mesh>
          <mesh rotation-x={Math.PI / 2} position={[0, 0, Math.sign(p[2]) * 0.22]}><cylinderGeometry args={[0.32, 0.32, 0.02, 20]} />
            <meshStandardMaterial color="#8A929E" metalness={0.9} roughness={0.25} /></mesh>
        </group>
      ))}
      {[-0.75, 0.75].map((z) => (
        <mesh key={z} position={[3.21, 1.3, z]}><boxGeometry args={[0.04, 0.16, 0.5]} /><meshBasicMaterial color={glow("#EAF6FF", 3)} toneMapped={false} /></mesh>
      ))}
      {[-0.85, 0.85].map((z) => (
        <mesh key={z} position={[-3.26, 1.45, z]}><boxGeometry args={[0.04, 0.3, 0.2]} /><meshBasicMaterial color={glow("#FF2A2A", 2)} toneMapped={false} /></mesh>
      ))}
      <mesh position={[-0.6, 1.25, 1.112]}><planeGeometry args={[3.4, 1]} /><meshBasicMaterial map={decal} transparent toneMapped={false} /></mesh>
      <mesh position={[-0.6, 1.25, -1.112]} rotation-y={Math.PI}><planeGeometry args={[3.4, 1]} /><meshBasicMaterial map={decal} transparent toneMapped={false} /></mesh>
      <mesh position={[0, 0.7, 0]}><boxGeometry args={[6.2, 0.06, 2.24]} /><meshBasicMaterial color={glow(ICE, 1.6)} toneMapped={false} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------------------ world
export default function CampusWorld({ dashboard, reducedMotion }: { dashboard: Dashboard | null; reducedMotion: boolean }) {
  return (
    <group>
      <Sky />
      <Mountains />
      <Pines />
      <Ground />
      <BrandBlock />
      <Canopy />
      <DashboardWall dashboard={dashboard} />
      <Fountain reducedMotion={reducedMotion} />
      <Monument dashboard={dashboard} />
      <ServiceAreaModel reducedMotion={reducedMotion} />
      <Truck />
      <Planter pos={[10, 0, 19.5]} size={[14, 1.6]} seed={5} />
      <Planter pos={[-9, 0, 62]} size={[6, 2.2]} seed={6} />
      <Planter pos={[9, 0, 62]} size={[6, 2.2]} seed={7} />
      <Planter pos={[33, 0, 30]} size={[2.2, 10]} seed={8} />
      <Planter pos={[-33, 0, 14]} size={[2.2, 10]} seed={9} />
      <Rocks pos={[30, 0, 40]} seed={12} />
      {[22, 28, 34, 40, 46, 52, 58, 64, 70].flatMap((z) => [-13, 13].map((x) => <Bollard key={`${x}${z}`} pos={[x, 0, z]} />))}
    </group>
  );
}
