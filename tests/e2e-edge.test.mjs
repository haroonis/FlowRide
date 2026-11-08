// Browser edge cases: hostile content, tiny screens, foreign time zones, offline,
// blocked storage, the native app bridge and accessibility (WCAG 2.2 AA, Equality Act 2010).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startServer, loadPlaywright, ROOT, ADMIN, driver, rider } from './helpers.mjs';

const pw = loadPlaywright();
const skip = !pw ? 'playwright not installed' : !existsSync(path.join(ROOT, 'dist/index.html')) ? 'run `npm run build` first' : false;
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
let s, browser, ev;
before(async () => {
  if (skip) return;
  s = await startServer({ RATE_LIMIT: '100000' });
  ev = (await s.api('GET', '/api/events')).json.find(e => e.title.includes('Didsbury'));
  browser = await pw.chromium.launch();
});
after(async () => { await browser?.close(); await s?.stop(); });

let n = 0;
const phone = () => `07700 8${String(10000 + ++n).slice(-5)}`;
async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts });
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  p.dialogs = []; p.on('dialog', d => { p.dialogs.push(d.message()); d.accept(); });
  return p;
}
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

describe('Browser edge cases', { skip }, () => {
  test('script injection in names and notes is shown as text, never run', async () => {
    await s.api('POST', `/api/events/${ev.id}/offers`, driver({ name: '<img src=x onerror=window.__xss=1>', notes: '<script>window.__xss=2</script><b>bold</b>', phone: phone() }));
    const p = await page();
    await p.goto(`${s.base}/e/${ev.id}`);
    await p.getByText('<script>window.__xss=2</script>', { exact: false }).waitFor();
    assert.equal(await p.evaluate(() => window.__xss), undefined);
    assert.equal(await p.locator('main img[src="x"], main b:text("bold")').count(), 0);
    assert.deepEqual(p.dialogs, []);
    await p.context().close();
  });

  test('iPhone SE width (320px) with very long names and notes: nothing spills sideways', async () => {
    await s.api('POST', `/api/events/${ev.id}/offers`, driver({
      name: 'Wolfeschlegelsteinhausenbergerdorffvoral', area: 'Llanfairpwllgwyngyllgogerychwyrndrobwll',
      notes: 'https://example.org/' + 'a'.repeat(150), phone: phone(),
    }));
    const p = await page({ viewport: { width: 320, height: 640 } });
    for (const url of ['/', `/e/${ev.id}`, '/privacy', '/organisers', '/me']) {
      await p.goto(s.base + url);
      await p.waitForLoadState('networkidle');
      assert.ok(await overflow(p) <= 0, `${url} overflows by ${await overflow(p)}px`);
    }
    await p.context().close();
  });

  test('a visitor whose phone is set to New York time still sees UK event times', async () => {
    const p = await page({ timezoneId: 'America/New_York', locale: 'en-US' });
    await p.goto(`${s.base}/e/${ev.id}`);
    await p.getByText(/1:15pm/).first().waitFor();
    await p.context().close();
  });

  test('double-tapping "Offer my seats" creates one lift', async () => {
    const p = await page();
    await p.goto(`${s.base}/e/${ev.id}`);
    await p.getByRole('button', { name: /offer seats/ }).click();
    await p.locator('input[name=name]').fill('Double Tapper');
    await p.locator('input[name=area]').fill('Levenshulme');
    await p.locator('input[name=depart_time]').fill('12:30');
    await p.locator('input[name=phone]').fill(phone());
    await p.locator('input[name=consent]').check(); await p.locator('input[name=adult]').check();
    await p.getByRole('button', { name: 'Offer my seats' }).dblclick();
    await p.getByText('Your lift is listed!').waitFor();
    const all = (await s.api('GET', `/api/admin/events/${ev.id}`, undefined, ADMIN)).json.offers;
    assert.equal(all.filter(o => o.name === 'Double Tapper').length, 1);
    await p.context().close();
  });

  test('blocked browser storage (private mode): the user still sees their lift and is told to save the link', async () => {
    const p = await page();
    await p.addInitScript(() => {
      const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
      Storage.prototype.setItem = boom; Storage.prototype.getItem = boom;
    });
    await p.goto(`${s.base}/e/${ev.id}`);
    await p.getByRole('button', { name: /offer seats/ }).click();
    await p.locator('input[name=name]').fill('Private Mode');
    await p.locator('input[name=area]').fill('Rusholme');
    await p.locator('input[name=depart_time]').fill('12:20');
    await p.locator('input[name=phone]').fill(phone());
    await p.locator('input[name=consent]').check(); await p.locator('input[name=adult]').check();
    await p.getByRole('button', { name: 'Offer my seats' }).click();
    await p.getByText('Your lift is listed!').waitFor();
    await p.getByText(/isn't saving data/).waitFor();
    await p.getByTestId('offer-card').waitFor();
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  test('stale saved link (entry already erased) is tidied away quietly', async () => {
    const o = (await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: phone() }))).json;
    await s.api('DELETE', '/api/me', undefined, o.token);
    const p = await page();
    await p.addInitScript(t => localStorage.setItem('flowride:bookings', JSON.stringify([{ token: t, kind: 'offer', eventId: 'x', title: 'Old', startsAt: '' }])), o.token);
    await p.goto(s.base + '/me');
    await p.getByText("You haven't offered or requested").waitFor();
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('flowride:bookings')).length), 0);
    await p.context().close();
  });

  test('offline: the installed site opens to the app shell, and personal data is never cached', async () => {
    const p = await page();
    await p.goto(s.base);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload();
    await p.getByText('Upcoming events').waitFor();
    // a real flow while online
    const o = (await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: phone() }))).json;
    await p.goto(`${s.base}/m/${o.token}`);
    await p.getByTestId('offer-card').waitFor();
    const cached = await p.evaluate(async () => {
      const urls = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
      return urls;
    });
    assert.ok(cached.length > 0, 'service worker cached nothing');
    assert.ok(!cached.some(u => u.includes('/api/') || u.includes('/m/')), cached.join('\n'));

    await p.context().setOffline(true);
    await p.goto(s.base + '/privacy').catch(() => {});
    const body = await p.textContent('body');
    assert.match(body, /FlowRide/);
    assert.match(body, /Privacy notice|offline|Can't reach FlowRide/);
    await p.context().close();
  });

  test('inside the iPhone/Android app: native share and Android back button work', async () => {
    const p = await page();
    await p.addInitScript(() => {
      window.__log = [];
      window.Capacitor = {
        isNativePlatform: () => true, getPlatform: () => 'android',
        Plugins: {
          Share: { share: async o => { window.__log.push(['share', o]); } },
          App: { addListener: (name, cb) => { window.__back = cb; }, exitApp: () => window.__log.push(['exit']) },
        },
      };
    });
    await p.goto(s.base);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('native-app')));
    assert.equal(await p.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length)), 0, 'no service worker inside the app');
    await p.getByText("Jumu'ah at Didsbury Mosque").click();
    await p.getByRole('button', { name: 'Share', exact: true }).click();
    const shared = await p.evaluate(() => window.__log.find(l => l[0] === 'share')[1]);
    assert.equal(shared.url, `${s.base}/e/${ev.id}`);
    await p.evaluate(() => window.__back());
    await p.waitForURL(s.base + '/');
    await p.evaluate(() => window.__back());
    assert.ok(await p.evaluate(() => window.__log.some(l => l[0] === 'exit')), 'back on home screen should exit the app');
    await p.context().close();
  });

  test('keyboard users: Escape closes the form and focus is visible', async () => {
    const p = await page({ isMobile: false, hasTouch: false, viewport: { width: 1200, height: 900 } });
    await p.goto(`${s.base}/e/${ev.id}`);
    await p.getByRole('button', { name: /offer seats/ }).click();
    await p.getByRole('dialog').waitFor();
    await p.keyboard.press('Escape');
    await p.getByRole('dialog').waitFor({ state: 'detached' });
    await p.keyboard.press('Tab');
    const outline = await p.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return el !== document.body && (cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'); });
    assert.ok(outline, 'focused element has no visible focus style');
    await p.context().close();
  });

  for (const [label, url, prep] of [
    ['home', '/', null],
    ['event page with the request form open', () => `/e/${ev.id}`, async p => { await p.getByRole('button', { name: 'Request seat' }).first().click(); await p.getByRole('dialog').waitFor(); }],
    ['my rides with a confirmed lift', null, null],
    ['privacy notice', '/privacy', null],
    ['organiser login', '/organisers', null],
  ]) test(`accessibility (axe, WCAG 2.2 AA): ${label}`, async () => {
    const p = await page({ bypassCSP: true });
    if (label.startsWith('my rides')) {
      const o = (await s.api('POST', `/api/events/${ev.id}/offers`, driver({ phone: phone() }))).json;
      const r = (await s.api('POST', `/api/offers/${o.id}/requests`, rider({ phone: phone() }))).json;
      await s.api('POST', `/api/me/requests/${r.id}/accept`, {}, o.token);
      await p.goto(`${s.base}/m/${o.token}`);
      await p.getByTestId('offer-card').waitFor();
    } else {
      await p.goto(s.base + (typeof url === 'function' ? url() : url));
      await p.waitForLoadState('networkidle');
      if (prep) await prep(p);
    }
    await p.addScriptTag({ path: AXE });
    const res = await p.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }));
    const bad = res.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    await p.context().close();
    assert.deepEqual(bad.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`), []);
  });
});
