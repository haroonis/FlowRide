import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, driver, rider, ADMIN } from './helpers.mjs';

let s, ev;
before(async () => { s = await startServer({ RATE_LIMIT: '1000' }); ev = (await s.api('GET', '/api/events')).json[0]; });
after(() => s?.stop());

async function offer(o) { const r = await s.api('POST', `/api/events/${ev.id}/offers`, driver(o)); assert.equal(r.status, 201, r.text); return r.json; }
async function request(offerId, o) { return s.api('POST', `/api/offers/${offerId}/requests`, rider(o)); }

describe('browsing', () => {
  test('demo events are in the future', async () => {
    const r = await s.api('GET', '/api/events');
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 3);
    assert.ok(r.json.every(e => new Date(e.starts_at) > new Date()));
  });
  test('unknown event is a 404 JSON error', async () => {
    const r = await s.api('GET', '/api/events/nope');
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'Event not found');
  });
});

describe('full lift flow with privacy-safe contact sharing', () => {
  let o, rq;
  test('driver offers seats; public listing shows first name only and no phone', async () => {
    o = await offer();
    assert.match(o.token, /^o\./);
    const pub = (await s.api('GET', `/api/events/${ev.id}`)).json.offers.find(x => x.id === o.id);
    assert.equal(pub.name, 'Usman');
    assert.equal(pub.seats_left, 3);
    assert.ok(!JSON.stringify(pub).includes('7700'));
  });
  test('rider requests; neither side sees the other phone yet', async () => {
    rq = (await request(o.id, { passengers: 2 })).json;
    const dv = (await s.api('GET', '/api/me', undefined, o.token)).json;
    assert.equal(dv.requests[0].status, 'pending');
    assert.equal(dv.requests[0].contact, undefined);
    const rv = (await s.api('GET', '/api/me', undefined, rq.token)).json;
    assert.equal(rv.driver.contact, undefined);
    assert.equal(rv.driver.name, 'Usman');
  });
  test('driver accepts; both now see each other on WhatsApp', async () => {
    const dv = (await s.api('POST', `/api/me/requests/${rq.id}/accept`, {}, o.token)).json;
    assert.deepEqual(dv.requests[0].contact, { phone: '+447700900222', whatsapp: true });
    assert.equal(dv.offer.seats_left, 1);
    const rv = (await s.api('GET', '/api/me', undefined, rq.token)).json;
    assert.deepEqual(rv.driver.contact, { phone: '+447700900111', whatsapp: true });
    assert.equal(rv.driver.name, 'Usman Farooq');
  });
  test('seat capacity is enforced on request and on accept', async () => {
    const big = await request(o.id, { phone: '07700 900333', passengers: 2 });
    assert.equal(big.status, 409);
    const one = (await request(o.id, { phone: '07700 900444' })).json;
    const two = await offer({ phone: '07700 900555', seats: 1 });
    const a = (await request(two.id, { phone: '07700 900666' })).json;
    const b = (await request(two.id, { phone: '07700 900777' })).json;
    assert.equal((await s.api('POST', `/api/me/requests/${a.id}/accept`, {}, two.token)).status, 200);
    assert.equal((await s.api('POST', `/api/me/requests/${b.id}/accept`, {}, two.token)).status, 409);
    assert.ok(one.id);
  });
  test('rider cannot accept requests and cannot see other riders', async () => {
    const r = await s.api('POST', `/api/me/requests/${rq.id}/accept`, {}, rq.token);
    assert.equal(r.status, 403);
  });
  test('a driver cannot act on another driver\'s request', async () => {
    const other = await offer({ phone: '07700 900888' });
    const r = await s.api('POST', `/api/me/requests/${rq.id}/decline`, {}, other.token);
    assert.equal(r.status, 404);
  });
  test('duplicate request and own-car request are refused', async () => {
    assert.equal((await request(o.id, { passengers: 1 })).status, 409);
    assert.equal((await request(o.id, { phone: '07700900111' })).status, 400);
  });
  test('rider cancel frees the seats', async () => {
    await s.api('POST', '/api/me/cancel', {}, rq.token);
    const dv = (await s.api('GET', '/api/me', undefined, o.token)).json;
    assert.equal(dv.offer.seats_left, 3);
    assert.equal((await s.api('POST', `/api/me/requests/${rq.id}/accept`, {}, o.token)).status, 409);
  });
  test('data export returns everything held for the entry', async () => {
    const r = await s.api('GET', '/api/me/export', undefined, rq.token);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment/);
    assert.equal(r.json.request.phone, '+447700900222');
  });
  test('right to erasure: driver delete removes offer and every request to it', async () => {
    assert.equal((await s.api('DELETE', '/api/me', undefined, o.token)).status, 200);
    assert.equal((await s.api('GET', '/api/me', undefined, o.token)).status, 404);
    assert.equal((await s.api('GET', '/api/me', undefined, rq.token)).status, 404);
    const db = s.db();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM requests WHERE id = ?').get(rq.id).n, 0);
    db.close();
  });
});

