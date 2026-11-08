const TZ = 'Europe/London';
export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', '');
export const fmtWhen = (iso: string) => `${fmtDate(iso)} · ${fmtTime(iso)}`;
export const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

/** Click-to-chat link. Opens WhatsApp (app or web) with no install of anything new. */
export const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
/** Opens WhatsApp's chat picker with a message ready to send, e.g. to a community group. */
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const telLink = (phone: string) => `tel:${phone}`;
export const prettyPhone = (phone: string) =>
  phone.startsWith('+44') ? '0' + phone.slice(3).replace(/^(\d{4})(\d{3})(\d+)$/, '$1 $2 $3') : phone;

export const origin = () => window.location.origin;
export const eventUrl = (id: string) => `${origin()}/e/${id}`;
export const manageUrl = (token: string) => `${origin()}/m/${token}`;
