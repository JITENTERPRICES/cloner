// Three original voxel maps, authored as code so client rendering, client collision and
// server hit validation all use exactly the same geometry.
import { Box6, V3 } from './physics';

export type Mat = 'asphalt' | 'sidewalk' | 'concrete' | 'brick' | 'darkbrick' | 'metal' | 'rust' | 'contR' | 'contB' | 'contG' | 'windows' | 'glass' | 'wood'
  | 'roof' | 'dark' | 'neonP' | 'neonR' | 'neonC' | 'lamp' | 'car' | 'tower' | 'barrel';
export interface MapBox { b: Box6; m: Mat }
export interface MapLight { p: V3; color: number; intensity: number; dist: number }
export interface MapDef {
  id: string; name: string; blurb: string;
  boxes: MapBox[]; barrels: V3[]; lights: MapLight[];
  spawns: { a: V3[]; b: V3[]; ffa: V3[] };
  zones: { id: string; p: V3; r: number }[];
  bounds: { x: number; z: number; yMin: number; yMax: number };
  fog: number; fogDensity: number; sky: [number, number]; ambient: number; moon: number;
}

class Builder {
  boxes: MapBox[] = [];
  lights: MapLight[] = [];
  /** box from min corner + size */
  box(x: number, y: number, z: number, w: number, h: number, d: number, m: Mat) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.boxes.push({ b: [x, y, z, x + w, y + h, z + d], m });
  }
  /** A wall along an axis at coordinate c, with openings [from, to, bottom, top] measured along the axis / height. */
  wall(axis: 'x' | 'z', a0: number, a1: number, c: number, y0: number, h: number, m: Mat, open: [number, number, number?, number?][] = [], th = 0.5) {
    const seg = (s: number, e: number, yy: number, hh: number) => {
      if (e - s <= 0.01 || hh <= 0.01) return;
      if (axis === 'x') this.box(s, yy, c, e - s, hh, th, m); else this.box(c, yy, s, th, hh, e - s, m);
    };
    let cur = a0;
    for (const [s, e, bot = 0, top = 2.5] of [...open].sort((p, q) => p[0] - q[0])) {
      seg(cur, s, y0, h);
      seg(s, e, y0, bot);
      seg(s, e, y0 + top, h - top);
      cur = e;
    }
    seg(cur, a1, y0, h);
  }
  /** Hollow building. Openings are per side: n (z0), s (z1), w (x0), e (x1), coordinates absolute along the wall. */
  house(x: number, z: number, w: number, d: number, h: number, m: Mat, o: { n?: [number, number, number?, number?][]; s?: [number, number, number?, number?][]; w?: [number, number, number?, number?][]; e?: [number, number, number?, number?][]; roof?: Mat; y?: number } = {}) {
    const y = o.y ?? 0;
    this.wall('x', x, x + w, z, y, h, m, o.n);
    this.wall('x', x, x + w, z + d - 0.5, y, h, m, o.s);
    this.wall('z', z + 0.5, z + d - 0.5, x, y, h, m, o.w);
    this.wall('z', z + 0.5, z + d - 0.5, x + w - 0.5, y, h, m, o.e);
    this.box(x - 0.2, y + h, z - 0.2, w + 0.4, 0.4, d + 0.4, o.roof ?? 'roof');
  }
  /** Solid stair block rising along +/-x or +/-z. (x,z) is the low end's min corner for + directions. */
  stairs(x: number, y: number, z: number, dir: 'x+' | 'x-' | 'z+' | 'z-', n: number, width: number, m: Mat, rise = 0.5, run = 0.6) {
    for (let i = 0; i < n; i++) {
      const hh = (i + 1) * rise;
      if (dir === 'x+') this.box(x + i * run, y, z, run, hh, width, m);
      if (dir === 'x-') this.box(x - (i + 1) * run, y, z, run, hh, width, m);
      if (dir === 'z+') this.box(x, y, z + i * run, width, hh, run, m);
      if (dir === 'z-') this.box(x, y, z - (i + 1) * run, width, hh, run, m);
    }
  }
  lamp(x: number, z: number, color = 0xffc98a, y = 0) {
    this.box(x - 0.1, y, z - 0.1, 0.2, 5, 0.2, 'dark');
    this.box(x - 0.35, y + 5, z - 0.35, 0.7, 0.25, 0.7, 'lamp');
    this.lights.push({ p: [x, y + 4.6, z], color, intensity: 30, dist: 22 });
  }
  car(x: number, z: number, alongX: boolean, m: Mat = 'car') {
    const [w, d] = alongX ? [4.2, 1.9] : [1.9, 4.2];
    this.box(x, 0, z, w, 0.95, d, m);
    if (alongX) this.box(x + 1, 0.95, z + 0.15, 2.1, 0.65, d - 0.3, 'glass'); else this.box(x + 0.15, 0.95, z + 1, w - 0.3, 0.65, 2.1, 'glass');
  }
  container(x: number, y: number, z: number, alongX: boolean, m: Mat) {
    if (alongX) this.box(x, y, z, 6, 2.6, 2.4, m); else this.box(x, y, z, 2.4, 2.6, 6, m);
  }
  /** Copies every box/light created inside fn through the given transforms (for symmetric, fair layouts). */
  symmetric(mode: 'quad' | 'rot180', fn: () => void) {
    const b0 = this.boxes.length, l0 = this.lights.length;
    fn();
    const nb = this.boxes.slice(b0), nl = this.lights.slice(l0);
    const flips: [number, number][] = mode === 'quad' ? [[-1, 1], [1, -1], [-1, -1]] : [[-1, -1]];
    for (const [sx, sz] of flips) {
      for (const { b, m } of nb) {
        const x0 = sx < 0 ? -b[3] : b[0], x1 = sx < 0 ? -b[0] : b[3];
        const z0 = sz < 0 ? -b[5] : b[2], z1 = sz < 0 ? -b[2] : b[5];
        this.boxes.push({ b: [x0, b[1], z0, x1, b[4], z1], m });
      }
      for (const l of nl) this.lights.push({ ...l, p: [l.p[0] * sx, l.p[1], l.p[2] * sz] });
    }
  }
}
const quad = (pts: [number, number][], y = 0.05): V3[] => pts.flatMap(([x, z]) => [[x, y, z], [-x, y, z], [x, y, -z], [-x, y, -z]] as V3[]);

