import { useEffect, useState } from 'react';
import { api, type SiteConfig } from '../api';
import { linkProps } from '../router';

export default function Privacy() {
  const [c, setC] = useState<SiteConfig | null>(null);
  useEffect(() => { api.config().then(setC, () => {}); }, []);
  const days = c?.retentionDays ?? 7;
  return (
    <article className="prose-sm max-w-none space-y-5 text-slate-700 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">
      <h1 className="text-2xl font-extrabold text-ink">Privacy notice</h1>
      <p className="rounded-xl bg-brand-soft p-4 text-brand-dark"><b>In short:</b> we collect only what's needed to arrange a lift. Your phone number is shown only to the person you're matched with, after the driver accepts. Everything is deleted automatically {days} days after the event, or straight away if you press <i>Delete now</i>. No accounts, adverts, tracking or cookies.</p>

      <h2>Who we are</h2>
      <p>{c?.controllerName ?? 'FlowRide'} is the data controller. Contact: <a className="font-semibold text-brand" href={`mailto:${c?.privacyEmail}`}>{c?.privacyEmail}</a>.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Drivers:</b> name, the area you leave from (not your address), departure time, seats, optional notes, and your mobile number.</li>
        <li><b>Riders:</b> name, area, how many people, an optional message, and your mobile number.</li>
        <li>Whether you're happy to be contacted on WhatsApp.</li>
      </ul>
      <p>We don't collect email addresses, exact addresses, GPS location or payment details.</p>

      <h2>Why, and our lawful basis</h2>
      <p>We use your details only to show lifts and pass contact details between a driver and the riders they accept. Our lawful basis is your <b>consent</b> (UK GDPR Art. 6(1)(a)). Because signing up for a religious event may reveal your beliefs, we also rely on your <b>explicit consent</b> (Art. 9(2)(a)). You can withdraw consent at any time by deleting your entry.</p>

      <h2>Who can see it</h2>
      <ul>
        <li><b>Everyone:</b> a driver's first name, area, departure time and free seats. Never phone numbers.</li>
        <li><b>The driver you ask:</b> your name, area, group size and message. They see your number only after they accept.</li>
        <li><b>Riders a driver accepts:</b> the driver's full name and number.</li>
        <li><b>Event organisers:</b> names, areas and booking status, to help with moderation. They can't see phone numbers.</li>
        <li><b>Our hosting provider</b> stores the data on our behalf.</li>
      </ul>
      <p>Pressing a WhatsApp button opens WhatsApp on your phone. FlowRide doesn't send anything to WhatsApp (Meta) itself. Once you message someone there, WhatsApp's own privacy policy applies.</p>

      <h2>How long we keep it</h2>
      <p>Your details are deleted automatically {days} days after the event. You can delete them sooner using <i>Your data → Delete now</i> on <a {...linkProps('/me')} className="font-semibold text-brand">My rides</a>. Deleting a lift also deletes every request made to it.</p>

      <h2>Your rights</h2>
      <p>You can access (<i>Download my data</i>), correct, or erase your data, withdraw consent, or object to how we use it. For anything you can't do yourself, email us. If you're unhappy with how we handle your data, you can complain to the Information Commissioner's Office at <a className="font-semibold text-brand" href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk</a>.</p>

      <h2>Cookies and storage</h2>
      <p>We don't use cookies, analytics or third-party fonts and scripts. Your browser stores the private links to your own lifts so you can find them again. This is strictly necessary for the service you asked for, so we don't need to ask for cookie consent. Clearing your browser data removes these links.</p>

      <h2>Age</h2>
      <p>You must be 18 or over to offer or request a lift. Children can travel as part of an adult's group.</p>

      <h2>Security</h2>
      <p>Data is sent over HTTPS, and phone numbers are encrypted in our database. Private links are random and stored only as a one-way hash. We never log what you type into forms. To report a security problem, see <a className="font-semibold text-brand" href="/.well-known/security.txt">security.txt</a>.</p>
    </article>
  );
}
