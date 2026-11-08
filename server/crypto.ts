import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Field-level encryption for phone numbers (UK GDPR Art. 32 "encryption of personal data").
 * A stolen database file or backup is useless without the key, which lives elsewhere.
 */
export interface Vault {
  encrypt(plain: string): string;
  decrypt(stored: string): string;
  /** Deterministic keyed hash, used to spot duplicates without decrypting. */
  blindIndex(plain: string): string;
}

export function createVault(masterKey: Buffer): Vault {
  if (masterKey.length !== 32) throw new Error('DATA_KEY must be 32 bytes (base64-encoded)');
  const encKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), 'flowride:enc:v1', 32));
  const macKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), 'flowride:mac:v1', 32));
  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
    },
    decrypt(stored) {
      if (!stored.startsWith('v1.')) throw new Error('Unknown ciphertext format');
      const buf = Buffer.from(stored.slice(3), 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', encKey, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
    },
    blindIndex(plain) {
      return crypto.createHmac('sha256', macKey).update(plain).digest('hex');
    },
  };
}

/** DATA_KEY env (base64) wins; otherwise a key file is created once with owner-only permissions. */
export function loadKey(envKey: string | undefined, keyFile: string): Buffer {
  if (envKey) return Buffer.from(envKey, 'base64');
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Created encryption key at ${keyFile}. Back it up separately from the database.`);
  return key;
}
