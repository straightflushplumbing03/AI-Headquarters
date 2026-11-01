// The oceanfront plaza from the approved exterior image: sunset over the Pacific with an island and a yacht, palms,
// a wet LED-lit plaza with the lit fountain, fire-pit lounges, the café, the SUV, an outdoor pool table, the
// "One Mission" bridge screen, the Longevity tower with the Empire Expansion and Stock Exchange signs, a bronze bull
// and the logo mat. Screens with business data stay honest: anything not connected says so.
import { MeshReflectorMaterial, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Palms, PoolTable, Sofa, SUV, glow } from "./props";
import { canvas, rugTexture, signTexture, toTexture, useBrand, useCanvasTexture, useOptionalImage } from "./screens";

const LED = "#2F8CFF";
const SUN_DIR = new THREE.Vector3(0.05, 0.035, -1).normalize();
const PLAZA = { x0: -40, x1: 104, z0: -34, z1: 50 };

// ------------------------------------------------------------------------------------------------ sky + ocean
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      float y = vDir.y; float s = max(dot(vDir, sunDir), 0.0);
      vec3 c = mix(vec3(1.0,0.62,0.28), vec3(0.95,0.42,0.38), smoothstep(0.0,0.09,y));
      c = mix(c, vec3(0.42,0.28,0.55), smoothstep(0.07,0.25,y));
      c = mix(c, vec3(0.12,0.12,0.30), smoothstep(0.22,0.5,y));
      c = mix(c, vec3(0.04,0.05,0.14), smoothstep(0.5,0.95,y));
      c += vec3(1.0,0.6,0.25) * pow(s, 14.0) * 0.45 + vec3(1.0,0.82,0.5) * smoothstep(0.9993, 0.9996, s) * 0.9;
      vec2 uv = vec2(atan(vDir.z, vDir.x) * 4.0, y * 26.0);
      float cl = n(uv) * 0.6 + n(uv * vec2(2.4, 2.0)) * 0.4;
      cl = smoothstep(0.52, 0.85, cl) * smoothstep(0.03, 0.1, y) * (1.0 - smoothstep(0.3, 0.45, y));
      c = mix(c, vec3(1.0, 0.55, 0.45) * (0.7 + pow(s, 3.0)), cl * 0.6);
      if (y < 0.0) c = vec3(0.9, 0.5, 0.3) * 0.6;
      gl_FragColor = vec4(c * 0.92, 1.0);
    }`,
});

const oceanMaterial = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 }, sunDir: { value: SUN_DIR } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float time; uniform vec3 sunDir; varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      vec3 V = normalize(cameraPosition - vW);
      vec2 p = vW.xz * vec2(0.07, 0.16);
      float a = n(p + vec2(time*0.06, time*0.03)), b = n(p*2.3 - vec2(time*0.05, -time*0.04));
      vec3 N = normalize(vec3((a - 0.5) * 0.5 + (b - 0.5) * 0.3, 1.0, (b - 0.5) * 0.5));
      vec3 R = reflect(-V, N);
      float y = max(R.y, 0.0);
      vec3 sky = mix(vec3(1.0,0.58,0.3), vec3(0.45,0.3,0.55), smoothstep(0.0, 0.3, y));
      float fres = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      float sd = max(dot(R, sunDir), 0.0);
      vec3 col = mix(vec3(0.03,0.07,0.15), sky, fres) + vec3(1.0,0.72,0.38) * (pow(sd, 400.0) * 7.0 + pow(sd, 40.0) * 0.5);
      gl_FragColor = vec4(col, 1.0);
    }`,
});

