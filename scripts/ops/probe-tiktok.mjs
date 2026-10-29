#!/usr/bin/env node
/**
 * ASK TIKTOK WHAT IT WILL ACTUALLY GIVE US.
 *
 * Every fact in the "What the GMV Max API will and will not give us" section of
 * `docs/OPERATIONS.md` was learned by asking the live account, not by reading a
 * doc, because the docs and the grant do not agree: an endpoint can exist,
 * be documented, and still answer
 *
 *     40001  advertiser does not grant you <path>:GET permission
 *
 * which is the difference between "build it" and "apply for it".
 *
 * This walks a list of candidate GET endpoints through the `raw.probe` action
 * on `tiktok-connect` and prints, for each, TikTok's own code and message. It
 * writes nothing to TikTok — `raw.probe` is GET only, `/open_api/` only, on
 * TikTok's host alone, and cannot be made to write.
 *
 * It DOES create a throwaway admin in the dev database to authenticate with,
 * and deletes it again, so it is dev only and needs the service key:
 *
 *     SUPABASE_SERVICE_KEY=... node scripts/ops/probe-tiktok.mjs
 *     SUPABASE_SERVICE_KEY=... node scripts/ops/probe-tiktok.mjs --json   # raw envelopes
 *
 * Add a probe by adding a line to PROBES. That is the whole point of it: a
 * question about the API should cost a request, not a deploy.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

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
assertDevProject(URL_, 'probe-tiktok.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !PUBLISHABLE) throw new Error('.env.local is missing the Supabase URL or key');
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set in the environment');

const SHOW_JSON = process.argv.includes('--json');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/* ------------------------------------------------------- what to ask with -- */

const { data: store } = await admin
  .from('tiktok_stores')
  .select('store_id, advertiser_id, store_authorized_bc_id, name, brand_id')
  .not('brand_id', 'is', null)
  .limit(1)
  .maybeSingle();

if (!store) throw new Error('No mapped TikTok store in dev, so there is nothing to ask about.');

// A window that is known to have real spend on this account.
const END = process.env.PROBE_END ?? '2026-08-15';
const START = process.env.PROBE_START ?? '2026-08-14';

const A = store.advertiser_id;
const S = store.store_id;
const BC = store.store_authorized_bc_id ?? '';

console.log(`Probing advertiser ${A}, store ${S} (${store.name}), bc ${BC}`);
console.log(`Window ${START} to ${END}\n`);

/* ------------------------------------------------------------- the probes -- */

const J = JSON.stringify;

