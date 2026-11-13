// End-to-end server test. Start the server with SHOOTAY_TEST=1 (short timers), then: npx tsx scripts/test-server.ts
// Drives two real accounts over HTTP + Socket.IO through a full Team Deathmatch and checks every reward path.
import { io, Socket } from 'socket.io-client';
import { PHYS } from '../shared/constants';
import { MAP_BY_ID, mapColliderBoxes } from '../shared/maps';
import { Collider, V3 } from '../shared/physics';
import { moveDeyes, pool, tx } from '../backend/src/db';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let failed = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? '  ok ' : 'FAIL '} ${msg}`); if (!c) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET') => {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) as any };
};
const emit = (s: Socket, ev: string, m?: unknown) => new Promise<any>((res) => s.emit(ev, m, res));

class Bot {
  token = ''; id = ''; sock!: Socket; pos: V3 = [0, 0, 0]; alive = false; events: any[] = []; end: any = null; corrected = 0; state = ''; lobby: any = null;
  constructor(public name: string) {}
  async register() {
    const r = await call('/api/auth/register', undefined, { username: this.name, password: 'correct-horse-9' });
    this.token = r.data.token; this.id = r.data.user.id;
    return r;
  }
  connect() {
    this.sock = io(BASE, { auth: { token: this.token }, transports: ['websocket'] });
    this.sock.on('spawn', (m) => { this.pos = m.pos; this.alive = true; });
    this.sock.on('ev', (e) => { this.events.push(e); if (e.k === 'kill' && e.v === this.id) this.alive = false; });
    this.sock.on('match:end', (m) => (this.end = m));
    this.sock.on('match:state', (m) => (this.state = m.state));
    this.sock.on('match:init', (m) => (this.state = m.state));
    this.sock.on('room:state', (m) => (this.lobby = m));
    this.sock.on('correct', (m) => { this.corrected++; this.pos = m.pos; });
    this.sock.on('pg', (t) => this.sock.emit('pg', t));
    return new Promise<void>((res, rej) => { this.sock.on('connect', () => res()); this.sock.on('connect_error', rej); });
  }
  send(flags = 0, yaw = 0) { this.sock.emit('st', [this.pos[0], this.pos[1], this.pos[2], yaw, 0, flags]); }
}

const col = new Collider(mapColliderBoxes(MAP_BY_ID.urban));
const free = (x: number, z: number) => !col.overlaps(x, 0.2, z, PHYS.height, PHYS.radius + 0.05);
/** Grid BFS over walkable ground so the bot moves like a legitimate player (no teleporting). */
function path(from: V3, to: V3): V3[] {
  const S = 0.5, key = (x: number, z: number) => `${Math.round(x / S)},${Math.round(z / S)}`;
  const start: [number, number] = [Math.round(from[0] / S) * S, Math.round(from[2] / S) * S];
  const prev = new Map<string, [number, number] | null>([[key(...start), null]]);
  const queue: [number, number][] = [start];
  while (queue.length) {
    const [x, z] = queue.shift()!;
    if (Math.hypot(x - to[0], z - to[2]) < 6 && !col.raycast([x, 1.6, z], norm([to[0] - x, 0, to[2] - z]), Math.hypot(x - to[0], z - to[2]))) {
      const out: V3[] = [];
      let cur: [number, number] | null = [x, z];
      while (cur) { out.unshift([cur[0], 0.2, cur[1]]); cur = prev.get(key(...cur)) ?? null; }
      return out;
    }
    for (const [dx, dz] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (prev.has(k) || Math.abs(nx) > 44 || Math.abs(nz) > 44 || !free(nx, nz)) continue;
      prev.set(k, [x, z]); queue.push([nx, nz]);
    }
  }
  return [];
}
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

async function hunt(a: Bot, b: Bot) {
  while (!a.alive || !b.alive) await sleep(50);
  await sleep(2100); // spawn protection
  const route = path(a.pos, b.pos);
  for (const p of route) { a.pos = p; a.send(); b.send(); await sleep(50); } // 0.5m per 50ms = 10 m/s, under the server limit
  const kills = () => a.events.filter((e) => e.k === 'kill' && e.a === a.id).length;
  const before = kills();
  for (let i = 0; i < 12 && kills() === before; i++) {
    const eye: V3 = [a.pos[0], a.pos[1] + PHYS.eye, a.pos[2]];
    a.sock.emit('shoot', { o: eye, d: [norm([b.pos[0] - eye[0], b.pos[1] + 1.0 - eye[1], b.pos[2] - eye[2]])] });
    await sleep(110);
  }
  return kills() > before;
}

const tag = Math.random().toString(36).slice(2, 8);
const a = new Bot('ta_' + tag), b = new Bot('tb_' + tag);
const reg = await a.register(); await b.register();
ok(reg.status === 200 && reg.data.user.deyes === 1000, 'register: account created with 1000 starting Deyes');
ok((await call('/api/auth/register', undefined, { username: a.name, password: 'correct-horse-9' })).status === 409, 'register: duplicate username rejected');
ok((await call('/api/auth/login', undefined, { username: a.name, password: 'wrong-password' })).status === 401, 'login: wrong password rejected');
ok((await call('/api/me')).status === 401, 'api: unauthenticated request rejected');
ok((await call('/api/me', 'forged.token.value')).status === 401, 'api: forged token rejected');

await a.connect(); await b.connect();
const bad = io(BASE, { auth: { token: 'nope' }, transports: ['websocket'] });
ok(await new Promise<boolean>((res) => { bad.on('connect_error', () => res(true)); bad.on('connect', () => res(false)); }), 'socket: unauthenticated connection refused');
bad.close();

const created = await emit(a.sock, 'room:create', { mode: 'tdm', map: 'urban', scoreLimit: 2, timeLimit: 120 });
ok(/^[A-Z2-9]{6}$/.test(created.code), `private room created with code ${created.code}`);
ok((await emit(b.sock, 'room:join', { code: 'ZZZZZZ' })).error !== undefined, 'joining an unknown room code fails');
ok((await emit(b.sock, 'room:join', { code: created.code })).code === created.code, 'second player joins through the room code');
await sleep(100);
ok(a.lobby?.players.length === 2 && a.lobby.host === a.id, 'room lobby lists both players and the host');
ok((await emit(b.sock, 'room:start')).error !== null, 'non-host cannot start the match');
b.sock.emit('room:config', { mode: 'ffa' }); await sleep(100);
ok(a.lobby.config.mode === 'tdm', 'non-host cannot change room settings');
ok((await emit(a.sock, 'room:start')).error === null, 'host starts the match');
while (a.state !== 'active') await sleep(50);

// cheating attempts
a.pos = [a.pos[0] + 30, a.pos[1], a.pos[2]]; a.send(); await sleep(150);
ok(a.corrected > 0, 'anti-cheat: teleport rejected and client corrected');
const evBefore = b.events.length;
a.sock.emit('shoot', { o: [b.pos[0], b.pos[1] + 1.6, b.pos[2] - 1], d: [[0, 0, 1]] }); await sleep(150);
ok(!b.events.slice(evBefore).some((e) => e.k === 'hurt'), 'anti-cheat: shot from a forged origin ignored');

ok(await hunt(a, b), 'first elimination registered by the server');
const mid = await call('/api/me', a.token);
ok(mid.data.deyes === 1000, `Deyes are NOT credited at kill time (balance still ${mid.data.deyes})`);
ok(await hunt(a, b), 'second elimination registered');
while (!a.end || !b.end) await sleep(50);
ok(a.end.winnerTeam === 0 && a.end.reward?.deyes === 200 && a.end.reward.balance === 1200, `match end: winner credited 2 x 100 Deyes (reward ${JSON.stringify(a.end.reward)})`);
ok(b.end.reward?.deyes === 0, 'match end: loser with no kills earns no Deyes');
const after = await call('/api/me', a.token);
ok(after.data.deyes === 1200 && after.data.stats.kills === 2 && after.data.stats.wins === 1, 'database: balance, kills and win persisted');
const txs = await call('/api/transactions', a.token);
ok(txs.data.filter((t: any) => t.reason === 'match').length === 1, 'ledger: exactly one match transaction saved');
ok((await tx((c) => moveDeyes(c, Number(a.id), 200, 'match', a.end.matchId))) === null, 'ledger: replaying the same match reward is a no-op (anti-duplicate)');

const ms = await call('/api/missions', a.token);
ok(ms.data.missions.length === 3 && new Set(ms.data.missions.map((m: any) => m.difficulty)).size === 3, 'missions: exactly three daily missions, one per difficulty');
ok((await call('/api/missions', a.token)).data.missions.map((m: any) => m.id).join() === ms.data.missions.map((m: any) => m.id).join(), 'missions: assignment is stable within the day');
const open = ms.data.missions.find((m: any) => !m.complete);
ok((await call('/api/missions/claim', a.token, { missionId: open.id })).status === 400, 'missions: claiming an incomplete mission rejected');
// complete a mission the legitimate way is slow; force progress in the DB to test the claim path itself
await pool.query(`UPDATE user_missions SET progress = 9999 WHERE user_id = $1 AND mission_id = $2`, [a.id, open.id]);
const claim = await call('/api/missions/claim', a.token, { missionId: open.id });
ok(claim.status === 200 && claim.data.reward === open.reward, `missions: completed mission pays ${open.reward} Deyes`);
ok((await call('/api/missions/claim', a.token, { missionId: open.id })).status === 409, 'missions: double claim rejected');

const bal0 = (await call('/api/me', a.token)).data.deyes;
const box = await call('/api/boxes/open', a.token, { boxId: 'street' });
ok(box.status === 200 && box.data.deyes === bal0 - 500 + box.data.refund, `mystery box: ${box.data.reward?.rarity} ${box.data.reward?.name} for 500 Deyes`);
const inv = (await call('/api/me', a.token)).data.inventory;
ok(inv[box.data.reward.type === 'combo' ? 'weapon' : box.data.reward.type].includes(box.data.reward.id), 'mystery box: reward is in the inventory');
await pool.query('UPDATE users SET deyes = 10 WHERE id = $1', [b.id]);
ok((await call('/api/boxes/open', b.token, { boxId: 'vault' })).status === 400, 'mystery box: cannot open without enough Deyes');
ok((await call('/api/loadout', a.token, { loadout: { primary: { weapon: 'fnk2', atts: [] }, secondary: { weapon: 'g17', atts: [] } } }, 'PUT')).data.loadout.primary.weapon === 'mr4', 'loadout: equipping an unowned weapon falls back to an owned one');

ok((await call('/api/friends/request', a.token, { username: b.name })).data.state === 'sent', 'friends: request sent');
ok((await call('/api/friends/respond', b.token, { userId: Number(a.id), accept: true })).status === 200, 'friends: request accepted');
const fl = await call('/api/friends', a.token);
ok(fl.data[0]?.state === 'friend' && fl.data[0].status !== 'offline', `friends: list shows ${fl.data[0]?.username} as ${fl.data[0]?.status}`);
a.sock.emit('room:leave'); b.sock.emit('room:leave'); await sleep(150);
const invited = new Promise<any>((res) => b.sock.once('invite', res));
await emit(a.sock, 'party:invite', { userId: b.id });
const inviteMsg = await invited;
ok(inviteMsg.kind === 'party', 'party: invitation delivered');
const follow = new Promise<any>((res) => b.sock.once('party:follow', res));
await emit(b.sock, 'party:accept', { partyId: inviteMsg.partyId });
const mm = await emit(a.sock, 'mm:join', { mode: 'ffa' });
ok((await follow).code === mm.code, 'party: members follow the leader into matchmaking');

a.sock.close(); b.sock.close(); await pool.end();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll server checks passed');
process.exit(failed ? 1 : 0);
