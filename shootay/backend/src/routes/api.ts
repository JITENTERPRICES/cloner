// REST API. Every mutation re-derives truth from the database; request bodies are only *requests*.
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { cleanFx, cleanLoadout, cleanOutfit, getOwned, loadMe } from '../account';
import { requireAuth, wrap } from '../auth';
import { config } from '../config';
import { HttpError, moveDeyes, q, tx } from '../db';
import { claimMission, getDaily } from '../missions';
import { onlineCount, sessions, statusOf } from '../presence';
import { ATTACHMENTS, compatible } from '../../../shared/attachments';
import { BOXES, BOX_BY_ID, DUPLICATE_REFUND, Reward, RewardType, pool, rollRarity } from '../../../shared/boxes';
import { CLOTH_BY_ID, ClothingDef } from '../../../shared/clothing';
import { levelFromXp, rarityRank } from '../../../shared/constants';
import { sanitizeSettings } from '../../../shared/settings';
import { WEAPON_BY_ID } from '../../../shared/weapons';

export const api = Router();
api.use(rateLimit({ windowMs: 60_000, limit: config.isProd ? 240 : 5000, standardHeaders: true, legacyHeaders: false, message: { error: 'Slow down.' } }));

// ── catalogue extensions (licensed / approved UGC rows added in the database over time) ──
let extraClothing: Record<string, ClothingDef> = {};
export async function refreshCatalog() {
  const { rows } = await q('SELECT * FROM catalog_items WHERE enabled');
  extraClothing = Object.fromEntries(rows.map((r) => [r.id, { id: r.id, name: r.name, brand: r.brand, slot: r.slot, style: r.style, tags: r.tags, rarity: r.rarity, price: r.price, color: r.color, color2: r.color2, accent: r.accent, license: r.license } as ClothingDef]));
}
export const clothingDef = (id: string): ClothingDef | undefined => CLOTH_BY_ID[id] ?? extraClothing[id];

api.get('/status', (_req, res) => res.json({ online: onlineCount() }));
api.get('/news', wrap(async (_req, res) => res.json((await q('SELECT tag, title, body, created_at FROM news ORDER BY id DESC LIMIT 8')).rows)));
api.get('/catalog/extra', (_req, res) => res.json(Object.values(extraClothing)));

api.use(requireAuth);

api.get('/me', wrap(async (req, res) => {
  const me = await loadMe(req.userId);
  if (!me) throw new HttpError(401, 'Account not found');
  res.json(me);
}));

api.put('/settings', wrap(async (req, res) => {
  const settings = sanitizeSettings(req.body);
  await q('UPDATE users SET settings = $2 WHERE id = $1', [req.userId, JSON.stringify(settings)]);
  const s = sessions.get(req.userId);
  if (s) { s.showOnline = settings.privacy.showOnline; s.allowInvites = settings.privacy.invites; }
  res.json(settings);
}));

api.put('/loadout', wrap(async (req, res) => {
  const { rows } = await q('SELECT xp FROM users WHERE id = $1', [req.userId]);
  const owned = await getOwned(req.userId, rows[0].xp);
  const loadout = cleanLoadout(req.body?.loadout, owned);
  const fx = cleanFx(req.body?.fx, owned);
  await q('UPDATE users SET loadout = $2, equipped_fx = $3 WHERE id = $1', [req.userId, JSON.stringify(loadout), JSON.stringify(fx)]);
  res.json({ loadout, fx });
}));

api.put('/outfit', wrap(async (req, res) => {
  const { rows } = await q('SELECT xp FROM users WHERE id = $1', [req.userId]);
  const owned = await getOwned(req.userId, rows[0].xp);
  const outfit = cleanOutfit(req.body, owned, extraClothing);
  await q('UPDATE users SET outfit = $2 WHERE id = $1', [req.userId, JSON.stringify(outfit)]);
  res.json(outfit);
}));

// ── store: clothing and buy-to-unlock weapons, paid in earned Deyes only ──
api.post('/shop/buy', wrap(async (req, res) => {
  const { type, id } = req.body ?? {};
  if (typeof id !== 'string' || id.length > 64) throw new HttpError(400, 'Invalid item');
  let price: number;
  if (type === 'clothing') {
    const c = clothingDef(id);
    if (!c) throw new HttpError(404, 'Unknown item');
    price = c.price;
  } else if (type === 'weapon') {
    const w = WEAPON_BY_ID[id];
    if (!w || w.unlock.type !== 'buy') throw new HttpError(400, 'That weapon cannot be bought');
    price = w.unlock.price;
  } else throw new HttpError(400, 'Invalid item type');
  const deyes = await tx(async (c) => {
    const ins = await c.query(`INSERT INTO inventory (user_id, item_type, item_id, source) VALUES ($1,$2,$3,'shop') ON CONFLICT DO NOTHING`, [req.userId, type, id]);
    if (!ins.rowCount) throw new HttpError(409, 'You already own this');
    const bal = await moveDeyes(c, req.userId, -price, 'purchase', `${type}:${id}`);
    if (bal === null) throw new HttpError(409, 'You already own this');
    return bal;
  });
  res.json({ deyes, type, id });
}));

