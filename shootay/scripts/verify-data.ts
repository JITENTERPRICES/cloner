// Data integrity tests: run with `npm test`. Fails loudly if any content promise is not met.
import { ATTACHMENTS, SLOTS, comboRarity, computeStats } from '../shared/attachments';
import { BOXES, pool } from '../shared/boxes';
import { CLOTHING, CLOTH_SLOTS, searchClothing } from '../shared/clothing';
import { PHYS, RARITIES } from '../shared/constants';
import { MAPS, mapColliderBoxes } from '../shared/maps';
import { generateMissions, MISSION_COUNT } from '../shared/missions';
import { Collider } from '../shared/physics';
import { WEAPONS, GUN_GAME_LADDER, WEAPON_BY_ID } from '../shared/weapons';

let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failed++; };
const uniq = (a: string[]) => new Set(a).size === a.length;

ok(WEAPONS.length >= 30, `${WEAPONS.length} weapons (>= 30)`);
ok(uniq(WEAPONS.map((w) => w.id)) && uniq(WEAPONS.map((w) => w.name)), 'weapon ids and names unique');
ok(GUN_GAME_LADDER.every((id) => WEAPON_BY_ID[id]), 'gun game ladder weapons exist');
ok(ATTACHMENTS.length >= 200, `${ATTACHMENTS.length} attachments (>= 200)`);
ok(uniq(ATTACHMENTS.map((a) => a.id)) && uniq(ATTACHMENTS.map((a) => a.name)), 'attachment ids and names unique');
ok(SLOTS.every((s) => ATTACHMENTS.filter((a) => a.slot === s).length >= 20), 'every attachment slot has 20+ entries');
ok(comboRarity('drk7', ['grip_woodgrip_standard']) !== 'rare', `DRK-7 + rare wooden grip => ${comboRarity('drk7', ['grip_woodgrip_standard'])}`);

// balance: body-shot time-to-kill must not improve with rarity inside a category
for (const cat of ['ar', 'smg', 'lmg'] as const) {
  const ttk = WEAPONS.filter((w) => w.cat === cat).map((w) => ({ r: w.rarity, t: (Math.ceil(100 / w.damage) - 1) * (60 / w.rpm) }));
  const min = Math.min(...ttk.map((x) => x.t)), max = Math.max(...ttk.map((x) => x.t));
  ok(max - min < 0.12, `${cat} TTK spread ${(min * 1000) | 0}-${(max * 1000) | 0}ms (rarity is not power)`);
}
ok(computeStats(WEAPON_BY_ID.mr4, ['magazine_ext_standard']).mag > 30, 'attachments change stats');

const missions = generateMissions();
ok(missions.length === MISSION_COUNT, `${missions.length} missions generated (= ${MISSION_COUNT})`);
ok(uniq(missions.map((m) => m.id)), 'mission ids unique');
ok(uniq(missions.map((m) => m.title)), 'mission titles unique');
const diff = Object.fromEntries(['easy', 'medium', 'hard'].map((d) => [d, missions.filter((m) => m.difficulty === d).length]));
ok(Object.values(diff).every((n) => n >= 300), `difficulty spread ${JSON.stringify(diff)}`);

ok(CLOTH_SLOTS.every((s) => CLOTHING.some((c) => c.slot === s)), `${CLOTHING.length} clothing items across all ${CLOTH_SLOTS.length} slots`);
ok(uniq(CLOTHING.map((c) => c.id)), 'clothing ids unique');
const nike = searchClothing(CLOTHING, 'Nike');
ok(!!nike.notice && nike.items.length > 0 && nike.items.every((i) => i.license === 'original'), 'real-brand search returns an honest notice + original designs');

for (const b of BOXES) {
  const sum = RARITIES.reduce((a, r) => a + b.odds[r], 0);
  ok(Math.abs(sum - 100) < 1e-6, `${b.name} odds sum to 100`);
  ok(RARITIES.every((r) => b.odds[r] === 0 || Object.keys(b.types).some((t) => pool(t as any, r).length > 0)), `${b.name} has a reward for every rarity it can roll`);
}

ok(MAPS.length >= 3, `${MAPS.length} maps`);
for (const m of MAPS) {
  const col = new Collider(mapColliderBoxes(m));
  const all = [...m.spawns.a, ...m.spawns.b, ...m.spawns.ffa, ...m.zones.map((z) => [z.p[0], z.p[1] + 0.05, z.p[2]] as [number, number, number])];
  const bad = all.filter((p) => col.overlaps(p[0], p[1], p[2], PHYS.height) || !col.overlaps(p[0], p[1] - 0.3, p[2], 0.2));
  ok(bad.length === 0, `${m.name}: ${m.boxes.length} boxes, ${all.length} spawn/zone points clear and grounded${bad.length ? ' — bad: ' + JSON.stringify(bad) : ''}`);
  ok(m.spawns.a.length >= 5 && m.spawns.b.length >= 5 && m.spawns.ffa.length >= 12, `${m.name}: enough spawns`);
  ok(m.barrels.every((p) => !new Collider(m.boxes.map((x) => x.b)).overlaps(p[0], p[1] + 0.05, p[2], 1.2, 0.4)), `${m.name}: barrels placed in the open`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll data checks passed');
process.exit(failed ? 1 : 0);