function SkyAndSea({ reducedMotion }: { reducedMotion: boolean }) {
  useFrame((_, dt) => { if (!reducedMotion) oceanMaterial.uniforms.time.value += dt; });
  const island = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 48, 6);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > -0.45) pos.setY(i, y * (0.75 + 0.25 * Math.sin(pos.getX(i) * 9 + pos.getZ(i) * 5)));
    }
    g.computeVertexNormals(); return g;
  }, []);
  return (
    <group>
      <mesh renderOrder={-10} material={skyMaterial}><sphereGeometry args={[780, 48, 24]} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[30, -0.25, -420]} material={oceanMaterial}><planeGeometry args={[1600, 760]} /></mesh>
      <mesh geometry={island} position={[70, 6, -520]} scale={[150, 26, 40]}>
        <meshStandardMaterial color="#2B2442" roughness={1} fog={false} /></mesh>
      <mesh geometry={island} position={[-160, 3, -560]} scale={[90, 14, 30]}>
        <meshStandardMaterial color="#332A4A" roughness={1} fog={false} /></mesh>
      {/* yacht */}
      <group position={[30, 0, -170]} rotation-y={0.3}>
        <RoundedBox args={[14, 1.6, 3.4]} radius={0.6} position={[0, 0.8, 0]}><meshStandardMaterial color="#F2F2F0" roughness={0.3} /></RoundedBox>
        <RoundedBox args={[7, 1.3, 2.6]} radius={0.4} position={[-1, 2.2, 0]}><meshStandardMaterial color="#EDEDEA" roughness={0.3} /></RoundedBox>
        <mesh position={[-1, 2.2, 1.32]}><boxGeometry args={[6.4, 0.5, 0.02]} /><meshBasicMaterial color={glow("#FFD9A0", 1.6)} toneMapped={false} /></mesh>
      </group>
      {/* beach and land */}
      <mesh rotation-x={-Math.PI / 2} position={[30, -0.04, -42]}><planeGeometry args={[900, 18]} /><meshStandardMaterial color="#8A6A4E" roughness={1} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[30, -0.06, 120]}><planeGeometry args={[900, 340]} /><meshStandardMaterial color="#1F1A18" roughness={1} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ plaza
function Plaza() {
  const tiles = useMemo(() => {
    const { c, g } = canvas(512, 512);
    g.fillStyle = "#3A342F"; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 70 + Math.random() * 18;
      g.fillStyle = `rgb(${v + 6},${v},${v - 6})`; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
    }
    const t = toTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set((PLAZA.x1 - PLAZA.x0) / 6, (PLAZA.z1 - PLAZA.z0) / 6); return t;
  }, []);
  const w = PLAZA.x1 - PLAZA.x0, d = PLAZA.z1 - PLAZA.z0;
  const edge = (pos: [number, number, number], size: [number, number]) => (
    <mesh rotation-x={-Math.PI / 2} position={pos}><planeGeometry args={size} /><meshBasicMaterial color={glow(LED, 2)} toneMapped={false} /></mesh>
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(PLAZA.x0 + PLAZA.x1) / 2, -0.01, (PLAZA.z0 + PLAZA.z1) / 2]}>
        <planeGeometry args={[w, d]} />
        <MeshReflectorMaterial map={tiles} blur={[220, 70]} resolution={1024} mixBlur={0.85} mixStrength={26} roughness={0.5}
          depthScale={1} minDepthThreshold={0.5} maxDepthThreshold={1.3} color="#C9BBAE" metalness={0.5} mirror={0.78} />
      </mesh>
      {edge([(PLAZA.x0 + PLAZA.x1) / 2, 0.01, PLAZA.z1], [w, 0.2])}
      {edge([(PLAZA.x0 + PLAZA.x1) / 2, 0.01, PLAZA.z0], [w, 0.2])}
      {edge([PLAZA.x1, 0.01, (PLAZA.z0 + PLAZA.z1) / 2], [0.2, d])}
      {[[38, 30, 28], [66, 30, 28]].map(([x, z, l]) => edge([x, 0.012, z], [0.1, l]))}
    </group>
  );
}

function LampPost({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 2.4, 0]}><cylinderGeometry args={[0.07, 0.11, 4.8, 10]} /><meshStandardMaterial color="#111" metalness={0.7} /></mesh>
      <mesh position={[0, 4.9, 0]}><sphereGeometry args={[0.32, 16, 16]} /><meshBasicMaterial color={glow("#FFC77A", 2.6)} toneMapped={false} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ fountain + fire pits
