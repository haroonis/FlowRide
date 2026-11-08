# FlowRide security

How FlowRide follows UK security good practice, and what the tests check. References:
- **NCSC** (National Cyber Security Centre): web app security, secure development, and vulnerability disclosure
- **Cyber Essentials** technical controls
- **OWASP** Top 10 and ASVS
- **ICO** guidance on UK GDPR Art. 32 (security of processing)
- **PECR** (cookies and similar storage)

## Controls in the code

| Area | Control | Test |
|---|---|---|
| Encryption in transit | HTTPS required; `Strict-Transport-Security` for 1 year | `security.test.mjs` › headers |
| Encryption at rest (Art. 32) | Phone numbers encrypted with AES-256-GCM. A separate HMAC fingerprint is used for duplicate checks. The key is stored outside the database (`DATA_KEY`, or a 0600 key file) | › Encryption at rest |
| Private links | 192-bit random tokens, stored only as SHA-256 hashes, removed from the address bar after opening; `Referrer-Policy: no-referrer` | › No data leaks |
| Brute force | Organiser login locks after 10 bad passwords per IP for 15 min; private-link guessing locks after 30 misses; sign-ups limited to 30 per IP per 10 min; `X-Forwarded-For` is ignored unless `TRUST_PROXY` is set | › Brute-force protection |
| Organiser password | Must be at least 16 characters, otherwise the dashboard is disabled; compared in constant time; organiser actions written to an audit log (ids only) | › weak password |
| XSS | React escapes all output; strict CSP (`script-src 'self'`, no inline or eval scripts); `nosniff` | `e2e-edge` › script injection |
| Clickjacking | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` | › headers |
| CSRF | No cookies. Every change needs the private link in an `Authorization` header, which other sites can't send. Form posts and `text/plain` bodies are rejected | › CSRF |
| CORS | No CORS headers, so other websites can't read the API | › CORS |
| Isolation | `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`; `Permissions-Policy` disables camera, microphone and location | › headers |
| Injection | Parameterised SQL only; input length and type validated; invisible and right-to-left override characters stripped from names | › SQL injection, `edge` › names |
| Denial of service | 20 KB JSON body limit; malformed JSON returns 400; a load smoke test sends 300 requests at once | › oversized body, `edge` › Load |
| Information leakage | No stack traces or file paths in errors; no `X-Powered-By`; source maps not published; path traversal blocked; database and key never served | › Hostile input |
| Logging | Request bodies never logged; logs checked for names and phone numbers | › server logs |
| Privacy by design | Organisers never see phone numbers; contact details released only after the driver accepts; automatic deletion after `RETENTION_DAYS` | `api.test.mjs`, `edge` › Timing |
| PECR | No cookies at all, so no consent banner is needed | › no cookies |
| Vulnerability disclosure | `/.well-known/security.txt` (RFC 9116), as the NCSC recommends | › security.txt |
| Accessibility | WCAG 2.2 AA checks (axe) on all key screens, keyboard support, AA colour contrast | `e2e-edge` › accessibility |

## Supply chain
- `npm audit` runs in CI and fails the build on high-severity issues. Dependabot proposes weekly updates for npm and GitHub Actions.
- No third-party scripts, fonts, analytics or trackers are loaded at run time.

## Running it securely (Cyber Essentials controls)
1. **Secure configuration:** set `ADMIN_TOKEN` (`openssl rand -base64 24`), `DATA_KEY` (`openssl rand -base64 32`), `CONTROLLER_NAME`, `PRIVACY_EMAIL` and `SECURITY_EMAIL`. Keep them in your host's secret store, never in git.
2. **Keep the key away from the data:** store `DATA_KEY` as a secret, not in the same volume or backup as `flowride.db`. Without the key, a stolen backup reveals no phone numbers.
3. **Firewall:** expose only 443 (and 80 for redirects). Run Node behind Caddy or nginx and set `TRUST_PROXY=1`.
4. **Patching:** rebuild the Docker image monthly, or whenever Dependabot or `npm audit` flags something. The image runs as the unprivileged `node` user.
5. **Access control:** only organisers get `ADMIN_TOKEN`. Rotate it when someone leaves.
6. **Backups:** keep them encrypted and no longer than the retention period (7 days by default).
7. **Breaches:** if personal data may have leaked, assess it within 72 hours and report to the ICO if required (UK GDPR Art. 33). Rotate `ADMIN_TOKEN`; rotating `DATA_KEY` makes stored numbers unreadable, which is acceptable because the data is short-lived.

## Run the tests
```bash
npm run build && npm test     # 142 tests: API, security, edge cases, browser, accessibility
```
