// Edge cases: real-world names and numbers, race conditions, timing boundaries and
// lifecycle surprises (people deleting things mid-flow).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, driver, rider, ADMIN } from './helpers.mjs';
import { normalisePhone } from '../server/phone.ts';
import { fmtTime, fmtDate, fmt12, prettyPhone, waLink, waShare } from '../src/format.ts';

let s, ev;
before(async () => { s = await startServer({ RATE_LIMIT: '100000' }); ev = (await s.api('GET', '/api/events')).json[0]; });
after(() => s?.stop());

let n = 0;
const uniquePhone = () => `07700 9${String(10000 + ++n).slice(-5)}`;
const offer = async (o = {}, eventId = ev.id) => {
  const r = await s.api('POST', `/api/events/${eventId}/offers`, driver({ phone: uniquePhone(), ...o }));
  assert.equal(r.status, 201, r.text); return r.json;
};
const request = (offerId, o = {}) => s.api('POST', `/api/offers/${offerId}/requests`, rider({ phone: uniquePhone(), ...o }));
const me = token => s.api('GET', '/api/me', undefined, token).then(r => r.json);
const newEvent = async (startsInMs, title = 'Edge event') =>
  (await s.api('POST', '/api/admin/events', { title, venue: 'Somewhere', starts_at: new Date(Date.now() + startsInMs).toISOString() }, ADMIN)).json;

describe('Names from a real community', () => {
  for (const name of ['محمد علي', 'Siân Llŷr', 'Zoë O’Brien-Smith', 'Ngozi Okonkwo-Adébáyọ̀', '張偉', 'Aisha 🌙', 'Jo']) test(`accepts "${name}"`, async () => {
    const o = await offer({ name });
    const v = await me(o.token);
    assert.equal(v.offer.name, name.normalize('NFC'));
  });

  test('right-to-left override and zero-width characters are stripped (stops name spoofing)', async () => {
    const o = await offer({ name: 'Admin‮nimda​‍' });
    assert.equal((await me(o.token)).offer.name, 'Adminnimda');
  });

  test('a name made only of invisible characters is rejected', async () => {
    const r = await s.api('POST', `/api/events/${ev.id}/offers`, driver({ name: '​‌⁠﻿', phone: uniquePhone() }));
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Name is required/);
  });

  test('decomposed accents are normalised so "José" is stored one way', async () => {
    const o = await offer({ name: 'José' });
    assert.equal((await me(o.token)).offer.name, 'José');
  });

  test('multi-line notes are flattened to one line', async () => {
    const o = await offer({ notes: 'line one\n\n\tline two' });
    assert.equal((await me(o.token)).offer.notes, 'line one line two');
  });
});

describe('Phone numbers typed every possible way', () => {
  const ok = {
    '٠٧٧٠٠ ٩٠٠١٢٣': '447700900123',   // Arabic-Indic digits (Arabic keyboard)
    '۰۷۷۰۰۹۰۰۱۲۳': '447700900123',    // Persian/Urdu digits
    '０７７００ ９００１２３': '447700900123', // full-width (Chinese/Japanese keyboards)
    '+٤٤ ٧٧٠٠ ٩٠٠١٢٣': '447700900123',
    '+92 300 1234567': '923001234567', // Pakistan
    '+880 1712 345678': '8801712345678', // Bangladesh
    '+353 85 123 4567': '353851234567', // Ireland
    '0161 123 4567': '441611234567',   // Manchester landline (call only)
  };
  for (const [input, want] of Object.entries(ok)) test(`"${input}" → ${want}`, () => assert.equal(normalisePhone(input), want));
  for (const bad of ['07700 900123 ext 2', '+44 7700', '999', '112', '0800 1111', 'call me', '07700900123; DROP']) test(`rejects "${bad}"`, () => assert.equal(normalisePhone(bad), null));

  test('the same person typing their number differently counts as a duplicate', async () => {
    const o = await offer();
    assert.equal((await request(o.id, { phone: '07700 955555' })).status, 201);
    assert.equal((await request(o.id, { phone: '+44 (0)7700-955555' })).status, 409);
    assert.equal((await request(o.id, { phone: '٠٧٧٠٠٩٥٥٥٥٥' })).status, 409);
  });
});