function Fountain({ position, reducedMotion }: { position: [number, number, number]; reducedMotion: boolean }) {
  const jets = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    jets.current.forEach((m, i) => {
      if (!m) return;
      const k = i === 0 ? 1 : 0.55 + 0.25 * Math.sin(t * 1.6 + i);
      m.scale.y = reducedMotion ? 1 : k;
    });
  });
  const ring = Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2);
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[6.6, 6.9, 0.9, 64, 1, true]} /><meshStandardMaterial color="#3A3632" roughness={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.91, 0]}><ringGeometry args={[6.1, 6.75, 64]} /><meshStandardMaterial color="#4A4540" roughness={0.5} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.7, 0]}><circleGeometry args={[6.1, 64]} />
        <meshStandardMaterial color="#0A2D55" emissive="#1E6FD6" emissiveIntensity={0.9} roughness={0.15} metalness={0.3} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 0]}><ringGeometry args={[7.0, 7.25, 96]} /><meshBasicMaterial color={glow(LED, 2.2)} toneMapped={false} /></mesh>
      <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.6, 1.2, 1.4, 24]} /><meshStandardMaterial color="#4A4540" roughness={0.5} /></mesh>
      <mesh position={[0, 2.2, 0]}><cylinderGeometry args={[2.4, 0.7, 0.4, 32]} /><meshStandardMaterial color="#4A4540" roughness={0.5} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 2.41, 0]}><circleGeometry args={[2.3, 32]} /><meshBasicMaterial color={glow("#3F9BFF", 1.2)} toneMapped={false} /></mesh>
      {/* jets: centre plume plus a ring */}
      <mesh ref={(m) => { if (m) jets.current[0] = m; }} position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.12, 0.35, 5.2, 16, 1, true]} />
        <meshBasicMaterial color={glow("#BFE6FF", 1.6)} transparent opacity={0.55} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {ring.map((a, i) => (
        <group key={a} position={[Math.cos(a) * 4.4, 0.7, Math.sin(a) * 4.4]}>
          <mesh ref={(m) => { if (m) jets.current[i + 1] = m; }} position={[0, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.12, 2.6, 10, 1, true]} />
            <meshBasicMaterial color={glow("#9FD4FF", 1.6)} transparent opacity={0.5} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <pointLight position={[0, 3, 0]} color="#3F9BFF" intensity={60} distance={22} />
    </group>
  );
}

function FirePit({ position, reducedMotion }: { position: [number, number, number]; reducedMotion: boolean }) {
  const flames = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (flames.current && !reducedMotion) flames.current.children.forEach((c, i) => { c.scale.y = 0.8 + 0.35 * Math.abs(Math.sin(t * 6 + i * 1.7)); });
    if (light.current && !reducedMotion) light.current.intensity = 22 + Math.sin(t * 9) * 4;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]}><cylinderGeometry args={[1.3, 1.45, 0.6, 32]} /><meshStandardMaterial color="#3B3631" roughness={0.7} /></mesh>
      <group ref={flames} position={[0, 0.6, 0]}>
        {[[0, 0], [0.4, 0.2], [-0.35, 0.25], [0.1, -0.4], [-0.2, -0.2]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.45, z]}><coneGeometry args={[0.28, 1.1 - i * 0.1, 10]} />
            <meshBasicMaterial color={glow(i % 2 ? "#FF7A1A" : "#FFB13C", 2.6)} transparent opacity={0.85} toneMapped={false} depthWrite={false} /></mesh>
        ))}
      </group>
      <pointLight ref={light} position={[0, 1.5, 0]} color="#FF8A3C" intensity={22} distance={12} />
      <Sofa position={[0, 0, -3.1]} width={3.4} />
      <Sofa position={[0, 0, 3.1]} rotation={Math.PI} width={3.4} />
      <Sofa position={[-3.1, 0, 0]} rotation={Math.PI / 2} width={2.6} />
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ café
function Cafe() {
  const sign = useMemo(() => signTexture([{ text: "SAFE BET COFFEE", size: 120, color: "#F4ECDD" }, { text: "espresso · pastries · wifi", size: 54, color: "#C9A46A" }],
    1600, 420, "#14231B", "#3E8A5C"), []);
  const umbrellas = [[27, 18], [32, 18], [27, 24], [32, 24], [37, 21]];
  return (
    <group>
      <mesh position={[28.5, 3, 6]}><boxGeometry args={[11, 6, 16]} /><meshStandardMaterial color="#2A221C" roughness={0.6} /></mesh>
      <mesh position={[34.06, 2.4, 6]} rotation-y={Math.PI / 2}><planeGeometry args={[14, 4.2]} />
        <meshBasicMaterial color={glow("#FFC98A", 0.8)} toneMapped={false} /></mesh>
      <mesh position={[28.5, 2.4, 14.06]}><planeGeometry args={[9, 4.2]} /><meshBasicMaterial color={glow("#FFC98A", 0.8)} toneMapped={false} /></mesh>
      <mesh position={[34.1, 5.2, 6]} rotation-y={Math.PI / 2}><planeGeometry args={[9, 2.36]} /><meshBasicMaterial map={sign} toneMapped={false} /></mesh>
      <mesh position={[28.5, 6.05, 6]}><boxGeometry args={[11.4, 0.1, 16.4]} /><meshBasicMaterial color={glow(LED, 1.6)} toneMapped={false} /></mesh>
      {umbrellas.map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}>
          <mesh position={[0, 1.4, 0]}><cylinderGeometry args={[0.05, 0.05, 2.8, 8]} /><meshStandardMaterial color="#222" /></mesh>
          <mesh position={[0, 2.85, 0]}><coneGeometry args={[1.9, 0.75, 8, 1, true]} /><meshStandardMaterial color="#1F4A36" roughness={0.8} side={THREE.DoubleSide} /></mesh>
          <mesh position={[0, 0.75, 0]}><cylinderGeometry args={[0.6, 0.6, 0.05, 20]} /><meshStandardMaterial color="#2A2522" /></mesh>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} position={[Math.cos(k * 1.57) * 1.0, 0.45, Math.sin(k * 1.57) * 1.0]}><boxGeometry args={[0.45, 0.06, 0.45]} />
              <meshStandardMaterial color="#3A2A20" /></mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ Longevity tower
function windowBands() {
  const { c, g } = canvas(1024, 512);
  g.fillStyle = "#0B1020"; g.fillRect(0, 0, 1024, 512);
  for (let row = 0; row < 7; row++) for (let col = 0; col < 32; col++) {
    const lit = Math.random() < 0.75;
    g.fillStyle = lit ? `rgba(255,${190 + Math.random() * 40},${120 + Math.random() * 40},${0.6 + Math.random() * 0.4})` : "#141A2C";
    g.fillRect(col * 32 + 3, row * 73 + 14, 26, 50);
  }
  const t = toTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); return t;
}

