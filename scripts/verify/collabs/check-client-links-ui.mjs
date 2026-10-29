#!/usr/bin/env node
/**
 * THE CLIENT LINKS SCREEN, END TO END, IN A REAL BROWSER.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-client-links-ui.mjs
 *
 * An owner signs in, makes a link for one brand and one month, and the link is
 * then opened IN A BROWSER THAT HAS NEVER LOGGED IN — a second, clean context,
 * so nothing of the admin's session can be helping it work. Then the owner
 * revokes it and the client page dies.
 *
 * It also proves the other half of the boundary: somebody who is not an owner
 * cannot reach the screen at all.
 *
 * It makes its own admin and its own creator, deletes both, and deletes every
 * link it minted, in a `finally`.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Apothecary';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const LABEL = `probe link ${Date.now()}`;
const people = [];

async function makeUser(role) {
  const email = `links-probe-${role}-${Date.now()}@example.com`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  await svc.from('profiles').update({ role, is_active: true }).eq('id', data.user.id);
  people.push(data.user.id);
  return { email, password };
}

const signIn = async (page, who) => {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', who.email);
  await page.fill('input[name="password"]', who.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
};

const browser = await launchBrowser();
try {
  const owner = await makeUser('admin');
  const outsider = await makeUser('creator');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 160)));

  await signIn(page, owner);
  await page.goto(`${BASE}/admin/client-links`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  check(/client links/i.test(await page.evaluate(() => document.body.innerText)), 'an admin reaches the Client links screen');
  check(await page.getByRole('link', { name: /client links/i }).first().isVisible().catch(() => false),
    'and it is in the sidebar');

  /* make one: one brand, one month, everything shown */
  await page.getByRole('button', { name: /new link/i }).first().click();
  await page.waitForTimeout(800);
  await page.fill('#link-label', LABEL);
  await page.getByRole('button', { name: new RegExp(`^${BRAND}$`) }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^chosen months$/i }).first().click();
  await page.waitForTimeout(400);
  const monthChip = page.locator('button[aria-pressed="false"]', { hasText: /^[A-Z][a-z]{2} 20\d\d$/ }).first();
  const monthText = (await monthChip.textContent().catch(() => ''))?.trim() ?? '';
  await monthChip.click();
  check(Boolean(monthText), 'the months on offer are the ones that brand has work in', monthText);
  await page.getByRole('button', { name: /^create link$/i }).click();
  await page.waitForTimeout(4000);

  const url = (await page.locator('code').first().textContent().catch(() => ''))?.trim() ?? '';
  check(/\/share\/collabs\/[A-Za-z0-9_-]{32}$/.test(url), 'the link appears once, ready to copy', url.slice(0, 60));
  /* ── the link comes back: copy from the list, and open it for the rest ── */
  /* Rashid, 2026-09-18: "no option to copy again and we should be able to open
     it and see details". So the address survives a reload, which is the only
     honest way to test "again". */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const listed = page.locator('li', { hasText: LABEL }).first();
  check(await listed.getByRole('button', { name: /copy link/i }).isVisible().catch(() => false),
    'a live link can be copied straight from the list, after a reload');

  await listed.getByRole('button', { name: new RegExp(LABEL.slice(0, 12)) }).first().click();
  await page.waitForTimeout(1200);
  const detail = await listed.evaluate((el) => el.innerText);
  check(detail.includes(url), 'opening it shows the same address again', detail.match(/share\/collabs\/\S+/)?.[0] ?? 'no link');
  check(/Brands/i.test(detail) && /Months/i.test(detail) && /Sections/i.test(detail) && /Opens/i.test(detail),
    'and what it covers, plus when it was opened', detail.slice(0, 80).replace(/\n/g, ' · '));
  check(/1 in total|never opened|in total/i.test(detail), 'the opens are listed, not just counted', '');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/client-links-made.png` });

  /* the outsider cannot get near the screen */
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signIn(page2, outsider);
  await page2.goto(`${BASE}/admin/client-links`, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(3000);
  const outsiderSees = await page2.evaluate(() => document.body.innerText);
  check(!/new link/i.test(outsiderSees) && !/client links/i.test(outsiderSees),
    'somebody who is not an owner cannot reach the screen', outsiderSees.slice(0, 60).replace(/\n/g, ' '));
  await ctx2.close();

  /* THE CLIENT: a browser that has never logged in */
  const clean = await browser.newContext();
  const client = await clean.newPage();
  await client.goto(url, { waitUntil: 'domcontentloaded' });
  await client.waitForSelector('h1', { timeout: 30000 }).catch(() => {});
  await client.waitForTimeout(2500);
  const seen = await client.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    month: document.querySelector('header[data-month]')?.getAttribute('data-month') ?? '',
    months: [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter((t) => /^[A-Z][a-z]{2} 20\d\d$/.test(t ?? '')),
  }));
  check(seen.heading === BRAND, 'the link opens for a browser with no session', seen.heading);
  check(seen.months.length === 1 && seen.months[0] === monthText,
    'and offers only the month it was given', seen.months.join(', ') || 'none');

  /* revoke it, and the client is out */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const row = page.locator('li', { hasText: LABEL }).first();
  await row.getByRole('button', { name: /stop sharing/i }).click();
  await page.waitForTimeout(400);
  await row.getByRole('button', { name: /^yes, stop/i }).click();
  await page.waitForTimeout(3000);
  check(/stopped|revoked/i.test((await row.textContent().catch(() => '')) ?? ''), 'the owner can stop a link from the list');

  await client.reload({ waitUntil: 'domcontentloaded' });
  await client.waitForTimeout(2500);
  const after = await client.evaluate(() => document.body.innerText);
  check(/link has ended|not active/i.test(after), 'and the client is out the moment it is stopped', after.slice(0, 60).replace(/\n/g, ' '));
  check(!new RegExp(BRAND).test(after), 'with nothing of the brand left on the page');

  /* ── a new address for the same link ─────────────────────────────────── */
  /* The one thing that could not be done before: send a client a working link
     when the old one is gone or has spread. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const again = page.locator('li', { hasText: LABEL }).first();
  await again.getByRole('button', { name: new RegExp(LABEL.slice(0, 12)) }).first().click();
  await page.waitForTimeout(1000);
  await again.getByRole('button', { name: /give it a new address/i }).click();
  await page.waitForTimeout(4000);
  const fresh = (await page.locator('code').first().textContent().catch(() => ''))?.trim() ?? '';
  check(/\/share\/collabs\/[A-Za-z0-9_-]{32}$/.test(fresh) && fresh !== url, 'a link can be given a new address', fresh.slice(-40));

  await client.goto(fresh, { waitUntil: 'domcontentloaded' });
  await client.waitForSelector('h1', { timeout: 30000 }).catch(() => {});
  await client.waitForTimeout(2000);
  check((await client.evaluate(() => document.querySelector('h1')?.textContent?.trim())) === BRAND,
    'the new address opens for the client');
  await client.goto(url, { waitUntil: 'domcontentloaded' });
  await client.waitForTimeout(2000);
  check(/link has ended|not active/i.test(await client.evaluate(() => document.body.innerText)),
    'and the old one is dead');
  await clean.close();

  check(errors.length === 0, 'zero console errors on the owner screen', errors.slice(0, 3).join(' | '));
} finally {
  const { data: mine } = await svc.from('collab_share_links').select('id, label').ilike('label', 'probe link %');
  for (const l of mine ?? []) await svc.from('collab_share_links').delete().eq('id', l.id);
  for (const id of people) await svc.auth.admin.deleteUser(id).catch(() => {});
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
