export interface EventSummary {
  id: string; title: string; venue: string; address: string; starts_at: string; description: string;
  drivers?: number; seats_left?: number;
}
export interface PublicOffer { id: string; name: string; area: string; depart_time: string; seats: number; seats_left: number; notes: string }
export interface EventDetail extends EventSummary { offers: PublicOffer[] }
export interface Contact { phone: string; whatsapp: boolean }
export type Status = 'pending' | 'accepted' | 'declined' | 'cancelled';
export interface OfferView {
  kind: 'offer'; event: EventSummary;
  offer: { id: string; name: string; area: string; depart_time: string; seats: number; seats_left: number; notes: string; phone: string; whatsapp: boolean; created_at: string };
  requests: { id: string; name: string; area: string; passengers: number; message: string; status: Status; created_at: string; contact?: Contact }[];
}
export interface RequestView {
  kind: 'request'; event: EventSummary;
  request: { id: string; name: string; area: string; passengers: number; message: string; status: Status; phone: string; whatsapp: boolean; created_at: string };
  driver: { name: string; area: string; depart_time: string; notes: string; seats_left: number; contact?: Contact };
}
export type MeView = OfferView | RequestView;
export interface SiteConfig { controllerName: string; privacyEmail: string; retentionDays: number; publicUrl: string }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function call<T>(method: string, url: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach FlowRide. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Something went wrong (${res.status})`);
  if (data === null) throw new ApiError(res.status, 'Unexpected response from server');
  return data as T;
}

export const api = {
  config: () => call<SiteConfig>('GET', '/api/config'),
  events: () => call<EventSummary[]>('GET', '/api/events'),
  event: (id: string) => call<EventDetail>('GET', `/api/events/${encodeURIComponent(id)}`),
  offer: (eventId: string, body: object) => call<{ id: string; token: string }>('POST', `/api/events/${encodeURIComponent(eventId)}/offers`, body),
  request: (offerId: string, body: object) => call<{ id: string; token: string }>('POST', `/api/offers/${encodeURIComponent(offerId)}/requests`, body),
  me: (token: string) => call<MeView>('GET', '/api/me', undefined, token),
  respond: (token: string, requestId: string, action: 'accept' | 'decline') => call<OfferView>('POST', `/api/me/requests/${requestId}/${action}`, {}, token),
  cancel: (token: string) => call<RequestView>('POST', '/api/me/cancel', {}, token),
  erase: (token: string) => call<{ deleted: true }>('DELETE', '/api/me', undefined, token),
  exportData: (token: string) => call<object>('GET', '/api/me/export', undefined, token),
  admin: {
    events: (t: string) => call<(EventSummary & { drivers: number; requests: number; purged_at: string | null })[]>('GET', '/api/admin/events', undefined, t),
    event: (t: string, id: string) => call<any>('GET', `/api/admin/events/${id}`, undefined, t),
    create: (t: string, body: object) => call<EventSummary>('POST', '/api/admin/events', body, t),
    removeEvent: (t: string, id: string) => call('DELETE', `/api/admin/events/${id}`, undefined, t),
    removeOffer: (t: string, id: string) => call('DELETE', `/api/admin/offers/${id}`, undefined, t),
    removeRequest: (t: string, id: string) => call('DELETE', `/api/admin/requests/${id}`, undefined, t),
    purge: (t: string) => call<{ purged_events: number }>('POST', '/api/admin/purge', {}, t),
  },
};
