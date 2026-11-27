/**
 * euka-ads-sync
 * ---------------------------------------------------------------------------
 * Copies EUKA's per-video ad figures and spark codes into our database, so Paid
 * Collabs can show ad spend, ROI and spark codes for any month in milliseconds.
 *
 * Rashid, 2026-09-15: "when euka is giving data we can rely on euka … let's move
 * with euka for now". For every brand whose TikTok ad account is connected
 * INSIDE Euka, Paid Collabs shows ad spend and ROI per video and per creator for
 * the month on screen, and the spark code.
 *
 * WHY A SYNC AND NOT A LIVE CALL, measured on dev the same day:
 *   - The per-campaign item report answers the FIRST request for a window with a
 *     504 after about 45 seconds, and the same request a moment later in about
 *     6. TikTok is slow behind Euka, and Euka evidently finishes the job and
 *     keeps the answer, so one immediate retry is worth making.
 *   - One month across every connected store took 74 calls and 65 seconds, with
 *     most campaigns timing out.
 *   - The spark-code export is capped at 150 rows a call and takes ~40 seconds,
 *     so it can only be read a day at a time.
 *
 * EVERY RUN IS BOUNDED BY TIME, NOT BY WORK. pg_cron fires it every five minutes
 * (`euka_ads_run_cycle`). A run claims due units, works until its budget is
 * nearly spent, and returns; whatever it did not reach stays due for the next.
 * A unit is one campaign's month, or one store's day of spark codes.
 *
 * WHAT IT READS FROM EUKA, all GET, nothing written to Euka:
 *   /api/v1/gmv-max/advertisers   is TikTok Ads connected for this store?
 *   /api/v1/gmv-max/campaigns     live, paused and deleted, 20 at most each.
 *                                 Euka refuses page and pageSize, so a list cut
 *                                 short is RECORDED, never assumed complete.
 *   /api/v1/gmv-max/reports/item  every video in one campaign for a window
 *   /v0/data-export?type=spark_codes_video_download_links   one day at a time
 *
 * WHO CAN RUN IT: the scheduler presenting `x-sync-secret`, or an active staff
 * member (ops, admin, ads_manager) for a manual kick. Nobody else.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { refreshOneStaleStore } from '../_shared/euka-tiers.ts';
import { fillFollowers } from '../_shared/euka-followers.ts';
import {
  EUKA_V0,
  EUKA_V1,
  eukaKeys,
  indexStores,
  storeBrandPair,
  type EukaAuth,
  type StoreIndex,
} from '../_shared/euka-accounts.ts';

const Body = z.object({
  /* How long this run may work. The scheduler's HTTP call gives up at 120s. */
  budgetMs: z.number().int().min(15_000).max(110_000).optional(),
  /* List stores and campaigns now, rather than on the six-hour clock. */
  discover: z.boolean().optional(),
  /* false: ad figures only, this run. */
  sparks: z.boolean().optional(),
});

/* The first month backfilled. No unit is ever created for an earlier month. */
const BACKFILL_FROM = '2026-06-01';
/* Euka serves spark codes for the most recent 60 days only. Stay inside it. */
const SPARK_DAYS = 58;
/*
 * How far back day-grain figures are kept. Rashid chose 90 on 2026-10-13, so
 * "last 7 days", "last 30 days" and the current quarter all answer exactly.
 * Anything older still answers from the month table, which is where all the
 * history lives — wide rather than wrong, and exactly what the page does today.
 */
const AD_DAYS = 90;
/* Euka answers, or gives up with a 504, by about 50s. Never start a call with less left. */
const CALL_MS = 58_000;
const UNIT_WORKERS = 4;
/* Two, against the months' four. See the note where the pool is started. */
const DAY_WORKERS = 2;
const SPARK_WORKERS = 2;
const DISCOVER_EVERY_MS = 6 * 60 * 60 * 1000;
/* "Done, unless something asks again." A closed month does not move. */
const NEVER = '2999-01-01T00:00:00Z';
const SPARK_CAP = 150;

type Db = SupabaseClient;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const todayUtc = () => iso(new Date());
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return iso(new Date(Date.UTC(y, m, 1) - 86_400_000));
}

function monthsFrom(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  const [ly, lm] = last.split('-').map(Number) as [number, number];
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function lastDays(n: number): string[] {
  const d = new Date();
  return Array.from({ length: n }, (_, i) =>
    iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i))),
  );
}

