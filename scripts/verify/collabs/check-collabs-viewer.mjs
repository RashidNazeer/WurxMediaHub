#!/usr/bin/env node
/**
 * The three read-only Paid Collabs roles, in a real browser.
 *
 *   pnpm build && pnpm preview
 *   COLLABS_VIEWER_PASSWORD=... node scripts/verify/collabs/check-collabs-viewer.mjs
 *
 * WHAT THIS IS FOR. Affiliate Team Lead, Operations Lead and Ads Manager may
 * read Paid Collabs and see nothing else in the product. The database enforces
 * it — `public.is_collabs_viewer()` on the wurxbase SELECT policies, writes
 * still on `is_staff()` — and `verify:rls` proves that half by attacking it.
 * This proves the half a person actually meets: the menu offers them nothing
 * they cannot open, an admin URL typed by hand does not render, and no button
 * inside Paid Collabs offers to change anything.
 *
 * IT ASSERTS ON WHAT IS ON SCREEN, not on what the code intends. A sidebar row
 * that exists but is hidden, or a screen that renders behind a spinner, both
 * count as visible here.
 */
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const PW = process.env.COLLABS_VIEWER_PASSWORD || '1234567890';
const STAFF_EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const STAFF_PW = process.env.COLLAB_STAFF_PASSWORD || PW;
const WHO = [
  ['atl@wurxmedia.com', 'Affiliate Team Lead'],
  ['opslead@wurxmedia.com', 'Operations Lead'],
  /* Ads Manager left this list on 2026-09-15: full staff now, see
     check-ads-manager.mjs. */
];
/* Screens they must never reach. Every one of them reads money. */
const FORBIDDEN = ['/admin', '/admin/applications', '/admin/offers', '/admin/contests',
  '/admin/brands', '/admin/creators', '/admin/tiktok', '/admin/activity'];

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
try {
  for (const [email, label] of WHO) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hello = page.getByRole('button', { name: /let.s go/i });
    if (await hello.first().isVisible().catch(() => false)) await hello.first().click();
    await page.waitForTimeout(9000);

    check(/\/admin\/collabs/.test(page.url()), `${label}: lands in Paid Collabs`, page.url());

    /* The menu offers Paid Collabs and nothing else. */
    const nav = await page.evaluate(() => {
      const links = [...document.querySelectorAll('nav a[href]')];
      return {
        all: [...new Set(links.map((a) => a.getAttribute('href')))],
        visible: [...new Set(links.filter((a) => a.getBoundingClientRect().width > 0)
          .map((a) => a.getAttribute('href')))],
      };
    });
    const strays = nav.visible.filter((h) => h.startsWith('/admin') && !h.startsWith('/admin/collabs'));
    check(strays.length === 0, `${label}: the menu shows no non-collabs admin row`, strays.join(', '));
    check(nav.visible.some((h) => h.startsWith('/admin/collabs')), `${label}: it does show Paid Collabs`,
      nav.visible.filter((h) => h.startsWith('/admin/collabs')).length + ' rows');

    /* Typing an admin URL by hand gets them nowhere. */
    for (const path of FORBIDDEN) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const landed = page.url();
      const stayed = new URL(landed).pathname === path;
      check(!stayed, `${label}: ${path} does not render`, 'landed on ' + new URL(landed).pathname);
    }

    /* ── Inside Paid Collabs, nothing offers to change anything, and
       nothing offers to take the data out. ──────────────────────────────
       THE FIRST VERSION OF THIS CHECK LIED, and it lied in the way that is
       hardest to notice: it held a DENYLIST of button labels somebody had
       already thought of ("add creator", "save", "delete", "export"…) and
       passed anything not on it. So the status dropdown, whose label is the
       status itself — "Payment Pending" — sailed through, and it ran on the
       creators tab only, so the Brands tab's Export button was never even
       looked at. 42/42 green, two real holes.

       It is an ALLOWLIST now. Every visible control on every tab must be
       recognisably READ-ONLY — navigation, filtering, sorting, paging, the
       app chrome. Anything else is a failure until a person classifies it,
       so the next control somebody adds is caught by default rather than by
       having been predicted. */
    const SAFE = [
      /^$/,                                     // icon-only chrome (bell, logs, theme, avatar)
      /^(‹|›|«|»|×|✕)$/,                        // month stepper, close
      /^(all time|this month|filter|clear|reset|refresh|search)$/,
      /^(brands|creators|performance|reporting|leaderboard|discovery)$/,
      /^creator platform$/, /^sign out$/,       // our own shell
      /^‹ all brands$/, /^back$/,
      /^[\d,.$%\s]+$/,                           // KPI pills that are pure figures
      /^(unique creators|total budget|allocated|paid|remaining|videos delivered)/,
      /^(overview|videos|contract|notes|activity)$/,
      /^(a-z|z-a|newest|oldest|highest|lowest)$/,
      /^(next|previous|page \d+)$/,
      /^(light|dark|system|text size|smaller|larger)$/,
      /* Reporting's two sub-tabs. Verified 2026-09-02 that these are
         navigation only: behind "Creative angle testing" a viewer gets a
         brand picker and nothing else — no add, rename, remove or save, and
         no editable cell, because canEditAngles and canEditAdSpend are both
         withheld from viewer. Asserted below rather than trusted. */
      /^(reporting|creative angle testing)$/,
      /* The creators tab's tier chips ("L2" + its count → "l226", and
         "Unmatched34") and the deals strip ("2×21": two deals, 21 people),
         which became FILTERS on 2026-09-10 in 5814e80. Each only sets a
         filter in local state. This check was not run again until
         2026-09-15, so that was the first time it saw them. */
      /^l[0-5]\d+$/, /^unmatched\d+$/, /^\d+×\d+$/,
    ];
    const TABS = ['brands', 'creators', 'performance', 'leaderboard', 'discovery', 'reporting'];
    for (const tab of TABS) {
      await page.goto(`${BASE}/admin/collabs/${tab}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(11000);
      const seen = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          labels: [...new Set([...document.querySelectorAll('button')].filter(vis)
            .map((b) => (b.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)))],
          /* a checkbox exists only to feed a bulk action — none should be offered */
          checks: [...document.querySelectorAll('input[type=checkbox]')].filter(vis).length,
          /* the status pill must be inert: a span, never a button */
          statusBtns: [...document.querySelectorAll('button.pc-badge, .pc-badge-btn')].filter(vis).length,
          rows: document.querySelectorAll('.pc-cv-row, .pc-bt-row, .pc-mx-row').length,
        };
      });
      const odd = seen.labels.filter((l) => !SAFE.some((re) => re.test(l)));
      check(odd.length === 0, `${label}: /${tab} offers only read-only controls`, odd.join(' | '));
      check(seen.checks === 0, `${label}: /${tab} offers no row selection`, seen.checks + ' checkboxes');
      check(seen.statusBtns === 0, `${label}: /${tab} status pill is not clickable`, seen.statusBtns + ' clickable pills');
      if (tab === 'creators') check(seen.rows > 0, `${label}: can actually read the creators list`, seen.rows + ' rows');
    }

    /* Reporting > Creative Angle Testing is a WRITE surface for anyone who
       holds canEditAngles / canEditAdSpend — typed ad spend, typed GMV,
       renamed and deleted angles. Assert on the property that matters and
       does not move with the data: nothing on it can be typed into. */
    await page.goto(`${BASE}/admin/collabs/reporting`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(11000);
    const anglesTab = page.locator('button', { hasText: /creative angle testing/i }).first();
    if (await anglesTab.isVisible().catch(() => false)) {
      await anglesTab.click();
      await page.waitForTimeout(9000);
      const ang = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const typeable = [...document.querySelectorAll(
          'input:not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])')]
          .filter(vis).filter((i) => !['month', 'checkbox', 'radio', 'search'].includes(i.type));
        return {
          typeable: typeable.map((i) => i.type + '.' + String(i.className).slice(0, 24)),
          editable: [...document.querySelectorAll('[contenteditable="true"]')].filter(vis).length,
          opened: /angle/i.test(document.body.innerText),
        };
      });
      check(ang.opened, `${label}: the angles tab actually opened`, 'nothing angle-shaped on screen');
      check(ang.typeable.length === 0, `${label}: angles tab has no typeable field`, ang.typeable.join(' | '));
      check(ang.editable === 0, `${label}: angles tab has nothing contenteditable`, ang.editable + ' found');
    } else {
      check(false, `${label}: the angles tab was reachable to check`, 'THIS CHECK SAW NOTHING');
    }

    /* And inside a brand, where the status pill and the deal rows live. */
    await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(11000);
    const row = page.locator('.pc-bt-row').first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(9000);
      const dd = await page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          statusBtns: [...document.querySelectorAll('button.pc-badge, .pc-badge-btn')].filter(vis).length,
          pills: [...document.querySelectorAll('span.pc-badge')].filter(vis).length,
          checks: [...document.querySelectorAll('input[type=checkbox]')].filter(vis).length,
        };
      });
      check(dd.pills > 0, `${label}: brand drilldown actually rendered its status pills`, dd.pills + ' pills');
      check(dd.statusBtns === 0, `${label}: brand drilldown status pills are inert`, dd.statusBtns + ' clickable');
      check(dd.checks === 0, `${label}: brand drilldown offers no row selection`, dd.checks + ' checkboxes');
    } else {
      check(false, `${label}: brand drilldown opened`, 'no brand row to click — THIS CHECK SAW NOTHING');
    }

    check(errors.length === 0, `${label}: zero console errors`, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  /* ── THE OTHER HALF OF THE BOUNDARY ─────────────────────────────────
     Everything hidden above must STILL be there for Asad's team. A gate
     that over-fires is as much a bug as one that never fires, and Rashid
     was explicit that they must not be disturbed.

     This half is not decoration. The capability these gates read lives in a
     module variable that a React effect used to populate, so it was null for
     the whole first paint — an admin would have lost the lot until some
     unrelated fetch happened to re-render. Without an assertion from the
     admin's side, that is invisible. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', STAFF_EMAIL);
    await page.fill('input[name="password"]', STAFF_PW);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi = page.getByRole('button', { name: /let.s go/i });
    if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

    const look = async (path) => {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(12000);
      return page.evaluate(() => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return {
          exports: [...document.querySelectorAll('button')].filter(vis)
            .filter((b) => /export|csv|copy/i.test(b.textContent || '')).length,
          checks: [...document.querySelectorAll('input[type=checkbox]')].filter(vis).length,
          statusBtns: [...document.querySelectorAll('button.pc-badge, .pc-badge-btn')].filter(vis).length,
          notes: [...document.querySelectorAll('.pc-note-btn')].filter(vis).length,
        };
      });
    };
    const br = await look('/admin/collabs/brands');
    check(br.exports > 0, 'staff STILL have the brands Export button', br.exports + ' found');
    check(br.notes > 0, 'staff STILL have the brand notes buttons', br.notes + ' found');
    const cr = await look('/admin/collabs/creators');
    check(cr.checks > 0, 'staff STILL have row selection', cr.checks + ' checkboxes');
    check(cr.statusBtns > 0, 'staff STILL have clickable status pills', cr.statusBtns + ' pills');
    check(errors.length === 0, 'staff: zero console errors', errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
