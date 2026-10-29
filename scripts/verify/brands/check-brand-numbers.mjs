#!/usr/bin/env node
/**
 * A creator's numbers inside a Brand Hub: are they really that brand's?
 *
 * This signs in as a REAL creator and calls the same RPCs the screen calls,
 * then works the answer out again independently with the service role and the
 * raw money rows. Two routes to the same figure is the only way to catch a
 * filter that is applied in one place and forgotten in another, which is the
 * failure this whole surface is prone to: the tiles narrow, the list does not,
 * and both look plausible.
 *
 * THE RULE BEING TESTED, which is Rashid's:
 *   the videos listed = the ones filed against this brand's offers or contests
 *   the money summed  = only this brand's own money rows, on those videos
 *
 * It also proves the thing that has bitten this repo before: that adding an
 * argument did not leave a SECOND OVERLOAD of the function alive. PostgREST
 * binds by argument NAMES, so an old body can keep answering while every test
 * of the new one passes. Here a brand that does not exist must return nothing;
 * if an old global overload were still bound, it would return everything.
 *
 * DEV ONLY. Needs SUPABASE_SERVICE_KEY. Writes nothing.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
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

const URL_ = env.VITE_SUPABASE_URL;
assertDevProject(URL_, 'check-brand-numbers.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const n = (x) => Number(x ?? 0);
const money = (x) => '$' + n(x).toFixed(2);
const EPS = 0.005;
// Every creator seeded by scripts/seed/seed-creators.mjs shares this.
const PASSWORD = '1234567890';
const NOWHERE = '00000000-0000-0000-0000-000000000000';
const FROM = '2000-01-01';
const TO = '2999-12-31';

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m, d) => {
  console.error(`  FAIL  ${m}${d ? `\n        ${d}` : ''}`);
  failures++;
};
const check = (cond, m, d) => (cond ? pass(m) : fail(m, d));

/* Page past PostgREST's 1000-row cap, or a "total" is a total of one page. */
async function all(table, cols, tweak) {
  const out = [];
  const SIZE = 1000;
  for (let from = 0; ; from += SIZE) {
    let q = admin.from(table).select(cols).range(from, from + SIZE - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < SIZE) break;
  }
  return out;
}

const { data: brands } = await admin.from('brands').select('id, name, slug');
if (!brands?.length) throw new Error('there are no brands to check');

const daily = await all('tiktok_video_daily', 'item_id, brand_id, cost, gross_revenue, orders');
const videos = await all('creator_videos', 'creator_id, brand_id, embed_id, status, source');
const approved = videos.filter((v) => v.status === 'approved' && v.embed_id);

/* Pick the creator with the most money at the first brand: the most to get wrong. */
const brand = brands[0];
const scoreByCreator = {};
for (const v of approved.filter((v) => v.brand_id === brand.id)) {
  const rows = daily.filter((d) => d.item_id === v.embed_id && d.brand_id === brand.id);
  scoreByCreator[v.creator_id] =
    (scoreByCreator[v.creator_id] ?? 0) + rows.reduce((s, r) => s + n(r.gross_revenue), 0);
}
const creatorId = Object.entries(scoreByCreator).sort((a, b) => b[1] - a[1])[0]?.[0];
if (!creatorId) throw new Error(`no creator has approved videos at ${brand.name}`);

const { data: who } = await admin
  .from('profiles')
  .select('email, display_name')
  .eq('id', creatorId)
  .single();

console.log(`\nBrand   ${brand.name} (${brand.id})`);
console.log(`Creator ${who.display_name} <${who.email}>\n`);

/* -------------------------------------------------- the independent answer -- */
/*
 * Worked out from the raw rows, deliberately NOT by calling the same functions
 * the screen calls. Filed against this brand, and only this brand's money.
 */
const mine = [...new Set(approved.filter((v) => v.creator_id === creatorId).map((v) => v.embed_id))];
const mineHere = [
  ...new Set(
    approved.filter((v) => v.creator_id === creatorId && v.brand_id === brand.id).map((v) => v.embed_id)
  ),
];
const rowsHere = daily.filter((d) => mineHere.includes(d.item_id) && d.brand_id === brand.id);
const expect = {
  videos: mineHere.length,
  cost: rowsHere.reduce((s, r) => s + n(r.cost), 0),
  gmv: rowsHere.reduce((s, r) => s + n(r.gross_revenue), 0),
  orders: rowsHere.reduce((s, r) => s + n(r.orders), 0),
};
const rowsAnywhere = daily.filter((d) => mine.includes(d.item_id));
const global = {
  videos: mine.length,
  cost: rowsAnywhere.reduce((s, r) => s + n(r.cost), 0),
  gmv: rowsAnywhere.reduce((s, r) => s + n(r.gross_revenue), 0),
};
console.log(`  worked out from the raw rows: ${expect.videos} videos, spend ${money(expect.cost)}, gmv ${money(expect.gmv)}, orders ${expect.orders}`);
console.log(`  the same creator across ALL brands: ${global.videos} videos, spend ${money(global.cost)}, gmv ${money(global.gmv)}\n`);

/* ------------------------------------------------- now ask as the creator -- */
const cli = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
const { error: siErr } = await cli.auth.signInWithPassword({ email: who.email, password: PASSWORD });
if (siErr) throw new Error(`could not sign ${who.email} in: ${siErr.message}`);