const daysAgo = (day: string) =>
  (Date.parse(`${todayUtc()}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;

/* [start, end] in seven-day pieces, inclusive, never past `end`. */
function weekWindows(start: string, end: string): [string, string][] {
  const out: [string, string][] = [];
  let s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  while (s <= e) {
    const stop = Math.min(s + 6 * 86_400_000, e);
    out.push([iso(new Date(s)), iso(new Date(stop))]);
    s = stop + 86_400_000;
  }
  return out;
}

async function getJson(url: string, auth: EukaAuth, ms: number): Promise<{ status: number; body: any }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: auth, signal: ctl.signal });
    const text = await r.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { status: r.status, body };
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError';
    return { status: 599, body: { error: aborted ? `no answer within ${ms / 1000}s` : String((e as Error).message) } };
  } finally {
    clearTimeout(timer);
  }
}

/* The message alone said "Input validation failed" for a month and nothing about WHICH input. Euka
   puts the reason in `details` / `errors` / `issues`, so the whole body goes in, trimmed. */
/*
 * EUKA NOW REQUIRES `brandId` ON EVERY GMV MAX CALL. From 2026-10-27 each of them answered
 * 400 "Input validation failed" with `issues: ["brandId: Invalid UUID format"]` for every store,
 * and this sync stopped writing that day. The brand is found the way the data exports find it
 * (its name matched to the store's), once per store per run. A store with no matching brand
 * sends no brandId, as before.
 */
const brandIdMemo = new Map<string, Promise<string>>();
const brandOf = (auth: EukaAuth, storeId: string, name: string): Promise<string> => {
  let p = brandIdMemo.get(storeId);
  if (!p) brandIdMemo.set(storeId, (p = storeBrandPair(auth, storeId, name).catch(() => '')));
  return p;
};
const withBrand = (q: URLSearchParams, brandId: string): URLSearchParams => {
  if (brandId) q.set('brandId', brandId);
  return q;
};

const errText = (r: { status: number; body: any }) => {
  const msg = String(r.body?.error?.message ?? r.body?.error ?? r.body?.message ?? r.body?.raw ?? '').slice(0, 200);
  let more = '';
  try {
    const extra = r.body?.error?.details ?? r.body?.details ?? r.body?.errors ?? r.body?.issues ?? r.body?.error;
    if (extra && typeof extra === 'object') more = ' ' + JSON.stringify(extra).slice(0, 400);
  } catch { /* an odd body must never break the sync */ }
  return `${r.status} ${msg}${more}`.trim();
};

/* Current month: every day. A month closed less than eight days ago: every day,
   because TikTok restates spend for about a week. Older: done. */
function dueAfterSuccess(month: string): string {
  const end = monthEnd(month);
  if (end >= todayUtc() || daysAgo(end) < 8) return new Date(Date.now() + 20 * 3600_000).toISOString();
  return NEVER;
}

/*
 * A DAY IS FINISHED THE MOMENT EUKA STOPS REWRITING IT.
 *
 * THREE DAYS, AND THE NUMBER IS THE WHOLE POINT. An earlier version of this
 * used eight, to match the month path's restate window, with a comment
 * claiming day grain would cost fewer calls than months. That was wrong, and
 * badly: a month unit is ONE call kept warm, while eight open days are eight.
 * Worked through against dev's 471 month units (~94 campaigns):
 *
 *   months            ~94 campaigns x 1 open month, every 20h   ~110 calls/day
 *   days, 8-day window ~94 x 8, every 20h                       ~900 calls/day
 *   days, 3-day window ~94 x 3, every 20h                       ~340 calls/day
 *
 * Three is Euka's own documented rewrite window — it restates the last 3 days
 * of its sync and nothing earlier — so holding days open past that buys
 * nothing but calls. It is still ~3x the month path, which is the honest price
 * of being able to answer "last 7 days" at all, and it is bounded: a day older
 * than three is fetched once and never asked again.
 */
function dueAfterDaySuccess(day: string): string {
  if (daysAgo(day) < 3) return new Date(Date.now() + 20 * 3600_000).toISOString();
  return NEVER;
}

/* 10 minutes, then 20, 40 … capped at 12 hours. */
const retryAfter = (attempts: number) =>
  new Date(Date.now() + Math.min(10 * 60_000 * 2 ** Math.max(0, attempts - 1), 12 * 3600_000)).toISOString();

/* ═══ 1 · WHICH STORES ARE CONNECTED, AND WHICH CAMPAIGNS EXIST ═══════════ */
async function discover(db: Db, index: StoreIndex) {
  const months = monthsFrom(BACKFILL_FROM, monthOf(todayUtc()));
  const sparkDays = lastDays(SPARK_DAYS);
  const adDays = lastDays(AD_DAYS);
  let connected = 0;
  let unitsSeen = 0;
  let dayUnitsSeen = 0;
  const problems: string[] = [];

  await Promise.all(index.stores.map(async (s) => {
    const auth = index.ownerOf.get(s.id)!;
    /* 50s: Penetrex's lookup ran past 30s on the first live run, and a timeout here left the
       whole store unqueued. */
    const brandId = await brandOf(auth, s.id, s.name);
    const adv = await getJson(`${EUKA_V1}/gmv-max/advertisers?${withBrand(new URLSearchParams({ storeId: s.id }), brandId)}`, auth, 50_000);

    /* "TikTok Ads is not connected for this store" is an ANSWER, not an error. */
    if (adv.status === 404) {
      await db.from('euka_ad_sync_stores').upsert({
        store_id: s.id, store_name: s.name, connected: false,
        advertisers: 0, campaigns_listed: 0, campaigns_reported: 0,
        last_error: null, checked_at: nowIso(),
      });
      return;
    }
    if (adv.status !== 200) {
      problems.push(`${s.name}: ${errText(adv)}`);
      await db.from('euka_ad_sync_stores').upsert({
        store_id: s.id, store_name: s.name, connected: null,
        last_error: `advertisers: ${errText(adv)}`, checked_at: nowIso(),
      });
      return;
    }

    connected += 1;
    const advertisers: any[] = Array.isArray(adv.body?.advertisers) ? adv.body.advertisers : [];
    let listed = 0;
    let missing = 0;
    const units: Record<string, unknown>[] = [];
    const dayUnits: Record<string, unknown>[] = [];

    for (const a of advertisers) {
      const advertiserId = String(a?.advertiserId ?? '');
      if (!advertiserId) continue;
      const found = new Map<string, any>();
      /*
       * THREE LISTS, because the default holds only live campaigns and a paused
       * or deleted one can still have spent inside a month being read.
       */
      /* The three lists in PARALLEL, each capped at 25s. Asked one after another
         at up to 50s each, a slow store kept a run past the gateway's 150s
         limit, and the cut-off run left the units it had claimed leased. */
      const lists = await Promise.all([null, 'STATUS_DISABLE', 'STATUS_DELETE'].map(async (status) => {
        const q = withBrand(new URLSearchParams({ storeId: s.id, advertiserId }), brandId);
        /* Euka now also REQUIRES a date window on the campaign list (400 "startDate: expected string,
           received undefined", 2026-11-27). The whole backfill window (under the 365 days Euka allows), so a campaign that spent in any
           month being read is listed. */
        q.set('startDate', months[0]!);
        q.set('endDate', todayUtc());
        if (status) q.set('primaryStatus', status);
        return { status, r: await getJson(`${EUKA_V1}/gmv-max/campaigns?${q}`, auth, 25_000) };
      }));
      for (const { status, r } of lists) {
        if (r.status !== 200) {
          problems.push(`${s.name} campaigns ${status ?? 'live'}: ${errText(r)}`);
          continue;
        }
        const list: any[] = Array.isArray(r.body?.campaigns) ? r.body.campaigns : [];
        const total = Number(r.body?.pageInfo?.totalNumber ?? list.length);
        if (total > list.length) missing += total - list.length;
        for (const c of list) if (c?.campaignId) found.set(String(c.campaignId), c);
      }
      listed += found.size;

      for (const c of found.values()) {
        /* A campaign cannot have spent before it existed. */
        const created = /^\d{4}-\d{2}-\d{2}/.test(String(c.createTime ?? ''))
          ? monthOf(String(c.createTime).slice(0, 10))
          : BACKFILL_FROM;
        for (const m of months) {
          if (m < created) continue;
          units.push({
            advertiser_id: advertiserId,
            campaign_id: String(c.campaignId),
            month: m,
            store_id: s.id,
            store_name: s.name,
            advertiser_name: String(a.advertiserName ?? ''),
            campaign_name: String(c.campaignName ?? ''),
          });
        }
        /* The same campaign, as DAYS, for the recent window. `created` is a
           month boundary, so compare on the day's own month rather than
           dropping every day of the month a campaign started in. */
        for (const d of adDays) {
          if (monthOf(d) < created) continue;
          dayUnits.push({
            advertiser_id: advertiserId,
            campaign_id: String(c.campaignId),
            day: d,
            store_id: s.id,
            store_name: s.name,
            advertiser_name: String(a.advertiserName ?? ''),
            campaign_name: String(c.campaignName ?? ''),
          });
        }
      }
    }

    for (let i = 0; i < units.length; i += 500) {
      /* ignoreDuplicates: a unit already known keeps its status and schedule. */
      const { error } = await db.from('euka_ad_sync_units')
        .upsert(units.slice(i, i + 500), { onConflict: 'advertiser_id,campaign_id,month', ignoreDuplicates: true });
      if (error) problems.push(`${s.name} units: ${error.message}`);
    }
    unitsSeen += units.length;

    for (let i = 0; i < dayUnits.length; i += 500) {
      /* Same `ignoreDuplicates`: a day already fetched keeps its status, so
         rediscovery every six hours never re-opens finished days and the
         backfill cannot restart itself. */
      const { error } = await db.from('euka_ad_sync_days')
        .upsert(dayUnits.slice(i, i + 500), { onConflict: 'advertiser_id,campaign_id,day', ignoreDuplicates: true });
      if (error) problems.push(`${s.name} day units: ${error.message}`);
    }
    dayUnitsSeen += dayUnits.length;

    const { error: dayErr } = await db.from('euka_spark_sync_days')
      .upsert(sparkDays.map((day) => ({ store_id: s.id, day })), { onConflict: 'store_id,day', ignoreDuplicates: true });
    if (dayErr) problems.push(`${s.name} spark days: ${dayErr.message}`);

    await db.from('euka_ad_sync_stores').upsert({
      store_id: s.id,
      store_name: s.name,
      connected: true,
      advertisers: advertisers.length,
      campaigns_listed: listed,
      campaigns_reported: listed + missing,
      last_error: missing
        ? `Euka reports ${listed + missing} campaigns but lists ${listed}; it refuses page and pageSize, so ${missing} cannot be read`
        : null,
      checked_at: nowIso(),
    });
  }));

  return { stores: index.stores.length, connected, units: unitsSeen, dayUnits: dayUnitsSeen, problems: problems.slice(0, 10) };
}

/* ═══ 2a · ONE CAMPAIGN'S DAY ════════════════════════════════════════════ */
/*
 * The same call as `processUnit`, for a single day, and simpler in one way that
 * matters: a one-day window is already the narrowest thing Euka can be asked
 * for, so there is no week-splitting fallback. If a single day times out
 * repeatedly there is nothing left to narrow, and it simply retries on the
 * usual backoff.
 */
async function processDayUnit(db: Db, index: StoreIndex, u: any, deadline: number): Promise<boolean> {
  const where = (q: any) =>
    q.eq('advertiser_id', u.advertiser_id).eq('campaign_id', u.campaign_id).eq('day', u.day);

  const fail = async (message: string, transient = false) => {
    const attempts = Number(u.attempts ?? 0) + 1;
    const due = transient && attempts <= 20
      ? new Date(Date.now() + 4 * 60_000).toISOString()
      : retryAfter(attempts);
    await where(db.from('euka_ad_sync_days').update({
      status: 'failed', attempts, last_error: message.slice(0, 300),
      due_at: due, updated_at: nowIso(),
    }));
    return false;
  };

  const auth = index.ownerOf.get(u.store_id);
  if (!auth) return fail('no Euka key we hold owns this store any more');

  const day = String(u.day);
  /* A day that has not happened yet is not a failure; it is simply not due. */
  if (day > todayUtc()) {
    await where(db.from('euka_ad_sync_days').update({ due_at: `${day}T01:00:00Z`, updated_at: nowIso() }));
    return true;
  }

  const q = withBrand(new URLSearchParams({
    storeId: u.store_id, advertiserId: u.advertiser_id, campaignId: u.campaign_id,
    startDate: day, endDate: day,
  }), await brandOf(auth, u.store_id, index.stores.find((st) => st.id === u.store_id)?.name ?? ''));
  const url = `${EUKA_V1}/gmv-max/reports/item?${q}`;
  const before = deadline - Date.now();
  if (before < 12_000) return fail('time ran out before the call could be made', true);

  let r = await getJson(url, auth, Math.min(CALL_MS, Math.max(10_000, before - 2_000)));
  /* Same warm-retry rule as the month path: Euka keeps working after it gives
     up on us and keeps the answer, so one immediate retry is worth it when a
     slow second answer still fits inside this run. */
  const left = deadline - Date.now();
  if (r.status >= 500 && left > 50_000) r = await getJson(url, auth, Math.min(CALL_MS, left - 2_000));
  if (r.status !== 200) return fail(`item report (${day}): ${errText(r)}`, r.status >= 500);
  if (r.body?.truncated) {
    return fail(`item report (${day}): Euka marked the rows truncated, so they are not the whole day; nothing was stored`);
  }

  const rowsIn: any[] = Array.isArray(r.body?.rows) ? r.body.rows : [];
  const byItem = new Map<string, { item_id: string; cost: number; orders: number; gross_revenue: number; currency: string | null }>();
  for (const row of rowsIn) {
    const id = String(row?.itemId ?? '');
    if (!/^[0-9]{6,32}$/.test(id)) continue;
    const cost = Number(row.cost) || 0;
    const orders = Number(row.orders) || 0;
    const revenue = Number(row.grossRevenue) || 0;
    /* Only rows where something moved, so an untouched day stores nothing and
       the table stays about spend rather than about campaigns. */
    if (!cost && !orders && !revenue) continue;
    const cur = byItem.get(id) ?? { item_id: id, cost: 0, orders: 0, gross_revenue: 0, currency: row.currency ?? null };
    if (row.currency && cur.currency && row.currency !== cur.currency) {
      return fail(`item report (${day}): video ${id} came back in two currencies (${cur.currency}, ${row.currency})`);
    }
    cur.cost += cost;
    cur.orders += orders;
    cur.gross_revenue += revenue;
    byItem.set(id, cur);
  }
  const rows = [...byItem.values()].map((x) => ({
    ...x,
    cost: Math.round(x.cost * 100) / 100,
    gross_revenue: Math.round(x.gross_revenue * 100) / 100,
  }));

  const { error } = await db.rpc('euka_ad_replace_day', {
    p_advertiser_id: u.advertiser_id,
    p_campaign_id: u.campaign_id,
    p_day: day,
    p_store_id: u.store_id,
    p_rows: rows,
  });
  if (error) return fail(`store rows: ${error.message}`);

  await where(db.from('euka_ad_sync_days').update({
    status: 'ok', attempts: 0, row_count: rows.length,
    cost: Math.round(rows.reduce((t, x) => t + x.cost, 0) * 100) / 100,
    last_error: null, synced_at: nowIso(), due_at: dueAfterDaySuccess(day), updated_at: nowIso(),
  }));
  return true;
}

/* ═══ 2 · ONE CAMPAIGN'S MONTH ═══════════════════════════════════════════ */
async function processUnit(db: Db, index: StoreIndex, u: any, deadline: number): Promise<boolean> {
  const where = (q: any) =>
    q.eq('advertiser_id', u.advertiser_id).eq('campaign_id', u.campaign_id).eq('month', u.month);

  /* `transient`: Euka's 504, or our own timeout. Measured: those come back warm within
     minutes, so they are tried again on the next run or two instead of backing off for hours. */
  const fail = async (message: string, transient = false) => {
    const attempts = Number(u.attempts ?? 0) + 1;
    /* Up to 20 tries, four minutes apart. In week mode every try warms more of
       the month at Euka, and hours of backoff would throw that progress away. */
    const due = transient && attempts <= 20
      ? new Date(Date.now() + 4 * 60_000).toISOString()
      : retryAfter(attempts);
    await where(db.from('euka_ad_sync_units').update({
      status: 'failed', attempts, last_error: message.slice(0, 300),
      due_at: due, updated_at: nowIso(),
    }));
    return false;
  };

  const auth = index.ownerOf.get(u.store_id);
  if (!auth) return fail('no Euka key we hold owns this store any more');

  const start = String(u.month);
  const today = todayUtc();
  if (start > today) {
    await where(db.from('euka_ad_sync_units').update({ due_at: `${start}T01:00:00Z`, updated_at: nowIso() }));
    return true;
  }
  const end = monthEnd(start) < today ? monthEnd(start) : today;

  /*
   * A CAMPAIGN-MONTH THAT KEEPS TIMING OUT IS ASKED FOR A WEEK AT A TIME.
   *
   * Euka's 504 says it outright: "Narrow the date range". On 2026-09-15 a few
   * large Cutler Nutrition campaigns timed out on every attempt, warm or not,
   * for four months running. Splitting a window and summing was proven exact
   * the same day (seven single days = one seven-day call, to the cent), so
   * after three failures the month is read in weeks. If any week fails nothing
   * is stored and the unit is due again shortly; the weeks that did answer are
   * then warm at Euka and come back in seconds.
   */
  const windows: [string, string][] = Number(u.attempts ?? 0) >= 3 ? weekWindows(start, end) : [[start, end]];
  const allRows: any[] = [];
  for (let w = 0; w < windows.length; w++) {
    const [ws, we] = windows[w]!;
    const q = withBrand(new URLSearchParams({
      storeId: u.store_id, advertiserId: u.advertiser_id, campaignId: u.campaign_id,
      startDate: ws, endDate: we,
    }), await brandOf(auth, u.store_id, index.stores.find((st) => st.id === u.store_id)?.name ?? ''));
    const url = `${EUKA_V1}/gmv-max/reports/item?${q}`;
    const before = deadline - Date.now();
    if (w > 0 && before < 15_000) {
      return fail(`item report: time ran out after ${w} of ${windows.length} weeks; nothing stored, due again shortly`, true);
    }
    let r = await getJson(url, auth, Math.min(CALL_MS, Math.max(10_000, before - 2_000)));
    /*
     * WHEN AN IMMEDIATE RETRY IS WORTH MAKING. Measured on dev: a 504 at ~49s,
     * the identical request straight after answered 200 in 45.7s, and requests
     * made minutes later answered in 5 to 8 seconds. Euka keeps working after it
     * gives up on us, and keeps the answer. So retry at once only when a SLOW
     * second answer still fits in this run; otherwise leave it for a run four
     * minutes on, when it will be warm.
     */
    const left = deadline - Date.now();
    if (r.status >= 500 && left > 50_000) r = await getJson(url, auth, Math.min(CALL_MS, left - 2_000));
    if (r.status !== 200) {
      const which = windows.length > 1 ? ` (week ${w + 1} of ${windows.length}, ${ws} to ${we})` : '';
      return fail(`item report${which}: ${errText(r)}`, r.status >= 500);
    }
    if (r.body?.truncated) {
      return fail('item report: Euka marked the rows truncated, so they are not the whole month; nothing was stored');
    }
    if (Array.isArray(r.body?.rows)) allRows.push(...r.body.rows);
  }

  /* One video can sit under several products in one campaign: sum it. */
  const byItem = new Map<string, { item_id: string; cost: number; orders: number; gross_revenue: number; currency: string | null }>();
  for (const row of allRows) {
    const id = String(row?.itemId ?? '');
    if (!/^[0-9]{6,32}$/.test(id)) continue;
    const cost = Number(row.cost) || 0;
    const orders = Number(row.orders) || 0;
    const revenue = Number(row.grossRevenue) || 0;
    if (!cost && !orders && !revenue) continue;
    const cur = byItem.get(id) ?? { item_id: id, cost: 0, orders: 0, gross_revenue: 0, currency: row.currency ?? null };
    if (row.currency && cur.currency && row.currency !== cur.currency) {
      return fail(`item report: video ${id} came back in two currencies (${cur.currency}, ${row.currency})`);
    }
    cur.cost += cost;
    cur.orders += orders;
    cur.gross_revenue += revenue;
    byItem.set(id, cur);
  }
  const rows = [...byItem.values()].map((x) => ({
    ...x,
    cost: Math.round(x.cost * 100) / 100,
    gross_revenue: Math.round(x.gross_revenue * 100) / 100,
  }));

  const { error } = await db.rpc('euka_ad_replace_unit', {
    p_advertiser_id: u.advertiser_id,
    p_campaign_id: u.campaign_id,
    p_month: start,
    p_store_id: u.store_id,
    p_rows: rows,
  });
  if (error) return fail(`store rows: ${error.message}`);

  await where(db.from('euka_ad_sync_units').update({
    status: 'ok', attempts: 0, row_count: rows.length,
    cost: Math.round(rows.reduce((t, x) => t + x.cost, 0) * 100) / 100,
    last_error: null, synced_at: nowIso(), due_at: dueAfterSuccess(start), updated_at: nowIso(),
  }));
  return true;
}

/* ═══ 3 · ONE STORE'S DAY OF SPARK CODES ════════════════════════════════ */
async function processSparkDay(
  db: Db, index: StoreIndex, d: any, deadline: number, brandIds: Map<string, Promise<string>>,
): Promise<boolean> {
  const where = (q: any) => q.eq('store_id', d.store_id).eq('day', d.day);
  const fail = async (message: string) => {
    const attempts = Number(d.attempts ?? 0) + 1;
    await where(db.from('euka_spark_sync_days').update({
      status: 'failed', attempts, last_error: message.slice(0, 300), due_at: retryAfter(attempts),
    }));
    return false;
  };

  const auth = index.ownerOf.get(d.store_id);
  if (!auth) return fail('no Euka key we hold owns this store any more');
  const day = String(d.day);
  if (daysAgo(day) >= 60) {
    await where(db.from('euka_spark_sync_days').update({
      status: 'ok', last_error: 'older than the 60 days Euka serves spark codes for', due_at: NEVER,
    }));
    return true;
  }

  const name = index.stores.find((s) => s.id === d.store_id)?.name ?? '';
  if (!brandIds.has(d.store_id)) brandIds.set(d.store_id, storeBrandPair(auth, d.store_id, name));
  const brandId = await brandIds.get(d.store_id)!;

  const url = `${EUKA_V0}/data-export?type=spark_codes_video_download_links` +
    `&store_id=${encodeURIComponent(d.store_id)}` +
    (brandId ? `&brand_id=${encodeURIComponent(brandId)}` : '') +
    `&start_date=${day}&end_date=${day}&export_type=json`;
  let r = await getJson(url, auth, CALL_MS);
  if (r.status >= 500 && Date.now() + CALL_MS < deadline) r = await getJson(url, auth, CALL_MS);
  if (r.status !== 200) return fail(`spark export: ${errText(r)}`);

  const rows: any[] = Array.isArray(r.body) ? r.body : Array.isArray(r.body?.data) ? r.body.data : [];
  const codes = rows
    .filter((x) => /^[0-9]{6,32}$/.test(String(x?.video_id ?? '')) && String(x?.spark_code ?? '').trim())
    .map((x) => {
      const exp = x.spark_code_expiry_date ? Date.parse(String(x.spark_code_expiry_date)) : NaN;
      return {
        item_id: String(x.video_id),
        store_id: d.store_id,
        spark_code: String(x.spark_code).trim(),
        expired: x.spark_code_expired === true || String(x.spark_code_expired).toLowerCase() === 'true',
        expires_at: Number.isFinite(exp) ? new Date(exp).toISOString() : null,
        posted_date: /^\d{4}-\d{2}-\d{2}/.test(String(x.posted_date ?? '')) ? String(x.posted_date).slice(0, 10) : null,
        synced_at: nowIso(),
      };
    });
  for (let i = 0; i < codes.length; i += 500) {
    const { error } = await db.from('euka_spark_codes').upsert(codes.slice(i, i + 500), { onConflict: 'item_id' });
    if (error) return fail(`store codes: ${error.message}`);
  }

  await where(db.from('euka_spark_sync_days').update({
    status: 'ok', attempts: 0, row_count: rows.length,
    /* 150 is Euka's ceiling per call: a full day may be missing codes. Recorded, never hidden. */
    capped: rows.length >= SPARK_CAP,
    last_error: rows.length >= SPARK_CAP ? `Euka returned its ${SPARK_CAP}-row maximum for this day, so some codes may be missing` : null,
    synced_at: nowIso(),
    /* The last three days still gain codes as creators share them. */
    due_at: daysAgo(day) <= 3 ? new Date(Date.now() + 20 * 3600_000).toISOString() : NEVER,
  }));
  return true;
}

/* ═══ a pool of workers that claim due work until time runs short ════════ */
/*
 * EACH WORKER CLAIMS ONE UNIT, AT THE MOMENT IT IS ABOUT TO WORK ON IT.
 *
 * The first version claimed two per worker in a batch. A claim is a ten-minute
 * lease, so whatever a run claimed and did not reach before its time ran out
 * was pushed ten minutes back, every run. Dr Tobias's August "All Products"
 * campaign was claimed run after run for over an hour and never once fetched.
 * Claiming only at the moment of work leaves nothing claimed and untouched.
 */
async function pool<T>(
  workers: number,
  deadline: number,
  claim: (n: number) => Promise<T[]>,
  run: (item: T) => Promise<boolean>,
) {
  const tally = { ok: 0, failed: 0 };
  const worker = async () => {
    while (Date.now() + CALL_MS < deadline) {
      const [item] = await claim(1);
      if (item === undefined) return;
      if (await run(item)) tally.ok += 1;
      else tally.failed += 1;
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return tally;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);
  const started = Date.now();

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  /* ── who is asking ───────────────────────────────────────────────────── */
  /* TIMING SAFE comparison on the scheduler's secret, as tiktok-sync does. */
  const secret = Deno.env.get('EUKA_ADS_SYNC_SECRET') ?? '';
  const presented = req.headers.get('x-sync-secret') ?? '';
  let isCron = false;
  if (secret && presented) {
    const a = new TextEncoder().encode(presented);
    const b = new TextEncoder().encode(secret);
    if (a.length === b.length) {
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
      isCron = diff === 0;
    }
  }
  if (!isCron) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not allowed' }, 401, req);
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: 'Not allowed' }, 401, req);
    const { data: profile } = await db.from('profiles').select('role, is_active').eq('id', who.user.id).single();
    /* Staff only. A manual kick spends Euka calls, which is not a reader's decision. */
    if (!profile?.is_active || !['ops', 'admin', 'ads_manager', 'ops_lead'].includes(profile.role)) {
      return json({ error: 'Not allowed' }, 403, req);
    }
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    /* an empty body is a scheduled run */
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) return json({ error: 'Bad request' }, 400, req);
  const deadline = started + (parsed.data.budgetMs ?? 100_000);

  const keys = eukaKeys();
  if (keys.length === 0) {
    return json({ error: 'No EUKA key is set on this project (EUKA_API_KEY, or EUKA_API_KEYS)' }, 500, req);
  }

  try {
    const index = await indexStores(keys);
    if (index.stores.length === 0) {
      throw new Error(`no Euka account answered (${index.unavailable} of ${index.total} unavailable)`);
    }

    const { data: oldest } = await db.from('euka_ad_sync_stores')
      .select('checked_at').order('checked_at', { ascending: true }).limit(1);
    /* A store whose lookup FAILED (connected unknown) is looked at again on the next run, not in six
       hours: otherwise one slow answer leaves a connected brand with nothing queued all afternoon. */
    const { count: unresolved } = await db.from('euka_ad_sync_stores')
      .select('*', { count: 'exact', head: true }).is('connected', null);
    const stale = !oldest?.length || (unresolved ?? 0) > 0 ||
      Date.now() - Date.parse(oldest[0].checked_at) > DISCOVER_EVERY_MS;
    const discovered = parsed.data.discover || stale ? await discover(db, index) : null;
    /* Discovery can take most of a run on its own when a store answers slowly,
       and a run past 150s is cut off by the gateway mid-unit, leaving its claims
       leased. So a run that discovered stops here; the next one does the work. */
    if (discovered) {
      return json({ ranMs: Date.now() - started, trigger: isCron ? 'schedule' : 'staff', discovered, units: null, dayUnits: null, sparks: null }, 200, req);
    }

    const brandIds = new Map<string, Promise<string>>();
    const [units, dayUnits, sparks] = await Promise.all([
      pool<any>(UNIT_WORKERS, deadline,
        async (n) => {
          const { data, error } = await db.rpc('euka_ad_claim_units', { p_limit: n });
          if (error) throw new Error(`claim units: ${error.message}`);
          return data ?? [];
        },
        (u) => processUnit(db, index, u, deadline)),
      /*
       * THE DAY BACKFILL RUNS BESIDE THE MONTHS, NOT INSTEAD OF THEM.
       *
       * Fewer workers on purpose. The months are what every screen reads today
       * and they must not get slower while ninety days of history fills in
       * behind them; the days are a backfill that only has to finish
       * eventually, and once it has, a day older than the restate window never
       * becomes due again. Steady state is a couple of days per campaign.
       */
      pool<any>(DAY_WORKERS, deadline,
        async (n) => {
          const { data, error } = await db.rpc('euka_ad_claim_days', { p_limit: n });
          if (error) throw new Error(`claim day units: ${error.message}`);
          return data ?? [];
        },
        (u) => processDayUnit(db, index, u, deadline)),
      parsed.data.sparks === false
        ? Promise.resolve(null)
        : pool<any>(SPARK_WORKERS, deadline,
          async (n) => {
            const { data, error } = await db.rpc('euka_spark_claim_days', { p_limit: n });
            if (error) throw new Error(`claim spark days: ${error.message}`);
            return data ?? [];
          },
          (d) => processSparkDay(db, index, d, deadline, brandIds)),
    ]);

    /*
     * THE CLIENT PAGE'S TIER AND L30 GMV, ONE STORE PER RUN.
     *
     * It lives here because this function is already the place that spends
     * Euka's time on a schedule. It was briefly inside `collab-share`, where
     * two heavy exports in the request path left the next client view queued
     * behind them and two in five timed out. Only when this run has a minute
     * to spare, so it can never be the reason a run is cut off mid-unit.
     */
    const tierCache = Date.now() < deadline - 60_000
      ? await refreshOneStaleStore(db, index.stores, (id) => index.ownerOf.get(id))
      : null;

    /*
     * FOLLOWER COUNTS FOR THE PEOPLE EUKA'S SHOP DATA DOES NOT COVER.
     *
     * A small batch per run, so 464 handles fill in over a few hours and stay
     * fresh on a monthly re-check, without this ever being the reason a run is
     * cut off. Any account's key will do: market intelligence is about TikTok,
     * not about one of our shops.
     */
    const followers = Date.now() < deadline - 40_000
      ? await fillFollowers(db, index.ownerOf.get(index.stores[0]?.id ?? ''), deadline).catch(() => null)
      : null;

    const now = nowIso();
    const { count: unitsDue } = await db.from('euka_ad_sync_units')
      .select('*', { count: 'exact', head: true }).lte('due_at', now);
    const { count: sparkDaysDue } = await db.from('euka_spark_sync_days')
      .select('*', { count: 'exact', head: true }).lte('due_at', now);
    const { count: adDaysDue } = await db.from('euka_ad_sync_days')
      .select('*', { count: 'exact', head: true }).lte('due_at', now);
    /* How far back the day grain actually reaches. This is what decides whether
       a range picker answers exactly or falls back to whole months, so it is
       worth having in the run log rather than only in the database. */
    const { data: dayCoverage } = await db.rpc('euka_ad_day_coverage').maybeSingle();

    return json({
      ranMs: Date.now() - started,
      trigger: isCron ? 'schedule' : 'staff',
      discovered,
      units,
      dayUnits,
      sparks,
      dayCoverage: dayCoverage ?? null,
      stillDue: { units: unitsDue ?? null, sparkDays: sparkDaysDue ?? null, adDays: adDaysDue ?? null },
      tierCache,
      followers,
      eukaAccountsUnavailable: index.unavailable,
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 300), ranMs: Date.now() - started }, 502, req);
  }
});
