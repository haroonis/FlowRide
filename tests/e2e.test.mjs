// Browser flows on a phone-sized screen. Needs `npm run build` first.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startServer, loadPlaywright, ROOT, ADMIN } from './helpers.mjs';

const pw = loadPlaywright();
const skip = !pw ? 'playwright not installed' : !existsSync(path.join(ROOT, 'dist/index.html')) ? 'run `npm run build` first' : false;
let s, browser;
before(async () => { if (skip) return; s = await startServer(); browser = await pw.chromium.launch(); });
after(async () => { await browser?.close(); await s?.stop(); });

async function phone() {
  const ctx = await browser.newContext({ ...pw.devices['iPhone 13'], permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  p.on('dialog', d => d.accept());
  return p;
}
const EVENT = "Jumu'ah at Didsbury Mosque";

describe('E2E on a phone', { skip }, () => {
  let driverPage, riderPage;

  test('home lists events, search filters them, no horizontal scroll', async () => {
    const p = await phone();
    await p.goto(s.base);
    await p.getByText(EVENT).waitFor();
    await p.getByLabel('Search events').fill('didsbury');
    assert.equal(await p.getByRole('link', { name: /Jumu'ah/ }).count(), 1);
    await p.getByLabel('Search events').fill('zzz');
    await p.getByText('No events match').waitFor();
    const [sw, w] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.equal(sw, w);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  test('driver offers seats (blocked until consent + 18+ ticked)', async () => {
    driverPage = await phone();
    const p = driverPage;
    await p.goto(s.base);
    await p.getByText(EVENT).click();
    await p.getByRole('button', { name: /offer seats/ }).click();
    await p.locator('input[name=name]').fill('Usman Farooq');
    await p.locator('input[name=area]').fill('Chorlton');
    await p.locator('input[name=depart_time]').fill('12:40');
    await p.locator('input[name=phone]').fill('07700 900111');
    const btn = p.getByRole('button', { name: 'Offer my seats' });
    assert.ok(await btn.isDisabled());
    await p.locator('input[name=consent]').check();
    assert.ok(await btn.isDisabled());
    await p.locator('input[name=adult]').check();
    await btn.click();
    await p.getByText('Your lift is listed!').waitFor();
    const save = await p.getByRole('link', { name: 'Send to myself on WhatsApp' }).getAttribute('href');
    assert.match(save, /^https:\/\/wa\.me\/\?text=.*%2Fm%2Fo\./);
  });

  test('server-side error is shown in the form (bad phone number)', async () => {
    const p = await phone();
    await p.goto(s.base);
    await p.getByText(EVENT).click();
    await p.getByRole('button', { name: 'Request seat' }).click();
    await p.locator('input[name=name]').fill('X'); await p.locator('input[name=area]').fill('Y');
    await p.locator('input[name=phone]').fill('123');
    await p.locator('input[name=consent]').check(); await p.locator('input[name=adult]').check();
    await p.getByRole('button', { name: 'Send request' }).click();
    await p.getByRole('alert').filter({ hasText: 'valid mobile' }).waitFor();
    await p.context().close();
  });

  test('rider requests a seat and waits; no phone numbers shown', async () => {
    riderPage = await phone();
    const p = riderPage;
    await p.goto(s.base);
    await p.getByText(EVENT).click();
    await p.getByText('Usman', { exact: true }).waitFor();
    assert.ok(!(await p.textContent('body')).includes('900 111'));
    await p.getByRole('button', { name: 'Request seat' }).click();
    await p.locator('input[name=name]').fill('Fatima Siddiqui');
    await p.locator('input[name=area]').fill('Withington');
    await p.locator('select[name=passengers]').selectOption('2');
    await p.locator('input[name=phone]').fill('+44 7700 900222');
    await p.locator('input[name=consent]').check(); await p.locator('input[name=adult]').check();
    await p.getByRole('button', { name: 'Send request' }).click();
    await p.getByText('Request sent!').waitFor();
    await p.getByText('Waiting for driver').waitFor();
    assert.equal(await p.getByRole('link', { name: 'WhatsApp', exact: true }).count(), 0);
  });

  test('driver accepts → both get WhatsApp + call buttons; rider updates without reloading', async () => {
    await driverPage.reload();
    await driverPage.getByText('Fatima Siddiqui').waitFor();
    await driverPage.getByRole('button', { name: 'Accept' }).click();
    const dwa = await driverPage.getByTestId('request-row').getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
    assert.match(dwa, /^https:\/\/wa\.me\/447700900222\?text=Hi%20Fatima/);
    assert.equal(await driverPage.getByRole('link', { name: 'Call' }).getAttribute('href'), 'tel:+447700900222');

    await riderPage.getByText("You're in!").waitFor({ timeout: 30_000 }); // picked up by polling (every 20s at first)
    const rwa = await riderPage.getByRole('link', { name: 'WhatsApp', exact: true }).getAttribute('href');
    assert.match(rwa, /^https:\/\/wa\.me\/447700900111\?text=Hi%20Usman/);
  });

  test('private link restores the ride on another phone and hides the token from the URL', async () => {
    const token = await driverPage.evaluate(() => JSON.parse(localStorage.getItem('flowride:bookings'))[0].token);
    const p = await phone();
    await p.goto(`${s.base}/m/${token}`);
    await p.getByText('Fatima Siddiqui').waitFor();
    assert.equal(new URL(p.url()).pathname, '/me');
    await p.context().close();
  });

  test('rider deletes their data; driver no longer sees them', async () => {
    await riderPage.getByText('Your data').click();
    await riderPage.getByRole('button', { name: 'Delete now' }).click();
    await riderPage.getByText("You haven't offered or requested").waitFor();
    await driverPage.reload();
    await driverPage.getByText('No requests yet').waitFor();
    assert.deepEqual(riderPage.errors, []);
    assert.deepEqual(driverPage.errors, []);
  });

  test('organiser logs in and creates an event that appears on the home page', async () => {
    const p = await phone();
    await p.goto(s.base + '/organisers');
    await p.locator('input[name=admin]').fill('wrong');
    await p.getByRole('button', { name: 'Log in' }).click();
    await p.getByText('Wrong admin password').waitFor();
    await p.locator('input[name=admin]').fill(ADMIN);
    await p.getByRole('button', { name: 'Log in' }).click();
    await p.getByRole('button', { name: 'New event' }).click();
    await p.locator('input[name=title]').fill('Eid prayer in the park');
    await p.locator('input[name=venue]').fill('Platt Fields');
    await p.locator('input[name=starts_at]').fill('2030-04-10T08:30');
    await p.getByRole('button', { name: 'Create' }).click();
    await p.getByText('Eid prayer in the park').waitFor();
    await p.goto(s.base);
    await p.getByText('Eid prayer in the park').waitFor();
    await p.context().close();
  });

  test('installable PWA: manifest, icons and service worker are served', async () => {
    const m = await (await fetch(s.base + '/manifest.webmanifest')).json();
    assert.equal(m.display, 'standalone');
    for (const i of m.icons) assert.equal((await fetch(s.base + i.src)).status, 200, i.src);
    assert.equal((await fetch(s.base + '/sw.js')).status, 200);
    assert.equal((await fetch(s.base + '/offline.html')).status, 200);
  });
});