// ── mystery boxes ──
api.get('/boxes', (_req, res) => res.json({ boxes: BOXES, duplicateRefund: DUPLICATE_REFUND }));

const rand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32; // CSPRNG: results cannot be predicted or influenced by the client
const pickOne = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
const boxLimiter = rateLimit({ windowMs: 60_000, limit: 40, keyGenerator: (req) => String((req as any).userId), message: { error: 'Opening boxes too quickly.' } });

api.post('/boxes/open', boxLimiter, wrap(async (req, res) => {
  const box = BOX_BY_ID[req.body?.boxId];
  if (!box) throw new HttpError(404, 'Unknown box');
  const openId = crypto.randomUUID();
  const result = await tx(async (c) => {
    await moveDeyes(c, req.userId, -box.price, 'box', openId); // throws if the balance is short
    const rarity = rollRarity(box, rand());
    const types = (Object.keys(box.types) as RewardType[]).filter((t) => pool(t, rarity).length > 0);
    let roll = rand() * types.reduce((a, t) => a + box.types[t]!, 0);
    let type = types[0];
    for (const t of types) { roll -= box.types[t]!; if (roll < 0) { type = t; break; } }
    const item = pickOne(pool(type, rarity));
    const reward: Reward = { type, id: item.id, name: item.name, rarity };
    const grants: { type: string; id: string }[] = [{ type: type === 'combo' ? 'weapon' : type, id: item.id }];
    if (type === 'combo') {
      // a pre-built weapon combination: the weapon plus 2-3 compatible attachments from different slots
      const w = WEAPON_BY_ID[item.id];
      const slots = new Set<string>();
      const cands = ATTACHMENTS.filter((a) => compatible(w, a) && rarityRank(a.rarity) <= Math.max(1, rarityRank(rarity)));
      reward.extra = [];
      for (let i = 0; i < 40 && reward.extra.length < 3; i++) {
        const a = pickOne(cands);
        if (slots.has(a.slot)) continue;
        slots.add(a.slot); reward.extra.push(a.id); grants.push({ type: 'attachment', id: a.id });
      }
    }
    const { rows } = await c.query('SELECT xp FROM users WHERE id = $1', [req.userId]);
    const owned = await getOwned(req.userId, rows[0].xp, c);
    let duplicate = false, refund = 0, fresh = 0;
    for (const [i, g] of grants.entries()) {
      const had = (owned as any)[g.type].has(g.id);
      if (had) {
        await c.query(`INSERT INTO inventory (user_id, item_type, item_id, source, duplicates) VALUES ($1,$2,$3,'box',1)
          ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET duplicates = inventory.duplicates + 1`, [req.userId, g.type, g.id]);
        if (i === 0) duplicate = true;
      } else {
        await c.query(`INSERT INTO inventory (user_id, item_type, item_id, source) VALUES ($1,$2,$3,'box') ON CONFLICT DO NOTHING`, [req.userId, g.type, g.id]);
        fresh++;
      }
    }
    // duplicate protection: if nothing in the reward was new, part of the price comes back
    if (duplicate && fresh === 0) { refund = DUPLICATE_REFUND[rarity]; await moveDeyes(c, req.userId, refund, 'box_dupe', openId); }
    const bal = await c.query('SELECT deyes FROM users WHERE id = $1', [req.userId]);
    return { reward, duplicate, refund, deyes: bal.rows[0].deyes as number };
  });
  res.json(result);
}));

// ── missions ──
api.get('/missions', wrap(async (req, res) => res.json(await getDaily(req.userId))));
api.post('/missions/claim', wrap(async (req, res) => res.json(await claimMission(req.userId, req.body?.missionId))));

