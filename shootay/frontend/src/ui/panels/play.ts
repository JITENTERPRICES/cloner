// Game mode selector, matchmaking, private rooms (with shareable invite links) and the room lobby.
import { MAPS, MAP_BY_ID } from '../../../../shared/maps';
import { MODES, MODE_BY_ID, PUBLIC_MODES } from '../../../../shared/modes';
import { sfx } from '../../engine/audio';
import { api, request, socket } from '../../net/net';
import { app, bus } from '../../state';
import { clear, guard, h, toast } from '../dom';
import type { Ctx } from '../shell';

export const selectedMode = () => { const m = localStorage.getItem('shootay.mode'); return m && PUBLIC_MODES.includes(m as any) ? m : 'tdm'; };

let searching: { el: HTMLElement; timer: number } | null = null;
export function stopSearching() { if (searching) { clearInterval(searching.timer); searching.el.remove(); searching = null; } }
/** Quick play: asks the server for a public match of this mode. The whole party goes with the leader. */
export const queue = guard(async (mode: string) => {
  if (searching) return;
  const el = h('div.searching', null, h('div.radar'), h('b', null, 'FINDING A MATCH'), h('span', null, MODE_BY_ID[mode].name), h('button.btn.ghost', { onclick: () => { stopSearching(); socket?.emit('room:leave'); } }, 'Cancel'));
  document.getElementById('ui')!.appendChild(el);
  sfx.searching();
  searching = { el, timer: window.setInterval(() => sfx.searching(), 1600) };
  try { await request('mm:join', { mode }); } catch (e) { stopSearching(); throw e; }
  // success: the server sends match:init, which tears this overlay down
});

export function modesPanel(body: HTMLElement) {
  const sel = selectedMode();
  body.append(h('p.lead', null, 'Pick a mode. PLAY always queues the one selected here.'),
    h('div.grid.modes', null, MODES.map((m) => h('div.card.mode', { class: m.id === sel ? 'selected' : '' },
      h('h3', null, m.name), h('p', null, m.desc),
      h('ul', null, m.rules.map((r) => h('li', null, r))),
      h('div.meta', null, `Up to ${m.maxPlayers} players`, m.rewards ? null : ' · no rewards'),
      m.id === 'training'
        ? h('button.btn', { onclick: guard(() => request('room:create', { mode: 'training', map: MAPS[0].id })) }, 'Enter range')
        : h('div.row', null,
          h('button.btn.primary', { onclick: () => { localStorage.setItem('shootay.mode', m.id); queue(m.id); } }, 'Play'),
          m.id === sel ? h('span.tag', null, 'SELECTED') : h('button.btn.ghost', { onclick: () => { localStorage.setItem('shootay.mode', m.id); clear(body); modesPanel(body); bus.emit('mode'); } }, 'Set as default'))))));
}

export function multiplayerPanel(body: HTMLElement) {
  const mode = h('select', null, MODES.filter((m) => m.id !== 'training').map((m) => h('option', { value: m.id }, m.name)));
  const map = h('select', null, MAPS.map((m) => h('option', { value: m.id }, m.name)));
  const code = h('input', { placeholder: 'ROOM CODE', maxLength: 6, autocapitalize: 'characters', spellcheck: false }) as HTMLInputElement;
  const list = h('div.list');
  const loadRooms = guard(async () => {
    const rooms: any[] = await request('rooms:list');
    clear(list);
    if (!rooms.length) list.append(h('p.muted', null, 'No open matches right now. Queue with PLAY to start one.'));
    for (const r of rooms) list.append(h('div.item', null,
      h('div', null, h('b', null, MODE_BY_ID[r.mode].name), h('small', null, `${MAP_BY_ID[r.map].name} · ${r.custom ? 'custom room' : 'matchmaking'} · ${r.state}`)),
      h('span.tag', null, `${r.players}/${r.max}`),
      h('button.btn.small', { onclick: guard(() => request('room:join', { code: r.code })) }, 'Join')));
  });
  body.append(
    h('section', null, h('h3', null, 'Private match'), h('p.muted', null, 'Create a room, then share its invite link. You control mode, map, teams and limits.'),
      h('div.form', null, h('label', null, 'Mode', mode), h('label', null, 'Map', map)),
      h('button.btn.primary', { onclick: guard(() => request('room:create', { mode: (mode as HTMLSelectElement).value, map: (map as HTMLSelectElement).value })) }, 'Create private room')),
    h('section', null, h('h3', null, 'Join with a code'),
      h('div.row', null, code, h('button.btn', { onclick: guard(async () => { await request('room:join', { code: code.value.trim().toUpperCase() }); }) }, 'Join'))),
    h('section', null, h('div.row.between', null, h('h3', null, 'Open matches'), h('button.btn.small.ghost', { onclick: loadRooms }, 'Refresh')), list));
  loadRooms();
}

