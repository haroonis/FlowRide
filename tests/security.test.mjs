// Security tests aligned with UK practice: OWASP ASVS / Top 10, NCSC web guidance,
// UK GDPR Art. 32 (security of processing) and PECR (no cookies without consent).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { startServer, driver, rider, ADMIN } from './helpers.mjs';
import { createVault } from '../server/crypto.ts';
import crypto from 'node:crypto';

let s, ev;
const seen = []; // every JSON body we receive, scanned for leaks at the end
before(async () => {
  s = await startServer();
  ev = (await s.api('GET', '/api/events')).json[0];
  const orig = s.api;
  s.api = async (...a) => { const r = await orig(...a); seen.push(r.text); return r; };
});
after(() => s?.stop());

const offer = async o => (await s.api('POST', `/api/events/${ev.id}/offers`, driver(o))).json;

describe('HTTP security headers (NCSC / OWASP secure headers)', () => {
  for (const path of ['/', '/api/events', '/e/whatever', '/privacy']) test(`headers on ${path}`, async () => {
    const r = await s.api('GET', path);
    const h = k => r.headers.get(k);
    assert.match(h('strict-transport-security'), /max-age=31536000/);
    assert.match(h('content-security-policy'), /default-src 'self'/);
    assert.match(h('content-security-policy'), /frame-ancestors 'none'/);
    assert.doesNotMatch(h('content-security-policy'), /unsafe-eval|script-src[^;]*unsafe-inline/);
    assert.equal(h('x-frame-options'), 'DENY');
    assert.equal(h('x-content-type-options'), 'nosniff');
    assert.equal(h('referrer-policy'), 'no-referrer');
    assert.equal(h('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h('cross-origin-resource-policy'), 'same-origin');
    assert.match(h('permissions-policy'), /geolocation=\(\)/);
    assert.equal(h('x-powered-by'), null);
  });

  test('no cookies are ever set (PECR: nothing needing consent)', async () => {
    for (const p of ['/', '/api/events', '/api/config', `/e/${ev.id}`]) assert.equal((await s.api('GET', p)).headers.get('set-cookie'), null, p);
    const o = await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: '07700 900001' }));
    assert.equal(o.headers.get('set-cookie'), null);
  });

  test('security.txt gives a vulnerability disclosure contact (RFC 9116)', async () => {
    const r = await s.api('GET', '/.well-known/security.txt');
    assert.equal(r.status, 200);
    assert.match(r.text, /^Contact: mailto:/m);
    assert.match(r.text, /^Expires: \d{4}-/m);
  });
});

describe('Cross-site attacks', () => {
  test('no CORS: other websites cannot read the API from a browser', async () => {
    const res = await fetch(s.base + '/api/events', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    const pre = await fetch(s.base + '/api/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'DELETE' } });
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
  });

  test('CSRF: a plain HTML form post cannot create or delete anything', async () => {
    const form = await fetch(`${s.base}/api/events/${ev.id}/offers`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Forged', area: 'x', depart_time: '10:00', seats: '2', phone: '07700900999', consent: 'true', adult: 'true' }),
    });
    assert.equal(form.status, 400);
    const textPlain = await fetch(`${s.base}/api/events/${ev.id}/offers`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(driver()) });
    assert.equal(textPlain.status, 400, 'text/plain JSON must not be parsed');
    assert.equal((await s.api('DELETE', '/api/me')).status, 401, 'deletes need the private link, never an ambient cookie');
  });

  test('pages refuse to be framed (clickjacking)', async () => {
    const r = await s.api('GET', '/organisers');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  });
});

