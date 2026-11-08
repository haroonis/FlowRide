import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { eventUrl, fmtWhen } from '../format';
import { linkProps } from '../router';
import { Alert, Button, Field, StatusPill } from '../ui';

const KEY = 'flowride:admin';
const getToken = () => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } };

export default function Admin() {
  const [token, setToken] = useState(getToken);
  const [events, setEvents] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (t = token) => {
    if (!t) return;
    try { setEvents(await api.admin.events(t)); setError(''); try { sessionStorage.setItem(KEY, t); } catch {} }
    catch (e: any) { setError(e.message); setEvents(null); if (e.status === 401) setToken(''); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (!events) return <Login error={error} onSubmit={t => { setToken(t); load(t); }} />;

  const openEvent = async (id: string) => setOpen(await api.admin.event(token, id));
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Organiser dashboard</h1>
        <Button variant="ghost" onClick={() => { try { sessionStorage.removeItem(KEY); } catch {} setToken(''); setEvents(null); }}>Log out</Button>
      </div>
      {error && <Alert>{error}</Alert>}
      <Alert tone="info">You can see names, areas and booking status to help moderate. Phone numbers are never shown here. Personal data is erased automatically after each event.</Alert>

      {creating ? <CreateEvent token={token} onDone={() => { setCreating(false); load(); }} /> :
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New event</Button>}

      <ul className="space-y-3">
        {events.map(e => (
          <li key={e.id} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <a {...linkProps(`/e/${e.id}`)} className="font-bold hover:text-brand">{e.title}</a>
                <p className="text-sm text-slate-500">{fmtWhen(e.starts_at)} · {e.drivers} drivers · {e.requests} requests{e.purged_at && ' · personal data erased'}</p>
                <p className="select-all break-all text-xs text-slate-400">{eventUrl(e.id)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => open?.id === e.id ? setOpen(null) : openEvent(e.id)}>{open?.id === e.id ? 'Hide' : 'Entries'}</Button>
                <Button variant="danger" aria-label={`Delete ${e.title}`} onClick={async () => {
                  if (!confirm(`Delete "${e.title}" and every lift and request for it?`)) return;
                  await api.admin.removeEvent(token, e.id); load();
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {open?.id === e.id && (
              <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
                {open.offers.length === 0 && <p className="text-slate-500">No lifts yet.</p>}
                {open.offers.map((o: any) => (
                  <div key={o.id} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p><b>{o.name}</b> · {o.area} · {o.depart_time} · {o.seats_left}/{o.seats} free</p>
                      <button className="text-red-600" aria-label={`Remove ${o.name}`} onClick={async () => { if (confirm(`Remove ${o.name}'s lift?`)) { await api.admin.removeOffer(token, o.id); openEvent(e.id); load(); } }}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    {o.requests.map((r: any) => (
                      <div key={r.id} className="ml-4 mt-2 flex items-center justify-between gap-2">
                        <span>{r.name} · {r.area} · {r.passengers}p <StatusPill status={r.status} /></span>
                        <button className="text-red-600" aria-label={`Remove ${r.name}`} onClick={async () => { if (confirm(`Remove ${r.name}'s request?`)) { await api.admin.removeRequest(token, r.id); openEvent(e.id); } }}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Login({ error, onSubmit }: { error: string; onSubmit: (t: string) => void }) {
  const [t, setT] = useState('');
  return (
    <form className="card mx-auto max-w-sm space-y-4 p-6" onSubmit={e => { e.preventDefault(); onSubmit(t); }}>
      <h1 className="flex items-center gap-2 text-xl font-bold"><Lock className="h-5 w-5 text-brand" />Organisers</h1>
      <p className="text-sm text-slate-600">Create events and moderate lifts. Riders and drivers don't need to log in.</p>
      <Field label="Organiser password"><input className="field" type="password" name="admin" autoComplete="current-password" value={t} onChange={e => setT(e.target.value)} /></Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" className="w-full" disabled={!t}>Log in</Button>
    </form>
  );
}

function CreateEvent({ token, onDone }: { token: string; onDone: () => void }) {
  const [f, setF] = useState({ title: '', venue: '', address: '', starts_at: '', description: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.admin.create(token, { ...f, starts_at: f.starts_at ? new Date(f.starts_at).toISOString() : '' });
      onDone();
    } catch (err: any) { setError(err.message); }
  };
  return (
    <form onSubmit={submit} className="card space-y-3 p-4" noValidate>
      <h2 className="font-bold">New event</h2>
      <Field label="Title"><input className="field" name="title" value={f.title} onChange={set('title')} placeholder="Jumu'ah at …" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Venue"><input className="field" name="venue" value={f.venue} onChange={set('venue')} /></Field>
        <Field label="Starts"><input className="field" name="starts_at" type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></Field>
      </div>
      <Field label="Address (optional)"><input className="field" name="address" value={f.address} onChange={set('address')} /></Field>
      <Field label="Description (optional)"><textarea className="field" name="description" rows={2} value={f.description} onChange={set('description')} /></Field>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2"><Button type="submit">Create</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}
