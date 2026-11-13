// Clothing catalogue. Every item here is an ORIGINAL design under a fictional in-game label.
// No real-world brand is included: licensed collections can be added later through the
// `catalog_items` database table (license = 'licensed' | 'ugc'), which the server merges in.
import { Rarity, RARITIES } from './constants';

export type ClothSlot = 'hoodie' | 'shirt' | 'jacket' | 'pants' | 'shoes' | 'mask' | 'hat' | 'chain' | 'accessory' | 'hair' | 'gloves' | 'back';
export const CLOTH_SLOTS: ClothSlot[] = ['hoodie', 'shirt', 'jacket', 'pants', 'shoes', 'mask', 'hat', 'chain', 'accessory', 'hair', 'gloves', 'back'];
export const CLOTH_SLOT_NAME: Record<ClothSlot, string> = {
  hoodie: 'Hoodies', shirt: 'Shirts', jacket: 'Jackets', pants: 'Pants', shoes: 'Shoes', mask: 'Masks', hat: 'Hats', chain: 'Chains', accessory: 'Accessories', hair: 'Hairstyles', gloves: 'Gloves', back: 'Back',
};
export interface ClothingDef {
  id: string; name: string; brand: string; slot: ClothSlot; style: string; tags: string[]; rarity: Rarity; price: number;
  color: number; color2: number; accent: number; license: 'original' | 'licensed' | 'ugc'; starter?: boolean;
}

/** Original in-game labels. */
export const BRANDS = [
  { name: 'NOIRWAVE', tags: ['minimal', 'luxury', 'oversized'], blurb: 'Monochrome luxury basics.' },
  { name: 'VANTA SUPPLY', tags: ['technical', 'utility', 'industrial'], blurb: 'Technical shells and utility cuts.' },
  { name: 'GRAVECHILD', tags: ['graphic', 'gothic', 'flames'], blurb: 'Heavy graphics, heavier cotton.' },
  { name: 'HEXFORM', tags: ['athletic', 'sport', 'sneakers'], blurb: 'Performance lines and runners.' },
  { name: 'ASHLINE', tags: ['industrial', 'graphic', 'quotes'], blurb: 'Hazard tape, stencil type, grey scale.' },
  { name: 'DEADSIGNAL', tags: ['racing', 'graphic', 'speed'], blurb: 'Motorsport cuts and loud panels.' },
  { name: 'SILVERTONGUE', tags: ['jewelry', 'luxury', 'metal'], blurb: 'Chains, rings and hardware.' },
  { name: 'KILOGRAM', tags: ['workwear', 'denim', 'baggy'], blurb: 'Workwear weights, wide legs.' },
];

/** What a search for a real-world label maps to. We never claim to stock these brands. */
export const BRAND_SEARCH_HINTS: Record<string, string[]> = {
  nike: ['athletic', 'sneakers', 'sport'], adidas: ['athletic', 'sport'], jordan: ['sneakers', 'athletic'],
  'off-white': ['industrial', 'quotes', 'graphic'], offwhite: ['industrial', 'quotes', 'graphic'],
  balenciaga: ['oversized', 'luxury', 'minimal'], hellstar: ['flames', 'graphic', 'gothic'], godspeed: ['racing', 'speed', 'graphic'],
  supreme: ['graphic', 'minimal'], 'chrome hearts': ['jewelry', 'gothic', 'metal'], 'rick owens': ['gothic', 'oversized'],
  carhartt: ['workwear', 'utility'], 'stone island': ['technical', 'utility'], bape: ['graphic', 'sneakers'], essentials: ['minimal', 'oversized'],
};

