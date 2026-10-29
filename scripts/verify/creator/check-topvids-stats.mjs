#!/usr/bin/env node
/**
 * THE THREE TOTALS BESIDE TOP VIDEOS, ON THE ACTUAL SCREEN, AGAINST THE DATABASE.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-topvids-stats.mjs
 *
 * Rashid, 2026-09-16, for his boss: beside the ten top videos, three stacked
 * cards with the sum of views (blue), GMV (green) and ad spend (red), for the
 * chosen month, or for all time under All Time.
 *
 * For one brand, in a month AND under All Time, every figure is recomputed
 * here from `wurxbase.creators` and `euka_ad_video_month` with the same rule
 * the screen uses: each TikTok video counted once, however many deals list it.
 * The expected numbers come from the database first, and a brand with no ad
 * money in the month is a FAILURE ("proves nothing"), never a pass.
 *
 * THE VIDEO FIGURES ARE LIVE. The page's own Euka sweep writes fresh views into
 * these rows while it is open: one run saw All Time views move by 73 between
 * the database read and the screen read. So every comparison reads the
 * database right before AND right after reading the screen, and views and GMV
 * must fall inside the span of those reads (ad spend must match exactly).
 *
 * Also: each card wears its own token (info, success, danger) in both themes;
 * beside the videos the cards sit on the strip's far right, centred top to
 * bottom on the row ("extreme right ... Also in center"); and at every width
 * they never cover a thumbnail, nothing in a card is cut off, and the page
 * never scrolls sideways.
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
const ALL = 'All Time';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const idOf = (u) => (String(u || '').match(/\/video\/(\d+)/) || [])[1] || null;

/* ── the truth ─────────────────────────────────────────────────────────── */
/* EVERY ROW, PAGED. The first run of this check read one unpaged select, got
   Supabase's first 1000 of 1328 rows, and "failed" the screen for showing 34
   Penetrex rows when the truth held 27. A truth that is quietly short is the
   worst kind of check. */
async function brandRowsNow() {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await wb.from('creators').select('id,name,brand,hiring_date,video_codes').order('id').range(from, from + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  return rows.filter((r) => String(r.brand || '').trim() === BRAND);
}

async function truthNow(period) {
  const brandRows = await brandRowsNow();
  const scope = period === ALL ? brandRows : brandRows.filter((r) => String(r.hiring_date || '').slice(0, 7) === MONTH);
  const vids = new Map();
  let dupes = 0, columnViews = 0;
  for (const r of scope) {
    const seen = new Set();
    for (const v of Array.isArray(r.video_codes) ? r.video_codes : []) {
      const url = v && String(v.video || '').trim();
      if (!url) continue;
      columnViews += Number(v.views) || 0;
      const k = idOf(url) || url;
      if (seen.has(k)) continue;
      seen.add(k);
      const cur = vids.get(k);
      if (cur) dupes++;
      vids.set(k, { id: idOf(url), views: Math.max(cur?.views || 0, Number(v.views) || 0), gmv: Math.max(cur?.gmv || 0, Number(v.revenue) || 0) });
    }
  }
  const all = [...vids.values()];
  const ids = all.map((v) => v.id).filter(Boolean);
  let cost = 0;
  const withData = new Set(), currencies = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    let q = svc.from('euka_ad_video_month').select('item_id,cost,currency').in('item_id', ids.slice(i, i + 300));
    if (period !== ALL) q = q.eq('month', `${MONTH}-01`);
    const { data, error } = await q;
    if (error) throw error;
    for (const f of data) { cost += Number(f.cost); withData.add(f.item_id); if (f.currency) currencies.add(f.currency); }
  }
  return {
    rows: scope.length, videos: all.length, dupes,
    views: all.reduce((s, v) => s + v.views, 0),
    gmv: Math.round(all.reduce((s, v) => s + v.gmv, 0)),
    cost, withData: withData.size, currencies: [...currencies],
    columnViews,
  };
}
const say = (period, t) => console.log(`database, ${BRAND} ${period}: ${t.rows} rows · ${t.videos} videos (${t.dupes} listed twice) · views ${t.views} (column sum ${t.columnViews}) · GMV $${t.gmv} · ad spend ${t.cost.toFixed(2)} ${t.currencies.join('/')} on ${t.withData} videos`);