/** Private-room lobby. Re-rendered every time the server broadcasts room state. */
export function roomPanel(body: HTMLElement, ctx: Ctx, room: any) {
  const me = app.user!.id, host = room.host === me, cfg = room.config, mode = MODE_BY_ID[cfg.mode];
  const link = `${location.origin}/join/${room.code}`;
  const set = (patch: object) => socket?.emit('room:config', patch);
  const sel = (label: string, value: string | number, opts: [string | number, string][], key: string, conv: (v: string) => unknown = (v) => v) =>
    h('label', null, label, h('select', { disabled: !host, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; set({ [key]: conv(v) }); } },
      opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
  const maxOpts = Array.from({ length: mode.maxPlayers - mode.minPlayers + 1 }, (_, i) => [mode.minPlayers + i, `${mode.minPlayers + i} players`] as [number, string]);
  const scoreOpts = ({ tdm: [10, 20, 30, 50, 75], ffa: [10, 15, 20, 30], dom: [50, 100, 150, 200] } as Record<string, number[]>)[cfg.mode];
  const team = (t: number, title: string) => h('div.team', { class: t === 0 ? 'ally' : t === 1 ? 'enemy' : '' }, h('h4', null, title),
    room.players.filter((p: any) => (mode.teams ? p.team === t : true)).map((p: any) => h('div.item', null,
      h('div', null, h('b', null, p.name), h('small', null, `Level ${p.level}${p.id === room.host ? ' · HOST' : ''}`)),
      mode.teams && (host || (p.id === me && cfg.teamSelect)) ? h('button.btn.small.ghost', { onclick: () => socket?.emit('room:team', { userId: p.id, team: 1 - t }) }, 'Switch team') : null,
      host && p.id !== me ? h('button.btn.small.danger', { onclick: () => socket?.emit('room:kick', { userId: p.id }) }, 'Kick') : null)),
    mode.teams && cfg.teamSelect && !room.players.some((p: any) => p.id === me && p.team === t) ? h('button.btn.small', { onclick: () => socket?.emit('room:team', { team: t }) }, 'Join this team') : null);
  const friends = h('div.list');
  api('/friends').then((fs: any[]) => {
    const online = fs.filter((f) => f.state === 'friend' && f.status !== 'offline' && !room.players.some((p: any) => p.id === f.id));
    if (!online.length) friends.append(h('p.muted', null, 'No friends online to invite. Send them the link instead.'));
    for (const f of online) friends.append(h('div.item', null, h('b', null, f.username), h('button.btn.small', { onclick: guard(async () => { await request('invite:room', { userId: f.id }); toast(`Invite sent to ${f.username}`, 'good'); }) }, 'Invite')));
  }).catch(() => {});

  body.append(
    h('section.roomhead', null,
      h('div', null, h('small', null, 'ROOM CODE'), h('div.code', null, room.code)),
      h('div.invite', null, h('input', { readOnly: true, value: link, onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
        h('button.btn.primary', { id: 'copy-invite', onclick: guard(async () => {
          try { await navigator.clipboard.writeText(link); toast('Invite link copied', 'good'); }
          catch { const i = body.querySelector<HTMLInputElement>('.invite input')!; i.select(); document.execCommand('copy'); toast('Invite link copied', 'good'); }
        }) }, 'COPY INVITE LINK'))),
    h('section', null, h('h3', null, host ? 'Match settings' : 'Match settings (host only)'),
      h('div.form', null,
        sel('Game mode', cfg.mode, MODES.filter((m) => m.id !== 'training').map((m) => [m.id, m.name]), 'mode'),
        sel('Map', cfg.map, MAPS.map((m) => [m.id, m.name]), 'map'),
        sel('Player limit', cfg.maxPlayers, maxOpts, 'maxPlayers', Number),
        sel('Time limit', cfg.timeLimit, [[180, '3 minutes'], [300, '5 minutes'], [480, '8 minutes'], [600, '10 minutes'], [900, '15 minutes']] as [number, string][], 'timeLimit', Number),
        scoreOpts ? sel('Score limit', cfg.scoreLimit, [...new Set([...scoreOpts, cfg.scoreLimit])].sort((a, b) => a - b).map((v) => [v, String(v)]), 'scoreLimit', Number) : null,
        sel('Room privacy', cfg.privacy, [['invite', 'Invite only (link or code)'], ['public', 'Public (listed in Open matches)']], 'privacy'),
        mode.teams ? sel('Team selection', cfg.teamSelect ? '1' : '0', [['1', 'Players pick their team'], ['0', 'Host assigns teams']], 'teamSelect', (v) => v === '1') : null),
      h('p.muted', null, mode.desc + ' ' + mode.rules.join(' · '))),
    h('section', null, h('h3', null, `Players ${room.players.length}/${cfg.maxPlayers}`),
      mode.teams ? h('div.teams', null, team(0, 'TEAM A'), team(1, 'TEAM B')) : team(-1, 'ALL PLAYERS')),
    h('section', null, h('h3', null, 'Invite friends'), friends),
    h('div.row.sticky', null,
      host ? h('button.btn.primary.big', { onclick: guard(async () => { const r = await request('room:start'); if (r?.error) throw new Error(r.error); }) }, 'START MATCH')
        : h('span.muted', null, 'Waiting for the host to start…'),
      h('button.btn.ghost', { onclick: () => { socket?.emit('room:leave'); ctx.leaveRoom(); } }, 'Leave room')));
}
