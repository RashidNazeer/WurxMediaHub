#!/usr/bin/env node
/**
 * THE TIER TAG AND THE DEALS BADGE, ON THE ACTUAL SCREEN, AGAINST THE DATABASE.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-tier-deals-ui.mjs
 *
 * Rashid, 2026-09-16: beside each creator's L tier, a small circle with the
 * number of deals we have had with that person, and a new L0-L7 palette.
 *
 * Deals: every badge sits on the corner of the creator's face, and costs the
 * name no width (beside the tier tag it cut names to one letter at 1600px).
 *
 * THE COUNT FOLLOWS THE MONTH PICKER (Rashid, 2026-09-16: "month wise ... not
 * overal"). With a month chosen it counts that month's deals across every
 * brand; under All Time it counts the person's whole history. Both numbers are
 * made HERE from `wurxbase.creators`, on the same key the screen uses (trimmed,
 * lower-cased name), and both are checked on screen. The count comes from the
 * database first; a page with no badges is a FAILURE, never a pass.
 *
 * Tiers: in BOTH themes, every tier tag's ink is the `--wx-tier-N` token of its
 * own tier, and no two tiers on the screen share an ink (L3 and L4 used to).
 *
 * BRAND and MONTH default to Penetrex, 2026-09. Screenshots go to SHOTS_DIR.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Penetrex';
const MONTH = process.env.MONTH || '2026-09';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const key = (name) => String(name || '').trim().toLowerCase();

/* ── the truth: this month's deals per person, and the lifetime count ───── */
const monthDeals = new Map();
const lifetime = new Map();
let total = 0;
for (let from = 0; ; from += 1000) {
  const { data, error } = await wb.from('creators').select('id,name,hiring_date').order('id').range(from, from + 999);
  if (error) throw error;
  for (const r of data) {
    const k = key(r.name);
    if (!k) continue;
    lifetime.set(k, (lifetime.get(k) || 0) + 1);
    if (String(r.hiring_date || '').slice(0, 7) === MONTH) monthDeals.set(k, (monthDeals.get(k) || 0) + 1);
  }
  total += data.length;
  if (data.length < 1000) break;
}
const repeat = [...monthDeals.values()].filter((n) => n > 1).length;
/* The two counts must actually DIFFER for somebody, or the month check would
   pass just as well against a lifetime count and prove nothing. */
const differs = [...monthDeals.keys()].filter((k) => lifetime.get(k) !== monthDeals.get(k)).length;
console.log(`database: ${total} deal rows · ${lifetime.size} people · in ${MONTH}: ${monthDeals.size} people, ${repeat} with more than one deal · ${differs} whose month count differs from their lifetime count`);
check(repeat > 0 && differs > 0, `${MONTH} holds people with more than one deal, and people whose month count differs from their lifetime one`, `${repeat} with several, ${differs} differing`);

/* ── reading the screen ────────────────────────────────────────────────── */
const readRows = (page, rowSel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((row) => ({
  name: (row.querySelector('.pc-cname') || {}).textContent?.trim() || '',
  badge: (row.querySelector('.pc-facewrap > .pc-dealsbadge') || {}).textContent?.trim() || '',
  loose: row.querySelectorAll('.pc-dealsbadge').length - row.querySelectorAll('.pc-facewrap > .pc-dealsbadge').length,
  title: (row.querySelector('.pc-dealsbadge') || { getAttribute: () => '' }).getAttribute('title') || '',
})), rowSel);

function compareDeals(label, rows, want_ = monthDeals, saying = /in /) {
  const wrong = [];
  let compared = 0;
  for (const r of rows) {
    const want = want_.get(key(r.name));
    if (!want) continue;
    compared++;
    if (String(want) !== r.badge) wrong.push(`${r.name}: badge ${r.badge || 'MISSING'}, database ${want}`);
  }
  const many = rows.filter((r) => Number(r.badge) > 1).length;
  const loose = rows.filter((r) => r.loose > 0).length;
  check(loose === 0, `${label}: every badge sits on the creator's face`, loose ? `${loose} rows have a badge somewhere else` : '');
  check(compared > 0 && wrong.length === 0, `${label}: every deals badge matches the database (${compared} rows, ${many} showing more than one)`, wrong.slice(0, 4).join(' | '));
  const t = rows.find((r) => r.badge)?.title || '';
  check(saying.test(t) && /deals? with this creator/.test(t), `${label}: the badge says what it counts on hover`, t || 'no title');
}

/* every tier tag's ink is its own token, and no two tiers share one */
const readTiers = (page) => page.evaluate(() => {
  const toRgb = (v) => { const d = document.createElement('span'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
  const root = getComputedStyle(document.documentElement);
  const want = {};
  for (let n = 0; n <= 7; n++) want['l' + n] = toRgb(root.getPropertyValue('--wx-tier-' + n).trim());
  const seen = {};
  for (const b of document.querySelectorAll('.pc-tierbadge')) {
    const t = [...b.classList].find((c) => /^l[0-7]$/.test(c));
    if (!t) continue;
    (seen[t] = seen[t] || new Set()).add(getComputedStyle(b).color);
  }
  return { theme: document.documentElement.dataset.theme, want, seen: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]])) };
});

