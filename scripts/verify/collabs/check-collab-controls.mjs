#!/usr/bin/env node
/**
 * Every control in a creator row actually receives its own click.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... COLLAB_STAFF_PASSWORD=... node scripts/verify/collabs/check-collab-controls.mjs
 *
 * WHY THIS EXISTS. Three separate bug reports — "the status pill floats",
 * "clicking Payment Pending shows no dropdown", "the eye icon does nothing" —
 * turned out to be two defects that no existing check could see, because every
 * one of our guards asked whether an element EXISTS.
 *
 *   1. A starved grid track. A `.pc-cell` centres its content and does not
 *      clip, so a column narrower than what is in it SPILLS into its
 *      neighbours. The contract pencil is `position: relative` and the status
 *      pill is static, so the pencil painted on top and swallowed the click.
 *      Both elements were present, visible and correctly styled the whole time.
 *
 *   2. Ten overlays portalled to `document.body`, which is outside
 *      `.wurxbase-root`, so every fenced rule in their stylesheet missed them.
 *      The status menu mounted as an unstyled full-width block at the bottom of
 *      the document. It existed, it was in the DOM, and it was 1,008px below
 *      the fold.
 *
 * So this asserts on HIT TESTING and on POSITION, which is what "does nothing"
 * actually means. `elementFromPoint` at a control's centre must return that
 * control, and an opened overlay must be inside the viewport.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');
const PASSWORD = process.env.COLLAB_STAFF_PASSWORD;
if (!PASSWORD) throw new Error('COLLAB_STAFF_PASSWORD must be set');
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

let browser;
try {
  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

  /* Never networkidle on a collabs route — see OPERATIONS. */
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-ava', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(12000);

  /* The portal host exists and sits where it must: inside the styling fence,
     outside the scrolling one. Everything below depends on it. */
  const host = await page.evaluate(() => {
    const h = document.getElementById('wurxbase-portal-host');
    if (!h) return null;
    return {
      inRoot: Boolean(h.closest('.wurxbase-root')),
      inFence: Boolean(h.closest('.wurxbase-fence')),
    };
  });
  check(Boolean(host), 'the portal host is on the page');
  check(host?.inRoot === true, 'it is INSIDE .wurxbase-root, so their CSS reaches it');
  check(host?.inFence === false, 'and OUTSIDE .wurxbase-fence, so fixed means the screen');

  /* Into a brand. */
  const brand = page.locator('.pc-ava').first();
  await brand.click();
  await page.waitForSelector('.pc-ct-row', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(9000);

  const rows = await page.locator('.pc-ct-row').count();
  check(rows > 0, 'the creator table rendered', `${rows} row(s)`);
  if (!rows) throw new Error('no creator rows — nothing below would mean anything');

  /*
   * EVERY CONTROL GETS ITS OWN CLICKS. Measured across the width of each
   * control, not just at the centre: the reported bug was a dead BAND down one
   * side of the pill, which a centre-only probe would have passed.
   */
  for (const width of [1500, 1280, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(1500);

    const report = await page.evaluate(() => {
      const row = document.querySelector('.pc-ct-row');
      if (!row) return null;
      /*
       * SCROLL THE ROW INTO VIEW FIRST, AND SAY SO WHEN A POINT IS EMPTY.
       *
       * `document.elementFromPoint` returns null for anything outside the
       * viewport, and this probe used to count a null as "a neighbour is on top
       * of it". The first row sits lower than it used to — the by-product band
       * above the table, then the product group header — so at 1280 and 1024 it
       * was already below a 1000px fold, and this file reported three controls
       * as unclickable that were perfectly clickable once you scrolled to them.
       * Six false failures, standing, describing a bug that does not exist.
       *
       * The distinction is kept rather than papered over: `offscreen` counts the
       * points that had NOTHING at them, `own` counts the ones that were this
       * control's, and a point owned by something else is still a real overlap.
       * A probe that could not sample anything is a FAILURE to probe, not a
       * pass — see the checks below.
       */
      row.scrollIntoView({ block: 'center' });
      const probe = (el, label) => {
        if (!el) return { label, present: false };
        const r = el.getBoundingClientRect();
        if (!r.width) return { label, present: true, zero: true };
        const y = r.top + r.height / 2;
        let mine = 0, empty = 0, total = 0;
        for (let x = r.left + 2; x < r.right - 2; x += 3) {
          total++;
          const hit = document.elementFromPoint(x, y);
          if (!hit) empty++;
          else if (hit === el || el.contains(hit)) mine++;
        }
        const sampled = total - empty;
        return {
          label,
          present: true,
          /* Of the points that could be sampled at all. */
          own: sampled ? Math.round((mine / sampled) * 100) : 0,
          sampled,
          offscreen: empty,
          w: Math.round(r.width),
        };
      };
      return [
        probe(row.querySelector('.pc-badge-btn'), 'status pill'),
        probe(row.querySelector('.pc-contract-btn'), 'contract pencil'),
        probe(row.querySelector('.pc-rowactions .pc-actbtn'), 'eye button'),
      ];
    });

    for (const c of report || []) {
      if (!c.present) { check(false, `${width}px: ${c.label} is missing`); continue; }
      /* A probe that sampled nothing proves nothing. Say that, rather than
         letting a 0-of-0 be read as either a pass or an overlap. */
      check(c.sampled > 0, `${width}px: the ${c.label} could be probed at all`,
        `${c.sampled} points on screen, ${c.offscreen} off it`);
      if (!c.sampled) continue;
      check(
        c.own >= 92,
        `${width}px: the ${c.label} receives its own clicks`,
        `${c.own}% of its ${c.w}px width — the rest is a neighbour on top of it`,
      );
    }
  }

  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.waitForTimeout(1200);

  /* The status menu opens ON SCREEN and offers the option Asad needs.
     Scrolled to first, for the same reason as the probe above: the row sits
     below a 1000px fold now that the product band and its group header are
     above it, and "the status menu opens" was failing because the click never
     landed, not because the menu is broken. */
  await page.locator('.pc-ct-row .pc-badge-btn').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.pc-ct-row .pc-badge-btn').first().click();
  await page.waitForTimeout(1200);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.pc-statusmenu');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    return {
      position: cs.position,
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
      rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      options: [...m.querySelectorAll('.pc-statusopt')].map((b) => b.textContent.trim()),
      clickable: [...m.querySelectorAll('.pc-statusopt')].every((b) => {
        const br = b.getBoundingClientRect();
        const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        return hit && (hit === b || b.contains(hit));
      }),
    };
  });
  check(Boolean(menu), 'the status menu opens');
  check(menu?.position === 'fixed', 'it is styled — their fenced CSS reaches it now', `position: ${menu?.position}`);
  check(menu?.onScreen === true, 'it opens ON SCREEN', menu?.rect);
  check(
    (menu?.options || []).some((o) => /payment sent/i.test(o)),
    'and offers "Payment Sent", which is how a creator gets marked paid',
    (menu?.options || []).join(' | '),
  );
  check(menu?.clickable === true, 'every option in it can actually be clicked');

  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(5, 5);
  await page.waitForTimeout(800);

  /* The eye opens its panel on screen rather than below the fold. */
  await page.locator('.pc-ct-row .pc-rowactions .pc-actbtn').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.pc-ct-row .pc-rowactions .pc-actbtn').first().click();
  await page.waitForTimeout(2500);
  const modal = await page.evaluate(() => {
    const m = document.querySelector('.pc-vx-modal, .pc-overlay');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { onScreen: r.top < window.innerHeight && r.bottom > 0 && r.width > 0, rect: `${Math.round(r.top)}..${Math.round(r.bottom)} of ${window.innerHeight}` };
  });
  check(Boolean(modal), 'the eye button opens its videos panel');
  check(modal?.onScreen === true, 'and it opens where you can see it', modal?.rect);


  /* ═══════════════════════════ THE PERFORMANCE SHEET ═══════════════════════
   * Rashid, 2026-09-01: *"numbers are not even properly visible"*. He was
   * right and it was measurable the whole time — a month column gave each
   * figure 53px of room for a value that needs 61, so every five-figure GMV
   * was cut mid-digit and printed as a SMALLER NUMBER THAN IT IS. Nothing
   * threw, nothing looked broken, and no guard could see it: they all asked
   * whether an element exists.
   *
   * A number that does not fit its box is the failure. Assert on that.
   * ══════════════════════════════════════════════════════════════════════ */
  for (const w of [1500, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.goto(`${BASE}/admin/collabs/performance`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pc-ava', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(9000);
    await page.locator('.pc-ava').first().click({ timeout: 20000 }).catch(() => {});
    const opened = await page.waitForSelector('.pc-mx-row', { timeout: 45000 }).catch(() => null);
    await page.mouse.move(4, 4);
    await page.waitForTimeout(6000);
    if (!opened) { check(false, `${w}px: the performance sheet never opened, so nothing below it was checked`); continue; }

    const sheet = await page.evaluate(() => {
      const wrap = document.querySelector('.pc-matrix-wrap');
      const mx = document.querySelector('.pc-mx');
      if (!wrap || !mx) return null;
      const clipped = [];
      let filled = 0;
      mx.querySelectorAll('.pc-mx-input').forEach((i) => {
        if (!i.value) return;
        filled += 1;
        if (i.scrollWidth > i.clientWidth + 1) clipped.push(`${i.value} needs ${i.scrollWidth} in ${i.clientWidth}`);
      });
      /*
       * THE ROOM A CELL HAS, AGAINST A NUMBER THIS BRAND HAS NOT REACHED YET.
       *
       * Measuring only the values that happen to be on screen is how the first
       * version of this check passed at the broken width: whichever brand loads
       * first has nothing bigger than 13,888.24, so it fitted, and the guard
       * reported green on the exact geometry Rashid photographed as broken.
       * Today's data is not the invariant — the cell has to hold a six-figure
       * month, because one good creator on one good month IS six figures on
       * TikTok Shop and nobody should have to notice the day it stops fitting.
       */
      const REFERENCE = '123,456.78';
      const one = mx.querySelector('.pc-mx-month-pair .pc-mx-input');
      let widest = 0, reference = 0, widestValue = '';
      if (one) {
        const cs = getComputedStyle(one);
        const probe = document.createElement('span');
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily};letter-spacing:${cs.letterSpacing};font-variant-numeric:${cs.fontVariantNumeric};`;
        document.body.appendChild(probe);
        mx.querySelectorAll('.pc-mx-input').forEach((i) => {
          if (!i.value) return;
          probe.textContent = i.value;
          const px = probe.getBoundingClientRect().width;
          if (px > widest) { widest = px; widestValue = i.value; }
        });
        probe.textContent = REFERENCE;
        reference = probe.getBoundingClientRect().width;
        probe.remove();
      }
      /* every summary cell receives its own clicks · a sticky experiment here
         once painted the totals straight over live figures */
      const overlapped = [];
      mx.querySelectorAll('.mx-sum').forEach((c) => {
        const r = c.getBoundingClientRect();
        if (r.width < 4 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit !== c && !c.contains(hit)) overlapped.push(c.className);
      });
      /* what is on screen when the sheet opens */
      const tiles = [...mx.querySelectorAll('.pc-mx-head .pc-mxh-tile:not(.mx-sum)')];
      const last = tiles[tiles.length - 1];
      const wr = wrap.getBoundingClientRect();
      const lastMonthVisible = last ? last.getBoundingClientRect().right <= wr.right + 2 && last.getBoundingClientRect().right > wr.left : false;
      return {
        filled,
        clipped: clipped.slice(0, 5),
        clippedCount: clipped.length,
        widest: Math.round(widest),
        widestValue,
        reference: Math.round(reference),
        room: one ? Math.round(one.clientWidth - parseFloat(getComputedStyle(one).paddingLeft) - parseFloat(getComputedStyle(one).paddingRight)) : 0,
        overlapped,
        lastMonthVisible,
        scrollable: wrap.scrollWidth > wrap.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    if (!sheet) { check(false, `${w}px: the sheet rendered no matrix`); continue; }
    check(sheet.filled > 200, `${w}px: the sheet has figures in it to check`, `${sheet.filled} filled cells`);
    check(sheet.clippedCount === 0, `${w}px: not one figure is cut off by its cell`, sheet.clipped.join(' | '));
    check(sheet.widest > 0 && sheet.room >= sheet.widest,
      `${w}px: a cell has room for the widest figure on this brand's sheet`,
      `${sheet.widestValue} is ${sheet.widest}px, room ${sheet.room}px`);
    check(sheet.reference > 0 && sheet.room >= sheet.reference,
      `${w}px: and for a six-figure month, which is what it has to survive`,
      `123,456.78 needs ${sheet.reference}px, room is ${sheet.room}px`);
    check(sheet.overlapped.length === 0, `${w}px: every total column receives its own clicks`, sheet.overlapped.slice(0, 3).join(' | '));
    check(sheet.scrollable === true, `${w}px: the months scroll sideways inside the sheet`);
    check(sheet.pageOverflow === 0, `${w}px: and the PAGE does not scroll sideways`, `${sheet.pageOverflow}px`);
    check(sheet.lastMonthVisible === true,
      `${w}px: it opens on the newest month, not ten months of empty cells`);
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'shots/collab-controls.png' });
} finally {
  if (browser) await browser.close();
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