// ───────────────────────── MAP 1 — URBAN STREETS ─────────────────────────
function urban(): MapDef {
  const B = new Builder();
  B.box(-46, -1, -46, 92, 1, 92, 'asphalt');
  B.symmetric('quad', () => {
    // raised sidewalks framing the block
    B.box(5, 0, 5, 38, 0.15, 2, 'sidewalk');
    B.box(5, 0, 7, 2, 0.15, 36, 'sidewalk');
    // corner apartment block with a walk-through ground-floor shop
    B.house(8, 8, 16, 14, 4, 'brick', { n: [[13, 16], [10, 12, 1, 2.6], [18, 22, 1, 2.6]], e: [[13, 16]], w: [[11, 14, 1, 2.6], [17, 20, 1, 2.6]], s: [[11, 13]], roof: 'concrete' });
    B.box(8, 4.4, 8, 16, 7, 14, 'windows'); // upper storeys (solid, lit windows)
    B.box(7.8, 11.4, 7.8, 16.4, 0.4, 14.4, 'roof');
    B.box(12.5, 3.1, 7.7, 4, 0.7, 0.3, 'neonP'); // shop sign
    B.box(10, 0, 13, 3, 1.1, 0.8, 'wood'); // shop counter
    B.box(18, 0, 17, 0.8, 1.1, 3, 'wood');
    // low annex across the alley: roof reachable by the fire-escape stairs
    B.house(28, 8, 14, 12, 4.5, 'darkbrick', { n: [[33, 36]], w: [[13, 15.5]], s: [[37, 39.5]], e: [[11, 14, 1.1, 2.6]] });
    B.box(32.5, 3.2, 7.7, 4, 0.6, 0.3, 'neonR');
    B.stairs(42, 0, 20.5, 'x-', 9, 1.6, 'metal'); // climbs toward x=36.6 at 4.5m
    B.box(28, 4.9, 20, 8.6, 0.1, 2.1, 'metal'); // landing joined to roof
    B.box(27.8, 4.9, 7.8, 0.3, 1, 12.4, 'darkbrick'); // parapets as rooftop cover
    B.box(34, 4.9, 12, 2.4, 1.3, 1.6, 'metal'); // rooftop AC unit
    // back tenement
    B.house(8, 28, 15, 14, 5, 'brick', { n: [[14, 17]], e: [[33, 36]], w: [[31, 34, 1, 2.6]], s: [[12, 15, 1, 2.6]] });
    B.box(8, 5.4, 28, 15, 5, 14, 'windows');
    B.box(13, 0, 34, 4, 1, 1, 'wood');
    // yard clutter between the buildings
    B.box(25, 0, 30, 2.2, 1.5, 4, 'rust'); // dumpster
    B.box(30, 0, 27, 1.4, 1.4, 1.4, 'wood');
    B.box(31.4, 0, 27.4, 1.2, 1.2, 1.2, 'wood');
    B.box(30.4, 1.4, 27.2, 1.1, 1.1, 1.1, 'wood');
    B.car(33, 34, true);
    B.box(38, 0, 26, 0.4, 2.2, 8, 'metal'); // chain-link stand-in
    B.box(24.6, 0, 12, 0.9, 1.3, 1.6, 'rust'); // alley bins
    B.box(26.6, 0, 17, 1.2, 1.1, 1.2, 'wood');
    // street furniture and cover on the road
    B.car(11, 1.6, true);
    B.car(1.8, 14, false);
    B.box(19, 0, -0.01, 2.6, 3, 4.4, 'contB'); // box truck across the lane, breaks the long sightline
    B.box(21.6, 0, 0.8, 1.6, 2.1, 3, 'car');
    B.box(1.2, 0, 26, 3.4, 1.2, 0.8, 'concrete'); // jersey barriers
    B.box(30, 0, 3.4, 0.8, 1.2, 3.2, 'concrete');
    B.lamp(6, 6); B.lamp(26, 6.2); B.lamp(6.2, 26);
    // perimeter
    B.box(45, 0, 0, 1, 7, 46, 'darkbrick');
    B.box(0, 0, 45, 45, 7, 1, 'darkbrick');
    B.box(43, 0, 5.2, 2, 6, 3, 'windows'); // facade bits against the boundary
    B.box(5.2, 0, 43, 3, 6, 2, 'windows');
  });
  return {
    id: 'urban', name: 'Urban Streets', blurb: 'Night-time crossroads: apartments, alleys, storefronts and a rooftop flank.',
    boxes: B.boxes, lights: B.lights, barrels: [[26, 0, 23.5], [-26, 0, -23.5], [-9, 0, 3.8], [9, 0, -3.8]],
    spawns: {
      a: [[-41, 0.05, -3], [-41, 0.05, 0], [-41, 0.05, 3], [-37, 0.05, -2], [-37, 0.05, 2], [-34, 0.05, 0]],
      b: [[41, 0.05, -3], [41, 0.05, 0], [41, 0.05, 3], [37, 0.05, -2], [37, 0.05, 2], [34, 0.05, 0]],
      ffa: [...quad([[41, 2], [2, 41], [26, 15], [35, 30], [40, 40], [16, 25]])],
    },
    zones: [{ id: 'A', p: [-26, 0, 0], r: 4.5 }, { id: 'B', p: [0, 0, 0], r: 5 }, { id: 'C', p: [26, 0, 0], r: 4.5 }],
    bounds: { x: 46, z: 46, yMin: -2, yMax: 16 },
    fog: 0x0b0a12, fogDensity: 0.016, sky: [0x05040a, 0x1a1026], ambient: 0.5, moon: 0.55,
  };
}

