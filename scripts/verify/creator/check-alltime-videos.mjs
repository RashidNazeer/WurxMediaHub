#!/usr/bin/env node
/* ALL TIME MUST MEAN ALL TIME.
 *
 * Erin Cooper has NINE Penetrex collabs and 88 videos; every row carries only
 * its own month, so expanding any one of them used to show ~15. In All time
 * the panel must now show all 88 and say it is doing so — and in a month view
 * it must go back to that one collab, because then the collab is the subject.
 * The truth is read from the DATABASE first, so the expected numbers are not
 * taken from the screen being tested.
 */
import { launchBrowser } from '../../lib/browser.mjs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const env = Object.fromEntries(readFileSync('.env.local', 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

/* ── what the database says, before the browser is opened ────────────── */
const { data } = await wb.from('creators').select('name,brand,hiring_date,video_codes').eq('brand', 'Penetrex');
const byPerson = new Map();
for (const c of data || []) {
  const k = (c.name || '').trim().toLowerCase();
  if (!k) continue;
  if (!byPerson.has(k)) byPerson.set(k, []);
  byPerson.get(k).push(c);
}
/* the person with the most collabs is the sharpest test */
const [who, rowsOf] = [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length)[0];
const uniq = new Set();
rowsOf.forEach((r) => (Array.isArray(r.video_codes) ? r.video_codes : [])
  .forEach((v) => { const u = String((v && v.video) || '').trim(); if (u) uniq.add(u); }));
const expectAll = uniq.size;
const biggest = rowsOf.slice().sort((a, b) =>
  (b.video_codes || []).length - (a.video_codes || []).length)[0];
const expectOne = new Set((biggest.video_codes || [])
  .map((v) => String((v && v.video) || '').trim()).filter(Boolean)).size;
console.log(`database: "${who}" has ${rowsOf.length} Penetrex collabs, ${expectAll} distinct videos`);
console.log(`          its biggest single collab (hired ${String(biggest.hiring_date).slice(0, 10)}) has ${expectOne}`);
check(rowsOf.length > 1 && expectAll > expectOne,
  'the test subject really does span several collabs',
  `${rowsOf.length} collabs, ${expectAll} vs ${expectOne}`);

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
const hi = page.getByRole('button', { name: /let.s go/i });
if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

const openPenetrexAllTime = async (allTime) => {
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  /* The drilldown survives a navigation back to /brands, so leave it before
     looking for brand rows — otherwise the second half waits thirty seconds
     for a list that is not on screen. */
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) {
    await back.first().click();
    await page.waitForTimeout(5000);
  }
  /* All Time is a toggle in the top bar */
  const state = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /all time/i.test(x.textContent || ''));
    return b ? b.getAttribute('title') || '' : null;
  });
  const showingAll = /click to filter by month/i.test(state || '');
  if (showingAll !== allTime) {
    await page.locator('button', { hasText: /all time/i }).first().click();
    await page.waitForTimeout(4000);
  }
  await page.locator('.pc-bt-row').first().waitFor({ timeout: 45000 }).catch(() => {});
  await page.locator('.pc-bt-row', { hasText: /Penetrex/ }).first().click();
  await page.waitForTimeout(9000);
};

const expandAndRead = async () => {
  const found = await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('.pc-ct-row')];
    const hit = rows.find((r) => (r.textContent || '').toLowerCase().replace(/s+/g, ' ').includes(name));
    if (!hit) return null;
    hit.click();
    return true;
  }, who);
  if (!found) return null;
  await page.waitForTimeout(6000);
  return page.evaluate(() => {
    const p = document.querySelector('.pc-vxp');
    if (!p) return null;
    const t = p.querySelector('.pc-vxp-title');
    const n = t ? Number((t.querySelector('b') || {}).textContent || 0) : 0;
    return {
      count: n,
      scope: (p.querySelector('.pc-vxp-scope') || {}).textContent || null,
      title: t ? t.textContent.replace(/\s+/g, ' ').trim() : null,
    };
  });
};

await openPenetrexAllTime(true);
const all = await expandAndRead();
console.log('ALL TIME  → ' + JSON.stringify(all));
check(all && all.count === expectAll,
  'All time shows every video that person posted for the brand',
  all ? `screen ${all.count}, database ${expectAll}` : 'panel not found');
check(all && /across \d+ collabs/i.test(all.scope || ''),
  'and the panel says it is showing more than one collab', all ? String(all.scope) : '');

/* A month view has to be a month she ACTUALLY has a collab in. The default
   is the current month and she has no September deal, so the row is simply
   not there — correct behaviour, wrong assumption in the first version. */
const bigMonth = String(biggest.hiring_date).slice(0, 7);
await openPenetrexAllTime(false);
await page.evaluate((m) => {
  const inp = document.querySelector('input.pc-chrome-input');
  if (!inp) return;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(inp, m);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
}, bigMonth);
await page.waitForTimeout(9000);
console.log('month set to ' + bigMonth);
const one = await expandAndRead();
console.log('ONE MONTH → ' + JSON.stringify(one));
check(one && one.count > 0 && one.count < expectAll,
  'a month view goes back to that one collab',
  one ? `${one.count} of ${expectAll}` : 'panel not found');
check(one && !one.scope, 'and drops the across-collabs note', one ? String(one.scope) : '');

check(errors.length === 0, 'zero console errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
