// Lobby shell: top bar, navigation, slide-in panels, news, music player, party chip, auth screen.
import { levelFromXp, xpForLevel } from '../../../shared/constants';
import { MODE_BY_ID } from '../../../shared/modes';
import { music, sfx, unlockAudio } from '../engine/audio';
import { api, request, saveSettings, signIn, socket } from '../net/net';
import { app, bus } from '../state';
import { clear, deyes, guard, h, toast } from './dom';
import { Lobby3D } from './lobby3d';
import { weaponsPanel } from './panels/armory';
import { modesPanel, multiplayerPanel, queue, roomPanel, selectedMode } from './panels/play';
import { settingsPanel } from './panels/settings';
import { friendsPanel, missionsPanel, profilePanel } from './panels/social';
import { boxesPanel } from './panels/store';
import { clothingPanel, operatorsPanel } from './panels/wardrobe';

export interface Ctx { lobby: Lobby3D; open(id: string, arg?: any): void; close(): void; leaveRoom(): void }
type Panel = (body: HTMLElement, ctx: Ctx, arg?: any) => void | (() => void);
const PANELS: Record<string, { title: string; fn: Panel; wide?: boolean }> = {
  modes: { title: 'Game Modes', fn: modesPanel }, multiplayer: { title: 'Multiplayer', fn: multiplayerPanel },
  weapons: { title: 'Weapons', fn: weaponsPanel }, operators: { title: 'Operators', fn: operatorsPanel }, clothing: { title: 'Clothing', fn: clothingPanel },
  boxes: { title: 'Mystery Boxes', fn: boxesPanel, wide: true }, missions: { title: 'Daily Missions', fn: missionsPanel }, friends: { title: 'Friends', fn: friendsPanel },
  profile: { title: 'Player Profile', fn: profilePanel }, settings: { title: 'Settings', fn: (b) => settingsPanel(b) }, room: { title: 'Private Room', fn: roomPanel, wide: true },
};
const NAV: [string, string][] = [['multiplayer', 'Multiplayer'], ['modes', 'Game Modes'], ['weapons', 'Weapons'], ['operators', 'Operators'], ['clothing', 'Clothing'], ['boxes', 'Mystery Boxes'], ['missions', 'Daily Missions'], ['friends', 'Friends'], ['profile', 'Player Profile'], ['settings', 'Settings']];

export class Shell {
  root = document.getElementById('ui')!;
  private panel: HTMLElement | null = null; private cleanup: (() => void) | void = undefined; private current: string | null = null;
  private room: any = null;
  ctx: Ctx;
  private offs: (() => void)[] = [];

  constructor(public lobby: Lobby3D) {
    this.ctx = { lobby, open: (id, arg) => this.open(id, arg), close: () => this.close(), leaveRoom: () => { this.room = null; this.close(); } };
    bus.on('net:room:state', (r) => { this.room = r; if (this.visible) this.open('room', r); });
    bus.on('net:room:kicked', () => { this.room = null; this.close(); toast('You were removed from the room', 'error'); });
    bus.on('net:invite', (m: any) => {
      sfx.ui('buy');
      if (m.kind === 'party') toast(`${m.from} invited you to their party`, 'info', { label: 'Join party', fn: guard(() => request('party:accept', { partyId: m.partyId })) });
      else toast(`${m.from} invited you to ${m.mode}`, 'info', { label: 'Join', fn: guard(() => request('room:join', { code: m.code })) });
    });
    bus.on('net:party:follow', guard(async (m: any) => { toast('Following your party leader…'); await request('room:join', { code: m.code }); }));
    bus.on('net:friends:changed', (m: any) => { if (m?.from) toast(`${m.from} sent you a friend request`, 'info', { label: 'View', fn: () => this.open('friends') }); });
  }
  get visible() { return this.root.dataset.screen === 'lobby'; }
  get inRoom() { return !!this.room; }
  clearRoom() { this.room = null; }

