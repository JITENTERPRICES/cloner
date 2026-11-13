import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { generateMissions, MISSION_COUNT } from '../../shared/missions';

pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT -> number (balances stay far below 2^53)
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined });
export const q = <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) => pool.query<T>(text, params);

/** Runs fn inside a transaction; rolls back on any throw. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * The only way Deyes ever change. Locks the user row, refuses to overdraw, and writes a ledger row
 * whose (user, reason, ref) key is unique — replaying the same reward is a no-op that returns null.
 */
export async function moveDeyes(c: pg.PoolClient, userId: number, amount: number, reason: string, ref: string): Promise<number | null> {
  const u = await c.query('SELECT deyes FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!u.rowCount) throw new Error('user not found');
  const balance = u.rows[0].deyes + amount;
  if (balance < 0) throw new HttpError(400, 'Not enough Deyes');
  const ins = await c.query(
    'INSERT INTO transactions (user_id, amount, reason, ref, balance_after) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, reason, ref) DO NOTHING',
    [userId, amount, reason, ref, balance]);
  if (!ins.rowCount) return null;
  await c.query('UPDATE users SET deyes = $2 WHERE id = $1', [userId, balance]);
  return balance;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function initDatabase() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [path.resolve(here, '../../database/schema.sql'), path.resolve(process.cwd(), 'database/schema.sql')];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error('database/schema.sql not found');
  await q(fs.readFileSync(file, 'utf8'));
  const { rows } = await q('SELECT count(*)::int AS n FROM missions');
  if (rows[0].n !== MISSION_COUNT) {
    const ms = generateMissions();
    await tx(async (c) => {
      for (let i = 0; i < ms.length; i += 500) {
        const chunk = ms.slice(i, i + 500);
        const vals: unknown[] = [];
        const ph = chunk.map((m, j) => {
          vals.push(m.id, m.type, m.target, m.difficulty, m.reward, m.title, m.mode, m.map, m.cat, m.weapon);
          return `(${Array.from({ length: 10 }, (_, k) => `$${j * 10 + k + 1}`).join(',')})`;
        });
        await c.query(`INSERT INTO missions (id,type,target,difficulty,reward,title,mode,map,cat,weapon) VALUES ${ph.join(',')} ON CONFLICT (id) DO NOTHING`, vals);
      }
    });
    console.log(`[db] seeded ${ms.length} missions`);
  }
  await q(`INSERT INTO news (tag, title, body) VALUES
    ('SEASON 1', 'Blackout Season is live', 'Three maps, six modes and the full arsenal. Earn Deyes from verified eliminations and spend them on Mystery Boxes.'),
    ('MISSIONS', 'Three daily missions, every day', 'A fresh set of objectives drops at 00:00 UTC, drawn from a library of 6,000.'),
    ('SOCIAL', 'Private rooms with invite links', 'Create a room, hit COPY INVITE LINK and send it. Anyone with the link lands straight in your lobby.')
    ON CONFLICT (title) DO NOTHING`);
}
