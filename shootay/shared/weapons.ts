// Fictional weapon definitions. Rarity is cosmetic/collection status only: every category is
// balanced around the same time-to-kill band, so a MYTHIC does not out-damage a COMMON.
import { Rarity } from './constants';

export type WeaponCat = 'ar' | 'smg' | 'shotgun' | 'sniper' | 'pistol' | 'lmg';
export const CAT_NAME: Record<WeaponCat, string> = {
  ar: 'Assault Rifles', smg: 'Submachine Guns', shotgun: 'Shotguns', sniper: 'Sniper Rifles', pistol: 'Pistols', lmg: 'Light Machine Guns',
};
export type MagStyle = 'straight' | 'curved' | 'drum' | 'box' | 'tube' | 'grip' | 'top';
export type Unlock = { type: 'starter' } | { type: 'level'; level: number } | { type: 'buy'; price: number } | { type: 'box' };

export interface WeaponShape {
  body: number; barrel: number; stock: number; mag: MagStyle; wood: boolean; tint: number; handguard: number; bullpup?: boolean;
}
export interface WeaponDef {
  id: string; name: string; cat: WeaponCat; rarity: Rarity; desc: string;
  damage: number; head: number; rpm: number; mag: number; reload: number;
  rangeStart: number; rangeEnd: number; minMul: number;
  hip: number; ads: number; adsTime: number; move: number;
  recoilV: number; recoilH: number; auto: boolean; pellets: number; zoom: number;
  unlock: Unlock; shape: WeaponShape; pitch: number;
}

type Row = [string, string, Rarity, number, number, number, number, number, Unlock, Partial<WeaponDef> & { s: Partial<WeaponShape> }, string];
const L = (level: number): Unlock => ({ type: 'level', level });
const BUY = (price: number): Unlock => ({ type: 'buy', price });
const BOX: Unlock = { type: 'box' };
const START: Unlock = { type: 'starter' };

// per-category baseline
const BASE: Record<WeaponCat, Partial<WeaponDef> & { shape: WeaponShape }> = {
  ar: { head: 1.5, rangeStart: 28, rangeEnd: 60, minMul: 0.7, hip: 3.2, ads: 0.35, adsTime: 0.25, move: 0.94, auto: true, pellets: 1, zoom: 1.25, pitch: 1,
    shape: { body: 0.34, barrel: 0.36, stock: 0.26, mag: 'curved', wood: false, tint: 0x24262b, handguard: 0.26 } },
  smg: { head: 1.4, rangeStart: 14, rangeEnd: 34, minMul: 0.6, hip: 2.4, ads: 0.6, adsTime: 0.18, move: 1.0, auto: true, pellets: 1, zoom: 1.15, pitch: 1.3,
    shape: { body: 0.26, barrel: 0.16, stock: 0.18, mag: 'straight', wood: false, tint: 0x1f2126, handguard: 0.14 } },
  shotgun: { head: 1.15, rangeStart: 7, rangeEnd: 20, minMul: 0.3, hip: 5.5, ads: 4.2, adsTime: 0.24, move: 0.95, auto: false, pellets: 8, zoom: 1.1, pitch: 0.7,
    shape: { body: 0.3, barrel: 0.44, stock: 0.26, mag: 'tube', wood: false, tint: 0x2a2a2c, handguard: 0.24 } },
  sniper: { head: 2.2, rangeStart: 80, rangeEnd: 160, minMul: 0.9, hip: 7, ads: 0.02, adsTime: 0.42, move: 0.88, auto: false, pellets: 1, zoom: 4, pitch: 0.6,
    shape: { body: 0.36, barrel: 0.6, stock: 0.3, mag: 'straight', wood: false, tint: 0x23272a, handguard: 0.3 } },
  pistol: { head: 1.5, rangeStart: 12, rangeEnd: 30, minMul: 0.6, hip: 2.0, ads: 0.5, adsTime: 0.14, move: 1.04, auto: false, pellets: 1, zoom: 1.1, pitch: 1.5,
    shape: { body: 0.17, barrel: 0.03, stock: 0, mag: 'grip', wood: false, tint: 0x202226, handguard: 0 } },
  lmg: { head: 1.4, rangeStart: 32, rangeEnd: 70, minMul: 0.75, hip: 4.5, ads: 0.5, adsTime: 0.38, move: 0.86, auto: true, pellets: 1, zoom: 1.25, pitch: 0.85,
    shape: { body: 0.4, barrel: 0.46, stock: 0.26, mag: 'box', wood: false, tint: 0x26282a, handguard: 0.3 } },
};

