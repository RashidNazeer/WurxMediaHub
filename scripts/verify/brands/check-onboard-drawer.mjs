#!/usr/bin/env node
/**
 * THE ONBOARDING DRAWER, AT EVERY ZOOM AND EVERY WIDTH.
 *
 *   pnpm build && pnpm preview
 *   node scripts/verify/brands/check-onboard-drawer.mjs
 *
 * Rashid, 2026-09-23: "instead of showing the popup we need to use drawer ...
 * for choosing multiple products the ui is very bad, I said it should be the
 * dropdown and searchable and it means it should only show the list only when
 * we open the dropdown, click arrow should close the list ... also use product
 * images ... keep the font same because boss like small fonts but ui should be
 * perfect please, also when zooming in zooming out drawer should never overlap
 * or miss something."
 *
 * So the measurements here are the requirements, one for one:
 *   - the drawer is at the right edge, full height, and NOTHING covers its
 *     header — our own top bar sits in a stacking context it cannot escape, so
 *     this is the check that would have caught the first attempt;
 *   - the footer with Cancel and Add creator is inside the window at every zoom,
 *     because a form you cannot submit is the worst way to lose one;
 *   - no horizontal scrolling, and no row wider than the drawer, at any zoom —
 *     product names here run past 120 characters;
 *   - the product list is CLOSED until the trigger is pressed, and the chevron
 *     closes it again;
 *   - the type stays small: the body text must not have grown.
 *
 * ZOOM IS SIMULATED THE WAY A BROWSER DOES IT, by changing the device pixel
 * ratio and the CSS viewport together — at 150% a 1500px window reports 1000px
 * of CSS space, which is precisely when a fixed-width panel starts covering
 * what it should not.
 */
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Penetrex';
const SHOTS = process.env.SHOTS_DIR || '';

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
void readFileSync;

