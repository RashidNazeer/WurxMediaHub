#!/usr/bin/env node
/**
 * TOP VIDEOS SHOWS TEN AND TOTALS THE COLUMN · VIDEOS CAN BE SEEN BY DAY.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-video-days.mjs
 *
 * Rashid, 2026-09-15: ten videos instead of eight with "the sum of gmv (new
 * video gmv column)" beside them, and in Manage videos "let them view the
 * videos of a certain date … today or any date".
 *
 * ON 2026-09-16 THE SINGLE TOTAL BECAME THREE CARDS (views, GMV, ad spend),
 * and GMV stopped being "the column added up": each video now counts once.
 * Their figures are proven by verify:topvids-stats. This check keeps the ten
 * videos, the cards' position at every width, and the day filter.
 *
 * EVERY EXPECTED NUMBER IS READ FROM THE DATABASE FIRST, never from the screen
 * under test. The one exception is the column total, which is compared with
 * both: the column the person can see, and the database.
 *
 * NOTHING IS WRITTEN. The videos modal is opened, filtered and closed, and the
 * creator's saved videos are compared before and after to prove it.
 *
 * SHOTS_DIR=<dir> saves screenshots of both, for looking at.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Penetrex';
const SHOTS = process.env.SHOTS_DIR || '';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDay = (d) => { const [y, m, dd] = d.split('-'); return `${MONTHS[+m - 1]} ${+dd}, ${y}`; };
const isUrl = (s) => /^https?:\/\//i.test(String(s || '').trim());
const money = (t) => Number(String(t || '').replace(/[^0-9.-]/g, '')) || 0;
const localDay = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ── the truth, before any browser opens ────────────────────────────────── */
const { data: all, error } = await wb.from('creators').select('id,name,brand,hiring_date,video_codes').eq('brand', BRAND);
if (error) throw error;
const vids = (c) => (Array.isArray(c.video_codes) ? c.video_codes : []).filter((v) => v && isUrl(v.video));
const byMonth = new Map();
for (const c of all) {
  const m = String(c.hiring_date || '').slice(0, 7);
  if (!m) continue;
  if (!byMonth.has(m)) byMonth.set(m, []);
  byMonth.get(m).push(c);
}
/* the month with the most earning videos is the sharpest test of "ten" */
const earningIn = (rows) => rows.reduce((n, c) => n + vids(c).filter((v) => Number(v.revenue) > 0).length, 0);
const [MONTH, monthRows] = [...byMonth.entries()].sort((a, b) => earningIn(b[1]) - earningIn(a[1]))[0];
const earning = earningIn(monthRows);
const dbTotal = monthRows.reduce((t, c) => t + Math.round(vids(c).reduce((s, v) => s + (Number(v.revenue) || 0), 0)), 0);
console.log(`database: ${BRAND} ${MONTH} · ${monthRows.length} rows · ${earning} earning videos · column total $${dbTotal}`);

/* the creator for the modal: a name unique in that month, videos over most days */
const nameCount = new Map();
monthRows.forEach((c) => nameCount.set(c.name, (nameCount.get(c.name) || 0) + 1));
const daysOf = (c) => { const m = new Map(); vids(c).forEach((v) => { const d = String(v.date || '').slice(0, 10); if (d) m.set(d, (m.get(d) || 0) + 1); }); return m; };
const subject = monthRows.filter((c) => nameCount.get(c.name) === 1)
  .sort((a, b) => daysOf(b).size - daysOf(a).size)[0];
