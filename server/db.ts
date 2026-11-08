import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      venue TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,          -- ISO 8601, UTC
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      purged_at TEXT                     -- set once personal data has been erased
    );

    -- A driver offering seats for an event.
    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      area TEXT NOT NULL,                -- postcode district / neighbourhood only
      depart_time TEXT NOT NULL,         -- HH:MM, local time
      seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 8),
      notes TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL,               -- E.164 digits, shown only to accepted riders
      whatsapp INTEGER NOT NULL DEFAULT 1,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- A rider asking for a seat in a specific offer.
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      area TEXT NOT NULL,
      passengers INTEGER NOT NULL CHECK (passengers BETWEEN 1 AND 8),
      message TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL,               -- shown to the driver only after they accept
      whatsapp INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','accepted','declined','cancelled')),
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS offers_event ON offers(event_id);
    CREATE INDEX IF NOT EXISTS requests_offer ON requests(offer_id);
  `);
  return db;
}

/** Erase all personal data for events that ended more than `days` ago. */
export function purgeExpired(db: DB, days: number, now = new Date()): number {
  const cutoff = new Date(now.getTime() - days * 86400_000).toISOString();
  const ids = db.prepare(`SELECT id FROM events WHERE starts_at < ? AND purged_at IS NULL`).all(cutoff) as { id: string }[];
  const tx = db.transaction(() => {
    for (const { id } of ids) {
      db.prepare(`DELETE FROM offers WHERE event_id = ?`).run(id); // requests cascade
      db.prepare(`UPDATE events SET purged_at = ? WHERE id = ?`).run(now.toISOString(), id);
    }
  });
  tx();
  return ids.length;
}