const browser = await launchBrowser();
try {
  /* Each "zoom" is a viewport: the CSS pixels a browser reports at that zoom on
     a 1500x950 window, which is what the layout actually sees. */
  const ZOOMS = [
    { label: '100%', width: 1500, height: 950 },
    { label: '125%', width: 1200, height: 760 },
    { label: '150%', width: 1000, height: 633 },
    { label: '175%', width: 857, height: 543 },
    { label: '200%', width: 750, height: 475 },
    { label: 'phone', width: 390, height: 780 },
  ];

  for (const z of ZOOMS) {
    const ctx = await browser.newContext({ viewport: { width: z.width, height: z.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 120)));

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
    await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi = page.getByRole('button', { name: /let.s go/i });
    if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

    await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
    const back = page.locator('.pc-back');
    if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(2000); }
    const row = page.locator('.pc-bt-row').filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${BRAND}\\s*$`) }) }).first();
    if (!(await row.isVisible().catch(() => false))) { check(false, `${z.label}: ${BRAND} is on the Brands screen`); await ctx.close(); continue; }
    await row.click();
    await page.waitForSelector('.pc-ct-row, .pc-empty', { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /\+\s*creator/i }).first().click();
    await page.waitForSelector('[data-wx="product-trigger"]', { timeout: 20000 });
    /* WAIT FOR THE CATALOGUE, not for a pause. The trigger says "Loading this
       brand's products" until it lands; opening the list before then shows an
       empty panel, and an empty panel here is a timing artefact rather than a
       fault — which is exactly the sort of thing that makes a check lie. */
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-wx="product-trigger"]');
      return !!t && !/loading/i.test(t.textContent || '');
    }, null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(500);

    const geom = await page.evaluate(() => {
      const d = document.querySelector('.wx-drawer');
      if (!d) return null;
      const head = d.querySelector('.pc-cf-head');
      const body = d.querySelector('.pc-cm-body');
      const foot = d.querySelector('.pc-cf-foot');
      const r = (e) => (e ? e.getBoundingClientRect() : null);
      const dr = r(d), hr = r(head), br = r(body), fr = r(foot);
      /* What is actually painted at the middle of the header? If our own top
         bar is over it, this is the app's button rather than the drawer's. */
      const overHeader = hr ? document.elementFromPoint(Math.round(hr.left + hr.width / 2), Math.round(hr.top + hr.height / 2)) : null;
      const inDrawer = overHeader ? d.contains(overHeader) : false;
      /* Anything wider than the panel is something spilling out of it. */
      const wide = [...d.querySelectorAll('.pc-cm-body *')]
        .filter((e) => e.getBoundingClientRect().width > dr.width + 1).length;
      const bodyStyle = body ? getComputedStyle(body) : null;
      const sample = d.querySelector('[data-wx="product-trigger"]');
      return {
        drawer: { top: dr.top, right: dr.right, bottom: dr.bottom, width: dr.width, height: dr.height },
        headVisible: !!hr && hr.height > 20 && hr.top >= -1,
        headCoveredByChrome: !inDrawer,
        footInside: !!fr && fr.bottom <= window.innerHeight + 1 && fr.top >= 0,
        bodyScrolls: !!body && body.scrollHeight > body.clientHeight,
        sideScroll: body ? body.scrollWidth - body.clientWidth : 0,
        pageSideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wideChildren: wide,
        fontPx: sample ? parseFloat(getComputedStyle(sample).fontSize) : null,
        bodyOverflowX: bodyStyle ? bodyStyle.overflowX : null,
        listOpen: !!document.querySelector('[data-wx="product-panel"]'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    });

    if (!geom) { check(false, `${z.label}: the drawer opened`); await ctx.close(); continue; }

    check(Math.abs(geom.drawer.right - geom.viewport.w) <= 1 && geom.drawer.height > 200,
      `${z.label}: the drawer is against the right edge and fills the height`,
      `right ${Math.round(geom.drawer.right)} of ${geom.viewport.w}, ${Math.round(geom.drawer.height)}px tall`);
    check(geom.headVisible && !geom.headCoveredByChrome,
      `${z.label}: its header is visible and nothing is painted over it`,
      `visible ${geom.headVisible}, covered ${geom.headCoveredByChrome}`);
    check(geom.footInside, `${z.label}: Cancel and Add creator are inside the window`);
    check(geom.sideScroll <= 1 && geom.pageSideScroll <= 1 && geom.wideChildren === 0,
      `${z.label}: nothing spills sideways out of the drawer`,
      `body ${geom.sideScroll}px · page ${geom.pageSideScroll}px · ${geom.wideChildren} wide children`);
    /* The boss likes small type. The drawer must not have inflated it. */
    check(geom.fontPx !== null && geom.fontPx <= 14, `${z.label}: the type is still small`, `${geom.fontPx}px`);
    check(geom.listOpen === false, `${z.label}: the product list starts CLOSED`);

    /* The dropdown: opens on the trigger, closes on the trigger, closes on Escape. */
    await page.locator('[data-wx="product-trigger"]').click();
    await page.waitForTimeout(500);
    /* LET THE PICTURES SETTLE BEFORE MEASURING THEM. Product photographs come
       off TikTok's CDN, and reading `naturalWidth` half a second after the list
       opens says "0 loaded" about images that are simply still arriving — a
       failure report about nothing. Wait until every one has either loaded or
       given up, and only then look. */
    /* Wait for the thing being asserted, which is that the CDN serves us AT
       ALL — not for every image in the list. They are `loading="lazy"`, so the
       ones below the fold of a short panel may never load by design, and
       waiting for all of them makes the check fail on laziness rather than on
       anything real. One rendered photograph proves the point; zero does not. */
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('[data-wx="product-list"] img')];
      return imgs.length === 0 || imgs.some((i) => i.complete && i.naturalWidth > 0);
    }, null, { timeout: 25000 }).catch(() => {});
    const opened = await page.evaluate(() => {
      const p = document.querySelector('[data-wx="product-panel"]');
      const d = document.querySelector('.wx-drawer');
      if (!p || !d) return null;
      const pr = p.getBoundingClientRect(), dr = d.getBoundingClientRect();
      return {
        open: true,
        inside: pr.left >= dr.left - 1 && pr.right <= dr.right + 1,
        onScreen: pr.top >= 0 && pr.top < window.innerHeight,
        rows: document.querySelectorAll('[data-wx="product-list"] button').length,
        tiles: document.querySelectorAll('[data-wx="product-list"] button > span:first-child').length,
        /* A PICTURE IS NOT A PICTURE UNTIL THE BROWSER HAS ONE. Since
           2026-09-24 the products carry real image URLs from TikTok's CDN, and
           a CDN is entitled to refuse a hotlink — which would leave a broken
           tile on the screen while every count elsewhere still said "covered".
           `naturalWidth` is the only thing that knows the difference. */
        imgTotal: document.querySelectorAll('[data-wx="product-list"] button img').length,
        imgOk: [...document.querySelectorAll('[data-wx="product-list"] button img')]
          .filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    });
    check(!!opened?.open, `${z.label}: pressing it opens the list`);
    if (opened) {
      check(opened.inside && opened.onScreen, `${z.label}: and the list stays inside the drawer`, `inside ${opened.inside}, on screen ${opened.onScreen}`);
      check(opened.rows > 0 && opened.tiles === opened.rows, `${z.label}: every row carries a picture or its stand-in`, `${opened.tiles} of ${opened.rows}`);
      check(opened.imgTotal > 0 && opened.imgOk > 0,
        `${z.label}: real product photographs load, not just letter tiles`,
        `${opened.imgOk} of ${opened.imgTotal} images rendered`);
    }
    await page.locator('[data-wx="product-trigger"]').click();
    await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector('[data-wx="product-panel"]')),
      `${z.label}: pressing the arrow again closes it`);
    await page.locator('[data-wx="product-trigger"]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector('[data-wx="product-panel"]')),
      `${z.label}: and Escape closes it without closing the drawer`);
    check(await page.evaluate(() => !!document.querySelector('.wx-drawer')),
      `${z.label}: the drawer itself is still open after Escape`);

    check(errors.length === 0, `${z.label}: zero console errors`, errors.slice(0, 2).join(' | '));
    if (SHOTS && ['100%', '150%', 'phone'].includes(z.label)) {
      await page.screenshot({ path: `${SHOTS}/drawer-${z.label.replace('%', 'pc')}.png` });
    }
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
