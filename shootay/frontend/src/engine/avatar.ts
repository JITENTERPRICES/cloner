// Voxel operator model with adult proportions. Rebuilt from an Outfit, so clothing previews, the lobby
// character and in-match players are all the same code path.
import * as THREE from 'three';
import { CLOTH_BY_ID, ClothingDef, OPERATOR_BY_ID, OPERATORS, Outfit } from '../../../shared/clothing';
import { app } from '../state';
import { GunModel } from './guns';

const geo = new THREE.BoxGeometry(1, 1, 1);
const mats = new Map<string, THREE.MeshStandardMaterial>();
const M = (color: number, rough = 0.85, metal = 0, emissive = 0) => {
  const k = `${color}|${rough}|${metal}|${emissive}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal * 0.5, emissive: emissive || color, emissiveIntensity: emissive ? 1.2 : 0.3 })));
  return m;
};
function box(p: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(geo, m);
  b.scale.set(w, h, d); b.position.set(x, y, z);
  p.add(b);
  return b;
}
const pivot = (p: THREE.Object3D, x: number, y: number, z: number) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
const cloth = (id: string | null | undefined): ClothingDef | undefined => (id ? CLOTH_BY_ID[id] ?? app.extraClothing.find((c) => c.id === id) : undefined);

export interface AvatarAnim { speed: number; crouch: boolean; slide: boolean; air: boolean; pitch: number; pose: 'ready' | 'aim'; }

export class Avatar {
  root = new THREE.Group();
  private body = new THREE.Group();
  private hips!: THREE.Group; private torso!: THREE.Group; private head!: THREE.Group;
  private armL!: THREE.Group; private armR!: THREE.Group; private foreL!: THREE.Group; private foreR!: THREE.Group;
  private legL!: THREE.Group; private legR!: THREE.Group; private shinL!: THREE.Group; private shinR!: THREE.Group;
  private mount!: THREE.Group;
  private gun: GunModel | null = null;
  private t = Math.random() * 10; private walk = 0; private crouchK = 0; private inspectT = -1; private hitK = 0;
  dead = false; private deadK = 0;

  constructor(outfit: Outfit) { this.root.add(this.body); this.setOutfit(outfit); }

  setOutfit(o: Outfit) {
    this.body.clear();
    const op = OPERATOR_BY_ID[o.operator] ?? OPERATORS[0];
    const skin = M(op.skin, 0.75);
    const bw = op.build;
    const shirt = cloth(o.shirt), hoodie = cloth(o.hoodie), jacket = cloth(o.jacket), pants = cloth(o.pants), shoes = cloth(o.shoes);
    const top = jacket ?? hoodie ?? shirt;
    const under = hoodie ?? shirt;
    const topM = top ? M(top.color) : skin;
    const sleeveLong = !!(jacket || hoodie) || shirt?.style === 'longsleeve' || shirt?.style === 'jersey';
    const pantM = M(pants?.color ?? 0x1a1a1e);

    this.hips = pivot(this.body, 0, 0.9, 0);
    box(this.hips, pantM, 0.4 * bw, 0.14, 0.22, 0, 0.02, 0);
    // legs: thigh + shin so crouching and sliding read properly
    const leg = (side: number) => {
      const th = pivot(this.hips, 0.1 * side * bw, -0.02, 0);
      const wide = pants?.style === 'denim' || pants?.style === 'cargo' ? 1.18 : pants?.style === 'slim' ? 0.92 : 1;
      box(th, pantM, 0.17 * wide, 0.44, 0.19 * wide, 0, -0.22, 0);
      if (pants?.style === 'cargo') box(th, M(pants.color2), 0.05, 0.14, 0.14, 0.1 * side, -0.3, 0);
      if (pants?.style === 'track') box(th, M(pants.accent), 0.012, 0.44, 0.05, 0.088 * side, -0.22, 0);
      const sh = pivot(th, 0, -0.44, 0);
      box(sh, pantM, 0.16 * wide, 0.36, 0.18 * wide, 0, -0.18, 0);
      if (pants?.style === 'track') box(sh, M(pants.accent), 0.012, 0.36, 0.05, 0.083 * side, -0.18, 0);
      // footwear
      const sc = shoes?.color ?? 0x101012, sole = shoes?.color2 ?? 0x2a2a2e, st = shoes?.style;
      const sh2 = st === 'chunky' ? 0.07 : 0.04, up = st === 'hightop' || st === 'boot' ? 0.16 : 0.09;
      box(sh, M(sc, 0.6), 0.17, up, 0.3, 0, -0.36 - up / 2 + 0.04, -0.045);
      box(sh, M(sole, 0.9), 0.18, sh2, 0.32, 0, -0.44 - sh2 / 2 + 0.04, -0.045);
      if (shoes && st !== 'boot') box(sh, M(shoes.accent, 0.5), 0.172, 0.03, 0.1, 0, -0.39, -0.02);
      return [th, sh] as const;
    };
    [this.legL, this.shinL] = leg(-1);
    [this.legR, this.shinR] = leg(1);

    // torso
    this.torso = pivot(this.hips, 0, 0.08, 0);
    const tw = 0.44 * bw, puff = jacket?.style === 'puffer' ? 1.18 : jacket ? 1.08 : hoodie ? 1.05 : 1;
    box(this.torso, under ? M(under.color) : skin, tw, 0.56, 0.24, 0, 0.3, 0);
    if (jacket) { // open-front shell so the layer underneath shows
      box(this.torso, topM, tw * 0.42 * puff, 0.57, 0.26 * puff, -tw * 0.3, 0.3, 0);
      box(this.torso, topM, tw * 0.42 * puff, 0.57, 0.26 * puff, tw * 0.3, 0.3, 0);
      box(this.torso, topM, tw * puff, 0.57, 0.1, 0, 0.3, 0.085 * puff);
      box(this.torso, M(jacket.color2), tw * puff + 0.01, 0.06, 0.27 * puff, 0, 0.04, 0);
      if (jacket.style === 'puffer') for (let i = 0; i < 3; i++) box(this.torso, M(jacket.color2), tw * puff + 0.012, 0.012, 0.27 * puff, 0, 0.16 + i * 0.14, 0.001);
      if (jacket.style === 'shell' || jacket.style === 'leather') box(this.torso, M(jacket.accent, 0.4, 0.5), 0.012, 0.5, 0.012, tw * 0.1, 0.3, -0.135 * puff);
    } else if (hoodie) {
      box(this.torso, topM, tw * puff, 0.57, 0.25 * puff, 0, 0.3, 0);
      box(this.torso, M(hoodie.color2), tw * 0.5, 0.1, 0.02, 0, 0.14, -0.13 * puff); // kangaroo pocket
      box(this.torso, topM, 0.26, 0.16, 0.12, 0, 0.6, 0.13); // hood resting on the back
      if (hoodie.style === 'zip') box(this.torso, M(hoodie.accent, 0.4, 0.6), 0.014, 0.52, 0.012, 0, 0.31, -0.133 * puff);
      if (hoodie.style === 'graphic' || hoodie.style === 'cropped') box(this.torso, M(hoodie.accent, 0.7, 0, hoodie.style === 'graphic' ? hoodie.accent : 0), 0.18, 0.14, 0.012, 0, 0.38, -0.133 * puff);
    } else if (shirt) {
      if (shirt.style === 'graphic') box(this.torso, M(shirt.accent, 0.7), 0.2, 0.16, 0.012, 0, 0.36, -0.122);
      if (shirt.style === 'jersey') { box(this.torso, M(shirt.accent, 0.7), tw + 0.006, 0.07, 0.246, 0, 0.42, 0); box(this.torso, M(shirt.color2), 0.08, 0.12, 0.012, 0, 0.26, -0.122); }
    }
    // neck + head
    box(this.torso, skin, 0.11, 0.07, 0.11, 0, 0.6, 0);
    this.head = pivot(this.torso, 0, 0.64, 0);
    box(this.head, skin, 0.21, 0.25, 0.22, 0, 0.125, 0);
    box(this.head, skin, 0.17, 0.05, 0.2, 0, 0.012, -0.005); // jaw taper
    box(this.head, M(0x0a0a0c, 0.3), 0.035, 0.018, 0.01, -0.05, 0.15, -0.112); box(this.head, M(0x0a0a0c, 0.3), 0.035, 0.018, 0.01, 0.05, 0.15, -0.112); // eyes
    box(this.head, M(0x0c0b0b), 0.05, 0.012, 0.012, -0.05, 0.172, -0.112); box(this.head, M(0x0c0b0b), 0.05, 0.012, 0.012, 0.05, 0.172, -0.112); // brows
    box(this.head, skin, 0.03, 0.05, 0.03, 0, 0.11, -0.115); // nose
    this.dressHead(o);

    // arms
    const arm = (side: number) => {
      const up = pivot(this.torso, (tw / 2 + 0.07) * side, 0.52, 0);
      const sl = sleeveLong || top ? topM : skin;
      box(up, top ? topM : skin, 0.13 * puff, 0.3, 0.14 * puff, 0, -0.13, 0);
      const fore = pivot(up, 0, -0.28, 0);
      box(fore, sleeveLong ? sl : skin, 0.115 * (sleeveLong ? puff : 1), 0.27, 0.12 * (sleeveLong ? puff : 1), 0, -0.13, 0);
      const gl = cloth(o.gloves);
      box(fore, gl ? M(gl.color, 0.7) : skin, 0.1, 0.1, 0.11, 0, -0.31, 0);
      if (gl?.style === 'fingerless') box(fore, skin, 0.09, 0.035, 0.1, 0, -0.35, 0);
      if (gl?.style === 'tactical') box(fore, M(gl.accent, 0.5), 0.102, 0.03, 0.06, 0, -0.29, -0.03);
      const acc = cloth(o.accessory);
      if (acc?.style === 'watch' && side < 0) { box(fore, M(acc.color, 0.3, 0.9), 0.125, 0.035, 0.13, 0, -0.24, 0); box(fore, M(0xdfe3ea, 0.2, 1), 0.02, 0.05, 0.05, -0.065, -0.24, 0); }
      return [up, fore] as const;
    };
    [this.armL, this.foreL] = arm(-1);
    [this.armR, this.foreR] = arm(1);
    this.dressBody(o, tw);

    this.mount = pivot(this.torso, 0.13, 0.42, -0.34);
    if (this.gun) this.mount.add(this.gun);
    this.root.scale.setScalar(op.height);
    this.body.traverse((m) => { (m as THREE.Mesh).castShadow = true; });
  }

  private dressHead(o: Outfit) {
    const h = this.head;
    const hair = cloth(o.hair), hat = cloth(o.hat), mask = cloth(o.mask), acc = cloth(o.accessory);
    const fullMask = mask?.style === 'balaclava' || mask?.style === 'shiesty';
    if (hair && !fullMask) {
      const hm = M(hair.color, 0.95), s = hair.style, capped = !!hat;
      if (s === 'buzz') box(h, hm, 0.215, 0.07, 0.225, 0, 0.225, 0.002);
      if (s === 'fade') { box(h, hm, 0.2, 0.09, 0.2, 0, 0.26, 0); box(h, hm, 0.215, 0.05, 0.225, 0, 0.2, 0.004); }
      if (s === 'curls') { box(h, hm, 0.25, 0.13, 0.25, 0, 0.27, 0.005); box(h, hm, 0.23, 0.08, 0.06, 0, 0.2, 0.1); }
      if (s === 'braids' || s === 'locs') {
        box(h, hm, 0.22, 0.07, 0.23, 0, 0.235, 0.002);
        const n = s === 'locs' ? 5 : 4, wd = s === 'locs' ? 0.034 : 0.022;
        for (let i = 0; i < n; i++) { box(h, hm, wd, s === 'locs' ? 0.26 : 0.32, wd, -0.09 + (i * 0.18) / (n - 1), 0.07, 0.118); }
        if (s === 'locs') { box(h, hm, 0.03, 0.22, 0.03, -0.118, 0.1, 0.04); box(h, hm, 0.03, 0.22, 0.03, 0.118, 0.1, 0.04); }
      }
      if (s === 'long') { box(h, hm, 0.22, 0.07, 0.23, 0, 0.235, 0.002); box(h, hm, 0.07, 0.07, 0.08, 0, 0.2, 0.14); box(h, hm, 0.05, 0.2, 0.05, 0, 0.08, 0.16); }
      if (capped) h.children.slice(-1)[0].scale.y *= 1; // hats sit over the hair mass
    }
    if (mask) {
      const mm = M(mask.color, 0.9);
      if (fullMask) {
        box(h, mm, 0.225, 0.265, 0.235, 0, 0.128, 0.001);
        box(h, M(0x000000, 1), 0.17, mask.style === 'shiesty' ? 0.1 : 0.04, 0.01, 0, mask.style === 'shiesty' ? 0.13 : 0.152, -0.118); // eye opening
        box(h, M(OPERATOR_BY_ID[o.operator]?.skin ?? 0x8d5a3c, 0.75), 0.16, mask.style === 'shiesty' ? 0.085 : 0.03, 0.012, 0, mask.style === 'shiesty' ? 0.132 : 0.152, -0.116);
        box(h, M(0x0a0a0c, 0.3), 0.035, 0.016, 0.014, -0.05, 0.152, -0.118); box(h, M(0x0a0a0c, 0.3), 0.035, 0.016, 0.014, 0.05, 0.152, -0.118);
      } else if (mask.style === 'bandana') { box(h, mm, 0.222, 0.11, 0.232, 0, 0.065, -0.002); box(h, M(mask.accent, 0.9), 0.1, 0.03, 0.012, 0, 0.06, -0.12); }
      else if (mask.style === 'respirator') { box(h, mm, 0.16, 0.1, 0.07, 0, 0.065, -0.1); box(h, M(mask.accent, 0.4, 0.6), 0.06, 0.06, 0.05, -0.1, 0.05, -0.1); box(h, M(mask.accent, 0.4, 0.6), 0.06, 0.06, 0.05, 0.1, 0.05, -0.1); box(h, mm, 0.23, 0.02, 0.24, 0, 0.1, 0); }
    }
    if (hat) {
      const hm = M(hat.color, 0.85), s = hat.style, y = 0.25;
      if (s === 'beanie') { box(h, hm, 0.228, 0.11, 0.238, 0, y + 0.02, 0); box(h, M(hat.color2), 0.234, 0.04, 0.244, 0, y - 0.03, 0); }
      else if (s === 'bucket') { box(h, hm, 0.22, 0.09, 0.23, 0, y + 0.03, 0); box(h, hm, 0.33, 0.02, 0.34, 0, y - 0.01, 0); }
      else { box(h, hm, 0.222, 0.08, 0.232, 0, y + 0.03, 0); box(h, M(hat.color2), 0.2, 0.014, 0.13, 0, y - 0.004, -0.17); if (s === 'trucker') box(h, M(hat.accent, 0.8), 0.12, 0.06, 0.012, 0, y + 0.03, -0.118); else box(h, M(hat.accent, 0.8), 0.04, 0.03, 0.012, 0, y + 0.03, -0.118); }
    }
    if (acc?.style === 'shades') { box(h, M(acc.color, 0.1, 0.9), 0.2, 0.04, 0.02, 0, 0.152, -0.118); box(h, M(acc.color, 0.3, 0.6), 0.22, 0.012, 0.12, 0, 0.158, -0.06); }
  }

  private dressBody(o: Outfit, tw: number) {
    const t = this.torso, chain = cloth(o.chain), acc = cloth(o.accessory), back = cloth(o.back);
    if (chain) {
      const cm = M(chain.color === 0x101012 ? 0xd9a437 : 0xcfd3da, 0.25, 1), th = chain.style === 'cuban' ? 0.024 : 0.012, z = -0.142;
      box(t, cm, th, 0.16, th, -0.06, 0.5, z).rotation.z = -0.35; box(t, cm, th, 0.16, th, 0.06, 0.5, z).rotation.z = 0.35;
      box(t, cm, 0.07, th, th, 0, 0.425, z);
      if (chain.style === 'pendant') box(t, M(chain.accent, 0.2, 1, chain.accent), 0.04, 0.05, 0.014, 0, 0.385, z);
      if (chain.style === 'cross') { box(t, cm, 0.016, 0.075, 0.012, 0, 0.375, z); box(t, cm, 0.05, 0.016, 0.012, 0, 0.39, z); }
    }
    if (acc?.style === 'belt') { box(t, M(acc.color, 0.6), tw + 0.02, 0.04, 0.26, 0, 0.03, 0); box(t, M(acc.accent, 0.6), 0.03, 0.2, 0.012, tw * 0.3, -0.07, -0.135); }
    if (acc?.style === 'bag') { const s = box(t, M(acc.color2, 0.8), 0.035, 0.62, 0.27, 0, 0.3, 0); s.rotation.z = 0.62; box(t, M(acc.color, 0.7), 0.17, 0.11, 0.06, -0.08, 0.26, -0.165); box(t, M(acc.accent, 0.4, 0.6), 0.05, 0.012, 0.062, -0.08, 0.29, -0.167); }
    if (back) {
      const bm = M(back.color, 0.8), z = 0.2;
      if (back.style === 'backpack') { box(t, bm, 0.3, 0.38, 0.14, 0, 0.32, z); box(t, M(back.color2), 0.22, 0.14, 0.04, 0, 0.24, z + 0.08); }
      if (back.style === 'duffel') { const d = box(t, bm, 0.5, 0.18, 0.18, 0, 0.2, z + 0.02); d.rotation.z = 0.25; box(t, M(back.accent, 0.7), 0.035, 0.6, 0.27, 0, 0.3, 0).rotation.z = -0.62; }
      if (back.style === 'sling') { box(t, bm, 0.16, 0.44, 0.09, 0.03, 0.32, z - 0.02).rotation.z = 0.3; box(t, M(back.color2), 0.03, 0.62, 0.27, 0, 0.3, 0).rotation.z = -0.62; }
      if (back.style === 'wings') { box(t, bm, 0.26, 0.42, 0.1, 0, 0.32, z - 0.01); box(t, M(back.accent, 0.4, 0.5, back.accent), 0.02, 0.36, 0.03, 0, 0.32, z + 0.05); box(t, bm, 0.34, 0.1, 0.08, 0, 0.5, z); }
    }
  }

  setGun(gun: GunModel | null) {
    if (this.gun) this.mount.remove(this.gun);
    this.gun = gun;
    if (gun) { gun.scale.setScalar(1.25); this.mount.add(gun); }
  }
  inspect() { this.inspectT = 0; }
  flinch() { this.hitK = 1; }
  /** World position of the weapon muzzle (for third-person tracers). */
  muzzleWorld(out: THREE.Vector3) { return this.gun ? this.gun.userData.muzzle.getWorldPosition(out) : this.root.getWorldPosition(out).add(new THREE.Vector3(0, 1.4, 0)); }

  update(dt: number, a: AvatarAnim) {
    this.t += dt;
    this.walk += dt * Math.min(a.speed, 9) * 1.55;
    const moving = Math.min(1, a.speed / 5), sw = Math.sin(this.walk) * 0.75 * moving;
    const target = a.slide ? 1.25 : a.crouch ? 1 : 0;
    this.crouchK += (target - this.crouchK) * Math.min(1, dt * 12);
    const c = Math.min(1, this.crouchK), sl = Math.max(0, this.crouchK - 1) * 4;
    this.hitK = Math.max(0, this.hitK - dt * 6);

    if (this.dead) { this.deadK = Math.min(1, this.deadK + dt * 3.2); } else this.deadK = 0;
    const d = this.deadK * this.deadK;
    this.body.rotation.x = d * 1.5 + sl * 0.55; // fall back on elimination / lean back in a slide
    this.body.position.y = -d * 0.75 - sl * 0.1;
    this.body.position.z = d * 0.5;

    const breath = Math.sin(this.t * 1.6) * 0.008;
    this.hips.position.y = 0.9 - c * 0.36 + Math.abs(Math.sin(this.walk)) * 0.03 * moving + breath;
    const air = a.air ? 1 : 0;
    this.legL.rotation.x = sw * (1 - c * 0.4) + c * 1.15 - sl * 0.9 + air * 0.35; this.shinL.rotation.x = -c * 1.6 - Math.max(0, -sw) * 0.9 * moving + sl * 1.1 - air * 0.7;
    this.legR.rotation.x = -sw * (1 - c * 0.4) + c * 0.75 - sl * 0.2 - air * 0.2; this.shinR.rotation.x = -c * 1.75 - Math.max(0, sw) * 0.9 * moving + sl * 0.6 - air * 0.4;
    this.torso.rotation.x = -c * 0.32 + a.pitch * 0.35 + this.hitK * 0.2 + sl * 0.2;
    this.torso.rotation.y = sw * 0.08;
    this.head.rotation.x = a.pitch * 0.5 + c * 0.25;
    this.head.rotation.y = a.pose === 'ready' ? Math.sin(this.t * 0.35) * 0.35 : 0;

    const aim = a.pose === 'aim' ? 1 : 0;
    const lower = (1 - aim) * 0.55; // low-ready when idle in the lobby
    this.armR.rotation.set(1.15 - lower * 0.8 + a.pitch * 0.55, 0, -0.12);
    this.foreR.rotation.set(0.75 + lower * 0.5, 0, 0);
    this.armL.rotation.set(1.3 - lower * 0.75 + a.pitch * 0.55, 0, 0.62);
    this.foreL.rotation.set(0.35 + lower * 0.6, 0, -0.5);
    this.mount.rotation.set(a.pitch * 0.62 - lower * 0.7, 0, 0);
    this.mount.position.set(0.13, 0.42 - lower * 0.16 + breath, -0.34 + lower * 0.06);
    if (this.inspectT >= 0) { // weapon inspection: roll the gun over and back
      this.inspectT += dt;
      const k = this.inspectT / 2.6, e = Math.sin(Math.min(1, k) * Math.PI);
      this.mount.rotation.z = e * 1.3; this.mount.rotation.y = e * 0.5; this.mount.rotation.x += e * 0.5;
      this.armR.rotation.x += e * 0.25; this.head.rotation.x += e * 0.25; this.head.rotation.y = e * 0.2;
      if (k >= 1) { this.inspectT = -1; this.mount.rotation.z = 0; this.mount.rotation.y = 0; }
    }
  }
}
