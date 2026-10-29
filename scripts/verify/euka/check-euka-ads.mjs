#!/usr/bin/env node
/**
 * EUKA AD FIGURES IN PAID COLLABS, checked as money rather than as pixels.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/euka/check-euka-ads.mjs
 *
 * Rashid, 2026-09-15: Paid Collabs' ad spend, ROI and spark codes come from
 * EUKA, copied into `euka_ad_video_month` / `euka_spark_codes` by the
 * `euka-ads-sync` function. The arithmetic on screen is `collab-ad-math.ts`,
 * already proven by `verify:collab-ads`; this proves the new source feeding it,
 * on the things that would be wrong QUIETLY:
 *
 *   1. One video under TWO campaigns is summed, once each.
 *   2. Months do not blend. All time sums them. A month with nothing is ABSENT,
 *      because the screen shows absence as a dash and a zero row as "$0".
 *   3. Two currencies are flagged, never added together.
 *   4. Replacing a campaign-month is a replace: running it twice does not
 *      double, and running it with no rows clears exactly that month.
 *   5. A creator reads NOTHING. A read-only collabs role reads it.
 *   6. Spark codes come back per video, to the same people.
 *   7. The sync function refuses an anonymous caller, a creator and a wrong
 *      scheduler secret — a manual run spends Euka calls.
 *   8. The schedule can actually fire on dev: the vault holds its secret and URL.
 *
 * Test rows carry ids no real TikTok video has, and are removed in a `finally`.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
assertDevProject(env.VITE_SUPABASE_URL, 'check-euka-ads.mjs');
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (l) => { console.log(`  PASS  ${l}`); pass++; };
const bad = (l, d) => { console.error(`  FAIL  ${l}${d ? `\n        ${d}` : ''}`); fail++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const stamp = Date.now();
const V1 = `99${String(stamp).slice(-12)}01`;
const V2 = `99${String(stamp).slice(-12)}02`;
const V3 = `99${String(stamp).slice(-12)}03`;
const V4 = `99${String(stamp).slice(-12)}04`;
const ADV = `test-adv-${stamp}`;
const STORE = `test-store-${stamp}`;
const made = [];

const replace = (campaign, month, rows) =>
  admin.rpc('euka_ad_replace_unit', {
    p_advertiser_id: ADV, p_campaign_id: campaign, p_month: month, p_store_id: STORE, p_rows: rows,
  });
/*
 * ONE RETRY, AND ONLY FOR A DROPPED REQUEST. On 2026-09-15 this machine's
 * connection dropped the same call twice ("TypeError: fetch failed") while the
 * reader itself answered correctly when asked again. A network failure says
 * nothing about the numbers, so it is retried once; an error FROM the database
 * never is, because that is exactly what these checks exist to catch.
 */
const totals = async (client, ids, from, to) => {
  const ask = () => client.rpc('euka_ad_totals_for_videos', { p_item_ids: ids, p_from: from ?? undefined, p_to: to ?? undefined });
  const first = await ask();
  if (first.error && /fetch failed/i.test(first.error.message || '')) return ask();
  return first;
};
const byId = (data) => Object.fromEntries((data ?? []).map((r) => [r.item_id, r]));

