#!/usr/bin/env node
/**
 * THE BY-PRODUCT BAND ON A BRAND'S PAGE.
 *
 *   pnpm build && pnpm preview
 *   node scripts/verify/brands/check-product-band.mjs
 *
 * Rashid, 2026-09-24: "is it possible to get the product wise gmv, product wise
 * creators and product wise videos ... a beautifully iconed and pilled style
 * display without disturbing the ui ... for the current month that user
 * selected".
 *
 * THE CHECK THAT MATTERS IS RECONCILIATION. A breakdown that does not add up to
 * the total directly above it is worse than no breakdown, because both numbers
 * look authoritative and only one can be right. The same TikTok video sits under
 * two deals of one creator 32 times in a single brand-month on dev, so a naive
 * per-product sum comes out HIGHER than the GMV card. This compares the pills'
 * GMV against that card's own `data-value`, as numbers.
 *
 * It also refuses to grade a brand that shows no pills at all — "0 pills, 0
 * discrepancy, everything reconciles" is the shape of lie this project keeps
 * catching.
 *
 * TWO MORE FIGURES SINCE 2026-10-07. Rashid: "the videos part must also show the
 * number of expected videos ... and i want the cards to show the summed up ad
 * spend as well in each card". Ad spend shares the GMV's scope, this product's
 * own videos, so it reconciles the same way. The expected-video commitment does
 * NOT: a commitment belongs to a creator's deal and names no product, so it is
 * attributed to every product that creator posted for and therefore overlaps,
 * exactly as the creator count beside it already does. That was the decision
 * rather than the accident, and the checks below assert the overlap scope
 * instead of a sum that was never meant to hold.
 */
import { launchBrowser, ensureAllTime } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
/* A brand with several products, and one with a single product, so a
   one-pill band cannot pass by accident. */