// [id, name, rarity, damage, rpm, mag, reload, recoilV, unlock, overrides, description]
const ROWS: Record<WeaponCat, Row[]> = {
  ar: [
    ['mr4', 'MR-4 Vandal', 'common', 25, 720, 30, 2.1, 1.0, START, { s: {} }, 'Balanced AR-platform carbine. The baseline everything else is measured against.'],
    ['kv47', 'KV-47 Warden', 'uncommon', 31, 580, 30, 2.4, 1.35, L(3), { recoilH: 0.55, s: { wood: true, barrel: 0.4 } }, 'Heavy-hitting wood-furnished rifle with a stubborn kick.'],
    ['drk7', 'DRK-7 Shorty', 'rare', 29, 640, 30, 2.2, 1.5, L(6), { rangeStart: 18, rangeEnd: 42, hip: 2.7, adsTime: 0.2, move: 0.98, s: { wood: true, barrel: 0.14, stock: 0, handguard: 0.2 } }, 'Draco-style compact rifle. No stock, loud, vicious up close.'],
    ['aurg', 'AUR-G Bullpup', 'rare', 26, 690, 30, 2.5, 0.9, BUY(2400), { zoom: 1.5, s: { bullpup: true, tint: 0x3a4034, barrel: 0.3 } }, 'Bullpup rifle with an integrated optic rail and soft recoil.'],
    ['sc17', 'SC-17 Heavy', 'epic', 38, 480, 20, 2.6, 1.6, L(14), { rangeStart: 36, rangeEnd: 75, s: { tint: 0x5a4b36, mag: 'straight', barrel: 0.42 } }, 'Battle rifle. Slow cadence, long reach, small magazine.'],
    ['cinder', 'Cinder-556', 'legendary', 24, 780, 30, 2.0, 0.95, BOX, { hip: 3.4, s: { tint: 0x3b1418, handguard: 0.3 } }, 'Race-tuned carbine in oxblood cerakote. Box exclusive.'],
    ['fnk2', 'FN-K2 Marksman', 'mythic', 34, 520, 25, 2.5, 1.2, BOX, { zoom: 1.6, rangeStart: 40, rangeEnd: 80, hip: 3.8, s: { tint: 0x16161a, barrel: 0.46 } }, 'Precision-barrelled rifle. Collector status, honest numbers.'],
  ],
  smg: [
    ['mp9', 'MP-9 Rattler', 'common', 21, 860, 30, 1.8, 0.8, START, { s: {} }, 'Light, forgiving SMG for entry work.'],
    ['uz1', 'UZ-1 Micro', 'uncommon', 19, 960, 32, 1.7, 0.95, L(2), { hip: 2.8, move: 1.03, s: { stock: 0, mag: 'grip', body: 0.22 } }, 'Tiny open-bolt bullet hose.'],
    ['krs', 'KRS Vortex', 'rare', 18, 1080, 25, 1.9, 0.7, L(8), { s: { tint: 0x2c2c33, mag: 'straight' } }, 'Recoil-mitigating action with a blistering fire rate.'],
    ['px90', 'PX-90 Halo', 'epic', 19, 900, 50, 2.4, 0.75, BUY(3200), { s: { bullpup: true, mag: 'top', barrel: 0.1 } }, 'Top-fed bullpup with a deep magazine.'],
    ['mpx', 'MPX Wraith', 'legendary', 22, 820, 30, 1.8, 0.85, BOX, { s: { tint: 0x2a1a3a } }, 'Suppressor-ready SMG in deep violet anodise.'],
    ['chi', 'Chicago Drum', 'mythic', 24, 720, 50, 2.9, 1.1, BOX, { move: 0.96, adsTime: 0.22, s: { wood: true, mag: 'drum', barrel: 0.24 } }, 'Old-world drum gun reborn. Heavy, stylish, fair.'],
  ],
  shotgun: [
    ['m870', 'M-870 Breaker', 'common', 13, 70, 6, 3.2, 3.2, START, { s: { wood: true } }, 'Pump-action workhorse.'],
    ['s12', 'S-12 Riot', 'rare', 10, 200, 8, 2.6, 2.4, L(7), { s: { mag: 'straight' } }, 'Mag-fed semi-auto shotgun.'],
    ['dbs', 'DB Sawed', 'uncommon', 15, 160, 2, 2.2, 3.8, L(4), { hip: 7, rangeStart: 5, rangeEnd: 14, move: 1.0, s: { wood: true, barrel: 0.2, stock: 0.08 } }, 'Two shells. Make them count.'],
    ['aah', 'AA-Havoc', 'epic', 8, 300, 12, 3.3, 2.0, BUY(3600), { auto: true, s: { mag: 'drum' } }, 'Full-auto drum shotgun with modest per-shell damage.'],
    ['ksl', 'KS Lever', 'legendary', 14, 85, 7, 3.0, 3.0, BOX, { hip: 4.6, rangeStart: 9, rangeEnd: 24, s: { wood: true, tint: 0x3a3a3f } }, 'Lever-action with a tighter choke.'],
  ],
  sniper: [
    ['ax50', 'AX-50 Longbow', 'uncommon', 92, 46, 5, 3.4, 4.5, START, { s: {} }, 'Bolt-action rifle. One to the chest leaves them on a sliver.'],
    ['dmr', 'DM-R Sentinel', 'rare', 52, 220, 10, 2.8, 2.6, L(5), { zoom: 3, head: 1.9, adsTime: 0.34, s: { barrel: 0.5 } }, 'Semi-automatic marksman rifle.'],
    ['kar', 'KR-98 Relic', 'epic', 88, 52, 5, 3.0, 4.0, L(12), { adsTime: 0.36, zoom: 3.5, s: { wood: true } }, 'Wood-stocked bolt gun with a quick handling profile.'],
    ['m200', 'M-200 Phantom', 'legendary', 96, 40, 5, 3.7, 5.0, BOX, { adsTime: 0.48, zoom: 5, s: { tint: 0x101014, barrel: 0.7 } }, 'Long-action anti-materiel styling. Slow, deliberate.'],
  ],
  pistol: [
    ['g17', 'G-17 Standard', 'common', 26, 380, 15, 1.4, 1.1, START, { s: {} }, 'Polymer sidearm. Always there.'],
    ['m19', 'M19 Classic', 'uncommon', 34, 300, 8, 1.5, 1.5, L(2), { s: { tint: 0x4a4a50 } }, 'Single-stack steel classic.'],
    ['g18', 'G-18 Switch', 'rare', 18, 1050, 20, 1.6, 1.3, L(9), { auto: true, hip: 3.4, ads: 1.1, s: { tint: 0x1a1a1e } }, 'Machine pistol with a selector switch. Empties in a heartbeat.'],
    ['tec', 'TEC Stinger', 'epic', 20, 780, 24, 1.8, 1.0, BUY(2800), { auto: true, hip: 3.0, s: { body: 0.2, barrel: 0.1, mag: 'straight' } }, 'Compact machine pistol with a forward magazine.'],
    ['rev', 'Rev-357 Marshal', 'legendary', 56, 150, 6, 2.6, 3.0, BOX, { rangeStart: 20, rangeEnd: 42, s: { tint: 0x8a8d94, barrel: 0.1, wood: true } }, 'Six-shot revolver in brushed silver.'],
    ['de50', 'DE-50 Regent', 'mythic', 50, 170, 7, 2.0, 3.4, BOX, { rangeStart: 16, rangeEnd: 36, s: { tint: 0x2b0c10, body: 0.2, barrel: 0.05 } }, 'Hand cannon. Looks like money, hits like the Marshal.'],
  ],
  lmg: [
    ['m249', 'M-249 Sawtooth', 'uncommon', 26, 740, 100, 5.4, 1.1, L(5), { s: {} }, 'Belt-fed suppression.'],
    ['rpk', 'RPK Longarm', 'rare', 30, 600, 60, 3.6, 1.3, L(10), { adsTime: 0.33, move: 0.9, s: { wood: true, mag: 'drum' } }, 'Rifle-pattern LMG that handles lighter than it looks.'],
    ['pkb', 'PK Bulwark', 'epic', 34, 540, 80, 5.8, 1.5, BUY(3400), { s: { wood: true } }, 'Slow, heavy rounds with real range.'],
    ['mgr', 'MG Ripper', 'legendary', 22, 980, 75, 5.6, 1.25, BOX, { hip: 5.2, s: { tint: 0x33363a, barrel: 0.5 } }, 'Buzzsaw fire rate, punishing reload.'],
  ],
};

