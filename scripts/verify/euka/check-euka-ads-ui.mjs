#!/usr/bin/env node
/**
 * EUKA'S AD FIGURES, ON THE ACTUAL SCREEN, AGAINST THE DATABASE.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/euka/check-euka-ads-ui.mjs
 *
 * `verify:euka-ads` proves the reader. This proves that what a person sees in
 * Paid Collabs IS that reader's answer: for one brand and month, every creator
 * row's Ad spend and ROI are recomputed from `euka_ad_video_month` here, from
 * that row's own distinct TikTok video ids, and compared cell by cell.
 *
 * Also: a video whose row has no spark code, but for which Euka holds one,
 * shows Euka's code in the videos panel, and says it came from Euka.
 *
 * EXPECTED NUMBERS COME FROM THE DATABASE FIRST. If the brand has no synced
 * figures for the month yet, that is a FAILURE ("saw nothing"), never a pass.
 *
 * BRAND and MONTH default to Penetrex, 2026-09.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Penetrex';
const MONTH = process.env.MONTH || '2026-09';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const idsOf = (codes) => [...new Set((Array.isArray(codes) ? codes : [])
  .map((v) => (String(v?.video || '').match(/\/video\/(\d+)/) || [])[1]).filter(Boolean))];
const num = (t) => Number(String(t || '').replace(/[^0-9.-]/g, '')) || 0;

/* ── the truth ─────────────────────────────────────────────────────────── */
const { data: rows, error: rowErr } = await wb.from('creators').select('id,name,brand,hiring_date,video_codes').eq('brand', BRAND);
if (rowErr) throw rowErr;
const monthRows = rows.filter((r) => String(r.hiring_date || '').slice(0, 7) === MONTH);
const allIds = [...new Set(monthRows.flatMap((r) => idsOf(r.video_codes)))];
const figures = new Map();
for (let i = 0; i < allIds.length; i += 500) {
  const { data, error } = await svc.from('euka_ad_video_month')
    .select('item_id,cost,gross_revenue,currency').eq('month', `${MONTH}-01`).in('item_id', allIds.slice(i, i + 500));
  if (error) throw error;
  for (const f of data) {
    const cur = figures.get(f.item_id) || { cost: 0, revenue: 0 };
    cur.cost += Number(f.cost); cur.revenue += Number(f.gross_revenue);
    figures.set(f.item_id, cur);
  }
}
const expect = new Map();
const nameCount = new Map();
for (const r of monthRows) nameCount.set(r.name, (nameCount.get(r.name) || 0) + 1);
for (const r of monthRows) {
  if (nameCount.get(r.name) !== 1) continue;   // a name on two rows cannot be matched to one cell
  const ids = idsOf(r.video_codes);
  const got = ids.map((id) => figures.get(id)).filter(Boolean);
  const cost = got.reduce((t, f) => t + f.cost, 0);
  const revenue = got.reduce((t, f) => t + f.revenue, 0);
  expect.set(r.name, { withData: got.length, cost, roi: cost > 0 ? revenue / cost : null });
}
const withSpend = [...expect.entries()].filter(([, e]) => e.withData > 0);
console.log(`database: ${BRAND} ${MONTH} · ${monthRows.length} rows · ${allIds.length} videos · ${figures.size} with Euka figures · ${withSpend.length} creators with figures`);
check(withSpend.length > 0, `the database holds Euka figures for ${BRAND} in ${MONTH}`, withSpend.length ? '' : 'THE SYNC HAS NOT FILLED THIS MONTH YET — nothing below could be real');

/* a spark-code candidate: a video with no code on its row, but one in Euka */
const blankIds = monthRows.flatMap((r) => (Array.isArray(r.video_codes) ? r.video_codes : [])
  .filter((v) => !String(v?.adCode || '').trim())
  .map((v) => ({ name: r.name, id: (String(v?.video || '').match(/\/video\/(\d+)/) || [])[1] })))
  .filter((x) => x.id && nameCount.get(x.name) === 1);
let sparkCandidate = null;
for (let i = 0; i < blankIds.length && !sparkCandidate; i += 500) {
  const slice = blankIds.slice(i, i + 500);
  const { data } = await svc.from('euka_spark_codes').select('item_id,spark_code').in('item_id', slice.map((x) => x.id));
  if (data?.length) {
    const hit = slice.find((x) => x.id === data[0].item_id);
    sparkCandidate = { ...hit, code: data[0].spark_code };
  }
}
console.log('spark candidate: ' + (sparkCandidate ? `${sparkCandidate.name} · video ${sparkCandidate.id}` : 'none in this month'));

/* ── the screen ────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
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

  /* WAIT FOR A FIGURE, DO NOT ASSUME ONE: the readers answer after the table paints. */
  await page.waitForFunction(() => [...document.querySelectorAll('.pc-cell[data-label="Ad spend"]')]
    .some((c) => { const t = c.textContent.trim(); return t && t !== '-' && t !== '–'; }), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const cells = await page.evaluate(() => [...document.querySelectorAll('.pc-ct-row')].map((row) => ({
    name: (row.querySelector('.pc-cname') || {}).textContent?.trim() || '',
    spend: (row.querySelector('[data-label="Ad spend"]') || {}).textContent?.trim() || '',
    roi: (row.querySelector('[data-label="ROI"]') || {}).textContent?.trim() || '',
  })));
  check(cells.length === monthRows.length, 'the brand page lists the rows the database has for the month', `${cells.length} on screen, ${monthRows.length} in the database`);

  let compared = 0, wrong = [];
  for (const cell of cells) {
    const e = expect.get(cell.name);
    if (!e) continue;
    compared++;
    const dash = cell.spend === '-' || cell.spend === '–';
    if (e.withData === 0) {
      if (!dash) wrong.push(`${cell.name}: no Euka figures but the cell shows ${cell.spend}`);
      continue;
    }
    /* money() shows whole dollars from $1,000 up, cents below */
    const shown = num(cell.spend);
    const tolerance = e.cost >= 1000 ? 0.51 : 0.006;
    if (dash || Math.abs(shown - e.cost) > tolerance) wrong.push(`${cell.name}: spend shows ${cell.spend}, database ${e.cost.toFixed(2)}`);
    const roiShown = cell.roi === '-' || cell.roi === '–' ? null : num(cell.roi);
    if (e.roi === null ? roiShown !== null : roiShown === null || Math.abs(roiShown - e.roi) > 0.006) {
      wrong.push(`${cell.name}: ROI shows ${cell.roi}, database ${e.roi === null ? 'none' : e.roi.toFixed(2) + 'x'}`);
    }
  }
  check(compared > 0 && wrong.length === 0, `every creator's Ad spend and ROI match the database (${compared} rows compared, ${withSpend.length} with figures)`, wrong.slice(0, 4).join(' | '));

  if (sparkCandidate) {
    const row = page.locator('.pc-ct-row', { hasText: sparkCandidate.name }).first();
    await row.click();
    await page.waitForTimeout(6000);
    const shown = await page.evaluate((code) => [...document.querySelectorAll('.pc-vxp-code, .pc-vxm-code')]
      .map((b) => b.getAttribute('title') || '').filter((t) => t.includes(code)), sparkCandidate.code);
    check(shown.length > 0 && shown.some((t) => /from EUKA/.test(t)), 'a video with no code on its row shows Euka\'s spark code, and says so', shown[0] ? shown[0].replace(/\n/g, ' · ') : 'NOT SHOWN');
  } else {
    console.log('NOTE: no video in this month lacks a row code while Euka holds one, so the spark fallback was not exercised here');
  }

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
