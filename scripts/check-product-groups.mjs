#!/usr/bin/env node
/**
 * A BRAND'S CREATORS, GROUPED BY PRODUCT.
 *
 *   pnpm build && pnpm preview
 *   node scripts/check-product-groups.mjs
 *
 * Rashid, 2026-09-29, with a mockup: "we are showing creators of the brand when
 * we open a particular brand ... we also have products and we can see. Now what
 * i want is to organize and show product wise creators".
 *
 * THE ONE THING THAT CAN GO SILENTLY WRONG HERE IS MONEY SHOWN TWICE. Every row
 * of that table carries per-creator figures — the deal, total views, new-video
 * GMV, L30 GMV, ad spend, ROI. Ten of Penetrex's thirty-four September creators
 * posted for more than one product, so a table that lists a creator under each
 * of their products shows those ten people's money two and three times over,
 * and every total a human adds up off the screen comes out wrong. The whole
 * point of these groups is that they PARTITION the list: this file proves it,
 * by name, rather than trusting that they do.
 *
 * IT ALSO REFUSES TO GRADE A BRAND THAT SHOWS NO GROUPS. "0 groups, 0 duplicate
 * creators, everything partitions" is the exact shape of lie this project keeps
 * catching, so the guard comes before every assertion that depends on it — and
 * a brand with no product data at all is checked the other way round, that it
 * kept its flat table and grew no empty band.
 */
import { launchBrowser, ensureAllTime } from './browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
/* Penetrex is the hard case on dev: seven products in September and ten
   creators who straddle them. Dr Tobias is the easy one, two products and no
   straddlers, so a pass on Penetrex alone cannot be luck. */
const GROUPED = (process.env.PG_BRANDS || 'Penetrex,Dr Tobias').split(',').map((s) => s.trim());
/* A brand whose videos carry no product at all. It must keep the flat list it
   has today rather than grow a single "No product recorded" band around
   everything, which would be furniture, not information. Of the eleven brands
   the Brands screen actually lists for September 2026, exactly two are like
   this — Pure Daily Care and Aqua Sonic, both on Cruva, whose catalogue we
   cannot read. Naming a brand with no rows in the month on screen is how this
   check first "passed" a brand it never opened. */
const FLAT = process.env.PG_FLAT_BRAND || 'Pure Daily Care';

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/* What the screen is showing, read once per brand. Everything the assertions
   need comes out of this single evaluate so the DOM cannot change underneath
   two halves of one comparison. */
