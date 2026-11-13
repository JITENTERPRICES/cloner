// Weapons, gunsmith (attachments + skins), combination rarity and collection statistics.
import { ATTACHMENTS, ATT_BY_ID, SLOTS, SLOT_NAME, Slot, cleanAttachments, comboRarity, compatible, computeStats, slotAllowed } from '../../../../shared/attachments';
import { RARITIES, RARITY_COLOR, Rarity, rarityRank } from '../../../../shared/constants';
import { CAT_NAME, EFFECTS, SKINS, WEAPONS, WEAPON_BY_ID, WeaponCat, WeaponDef } from '../../../../shared/weapons';
import { sfx } from '../../engine/audio';
import { api, refreshMe } from '../../net/net';
import { app, setDeyes } from '../../state';
import { clear, deyes, guard, h, rarityTag, toast } from '../dom';
import type { Ctx } from '../shell';

type Build = { atts: string[]; skin: string | null };
const builds: Record<string, Build> = (() => { try { return JSON.parse(localStorage.getItem('shootay.builds') ?? '{}'); } catch { return {}; } })();
const saveBuilds = () => localStorage.setItem('shootay.builds', JSON.stringify(builds));

function buildFor(w: WeaponDef): Build {
  const u = app.user!;
  const eq = [u.loadout.primary, u.loadout.secondary].find((s) => s.weapon === w.id);
  const b = builds[w.id] ?? (eq ? { atts: eq.atts, skin: eq.skin } : { atts: [], skin: null });
  // drop anything no longer owned / compatible
  b.atts = cleanAttachments(w.id, b.atts).filter((a) => u.inventory.attachment.includes(a));
  if (b.skin && !u.inventory.skin.includes(b.skin)) b.skin = null;
  return (builds[w.id] = b);
}
const owns = (w: WeaponDef) => app.user!.inventory.weapon.includes(w.id);
const lockText = (w: WeaponDef) => (w.unlock.type === 'level' ? `Unlocks at level ${w.unlock.level}` : w.unlock.type === 'box' ? 'Mystery Box exclusive' : w.unlock.type === 'buy' ? 'Buy in the armory' : '');

