// Private links ("tokens") for the user's own lifts/requests live only on this device.
// This is strictly necessary storage for a service the user asked for, so no cookie banner is needed (PECR reg. 6(4)).
// If the browser blocks storage (some private modes), we keep them in memory for this visit
// and the "send link to myself" step becomes the way back in.
export interface Saved { token: string; kind: 'offer' | 'request'; eventId: string; title: string; startsAt: string }
const KEY = 'flowride:bookings';
let memory: Saved[] = [];

function read(): Saved[] | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return null; }
}
function write(list: Saved[]): boolean {
  memory = list;
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export function loadSaved(): Saved[] {
  const stored = read() ?? [];
  const seen = new Set(stored.map(s => s.token));
  return [...memory.filter(m => !seen.has(m.token)), ...stored];
}
export const storageWorks = () => { try { localStorage.setItem(KEY + ':t', '1'); localStorage.removeItem(KEY + ':t'); return true; } catch { return false; } };
export function save(item: Saved) { write([item, ...loadSaved().filter(s => s.token !== item.token)]); }
export function forget(token: string) { write(loadSaved().filter(s => s.token !== token)); }
export const kindOf = (token: string): 'offer' | 'request' => (token.startsWith('o.') ? 'offer' : 'request');
