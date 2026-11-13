// In-match HUD. Pure DOM over the canvas; the match pushes values into it.
import { RARITY_COLOR, Rarity } from '../../../shared/constants';
import { MODE_BY_ID } from '../../../shared/modes';
import { app } from '../state';
import { clear, clock, h } from './dom';

export interface BoardRow { id: string; name: string; team: number; kills: number; deaths: number; score: number; gg: number; dummy?: boolean }

export class Hud {
  root = document.getElementById('hud')!;
  private cross = h('div.crosshair'); private hit = h('div.hitmarker');
  private hpBar = h('div.hp-fill'); private hpNum = h('div.hp-num');
  private ammo = h('div.ammo'); private wname = h('div.wname'); private other = h('div.wother');
  private top = h('div.hud-top'); private feed = h('div.killfeed'); private msg = h('div.center-msg'); private sub = h('div.sub-msg');
  private vign = h('div.vignette'); private low = h('div.lowhp'); private scope = h('div.scope'); private dmg = h('div.dmg-ind');
  private board = h('div.scoreboard'); private respawn = h('div.respawn'); private obj = h('div.objective'); private fps = h('div.fps'); private pop = h('div.kill-pop'); private flash = h('div.flashbang');
  private msgTimer = 0; private hitTimer = 0; private popTimer = 0;

