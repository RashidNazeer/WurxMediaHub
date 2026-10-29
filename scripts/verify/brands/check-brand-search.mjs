#!/usr/bin/env node
/**
 * SEARCH AND FILTER ON A BRAND'S OWN CREATOR LIST, AGAINST THE DATABASE.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/brands/check-brand-search.mjs
 *
 * Rashid, 2026-09-23: "we need to let users search the creators there should be
 * search and filter functionality without disturbing ui".
 *
 * EVERY EXPECTED SET IS COMPUTED FROM `wurxbase.creators`, not read off the
 * screen: for a brand and month, who matches a typed word, who is on each
 * payment status, who still owes videos, and who each person was hired by. A
 * filter that quietly showed everybody, or showed one row and called it a
 * match, passes a "the box exists" test and fails this one.
 *
 * IT ALSO PROVES THE PART THAT IS EASY TO GET WRONG: the five cards and the
 * top-videos totals describe the brand's month and must NOT move when the list
 * is narrowed. They are read before and after filtering and compared.
 *
 * A brand-month with only one payment status, or nobody outstanding, is a
 * FAILURE ("proves nothing"), never a quiet pass.
 *
 * BRAND and MONTH default to Penetrex, 2026-08 — Rashid's screenshot.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Penetrex';
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

/* ── the truth, with the screen's own rules written out again ──────────── */
/*
 * Their three rules, written out again rather than imported — a check that
 * borrows the screen's function agrees with any bug in it. Transcribed from
 * WurxUI.jsx on 2026-09-23 and they are NOT what you would guess:
 *
 * `statusOf` reads "Done" videos as PAYMENT PENDING, not as finished: the
 * videos are in, the money is not. Anything else is "Videos in Progress".
 * A first draft of this check assumed the payment_status word decided, which
 * would have made the status filter look broken when it was right.
 */
const statusOf = (c) => {
  if (c?.payment_status === 'Paid') return 'sent';
  if (c?.videos === 'Done') return 'pending';
  return 'progress';
};
/** Their `parseDealVideos`: three shapes of free text, in this order. */
const dealVideos = (deal) => {
  if (!deal) return 0;
  const s = String(deal);
  const m1 = s.match(/(\d+)\s*(?:videos?|vids?|clips?|posts?)\b/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = s.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:[/\-x×*]|for)\s*(\d+)\b/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = s.match(/\b(\d+)\s*[vV]\b/);
  if (m3) return parseInt(m3[1], 10);
  return 0;
};
/** Their `deliveredVideoCount`: DISTINCT videos, by TikTok id where there is one. */
const delivered = (c) => {
  if (!Array.isArray(c?.video_codes)) return 0;
  const seen = new Set();
  for (const v of c.video_codes) {
    const u = String(v?.video || '').trim();
    if (!u) continue;
    const m = u.match(/video\/(\d+)/);
    seen.add(m ? m[1] : u.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, ''));
  }
  return seen.size;
};
const deliveryOf = (c) => {
  const want = dealVideos(c.deal), got = delivered(c);
  return c.videos === 'Done' || (want > 0 && got >= want) ? 'complete' : 'outstanding';
};
const haystack = (c) => [c.name, c.tiktok_account, c.tiktok_account_2, c.category, c.product, c.deal, c.hired_by]
  .map((v) => String(v || '')).join(' ').toLowerCase();

async function rowsNow() {
  const rows = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await wb.from('creators')
      .select('id,name,brand,hiring_date,payment_status,deal,videos,video_codes,tiktok_account,tiktok_account_2,category,product,hired_by')
      .order('id').range(from, from + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) break;
  }
  return rows.filter((r) => String(r.brand || '').trim() === BRAND && String(r.hiring_date || '').slice(0, 7) === MONTH);
}