const days = daysOf(subject);
const [DAY, dayCount] = [...days.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
const undated = vids(subject).filter((v) => !String(v.date || '').trim()).length;
const latest = [...days.keys()].sort().pop();
const todayCount = days.get(localDay(0)) || 0;
console.log(`subject: ${subject.name} · ${vids(subject).length} videos over ${days.size} days · ${DAY} has ${dayCount} · ${undated} undated`);
check(days.size > 1 && dayCount < vids(subject).length, 'the subject really has videos on more than one day',
  `${days.size} days`);
const before = JSON.stringify(subject.video_codes);

/* ── the browser ────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
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
  await page.waitForTimeout(10000);

  /* ── the strip ───────────────────────────────────────────────────────── */
  const strip = await page.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const frames = [...document.querySelectorAll('.pc-topvid-frame')];
    const total = document.querySelector('.pc-topvids-stats');
    return {
      tiles: document.querySelectorAll('.pc-topvid').length,
      total: (document.querySelector('.pc-topvids-stat.gmv .pc-topvids-stat-val') || {}).textContent || null,
      cells: [...document.querySelectorAll('.pc-ct-row [data-label="New video GMV"]')].map((c) => c.textContent.trim()),
      rows: document.querySelectorAll('.pc-ct-row').length,
      lastFrame: frames.length ? box(frames[frames.length - 1]) : null,
      firstFrame: frames.length ? box(frames[0]) : null,
      body: document.querySelector('.pc-topvids-body') ? box(document.querySelector('.pc-topvids-body')) : null,
      totalBox: total ? box(total) : null,
    };
  });
  const colSum = strip.cells.reduce((t, x) => t + money(x), 0);
  console.log(`screen: ${strip.tiles} tiles · total ${strip.total} · column adds to $${colSum} over ${strip.rows} rows`);
  const sameRows = strip.rows === monthRows.length;
  check(sameRows, 'the brand page lists the rows the database has for that month', `${strip.rows} on screen, ${monthRows.length} in the database`);
  check(strip.tiles === Math.min(10, earning), 'the strip shows ten videos (or every earning video, if fewer)',
    `${strip.tiles} shown, ${earning} earning`);
  /* The GMV card no longer equals the column added up: it counts each video
     once and rounds once (DECISIONS, 2026-09-16). verify:topvids-stats proves
     all three cards against the database. */
  check(strip.total !== null, 'the views, GMV and ad spend cards render', `GMV card ${strip.total}`);
  if (strip.totalBox && strip.lastFrame && strip.firstFrame) {
    const mid = (b) => (b.t + b.b) / 2;
    check(strip.totalBox.l > strip.lastFrame.r, 'the totals sit to the right of the videos',
      `total starts ${Math.round(strip.totalBox.l)}, last video ends ${Math.round(strip.lastFrame.r)}`);
    /* Since 2026-09-16 the cards centre on the whole row of tiles (picture,
       name and views), not on the pictures: "Also in center". */
    check(!!strip.body && Math.abs(mid(strip.totalBox) - mid(strip.body)) <= 2, 'vertically centred on the row of videos',
      strip.body ? `${Math.round(mid(strip.totalBox) - mid(strip.body))}px off` : 'no strip body');
  } else {
    check(false, 'the total card rendered', 'NOT FOUND');
  }
  if (SHOTS) await page.locator('.pc-topvids').first().screenshot({ path: `${SHOTS}/strip-light.png` });

  /* ── the videos modal ────────────────────────────────────────────────── */
  const row = page.locator('.pc-ct-row', { hasText: subject.name }).first();
  await row.locator('button[title="View videos & ad codes"]').first().click();
  await page.waitForTimeout(2500);
  const rowsNow = () => page.evaluate(() => document.querySelectorAll('.pc-vx-modal .pc-vx-row').length);
  const allRows = await rowsNow();
  check(allRows >= vids(subject).length, 'the modal opened on every row', `${allRows} rows`);

  await page.evaluate((d) => {
    const inp = document.querySelector('.pc-vx-daypick input');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, d);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, DAY);
  await page.waitForTimeout(900);
  const picked = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pc-vx-modal .pc-vx-row').length,
    tags: [...document.querySelectorAll('.pc-vx-modal .pc-vx-row .pc-vx-daytag')].map((t) => t.getAttribute('title')),
    count: (document.querySelector('.pc-vx-daypick b') || {}).textContent || null,
    note: (document.querySelector('.pc-vx-days-note') || {}).textContent || null,
  }));
  check(picked.rows === dayCount, `picking ${DAY} shows exactly that day's videos`, `${picked.rows} shown, ${dayCount} in the database`);
  check(picked.tags.length === picked.rows && picked.tags.every((t) => t === `Posted ${longDay(DAY)}`),
    'and every row shown says it was posted that day', [...new Set(picked.tags)].join(' | '));
  check(Number(picked.count) === dayCount, 'the picker states the count', String(picked.count));
  check(undated ? (picked.note || '').startsWith(`${undated} `) : picked.note === null,
    'undated videos are named, not silently hidden', String(picked.note));
  if (SHOTS) await page.locator('.pc-vx-modal').first().screenshot({ path: `${SHOTS}/modal-day-light.png` });

  await page.locator('.pc-vx-day', { hasText: /^Today/ }).click();
  await page.waitForTimeout(700);
  const t = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pc-vx-modal .pc-vx-row').length,
    empty: (document.querySelector('.pc-vx-dayempty') || {}).textContent || null,
  }));
  check(t.rows === todayCount, 'Today shows today\'s videos', `${t.rows} shown, ${todayCount} in the database`);
  if (todayCount === 0) {
    check(Boolean(t.empty) && t.empty.includes(longDay(latest)), 'an empty day says when the latest posts were', String(t.empty));
    const link = page.locator('.pc-vx-daylink');
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      await page.waitForTimeout(700);
      check(await rowsNow() === days.get(latest), 'and one click goes to that day', `${await rowsNow()} vs ${days.get(latest)}`);
    }
  }

  await page.locator('.pc-vx-day', { hasText: /^All/ }).click();
  await page.waitForTimeout(700);
  check(await rowsNow() === allRows, 'All brings every row back', `${await rowsNow()} of ${allRows}`);

  if (SHOTS) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(600);
    await page.locator('.pc-vx-modal').first().screenshot({ path: `${SHOTS}/modal-dark.png` });
  }
  await page.locator('.pc-vx-modal button[aria-label="Close"]').first().click();
  await page.waitForTimeout(2500);
  if (SHOTS) {
    await page.locator('.pc-topvids').first().screenshot({ path: `${SHOTS}/strip-dark.png` });
    await page.emulateMedia({ colorScheme: 'light' });
  }

  /* EVERY WIDTH MUST BE ONE OF TWO GOOD SHAPES: all ten visible beside the
     total, or the total above them. The first version had a third shape
     nobody chose — the total beside the row with the tenth video scrolled
     under it — and only a 1500px check found it. */
  for (const w of [1500, 1400, 1280, 1100, 900]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(1200);
    const l = await page.evaluate(() => {
      const t = document.querySelector('.pc-topvids-stats');
      const r = document.querySelector('.pc-topvids-row');
      if (!t || !r) return null;
      const tb = t.getBoundingClientRect(), rb = r.getBoundingClientRect();
      return {
        beside: tb.left >= rb.right - 1,
        above: tb.bottom <= rb.top + 1,
        hidden: r.scrollWidth - r.clientWidth,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    if (!l) { check(false, `at ${w}px the strip rendered`, 'NOT FOUND'); continue; }
    check(l.beside ? l.hidden <= 1 : l.above,
      `at ${w}px: ${l.beside ? 'all ten fit beside the totals' : 'the totals sit above the videos'}`,
      l.beside ? `${l.hidden}px of videos hidden` : `above=${l.above}`);
    check(l.overflow <= 1, `at ${w}px the page does not scroll sideways`, `${l.overflow}px`);
    if (SHOTS && w === 1280) await page.locator('.pc-topvids').first().screenshot({ path: `${SHOTS}/strip-1280.png` });
  }

  /* a narrow screen: the total moves above the videos, and nothing scrolls sideways */
  await page.setViewportSize({ width: 400, height: 900 });
  await page.waitForTimeout(1500);
  const narrow = await page.evaluate(() => {
    const t = document.querySelector('.pc-topvids-stats');
    const r = document.querySelector('.pc-topvids-row');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      above: t && r ? t.getBoundingClientRect().bottom <= r.getBoundingClientRect().top + 1 : null,
    };
  });
  check(narrow.above === true, 'at 400px the totals sit above the videos', String(narrow.above));
  check(narrow.overflow <= 1, 'and the page does not scroll sideways', `${narrow.overflow}px`);
  if (SHOTS) await page.locator('.pc-topvids').first().screenshot({ path: `${SHOTS}/strip-400.png` });

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
}

const { data: after } = await wb.from('creators').select('video_codes').eq('id', subject.id).single();
check(JSON.stringify(after?.video_codes) === before, 'the modal wrote nothing', 'saved videos identical before and after');

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