// ───────────────────── MAP 2 — ABANDONED INDUSTRIAL COMPLEX ─────────────────────
function industrial(): MapDef {
  const B = new Builder();
  B.box(-52, -1, -42, 104, 1, 84, 'concrete');
  // central warehouse, open on all four sides
  B.house(-18, -12, 36, 24, 8, 'metal', { n: [[-3, 3, 0, 4], [-14, -10, 1.4, 3.4], [10, 14, 1.4, 3.4]], s: [[-3, 3, 0, 4], [-14, -10, 1.4, 3.4], [10, 14, 1.4, 3.4]], w: [[-3, 3, 0, 4]], e: [[-3, 3, 0, 4]], roof: 'rust' });
  B.symmetric('rot180', () => {
    // warehouse interior: shelving, crates, a mezzanine reached by stairs
    B.box(6, 0, -9, 8, 3, 1.2, 'rust');
    B.box(6, 0, -5, 1.6, 1.6, 1.6, 'wood');
    B.box(7.6, 0, -5.2, 1.4, 1.4, 1.4, 'wood');
    B.box(-12, 0, -3, 2.4, 2.6, 6, 'contG');
    B.box(9, 3.6, 4, 8.5, 0.3, 7.5, 'metal'); // mezzanine deck
    B.stairs(9, 0, 9.2, 'x-', 7, 1.6, 'metal', 0.52); // 3.64m up to the deck
    B.box(9, 3.9, 4, 0.2, 1, 5, 'metal'); // deck railing
    B.box(1.5, 0, 2, 1.2, 1.2, 4, 'concrete');
    // container yard (east side for this half, mirrored to the west)
    B.container(24, 0, -10, false, 'contR');
    B.container(24, 2.6, -10, false, 'contB');
    B.container(29, 0, -3, true, 'contB');
    B.container(31, 0, 4, false, 'contG');
    B.container(24, 0, 8, true, 'contR');
    B.container(38, 0, -12, true, 'contG');
    B.container(38, 2.6, -12, true, 'contR');
    B.box(36, 0, 2, 1.5, 1.5, 1.5, 'wood');
    B.box(27.5, 0, -1, 1.2, 1.2, 1.2, 'wood'); // crate step onto the container tops
    B.box(28.5, 0, -2.2, 0.9, 0.62, 0.9, 'wood');
    // long service corridor along the north edge: a covered flank route
    B.house(-2, -32, 40, 6, 3.6, 'concrete', { w: [[-30.5, -27.5]], e: [[-30.5, -27.5]], s: [[8, 11], [24, 27], [16, 20, 1.2, 2.4]], roof: 'concrete' });
    B.box(12, 0, -30, 0.6, 3.6, 2.2, 'concrete'); // corridor baffles
    B.box(22, 0, -29.2, 0.6, 3.6, 2.2, 'concrete');
    // silos and pipework
    B.box(-34, 0, -30, 5, 11, 5, 'rust');
    B.box(-27, 0, -30, 5, 9, 5, 'rust');
    B.box(-29, 5, -27.8, 2, 0.6, 0.6, 'metal');
    B.box(-36, 0, -22, 9, 1.2, 1, 'concrete');
    // loading dock: raised platform with steps
    B.box(8, 0, -22, 14, 1.2, 6, 'concrete');
    B.stairs(6.8, 0, -20, 'x+', 2, 2.4, 'concrete', 0.6);
    B.box(12, 1.2, -21, 1.6, 1.6, 1.6, 'wood');
    B.box(18, 1.2, -19, 2, 1.1, 1.2, 'wood');
    // wrecked forklift / generator cover in the open lanes
    B.box(-8, 0, -20, 2.4, 1.6, 1.6, 'car');
    B.box(-24, 0, -16, 1.4, 2.2, 3, 'metal');
    B.box(44, 0, 6, 3, 1.3, 1, 'concrete');
    B.lamp(22, -14, 0xbfd6ff); B.lamp(-6, -24, 0xffb070); B.lamp(40, 0, 0xbfd6ff);
    // perimeter fence
    B.box(51, 0, -42, 1, 6, 84, 'metal');
    B.box(-52, 0, -42, 104, 6, 1, 'metal');
  });
  return {
    id: 'industrial', name: 'Abandoned Industrial Complex', blurb: 'A dead facility: one big warehouse, a container maze and a service corridor flank.',
    boxes: B.boxes, lights: B.lights, barrels: [[4, 0, 6], [-4, 0, -6], [34, 0, 9], [-34, 0, -9], [0, 0, 20], [0, 0, -20]],
    spawns: {
      a: [[-46, 0.05, -4], [-46, 0.05, 0], [-46, 0.05, 4], [-43, 0.05, -8], [-46, 0.05, 10], [-47, 0.05, 14]],
      b: [[46, 0.05, 4], [46, 0.05, 0], [46, 0.05, -4], [43, 0.05, 8], [46, 0.05, -10], [47, 0.05, -14]],
      ffa: [[-46, 0.05, 0], [46, 0.05, 0], [0, 0.05, 36], [0, 0.05, -24], [-30, 0.05, 20], [30, 0.05, -20], [-22, 0.05, -36], [22, 0.05, 36], [0, 0.05, 0], [-44, 0.05, 30], [44, 0.05, -30], [20, 0.05, 20], [-20, 0.05, -18], [35, 0.05, 30], [-35, 0.05, -34]],
    },
    zones: [{ id: 'A', p: [-34, 0, 4], r: 4.5 }, { id: 'B', p: [0, 0, 0], r: 5 }, { id: 'C', p: [34, 0, -4], r: 4.5 }],
    bounds: { x: 52, z: 42, yMin: -2, yMax: 16 },
    fog: 0x0c0d0f, fogDensity: 0.02, sky: [0x040506, 0x14171a], ambient: 0.42, moon: 0.45,
  };
}

