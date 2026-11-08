import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import type { DB } from './db.ts';
import { purgeExpired } from './db.ts';
import { normalisePhone } from './phone.ts';

export interface Config {
  adminToken: string | null;
  retentionDays: number;
  controllerName: string;
  privacyEmail: string;
  publicUrl: string;
  rateLimit: number; // create actions per IP per 10 minutes
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// ---------- small helpers ----------

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function newId(len = 10) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}
const newToken = (kind: 'o' | 'r') => `${kind}.${crypto.randomBytes(24).toString('base64url')}`;
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function text(v: unknown, field: string, { min = 1, max = 80 } = {}): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < min) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return s;
}
function optionalText(v: unknown, field: string, max: number): string {
  if (v == null || v === '') return '';
  return text(v, field, { min: 0, max });
}
function int(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
    throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}`);
  return n;
}
function phone(v: unknown): string {
  const p = normalisePhone(v);
  if (!p) throw new HttpError(400, 'Enter a valid mobile number, e.g. 07700 900123');
  return p;
}
function requireTrue(v: unknown, message: string) {
  if (v !== true) throw new HttpError(400, message);
}
const firstName = (name: string) => name.split(' ')[0];

// ---------- row types ----------

interface EventRow { id: string; title: string; venue: string; address: string; starts_at: string; description: string; purged_at: string | null }
interface OfferRow { id: string; event_id: string; name: string; area: string; depart_time: string; seats: number; notes: string; phone: string; whatsapp: number; created_at: string }
interface RequestRow { id: string; offer_id: string; name: string; area: string; passengers: number; message: string; phone: string; whatsapp: number; status: string; created_at: string; updated_at: string }

const publicEvent = (e: EventRow) => ({
  id: e.id, title: e.title, venue: e.venue, address: e.address,
  starts_at: e.starts_at, description: e.description,
});

export function createApp(db: DB, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  // Security + privacy headers. no-referrer stops manage links leaking to WhatsApp etc.
  app.use((_req, res, next) => {
    if (process.env.NODE_ENV === 'production') res.set('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.set({
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    });
    next();
  });
  app.use('/api', express.json({ limit: '20kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // In-memory rate limit for actions that create data. Nothing is persisted.
  const hits = new Map<string, { n: number; reset: number }>();
  const limited = (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 10 * 60_000 });
    else if (++h.n > config.rateLimit) return next(new HttpError(429, 'Too many requests, please try again in a few minutes'));
    next();
  };
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();

  const q = {
    event: db.prepare(`SELECT * FROM events WHERE id = ?`),
    upcoming: db.prepare(`SELECT * FROM events WHERE starts_at > ? ORDER BY starts_at`),
    offersFor: db.prepare(`SELECT * FROM offers WHERE event_id = ? ORDER BY depart_time, created_at`),
    offer: db.prepare(`SELECT * FROM offers WHERE id = ?`),
    seatsTaken: db.prepare(`SELECT COALESCE(SUM(passengers),0) AS n FROM requests WHERE offer_id = ? AND status = 'accepted'`),
    requestsFor: db.prepare(`SELECT * FROM requests WHERE offer_id = ? ORDER BY created_at`),
    offerByToken: db.prepare(`SELECT * FROM offers WHERE token_hash = ?`),
    requestByToken: db.prepare(`SELECT * FROM requests WHERE token_hash = ?`),
  };
  const seatsLeft = (o: OfferRow) => o.seats - (q.seatsTaken.get(o.id) as { n: number }).n;
  const getEvent = (id: string) => {
    const e = q.event.get(id) as EventRow | undefined;
    if (!e) throw new HttpError(404, 'Event not found');
    return e;
  };
  const assertOpen = (e: EventRow) => {
    if (new Date(e.starts_at).getTime() < Date.now()) throw new HttpError(409, 'This event has already started');
  };
  const contact = (row: { phone: string; whatsapp: number }) => ({ phone: '+' + row.phone, whatsapp: !!row.whatsapp });

  // ---------- public ----------

  app.get('/api/config', (_req, res) => {
    res.json({
      controllerName: config.controllerName, privacyEmail: config.privacyEmail,
      retentionDays: config.retentionDays, publicUrl: config.publicUrl,
    });
  });

  app.get('/api/events', (_req, res) => {
    const since = new Date(Date.now() - 3 * 3600_000).toISOString(); // keep showing for 3h after start
    const rows = q.upcoming.all(since) as EventRow[];
    res.json(rows.map(e => {
      const offers = q.offersFor.all(e.id) as OfferRow[];
      return { ...publicEvent(e), drivers: offers.length, seats_left: offers.reduce((s, o) => s + Math.max(0, seatsLeft(o)), 0) };
    }));
  });

  app.get('/api/events/:id', (req, res) => {
    const e = getEvent(req.params.id);
    const offers = (q.offersFor.all(e.id) as OfferRow[]).map(o => ({
      id: o.id, name: firstName(o.name), area: o.area, depart_time: o.depart_time,
      seats: o.seats, seats_left: Math.max(0, seatsLeft(o)), notes: o.notes,
    }));
    res.json({ ...publicEvent(e), offers });
  });

  app.post('/api/events/:id/offers', limited, (req, res) => {
    const e = getEvent(req.params.id);
    assertOpen(e);
    const b = req.body ?? {};
    requireTrue(b.consent, 'Please agree to share your number with riders you accept');
    requireTrue(b.adult, 'You must be 18 or over to offer a lift');
    const depart = text(b.depart_time, 'Departure time', { max: 5 });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(depart)) throw new HttpError(400, 'Departure time must look like 12:30');
    const row = {
      id: newId(), event_id: e.id,
      name: text(b.name, 'Name', { max: 40 }),
      area: text(b.area, 'Area', { max: 40 }),
      depart_time: depart,
      seats: int(b.seats, 'Seats', 1, 8),
      notes: optionalText(b.notes, 'Notes', 200),
      phone: phone(b.phone),
      whatsapp: b.whatsapp === false ? 0 : 1,
    };
    const token = newToken('o');
    db.prepare(`INSERT INTO offers (id,event_id,name,area,depart_time,seats,notes,phone,whatsapp,token_hash)
      VALUES (@id,@event_id,@name,@area,@depart_time,@seats,@notes,@phone,@whatsapp,@token_hash)`)
      .run({ ...row, token_hash: hash(token) });
    res.status(201).json({ id: row.id, token });
  });

  app.post('/api/offers/:id/requests', limited, (req, res) => {
    const o = q.offer.get(req.params.id) as OfferRow | undefined;
    if (!o) throw new HttpError(404, 'This lift is no longer available');
    assertOpen(getEvent(o.event_id));
    const b = req.body ?? {};
    requireTrue(b.consent, 'Please agree to share your number with the driver if they accept');
    requireTrue(b.adult, 'You must be 18 or over to request a lift');
    const passengers = int(b.passengers ?? 1, 'Passengers', 1, 8);
    if (passengers > seatsLeft(o)) throw new HttpError(409, `Only ${Math.max(0, seatsLeft(o))} seat(s) left in this car`);
    const p = phone(b.phone);
    if (p === o.phone) throw new HttpError(400, "You can't request a seat in your own car");
    const dup = db.prepare(`SELECT 1 FROM requests WHERE offer_id = ? AND phone = ? AND status IN ('pending','accepted')`).get(o.id, p);
    if (dup) throw new HttpError(409, 'You have already requested this lift');
    const id = newId();
    const token = newToken('r');
    db.prepare(`INSERT INTO requests (id,offer_id,name,area,passengers,message,phone,whatsapp,token_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, o.id, text(b.name, 'Name', { max: 40 }), text(b.area, 'Area', { max: 40 }), passengers,
      optionalText(b.message, 'Message', 200), p, b.whatsapp === false ? 0 : 1, hash(token));
    res.status(201).json({ id, token });
  });

  // ---------- "my booking" (authorised by the private link token) ----------

  type Owner = { kind: 'offer'; row: OfferRow } | { kind: 'request'; row: RequestRow };
  function owner(req: Request): Owner {
    const m = /^Bearer\s+(\S+)$/.exec(req.get('authorization') ?? '');
    if (!m) throw new HttpError(401, 'Missing link token');
    const h = hash(m[1]);
    const offer = q.offerByToken.get(h) as OfferRow | undefined;
    if (offer) return { kind: 'offer', row: offer };
    const request = q.requestByToken.get(h) as RequestRow | undefined;
    if (request) return { kind: 'request', row: request };
    throw new HttpError(404, 'This link has expired or the entry was deleted');
  }

  function describe(o: Owner) {
    if (o.kind === 'offer') {
      const offer = o.row;
      const event = getEvent(offer.event_id);
      const requests = (q.requestsFor.all(offer.id) as RequestRow[]).map(r => ({
        id: r.id, name: r.name, area: r.area, passengers: r.passengers, message: r.message,
        status: r.status, created_at: r.created_at,
        ...(r.status === 'accepted' ? { contact: contact(r) } : {}),
      }));
      const { phone: ph, whatsapp, ...rest } = offer;
      return {
        kind: 'offer', event: publicEvent(event),
        offer: { ...rest, phone: '+' + ph, whatsapp: !!whatsapp, seats_left: seatsLeft(offer) },
        requests,
      };
    }
    const r = o.row;
    const offer = q.offer.get(r.offer_id) as OfferRow;
    const event = getEvent(offer.event_id);
    const { phone: ph, whatsapp, offer_id, ...rest } = r;
    return {
      kind: 'request', event: publicEvent(event),
      request: { ...rest, phone: '+' + ph, whatsapp: !!whatsapp },
      driver: {
        name: r.status === 'accepted' ? offer.name : firstName(offer.name),
        area: offer.area, depart_time: offer.depart_time, notes: offer.notes,
        seats_left: Math.max(0, seatsLeft(offer)),
        ...(r.status === 'accepted' ? { contact: contact(offer) } : {}),
      },
    };
  }

  app.get('/api/me', (req, res) => res.json(describe(owner(req))));

  app.get('/api/me/export', (req, res) => {
    const o = owner(req);
    res.set('Content-Disposition', 'attachment; filename="flowride-my-data.json"');
    res.json({ exported_at: new Date().toISOString(), note: 'All personal data FlowRide holds for this entry.', ...describe(o) });
  });

  app.post('/api/me/requests/:id/:action(accept|decline)', (req, res) => {
    const o = owner(req);
    if (o.kind !== 'offer') throw new HttpError(403, 'Only the driver can do this');
    const tx = db.transaction(() => {
      const r = db.prepare(`SELECT * FROM requests WHERE id = ? AND offer_id = ?`).get(req.params.id, o.row.id) as RequestRow | undefined;
      if (!r) throw new HttpError(404, 'Request not found');
      if (r.status === 'cancelled') throw new HttpError(409, 'The rider cancelled this request');
      if (req.params.action === 'accept') {
        if (r.status === 'accepted') return;
        if (r.passengers > seatsLeft(o.row)) throw new HttpError(409, 'Not enough seats left to accept this request');
      }
      db.prepare(`UPDATE requests SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(req.params.action === 'accept' ? 'accepted' : 'declined', r.id);
    });
    tx();
    res.json(describe(o));
  });

  app.post('/api/me/cancel', (req, res) => {
    const o = owner(req);
    if (o.kind !== 'request') throw new HttpError(400, 'Drivers can withdraw by deleting their lift');
    db.prepare(`UPDATE requests SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(o.row.id);
    res.json(describe(owner(req)));
  });

  // Right to erasure: removes the entry and (for drivers) every request made to it.
  app.delete('/api/me', (req, res) => {
    const o = owner(req);
    db.prepare(o.kind === 'offer' ? `DELETE FROM offers WHERE id = ?` : `DELETE FROM requests WHERE id = ?`).run(o.row.id);
    res.json({ deleted: true });
  });

  // ---------- organiser / admin ----------

  const admin = (req: Request, _res: Response, next: NextFunction) => {
    if (!config.adminToken) return next(new HttpError(503, 'Admin is disabled: set ADMIN_TOKEN on the server'));
    const given = Buffer.from(/^Bearer\s+(.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '');
    const want = Buffer.from(config.adminToken);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return next(new HttpError(401, 'Wrong admin password'));
    next();
  };

  app.get('/api/admin/events', admin, (_req, res) => {
    const rows = db.prepare(`
      SELECT e.*, (SELECT COUNT(*) FROM offers o WHERE o.event_id = e.id) AS drivers,
        (SELECT COUNT(*) FROM requests r JOIN offers o ON o.id = r.offer_id WHERE o.event_id = e.id) AS requests
      FROM events e ORDER BY starts_at DESC`).all();
    res.json(rows);
  });

  app.post('/api/admin/events', admin, (req, res) => {
    const b = req.body ?? {};
    const starts = new Date(text(b.starts_at, 'Start time', { max: 40 }));
    if (Number.isNaN(starts.getTime())) throw new HttpError(400, 'Start time is not a valid date');
    const id = newId(8);
    db.prepare(`INSERT INTO events (id,title,venue,address,starts_at,description) VALUES (?,?,?,?,?,?)`).run(
      id, text(b.title, 'Title', { max: 100 }), text(b.venue, 'Venue', { max: 100 }),
      optionalText(b.address, 'Address', 200), starts.toISOString(), optionalText(b.description, 'Description', 1000));
    res.status(201).json(publicEvent(getEvent(id)));
  });

  app.delete('/api/admin/events/:id', admin, (req, res) => {
    getEvent(req.params.id);
    db.prepare(`DELETE FROM events WHERE id = ?`).run(req.params.id);
    res.json({ deleted: true });
  });

  // Organisers see who is travelling, but never phone numbers (data minimisation).
  app.get('/api/admin/events/:id', admin, (req, res) => {
    const e = getEvent(req.params.id);
    const offers = (q.offersFor.all(e.id) as OfferRow[]).map(o => ({
      id: o.id, name: o.name, area: o.area, depart_time: o.depart_time, seats: o.seats,
      seats_left: seatsLeft(o), notes: o.notes,
      requests: (q.requestsFor.all(o.id) as RequestRow[]).map(r => ({
        id: r.id, name: r.name, area: r.area, passengers: r.passengers, status: r.status,
      })),
    }));
    res.json({ ...publicEvent(e), purged_at: e.purged_at, offers });
  });

  app.delete('/api/admin/offers/:id', admin, (req, res) => {
    const r = db.prepare(`DELETE FROM offers WHERE id = ?`).run(req.params.id);
    if (!r.changes) throw new HttpError(404, 'Not found');
    res.json({ deleted: true });
  });
  app.delete('/api/admin/requests/:id', admin, (req, res) => {
    const r = db.prepare(`DELETE FROM requests WHERE id = ?`).run(req.params.id);
    if (!r.changes) throw new HttpError(404, 'Not found');
    res.json({ deleted: true });
  });
  app.post('/api/admin/purge', admin, (_req, res) => {
    res.json({ purged_events: purgeExpired(db, config.retentionDays) });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // JSON errors only; never echo request bodies (they contain personal data).
  app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error('Unexpected error:', err?.message);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