const first = { month: await truthNow(MONTH), all: await truthNow(ALL) };
say(MONTH, first.month);
say(ALL, first.all);
check(first.month.cost > 0 && first.all.cost > first.month.cost, `the database holds ${BRAND} ad money for ${MONTH}, and more across all time`, `${first.month.cost.toFixed(2)} vs ${first.all.cost.toFixed(2)}`);
check(first.all.dupes > 0, 'the brand has videos listed under two deals, so the count-once rule is really exercised', `${first.all.dupes} under All Time`);

/* ── reading the screen ────────────────────────────────────────────────── */
const readStats = (page) => page.evaluate(() => {
  const get = (cls) => {
    const el = document.querySelector(`.pc-topvids-stat.${cls}`);
    if (!el) return null;
    const val = el.querySelector('.pc-topvids-stat-val');
    return { value: el.dataset.value || '', state: el.dataset.state || '', text: val?.textContent.trim() || '', title: el.getAttribute('title') || '', color: val ? getComputedStyle(val).color : '' };
  };
  const box = document.querySelector('.pc-topvids-stats');
  return { label: box?.getAttribute('aria-label') || '', views: get('views'), gmv: get('gmv'), spend: get('spend') };
});

/*
 * The screen, bracketed by database reads.
 *
 * VIEWS AND GMV ONLY GROW, and under All Time the page's sweep keeps writing
 * them while the check runs: one read saw views go 7,928,322, then 7,930,787
 * on screen, then 7,933,730. So the screen must sit between the EARLIEST read
 * of this period (taken at the start, before the page was even open) and the
 * read taken just after it. A number outside that span is wrong; the span is
 * printed so a wide one cannot hide. Ad spend does not move, and must match
 * exactly.
 */
async function compareNow(page, period, label, periodText) {
  const floor = first[period === ALL ? 'all' : 'month'];
  const before = await truthNow(period);
  const got = await readStats(page);
  const after = await truthNow(period);
  const ts = [floor, before, after];
  const t = after;
  const any = (f) => ts.some(f);
  const lo = (k) => Math.min(...ts.map((x) => x[k]));
  const hi = (k) => Math.max(...ts.map((x) => x[k]));
  const within = (v, k) => v >= lo(k) && v <= hi(k);
  const span = (k, pre = '') => (lo(k) === hi(k)
    ? `${pre}${lo(k).toLocaleString()}`
    : `live: ${pre}${lo(k).toLocaleString()} to ${pre}${hi(k).toLocaleString()} while checking`);
  check(!!got.views && !!got.gmv && !!got.spend, `${label}: all three cards are on screen`);
  if (!got.views || !got.gmv || !got.spend) return;
  check(got.label.toLowerCase().includes(periodText.toLowerCase()), `${label}: the cards say which period they cover`, got.label);
  check(within(Number(got.views.value), 'views'), `${label}: views match the database (${span('views')}), each video once`, `screen ${got.views.value} "${got.views.text}" · the columns would say ${t.columnViews.toLocaleString()}`);
  check(within(Number(got.gmv.value), 'gmv'), `${label}: GMV matches the database (${span('gmv', '$')})`, `screen ${got.gmv.value} "${got.gmv.text}"`);
  if (t.currencies.length > 1) check(got.spend.state === 'mixed', `${label}: two currencies are not added together`, got.spend.text);
  else check(got.spend.state === 'ok' && any((x) => Math.abs(Number(got.spend.value) - x.cost) < 0.01), `${label}: ad spend = ${t.cost.toFixed(2)} on ${t.withData} videos`, `screen ${got.spend.state} ${got.spend.value} "${got.spend.text}"`);
  if (t.dupes) check(new RegExp(`${t.dupes} videos? listed under two deals, counted once`).test(got.views.title), `${label}: the hover text says ${t.dupes} duplicates were counted once`, got.views.title);
}

const tokenRgb = (page, name) => page.evaluate((n) => {
  const d = document.createElement('span');
  d.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  document.body.appendChild(d);
  const c = getComputedStyle(d).color;
  d.remove();
  return c;
}, name);

/* Through the app's own theme provider: it listens for the storage event. */
async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('wurxmediahub-theme', t);
    window.dispatchEvent(new StorageEvent('storage', { key: 'wurxmediahub-theme' }));
  }, theme);
  const ok = await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 8000 }).then(() => true, () => false);
  if (!ok) throw new Error(`could not switch the screen to ${theme}`);
  await page.waitForTimeout(500);
}