// ── profiles ──
api.get('/profile/:username', wrap(async (req, res) => {
  const name = String(req.params.username).toLowerCase().slice(0, 16);
  const { rows } = await q('SELECT id, username, xp, kills, deaths, headshots, wins, matches, outfit, loadout, settings, created_at FROM users WHERE username_lc = $1', [name]);
  const u = rows[0];
  if (!u) throw new HttpError(404, 'Player not found');
  const isPublic = sanitizeSettings(u.settings).privacy.publicProfile || u.id === req.userId;
  const base = { username: u.username, level: levelFromXp(u.xp), status: statusOf(u.id), private: !isPublic };
  if (!isPublic) return res.json(base);
  const owned = await getOwned(u.id, u.xp);
  const recent = await q(`SELECT m.mode, m.map, mp.kills, mp.deaths, mp.won, mp.deyes, m.ended_at FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = $1 ORDER BY m.ended_at DESC LIMIT 8`, [u.id]);
  res.json({ ...base, stats: { kills: u.kills, deaths: u.deaths, headshots: u.headshots, wins: u.wins, matches: u.matches }, outfit: cleanOutfit(u.outfit, owned, extraClothing), loadout: cleanLoadout(u.loadout, owned),
    collection: { weapons: owned.weapon.size, attachments: owned.attachment.size, clothing: owned.clothing.size, skins: owned.skin.size, effects: owned.effect.size }, recent: recent.rows, joined: u.created_at });
}));
api.get('/transactions', wrap(async (req, res) => res.json((await q('SELECT amount, reason, balance_after, created_at FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [req.userId])).rows)));

// ── friends ──
api.get('/friends', wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT u.id, u.username, u.xp, f.status, (f.user_a = $1) AS outgoing FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END WHERE f.user_a = $1 OR f.user_b = $1 ORDER BY u.username_lc`, [req.userId]);
  res.json(rows.map((r) => ({ id: String(r.id), username: r.username, level: levelFromXp(r.xp), state: r.status === 'accepted' ? 'friend' : r.outgoing ? 'sent' : 'incoming', status: r.status === 'accepted' ? statusOf(r.id) : 'offline' })));
}));
api.post('/friends/request', wrap(async (req, res) => {
  const name = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 16) : '';
  const { rows } = await q('SELECT id, username, settings FROM users WHERE username_lc = $1', [name]);
  const target = rows[0];
  if (!target) throw new HttpError(404, 'No player with that username');
  if (target.id === req.userId) throw new HttpError(400, 'That is you');
  const existing = await q('SELECT user_a, status FROM friendships WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)', [req.userId, target.id]);
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'pending' && existing.rows[0].user_a === target.id) { // they already asked us: accept
      await q(`UPDATE friendships SET status = 'accepted' WHERE user_a = $1 AND user_b = $2`, [target.id, req.userId]);
      sessions.get(target.id)?.socket.emit('friends:changed');
      return res.json({ state: 'friend' });
    }
    throw new HttpError(409, existing.rows[0].status === 'accepted' ? 'Already friends' : 'Request already sent');
  }
  if (!sanitizeSettings(target.settings).privacy.friendRequests) throw new HttpError(403, 'That player is not accepting friend requests');
  const count = await q('SELECT count(*)::int AS n FROM friendships WHERE user_a = $1 OR user_b = $1', [req.userId]);
  if (count.rows[0].n >= 200) throw new HttpError(400, 'Friends list is full');
  await q('INSERT INTO friendships (user_a, user_b) VALUES ($1, $2)', [req.userId, target.id]);
  const me = await q('SELECT username FROM users WHERE id = $1', [req.userId]);
  sessions.get(target.id)?.socket.emit('friends:changed', { from: me.rows[0].username });
  res.json({ state: 'sent' });
}));
api.post('/friends/respond', wrap(async (req, res) => {
  const other = Number(req.body?.userId);
  if (!Number.isInteger(other)) throw new HttpError(400, 'Invalid player');
  const r = req.body?.accept === true
    ? await q(`UPDATE friendships SET status = 'accepted' WHERE user_a = $1 AND user_b = $2 AND status = 'pending'`, [other, req.userId])
    : await q(`DELETE FROM friendships WHERE user_a = $1 AND user_b = $2 AND status = 'pending'`, [other, req.userId]);
  if (!r.rowCount) throw new HttpError(404, 'No pending request from that player');
  sessions.get(other)?.socket.emit('friends:changed');
  res.json({ ok: true });
}));
api.delete('/friends/:id', wrap(async (req, res) => {
  const other = Number(req.params.id);
  if (!Number.isInteger(other)) throw new HttpError(400, 'Invalid player');
  await q('DELETE FROM friendships WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)', [req.userId, other]);
  sessions.get(other)?.socket.emit('friends:changed');
  res.json({ ok: true });
}));

export async function areFriends(a: number, b: number) {
  const r = await q(`SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1))`, [a, b]);
  return !!r.rowCount;
}
