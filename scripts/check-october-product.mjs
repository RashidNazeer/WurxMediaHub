#!/usr/bin/env node
/**
 * A PRODUCT IS COMPULSORY FROM OCTOBER, AND NOT ONE DAY EARLIER.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/check-october-product.mjs
 *
 * Rashid, 2026-09-24: "I want from october and onwards (not before october
 * please) it should be compulsory to choose the product while onboarding".
 *
 * THE SECOND HALF OF THAT SENTENCE IS THE DANGEROUS ONE. The same modal edits
 * creators hired months ago, so a rule read off today's clock would start
 * refusing to save a September row the moment October arrived — hundreds of
 * existing rows unsaveable, which is exactly what "not before October" forbids.
 * The rule therefore keys on the ROW'S OWN onboarding date, and the check below
 * proves both directions rather than only the new one.
 *
 * It also proves the escape hatch. Of the brands actually being worked — 11 in
 * September 2026, which is what the Brands screen lists — 9 have a catalogue we
 * can read and 2 do not: Aqua Sonic and Pure Daily Care, both on Cruva. For
 * those two, "compulsory" has to mean a product that can be TYPED.
 *
 * NOTHING IS WRITTEN. Every write to the creators table is intercepted in the
 * browser and answered with a fake success, and that is proved at the end
 * rather than asserted.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser, ensureAllTime } from './browser.mjs';
import { assertDevProject } from './lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
/* A brand with a catalogue, and one without: the rule must behave the same on
   both, and only the second can prove the typed escape hatch. */
const WITH_CATALOGUE = process.env.EUKA_BRAND || 'Penetrex';
/* THE BRANDS SCREEN LISTS THE BRANDS ACTIVE IN THE SELECTED MONTH — 11 in
   September 2026, not the 44 distinct names that exist across the whole
   history — so this has to be one of those. Aqua Sonic is both: it is on the
   screen and it is one of the two no platform can answer for. */