const all = await rowsNow();
const nameOf = (c) => String(c.name || '').trim();
const statusCounts = new Map(), deliveryCounts = new Map(), hiredCounts = new Map();
for (const c of all) {
  statusCounts.set(statusOf(c), (statusCounts.get(statusOf(c)) || 0) + 1);
  deliveryCounts.set(deliveryOf(c), (deliveryCounts.get(deliveryOf(c)) || 0) + 1);
  const h = String(c.hired_by || '').trim();
  if (h) hiredCounts.set(h, (hiredCounts.get(h) || 0) + 1);
}
console.log(`database, ${BRAND} ${MONTH}: ${all.length} creators · statuses ${[...statusCounts].map(([k, n]) => `${k} ${n}`).join(', ')} · delivery ${[...deliveryCounts].map(([k, n]) => `${k} ${n}`).join(', ')} · hired by ${[...hiredCounts].map(([k, n]) => `${k} ${n}`).join(', ') || 'nobody recorded'}`);

check(all.length >= 5, `${BRAND} ${MONTH} has enough creators to search`, `${all.length}`);
check(statusCounts.size >= 2, 'the month holds more than one payment status, so the status filter is really exercised', [...statusCounts.keys()].join(', '));
check((deliveryCounts.get('outstanding') || 0) > 0 && (deliveryCounts.get('complete') || 0) > 0,
  'the month holds both delivered and still-owed creators', [...deliveryCounts].map(([k, n]) => `${k} ${n}`).join(', '));

/* A word that really narrows: the commonest first name in the month, which
   must match more than one row and fewer than all of them. */
const firstNames = new Map();
for (const c of all) {
  const f = nameOf(c).split(/\s+/)[0]?.toLowerCase();
  if (f && f.length > 2) firstNames.set(f, (firstNames.get(f) || 0) + 1);
}
const TERM = [...firstNames.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w)
  .find((w) => { const n = all.filter((c) => haystack(c).includes(w)).length; return n > 1 && n < all.length; })
  ?? [...firstNames.keys()][0];
const expectSearch = all.filter((c) => haystack(c).includes(TERM));
check(!!TERM && expectSearch.length > 0 && expectSearch.length < all.length,
  `a search word that really narrows the list was found: "${TERM}"`, `${expectSearch.length} of ${all.length} rows`);

/* ── the screen ────────────────────────────────────────────────────────── */
const readTable = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.pc-ct-row')];
  /* `.pc-cname` is the name itself. The cell around it also holds the handle,
     the follower count and the tier badge, so reading the cell gives a string
     that starts with the name and then keeps going. */
  const names = rows.map((r) => (r.querySelector('[data-label="Creator"] .pc-cname')?.textContent || '').trim());
  const dividers = [...document.querySelectorAll('.pc-ct-divider')].map((d) => ({
    label: (d.querySelector('.pc-ct-divider-label')?.innerText || '').split('\n')[0].trim(),
    count: Number((d.querySelector('.pc-ct-divider-count')?.textContent || '0').trim()),
  }));
  const numbers = rows.map((r) => (r.querySelector('.pc-num')?.textContent || '').trim());
  const kpis = [...document.querySelectorAll('.pc-kpis-5 .pc-kpi')].map((k) => (k.innerText || '').replace(/\s+/g, ' ').trim());
  const gmv = document.querySelector('.pc-topvids-stat.gmv')?.dataset.value ?? '';
  const views = document.querySelector('.pc-topvids-stat.views')?.dataset.value ?? '';
  const toolbar = document.querySelector('.pc-toolbar');
  const chip = toolbar ? [...toolbar.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /creators?/.test(t)) ?? '' : '';
  const empty = (document.querySelector('.pc-empty h3')?.textContent || '').trim();
  return { count: rows.length, names, dividers, numbers, kpis, gmv, views, chip, empty };
});

const setSearch = async (page, text) => {
  const box = page.locator('.pc-toolbar input').first();
  await box.click();
  await box.fill(text);
  await page.waitForTimeout(500);
};