describe('Race conditions', () => {
  test('six riders, three seats, all accepted at the same instant → exactly three get in', async () => {
    const o = await offer({ seats: 3 });
    const reqs = await Promise.all(Array.from({ length: 6 }, () => request(o.id).then(r => r.json)));
    const results = await Promise.all(reqs.map(r => s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token)));
    assert.equal(results.filter(r => r.status === 200).length, 3);
    assert.equal(results.filter(r => r.status === 409).length, 3);
    assert.equal((await me(o.token)).offer.seats_left, 0);
  });

  test('a family of 3 cannot squeeze into the last 2 seats', async () => {
    const o = await offer({ seats: 3 });
    const a = (await request(o.id)).json;
    const fam = (await request(o.id, { passengers: 3 })).json;
    await s.api('POST', `/api/me/requests/${a.id}/accept`, {}, o.token);
    const r = await s.api('POST', `/api/me/requests/${fam.id}/accept`, {}, o.token);
    assert.equal(r.status, 409);
    assert.match(r.json.error, /Not enough seats/);
  });

  test('double-tapped "Send request" creates one request, not two', async () => {
    const o = await offer();
    const body = rider({ phone: uniquePhone() });
    const rs = await Promise.all([1, 2, 3].map(() => s.api('POST', `/api/offers/${o.id}/requests`, body)));
    assert.equal(rs.filter(r => r.status === 201).length, 1);
    assert.equal((await me(o.token)).requests.length, 1);
  });

  test('rider cancels while the driver is accepting: final state is consistent', async () => {
    const o = await offer({ seats: 1 });
    const r = (await request(o.id)).json;
    await Promise.all([s.api('POST', '/api/me/cancel', {}, r.token), s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token)]);
    const v = await me(o.token);
    const st = v.requests[0].status;
    assert.ok(st === 'cancelled' || st === 'accepted');
    assert.equal(v.offer.seats_left, st === 'accepted' ? 0 : 1);
  });
});

describe('Lifecycle surprises', () => {
  test('driver changes their mind after accepting → rider loses the number again', async () => {
    const o = await offer();
    const r = (await request(o.id)).json;
    await s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token);
    assert.ok((await me(r.token)).driver.contact);
    await s.api('POST', `/api/me/requests/${r.id}/decline`, {}, o.token);
    const v = await me(r.token);
    assert.equal(v.request.status, 'declined');
    assert.equal(v.driver.contact, undefined);
  });

  test('rider cancels then asks again → allowed', async () => {
    const o = await offer();
    const phone = uniquePhone();
    const first = (await request(o.id, { phone })).json;
    await s.api('POST', '/api/me/cancel', {}, first.token);
    assert.equal((await request(o.id, { phone })).status, 201);
  });

  test('requesting a lift the driver just deleted', async () => {
    const o = await offer();
    await s.api('DELETE', '/api/me', undefined, o.token);
    const r = await request(o.id);
    assert.equal(r.status, 404);
    assert.match(r.json.error, /no longer available/);
  });

  test('driver accepts a rider who already deleted their data', async () => {
    const o = await offer();
    const r = (await request(o.id)).json;
    await s.api('DELETE', '/api/me', undefined, r.token);
    assert.equal((await s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token)).status, 404);
  });

  test('organiser deletes the event while people hold private links', async () => {
    const e = await newEvent(86400_000, 'Cancelled event');
    const o = await offer({}, e.id);
    const r = (await request(o.id)).json;
    await s.api('DELETE', `/api/admin/events/${e.id}`, undefined, ADMIN);
    assert.equal((await s.api('GET', '/api/me', undefined, o.token)).status, 404);
    assert.equal((await s.api('GET', '/api/me', undefined, r.token)).status, 404);
  });

  test('erasing twice is harmless', async () => {
    const o = await offer();
    assert.equal((await s.api('DELETE', '/api/me', undefined, o.token)).status, 200);
    assert.equal((await s.api('DELETE', '/api/me', undefined, o.token)).status, 404);
  });

  test('riders can be calls-only (WhatsApp unticked)', async () => {
    const o = await offer({ whatsapp: false });
    const r = (await request(o.id, { whatsapp: false })).json;
    const d = await s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token);
    assert.equal(d.json.requests[0].contact.whatsapp, false);
    assert.equal((await me(r.token)).driver.contact.whatsapp, false);
  });
});

describe('Numbers at the limits', () => {
  for (const [label, patch, status] of [
    ['0 passengers', { passengers: 0 }, 400], ['-1 passengers', { passengers: -1 }, 400],
    ['1.5 passengers', { passengers: 1.5 }, 400], ['"2" as text', { passengers: '2' }, 201],
    ['passengers as array', { passengers: [2] }, 400], ['consent as "true" string', { consent: 'true' }, 400],
  ]) test(`request with ${label} → ${status}`, async () => {
    const o = await offer({ seats: 4 });
    assert.equal((await request(o.id, patch)).status, status);
  });
  for (const [t, ok] of [['00:00', true], ['23:59', true], ['24:00', false], ['9:30', false], ['12:60', false], ['noon', false]]) test(`departure "${t}"`, async () => {
    const r = await s.api('POST', `/api/events/${ev.id}/offers`, driver({ depart_time: t, phone: uniquePhone() }));
    assert.equal(r.status, ok ? 201 : 400);
  });
  test('8 seats is the maximum (minibus), 9 is refused', async () => {
    assert.equal((await s.api('POST', `/api/events/${ev.id}/offers`, driver({ seats: 8, phone: uniquePhone() }))).status, 201);
    assert.equal((await s.api('POST', `/api/events/${ev.id}/offers`, driver({ seats: 9, phone: uniquePhone() }))).status, 400);
  });
});

