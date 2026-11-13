// Client side of a match: renders the world, runs local movement/weapon handling for responsiveness,
// interpolates other players from server snapshots, and plays back server-confirmed combat events.
// It never decides damage, kills, score or rewards — it only asks ("shoot", "reload") and displays results.
import * as THREE from 'three';
import { WeaponStats, comboRarity, computeStats } from '../../../shared/attachments';
import { CLOTH_BY_ID, OPERATOR_BY_ID, Outfit } from '../../../shared/clothing';
import { DEYES_PER_KILL, DEYES_SYMBOL, F_ADS, F_AIR, F_CROUCH, F_RELOAD, F_SLIDE, F_SPRINT, HITBOX, PHYS } from '../../../shared/constants';
import { MAP_BY_ID, MapDef } from '../../../shared/maps';
import { MODE_BY_ID, ModeDef } from '../../../shared/modes';
import { Box6, V3, rayBox } from '../../../shared/physics';
import { EFFECT_BY_ID, WEAPON_BY_ID } from '../../../shared/weapons';
import { music, setListener, sfx, startAmbience, stopAmbience } from '../engine/audio';
import { Avatar } from '../engine/avatar';
import { Effects } from '../engine/effects';
import { buildGun } from '../engine/guns';
import { Input } from '../engine/input';
import { ViewModel } from '../engine/viewmodel';
import { World, buildWorld } from '../engine/world';
import { request, socket } from '../net/net';
import { app, bus } from '../state';
import { BoardRow, Hud } from '../ui/hud';
import { h } from '../ui/dom';
import { PlayerController } from './player';

interface SlotInfo { weapon: string; atts: string[]; skin: string | null; stats: WeaponStats }
interface Snap { t: number; p: V3; yaw: number; pitch: number; flags: number; alive: boolean; slot: number }
interface Remote {
  id: string; name: string; team: number; dummy: boolean; avatar: Avatar; snaps: Snap[]; pos: THREE.Vector3; flags: number; alive: boolean; slot: number;
  slots: { weapon: string; atts: string[]; skin: string | null }[]; gunKey: string; outfitKey: string; tracer: number; tag: THREE.Sprite | null; lastStep: number; lastPos: THREE.Vector3; speed: number;
}
export interface MatchInit { code: string; mode: string; map: string; config: any; state: string; you: string; isPrivate: boolean; timeLeft: number; countdown: number; barrels: boolean[]; ladder: string[] | null }

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

export class Match {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(80, 1, 0.08, 400);
  view = new ViewModel();
  hud = new Hud();
  player = new PlayerController();
  private world: World; private fx: Effects; private map: MapDef; mode: ModeDef;
  private remotes = new Map<string, Remote>();
  private roster: BoardRow[] = [];
  private slots: SlotInfo[] = []; private slot = 0; private ammo: number[] = [0, 0];
  private hp = 100; alive = false; private protectedSpawn = false; private myTeam = -1;
  state: string; private timeLeft: number; private countdownEnd = 0; private lastBeep = -1;
  private teamScores = [0, 0]; private zones: [number, number, number][] = []; private br: number[] | null = null;
  private zoneMeshes: THREE.Mesh[] = []; private brMesh: THREE.Mesh | null = null;
  private lastShot = 0; private triggerHeld = false; private bloom = 0; private recoil = 0; private reloadEnd = 0; private lastSend = 0; private clockOff: number | null = null;
  private respawnAt = 0; private deathTilt = 0; private landDip = 0; private frames = 0; private fpsT = 0; private ping = 0; private pingTimer = 0; private smokeT = 0; private aimId: string | null = null;
  private subs: (() => void)[] = [];
  paused = false; ended = false;

