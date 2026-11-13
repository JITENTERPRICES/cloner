import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import { authRouter } from './auth';
import { config } from './config';
import { HttpError, initDatabase } from './db';
import { attachGame } from './game/manager';
import { api, refreshCatalog } from './routes/api';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'", 'ws:', 'wss:', ...config.corsOrigins], workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: null, // plain-http LAN testing from a phone must keep working
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: config.isProd,
}));
if (config.corsOrigins.length) {
  app.use((req, res, next) => {
    const o = req.headers.origin;
    if (o && config.corsOrigins.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}
app.use(express.json({ limit: '16kb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api', api);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// built client + extracted soundtrack
const here = path.dirname(new URL(import.meta.url).pathname);
const root = [path.resolve(here, '../..'), process.cwd()].find((d) => fs.existsSync(path.join(d, 'shared'))) ?? process.cwd();
const dist = path.join(root, 'frontend/dist');
app.use('/music', express.static(path.join(root, 'assets/music'), { maxAge: '1h' }));
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  // SPA fallback: /join/ROOMCODE and every other client route load the game, which then joins the room after sign-in
  app.get(/^\/(?!api\/|socket\.io\/|music\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as any)?.type === 'entity.parse.failed' || (err as any)?.type === 'entity.too.large') return res.status(400).json({ error: 'Bad request' });
  console.error('[api]', err);
  res.status(500).json({ error: 'Server error' }); // never leak internals
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: config.corsOrigins.length ? { origin: config.corsOrigins } : undefined,
  maxHttpBufferSize: 8 * 1024, // gameplay packets are tiny; anything bigger is refused
  pingInterval: 10000, pingTimeout: 8000,
});
attachGame(io);

await initDatabase();
await refreshCatalog();
setInterval(() => refreshCatalog().catch(() => {}), 5 * 60_000);
server.listen(config.port, () => console.log(`[shootay] listening on :${config.port} (${config.isProd ? 'production' : 'development'})`));
