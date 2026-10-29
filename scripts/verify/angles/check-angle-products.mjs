#!/usr/bin/env node
/**
 * Does ANGLE → PRODUCT → VIDEOS hold for EVERY brand?
 *
 *   node scripts/verify/angles/check-angle-products.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/angles/check-angle-products.mjs   (adds the data half)
 *
 * Umar, 2026-10-07: "please make sure it is done for every brand".
 *
 * THAT IS TWO CLAIMS, AND THEY FAIL DIFFERENTLY.
 *
 *   1. THE LOGIC is brand-agnostic -- no brand name, no list of known
 *      products, nothing that could work for Penetrex and not for a brand
 *      added tomorrow. Proved here by RUNNING the real `wxAngleRows` against
 *      the data shapes brands actually come in. Node strips the types off the
 *      .ts and executes it, so this tests the shipped function rather than a
 *      second copy written to agree with it.
 *
 *   2. THE DATA -- whether a given brand's videos carry a product at all.
 *      Nothing in the source can answer that. With a service key this reports
 *      coverage brand by brand, so "no bands on this brand" is never a mystery:
 *      it is either a brand whose rows have no product, or a bug.
 *
 * Read-only throughout. The live half sends GETs and nothing else.
 */

import { readFileSync } from 'node:fs';

import { wxAngleRows, UNKNOWN_PRODUCT } from '../../../src/routes/admin/collab-angle-products.ts';

