import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, Copy, Download, MessageCircle, Trash2, X } from 'lucide-react';
import { api, ApiError, type MeView, type OfferView, type RequestView } from '../api';
import { fmt12, fmtWhen, manageUrl, waShare } from '../format';
import { linkProps } from '../router';
import { forget, loadSaved, storageWorks, type Saved } from '../store';
import { Alert, Button, ContactButtons, LinkButton, Spinner, StatusPill, useToast } from '../ui';

type Item = { saved: Saved; view?: MeView; error?: string };
const POLL_MS = 15_000;

export default function MyRides() {
  const fresh = new URLSearchParams(window.location.search).get('new');
  const [items, setItems] = useState<Item[] | null>(null);
  const [toast, showToast] = useToast();
  const prev = useRef(new Map<string, string>());

  const refresh = useCallback(async (silent = false) => {
    const saved = loadSaved();
    const result = await Promise.all(saved.map(async s => {
      try { return { saved: s, view: await api.me(s.token) }; }
      catch (e) {
        if (e instanceof ApiError && e.status === 404) { forget(s.token); return null; } // deleted or auto-purged
        return { saved: s, error: (e as Error).message };
      }
    }));
    const list = result.filter(Boolean) as Item[];
    // Tell the user when something changed since the last check.
    for (const it of list) {
      if (!it.view) continue;
      const sig = signature(it.view);
      const old = prev.current.get(it.saved.token);
      if (old && old !== sig && !silent) { showToast(changeMessage(it.view)); navigator.vibrate?.(200); }
      prev.current.set(it.saved.token, sig);
    }
    setItems(list);
  }, [showToast]);

  useEffect(() => {
    refresh(true);
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
    const vis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh]);

  if (!items) return <Spinner />;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">My rides</h1>
      {fresh && items[0] && <SavedNotice item={items[0]} kind={fresh} onCopy={() => showToast('Link copied')} />}
      {items.length === 0 && (
        <div className="card space-y-3 p-6 text-center text-slate-600">
          <p>You haven't offered or requested any lifts on this device.</p>
          <p className="text-sm">Using a different phone? Open the private link you saved when you signed up.</p>
          <a {...linkProps('/')} className="inline-block font-semibold text-brand">Find an event →</a>
        </div>
      )}
      <ul className="space-y-4">
        {items.map(it => (
          <li key={it.saved.token}>
            {it.error ? <Alert>{it.saved.title}: {it.error}</Alert>
              : it.view!.kind === 'offer'
                ? <OfferCard token={it.saved.token} view={it.view as OfferView} onChange={() => refresh(true)} toast={showToast} />
                : <RequestCard token={it.saved.token} view={it.view as RequestView} onChange={() => refresh(true)} toast={showToast} />}
          </li>
        ))}
      </ul>
      {items.length > 0 && <p className="flex items-center gap-2 text-xs text-slate-500"><Bell className="h-4 w-4" />This page updates automatically while it's open.</p>}
      {toast}
    </div>
  );
}

const signature = (v: MeView) => v.kind === 'offer' ? v.requests.map(r => r.id + r.status).join() : v.request.status;
const changeMessage = (v: MeView) => v.kind === 'offer' ? 'You have an update on your lift' : `Your request is now: ${v.request.status}`;

function SavedNotice({ item, kind, onCopy }: { item: Item; kind: string; onCopy: () => void }) {
  const url = manageUrl(item.saved.token);
  return (
    <Alert tone="success">
      <p className="font-bold">{kind === 'offer' ? 'Your lift is listed!' : 'Request sent!'}</p>
      <p className="mt-1">{kind === 'offer' ? "Riders can now ask for a seat. You'll see their requests here." : "The driver will accept or decline. Check back here to see when they reply."}</p>
      <p className="mt-2">Save your private link so you can get back here from any phone. Anyone with the link can manage this entry, so keep it to yourself.</p>
      {!storageWorks() && <p className="mt-2 font-bold">Your browser isn't saving data for this site (private mode?), so save this link now or you'll lose access when you close the page.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <LinkButton variant="wa" external href={waShare(`My FlowRide link for ${item.saved.title} (keep private): ${url}`)}><MessageCircle className="h-4 w-4" />Send to myself on WhatsApp</LinkButton>
        <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(url); onCopy(); } catch {} }}><Copy className="h-4 w-4" />Copy link</Button>
      </div>
    </Alert>
  );
}

function Header({ view }: { view: MeView }) {
  return (
    <div className="space-y-0.5">
      <a {...linkProps(`/e/${view.event.id}`)} className="font-bold hover:text-brand">{view.event.title}</a>
      <p className="text-sm text-slate-500">{fmtWhen(view.event.starts_at)} · {view.event.venue}</p>
    </div>
  );
}