function LongevityTower() {
  const C: [number, number, number] = [76, 0, -14];
  const R = 13, HT = 26;
  const facing = Math.atan2(30 - C[0], 82 - C[2]);           // toward the plaza camera
  const bands = useMemo(windowBands, []);
  const dog = useOptionalImage("/dog.jpg");
  const { fonts } = useBrand();
  const portrait = useCanvasTexture(() => {
    const { c, g } = canvas(800, 1000);
    g.fillStyle = "#0B1430"; g.fillRect(0, 0, 800, 1000);
    if (dog) {
      const s = Math.max(800 / dog.naturalWidth, 1000 / dog.naturalHeight);
      g.drawImage(dog, (800 - dog.naturalWidth * s) / 2, (1000 - dog.naturalHeight * s) / 2, dog.naturalWidth * s, dog.naturalHeight * s);
    } else {
      g.fillStyle = "#5FB0FF";
      g.beginPath(); g.ellipse(400, 600, 170, 140, 0, 0, Math.PI * 2); g.fill();
      [[250, 400], [340, 330], [460, 330], [550, 400]].forEach(([x, y]) => { g.beginPath(); g.ellipse(x, y, 60, 75, 0, 0, Math.PI * 2); g.fill(); });
    }
    g.strokeStyle = "#4FC3FF"; g.lineWidth = 14; g.strokeRect(7, 7, 786, 986);
    return toTexture(c);
  }, [dog]);
  const title = useCanvasTexture(() => signTexture([
    { text: "LONGEVITY", size: 150, color: "#E6F4FF" },
    { text: "Headquarters &", size: 96, color: "#BFE3FF" }, { text: "Wellness", size: 110, color: "#BFE3FF" },
  ], 900, 1000, "#0A1636", "#4FC3FF"), [fonts]);
  const empire = useCanvasTexture(() => signTexture([
    { text: "♛", size: 120, color: "#FFD45A" }, { text: "EMPIRE", size: 110, color: "#FFFFFF" }, { text: "EXPANSION", size: 96, color: "#FFFFFF" },
    { text: "DISTRICT", size: 96, color: "#FFFFFF" }, { text: "◆ Build", size: 70, color: "#BFE3FF" }, { text: "◆ Innovate", size: 70, color: "#BFE3FF" }, { text: "◆ Grow", size: 70, color: "#BFE3FF" },
  ], 640, 1200, "#0A1636", "#4FC3FF"), [fonts]);
  const exchange = useCanvasTexture(() => signTexture([
    { text: "BADGWELL STOCK EXCHANGE", size: 96, color: "#FFFFFF" },
    { text: "Market data not connected yet", size: 56, color: "#8FA3BF" },
  ], 1600, 420, "#0A1636", "#4FC3FF"), [fonts]);
  const onFace = (dTheta: number, y: number, out = 0.35) => {
    const a = facing + dTheta;
    return { position: [C[0] + Math.sin(a) * (R + out), y, C[2] + Math.cos(a) * (R + out)] as [number, number, number], rotY: a };
  };
  const p1 = onFace(-0.32, 15.5), p2 = onFace(0.05, 15.5), p3 = onFace(0.42, 14), p4 = onFace(0, 3.2, 0.4);
  return (
    <group>
      <mesh position={[C[0], HT / 2, C[2]]}><cylinderGeometry args={[R, R, HT, 72, 1, true]} />
        <meshStandardMaterial map={bands} emissiveMap={bands} emissive="#FFFFFF" emissiveIntensity={0.55} roughness={0.25} metalness={0.4} /></mesh>
      <mesh position={[C[0], HT + 0.4, C[2]]}><cylinderGeometry args={[R + 0.6, R + 0.6, 0.8, 72]} /><meshStandardMaterial color="#1B2030" /></mesh>
      {Array.from({ length: 8 }, (_, i) => i * (HT / 7)).map((y) => (
        <mesh key={y} position={[C[0], y + 0.05, C[2]]} rotation-x={Math.PI / 2}><torusGeometry args={[R + 0.15, 0.09, 6, 128]} />
          <meshBasicMaterial color={glow(LED, 2.2)} toneMapped={false} /></mesh>
      ))}
      <mesh position={[C[0], HT + 0.85, C[2]]} rotation-x={Math.PI / 2}><torusGeometry args={[R + 0.6, 0.14, 6, 128]} /><meshBasicMaterial color={glow(LED, 3)} toneMapped={false} /></mesh>
      <group position={p1.position} rotation-y={p1.rotY}><mesh><planeGeometry args={[7.2, 9]} /><meshBasicMaterial map={portrait} toneMapped={false} /></mesh></group>
      <group position={p2.position} rotation-y={p2.rotY}><mesh><planeGeometry args={[7.2, 8]} /><meshBasicMaterial map={title} toneMapped={false} /></mesh></group>
      <group position={p3.position} rotation-y={p3.rotY}><mesh><planeGeometry args={[4.6, 8.6]} /><meshBasicMaterial map={empire} toneMapped={false} /></mesh></group>
      <group position={p4.position} rotation-y={p4.rotY}><mesh><planeGeometry args={[12, 3.15]} /><meshBasicMaterial map={exchange} toneMapped={false} /></mesh></group>
    </group>
  );
}

