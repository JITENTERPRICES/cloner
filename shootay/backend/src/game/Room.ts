// One room = one authoritative match simulation. Clients send inputs/intent; this class decides
// what actually happened (hits, damage, eliminations, objectives, who won).
import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { config } from '../config';
import { finalizeMatch, PlayerResult } from './rewards';
import { Loadout } from '../account';
import { WeaponStats, computeStats, damageAt } from '../../../shared/attachments';
import { Outfit } from '../../../shared/clothing';
import { F_ADS, F_CROUCH, F_SLIDE, HITBOX, MAX_HP, PHYS, RESPAWN_TIME, SPAWN_PROTECT, TICK_RATE } from '../../../shared/constants';
import { BARREL_SIZE, MAPS, MAP_BY_ID, MapDef, mapColliderBoxes } from '../../../shared/maps';
import { KillRec } from '../../../shared/missions';
import { MODE_BY_ID, ModeDef, RoomConfig } from '../../../shared/modes';
import { Box6, Collider, V3, rayBox } from '../../../shared/physics';
import { GUN_GAME_LADDER, WEAPON_BY_ID, WeaponCat } from '../../../shared/weapons';

type State = 'lobby' | 'waiting' | 'countdown' | 'active' | 'ended';
interface Slot { weapon: string; atts: string[]; skin: string | null; stats: WeaponStats; ammo: number }
export interface RP {
  id: number; name: string; socket: Socket | null; dummy: boolean; team: number; level: number;
  outfit: Outfit; fx: { tracer: string | null; kill: string | null }; base: Loadout;
  slots: Slot[]; slot: number;
  pos: V3; yaw: number; pitch: number; flags: number;
  hp: number; alive: boolean; respawnAt: number; protectUntil: number; lastHurt: number; lastShot: number; reloadUntil: number;
  kills: number; deaths: number; score: number; streak: number; maxStreak: number; captures: number; gg: number; placement: number;
  killRecs: KillRec[]; killsByVictim: Map<number, number>; damage: Map<string, number>;
  hist: { t: number; p: V3; c: boolean }[]; lastState: number; ping: number; strikes: number; joinedMatch: boolean;
}
export interface JoinData { id: number; name: string; level: number; outfit: Outfit; fx: RP['fx']; loadout: Loadout }

