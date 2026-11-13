// Shared collision + raycasting against axis-aligned voxel boxes.
// The client uses it for movement, the server for anti-cheat and hit validation.
import { PHYS } from './constants';

/** [x0,y0,z0,x1,y1,z1] */
export type Box6 = [number, number, number, number, number, number];
export type V3 = [number, number, number];

export interface RayHit { t: number; n: V3; index: number }

export class Collider {
  boxes: Box6[];
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array;
  private stampId = 0;
  private cell = 6;

  constructor(boxes: Box6[]) {
    this.boxes = boxes;
    this.stamp = new Uint32Array(boxes.length);
    boxes.forEach((b, i) => {
      const cx0 = Math.floor(b[0] / this.cell), cx1 = Math.floor(b[3] / this.cell);
      const cz0 = Math.floor(b[2] / this.cell), cz1 = Math.floor(b[5] / this.cell);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const k = (cx + 512) * 1024 + (cz + 512);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(i);
      }
    });
  }

  /** Calls fn for every box whose XZ cell range touches the query. fn returning true stops early. */
  private query(x0: number, z0: number, x1: number, z1: number, fn: (b: Box6, i: number) => boolean | void) {
    const id = ++this.stampId;
    const cx0 = Math.floor(x0 / this.cell), cx1 = Math.floor(x1 / this.cell);
    const cz0 = Math.floor(z0 / this.cell), cz1 = Math.floor(z1 / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = this.cells.get((cx + 512) * 1024 + (cz + 512));
      if (!arr) continue;
      for (const i of arr) {
        if (this.stamp[i] === id) continue;
        this.stamp[i] = id;
        if (fn(this.boxes[i], i)) return;
      }
    }
  }

  /** Is a player-sized AABB (feet at p) intersecting any box? */
  overlaps(px: number, py: number, pz: number, height: number, r = PHYS.radius): boolean {
    let hit = false;
    this.query(px - r, pz - r, px + r, pz + r, (b) => {
      if (px + r > b[0] && px - r < b[3] && py + height > b[1] && py < b[4] && pz + r > b[2] && pz - r < b[5]) { hit = true; return true; }
    });
    return hit;
  }

  /** Moves a player AABB with velocity, sliding along surfaces. Mutates p and v. */
  move(p: V3, v: V3, dt: number, height: number, canStep: boolean): { ground: boolean } {
    const r = PHYS.radius, E = 0.001;
    let ground = false;
    const speed = Math.hypot(v[0], v[1], v[2]);
    const steps = Math.max(1, Math.ceil((speed * dt) / 0.2));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const a of [0, 2] as const) {
        const d = v[a] * h;
        if (!d) continue;
        p[a] += d;
        let pushTo: number | null = null, top = -Infinity;
        this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, (b) => {
          if (p[0] + r > b[0] && p[0] - r < b[3] && p[1] + height > b[1] && p[1] < b[4] && p[2] + r > b[2] && p[2] - r < b[5]) {
            const face = d > 0 ? b[a] - r - E : b[a + 3] + r + E;
            pushTo = pushTo === null ? face : d > 0 ? Math.min(pushTo, face) : Math.max(pushTo, face);
            top = Math.max(top, b[4]);
          }
        });
        if (pushTo !== null) {
          const rise = top - p[1];
          if (canStep && rise > 0 && rise <= PHYS.step && !this.overlaps(p[0], top + E, p[2], height)) {
            p[1] = top + E; // step up onto low ledges / stairs
          } else {
            p[a] = pushTo;
            v[a] = 0;
          }
        }
      }
      const dy = v[1] * h;
      p[1] += dy;
      let pushY: number | null = null;
      this.query(p[0] - r, p[2] - r, p[0] + r, p[2] + r, (b) => {
        if (p[0] + r > b[0] && p[0] - r < b[3] && p[1] + height > b[1] && p[1] < b[4] && p[2] + r > b[2] && p[2] - r < b[5]) {
          const face = dy <= 0 ? b[4] + E : b[1] - height - E;
          pushY = pushY === null ? face : dy <= 0 ? Math.max(pushY, face) : Math.min(pushY, face);
        }
      });
      if (pushY !== null) {
        if (dy <= 0) ground = true;
        p[1] = pushY;
        v[1] = 0;
      }
    }
    return { ground };
  }

  /** Nearest box hit along a ray (d must be normalised). */
  raycast(o: V3, d: V3, max: number): RayHit | null {
    let best: RayHit | null = null;
    const bs = this.boxes;
    for (let i = 0; i < bs.length; i++) {
      const h = rayBox(o, d, bs[i], best ? best.t : max);
      if (h) best = { t: h.t, n: h.n, index: i };
    }
    return best;
  }
}

/** Slab test. Returns entry distance + face normal if the ray enters the box before `max`. */
export function rayBox(o: V3, d: V3, b: Box6, max: number): { t: number; n: V3 } | null {
  let tmin = 0, tmax = max, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b[a] || o[a] > b[a + 3]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t0 = (b[a] - o[a]) * inv, t1 = (b[a + 3] - o[a]) * inv, sg = -1;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; sg = 1; }
    if (t0 > tmin) { tmin = t0; axis = a; sign = sg; }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null; // origin inside the box
  const n: V3 = [0, 0, 0];
  n[axis] = sign;
  return { t: tmin, n };
}
