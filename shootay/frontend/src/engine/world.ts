// Turns a shared MapDef into renderable geometry: one merged mesh per material (few draw calls),
// procedural canvas textures, night sky, skyline, lights and the collider used for movement.
import * as THREE from 'three';
import { rng } from '../../../shared/constants';
import { BARREL_SIZE, MapDef, Mat, mapColliderBoxes } from '../../../shared/maps';
import { Collider } from '../../../shared/physics';

type Painter = (g: CanvasRenderingContext2D, e: CanvasRenderingContext2D | null, r: () => number) => void;
interface MatSpec { paint: Painter; tile: number; emissive?: number; rough?: number; metal?: number; basic?: boolean; opacity?: number }

const noise = (g: CanvasRenderingContext2D, r: () => number, base: [number, number, number], amp: number, n = 64) => {
  for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
    const k = (r() - 0.5) * amp;
    g.fillStyle = `rgb(${base[0] + k | 0},${base[1] + k | 0},${base[2] + k | 0})`;
    g.fillRect(x, y, 2, 2);
  }
};
const corrugated = (c: [number, number, number]): Painter => (g, _e, r) => {
  noise(g, r, c, 14);
  for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(x, 0, 3, 64); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 4, 0, 1, 64); }
  g.fillStyle = 'rgba(60,30,10,0.35)';
  for (let i = 0; i < 6; i++) g.fillRect(r() * 60, r() * 60, 2 + r() * 5, 4 + r() * 10); // rust streaks
};
const bricks = (c: [number, number, number]): Painter => (g, _e, r) => {
  g.fillStyle = '#0d0b0b'; g.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) {
    const k = (r() - 0.5) * 26;
    g.fillStyle = `rgb(${c[0] + k | 0},${c[1] + k * 0.6 | 0},${c[2] + k * 0.5 | 0})`;
    g.fillRect(col * 16 + (row % 2) * 8 + 1, row * 8 + 1, 14, 6);
  }
};
const neon = (hex: string): Painter => (g, e) => { g.fillStyle = hex; g.fillRect(0, 0, 64, 64); e!.fillStyle = hex; e!.fillRect(0, 0, 64, 64); };

const SPECS: Record<Mat, MatSpec> = {
  asphalt: { tile: 4, rough: 0.95, paint: (g, _e, r) => { noise(g, r, [26, 26, 30], 12); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.moveTo(r() * 64, 0); g.lineTo(r() * 64, 30); g.lineTo(r() * 64, 64); g.stroke(); } },
  sidewalk: { tile: 4, rough: 0.9, paint: (g, _e, r) => { noise(g, r, [58, 58, 64], 10); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 32, 64, 1); g.fillRect(0, 0, 1, 64); g.fillRect(32, 0, 1, 64); } },
  concrete: { tile: 4, rough: 0.9, paint: (g, _e, r) => { noise(g, r, [70, 70, 74], 16); g.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 5; i++) g.fillRect(r() * 60, 0, 1 + r() * 3, 20 + r() * 44); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 63, 64, 1); } },
  brick: { tile: 2, rough: 0.92, paint: bricks([96, 44, 36]) },
  darkbrick: { tile: 2, rough: 0.92, paint: bricks([48, 38, 44]) },
  metal: { tile: 4, rough: 0.5, metal: 0.7, paint: (g, _e, r) => { noise(g, r, [62, 66, 72], 10); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64); g.fillStyle = 'rgba(255,255,255,0.12)'; for (const [x, y] of [[4, 4], [59, 4], [4, 59], [59, 59]]) g.fillRect(x, y, 2, 2); } },
  rust: { tile: 4, rough: 0.95, metal: 0.2, paint: (g, _e, r) => { noise(g, r, [88, 52, 34], 30); g.fillStyle = 'rgba(30,14,8,0.4)'; for (let i = 0; i < 9; i++) g.fillRect(r() * 60, r() * 60, 3 + r() * 9, 3 + r() * 9); } },
  contR: { tile: 2.6, rough: 0.7, metal: 0.4, paint: corrugated([110, 34, 30]) },
  contB: { tile: 2.6, rough: 0.7, metal: 0.4, paint: corrugated([34, 52, 86]) },
  contG: { tile: 2.6, rough: 0.7, metal: 0.4, paint: corrugated([40, 66, 54]) },
  windows: { tile: 6, rough: 0.6, emissive: 1.4, paint: (g, e, r) => {
    noise(g, r, [30, 30, 36], 8);
    e!.fillStyle = '#000'; e!.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const lit = r() < 0.3, warm = r() < 0.7;
      g.fillStyle = lit ? (warm ? '#b8935a' : '#7f9ec9') : '#0a0c12';
      g.fillRect(x * 16 + 3, y * 16 + 3, 10, 9);
      if (lit) { e!.fillStyle = warm ? '#c79a55' : '#6f93c9'; e!.fillRect(x * 16 + 3, y * 16 + 3, 10, 9); if (r() < 0.5) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x * 16 + 3, y * 16 + 3, 10, 2 + r() * 5); } }
    }
  } },
  glass: { tile: 4, rough: 0.1, metal: 0.6, opacity: 0.5, paint: (g, _e, r) => { noise(g, r, [26, 40, 58], 6); g.fillStyle = 'rgba(160,200,255,0.18)'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64); } },
  wood: { tile: 2, rough: 0.85, paint: (g, _e, r) => { noise(g, r, [84, 60, 38], 14); g.fillStyle = 'rgba(0,0,0,0.4)'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1); g.fillRect(0, 0, 1, 64); g.fillRect(63, 0, 1, 64); } },
  roof: { tile: 4, rough: 1, paint: (g, _e, r) => noise(g, r, [20, 20, 23], 10) },
  dark: { tile: 4, rough: 0.7, metal: 0.3, paint: (g, _e, r) => noise(g, r, [16, 16, 19], 6) },
  car: { tile: 4, rough: 0.35, metal: 0.8, paint: (g, _e, r) => { noise(g, r, [30, 22, 34], 6); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 20, 64, 2); } },
  tower: { tile: 4, rough: 0.4, metal: 0.7, paint: (g, _e, r) => { noise(g, r, [24, 26, 34], 6); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 64, 1); g.fillRect(0, 0, 1, 64); g.fillStyle = 'rgba(150,120,255,0.1)'; g.fillRect(0, 31, 64, 1); } },
  barrel: { tile: 1.2, rough: 0.6, metal: 0.5, paint: (g, _e, r) => { noise(g, r, [120, 24, 26], 14); g.fillStyle = '#1a1a1c'; g.fillRect(0, 12, 64, 4); g.fillRect(0, 46, 64, 4); g.fillStyle = '#e0b030'; g.fillRect(22, 24, 20, 14); g.fillStyle = '#1a1a1c'; g.fillRect(30, 26, 4, 7); g.fillRect(30, 34, 4, 2); } },
  neonP: { tile: 4, basic: true, paint: neon('#b04dff') },
  neonR: { tile: 4, basic: true, paint: neon('#ff2d45') },
  neonC: { tile: 4, basic: true, paint: neon('#39d6ff') },
  lamp: { tile: 4, basic: true, paint: neon('#ffe2b0') },
};

