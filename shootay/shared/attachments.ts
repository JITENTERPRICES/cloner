// 216 attachment definitions (9 slots x 6 styles x 4 product lines), stat maths and combo rarity.
import { RARITIES, Rarity, rarityRank } from './constants';
import { WeaponCat, WeaponDef, WEAPON_BY_ID } from './weapons';

export type Slot = 'optic' | 'grip' | 'stock' | 'barrel' | 'muzzle' | 'magazine' | 'laser' | 'underbarrel' | 'cosmetic';
export const SLOTS: Slot[] = ['optic', 'grip', 'stock', 'barrel', 'muzzle', 'magazine', 'laser', 'underbarrel', 'cosmetic'];
export const SLOT_NAME: Record<Slot, string> = {
  optic: 'Optics', grip: 'Grips', stock: 'Stocks', barrel: 'Barrels', muzzle: 'Muzzles', magazine: 'Magazines', laser: 'Lasers', underbarrel: 'Underbarrel', cosmetic: 'Cosmetic Mods',
};

/** Multipliers (1 = no change) except zoom (absolute) and silent (flag). */
export interface Mods { recoil?: number; hip?: number; ads?: number; adsTime?: number; move?: number; range?: number; mag?: number; reload?: number; zoom?: number; silent?: boolean }
export interface AttachmentDef {
  id: string; name: string; slot: Slot; rarity: Rarity; mods: Mods; cats: WeaponCat[];
  look: { style: string; color: number; accent: number; scale: number };
  desc: string;
}

const ALL: WeaponCat[] = ['ar', 'smg', 'shotgun', 'sniper', 'pistol', 'lmg'];
const LONG: WeaponCat[] = ['ar', 'smg', 'shotgun', 'sniper', 'lmg'];

// Product lines: name prefix, rarity offset, colours, and how strongly the stat trade-off is expressed.
const LINES = [
  { name: 'Standard', r: 0, color: 0x1c1d20, accent: 0x3a3c42, k: 0.8 },
  { name: 'Vanta', r: 1, color: 0x0b0b0d, accent: 0x7a3cff, k: 1.0 },
  { name: 'Ashline', r: 2, color: 0x5a5d66, accent: 0xb9bdc6, k: 1.1 },
  { name: 'Redwire', r: 3, color: 0x1a0a0c, accent: 0xff2d45, k: 1.2 },
];

type Style = { n: string; style: string; r: number; mods: Mods; cats: WeaponCat[]; d: string; color?: number };
const S = (n: string, style: string, r: number, mods: Mods, cats: WeaponCat[], d: string, color?: number): Style => ({ n, style, r, mods, cats, d, color });

