// End-of-match settlement. Deyes are never credited when a kill happens — only here, once,
// after the server has finished the match and validated its own records.
import { moveDeyes, tx } from '../db';
import { applyMatchFacts } from '../missions';
import { DEYES_PER_KILL, MAX_REWARDED_KILLS_PER_VICTIM, levelFromXp } from '../../../shared/constants';
import { KillRec } from '../../../shared/missions';
import { WeaponCat } from '../../../shared/weapons';

export interface PlayerResult {
  userId: number; name: string; team: number; kills: number; deaths: number; score: number; placement: number; won: boolean;
  killRecs: KillRec[]; killsByVictim: number[]; damage: { weapon: string; cat: WeaponCat; amount: number }[]; maxStreak: number; captures: number;
}
export interface MatchRecord { matchId: string; mode: string; map: string; isPrivate: boolean; startedAt: number; eligible: boolean; results: PlayerResult[] }
export interface Reward { kills: number; rewardedKills: number; deyes: number; xp: number; balance: number; level: number; leveledUp: boolean; missionsCompleted: string[] }

export async function finalizeMatch(m: MatchRecord): Promise<Map<number, Reward>> {
  const out = new Map<number, Reward>();
  if (!m.results.length) return out;
  await tx(async (c) => {
    // the match row is the idempotency anchor: a second settlement of the same match stops here
    const ins = await c.query('INSERT INTO matches (id, mode, map, private, started_at, summary) VALUES ($1,$2,$3,$4,to_timestamp($5),$6) ON CONFLICT (id) DO NOTHING',
      [m.matchId, m.mode, m.map, m.isPrivate, m.startedAt / 1000, JSON.stringify({ eligible: m.eligible, players: m.results.length })]);
    if (!ins.rowCount) return;
    for (const r of m.results) {
      // validation: recorded kills must agree with the per-victim tally, and farming one victim is capped
      const tally = r.killsByVictim.reduce((a, n) => a + n, 0);
      const verified = Math.min(r.kills, tally, r.killRecs.length);
      const capped = r.killsByVictim.reduce((a, n) => a + Math.min(n, MAX_REWARDED_KILLS_PER_VICTIM), 0);
      const rewardedKills = m.eligible ? Math.min(verified, capped) : 0;
      const deyes = rewardedKills * DEYES_PER_KILL;
      const xp = m.eligible ? Math.round(r.score * 0.5 + (r.won ? 150 : 50)) : 0;
      const before = await c.query('SELECT xp FROM users WHERE id = $1 FOR UPDATE', [r.userId]);
      if (!before.rowCount) continue;
      await c.query('INSERT INTO match_players (match_id, user_id, team, kills, rewarded_kills, deaths, score, placement, won, deyes, xp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [m.matchId, r.userId, r.team, r.kills, rewardedKills, r.deaths, r.score, r.placement, r.won, deyes, xp]);
      let balance: number | null = null;
      if (deyes > 0) balance = await moveDeyes(c, r.userId, deyes, 'match', m.matchId);
      const heads = r.killRecs.filter((k) => k.head).length;
      const upd = await c.query(
        `UPDATE users SET xp = xp + $2, kills = kills + $3, deaths = deaths + $4, headshots = headshots + $5, wins = wins + $6, matches = matches + $7, last_seen = now() WHERE id = $1 RETURNING xp, deyes`,
        [r.userId, xp, m.eligible ? verified : 0, m.eligible ? r.deaths : 0, m.eligible ? heads : 0, m.eligible && r.won ? 1 : 0, m.eligible ? 1 : 0]);
      const missionsCompleted = m.eligible
        ? await applyMatchFacts(c, r.userId, { mode: m.mode, map: m.map, kills: r.killRecs.slice(0, verified), damage: r.damage, won: r.won, completed: true, maxStreak: r.maxStreak, captures: r.captures, score: r.score, placement: r.placement })
        : [];
      out.set(r.userId, {
        kills: r.kills, rewardedKills, deyes, xp, balance: balance ?? upd.rows[0].deyes, level: levelFromXp(upd.rows[0].xp),
        leveledUp: levelFromXp(upd.rows[0].xp) > levelFromXp(before.rows[0].xp), missionsCompleted,
      });
    }
  });
  return out;
}