function PrivacyTools({ token, label, onDeleted, toast }: { token: string; label: string; onDeleted: () => void; toast: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-slate-500">Your data</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={async () => {
          const data = await api.exportData(token);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          a.download = 'flowride-my-data.json'; a.click();
        }}><Download className="h-4 w-4" />Download my data</Button>
        <Button variant="danger" busy={busy} onClick={async () => {
          if (!confirm(`Delete ${label}? This permanently erases your details now and can't be undone.`)) return;
          setBusy(true);
          try { await api.erase(token); forget(token); toast('Deleted'); onDeleted(); } finally { setBusy(false); }
        }}><Trash2 className="h-4 w-4" />Delete now</Button>
      </div>
    </details>
  );
}

function OfferCard({ token, view, onChange, toast }: { token: string; view: OfferView; onChange: () => void; toast: (m: string) => void }) {
  const { offer, requests } = view;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const act = async (id: string, action: 'accept' | 'decline') => {
    setBusy(id + action); setError('');
    try { await api.respond(token, id, action); onChange(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const active = requests.filter(r => r.status !== 'cancelled');
  return (
    <article className="card space-y-4 p-4" data-testid="offer-card">
      <div className="flex items-start justify-between gap-3">
        <Header view={view} />
        <span className="shrink-0 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-900">Driving</span>
      </div>
      <p className="text-sm text-slate-600">From {offer.area} at {fmt12(offer.depart_time)} · <b>{offer.seats_left} of {offer.seats}</b> seats free</p>
      {error && <Alert>{error}</Alert>}
      {active.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No requests yet. Share the event in your WhatsApp group to find riders.</p>}
      <ul className="space-y-3">
        {active.map(r => (
          <li key={r.id} className="space-y-3 rounded-xl border border-slate-200 p-3" data-testid="request-row">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{r.name} <span className="font-normal text-slate-500">· {r.area} · {r.passengers === 1 ? '1 person' : `${r.passengers} people`}</span></p>
                {r.message && <p className="text-sm italic text-slate-600">“{r.message}”</p>}
              </div>
              <StatusPill status={r.status} />
            </div>
            {r.status === 'pending' && (
              <div className="flex gap-2">
                <Button className="flex-1" busy={busy === r.id + 'accept'} onClick={() => act(r.id, 'accept')}><Check className="h-4 w-4" />Accept</Button>
                <Button variant="outline" className="flex-1" busy={busy === r.id + 'decline'} onClick={() => act(r.id, 'decline')}><X className="h-4 w-4" />Decline</Button>
              </div>
            )}
            {r.status === 'accepted' && r.contact && (
              <>
                <ContactButtons contact={r.contact} message={`Hi ${r.name.split(" ")[0]}, it's ${offer.name.split(" ")[0]} from FlowRide. I'm giving you a lift to ${view.event.title}, leaving ${fmt12(offer.depart_time)}. Where shall I pick you up?`} />
                <button className="text-xs font-semibold text-slate-500 underline" onClick={() => confirm(`Remove ${r.name} from your car?`) && act(r.id, 'decline')}>Can't take them any more</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <PrivacyTools token={token} label="your lift and all its requests" onDeleted={onChange} toast={toast} />
    </article>
  );
}

function RequestCard({ token, view, onChange, toast }: { token: string; view: RequestView; onChange: () => void; toast: (m: string) => void }) {
  const { request, driver } = view;
  const [busy, setBusy] = useState(false);
  return (
    <article className="card space-y-4 p-4" data-testid="request-card">
      <div className="flex items-start justify-between gap-3">
        <Header view={view} />
        <StatusPill status={request.status} />
      </div>
      <p className="text-sm text-slate-600">Lift with <b>{driver.name}</b> from {driver.area}, leaving {fmt12(driver.depart_time)} · {request.passengers === 1 ? 'just you' : `${request.passengers} people`}</p>
      {request.status === 'pending' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Waiting for {driver.name} to reply. Their number will appear here once they accept.</p>}
      {request.status === 'declined' && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{driver.name} can't take you this time. <a {...linkProps(`/e/${view.event.id}`)} className="font-semibold text-brand">See other lifts →</a></p>}
      {request.status === 'accepted' && driver.contact && (
        <div className="space-y-2 rounded-xl bg-brand-soft p-3">
          <p className="text-sm font-semibold text-brand-dark">You're in! Message {driver.name} to arrange pick-up.</p>
          <ContactButtons contact={driver.contact} message={`Hi ${driver.name.split(" ")[0]}, it's ${request.name.split(" ")[0]} from FlowRide. Thanks for the lift to ${view.event.title}! I'm in ${request.area}.`} />
        </div>
      )}
      {(request.status === 'pending' || request.status === 'accepted') && (
        <Button variant="ghost" className="text-sm" busy={busy} onClick={async () => {
          if (!confirm('Cancel your request? The driver will see that you cancelled.')) return;
          setBusy(true); try { await api.cancel(token); onChange(); } finally { setBusy(false); }
        }}>Cancel my request</Button>
      )}
      <PrivacyTools token={token} label="your request" onDeleted={onChange} toast={toast} />
    </article>
  );
}