describe('Encryption at rest (UK GDPR Art. 32)', () => {
  test('phone numbers are not stored in plain text', async () => {
    const o = await offer({ phone: '07700 912345' });
    await s.api('POST', `/api/offers/${o.id}/requests`, rider({ phone: '07700 954321' }));
    const db = s.db();
    const dump = JSON.stringify([...db.prepare('SELECT * FROM offers').all(), ...db.prepare('SELECT * FROM requests').all()]);
    db.close();
    assert.ok(!/912345|954321/.test(dump), 'raw phone digits found in database');
    assert.match(dump, /"phone":"v1\./);
  });

  test('same number encrypts differently each time but de-duplicates via keyed hash', async () => {
    const a = await offer({ phone: '07700 977777' });
    const b = await offer({ phone: '07700 977777' });
    const db = s.db();
    const [ra, rb] = [a, b].map(x => db.prepare('SELECT phone, phone_hmac FROM offers WHERE id = ?').get(x.id));
    db.close();
    assert.notEqual(ra.phone, rb.phone);
    assert.equal(ra.phone_hmac, rb.phone_hmac);
    assert.match(ra.phone_hmac, /^[0-9a-f]{64}$/);
  });

  test('ciphertext is tamper-evident and useless with the wrong key', () => {
    const v = createVault(crypto.randomBytes(32));
    const c = v.encrypt('447700900123');
    assert.equal(v.decrypt(c), '447700900123');
    const flipped = c.slice(0, -2) + (c.at(-2) === 'A' ? 'B' : 'A') + c.at(-1);
    assert.throws(() => v.decrypt(flipped));
    assert.throws(() => createVault(crypto.randomBytes(32)).decrypt(c));
    assert.throws(() => createVault(crypto.randomBytes(16)), /32 bytes/);
  });

  test('auto-generated key file is readable by the owner only', async () => {
    const t = await startServer();
    const mode = statSync(t.dbPath + '.key').mode & 0o777;
    await t.stop();
    assert.equal(mode, 0o600);
  });
});

describe('Brute-force protection', () => {
  test('organiser login locks after repeated wrong passwords, even for the right one', async () => {
    const t = await startServer({ ADMIN_MAX_FAILS: '3' });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await t.api('GET', '/api/admin/events', undefined, 'guess' + i)).status);
    codes.push((await t.api('GET', '/api/admin/events', undefined, ADMIN)).status);
    await t.stop();
    assert.deepEqual(codes, [401, 401, 401, 429]);
  });

  test('guessing private links gets blocked', async () => {
    const t = await startServer({ LINK_MAX_FAILS: '5' });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await t.api('GET', '/api/me', undefined, 'o.guess' + i)).status);
    await t.stop();
    assert.deepEqual(codes, [404, 404, 404, 404, 404, 429]);
  });

  test('spoofed X-Forwarded-For does not bypass limits when no proxy is trusted', async () => {
    const t = await startServer({ RATE_LIMIT: '2' });
    const e = (await t.api('GET', '/api/events')).json[0];
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${t.base}/api/events/${e.id}/offers`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i}` }, body: JSON.stringify(driver({ phone: `0770090020${i}` })) });
      codes.push(res.status);
    }
    await t.stop();
    assert.deepEqual(codes, [201, 201, 429, 429]);
  });

  test('a weak organiser password disables the dashboard instead of running insecurely', async () => {
    const t = await startServer({ ADMIN_TOKEN: 'password' });
    const r = await t.api('GET', '/api/admin/events', undefined, 'password');
    const out = t.output();
    await t.stop();
    assert.equal(r.status, 503);
    assert.match(out, /shorter than 16/);
  });
});