const PROBES = [
  /* --- IS AN AD RUNNING, PAUSED, LEARNING OR STOPPED? --------------------- */
  /*
   * Rashid, 2026-08-25: "do we have any endpoint that will tell us the ads
   * status? such as wether it's stop, learning in queue or something else ...
   * tiktok recently updated the status values so it could be any".
   *
   * Delivery status does not live in the GMV Max REPORTS at all: those carry
   * money and nothing else. It lives on the campaign, the ad group and the ad,
   * in `operation_status` (what the advertiser set) and `secondary_status`
   * (what TikTok is actually doing with it, which is where LEARNING, NOT
   * DELIVERING and the rest appear).
   *
   * Every candidate is asked below, at BOTH versions where both exist, because
   * the whole point is to find out what this account answers today rather than
   * what a doc said last week.
   */
  [
    'CAMPAIGN list: operation_status and secondary_status',
    '/open_api/v1.3/campaign/get/',
    { advertiser_id: A, page_size: '5' },
  ],
  [
    'CAMPAIGN list at v1.2',
    '/open_api/v1.2/campaign/get/',
    { advertiser_id: A, page_size: '5' },
  ],
  [
    'AD GROUP list: where LEARNING usually shows',
    '/open_api/v1.3/adgroup/get/',
    { advertiser_id: A, page_size: '5' },
  ],
  [
    'AD list: per creative delivery status',
    '/open_api/v1.3/ad/get/',
    { advertiser_id: A, page_size: '5' },
  ],
  [
    'GMV Max CAMPAIGN detail',
    '/open_api/v2.0/gmv_max/campaign/get/',
    { advertiser_id: A, store_ids: J([S]), store_authorized_bc_id: BC, page_size: '5' },
  ],
  [
    'GMV Max CAMPAIGN detail at v1.3',
    '/open_api/v1.3/gmv_max/campaign/get/',
    { advertiser_id: A, store_ids: J([S]), store_authorized_bc_id: BC, page_size: '5' },
  ],
  [
    'campaign gmv_max info',
    '/open_api/v1.3/campaign/gmv_max/info/',
    { advertiser_id: A, store_id: S },
  ],
  [
    'can the STORE report carry a status dimension?',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['campaign_id']),
      metrics: J(['cost', 'secondary_status']),
    },
  ],
  [
    'can the VIDEO report carry a status metric?',
    '/open_api/v2.0/gmv_max/video_list/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['item_id']),
      metrics: J(['cost', 'operation_status']),
      page_size: '5',
    },
  ],
  [
    'the integrated report, filtered to campaign status',
    '/open_api/v1.3/report/integrated/get/',
    {
      advertiser_id: A,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: J(['campaign_id']),
      metrics: J(['spend']),
      start_date: START,
      end_date: END,
      page_size: '5',
    },
  ],

  /* --- the ones round one only got the PARAMETERS wrong on ---------------- */
  [
    'every video the SHOP has (not just ours)',
    '/open_api/v1.3/gmv_max/video/get/',
    { advertiser_id: A, store_id: S, store_authorized_bc_id: BC, page_size: '10' },
  ],
  [
    'identities: whose account posts the videos',
    '/open_api/v1.3/gmv_max/identity/get/',
    { advertiser_id: A, store_id: S, store_authorized_bc_id: BC },
  ],
  [
    'shop ad usage check',
    '/open_api/v1.3/gmv_max/store/shop_ad_usage_check/',
    { advertiser_id: A, store_id: S, store_authorized_bc_id: BC },
  ],
  [
    'store GMV by HOUR',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: END,
      end_date: END,
      dimensions: J(['stat_time_hour']),
      metrics: J(['cost', 'gross_revenue', 'orders']),
    },
  ],
  [
    'is there a LIVE report?',
    '/open_api/v2.0/gmv_max/live_list/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['stat_time_day']),
      metrics: J(['cost', 'gross_revenue']),
    },
  ],
  [
    'is there a PRODUCT report?',
    '/open_api/v2.0/gmv_max/product_list/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['spu_id']),
      metrics: J(['cost', 'gross_revenue']),
    },
  ],
  [
    'can the store report break down by CAMPAIGN?',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['campaign_id']),
      metrics: J(['cost', 'gross_revenue']),
    },
  ],
  [
    'can the store report break down by VIDEO?',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['item_id']),
      metrics: J(['cost', 'gross_revenue']),
    },
  ],
  [
    'video report by DAY as well as video',
    '/open_api/v2.0/gmv_max/video_list/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['item_id', 'stat_time_day']),
      metrics: J(['cost', 'gross_revenue']),
      page_size: '5',
    },
  ],

  /* A control. If this fails, the problem is the connection, not the grant. */
  ['sanity: timezones', '/open_api/v1.3/tool/timezone/', { advertiser_id: A }],

  /* --- what we already use, re-confirmed --------------------------------- */
  [
    'per video report (what we sync)',
    '/open_api/v2.0/gmv_max/video_list/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['item_id']),
      metrics: J(['cost', 'gross_revenue', 'orders']),
      page_size: '5',
    },
  ],

  /* --- SHOP-LEVEL GMV, the actual question ------------------------------- */
  [
    'STORE GMV by day',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['stat_time_day']),
      metrics: J(['cost', 'net_cost', 'gross_revenue', 'orders', 'roi', 'cost_per_order']),
    },
  ],
  [
    'STORE GMV by product',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['spu_id']),
      metrics: J(['cost', 'gross_revenue', 'orders']),
    },
  ],
  [
    'STORE GMV by day AND product',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['stat_time_day', 'spu_id']),
      metrics: J(['cost', 'gross_revenue', 'orders']),
    },
  ],
  [
    'is there an ORGANIC / total split? (order_source)',
    '/open_api/v2.0/gmv_max/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['stat_time_day', 'order_source']),
      metrics: J(['gross_revenue', 'orders']),
    },
  ],
  [
    'per video, more metrics than we take',
    '/open_api/v2.0/gmv_max/video_list/report/get/',
    {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: START,
      end_date: END,
      dimensions: J(['item_id']),
      metrics: J(['cost', 'gross_revenue', 'orders', 'video_views', 'impressions', 'clicks']),
      page_size: '5',
    },
  ],

  /* --- the video and identity endpoints we have never called ------------- */
  ['gmv max video list', '/open_api/v1.3/gmv_max/video/get/', { advertiser_id: A, store_id: S }],
  [
    'gmv max video list (v2.0)',
    '/open_api/v2.0/gmv_max/video/get/',
    { advertiser_id: A, store_id: S },
  ],
  [
    'gmv max identities (creator accounts)',
    '/open_api/v1.3/gmv_max/identity/get/',
    { advertiser_id: A, store_id: S },
  ],
  [
    'custom anchor video list',
    '/open_api/v1.3/gmv_max/custom_anchor_video_list/get/',
    { advertiser_id: A, store_id: S },
  ],
  [
    'occupied custom shop ads',
    '/open_api/v1.3/gmv_max/occupied_custom_shop_ads/list/',
    { advertiser_id: A, store_id: S },
  ],
  ['ad account identities', '/open_api/v1.3/identity/get/', { advertiser_id: A }],

  /* --- campaign settings, refused once. Two other paths exist ------------ */
  ['gmv max campaigns (known refusal)', '/open_api/v1.3/gmv_max/campaign/get/', { advertiser_id: A }],
  ['gmv max campaign info', '/open_api/v1.3/campaign/gmv_max/info/', { advertiser_id: A }],
  ['ordinary campaign list', '/open_api/v1.3/campaign/get/', { advertiser_id: A }],

  /* --- the general ads report, which is a different grant ---------------- */
  [
    'integrated report, plain spend',
    '/open_api/v1.3/report/integrated/get/',
    {
      advertiser_id: A,
      report_type: 'BASIC',
      data_level: 'AUCTION_ADVERTISER',
      dimensions: J(['advertiser_id', 'stat_time_day']),
      metrics: J(['spend']),
      start_date: START,
      end_date: END,
    },
  ],
  [
    'integrated report, SHOP metrics',
    '/open_api/v1.3/report/integrated/get/',
    {
      advertiser_id: A,
      report_type: 'BASIC',
      data_level: 'AUCTION_ADVERTISER',
      dimensions: J(['advertiser_id', 'stat_time_day']),
      metrics: J(['spend', 'total_onsite_shopping_value', 'onsite_shopping', 'gross_revenue']),
      start_date: START,
      end_date: END,
    },
  ],

  /* --- store and business centre plumbing -------------------------------- */
  [
    'shop ad usage check',
    '/open_api/v1.3/gmv_max/store/shop_ad_usage_check/',
    { advertiser_id: A, store_ids: J([S]) },
  ],
  [
    'exclusive authorization',
    '/open_api/v1.3/gmv_max/exclusive_authorization/get/',
    { advertiser_id: A, store_ids: J([S]) },
  ],
  ['business centres', '/open_api/v1.3/bc/get/', {}],
  ['bc assets: shops', '/open_api/v1.3/bc/asset/get/', { bc_id: BC, asset_type: 'TIKTOK_SHOP' }],
  ['bc assets: ad accounts', '/open_api/v1.3/bc/asset/get/', { bc_id: BC, asset_type: 'ADVERTISER' }],
  ['account balance', '/open_api/v1.3/advertiser/balance/get/', { advertiser_ids: J([A]) }],
];

