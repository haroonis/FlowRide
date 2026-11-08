// Private links ("tokens") for the user's own lifts/requests live only on this device.
// This is strictly necessary storage for a service the user asked for, so no cookie banner is needed (PECR reg. 6(4)).
export interface Saved { token: string; kind: 'offer' | 'request'; eventId: string; title: string; startsAt: string }
const KEY = 'flowride:bookings';

export function loadSaved(): Saved[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function save(item: Saved) {
  const list = loadSaved().filter(s => s.token !== item.token);
  list.unshift(item);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export function forget(token: string) {
  try { localStorage.setItem(KEY, JSON.stringify(loadSaved().filter(s => s.token !== token))); } catch {}
}
export const kindOf = (token: string): 'offer' | 'request' => (token.startsWith('o.') ? 'offer' : 'request');