  constructor(private input: Input, public init: MatchInit) {
    const g = app.settings.graphics;
    this.map = MAP_BY_ID[init.map]; this.mode = MODE_BY_ID[init.mode];
    this.state = init.state; this.timeLeft = init.timeLeft;
    if (init.countdown > 0) this.countdownEnd = performance.now() + init.countdown;
    this.world = buildWorld(this.scene, this.map, g.quality, g.shadows && g.quality !== 'low', g.viewDistance);
    init.barrels.forEach((on, i) => { if (this.world.barrels[i]) this.world.barrels[i].visible = on; });
    this.fx = new Effects(this.scene);
    this.camera.rotation.order = 'YXZ';
    this.buildObjectives();
    this.wire();
    this.applyOutfitToArms();
    this.player.onLand = (s) => { this.view.landed(s); this.landDip = s; sfx.land(s); if (s > 0.3) this.fx.dust(tmp.set(...this.player.pos), 4); };
    this.player.onStep = (l) => sfx.footstep(null, l * 0.6);
    this.player.onJump = () => sfx.jump();
    this.player.onSlide = () => { sfx.slide(); this.fx.dust(tmp.set(...this.player.pos), 6); };
    startAmbience(this.map.id as any);
    music.setDuck(0.25); // music drops back once the match begins
    this.hud.show(true);
    input.setEnabled(true);
    this.pingTimer = window.setInterval(() => { const t0 = performance.now(); request('rooms:list').then(() => (this.ping = Math.round(performance.now() - t0))).catch(() => {}); }, 4000);
    this.hud.announce(this.mode.name.toUpperCase(), this.map.name, 3000);
    if (this.state === 'waiting') this.hud.announce('WARM-UP', 'Waiting for more players…', 0);
  }

  private applyOutfitToArms() {
    const o = app.user?.outfit; if (!o) return;
    const top = CLOTH_BY_ID[o.jacket ?? ''] ?? CLOTH_BY_ID[o.hoodie ?? ''] ?? CLOTH_BY_ID[o.shirt ?? ''];
    const skin = OPERATOR_BY_ID[o.operator]?.skin ?? 0x8d5a3c;
    const long = !!(o.jacket || o.hoodie) || top?.style === 'longsleeve' || top?.style === 'jersey';
    this.view.setArms(long && top ? top.color : skin, CLOTH_BY_ID[o.gloves ?? '']?.color ?? skin);
  }

  private buildObjectives() {
    if (this.mode.id === 'dom') for (const z of this.map.zones) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(z.r, z.r, 2.6, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.set(z.p[0], z.p[1] + 1.3, z.p[2]);
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      g.font = 'bold 52px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(z.id, 32, 34);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, opacity: 0.85 }));
      s.position.set(0, 2.4, 0); s.scale.setScalar(1.6); m.add(s);
      this.scene.add(m); this.zoneMeshes.push(m);
    }
    if (this.mode.id === 'br') {
      this.brMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xa24bff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.brMesh.position.y = 20; this.scene.add(this.brMesh);
    }
  }

  // ───────────── network ─────────────
  private wire() {
    const on = (ev: string, fn: (m: any) => void) => this.subs.push(bus.on('net:' + ev, fn));
    on('roster', (list: any[]) => this.onRoster(list));
    on('snap', (s) => this.onSnap(s));
    on('spawn', (m) => {
      this.player.teleport(m.pos, m.yaw); this.alive = true; this.hp = 100; this.respawnAt = 0; this.deathTilt = 0; this.recoil = 0; this.bloom = 0;
      this.input.resetToggles(); this.hud.respawnIn(null);
      this.ammo = this.slots.map((s) => s.stats.mag); this.reloadEnd = 0; this.view.cancelReload();
    });
    on('loadout', (m) => {
      this.slots = m.slots.map((s: any) => ({ ...s, stats: computeStats(WEAPON_BY_ID[s.weapon], s.atts) }));
      this.ammo = this.slots.map((s) => s.stats.mag);
      this.slot = m.slot; this.reloadEnd = 0;
      const s = this.slots[this.slot];
      this.view.equip(s.weapon, s.atts, s.skin, s.stats, !this.view.stats);
    });
    on('correct', (m) => { this.player.pos = [...m.pos] as V3; this.player.vel = [0, 0, 0]; });
    on('match:state', (m) => {
      this.state = m.state;
      if (m.state === 'countdown') { this.countdownEnd = performance.now() + m.countdown; this.hud.announce('MATCH STARTING', 'Get ready', m.countdown); sfx.matchFound(); }
      if (m.state === 'active') { this.timeLeft = m.timeLeft; this.hud.announce('GO', this.mode.rules[0], 2200); sfx.countdown(true); }
      if (m.state === 'waiting') this.hud.announce('WARM-UP', 'Waiting for more players…', 0);
      if (m.state === 'ended') { this.ended = true; this.input.setEnabled(false); this.input.unlock(); }
    });
    on('ev', (e) => this.onEvent(e));
  }