let pass = 0;
const fails = [];
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? `   ${detail}` : ''}`); }
};
const info = (line) => console.log(`  INFO  ${line}`);

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

/* A video row shaped as `videoFig` returns one. */
const vid = (url, product, views = 0, gmv = 0, ad = 0) => ({
  url,
  f: { v: product === null ? null : { product, creator: 'Someone' }, views, gmv, ad },
});

const heads = (rows) => rows.filter((r) => r.wxHead).map((r) => r.wxHead);
const videos = (rows) => rows.filter((r) => !r.wxHead);
const NONE = new Set();

console.log('\nANGLE -> PRODUCT -> VIDEOS\n');

console.log('The arrangement, run for real:');

/* 1. The ordinary case: a brand with two products in one angle. */
{
  const rows = wxAngleRows([
    vid('a', 'Gel', 10, 5),
    vid('b', 'Capsules', 20, 500),
    vid('c', 'Gel', 30, 15),
  ], NONE);
  const h = heads(rows);
  check('two products become two bands', h.length === 2, `got ${h.length}`);
  check('the bigger earner leads', h[0] && h[0].name === 'Capsules', h[0] && h[0].name);
  check('every video survives the grouping', videos(rows).length === 3, String(videos(rows).length));
  const gel = h.find((x) => x.name === 'Gel');
  check('a band counts its own videos', gel && gel.count === 2, gel && String(gel.count));
  check('a band sums its own figures', gel && gel.views === 40 && gel.gmv === 20,
    gel && `${gel.views}/${gel.gmv}`);
}

/* 2. The brand that names no product anywhere. Bands would be noise. */
{
  const rows = wxAngleRows([vid('a', ''), vid('b', null), vid('c', '   ')], NONE);
  check('a brand with no products at all gets no bands', heads(rows).length === 0);
  check('...and keeps every video', videos(rows).length === 3, String(videos(rows).length));
}

/* 3. The mixed brand: some rows carry a product, some do not. */
{
  const rows = wxAngleRows([
    vid('a', 'Gel', 0, 100),
    vid('b', ''),
    vid('c', 'Gel', 0, 50),
  ], NONE);
  const h = heads(rows);
  check('videos with no product are kept, not dropped', videos(rows).length === 3);
  check('...under one honest label', h.some((x) => x.name === UNKNOWN_PRODUCT));
  check('...which is always last', h[h.length - 1].name === UNKNOWN_PRODUCT, h[h.length - 1].name);
  check('...even though a real product may earn less',
    h[0].name === 'Gel' && h[h.length - 1].unknown === true);
}

/* 4. One product only -- still a band, because the angle may gain another. */
{
  const rows = wxAngleRows([vid('a', 'Gel'), vid('b', 'Gel')], NONE);
  check('a single-product brand still gets its band', heads(rows).length === 1);
}

/* 5. Spelling. The same product written two ways is one product. */
{
  const rows = wxAngleRows([vid('a', 'Gel'), vid('b', 'gel'), vid('c', ' GEL ')], NONE);
  check('one product spelled three ways is one band', heads(rows).length === 1,
    `got ${heads(rows).length}`);
  check('...holding all three videos', heads(rows)[0].count === 3);
}

/* 6. Folding hides rows and must NOT change what a band reports. */
{
  const open = wxAngleRows([vid('a', 'Gel', 10, 5), vid('b', 'Gel', 10, 5)], NONE);
  const shut = wxAngleRows([vid('a', 'Gel', 10, 5), vid('b', 'Gel', 10, 5)], new Set(['gel']));
  check('folding a band hides its videos', videos(shut).length === 0);
  check('...and does not change its count', shut[0].wxHead.count === open[0].wxHead.count);
  check('...or its figures', shut[0].wxHead.gmv === open[0].wxHead.gmv);
}

/* 7. Degenerate input must not throw: this runs on every render. */
{
  check('an empty angle is fine', wxAngleRows([], NONE).length === 0);
  check('a missing shut-set is fine', wxAngleRows([vid('a', 'Gel')], undefined).length === 2);
}

console.log('\nNothing brand-specific in the source:');
{
  const logic = read('src/routes/admin/collab-angle-products.ts');
  const band = read('src/routes/admin/collab-angle-product-band.tsx');
  const pics = read('src/routes/admin/collab-angle-product-pics.ts');
  /* Any real brand name here would mean the feature works for that brand and
     quietly differently for the rest. */
  const brands = /biostime|penetrex|dr\.?\s*tobias|klassy|kenashii|honeysticks|yesday|harvey/i;
  check('the arrangement names no brand', !brands.test(logic));
  check('the band names no brand', !brands.test(band));
  check('the picture fetch names no brand', !brands.test(pics));
  check('no hard-coded product list', !/const\s+\w*PRODUCTS\s*=\s*\[/.test(logic));
  check('the arrangement has no React in it, so this file can run it',
    !/from\s+'react'/.test(logic));
  check('the picture fetch reads the same catalogue as the Brands screen',
    pics.includes("'collab-products'"));
}

console.log('\nWired into the screen:');
{
  const jsx = read('src/vendor/wurxbase/CreativeAngles.jsx');
  const patches = read('scripts/ops/wurxbase/wurxbase-patches.mjs');
  const css = read('src/routes/admin/wurxbase-overrides.css');
  check('the drawer groups by product', jsx.includes('wxAngleRows(shown, wxShut)'));
  check('...on the FILTERED list, so search and "needs ad spend" still apply',
    jsx.includes('wxAngleRows(shown,'));
  check('the band is rendered', jsx.includes('<WxAngleProductHead'));
  check('the band gets its picture', jsx.includes('pic={wxPics'));
  check('the card knows its brand', jsx.includes('wxBrand={brand}'));
  check('every block is fenced', (jsx.match(/WURX-ADDED/g) || []).length === (jsx.match(/WURX-END/g) || []).length);
  check('the patch script owns all of it, so a re-vendor restores it',
    patches.includes('group the drawer by product') && patches.includes('product bands import'));
  check('the patch script refuses a swap that would silently no-op',
    patches.includes("'to' is a substring of 'from'"));
  check('the bands are styled', css.includes('.wx-pg-b') && css.includes('.wx-pg-pic'));
  /* The EXACT class token, not a substring: somebody else's product band on the
     Brands screen uses `wx-prodband` and `wx-prodcard`, and a loose match here
     would fail on their code for ever. */
  check('the retired per-video chip is gone',
    !jsx.includes('"wx-prod"') && !/\.wx-prod\b(?!-)/.test(css));
}

/* ─────────────────────────── the data half ─────────────────────────── */
const KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const BASE = 'https://qinxwfdwvpkzfhcijuqw.supabase.co';

if (!KEY) {
  console.log('\nPer-brand product coverage:');
  info('SKIPPED. Set SUPABASE_SERVICE_KEY (the dev service role key) to see, brand by');
  info('brand, how many videos actually carry a product. Without it this script can');
  info('prove the grouping is brand-agnostic but NOT that every brand has the data.');
} else {
  console.log('\nPer-brand product coverage (live):');
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${BASE}/rest/v1/creators?select=brand,video_codes`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Accept-Profile': 'wurxbase',
        Range: `${from}-${from + 999}`,
        'Range-Unit': 'items',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      check('read wurxbase.creators', false, `${res.status} ${(await res.text()).slice(0, 120)}`);
      break;
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const byBrand = new Map();
  for (const c of rows) {
    const brand = String(c.brand ?? '').trim();
    if (!brand) continue;
    let b = byBrand.get(brand);
    if (!b) { b = { videos: new Map() }; byBrand.set(brand, b); }
    for (const v of Array.isArray(c.video_codes) ? c.video_codes : []) {
      const url = String(v?.video ?? '').trim();
      if (!url) continue;
      const had = b.videos.get(url) || false;
      b.videos.set(url, had || String(v?.product ?? '').trim() !== '');
    }
  }

  const report = [...byBrand.entries()]
    .map(([brand, b]) => {
      const total = b.videos.size;
      const withP = [...b.videos.values()].filter(Boolean).length;
      return { brand, total, withP, pct: total ? Math.round((withP / total) * 100) : 0 };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => a.pct - b.pct || b.total - a.total);

  for (const r of report) {
    info(`${String(r.pct + '%').padStart(4)}  ${String(r.withP).padStart(5)}/${String(r.total).padEnd(5)}  ${r.brand}`);
  }
  const blind = report.filter((r) => r.withP === 0);
  check('every brand with videos has at least one product recorded',
    blind.length === 0,
    blind.length ? `no product on ANY video: ${blind.map((r) => r.brand).join(', ')}` : '');
  info('A brand at 0% shows no bands -- that is the data, not the grouping. Anything');
  info('above 0% gets bands, with the productless videos under "No product recorded".');
}

console.log(`\n${pass} passed, ${fails.length} failed.\n`);
process.exit(fails.length ? 1 : 0);
