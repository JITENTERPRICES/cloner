import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { HttpError, moveDeyes, q, tx } from './db';
import { loadMe } from './account';
import { STARTING_DEYES } from '../../shared/constants';
import { DEFAULT_OUTFIT } from '../../shared/clothing';
import { DEFAULT_LOADOUT } from '../../shared/weapons';

export interface AuthedRequest extends Request { userId: number }

export const signToken = (userId: number) => jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '7d', algorithm: 'HS256' });
export function verifyToken(token: unknown): number | null {
  if (typeof token !== 'string' || token.length > 600) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as { uid?: number };
    return Number.isInteger(p.uid) ? p.uid! : null;
  } catch { return null; }
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const uid = verifyToken(h?.startsWith('Bearer ') ? h.slice(7) : null);
  if (!uid) return next(new HttpError(401, 'Sign in required'));
  (req as AuthedRequest).userId = uid;
  next();
}
/** Wraps async handlers so thrown errors reach the error middleware. */
export const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req as AuthedRequest, res).catch(next);

const USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const limiter = rateLimit({ windowMs: 10 * 60_000, limit: config.isProd ? 30 : 1000, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });

export const authRouter = Router();
authRouter.use(limiter);

authRouter.post('/register', wrap(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || !USERNAME.test(username)) throw new HttpError(400, 'Username must be 3-16 letters, numbers or underscores');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new HttpError(400, 'Password must be 8-72 characters');
  const hash = await bcrypt.hash(password, 10);
  const id = await tx(async (c) => {
    const ins = await c.query(
      'INSERT INTO users (username, username_lc, password_hash, loadout, outfit) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username_lc) DO NOTHING RETURNING id',
      [username, username.toLowerCase(), hash, JSON.stringify(DEFAULT_LOADOUT), JSON.stringify(DEFAULT_OUTFIT)]);
    if (!ins.rowCount) throw new HttpError(409, 'That username is taken');
    await moveDeyes(c, ins.rows[0].id, STARTING_DEYES, 'welcome', 'signup');
    return ins.rows[0].id as number;
  });
  res.json({ token: signToken(id), user: await loadMe(id) });
}));

authRouter.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 72) throw new HttpError(400, 'Invalid credentials');
  const { rows } = await q('SELECT id, password_hash FROM users WHERE username_lc = $1', [username.toLowerCase().slice(0, 16)]);
  // always run a compare so response time does not reveal whether the account exists
  const okPass = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_HASH);
  if (!rows[0] || !okPass) throw new HttpError(401, 'Wrong username or password');
  await q('UPDATE users SET last_seen = now() WHERE id = $1', [rows[0].id]);
  res.json({ token: signToken(rows[0].id), user: await loadMe(rows[0].id) });
}));
