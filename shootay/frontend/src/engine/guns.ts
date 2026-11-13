// Procedural voxel weapon models. One builder serves the first-person view, third-person avatars,
// the lobby and the gunsmith preview. Attachments add/replace real geometry; skins recolour it.
import * as THREE from 'three';
import { ATT_BY_ID, AttachmentDef } from '../../../shared/attachments';
import { SKIN_BY_ID, WEAPON_BY_ID } from '../../../shared/weapons';

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, metal = 0.6, rough = 0.5, emissive = 0): THREE.MeshStandardMaterial {
  const k = `${color}|${metal}|${rough}|${emissive}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive, emissiveIntensity: emissive ? 1.6 : 0 })));
  return m;
}
const geo = new THREE.BoxGeometry(1, 1, 1);
/** Adds a box: centre (x,y,z), size (w,h,d). Forward is -Z, up is +Y. */
function box(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) {
  const b = new THREE.Mesh(geo, m);
  b.scale.set(w, h, d); b.position.set(x, y, z); b.rotation.x = rx;
  parent.add(b);
  return b;
}

export interface GunModel extends THREE.Group {
  userData: { sightY: number; muzzle: THREE.Object3D; mag: THREE.Object3D; bolt: THREE.Object3D; length: number; rear: number; gripZ: number; foreZ: number; zoomOptic: boolean };
}

export function buildGun(weaponId: string, atts: string[] = [], skinId: string | null = null): GunModel {
  const w = WEAPON_BY_ID[weaponId] ?? WEAPON_BY_ID.mr4;
  const sh = w.shape;
  const skin = skinId ? SKIN_BY_ID[skinId] : null;
  const A: Partial<Record<string, AttachmentDef>> = {};
  for (const id of atts) { const a = ATT_BY_ID[id]; if (a) A[a.slot] = a; }
  const g = new THREE.Group() as GunModel;
  const body = mat(skin ? skin.color : sh.tint, skin ? skin.metal * 0.45 : 0.3, 0.5);
  const dark = mat(0x17171b, 0.3, 0.5);
  const steel = mat(0x3a3d44, 0.45, 0.4);
  const wood = mat(0x5e3b20, 0.05, 0.75);
  const furn = sh.wood && !skin ? wood : mat(skin ? skin.accent : 0x16171a, 0.3, 0.6, skin?.glow ? skin.accent : 0);
  const pistol = w.cat === 'pistol';

  // barrel length responds to the barrel attachment
  const bStyle = A.barrel?.look.style;
  const barrelLen = sh.barrel * (bStyle === 'short' ? 0.6 : bStyle === 'long' ? 1.35 : bStyle === 'heavy' || bStyle === 'integral' ? 1.15 : 1);
  const barrelR = bStyle === 'heavy' ? 0.03 : bStyle === 'integral' ? 0.042 : 0.02;
  let front: number; // z of the muzzle end
  let sightY: number;

  if (pistol) {
    const L = sh.body;
    box(g, body, 0.03, 0.035, L, 0, 0.03, -L / 2 + 0.03); // slide
    box(g, dark, 0.028, 0.022, L * 0.8, 0, 0.004, -L / 2 + 0.02); // frame
    box(g, A.grip ? mat(A.grip.look.color, 0.1, 0.8) : furn, 0.03, 0.1, 0.045, 0, -0.05, 0.02, 0.22);
    box(g, dark, 0.006, 0.03, 0.04, 0, -0.012, -0.03); // trigger guard
    front = -L + 0.03 - barrelLen;
    if (barrelLen > 0.04) box(g, steel, 0.018, 0.018, barrelLen, 0, 0.03, -L + 0.03 - barrelLen / 2);
    sightY = 0.056;
    box(g, dark, 0.006, 0.008, 0.008, 0, 0.052, -L + 0.045);
    box(g, dark, 0.016, 0.008, 0.008, 0, 0.052, 0.02);
    g.userData.rear = 0.05; g.userData.gripZ = 0.02; g.userData.foreZ = 0.0;
  } else {
    const L = sh.body, hg = sh.handguard;
    const rz = sh.bullpup ? 0.18 : 0; // bullpups shift the receiver back behind the grip
    box(g, body, 0.046, 0.07, L, 0, 0.02, -L / 2 + 0.06 + rz); // receiver
    box(g, dark, 0.03, 0.012, L * 0.9, 0, 0.061, -L / 2 + 0.06 + rz); // top rail
    const hgZ = -L + 0.06 + rz;
    box(g, A.cosmetic?.look.style === 'tape' ? mat(0x3a3a34, 0, 0.95) : furn, 0.05, 0.056, hg, 0, 0.016, hgZ - hg / 2); // handguard
    if (A.cosmetic?.look.style === 'covers') box(g, mat(A.cosmetic.look.accent, 0.2, 0.6), 0.054, 0.02, hg * 0.8, 0, 0.0, hgZ - hg / 2);
    front = hgZ - hg - barrelLen;
    box(g, steel, barrelR * 2, barrelR * 2, barrelLen + hg * 0.3, 0, 0.026, hgZ - hg - barrelLen / 2 + hg * 0.15); // barrel
    if (w.cat === 'shotgun' && sh.mag === 'tube') box(g, steel, 0.03, 0.03, hg + barrelLen * 0.8, 0, -0.012, hgZ - (hg + barrelLen * 0.8) / 2);
    // pistol grip
    const gm = A.grip ? mat(A.grip.look.color, A.grip.look.style === 'skeleton' ? 0.8 : 0.1, 0.75) : furn;
    box(g, gm, 0.034, 0.1, 0.045, 0, -0.06, 0.02, 0.3);
    if (A.grip?.look.style === 'skeleton') box(g, dark, 0.036, 0.04, 0.02, 0, -0.06, 0.022, 0.3);
    box(g, dark, 0.006, 0.03, 0.05, 0, -0.022, -0.035);
    // stock (attachment can replace or remove it)
    const sStyle = A.stock?.look.style ?? (sh.stock > 0.02 ? 'fixed' : 'none');
    const sl = Math.max(sh.stock, sStyle === 'none' ? 0 : 0.2);
    const sm = A.stock ? mat(A.stock.look.color, 0.4, 0.6) : furn;
    const sz = 0.06 + rz;
    if (sStyle !== 'none' && !sh.bullpup) {
      if (sStyle === 'folding' || sStyle === 'skel') { box(g, steel, 0.012, 0.012, sl, 0, 0.04, sz + sl / 2); box(g, steel, 0.012, 0.012, sl, 0, -0.01, sz + sl / 2); box(g, sm, 0.03, 0.09, 0.02, 0, 0.012, sz + sl); }
      else if (sStyle === 'brace') { box(g, steel, 0.02, 0.02, sl, 0, 0.03, sz + sl / 2); box(g, sm, 0.05, 0.07, 0.07, 0, 0.02, sz + sl); }
      else { box(g, sm, 0.04, 0.06, sl, 0, 0.012, sz + sl / 2, -0.06); box(g, dark, 0.042, 0.09, 0.02, 0, 0.0, sz + sl); if (sStyle === 'padded') box(g, mat(0x1a1a1c, 0, 1), 0.044, 0.02, sl * 0.6, 0, 0.05, sz + sl * 0.5); }
    } else if (sh.bullpup) box(g, body, 0.046, 0.08, 0.1, 0, 0.012, sz + 0.03);
    g.userData.rear = sStyle === 'none' && !sh.bullpup ? 0.08 : sz + sl; g.userData.gripZ = 0.02; g.userData.foreZ = hgZ - hg * 0.55;
    // underbarrel
    if (A.underbarrel) {
      const u = A.underbarrel.look, um = mat(u.color, 0.2, 0.7), uz = hgZ - hg * 0.55;
      if (u.style === 'vert' || u.style === 'woodfore') box(g, um, 0.028, 0.085, 0.03, 0, -0.055, uz);
      else if (u.style === 'angled') box(g, um, 0.03, 0.03, 0.1, 0, -0.03, uz, -0.45);
      else if (u.style === 'stubby') box(g, um, 0.03, 0.045, 0.032, 0, -0.035, uz);
      else if (u.style === 'stop') box(g, um, 0.03, 0.02, 0.03, 0, -0.022, uz);
      else if (u.style === 'bipod') { box(g, um, 0.012, 0.012, 0.16, 0.022, -0.02, uz - 0.03); box(g, um, 0.012, 0.012, 0.16, -0.022, -0.02, uz - 0.03); }
    }
    sightY = 0.092;
    if (!A.optic) { box(g, dark, 0.006, 0.03, 0.008, 0, 0.08, hgZ - hg + 0.03); box(g, dark, 0.03, 0.022, 0.012, 0, 0.076, 0.03 + rz); }
  }

  // magazine (its own object so the reload animation can move it)
  const magG = new THREE.Group();
  const ms = A.magazine?.look.style;
  const style = ms === 'drum' ? 'drum' : sh.mag;
  const ext = ms === 'ext' ? 1.4 : ms === 'light' ? 0.7 : 1;
  const mm = ms === 'window' ? mat(0x3a4046, 0.1, 0.3) : A.magazine ? mat(A.magazine.look.color, 0.5, 0.5) : dark;
  const mz = pistol && style === 'grip' ? 0.02 : sh.bullpup ? 0.16 : -sh.body * 0.42 + 0.06;
  if (style === 'curved') { box(magG, mm, 0.028, 0.09 * ext, 0.05, 0, -0.045 * ext, 0, 0.12); box(magG, mm, 0.028, 0.07 * ext, 0.048, 0, -0.105 * ext, -0.022, 0.38); }
  else if (style === 'straight') box(magG, mm, 0.028, 0.13 * ext, 0.045, 0, -0.065 * ext, 0, 0.08);
  else if (style === 'drum') { box(magG, mm, 0.07, 0.1, 0.1, 0, -0.07, 0); box(magG, steel, 0.074, 0.03, 0.03, 0, -0.07, 0); if (ms === 'jungle') box(magG, mm, 0.028, 0.12, 0.045, 0.03, -0.06, 0); }
  else if (style === 'box') { box(magG, mat(0x2a3026, 0.3, 0.7), 0.08, 0.1, 0.11, 0.02, -0.07, 0); box(magG, steel, 0.03, 0.01, 0.08, 0.03, 0.0, -0.02); }
  else if (style === 'grip') box(magG, mm, 0.022, 0.1 * ext, 0.03, 0, -0.06 - 0.02 * (ext - 1), 0.012, 0.22);
  else if (style === 'top') box(magG, mat(0x3a4046, 0.1, 0.3), 0.05, 0.02, 0.2, 0, 0.068, -0.02);
  else if (style === 'tube') box(magG, mm, 0.02, 0.02, 0.05, 0, -0.03, 0);
  if (ms === 'jungle' && style !== 'drum') box(magG, mm, 0.028, 0.12, 0.045, 0.032, -0.07, 0, -0.08);
  magG.position.set(0, pistol ? 0 : -0.015, mz);
  g.add(magG);

  // charging handle / slide
  const bolt = box(g, steel, pistol ? 0.032 : 0.012, pistol ? 0.012 : 0.014, pistol ? sh.body * 0.5 : 0.05, pistol ? 0 : 0.03, pistol ? 0.05 : 0.04, pistol ? -0.02 : -0.02);

  // optic
  let zoomOptic = false;
  if (A.optic) {
    const o = A.optic.look, om = mat(o.color, 0.6, 0.4), lens = mat(0x101820, 0.9, 0.05, o.accent), oz = pistol ? -0.02 : -sh.body * 0.3 + 0.06, by = pistol ? 0.05 : 0.068;
    const og = new THREE.Group(); og.position.set(0, by, oz); g.add(og);
    if (o.style === 'dot' || o.style === 'reflex') { box(og, om, 0.03, 0.008, 0.045, 0, 0.004, 0); box(og, om, 0.004, 0.03, 0.006, 0.014, 0.022, -0.018); box(og, om, 0.004, 0.03, 0.006, -0.014, 0.022, -0.018); box(og, om, 0.032, 0.004, 0.006, 0, 0.038, -0.018); sightY = by + 0.022; }
    else if (o.style === 'holo') { box(og, om, 0.036, 0.012, 0.06, 0, 0.006, 0); box(og, om, 0.004, 0.036, 0.04, 0.018, 0.03, 0); box(og, om, 0.004, 0.036, 0.04, -0.018, 0.03, 0); box(og, om, 0.04, 0.004, 0.04, 0, 0.05, 0); sightY = by + 0.03; }
    else if (o.style === 'acog' || o.style === 'scope') {
      const len = o.style === 'scope' ? 0.24 : 0.12, rad = o.style === 'scope' ? 0.036 : 0.04;
      box(og, om, 0.02, 0.02, 0.05, 0, 0.01, 0); box(og, om, rad, rad, len, 0, 0.04, 0); box(og, om, rad * 1.25, rad * 1.25, 0.03, 0, 0.04, -len / 2); box(og, lens, rad * 0.9, rad * 0.9, 0.004, 0, 0.04, -len / 2 - 0.016);
      sightY = by + 0.04; zoomOptic = true;
    } else { box(og, om, 0.006, 0.03, 0.008, 0, 0.016, -0.05); box(og, om, 0.024, 0.024, 0.01, 0, 0.014, 0.03); sightY = by + 0.028; }
  }
  if (w.cat === 'sniper' && !A.optic) { // snipers always ship with a factory scope
    const om = mat(0x101012, 0.6, 0.4), oz = -sh.body * 0.3 + 0.06;
    box(g, om, 0.02, 0.02, 0.05, 0, 0.078, oz); box(g, om, 0.036, 0.036, 0.26, 0, 0.108, oz); box(g, om, 0.046, 0.046, 0.03, 0, 0.108, oz - 0.13);
    sightY = 0.108; zoomOptic = true;
  }
  // muzzle device
  const my = pistol ? 0.03 : 0.026;
  if (A.muzzle) {
    const m = A.muzzle.look, mmz = mat(m.color, 0.8, 0.4);
    const len = m.style === 'supp' ? 0.16 : m.style === 'breach' ? 0.06 : 0.045, rad = m.style === 'supp' ? 0.04 : 0.032;
    box(g, mmz, rad, rad, len, 0, my, front - len / 2);
    if (m.style === 'comp' || m.style === 'brake') box(g, dark, rad + 0.004, 0.008, len * 0.5, 0, my, front - len / 2);
    front -= len;
  }
  // laser / light module
  if (A.laser) {
    const l = A.laser.look, lz = pistol ? -sh.body * 0.5 : g.userData.foreZ - 0.03;
    box(g, dark, 0.022, 0.022, 0.05, pistol ? 0 : 0.034, pistol ? -0.004 : 0.02, lz);
    if (l.style !== 'ir') {
      const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: l.style === 'light' ? 0.1 : 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      const bl = l.style === 'light' ? 1.2 : 6;
      beam.scale.set(l.style === 'light' ? 0.05 : 0.003, l.style === 'light' ? 0.05 : 0.003, bl); beam.position.set(pistol ? 0 : 0.034, pistol ? -0.004 : 0.02, lz - 0.025 - bl / 2);
      beam.name = 'beam'; g.add(beam);
    }
  }
  // cosmetic mods
  const c = A.cosmetic?.look;
  if (c?.style === 'charm') { box(g, mat(0xb9bdc6, 1, 0.2), 0.004, 0.04, 0.004, 0.026, -0.02, 0.03); box(g, mat(c.accent, 0.8, 0.3, c.accent), 0.012, 0.012, 0.012, 0.026, -0.045, 0.03); }
  if (c?.style === 'tally') for (let i = 0; i < 4; i++) box(g, mat(0xe8e8ee, 0, 0.9), 0.048, 0.02, 0.004, 0, 0.02, -0.02 - i * 0.012);
  if (c?.style === 'plate') box(g, mat(c.accent, 1, 0.2), 0.048, 0.03, 0.06, 0, 0.02, -0.06);
  if (c?.style === 'inlay') box(g, mat(c.accent, 0.5, 0.3, c.accent), 0.049, 0.006, sh.body * 0.7, 0, 0.038, -sh.body * 0.3);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, my, front);
  g.add(muzzle);
  Object.assign(g.userData, { sightY, muzzle, mag: magG, bolt, length: -front + (g.userData.rear ?? 0), zoomOptic });
  return g;
}