/*
 * METRIC DISCOVERY, with `--metrics`.
 *
 * The report endpoints name only the FIRST metric they dislike, so a long list
 * tells you nothing except that something in it is wrong. Asking for one metric
 * per request is the only way to get a complete answer, and it is cheap.
 */
const CANDIDATE_METRICS = [
  'cost',
  'net_cost',
  'gross_revenue',
  'orders',
  'roi',
  'cost_per_order',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'video_views',
  'conversion',
  'conversion_rate',
  'gross_revenue_roi',
  'net_cost_roi',
  'buyers',
  'unit_sales',
  'refund',
  'refund_amount',
  'live_gmv',
  'product_gmv',
  'shop_ads_gmv',
  'organic_gmv',
  'total_gmv',
  'gmv',
];

if (process.argv.includes('--metrics')) {
  PROBES.length = 0;
  for (const m of CANDIDATE_METRICS) {
    PROBES.push([
      `store metric: ${m}`,
      '/open_api/v2.0/gmv_max/report/get/',
      {
        advertiser_id: A,
        store_ids: J([S]),
        store_authorized_bc_id: BC,
        start_date: END,
        end_date: END,
        dimensions: J(['stat_time_day']),
        metrics: J([m]),
      },
    ]);
    PROBES.push([
      `video metric: ${m}`,
      '/open_api/v2.0/gmv_max/video_list/report/get/',
      {
        advertiser_id: A,
        store_ids: J([S]),
        store_authorized_bc_id: BC,
        start_date: END,
        end_date: END,
        dimensions: J(['item_id']),
        metrics: J([m]),
        page_size: '1',
      },
    ]);
  }
}

