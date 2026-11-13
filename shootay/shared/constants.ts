// Shared constants used by client and server. Nothing secret lives here.
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9aa0a6', uncommon: '#3ecf6e', rare: '#3d8bff', epic: '#a24bff', legendary: '#f5b83d', mythic: '#ff3b4e',
};
export const rarityRank = (r: Rarity) => RARITIES.indexOf(r);

export const DEYES_SYMBOL = '👁️‍🗨️';
export const DEYES_PER_KILL = 100;
export const STARTING_DEYES = 1000;
/** Kills on the same victim beyond this count in one match earn nothing (anti-farming). */
export const MAX_REWARDED_KILLS_PER_VICTIM = 8;
export const DEFAULT_GORE = 0.59;

export const PHYS = {
  radius: 0.32, height: 1.8, crouchHeight: 1.15, eye: 1.62, crouchEye: 0.98,
  walk: 5.4, sprint: 7.8, crouch: 2.7, adsMul: 0.62,
  accel: 55, airAccel: 14, friction: 9,
  jump: 6.9, gravity: 21, step: 0.62,
  slideBoost: 1.32, slideMin: 10.4, slideFriction: 5.2, slideEnd: 3.4, slideMax: 1.25, slideCooldown: 0.35,
  /** Server-side sanity limit (m/s) — covers slide-jumps with headroom. */
  maxSpeed: 15,
};

export const HITBOX = { bodyHalf: 0.36, headHalf: 0.22, headH: 0.36 };
export const TICK_RATE = 20;
export const RESPAWN_TIME = 3;
export const SPAWN_PROTECT = 2;
export const MAX_HP = 100;

// state flag bits sent over the wire
export const F_CROUCH = 1, F_SLIDE = 2, F_SPRINT = 4, F_ADS = 8, F_AIR = 16, F_RELOAD = 32;

export const xpForLevel = (lvl: number) => 500 * (lvl - 1) * (lvl - 1);
export const levelFromXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 500)) + 1;

/** Deterministic PRNG (mulberry32) so generated content is identical on client, server and DB seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
