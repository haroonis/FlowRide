# FlowRide tests

`npm test` runs two files (no dependencies, Node 20+):

- `readiness.test.mjs` checks that the repo contains a runnable app. Today the repo only has a README, so the app checks show as TODO.
- `acceptance.test.mjs` holds the core user flows: browse events, offer seats, request a lift, match, accept, and GDPR delete. It is skipped unless you point it at a server:

```
FLOWRIDE_URL=http://localhost:3000 npm test
```