// ───────────────────── MAP 3 — DOWNTOWN NIGHT DISTRICT ─────────────────────
function downtown(): MapDef {
  const B = new Builder();
  // plaza slabs leave a sunken atrium (x ±12, z ±8) open to the underground level
  B.box(-46, -0.5, -46, 34, 0.5, 92, 'sidewalk');
  B.box(12, -0.5, -46, 34, 0.5, 92, 'sidewalk');
  B.box(-12, -0.5, -46, 24, 0.5, 38, 'sidewalk');
  B.box(-12, -0.5, 8, 24, 0.5, 38, 'sidewalk');
  // underground concourse: wider than the atrium, so there are covered lanes under the plaza
  B.box(-21, -5, -15, 42, 1, 30, 'concrete');
  B.box(-21, -4, -15, 42, 3.5, 1, 'dark');
  B.box(-21, -4, 14, 42, 3.5, 1, 'dark');
  B.box(-21, -4, -14, 1, 3.5, 28, 'dark');
  B.box(20, -4, -14, 1, 3.5, 28, 'dark');
  B.symmetric('rot180', () => {
    B.stairs(-12, -4, -3, 'x+', 8, 3, 'concrete'); // atrium stair: floor (-4) up to the west plaza edge
    B.box(-12, -4, 0, 4.8, 4, 0.4, 'concrete'); // stair side wall
    B.box(-16, -4, -11, 1, 3.5, 1, 'concrete'); // pillars
    B.box(-16, -4, 9, 1, 3.5, 1, 'concrete');
    B.box(-6, -4, -12.5, 4, 1.2, 1.6, 'car');
    B.box(4, -4, 4, 1.2, 1.2, 3, 'concrete');
    B.box(-3, -4, -6, 6, 0.9, 0.9, 'concrete'); // atrium planter
    B.box(-20, -1.4, -10, 0.3, 0.5, 6, 'neonC'); // underground strip lights
    B.lights.push({ p: [-15, -1.5, 0], color: 0x39d6ff, intensity: 22, dist: 18 });
    // atrium glass balustrade (waist-high cover along the long edges)
    B.box(-12, 0, -8.4, 24, 1, 0.3, 'glass');
    // corner tower with walk-in lobby
    B.house(22, 16, 18, 18, 5, 'tower', { n: [[29, 33, 0, 3.2]], w: [[23, 27, 0, 3.2]], s: [[26, 30, 1, 3]], e: [[22, 26, 1, 3]], roof: 'concrete' });
    B.box(22, 5.4, 16, 18, 24, 18, 'windows');
    B.box(21.7, 6, 15.7, 0.3, 22, 0.3, 'neonP');
    B.box(27, 3.6, 15.7, 8, 0.8, 0.3, 'neonP');
    B.box(30, 0, 24, 5, 1.1, 1, 'wood'); // reception desk
    // slim mid-rise with a neon spine
    B.house(-40, 14, 14, 12, 4.5, 'tower', { n: [[-35, -32, 0, 3]], e: [[18, 21, 0, 3]], roof: 'concrete' });
    B.box(-40, 4.9, 14, 14, 16, 12, 'windows');
    B.box(-26.2, 5, 19, 0.3, 14, 0.8, 'neonR');
    // retail pavilion with roof terrace + skybridge toward the tower
    B.house(-8, 20, 16, 10, 4, 'glass', { n: [[-2, 2, 0, 3]], s: [[-2, 2, 0, 3]], w: [[23, 27, 1, 3]], e: [[23, 27, 1, 3]], roof: 'concrete' });
    B.stairs(-8.2, 0, 31, 'x+', 9, 1.8, 'metal', 0.49); // up to the 4.4m terrace
    B.box(-2.8, 4.3, 30, 10.8, 0.1, 2.8, 'metal');
    B.box(-8, 4.4, 20, 16, 1, 0.3, 'glass');
    B.box(8, 4.3, 23, 14, 0.3, 2.4, 'metal'); // skybridge to tower facade (dead-end overlook)
    B.box(8, 4.6, 22.9, 14, 0.9, 0.2, 'glass');
    B.box(-3, 4.4, 24, 6, 1.4, 0.4, 'neonC');
    // plaza furniture
    B.box(14, 0, -14, 6, 1, 1.4, 'concrete'); // planters
    B.box(15, 1, -13.8, 4, 0.6, 1, 'wood');
    B.box(-18, 0, 10, 1.4, 3.4, 1.4, 'tower'); // ad pylons
    B.box(-18.1, 1, 9.9, 1.6, 2, 0.15, 'neonR');
    B.box(16, 0, 10, 3, 2.6, 3, 'dark'); // kiosk
    B.box(15.8, 2.6, 9.8, 3.4, 0.3, 3.4, 'neonP');
    B.car(-32, 34, true); B.car(34, 2, false);
    B.box(-14, 0, 36, 5, 1.2, 0.8, 'concrete');
    B.box(6, 0, 38, 0.8, 1.2, 4, 'concrete');
    B.box(40, 0, -6, 0.8, 1.2, 5, 'concrete');
    B.lamp(-20, 4, 0xd9c8ff); B.lamp(10, 14, 0xd9c8ff); B.lamp(-30, 38, 0xffc98a); B.lamp(38, 12, 0xffc98a);
    // boundary: neighbouring high-rises
    B.box(45, 0, -46, 1, 30, 92, 'windows');
    B.box(-46, 0, -46, 92, 30, 1, 'windows');
  });
  return {
    id: 'downtown', name: 'Downtown Night District', blurb: 'Glass towers, neon signage, a retail terrace and a sunken concourse under the plaza.',
    boxes: B.boxes, lights: B.lights, barrels: [[-19, -4, 12], [19, -4, -12], [20, 0, -20], [-20, 0, 20]],
    spawns: {
      a: [[-42, 0.05, -6], [-42, 0.05, -2], [-42, 0.05, 2], [-42, 0.05, 6], [-38, 0.05, -4], [-38, 0.05, 4]],
      b: [[42, 0.05, 6], [42, 0.05, 2], [42, 0.05, -2], [42, 0.05, -6], [38, 0.05, 4], [38, 0.05, -4]],
      ffa: [[-42, 0.05, 0], [42, 0.05, 0], [0, 0.05, 40], [0, 0.05, -40], [-30, 0.05, -30], [30, 0.05, 30], [0, -3.95, 4], [0, -3.95, -4], [-17, -3.95, -6], [17, -3.95, 6], [26, 0.05, -38], [-26, 0.05, 38], [18, 0.05, -40], [-18, 0.05, 40], [36, 0.05, -10], [-36, 0.05, 8]],
    },
    zones: [{ id: 'A', p: [-28, 0, -4], r: 4.5 }, { id: 'B', p: [0, -4, 0], r: 5 }, { id: 'C', p: [28, 0, 4], r: 4.5 }],
    bounds: { x: 46, z: 46, yMin: -6, yMax: 16 },
    fog: 0x0d0916, fogDensity: 0.014, sky: [0x06030c, 0x24123a], ambient: 0.55, moon: 0.5,
  };
}

export const MAPS: MapDef[] = [urban(), industrial(), downtown()];
export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map((m) => [m.id, m]));
export const BARREL_SIZE = { r: 0.4, h: 1.2 };
export const barrelBox = (p: V3): Box6 => [p[0] - BARREL_SIZE.r, p[1], p[2] - BARREL_SIZE.r, p[0] + BARREL_SIZE.r, p[1] + BARREL_SIZE.h, p[2] + BARREL_SIZE.r];
/** Static collision boxes for a map (world geometry + barrels). */
export const mapColliderBoxes = (m: MapDef): Box6[] => [...m.boxes.map((x) => x.b), ...m.barrels.map(barrelBox)];
