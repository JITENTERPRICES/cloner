// All secrets come from the environment. Nothing here is ever sent to the client.
const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) throw new Error('JWT_SECRET (32+ chars) is required in production');
if (isProd && !env.DATABASE_URL) throw new Error('DATABASE_URL is required in production');

export const config = {
  isProd,
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://shootay:shootay_dev@localhost:5432/shootay',
  dbSsl: env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me-dev-only-secret',
  /** Public origin used when building invite links, e.g. https://play.example.com. Falls back to the request host. */
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  /** Comma-separated origins allowed for CORS/WebSocket when the client is hosted separately. */
  corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Shorter matches for automated tests only. */
  testMode: env.SHOOTAY_TEST === '1',
};
