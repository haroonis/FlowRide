import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Car, ChevronLeft, Clock, MapPin, MessageCircle, Share2, UserRound, Users } from 'lucide-react';
import { api, type EventDetail, type PublicOffer } from '../api';
import { eventUrl, fmt12, fmtWhen, waShare } from '../format';
import { shareLink } from '../native';
import { linkProps, navigate } from '../router';
import { save } from '../store';
import { Alert, Button, Check, Field, LinkButton, Sheet, Spinner, useToast } from '../ui';

export default function EventPage({ id }: { id: string }) {
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');
  const [offering, setOffering] = useState(false);
  const [requesting, setRequesting] = useState<PublicOffer | null>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(() => api.event(id).then(setEv, e => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Alert>{error} <a {...linkProps('/')} className="font-semibold underline">Back to events</a></Alert>;
  if (!ev) return <Spinner />;
  const started = new Date(ev.starts_at).getTime() < Date.now();
  const shareText = `Need a lift or got spare seats for ${ev.title} (${fmtWhen(ev.starts_at)})? Sort it on FlowRide:`;

  return (
    <div className="space-y-6">
      <a {...linkProps('/')} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-brand"><ChevronLeft className="h-4 w-4" />All events</a>

      <section className="space-y-3 rounded-3xl bg-slate-900 p-5 text-white sm:p-8">
        <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">{ev.title}</h1>
        <div className="space-y-1.5 text-sm text-slate-300">
          <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-emerald-400" />{fmtWhen(ev.starts_at)}</p>
          <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-emerald-400" />{ev.venue}{ev.address && `, ${ev.address}`}</p>
        </div>
        {ev.description && <p className="text-slate-300">{ev.description}</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          <LinkButton variant="wa" external href={waShare(`${shareText} ${eventUrl(ev.id)}`)}><MessageCircle className="h-4 w-4" />Share to WhatsApp group</LinkButton>
          <Button variant="outline" className="border-slate-600 bg-transparent text-white hover:text-white"
            onClick={async () => { const r = await shareLink(ev.title, shareText, eventUrl(ev.id)); if (r === 'copied') showToast('Link copied'); }}>
            <Share2 className="h-4 w-4" />Share
          </Button>
        </div>
      </section>

      {started ? <Alert tone="info">This event has started, so new lifts can't be arranged.</Alert> : (
        <Button className="w-full py-4 text-lg" onClick={() => setOffering(true)}><Car className="h-5 w-5" />I'm driving: offer seats</Button>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Lifts on offer ({ev.offers.length})</h2>
        {ev.offers.length === 0 && (
          <div className="card space-y-2 p-6 text-center text-slate-600">
            <p className="font-semibold">No lifts offered yet.</p>
            <p className="text-sm">Share this page in your community WhatsApp group so drivers can add their spare seats.</p>
          </div>
        )}
        <ul className="space-y-3">
          {ev.offers.map(o => (
            <li key={o.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex items-center gap-2 font-bold"><UserRound className="h-4 w-4 text-brand" />{o.name}</p>
                <p className="flex items-center gap-2 text-sm text-slate-600"><MapPin className="h-4 w-4 text-slate-400" />From {o.area}</p>
                <p className="flex items-center gap-2 text-sm text-slate-600"><Clock className="h-4 w-4 text-slate-400" />Leaves {fmt12(o.depart_time)}</p>
                {o.notes && <p className="text-sm italic text-slate-500">“{o.notes}”</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${o.seats_left ? 'bg-brand-soft text-brand-dark' : 'bg-slate-100 text-slate-500'}`}>
                  <Users className="mr-1 inline h-3.5 w-3.5" />{o.seats_left ? `${o.seats_left} of ${o.seats} free` : 'Full'}
                </span>
                {!started && o.seats_left > 0 && <Button onClick={() => setRequesting(o)}>Request seat</Button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2 p-4 text-sm text-slate-600">
        <h2 className="font-bold text-ink">Good to know</h2>
        <p><b>Drivers:</b> you choose the route and who you take. Only accept people you're comfortable with.</p>
        <p><b>Riders:</b> be ready a few minutes early. Offering something towards fuel is a kind gesture.</p>
        <p><b>Safety:</b> FlowRide doesn't check drivers or riders. Travel with people from your community, and tell someone your plans.</p>
      </section>

      {offering && <OfferForm ev={ev} onClose={() => setOffering(false)} />}
      {requesting && <RequestForm ev={ev} offer={requesting} onClose={() => setRequesting(null)} onFull={load} />}
      {toast}
    </div>
  );
}

function useForm<T extends object>(initial: T) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof T>(k: K) => (e: { target: { value: string } } | T[K]) =>
    setV(s => ({ ...s, [k]: typeof e === 'object' && e !== null && 'target' in (e as any) ? (e as any).target.value : e }));
  return [v, set] as const;
}

function Consent({ consent, adult, setConsent, setAdult, who }: { consent: boolean; adult: boolean; setConsent: (b: boolean) => void; setAdult: (b: boolean) => void; who: string }) {
  return (
    <div className="space-y-2">
      <Check name="consent" checked={consent} onChange={setConsent}>
        Share my name and phone number with {who}. It's only shown once the lift is confirmed, and it's deleted automatically after the event. I understand this shows I'm going to this event. <a {...linkProps('/privacy')} target="_blank" className="font-semibold text-brand underline">Privacy notice</a>
      </Check>
      <Check name="adult" checked={adult} onChange={setAdult}>I'm 18 or over.</Check>
    </div>
  );
}

function OfferForm({ ev, onClose }: { ev: EventDetail; onClose: () => void }) {
  const [f, set] = useForm({ name: '', area: '', depart_time: '', seats: '3', phone: '', notes: '', whatsapp: true, consent: false, adult: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.offer(ev.id, { ...f, seats: Number(f.seats) });
      save({ token: r.token, kind: 'offer', eventId: ev.id, title: ev.title, startsAt: ev.starts_at });
      navigate('/me?new=offer');
    } catch (err: any) { setError(err.message); setBusy(false); }
  };
  return (
    <Sheet title="Offer seats" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Your name"><input className="field" name="name" autoComplete="given-name" required maxLength={40} value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Leaving from" hint="Area or postcode start, e.g. M14"><input className="field" name="area" required maxLength={40} value={f.area} onChange={set('area')} placeholder="Fallowfield" /></Field>
          <Field label="Leaving at"><input className="field" name="depart_time" type="time" required value={f.depart_time} onChange={set('depart_time')} /></Field>
        </div>
        <Field label="Seats for passengers">
          <select className="field" name="seats" value={f.seats} onChange={set('seats')}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Mobile number" hint="Only shown to riders you accept">
          <input className="field" name="phone" type="tel" inputMode="tel" autoComplete="tel" required value={f.phone} onChange={set('phone')} placeholder="07700 900123" />
        </Field>
        <Check name="whatsapp" checked={f.whatsapp} onChange={set('whatsapp')}>Riders can message me on WhatsApp</Check>
        <Field label="Notes (optional)" hint="e.g. 'Can pick up along Wilmslow Rd'. Please don't include personal details.">
          <input className="field" name="notes" maxLength={200} value={f.notes} onChange={set('notes')} />
        </Field>
        <Consent who="riders I accept" consent={f.consent} adult={f.adult} setConsent={set('consent')} setAdult={set('adult')} />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full py-3.5" busy={busy} disabled={!f.consent || !f.adult}>Offer my seats</Button>
      </form>
    </Sheet>
  );
}

function RequestForm({ ev, offer, onClose, onFull }: { ev: EventDetail; offer: PublicOffer; onClose: () => void; onFull: () => void }) {
  const [f, set] = useForm({ name: '', area: '', passengers: '1', phone: '', message: '', whatsapp: true, consent: false, adult: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.request(offer.id, { ...f, passengers: Number(f.passengers) });
      save({ token: r.token, kind: 'request', eventId: ev.id, title: ev.title, startsAt: ev.starts_at });
      navigate('/me?new=request');
    } catch (err: any) { setError(err.message); setBusy(false); if (err.status === 409) onFull(); }
  };
  return (
    <Sheet title={`Ask ${offer.name} for a lift`} onClose={onClose}>
      <p className="mb-4 text-sm text-slate-600">From {offer.area}, leaving {fmt12(offer.depart_time)}. {offer.seats_left} seat{offer.seats_left > 1 ? 's' : ''} free.</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Your name"><input className="field" name="name" autoComplete="given-name" required maxLength={40} value={f.name} onChange={set('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your area" hint="e.g. Rusholme or M14"><input className="field" name="area" required maxLength={40} value={f.area} onChange={set('area')} /></Field>
          <Field label="People travelling">
            <select className="field" name="passengers" value={f.passengers} onChange={set('passengers')}>
              {Array.from({ length: offer.seats_left }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n === 1 ? 'Just me' : n}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Mobile number" hint="Only shown to the driver if they accept">
          <input className="field" name="phone" type="tel" inputMode="tel" autoComplete="tel" required value={f.phone} onChange={set('phone')} placeholder="07700 900123" />
        </Field>
        <Check name="whatsapp" checked={f.whatsapp} onChange={set('whatsapp')}>The driver can message me on WhatsApp</Check>
        <Field label="Message to driver (optional)"><input className="field" name="message" maxLength={200} value={f.message} onChange={set('message')} placeholder="Can walk to the main road" /></Field>
        <Consent who={`${offer.name} if they accept`} consent={f.consent} adult={f.adult} setConsent={set('consent')} setAdult={set('adult')} />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full py-3.5" busy={busy} disabled={!f.consent || !f.adult}>Send request</Button>
      </form>
    </Sheet>
  );
}
