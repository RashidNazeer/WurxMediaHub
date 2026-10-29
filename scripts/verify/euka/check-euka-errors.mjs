#!/usr/bin/env node
/* Every way the EUKA button can fail must now name its own cause.
 *
 * The old build said `No EUKA store named "<brand>"` for all of them, which is
 * why one profile-level problem on one laptop took a day. Each case here is
 * forced deliberately and the screen is read back.
 */
import { launchBrowser } from '../../lib/browser.mjs';
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const PW = process.env.COLLAB_STAFF_PASSWORD || '1234567890';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PW);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
const hi = page.getByRole('button', { name: /let.s go/i });
if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

const openBrand = async () => {
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  const row = page.locator('.pc-bt-row').first();
  if (!(await row.isVisible().catch(() => false))) return false;
  await row.click();
  await page.waitForTimeout(9000);
  return true;
};

const clickSyncAndRead = async () => {
  const btn = page.locator('.pc-vidsync').first();
  if (!(await btn.isVisible().catch(() => false))) return { missing: true };
  await btn.click();
  await page.waitForTimeout(12000);
  return page.evaluate(() => {
    const el = document.querySelector('.pc-euka-why');
    return {
      headline: el ? (el.querySelector('b') || {}).textContent : null,
      detail: el ? (el.querySelector('span') || {}).textContent : null,
      oldMessageAnywhere: /No EUKA store named/i.test(document.body.innerText),
    };
  });
};

/* ── CASE 1 · the request is blocked before it leaves the browser.
   This is what an ad-blocker, privacy extension, VPN or firewall does, and
   it is the leading suspect for a profile that fails while a fresh profile
   on the same laptop works. ── */
await page.route('**/functions/v1/euka', (r) => r.abort('blockedbyclient'));
if (!(await openBrand())) { console.log('no brand row'); await browser.close(); process.exit(1); }
const blocked = await clickSyncAndRead();
check(!!blocked.headline, 'blocked request: the screen explains itself', JSON.stringify(blocked).slice(0, 200));
check(/extension|VPN|firewall|offline|never reached/i.test(blocked.detail || ''),
  'blocked request: it names an extension or the connection as the cause', blocked.detail);
check(!blocked.oldMessageAnywhere, 'blocked request: it does NOT blame the store name', blocked.detail);

/* ── CASE 2 · the server rejects the session ── */
await page.unroute('**/functions/v1/euka');
await page.route('**/functions/v1/euka', (r) => r.fulfill({
  status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not signed in' }),
}));
await openBrand();
const unauth = await clickSyncAndRead();
check(/session/i.test(unauth.detail || ''), '401: it says the session was rejected', unauth.detail);
check(/sign out and sign in/i.test(unauth.detail || ''), '401: and says what to do', unauth.detail);

/* ── CASE 3 · this account is not allowed ── */
await page.unroute('**/functions/v1/euka');
await page.route('**/functions/v1/euka', (r) => r.fulfill({
  status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Not allowed' }),
}));
await openBrand();
const forbidden = await clickSyncAndRead();
check(/not allowed|role/i.test(forbidden.detail || ''), '403: it points at the account, not the brand', forbidden.detail);

/* ── CASE 4 · EUKA answers, but has no store by that name.
   The ONLY case where the old message was ever correct. ── */
await page.unroute('**/functions/v1/euka');
await page.route('**/functions/v1/euka', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ stores: [{ id: 1, name: 'Some Other Shop' }, { id: 2, name: 'A Third Shop' }] }),
}));
await openBrand();
const nostore = await clickSyncAndRead();
check(/no store/i.test(nostore.headline || ''), 'genuinely missing store: it says so', nostore.headline);
check(/Some Other Shop/.test(nostore.detail || ''),
  'genuinely missing store: and lists what EUKA actually has', nostore.detail);

await browser.close();
console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
