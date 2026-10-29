#!/usr/bin/env node
/**
 * Ad Spend and ROI inside Paid Collabs, checked as money rather than as pixels.
 *
 * WHAT MAKES THIS WORTH ITS OWN SUITE. These two columns sit inside a vendored
 * app, are built from a cross-database join, and are read by somebody deciding
 * which creators to keep paying. This project has been bitten before by a key
 * that did not match the grain and by a total that double counted, and both
 * kinds of wrongness look completely plausible on screen.
 *
 * So it asserts the three things that would be wrong QUIETLY:
 *
 *   1. ROI is revenue over the SUMS, never an average of per-video ratios. The
 *      two differ, and only the first agrees with what TikTok reports.
 *   2. A video link duplicated in `video_codes` is counted ONCE. Their own app
 *      warns that a bulk paste overlaps existing rows; counting a duplicate
 *      twice would inflate a brand's real ad spend.
 *   3. A creator cannot read another creator's ad spend through the new RPC.
 *      It is SECURITY INVOKER precisely so the existing policies decide, and a
 *      DEFINER version would have handed every creator the company's numbers.
 *
 * Makes its own rows and removes them in a `finally`. Dev only.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-collab-ads.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

assertDevProject(env.VITE_SUPABASE_URL, 'check-collab-ads.mjs');
const URL_BASE = env.VITE_SUPABASE_URL;
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (l) => { console.log(`  PASS  ${l}`); pass++; };
const bad = (l, d) => { console.error(`  FAIL  ${l}${d ? `\n        ${d}` : ''}`); fail++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/* ------------------------------------------------- the pure math, in Node -- */
const dir = mkdtempSync(join(tmpdir(), 'wx-collab-'));
let math;
try {
  const tsc = resolve(here, '../../../node_modules/typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [
      tsc,
      resolve(here, '../../../src/routes/admin/collab-ad-math.ts'),
      '--outDir', dir, '--module', 'esnext', '--target', 'es2022', '--skipLibCheck',
    ],
    { stdio: 'pipe', cwd: dir }
  );
  math = await import(pathToFileURL(join(dir, 'collab-ad-math.js')).href);
} finally {
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}
const { videoIdsOf, totalsOf, tiktokVideoId, roiText, money } = math;

const stamp = Date.now();
/* Ids must satisfy the table's own check: 6 to 32 digits. */
const V1 = String(stamp).slice(-12) + '01';
const V2 = String(stamp).slice(-12) + '02';
const V3 = String(stamp).slice(-12) + '03';
const madeUsers = [];
let advertiser = null;