  constructor() {
    clear(this.root);
    this.root.append(this.vign, this.low, this.scope, this.flash, this.dmg, this.cross, this.hit, this.top, this.feed, this.obj,
      h('div.hud-bl', null, h('div.hp', null, this.hpBar), this.hpNum),
      h('div.hud-br', null, this.wname, this.ammo, this.other), this.msg, this.sub, this.pop, this.respawn, this.board, this.fps);
    for (const d of ['t', 'b', 'l', 'r', 'dot']) this.cross.appendChild(h('i', { class: 'c-' + d }));
    this.applySettings();
  }
  show(on: boolean) { this.root.style.display = on ? 'block' : 'none'; }
  applySettings() {
    const s = app.settings, c = s.crosshair;
    this.root.style.setProperty('--hud-scale', String(s.hud.scale));
    this.root.style.setProperty('--hud-opacity', String(s.hud.opacity));
    this.root.classList.toggle('large-text', s.accessibility.largeText);
    this.root.classList.toggle('high-contrast', s.accessibility.highContrastHud);
    this.cross.dataset.style = c.style;
    const st = this.cross.style;
    st.setProperty('--c-color', c.color); st.setProperty('--c-size', c.size + 'px'); st.setProperty('--c-thick', c.thickness + 'px');
    this.cross.querySelector<HTMLElement>('.c-dot')!.style.display = c.dot || c.style === 'dot' ? 'block' : 'none';
    this.feed.style.display = s.hud.killfeed ? 'flex' : 'none';
    this.fps.style.display = s.hud.fps ? 'block' : 'none';
  }
  /** spread in degrees -> crosshair gap; hidden while aiming down sights or scoped. */
  crosshair(spreadDeg: number, ads: number, scoped: boolean, fovDeg: number) {
    const c = app.settings.crosshair;
    const px = c.dynamic ? (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan((fovDeg * Math.PI) / 360)) * (innerHeight / 2) : 0;
    this.cross.style.setProperty('--c-gap', c.gap + px + 'px');
    this.cross.style.opacity = String(c.style === 'none' ? 0 : Math.max(0, 1 - ads * 1.6));
    this.scope.style.opacity = scoped ? '1' : '0';
  }
  hitmarker(head: boolean, kill: boolean) {
    if (!app.settings.hud.hitmarkers) return;
    this.hit.className = 'hitmarker on' + (kill ? ' kill' : head ? ' head' : '');
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => (this.hit.className = 'hitmarker'), kill ? 260 : 120);
  }
  health(hp: number, protectedSpawn: boolean) {
    this.hpBar.style.width = Math.max(0, hp) + '%';
    this.hpBar.classList.toggle('crit', hp <= 30); this.hpBar.classList.toggle('shield', protectedSpawn);
    this.hpNum.textContent = String(Math.max(0, Math.round(hp)));
    this.low.style.opacity = String(hp <= 35 && hp > 0 ? (35 - hp) / 35 * 0.9 : 0);
  }
  weapon(name: string, rarity: Rarity, ammo: number, mag: number, reloading: boolean, otherName: string | null) {
    this.wname.textContent = name; this.wname.style.color = RARITY_COLOR[rarity];
    clear(this.ammo);
    this.ammo.append(h('b', { class: ammo <= mag * 0.25 ? 'lowammo' : '' }, reloading ? '···' : ammo), h('span', null, ` / ${mag}`));
    this.other.textContent = otherName ? `[Q] ${otherName}` : '';
  }
  topBar(mode: string, timeLeft: number, state: string, info: { teamScores?: number[]; myTeam?: number; limit?: number; lead?: string; mine?: string }) {
    clear(this.top);
    const m = MODE_BY_ID[mode];
    const time = h('div.timer', null, state === 'active' ? clock(timeLeft) : state === 'countdown' ? 'STARTING' : state === 'waiting' ? 'WARM-UP' : '—');
    if (info.teamScores && info.myTeam !== undefined) {
      const mine = info.teamScores[info.myTeam] ?? 0, theirs = info.teamScores[1 - info.myTeam] ?? 0;
      this.top.append(h('div.tscore.ally', null, h('small', null, 'YOUR TEAM'), mine), h('div.tmid', null, h('small', null, m.name.toUpperCase()), time, info.limit ? h('small', null, `FIRST TO ${info.limit}`) : null), h('div.tscore.enemy', null, h('small', null, 'ENEMY'), theirs));
    } else this.top.append(h('div.tscore.ally', null, h('small', null, 'YOU'), info.mine ?? '0'), h('div.tmid', null, h('small', null, m.name.toUpperCase()), time), h('div.tscore.enemy', null, h('small', null, 'LEADER'), info.lead ?? '—'));
  }
  objective(nodes: (Node | string)[]) { clear(this.obj); this.obj.append(...nodes); }
  kill(killer: string | null, victim: string, weapon: string, head: boolean, kind: 'ally' | 'enemy' | 'me' | 'neutral') {
    const row = h('div.kf', { class: kind }, killer ? h('b', null, killer) : null, h('span.kf-w', null, (head ? '◎ ' : '') + weapon), h('b.kf-v', null, victim));
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastChild!.remove();
    setTimeout(() => row.remove(), 6000);
  }
  /** "+100" popup. Deyes shown here are pending: they are only credited when the server settles the match. */
  killPopup(text: string, sub: string) {
    clear(this.pop); this.pop.append(h('b', null, text), h('small', null, sub));
    this.pop.classList.remove('on'); void this.pop.offsetWidth; this.pop.classList.add('on');
    clearTimeout(this.popTimer); this.popTimer = window.setTimeout(() => this.pop.classList.remove('on'), 1800);
  }
  announce(text: string, sub = '', ms = 2500) {
    this.msg.textContent = text; this.sub.textContent = sub;
    this.msg.classList.add('on'); this.sub.classList.add('on');
    clearTimeout(this.msgTimer);
    if (ms) this.msgTimer = window.setTimeout(() => { this.msg.classList.remove('on'); this.sub.classList.remove('on'); }, ms);
  }
  damageFrom(angle: number, amount: number) {
    const a = h('div.dmg-arc', { style: { transform: `rotate(${angle}rad)` } });
    this.dmg.appendChild(a);
    setTimeout(() => a.remove(), 900);
    if (!app.settings.accessibility.reduceFlashes) { this.vign.style.opacity = String(Math.min(0.9, 0.25 + amount / 60)); setTimeout(() => (this.vign.style.opacity = '0'), 120); }
  }
  whiteout(k: number) { this.flash.style.opacity = String(app.settings.accessibility.reduceFlashes ? k * 0.2 : k); }
  respawnIn(sec: number | null, text = 'ELIMINATED') {
    this.respawn.style.display = sec === null ? 'none' : 'flex';
    if (sec !== null) { clear(this.respawn); this.respawn.append(h('b', null, text), h('span', null, sec > 0 ? `Respawning in ${Math.ceil(sec)}` : sec === 0 ? 'Respawning…' : 'Spectating — no respawns in this mode')); }
  }
  scoreboard(show: boolean, rows: BoardRow[], mode: string, me: string, myTeam: number) {
    this.board.style.display = show ? 'block' : 'none';
    if (!show) return;
    clear(this.board);
    const m = MODE_BY_ID[mode];
    const table = (title: string, list: BoardRow[], cls: string) => h('div.sb-team', { class: cls }, h('h4', null, title),
      h('div.sb-row.head', null, h('span', null, 'PLAYER'), h('span', null, mode === 'gungame' ? 'RUNG' : 'SCORE'), h('span', null, 'K'), h('span', null, 'D')),
      list.map((r) => h('div.sb-row', { class: r.id === me ? 'me' : '' }, h('span', null, r.name), h('span', null, mode === 'gungame' ? r.gg + 1 : r.score), h('span', null, r.kills), h('span', null, r.deaths))));
    const sorted = [...rows].filter((r) => !r.dummy).sort((a, b) => (mode === 'gungame' ? b.gg - a.gg : b.score - a.score) || b.kills - a.kills);
    this.board.append(h('h3', null, m.name));
    if (m.teams) this.board.append(h('div.sb-cols', null, table('YOUR TEAM', sorted.filter((r) => r.team === myTeam), 'ally'), table('ENEMY TEAM', sorted.filter((r) => r.team !== myTeam), 'enemy')));
    else this.board.append(table('PLAYERS', sorted, ''));
  }
  setFps(n: number, ping: number) { this.fps.textContent = `${n} FPS · ${ping} ms`; }
}
