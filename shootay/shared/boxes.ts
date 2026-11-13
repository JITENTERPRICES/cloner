// Mystery box definitions. Odds are published to the client verbatim; rolls happen only on the server.
import { Rarity, RARITIES } from './constants';
import { ATTACHMENTS } from './attachments';
import { CLOTHING } from './clothing';
import { EFFECTS, SKINS, WEAPONS } from './weapons';

export type RewardType = 'weapon' | 'skin' | 'attachment' | 'clothing' | 'effect' | 'combo';
export interface BoxDef {
  id: string; name: string; price: number; desc: string;
  /** % chance per rarity — sums to 100 */
  odds: Record<Rarity, number>;
  /** relative weight per reward type */
  types: Partial<Record<RewardType, number>>;
}
export const BOXES: BoxDef[] = [
  { id: 'street', name: 'Street Crate', price: 500, desc: 'Clothing, attachments and skins off the back of a van.',
    odds: { common: 52, uncommon: 28, rare: 13, epic: 5, legendary: 1.7, mythic: 0.3 }, types: { clothing: 40, attachment: 35, skin: 20, effect: 5 } },
  { id: 'arsenal', name: 'Arsenal Case', price: 1500, desc: 'Weapons, attachments and rare weapon combinations.',
    odds: { common: 30, uncommon: 32, rare: 22, epic: 11, legendary: 4, mythic: 1 }, types: { weapon: 30, attachment: 40, skin: 15, combo: 15 } },
  { id: 'vault', name: 'Blackout Vault', price: 4000, desc: 'The good shelf. Everything, weighted high.',
    odds: { common: 0, uncommon: 30, rare: 35, epic: 22, legendary: 10, mythic: 3 }, types: { weapon: 25, attachment: 20, skin: 20, clothing: 15, effect: 10, combo: 10 } },
];
export const BOX_BY_ID: Record<string, BoxDef> = Object.fromEntries(BOXES.map((b) => [b.id, b]));
/** Deyes refunded when a box rolls something you already own. */
export const DUPLICATE_REFUND: Record<Rarity, number> = { common: 100, uncommon: 200, rare: 400, epic: 800, legendary: 1600, mythic: 3200 };

export interface Reward { type: RewardType; id: string; name: string; rarity: Rarity; extra?: string[] }

/** All items a box can produce for a type+rarity. Only box/buy/level weapons — starters are already owned. */
export function pool(type: RewardType, rarity: Rarity): { id: string; name: string }[] {
  switch (type) {
    case 'weapon': case 'combo': return WEAPONS.filter((w) => w.rarity === rarity && w.unlock.type !== 'starter');
    case 'skin': return SKINS.filter((s) => s.rarity === rarity);
    case 'attachment': return ATTACHMENTS.filter((a) => a.rarity === rarity);
    case 'clothing': return CLOTHING.filter((c) => c.rarity === rarity && !c.starter && c.license === 'original');
    case 'effect': return EFFECTS.filter((e) => e.rarity === rarity);
  }
}
export function rollRarity(box: BoxDef, u: number): Rarity {
  let acc = 0;
  for (const r of RARITIES) { acc += box.odds[r]; if (u * 100 < acc) return r; }
  return 'common';
}