  // ───────────── auth ─────────────
  showAuth() {
    this.teardown();
    this.root.dataset.screen = 'auth';
    let mode: 'login' | 'register' = 'login';
    const user = h('input', { placeholder: 'Username', autocomplete: 'username', maxLength: 16 }) as HTMLInputElement;
    const pass = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', maxLength: 72 }) as HTMLInputElement;
    const err = h('p.err'), submit = h('button.btn.primary.big', { type: 'submit' }, 'Sign in'), swap = h('button.link', { type: 'button' }, 'New here? Create an account');
    swap.addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; submit.textContent = mode === 'login' ? 'Sign in' : 'Create account'; swap.textContent = mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'; err.textContent = ''; });
    const form = h('form.auth-card', { onsubmit: (e: Event) => {
      e.preventDefault(); unlockAudio(); err.textContent = ''; (submit as HTMLButtonElement).disabled = true;
      signIn(mode, user.value.trim(), pass.value).catch((ex) => { err.textContent = ex.message; sfx.ui('error'); }).finally(() => ((submit as HTMLButtonElement).disabled = false));
    } },
      h('h1.logo', null, 'SHOOTAY'), h('p.tag-line', null, 'BUILD DIFFERENT. SHOOT DIFFERENT.'),
      app.pendingJoin ? h('p.invite-note', null, 'You have been invited to private room ', h('b', null, app.pendingJoin), '. Sign in and you will be dropped straight into it.') : null,
      user, pass, err, submit, swap,
      h('p.fine', null, 'Usernames: 3–16 letters, numbers or underscores. Passwords: 8+ characters. Online multiplayer — play fair.'));
    this.root.append(h('div.auth', null, form));
  }

  // ───────────── lobby ─────────────
  showLobby() {
    this.teardown();
    this.root.dataset.screen = 'lobby';
    const u = () => app.user!;
    const bal = h('div.bal'), who = h('div.who'), online = h('div.online'), party = h('div.party'), playMode = h('small');
    const renderUser = () => {
      if (!app.user) return;
      clear(bal); bal.append(deyes(u().deyes, 'big'));
      const lvl = levelFromXp(u().xp), a = xpForLevel(lvl), b = xpForLevel(lvl + 1);
      clear(who); who.append(h('button.name', { onclick: () => this.open('profile') }, u().username), h('div.lvl', null, h('span', null, `LVL ${lvl}`), h('div.progress', null, h('i', { style: { width: ((u().xp - a) / (b - a)) * 100 + '%' } }))));
    };
    const renderOnline = () => { clear(online); online.append(h('i.status.online'), `${app.online} online`); };
    const renderParty = () => { clear(party); if (app.party) party.append(h('small', null, 'PARTY'), ...app.party.members.map((m) => h('span.chip', { class: m.id === app.party!.leader ? 'on' : '' }, m.name)), h('button.link', { onclick: () => socket?.emit('party:leave') }, 'Leave')); party.style.display = app.party ? 'flex' : 'none'; };
    const renderMode = () => (playMode.textContent = MODE_BY_ID[selectedMode()].name);
    renderUser(); renderOnline(); renderParty(); renderMode();
    this.offs.push(bus.on('user', renderUser), bus.on('online', renderOnline), bus.on('party', renderParty), bus.on('mode', renderMode));

    const news = h('div.news', null, h('h5', null, 'NEWS & SEASON'));
    api('/news').then((rows: any[]) => rows.slice(0, 3).forEach((n) => news.append(h('div.news-item', null, h('span.tag', null, n.tag), h('b', null, n.title), h('p', null, n.body))))).catch(() => {});

    this.root.append(
      h('header.topbar', null, h('div.brand', null, h('div.logo', null, 'SHOOTAY'), h('div.tag-line', null, 'BUILD DIFFERENT. SHOOT DIFFERENT.')), h('div.top-right', null, online, bal, who)),
      h('nav.nav', null,
        h('button.play', { onclick: () => { unlockAudio(); this.room ? this.open('room', this.room) : queue(selectedMode()); } }, h('b', null, 'PLAY'), playMode),
        NAV.map(([id, label]) => h('button.nav-item', { 'data-nav': id, onclick: () => { unlockAudio(); this.open(id); } }, label))),
      h('div.stage-hint', null, h('span', null, 'Drag to rotate · scroll to zoom'), h('button.btn.small.ghost', { onclick: () => this.lobby.inspectHeld() }, 'Inspect weapon')),
      news, party, this.musicPlayer());
    if (this.room) this.open('room', this.room);
  }