const COLORWAYS: [string, number, number, number, number][] = [
  // name, primary, secondary, accent, rarity offset
  ['Matte Black', 0x101012, 0x1c1c20, 0x3a3a40, 0], ['Charcoal', 0x2a2c31, 0x1a1b1e, 0x55585f, 0], ['Bone', 0xcfc8b8, 0x9a9486, 0x1a1a1a, 0],
  ['Oxblood', 0x4a1016, 0x230609, 0xb9bdc6, 1], ['Deep Violet', 0x2d1452, 0x160a2a, 0xb04dff, 1], ['Gunmetal', 0x4a4e57, 0x2a2d33, 0xb9bdc6, 1],
  ['Blackout Red', 0x0c0c0e, 0x1a1a1e, 0xff2d45, 2], ['Violet Signal', 0x0f0d14, 0x1c1826, 0xb04dff, 2], ['Chrome', 0xb9bdc6, 0x6a6e77, 0x101012, 3],
];
type St = [style: string, label: string, brand: number, tags: string[], baseRarity: number, basePrice: number];
const STYLES: Record<ClothSlot, St[]> = {
  hoodie: [['pullover', 'Heavyweight Hoodie', 0, ['oversized', 'minimal'], 0, 400], ['zip', 'Zip Hoodie', 3, ['athletic', 'sport'], 0, 450], ['graphic', 'Graphic Hoodie', 2, ['graphic', 'flames', 'gothic'], 1, 700], ['cropped', 'Boxy Hoodie', 4, ['industrial', 'quotes'], 1, 650]],
  shirt: [['tee', 'Box Tee', 0, ['minimal'], 0, 200], ['longsleeve', 'Long Sleeve', 4, ['industrial', 'quotes'], 0, 260], ['graphic', 'Graphic Tee', 2, ['graphic', 'flames'], 1, 380], ['jersey', 'Race Jersey', 5, ['racing', 'speed', 'sport'], 1, 420]],
  jacket: [['bomber', 'Bomber Jacket', 0, ['minimal', 'luxury'], 1, 900], ['shell', 'Tech Shell', 1, ['technical', 'utility'], 1, 950], ['puffer', 'Puffer', 0, ['oversized', 'luxury'], 2, 1300], ['leather', 'Moto Leather', 5, ['racing', 'gothic'], 2, 1500], ['work', 'Chore Coat', 7, ['workwear', 'denim'], 1, 850]],
  pants: [['cargo', 'Cargo Pants', 1, ['utility', 'technical', 'baggy'], 0, 400], ['denim', 'Wide Denim', 7, ['denim', 'baggy', 'workwear'], 0, 420], ['track', 'Track Pants', 3, ['athletic', 'sport'], 0, 350], ['slim', 'Tapered Trousers', 0, ['minimal', 'luxury'], 1, 500]],
  shoes: [['runner', 'Runner', 3, ['sneakers', 'athletic', 'sport'], 0, 500], ['hightop', 'High-Top', 3, ['sneakers', 'athletic'], 1, 700], ['boot', 'Combat Boot', 1, ['utility', 'gothic'], 0, 550], ['chunky', 'Platform Trainer', 0, ['sneakers', 'oversized', 'luxury'], 2, 1100]],
  mask: [['balaclava', 'Balaclava', 1, ['utility', 'technical'], 0, 350], ['bandana', 'Bandana', 2, ['graphic', 'gothic'], 0, 250], ['respirator', 'Half Respirator', 1, ['technical', 'industrial'], 2, 900], ['shiesty', 'Knit Mask', 0, ['minimal'], 1, 450]],
  hat: [['cap', 'Six-Panel Cap', 3, ['sport', 'athletic'], 0, 250], ['beanie', 'Beanie', 0, ['minimal'], 0, 220], ['bucket', 'Bucket Hat', 7, ['workwear'], 1, 320], ['trucker', 'Trucker Cap', 5, ['racing', 'graphic'], 1, 340]],
  chain: [['thin', 'Rope Chain', 6, ['jewelry', 'metal'], 1, 800], ['cuban', 'Cuban Link', 6, ['jewelry', 'metal', 'luxury'], 2, 1500], ['pendant', 'Pendant Chain', 6, ['jewelry', 'gothic'], 2, 1700], ['cross', 'Cross Pendant', 6, ['jewelry', 'gothic', 'metal'], 3, 2400]],
  accessory: [['watch', 'Steel Watch', 6, ['jewelry', 'luxury', 'metal'], 1, 900], ['shades', 'Wrap Shades', 0, ['luxury', 'minimal'], 1, 600], ['belt', 'Industrial Belt', 4, ['industrial', 'quotes'], 0, 350], ['bag', 'Cross-Body Bag', 1, ['utility', 'technical'], 1, 650]],
  hair: [['buzz', 'Buzz Cut', 0, [], 0, 0], ['fade', 'High Fade', 0, [], 0, 150], ['braids', 'Braids', 0, [], 1, 300], ['locs', 'Locs', 0, [], 1, 300], ['long', 'Long Tied', 0, [], 0, 200], ['curls', 'Curls', 0, [], 0, 200]],
  gloves: [['tactical', 'Tactical Gloves', 1, ['utility', 'technical'], 0, 300], ['fingerless', 'Fingerless Gloves', 2, ['gothic'], 0, 250], ['leather', 'Leather Gloves', 5, ['racing', 'luxury'], 1, 500], ['knit', 'Knit Gloves', 0, ['minimal'], 0, 200]],
  back: [['backpack', 'Utility Backpack', 1, ['utility', 'technical'], 0, 500], ['duffel', 'Duffel', 3, ['sport', 'athletic'], 1, 650], ['sling', 'Rifle Sling Pack', 1, ['utility'], 1, 700], ['wings', 'Hardshell Pack', 5, ['racing', 'technical'], 2, 1400]],
};
const HAIR_COLORS: [string, number][] = [['Black', 0x0c0b0b], ['Dark Brown', 0x2a1c14], ['Ash', 0x8a8780], ['Violet', 0x4a2a8a]];

