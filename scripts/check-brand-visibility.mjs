#!/usr/bin/env node
/**
 * A BRAND SOMEBODY ADDED IS FINDABLE BY EVERYBODY ELSE.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/check-brand-visibility.mjs
 *
 * Rashid, 2026-10-09: "Asad added a new brand Honeysticks and other users like
 * me or admin is unable to see this ... asad is able to see the brand on his
 * laptop but even he can't see on my laptop with his own account."
 *
 * ── WHAT IT ACTUALLY WAS ─────────────────────────────────────────────────
 * Not permissions. The policy on every `wurxbase` table is `is_staff()`, and
 * signing in as the person who could see it changed nothing — because the thing
 * that differed was the LAPTOP, not the login. The Brands screen lists the
 * brands with a creator or a budget IN THE SELECTED MONTH, and the selected
 * month was remembered in that browser's localStorage FOR EVER. HoneySticks
 * has an October budget and no creators; the other browsers were still parked
 * on September from weeks before. Proved by experiment: one account, one
 * machine, one build, only the saved month different.
 *
 * That is why this file drives a real browser and seeds `wurx_ui_state_v1`
 * directly. The bug lived in persisted browser state, so persisted browser
 * state is the only place a guard can stand.
 *
 * ── THE TWO HALVES OF THE FIX, BOTH GUARDED HERE ─────────────────────────
 * 1. A month remembered on an earlier DAY is not restored (`rememberedMonth`).
 *    A month chosen today still is — that is the convenience it exists for.
 * 2. When a brand is set up in a later month than the one on screen, the
 *    Brands screen says so by name and offers a one-click switch. This is the
 *    half that fixes the CLASS: the screen could not previously distinguish
 *    "no such brand" from "not in this month", and the team concluded the
 *    former twice.
 */
import { readFileSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(Boolean)
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dayStamp = (d) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
const NOW = monthKey(new Date());
const TODAY = dayStamp(new Date());
const PREV = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return monthKey(d); })();

if (!KEY) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }

/* ── WHAT THE DATA ACTUALLY HOLDS, so the browser checks below are not
      asserted against an assumption. ──────────────────────────────────── */
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'wurxbase' };

/* A dropped connection is not a finding. These two reads only establish what
   the data looks like before anything is asserted, so a blip on the way to
   Supabase must not be reported as a brand being invisible — but it must not
   be swallowed either, so three tries and then a real failure. */
async function getJson(path, tries = 3) {
  let last = '';
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
      if (r.ok) return r.json();
      last = `HTTP ${r.status}`;
    } catch (e) { last = String(e.message).slice(0, 80); }
    if (i < tries) await new Promise((s) => setTimeout(s, 1500 * i));
  }
  console.error(`could not read ${path.split('?')[0]} after ${tries} tries: ${last}`);
  process.exit(1);
}
const budgets = await getJson('brand_monthly_budgets?select=brand,month&limit=1000');
const creators = await getJson('creators?select=brand,hiring_date&limit=2000');

const inMonth = (m) => new Set(creators
  .filter((c) => String(c.hiring_date || '').startsWith(m))
  .map((c) => String(c.brand || '').trim().toLowerCase()));
const nowCreators = inMonth(NOW);
/* A brand with a budget THIS month and no creators in the PREVIOUS one is
   exactly the shape HoneySticks had: invisible to a browser left behind. */
const stranded = budgets
  .filter((b) => b.month === NOW)
  .map((b) => String(b.brand || '').trim())
  .filter((b) => b && !inMonth(PREV).has(b.toLowerCase()));

check(budgets.length > 0, 'there are budget rows to reason about', `${budgets.length}`);
check(stranded.length > 0,
  `at least one brand is set up in ${NOW} and absent from ${PREV} — the shape of the bug`,
  stranded.slice(0, 4).join(', ') || 'none, so the browser checks below prove nothing');
if (!stranded.length) {
  console.log('\nNo brand currently has this shape on dev, so the guard cannot run. Not a pass.');
  for (const f of fail) console.log('  FAIL  ' + f);
  process.exit(1);
}
const TARGET = stranded[0];

