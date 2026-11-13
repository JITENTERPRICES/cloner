// Socket layer: authentication, matchmaking, private rooms, parties, invites and per-socket rate limits.
import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { cleanFx, cleanLoadout, cleanOutfit, getOwned } from '../account';
import { verifyToken } from '../auth';
import { q } from '../db';
import { Session, onlineCount, sessions } from '../presence';
import { areFriends } from '../routes/api';
import { JoinData, Room, sanitizeConfig } from './Room';
import { levelFromXp } from '../../../shared/constants';
import { MAPS } from '../../../shared/maps';
import { MODE_BY_ID, PUBLIC_MODES } from '../../../shared/modes';
import { sanitizeSettings } from '../../../shared/settings';

const rooms = new Map<string, Room>();
interface Party { id: string; leader: number; members: Set<number>; invited: Set<number> }
const parties = new Map<string, Party>();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => { let c: string; do c = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join(''); while (rooms.has(c)); return c; };
const CODE = /^[A-Z2-9]{6}$/;

/** Token-bucket limiter per socket + event class. */
function limiter(perSec: number, burst: number) {
  let tokens = burst, last = Date.now();
  return () => { const t = Date.now(); tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSec); last = t; if (tokens < 1) return false; tokens--; return true; };
}

async function joinData(userId: number): Promise<JoinData | null> {
  const { rows } = await q('SELECT id, username, xp, loadout, outfit, equipped_fx FROM users WHERE id = $1', [userId]);
  const u = rows[0];
  if (!u) return null;
  const owned = await getOwned(userId, u.xp); // loadout is rebuilt from what the database says the player owns
  return { id: u.id, name: u.username, level: levelFromXp(u.xp), outfit: cleanOutfit(u.outfit, owned), fx: cleanFx(u.equipped_fx, owned), loadout: cleanLoadout(u.loadout, owned) };
}

function createRoom(io: Server, cfgRaw: any, isPrivate: boolean, hostId: number) {
  const code = newCode();
  const room = new Room(io, code, sanitizeConfig(cfgRaw), isPrivate, hostId);
  room.onEmpty = () => { room.destroy(); rooms.delete(code); };
  rooms.set(code, room);
  return room;
}
function leaveRoom(s: Session) {
  if (!s.roomCode) return;
  rooms.get(s.roomCode)?.leave(s.userId);
  s.roomCode = null;
}
async function enterRoom(io: Server, s: Session, room: Room): Promise<string | null> {
  if (s.roomCode === room.code) return null;
  leaveRoom(s);
  const data = await joinData(s.userId);
  if (!data) return 'Account not found';
  if (!rooms.has(room.code)) return 'Room closed';
  const err = room.join(s.socket, data);
  if (err) return err;
  s.roomCode = room.code;
  // the party follows its leader
  const party = s.partyId ? parties.get(s.partyId) : null;
  if (party && party.leader === s.userId) for (const m of party.members) if (m !== s.userId) sessions.get(m)?.socket.emit('party:follow', { code: room.code });
  return null;
}
const partyInfo = (p: Party) => ({ id: p.id, leader: String(p.leader), members: [...p.members].map((id) => ({ id: String(id), name: sessions.get(id)?.username ?? '?' })) });
const sendParty = (p: Party) => { for (const m of p.members) sessions.get(m)?.socket.emit('party:state', partyInfo(p)); };
function leaveParty(s: Session) {
  const p = s.partyId ? parties.get(s.partyId) : null;
  s.partyId = null;
  s.socket.emit('party:state', null);
  if (!p) return;
  p.members.delete(s.userId);
  if (p.members.size <= 1) { for (const m of p.members) { const o = sessions.get(m); if (o) { o.partyId = null; o.socket.emit('party:state', null); } } parties.delete(p.id); return; }
  if (p.leader === s.userId) p.leader = [...p.members][0];
  sendParty(p);
}