describe('Hostile input', () => {
  test('path traversal never exposes source, config or the database', async () => {
    for (const p of ['/../package.json', '/%2e%2e/server/app.ts', '/assets/..%2f..%2fserver%2fapp.ts', '/assets/%2e%2e/%2e%2e/package.json', '/.env', '/flowride.db', '/server/app.ts', '/..%5c..%5cpackage.json']) {
      const res = await fetch(s.base + p);
      const body = await res.text();
      assert.ok(!/createApp|"dependencies"|SQLite format/.test(body), `${p} leaked file contents`);
    }
  });

  test('missing assets and source maps are real 404s', async () => {
    for (const p of ['/assets/nope.js', '/assets/index.js.map']) assert.equal((await fetch(s.base + p)).status, 404, p);
  });

  test('oversized body → 413, not a crash', async () => {
    const r = await s.api('POST', `/api/events/${ev.id}/offers`, driver({ notes: 'x'.repeat(25_000) }));
    assert.equal(r.status, 413);
    assert.ok(s.alive());
  });

  test('prototype-pollution payloads are inert', async () => {
    const body = JSON.stringify({ ...driver({ phone: '07700 900321' }), __proto__: { isAdmin: true }, constructor: { prototype: { isAdmin: true } } })
      .replace('{', '{"__proto__":{"polluted":"yes"},');
    const r = await s.api('POST', `/api/events/${ev.id}/offers`, body);
    assert.ok([201, 400].includes(r.status));
    assert.equal(({}).polluted, undefined);
    const list = await s.api('GET', '/api/events');
    assert.ok(!list.text.includes('polluted'));
    assert.equal((await s.api('GET', '/api/admin/events')).status, 401);
  });

  test('SQL injection strings are stored as plain text', async () => {
    const evil = "Robert'); DROP TABLE offers;--";
    const o = await offer({ name: evil, phone: '07700 900432' });
    const pub = (await s.api('GET', `/api/events/${ev.id}`)).json.offers.find(x => x.id === o.id);
    assert.equal(pub.name, "Robert');");
    const db = s.db();
    assert.ok(db.prepare("SELECT COUNT(*) n FROM offers").get().n > 0);
    db.close();
  });

  test('garbage and huge Authorization headers are handled', async () => {
    for (const t of ['x'.repeat(5000), 'o.' + 'é'.repeat(10), '', 'Bearer']) {
      const res = await fetch(s.base + '/api/me', { headers: { Authorization: 'Bearer ' + encodeURIComponent(t) } });
      assert.ok([401, 404].includes(res.status), String(res.status));
    }
    assert.ok(s.alive());
  });

  test('unexpected methods are rejected', async () => {
    assert.equal((await s.api('PUT', '/api/events', {})).status, 404);
    assert.equal((await s.api('PATCH', `/api/events/${ev.id}`, {})).status, 404);
    const trace = await fetch(s.base + '/', { method: 'TRACE' }).catch(() => null);
    assert.ok(!trace || trace.status !== 200 || !(await trace.text()).includes('TRACE'));
  });

  test('errors never reveal stack traces or file paths', async () => {
    const rs = await Promise.all([
      s.api('POST', `/api/events/${ev.id}/offers`, '{bad json'),
      s.api('GET', '/api/events/missing'),
      s.api('POST', '/api/me/requests/x/accept', {}, 'r.nope'),
    ]);
    for (const r of rs) assert.ok(!/at .*\.(ts|js):\d+|node_modules|\/home\//.test(r.text), r.text);
  });
});

describe('No data leaks', () => {
  test('no API response ever contains hashes, ciphertext or token hashes', async () => {
    const o = await offer({ phone: '07700 900543' });
    const r = (await s.api('POST', `/api/offers/${o.id}/requests`, rider({ phone: '07700 900654' }))).json;
    await s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token);
    await s.api('GET', '/api/me', undefined, o.token);
    await s.api('GET', '/api/me', undefined, r.token);
    await s.api('GET', '/api/me/export', undefined, r.token);
    await s.api('GET', `/api/admin/events/${ev.id}`, undefined, ADMIN);
    for (const body of seen) assert.ok(!/phone_hmac|token_hash|"v1\.[A-Za-z0-9_-]{20}/.test(body), body.slice(0, 200));
  });

  test('server logs contain no names or phone numbers', () => {
    const out = s.output();
    assert.ok(!/7700|Usman|Fatima|Farooq|Siddiqui/.test(out), out);
  });
});