const layout = (page) => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const stats = document.querySelector('.pc-topvids-stats');
  const thumbs = [...document.querySelectorAll('.pc-topvids-row .pc-topvid')];
  if (!stats || !thumbs.length) return { missing: true };
  const s = r(stats);
  const beside = s.left > r(thumbs[0]).right;
  const overlap = thumbs.filter((t) => { const b = r(t); return b.left < s.right && b.right > s.left && b.top < s.bottom && b.bottom > s.top; }).length;
  const hiddenThumbs = beside ? thumbs.filter((t) => r(t).right > s.left + 1).length : 0;
  const clipped = [...document.querySelectorAll('.pc-topvids-stat, .pc-topvids-stat-val, .pc-topvids-stat-lbl')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).length;
  const cards = [...document.querySelectorAll('.pc-topvids-stat')].map((c) => Math.round(r(c).height));
  /* Beside the videos, the cards sit on the strip's far right edge (Rashid,
     2026-09-16: "extreme right"). */
  const body = document.querySelector('.pc-topvids-body');
  const rightGap = body ? Math.round(r(body).right - s.right) : 999;
  /* ...and centred top to bottom on the row of tiles ("Also in center"). */
  const mid = (b) => (b.top + b.bottom) / 2;
  const offCentre = body ? Math.round(mid(s) - mid(r(body))) : 999;
  return { beside, overlap, hiddenThumbs, clipped, cards, rightGap, offCentre, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});

async function shot(page, file) {
  if (!SHOTS) return;
  const box = await page.evaluate(() => {
    const el = document.querySelector('.pc-topvids');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    return { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, window.innerWidth - Math.max(0, b.x)), height: b.height };
  });
  if (box) await page.screenshot({ path: `${SHOTS}/${file}`, clip: box });
}

/* ── the screen ────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })).newPage();
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

  /* WAIT FOR EUKA'S ANSWER, DO NOT ASSUME IT: the ad spend lands after the page paints. */
  const settled = () => page.waitForFunction(() => {
    const el = document.querySelector('.pc-topvids-stat.spend');
    return el && el.dataset.state && el.dataset.state !== 'pending';
  }, null, { timeout: 60000 }).catch(() => {});
  await settled();
  await page.waitForTimeout(1500);

  const monthText = new Date(`${MONTH}-15T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  await compareNow(page, MONTH, `${BRAND} ${MONTH}`, monthText);

  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    const got = await readStats(page);
    const inks = { views: await tokenRgb(page, '--wx-info'), gmv: await tokenRgb(page, '--wx-success'), spend: await tokenRgb(page, '--wx-danger') };
    const wrong = ['views', 'gmv', 'spend'].filter((k) => got[k] && got[k].state !== 'none' && got[k].color !== inks[k]);
    check(wrong.length === 0, `${theme}: views blue, GMV green, ad spend red, each its own token`, wrong.map((k) => `${k} ${got[k].color} vs ${inks[k]}`).join(' | '));
    await shot(page, `strip-1600-${theme}.png`);
  }

  for (const w of [1920, 1600, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.waitForTimeout(900);
    const l = await layout(page);
    if (l.missing) { check(false, `${w}px: the strip is on screen`); continue; }
    const small = l.cards.filter((h) => h < 24).length;
    const placed = !l.beside || (Math.abs(l.rightGap) <= 2 && Math.abs(l.offCentre) <= 2);
    check(l.overlap === 0 && l.hiddenThumbs === 0 && l.clipped === 0 && l.sideways <= 1 && small === 0 && placed,
      `${w}px: cards ${l.beside ? 'on the far right, centred top to bottom,' : 'above the videos,'} covering none, nothing cut off, no sideways scroll`,
      `right gap ${l.rightGap}px · off centre ${l.offCentre}px · overlap ${l.overlap} · thumbs under cards ${l.hiddenThumbs} · clipped ${l.clipped} · sideways ${l.sideways}px · card heights ${l.cards.join('/')}`);
    if ([1280, 768, 390].includes(w)) await shot(page, `strip-${w}-light.png`);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setTheme(page, 'dark');

  /* All Time: same cards, the whole history */
  await page.locator('button', { hasText: /all time/i }).first().click();
  await page.waitForFunction(() => /all time/i.test(document.querySelector('.pc-topvids-stats')?.getAttribute('aria-label') || ''), null, { timeout: 30000 }).catch(() => {});
  await settled();
  await page.waitForTimeout(1500);
  await compareNow(page, ALL, `${BRAND} All Time`, 'all time');
  await shot(page, 'strip-alltime-dark.png');

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