export function attachGame(io: Server) {
  io.use(async (socket, next) => {
    const uid = verifyToken(socket.handshake.auth?.token);
    if (!uid) return next(new Error('unauthorized'));
    const { rows } = await q('SELECT username, settings FROM users WHERE id = $1', [uid]).catch(() => ({ rows: [] as any[] }));
    if (!rows[0]) return next(new Error('unauthorized'));
    socket.data = { userId: uid, username: rows[0].username, privacy: sanitizeSettings(rows[0].settings).privacy };
    next();
  });

  setInterval(() => io.emit('online', onlineCount()), 5000);

  io.on('connection', (socket: Socket) => {
    const userId: number = socket.data.userId;
    // one live session per account: a new login replaces the old one
    const old = sessions.get(userId);
    if (old) { old.socket.emit('kicked', 'Signed in from another device'); leaveRoom(old); leaveParty(old); old.socket.disconnect(true); }
    const s: Session = { userId, username: socket.data.username, socket, roomCode: null, partyId: null, showOnline: socket.data.privacy.showOnline, allowInvites: socket.data.privacy.invites };
    sessions.set(userId, s);
    socket.emit('online', onlineCount());

    const fast = limiter(70, 140), mid = limiter(35, 70), slow = limiter(2, 8);
    const room = () => (s.roomCode ? rooms.get(s.roomCode) : undefined); // membership is server state, never a client claim
    const reply = (cb: unknown, v: unknown) => { if (typeof cb === 'function') cb(v); };

    // ── gameplay (high frequency) ──
    socket.on('st', (m) => { if (fast()) room()?.onState(userId, m); });
    socket.on('shoot', (m) => { if (mid()) room()?.onShoot(userId, m); });
    socket.on('reload', () => { if (mid()) room()?.onReload(userId); });
    socket.on('switch', (slot) => { if (mid()) room()?.onSwitch(userId, slot); });
    socket.on('pg', (t) => { const r = room()?.players.get(userId); if (r && typeof t === 'number') r.ping = Math.max(0, Math.min(400, Date.now() - t)); });
    const pinger = setInterval(() => socket.emit('pg', Date.now()), 2000);

    // ── matchmaking & rooms ──
    socket.on('mm:join', async (m, cb) => {
      if (!slow()) return reply(cb, { error: 'Slow down' });
      const mode = m?.mode;
      if (!PUBLIC_MODES.includes(mode)) return reply(cb, { error: 'Unknown mode' });
      const party = s.partyId ? parties.get(s.partyId) : null;
      if (party && party.leader !== userId) return reply(cb, { error: 'Only the party leader can queue' });
      const need = party ? party.members.size : 1;
      let best: Room | null = null;
      for (const r of rooms.values()) {
        if (r.cfg.mode !== mode || (r.isPrivate && r.cfg.privacy !== 'public') || r.state === 'ended' || r.state === 'lobby') continue;
        if (r.state === 'active' && !r.mode.lateJoin) continue;
        if (r.humans().length + need > r.cfg.maxPlayers || r.banned.has(userId)) continue;
        if (!best || r.humans().length > best.humans().length) best = r;
      }
      best ??= createRoom(io, { mode, map: MAPS[Math.floor(Math.random() * MAPS.length)].id }, false, userId);
      const err = await enterRoom(io, s, best);
      reply(cb, err ? { error: err } : { code: best.code });
    });
    socket.on('room:create', async (m, cb) => {
      if (!slow()) return reply(cb, { error: 'Slow down' });
      const training = m?.mode === 'training';
      const r = createRoom(io, m, true, userId);
      const err = await enterRoom(io, s, r);
      if (err) return reply(cb, { error: err });
      if (training) r.start(userId);
      reply(cb, { code: r.code });
    });
    socket.on('room:join', async (m, cb) => {
      if (!slow()) return reply(cb, { error: 'Slow down' });
      const code = typeof m?.code === 'string' ? m.code.toUpperCase() : '';
      const r = CODE.test(code) ? rooms.get(code) : undefined;
      if (!r) return reply(cb, { error: 'Room not found — the code may have expired' });
      const err = await enterRoom(io, s, r);
      reply(cb, err ? { error: err } : { code: r.code });
    });
    socket.on('room:leave', () => leaveRoom(s));
    socket.on('room:config', (m) => { if (slow()) room()?.configure(userId, m); });
    socket.on('room:team', (m) => { if (mid()) room()?.setTeam(userId, m?.userId ? Number(m.userId) : userId, m?.team); });
    socket.on('room:start', (_m, cb) => { const r = room(); reply(cb, r ? { error: r.start(userId) } : { error: 'Not in a room' }); });
    socket.on('room:kick', (m) => {
      const r = room(), target = Number(m?.userId);
      if (!r || !r.kick(userId, target)) return;
      const ts = sessions.get(target);
      if (ts) { leaveRoom(ts); ts.socket.emit('room:kicked'); }
    });
    socket.on('rooms:list', (_m, cb) => reply(cb, [...rooms.values()]
      .filter((r) => (!r.isPrivate || r.cfg.privacy === 'public') && r.cfg.mode !== 'training')
      .slice(0, 40).map((r) => ({ code: r.code, mode: r.cfg.mode, map: r.map.id, players: r.humans().length, max: r.cfg.maxPlayers, state: r.state, custom: r.isPrivate }))));

    // ── invitations & parties (friends only) ──
    socket.on('invite:room', async (m, cb) => {
      if (!slow()) return reply(cb, { error: 'Slow down' });
      const target = sessions.get(Number(m?.userId)), r = room();
      if (!r) return reply(cb, { error: 'Join a room first' });
      if (!target || !(await areFriends(userId, target.userId))) return reply(cb, { error: 'That friend is offline' });
      if (!target.allowInvites) return reply(cb, { error: 'That player has invites turned off' });
      target.socket.emit('invite', { kind: 'room', from: s.username, code: r.code, mode: MODE_BY_ID[r.cfg.mode].name });
      reply(cb, { ok: true });
    });
    socket.on('party:invite', async (m, cb) => {
      if (!slow()) return reply(cb, { error: 'Slow down' });
      const target = sessions.get(Number(m?.userId));
      if (!target || target.userId === userId || !(await areFriends(userId, target.userId))) return reply(cb, { error: 'That friend is offline' });
      if (!target.allowInvites) return reply(cb, { error: 'That player has invites turned off' });
      let p = s.partyId ? parties.get(s.partyId) : undefined;
      if (!p) { p = { id: crypto.randomUUID(), leader: userId, members: new Set([userId]), invited: new Set() }; parties.set(p.id, p); s.partyId = p.id; sendParty(p); }
      if (p.leader !== userId) return reply(cb, { error: 'Only the party leader can invite' });
      if (p.members.size >= 5) return reply(cb, { error: 'Party is full' });
      p.invited.add(target.userId);
      target.socket.emit('invite', { kind: 'party', from: s.username, partyId: p.id });
      reply(cb, { ok: true });
    });
    socket.on('party:accept', (m, cb) => {
      const p = typeof m?.partyId === 'string' ? parties.get(m.partyId) : undefined;
      if (!p || !p.invited.has(userId) || p.members.size >= 5) return reply(cb, { error: 'Invite expired' });
      leaveParty(s);
      p.invited.delete(userId); p.members.add(userId); s.partyId = p.id;
      sendParty(p);
      const leader = sessions.get(p.leader);
      if (leader?.roomCode) socket.emit('party:follow', { code: leader.roomCode });
      reply(cb, { ok: true });
    });
    socket.on('party:leave', () => leaveParty(s));

    socket.on('disconnect', () => {
      clearInterval(pinger);
      if (sessions.get(userId) !== s) return;
      leaveRoom(s); leaveParty(s);
      sessions.delete(userId);
      q('UPDATE users SET last_seen = now() WHERE id = $1', [userId]).catch(() => {});
    });
  });
}
