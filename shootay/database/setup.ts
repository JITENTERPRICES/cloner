// `npm run db:setup` — applies database/schema.sql and seeds the 6,000-mission library. Safe to re-run.
import { initDatabase, pool, q } from '../backend/src/db';
await initDatabase();
const { rows } = await q('SELECT count(*)::int AS missions, count(DISTINCT title)::int AS titles FROM missions');
console.log(`[db] schema applied — ${rows[0].missions} missions (${rows[0].titles} unique titles)`);
await pool.end();