export const WEAPONS: WeaponDef[] = [];
for (const cat of Object.keys(ROWS) as WeaponCat[]) {
  for (const [id, name, rarity, damage, rpm, mag, reload, recoilV, unlock, over, desc] of ROWS[cat]) {
    const base = BASE[cat];
    const { s, ...rest } = over;
    WEAPONS.push({
      ...(base as WeaponDef), recoilH: 0.35, ...rest,
      id, name, cat, rarity, desc, damage, rpm, mag, reload, recoilV, unlock,
      shape: { ...base.shape, ...s },
    });
  }
}
export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const STARTER_WEAPONS = WEAPONS.filter((w) => w.unlock.type === 'starter').map((w) => w.id);
export const DEFAULT_LOADOUT = { primary: { weapon: 'mr4', atts: [] as string[], skin: null as string | null }, secondary: { weapon: 'g17', atts: [] as string[], skin: null as string | null } };
/** Gun Game ladder: one kill per rung, last rung wins the match. */
export const GUN_GAME_LADDER = ['mr4', 'kv47', 'mp9', 'krs', 's12', 'm870', 'm249', 'dmr', 'ax50', 'g18', 'm19', 'g17'];

export interface WeaponSkin { id: string; name: string; rarity: Rarity; color: number; accent: number; metal: number; glow: boolean }
const SK = (id: string, name: string, rarity: Rarity, color: number, accent: number, metal = 0.5, glow = false): WeaponSkin => ({ id: 'skin_' + id, name, rarity, color, accent, metal, glow });
export const SKINS: WeaponSkin[] = [
  SK('matte', 'Matte Black', 'common', 0x121214, 0x2a2a2e, 0.3), SK('char', 'Charcoal', 'common', 0x2b2d31, 0x454850, 0.3),
  SK('olive', 'Field Olive', 'common', 0x3a4030, 0x22261c, 0.2), SK('sand', 'Dust Tan', 'common', 0x8a775a, 0x4a3f30, 0.2),
  SK('gun', 'Gunmetal', 'uncommon', 0x4a4e57, 0x8a8f99, 0.8), SK('ox', 'Oxblood', 'uncommon', 0x4a1016, 0x1a0608, 0.4),
  SK('navy', 'Midnight Navy', 'uncommon', 0x141c33, 0x2c3a66, 0.4), SK('bone', 'Bone White', 'uncommon', 0xcfc9bb, 0x55524a, 0.2),
  SK('violet', 'Deep Violet', 'rare', 0x2d1452, 0x7a3cff, 0.6), SK('silver', 'Brushed Silver', 'rare', 0xa9aeb8, 0x5e626b, 0.95),
  SK('crim', 'Crimson Fade', 'rare', 0x7a0f1c, 0x220508, 0.6), SK('carbon', 'Carbon Weave', 'rare', 0x18191c, 0x3a3c42, 0.7),
  SK('neonp', 'Purple Circuit', 'epic', 0x16101f, 0xb04dff, 0.7, true), SK('neonr', 'Red Line', 'epic', 0x140a0c, 0xff2d45, 0.7, true),
  SK('chrome', 'Liquid Chrome', 'epic', 0xdfe3ea, 0x8e939c, 1), SK('smoke', 'Smoked Titanium', 'epic', 0x55505e, 0x9a8fb0, 0.9),
  SK('gold', 'Black & Gold', 'legendary', 0x101012, 0xd9a437, 0.9), SK('ghost', 'Ghost Signal', 'legendary', 0x0c0c12, 0x39e6ff, 0.8, true),
  SK('blood', 'Blood Moon', 'mythic', 0x230307, 0xff2038, 0.85, true), SK('void', 'Voidglass', 'mythic', 0x07050d, 0x9d5cff, 1, true),
];
export const SKIN_BY_ID: Record<string, WeaponSkin> = Object.fromEntries(SKINS.map((s) => [s.id, s]));

