#!/usr/bin/env node
/**
 * NEW VIDEO GMV ON THE BRANDS SCREEN, AND RED AD SPEND ON A BRAND'S PAGE.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/brands/check-brands-gmv.mjs
 *
 * Rashid, 2026-09-21: "i want the ad spend column values to be in red color",
 * and "sum the new vide gmv of all the brands and add it in the first row of
 * brand's main page ... do not disturb UI and be careful on calculations".
 *
 * THE TOTAL IS CHECKED TWO WAYS, because either alone could agree with a bug:
 *   1. against the database, recomputed here brand by brand with the screen's
 *      own rule (each TikTok video once per brand, the larger synced figure
 *      kept), for one month and for All Time;
 *   2. against the screen itself: every brand in the month is opened and its
 *      GMV card read, and those cards must add up to the total.
 * GMV is live — the page's own sweep writes fresh figures while it is open —
 * so every database comparison is bracketed by reads before and after the
 * screen read, and a month with no GMV at all is a FAILURE, not a pass.
 *
 * Also: the red is the --wx-danger token on every ad spend figure and on no
 * dash, in both themes; the new card's figure is --wx-success; at twelve widths
 * nothing in the six cards is cut off, every row of cards is full, they never
 * run under the month controls, and the page never scrolls sideways.
 *
 * MONTH defaults to 2026-08, the month in Rashid's screenshot. SHOTS_DIR saves
 * screenshots.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const MONTH = process.env.MONTH || '2026-08';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const wb = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const idOf = (u) => (String(u || '').match(/\/video\/(\d+)/) || [])[1] || null;
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

/* ── the truth ─────────────────────────────────────────────────────────── */
/* Every row, PAGED: an unpaged select stops at 1000 without a word, and this
   table is past that. */
async function allRows() {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await wb.from('creators').select('id,brand,hiring_date,video_codes').order('id').range(from, from + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  return rows;
}

/* The screen's rule, written out again rather than imported: a check that
   borrowed the screen's function would agree with any bug in it. */
async function truthNow(period) {
  const rows = (await allRows()).filter((r) => period === 'all' || String(r.hiring_date || '').slice(0, 7) === period);
  const byBrand = new Map();
  for (const r of rows) {
    const b = String(r.brand || '').trim();
    if (!b) continue;
    if (!byBrand.has(b)) byBrand.set(b, new Map());
    const vids = byBrand.get(b);
    const seen = new Set();
    for (const v of Array.isArray(r.video_codes) ? r.video_codes : []) {
      const url = v && String(v.video || '').trim();
      if (!url) continue;
      const k = idOf(url) || url;
      if (seen.has(k)) continue;
      seen.add(k);
      vids.set(k, Math.max(vids.get(k) || 0, Number(v.revenue) || 0));
    }
  }
  const brands = new Map();
  let total = 0, videos = 0;
  for (const [b, vids] of byBrand) {
    const g = [...vids.values()].reduce((s, x) => s + x, 0);
    brands.set(b, g);
    total += g;
    videos += vids.size;
  }
  return { total, videos, brands };
}

/* ── reading the screen ────────────────────────────────────────────────── */
const readCard = (page) => page.evaluate(() => {
  const el = document.querySelector('.wx-kpi-gmv');
  if (!el) return null;
  const v = el.querySelector('.pc-kpi-value');
  const dot = el.querySelector('.pc-kpi-dot');
  return {
    value: Number(el.dataset.value),
    text: (v?.textContent || '').trim(),
    title: el.getAttribute('title') || '',
    label: (el.querySelector('.pc-kpi-label')?.textContent || '').trim(),
    color: v ? getComputedStyle(v).color : '',
    dot: dot ? getComputedStyle(dot).backgroundColor : '',
  };
});

const tokenRgb = (page, name) => page.evaluate((n) => {
  const d = document.createElement('span');
  d.style.color = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  document.body.appendChild(d);
  const c = getComputedStyle(d).color;
  d.remove();
  return c;
}, name);

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('wurxmediahub-theme', t);
    window.dispatchEvent(new StorageEvent('storage', { key: 'wurxmediahub-theme' }));
  }, theme);
  const ok = await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 8000 }).then(() => true, () => false);
  if (!ok) throw new Error(`could not switch the screen to ${theme}`);
  await page.waitForTimeout(500);
}

