// Account helpers: what a player owns, and turning stored (untrusted-shaped) JSON into valid loadouts/outfits.
import type pg from 'pg';
import { q } from './db';
import { ATT_BY_ID, STARTER_ATTACHMENTS, cleanAttachments } from '../../shared/attachments';
import { CLOTH_BY_ID, CLOTH_SLOTS, DEFAULT_OUTFIT, OPERATOR_BY_ID, Outfit, STARTER_CLOTHING } from '../../shared/clothing';
import { levelFromXp } from '../../shared/constants';
import { sanitizeSettings } from '../../shared/settings';
import { DEFAULT_LOADOUT, EFFECT_BY_ID, SKIN_BY_ID, WEAPONS, WEAPON_BY_ID } from '../../shared/weapons';

export type ItemType = 'weapon' | 'attachment' | 'clothing' | 'skin' | 'effect';
export type Owned = Record<ItemType, Set<string>>;
export interface LoadoutSlot { weapon: string; atts: string[]; skin: string | null }
export interface Loadout { primary: LoadoutSlot; secondary: LoadoutSlot }

type Db = { query: pg.Pool['query'] } | pg.PoolClient;

export async function getOwned(userId: number, xp: number, db: Db = { query: q as any }): Promise<Owned> {
  const { rows } = await (db as any).query('SELECT item_type, item_id FROM inventory WHERE user_id = $1', [userId]);
  const owned: Owned = { weapon: new Set(), attachment: new Set(STARTER_ATTACHMENTS), clothing: new Set(STARTER_CLOTHING), skin: new Set(['skin_matte']), effect: new Set() };
  const level = levelFromXp(xp);
  for (const w of WEAPONS) if (w.unlock.type === 'starter' || (w.unlock.type === 'level' && level >= w.unlock.level)) owned.weapon.add(w.id);
  for (const r of rows) (owned as any)[r.item_type]?.add(r.item_id);
  return owned;
}

function cleanSlot(raw: any, fallback: LoadoutSlot, owned: Owned, wantPistol: boolean): LoadoutSlot {
  const w = raw && typeof raw.weapon === 'string' ? WEAPON_BY_ID[raw.weapon] : undefined;
  if (!w || !owned.weapon.has(w.id) || (w.cat === 'pistol') !== wantPistol) return { ...fallback };
  const atts = cleanAttachments(w.id, raw.atts).filter((a) => owned.attachment.has(a));
  const skin = typeof raw.skin === 'string' && SKIN_BY_ID[raw.skin] && owned.skin.has(raw.skin) ? raw.skin : null;
  return { weapon: w.id, atts, skin };
}
/** Primary must be a non-pistol, secondary a pistol; everything must be owned and compatible. */
export function cleanLoadout(raw: any, owned: Owned): Loadout {
  return { primary: cleanSlot(raw?.primary, DEFAULT_LOADOUT.primary, owned, false), secondary: cleanSlot(raw?.secondary, DEFAULT_LOADOUT.secondary, owned, true) };
}
export function cleanOutfit(raw: any, owned: Owned, extra: Record<string, { slot: string }> = {}): Outfit {
  const out: Outfit = { operator: raw && OPERATOR_BY_ID[raw.operator] ? raw.operator : DEFAULT_OUTFIT.operator };
  for (const slot of CLOTH_SLOTS) {
    const id = raw?.[slot];
    const def = typeof id === 'string' ? CLOTH_BY_ID[id] ?? extra[id] : undefined;
    out[slot] = def && def.slot === slot && owned.clothing.has(id) ? id : raw && slot in raw ? null : (DEFAULT_OUTFIT[slot] ?? null);
  }
  return out;
}
export function cleanFx(raw: any, owned: Owned): { tracer: string | null; kill: string | null } {
  const pick = (id: any, kind: string) => (typeof id === 'string' && EFFECT_BY_ID[id]?.kind === kind && owned.effect.has(id) ? id : null);
  return { tracer: pick(raw?.tracer, 'tracer'), kill: pick(raw?.kill, 'kill') };
}

/** Full private profile for the signed-in player. */
export async function loadMe(userId: number) {
  const { rows } = await q('SELECT * FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return null;
  const u = rows[0];
  const owned = await getOwned(userId, u.xp);
  return {
    id: String(u.id), username: u.username, deyes: u.deyes, xp: u.xp, level: levelFromXp(u.xp),
    stats: { kills: u.kills, deaths: u.deaths, headshots: u.headshots, wins: u.wins, matches: u.matches },
    loadout: cleanLoadout(u.loadout, owned), outfit: cleanOutfit(u.outfit, owned), fx: cleanFx(u.equipped_fx, owned),
    settings: sanitizeSettings(u.settings),
    inventory: Object.fromEntries(Object.entries(owned).map(([k, v]) => [k, [...v]])) as Record<ItemType, string[]>,
    createdAt: u.created_at,
  };
}
export const attRarity = (id: string) => ATT_BY_ID[id]?.rarity;
