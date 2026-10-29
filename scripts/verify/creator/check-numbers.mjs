#!/usr/bin/env node
/**
 * Do the numbers we show a creator equal the numbers TikTok holds?
 *
 * Every other suite here proves the pipeline MOVES data. This one proves it
 * moved the RIGHT data, which is a different question and the only one that
 * matters when the figure on the screen is somebody's money.
 *
 * For each day it checks, it asks TikTok the same question the nightly sync
 * asks, for the same videos, and compares row by row with what we stored. A
 * penny of drift is a failure: these are not estimates.
 *
 * WHY IT GOES THROUGH AN EDGE FUNCTION rather than calling TikTok directly.
 * TikTok blocks Indian IPs, and a Supabase call from Pakistan is routed to
 * Mumbai, so a direct call from this machine comes back "Client IP address is
 * in banned Country list", which reads exactly like a bad app secret. The call
 * therefore leaves from the function's own region, pinned to ap-northeast-1.
 * `raw.probe` is GET only, `/open_api/` only, TikTok's host only, so this
 * cannot write to TikTok even by accident.
 *
 * THE DRIFT IT WAS WRITTEN TO CATCH. `gross_revenue` is settled and has never
 * moved. `cost` is not: TikTok restates ad spend for days that are already
 * closed, crediting back invalid traffic. The sync skips any day it already
 * holds, so a stale figure stays on the screen for ever. On 2026-08-24 that had
 * left dev overstating spend by 2.8% overall and 13.6% on one day, which lowers
 * every ROI a creator is shown. Run this after any change to the sync.
 *
 * DEV ONLY. Needs SUPABASE_SERVICE_KEY. Creates one throwaway admin, because
 * the function refuses anyone who is not one, and deletes it again.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-numbers.mjs           # 5 days
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-numbers.mjs 12        # 12 days
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-numbers.mjs 2026-08-19
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
assertDevProject(URL_, 'check-numbers.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !PUBLISHABLE) throw new Error('.env.local is missing the Supabase URL or key');
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const J = JSON.stringify;
const n = (x) => Number(x ?? 0);
const money = (x) => '$' + n(x).toFixed(2);
// A penny. At or below this is rounding; above it is drift.
const EPS = 0.005;

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m, d) => {
  console.error(`  FAIL  ${m}${d ? `\n        ${d}` : ''}`);
  failures++;
};
const check = (cond, m, d) => (cond ? pass(m) : fail(m, d));

const arg = process.argv[2];
const ONE_DAY = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : null;
const HOW_MANY = ONE_DAY ? 1 : Number(arg || 5);

const stamp = String(Date.now()).slice(-6);
const email = `numbers-admin-${stamp}@wurxmediahub.test`;
const password = 'a-long-enough-test-password-1';
let userId = null;

try {
  const { data: made, error: mkErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (mkErr) throw new Error(`could not create the admin: ${mkErr.message}`);
  userId = made.user.id;
  await admin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', userId);

  // The JWT must be minted AFTER the promotion or it still carries 'applicant'.
  const cli = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: sess, error: siErr } = await cli.auth.signInWithPassword({ email, password });
  if (siErr) throw new Error(`could not sign the admin in: ${siErr.message}`);
  const jwt = sess.session.access_token;

  const ask = async (path, query) => {
    const res = await fetch(`${URL_}/functions/v1/tiktok-connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${jwt}`,
        // Mumbai is on TikTok's country block list. Never omit this.
        'x-region': 'ap-northeast-1',
      },
      body: J({ action: 'raw.probe', path, query }),
    });
    const body = await res.json().catch(() => null);
    return { payload: body?.payload, error: body?.error, status: res.status };
  };

  const { data: store, error: storeErr } = await admin
    .from('tiktok_stores')
    .select('store_id, advertiser_id, store_authorized_bc_id, brand_id')
    .not('brand_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (storeErr || !store) {
    throw new Error('no shop is matched to a brand, so there is nothing to check');
  }

  /*
   * PAGE UNTIL THERE ARE ENOUGH DISTINCT DAYS, rather than reading a fixed
   * number of ROWS. This table holds one row per video per day, so at 91
   * videos a "last 400 rows" read is only four days: asking for twelve would
   * have quietly checked five and still printed all green, which is the exact
   * shape of a check that passes because it never looked.
   */
  const seen = [];
  if (!ONE_DAY) {
    const PAGE = 1000;
    for (let from = 0; seen.length < HOW_MANY; from += PAGE) {
      const { data: page } = await admin
        .from('tiktok_video_daily')
        .select('stat_date')
        .eq('advertiser_id', store.advertiser_id)
        .order('stat_date', { ascending: false })
        .range(from, from + PAGE - 1);
      if (!page?.length) break;
      for (const row of page) if (!seen.includes(row.stat_date)) seen.push(row.stat_date);
      if (page.length < PAGE) break;
    }
  }

  const days = ONE_DAY ? [ONE_DAY] : seen.slice(0, HOW_MANY);
  if (!days.length) throw new Error('there are no stored days to check');
  if (!ONE_DAY && days.length < HOW_MANY) {
    console.log(`Only ${days.length} day(s) are stored, so that is all there is to check.`);
  }

  console.log(`\nStore ${store.store_id} on advertiser ${store.advertiser_id}`);
  console.log(`Checking ${days.length} day(s): ${days.join(', ')}\n`);

  let compared = 0;
  for (const day of days) {
    console.log(`-- ${day} ------------------------------------------------`);

    const { data: ours } = await admin
      .from('tiktok_video_daily')
      .select('item_id, cost, gross_revenue, orders, brand_id')
      .eq('stat_date', day)
      .eq('advertiser_id', store.advertiser_id);

    if (!ours?.length) {
      fail(`${day}: we hold no rows at all`);
      continue;
    }
    const mine = new Map(ours.map((r) => [r.item_id, r]));

    // Every money row must know its brand, or a per-brand total silently drops
    // it and a creator's Brand Hub shows less than they actually earned.
    const brandless = ours.filter((r) => !r.brand_id).length;
    check(
      brandless === 0,
      `${day}: every stored row carries a brand`,
      `${brandless} row(s) have no brand_id`
    );

    const r = await ask('/open_api/v2.0/gmv_max/video_list/report/get/', {
      advertiser_id: store.advertiser_id,
      store_ids: J([store.store_id]),
      store_authorized_bc_id: store.store_authorized_bc_id,
      start_date: day,
      end_date: day,
      dimensions: J(['item_id']),
      metrics: J(['cost', 'gross_revenue', 'orders']),
      filtering: J([{ field_name: 'item_id', filter_type: 'IN', filter_value: [...mine.keys()] }]),
      sort_field: 'cost',
      sort_type: 'DESC',
      page_size: '1000',
    });

    if (r.error || r.payload?.code !== 0) {
      fail(
        `${day}: TikTok refused the report`,
        r.error ?? `${r.payload?.message} (code ${r.payload?.code})`
      );
      continue;
    }

    const live = r.payload.data.list ?? [];
    check(
      live.length === ours.length,
      `${day}: TikTok returns the same number of videos we store`,
      `tiktok ${live.length}, ours ${ours.length}`
    );

    const drift = [];
    for (const row of live) {
      const id = row.dimensions.item_id;
      const o = mine.get(id);
      if (!o) {
        drift.push(`${id}: TikTok has it, we do not`);
        continue;
      }
      const fields = [
        ['cost', n(row.metrics.cost), n(o.cost)],
        ['gmv', n(row.metrics.gross_revenue), n(o.gross_revenue)],
        ['orders', n(row.metrics.orders), n(o.orders)],
      ];
      for (const [f, theirs, mineVal] of fields) {
        if (Math.abs(theirs - mineVal) > EPS) {
          drift.push(`${id} ${f}: tiktok ${theirs}, ours ${mineVal}`);
        }
      }
    }
    compared += live.length;
    check(
      drift.length === 0,
      `${day}: all ${live.length} videos agree with TikTok to the penny`,
      drift.slice(0, 8).join('\n        ') +
        (drift.length > 8 ? `\n        ...and ${drift.length - 8} more` : '')
    );

    const liveCost = live.reduce((s, x) => s + n(x.metrics.cost), 0);
    const ourCost = ours.reduce((s, x) => s + n(x.cost), 0);
    const liveGmv = live.reduce((s, x) => s + n(x.metrics.gross_revenue), 0);
    const ourGmv = ours.reduce((s, x) => s + n(x.gross_revenue), 0);
    check(
      Math.abs(liveCost - ourCost) <= EPS,
      `${day}: total spend matches`,
      `tiktok ${money(liveCost)}, ours ${money(ourCost)}`
    );
    check(
      Math.abs(liveGmv - ourGmv) <= EPS,
      `${day}: total GMV matches`,
      `tiktok ${money(liveGmv)}, ours ${money(ourGmv)}`
    );
  }

  console.log(`\n${compared} video-days compared against the live API.`);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nEvery figure we store matches what TikTok holds.\n');
