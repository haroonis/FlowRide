/**
 * Normalise a phone number to international digits (no "+"), as used by
 * wa.me links. UK numbers like "07700 900123" become "447700900123".
 * Returns null when the input can't be a real number.
 */
export function normalisePhone(input: unknown, defaultCountry = '44'): string | null {
  if (typeof input !== 'string') return null;
  let s = toAsciiDigits(input).trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(s)) return null;
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith('0')) s = defaultCountry + s.slice(1);
  if (s.startsWith('440')) s = '44' + s.slice(3); // "+44 (0)7700..." typed literally
  if (s.length < 10 || s.length > 15) return null;
  if (s.startsWith('44') && s.length !== 12) return null;
  return s;
}

/** Arabic-Indic (٠-٩), Persian/Urdu (۰-۹), Devanagari and full-width digits → 0-9. */
export function toAsciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\uFF10-\uFF19]/g, ch => {
    const c = ch.charCodeAt(0);
    for (const base of [0x0660, 0x06f0, 0x0966, 0xff10]) if (c >= base && c <= base + 9) return String(c - base);
    return ch;
  }).replace(/\uFF0B/g, '+');
}
