// Generator for the 6,000-mission library. Deterministic: the database seed and the tests
// produce exactly the same rows. Every mission has a unique id and a unique rule tuple.
import { rng } from './constants';
import { MODES } from './modes';
import { MAPS } from './maps';
import { CAT_NAME, WEAPONS, WeaponCat } from './weapons';

export type MissionType = 'kills' | 'headshots' | 'wins' | 'matches' | 'streak' | 'captures' | 'damage' | 'score' | 'longshots' | 'slidekills' | 'topthree' | 'adskills';
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface MissionDef {
  id: string; type: MissionType; target: number; difficulty: Difficulty; reward: number; title: string;
  /** optional filters — null means "any" */
  mode: string | null; map: string | null; cat: WeaponCat | null; weapon: string | null;
}
export const MISSION_COUNT = 6000;

const modes = MODES.filter((m) => m.rewards);
const cats = Object.keys(CAT_NAME) as WeaponCat[];
const T: Record<MissionType, { verb: (n: number) => string; targets: number[]; unit: number; quota: number; modes?: string[] }> = {
  kills: { verb: (n) => `Get ${n} eliminations`, targets: [5, 8, 10, 12, 15, 20, 25, 30, 40, 50], unit: 1, quota: 2668 },
  headshots: { verb: (n) => `Get ${n} headshot eliminations`, targets: [2, 3, 5, 7, 10, 12, 15], unit: 2.5, quota: 800 },
  adskills: { verb: (n) => `Get ${n} eliminations while aiming down sights`, targets: [5, 8, 12, 16, 20, 25], unit: 1.2, quota: 500 },
  longshots: { verb: (n) => `Get ${n} long-range eliminations (30m+)`, targets: [1, 2, 3, 5, 7, 10], unit: 3, quota: 450 },
  slidekills: { verb: (n) => `Get ${n} eliminations while sliding`, targets: [1, 2, 3, 4, 5, 6], unit: 4, quota: 400 },
  damage: { verb: (n) => `Deal ${n} damage`, targets: [500, 750, 1000, 1500, 2000, 3000, 4000, 5000], unit: 0.012, quota: 500 },
  wins: { verb: (n) => (n === 1 ? 'Win a match' : `Win ${n} matches`), targets: [1, 2, 3, 4, 5], unit: 8, quota: 110 },
  matches: { verb: (n) => (n === 1 ? 'Complete a match without quitting' : `Complete ${n} matches without quitting`), targets: [1, 2, 3, 4, 5, 6, 8], unit: 4, quota: 150 },
  streak: { verb: (n) => `Earn a ${n}-elimination streak`, targets: [2, 3, 4, 5, 6, 7, 8], unit: 5, quota: 150 },
  score: { verb: (n) => `Score ${n} points in a single match`, targets: [500, 800, 1000, 1500, 2000, 2500, 3000], unit: 0.012, quota: 150 },
  topthree: { verb: (n) => (n === 1 ? 'Finish a match in the top three' : `Finish in the top three ${n} times`), targets: [1, 2, 3, 4, 5], unit: 6, quota: 90 },
  captures: { verb: (n) => (n === 1 ? 'Capture an objective' : `Capture ${n} objectives`), targets: [1, 2, 3, 4, 5, 6, 8, 10], unit: 4, quota: 32, modes: ['dom'] },
};
const WEAPON_TYPES: MissionType[] = ['kills', 'headshots', 'adskills', 'longshots', 'slidekills', 'damage'];

