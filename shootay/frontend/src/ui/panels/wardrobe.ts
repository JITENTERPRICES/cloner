// Operators and the searchable clothing catalogue, previewed live on the 3D character.
import { BRANDS, CLOTHING, CLOTH_SLOTS, CLOTH_SLOT_NAME, ClothSlot, ClothingDef, OPERATORS, Outfit, searchClothing } from '../../../../shared/clothing';
import { sfx } from '../../engine/audio';
import { api, refreshMe } from '../../net/net';
import { app, setDeyes } from '../../state';
import { clear, deyes, guard, h, rarityTag, toast } from '../dom';
import type { Ctx } from '../shell';

const saveOutfit = async (o: Outfit) => { app.user!.outfit = await api('/outfit', o, 'PUT'); };

export function operatorsPanel(body: HTMLElement, ctx: Ctx) {
  const render = () => {
    clear(body);
    body.append(h('p.lead', null, 'Operators are identities, not stat packages. Pick one, then dress them in Clothing.'),
      h('div.grid.ops', null, OPERATORS.map((op) => {
        const on = app.user!.outfit.operator === op.id;
        return h('button.card.op', { class: on ? 'selected' : '', onclick: guard(async () => { await saveOutfit({ ...app.user!.outfit, operator: op.id }); ctx.lobby.setOutfit(app.user!.outfit); sfx.ui('equip'); render(); }) },
          h('i.swatch.big', { style: { background: '#' + op.skin.toString(16).padStart(6, '0') } }), h('b', null, op.name), h('small', null, op.bio), on ? h('span.tag', null, 'ACTIVE') : null);
      })));
  };
  render();
}

export function clothingPanel(body: HTMLElement, ctx: Ctx) {
  const catalogue: ClothingDef[] = [...CLOTHING, ...app.extraClothing];
  let slot: ClothSlot | null = null, query = '', preview: ClothingDef | null = null;
  const search = h('input', { type: 'search', placeholder: 'Search styles, labels, colours… (try "graphic hoodie" or "Nike")', oninput: () => { query = search.value; renderList(); } }) as HTMLInputElement;
  const chips = h('div.chips'), notice = h('div.notice'), grid = h('div.grid.clothes'), detail = h('div.cloth-detail');
  const owned = (c: ClothingDef) => app.user!.inventory.clothing.includes(c.id);
  const worn = (c: ClothingDef) => app.user!.outfit[c.slot] === c.id;

  const show = (c: ClothingDef | null) => {
    preview = c;
    ctx.lobby.setOutfit(c ? { ...app.user!.outfit, [c.slot]: c.id } : app.user!.outfit); // preview on the real character
    if (c && (c.slot === 'back')) ctx.lobby.face(Math.PI * 0.8); else ctx.lobby.face(0.35);
    clear(detail);
    if (!c) return;
    detail.append(h('div.row.between', null, h('div', null, h('small', null, c.brand), h('h3', null, c.name)), rarityTag(c.rarity)),
      h('small.muted', null, `${CLOTH_SLOT_NAME[c.slot]} · ${c.tags.join(' · ')} · ${c.license === 'original' ? 'original SHOOTAY design' : c.license === 'licensed' ? 'licensed collection' : 'approved community upload'}`),
      h('div.row', null,
        owned(c)
          ? h('button.btn.primary', { onclick: guard(async () => { await saveOutfit({ ...app.user!.outfit, [c.slot]: worn(c) ? null : c.id }); sfx.ui('equip'); show(worn(c) ? c : null); renderList(); }) }, worn(c) ? 'Take off' : 'Wear')
          : h('button.btn.primary', { onclick: guard(async () => {
            const r = await api('/shop/buy', { type: 'clothing', id: c.id }); setDeyes(r.deyes); await refreshMe();
            await saveOutfit({ ...app.user!.outfit, [c.slot]: c.id }); sfx.ui('buy'); toast(`${c.name} added to your wardrobe`, 'good'); show(c); renderList();
          }) }, 'Buy for ', deyes(c.price)),
        h('button.btn.ghost', { onclick: () => { show(null); renderList(); } }, 'Stop preview')));
  };
  const renderList = () => {
    clear(chips); clear(grid); clear(notice);
    chips.append(h('button.chip', { class: slot === null ? 'on' : '', onclick: () => { slot = null; renderList(); } }, 'All'),
      ...CLOTH_SLOTS.map((s) => h('button.chip', { class: slot === s ? 'on' : '', onclick: () => { slot = s; renderList(); } }, CLOTH_SLOT_NAME[s])));
    const res = searchClothing(catalogue, query, slot);
    if (res.notice) notice.append(h('b', null, 'Heads up: '), res.notice);
    notice.style.display = res.notice ? 'block' : 'none';
    if (!res.items.length) grid.append(h('p.muted', null, 'Nothing matches that search.'));
    for (const c of res.items.slice(0, 120)) grid.append(h('button.card.item-card', { class: `r-${c.rarity}${preview === c ? ' selected' : ''}`, onclick: () => { show(c); renderList(); } },
      h('i.swatch', { style: { background: '#' + c.color.toString(16).padStart(6, '0'), borderColor: '#' + c.accent.toString(16).padStart(6, '0') } }),
      h('b', null, c.name), h('small', null, c.brand), worn(c) ? h('span.tag', null, 'WEARING') : owned(c) ? h('small', null, 'Owned') : deyes(c.price, 'small')));
  };
  body.append(search, chips, notice, detail, grid,
    h('section', null, h('h4', null, 'In-game labels'), h('div.brands', null, BRANDS.map((b) => h('button.chip', { title: b.blurb, onclick: () => { search.value = query = b.name; renderList(); } }, b.name))),
      h('p.fine', null, 'Every item is an original SHOOTAY design under a fictional label. Real-world brands are not in the catalogue; licensed collections and approved community uploads appear here only once they have actually been added.')));
  renderList();
  return () => { ctx.lobby.setOutfit(app.user!.outfit); ctx.lobby.face(0.35); };
}