  private musicPlayer() {
    const title = h('b'), sub = h('small'), bar = h('i'), playBtn = h('button.mbtn', { title: 'Play / pause', onclick: () => { unlockAudio(); music.toggle(); } }, '▶');
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, title: 'Music volume', oninput: (e: Event) => { app.settings.audio.music = Number((e.target as HTMLInputElement).value); app.settings.audio.musicMuted = false; saveSettings(); } }) as HTMLInputElement;
    const mute = h('button.mbtn', { title: 'Mute', onclick: () => { app.settings.audio.musicMuted = !app.settings.audio.musicMuted; saveSettings(); } }, '🔊');
    const shuffle = h('button.mbtn', { title: 'Shuffle', onclick: () => { app.settings.audio.shuffle = !app.settings.audio.shuffle; saveSettings(); } }, '⤨');
    const repeat = h('button.mbtn', { title: 'Repeat', onclick: () => { const a = app.settings.audio; a.repeat = a.repeat === 'all' ? 'one' : a.repeat === 'one' ? 'off' : 'all'; saveSettings(); } }, '↻');
    const list = h('div.tracks');
    const el = h('div.music', null,
      h('div.m-info', null, title, sub, h('div.progress.seek', { onclick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); music.seek((e.clientX - r.left) / r.width); } }, bar)),
      h('div.m-ctl', null, h('button.mbtn', { title: 'Previous', onclick: () => music.prev() }, '⏮'), playBtn, h('button.mbtn', { title: 'Next', onclick: () => music.next() }, '⏭'), shuffle, repeat, mute, vol,
        h('button.mbtn', { title: 'Tracks', onclick: () => el.classList.toggle('open') }, '☰')), list);
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const render = () => {
      const a = app.settings.audio;
      el.classList.toggle('missing', music.status !== 'ready');
      if (music.status !== 'ready') {
        title.textContent = music.status === 'loading' ? 'Loading soundtrack…' : 'Soundtrack not installed';
        sub.textContent = music.status === 'loading' ? '' : 'Waiting for the four supplied tracks (255, 257, 221, 201). No substitute music is used.';
      } else {
        title.textContent = music.current.title; sub.textContent = `${music.index + 1} / ${music.tracks.length} · ${fmt(music.time)} / ${fmt(music.duration)}`;
        bar.style.width = (music.duration ? (music.time / music.duration) * 100 : 0) + '%';
      }
      playBtn.textContent = music.playing ? '⏸' : '▶';
      mute.textContent = a.musicMuted ? '🔇' : '🔊'; mute.classList.toggle('on', a.musicMuted);
      shuffle.classList.toggle('on', a.shuffle); repeat.classList.toggle('on', a.repeat !== 'off'); repeat.textContent = a.repeat === 'one' ? '↻1' : '↻';
      if (document.activeElement !== vol) vol.value = String(a.music);
      if (list.childElementCount !== music.tracks.length) { clear(list); music.tracks.forEach((t, i) => list.append(h('button.track', { onclick: () => { unlockAudio(); music.select(i); } }, `${i + 1}. ${t.title}`))); }
      [...list.children].forEach((c, i) => c.classList.toggle('on', i === music.index));
    };
    render();
    this.offs.push(bus.on('music', render), bus.on('settings', render));
    return el;
  }

  open(id: string, arg?: any) {
    const def = PANELS[id]; if (!def) return;
    this.closePanelOnly();
    this.current = id;
    const body = h('div.panel-body');
    this.panel = h('aside.panel', { class: def.wide ? 'wide' : '' }, h('header', null, h('h2', null, def.title), h('button.close', { onclick: () => { if (id === 'room') { socket?.emit('room:leave'); this.room = null; } this.close(); } }, id === 'room' ? 'Leave' : 'Close')), body);
    this.root.append(this.panel);
    this.lobby.shift = 1;
    this.root.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('on', (n as HTMLElement).dataset.nav === id));
    this.cleanup = def.fn(body, this.ctx, arg);
  }
  private closePanelOnly() { if (typeof this.cleanup === 'function') this.cleanup(); this.cleanup = undefined; this.panel?.remove(); this.panel = null; this.current = null; }
  close() { this.closePanelOnly(); this.lobby.shift = 0; this.lobby.showCharacter(); this.root.querySelectorAll('.nav-item.on').forEach((n) => n.classList.remove('on')); sfx.ui('back'); }

  /** Hides all lobby UI (while a match is on screen). */
  hide() { this.teardown(); this.root.dataset.screen = 'match'; }
  private teardown() {
    this.closePanelOnly(); this.offs.forEach((o) => o()); this.offs = [];
    this.lobby.shift = 0; this.lobby.showCharacter();
    clear(this.root);
  }
}