const matCache = new Map<string, THREE.Material>();
export function worldMaterial(m: Mat, low: boolean): THREE.Material {
  const key = m + (low ? ':low' : '');
  let mat = matCache.get(key);
  if (mat) return mat;
  const spec = SPECS[m];
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 64; return c; };
  const c = mk(), ec = spec.emissive ? mk() : null;
  spec.paint(c.getContext('2d')!, spec.basic ? c.getContext('2d')! : ec?.getContext('2d') ?? null, rng(m.length * 7919 + m.charCodeAt(0)));
  const tex = (cv: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = low ? 1 : 4;
    return t;
  };
  if (spec.basic) mat = new THREE.MeshBasicMaterial({ map: tex(c), vertexColors: false, fog: false });
  else if (low) mat = new THREE.MeshLambertMaterial({ map: tex(c), vertexColors: true, emissiveMap: ec ? tex(ec) : null, emissive: ec ? 0xffffff : 0, emissiveIntensity: spec.emissive ?? 0, transparent: !!spec.opacity, opacity: spec.opacity ?? 1 });
  else mat = new THREE.MeshStandardMaterial({ map: tex(c), vertexColors: true, roughness: spec.rough ?? 0.8, metalness: spec.metal ?? 0, emissiveMap: ec ? tex(ec) : null, emissive: ec ? 0xffffff : 0, emissiveIntensity: spec.emissive ?? 0, transparent: !!spec.opacity, opacity: spec.opacity ?? 1 });
  matCache.set(key, mat);
  return mat;
}

/** Merges boxes into a single BufferGeometry with world-space UVs (so textures tile like voxels) and per-box tint. */
function mergeBoxes(boxes: number[][], tile: number, seed: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const r = rng(seed);
  const face = (v: number[][], n: number[], uvOf: (p: number[]) => [number, number], shade: number) => {
    const base = pos.length / 3;
    for (const p of v) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); const [u, w] = uvOf(p); uv.push(u / tile, w / tile); col.push(shade, shade, shade); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    const s = 0.82 + r() * 0.18;
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], (p) => [p[0], p[2]], s);
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], (p) => [p[0], p[2]], s * 0.6);
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], (p) => [p[0], p[1]], s * 0.92);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], (p) => [p[0], p[1]], s * 0.92);
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], (p) => [p[2], p[1]], s * 0.85);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], (p) => [p[2], p[1]], s * 0.85);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}