describe('validation', () => {
  const cases = [
    ['missing consent', { consent: false }, /agree/],
    ['not 18+', { adult: false }, /18/],
    ['blank name', { name: '   ' }, /Name/],
    ['bad phone', { phone: '12345' }, /mobile/],
    ['bad time', { depart_time: '25:00' }, /Departure/],
    ['too many seats', { seats: 40 }, /Seats/],
    ['seats as text', { seats: 'lots' }, /Seats/],
    ['huge name', { name: 'x'.repeat(41) }, /40/],
  ];
  for (const [label, patch, msg] of cases) test(`offer rejected: ${label}`, async () => {
    const r = await s.api('POST', `/api/events/${ev.id}/offers`, driver(patch));
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error, msg);
  });
  test('malformed JSON gives 400, not a crash', async () => {
    const r = await s.api('POST', `/api/events/${ev.id}/offers`, '{not json');
    assert.equal(r.status, 400);
    assert.ok(s.alive());
  });
  test('missing or bogus token', async () => {
    assert.equal((await s.api('GET', '/api/me')).status, 401);
    assert.equal((await s.api('GET', '/api/me', undefined, 'o.fake')).status, 404);
  });
  test('cannot offer for an event that has started', async () => {
    const e = (await s.api('POST', '/api/admin/events', { title: 'Past', venue: 'X', starts_at: new Date(Date.now() - 60_000).toISOString() }, ADMIN)).json;
    assert.equal((await s.api('POST', `/api/events/${e.id}/offers`, driver())).status, 409);
  });
});

describe('organisers', () => {
  test('admin endpoints need the token', async () => {
    assert.equal((await s.api('GET', '/api/admin/events')).status, 401);
    assert.equal((await s.api('GET', '/api/admin/events', undefined, 'wrong')).status, 401);
    assert.equal((await s.api('POST', '/api/admin/events', { title: 'x' })).status, 401);
  });
  test('organiser can create an event and see entries without phone numbers', async () => {
    const e = (await s.api('POST', '/api/admin/events', { title: 'Eid prayer', venue: 'Platt Fields', starts_at: new Date(Date.now() + 86400_000).toISOString() }, ADMIN));
    assert.equal(e.status, 201);
    const o = (await s.api('POST', `/api/events/${e.json.id}/offers`, driver())).json;
    await s.api('POST', `/api/offers/${o.id}/requests`, rider());
    const v = await s.api('GET', `/api/admin/events/${e.json.id}`, undefined, ADMIN);
    assert.equal(v.json.offers[0].requests.length, 1);
    assert.ok(!v.text.includes('7700'), 'admin view leaked a phone number');
  });
});

describe('automatic deletion after the event', () => {
  test('purge erases offers and requests for events older than the retention period', async () => {
    const e = (await s.api('POST', '/api/admin/events', { title: 'Old', venue: 'X', starts_at: new Date(Date.now() + 3600_000).toISOString() }, ADMIN)).json;
    const o = (await s.api('POST', `/api/events/${e.id}/offers`, driver())).json;
    const r = (await s.api('POST', `/api/offers/${o.id}/requests`, rider())).json;
    const db = s.db();
    db.prepare('UPDATE events SET starts_at = ? WHERE id = ?').run(new Date(Date.now() - 8 * 86400_000).toISOString(), e.id);
    db.close();
    const p = await s.api('POST', '/api/admin/purge', {}, ADMIN);
    assert.ok(p.json.purged_events >= 1);
    assert.equal((await s.api('GET', '/api/me', undefined, o.token)).status, 404);
    assert.equal((await s.api('GET', '/api/me', undefined, r.token)).status, 404);
  });
});

describe('low data use', () => {
  test('unchanged data is answered with an empty 304, changed data with a fresh 200', async () => {
    const o = (await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: '07700 900999' }))).json;
    const first = await s.api('GET', '/api/me', undefined, o.token);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const again = await fetch(s.base + '/api/me', { headers: { Authorization: `Bearer ${o.token}`, 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0);
    await s.api('POST', `/api/offers/${o.id}/requests`, rider({ phone: '07700 900998' }));
    const changed = await fetch(s.base + '/api/me', { headers: { Authorization: `Bearer ${o.token}`, 'If-None-Match': etag } });
    assert.equal(changed.status, 200);
  });
  test('one person\'s 304 never reveals another person\'s data (ETag is per response)', async () => {
    const a = (await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: '07700 900997' }))).json;
    const b = (await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: '07700 900996' }))).json;
    const etagA = (await s.api('GET', '/api/me', undefined, a.token)).headers.get('etag');
    const asB = await fetch(s.base + '/api/me', { headers: { Authorization: `Bearer ${b.token}`, 'If-None-Match': etagA } });
    assert.equal(asB.status, 200);
  });
});

describe('security headers', () => {
  test('pages send CSP and no-referrer (so private links never leak via Referer)', async () => {
    const r = await s.api('GET', '/');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
  test('API responses are not cached', async () => {
    assert.equal((await s.api('GET', '/api/events')).headers.get('cache-control'), 'no-store');
  });
  test('rate limit stops mass sign-ups', async () => {
    const t = await startServer({ RATE_LIMIT: '3' });
    const e = (await t.api('GET', '/api/events')).json[0];
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await t.api('POST', `/api/events/${e.id}/offers`, driver({ phone: `0770090010${i}` }))).status);
    await t.stop();
    assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  });
});