export const CLOTHING: ClothingDef[] = [];
for (const slot of CLOTH_SLOTS) {
  STYLES[slot].forEach(([style, label, bi, tags, br, price], si) => {
    if (slot === 'hair') {
      HAIR_COLORS.forEach(([cn, c], ci) => CLOTHING.push({
        id: `hair_${style}_${ci}`, name: `${label} — ${cn}`, brand: 'SHOOTAY', slot, style, tags: ['hair'], rarity: RARITIES[Math.min(5, br + (ci === 3 ? 2 : 0))],
        price: price + ci * 50, color: c, color2: c, accent: c, license: 'original', starter: ci === 0 && si < 2,
      }));
      return;
    }
    // each style ships in a rotating subset of colourways so slots don't all look alike
    for (let k = 0; k < 4; k++) {
      const ci = (si * 2 + k * 2 + (slot.length % 3)) % COLORWAYS.length;
      const [cn, c1, c2, ac, cr] = COLORWAYS[ci];
      const rr = Math.min(5, br + cr);
      const brand = BRANDS[bi];
      CLOTHING.push({
        id: `${slot}_${style}_${ci}`, name: `${label} — ${cn}`, brand: brand.name, slot, style, tags: [...new Set([...tags, ...brand.tags])],
        rarity: RARITIES[rr], price: Math.round((price * (1 + cr * 0.6)) / 50) * 50, color: c1, color2: c2, accent: ac, license: 'original',
      });
    }
  });
}
// starter wardrobe: one plain piece per essential slot
for (const id of ['shirt_tee_', 'pants_cargo_', 'shoes_runner_', 'hoodie_pullover_']) {
  const opts = CLOTHING.filter((c) => c.id.startsWith(id));
  const it = opts.find((c) => c.name.endsWith('Matte Black')) ?? opts.find((c) => c.name.endsWith('Charcoal')) ?? opts[0];
  if (!/Matte Black|Charcoal/.test(it.name)) { it.name = it.name.replace(/— .*/, '— Charcoal'); it.color = 0x2a2c31; it.color2 = 0x1a1b1e; it.accent = 0x55585f; it.rarity = 'common'; }
  it.starter = true; it.price = 0;
}
export const CLOTH_BY_ID: Record<string, ClothingDef> = Object.fromEntries(CLOTHING.map((c) => [c.id, c]));
export const STARTER_CLOTHING = CLOTHING.filter((c) => c.starter).map((c) => c.id);

export interface Operator { id: string; name: string; bio: string; skin: number; build: number; height: number }
export const OPERATORS: Operator[] = [
  { id: 'op_kade', name: 'Kade', bio: 'Ex-courier. Knows every rooftop in the district.', skin: 0x8d5a3c, build: 1.0, height: 1.0 },
  { id: 'op_ivy', name: 'Ivy', bio: 'Signals tech turned contractor.', skin: 0xc69273, build: 0.9, height: 0.97 },
  { id: 'op_mourn', name: 'Mourn', bio: 'Says little. Shows up early.', skin: 0x5a3a28, build: 1.08, height: 1.03 },
  { id: 'op_sable', name: 'Sable', bio: 'Docks enforcer with a long memory.', skin: 0xe0b594, build: 1.04, height: 1.0 },
  { id: 'op_rook', name: 'Rook', bio: 'Tower block legend. Never rushes.', skin: 0x3d2a20, build: 1.0, height: 1.02 },
  { id: 'op_vex', name: 'Vex', bio: 'Night-shift racer, part-time problem.', skin: 0xa87454, build: 0.93, height: 0.98 },
];
export const OPERATOR_BY_ID: Record<string, Operator> = Object.fromEntries(OPERATORS.map((o) => [o.id, o]));

export type Outfit = { operator: string } & Partial<Record<ClothSlot, string | null>>;
export const DEFAULT_OUTFIT: Outfit = {
  operator: 'op_kade', hair: 'hair_buzz_0',
  shirt: STARTER_CLOTHING.find((i) => i.startsWith('shirt')), pants: STARTER_CLOTHING.find((i) => i.startsWith('pants')),
  shoes: STARTER_CLOTHING.find((i) => i.startsWith('shoes')), hoodie: STARTER_CLOTHING.find((i) => i.startsWith('hoodie')),
};

/** Catalogue search. Returns matches plus an honest notice when the query names a real-world brand. */
export function searchClothing(items: ClothingDef[], q: string, slot?: ClothSlot | null): { items: ClothingDef[]; notice: string | null } {
  const query = q.trim().toLowerCase();
  let pool = slot ? items.filter((i) => i.slot === slot) : items;
  if (!query) return { items: pool, notice: null };
  const hintKey = Object.keys(BRAND_SEARCH_HINTS).find((k) => query.includes(k));
  const licensed = pool.filter((i) => i.license !== 'original' && i.brand.toLowerCase().includes(query));
  if (hintKey && !licensed.length) {
    const tags = BRAND_SEARCH_HINTS[hintKey];
    return {
      items: pool.filter((i) => i.tags.some((t) => tags.includes(t))),
      notice: `There is no licensed "${q.trim()}" collection in SHOOTAY. Showing original designs in a similar style.`,
    };
  }
  const words = query.split(/\s+/);
  pool = pool.filter((i) => { const hay = `${i.name} ${i.brand} ${i.style} ${i.slot} ${i.tags.join(' ')} ${i.rarity}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  return { items: pool, notice: null };
}