const probeUser = async (role) => {
  const email = `euka-ads-${role}-${stamp}@wurx.test`;
  const password = `EukaAds!${stamp}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  made.push(data.user.id);
  await admin.from('profiles').update({ role, is_active: true, ...(role === 'creator' ? { tier: 'pro' } : {}) }).eq('id', data.user.id);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await c.auth.signInWithPassword({ email, password });
  if (se) throw se;
  return { c, token: s.session.access_token };
};

try {
  console.log('\n[1] Setup, proven before anything is asserted about it');
  {
    const r = [
      await replace('camp-1', '2026-08-01', [
        { item_id: V1, cost: 100, orders: 5, gross_revenue: 250, currency: 'USD' },
        { item_id: V2, cost: 10, orders: 1, gross_revenue: 5, currency: 'USD' },
      ]),
      await replace('camp-2', '2026-08-01', [{ item_id: V1, cost: 50, orders: 2, gross_revenue: 50, currency: 'USD' }]),
      await replace('camp-1', '2026-09-01', [{ item_id: V1, cost: 500, orders: 1, gross_revenue: 100, currency: 'USD' }]),
      await replace('camp-3', '2026-08-01', [{ item_id: V3, cost: 10, orders: 1, gross_revenue: 20, currency: 'USD' }]),
      await replace('camp-4', '2026-08-01', [{ item_id: V3, cost: 10, orders: 1, gross_revenue: 20, currency: 'GBP' }]),
    ];
    const errs = r.filter((x) => x.error).map((x) => x.error.message);
    if (errs.length) { bad('setup: could not write test rows', errs.join(' | ')); throw new Error('cannot continue'); }
    const { count } = await admin.from('euka_ad_video_month').select('*', { count: 'exact', head: true }).eq('advertiser_id', ADV);
    if (count === 6) ok('six test rows across four campaigns and two months are really there');
    else { bad(`setup: expected 6 rows, found ${count}`); throw new Error('cannot continue'); }
  }

  console.log('\n[2] Campaigns sum, months do not blend');
  {
    const { data, error } = await totals(admin, [V1, V2, V4], '2026-08-01', '2026-08-31');
    if (error) bad(`the reader errored: ${error.message}`);
    const t = byId(data);
    if (t[V1] && near(t[V1].cost, 150) && near(t[V1].gross_revenue, 300) && Number(t[V1].orders) === 7) {
      ok('August: one video under two campaigns sums to $150 spend, $300 ad GMV, 7 orders');
    } else bad('the two campaigns did not sum', JSON.stringify(t[V1]));
    if (!t[V4]) ok('a video with no figures is absent, not a zero row');
    else bad('a video with no figures came back', JSON.stringify(t[V4]));

    const { data: sep } = await totals(admin, [V1], '2026-09-01', '2026-09-30');
    if (sep?.length === 1 && near(sep[0].cost, 500)) ok('September asks for September and gets $500');
    else bad('the September figure is wrong', JSON.stringify(sep));

    const { data: all } = await totals(admin, [V1], null, null);
    if (all?.length === 1 && near(all[0].cost, 650)) ok('All time (no bounds) sums both months to $650');
    else bad('the all-time figure is wrong', JSON.stringify(all));

    const { data: jul } = await totals(admin, [V1], '2026-07-01', '2026-07-31');
    if (!jul || jul.length === 0) ok('a month with nothing returns nothing, which the screen shows as a dash');
    else bad('an empty month returned a row', JSON.stringify(jul));
  }

  console.log('\n[3] Currencies are flagged, never added');
  {
    /* The error is printed with the answer: on 2026-09-15 a dropped request
       ("fetch failed") first read here as "not flagged", which blamed the
       reader for the network. */
    const { data, error } = await totals(admin, [V3], '2026-08-01', '2026-08-31');
    const r = data?.[0];
    if (r && r.mixed_currency === true && r.currency === null) ok('USD and GBP on one video are flagged, with no single currency claimed');
    else bad('a mixed-currency video was not flagged', error ? `the request itself failed: ${error.message}` : JSON.stringify(data));
  }

  console.log('\n[4] Guard rails');
  {
    const huge = Array.from({ length: 2001 }, (_, i) => String(1000000 + i));
    const { error: big } = await totals(admin, huge, null, null);
    if (big) ok('more than 2000 videos is refused rather than silently truncated');
    else bad('an oversized list was accepted');
    const { error: back } = await totals(admin, [V1], '2026-09-01', '2026-08-01');
    if (back) ok('a backwards range is refused rather than read as "no spend"');
    else bad('a backwards range was accepted');
  }

  console.log('\n[5] A replace is a replace');
  {
    await replace('camp-1', '2026-08-01', [
      { item_id: V1, cost: 100, orders: 5, gross_revenue: 250, currency: 'USD' },
      { item_id: V2, cost: 10, orders: 1, gross_revenue: 5, currency: 'USD' },
    ]);
    const { data } = await totals(admin, [V1], '2026-08-01', '2026-08-31');
    if (data?.length === 1 && near(data[0].cost, 150)) ok('re-syncing the same campaign-month does not double it (still $150)');
    else bad('re-syncing doubled the figure', JSON.stringify(data));

    await replace('camp-1', '2026-08-01', []);
    const { data: after } = await totals(admin, [V1, V2], '2026-08-01', '2026-08-31');
    const t = byId(after);
    if (t[V1] && near(t[V1].cost, 50) && !t[V2]) ok('an empty re-sync clears exactly that campaign-month ($50 left from the other campaign)');
    else bad('an empty re-sync did not clear just its own month', JSON.stringify(after));
    const { data: sepStill } = await totals(admin, [V1], '2026-09-01', '2026-09-30');
    if (sepStill?.length === 1 && near(sepStill[0].cost, 500)) ok('and the same campaign in another month was untouched');
    else bad('clearing August touched September', JSON.stringify(sepStill));
  }

  console.log('\n[6] Who can read it');
  const creator = await probeUser('creator');
  const atl = await probeUser('affiliate_team_lead');
  {
    const { data: cd } = await totals(creator.c, [V1], null, null);
    const { data: ct } = await creator.c.from('euka_ad_video_month').select('item_id').eq('advertiser_id', ADV);
    if ((!cd || cd.length === 0) && (!ct || ct.length === 0)) ok('a creator reads nothing, through the reader or the table');
    else bad('a creator read ad figures', JSON.stringify({ cd, ct }));

    const { data: ad } = await totals(atl.c, [V1], null, null);
    if (ad?.length === 1 && near(ad[0].cost, 550)) ok('a read-only Paid Collabs role reads the figures ($550 all time)');
    else bad('the read-only collabs role could not read them, so the creator check above proves nothing', JSON.stringify(ad));
  }

  console.log('\n[7] Spark codes');
  {
    const { error } = await admin.from('euka_spark_codes').insert({ item_id: V1, store_id: STORE, spark_code: `#TEST${stamp}`, expired: false });
    if (error) bad(`setup: could not write a test spark code (${error.message})`);
    const { data: seen } = await atl.c.rpc('euka_spark_codes_for_videos', { p_item_ids: [V1, V2] });
    if (seen?.length === 1 && seen[0].spark_code === `#TEST${stamp}` && seen[0].expired === false) ok('the collabs role gets the code for the video that has one, and nothing for the one that does not');
    else bad('spark codes did not come back per video', JSON.stringify(seen));
    const { data: hidden } = await creator.c.rpc('euka_spark_codes_for_videos', { p_item_ids: [V1] });
    if (!hidden || hidden.length === 0) ok('a creator gets no spark codes');
    else bad('a creator read a spark code', JSON.stringify(hidden));
  }

  console.log('\n[8] The sync refuses who it should');
  {
    const post = (headers) => fetch(`${URL_}/functions/v1/euka-ads-sync`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', ...headers }, body: '{"budgetMs":15000}',
    }).then((r) => r.status);
    const anon = await post({});
    if (anon === 401) ok('no caller: 401'); else bad(`no caller got ${anon}`);
    const wrong = await post({ 'x-sync-secret': 'x'.repeat(64) });
    if (wrong === 401) ok('a wrong scheduler secret: 401'); else bad(`a wrong secret got ${wrong}`);
    const cr = await post({ Authorization: `Bearer ${creator.token}` });
    if (cr === 403) ok('a creator: 403'); else bad(`a creator got ${cr}`);
    const ro = await post({ Authorization: `Bearer ${atl.token}` });
    if (ro === 403) ok('a read-only collabs role cannot spend Euka calls either: 403'); else bad(`a read-only role got ${ro}`);
  }

  console.log('\n[9] The schedule can fire on dev');
  {
    /* euka_ads_run_cycle returns NULL, quietly, when the vault is empty (on
       purpose, for production). So a null here means the five-minute job has
       been doing nothing, and nothing else would say so. It returns a request
       id when it fires, which starts one real sync run: exactly what cron does. */
    const { data, error } = await admin.rpc('euka_ads_run_cycle');
    if (!error && data !== null && data !== undefined) ok(`the vault holds the secret and URL, and the cycle fired (request ${data})`);
    else bad('the scheduled cycle cannot fire: the vault secret or URL is missing', error?.message);
  }
} finally {
  await admin.from('euka_ad_video_month').delete().eq('advertiser_id', ADV);
  await admin.from('euka_spark_codes').delete().eq('store_id', STORE);
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {});
  console.log('\n[cleanup] test figures, spark codes and probe accounts removed');
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. Euka ad figures sum per video, keep months apart, and reach only the Paid Collabs team.\n`);
