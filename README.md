# FlowRide

Lift sharing for local events: Friday prayers, community days, matches, meetups.
Drivers offer spare seats, riders ask for one, and once the driver accepts, both can chat on **WhatsApp** or call to sort out pick-up.

**No app install and no account needed.** First visit is about 36 KB; after that, pages cost about 1 KB. It runs in any phone browser, can be added to the home screen, and also ships as an iPhone/Android app that wraps the same website ([mobile/](mobile/README.md)).

## How it works

1. **An organiser** creates an event at `/organisers` and posts its link in the community WhatsApp group (there's a one-tap "Share to WhatsApp group" button).
2. **A driver** opens the link and taps *Offer seats*: first name, the area they leave from, departure time, seats and mobile number.
3. **A rider** picks a car and taps *Request seat*.
4. **The driver** sees the request on *My rides* and taps *Accept*.
5. **Only then** both of them get a **WhatsApp** button (a `wa.me` click-to-chat link with a friendly pre-filled message) and a **Call** button. Before that, nobody, not even the organiser, can see anyone's number.

There are no logins. Each person gets a **private link** that is saved on their phone. They can also send it to themselves on WhatsApp to open it on another device.

## Privacy (UK GDPR) in one paragraph

We collect the minimum: first name, rough area (not addresses), and a phone number. Numbers are revealed only to the matched person, only after mutual agreement. Explicit consent is collected, because attending a religious event is special-category data. Everything is **deleted automatically** `RETENTION_DAYS` (default 7) days after the event. Users can **download** or **delete** their data themselves at any time. There are no cookies, analytics, third-party fonts or scripts, so no cookie banner is needed. Full details are in [docs/GDPR.md](docs/GDPR.md).

## Run it

```bash
npm install
npm run dev                 # http://localhost:3000 with live reload
ADMIN_TOKEN=secret npm run dev   # enables /organisers
```

Production:

```bash
npm run build
ADMIN_TOKEN=... CONTROLLER_NAME="..." PRIVACY_EMAIL=... npm start
```

See `.env.example` for all settings.

## Deploy

FlowRide needs a small always-on Node server (SQLite database file). **Netlify static hosting is not enough**, because there would be nowhere to store lifts.

**Recommended: Oracle Cloud Always Free.** Pushes to `main` deploy automatically via GitHub Actions. Setup steps and capacity numbers: [docs/ORACLE.md](docs/ORACLE.md).

Other options:

- **Docker** on any VM (e.g. your Oracle Cloud instance): `docker build -t flowride . && docker run -d -p 3000:3000 -v flowride-data:/data --env-file .env flowride`. Put Caddy or nginx in front for HTTPS.
- **Fly.io / Render / Railway:** use the Dockerfile and mount a persistent volume at `/data`.

HTTPS is required in production. It's needed for the PWA install, and phone numbers must never travel unencrypted.

## Tests

```bash
npm run build && npm test   # 142 tests
```

| File | Covers |
|---|---|
| `api.test.mjs` | core flows, GDPR rules, validation, organiser access |
| `security.test.mjs` | UK/OWASP security: headers, CSRF/CORS, encryption at rest, brute force, injection, leaks |
| `edge.test.mjs` | names in many scripts, Arabic/Urdu digits in phone numbers, race conditions, deletions mid-flow, UK clock changes, load |
| `e2e.test.mjs` | the full driver → rider → WhatsApp flow on an iPhone-sized screen |
| `e2e-edge.test.mjs` | script injection, 320px screens, other time zones, offline, private mode, the native app bridge, WCAG 2.2 AA accessibility |
| `phone.test.mjs` | phone number parsing |

Security design and the UK good-practice checklist: [docs/SECURITY.md](docs/SECURITY.md).

CI (`.github/workflows/ci.yml`) runs the tests and builds the Android APK and iOS simulator app on every push.

## Project layout

```
server/   Express API + SQLite (app.ts = routes & rules, db.ts = schema & auto-purge, phone.ts)
src/      React website (pages/, ui.tsx, native.ts = extra touches inside the mobile app)
public/   PWA manifest, service worker, icons, offline page
mobile/   Capacitor iOS + Android app that loads the website
tests/    node:test + Playwright
docs/     GDPR notes
```