/* ── THE BROWSER, with the saved state seeded exactly as a stale one ──── */
const browser = await launchBrowser();
try {
  const open = async (seed) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    if (seed) {
      await page.evaluate((s) => {
        const k = 'wurx_ui_state_v1';
        const cur = JSON.parse(localStorage.getItem(k) || '{}');
        localStorage.setItem(k, JSON.stringify({ ...cur, ...s }));
      }, seed);
    }
    await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
    await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi = page.getByRole('button', { name: /let.s go/i });
    if (await hi.first().isVisible().catch(() => false)) await hi.first().click();
    await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pc-bt-row, .pc-empty', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const read = async () => page.evaluate(() => ({
      month: JSON.parse(localStorage.getItem('wurx_ui_state_v1') || '{}').month,
      brands: [...document.querySelectorAll('.pc-brandname')].map((e) => e.textContent.trim()),
      banner: (document.querySelector('[data-wx="brands-elsewhere"]')?.innerText || '').replace(/\s+/g, ' ').trim(),
    }));
    return { page, ctx, read, errors };
  };

  /* 1. A MONTH LEFT OVER FROM ANOTHER DAY IS NOT RESTORED. */
  for (const [label, seed] of [
    ['with no day stamp at all (saved before the fix)', { month: PREV }],
    ['stamped on an earlier day', { month: PREV, monthSavedOn: `${PREV}-20` }],
  ]) {
    const s = await open(seed);
    const v = await s.read();
    check(v.month === NOW,
      `a month ${label} is not restored — the screen opens on ${NOW}`,
      `opened on ${v.month}`);
    check(v.brands.some((b) => b.toLowerCase() === TARGET.toLowerCase()),
      `and ${TARGET} is therefore visible, as it is to everybody else`,
      `${v.brands.length} brands listed`);
    check(s.errors.length === 0, `zero console errors (${label})`, s.errors.slice(0, 2).join(' | '));
    await s.ctx.close();
  }

  /* 2. A MONTH CHOSEN TODAY STILL STICKS. The fix must not take away the
        convenience it was narrowing — somebody reconciling last month should
        not be thrown forward on every reload. */
  {
    const s = await open({ month: PREV, monthSavedOn: TODAY });
    const v = await s.read();
    check(v.month === PREV,
      `a month chosen today is still restored (${PREV})`,
      `opened on ${v.month}`);

    /* 3. AND THE SCREEN SAYS WHERE THE MISSING BRAND IS. */
    check(v.banner.length > 0,
      'looking at an earlier month, the screen says brands exist in a later one',
      v.banner || 'no banner rendered');
    check(v.banner.includes(TARGET),
      `the banner names ${TARGET} — the brand somebody would be hunting for`,
      v.banner.slice(0, 120));
    check(/show\s/i.test(v.banner),
      'and offers a way to get there', v.banner.slice(0, 120));

    /* The offer must work, not just be printed. */
    /* The button is labelled with the month as a person reads it ("Show Oct
       2026"), not as the data stores it, so it is found inside the banner
       rather than by a key-shaped name — the first version looked for
       "Show 2026-10", matched nothing, and reported the switch as broken. */
    const jump = s.page.locator('[data-wx="brands-elsewhere"] button');
    const n = await jump.count().catch(() => 0);
    check(n > 0, 'the banner has a clickable way through', `${n} buttons`);
    if (n > 0) {
      await jump.first().click();
      await s.page.waitForTimeout(3000);
      const after = await s.read();
      check(after.month === NOW, 'clicking it switches the month', `now ${after.month}`);
      check(after.brands.some((b) => b.toLowerCase() === TARGET.toLowerCase()),
        `and ${TARGET} is on the screen`, `${after.brands.length} brands listed`);
    }
    await s.ctx.close();
  }

  /* 4. NO WALLPAPER. On the current month with nothing set up later, the
        notice must be absent — a banner that is always there is one nobody
        reads, which is how the real one would be missed. */
  {
    const s = await open({ month: NOW, monthSavedOn: TODAY });
    const v = await s.read();
    const laterExists = budgets.some((b) => b.month > NOW);
    check(laterExists || v.banner === '',
      'on the current month, with nothing set up later, there is no notice',
      v.banner ? `shown anyway: ${v.banner.slice(0, 90)}` : 'absent, correctly');
    await s.ctx.close();
  }
} finally {
  await browser.close();
}

/* ── 5. AND THE PRODUCT PICKER SPEAKS ENGLISH ─────────────────────────────
      Rashid, same message: "fetching product from euka shows 503 error". The
      503 is EUKA's and the function handles it correctly; what reached the
      person onboarding a creator was the number. ───────────────────────── */
{
  const si = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com',
      password: process.env.COLLAB_STAFF_PASSWORD || '1234567890',
    }),
  });
  const tok = (await si.json()).access_token;
  check(!!tok, 'signed in as staff to ask the product picker');
  if (tok) {
    const ask = async (brand) => {
      const r = await fetch(`${URL_}/functions/v1/collab-products`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };

    /* A brand whose catalogue works, so a blanket failure cannot read as a
       well-worded error. */
    const ctrl = await ask(process.env.PICKER_OK_BRAND || 'Penetrex');
    check(ctrl.status === 200 && Array.isArray(ctrl.body.products) && ctrl.body.products.length > 0,
      'the control brand still returns a real catalogue',
      `${ctrl.status}, ${ctrl.body.products?.length ?? '-'} products`);

    /* Find a brand whose catalogue is ACTUALLY failing, rather than asserting
       the wording against the first stranded name and discovering it works.
       If none is failing, say so plainly instead of printing a green line. */
    let bad = null, badBrand = '';
    for (const b of stranded.slice(0, 6)) {
      const r = await ask(b);
      check(r.status === 200, `${b}: a brand EUKA cannot answer for is still a 200, not an error page`, String(r.status));
      if (r.body.upstreamStatus || /error \d{3}/.test(String(r.body.note || ''))) { bad = r; badBrand = b; break; }
    }
    if (bad) {
      const note = String(bad.body.note || '');
      check(!/^euka answered \d+$/i.test(note.trim()),
        'the note is a sentence, not the bare upstream status code the picker used to print',
        note.slice(0, 110));
      check(note.includes(badBrand), 'it names the brand it is talking about', note.slice(0, 110));
      check(/type the product/i.test(note), 'and tells the person what to do instead', note.slice(0, 110));
      check(!/^\s*\d{3}\s*$/.test(note), 'and is not just a number');
    } else {
      console.log('  NOTE  no brand\'s catalogue is failing right now, so the upstream-failure'
        + ' wording had nothing to prove this run. The control above still ran.');
    }
  }
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
