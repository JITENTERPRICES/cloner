// Daily missions: assignment, server-side progress and verified claims.
import type pg from 'pg';
import { HttpError, moveDeyes, q, tx } from './db';
import { MatchFacts, MissionDef, missionProgress } from '../../shared/missions';

const DAY = `(now() AT TIME ZONE 'utc')::date`;
const SELECT = `SELECT um.slot, um.progress, um.claimed, um.day::text AS day, m.* FROM user_missions um JOIN missions m ON m.id = um.mission_id
  WHERE um.user_id = $1 AND um.day = ${DAY} ORDER BY um.slot`;
const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * Ensures the player has exactly three missions for the current UTC day (one per difficulty) and returns them.
 * Rotation is fair: uniform random over the library, excluding anything this player was given in the
 * last 60 days and never two missions of the same type on one day.
 */
export async function ensureDaily(c: pg.PoolClient, userId: number) {
  await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]); // serialise concurrent requests
  let cur = await c.query(SELECT, [userId]);
  if (cur.rowCount === 3) return cur.rows;
  const types: string[] = cur.rows.map((r) => r.type);
  const have = new Set(cur.rows.map((r) => r.slot));
  for (let slot = 0; slot < 3; slot++) {
    if (have.has(slot)) continue;
    const pick = await c.query(
      `SELECT m.id, m.type FROM missions m WHERE m.difficulty = $1 AND m.type <> ALL($3::text[])
         AND NOT EXISTS (SELECT 1 FROM user_missions um WHERE um.user_id = $2 AND um.mission_id = m.id AND um.day > ${DAY} - 60)
       ORDER BY random() LIMIT 1`, [DIFFICULTIES[slot], userId, types]);
    if (!pick.rowCount) continue;
    types.push(pick.rows[0].type);
    await c.query(`INSERT INTO user_missions (user_id, day, mission_id, slot) VALUES ($1, ${DAY}, $2, $3) ON CONFLICT DO NOTHING`, [userId, pick.rows[0].id, slot]);
  }
  cur = await c.query(SELECT, [userId]);
  return cur.rows;
}

const shape = (r: any) => ({ id: r.id, slot: r.slot, title: r.title, type: r.type, target: r.target, difficulty: r.difficulty, reward: r.reward, progress: Math.min(r.progress, r.target), complete: r.progress >= r.target, claimed: r.claimed, day: r.day });

export async function getDaily(userId: number) {
  const rows = await tx((c) => ensureDaily(c, userId));
  const reset = await q(`SELECT extract(epoch FROM ((${DAY} + 1)::timestamp AT TIME ZONE 'utc') - now())::int AS s`);
  return { missions: rows.map(shape), resetsIn: reset.rows[0].s };
}

/** Called from match finalisation, inside its transaction. Returns missions that just completed. */
export async function applyMatchFacts(c: pg.PoolClient, userId: number, facts: MatchFacts) {
  const rows = await ensureDaily(c, userId);
  const done: string[] = [];
  for (const r of rows) {
    if (r.progress >= r.target) continue;
    const gain = missionProgress(r as MissionDef, facts);
    if (gain <= 0) continue;
    const next = Math.min(r.target, r.progress + gain);
    await c.query(`UPDATE user_missions SET progress = $3 WHERE user_id = $1 AND day = ${DAY} AND slot = $2`, [userId, r.slot, next]);
    if (next >= r.target) done.push(r.title);
  }
  return done;
}

export async function claimMission(userId: number, missionId: unknown) {
  if (typeof missionId !== 'string' || !/^M\d{4}$/.test(missionId)) throw new HttpError(400, 'Invalid mission');
  return tx(async (c) => {
    const { rows } = await c.query(
      `SELECT um.progress, um.claimed, um.day::text AS day, m.target, m.reward FROM user_missions um JOIN missions m ON m.id = um.mission_id
       WHERE um.user_id = $1 AND um.day = ${DAY} AND um.mission_id = $2 FOR UPDATE OF um`, [userId, missionId]);
    const r = rows[0];
    if (!r) throw new HttpError(404, 'That mission is not assigned to you today');
    if (r.progress < r.target) throw new HttpError(400, 'Mission is not complete');
    if (r.claimed) throw new HttpError(409, 'Reward already claimed');
    await c.query(`UPDATE user_missions SET claimed = true WHERE user_id = $1 AND day = ${DAY} AND mission_id = $2`, [userId, missionId]);
    const balance = await moveDeyes(c, userId, r.reward, 'mission', `${r.day}:${missionId}`);
    if (balance === null) throw new HttpError(409, 'Reward already claimed');
    return { deyes: balance, reward: r.reward };
  });
}