try {
  console.log('\n[1] The arithmetic, before any database is involved');
  {
    const id = tiktokVideoId('https://www.tiktok.com/@someone/video/7412345678901234567?is_from=x');
    if (id === '7412345678901234567') ok('a TikTok URL yields its numeric id');
    else bad('the id was not extracted', String(id));

    if (tiktokVideoId('not a url') === null) ok('a malformed link yields null, not a fake id');
    else bad('a malformed link produced an id');
  }
  {
    /*
     * THE DUPLICATE. Same video, three shapes: bare, with a query string, and
     * a different handle in the path. All one video, so all one cost.
     */
    const codes = [
      { video: 'https://www.tiktok.com/@a/video/7411111111111111111', adCode: '#a' },
      { video: 'https://www.tiktok.com/@a/video/7411111111111111111?_r=1', adCode: '#b' },
      { video: 'https://www.tiktok.com/@DIFFERENT/video/7411111111111111111', adCode: '#c' },
      { video: 'https://www.tiktok.com/@a/video/7422222222222222222', adCode: '#d' },
      { video: '', adCode: '#e' },
    ];
    const ids = videoIdsOf(codes);
    if (ids.length === 2) ok('five rows naming two videos dedupe to two ids');
    else bad(`dedupe produced ${ids.length} ids, expected 2`, JSON.stringify(ids));

    const get = (id) =>
      id === '7411111111111111111'
        ? { cost: 100, revenue: 300, orders: 3, currency: 'USD', mixedCurrency: false }
        : { cost: 100, revenue: 100, orders: 1, currency: 'USD', mixedCurrency: false };
    const t = totalsOf(get, ids);
    if (near(t.cost, 200)) ok('a duplicated link is charged once ($200, not $300)');
    else bad(`the duplicate double counted: $${t.cost}`);
  }
  {
    /*
     * ROI THE RIGHT WAY vs THE PLAUSIBLE WAY, on numbers where they differ.
     *   video A: spent 1000, made 1000  -> 1.0x
     *   video B: spent    1, made    9  -> 9.0x
     * Average of the ratios: 5.0x. Revenue over cost: 1009/1001 = 1.008x.
     * The first is the number somebody would proudly report and it is wrong.
     */
    const figs = {
      a: { cost: 1000, revenue: 1000, orders: 10, currency: 'USD', mixedCurrency: false },
      b: { cost: 1, revenue: 9, orders: 1, currency: 'USD', mixedCurrency: false },
    };
    const t = totalsOf((id) => figs[id] ?? null, ['a', 'b']);
    if (near(t.roi, 1009 / 1001)) ok(`ROI is revenue over cost (${t.roi.toFixed(3)}x, not the 5.0x an average gives)`);
    else bad(`ROI is ${t.roi}, expected ${(1009 / 1001).toFixed(4)}`);
  }
  {
    const t = totalsOf(() => null, ['x', 'y']);
    if (t.roi === null && t.withData === 0) ok('no data at all gives roi null and withData 0');
    else bad('missing data did not read as unknown', JSON.stringify(t));

    const zero = totalsOf(
      () => ({ cost: 0, revenue: 0, orders: 0, currency: 'USD', mixedCurrency: false }),
      ['x']
    );
    if (zero.roi === null) ok('zero spend gives roi null, not 0x');
    else bad(`zero spend produced roi ${zero.roi}`);

    if (roiText(null) === '–') ok('a null ROI renders as a dash');
    else bad(`null ROI rendered as "${roiText(null)}"`);
    if (money(null, 'USD') === '–') ok('a null amount renders as a dash');
    else bad(`null money rendered as "${money(null, 'USD')}"`);
    if (roiText(0) === '0.00x') ok('a real zero ROI still renders as 0.00x');
    else bad(`a real 0 ROI rendered as "${roiText(0)}"`);
  }
  {
    const mixed = totalsOf(
      (id) => ({
        cost: 10, revenue: 20, orders: 1,
        currency: id === 'a' ? 'USD' : 'GBP', mixedCurrency: false,
      }),
      ['a', 'b']
    );
    if (mixed.mixedCurrency && mixed.currency === null) {
      ok('two currencies are flagged rather than silently added together');
    } else {
      bad('a mixed-currency total was not flagged', JSON.stringify(mixed));
    }
  }
  {
    /* Partial coverage has to be reportable, or a total over 2 of 5 videos
       silently presents itself as the creator's whole spend. */
    const t = totalsOf(
      (id) => (id === 'a' ? { cost: 5, revenue: 5, orders: 1, currency: 'USD', mixedCurrency: false } : null),
      ['a', 'b', 'c']
    );
    if (t.withData === 1 && t.asked === 3) ok('partial coverage is reported as 1 of 3');
    else bad('partial coverage was not reported', JSON.stringify(t));
  }

  console.log('\n[2] The RPC, against real rows');
  {
    /*
     * PROVE THE SETUP EXISTS BEFORE ASSERTING ANYTHING ABOUT IT. Every check
     * below is about rows in `tiktok_video_daily`, which has a foreign key to
     * an ad account. With no account on dev the inserts fail, the RPC returns
     * nothing, and a naive suite reports "a creator cannot see it" — passing on
     * an empty table. So a missing account is a FAILURE here, never a skip.
     */
    const { data: accounts } = await admin
      .from('tiktok_ad_accounts')
      .select('advertiser_id')
      .limit(1);
    advertiser = accounts?.[0]?.advertiser_id ?? null;
    if (!advertiser) {
      bad('there is no tiktok_ad_accounts row on dev — every check in [2] would be vacuous');
      throw new Error('cannot continue without an ad account to hang test rows on');
    }
    ok(`using ad account ${advertiser} to hang test rows on`);
  }
  {
    /*
     * V1 across two days IN AUGUST, so the per-day sum is exercised rather than
     * assumed, plus a SEPTEMBER day on the same video. That September row is
     * the point: it must never appear in an August total, and an all-time total
     * must include it. Both directions are asserted in [4].
     */
    const { error } = await admin.from('tiktok_video_daily').insert([
      { item_id: V1, stat_date: '2026-08-01', advertiser_id: advertiser, cost: 60.00, gross_revenue: 180.00, orders: 3, currency: 'USD' },
      { item_id: V1, stat_date: '2026-08-02', advertiser_id: advertiser, cost: 40.00, gross_revenue: 20.00, orders: 1, currency: 'USD' },
      { item_id: V1, stat_date: '2026-09-15', advertiser_id: advertiser, cost: 500.00, gross_revenue: 25.00, orders: 1, currency: 'USD' },
      { item_id: V2, stat_date: '2026-08-01', advertiser_id: advertiser, cost: 1.00, gross_revenue: 9.00, orders: 1, currency: 'USD' },
    ]);
    if (error) {
      bad(`setup: could not insert test ad rows (${error.code} ${error.message})`);
      throw new Error('cannot continue');
    }
    const { data: back } = await admin
      .from('tiktok_video_daily').select('item_id').eq('item_id', V1);
    /* THREE now: two August days plus the September one that section [3]
       uses to prove the months do not blend. */
    if (back?.length === 3) ok('the test ad rows are really there, across both months');
    else bad('setup: the test rows did not read back; the rest would be vacuous');
  }
  {
    const { data, error } = await admin.rpc('ads_totals_for_videos', {
      p_item_ids: [V1, V2, V3], p_from: '2026-08-01', p_to: '2026-08-31',
    });
    if (error) {
      bad(`the RPC errored (${error.code} ${error.message})`);
    } else {
      const byId = Object.fromEntries((data ?? []).map((r) => [r.item_id, r]));

      if (byId[V1] && near(byId[V1].cost, 100) && near(byId[V1].gross_revenue, 200)) {
        ok('within August, two days of one video sum to $100 spend and $200 revenue');
      } else {
        bad('the per-day sum is wrong', JSON.stringify(byId[V1]));
      }

      if (byId[V1] && Number(byId[V1].orders) === 4) ok('orders sum across days');
      else bad('orders did not sum', JSON.stringify(byId[V1]));

      /*
       * A VIDEO WITH NO ROWS IS ABSENT, NOT ZERO. The screen turns absence into
       * a dash; a zero row here would turn it into "we spent nothing", which is
       * a claim rather than an absence.
       */
      if (!byId[V3]) ok('a video with no ad rows is absent from the result, not zero');
      else bad('a video with no data came back as a row', JSON.stringify(byId[V3]));

      /* And the whole point, end to end: ROI over these two videos. */
      const get = (id) => {
        const r = byId[id];
        return r
          ? { cost: Number(r.cost), revenue: Number(r.gross_revenue), orders: Number(r.orders), currency: r.currency, mixedCurrency: r.mixed_currency }
          : null;
      };
      const t = totalsOf(get, [V1, V2, V3]);
      /*
       * $209 back on $101 spent = 2.069x.
       *   V1: 180 + 20 = 200 revenue on 60 + 40 = 100 cost   -> 2.0x
       *   V2:             9 revenue on             1 cost    -> 9.0x
       * An average of those two ratios is 5.5x, which is the number a
       * reasonable person would compute and report, and it is wrong.
       *
       * This expectation was itself mistyped as 201/101 on the first run and
       * the suite failed a correct implementation. Left recorded because that
       * is the right way round for a test to be wrong.
       */
      if (near(t.roi, 209 / 101)) ok(`end to end ROI is ${t.roi.toFixed(3)}x, not the 5.5x an average would give`);
      else bad(`end to end ROI is ${t.roi}, expected ${(209 / 101).toFixed(3)}`);
    }
  }
  {
    const { data, error } = await admin.rpc('ads_totals_for_videos', { p_item_ids: [] });
    if (!error && (data ?? []).length === 0) ok('an empty list returns nothing rather than erroring');
    else bad('an empty list was not handled', error ? error.message : JSON.stringify(data));
  }
  {
    const huge = Array.from({ length: 2001 }, (_, i) => String(100000 + i));
    const { error } = await admin.rpc('ads_totals_for_videos', { p_item_ids: huge });
    if (error) ok('more than 2000 videos is refused rather than silently truncated');
    else bad('an oversized list was accepted, so a caller can ask for anything');
  }

  console.log('\n[3] Months do not blend');
  {
    /*
     * THE BUG THIS SECTION EXISTS FOR. The first version of these columns
     * summed every day a video ever ran, and put that lifetime figure in a row
     * whose budget and GMV were one month's. Rashid caught it while testing.
     *
     * V1 carries $100 of August spend and $500 of September spend, chosen so
     * far apart that a blend is unmistakable rather than a rounding argument.
     */
    const call = (from, to) =>
      admin.rpc('ads_totals_for_videos', { p_item_ids: [V1], p_from: from, p_to: to });

    const { data: aug } = await call('2026-08-01', '2026-08-31');
    if (aug?.length === 1 && near(aug[0].cost, 100)) ok('August asks for August and gets $100');
    else bad('the August window is wrong', JSON.stringify(aug));

    const { data: sep } = await call('2026-09-01', '2026-09-30');
    if (sep?.length === 1 && near(sep[0].cost, 500)) ok('September asks for September and gets $500');
    else bad('the September window is wrong', JSON.stringify(sep));

    /* The two must not be the same number, or the filter is doing nothing and
       both checks above would pass on a function that ignores its bounds. */
    if (aug?.[0] && sep?.[0] && !near(aug[0].cost, sep[0].cost)) {
      ok('the two months genuinely differ, so the range is being applied');
    } else {
      bad('August and September returned the same figure — the bounds are ignored');
    }

    const { data: all } = await call(null, null);
    if (all?.length === 1 && near(all[0].cost, 600)) ok('All Time (null bounds) sums both months to $600');
    else bad('the unbounded total is wrong', JSON.stringify(all));

    const { data: half } = await call('2026-08-02', null);
    if (half?.length === 1 && near(half[0].cost, 540)) ok('an open-ended range works from one side ($540)');
    else bad('a one-sided range is wrong', JSON.stringify(half));

    const { data: none } = await call('2026-07-01', '2026-07-31');
    if (!none || none.length === 0) ok('a month with no spend returns nothing, which the screen shows as a dash');
    else bad('an empty month returned a row', JSON.stringify(none));

    const { error: backwards } = await call('2026-09-01', '2026-08-01');
    if (backwards) ok('a backwards range is refused rather than silently returning nothing');
    else bad('a backwards range was accepted, and would read as "no spend"');

    /*
     * AND THE OLD ONE-ARGUMENT SIGNATURE MUST BE GONE. Left in place it would
     * overload, and a two-argument call becomes ambiguous — "function is not
     * unique" at runtime, from a migration that looked like it succeeded.
     */
    const { error: legacy } = await admin.rpc('ads_totals_for_videos', { p_item_ids: [V1] });
    if (!legacy) ok('calling with ids alone still works, defaulting to all time');
    else bad(`the defaulted call broke (${legacy.code} ${legacy.message})`);
  }

  console.log('\n[4] The RPC cannot leak one creator’s spend to another');
  {
    const A = { email: `collab-a-${stamp}@wurx.test`, password: 'CollabA!2026' };
    const B = { email: `collab-b-${stamp}@wurx.test`, password: 'CollabB!2026' };
    for (const who of [A, B]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: who.email, password: who.password, email_confirm: true,
      });
      if (error) throw error;
      who.id = data.user.id;
      madeUsers.push(who.id);
      await admin.from('profiles').update({ role: 'creator', tier: 'pro' }).eq('id', who.id);
    }

    /*
     * A owns V1 by having submitted it. That is what the existing policy keys
     * on, so this is the setup that makes the check real rather than vacuous:
     * A must be able to see it, or "B cannot see it" proves nothing.
     *
     * A submission needs a real brand, offer and application, so the FK values
     * are copied off an existing row rather than invented. Nothing about which
     * brand it is matters here; only that the row is valid enough to exist.
     */
    const { data: sample } = await admin
      .from('content_submissions')
      .select('brand_id, offer_id, application_id')
      .limit(1);
    const shape = sample?.[0];
    if (!shape) {
      bad('there is no content_submissions row on dev to copy a shape from — [3] cannot run');
    }

    const { error: subErr } = shape
      ? await admin.from('content_submissions').insert({
          creator_id: A.id,
          embed_id: V1,
          video_url: `https://www.tiktok.com/@a/video/${V1}`,
          ad_code: `#test${stamp}`,
          /*
           * APPROVED, AND THAT IS NOT A DETAIL. The owner policy on
           * tiktok_video_daily requires cs.status = 'approved': its own comment
           * says "ownership alone is not enough and never was", because a
           * submission is only a claim until somebody has watched it. Inserted
           * as pending, this suite reported the owner could not see their own
           * figures and blamed the product for a correct rule.
           */
          status: 'approved',
          brand_id: shape.brand_id,
          offer_id: shape.offer_id,
          application_id: shape.application_id,
        })
      : { error: { code: 'setup', message: 'no shape to copy' } };

    if (subErr) {
      bad(`setup: could not attach V1 to creator A (${subErr.code} ${subErr.message})`);
    } else {
      const sign = async (who) => {
        const c = createClient(URL_BASE, PUBLISHABLE, { auth: { persistSession: false } });
        const { error } = await c.auth.signInWithPassword({ email: who.email, password: who.password });
        if (error) throw new Error(`sign-in failed for ${who.email}: ${error.message}`);
        return c;
      };
      const ca = await sign(A);
      const cb = await sign(B);

      const { data: mine } = await ca.rpc('ads_totals_for_videos', {
        p_item_ids: [V1], p_from: '2026-08-01', p_to: '2026-08-31',
      });
      if (mine?.length === 1 && near(mine[0].cost, 100)) {
        ok('the owning creator DOES see their own video’s spend, so the next check is real');
      } else {
        bad('the owner could not see their own figures; the leak check below would be vacuous', JSON.stringify(mine));
      }

      const { data: theirs } = await cb.rpc('ads_totals_for_videos', {
        p_item_ids: [V1, V2], p_from: '2026-08-01', p_to: '2026-08-31',
      });
      if (!theirs || theirs.length === 0) {
        ok('another creator asking for the same ids gets nothing back');
      } else {
        bad(`a creator read ${theirs.length} row(s) of somebody else’s ad spend`, JSON.stringify(theirs).slice(0, 200));
      }
    }
  }
} finally {
  await admin.from('tiktok_video_daily').delete().in('item_id', [V1, V2, V3]);
  for (const id of madeUsers) {
    await admin.from('content_submissions').delete().eq('creator_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log('\n[cleanup] test ad rows, submissions and creators removed');
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. Ad spend counts each video once and ROI is a ratio of sums.\n`);
