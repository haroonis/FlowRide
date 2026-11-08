import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const Database = require('better-sqlite3');
export const ADMIN = 'test-admin-token';

export function loadPlaywright() {
  for (const base of [import.meta.url, (process.env.NODE_PATH ?? '') + '/', '/opt/node-tools/node_modules/']) {
    try { return createRequire(base)('playwright'); } catch {}
  }
  return null;
}

let nextPort = 3400 + Math.floor(Math.random() * 500);

/** Start the real server on a free port with a throwaway database. */
export async function startServer(env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'flowride-'));
  const port = nextPort++;
  const proc = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(ROOT, 'server', 'index.ts')], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(dir, 'test.db'), ADMIN_TOKEN: ADMIN, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', d => (out += d)); proc.stderr.on('data', d => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('server exited:\n' + out);
    try { if ((await fetch(base + '/api/config')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const api = async (method, url, body, token) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    base, api, output: () => out,
    alive: () => proc.exitCode === null,
    db: () => new Database(path.join(dir, 'test.db')),
    async stop() { proc.kill('SIGTERM'); await new Promise(r => proc.exitCode !== null ? r() : proc.on('exit', r)); rmSync(dir, { recursive: true, force: true }); },
  };
}

export const driver = (o = {}) => ({ name: 'Usman Farooq', area: 'Chorlton', depart_time: '12:40', seats: 3, phone: '07700 900111', consent: true, adult: true, ...o });
export const rider = (o = {}) => ({ name: 'Fatima Siddiqui', area: 'Withington', passengers: 1, phone: '07700 900222', consent: true, adult: true, ...o });
