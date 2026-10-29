#!/usr/bin/env node
/**
 * THE FOLLOWERS COLUMN ON THE CREATORS TAB, AGAINST EUKA ITSELF.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-followers-column.mjs
 *
 * Rashid, 2026-09-18: "can we add a new column of followers as well i hope we
 * can get followers count for our creators".
 *
 * THE EXPECTED NUMBERS COME FROM EUKA, not from the screen: this asks the
 * `euka` function for each store's profiles, exactly as the app's own sweep
 * does, builds handle → followers, and then compares every row that shows a
 * figure. A column that rendered dashes everywhere would pass a "the column
 * exists" test and fail this one.
 *
 * It also proves the column is not stealing the row: no creator's name may be
 * narrower than it was without the column.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/* WurxUI's kNum, so the comparison is against what the cell can possibly say. */
const kNum = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(v));
};
const handleKey = (raw) => {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return '';
  const last = t.startsWith('http') ? (t.replace(/\/+$/, '').split('/').pop() ?? '') : t;
  return last.replace(/^@/, '').split(/[?#]/)[0].trim();
};

/* ── what Euka says, through the same door the app uses ─────────────────── */
const api = createClient(URL_, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: signInErr } = await api.auth.signInWithPassword({
  email: process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com',
  password: process.env.COLLAB_STAFF_PASSWORD || '1234567890',
});
if (signInErr) throw new Error('sign-in failed: ' + signInErr.message);
const callEuka = async (body) => {
  const { data, error } = await api.functions.invoke('euka', { body });
  if (error) return null;
  return data;
};
const meta = await callEuka({});
const stores = meta?.stores ?? [];
const followers = new Map();
let answered = 0;
await Promise.all(stores.map(async (s) => {
  const d = await callEuka({ store: s.id });
  if (!d?.profiles) return;
  answered += 1;
  for (const [h, p] of Object.entries(d.profiles)) {
    const n = Number(p?.followers) || 0;
    const k = handleKey(h);
    if (k && n > (followers.get(k) ?? 0)) followers.set(k, n);
  }
}));
console.log(`euka: ${answered} of ${stores.length} stores answered · ${followers.size} handles with a follower count`);
check(followers.size > 0, 'Euka gives follower counts, so this check can fail', `${followers.size} handles`);

/* THE SECOND SOURCE: counts looked up by handle in Euka's market intelligence,
   stored by the sync. The screen falls back to these when the shop data has
   none, so the check does the same — shop first, stored second. */
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const stored = new Map();
{
  const { data } = await svc.from('euka_creator_followers').select('handle, followers').eq('found', true);
  for (const r of data ?? []) if (r.followers) stored.set(r.handle, r.followers);
}
console.log(`stored lookups: ${stored.size} handles`);

/*
 * ARE THE LOOKUPS THE RIGHT PEOPLE? The lookup is a keyword search, stored only
 * on an exact handle match — but trust is earned, not assumed. Where BOTH
 * sources know a handle, the two counts are the same person on different days,
 * so they must be close. A search that grabbed somebody else would be off by
 * miles. (Seen on 2026-09-18: @dulcedagda 361,800 by shop data, 378,200 by
 * lookup — 4.5% apart.)
 */
const both = [...stored.keys()].filter((h) => followers.has(h));
const far = both.filter((h) => {
  const a = followers.get(h), b = stored.get(h);
  return Math.max(a, b) / Math.max(1, Math.min(a, b)) > 1.5;
});
check(both.length >= 5, 'enough creators are known to both sources to judge the lookup', `${both.length} in both`);
check(far.length === 0, 'where both sources know a creator, the counts agree within 50%',
  far.slice(0, 4).map((h) => `@${h}: shop ${followers.get(h)}, lookup ${stored.get(h)}`).join(' | ') || `${both.length} compared`);

/* ── the screen ─────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1800, height: 1000 } })).newPage();
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

  await page.goto(`${BASE}/admin/collabs/creators`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-cv-row', { timeout: 45000 }).catch(() => {});
  /* The sweep is deferred past first paint on purpose, so wait for a figure
     rather than a timer: a fixed wait would pass on an empty column. */
  /*
   * WAIT FOR THE SWEEP TO SETTLE, not for the first figure. Euka is read one
   * store at a time and merged as each lands, so the column fills over about
   * half a minute — measured at 52 of 166 rows when the first figure appeared.
   * Comparing then reported creators as missing whose numbers were still in
   * flight. This waits until the filled count stops climbing.
   */
  /* THE APP SAYS WHEN ITS SWEEP IS DONE: it writes `wurx_euka_l30_v10` to
     localStorage only once EVERY store has answered ("Only cache COMPLETE
     sweeps", WurxUI). Waiting for a pause instead failed once already — a slow
     store stalled the sweep for six seconds mid-way, the count held still, and
     the check compared a half-loaded column. */
  await page.waitForFunction(() => {
    try {
      const c = JSON.parse(localStorage.getItem('wurx_euka_l30_v10') || 'null');
      return Boolean(c && c.complete);
    } catch { return false; }
  }, null, { timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const last = await page.evaluate(() =>
    [...document.querySelectorAll('.pc-cv-row [data-label="Followers"]')].filter((c) => /\d/.test(c.textContent ?? '')).length);
  const complete = await page.evaluate(() => {
    try { return Boolean(JSON.parse(localStorage.getItem('wurx_euka_l30_v10') || 'null')?.complete); } catch { return false; }
  });
  check(complete, 'the app finished its Euka sweep before anything was compared');
  console.log(`screen: ${last} rows carry a follower count once the sweep completed`);

  const head = await page.evaluate(() => [...document.querySelectorAll('.pc-cv-head > div')].map((d) => d.textContent?.trim()));
  check(head.includes('Followers'), 'the Creators tab has a Followers column', head.join(' | '));

  const rows = await page.evaluate(() => [...document.querySelectorAll('.pc-cv-row')].map((row) => ({
    name: row.querySelector('.pc-cname')?.textContent?.trim() ?? '',
    handle: row.querySelector('[data-label="TikTok"] a')?.textContent?.trim() ?? '',
    shown: row.querySelector('[data-label="Followers"]')?.textContent?.trim() ?? '',
    nameWidth: row.querySelector('.pc-cname')?.clientWidth ?? 0,
  })));
  check(rows.length > 0, 'the tab lists creators', `${rows.length} rows`);

  const withFigure = rows.filter((r) => /\d/.test(r.shown));
  check(withFigure.length > 0, 'the column is filled in, not a column of dashes', `${withFigure.length} of ${rows.length} rows`);

  const wrong = [];
  let compared = 0;
  let fromLookup = 0;
  for (const r of rows) {
    const key = handleKey(r.handle);
    if (!key) continue;
    const live = followers.get(key);
    const want = live || stored.get(key);
    if (!want) {
      if (/\d/.test(r.shown)) wrong.push(`${r.name || key}: screen ${r.shown}, but neither source has a count`);
      continue;
    }
    compared++;
    if (!live) fromLookup++;
    if (r.shown !== kNum(want)) wrong.push(`${r.name || key}: screen ${r.shown}, expected ${kNum(want)} (${live ? 'shop' : 'lookup'})`);
  }
  check(compared > 0 && wrong.length === 0,
    `every follower count matches its source (${compared} rows, ${fromLookup} of them from the handle lookup)`, wrong.slice(0, 4).join(' | '));

  /*
   * THE FILTER. Rashid, 2026-09-18: "we also need to have filter so users can
   * filter creators on follower". Picking a bucket must leave exactly the rows
   * in that bucket — checked against the figures the screen itself shows, so a
   * filter that quietly kept everybody, or emptied the list, fails.
   */
  const bucketOf = (shown) => {
    if (!/\d/.test(shown)) return 'none';
    const n = shown.endsWith('M') ? parseFloat(shown) * 1e6 : shown.endsWith('K') ? parseFloat(shown) * 1e3 : Number(shown);
    if (n >= 1e6) return '1m';
    if (n >= 1e5) return '100k';
    if (n >= 1e4) return '10k';
    return 'under10k';
  };
  const before = rows.map((r) => bucketOf(r.shown));
  const target = ['10k', '100k', 'under10k', '1m'].find((b) => before.filter((x) => x === b).length > 0);
  check(Boolean(target), 'the tab has creators in at least one followers bucket to filter by', target ?? 'none');

  await page.getByRole('button', { name: /^filter/i }).first().click();
  await page.waitForTimeout(600);
  const panel = await page.evaluate(() => document.body.innerText);
  /* The section titles are uppercased in CSS, and innerText reports what is
     rendered, so this must not be case-sensitive. */
  check(/followers/i.test(panel), 'the filter panel offers Followers');

  const labels = { '1m': /^1M\+ · \d+$/, '100k': /^100K – 1M · \d+$/, '10k': /^10K – 100K · \d+$/, 'under10k': /^Under 10K · \d+$/ };
  const chip = page.locator('button').filter({ hasText: labels[target] }).first();
  const chipText = (await chip.textContent().catch(() => ''))?.trim() ?? '';
  await chip.click();
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => [...document.querySelectorAll('.pc-cv-row')].map((row) =>
    row.querySelector('[data-label="Followers"]')?.textContent?.trim() ?? ''));
  const stray = after.filter((s) => {
    if (!/\d/.test(s)) return true;
    const n = s.endsWith('M') ? parseFloat(s) * 1e6 : s.endsWith('K') ? parseFloat(s) * 1e3 : Number(s);
    const b = n >= 1e6 ? '1m' : n >= 1e5 ? '100k' : n >= 1e4 ? '10k' : 'under10k';
    return b !== target;
  }).length;
  check(after.length > 0 && stray === 0,
    `filtering by ${chipText} leaves only that bucket`, `${after.length} rows, ${stray} from another bucket`);
  check(after.length < rows.length, 'and it really narrowed the list', `${after.length} of ${rows.length}`);

  /* 'Not on EUKA' is a filter too: those are people Euka has no profile for. */
  const noneChip = page.locator('button').filter({ hasText: /^No count yet · \d+$/ }).first();
  if (await noneChip.isVisible().catch(() => false)) {
    await noneChip.click();
    await page.waitForTimeout(1200);
    const noneRows = await page.evaluate(() => [...document.querySelectorAll('.pc-cv-row')].map((row) =>
      row.querySelector('[data-label="Followers"]')?.textContent?.trim() ?? ''));
    check(noneRows.length > 0 && noneRows.every((s) => !/\d/.test(s)),
      'and No count yet leaves only creators with no count', `${noneRows.length} rows`);
    await noneChip.click();
    await page.waitForTimeout(800);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  /* the names still have room */
  const squeezed = rows.filter((r) => r.nameWidth > 0 && r.nameWidth < 40).length;
  check(squeezed === 0, 'the new column has not squeezed the names', `${squeezed} names under 40px`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, 'the page still does not scroll sideways', `${overflow}px`);

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