const checkedPalette = new Set();
function compareTiers(label, got) {
  const tiers = Object.keys(got.seen).sort();
  const wrong = [];
  for (const t of tiers) {
    if (got.seen[t].length !== 1 || got.seen[t][0] !== got.want[t]) wrong.push(`${t.toUpperCase()} ink ${got.seen[t].join(' / ')}, token ${got.want[t]}`);
  }
  check(tiers.length >= 2 && wrong.length === 0, `${label} (${got.theme}): every tier tag wears its own tier's ink (${tiers.map((t) => t.toUpperCase()).join(' ')})`, wrong.slice(0, 3).join(' | ') || (tiers.length < 2 ? 'fewer than two tiers on screen' : ''));
  if (!checkedPalette.has(got.theme)) {
    checkedPalette.add(got.theme);
    check(new Set(Object.values(got.want)).size === 8, `${got.theme}: the eight tier inks are eight different colours`, Object.values(got.want).join(' '));
  }
}

/* Through the app's own theme provider: it listens for the storage event.
   Writing data-theme by hand does not stick, the provider paints it back. */
async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('wurxmediahub-theme', t);
    window.dispatchEvent(new StorageEvent('storage', { key: 'wurxmediahub-theme' }));
  }, theme);
  const ok = await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 8000 }).then(() => true, () => false);
  if (!ok) throw new Error(`could not switch the screen to ${theme}`);
  await page.waitForTimeout(500);
}

/* The name gets the same width with the badges as without them. */
const nameWidths = (page, rowSel) => page.evaluate((sel) =>
  [...document.querySelectorAll(sel)].slice(0, 12).map((r) => (r.querySelector('.pc-cname') || {}).clientWidth || 0), rowSel);
async function checkNameRoom(page, label, rowSel) {
  const withBadge = await nameWidths(page, rowSel);
  await page.addStyleTag({ content: '.pc-dealsbadge{display:none!important}' });
  await page.waitForTimeout(300);
  const without = await nameWidths(page, rowSel);
  await page.evaluate(() => document.querySelectorAll('style').forEach((x) => { if (x.textContent.includes('pc-dealsbadge{display:none')) x.remove(); }));
  const lost = withBadge.map((w, i) => without[i] - w).filter((d) => d > 1);
  check(withBadge.length > 0 && lost.length === 0, `${label}: the badge costs the creator's name no width`, lost.length ? `${lost.length} names lost up to ${Math.max(...lost)}px` : `${withBadge.length} rows`);
}

async function closeUp(page, rowSel, file) {
  if (!SHOTS) return;
  const box = await page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)].slice(0, 6);
    if (!rows.length) return null;
    const a = rows[0].getBoundingClientRect(), b = rows[rows.length - 1].getBoundingClientRect();
    return { x: Math.max(0, a.x), y: Math.max(0, a.y - 4), width: Math.min(760, a.width), height: b.bottom - a.y + 8 };
  }, rowSel);
  if (box) await page.screenshot({ path: `${SHOTS}/${file}`, clip: box });
}

/* ── the screen ────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 160)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
  await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

  /* the brand page, for one brand and month */
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(4000); }
  const showingAll = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /all time/i.test(x.textContent || ''));
    return /click to filter by month/i.test((b && b.getAttribute('title')) || '');
  });
  if (showingAll) { await page.locator('button', { hasText: /all time/i }).first().click(); await page.waitForTimeout(4000); }
  await page.evaluate((m) => {
    const inp = document.querySelector('input.pc-chrome-input');
    if (!inp) return;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, m);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, MONTH);
  await page.waitForTimeout(8000);
  await page.locator('.pc-bt-row', { hasText: BRAND }).first().click();
  await page.waitForSelector('.pc-ct-row .pc-dealsbadge', { timeout: 30000 }).catch(() => {});
  /* tiers come from Euka after the table paints */
  await page.waitForSelector('.pc-ct-row .pc-tierbadge', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);

  compareDeals(`brand page, ${BRAND} ${MONTH}`, await readRows(page, '.pc-ct-row'));
  await checkNameRoom(page, 'brand page at 1600px', '.pc-ct-row');
  await page.locator('.pc-ct-row').first().scrollIntoViewIfNeeded().catch(() => {});
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    compareTiers('brand page', await readTiers(page));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-${theme}.png` });
    await closeUp(page, '.pc-ct-row', `brand-rows-${theme}.png`);
  }
  await setTheme(page, 'dark');

  /* the Creators tab: its own list is month-filtered, the count must not be */
  await page.goto(`${BASE}/admin/collabs/creators`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-cv-row .pc-dealsbadge', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(6000);
  compareDeals(`Creators tab, ${MONTH}`, await readRows(page, '.pc-cv-row'));
  await checkNameRoom(page, 'Creators tab at 1600px', '.pc-cv-row');
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    if (await page.locator('.pc-cv-row .pc-tierbadge').count()) compareTiers('Creators tab', await readTiers(page));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/creators-${theme}.png` });
    await closeUp(page, '.pc-cv-row', `creators-rows-${theme}.png`);
  }

  /* All Time: the same circles must now show the whole history. This is the
     half that proves the number is not simply the lifetime count relabelled. */
  await page.locator('button', { hasText: /all time/i }).first().click();
  await page.waitForTimeout(9000);
  compareDeals('Creators tab, All Time', await readRows(page, '.pc-cv-row'), lifetime, /all time/i);

  /* a phone: the badge must not push the row sideways */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, 'Creators tab at 390px: no sideways page scroll', `${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/creators-390-light.png` });

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