const NO_CATALOGUE = process.env.BARE_BRAND || 'Aqua Sonic';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
const written = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 140)));

  await page.route('**/rest/v1/creators*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' || req.method() === 'PATCH') {
      try {
        const raw = JSON.parse(req.postData() || '{}');
        written.push({ method: req.method(), body: Array.isArray(raw) ? raw[0] : raw });
      } catch { /* not json */ }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([{ id: 999999 }]) });
    }
    return route.continue();
  });

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
  await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(2500); }
  await page.waitForTimeout(1500);

  const openModal = async (brand) => {
    /* ALWAYS START FROM THE BRANDS LIST. Coming back from a save can leave the
       app on a brand's own page, where the row being looked for does not exist
       — and a check reading "brand not found" would then be reporting on the
       navigation rather than on the brand. */
    await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
    const back0 = page.locator('.pc-back');
    if (await back0.first().isVisible().catch(() => false)) { await back0.first().click(); await page.waitForTimeout(2500); }
    await page.waitForSelector('.pc-bt-row', { timeout: 30000 }).catch(() => {});
    /* ALL TIME, OR THE CALENDAR DECIDES WHAT THIS FILE CAN TEST. The Brands
       screen lists the brands active in the selected month, and this check
       needs two specific ones — a brand with a catalogue and a brand without.
       Aqua Sonic has no October work, so on 1 October the no-catalogue half
       started reporting "Aqua Sonic is not on the Brands screen" about a brand
       that is simply not being worked this month. Nothing here is about the
       month. */
    await ensureAllTime(page);
    await page.waitForTimeout(800);
    const row = page.locator('.pc-bt-row')
      .filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${brand}\\s*$`) }) }).first();
    /* The list is long: a row below the fold is present but not "visible". */
    if (!(await row.count().catch(() => 0))) return false;
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await row.click();
    await page.waitForSelector('.pc-ct-row, .pc-empty', { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /\+\s*creator/i }).first().click();
    await page.waitForSelector('[data-wx="product-trigger"]', { timeout: 20000 });
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-wx="product-trigger"]');
      return !!t && !/loading/i.test(t.textContent || '');
    }, null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(400);
    return true;
  };
  const closeModal = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const back2 = page.locator('.pc-back');
    if (await back2.first().isVisible().catch(() => false)) { await back2.first().click(); await page.waitForTimeout(2000); }
  };
  const setDate = async (iso) => {
    const input = page.locator('.pc-cm-body input[type="date"]').first();
    await input.fill(iso);
    await page.waitForTimeout(500);
  };
  const setName = async (n) => {
    await page.locator('.pc-field', { has: page.locator('label:text-is("Name")') }).locator('input').first().fill(n);
    await page.waitForTimeout(300);
  };
  const trySave = async () => {
    const btn = page.getByRole('button', { name: /^(add creator|save changes|save)$/i }).first();
    if (!(await btn.isVisible().catch(() => false))) return { clicked: false };
    await btn.click();
    await page.waitForTimeout(1600);
    /* The banner carries `data-wx="save-error"` for exactly this: without a
       hook, a check cannot tell "refused, with a reason" from "silently did
       nothing", and those are the two outcomes that matter here. */
    const err = await page.evaluate(() =>
      (document.querySelector('[data-wx="save-error"]')?.textContent || '').trim().slice(0, 200));
    const stillOpen = await page.evaluate(() => !!document.querySelector('[data-wx="product-trigger"]'));
    return { clicked: true, err, stillOpen };
  };

  /* ── 1. SEPTEMBER IS UNTOUCHED ─────────────────────────────────────── */
  if (!(await openModal(WITH_CATALOGUE))) {
    check(false, `${WITH_CATALOGUE} is on the Brands screen`);
  } else {
    await setDate('2026-09-30');
    const sep = await page.evaluate(() => ({
      badge: !!document.querySelector('[data-wx="product-required"]'),
      hint: !!document.querySelector('[data-wx="product-required-hint"]'),
    }));
    check(!sep.badge && !sep.hint, 'a 30 September row is not asked for a product at all',
      `badge ${sep.badge}, hint ${sep.hint}`);
    await setName('ZZ October Check Sep');
    const r = await trySave();
    const sentSep = written.length;
    check(r.clicked && sentSep > 0, 'and it SAVES with no product chosen, exactly as before',
      `${sentSep} write(s) attempted${r.err ? `, error shown: "${r.err}"` : ''}`);
    await closeModal();
  }

  /* ── 2. OCTOBER REQUIRES ONE ───────────────────────────────────────── */
  const beforeOct = written.length;
  if (!(await openModal(WITH_CATALOGUE))) {
    check(false, `${WITH_CATALOGUE} opened a second time`);
  } else {
    await setDate('2026-10-01');
    const oct = await page.evaluate(() => ({
      badge: document.querySelector('[data-wx="product-required"]')?.textContent?.trim(),
      hint: document.querySelector('[data-wx="product-required-hint"]')?.textContent?.trim(),
    }));
    check(oct.badge === 'REQUIRED', 'a 1 October row says the product is REQUIRED, before anything is typed', `badge: ${oct.badge}`);
    check(!!oct.hint, 'and says so in words under the field', oct.hint ? `"${oct.hint.slice(0, 70)}…"` : 'no hint');

    await setName('ZZ October Check Oct');
    const r = await trySave();
    check(written.length === beforeOct, 'saving with no product is REFUSED — nothing is sent',
      `${written.length - beforeOct} write(s) attempted`);
    check(/product/i.test(r.err || '') && /october/i.test(r.err || ''),
      'and it says why, naming October', r.err ? `"${r.err}"` : 'no message shown');
    check(r.stillOpen, 'the drawer stays open so the product can be chosen');

    /* Now choose one; the same save must go through. */
    await page.locator('[data-wx="product-trigger"]').click();
    await page.waitForTimeout(600);
    const rows = await page.evaluate(() => document.querySelectorAll('[data-wx="product-list"] button').length);
    if (rows > 0) {
      await page.locator('[data-wx="product-list"] button').first().click();
      await page.waitForTimeout(500);
    }
    const r2 = await trySave();
    check(written.length > beforeOct, 'choosing a product lets the same row save',
      `${written.length - beforeOct} write(s)${r2.err ? `, error: "${r2.err}"` : ''}`);
    const sent = written[written.length - 1];
    check(!!sent && Array.isArray(sent.body?.products) && sent.body.products.length > 0,
      'and the product travels with it', sent ? JSON.stringify(sent.body?.products || []).slice(0, 90) : 'nothing sent');
    await closeModal();
  }

  /* ── 3. THE 35 BRANDS WITH NO CATALOGUE CAN STILL COMPLY ───────────── */
  const beforeBare = written.length;
  if (!(await openModal(NO_CATALOGUE))) {
    check(false, `${NO_CATALOGUE} is on the Brands screen (it is the no-catalogue case)`);
  } else {
    await setDate('2026-10-15');
    const state = await page.evaluate(() => ({
      badge: !!document.querySelector('[data-wx="product-required"]'),
      hint: document.querySelector('[data-wx="product-required-hint"]')?.textContent?.trim() || '',
    }));
    check(state.badge, `${NO_CATALOGUE}: an October row is required to have a product here too`);
    check(/type the product name/i.test(state.hint),
      'and, having no catalogue to read, it says to type the name instead of leaving a dead end',
      `"${state.hint.slice(0, 90)}"`);

    await page.locator('[data-wx="product-trigger"]').click();
    await page.waitForTimeout(600);
    await page.fill('[data-wx="product-search"]', 'Lunchbox Bundle');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const chosen = await page.evaluate(() => document.querySelectorAll('[data-wx="chosen-products"] > div').length);
    check(chosen === 1, 'a typed product is accepted as a chosen product', `${chosen} chosen`);

    await setName('ZZ October Check Bare');
    await trySave();
    check(written.length > beforeBare, 'and the row saves with it — October does not jam a brand with no catalogue',
      `${written.length - beforeBare} write(s)`);
  }

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

/* Nothing may have reached the table. Proved, not assumed. */
const svc = process.env.SUPABASE_SERVICE_KEY;
if (!svc) {
  check(false, 'SUPABASE_SERVICE_KEY was set, so the no-stray-row check could run');
} else {
  const admin = createClient(URL_, svc, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });
  const { data, error } = await admin.from('creators').select('id, name').ilike('name', 'ZZ October Check%');
  check(!error && (data?.length ?? 0) === 0, 'no test row reached Paid Collabs',
    error ? error.message : `${data?.length ?? 0} found`);
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
