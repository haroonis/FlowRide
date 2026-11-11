import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Car, LoaderCircle, MessageCircle, Phone, X } from 'lucide-react';
import { linkProps } from './router';
import { telLink, waLink, prettyPhone } from './format';
import type { Contact } from './api';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger' | 'wa'; busy?: boolean };
export function Button({ variant = 'primary', busy, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    outline: 'border border-slate-300 bg-white text-slate-800 hover:border-brand hover:text-brand',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-white border border-red-200 text-red-700 hover:bg-red-50',
    wa: 'bg-wa text-white hover:brightness-110',
  }[variant];
  return (
    <button {...rest} disabled={disabled || busy}
      className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none', v, className)}>
      {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ to, href, variant = 'primary', className, children, external }: { to?: string; href?: string; variant?: BtnProps['variant']; className?: string; children: React.ReactNode; external?: boolean }) {
  const v = {
    primary: 'bg-brand text-white hover:bg-brand-dark', outline: 'border border-slate-300 bg-white text-slate-800 hover:border-brand hover:text-brand',
    ghost: 'text-slate-600 hover:bg-slate-100', danger: 'text-red-700', wa: 'bg-wa text-white hover:brightness-110',
  }[variant];
  const props = to ? linkProps(to) : { href, ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) };
  return <a {...props} className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold transition active:scale-[.98]', v, className)}>{children}</a>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Check({ checked, onChange, children, name }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; name: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm leading-snug text-slate-700">
      <input type="checkbox" name={name} checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand" />
      <span>{children}</span>
    </label>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info' | 'success'; children: React.ReactNode }) {
  const t = { error: 'bg-red-50 text-red-800 border-red-200', info: 'bg-sky-50 text-sky-900 border-sky-200', success: 'bg-brand-soft text-brand-dark border-emerald-200' }[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl border px-4 py-3 text-sm', t)}>{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" />{label}</div>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Layout effect: listen for Escape as soon as the sheet is on screen, not a frame later.
  useLayoutEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="safe-bottom max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Contact buttons, only ever rendered once both people have agreed to share numbers. */
export function ContactButtons({ contact, message }: { contact: Contact; message: string }) {
  return (
    <div className="space-y-1.5">
    <div className="flex flex-wrap gap-2">
      {contact.whatsapp && (
        <LinkButton variant="wa" href={waLink(contact.phone, message)} external className="flex-1">
          <MessageCircle className="h-4 w-4" /> WhatsApp
        </LinkButton>
      )}
      <LinkButton variant="outline" href={telLink(contact.phone)} className="flex-1">
        <Phone className="h-4 w-4" /> Call
      </LinkButton>
    </div>
    <p className="text-center text-xs text-slate-500">{prettyPhone(contact.phone)}</p>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-900', accepted: 'bg-emerald-100 text-emerald-900',
    declined: 'bg-slate-200 text-slate-700', cancelled: 'bg-slate-200 text-slate-700',
  };
  const label: Record<string, string> = { pending: 'Waiting for driver', accepted: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled' };
  return <span className={cx('inline-block rounded-full px-2.5 py-1 text-xs font-bold', s[status])}>{label[status] ?? status}</span>;
}

export function Logo() {
  return (
    <a {...linkProps('/')} className="flex items-center gap-2" aria-label="FlowRide home">
      <span className="rounded-xl bg-brand p-1.5"><Car className="h-5 w-5 text-white" /></span>
      <span className="text-xl font-extrabold tracking-tight">Flow<span className="text-brand">Ride</span></span>
    </a>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); }, [msg]);
  const node = msg ? (
    <div role="status" className="fixed inset-x-4 bottom-6 z-[60] mx-auto max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-medium text-white shadow-xl">{msg}</div>
  ) : null;
  return [node, setMsg] as const;
}

export { cx };