/* --------------------------------------------------------------- run it --- */

const stamp = String(Date.now()).slice(-6);
const email = `probe-admin-${stamp}@wurxmediahub.test`;
const password = 'a-long-enough-test-password-1';
let userId = null;

try {
  const { data: made, error: makeErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (makeErr) throw new Error(`could not create the probe admin: ${makeErr.message}`);
  userId = made.user.id;
  await admin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', userId);

  const signedIn = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: session, error: signInErr } = await signedIn.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`could not sign the probe admin in: ${signInErr.message}`);
  const jwt = session.session.access_token;

  const ask = async (path, query) => {
    const res = await fetch(`${URL_}/functions/v1/tiktok-connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${jwt}`,
        // Mumbai is blocked by TikTok. Never omit this.
        'x-region': 'ap-northeast-1',
      },
      body: JSON.stringify({ action: 'raw.probe', path, query }),
    });
    const body = await res.json().catch(() => null);
    return { payload: body?.payload, error: body?.error, status: res.status };
  };

  /*
   * IS THE STORE FIGURE THE WHOLE SHOP, OR JUST THE ADS?
   *
   * `--reconcile` settles it by arithmetic rather than by reading a doc: ask
   * the store report for one day, then ask the video report for EVERY video on
   * the same day and add them up. If the two agree, the store number is the sum
   * of the ad-driven videos and contains no organic sale at all.
   */
  if (process.argv.includes('--reconcile')) {
    const day = END;
    const store = await ask('/open_api/v2.0/gmv_max/report/get/', {
      advertiser_id: A,
      store_ids: J([S]),
      store_authorized_bc_id: BC,
      start_date: day,
      end_date: day,
      dimensions: J(['stat_time_day']),
      metrics: J(['cost', 'gross_revenue', 'orders']),
    });
    const top = store.payload?.data?.list?.[0]?.metrics ?? {};

    let page = 1;
    let sumCost = 0;
    let sumGmv = 0;
    let sumOrders = 0;
    let counted = 0;
    let organicGmv = 0;
    let organicVideos = 0;
    const organicSample = [];
    let totalNumber = null;
    for (;;) {
      const r = await ask('/open_api/v2.0/gmv_max/video_list/report/get/', {
        advertiser_id: A,
        store_ids: J([S]),
        store_authorized_bc_id: BC,
        start_date: day,
        end_date: day,
        dimensions: J(['item_id']),
        metrics: J(['cost', 'gross_revenue', 'orders']),
        sort_field: 'cost',
        sort_type: 'DESC',
        page: String(page),
        page_size: '1000',
      });
      if (r.payload?.code !== 0) {
        console.log(`video page ${page} refused: ${r.payload?.message ?? r.error}`);
        break;
      }
      const rows = r.payload.data?.list ?? [];
      totalNumber = Number(r.payload.data?.page_info?.total_number ?? rows.length);
      for (const row of rows) {
        const c = Number(row.metrics?.cost ?? 0);
        const g = Number(row.metrics?.gross_revenue ?? 0);
        sumCost += c;
        sumGmv += g;
        sumOrders += Number(row.metrics?.orders ?? 0);
        counted++;
        /*
         * THE QUESTION UNDERNEATH ALL OF THIS. A video with GMV and no spend is
         * an ORGANIC sale, and if the report carries those then a creator can be
         * shown what their video sold whether or not the brand ever ran an ad on
         * it. If every earning video also has spend, this report is an ads
         * report and organic GMV is somewhere else entirely.
         */
        if (c === 0 && g > 0) {
          organicGmv += g;
          organicVideos++;
          if (organicSample.length < 3) organicSample.push(row);
        }
      }
      if (counted >= totalNumber || rows.length === 0) break;
      page++;
    }

    const n = (x) => Number(x ?? 0).toFixed(2);
    console.log(`\nReconciling ${day}\n`);
    console.log(`  store report      cost ${n(top.cost)}   gmv ${n(top.gross_revenue)}   orders ${top.orders ?? '-'}`);
    console.log(`  sum of ${String(counted).padStart(4)} videos  cost ${n(sumCost)}   gmv ${n(sumGmv)}   orders ${sumOrders}`);
    console.log(`  TikTok says the video report has ${totalNumber} rows for that day.`);
    console.log(
      `  of those, ${organicVideos} video(s) earned with NO spend at all, worth ${n(organicGmv)}`
    );
    for (const r of organicSample) console.log('      ' + JSON.stringify(r));
    const gap = Number(top.gross_revenue ?? 0) - sumGmv;
    console.log(
      `\n  GMV difference: ${n(gap)}  ` +
        (Math.abs(gap) < 0.5
          ? '-> the store figure IS the sum of the ad videos. No organic sale is in it.'
          : '-> the store figure holds money no single video accounts for.')
    );
  } else {

  const granted = [];
  const refused = [];
  const broken = [];

  for (const [label, path, query] of PROBES) {
    const { payload, error } = await ask(path, query);
    const body = { error };
    const code = payload?.code;
    const message = payload?.message ?? body?.error ?? 'no reply';

    let verdict;
    if (code === 0) verdict = 'GRANTED';
    else if (String(message).includes('does not grant you')) verdict = 'NOT GRANTED';
    else verdict = 'ERROR';

    const line = `${verdict.padEnd(11)} ${label}\n            ${path}`;
    if (verdict === 'GRANTED') {
      const data = payload?.data ?? {};
      const rows = data.list ?? data.store_list ?? data.videos ?? data.identity_list ?? null;
      const shape = Array.isArray(rows)
        ? `${rows.length} row(s)` +
          (rows[0] ? `  first row: ${JSON.stringify(rows[0]).slice(0, 400)}` : '')
        : `keys: ${Object.keys(data).join(', ')}  ${JSON.stringify(data).slice(0, 400)}`;
      granted.push(`${line}\n            ${shape}`);
      if (SHOW_JSON) granted.push(`            ${JSON.stringify(data).slice(0, 1200)}`);
    } else if (verdict === 'NOT GRANTED') {
      refused.push(`${line}\n            ${message}`);
    } else {
      broken.push(`${line}\n            code ${code}: ${message}`);
    }
  }

  console.log('================================ GRANTED, and answered\n');
  console.log(granted.join('\n\n') || '  (none)');
  console.log('\n\n=========================== NOT GRANTED, apply to TikTok\n');
  console.log(refused.join('\n\n') || '  (none)');
  console.log('\n\n=================== ERRORED (wrong parameters, or no such path)\n');
  console.log(broken.join('\n\n') || '  (none)');
  }
} finally {
  if (userId) {
    await admin.from('audit_log').delete().eq('actor_id', userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`\nCOULD NOT DELETE the probe admin ${email}: ${error.message}`);
    else console.log(`\nProbe admin ${email} removed.`);
  }
}