const rpc = async (fn, args) => {
  const { data, error } = await cli.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};

console.log('-- creator_video_performance ------------------------------------');
const scoped = await rpc('creator_video_performance', {
  p_from: FROM, p_to: TO, p_source: null, p_brand_id: brand.id,
});
check(scoped.length === expect.videos,
  `lists exactly the videos filed against ${brand.name}`,
  `rpc ${scoped.length}, raw rows say ${expect.videos}`);
check(Math.abs(scoped.reduce((s, r) => s + n(r.cost), 0) - expect.cost) <= EPS,
  'and their spend is this brand\'s spend',
  `rpc ${money(scoped.reduce((s, r) => s + n(r.cost), 0))}, expected ${money(expect.cost)}`);
check(Math.abs(scoped.reduce((s, r) => s + n(r.gross_revenue), 0) - expect.gmv) <= EPS,
  'and their GMV is this brand\'s GMV',
  `rpc ${money(scoped.reduce((s, r) => s + n(r.gross_revenue), 0))}, expected ${money(expect.gmv)}`);

const unscoped = await rpc('creator_video_performance', {
  p_from: FROM, p_to: TO, p_source: null, p_brand_id: null,
});
check(unscoped.length === global.videos,
  'without a brand it still answers for every brand, unchanged',
  `rpc ${unscoped.length}, expected ${global.videos}`);

/*
 * THE OVERLOAD TEST. A brand that does not exist must return nothing. If the
 * old no-brand body were still bound by PostgREST, this would return the lot.
 */
const nowhere = await rpc('creator_video_performance', {
  p_from: FROM, p_to: TO, p_source: null, p_brand_id: NOWHERE,
});
check(nowhere.length === 0,
  'a brand the creator has never worked with returns nothing, so no old overload is still answering',
  `got ${nowhere.length} rows`);

console.log('\n-- creator_daily_performance (the chart) ------------------------');
const dailyScoped = await rpc('creator_daily_performance', {
  p_from: FROM, p_to: TO, p_source: null, p_brand_id: brand.id,
});
const chartCost = dailyScoped.reduce((s, r) => s + n(r.cost), 0);
const chartGmv = dailyScoped.reduce((s, r) => s + n(r.gross_revenue), 0);
check(Math.abs(chartCost - expect.cost) <= EPS,
  'the chart adds up to the same spend as the video list',
  `chart ${money(chartCost)}, list ${money(expect.cost)}`);
check(Math.abs(chartGmv - expect.gmv) <= EPS,
  'and the same GMV, so the tiles and the chart cannot disagree',
  `chart ${money(chartGmv)}, list ${money(expect.gmv)}`);
const dailyNowhere = await rpc('creator_daily_performance', {
  p_from: FROM, p_to: TO, p_source: null, p_brand_id: NOWHERE,
});
check(dailyNowhere.length === 0, 'and an unknown brand draws an empty chart', `got ${dailyNowhere.length} days`);

console.log('\n-- creator_performance_window ----------------------------------');
const win = await rpc('creator_performance_window', { p_brand_id: brand.id });
check(n(win?.[0]?.videos) === expect.videos,
  'the window counts only this brand\'s videos, so "All time" starts here',
  `window ${win?.[0]?.videos}, expected ${expect.videos}`);
const winAll = await rpc('creator_performance_window', { p_brand_id: null });
check(n(winAll?.[0]?.videos) === global.videos,
  'and without a brand it is still the global window',
  `window ${winAll?.[0]?.videos}, expected ${global.videos}`);

console.log('\n-- the leaderboard, ranked inside the brand ---------------------');
const board = await rpc('creator_leaderboard', {
  p_from: FROM, p_to: TO, p_limit: 100, p_offset: 0, p_search: null, p_brand_id: brand.id,
});
check(board.length > 0, `${brand.name} has a board`, 'it came back empty');
if (board.length) {
  const ranks = board.map((r) => Number(r.rank));
  check(Math.min(...ranks) === 1, 'it starts at rank 1, not a global rank filtered down',
    `lowest rank is ${Math.min(...ranks)}`);
  check(Number(board[0].total_creators) === board.length,
    'and total_creators counts this brand\'s creators, not everybody',
    `total_creators ${board[0].total_creators}, rows ${board.length}`);
  check(ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), 'ranks come back in order');
}
const boardNowhere = await rpc('creator_leaderboard', {
  p_from: FROM, p_to: TO, p_limit: 100, p_offset: 0, p_search: null, p_brand_id: NOWHERE,
});
check(boardNowhere.length === 0, 'an unknown brand has an empty board', `got ${boardNowhere.length}`);

const standing = await rpc('my_leaderboard_standing', { p_from: FROM, p_to: TO, p_brand_id: brand.id });
if (standing?.length) {
  const mineRow = board.find((r) => r.is_me);
  check(mineRow && Number(standing[0].rank) === Number(mineRow.rank),
    'my own standing agrees with my row on the board',
    `standing ${standing?.[0]?.rank}, board ${mineRow?.rank}`);
  check(Number(standing[0].total_creators) === board.length,
    'and counts the same field of creators',
    `standing ${standing[0].total_creators}, board ${board.length}`);
}

await cli.auth.signOut();

if (failures) {
  console.error(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nA Brand Hub shows this brand\'s money and nobody else\'s.\n');
