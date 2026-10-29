#!/usr/bin/env node
/**
 * Ads Manager, in a real browser: the whole admin app, and every Paid Collabs
 * control that goes by role.
 *
 *   pnpm build && pnpm preview
 *   ADS_MANAGER_PASSWORD=... node scripts/verify/collabs/check-ads-manager-ui.mjs
 *
 * The database half is `verify:ads-manager`. This is the half a person meets:
 * Rashid's words were "the same edit access as asad and rashid", so the
 * assertions are the controls Asad reported missing on 2026-09-03 — Payment
 * Sent and Delete — plus the ones the read-only roles had taken away.
 *
 * NOTHING HERE CHANGES DATA. The status menu is opened, read and dismissed
 * without choosing an option; the creator editor is opened, read, and left by
 * navigating away, never by a button inside it.
 */
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EMAIL = process.env.ADS_MANAGER_EMAIL || 'subhan@wurxmedia.com';
const PW = process.env.ADS_MANAGER_PASSWORD;
if (!PW) throw new Error('ADS_MANAGER_PASSWORD must be set');

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const vis = `(e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }`;

const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 160)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();
  await page.waitForTimeout(9000);

  check(new URL(page.url()).pathname === '/admin', 'lands on the admin dashboard, like Ops', page.url());

  /* ── the whole admin menu, not just Paid Collabs ────────────────────── */
  const nav = await page.evaluate((v) => {
    const isVis = eval(v);
    return [...new Set([...document.querySelectorAll('nav a[href]')].filter(isVis)
      .map((a) => a.getAttribute('href')))];
  }, vis);
  const adminRows = nav.filter((h) => h.startsWith('/admin') && !h.startsWith('/admin/collabs'));
  const collabRows = nav.filter((h) => h.startsWith('/admin/collabs'));
  check(adminRows.length >= 5, 'the menu shows the admin screens', adminRows.join(', '));
  check(collabRows.length === 6, 'and all six Paid Collabs tabs', collabRows.join(', '));

  for (const path of ['/admin/applications', '/admin/creators', '/admin/brands', '/admin/offers', '/admin/contests']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    check(new URL(page.url()).pathname === path, `${path} renders for them`, 'landed on ' + new URL(page.url()).pathname);
  }

  /* ── Paid Collabs: who their app thinks this is ─────────────────────── */
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const wbRole = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('ch_user') || '{}').role || null; } catch { return null; }
  });
  check(wbRole === 'superadmin', 'Paid Collabs knows them as superadmin, as Asad is', String(wbRole));

  const brands = await page.evaluate((v) => {
    const isVis = eval(v);
    return {
      exports: [...document.querySelectorAll('button')].filter(isVis)
        .filter((b) => /export|csv/i.test(b.textContent || '')).length,
      notes: [...document.querySelectorAll('.pc-note-btn')].filter(isVis).length,
    };
  }, vis);
  check(brands.exports > 0, 'brands: Export is offered', brands.exports + ' found');
  check(brands.notes > 0, 'brands: notes are offered', brands.notes + ' found');

  /* ── creators: selection, and a status menu that includes Payment Sent ── */
  await page.goto(`${BASE}/admin/collabs/creators`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const cr = await page.evaluate((v) => {
    const isVis = eval(v);
    return {
      checks: [...document.querySelectorAll('input[type=checkbox]')].filter(isVis).length,
      pills: [...document.querySelectorAll('button.pc-badge-btn')].filter(isVis).length,
    };
  }, vis);
  check(cr.checks > 0, 'creators: rows can be selected', cr.checks + ' checkboxes');
  check(cr.pills > 0, 'creators: the status pill is a menu', cr.pills + ' clickable pills');

  if (cr.pills > 0) {
    await page.locator('button.pc-badge-btn').first().click();
    await page.waitForTimeout(900);
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('.pc-statusmenu .pc-statusopt')].map((b) => (b.textContent || '').trim()));
    check(opts.includes('Payment Sent'), 'the status menu offers Payment Sent', opts.join(' | ') || 'MENU DID NOT OPEN');
    /* dismiss WITHOUT choosing: their menu closes on any document click */
    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(500);
    const still = await page.evaluate(() => document.querySelectorAll('.pc-statusmenu').length);
    check(still === 0, 'and closes again without a choice being made', still + ' menus open');
  }

  /* ── the creator editor's Delete ─────────────────────────────────────── */
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(4000); }
  const row = page.locator('.pc-bt-row').first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await page.waitForTimeout(9000);
    const edit = page.locator('button[title="Edit creator"]').first();
    if (await edit.isVisible().catch(() => false)) {
      await edit.click();
      await page.waitForTimeout(2500);
      const del = await page.evaluate((v) => {
        const isVis = eval(v);
        return {
          editorDelete: [...document.querySelectorAll('.pc-modal-del')].filter(isVis).length,
          asadOnlyTrash: [...document.querySelectorAll('button[title="Delete creator (Asad only)"]')].filter(isVis).length,
        };
      }, vis);
      check(del.editorDelete === 1, 'the creator editor offers Delete', del.editorDelete + ' found');
      /* Not a gap: this icon checks Asad's USERNAME, and Rashid does not get
         it either. Asserted so a change to that rule is a decision, not a
         surprise. See FEATURE_MAP "Ads Manager became staff". */
      check(del.asadOnlyTrash === 0, 'the row trash icon stays Asad-only, as for Rashid', del.asadOnlyTrash + ' found');
    } else {
      check(false, 'the creator editor could be opened', 'no Edit creator button — THIS CHECK SAW NOTHING');
    }
  } else {
    check(false, 'a brand could be opened', 'no brand row — THIS CHECK SAW NOTHING');
  }
  /* leave by navigating, never through a button in the editor */
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