describe('Timing boundaries', () => {
  test('sign-ups close the moment the event starts', async () => {
    const e = await newEvent(1500);
    const o = await offer({}, e.id);
    await new Promise(r => setTimeout(r, 1700));
    assert.equal((await s.api('POST', `/api/events/${e.id}/offers`, driver({ phone: uniquePhone() }))).status, 409);
    assert.equal((await request(o.id)).status, 409);
    // existing matches still work for late arrivals
    assert.equal((await s.api('GET', '/api/me', undefined, o.token)).status, 200);
  });

  test('an event stays listed for 3 hours after it starts, then disappears', async () => {
    const recent = await newEvent(-2 * 3600_000, 'Started 2h ago');
    const old = await newEvent(-4 * 3600_000, 'Started 4h ago');
    const ids = (await s.api('GET', '/api/events')).json.map(e => e.id);
    assert.ok(ids.includes(recent.id));
    assert.ok(!ids.includes(old.id));
  });

  test('purge boundary: 6 days 23 h kept, 7 days 1 h erased, and a second run does nothing', async () => {
    const keep = await newEvent(3600_000, 'keep');
    const drop = await newEvent(3600_000, 'drop');
    const ok = await offer({}, keep.id), gone = await offer({}, drop.id);
    const db = s.db();
    const at = h => new Date(Date.now() - h * 3600_000).toISOString();
    db.prepare('UPDATE events SET starts_at = ? WHERE id = ?').run(at(7 * 24 - 1), keep.id);
    db.prepare('UPDATE events SET starts_at = ? WHERE id = ?').run(at(7 * 24 + 1), drop.id);
    db.close();
    const first = (await s.api('POST', '/api/admin/purge', {}, ADMIN)).json.purged_events;
    assert.ok(first >= 1);
    assert.equal((await s.api('GET', '/api/me', undefined, ok.token)).status, 200);
    assert.equal((await s.api('GET', '/api/me', undefined, gone.token)).status, 404);
    assert.equal((await s.api('POST', '/api/admin/purge', {}, ADMIN)).json.purged_events, 0);
    const page = (await s.api('GET', `/api/events/${drop.id}`)).json;
    assert.deepEqual(page.offers, []);
  });
});

describe('Dates, times and links (UK clocks)', () => {
  test('times show in UK time across the March clock change', () => {
    assert.equal(fmtTime('2026-03-29T00:30:00Z'), '12:30am'); // still GMT
    assert.equal(fmtTime('2026-03-29T01:30:00Z'), '2:30am');  // BST has started
    assert.equal(fmtTime('2026-10-25T00:30:00Z'), '1:30am');  // BST
    assert.equal(fmtTime('2026-10-25T01:30:00Z'), '1:30am');  // GMT again: same wall-clock hour twice
  });
  test('late-evening UTC events land on the right UK date', () => {
    assert.equal(fmtDate('2026-07-03T23:30:00Z'), 'Sat 4 Jul');
    assert.equal(fmtDate('2026-12-31T23:30:00Z'), 'Thu 31 Dec');
  });
  test('12-hour departure times', () => {
    assert.equal(fmt12('00:05'), '12:05am');
    assert.equal(fmt12('12:00'), '12:00pm');
    assert.equal(fmt12('23:59'), '11:59pm');
  });
  test('phone numbers display UK-style', () => {
    assert.equal(prettyPhone('+447700900123'), '07700 900 123');
    assert.equal(prettyPhone('+923001234567'), '+923001234567');
  });
  test('WhatsApp links survive emoji, ampersands and Arabic text', () => {
    const msg = 'Salaam 🌙 & thanks — see you at جامع';
    const u = new URL(waLink('+44 7700 900123', msg));
    assert.equal(u.host, 'wa.me');
    assert.equal(u.pathname, '/447700900123');
    assert.equal(u.searchParams.get('text'), msg);
    assert.equal(new URL(waShare(msg)).searchParams.get('text'), msg);
  });
});

describe('Load', () => {
  test('300 people opening the event link at once all get a fast answer', async () => {
    const t0 = Date.now();
    const rs = await Promise.all(Array.from({ length: 300 }, () => s.api('GET', `/api/events/${ev.id}`)));
    const ms = Date.now() - t0;
    assert.ok(rs.every(r => r.status === 200));
    assert.ok(ms < 5000, `took ${ms}ms`);
  });
});