/** A generic bronze bull in front of the exchange. */
function Bull({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const bronze = <meshStandardMaterial color="#8A5A2B" metalness={0.85} roughness={0.35} />;
  return (
    <group position={position} rotation-y={rotation}>
      <mesh position={[0, 0.3, 0]}><boxGeometry args={[4, 0.6, 2]} /><meshStandardMaterial color="#3A3632" /></mesh>
      <mesh position={[0, 2.0, 0]} scale={[1.6, 0.85, 0.75]}><sphereGeometry args={[1, 20, 16]} />{bronze}</mesh>
      <mesh position={[1.55, 2.2, 0]} rotation-z={-0.5} scale={[0.75, 0.55, 0.5]}><sphereGeometry args={[1, 16, 12]} />{bronze}</mesh>
      {[-0.32, 0.32].map((z) => (
        <mesh key={z} position={[1.85, 2.75, z * 1.6]} rotation={[z > 0 ? -0.9 : 0.9, 0, -0.4]}><coneGeometry args={[0.1, 0.8, 8]} />{bronze}</mesh>
      ))}
      {[[-1, -0.4], [-1, 0.4], [0.9, -0.4], [0.9, 0.4]].map(([x, z], i) => (
        <mesh key={i} position={[x, 1.05, z]} rotation-z={x > 0 ? 0.25 : -0.2}><cylinderGeometry args={[0.16, 0.12, 1.1, 10]} />{bronze}</mesh>
      ))}
      <mesh position={[-1.75, 2.2, 0]} rotation-z={0.9}><cylinderGeometry args={[0.05, 0.05, 1.2, 6]} />{bronze}</mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ mission bridge + mat
function MissionBridge() {
  const { fonts } = useBrand();
  const tex = useCanvasTexture(() => signTexture([
    { text: "One Mission. Total Domination.", size: 150, color: "#FFFFFF" },
    { text: "— LAGUNA NIGUEL · ORANGE COUNTY —", size: 60, color: "#9FD4FF" },
  ], 2400, 400, "#0A1636", "#4FC3FF"), [fonts]);
  return (
    <group position={[56, 0, -28]}>
      {[-22, 22].map((x) => <mesh key={x} position={[x, 4.5, 0]}><boxGeometry args={[1.2, 9, 1.2]} /><meshStandardMaterial color="#1E2024" metalness={0.4} /></mesh>)}
      <mesh position={[0, 6.5, 0]}><boxGeometry args={[45, 0.6, 3]} /><meshStandardMaterial color="#1E2024" metalness={0.4} /></mesh>
      <mesh position={[0, 6.2, 1.52]}><boxGeometry args={[45, 0.08, 0.08]} /><meshBasicMaterial color={glow(LED, 2.4)} toneMapped={false} /></mesh>
      <mesh position={[0, 8.6, 0.2]}><planeGeometry args={[24, 4]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
    </group>
  );
}

function LogoMat() {
  const { logo, fonts } = useBrand();
  const tex = useCanvasTexture(() => rugTexture(logo), [logo, fonts]);
  return (
    <group position={[46, 0.03, 34]}>
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[18, 9]} /><meshStandardMaterial map={tex} roughness={0.9} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.005, 0]}><planeGeometry args={[18.6, 9.6]} /><meshBasicMaterial color={glow(LED, 1.8)} toneMapped={false} /></mesh>
    </group>
  );
}

// ------------------------------------------------------------------------------------------------ world
const PALM_SPOTS: [number, number, number?][] = [
  ...Array.from({ length: 16 }, (_, i) => [-36 + i * 9, -31 - (i % 2) * 2.5, 1 + (i % 3) * 0.12] as [number, number, number]),
  [24, 15, 1.1], [38, 13, 1.2], [38, -14, 1.15], [58, -16, 1.1], [72, 16, 1.25], [44, 46, 1.1], [62, 46, 1.2],
  [-26, 18, 1.1], [-26, -6, 1.15], [-30, 30, 1.2], [14, 30, 1.1], [-10, 32, 1.15], [100, 30, 1.2], [96, 6, 1.1], [80, 40, 1.15],
];

export default function Oceanfront({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group>
      <SkyAndSea reducedMotion={reducedMotion} />
      <Plaza />
      <Palms spots={PALM_SPOTS} />
      <Fountain position={[52, 0, 6]} reducedMotion={reducedMotion} />
      <FirePit position={[38, 0, -4]} reducedMotion={reducedMotion} />
      <FirePit position={[66, 0, 30]} reducedMotion={reducedMotion} />
      <Cafe />
      <SUV position={[62, 0, 15]} rotation={-0.5} />
      <PoolTable position={[82, 0, 24]} rotation={0.3} />
      <MissionBridge />
      <LongevityTower />
      <Bull position={[68, 0, 9]} rotation={-2.4} />
      <LogoMat />
      {[[30, 34], [62, 46], [90, 18], [40, -20], [72, -20], [12, 40], [-14, 42], [96, -24]].map(([x, z]) => <LampPost key={`${x}${z}`} position={[x, 0, z]} />)}
    </group>
  );
}