const now = () => Date.now();
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const vec = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every(fin);
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class Room {
  state: State;
  players = new Map<number, RP>();
  banned = new Set<number>();
  map!: MapDef;
  mode!: ModeDef;
  collider!: Collider;
  nWorld = 0;
  barrels: { hp: number; respawnAt: number }[] = [];
  zones: { owner: number; prog: number; team: number }[] = [];
  teamScores = [0, 0];
  br = { x: 0, z: 0, r: 999, r0: 999 };
  matchId = '';
  startedAt = 0; endsAt = 0; countdownAt = 0; resetAt = 0; lastDomScore = 0; lastTick = now(); lastRoster = 0;
  participants = new Set<number>();
  private timer: NodeJS.Timeout;
  private dummySeq = -1;
  onEmpty: () => void = () => {};

  constructor(private io: Server, public code: string, public cfg: RoomConfig, public isPrivate: boolean, public hostId: number) {
    this.state = isPrivate ? 'lobby' : 'waiting';
    this.setup();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }
  get channel() { return 'room:' + this.code; }
  humans() { return [...this.players.values()].filter((p) => !p.dummy); }
  destroy() { clearInterval(this.timer); }

  /** (Re)builds per-match world state from the room config. */
  private setup() {
    this.mode = MODE_BY_ID[this.cfg.mode];
    this.map = MAP_BY_ID[this.cfg.map] ?? MAPS[0];
    const boxes = mapColliderBoxes(this.map);
    this.nWorld = this.map.boxes.length;
    this.collider = new Collider(boxes);
    this.barrels = this.map.barrels.map(() => ({ hp: 40, respawnAt: 0 }));
    this.zones = this.map.zones.map(() => ({ owner: -1, prog: 0, team: -1 }));
    this.teamScores = [0, 0];
    this.participants.clear();
    for (const p of [...this.players.values()]) if (p.dummy) this.players.delete(p.id);
    if (this.mode.id === 'training') this.addDummies();
  }

  // ───────────── membership ─────────────
  join(socket: Socket, d: JoinData): string | null {
    if (this.banned.has(d.id)) return 'You were removed from this room';
    if (this.humans().length >= this.cfg.maxPlayers) return 'Room is full';
    if (this.state === 'active' && !this.mode.lateJoin) return 'Match already in progress';
    if (this.state === 'ended') return 'Match is finishing — try again in a moment';
    const p: RP = {
      id: d.id, name: d.name, socket, dummy: false, team: -1, level: d.level, outfit: d.outfit, fx: d.fx, base: d.loadout,
      slots: [], slot: 0, pos: [0, 0, 0], yaw: 0, pitch: 0, flags: 0,
      hp: MAX_HP, alive: false, respawnAt: 0, protectUntil: 0, lastHurt: 0, lastShot: 0, reloadUntil: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, maxStreak: 0, captures: 0, gg: 0, placement: 0,
      killRecs: [], killsByVictim: new Map(), damage: new Map(), hist: [], lastState: now(), ping: 80, strikes: 0, joinedMatch: false,
    };
    if (this.mode.teams) p.team = this.smallerTeam();
    this.players.set(p.id, p);
    socket.join(this.channel);
    if (this.state === 'lobby') this.sendLobby();
    else {
      this.enterMatch(p);
      this.sendRoster(true);
    }
    return null;
  }
  leave(userId: number) {
    const p = this.players.get(userId);
    if (!p) return;
    p.socket?.leave(this.channel);
    this.players.delete(userId);
    if (this.state === 'active' && this.mode.id === 'br' && p.alive) this.io.to(this.channel).emit('ev', { k: 'left', id: String(p.id) });
    const humans = this.humans();
    if (!humans.length) return this.onEmpty();
    if (this.hostId === userId) this.hostId = humans[0].id;
    if (this.state === 'lobby') this.sendLobby(); else this.sendRoster(true);
  }
  private smallerTeam() {
    const n = [0, 0];
    for (const p of this.players.values()) if (p.team >= 0) n[p.team]++;
    return n[0] <= n[1] ? 0 : 1;
  }
  private addDummies() {
    const pts = [...this.map.spawns.b, ...this.map.zones.map((z) => [z.p[0] + 2, z.p[1] + 0.05, z.p[2] + 2] as V3)];
    for (const pos of pts.slice(0, 8)) {
      const id = this.dummySeq--;
      const stats = computeStats(WEAPON_BY_ID.g17, []);
      this.players.set(id, {
        id, name: 'Target', socket: null, dummy: true, team: -1, level: 1, outfit: { operator: 'op_mourn' }, fx: { tracer: null, kill: null }, base: null as any,
        slots: [{ weapon: 'g17', atts: [], skin: null, stats, ammo: 0 }], slot: 0, pos: [...pos] as V3, yaw: Math.random() * 6.28, pitch: 0, flags: 0,
        hp: MAX_HP, alive: true, respawnAt: 0, protectUntil: 0, lastHurt: 0, lastShot: 0, reloadUntil: 0, kills: 0, deaths: 0, score: 0, streak: 0, maxStreak: 0, captures: 0, gg: 0, placement: 0,
        killRecs: [], killsByVictim: new Map(), damage: new Map(), hist: [], lastState: now(), ping: 0, strikes: 0, joinedMatch: true,
      });
    }
  }

  // ───────────── private-room lobby ─────────────
  lobbyInfo() {
    return {
      code: this.code, host: String(this.hostId), config: this.cfg, state: this.state, isPrivate: this.isPrivate,
      players: this.humans().map((p) => ({ id: String(p.id), name: p.name, team: p.team, level: p.level })),
    };
  }
  sendLobby() { this.io.to(this.channel).emit('room:state', this.lobbyInfo()); }
  configure(userId: number, raw: any) {
    if (userId !== this.hostId || this.state !== 'lobby' || !this.isPrivate) return;
    const c = sanitizeConfig({ ...this.cfg, ...(raw && typeof raw === 'object' ? raw : {}) });
    c.maxPlayers = Math.max(c.maxPlayers, this.humans().length);
    const modeChanged = c.mode !== this.cfg.mode;
    this.cfg = c;
    this.setup();
    if (modeChanged) { let i = 0; for (const p of this.humans()) p.team = this.mode.teams ? i++ % 2 : -1; }
    this.sendLobby();
  }
  setTeam(actor: number, target: number, team: unknown) {
    if (this.state !== 'lobby' || !this.mode.teams || (team !== 0 && team !== 1)) return;
    if (actor !== target && actor !== this.hostId) return;
    if (actor === target && actor !== this.hostId && !this.cfg.teamSelect) return;
    const p = this.players.get(target);
    if (p) { p.team = team; this.sendLobby(); }
  }
  kick(actor: number, target: number): boolean {
    if (actor !== this.hostId || actor === target || !this.isPrivate || !this.players.has(target)) return false;
    this.banned.add(target);
    return true;
  }
  start(userId: number): string | null {
    if (userId !== this.hostId || this.state !== 'lobby') return 'Only the host can start';
    if (this.humans().length < this.mode.minPlayers) return `${this.mode.name} needs at least ${this.mode.minPlayers} players`;
    this.setup();
    this.beginCountdown();
    for (const p of this.humans()) this.enterMatch(p);
    this.sendRoster(true);
    return null;
  }

  // ───────────── match lifecycle ─────────────
  private enterMatch(p: RP) {
    this.resetPlayer(p);
    p.joinedMatch = true;
    if (this.state === 'active') this.participants.add(p.id);
    p.socket?.emit('match:init', {
      code: this.code, mode: this.cfg.mode, map: this.map.id, config: this.cfg, state: this.state, you: String(p.id), isPrivate: this.isPrivate,
      timeLeft: this.timeLeft(), countdown: Math.max(0, this.countdownAt - now()), barrels: this.barrels.map((b) => b.hp > 0),
      ladder: this.mode.id === 'gungame' ? GUN_GAME_LADDER : null,
    });
    if (this.mode.id === 'br' && this.state === 'active') { p.alive = false; p.respawnAt = 0; } else this.spawn(p);
  }
  private resetPlayer(p: RP) {
    Object.assign(p, { kills: 0, deaths: 0, score: 0, streak: 0, maxStreak: 0, captures: 0, gg: 0, placement: 0, strikes: 0 });
    p.killRecs = []; p.killsByVictim.clear(); p.damage.clear();
    this.giveLoadout(p);
  }
  private giveLoadout(p: RP) {
    const mk = (weapon: string, atts: string[], skin: string | null): Slot => { const stats = computeStats(WEAPON_BY_ID[weapon], atts); return { weapon, atts, skin, stats, ammo: stats.mag }; };
    if (this.mode.id === 'gungame') p.slots = [mk(GUN_GAME_LADDER[Math.min(p.gg, GUN_GAME_LADDER.length - 1)], [], p.base.primary.skin)];
    else p.slots = [mk(p.base.primary.weapon, p.base.primary.atts, p.base.primary.skin), mk(p.base.secondary.weapon, p.base.secondary.atts, p.base.secondary.skin)];
    p.slot = 0; p.reloadUntil = 0;
    p.socket?.emit('loadout', { slots: p.slots.map((s) => ({ weapon: s.weapon, atts: s.atts, skin: s.skin })), slot: 0 });
  }
  private beginCountdown() {
    this.state = 'countdown';
    this.countdownAt = now() + (config.testMode ? 1000 : 5000);
    this.io.to(this.channel).emit('match:state', { state: this.state, countdown: this.countdownAt - now() });
  }
  private beginMatch() {
    this.state = 'active';
    this.matchId = crypto.randomUUID();
    this.startedAt = now();
    this.endsAt = this.startedAt + this.cfg.timeLimit * 1000;
    this.lastDomScore = this.startedAt;
    this.teamScores = [0, 0];
    this.zones.forEach((z) => Object.assign(z, { owner: -1, prog: 0, team: -1 }));
    const b = this.map.bounds;
    this.br = { x: (Math.random() - 0.5) * 16, z: (Math.random() - 0.5) * 16, r0: Math.hypot(b.x, b.z) * 1.05, r: Math.hypot(b.x, b.z) * 1.05 };
    const order = [...this.map.spawns.ffa].sort(() => Math.random() - 0.5);
    let i = 0;
    for (const p of this.players.values()) {
      if (p.dummy) continue;
      this.resetPlayer(p);
      this.participants.add(p.id);
      this.spawn(p, this.mode.id === 'br' ? order[i++ % order.length] : undefined);
    }
    this.io.to(this.channel).emit('match:state', { state: 'active', timeLeft: this.timeLeft() });
    this.sendRoster(true);
  }
  timeLeft() { return this.state === 'active' ? Math.max(0, this.endsAt - now()) : this.cfg.timeLimit * 1000; }

  private spawn(p: RP, forced?: V3) {
    let pos = forced;
    if (!pos) {
      const list = this.mode.teams ? (p.team === 0 ? this.map.spawns.a : this.map.spawns.b) : this.map.spawns.ffa;
      const enemies = [...this.players.values()].filter((o) => o !== p && o.alive && (!this.mode.teams || o.team !== p.team));
      let best = -1;
      for (const s of list) {
        if ([...this.players.values()].some((o) => o !== p && o.alive && dist(o.pos, s) < 1.2)) continue;
        const d = enemies.length ? Math.min(...enemies.map((e) => dist(e.pos, s))) : Math.random() * 10;
        const sc = d + Math.random() * 4;
        if (sc > best) { best = sc; pos = s; }
      }
      pos ??= list[Math.floor(Math.random() * list.length)];
    }
    p.pos = [...pos] as V3;
    p.yaw = Math.atan2(p.pos[0], p.pos[2]); // face the map centre
    p.hp = MAX_HP; p.alive = true; p.respawnAt = 0; p.flags = 0; p.hist = []; p.lastState = now();
    p.protectUntil = now() + SPAWN_PROTECT * 1000;
    for (const s of p.slots) s.ammo = s.stats.mag;
    p.reloadUntil = 0;
    p.socket?.emit('spawn', { pos: p.pos, yaw: p.yaw });
  }

  // ───────────── client input ─────────────
  onState(userId: number, m: unknown) {
    const p = this.players.get(userId);
    if (!p || !p.alive || !Array.isArray(m) || m.length < 6 || !m.slice(0, 6).every(fin)) return;
    const t = now();
    const pos: V3 = [m[0], m[1], m[2]];
    const b = this.map.bounds;
    const dt = Math.min(1, Math.max(0.016, (t - p.lastState) / 1000));
    const horiz = Math.hypot(pos[0] - p.pos[0], pos[2] - p.pos[2]);
    const crouch = (m[5] & (F_CROUCH | F_SLIDE)) !== 0;
    // anti-cheat: speed, bounds, flying and clipping checks. A bad update is rejected and the client is snapped back.
    const bad = horiz > PHYS.maxSpeed * dt + 1.2 || pos[1] - p.pos[1] > 9 * dt + 1.5 ||
      Math.abs(pos[0]) > b.x || Math.abs(pos[2]) > b.z || pos[1] < b.yMin || pos[1] > b.yMax ||
      this.collider.overlaps(pos[0], pos[1] + 0.05, pos[2], (crouch ? PHYS.crouchHeight : PHYS.height) - 0.1, PHYS.radius - 0.04);
    p.lastState = t;
    if (bad) {
      p.strikes++;
      p.socket?.emit('correct', { pos: p.pos });
      if (p.strikes > 200) p.socket?.disconnect(true);
      return;
    }
    p.pos = pos; p.yaw = m[3]; p.pitch = Math.max(-1.6, Math.min(1.6, m[4])); p.flags = m[5] & 63;
    p.hist.push({ t, p: pos, c: crouch });
    if (p.hist.length > 30) p.hist.shift();
  }
  onSwitch(userId: number, slot: unknown) {
    const p = this.players.get(userId);
    if (!p || !p.alive || (slot !== 0 && slot !== 1) || !p.slots[slot] || slot === p.slot) return;
    p.slot = slot; p.reloadUntil = 0;
    p.lastShot = now() + 250; // raise time
  }
  onReload(userId: number) {
    const p = this.players.get(userId);
    if (!p || !p.alive) return;
    const s = p.slots[p.slot];
    if (p.reloadUntil || s.ammo >= s.stats.mag) return;
    p.reloadUntil = now() + s.stats.reload * 1000 - 60;
  }
  onShoot(userId: number, m: any) {
    const p = this.players.get(userId);
    const t = now();
    if (!p || !p.alive || this.state === 'ended' || this.state === 'lobby' || !m || !vec(m.o) || !Array.isArray(m.d)) return;
    const s = p.slots[p.slot], st = s.stats;
    if (p.reloadUntil || s.ammo <= 0) return;
    if (t - p.lastShot < st.fireInterval * 1000 * 0.82) return; // fire-rate check (tolerates jitter, not rapid-fire hacks)
    const eye: V3 = [p.pos[0], p.pos[1] + ((p.flags & (F_CROUCH | F_SLIDE)) ? PHYS.crouchEye : PHYS.eye), p.pos[2]];
    if (dist(eye, m.o) > 2.2) return; // shot must originate from where the server knows the shooter is
    p.lastShot = t; s.ammo--;
    const dirs: V3[] = [];
    for (const d of m.d.slice(0, st.pellets)) {
      if (!vec(d)) continue;
      const l = Math.hypot(d[0], d[1], d[2]);
      if (l > 0.5 && l < 1.5) dirs.push([d[0] / l, d[1] / l, d[2] / l]);
    }
    if (!dirs.length) return;
    // pellets may not stray further from the first ray than the weapon's spread allows
    const maxCos = Math.cos(((st.hip * 2.2 + 4) * Math.PI) / 180);
    const rewind = t - Math.min(280, p.ping / 2 + 110);
    const ends: V3[] = [];
    const live = this.state === 'active';
    for (const d of dirs) {
      if (d[0] * dirs[0][0] + d[1] * dirs[0][1] + d[2] * dirs[0][2] < maxCos) continue;
      const wall = this.collider.raycast(eye, d, 200);
      let bestT = wall ? wall.t : 200, victim: RP | null = null, head = false;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        const [op, oc] = this.rewound(o, rewind);
        const top = oc ? PHYS.crouchHeight : PHYS.height;
        const hb: Box6 = [op[0] - HITBOX.headHalf, op[1] + top - HITBOX.headH, op[2] - HITBOX.headHalf, op[0] + HITBOX.headHalf, op[1] + top, op[2] + HITBOX.headHalf];
        const bb: Box6 = [op[0] - HITBOX.bodyHalf, op[1], op[2] - HITBOX.bodyHalf, op[0] + HITBOX.bodyHalf, op[1] + top - HITBOX.headH, op[2] + HITBOX.bodyHalf];
        const hh = rayBox(eye, d, hb, bestT), hbod = rayBox(eye, d, bb, bestT);
        if (hh && (!hbod || hh.t <= hbod.t + 0.05)) { bestT = hh.t; victim = o; head = true; }
        else if (hbod) { bestT = hbod.t; victim = o; head = false; }
      }
      ends.push([eye[0] + d[0] * bestT, eye[1] + d[1] * bestT, eye[2] + d[2] * bestT]);
      if (victim) {
        if (this.mode.teams && victim.team === p.team) continue;
        const dmg = damageAt(st, bestT) * (head ? st.head : 1);
        this.hurt(victim, p, dmg, { head, dist: bestT, weapon: s.weapon, cat: st.cat });
      } else if (wall && wall.index >= this.nWorld && live) {
        const bi = wall.index - this.nWorld, br = this.barrels[bi];
        if (br.hp > 0) { br.hp -= st.damage; if (br.hp <= 0) this.explode(bi, p, s.weapon, st.cat); }
      }
    }
    p.socket?.to(this.channel).emit('ev', { k: 'shot', id: String(p.id), o: eye.map(r2), e: ends.map((e) => e.map(r2)), q: st.silent ? 1 : 0 });
  }
  private rewound(o: RP, t: number): [V3, boolean] {
    for (let i = o.hist.length - 1; i >= 0; i--) if (o.hist[i].t <= t) return [o.hist[i].p, o.hist[i].c];
    return [o.pos, (o.flags & (F_CROUCH | F_SLIDE)) !== 0];
  }
  private explode(i: number, by: RP, weapon: string, cat: WeaponCat) {
    const br = this.barrels[i], c = this.map.barrels[i];
    br.hp = 0; br.respawnAt = now() + 25000;
    const centre: V3 = [c[0], c[1] + BARREL_SIZE.h / 2, c[2]];
    this.io.to(this.channel).emit('ev', { k: 'boom', i, p: centre });
    for (const o of [...this.players.values()]) {
      if (!o.alive || (this.mode.teams && o.team === by.team && o !== by)) continue;
      const d = dist([o.pos[0], o.pos[1] + 0.9, o.pos[2]], centre);
      if (d < 6.5) this.hurt(o, by, 120 * (1 - d / 6.5), { head: false, dist: d, weapon, cat, boom: true });
    }
  }

  private hurt(v: RP, a: RP | null, amount: number, info: { head: boolean; dist: number; weapon: string; cat: WeaponCat; boom?: boolean; zone?: boolean }) {
    const t = now();
    if (!v.alive || amount <= 0 || t < v.protectUntil) return;
    const live = this.state === 'active';
    const dealt = Math.min(v.hp, amount);
    v.hp -= amount; v.lastHurt = t;
    if (a && a !== v && live && !v.dummy) a.damage.set(info.weapon, (a.damage.get(info.weapon) ?? 0) + dealt);
    v.socket?.emit('ev', { k: 'hurt', from: a ? a.pos : v.pos, dmg: Math.round(amount), hp: Math.max(0, Math.round(v.hp)), zone: info.zone ? 1 : 0 });
    const dead = v.hp <= 0;
    if (a && a !== v) a.socket?.emit('ev', { k: 'hit', id: String(v.id), dmg: Math.round(amount), head: info.head ? 1 : 0, kill: dead ? 1 : 0, p: [v.pos[0], v.pos[1] + 1.2, v.pos[2]].map(r2) });
    this.io.to(this.channel).emit('ev', { k: 'blood', id: String(v.id), head: info.head ? 1 : 0 });
    if (!dead) return;
    // ── elimination (decided here and only here) ──
    v.alive = false; v.hp = 0; v.deaths += live ? 1 : 0; v.streak = 0;
    const alive = [...this.players.values()].filter((o) => o.alive && !o.dummy).length;
    if (this.mode.id === 'br') v.placement = alive + 1;
    v.respawnAt = this.mode.respawn || !live ? t + RESPAWN_TIME * 1000 : 0;
    const credit = a && a !== v ? a : null;
    if (credit && live) {
      credit.kills++; credit.streak++; credit.maxStreak = Math.max(credit.maxStreak, credit.streak);
      credit.score += 100 + (info.head ? 25 : 0);
      if (!v.dummy) {
        credit.killsByVictim.set(v.id, (credit.killsByVictim.get(v.id) ?? 0) + 1);
        credit.killRecs.push({ weapon: info.weapon, cat: info.cat, head: info.head, dist: info.dist, slide: (credit.flags & F_SLIDE) !== 0, ads: (credit.flags & F_ADS) !== 0 });
      }
      if (this.mode.id === 'tdm') this.teamScores[credit.team]++;
      if (this.mode.id === 'gungame') {
        credit.gg++;
        if (credit.gg < GUN_GAME_LADDER.length) this.giveLoadout(credit);
      }
    }
    this.io.to(this.channel).emit('ev', {
      k: 'kill', v: String(v.id), a: credit ? String(credit.id) : null, w: info.zone ? 'zone' : info.boom ? 'barrel' : info.weapon, head: info.head ? 1 : 0,
      streak: credit?.streak ?? 0, fx: credit?.fx.kill ?? null, respawn: v.respawnAt ? RESPAWN_TIME : 0,
    });
    this.sendRoster(true);
  }

  // ───────────── simulation tick ─────────────
  private tick() {
    const t = now();
    const dt = Math.min(0.25, (t - this.lastTick) / 1000);
    this.lastTick = t;
    if (this.state === 'lobby') return;
    const humans = this.humans();
    if (this.state === 'waiting' && humans.length >= this.mode.minPlayers && !this.isPrivate) this.beginCountdown();
    if (this.state === 'countdown') {
      if (humans.length < this.mode.minPlayers) { this.state = this.isPrivate ? 'lobby' : 'waiting'; this.io.to(this.channel).emit('match:state', { state: this.state }); if (this.isPrivate) this.sendLobby(); }
      else if (t >= this.countdownAt) this.beginMatch();
    }
    if (this.state === 'ended') {
      if (t >= this.resetAt) this.afterMatch();
      return;
    }
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnAt && t >= p.respawnAt) { if (p.dummy) { p.hp = MAX_HP; p.alive = true; p.respawnAt = 0; } else this.spawn(p); }
        continue;
      }
      if (p.reloadUntil && t >= p.reloadUntil) { p.reloadUntil = 0; p.slots[p.slot].ammo = p.slots[p.slot].stats.mag; }
      if (p.hp < MAX_HP && t - p.lastHurt > 5000) p.hp = Math.min(MAX_HP, p.hp + 30 * dt); // health regeneration
    }
    for (const [i, b] of this.barrels.entries()) if (b.hp <= 0 && t >= b.respawnAt) { b.hp = 40; this.io.to(this.channel).emit('ev', { k: 'barrel', i }); }

    if (this.state === 'active') {
      if (this.mode.id === 'dom') this.tickDomination(t, dt);
      if (this.mode.id === 'br') this.tickRoyale(t, dt);
      const end = this.checkEnd(t, humans);
      if (end) return this.endMatch(end);
    }
    this.broadcast(t);
  }

  private tickDomination(t: number, dt: number) {
    this.map.zones.forEach((z, i) => {
      const st = this.zones[i];
      const inside: RP[][] = [[], []];
      for (const p of this.players.values()) if (p.alive && p.team >= 0 && Math.hypot(p.pos[0] - z.p[0], p.pos[2] - z.p[2]) <= z.r && Math.abs(p.pos[1] - z.p[1]) < 3) inside[p.team].push(p);
      const a = inside[0].length, b = inside[1].length;
      if (a && b) return; // contested: frozen
      const team = a ? 0 : b ? 1 : -1;
      if (team < 0 || team === st.owner) { st.prog = Math.max(0, st.prog - dt / 6); if (!st.prog) st.team = -1; return; }
      if (st.team !== team) { st.team = team; st.prog = 0; }
      st.prog += (dt / 5) * Math.min(2, inside[team].length);
      if (st.prog >= 1) {
        st.owner = team; st.prog = 0; st.team = -1;
        for (const p of inside[team]) { p.captures++; p.score += 150; }
        this.io.to(this.channel).emit('ev', { k: 'cap', z: z.id, team });
        this.sendRoster(true);
      }
    });
    if (t - this.lastDomScore >= 3000) {
      this.lastDomScore = t;
      for (const z of this.zones) if (z.owner >= 0) this.teamScores[z.owner]++;
    }
  }
  private tickRoyale(t: number, dt: number) {
    const el = (t - this.startedAt) / 1000, grace = 15, total = this.cfg.timeLimit - 20;
    const k = Math.max(0, Math.min(1, (el - grace) / (total - grace)));
    this.br.r = this.br.r0 + (5 - this.br.r0) * k;
    for (const p of this.players.values()) {
      if (!p.alive || p.dummy) continue;
      if (Math.hypot(p.pos[0] - this.br.x, p.pos[2] - this.br.z) > this.br.r) {
        p.protectUntil = 0;
        this.hurt(p, null, (6 + 14 * k) * dt, { head: false, dist: 0, weapon: 'zone', cat: 'ar', zone: true });
      }
    }
  }

  private checkEnd(t: number, humans: RP[]): { winnerTeam: number; winnerId: number | null; reason: string } | null {
    const m = this.mode.id, lim = this.cfg.scoreLimit;
    const top = [...humans].sort((a, b) => (m === 'gungame' ? b.gg - a.gg || b.kills - a.kills : b.kills - a.kills || a.deaths - b.deaths))[0];
    const byTeam = () => (this.teamScores[0] === this.teamScores[1] ? -1 : this.teamScores[0] > this.teamScores[1] ? 0 : 1);
    const timeUp = t >= this.endsAt;
    if (m === 'training') return timeUp ? { winnerTeam: -1, winnerId: null, reason: 'Session over' } : null;
    // opponents all left: nobody is declared the winner of an empty match
    if (humans.length < 2 && this.participants.size >= 2) return { winnerTeam: -1, winnerId: null, reason: 'Opponents left the match' };
    if (m === 'tdm' || m === 'dom') {
      if (lim && Math.max(...this.teamScores) >= lim) return { winnerTeam: byTeam(), winnerId: null, reason: 'Score limit reached' };
      if (timeUp) return { winnerTeam: byTeam(), winnerId: null, reason: 'Time limit reached' };
    } else if (m === 'ffa') {
      if (top && lim && top.kills >= lim) return { winnerTeam: -1, winnerId: top.id, reason: 'Score limit reached' };
      if (timeUp) return { winnerTeam: -1, winnerId: top && top.kills > 0 ? top.id : null, reason: 'Time limit reached' };
    } else if (m === 'gungame') {
      if (top && top.gg >= GUN_GAME_LADDER.length) return { winnerTeam: -1, winnerId: top.id, reason: 'Ladder complete' };
      if (timeUp) return { winnerTeam: -1, winnerId: top && top.gg > 0 ? top.id : null, reason: 'Time limit reached' };
    } else if (m === 'br') {
      const alive = humans.filter((p) => p.alive);
      if (alive.length <= 1) { if (alive[0]) alive[0].placement = 1; return { winnerTeam: -1, winnerId: alive[0]?.id ?? null, reason: 'Last operator standing' }; }
    }
    return null;
  }

  private endMatch(end: { winnerTeam: number; winnerId: number | null; reason: string }) {
    this.state = 'ended';
    this.resetAt = now() + (config.testMode ? 2500 : 12000);
    const humans = this.humans();
    const order = [...humans].sort((a, b) => (this.mode.id === 'br' ? (a.placement || 99) - (b.placement || 99) : this.mode.id === 'gungame' ? b.gg - a.gg || b.kills - a.kills : b.score - a.score || b.kills - a.kills));
    const duration = (now() - this.startedAt) / 1000;
    // rewards need a real contest: 2+ humans took part and the match was not instantly over
    const eligible = this.mode.rewards && this.participants.size >= 2 && (config.testMode || duration >= 20);
    const results: PlayerResult[] = order.map((p, i) => ({
      userId: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, score: p.score, placement: this.mode.id === 'br' ? p.placement || i + 1 : i + 1,
      won: this.mode.teams ? end.winnerTeam >= 0 && p.team === end.winnerTeam : end.winnerId === p.id,
      killRecs: p.killRecs, killsByVictim: [...p.killsByVictim.values()], damage: [...p.damage.entries()].map(([w, amount]) => ({ weapon: w, cat: WEAPON_BY_ID[w]?.cat ?? 'ar', amount })),
      maxStreak: p.maxStreak, captures: p.captures,
    }));
    const base = { matchId: this.matchId, mode: this.cfg.mode, map: this.map.id, reason: end.reason, winnerTeam: end.winnerTeam, winnerId: end.winnerId === null ? null : String(end.winnerId), teamScores: this.teamScores,
      board: results.map((r) => ({ id: String(r.userId), name: r.name, team: r.team, kills: r.kills, deaths: r.deaths, score: r.score, placement: r.placement, won: r.won })) };
    for (const p of this.players.values()) p.alive = false;
    this.io.to(this.channel).emit('match:state', { state: 'ended' });
    finalizeMatch({ matchId: this.matchId, mode: this.cfg.mode, map: this.map.id, isPrivate: this.isPrivate, startedAt: this.startedAt, eligible, results })
      .then((rewards) => { for (const p of humans) p.socket?.emit('match:end', { ...base, eligible, reward: rewards.get(p.id) ?? null }); })
      .catch((e) => { console.error('[match] finalize failed', e); for (const p of humans) p.socket?.emit('match:end', { ...base, eligible: false, reward: null, error: 'Rewards could not be saved' }); });
  }
  private afterMatch() {
    if (this.isPrivate) { this.state = 'lobby'; this.setup(); this.sendLobby(); return; }
    this.cfg = { ...this.cfg, map: MAPS[(MAPS.indexOf(this.map) + 1) % MAPS.length].id };
    this.state = 'waiting';
    this.setup();
    if (this.mode.teams) { let i = 0; for (const p of this.humans()) p.team = i++ % 2; }
    for (const p of this.humans()) this.enterMatch(p);
    this.sendRoster(true);
  }

  // ───────────── replication ─────────────
  sendRoster(force = false) {
    const t = now();
    if (!force && t - this.lastRoster < 1000) return;
    this.lastRoster = t;
    this.io.to(this.channel).emit('roster', [...this.players.values()].filter((p) => p.joinedMatch).map((p) => ({
      id: String(p.id), name: p.name, team: p.team, dummy: p.dummy, outfit: p.outfit, tracer: p.fx.tracer, kills: p.kills, deaths: p.deaths, score: p.score, gg: p.gg,
      slots: p.slots.map((s) => ({ weapon: s.weapon, atts: s.atts, skin: s.skin })),
    })));
  }
  private broadcast(t: number) {
    const ps = [...this.players.values()].filter((p) => p.joinedMatch);
    const arr = ps.map((p) => [String(p.id), r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r2(p.yaw), r2(p.pitch), p.flags, p.alive ? 1 : 0, p.slot]);
    const common = {
      t, p: arr, ts: this.teamScores, tl: this.timeLeft(), st: this.state,
      z: this.mode.id === 'dom' ? this.zones.map((z) => [z.owner, r2(z.prog), z.team]) : undefined,
      br: this.mode.id === 'br' ? [r2(this.br.x), r2(this.br.z), r2(this.br.r)] : undefined,
    };
    for (const p of ps) {
      if (!p.socket) continue;
      p.socket.volatile.emit('snap', { ...common, me: [Math.ceil(p.hp), p.slots[p.slot]?.ammo ?? 0, p.reloadUntil ? 1 : 0, p.slot, t < p.protectUntil ? 1 : 0] });
    }
  }
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export function sanitizeConfig(raw: any): RoomConfig {
  const mode = MODE_BY_ID[raw?.mode] ?? MODE_BY_ID.tdm;
  const int = (v: unknown, lo: number, hi: number, def: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v as number))) : def);
  return {
    mode: mode.id, map: MAP_BY_ID[raw?.map] ? raw.map : MAPS[0].id,
    maxPlayers: int(raw?.maxPlayers, mode.minPlayers, mode.maxPlayers, mode.maxPlayers),
    timeLimit: int(raw?.timeLimit, config.testMode ? 5 : 120, 900, mode.timeLimit),
    scoreLimit: mode.id === 'gungame' ? GUN_GAME_LADDER.length : mode.scoreLimit ? int(raw?.scoreLimit, config.testMode ? 1 : 5, 200, mode.scoreLimit) : 0,
    privacy: raw?.privacy === 'public' ? 'public' : 'invite', teamSelect: raw?.teamSelect !== false,
  };
}