/* A brand's row by its EXACT name, so 'Nutra' cannot open 'NutraHarmony Store'. */
const exactly = (s) => new RegExp('^\\s*' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$');
const brandRow = (page, b) => page.locator('.pc-bt-row').filter({
  has: page.locator('.pc-brandname', { hasText: exactly(b) }),
}).first();

/* The bracket: the screen must sit inside the span of every database read of
   this period, GMV only ever growing. */
function within(v, reads, pick, slack = 0.005) {
  const vals = reads.map(pick);
  return v >= Math.min(...vals) - slack && v <= Math.max(...vals) + slack;
}
const spanText = (reads, pick) => {
  const vals = reads.map(pick);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return lo === hi ? `$${lo.toFixed(2)}` : `live: $${lo.toFixed(2)} to $${hi.toFixed(2)} while checking`;
};

async function compareTotal(page, period, label) {
  const floor = firstTruth[period];
  const before = await truthNow(period);
  const got = await readCard(page);
  const after = await truthNow(period);
  const reads = [floor, before, after];
  check(!!got, `${label}: the New Video GMV card is on the Brands screen`);
  if (!got) return null;
  check(after.total > 0, `${label}: the database holds new video GMV for this period, so this check can fail`, usd(after.total));
  check(within(got.value, reads, (t) => t.total), `${label}: the card equals every brand's new video GMV added up (${spanText(reads, (t) => t.total)})`, `screen ${got.value} "${got.text}" · ${after.videos} videos in ${after.brands.size} brands`);
  check(got.text === usd(got.value), `${label}: the card shows its figure rounded once to the dollar`, `"${got.text}" for ${got.value}`);
  return got;
}

const cardsLayout = (page) => page.evaluate(() => {
  const r = (e) => e.getBoundingClientRect();
  const grid = document.querySelector('.wx-kpis-6');
  if (!grid) return { missing: true };
  const cards = [...grid.querySelectorAll(':scope > .pc-kpi')];
  /* Cards within 4px of each other's top are one row: a card under the
     pointer lifts 2-3px on hover, which is not a second row. */
  const rows = new Map();
  cards.forEach((c) => {
    const top = r(c).top;
    const key = [...rows.keys()].find((k) => Math.abs(k - top) <= 4) ?? top;
    rows.set(key, [...(rows.get(key) || []), Math.round(r(c).height)]);
  });
  const perRow = [...rows.values()].map((h) => h.length);
  const unevenHeights = [...rows.values()].filter((h) => Math.max(...h) - Math.min(...h) > 1).length;
  const clipped = [...grid.querySelectorAll('.pc-kpi-label, .pc-kpi-value')]
    .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent.trim());
  const fb = document.querySelector('.pc-filterbar');
  const under = fb ? cards.filter((c) => { const a = r(c), b = r(fb); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }).length : 0;
  const gmv = grid.querySelector('.wx-kpi-gmv');
  return {
    cards: cards.length, perRow, unevenHeights, clipped, under,
    gmvVisible: !!gmv && r(gmv).width > 40 && r(gmv).height > 30,
    cardWidth: Math.round(r(cards[0]).width),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

async function shot(page, file, h = 300) {
  if (!SHOTS) return;
  const w = page.viewportSize().width;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${file}`, clip: { x: 0, y: 0, width: w, height: h } });
}

/* ── the screen ────────────────────────────────────────────────────────── */
const firstTruth = { [MONTH]: await truthNow(MONTH), all: await truthNow('all') };
console.log(`database, ${MONTH}: ${usd(firstTruth[MONTH].total)} across ${firstTruth[MONTH].brands.size} brands · All Time: ${usd(firstTruth.all.total)}`);

const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1712, height: 1000 }, deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
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
  await page.waitForSelector('.pc-back, .wx-kpi-gmv', { timeout: 60000 }).catch(() => {});
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) await back.first().click();
  await page.waitForSelector('.wx-kpi-gmv', { timeout: 30000 });
  const showingAll = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /all time/i.test(x.textContent || ''));
    return /click to filter by month/i.test((b && b.getAttribute('title')) || '');
  });
  if (showingAll) await page.locator('button', { hasText: /all time/i }).first().click();
  await page.evaluate((m) => {
    const inp = document.querySelector('input.pc-chrome-input');
    if (!inp) return;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, m);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, MONTH);
  const monthText = new Date(`${MONTH}-15T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  /* Wait for the card to be ABOUT this month, and for the table to have rows:
     a card read before the data lands says $0 and would "match" nothing. */
  await page.waitForFunction((t) => (document.querySelector('.wx-kpi-gmv')?.getAttribute('title') || '').includes(t)
    && document.querySelectorAll('.pc-bt-row').length > 0, monthText, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const monthCard = await compareTotal(page, MONTH, MONTH);
  if (monthCard) {
    check(/new video gmv/i.test(monthCard.label), 'the card is labelled New Video GMV', monthCard.label);
    check(monthCard.title.includes(monthText), 'its hover text names the month it covers', monthCard.title);
  }
  const cardCount = await page.evaluate(() => document.querySelectorAll('.wx-kpis-6 > .pc-kpi').length);
  check(cardCount === 6, 'the first row holds the five cards it had, plus this one', `${cardCount} cards`);

  /* ── every brand's own GMV card, added up ──────────────────────────── */
  const brands = [...firstTruth[MONTH].brands.keys()].sort();
  const cards = [];
  let redFigures = 0, redWrong = 0, redDashes = 0, brandWithSpend = null;
  const danger = await tokenRgb(page, '--wx-danger');
  for (const b of brands) {
    const row = brandRow(page, b);
    if (!(await row.isVisible().catch(() => false))) { check(false, `${MONTH}: ${b} is listed on the Brands screen`); continue; }
    await row.click();
    await page.waitForSelector('.pc-back', { timeout: 20000 });
    /* Ad spend lands after the page paints; wait for Euka's answer. */
    await page.waitForFunction(() => {
      const el = document.querySelector('.pc-topvids-stat.spend');
      return !el || (el.dataset.state && el.dataset.state !== 'pending');
    }, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    const got = await page.evaluate((red) => {
      const g = document.querySelector('.pc-topvids-stat.gmv');
      const spend = [...document.querySelectorAll('[data-label="Ad spend"]')];
      const figs = spend.map((c) => c.querySelector('.wx-metric-spend')).filter(Boolean);
      const dashes = spend.map((c) => c.querySelector('.pc-handle')).filter(Boolean);
      const everywhere = document.querySelectorAll('.wx-metric-spend').length;
      return {
        gmv: g ? Number(g.dataset.value) : 0,
        figures: figs.length,
        wrong: figs.filter((f) => getComputedStyle(f).color !== red).length,
        redDashes: dashes.filter((d) => getComputedStyle(d).color === red).length,
        outside: everywhere - figs.length,
      };
    }, danger);
    cards.push({ brand: b, gmv: got.gmv });
    redFigures += got.figures;
    redWrong += got.wrong + got.outside;
    redDashes += got.redDashes;
    if (got.figures > 0 && !brandWithSpend) brandWithSpend = b;
    await page.locator('.pc-back').first().click();
    await page.waitForSelector('.wx-kpi-gmv', { timeout: 20000 });
  }
  const after = await truthNow(MONTH);
  const endCard = await readCard(page);
  const reads = [firstTruth[MONTH], after];
  const perBrandWrong = cards.filter((c) => {
    const vals = reads.map((t) => Math.round(t.brands.get(c.brand) || 0));
    return c.gmv < Math.min(...vals) || c.gmv > Math.max(...vals);
  });
  check(cards.length === brands.length && perBrandWrong.length === 0,
    `${MONTH}: every brand's own GMV card matches the database (${cards.length} of ${brands.length} brands opened)`,
    perBrandWrong.slice(0, 4).map((c) => `${c.brand}: card ${c.gmv}, database ${reads.map((t) => Math.round(t.brands.get(c.brand) || 0)).join(' then ')}`).join(' | ') || cards.map((c) => `${c.brand} ${usd(c.gmv)}`).join(', '));
  const sumCards = cards.reduce((s, c) => s + c.gmv, 0);
  /* Each brand card is rounded to the dollar and the total is rounded once, so
     they may differ by under half a dollar a brand, and never more. */
  const slack = 0.5 * cards.length;
  const totals = [monthCard?.value, endCard?.value].filter((v) => Number.isFinite(v));
  check(cards.length > 0 && totals.some((t) => Math.abs(t - sumCards) <= slack),
    `${MONTH}: the brands' GMV cards add up to the New Video GMV card (within rounding, $${slack.toFixed(2)})`,
    `cards add to ${usd(sumCards)} · total card ${totals.map((t) => `$${t.toFixed(2)}`).join(' then ')}`);

  check(redFigures > 0, `${MONTH}: at least one brand has ad spend figures, so the red is really tested`, `${redFigures} figures`);
  check(redWrong === 0, 'every ad spend figure is the --wx-danger red, and nothing outside the Ad spend column is', `${redWrong} wrong of ${redFigures}`);
  check(redDashes === 0, 'a dash in the Ad spend column stays grey, never red', `${redDashes} red dashes`);

  /* ── both themes ─────────────────────────────────────────────────────── */
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    const got = await readCard(page);
    const success = await tokenRgb(page, '--wx-success');
    check(got && got.color === success && got.dot === success, `${theme}: the New Video GMV figure and its dot are the --wx-success green`, `${got?.color} / ${got?.dot} vs ${success}`);
    await shot(page, `brands-kpis-1712-${theme}.png`);
    if (brandWithSpend) {
      await brandRow(page, brandWithSpend).click();
      await page.waitForSelector('.pc-back', { timeout: 20000 });
      await page.waitForFunction(() => document.querySelectorAll('.wx-metric-spend').length > 0, null, { timeout: 60000 }).catch(() => {});
      const red = await tokenRgb(page, '--wx-danger');
      const res = await page.evaluate((r) => {
        const f = [...document.querySelectorAll('.wx-metric-spend')];
        return { n: f.length, wrong: f.filter((x) => getComputedStyle(x).color !== r).length };
      }, red);
      check(res.n > 0 && res.wrong === 0, `${theme}: ${brandWithSpend}'s ad spend figures are the --wx-danger red`, `${res.wrong} of ${res.n} wrong · token ${red}`);
      if (SHOTS) {
        await page.evaluate(() => document.querySelector('.wx-metric-spend')?.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${SHOTS}/brand-adspend-${theme}.png` });
      }
      await page.locator('.pc-back').first().click();
      await page.waitForSelector('.wx-kpi-gmv', { timeout: 20000 });
    }
  }

  /* ── every width ─────────────────────────────────────────────────────── */
  for (const w of [1920, 1712, 1600, 1440, 1366, 1280, 1152, 1024, 900, 768, 640, 390]) {
    await page.setViewportSize({ width: w, height: 1000 });
    /* The pointer off every card, so none is mid hover-lift when measured. */
    await page.mouse.move(w - 2, 998);
    await page.waitForTimeout(700);
    const l = await cardsLayout(page);
    if (l.missing) { check(false, `${w}px: the cards are on screen`); continue; }
    const fullRows = l.perRow.every((n) => n === l.perRow[0]);
    check(l.cards === 6 && fullRows && l.unevenHeights === 0 && l.clipped.length === 0 && l.under === 0 && l.gmvVisible && l.sideways <= 1,
      `${w}px: ${l.perRow.length === 1 ? 'six cards in one row' : `${l.perRow.length} rows of ${l.perRow[0]}`}, nothing cut off, clear of the month controls, no sideways scroll`,
      `card ${l.cardWidth}px · rows ${l.perRow.join('/')} · uneven ${l.unevenHeights} · cut off ${l.clipped.join(', ') || 'none'} · under month controls ${l.under} · sideways ${l.sideways}px`);
    if ([1440, 1024, 390].includes(w)) await shot(page, `brands-kpis-${w}-light.png`, w === 390 ? 700 : 320);
  }
  await page.setViewportSize({ width: 1712, height: 1000 });
  await setTheme(page, 'dark');

  /* ── All Time ────────────────────────────────────────────────────────── */
  await page.locator('button', { hasText: /all time/i }).first().click();
  await page.waitForFunction(() => /all time/i.test(document.querySelector('.wx-kpi-gmv')?.getAttribute('title') || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const allCard = await compareTotal(page, 'all', 'All Time');
  if (allCard && monthCard) check(allCard.value > monthCard.value, 'All Time is more than one month', `${usd(allCard.value)} vs ${usd(monthCard.value)}`);
  await page.locator('button', { hasText: /all time/i }).first().click();

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