const STYLES: Record<Slot, Style[]> = {
  optic: [
    S('Micro Dot', 'dot', 0, { zoom: 1.3, adsTime: 1.02 }, ALL, 'Clean red dot with a slim housing.'),
    S('Holo Sight', 'holo', 0, { zoom: 1.4, adsTime: 1.04 }, LONG, 'Wide holographic window.'),
    S('Reflex Panel', 'reflex', 1, { zoom: 1.35, adsTime: 1.03 }, ALL, 'Open reflex sight, minimal frame.'),
    S('3x Combat Optic', 'acog', 1, { zoom: 2.4, adsTime: 1.1, ads: 0.9 }, LONG, 'Mid-range magnified prism optic.'),
    S('6x Long Scope', 'scope', 2, { zoom: 4.5, adsTime: 1.18, ads: 0.8 }, ['ar', 'sniper', 'lmg'], 'High-magnification scope.'),
    S('Canted Irons', 'irons', 0, { zoom: 1.15, adsTime: 0.95 }, ALL, 'Offset iron sights for speed.'),
  ],
  grip: [
    S('Polymer Grip', 'pistolgrip', 0, { recoil: 0.96, move: 0.99 }, ALL, 'Textured polymer rear grip.'),
    S('Wooden Grip', 'woodgrip', 2, { recoil: 0.94, adsTime: 1.04 }, ALL, 'Hand-oiled walnut. Heavier, steadier.', 0x6b4426),
    S('Rubber Wrap', 'wrap', 0, { hip: 0.93, adsTime: 1.03 }, ALL, 'Tacky rubberised wrap.'),
    S('Skeleton Grip', 'skeleton', 1, { adsTime: 0.94, recoil: 1.05 }, ALL, 'Cut-out alloy grip. Fast, twitchy.'),
    S('Stippled Grip', 'stipple', 1, { recoil: 0.95, hip: 1.05 }, ALL, 'Aggressive hand-stippled texture.'),
    S('Ivory Panels', 'ivory', 3, { adsTime: 0.97, hip: 1.03 }, ALL, 'Synthetic ivory side panels.', 0xd8d2c0),
  ],
  stock: [
    S('Fixed Stock', 'fixed', 0, { recoil: 0.93, adsTime: 1.06 }, LONG, 'Solid fixed stock.'),
    S('Folding Stock', 'folding', 0, { move: 1.03, recoil: 1.05 }, LONG, 'Side-folding wire stock.'),
    S('No Stock', 'none', 1, { adsTime: 0.88, move: 1.04, recoil: 1.14 }, LONG, 'Stock removed. Fast and unruly.'),
    S('Padded Stock', 'padded', 1, { recoil: 0.9, adsTime: 1.09, move: 0.98 }, LONG, 'Recoil pad and cheek riser.'),
    S('Skeleton Stock', 'skel', 2, { adsTime: 0.94, recoil: 1.03 }, LONG, 'Machined skeleton stock.'),
    S('Pistol Brace', 'brace', 1, { recoil: 0.95, adsTime: 1.03 }, ['pistol', 'smg'], 'Stabilising arm brace.'),
  ],
  barrel: [
    S('Short Barrel', 'short', 0, { adsTime: 0.93, move: 1.02, range: 0.86 }, ALL, 'Cut-down barrel for tight spaces.'),
    S('Long Barrel', 'long', 0, { range: 1.18, adsTime: 1.07, move: 0.98 }, ALL, 'Extended barrel for reach.'),
    S('Heavy Barrel', 'heavy', 1, { recoil: 0.92, range: 1.08, adsTime: 1.1, move: 0.97 }, ALL, 'Thick-profile barrel.'),
    S('Fluted Barrel', 'fluted', 2, { range: 1.1, adsTime: 1.02, recoil: 1.03 }, ALL, 'Fluted to shed weight.'),
    S('Ported Barrel', 'ported', 1, { recoil: 0.93, range: 0.94 }, ALL, 'Gas ports tame muzzle rise.'),
    S('Integral Barrel', 'integral', 3, { silent: true, range: 0.88, adsTime: 1.04 }, ['ar', 'smg', 'sniper', 'pistol'], 'Integrally suppressed barrel.'),
  ],
  muzzle: [
    S('Flash Hider', 'flash', 0, { recoil: 0.98 }, ALL, 'Hides muzzle flash.'),
    S('Compensator', 'comp', 0, { recoil: 0.9, hip: 1.08 }, ALL, 'Vents gas upward to fight climb.'),
    S('Muzzle Brake', 'brake', 1, { recoil: 0.92, adsTime: 1.03 }, ALL, 'Side-vented brake.'),
    S('Suppressor', 'supp', 1, { silent: true, range: 0.9, adsTime: 1.05 }, ALL, 'Quiet shots, shorter reach.'),
    S('Choke', 'choke', 1, { hip: 0.82, ads: 0.82, adsTime: 1.03 }, ['shotgun'], 'Tightens pellet spread.'),
    S('Breacher', 'breach', 2, { move: 1.02, range: 0.93 }, ALL, 'Toothed stand-off device.'),
  ],
  magazine: [
    S('Extended Mag', 'ext', 0, { mag: 1.3, reload: 1.1, adsTime: 1.03 }, ALL, 'More rounds, slower hands.'),
    S('Fast Mag', 'fast', 0, { reload: 0.82, mag: 0.9 }, ALL, 'Pull-tab magazine for quick changes.'),
    S('Drum Mag', 'drum', 2, { mag: 1.6, reload: 1.25, adsTime: 1.08, move: 0.97 }, ['ar', 'smg', 'shotgun', 'lmg', 'pistol'], 'High-capacity drum.'),
    S('Coupled Mags', 'jungle', 1, { reload: 0.88, adsTime: 1.03 }, ['ar', 'smg', 'lmg'], 'Taped pair for faster swaps.'),
    S('Light Mag', 'light', 1, { mag: 0.85, adsTime: 0.95, move: 1.02 }, ALL, 'Low-capacity, low weight.'),
    S('Windowed Mag', 'window', 1, { reload: 0.95 }, ALL, 'Translucent body. Count at a glance.'),
  ],
  laser: [
    S('Red Laser', 'laser_r', 0, { hip: 0.86 }, ALL, 'Visible red aiming laser.', 0xff2d45),
    S('Green Laser', 'laser_g', 1, { hip: 0.84, adsTime: 1.02 }, ALL, 'High-visibility green laser.', 0x3ecf6e),
    S('Violet Laser', 'laser_v', 2, { hip: 0.85 }, ALL, 'Deep violet beam.', 0xa24bff),
    S('IR Module', 'ir', 1, { ads: 0.9, hip: 0.95 }, ALL, 'Invisible aiming module.', 0x222222),
    S('Tac Light', 'light', 0, { adsTime: 0.97, hip: 0.95 }, ALL, 'Weapon light, tight throw.', 0xfff2c8),
    S('Dual Module', 'dual', 2, { hip: 0.8, adsTime: 1.05 }, LONG, 'Laser and light in one housing.', 0xff2d45),
  ],
  underbarrel: [
    S('Vertical Foregrip', 'vert', 0, { recoil: 0.92, move: 0.98 }, LONG, 'Classic vertical grip.'),
    S('Angled Foregrip', 'angled', 0, { adsTime: 0.93, recoil: 0.98 }, LONG, 'Angled grip for fast shouldering.'),
    S('Stubby Grip', 'stubby', 1, { recoil: 0.95, hip: 0.95 }, LONG, 'Short grip, small penalty.'),
    S('Hand Stop', 'stop', 1, { adsTime: 0.95, move: 1.01, recoil: 1.02 }, LONG, 'Minimal index point.'),
    S('Bipod', 'bipod', 1, { recoil: 0.86, adsTime: 1.1, move: 0.96 }, ['ar', 'sniper', 'lmg'], 'Folding bipod.'),
    S('Wooden Foregrip', 'woodfore', 2, { recoil: 0.93, adsTime: 1.03 }, LONG, 'Turned walnut foregrip.', 0x6b4426),
  ],
  cosmetic: [
    S('Chain Charm', 'charm', 0, {}, ALL, 'A short length of chain off the receiver.'),
    S('Rail Covers', 'covers', 0, {}, ALL, 'Coloured rail panels.'),
    S('Kill Tally', 'tally', 1, {}, ALL, 'Paint-marker tally stripes.'),
    S('Wrap Tape', 'tape', 0, {}, ALL, 'Friction tape around the handguard.'),
    S('Engraved Plate', 'plate', 2, {}, ALL, 'Engraved receiver plate.'),
    S('Glow Inlay', 'inlay', 3, {}, ALL, 'Luminous inlay along the receiver.'),
  ],
};

