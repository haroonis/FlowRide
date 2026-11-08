# FlowRide: GDPR design notes

This is a working record of how FlowRide handles personal data under UK GDPR and PECR. It's a starting point for your own records, not legal advice. Before launch, fill in the controller details and have someone responsible review it.

## 1. Controller and contact
Set `CONTROLLER_NAME` and `PRIVACY_EMAIL`. They appear in the in-app privacy notice (`/privacy`). If you run FlowRide for a mosque or charity, that organisation is usually the controller. Check whether you need to pay the ICO data protection fee. Many not-for-profits are exempt, but confirm with the ICO's self-assessment.

## 2. What we process and why

| Data | Who | Purpose | Visible to |
|---|---|---|---|
| Name | drivers, riders | identify each other | public: driver's first name only. Matched party: full name |
| Area (free text, e.g. "M14") | both | match people going from nearby | public (drivers), driver (riders) |
| Departure time, seats, notes | drivers | show the lift | public |
| Group size, message | riders | driver decides | the driver they ask |
| Mobile number + WhatsApp yes/no | both | let matched people contact each other | **only** the matched person, **after** the driver accepts |
| Private-link hash | both | let the person manage their entry | nobody (SHA-256 hash only) |

Not collected: email, home address, GPS, date of birth, payment details, IP logs.

## 3. Lawful basis
- **Art. 6(1)(a) consent.** A separate, unticked checkbox on every form. It explains exactly who will see the number and when.
- **Art. 9(2)(a) explicit consent.** Signing up for a lift to Friday prayers can reveal religious belief, which is special-category data. The checkbox says so explicitly ("I understand this shows I'm going to this event").
- Withdrawing consent is as easy as giving it: *My rides → Your data → Delete now*.

If FlowRide is run by a religious not-for-profit only for its members, Art. 9(2)(d) may also apply. Consent is still the cleaner basis for an open community tool.

## 4. Phone numbers and WhatsApp, without an app
- Numbers are stored server-side but returned by the API **only** to (a) the owner and (b) the counter-party after `status = accepted`. The organiser dashboard never returns them. Tests check this (`tests/api.test.mjs`).
- Contact uses standard links: `https://wa.me/<number>?text=…` opens WhatsApp (or WhatsApp Web), and `tel:` opens the dialler. FlowRide makes **no** server-side calls to WhatsApp/Meta and doesn't use the WhatsApp Business API, so no data is shared with Meta by FlowRide itself. Once users chat on WhatsApp, Meta's terms apply, and the privacy notice says so.
- Users can untick "message me on WhatsApp" to offer calls only.
- If a driver declines or a rider cancels, numbers are hidden again.

## 5. Retention
- `purgeExpired()` runs at start-up and every hour. It deletes every offer and request for events that started more than `RETENTION_DAYS` days ago (default 7). The event itself stays, with no personal data (`purged_at` is set).
- Users can delete their own entry immediately. A driver deleting a lift also deletes the requests made to it.
- Back-ups: if you back up the SQLite file, keep back-ups no longer than the retention period, or document why.

## 6. Data subject rights
| Right | How |
|---|---|
| Access (Art. 15) | *Download my data* (JSON) on My rides |
| Erasure (Art. 17) | *Delete now* on My rides; organisers can also remove entries |
| Rectification (Art. 16) | delete and re-enter (entries are short-lived), or email |
| Withdraw consent / object | delete the entry |
| Complain | ICO link in the privacy notice |

## 7. Cookies / PECR
No cookies. `localStorage` holds only the user's own private links, and `sessionStorage` holds the organiser password for the session. Both are *strictly necessary* for a service the user requested (PECR reg. 6(4)), so no consent banner is needed. No analytics and no third-party requests: fonts are system fonts, deliberately avoiding Google Fonts, which sends visitor IPs to Google.

## 8. Security
- HTTPS required in production; `Content-Security-Policy` restricted to the site itself; `Referrer-Policy: no-referrer`, so private links can't leak to WhatsApp or other sites.
- Private links are 192-bit random tokens, stored only as SHA-256 hashes. Opening a `/m/<token>` link saves it and immediately removes it from the address bar.
- Organiser password comes from `ADMIN_TOKEN` and is compared in constant time.
- Rate limiting on sign-ups; strict input validation; request bodies are never logged.
- SQLite file should live on an encrypted disk with restricted permissions.

## 9. Safeguarding
- 18+ confirmation for drivers and riders; children travel as part of an adult's group.
- Drivers choose whom to accept; FlowRide states clearly that it doesn't vet anyone.
- Organisers can remove any entry.

## 10. DPIA
Lift sharing between strangers, combined with special-category data, is worth a short Data Protection Impact Assessment. The tables above cover most of it. Add your organisation's risk owner, any vetting policy, and how you'll handle complaints.

## 11. Mobile apps
The iOS/Android apps load the same website, so they collect nothing extra: no push tokens, location or contacts. App Store and Play Store privacy labels: *Contact info (name, phone), linked to user, used for app functionality, not used for tracking.*
