#!/usr/bin/env node
/**
 * The Ad Spend and ROI columns, on the actual screen.
 *
 * WHY THE DATA SUITE IS NOT ENOUGH. `verify:collab-ads` proves the arithmetic
 * and the RPC. It cannot prove the two columns REACH a rendered page, and this
 * is the one place in the product where that is a live risk: the columns live
 * inside a 15,000 line vendored file, and our stylesheet has to beat theirs by
 * specificity rather than by order. The documented symptom of getting that
 * wrong is a rule that is provably in the built CSS and has no effect at all.
 *
 * It also signs in as a REAL admin through the real form, because that is the
 * only role that can open Paid Collabs, and plants THEIR session as a viewer so
 * a run of this file cannot write a row to their database.
 *
 * Makes its own admin and deletes it in a `finally`. Dev only.
 *
 * Needs a server:
 *   pnpm build; pnpm preview        (in another shell)
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-collab-ads-ui.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

assertDevProject(env.VITE_SUPABASE_URL, 'check-collab-ads-ui.mjs');
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');
const BASE = process.env.BASE_URL || 'http://localhost:4173';

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (l) => { console.log(`  PASS  ${l}`); pass++; };
const bad = (l, d) => { console.error(`  FAIL  ${l}${d ? `\n        ${d}` : ''}`); fail++; };

const stamp = Date.now();
const ME = { email: `collab-ui-${stamp}@wurx.test`, password: 'CollabUI!2026' };

mkdirSync('shots/collab-ads', { recursive: true });

let browser;
try {
  const { data, error } = await admin.auth.admin.createUser({
    email: ME.email, password: ME.password, email_confirm: true,
  });
  if (error) throw error;
  ME.id = data.user.id;
  await admin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', ME.id);

  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  /*
   * THEIR SESSION IS PLANTED AS A VIEWER, before any script on the page runs.
   * It gets us past their hardcoded login screen as somebody who cannot change
   * anything, so this file physically cannot write to their database.
   */
  await ctx.addInitScript(() => {
    sessionStorage.setItem(
      'ch_user',
      JSON.stringify({ id: 'lead', username: 'Lead', role: 'viewer', display: 'Lead' })
    );
  });

  const page = await ctx.newPage();
  /*
   * EVERY CALL TO OUR RPC IS COUNTED, because "does this hammer the database"
   * deserves a number rather than an assurance. One request per creator row
   * would be dozens per brand; the provider batches instead, and this is what
   * proves it still does.
   */
  const rpcCalls = [];
  page.on('request', (r) => {
    /* The reader is Euka's since 2026-09-15 (`euka_ad_totals_for_videos`);
       the old name is kept so a run against an older build still counts. */
    if (!/euka_ad_totals_for_videos|\/rpc\/ads_totals_for_videos/.test(r.url())) return;
    let ids = 0;
    try {
      ids = (JSON.parse(r.postData() || '{}').p_item_ids || []).length;
    } catch {
      /* an unparseable body still counts as a request */
    }
    rpcCalls.push({ ids });
  });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', ME.email);
  await page.fill('input[name="password"]', ME.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  /*
   * WAIT FOR THE URL TO STOP BEING THE LOGIN PAGE.
   *
   * The first version waited on a glob of double-star, slash, admin,
   * double-star. That pattern matches the login URL itself, so it resolved
   * instantly while the run was still sitting on the sign-in form. The run
   * then navigated to Paid Collabs, got bounced straight back to login, and
   * reported the two columns missing: a suite failing a perfectly good
   * feature because its own wait was satisfied by the very page it was
   * waiting to leave.
   */
  const onLogin = (u) => /\/admin\/login/.test(String(u));
  await page.waitForURL((u) => !onLogin(u), { timeout: 30_000 }).catch(() => {});
  if (onLogin(page.url())) {
    bad('sign-in never left the login page — everything below would be vacuous');
  }
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();


  /*
   * WAITING ON A PAID COLLABS SCREEN. Never `networkidle`. It never settles on a
   * screen holding a realtime socket, and since the Euka endpoint was restored
   * these routes also fire ten proxy calls that take seconds each upstream — so a
   * perfectly healthy page blows the 30 second navigation limit. Navigate with
   * `domcontentloaded` and wait for the CONTENT you need.
   */
  await page.goto(`${BASE}/admin/collabs`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  /*
   * THE COLUMNS ARE TWO LEVELS IN, AND NOTHING HERE IS A <table>.
   *
   * Paid Collabs opens on a list of BRANDS. Their creators are behind a click,
   * and each creator's videos behind another. Every one of these lists is a
   * CSS grid of divs with their own class names, so a selector written for a
   * table matches nothing and the run reports the columns missing from a
   * screen that was never going to show them. Two earlier versions of this
   * file did exactly that.
   *
   *   .pc-bt-row   one brand
   *   .pc-ct-head  the creators list header, inside a brand
   *   .pc-ct-row   one creator
   *   .pc-vxp-head the per-video table, inside an expanded creator
   */
  console.log('\n[1] Into a brand, where the creators list lives');
  {
    const brand = page.locator('.wurxbase-root .pc-bt-row').first();
    if (await brand.count()) {
      await brand.click();
      await page.waitForTimeout(2500);
      ok('opened a brand from the brands list');
    } else {
      bad('no brand rows found — nothing below can be checked');
    }

    const head = page.locator('.wurxbase-root .pc-ct-head').first();
    if (await head.count()) ok('the brand’s creators list rendered');
    else bad('the creators list did not render; the column checks would be vacuous');
  }

  console.log('\n[2] The two columns are on the creators list');
  {
    const head = page.locator('.wurxbase-root .pc-ct-head').first();
    const text = (await head.count()) ? (await head.innerText()).replace(/\s+/g, ' ') : '';

    if (/Ad spend/i.test(text)) ok('an "Ad spend" header is on the creators list');
    else bad('no "Ad spend" header on the creators list', text.slice(0, 250));

    if (/\bROI\b/i.test(text)) ok('an "ROI" header is on the creators list');
    else bad('no "ROI" header on the creators list', text.slice(0, 250));

    /*
     * THE HEADER AND THE ROW MUST HAVE THE SAME NUMBER OF CELLS. Adding a
     * header without adding a cell shifts every later column by one, which
     * looks like a styling wobble and is actually a creator's contract status
     * appearing under "Actions".
     */
    const head1 = await head.evaluate((el) => el.children.length).catch(() => -1);
    const row1 = await page
      .locator('.wurxbase-root .pc-ct-row').first()
      .evaluate((el) => el.children.length)
      .catch(() => -2);
    if (head1 > 0 && head1 === row1) ok(`header and row agree at ${head1} columns`);
    else bad(`column counts disagree: header ${head1}, row ${row1}`);
  }

  console.log('\n[3] Our CSS won the cascade, rather than merely shipping');
  {
    /*
     * Their stylesheet is injected after ours from the lazily loaded vendor
     * chunk, so a rule written `.wurxbase-root .x` ties on specificity and
     * loses. Reading the COMPUTED style is what makes this a real check: it
     * fails if the rule lost, even though it is in the bundle.
     */
    const figure = page.locator('.wurxbase-root .wx-collab-figure').first();
    if (await figure.count()) {
      const variant = await figure.evaluate((el) => getComputedStyle(el).fontVariantNumeric);
      if (/tabular-nums/.test(variant)) ok('the figure cells compute tabular-nums, so our rule won');
      else bad(`our rule did not apply: font-variant-numeric is "${variant}"`);

      const cols = await page
        .locator('.wurxbase-root .pc-ct-head').first()
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      if (cols === 14) ok('the creators grid has 14 tracks, matching the 14 cells');
      else bad(`the grid has ${cols} tracks but the row has 14 cells — columns will be off by one`);
    } else {
      bad('no .wx-collab-figure cell rendered, so the CSS assertion would be vacuous');
    }
  }

  await page.screenshot({ path: 'shots/collab-ads/creators-1440.png', fullPage: false });

  console.log('\n[4] The per-video figures, in BOTH layouts');
  {
    /*
     * THERE ARE TWO LAYOUTS AND EITHER MAY APPEAR.
     *
     * A brand synced with EUKA gets a table (.pc-vxp-table); every other brand
     * gets cards (.pc-vxm-grid). The first version of this check only knew
     * about the table, so it reported the figures missing when the screen had
     * simply chosen the other layout — and the feature genuinely WAS missing
     * from the cards, which is how that got found. A feature that works on
     * some brands and silently does nothing on the rest is worse than one that
     * is obviously absent.
     */
    let opened = false;
    const creators = page.locator('.wurxbase-root .pc-ct-row');
    const n = Math.min(await creators.count(), 6);
    for (let i = 0; i < n; i++) {
      await creators.nth(i).click();
      await page.waitForTimeout(1600);
      if (await page.locator('.wurxbase-root .pc-vxp-head, .wurxbase-root .pc-vxm-card').count()) {
        opened = true;
        break;
      }
      await creators.nth(i).click();
      await page.waitForTimeout(400);
    }

    if (!opened) {
      bad('no creator in this brand has any videos, so the per-video figures are unverified');
    } else {
      const table = page.locator('.wurxbase-root .pc-vxp-head').first();
      const cards = page.locator('.wurxbase-root .wx-collab-vm-figures').first();

      if (await table.count()) {
        const t = (await table.innerText()).replace(/\s+/g, ' ');
        if (/Ad spend/i.test(t) && /\bROI\b/i.test(t)) ok('TABLE layout: both headers present');
        else bad('TABLE layout: headers missing', t.slice(0, 200));

        const vh = await table.evaluate((el) => el.children.length);
        const vr = await page
          .locator('.wurxbase-root .pc-vxp-row').first()
          .evaluate((el) => el.children.length).catch(() => -2);
        if (vh > 0 && vh === vr) ok(`TABLE layout: header and row agree at ${vh} columns`);
        else bad(`TABLE layout: column counts disagree, header ${vh} row ${vr}`);

        const cols = await table.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        if (cols === 8) ok('TABLE layout: 8 grid tracks against 8 cells');
        else bad(`TABLE layout: ${cols} grid tracks against 8 cells`);
      } else if (await cards.count()) {
        const t = (await cards.innerText()).replace(/\s+/g, ' ');
        if (/Ad spend/i.test(t) && /\bROI\b/i.test(t)) ok(`CARD layout: both figures present ("${t.trim()}")`);
        else bad('CARD layout: a figure is missing', t.slice(0, 200));
      } else {
        bad('a videos panel opened but carried neither layout’s figures');
      }
      await page.screenshot({ path: 'shots/collab-ads/videos-1440.png', fullPage: false });
    }
  }

  console.log('\n[5] The figures follow the month selector');
  {
    /*
     * THE BUG THIS SECTION EXISTS FOR. These two columns first summed every day
     * a video ever ran, and sat in a row whose budget and GMV were one month's.
     * Rashid caught it while testing: a lifetime figure beside a monthly one
     * invites a comparison that is not valid.
     */
    const spendCells = () => page.locator('.wurxbase-root .pc-cell[data-label="Ad spend"]');

    const read = async () => {
      const c = spendCells();
      const n = await c.count();
      const out = [];
      for (let i = 0; i < n; i++) out.push((await c.nth(i).innerText()).trim());
      return out;
    };

    /*
     * WAIT FOR A FIGURE, DO NOT ASSUME ONE. The ad figures arrive from an RPC
     * that fires after the table paints, and on 2026-08-31 this read ran first
     * and reported "no creator shows a figure" against a brand that had
     * fifteen — a false failure that cost a real investigation. Poll for the
     * first real value, then read them all.
     */
    await page
      .waitForFunction(() => {
        const cells = document.querySelectorAll('.wurxbase-root .pc-cell[data-label="Ad spend"]');
        return [...cells].some((c) => { const t = c.textContent.trim(); return t && t !== '-' && t !== '–'; });
      }, { timeout: 45000 })
      .catch(() => {});

    const before = await read();
    const realBefore = before.filter((t) => t && t !== '-' && t !== '–');
    if (realBefore.length === 0) {
      bad('no creator in this brand shows a figure, so the month check would be vacuous');
    } else {
      ok(`${realBefore.length} of ${before.length} creators show a figure this month`);

      const callsBefore = rpcCalls.length;

      /* "All Time" removes the bounds. If the wiring does nothing, the numbers
         are identical and this fails, which is the point. */
      const allTime = page.getByRole('button', { name: /^all time$/i }).first();
      if (await allTime.count()) {
        await allTime.click();
        await page.waitForTimeout(3000);

        const after = await read();
        const realAfter = after.filter((t) => t && t !== '-' && t !== '–');

        if (realAfter.length === 0) {
          bad('All Time wiped every figure, which is not a wider range');
        } else if (JSON.stringify(before) !== JSON.stringify(after)) {
          ok('All Time changes the figures, so the month bounds are really applied');
        } else {
          bad('All Time produced identical figures — the month is being ignored');
        }

        /*
         * MEASURED AGAINST THE IDS, NOT A FLAT CEILING.
         *
         * "All Time" also un-filters the creator LIST, so the brand goes from
         * 41 creators to a few hundred and the id count grows with it. A fixed
         * ceiling failed a correctly batched run for that reason. What actually
         * matters is that the ids are sent in big batches rather than one
         * request per row, so that is what is asserted.
         */
        const fresh = rpcCalls.slice(callsBefore);
        const spent = fresh.length;
        const idsSent = fresh.reduce((n, c) => n + c.ids, 0);
        const expected = Math.max(1, Math.ceil(idsSent / 500));
        if (spent >= 1 && spent <= expected + 1) {
          ok(`switching period cost ${spent} request(s) for ${idsSent} videos (${expected} batch(es) of 500)`);
        } else {
          bad(`switching period cost ${spent} requests for ${idsSent} videos, expected about ${expected}`);
        }
      } else {
        bad('could not find the All Time button, so the month wiring is unverified');
      }
    }
  }

  console.log('\n[6] Requests are batched, not one per row');
  {
    /*
     * THE MEASURE IS IDS PER REQUEST, which is the thing that would collapse if
     * the batching broke. One request per creator row would average a handful
     * of ids each; real batching averages hundreds. A flat count cannot tell
     * those apart once the row count changes underneath it.
     */
    const rows = await page.locator('.wurxbase-root .pc-ct-row').count();
    const idsTotal = rpcCalls.reduce((n, c) => n + c.ids, 0);
    const perCall = rpcCalls.length ? idsTotal / rpcCalls.length : 0;

    if (rpcCalls.length === 0) {
      bad('no RPC calls at all, so the batching claim would be vacuous');
    } else if (perCall >= 100) {
      ok(`${rpcCalls.length} call(s) carried ${idsTotal} video ids, ${Math.round(perCall)} per call`);
    } else {
      bad(`only ${Math.round(perCall)} ids per call across ${rpcCalls.length} calls — batching is not holding`);
    }

    if (rpcCalls.length < rows) ok(`fewer requests (${rpcCalls.length}) than creator rows (${rows})`);
    else bad(`${rpcCalls.length} requests for ${rows} rows — that is per-row fetching`);
  }

  console.log('\n[7] No sideways scroll, no console errors');
  {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    if (!overflow) ok('the page does not scroll sideways at 1440');
    else bad('the page scrolls sideways at 1440');

    /*
     * THEIR ERRORS ARE NAMED RATHER THAN SWEPT. This run plants their session
     * as a VIEWER on purpose, so it cannot write to their database. Their app
     * then tries to save its own settings and is refused, which is the safety
     * measure working. Each pattern is listed so this filter cannot quietly
     * grow to cover a real error of ours.
     */
    const THEIRS = /favicon|tiktokcdn|app_settings|scheduleSettingsSave|status of (401|403|406)/i;
    const ours = consoleErrors.filter((e) => !THEIRS.test(e));
    if (ours.length === 0) ok('no console errors of ours');
    else bad(`${ours.length} console error(s)`, ours.slice(0, 3).join(' | '));
  }

} finally {
  if (browser) await browser.close();
  if (ME.id) await admin.auth.admin.deleteUser(ME.id);
  console.log('\n[cleanup] the throwaway admin is gone');
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed.  Shot in shots/collab-ads/\n`);
  process.exit(1);
}
console.log(`${pass} checks passed.  Shot in shots/collab-ads/\n`);