  private onRoster(list: any[]) {
    this.roster = list;
    const seen = new Set<string>();
    for (const p of list) {
      seen.add(p.id);
      if (p.id === this.init.you) { this.myTeam = p.team; continue; }
      let r = this.remotes.get(p.id);
      const outfitKey = JSON.stringify(p.outfit);
      if (!r) {
        r = { id: p.id, name: p.name, team: p.team, dummy: p.dummy, avatar: new Avatar(p.outfit as Outfit), snaps: [], pos: new THREE.Vector3(0, -50, 0), flags: 0, alive: false, slot: 0, slots: p.slots, gunKey: '', outfitKey, tracer: 0xffe0a0, tag: null, lastStep: 0, lastPos: new THREE.Vector3(), speed: 0 };
        r.avatar.root.visible = false;
        this.scene.add(r.avatar.root);
        this.remotes.set(p.id, r);
      } else if (r.outfitKey !== outfitKey) { r.avatar.setOutfit(p.outfit); r.outfitKey = outfitKey; }
      r.team = p.team; r.slots = p.slots; r.name = p.name;
      r.tracer = p.tracer ? EFFECT_BY_ID[p.tracer]?.color ?? 0xffe0a0 : 0xffe0a0;
      this.updateTag(r);
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { this.scene.remove(r.avatar.root); this.remotes.delete(id); }
  }
  private isAlly(r: Remote) { return this.mode.teams && r.team === this.myTeam; }
  private updateTag(r: Remote) {
    const want = this.isAlly(r) ? 'ally' : 'enemy';
    if (r.tag?.userData.kind === want) return;
    if (r.tag) r.avatar.root.remove(r.tag);
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d')!;
    g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(128 - g.measureText(r.name).width / 2 - 10, 6, g.measureText(r.name).width + 20, 36);
    g.fillStyle = want === 'ally' ? '#6fd3ff' : app.settings.accessibility.enemyColor; g.fillText(r.name, 128, 25);
    r.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: want !== 'ally', transparent: true, fog: false }));
    r.tag.scale.set(1.5, 0.28, 1); r.tag.position.y = 2.05; r.tag.userData.kind = want;
    r.avatar.root.add(r.tag);
  }

  private onSnap(s: any) {
    const now = performance.now();
    const off = s.t - now; // server clock relative to ours; keep the smallest latency estimate
    this.clockOff = this.clockOff === null ? off : Math.max(this.clockOff - 0.5, off);
    this.teamScores = s.ts; this.timeLeft = s.tl; this.state = s.st === 'ended' ? this.state : s.st;
    if (s.z) this.zones = s.z;
    if (s.br) this.br = s.br;
    for (const a of s.p) {
      if (a[0] === this.init.you) continue;
      const r = this.remotes.get(a[0]); if (!r) continue;
      r.snaps.push({ t: s.t, p: [a[1], a[2], a[3]], yaw: a[4], pitch: a[5], flags: a[6], alive: !!a[7], slot: a[8] });
      if (r.snaps.length > 20) r.snaps.shift();
    }
    const me = s.me;
    this.hp = me[0]; this.protectedSpawn = !!me[4];
    // server ammo is the truth; adopt it whenever we are not mid-burst or mid-reload locally
    if (now - this.lastShot > 350 && !this.reloadEnd && me[3] === this.slot) this.ammo[this.slot] = me[1];
  }

  private onEvent(e: any) {
    const me = this.init.you;
    if (e.k === 'shot') {
      const r = this.remotes.get(e.id); if (!r) return;
      const st = computeStats(WEAPON_BY_ID[r.slots[r.slot]?.weapon] ?? WEAPON_BY_ID.mr4, r.slots[r.slot]?.atts ?? []);
      const from = r.avatar.muzzleWorld(new THREE.Vector3());
      sfx.shot(st.cat, st.pitch, !!e.q, [from.x, from.y, from.z]);
      for (const end of e.e as V3[]) {
        const to = new THREE.Vector3(...end);
        this.fx.tracer(from, to, r.tracer);
        const nearPlayer = [...this.remotes.values()].some((o) => o.alive && o.pos.distanceTo(to) < 1.9) || tmp.set(...this.player.pos).distanceTo(to) < 1.9;
        if (!nearPlayer) { this.fx.impact(to, tmp2.copy(from).sub(to).normalize()); sfx.impact(end); }
      }
    } else if (e.k === 'hit') {
      this.hud.hitmarker(!!e.head, !!e.kill); sfx.hit(!!e.head);
    } else if (e.k === 'hurt') {
      this.hp = e.hp; sfx.hurt();
      const dx = e.from[0] - this.player.pos[0], dz = e.from[2] - this.player.pos[2], y = this.player.yaw;
      if (e.zone) this.hud.damageFrom(0, 4); else this.hud.damageFrom(Math.atan2(dx * Math.cos(y) - dz * Math.sin(y), -dx * Math.sin(y) - dz * Math.cos(y)), e.dmg);
      if (!app.settings.accessibility.reduceShake) this.recoil += 0.012;
    } else if (e.k === 'blood') {
      const r = this.remotes.get(e.id);
      if (r) { r.avatar.flinch(); this.fx.blood(tmp.copy(r.pos).setY(r.pos.y + (e.head ? 1.65 : 1.15)), tmp2.copy(r.pos).sub(this.camera.position).setY(0).normalize(), !!e.head, r.pos); }
    } else if (e.k === 'kill') {
      const killer = e.a ? (e.a === me ? app.user!.username : this.remotes.get(e.a)?.name ?? '?') : null;
      const victim = e.v === me ? app.user!.username : this.remotes.get(e.v)?.name ?? '?';
      const wname = e.w === 'zone' ? 'THE ZONE' : e.w === 'barrel' ? 'EXPLOSION' : WEAPON_BY_ID[e.w]?.name ?? e.w;
      const vr = this.remotes.get(e.v);
      const kind = e.a === me || e.v === me ? 'me' : this.mode.teams ? ((e.a ? (this.remotes.get(e.a)?.team === this.myTeam) : false) ? 'ally' : 'enemy') : 'neutral';
      this.hud.kill(killer, victim, wname, !!e.head, kind);
      if (vr) { vr.avatar.dead = true; if (e.fx) this.fx.killEffect(tmp.copy(vr.pos).setY(vr.pos.y + 1), EFFECT_BY_ID[e.fx]?.color ?? 0xffffff); }
      if (e.a === me && e.v !== me) {
        sfx.kill();
        const live = this.state === 'active' && this.mode.rewards && !vr?.dummy;
        this.hud.killPopup(e.head ? 'HEADSHOT' : 'ELIMINATION', live ? `+${DEYES_PER_KILL} ${DEYES_SYMBOL} pending — paid when the match is verified` : this.mode.rewards ? 'Warm-up — no rewards yet' : 'Training — no rewards');
        if (e.streak >= 3) this.hud.announce(`${e.streak} STREAK`, '', 1500);
      }
      if (e.v === me) {
        this.alive = false; this.hp = 0; this.view.cancelReload(); this.reloadEnd = 0;
        this.respawnAt = e.respawn ? performance.now() + e.respawn * 1000 : -1;
        this.hud.respawnIn(e.respawn || -1, killer ? `ELIMINATED BY ${killer.toUpperCase()}` : 'ELIMINATED');
      }
    } else if (e.k === 'boom') {
      const p = new THREE.Vector3(...(e.p as V3));
      this.fx.explosion(p, p.distanceTo(this.camera.position)); sfx.explosion(e.p);
      if (this.world.barrels[e.i]) this.world.barrels[e.i].visible = false;
      if (p.distanceTo(this.camera.position) < 9) { this.hud.whiteout(0.5); setTimeout(() => this.hud.whiteout(0), 160); }
    } else if (e.k === 'barrel') { if (this.world.barrels[e.i]) this.world.barrels[e.i].visible = true; }
    else if (e.k === 'cap') { const mine = e.team === this.myTeam; this.hud.announce(`${mine ? 'WE' : 'ENEMY'} CAPTURED ${e.z}`, '', 2000); sfx.capture(); }
  }

  // ───────────── frame update ─────────────
  update(dt: number) {
    const now = performance.now(), inp = this.input, pl = this.player;
    inp.poll();
    const s = this.slots[this.slot], st = s?.stats;
    const active = this.alive && !this.paused && !this.ended;
    if (active && st) {
      pl.look(inp, st.zoom, this.view.ads);
      // touch auto-fire: pull the trigger when the crosshair is on a hostile
      const wantFire = inp.fire || (app.touch && app.settings.touch.autoFire && !!this.aimId);
      if (inp.swap || (inp.slot !== null && inp.slot !== this.slot)) this.switchTo(inp.slot ?? (this.slot + 1) % this.slots.length);
      if (inp.inspect) this.view.inspect();
      if (inp.reload) this.startReload();
      if (this.reloadEnd && now >= this.reloadEnd) { this.reloadEnd = 0; this.ammo[this.slot] = st.mag; }
      if (wantFire) this.tryFire(now, st); else this.triggerHeld = false;
      pl.update(dt, inp, this.world.collider, st.move, this.view.ads > 0.5);
    } else if (!this.alive) { pl.vel = [0, 0, 0]; }
    const ldx = active ? inp.lookDX : 0, ldy = active ? inp.lookDY : 0;
    inp.consume();
    this.bloom = Math.max(0, this.bloom - dt * 5);
    this.recoil += (0 - this.recoil) * Math.min(1, dt * 6);
    this.landDip += (0 - this.landDip) * Math.min(1, dt * 9);
    if (!this.alive) this.deathTilt = Math.min(1, this.deathTilt + dt * 2.5);

    // camera
    const g = app.settings.graphics;
    const zoom = st ? 1 + (st.zoom - 1) * this.view.ads : 1;
    const baseFov = g.fov + (pl.sprinting ? 4 : 0) + (pl.sliding ? 6 : 0);
    const fov = (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI;
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 16);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    const shake = this.fx.shake * 0.06;
    this.camera.position.set(pl.pos[0] + (Math.random() - 0.5) * shake, pl.pos[1] + pl.eye - this.landDip * 0.12 - this.deathTilt * 0.9 + (Math.random() - 0.5) * shake, pl.pos[2]);
    this.camera.rotation.set(pl.pitch + this.recoil, pl.yaw, (pl.sliding ? 0.05 : 0) + this.deathTilt * 0.5);
    setListener(pl.pos[0], pl.pos[1] + pl.eye, pl.pos[2], pl.yaw);

    this.view.update(dt, { lookDX: ldx, lookDY: ldy, speed: pl.speed, grounded: pl.grounded, sprinting: pl.sprinting, sliding: pl.sliding, wantAds: active && inp.ads, aspect: this.camera.aspect });
    this.updateRemotes(dt, now);
    this.fx.update(dt);
    this.updateObjectives();
    this.updateHud(now, st, s);
    this.send(now);

    // ambient smoke from a few fixed vents/barrels for atmosphere
    this.smokeT -= dt;
    if (this.smokeT <= 0 && g.particles > 0.2) { this.smokeT = 0.5; const b = this.map.barrels[(Math.random() * this.map.barrels.length) | 0]; if (b) this.fx.smoke(tmp.set(b[0] + 1.5, b[1] + 0.2, b[2] + 1.5)); }
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.hud.setFps(Math.round(this.frames / this.fpsT), this.ping); this.frames = 0; this.fpsT = 0; }
  }

  private forward(out: THREE.Vector3) { return this.camera.getWorldDirection(out); }

  private tryFire(now: number, st: WeaponStats) {
    if (this.view.busy || this.state === 'ended') return;
    if (!st.auto && this.triggerHeld) return;
    if (now - this.lastShot < st.fireInterval * 1000) return;
    if (this.ammo[this.slot] <= 0) { if (!this.triggerHeld) sfx.dry(); this.triggerHeld = true; this.startReload(); return; }
    this.triggerHeld = true; this.lastShot = now; this.ammo[this.slot]--;
    const pl = this.player, adsK = this.view.ads;
    let spread = st.hip + (st.ads - st.hip) * adsK;
    spread *= (1 + Math.min(1, pl.speed / 8) * 0.6 * (1 - adsK * 0.5)) * (pl.grounded ? 1 : 1.8) * (pl.crouching && !pl.sliding ? 0.8 : 1);
    spread += this.bloom * (1 - adsK * 0.7);
    this.camera.updateMatrixWorld();
    const f = this.forward(new THREE.Vector3()), r = tmp2.setFromMatrixColumn(this.camera.matrixWorld, 0).clone(), u = tmp3.setFromMatrixColumn(this.camera.matrixWorld, 1).clone();
    const eye: V3 = [this.camera.position.x, pl.pos[1] + pl.eye, this.camera.position.z];
    const muzzle = this.view.muzzleWorld(this.camera, new THREE.Vector3());
    const tracerColor = app.user?.fx.tracer ? EFFECT_BY_ID[app.user.fx.tracer]?.color ?? 0xffe0a0 : 0xffe0a0;
    const dirs: V3[] = [];
    for (let i = 0; i < st.pellets; i++) {
      const a = (spread * Math.PI / 180) * Math.sqrt(Math.random()), phi = Math.random() * 6.283, tn = Math.tan(a);
      const d = new THREE.Vector3().copy(f).addScaledVector(r, tn * Math.cos(phi)).addScaledVector(u, tn * Math.sin(phi)).normalize();
      const dv: V3 = [d.x, d.y, d.z];
      dirs.push(dv);
      // cosmetic prediction only: where the tracer ends and whether to draw a wall impact
      const wall = this.world.collider.raycast(eye, dv, 200);
      let t = wall ? wall.t : 200, hitPlayer = false;
      for (const o of this.remotes.values()) { if (!o.alive) continue; const hb = rayBox(eye, dv, this.hitbox(o), t); if (hb) { t = hb.t; hitPlayer = true; } }
      const end = new THREE.Vector3(eye[0] + d.x * t, eye[1] + d.y * t, eye[2] + d.z * t);
      this.fx.tracer(muzzle, end, tracerColor);
      if (wall && !hitPlayer) this.fx.impact(end, new THREE.Vector3(...wall.n));
    }
    socket?.emit('shoot', { o: eye, d: dirs });
    this.view.fire();
    sfx.shot(st.cat, st.pitch, st.silent);
    // recoil: vertical climb + random horizontal drift, partly recovering; bloom widens hip fire
    const rk = app.settings.accessibility.reduceShake ? 0.6 : 1;
    this.recoil += st.recoilV * 0.011 * (1 - adsK * 0.25) * rk;
    pl.pitch = Math.min(1.5, pl.pitch + st.recoilV * 0.0045 * rk);
    pl.yaw += (Math.random() - 0.5) * st.recoilH * 0.016 * rk;
    this.bloom = Math.min(st.hip * 1.2, this.bloom + st.hip * 0.22);
    if (this.ammo[this.slot] <= 0) setTimeout(() => this.startReload(), 180);
  }
  private startReload() {
    const st = this.slots[this.slot]?.stats;
    if (!st || !this.alive || this.reloadEnd || this.view.busy || this.ammo[this.slot] >= st.mag) return;
    socket?.emit('reload');
    this.reloadEnd = performance.now() + st.reload * 1000;
    this.view.reload(st.reload); sfx.reload(st.reload, st.cat);
  }
  private switchTo(i: number) {
    if (i === this.slot || !this.slots[i] || !this.alive) return;
    this.slot = i; this.reloadEnd = 0; this.triggerHeld = true;
    socket?.emit('switch', i);
    const s = this.slots[i];
    this.view.equip(s.weapon, s.atts, s.skin, s.stats); sfx.swap();
  }
  private hitbox(o: Remote): Box6 {
    const top = o.flags & (F_CROUCH | F_SLIDE) ? PHYS.crouchHeight : PHYS.height, b = HITBOX.bodyHalf;
    return [o.pos.x - b, o.pos.y, o.pos.z - b, o.pos.x + b, o.pos.y + top, o.pos.z + b];
  }

  private updateRemotes(dt: number, now: number) {
    const render = this.clockOff === null ? 0 : now + this.clockOff - 100; // draw the world 100ms in the past and interpolate
    this.camera.updateMatrixWorld();
    const f = this.forward(tmp3), eye: V3 = [this.camera.position.x, this.camera.position.y, this.camera.position.z];
    let aimT = 60; this.aimId = null;
    for (const r of this.remotes.values()) {
      const sn = r.snaps;
      if (!sn.length) continue;
      let a = sn[0], b = sn[sn.length - 1];
      for (let i = sn.length - 1; i > 0; i--) if (sn[i - 1].t <= render) { a = sn[i - 1]; b = sn[i]; break; }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (render - a.t) / (b.t - a.t))) : 1;
      r.pos.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
      if (!a.alive && b.alive) r.pos.set(...b.p); // respawn: do not slide across the map
      let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const wasAlive = r.alive;
      r.alive = b.alive; r.flags = b.flags; r.slot = b.slot;
      if (r.alive && !wasAlive) r.avatar.dead = false;
      r.avatar.root.visible = r.alive || r.avatar.dead;
      if (r.alive) { r.avatar.root.position.copy(r.pos); r.avatar.root.rotation.y = a.yaw + dy * k; }
      const sp = r.lastPos.distanceTo(r.pos) / Math.max(dt, 0.001);
      r.speed += (Math.min(sp, 12) - r.speed) * Math.min(1, dt * 10); r.lastPos.copy(r.pos);
      r.avatar.update(dt, { speed: r.alive ? r.speed : 0, crouch: !!(r.flags & F_CROUCH), slide: !!(r.flags & F_SLIDE), air: !!(r.flags & F_AIR), pitch: a.pitch + (b.pitch - a.pitch) * k, pose: 'aim' });
      const sl = r.slots[r.slot] ?? r.slots[0];
      const key = sl ? `${sl.weapon}|${sl.atts.join()}|${sl.skin}` : '';
      if (key !== r.gunKey) { r.gunKey = key; r.avatar.setGun(sl ? buildGun(sl.weapon, sl.atts, sl.skin) : null); }
      // footsteps you can hear (and locate) from other players
      if (r.alive && r.speed > 3 && !(r.flags & (F_CROUCH | F_AIR | F_SLIDE)) && now - r.lastStep > (r.flags & F_SPRINT ? 300 : 380)) { r.lastStep = now; sfx.footstep([r.pos.x, r.pos.y, r.pos.z], r.flags & F_SPRINT ? 1 : 0.7); }
      const ally = this.isAlly(r);
      if (r.alive && !ally) { const hbx = rayBox(eye, [f.x, f.y, f.z], this.hitbox(r), aimT); if (hbx) { aimT = hbx.t; this.aimId = r.id; } }
      if (r.tag) r.tag.visible = r.alive && ally;
    }
    if (this.aimId) { // enemy name only while your crosshair is on them and nothing is in the way
      const wall = this.world.collider.raycast(eye, [f.x, f.y, f.z], aimT);
      if (wall) this.aimId = null; else { const r = this.remotes.get(this.aimId)!; if (r.tag && !r.dummy) r.tag.visible = true; }
    }
  }

  private updateObjectives() {
    this.zoneMeshes.forEach((m, i) => {
      const z = this.zones[i]; if (!z) return;
      const owner = z[0], col = owner < 0 ? 0xaaaaaa : owner === this.myTeam ? 0x4db8ff : 0xff3b4e;
      (m.material as THREE.MeshBasicMaterial).color.setHex(col);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.14 + z[1] * 0.2;
    });
    if (this.brMesh && this.br) { this.brMesh.position.x = this.br[0]; this.brMesh.position.z = this.br[1]; this.brMesh.scale.set(this.br[2], 1, this.br[2]); }
  }

  private updateHud(now: number, st: WeaponStats | undefined, s: SlotInfo | undefined) {
    const hud = this.hud, pl = this.player;
    hud.health(this.hp, this.protectedSpawn);
    if (st && s) {
      const spread = (st.hip + (st.ads - st.hip) * this.view.ads) * (1 + Math.min(1, pl.speed / 8) * 0.6) * (pl.grounded ? 1 : 1.8) + this.bloom;
      const scoped = this.view.zoomOptic && st.zoom >= 2.2 && this.view.ads > 0.92;
      hud.crosshair(spread, this.view.ads, scoped, this.camera.fov);
      this.view.scene.visible = this.alive && !scoped;
      const other = this.slots[1 - this.slot];
      hud.weapon(WEAPON_BY_ID[s.weapon].name, comboRarity(s.weapon, s.atts), this.ammo[this.slot] ?? 0, st.mag, !!this.reloadEnd, this.slots.length > 1 && other ? WEAPON_BY_ID[other.weapon].name : null);
    }
    const mine = this.roster.find((r) => r.id === this.init.you);
    const lead = [...this.roster].filter((r) => !r.dummy).sort((a, b) => (this.mode.id === 'gungame' ? b.gg - a.gg : b.kills - a.kills))[0];
    if (this.mode.teams) hud.topBar(this.mode.id, this.timeLeft, this.state, { teamScores: this.teamScores, myTeam: Math.max(0, this.myTeam), limit: this.init.config.scoreLimit });
    else if (this.mode.id === 'gungame') hud.topBar(this.mode.id, this.timeLeft, this.state, { mine: `${(mine?.gg ?? 0) + 1}/${this.init.ladder?.length ?? 12}`, lead: lead ? `${lead.name} ${lead.gg + 1}` : '—' });
    else if (this.mode.id === 'br') hud.topBar(this.mode.id, this.timeLeft, this.state, { mine: `${mine?.kills ?? 0} K`, lead: `${[...this.remotes.values()].filter((r) => r.alive).length + (this.alive ? 1 : 0)} ALIVE` });
    else hud.topBar(this.mode.id, this.timeLeft, this.state, { mine: String(mine?.kills ?? 0), lead: lead ? `${lead.name} ${lead.kills}` : '—' });
    if (this.mode.id === 'dom') hud.objective(this.map.zones.map((z, i) => {
      const zs = this.zones[i] ?? [-1, 0, -1];
      return h('span.zone', { class: zs[0] < 0 ? 'neutral' : zs[0] === this.myTeam ? 'ally' : 'enemy' }, z.id, zs[1] > 0 ? h('i', { style: { width: zs[1] * 100 + '%' }, class: zs[2] === this.myTeam ? 'ally' : 'enemy' }) : null);
    }));
    else if (this.mode.id === 'br' && this.br && this.alive) {
      const out = Math.hypot(pl.pos[0] - this.br[0], pl.pos[2] - this.br[1]) > this.br[2];
      hud.objective(out ? [h('span.zone.enemy', null, 'OUTSIDE THE SAFE ZONE — MOVE')] : []);
    } else hud.objective([]);
    if (this.state === 'countdown' && this.countdownEnd) {
      const sec = Math.ceil((this.countdownEnd - now) / 1000);
      if (sec !== this.lastBeep && sec > 0 && sec <= 3) { this.lastBeep = sec; sfx.countdown(false); this.hud.announce(String(sec), 'Get ready', 900); }
    }
    if (!this.alive && this.respawnAt > 0) hud.respawnIn(Math.max(0, (this.respawnAt - now) / 1000));
    hud.scoreboard(this.input.scoreboard && !this.ended, this.roster, this.mode.id, this.init.you, this.myTeam);
  }

  private send(now: number) {
    if (!this.alive || now - this.lastSend < 50) return;
    this.lastSend = now;
    const pl = this.player;
    const flags = (pl.crouching && !pl.sliding ? F_CROUCH : 0) | (pl.sliding ? F_SLIDE : 0) | (pl.sprinting ? F_SPRINT : 0) | (this.view.ads > 0.5 ? F_ADS : 0) | (pl.grounded ? 0 : F_AIR) | (this.reloadEnd ? F_RELOAD : 0);
    socket?.volatile.emit('st', [+pl.pos[0].toFixed(3), +pl.pos[1].toFixed(3), +pl.pos[2].toFixed(3), +pl.yaw.toFixed(3), +(pl.pitch + this.recoil).toFixed(3), flags]);
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(this.scene, this.camera);
    if (this.view.scene.visible) { renderer.clearDepth(); renderer.render(this.view.scene, this.view.camera); }
  }

  setPaused(p: boolean) { this.paused = p; if (p) { this.input.fire = false; this.input.ads = false; } }
  /** Rebuilds graphics-dependent state after a settings change mid-match. */
  applySettings() { this.hud.applySettings(); for (const r of this.remotes.values()) { if (r.tag) { r.avatar.root.remove(r.tag); r.tag = null; } this.updateTag(r); } }
  dispose() {
    this.subs.forEach((u) => u());
    clearInterval(this.pingTimer);
    this.input.setEnabled(false); this.input.unlock();
    this.hud.show(false);
    this.fx.dispose(); this.world.dispose();
    stopAmbience();
    music.setDuck(1);
  }
}
