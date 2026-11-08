import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, purgeExpired } from './db.ts';
import { createApp, newId } from './app.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);

const config = {
  adminToken: process.env.ADMIN_TOKEN || null,
  retentionDays: Number(process.env.RETENTION_DAYS ?? 7),
  controllerName: process.env.CONTROLLER_NAME ?? 'FlowRide (set CONTROLLER_NAME)',
  privacyEmail: process.env.PRIVACY_EMAIL ?? 'privacy@example.org (set PRIVACY_EMAIL)',
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  rateLimit: Number(process.env.RATE_LIMIT ?? 30),
};

const db = openDb(process.env.DB_PATH ?? path.join(ROOT, 'flowride.db'));

/** Convert a Europe/London wall-clock time to a UTC ISO string. */
function london(date: Date, hh: number, mm: number) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hh, mm));
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const offset = Number(parts.find(p => p.type === 'hour')!.value) - hh; // 0 in GMT, 1 in BST
  return new Date(d.getTime() - offset * 3600_000).toISOString();
}

// Demo events are always dated in the near future so the site never looks stale.
if (process.env.SEED_DEMO !== '0' && (db.prepare('SELECT COUNT(*) n FROM events').get() as any).n === 0) {
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000);
  const nextDow = (dow: number) => { for (let i = 1; i <= 7; i++) if (day(i).getUTCDay() === dow) return day(i); return day(7); };
  const fri = nextDow(5), sat = nextDow(6);
  const ins = db.prepare('INSERT INTO events (id,title,venue,address,starts_at,description) VALUES (?,?,?,?,?,?)');
  ins.run(newId(8), 'Jumu\'ah at Manchester Central Mosque', 'Manchester Central Mosque', 'Victoria Park, M14 5RU', london(fri, 13, 0), 'Weekly Friday prayer. Share a lift from South Manchester and save on parking.');
  ins.run(newId(8), 'Jumu\'ah at Didsbury Mosque', 'Didsbury Mosque', '271 Burton Rd, M20 2WA', london(fri, 13, 15), 'Friday prayer. Drivers from Didsbury, Chorlton and Withington welcome.');
  ins.run(newId(8), 'Platt Fields community garden day', 'Platt Fields Park', 'Fallowfield, M14 6LA', london(sat, 10, 0), 'Helping out at the community garden. Bring gloves!');
}

const purge = () => {
  const n = purgeExpired(db, config.retentionDays);
  if (n) console.log(`Privacy purge: erased personal data for ${n} past event(s)`);
};
purge();
setInterval(purge, 3600_000).unref();

const app = createApp(db, config);

if (prod) {
  const dist = path.join(ROOT, 'dist');
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { index: false, setHeaders: res => res.set('Cache-Control', 'no-cache') }));
  app.get('*', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = app.listen(port, process.env.HOST ?? '0.0.0.0', () => {
  console.log(`FlowRide running on http://localhost:${port} (${prod ? 'production' : 'development'})`);
  if (!config.adminToken) console.log('Note: ADMIN_TOKEN is not set, so the organiser dashboard is disabled.');
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
