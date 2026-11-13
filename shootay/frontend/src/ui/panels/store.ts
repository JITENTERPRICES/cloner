// Mystery boxes: published odds, opening animation, reward reveal and duplicate handling.
import { ATT_BY_ID } from '../../../../shared/attachments';
import { BoxDef, Reward } from '../../../../shared/boxes';
import { RARITIES, RARITY_COLOR, Rarity, rarityRank } from '../../../../shared/constants';
import { sfx } from '../../engine/audio';
import { api, refreshMe } from '../../net/net';
import { app, setDeyes } from '../../state';
import { clear, deyes, guard, h, rarityTag } from '../dom';
import type { Ctx } from '../shell';

const TYPE_NAME: Record<string, string> = { weapon: 'Weapons', skin: 'Weapon skins', attachment: 'Attachments', clothing: 'Clothing', effect: 'Cosmetic effects', combo: 'Rare weapon combinations' };
const TYPE_ONE: Record<string, string> = { weapon: 'Weapon', skin: 'Weapon skin', attachment: 'Attachment', clothing: 'Clothing', effect: 'Cosmetic effect', combo: 'Weapon combination' };

export function boxesPanel(body: HTMLElement, ctx: Ctx) {
  let busy = false;
  const render = async () => {
    const { boxes, duplicateRefund }: { boxes: BoxDef[]; duplicateRefund: Record<Rarity, number> } = await api('/boxes');
    clear(body);
    body.append(h('div.balance', null, 'Your balance ', deyes(app.user!.deyes, 'big')),
      h('p.lead', null, 'Boxes are bought with Deyes you earn by playing. There is nothing to buy with real money, and nothing inside changes weapon damage.'),
      h('div.grid.boxes', null, boxes.map((b) => {
        const total = Object.values(b.types).reduce((a, n) => a + (n ?? 0), 0);
        return h('div.card.box', null,
          h('div.crate', { class: 'crate-' + b.id }, h('i'), h('i')),
          h('h3', null, b.name), h('p', null, b.desc),
          h('h5', null, 'Drop rates'),
          h('table.odds', null, RARITIES.map((r) => h('tr', null, h('td', null, h('span.dot', { style: { background: RARITY_COLOR[r] } }), r.toUpperCase()), h('td', null, b.odds[r] ? `${b.odds[r]}%` : '—')))),
          h('h5', null, 'Contents'),
          h('ul.contents', null, Object.entries(b.types).map(([t, wgt]) => h('li', null, TYPE_NAME[t], h('span', null, `${Math.round(((wgt ?? 0) / total) * 100)}%`)))),
          h('button.btn.primary', { disabled: app.user!.deyes < b.price, onclick: () => open(b) }, 'Open for ', deyes(b.price)),
          app.user!.deyes < b.price ? h('small.muted', null, `You need ${b.price - app.user!.deyes} more Deyes`) : null);
      })),
      h('p.fine', null, `Duplicates: if a box rolls something you already own, Deyes are returned automatically — ${RARITIES.map((r) => `${r} ${duplicateRefund[r]}`).join(' · ')}.`));
  };
  const open = guard(async (b: BoxDef) => {
    if (busy) return; busy = true;
    const overlay = h('div.box-open', null, h('div.crate.big.shake', { class: 'crate-' + b.id }, h('i'), h('i')), h('b', null, `Opening ${b.name}…`));
    document.getElementById('ui')!.appendChild(overlay);
    sfx.boxShake();
    try {
      // the roll happens on the server; the animation just covers the request
      const [res] = await Promise.all([api<{ reward: Reward; duplicate: boolean; refund: number; deyes: number }>('/boxes/open', { boxId: b.id }), new Promise((r) => setTimeout(r, 1500))]);
      const r = res.reward, color = RARITY_COLOR[r.rarity];
      sfx.reveal(rarityRank(r.rarity)); ctx.lobby.pulse(r.rarity);
      clear(overlay);
      overlay.style.setProperty('--glow', color);
      overlay.classList.add('revealed');
      overlay.append(h('div.burst'), h('div.reward', { class: 'r-' + r.rarity },
        h('small', null, TYPE_ONE[r.type]), rarityTag(r.rarity), h('h2', null, r.name),
        r.extra?.length ? h('ul', null, r.extra.map((id) => h('li', null, '+ ', ATT_BY_ID[id]?.name ?? id))) : null,
        res.duplicate ? h('p.dupe', null, res.refund ? 'Duplicate — refunded ' : 'Duplicate', res.refund ? deyes(res.refund) : null) : h('p.new', null, 'NEW — added to your inventory'),
        h('div.row', null, h('button.btn.primary', { onclick: () => overlay.remove() }, 'Continue'), h('button.btn.ghost', { disabled: res.deyes < b.price, onclick: () => { overlay.remove(); open(b); } }, 'Open another'))));
      setDeyes(res.deyes);
      await refreshMe();
      await render();
    } catch (e) { overlay.remove(); throw e; } finally { busy = false; }
  });
  render().catch(() => {});
}
