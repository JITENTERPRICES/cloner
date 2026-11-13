// Daily missions, friends + party, and player profiles.
import { levelFromXp, xpForLevel } from '../../../../shared/constants';
import { MAP_BY_ID } from '../../../../shared/maps';
import { MODE_BY_ID } from '../../../../shared/modes';
import { WEAPON_BY_ID } from '../../../../shared/weapons';
import { sfx } from '../../engine/audio';
import { api, request, socket } from '../../net/net';
import { app, bus, setDeyes } from '../../state';
import { clear, deyes, fmt, guard, h, toast } from '../dom';
import type { Ctx } from '../shell';

export function missionsPanel(body: HTMLElement) {
  let timer = 0;
  const render = async () => {
    const d: { missions: any[]; resetsIn: number } = await api('/missions');
    clear(body);
    const end = Date.now() + d.resetsIn * 1000, reset = h('b', null, '');
    const tick = () => { const s = Math.max(0, (end - Date.now()) / 1000); reset.textContent = `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`; };
    tick(); clearInterval(timer); timer = window.setInterval(tick, 30000);
    body.append(h('div.row.between', null, h('p.lead', null, 'Three missions a day, drawn from a library of 6,000.'), h('div.reset', null, 'New missions in ', reset)),
      ...d.missions.map((m) => h('div.card.mission', { class: m.difficulty + (m.complete ? ' complete' : '') },
        h('div.row.between', null, h('span.tag', null, m.difficulty.toUpperCase()), deyes(m.reward)),
        h('h3', null, m.title),
        h('div.progress', null, h('i', { style: { width: (m.progress / m.target) * 100 + '%' } })),
        h('div.row.between', null, h('small', null, `${fmt(m.progress)} / ${fmt(m.target)}`),
          m.claimed ? h('span.tag.good', null, 'CLAIMED')
            : m.complete ? h('button.btn.primary.small', { onclick: guard(async () => { const r = await api('/missions/claim', { missionId: m.id }); setDeyes(r.deyes); sfx.ui('buy'); toast(`Mission reward: +${r.reward} Deyes`, 'good'); await render(); }) }, 'Claim reward')
              : h('small.muted', null, 'Progress updates when a match ends')))),
      h('p.fine', null, 'Progress is tracked by the server from completed matches. Leaving early forfeits that match’s progress. Private and public matches both count; the Training Range does not.'));
  };
  render().catch((e) => body.append(h('p.muted', null, e.message)));
  return () => clearInterval(timer);
}

export function friendsPanel(body: HTMLElement, ctx: Ctx) {
  const name = h('input', { placeholder: 'Username', maxLength: 16 }) as HTMLInputElement;
  const lists = h('div');
  const render = guard(async () => {
    const fs: any[] = await api('/friends');
    clear(lists);
    const p = app.party;
    lists.append(h('section', null, h('h3', null, 'Party'),
      p ? h('div', null, p.members.map((m) => h('div.item', null, h('b', null, m.name), m.id === p.leader ? h('span.tag', null, 'LEADER') : null)),
        h('p.muted', null, 'When the leader joins a match, the whole party follows.'), h('button.btn.small.ghost', { onclick: () => socket?.emit('party:leave') }, 'Leave party'))
        : h('p.muted', null, 'Invite an online friend to start a party.')));
    const incoming = fs.filter((f) => f.state === 'incoming');
    if (incoming.length) lists.append(h('section', null, h('h3', null, 'Friend requests'), incoming.map((f) => h('div.item', null, h('b', null, f.username),
      h('button.btn.small.primary', { onclick: guard(async () => { await api('/friends/respond', { userId: Number(f.id), accept: true }); render(); }) }, 'Accept'),
      h('button.btn.small.ghost', { onclick: guard(async () => { await api('/friends/respond', { userId: Number(f.id), accept: false }); render(); }) }, 'Decline')))));
    const friends = fs.filter((f) => f.state === 'friend').sort((a, b) => Number(b.status !== 'offline') - Number(a.status !== 'offline'));
    lists.append(h('section', null, h('h3', null, `Friends (${friends.filter((f) => f.status !== 'offline').length} online / ${friends.length})`),
      friends.length ? null : h('p.muted', null, 'No friends yet. Add someone by username above.'),
      friends.map((f) => h('div.item', null,
        h('i.status', { class: f.status }), h('div', null, h('b', null, f.username), h('small', null, `Level ${f.level} · ${f.status === 'in-match' ? 'In a match' : f.status === 'online' ? 'Online' : 'Offline'}`)),
        f.status !== 'offline' ? h('button.btn.small', { onclick: guard(async () => { await request('party:invite', { userId: f.id }); toast(`Party invite sent to ${f.username}`, 'good'); }) }, 'Invite to party') : null,
        h('button.btn.small.ghost', { onclick: () => ctx.open('profile', f.username) }, 'Profile'),
        h('button.btn.small.danger', { onclick: guard(async () => { await api('/friends/' + f.id, undefined, 'DELETE'); render(); }) }, 'Remove')))));
    const sent = fs.filter((f) => f.state === 'sent');
    if (sent.length) lists.append(h('section', null, h('h3', null, 'Sent requests'), sent.map((f) => h('div.item', null, h('b', null, f.username), h('small.muted', null, 'Pending')))));
  });
  body.append(h('section', null, h('h3', null, 'Add a friend'), h('div.row', null, name, h('button.btn.primary', { onclick: guard(async () => {
    const r = await api('/friends/request', { username: name.value.trim() }); toast(r.state === 'friend' ? 'You are now friends' : 'Friend request sent', 'good'); name.value = ''; render();
  }) }, 'Send request'))), lists);
  render();
  const offs = [bus.on('net:friends:changed', render), bus.on('party', render)];
  return () => offs.forEach((o) => o());
}