const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 140)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
  await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-back, .pc-bt-row', { timeout: 60000 }).catch(() => {});
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(2500); }
  const showingAll = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /all time/i.test(x.textContent || ''));
    return /click to filter by month/i.test((b && b.getAttribute('title')) || '');
  });
  if (showingAll) { await page.locator('button', { hasText: /all time/i }).first().click(); await page.waitForTimeout(2000); }
  await page.evaluate((m) => {
    const inp = document.querySelector('input.pc-chrome-input');
    if (!inp) return;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, m);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, MONTH);
  await page.waitForTimeout(4000);
  await page.locator('.pc-bt-row').filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${BRAND}\\s*$`) }) }).first().click();
  await page.waitForSelector('.pc-ct-row', { timeout: 30000 });
  await page.waitForTimeout(1500);

  /* ── the whole list, before anything is typed ───────────────────────── */
  const start = await readTable(page);
  check(start.count === all.length, `${BRAND} ${MONTH}: every creator is listed before filtering`, `screen ${start.count}, database ${all.length}`);
  check(/^\s*\d+\s+creators?\s*$/.test(start.chip) && Number(start.chip.match(/\d+/)[0]) === all.length,
    'the toolbar says how many creators there are', `"${start.chip}"`);
  const dividerTotal = start.dividers.reduce((s, d) => s + d.count, 0);
  check(start.dividers.length > 0 && dividerTotal === all.length, 'the group headings add up to the whole list',
    start.dividers.map((d) => `${d.label} ${d.count}`).join(' · '));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-toolbar.png`, clip: { x: 0, y: 0, width: 1600, height: 460 } });

  /* ── search ─────────────────────────────────────────────────────────── */
  await setSearch(page, TERM);
  const searched = await readTable(page);
  check(searched.count === expectSearch.length, `searching "${TERM}" leaves exactly the rows the database says`,
    `screen ${searched.count}, database ${expectSearch.length}`);
  const missing = expectSearch.map(nameOf).filter((n) => !searched.names.includes(n));
  check(missing.length === 0, 'and they are the right people', missing.length ? `missing ${missing.slice(0, 3).join(', ')} · screen shows ${searched.names.join(', ')}` : searched.names.join(', '));
  check(/\b\d+ of \d+ creators\b/.test(searched.chip), 'the count says it is showing part of the list', `"${searched.chip}"`);
  check(searched.numbers[0] === '#1', 'the rows renumber from one', searched.numbers.slice(0, 3).join(' '));
  check(searched.kpis.join('|') === start.kpis.join('|'), 'the five cards do NOT move when the list is searched', `${start.kpis[0]} → ${searched.kpis[0]}`);
  check(searched.gmv === start.gmv && searched.views === start.views, 'and neither do the top-videos totals',
    `GMV ${start.gmv} → ${searched.gmv} · views ${start.views} → ${searched.views}`);

  /* A word nobody matches: the empty state, not an empty table. */
  await setSearch(page, 'zzqqxx-nobody');
  const none = await readTable(page);
  check(none.count === 0 && /no creators match/i.test(none.empty), 'a search nobody matches says so in plain words', `"${none.empty}"`);
  await page.getByRole('button', { name: /clear search and filters/i }).click();
  await page.waitForTimeout(600);
  const cleared = await readTable(page);
  check(cleared.count === all.length, 'clearing brings everybody back', `${cleared.count} of ${all.length}`);

  /* ── filters ────────────────────────────────────────────────────────── */
  const openFilters = async () => {
    await page.locator('.pc-toolbar button', { hasText: /^filter/i }).first().click();
    await page.waitForTimeout(400);
  };
  for (const [label, key] of [['Payment Sent', 'sent'], ['Videos in Progress', 'progress'], ['Payment Pending', 'pending']]) {
    const want = all.filter((c) => statusOf(c) === key);
    if (!want.length) continue;
    await openFilters();
    await page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first().click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const got = await readTable(page);
    check(got.count === want.length, `the ${label} filter leaves exactly those creators`, `screen ${got.count}, database ${want.length}`);
    check(got.dividers.every((d) => new RegExp(label, 'i').test(d.label)), `and only the ${label} group remains`,
      got.dividers.map((d) => d.label).join(' · '));
    await openFilters();
    await page.getByRole('button', { name: /^reset all$/i }).click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
  }

  /* Still owed, the question a brand page is for. */
  await openFilters();
  await page.getByRole('button', { name: /^still owed/i }).first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const owed = await readTable(page);
  check(owed.count === (deliveryCounts.get('outstanding') || 0), 'the "still owed" filter matches the database',
    `screen ${owed.count}, database ${deliveryCounts.get('outstanding') || 0}`);

  /* Two filters at once narrow further, never wider. */
  await openFilters();
  const firstHired = [...hiredCounts.keys()][0];
  if (firstHired) {
    await page.getByRole('button', { name: new RegExp(`^${firstHired}`, 'i') }).first().click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const both = await readTable(page);
    const want = all.filter((c) => deliveryOf(c) === 'outstanding' && String(c.hired_by || '').trim() === firstHired);
    check(both.count === want.length, `two filters together match the database (still owed + hired by ${firstHired})`,
      `screen ${both.count}, database ${want.length}`);
    check(both.count <= owed.count, 'and adding a filter never widens the list', `${owed.count} → ${both.count}`);
  }
  await openFilters();
  await page.getByRole('button', { name: /^reset all$/i }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const afterReset = await readTable(page);
  check(afterReset.count === all.length, 'Reset all brings the whole list back', `${afterReset.count} of ${all.length}`);

  /* ── both themes, and the panel readable in each ─────────────────────── */
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      localStorage.setItem('wurxmediahub-theme', t);
      window.dispatchEvent(new StorageEvent('storage', { key: 'wurxmediahub-theme' }));
    }, theme);
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    await openFilters();
    const seen = await page.evaluate(() => {
      const panel = document.querySelector('[data-wx="brand-filters"]');
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      /* A panel painted in the page's own background colour is one nobody can
         read against the table behind it. */
      const solid = !/rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor);
      return {
        w: Math.round(r.width), h: Math.round(r.height), solid, bg: style.backgroundColor,
        onScreen: r.right <= window.innerWidth + 1 && r.left >= -1 && r.top >= -1,
        sections: [...panel.querySelectorAll('div')].map((d) => d.textContent.trim()).filter((t) => /^(Payment status|Videos|Hired by|EUKA tier)$/.test(t)),
      };
    });
    check(!!seen && seen.onScreen && seen.w > 200 && seen.solid && seen.sections.length >= 3,
      `${theme}: the filter panel opens fully on screen, solid, with its sections`,
      seen ? `${seen.w}x${seen.h}px · background ${seen.bg} · sections ${seen.sections.join(', ')}` : 'panel not found');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/brand-filters-${theme}.png`, clip: { x: 0, y: 0, width: 1600, height: 620 } });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  /* ── every width ─────────────────────────────────────────────────────── */
  for (const w of [1920, 1440, 1024, 768, 390]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.waitForTimeout(600);
    const l = await page.evaluate(() => {
      const t = document.querySelector('.pc-toolbar');
      const i = t?.querySelector('input');
      const b = [...(t?.querySelectorAll('button') || [])].find((x) => /filter/i.test(x.textContent || ''));
      const r = (e) => e.getBoundingClientRect();
      return {
        toolbar: !!t && r(t).height > 0,
        searchVisible: !!i && r(i).width > 80,
        filterVisible: !!b && r(b).width > 40,
        inside: t ? r(t).right <= window.innerWidth + 1 : false,
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(l.toolbar && l.searchVisible && l.filterVisible && l.inside && l.sideways <= 1,
      `${w}px: search and Filter are usable, nothing off the side`,
      `toolbar ${l.toolbar} · search ${l.searchVisible} · filter ${l.filterVisible} · inside ${l.inside} · sideways ${l.sideways}px`);
    if (SHOTS && [1440, 390].includes(w)) await page.screenshot({ path: `${SHOTS}/brand-toolbar-${w}.png`, clip: { x: 0, y: 0, width: w, height: w === 390 ? 700 : 460 } });
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
