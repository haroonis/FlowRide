// Portable acceptance tests for any FlowRide implementation.
// Point at a running server:  FLOWRIDE_URL=http://localhost:3000 npm test
// These cover the core user flows from the README: "ride sharing for local events".
// Expected API (same shape as haroonis/FlowRide2):
//   GET  /api/events                     -> [{ id, title, location, arrival_time }]
//   POST /api/participants               -> { id }
//   GET  /api/events/:id/participants    -> [participant]
//   POST /api/matches                    -> { id }
//   POST /api/matches/:id/respond        -> { success }
//   DELETE /api/participants/:id         -> { success }
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.FLOWRIDE_URL;
const skip = BASE ? false : 'no app in this repo yet. Set FLOWRIDE_URL to run against a server';

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

describe('FlowRide acceptance: core user flows', { skip }, () => {
  let event, driverId, riderId, matchId;

  test('1. visitor can browse upcoming events', async () => {
    const r = await api('GET', '/api/events');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json) && r.json.length > 0, 'no events');
    event = r.json[0];
    for (const k of ['id', 'title', 'location', 'arrival_time']) assert.ok(k in event, `event missing ${k}`);
  });

  test('2. driver can offer seats for an event', async () => {
    const r = await api('POST', '/api/participants', { event_id: event.id, name: 'Accept Driver', location: 'M14', role: 'driver', spaces: 3 });
    assert.equal(r.status, 200);
    driverId = r.json.id;
    assert.ok(driverId);
  });

  test('3. rider can request a lift', async () => {
    const r = await api('POST', '/api/participants', { event_id: event.id, name: 'Accept Rider', location: 'M20', role: 'rider', plus_ones: 1 });
    assert.equal(r.status, 200);
    riderId = r.json.id;
    assert.ok(riderId);
  });

  test('4. organiser sees both on the event', async () => {
    const r = await api('GET', `/api/events/${event.id}/participants`);
    const ids = r.json.map(p => p.id);
    assert.ok(ids.includes(driverId) && ids.includes(riderId));
  });

  test('5. organiser matches driver and rider', async () => {
    const r = await api('POST', '/api/matches', { event_id: event.id, driver_id: driverId, rider_id: riderId });
    assert.equal(r.status, 200);
    matchId = r.json.id;
    assert.ok(matchId);
  });

  test('6. rider accepts the match', async () => {
    const r = await api('POST', `/api/matches/${matchId}/respond`, { status: 'accepted' });
    assert.equal(r.status, 200);
  });

  test('7. user can be deleted (GDPR right to be forgotten)', async () => {
    for (const id of [riderId, driverId]) assert.equal((await api('DELETE', `/api/participants/${id}`)).status, 200);
    const r = await api('GET', `/api/events/${event.id}/participants`);
    assert.ok(!r.json.some(p => p.id === riderId || p.id === driverId));
  });

  test('8. invalid sign-up is rejected with 400', async () => {
    const r = await api('POST', '/api/participants', { event_id: event.id, role: 'pilot' });
    assert.equal(r.status, 400);
  });
});