const scaleMods = (m: Mods, k: number): Mods => {
  const out: Mods = {};
  for (const key of Object.keys(m) as (keyof Mods)[]) {
    const v = m[key];
    if (typeof v === 'boolean') (out as any)[key] = v;
    else if (key === 'zoom') out.zoom = v as number;
    else (out as any)[key] = +(1 + ((v as number) - 1) * k).toFixed(3); // benefits and penalties scale together
  }
  return out;
};

export const ATTACHMENTS: AttachmentDef[] = [];
for (const slot of SLOTS) {
  for (const st of STYLES[slot]) {
    for (const line of LINES) {
      const rr = Math.min(RARITIES.length - 1, st.r + line.r);
      ATTACHMENTS.push({
        id: `${slot}_${st.style}_${line.name.toLowerCase()}`,
        name: `${line.name} ${st.n}`,
        slot, rarity: RARITIES[rr], mods: scaleMods(st.mods, line.k), cats: st.cats,
        look: { style: st.style, color: st.color ?? line.color, accent: line.accent, scale: 1 + line.r * 0.04 },
        desc: st.d,
      });
    }
  }
}
export const ATT_BY_ID: Record<string, AttachmentDef> = Object.fromEntries(ATTACHMENTS.map((a) => [a.id, a]));
/** Attachments every account owns from the start. */
export const STARTER_ATTACHMENTS = ATTACHMENTS.filter((a) => a.rarity === 'common' && a.name.startsWith('Standard')).map((a) => a.id);