const READ = () => {
  const text = (el, sel) => (el?.querySelector(sel)?.textContent || '').trim();
  const groups = [...document.querySelectorAll('[data-wx="product-group"]')].map((g) => ({
    product: g.getAttribute('data-product') || '',
    count: Number(g.getAttribute('data-count')),
    shut: g.className.includes('is-shut'),
    name: text(g, '.wx-pgroup-name'),
    countLabel: text(g, '.wx-pgroup-count'),
    hasShot: !!g.querySelector('.wx-pgroup-shot'),
    hasKebab: !!g.querySelector('.wx-pgroup-kebab'),
    expanded: g.querySelector('.wx-pgroup-toggle')?.getAttribute('aria-expanded'),
    /* The rows actually painted under this band, right now. */
    rows: [...g.querySelectorAll('.wx-prow')].map((r) => ({
      idx: (r.querySelector('.pc-idx')?.textContent || '').trim(),
      /* THE ROW ID, not the person's name. Over a brand's whole history one
         person is legitimately several rows — hired in January, hired again in
         July — and keying on the name read 272 rows / 156 people as a
         duplication bug when nothing was duplicated. A row is the thing that
         must not appear twice, because a row is what carries the money. */
      who: (r.querySelector('.pc-ct-row')?.getAttribute('data-wx-id') || '').trim()
        || (r.querySelector('.pc-cname')?.textContent || '').trim(),
    })),
  }));
  const pills = [...document.querySelectorAll('[data-wx="product-pill"]')].map((p) => ({
    creators: Number(p.getAttribute('data-creators')),
    gmv: Number(p.getAttribute('data-gmv')),
  }));
  return {
    groups,
    pills,
    /* Every row on screen, grouped or not. */
    allRows: document.querySelectorAll('.pc-ct-row').length,
    allIdx: [...document.querySelectorAll('.pc-idx')].map((e) => e.textContent.trim()),
    /* The pill beside the search box: how many creators this brand has in the
       month on screen. The groups must add up to exactly this. */
    headCount: (() => {
      const m = (document.body.innerText || '').match(/(\d+)\s+creators?(?!\s+in)/);
      return m ? Number(m[1]) : null;
    })(),
    statusBands: document.querySelectorAll('.pc-ct-divider').length,
    /* The product names under each payment-status divider, in the order they
       are painted. Read by walking the card's own children rather than by
       nesting, because the dividers are siblings of the bands, not parents. */
    sections: (() => {
      const card = document.querySelector('.pc-card');
      if (!card) return [];
      const out = [];
      [...card.children].forEach((el) => {
        if (el.classList.contains('pc-ct-divider')) out.push([]);
        if (el.matches('[data-wx="product-group"]')) {
          if (!out.length) out.push([]);
          out[out.length - 1].push(el.getAttribute('data-product') || '');
        }
      });
      return out.filter((sec) => sec.length > 0);
    })(),
    pageSideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    /* Nothing inside a band may be wider than the card it sits in. */
    spills: (() => {
      const card = document.querySelector('.pc-card');
      if (!card) return -1;
      const w = card.getBoundingClientRect().width + 1;
      return [...document.querySelectorAll('[data-wx="product-group"] *')]
        .filter((x) => x.getBoundingClientRect().width > w).length;
    })(),
    /*
     * THE GROUPING MUST COST THE ROW NO WIDTH. This is here because it shipped
     * wrong once: indenting grouped rows and insetting the section took 46px
     * off a twelve-column grid with none to spare, the 151px status pill
     * overflowed its cell, and the cell after it covered the pill, the contract
     * pencil and the eye button. Nothing looked broken — the row was simply
     * dead to the mouse, which is the failure this screen keeps producing.
     * So: a grouped row is exactly as wide as the card it sits in.
     */
    rowWidth: (() => {
      const card = document.querySelector('.pc-card');
      const row = document.querySelector('[data-wx="product-group"] .pc-ct-row');
      if (!card || !row) return null;
      return {
        card: Math.round(card.getBoundingClientRect().width),
        row: Math.round(row.getBoundingClientRect().width),
      };
    })(),
    /*
     * And the controls in a grouped row still receive their own clicks, probed
     * across the whole width of each because the failure was a dead BAND down
     * one side that a centre-only probe reads as fine. Measured at the widest
     * viewport only: below roughly 1300px the pill already overflows on this
     * screen WITHOUT any grouping — a defect that predates this work and is
     * `pnpm verify:collab-controls`'s to report, not this file's to hide.
     */
    ownClicks: (() => {
      const row = document.querySelector('[data-wx="product-group"] .pc-ct-row');
      if (!row) return null;
      /* SCROLLED TO FIRST, and a point with NOTHING at it is counted as
         unsampled rather than as an overlap. `elementFromPoint` returns null
         outside the viewport, and the first row of this table sits below a
         1000px fold — the band, then the group header, are above it. Counting
         those nulls as "a neighbour is on top of it" is how the sibling suite
         stood at six false failures describing a bug that did not exist. */
      row.scrollIntoView({ block: 'center' });
      const probe = (sel, label) => {
        const el = row.querySelector(sel);
        if (!el) return { label, present: false };
        const r = el.getBoundingClientRect();
        if (!r.width) return { label, present: true, own: 0, sampled: 0 };
        const y = r.top + r.height / 2;
        let mine = 0, empty = 0, total = 0;
        for (let x = r.left + 2; x < r.right - 2; x += 3) {
          total += 1;
          const hit = document.elementFromPoint(x, y);
          if (!hit) empty += 1;
          else if (hit === el || el.contains(hit)) mine += 1;
        }
        const sampled = total - empty;
        return { label, present: true, own: sampled ? Math.round((mine / sampled) * 100) : 0, sampled };
      };
      return [
        probe('.pc-badge-btn', 'status pill'),
        probe('.pc-contract-btn', 'contract pencil'),
        probe('.pc-rowactions .pc-actbtn', 'eye button'),
      ];
    })(),
  };
};

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

  const openBrand = async (p, brand) => {
    await p.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
    const back = p.locator('.pc-back');
    if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await p.waitForTimeout(2500); }
    await p.waitForSelector('.pc-bt-row', { timeout: 30000 }).catch(() => {});
    /* ALL TIME FIRST, WHILE STILL ON THE LIST. The Brands screen lists the
       brands active in the selected month, so a brand with no creators this
       month is not on it at all — which is how this file reported "Pure Daily
       Care is not on the Brands screen" on 1 October. Switching after opening a
       brand is too late; the row has to be findable. */
    /* If All Time did not take, every figure below would be about the month
       the clock happens to be in rather than the one this file chose. Say so
       and refuse the brand, rather than measuring the wrong thing quietly. */
    if (!(await ensureAllTime(p))) {
      check(false, `${brand}: All Time could not be switched on`, 'the run below would describe the wrong period');
      return false;
    }
    await p.waitForTimeout(800);
    const row = p.locator('.pc-bt-row')
      .filter({ has: p.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${brand}\\s*$`) }) }).first();
    if (!(await row.count().catch(() => 0))) return false;
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    /*
     * ALL TIME, NOT WHATEVER MONTH THE CLOCK IS IN.
     *
     * The brand page opens on the current month, and on 1 October this file
     * went from 98 green to four failures without a line of the feature
     * changing: a brand with no October creators was no longer on the Brands
     * screen at all, and the brands that were had everybody in one payment
     * status, so the status dividers the check insists on were correctly
     * absent. None of that is about product grouping. A guard that breaks when
     * the calendar turns over is a guard nobody trusts the second time, so it
     * asks about the whole history instead, where the shape of the data is
     * stable.
     */
    await p.waitForSelector('.pc-ct-row, .pc-empty', { timeout: 30000 }).catch(() => {});
    /* AND THEN PROVE WE ARE ACTUALLY ON THAT BRAND'S PAGE. Returning true
       because a click did not throw is how this file reported "0 product bands"
       at one viewport width and nowhere else: the click had not opened
       anything, and every assertion after it was describing the Brands list. */
    const title = (await p.locator('.pc-dd-title').first().textContent().catch(() => '') || '').trim();
    if (title.toLowerCase() !== brand.toLowerCase()) return false;
    /* WAIT FOR THE TABLE TO STOP CHANGING, not for a selector and not for a
       fixed pause. Both of the obvious waits lie here: `.pc-empty` is on the
       page for a moment on the FIRST brand opened after signing in, while the
       month's creators are still arriving, so "wait for a band or an empty
       state" is satisfied instantly and everything read afterwards describes a
       half-drawn screen. That is exactly how this file reported "Penetrex: 0
       product groups" on the first open and 7 bands over 34 rows at every
       viewport width later in the same run. So: poll the row count until two
       consecutive reads a beat apart agree. */
    let last = -1, same = 0;
    for (let i = 0; i < 45; i += 1) {
      const n = await p.locator('.pc-ct-row').count().catch(() => -1);
      same = n === last ? same + 1 : 0;
      last = n;
      /* ZERO NEEDS MORE PROOF THAN A NUMBER. The empty state — "No creators in
         September 2026" — is painted while the month's creators are still on
         their way, so a zero that has held for one beat is very often a table
         that simply has not arrived. It is also a real answer for a brand with
         nobody this month, so it is accepted, after five quiet beats rather
         than one. A non-zero count only has to hold still twice. */
      if (n > 0 ? same >= 1 : same >= 5) break;
      await p.waitForTimeout(600);
    }
    await p.waitForTimeout(400);
    return true;
  };

  let sawDividers = false;
  for (const brand of GROUPED) {
    if (!(await openBrand(page, brand))) { check(false, `${brand} is on the Brands screen`); continue; }
    const v = await page.evaluate(READ);

    /* ── THE GUARD. Everything below is vacuous without groups. ─────────── */
    check(v.groups.length >= 2, `${brand}: the table is split into product groups`, `${v.groups.length} groups`);
    if (v.groups.length < 2) continue;
    check(v.allRows > 0, `${brand}: there are creator rows to group`, `${v.allRows} rows`);
    if (!v.allRows) continue;

    /* ── THE PARTITION. This is the check the feature lives or dies on. ── */
    const everyone = v.groups.flatMap((g) => g.rows.map((r) => r.who));
    const unique = new Set(everyone);
    check(everyone.every(Boolean),
      `${brand}: every grouped row carries the id the check needs`,
      `${everyone.filter(Boolean).length} of ${everyone.length}`);
    check(unique.size === everyone.length,
      `${brand}: NO ROW IS LISTED TWICE — each creator's money appears once on the screen`,
      `${everyone.length} rows, ${unique.size} distinct`);

    const summed = v.groups.reduce((t, g) => t + g.count, 0);
    check(summed === v.allRows,
      `${brand}: the groups' counts add up to the rows on screen`,
      `${summed} claimed vs ${v.allRows} rows`);
    check(v.headCount === null || summed === v.headCount,
      `${brand}: and to the creator count beside the search box`,
      `${summed} vs ${v.headCount}`);
    check(v.groups.every((g) => g.count === g.rows.length),
      `${brand}: every band's pill matches the rows beneath it`,
      v.groups.map((g) => `${g.count}/${g.rows.length}`).join(' '));

    /* ── THE NUMBERING reads 1..N straight down the page, whatever the
          grouping did to the order. A repeated or skipped number is how a
          reader discovers a row has been listed twice. ─────────────────── */
    const nums = v.allIdx.map((t) => Number(t.replace(/\D/g, '')));
    check(nums.length === v.allRows && nums.every((n, i) => n === i + 1),
      `${brand}: the rows are numbered 1..${v.allRows} in reading order`,
      nums.slice(0, 8).join(',') + (nums.length > 8 ? '…' : ''));

    /* ── THE SPLIT ITSELF. A product gets ONE band per payment status, and
          the products come in the same order under every status — that order
          is taken from the band above rather than worked out again, so the two
          halves of the screen can never disagree about which product leads.

          These replaced a comparison of the band's creator count against the
          partition's, which looked like an invariant and is not: the band
          counts creators who POSTED for a product, the groups place every
          creator including the ones with no videos yet. Dr Tobias reads 19
          against 20 for that reason alone, and the difference is two people
          who have not filmed anything. ──────────────────────────────────── */
    check(v.sections.length > 0, `${brand}: the bands sit inside payment-status sections`,
      `${v.sections.length} sections`);
    const dupInSection = v.sections.find((sec) => new Set(sec).size !== sec.length);
    check(!dupInSection, `${brand}: a product gets one band per status, never two`,
      dupInSection ? dupInSection.join(' | ') : '');
    const seq = v.sections.filter((sec) => sec.length > 1);
    const orderBroken = seq.find((sec) => {
      const ref = seq[0];
      const a = sec.filter((n) => ref.includes(n));
      const b = ref.filter((n) => sec.includes(n));
      return a.join('>') !== b.join('>');
    });
    check(!orderBroken, `${brand}: the products come in the same order under every status`,
      orderBroken ? orderBroken.join(' > ') : `${seq.length} multi-product sections`);
    check(v.sections.every((sec) => {
      const i = sec.indexOf('');
      return i === -1 || i === sec.length - 1;
    }), `${brand}: "No product recorded" is always last in its section`);

    /* ── THE UI RASHID DREW ──────────────────────────────────────────────── */
    check(v.groups.every((g) => g.hasShot), `${brand}: every band shows the product's picture slot`);
    check(v.groups.every((g) => g.name.length > 0), `${brand}: every band is named`);
    check(v.groups.every((g) => /\d+\s+creators?/.test(g.countLabel)),
      `${brand}: every band says how many creators`, v.groups.map((g) => g.countLabel).join(' · '));
    check(v.groups.every((g) => g.hasKebab), `${brand}: every band has its menu button`);
    check(v.groups.every((g) => g.expanded === 'true'), `${brand}: bands open by default`);
    /* THE DIVIDERS ARE CONDITIONAL AND ALWAYS WERE: the table draws them only
       when there is more than one payment status to separate. Dr Tobias's whole
       history is in one status, so insisting on them failed a screen that was
       correct. The real rule is that products never escape their status
       section — if the page has more than one section, it must have drawn the
       dividers that make them. */
    check(v.sections.length <= 1 || v.statusBands > 0,
      `${brand}: product bands stay inside the payment-status sections`,
      `${v.sections.length} sections, ${v.statusBands} dividers`);
    sawDividers = sawDividers || v.statusBands > 0;
    check(v.spills === 0, `${brand}: nothing in a band spills out of the card`, `${v.spills} too wide`);
    check(v.pageSideScroll <= 1, `${brand}: no horizontal page scroll`, `${v.pageSideScroll}px`);

    /* ── THE GROUPING COSTS THE ROW NO WIDTH, and its controls still take
          their own clicks. Both shipped wrong once; see READ. ───────────── */
    check(!!v.rowWidth, `${brand}: a grouped row could be measured`);
    if (v.rowWidth) {
      check(v.rowWidth.row >= v.rowWidth.card - 2,
        `${brand}: a grouped row is as wide as the card — grouping steals no column width`,
        `row ${v.rowWidth.row}px in card ${v.rowWidth.card}px`);
    }
    check(Array.isArray(v.ownClicks) && v.ownClicks.length === 3,
      `${brand}: the row's three controls were found to probe`);
    for (const c of v.ownClicks || []) {
      /* Nothing sampled proves nothing — say so rather than letting 0 of 0
         read as either answer. */
      check(c.present && c.sampled > 0, `${brand}: the ${c.label} could be probed at all`,
        c.present ? `${c.sampled} points on screen` : 'missing');
      if (!c.present || !c.sampled) continue;
      check(c.own >= 92,
        `${brand}: the ${c.label} in a grouped row receives its own clicks`,
        `${c.own}% of its width`);
    }

    /* ── COLLAPSING ONE BAND hides its rows and touches nothing else. The
          numbers must NOT renumber, or #14 becomes #9 because somebody
          folded a group and the print-out stops matching the screen. ───── */
    const firstCount = v.groups[0].count;
    await page.locator('[data-wx="product-group"] .wx-pgroup-toggle').first().click();
    await page.waitForTimeout(350);
    const shut = await page.evaluate(READ);
    check(shut.groups[0].rows.length === 0 && shut.groups[0].shut,
      `${brand}: collapsing a band hides its rows`,
      `${shut.groups[0].rows.length} rows left`);
    check(shut.allRows === v.allRows - firstCount,
      `${brand}: and hides only its own`,
      `${shut.allRows} vs expected ${v.allRows - firstCount}`);
    check(shut.groups[0].count === firstCount,
      `${brand}: a collapsed band still says how many are inside it`, String(shut.groups[0].count));
    const shutNums = shut.allIdx.map((t) => Number(t.replace(/\D/g, '')));
    check(shutNums.every((n, i) => i === 0 || n > shutNums[i - 1]),
      `${brand}: the remaining rows keep their numbers, still ascending`,
      shutNums.slice(0, 8).join(','));
    await page.locator('[data-wx="product-group"] .wx-pgroup-toggle').first().click();
    await page.waitForTimeout(350);
    const reopened = await page.evaluate(READ);
    check(reopened.allRows === v.allRows, `${brand}: opening it again brings every row back`,
      `${reopened.allRows} vs ${v.allRows}`);

    /* ── THE MENU DOES SOMETHING. A control that opens and then changes
          nothing is the overlay bug this screen has shipped twice. ──────── */
    await page.locator('.wx-pgroup-kebab').first().click();
    await page.waitForTimeout(250);
    const popVisible = await page.locator('.wx-pgroup-pop').first().isVisible().catch(() => false);
    check(popVisible, `${brand}: the band menu opens`);
    if (popVisible) {
      await page.getByRole('menuitem', { name: /collapse all products/i }).first().click();
      await page.waitForTimeout(400);
      const allShut = await page.evaluate(READ);
      check(allShut.allRows === 0 && allShut.groups.every((g) => g.shut),
        `${brand}: "Collapse all products" closes every band`,
        `${allShut.allRows} rows still showing`);
      await page.locator('.wx-pgroup-kebab').first().click();
      await page.waitForTimeout(250);
      await page.getByRole('menuitem', { name: /expand all products/i }).first().click();
      await page.waitForTimeout(400);
      const allOpen = await page.evaluate(READ);
      check(allOpen.allRows === v.allRows, `${brand}: "Expand all products" opens them again`,
        `${allOpen.allRows} vs ${v.allRows}`);
    }

    console.log(`  · ${brand}: ${v.groups.length} product groups · ${v.allRows} rows · ${unique.size} distinct people`);
  }

  /* ── A BRAND WITH NO PRODUCT DATA KEEPS ITS FLAT TABLE ────────────────── */
  if (await openBrand(page, FLAT)) {
    const v = await page.evaluate(READ);
    check(v.allRows > 0, `${FLAT}: has creators to show at all`, `${v.allRows} rows`);
    if (v.allRows > 0) {
      check(v.groups.length === 0,
        `${FLAT}: a brand with no product on any video grows no empty band`,
        `${v.groups.length} groups`);
      const nums = v.allIdx.map((t) => Number(t.replace(/\D/g, '')));
      check(nums.every((n, i) => n === i + 1),
        `${FLAT}: its flat list is still numbered 1..${v.allRows}`,
        nums.slice(0, 6).join(','));
    }
  } else {
    check(false, `${FLAT} is on the Brands screen`);
  }

  /* ── EVERY WIDTH, because this is new furniture on a full screen ──────── */
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
    if (!(await openBrand(p2, GROUPED[0]))) { check(false, `${w}px: ${GROUPED[0]} opened`); await c2.close(); continue; }
    const v = await p2.evaluate(READ);
    check(v.groups.length >= 2, `${w}px: the product bands are there`,
      `${v.groups.length} bands over ${v.allRows} rows`);
    if (v.groups.length >= 2) {
      /* The band is a tap target on a phone, not a hover-only affordance. */
      const box = await p2.locator('[data-wx="product-group"] .wx-pgroup-toggle').first().boundingBox();
      check(!!box && box.height >= 32, `${w}px: the band is big enough to tap`, box ? `${Math.round(box.height)}px tall` : 'no box');
      check(v.groups.every((g) => g.name.length > 0), `${w}px: names survive the narrow layout`);
      check(v.spills === 0, `${w}px: nothing spills out of the card`, `${v.spills} too wide`);
    }
    check(v.pageSideScroll <= 1, `${w}px: no horizontal page scroll`, `${v.pageSideScroll}px`);
    await c2.close();
  }

  /* ── DARK MODE. Both themes are equal citizens; a band readable in one and
        invisible in the other is half a feature. ──────────────────────── */
  {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: 'dark' });
    const p3 = await c3.newPage();
    await p3.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await p3.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
    await p3.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
    await p3.getByRole('button', { name: /^sign in$/i }).click();
    await p3.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hi3 = p3.getByRole('button', { name: /let.s go/i });
    if (await hi3.first().isVisible().catch(() => false)) await hi3.first().click();
    if (await openBrand(p3, GROUPED[0])) {
      const ink = await p3.evaluate(() => {
        const g = document.querySelector('[data-wx="product-group"]');
        if (!g) return null;
        const head = g.querySelector('.wx-pgroup-head');
        const name = g.querySelector('.wx-pgroup-name');
        return {
          bg: getComputedStyle(head).backgroundColor,
          fg: getComputedStyle(name).color,
          groups: document.querySelectorAll('[data-wx="product-group"]').length,
        };
      });
      check(!!ink && ink.groups >= 2, 'dark: the bands are drawn', ink ? `${ink.groups}` : 'none');
      if (ink) {
        /* Not "is it dark", which a stylesheet can fake, but "is the ink a
           different colour from the ground it is printed on". */
        check(ink.bg !== ink.fg && ink.bg !== 'rgba(0, 0, 0, 0)',
          'dark: the band has its own ground and its ink differs from it',
          `${ink.bg} / ${ink.fg}`);
      }
    } else {
      check(false, `dark: ${GROUPED[0]} opened`);
    }
    await c3.close();
  }

  /*
   * ZERO CONSOLE ERRORS OF OUR OWN.
   *
   * A third party being down for ONE brand is a real condition this product
   * handles deliberately, and `supabaseClient.js` is right to log it — the
   * console is the only place a fault can surface at all here. But it is not
   * this file's business: once a brand whose EUKA store is broken is visible
   * on the Brands screen (HoneySticks, from 2026-10-09), every run that touches
   * it logs a 503 and a guard about product GROUPING starts failing about
   * somebody else's server.
   *
   * So those are set aside — and COUNTED OUT LOUD, because a filter nobody can
   * see is how a real error would slip through behind a known one.
   */
  const upstream = errors.filter((e) => /\[euka\]|\[collab-products\]|non-2xx status code|status of 50\d/i.test(e));
  const ours = errors.filter((e) => !upstream.includes(e));
  if (upstream.length) {
    console.log(`  NOTE  ${upstream.length} console error(s) set aside as a known upstream`
      + ` failure, not this check's subject: ${upstream[0].slice(0, 90)}`);
  }
  check(ours.length === 0, 'zero console errors of our own',
    ours.length ? ours.slice(0, 3).join(' | ') : `${upstream.length} upstream set aside`);
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