export function weaponsPanel(body: HTMLElement, ctx: Ctx) {
  const u = app.user!;
  let cat: WeaponCat = WEAPON_BY_ID[u.loadout.primary.weapon].cat;
  let current: WeaponDef = WEAPON_BY_ID[u.loadout.primary.weapon];
  let picking: Slot | 'skin' | null = null;

  const render = () => {
    clear(body);
    const b = buildFor(current), st = computeStats(current, b.atts), base = computeStats(current, []);
    const rarity = comboRarity(current.id, b.atts);
    ctx.lobby.showWeapon(current.id, b.atts, b.skin, rarity);
    const inv = app.user!.inventory;
    // collection statistics
    const perRarity = (owned: string[], all: { id: string; rarity: Rarity }[]) => RARITIES.map((r) => h('span.dot', { title: `${r}: ${all.filter((x) => x.rarity === r && owned.includes(x.id)).length}/${all.filter((x) => x.rarity === r).length}`, style: { background: RARITY_COLOR[r], opacity: all.some((x) => x.rarity === r && owned.includes(x.id)) ? 1 : 0.25 } }));
    body.append(h('div.collection', null,
      h('div', null, h('b', null, `${inv.weapon.length}/${WEAPONS.length}`), h('small', null, 'Weapons'), h('div.dots', null, perRarity(inv.weapon, WEAPONS))),
      h('div', null, h('b', null, `${inv.attachment.length}/${ATTACHMENTS.length}`), h('small', null, 'Attachments'), h('div.dots', null, perRarity(inv.attachment, ATTACHMENTS))),
      h('div', null, h('b', null, `${inv.skin.length}/${SKINS.length}`), h('small', null, 'Skins'), h('div.dots', null, perRarity(inv.skin, SKINS))),
      h('div', null, h('b', null, `${inv.effect.length}/${EFFECTS.length}`), h('small', null, 'Effects'), h('div.dots', null, perRarity(inv.effect, EFFECTS)))));

    body.append(h('div.tabs', null, (Object.keys(CAT_NAME) as WeaponCat[]).map((c) => h('button.tab', { class: c === cat ? 'on' : '', onclick: () => { cat = c; current = WEAPONS.find((w) => w.cat === c && owns(w)) ?? WEAPONS.find((w) => w.cat === c)!; picking = null; render(); } }, CAT_NAME[c]))));
    body.append(h('div.grid.weapons', null, WEAPONS.filter((w) => w.cat === cat).map((w) => {
      const eq = u.loadout.primary.weapon === w.id || u.loadout.secondary.weapon === w.id;
      return h('button.card.item-card', { class: `r-${w.rarity}${w === current ? ' selected' : ''}${owns(w) ? '' : ' locked'}`, onclick: () => { current = w; picking = null; render(); } },
        h('b', null, w.name), rarityTag(w.rarity), h('small', null, eq ? 'EQUIPPED' : owns(w) ? 'Owned' : lockText(w)));
    })));

    // detail
    const bar = (label: string, v: number, v0: number, max: number, invert = false) => {
      const k = Math.max(0.04, Math.min(1, invert ? 1 - v / max : v / max)), k0 = Math.max(0.04, Math.min(1, invert ? 1 - v0 / max : v0 / max));
      return h('div.stat', null, h('span', null, label), h('div.bar', null, h('i', { style: { width: Math.min(k, k0) * 100 + '%' } }), k !== k0 ? h('i', { class: k > k0 ? 'up' : 'down', style: { left: Math.min(k, k0) * 100 + '%', width: Math.abs(k - k0) * 100 + '%' } }) : null));
    };
    const detail = h('section.detail', { class: 'r-' + rarity },
      h('div.row.between', null, h('div', null, h('h3', null, current.name), h('small', null, CAT_NAME[current.cat])), h('div.combo', null, h('small', null, 'COMBINATION'), rarityTag(rarity))),
      h('p.muted', null, current.desc),
      h('div.stats', null,
        bar('Damage', st.damage * st.pellets, base.damage * base.pellets, 110), bar('Fire rate', st.rpm, base.rpm, 1100), bar('Range', st.rangeStart, base.rangeStart, 90),
        bar('Accuracy', st.hip, base.hip, 8, true), bar('Control', st.recoilV, base.recoilV, 5.5, true), bar('Handling', st.adsTime, base.adsTime, 0.6, true), bar('Mobility', st.move - 0.8, base.move - 0.8, 0.26)),
      h('div.meta', null, `Magazine ${st.mag} · Reload ${st.reload.toFixed(1)}s · ${st.auto ? 'Automatic' : 'Semi-auto'}${st.silent ? ' · Suppressed' : ''}`),
      h('p.fine', null, 'Rarity is collection status. It never adds damage: every weapon in a class sits in the same time-to-kill band.'));
    if (owns(current)) {
      detail.append(h('h4', null, 'Attachments'), h('div.grid.slots', null, SLOTS.filter((s) => slotAllowed(current, s)).map((s) => {
        const a = b.atts.map((id) => ATT_BY_ID[id]).find((x) => x.slot === s);
        return h('button.slot', { class: (a ? 'r-' + a.rarity : 'empty') + (picking === s ? ' selected' : ''), onclick: () => { picking = picking === s ? null : s; render(); } }, h('small', null, SLOT_NAME[s]), h('b', null, a ? a.name : 'Empty'));
      }), h('button.slot', { class: (b.skin ? 'r-' + SKINS.find((k) => k.id === b.skin)!.rarity : 'empty') + (picking === 'skin' ? ' selected' : ''), onclick: () => { picking = picking === 'skin' ? null : 'skin'; render(); } }, h('small', null, 'Skin'), h('b', null, b.skin ? SKINS.find((k) => k.id === b.skin)!.name : 'Factory'))));
      if (picking === 'skin') detail.append(h('div.picker', null, h('button.pick', { class: !b.skin ? 'on' : '', onclick: () => { b.skin = null; saveBuilds(); sfx.ui('equip'); render(); } }, h('b', null, 'Factory finish')),
        SKINS.map((k) => { const have = inv.skin.includes(k.id); return h('button.pick', { class: `r-${k.rarity}${b.skin === k.id ? ' on' : ''}${have ? '' : ' locked'}`, disabled: !have, onclick: () => { b.skin = k.id; saveBuilds(); sfx.ui('equip'); render(); } }, h('i.swatch', { style: { background: '#' + k.color.toString(16).padStart(6, '0'), borderColor: '#' + k.accent.toString(16).padStart(6, '0') } }), h('b', null, k.name), rarityTag(k.rarity), have ? null : h('small', null, 'Mystery Box')); })));
      else if (picking) {
        const slot = picking;
        const options = ATTACHMENTS.filter((a) => a.slot === slot && compatible(current, a)).sort((x, y) => Number(inv.attachment.includes(y.id)) - Number(inv.attachment.includes(x.id)) || rarityRank(x.rarity) - rarityRank(y.rarity));
        const mods = (a: typeof options[number]) => Object.entries(a.mods).map(([k, v]) => {
          if (k === 'silent') return 'Suppressed'; if (k === 'zoom') return `${v}x zoom`;
          const pct = Math.round(((v as number) - 1) * 100); const good = ['range', 'mag', 'move'].includes(k) ? pct > 0 : pct < 0;
          return h('span', { class: good ? 'good' : 'bad' }, `${pct > 0 ? '+' : ''}${pct}% ${({ recoil: 'recoil', hip: 'hip spread', ads: 'ADS spread', adsTime: 'ADS time', move: 'movement', range: 'range', mag: 'magazine', reload: 'reload time' } as any)[k]}`);
        });
        detail.append(h('div.picker', null,
          h('button.pick', { onclick: () => { b.atts = b.atts.filter((id) => ATT_BY_ID[id].slot !== slot); saveBuilds(); render(); } }, h('b', null, 'None')),
          options.map((a) => { const have = inv.attachment.includes(a.id), on = b.atts.includes(a.id);
            return h('button.pick', { class: `r-${a.rarity}${on ? ' on' : ''}${have ? '' : ' locked'}`, disabled: !have, onclick: () => { b.atts = [...b.atts.filter((id) => ATT_BY_ID[id].slot !== slot), a.id]; saveBuilds(); sfx.ui('equip'); render(); } },
              h('b', null, a.name), rarityTag(a.rarity), h('small', null, a.desc), h('div.mods', null, Object.keys(a.mods).length ? mods(a) : 'Cosmetic only'), have ? null : h('small.lock', null, 'Found in Mystery Boxes')); })));
      }
      const slotName = current.cat === 'pistol' ? 'secondary' : 'primary';
      const eq = u.loadout[slotName];
      const same = eq.weapon === current.id && eq.skin === b.skin && eq.atts.join() === b.atts.join();
      detail.append(h('div.row', null, h('button.btn.primary', { disabled: same, onclick: guard(async () => {
        const r = await api('/loadout', { loadout: { ...u.loadout, [slotName]: { weapon: current.id, atts: b.atts, skin: b.skin } }, fx: u.fx }, 'PUT');
        u.loadout = r.loadout; u.fx = r.fx; sfx.ui('equip'); toast(`${current.name} equipped as ${slotName}`, 'good');
        ctx.lobby.refreshWeapon(); render();
      }) }, same ? `Equipped (${slotName})` : `Equip as ${slotName}`)));
    } else {
      detail.append(h('div.locked-note', null, h('b', null, 'LOCKED'), h('span', null, lockText(current))));
      if (current.unlock.type === 'buy') { const price = current.unlock.price; detail.append(h('button.btn.primary', { onclick: guard(async () => { const r = await api('/shop/buy', { type: 'weapon', id: current.id }); setDeyes(r.deyes); await refreshMe(); sfx.ui('buy'); toast(`${current.name} unlocked`, 'good'); render(); }) }, 'Buy for ', deyes(price))); }
    }
    body.append(detail);

    // cosmetic effects
    const fxRow = (kind: 'tracer' | 'kill', label: string) => h('label', null, label, h('select', { onchange: guard(async (e: Event) => {
      const v = (e.target as HTMLSelectElement).value || null;
      const r = await api('/loadout', { loadout: u.loadout, fx: { ...u.fx, [kind]: v } }, 'PUT'); u.fx = r.fx; sfx.ui('equip');
    }) }, h('option', { value: '' }, 'Standard'), EFFECTS.filter((e) => e.kind === kind && inv.effect.includes(e.id)).map((e) => h('option', { value: e.id, selected: u.fx[kind] === e.id }, e.name))));
    body.append(h('section', null, h('h4', null, 'Cosmetic effects'), h('div.form', null, fxRow('tracer', 'Tracer colour'), fxRow('kill', 'Elimination effect')), inv.effect.length ? null : h('p.muted', null, 'Effects drop from Mystery Boxes.')));
  };
  render();
  return () => { ctx.lobby.showCharacter(); ctx.lobby.refreshWeapon(); };
}