export function generateMissions(): MissionDef[] {
  const out: MissionDef[] = [];
  const seen = new Set<string>();
  const r = rng(0x5400741);
  for (const type of Object.keys(T) as MissionType[]) {
    const spec = T[type];
    // enumerate every legal combination for this type, then take a deterministic shuffled quota
    const combos: Omit<MissionDef, 'id' | 'difficulty' | 'reward' | 'title'>[] = [];
    const modeOpts: (string | null)[] = spec.modes ? spec.modes : [null, ...modes.map((m) => m.id)];
    const mapOpts: (string | null)[] = [null, ...MAPS.map((m) => m.id)];
    const wOpts: { cat: WeaponCat | null; weapon: string | null }[] = [{ cat: null, weapon: null }];
    if (WEAPON_TYPES.includes(type)) {
      for (const c of cats) wOpts.push({ cat: c, weapon: null });
      for (const w of WEAPONS) wOpts.push({ cat: null, weapon: w.id });
    }
    for (const target of spec.targets) for (const mode of modeOpts) for (const map of mapOpts) for (const w of wOpts) {
      if (mode === 'gungame' && (w.cat || w.weapon)) continue; // ladder weapons are forced, filters would be unfair
      if (type === 'slidekills' && w.cat === 'sniper') continue;
      combos.push({ type, target, mode, map, cat: w.cat, weapon: w.weapon });
    }
    for (let i = combos.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [combos[i], combos[j]] = [combos[j], combos[i]]; }
    // unfiltered missions first so the simplest version of each objective always exists
    combos.sort((a, b) => filters(a) - filters(b));
    for (const c of combos.slice(0, spec.quota)) {
      const key = `${c.type}|${c.target}|${c.mode}|${c.map}|${c.cat}|${c.weapon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const effort = c.target * spec.unit * (1 + 0.35 * filters(c));
      const difficulty: Difficulty = effort < 12 ? 'easy' : effort < 28 ? 'medium' : 'hard';
      const reward = Math.round((150 + effort * 22) / 50) * 50;
      out.push({ ...c, id: 'M' + String(out.length + 1).padStart(4, '0'), difficulty, reward: Math.min(reward, 2500), title: title(c, spec.verb(c.target)) });
    }
  }
  return out;
}
const filters = (c: { mode: string | null; map: string | null; cat: string | null; weapon: string | null }) => (c.mode ? 1 : 0) + (c.map ? 1 : 0) + (c.cat ? 1 : 0) + (c.weapon ? 1.5 : 0);
function title(c: { mode: string | null; map: string | null; cat: WeaponCat | null; weapon: string | null }, base: string) {
  let s = base;
  if (c.weapon) s += ` with the ${WEAPONS.find((w) => w.id === c.weapon)!.name}`;
  else if (c.cat) s += ` with ${CAT_NAME[c.cat].toLowerCase()}`;
  if (c.mode) s += ` in ${MODES.find((m) => m.id === c.mode)!.name}`;
  if (c.map) s += ` on ${MAPS.find((m) => m.id === c.map)!.name}`;
  return s;
}

/** Per-match facts the server records for each player; missions are evaluated only against this. */
export interface KillRec { weapon: string; cat: WeaponCat; head: boolean; dist: number; slide: boolean; ads: boolean }
export interface MatchFacts { mode: string; map: string; kills: KillRec[]; damage: { weapon: string; cat: WeaponCat; amount: number }[]; won: boolean; completed: boolean; maxStreak: number; captures: number; score: number; placement: number }

/** How much progress a finished match contributes to a mission. Pure function, server-side only. */
export function missionProgress(m: MissionDef, f: MatchFacts): number {
  if (!f.completed) return 0;
  if (m.mode && m.mode !== f.mode) return 0;
  if (m.map && m.map !== f.map) return 0;
  const wOk = (x: { weapon: string; cat: WeaponCat }) => (!m.weapon || m.weapon === x.weapon) && (!m.cat || m.cat === x.cat);
  switch (m.type) {
    case 'kills': return f.kills.filter(wOk).length;
    case 'headshots': return f.kills.filter((k) => wOk(k) && k.head).length;
    case 'adskills': return f.kills.filter((k) => wOk(k) && k.ads).length;
    case 'longshots': return f.kills.filter((k) => wOk(k) && k.dist >= 30).length;
    case 'slidekills': return f.kills.filter((k) => wOk(k) && k.slide).length;
    case 'damage': return Math.floor(f.damage.filter(wOk).reduce((a, d) => a + d.amount, 0));
    case 'wins': return f.won ? 1 : 0;
    case 'matches': return 1;
    case 'captures': return f.captures;
    case 'topthree': return f.placement <= 3 ? 1 : 0;
    // single-match achievements: complete in one go or not at all
    case 'streak': return f.maxStreak >= m.target ? m.target : 0;
    case 'score': return f.score >= m.target ? m.target : 0;
  }
}