export interface EffectDef { id: string; name: string; rarity: Rarity; kind: 'tracer' | 'kill'; color: number }
const FX = (id: string, name: string, rarity: Rarity, kind: 'tracer' | 'kill', color: number): EffectDef => ({ id: 'fx_' + id, name, rarity, kind, color });
export const EFFECTS: EffectDef[] = [
  FX('tr_amber', 'Amber Tracers', 'uncommon', 'tracer', 0xffb040), FX('tr_violet', 'Violet Tracers', 'rare', 'tracer', 0xa24bff),
  FX('tr_red', 'Red Tracers', 'rare', 'tracer', 0xff3b4e), FX('tr_ice', 'Ice Tracers', 'epic', 'tracer', 0x6fe0ff),
  FX('tr_silver', 'Silver Tracers', 'epic', 'tracer', 0xdfe3ea), FX('tr_void', 'Void Tracers', 'mythic', 'tracer', 0x7d2bff),
  FX('k_ember', 'Ember Burst', 'rare', 'kill', 0xff7a2a), FX('k_violet', 'Violet Shatter', 'epic', 'kill', 0xa24bff),
  FX('k_static', 'Static Collapse', 'legendary', 'kill', 0x39e6ff), FX('k_crimson', 'Crimson Bloom', 'legendary', 'kill', 0xff2038),
];
export const EFFECT_BY_ID: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));
