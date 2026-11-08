// Online SQLite backup, keeping only the last N days (matches the data retention period).
// Phone numbers stay encrypted inside the backup; the key is not stored with it.
import Database from 'better-sqlite3';
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const [db, dir, days = '7'] = process.argv.slice(2);
const stamp = new Date().toISOString().slice(0, 10);
const out = path.join(dir, `flowride-${stamp}.db`);
await new Database(db, { readonly: true, fileMustExist: true }).backup(out);
const cutoff = Date.now() - Number(days) * 86400_000;
for (const f of readdirSync(dir)) if (f.endsWith('.db') && statSync(path.join(dir, f)).mtimeMs < cutoff) rmSync(path.join(dir, f));
console.log(`Backup written: ${out}`);