const BRANDS = (process.env.BAND_BRANDS || 'Penetrex,Apothecary,Biostime').split(',').map((s) => s.trim());

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
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

  const openBrand = async (brand) => {
    await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
    const back = page.locator('.pc-back');
    if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(2500); }
    await page.waitForSelector('.pc-bt-row', { timeout: 30000 }).catch(() => {});
    /* ALL TIME, CHOSEN ON THE LIST, BEFORE THE BRAND IS LOOKED FOR.
       The Brands screen lists the brands active in the SELECTED MONTH, and the
       page opens on the current one — so on 1 October this file reported "the
       band is not on the page" for brands that had simply not been worked yet
       that month, and a null GMV card for the same reason. Nothing it checks is
       about the calendar, so it asks about the whole history, where the shape
       of the data does not change under it. */
    await ensureAllTime(page);
    await page.waitForTimeout(800);
    const row = page.locator('.pc-bt-row')
      .filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${brand}\\s*$`) }) }).first();
    if (!(await row.count().catch(() => 0))) return false;
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    await page.waitForSelector('.pc-ct-row, .pc-empty', { timeout: 30000 });
    /* WAIT FOR A CARD, not for a pause. The table's first row appears before
       the month's creators have all landed, and on Penetrex — 259 of them —
       a fixed 1.8s read "the band is not on the page" when it simply had not
       been drawn yet. */
    await page.waitForSelector('[data-wx="product-pill"]', { timeout: 30000 }).catch(() => {});
    /* AND FOR THE CARD THE PILLS ARE COMPARED AGAINST. The band is drawn from
       rows the page already has; the Top videos block above it arrives later,
       and on All Time, with fifty-odd creators, later is after the 700ms this
       used to wait — which read as "the GMV card was not readable" on a brand
       whose card says $15,338. Waiting for the thing being compared is not the
       same as waiting a bit longer and hoping. */
    await page.waitForSelector('.pc-topvids-stat.gmv', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => {
      const c = document.querySelector('.pc-topvids-stat.gmv');
      return c && c.getAttribute('data-value') !== null;
    }, null, { timeout: 20000 }).catch(() => {});
    /* AND FOR THE AD FIGURES, which arrive last and by a different road.
       Ad spend is fetched per video id in batches of 500, so Penetrex's 2,270
       videos are five round trips — and at the 700ms this used to wait, every
       card still read "–". That passed, because a dash is a legal answer when a
       brand has no ad data, so the check was green while the figure it was
       meant to prove had simply not arrived. A guard that cannot tell "loading"
       from "nothing" would stay green if ad spend broke completely.

       A brand with genuinely no ad data never resolves this, which is why it
       falls through on a timeout rather than failing: the cross-check below is
       what decides, by comparing the band against the creator rows on the same
       screen at the same moment. */
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-wx="product-pill"]')]
        .some((p) => (p.getAttribute('data-adspend') || '') !== ''),
      null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(700);
    return true;
  };

  for (const brand of BRANDS) {
    if (!(await openBrand(brand))) { check(false, `${brand} is on the Brands screen`); continue; }

    const band = await page.evaluate(() => {
      const el = document.querySelector('[data-wx="product-band"]');
      if (!el) return null;
      const pills = [...document.querySelectorAll('[data-wx="product-pill"]')].map((p) => ({
        gmv: Number(p.getAttribute('data-gmv')),
        creators: Number(p.getAttribute('data-creators')),
        videos: Number(p.getAttribute('data-videos')),
        expected: Number(p.getAttribute('data-expected')),
        /* '' when no video of this product has ad data at all, which is a
           different answer from 0 and must not become one here. */
        adspend: p.getAttribute('data-adspend'),
        name: (p.querySelector('.wx-prodcard-name')?.textContent || '').trim(),
        /* Five labelled figures across the card: GMV, Views, Creators, Videos,
           Ad spend. */
        stats: p.querySelectorAll('.wx-prodcard-cell').length,
        rank: (p.querySelector('.wx-prodcard-rank')?.textContent || '').trim(),
        shot: !!p.querySelector('.wx-prodcard-shot'),
        /* Every figure must be a real value, not an empty cell. */
        values: [...p.querySelectorAll('.wx-prodcard-val')].map((v) => v.textContent.trim()),
      }));
      /* THE SAME FACT, READ OFF THE ROWS BELOW. If any creator row on this
         screen is priced, this brand HAS ad data, so the band must be priced
         too. Self-calibrating: no brand is hardcoded as "should have ad spend",
         which would rot the first time an ad account is connected or dropped. */
      const rowsPriced = [...document.querySelectorAll('.pc-cell.wx-collab-figure[data-label="Ad spend"]')]
        .some((c) => /\d/.test(c.textContent || ''));
      const card = document.querySelector('.pc-topvids-stat.gmv');
      const head = (el.querySelector('.wx-prodband-head')?.textContent || '').trim();
      return {
        pills,
        rowsPriced,
        cardGmv: card ? Number(card.getAttribute('data-value')) : null,
        head,
        rowScrollsInside: (() => {
          const r = el.querySelector('[data-wx="product-band-row"]');
          return r ? r.scrollWidth - r.clientWidth >= 0 && getComputedStyle(r).overflowX === 'auto' : false;
        })(),
        pageSideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    if (!band) { check(false, `${brand}: the by-product band is on the page`); continue; }

    /* THE GUARD. Everything below is vacuous without pills. */
    check(band.pills.length > 0, `${brand}: the band shows at least one product`, `${band.pills.length} pills`);
    if (!band.pills.length) continue;

    const sumGmv = band.pills.reduce((t, p) => t + p.gmv, 0);
    const sumVideos = band.pills.reduce((t, p) => t + p.videos, 0);
    check(band.cardGmv !== null, `${brand}: the GMV card above it was readable`, String(band.cardGmv));
    if (band.cardGmv !== null) {
      /* Rounding per pill against one rounded total: a dollar per product. */
      const slack = Math.max(2, band.pills.length);
      check(Math.abs(sumGmv - band.cardGmv) <= slack,
        `${brand}: the products' GMV adds up to the GMV card above them`,
        `pills $${sumGmv} vs card $${band.cardGmv}`);
    }
    check(band.pills.every((p) => Number.isFinite(p.gmv) && Number.isFinite(p.creators) && Number.isFinite(p.videos)),
      `${brand}: every pill carries all three figures`);
    check(band.pills.every((p) => p.creators > 0 && p.videos > 0),
      `${brand}: no pill claims zero creators or zero videos`,
      band.pills.map((p) => `${p.creators}c/${p.videos}v`).join(' '));
    check(band.pills.every((p) => p.videos >= p.creators),
      `${brand}: a product never has more creators than videos`,
      band.pills.map((p) => `${p.creators}c/${p.videos}v`).join(' '));
    check(band.pills.every((p) => p.name.length > 0), `${brand}: every card is named`);
    check(band.pills.every((p) => p.stats === 5),
      `${brand}: each card shows GMV, views, creators, videos and ad spend`,
      band.pills.map((p) => p.stats).join(','));
    check(band.pills.every((p) => p.shot), `${brand}: each card has its picture slot`);
    check(band.pills.every((p) => p.values.length === 5 && p.values.every(Boolean)),
      `${brand}: all five figures are filled in, none blank`,
      band.pills.map((p) => p.values.join('/')).join(' · '));

    /* ── the expected-video commitment, added 2026-10-07 ──────────────────
       THE SCOPE IS "EVERY CREATOR WHO POSTED FOR IT", settled with Rashid on
       2026-10-07, so these deliberately overlap and do NOT sum to the brand's
       own videos KPI — exactly as the creator counts already overlap. What
       must hold is that a product with creators has a commitment at all, and
       that the commitment is drawn where the delivered count is. */
    check(band.pills.every((p) => Number.isFinite(p.expected) && p.expected >= 0),
      `${brand}: every card carries an expected-video figure`,
      band.pills.map((p) => `${p.videos}/${p.expected}`).join(' '));
    check(band.pills.some((p) => p.expected > 0),
      `${brand}: at least one product has a real video commitment`,
      band.pills.map((p) => `${p.videos}/${p.expected}`).join(' '));
    /* The figure is only shown when it is real, so wherever it IS shown the
       card's text must actually carry the slash. */
    check(band.pills.every((p) => p.expected === 0 || /\d\s*\/\s*\d/.test(p.values.join(' '))),
      `${brand}: a card with a commitment draws it as "delivered / expected"`,
      band.pills.map((p) => p.values.join('|')).join(' · '));

    /* ── ad spend, added 2026-10-07 ───────────────────────────────────────
       SAME SCOPE AS THE GMV BESIDE IT: this product's own videos. A blank is
       the honest answer when no video of the product has ad data, and it must
       stay distinguishable from a real zero — so the attribute is '' rather
       than 0 and the cell prints a dash. */
    check(band.pills.every((p) => p.adspend === '' || Number.isFinite(Number(p.adspend))),
      `${brand}: ad spend is a number or an honest blank, never NaN`,
      band.pills.map((p) => String(p.adspend)).join(' '));
    check(band.pills.every((p) => p.adspend === '' || Number(p.adspend) >= 0),
      `${brand}: no card claims negative ad spend`,
      band.pills.map((p) => String(p.adspend)).join(' '));
    const priced = band.pills.filter((p) => p.adspend !== '');
    /* THE CHECK THAT MAKES THE OTHERS WORTH ANYTHING. A dash is only honest
       when there is nothing to show; if the rows below are priced and the band
       is not, the band is broken, not empty. */
    check(!band.rowsPriced || priced.length > 0,
      `${brand}: the band is priced wherever the creator rows below it are`,
      `rows priced: ${band.rowsPriced} · band priced: ${priced.length}/${band.pills.length}`);
    console.log(`  · ${brand}: ${priced.length}/${band.pills.length} products priced · rows priced: ${band.rowsPriced} · ad spend ${priced.map((p) => '$' + p.adspend).join(' ') || 'none'}`);
    /* The numeral is decoration that carries information — it must agree with
       the order, or it is just noise. */
    check(band.pills.every((p, i) => p.rank === `Product ${String(i + 1).padStart(2, '0')}`),
      `${brand}: the product number matches the card's position`, band.pills.map((p) => p.rank).join(' '));
    /* Sorted by GMV, biggest first. */
    const sorted = band.pills.every((p, i) => i === 0 || band.pills[i - 1].gmv >= p.gmv);
    check(sorted, `${brand}: the biggest earner is first`, band.pills.map((p) => p.gmv).join(' ≥ '));
    check(/product performance/i.test(band.head) && /\d{4}|all time/i.test(band.head),
      `${brand}: the heading names the section and the period on screen`, `"${band.head}"`);
    check(band.pageSideScroll <= 1, `${brand}: the band does not make the page scroll sideways`,
      `${band.pageSideScroll}px`);
    console.log(`  · ${brand}: ${band.pills.length} products · $${sumGmv} GMV · ${sumVideos} videos · card $${band.cardGmv}`);
  }

  /* ── every width, because this is a new row on a full screen ─────────── */
  for (const w of [375, 768, 1024, 1440]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p2 = await c2.newPage();
    await p2.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await p2.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
    await p2.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
    await p2.getByRole('button', { name: /^sign in$/i }).click();
    await p2.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi2 = p2.getByRole('button', { name: /let.s go/i });
    if (await hi2.first().isVisible().catch(() => false)) await hi2.first().click();
    await p2.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
    const b2 = p2.locator('.pc-back');
    if (await b2.first().isVisible().catch(() => false)) { await b2.first().click(); await p2.waitForTimeout(2500); }
    await ensureAllTime(p2);
    const row = p2.locator('.pc-bt-row').filter({ has: p2.locator('.pc-brandname', { hasText: /^\s*Penetrex\s*$/ }) }).first();
    if (!(await row.count().catch(() => 0))) { check(false, `${w}px: Penetrex row found`); await c2.close(); continue; }
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    await p2.waitForSelector('.pc-ct-row, .pc-empty', { timeout: 30000 });
    /* WAIT FOR THE BAND, not for a pause. The table's first row appears before
       the month's creators have all landed, and a fixed wait passed at two
       widths and failed at the other two — which read as a layout fault and was
       nothing but timing. */
    await p2.waitForSelector('[data-wx="product-pill"]', { timeout: 25000 }).catch(() => {});
    await p2.waitForTimeout(600);
    const m = await p2.evaluate(() => {
      const el = document.querySelector('[data-wx="product-band"]');
      const r = el?.querySelector('[data-wx="product-band-row"]');
      return {
        there: !!el,
        pills: document.querySelectorAll('[data-wx="product-pill"]').length,
        pageSideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        /* Nothing inside may be wider than the band itself. */
        spills: el ? [...el.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().width > el.getBoundingClientRect().width + 1).length : -1,
        rowOverflow: r ? getComputedStyle(r).overflowX : null,
      };
    });
    check(m.there && m.pills > 0, `${w}px: the band is there with its pills`, `${m.pills} pills`);
    check(m.pageSideScroll <= 1, `${w}px: no horizontal page scroll`, `${m.pageSideScroll}px`);
    check(m.spills === 0, `${w}px: nothing spills out of the band`, `${m.spills} wider than the band`);
    await c2.close();
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