export function profilePanel(body: HTMLElement, _ctx: Ctx, username?: string) {
  const mine = !username || username === app.user!.username;
  const render = async () => {
    const p: any = await api('/profile/' + encodeURIComponent(username ?? app.user!.username));
    clear(body);
    body.append(h('div.profile-head', null, h('div.avatar-badge', null, p.username.slice(0, 2).toUpperCase()), h('div', null, h('h2', null, p.username), h('small', null, `Level ${p.level} · ${p.status === 'offline' ? 'Offline' : p.status === 'in-match' ? 'In a match' : 'Online'}`))));
    if (p.private) { body.append(h('p.muted', null, 'This profile is private.')); return; }
    if (mine) {
      const u = app.user!, lvl = levelFromXp(u.xp), a = xpForLevel(lvl), b = xpForLevel(lvl + 1);
      body.append(h('div.xp', null, h('div.row.between', null, h('small', null, `Level ${lvl}`), h('small', null, `${fmt(u.xp - a)} / ${fmt(b - a)} XP`)), h('div.progress', null, h('i', { style: { width: ((u.xp - a) / (b - a)) * 100 + '%' } }))));
    }
    const s = p.stats, kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
    const tile = (v: string | number, l: string) => h('div.tile', null, h('b', null, v), h('small', null, l));
    body.append(h('div.grid.tiles', null, tile(fmt(s.kills), 'Eliminations'), tile(kd, 'K/D ratio'), tile(fmt(s.wins), 'Wins'), tile(fmt(s.matches), 'Matches'), tile(fmt(s.headshots), 'Headshots'), tile(s.matches ? Math.round((s.wins / s.matches) * 100) + '%' : '—', 'Win rate')),
      h('section', null, h('h3', null, 'Loadout'), h('div.item', null, h('b', null, WEAPON_BY_ID[p.loadout.primary.weapon].name), h('small', null, `Primary · ${p.loadout.primary.atts.length} attachments`)), h('div.item', null, h('b', null, WEAPON_BY_ID[p.loadout.secondary.weapon].name), h('small', null, `Secondary · ${p.loadout.secondary.atts.length} attachments`))),
      h('section', null, h('h3', null, 'Collection'), h('div.grid.tiles', null, tile(p.collection.weapons, 'Weapons'), tile(p.collection.attachments, 'Attachments'), tile(p.collection.clothing, 'Clothing'), tile(p.collection.skins, 'Skins'), tile(p.collection.effects, 'Effects'))),
      h('section', null, h('h3', null, 'Recent matches'), p.recent.length ? p.recent.map((m: any) => h('div.item', null, h('span.tag', { class: m.won ? 'good' : '' }, m.won ? 'WIN' : 'LOSS'), h('div', null, h('b', null, MODE_BY_ID[m.mode]?.name ?? m.mode), h('small', null, MAP_BY_ID[m.map]?.name ?? m.map)), h('span', null, `${m.kills} / ${m.deaths}`), deyes(m.deyes, 'small'))) : h('p.muted', null, 'No completed matches yet.')));
    if (mine) {
      const tx: any[] = await api('/transactions');
      const reason: Record<string, string> = { welcome: 'Welcome bonus', match: 'Match eliminations', mission: 'Mission reward', box: 'Mystery box', box_dupe: 'Duplicate refund', purchase: 'Store purchase' };
      body.append(h('section', null, h('h3', null, 'Deyes ledger'), tx.map((t) => h('div.item', null, h('div', null, h('b', null, reason[t.reason] ?? t.reason), h('small', null, new Date(t.created_at).toLocaleString())), h('span', { class: t.amount >= 0 ? 'good' : 'bad' }, (t.amount >= 0 ? '+' : '') + fmt(t.amount)), h('small.muted', null, `→ ${fmt(t.balance_after)}`)))));
    }
  };
  render().catch((e) => { clear(body); body.append(h('p.muted', null, e.message)); });
}
