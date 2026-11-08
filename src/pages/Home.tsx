import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Car, ChevronRight, MapPin, MessageCircle, Search, ShieldCheck, Users } from 'lucide-react';
import { api, type EventSummary } from '../api';
import { fmtWhen } from '../format';
import { linkProps } from '../router';
import { Alert, Spinner } from '../ui';

export default function Home() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { api.events().then(setEvents, e => setError(e.message)); }, []);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (events ?? []).filter(e => !term || `${e.title} ${e.venue} ${e.address}`.toLowerCase().includes(term));
  }, [events, q]);

  return (
    <div className="space-y-8">
      <section className="space-y-3 pt-2 text-center">
        <p className="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-dark">No app · No sign-up · Free</p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl">Share the ride.<br /><span className="text-brand">Build the community.</span></h1>
        <p className="mx-auto max-w-md text-slate-600">Got spare seats? Offer them. Need a lift? Ask. Once a driver accepts, you can chat on WhatsApp to sort out pick-up.</p>
      </section>

      <section aria-label="How it works" className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: <Car className="h-5 w-5" />, t: 'Drivers offer seats', d: 'Pick the event, say where you leave from and how many seats.' },
          { icon: <Users className="h-5 w-5" />, t: 'Riders request a seat', d: 'Choose a car going from near you. The driver accepts or declines.' },
          { icon: <MessageCircle className="h-5 w-5" />, t: 'Chat on WhatsApp', d: 'Numbers are only swapped after the driver accepts. Nothing is public.' },
        ].map((s, i) => (
          <div key={i} className="card flex gap-3 p-4 sm:flex-col">
            <span className="h-fit rounded-xl bg-brand-soft p-2 text-brand">{s.icon}</span>
            <div><h2 className="font-bold">{s.t}</h2><p className="text-sm text-slate-600">{s.d}</p></div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-xl font-bold">Upcoming events</h2>
        </div>
        <label className="card flex items-center gap-3 px-4 py-3 focus-within:border-brand">
          <Search className="h-5 w-5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search events or venues" aria-label="Search events" className="w-full bg-transparent outline-none" />
        </label>
        {error && <Alert>{error}</Alert>}
        {!events && !error && <Spinner />}
        {events && shown.length === 0 && (
          <p className="card p-6 text-center text-slate-500">{q ? `No events match “${q}”.` : 'No upcoming events yet. Check back soon!'}</p>
        )}
        <ul className="space-y-3">
          {shown.map(e => (
            <li key={e.id}>
              <a {...linkProps(`/e/${e.id}`)} className="card group flex items-center gap-4 p-4 transition hover:border-brand hover:shadow-md">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h3 className="font-bold leading-snug group-hover:text-brand">{e.title}</h3>
                  <p className="flex items-center gap-1.5 text-sm text-slate-600"><CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />{fmtWhen(e.starts_at)}</p>
                  <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="h-4 w-4 shrink-0 text-slate-400" /><span className="truncate">{e.venue}</span></p>
                  <p className="text-xs font-semibold text-brand-dark">
                    {e.drivers ? `${e.drivers} driver${e.drivers > 1 ? 's' : ''} · ${e.seats_left} seat${e.seats_left === 1 ? '' : 's'} free` : 'No lifts offered yet. Be the first!'}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400 group-hover:text-brand" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4 shrink-0 text-brand" />
        We only keep what's needed to arrange your lift, and it's deleted automatically after the event. <a {...linkProps('/privacy')} className="font-semibold text-brand">Privacy</a>
      </p>
    </div>
  );
}