export function slotAllowed(w: WeaponDef, slot: Slot): boolean {
  if (w.cat === 'pistol') return slot !== 'underbarrel';
  return true;
}
export function compatible(w: WeaponDef, a: AttachmentDef): boolean {
  return a.cats.includes(w.cat) && slotAllowed(w, a.slot);
}
/** Validates an attachment list: known ids, compatible, one per slot. Returns the cleaned list. */
export function cleanAttachments(weaponId: string, atts: unknown): string[] {
  const w = WEAPON_BY_ID[weaponId];
  if (!w || !Array.isArray(atts)) return [];
  const used = new Set<Slot>(), out: string[] = [];
  for (const id of atts) {
    const a = typeof id === 'string' ? ATT_BY_ID[id] : undefined;
    if (!a || used.has(a.slot) || !compatible(w, a)) continue;
    used.add(a.slot);
    out.push(a.id);
  }
  return out;
}

export interface WeaponStats extends WeaponDef { silent: boolean; fireInterval: number }
export function computeStats(w: WeaponDef, atts: string[]): WeaponStats {
  const s: WeaponStats = { ...w, silent: false, fireInterval: 60 / w.rpm };
  for (const id of atts) {
    const a = ATT_BY_ID[id];
    if (!a) continue;
    const m = a.mods;
    if (m.recoil) { s.recoilV *= m.recoil; s.recoilH *= m.recoil; }
    if (m.hip) s.hip *= m.hip;
    if (m.ads) s.ads *= m.ads;
    if (m.adsTime) s.adsTime *= m.adsTime;
    if (m.move) s.move *= m.move;
    if (m.range) { s.rangeStart *= m.range; s.rangeEnd *= m.range; }
    if (m.mag) s.mag = Math.max(1, Math.round(s.mag * m.mag));
    if (m.reload) s.reload *= m.reload;
    if (m.zoom) s.zoom = Math.max(w.cat === 'sniper' ? w.zoom : 0, m.zoom);
    if (m.silent) s.silent = true;
  }
  return s;
}
export function damageAt(s: WeaponStats, dist: number): number {
  if (dist <= s.rangeStart) return s.damage;
  if (dist >= s.rangeEnd) return s.damage * s.minMul;
  const k = (dist - s.rangeStart) / (s.rangeEnd - s.rangeStart);
  return s.damage * (1 - k * (1 - s.minMul));
}

/** Signature builds: specific weapon + attachment style pairs that bump the combination a tier. */
const SIGNATURES: [string, string][] = [['drk7', 'woodgrip'], ['kv47', 'woodfore'], ['g18', 'drum'], ['chi', 'vert'], ['rev', 'ivory'], ['ax50', 'scope'], ['m870', 'choke']];
/**
 * Rarity of a weapon *combination*. Starts at the weapon's own rarity; every attachment adds
 * (rank + 1) / 4 of a tier; signature pairings add one more. Cosmetic status only.
 * e.g. DRK-7 (rare) + rare Wooden Grip -> 2 + 0.75 + 1 = EPIC or better.
 */
export function comboRarity(weaponId: string, atts: string[]): Rarity {
  const w = WEAPON_BY_ID[weaponId];
  if (!w) return 'common';
  let score = rarityRank(w.rarity);
  let sig = 0;
  for (const id of atts) {
    const a = ATT_BY_ID[id];
    if (!a) continue;
    score += (rarityRank(a.rarity) + 1) / 4;
    if (SIGNATURES.some(([wid, st]) => wid === weaponId && a.look.style === st)) sig = 1;
  }
  return RARITIES[Math.max(0, Math.min(RARITIES.length - 1, Math.round(score) + sig))];
}