/** Night sky dome, stars, moon and a distant lit skyline. Shared by matches and the lobby. */
export function buildSky(scene: THREE.Scene, top: number, horizon: number, radius = 260) {
  const g = new THREE.Group();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying float h; void main(){ gl_FragColor = vec4(mix(hor, top, smoothstep(-0.05, 0.55, h)), 1.0); }',
  }));
  g.add(sky);
  const r = rng(77), sp: number[] = [];
  for (let i = 0; i < 350; i++) { const a = r() * 6.283, e = 0.12 + r() * 1.3; sp.push(Math.cos(a) * Math.cos(e) * radius * 0.95, Math.sin(e) * radius * 0.95, Math.sin(a) * Math.cos(e) * radius * 0.95); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfc4ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xd9d4ff, fog: false, depthWrite: false }));
  moon.position.set(-90, 120, -160); moon.scale.setScalar(46); g.add(moon);
  // skyline: instanced towers with lit-window texture, far outside the playable area
  const n = 46, inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), worldMaterialSkyline(), n), m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + r() * 0.1, d = 95 + r() * 60, h = 18 + r() * 60, w = 10 + r() * 14;
    m4.compose(new THREE.Vector3(Math.cos(a) * d, h / 2 - 4, Math.sin(a) * d), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 3), new THREE.Vector3(w, h, w));
    inst.setMatrixAt(i, m4);
  }
  g.add(inst);
  scene.add(g);
  return g;
}
let skylineMat: THREE.Material | null = null;
function worldMaterialSkyline() {
  if (skylineMat) return skylineMat;
  const base = worldMaterial('windows', true) as THREE.MeshLambertMaterial;
  const map = base.map!.clone(); map.repeat.set(3, 8); map.needsUpdate = true;
  const em = base.emissiveMap!.clone(); em.repeat.set(3, 8); em.needsUpdate = true;
  return (skylineMat = new THREE.MeshBasicMaterial({ map: em, color: 0x9a90b0, fog: true }));
}

export interface World { group: THREE.Group; collider: Collider; barrels: THREE.Mesh[]; lights: THREE.PointLight[]; dispose(): void }
export function buildWorld(scene: THREE.Scene, map: MapDef, quality: 'low' | 'medium' | 'high', shadows: boolean, viewDistance: number): World {
  const low = quality === 'low';
  const group = new THREE.Group();
  const byMat = new Map<Mat, number[][]>();
  for (const { b, m } of map.boxes) { if (!byMat.has(m)) byMat.set(m, []); byMat.get(m)!.push(b); }
  let seed = 1;
  for (const [m, boxes] of byMat) {
    const mesh = new THREE.Mesh(mergeBoxes(boxes, SPECS[m].tile, seed++ * 131), worldMaterial(m, low));
    mesh.castShadow = shadows && !SPECS[m].basic && !SPECS[m].opacity; mesh.receiveShadow = shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  const barrelMat = worldMaterial('barrel', low).clone();
  barrelMat.vertexColors = false; // cylinder geometry carries no per-vertex tint
  const barrels = map.barrels.map((p) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_SIZE.r, BARREL_SIZE.r, BARREL_SIZE.h, 8), barrelMat);
    mesh.position.set(p[0], p[1] + BARREL_SIZE.h / 2, p[2]);
    group.add(mesh);
    return mesh;
  });
  scene.fog = new THREE.FogExp2(map.fog, map.fogDensity / viewDistance);
  scene.background = new THREE.Color(map.fog);
  group.add(buildSky(new THREE.Scene(), map.sky[0], map.sky[1])); // re-parented into our group
  group.add(new THREE.HemisphereLight(0x9a96d8, 0x3a3038, map.ambient * (low ? 7 : 5.5)));
  const moon = new THREE.DirectionalLight(0x9aa6ff, map.moon * 4.5);
  moon.position.set(-40, 70, -30);
  if (shadows) {
    moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
    const c = moon.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.far = 200; moon.shadow.bias = -0.0015;
  }
  group.add(moon);
  // real point lights are expensive: none on low, a spread subset on medium, all (capped) on high.
  const cap = low ? 0 : quality === 'medium' ? 6 : 14;
  const step = Math.max(1, Math.ceil(map.lights.length / Math.max(1, cap)));
  const lights: THREE.PointLight[] = [];
  const pool = new THREE.CircleGeometry(1, 20), glow = glowTexture();
  map.lights.forEach((l, i) => {
    if (cap && i % step === 0 && lights.length < cap) { const pl = new THREE.PointLight(l.color, l.intensity, l.dist, 1.6); pl.position.set(...l.p); group.add(pl); lights.push(pl); }
    // cheap fakes that work on every tier: a halo sprite and a soft pool of light on the ground
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: l.color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    s.position.set(l.p[0], l.p[1] + 0.3, l.p[2]); s.scale.setScalar(3.2); group.add(s);
    const gp = new THREE.Mesh(pool, new THREE.MeshBasicMaterial({ map: glow, color: l.color, blending: THREE.AdditiveBlending, transparent: true, opacity: low ? 0.34 : 0.16, depthWrite: false }));
    gp.rotation.x = -Math.PI / 2; gp.position.set(l.p[0], l.p[1] - 4.52, l.p[2]); gp.scale.setScalar(7); group.add(gp);
  });
  scene.add(group);
  return {
    group, collider: new Collider(mapColliderBoxes(map)), barrels, lights,
    dispose() {
      scene.remove(group);
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== pool) m.geometry.dispose(); });
      scene.fog = null;
    },
  };
}
