import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * Ad spend, ROI and spark codes for the videos inside Paid Collabs.
 *
 * THIS FILE IS THE SEAM, AND IT IS OURS. The vendored WurxBase app in
 * `src/vendor/wurxbase/` holds the creators and their delivered video URLs; we
 * hold what those videos cost to advertise and what they sold. Everything that
 * touches OUR database lives here, and the vendored code only ever reads the
 * answers out of a context.
 *
 * That split is what `pnpm verify:isolation` is protecting, and the guard names
 * this exact arrangement itself: "If it needs something of ours, pass it in as
 * a prop from the route." The vendored app never imports our Supabase client
 * and never names our project; our code never names either of theirs.
 *
 * THE SOURCE IS EUKA, since 2026-09-15. Rashid: "when euka is giving data we
 * can rely on euka … let's move with euka for now". The figures are EUKA's GMV
 * Max item reports, copied into `euka_ad_video_month` by the `euka-ads-sync`
 * function, because a live call takes up to a minute (see that function). The
 * earlier source, our own TikTok connection through `ads_totals_for_videos`,
 * still exists and still serves creators' My numbers; it is no longer read
 * here. On the day of the switch Euka held figures for 21 of 23 matched
 * Penetrex videos that our own data had missed, and where both had a figure
 * they agreed to within 3%.
 *
 * THE JOIN IS EXACT AND NEEDS NO BRAND MATCHING. Their videos are TikTok URLs;
 * Euka's `itemId` is TikTok's own id for the same video. So a video either has
 * figures or it does not, per video, and a brand lights up the moment its ad
 * account is connected inside Euka.
 */

/*
 * THE ARITHMETIC LIVES IN `collab-ad-math.ts`, and is re-exported here.
 *
 * Not a tidiness split. That file is pure, imports nothing and touches no
 * database, which is what lets `pnpm verify:collab-ads` transpile it and test
 * the money rules directly in Node. Re-exporting rather than duplicating means
 * the implementation under test is the implementation that ships.
 */
export {
  tiktokVideoId,
  videoIdsOf,
  totalsOf,
  money,
  roiText,
} from './collab-ad-math';

import type { AdFigures } from './collab-ad-math';

/** The spark code Euka holds for one video. */
type SparkCode = { code: string; expired: boolean };

type Ctx = {
  /** Register video ids to fetch. Safe to call during render. */
  ensure: (itemIds: string[]) => void;
  /** What we know about one video, FOR THE CURRENT PERIOD. `null` = no data. */
  get: (itemId: string) => AdFigures | null;
  /**
   * The spark code Euka holds for one video, or `null`. Not tied to a month:
   * a code belongs to the video, not to a period.
   */
  spark: (itemId: string) => SparkCode | null;
  /**
   * Which month these figures cover. `''` means all time.
   *
   * SET FROM THE VENDORED APP'S OWN MONTH SELECTOR, so the two columns cover
   * the same period as the budget and the GMV beside them. A lifetime ad spend
   * in a row of August figures is not a rounding difference, it is a different
   * period in the same line of numbers.
   */
  setMonth: (monthKey: string) => void;
  /** The month currently in force, for labelling. */
  month: string;
  /** True once at least one fetch has come back, so the UI can skeleton. */
  ready: boolean;
  loading: boolean;
  error: string | null;
  /**
   * Follower counts looked up by handle in Euka's market intelligence, for the
   * creators its shop exports do not cover. Keyed by handle: lower case, no @.
   * Only exact handle matches are ever stored (see the migration
   * 20260918160000_euka_creator_followers.sql). The screen uses these only when
   * the live shop data has no figure.
   */
  storedFollowers: Map<string, number>;
  /**
   * A picture for a brand EUKA has no store for, keyed by the brand name in
   * lower case. Paid Collabs draws every brand face from Euka's store photo;
   * Irwin Naturals sells through Reacher and has no Euka store at all, so
   * without this it is a gradient letter for ever. The screen still PREFERS
   * Euka's photo — this is only consulted when there is none.
   */
  brandPhotos: Map<string, string>;
};

/**
 * `YYYY-MM` to the first and last day of that month. `''` means no bounds.
 *
 * THE LAST DAY IS FOUND BY STEPPING BACK FROM THE FIRST OF THE NEXT MONTH,
 * rather than by a table of lengths, so February and leap years need no special
 * case. Built in UTC on purpose: `new Date(y, m, d)` is local time, and on a
 * machine east of Greenwich that lands the boundary on the wrong day — which
 * for this data means a day's money filed under the wrong month.
 */
function monthBounds(monthKey: string): { from: string | null; to: string | null } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey ?? '');
  if (!m) return { from: null, to: null };
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (!year || mon < 1 || mon > 12) return { from: null, to: null };
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const last = new Date(Date.UTC(year, mon, 1) - 86_400_000);
  return { from: iso(first), to: iso(last) };
}

/**
 * A PERIOD IS EITHER A MONTH OR A RANGE, and this is the one place that knows.
 *
 * Rashid asked for the brand page to take a date range the way the creator side
 * does. Rather than give the provider a second concept to track, a period is
 * still a single string and simply has two shapes:
 *
 *   `2026-09`                  a whole calendar month, exactly as before
 *   `2026-09-01..2026-09-07`   an explicit range, inclusive at both ends
 *   `''`                       no bounds at all, which is All Time
 *
 * Keeping it to one string matters because the period is part of every cache
 * key. Two separate pieces of state would have to be combined into a key
 * anyway, and the moment they could disagree, one of them would end up labelling
 * the other's numbers — which is the exact bug the month key was introduced to
 * prevent.
 *
 * The bounds themselves are what reach `euka_ad_totals_for_videos`, which since
 * 2026-10-13 answers a fully covered range from day-grain rows and falls back
 * to whole months otherwise. So a range here is honoured exactly when the data
 * behind it can honour it, and is never silently widened.
 */
function periodBounds(periodKey: string): { from: string | null; to: string | null } {
  const key = (periodKey ?? '').trim();
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (range) {
    const from = range[1]!;
    const to = range[2]!;
    /* Backwards is a caller's mistake, and the RPC would raise on it. Swapping
       quietly is kinder than an error on a dashboard and loses nothing: the
       only thing a reversed range can mean is the same span. */
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return monthBounds(key);
}

const AdFiguresContext = createContext<Ctx | null>(null);

/** At most this many ids per RPC call; both functions refuse more than 2000. */
const BATCH = 500;

export function CollabAdFiguresProvider({ children }: { children: ReactNode }) {
  /*
   * THE PERIOD IS PART OF EVERY CACHE KEY, and forgetting that is the whole
   * bug this guards against: with a key of just the video id, switching from
   * August to September would serve August's numbers under September's heading
   * and never refetch, because the id had already been "asked for".
   */
  const [month, setMonthState] = useState('');
  /*
   * NOTHING IS FETCHED UNTIL THE PERIOD IS KNOWN, and this is purely about not
   * wasting a request. The rows render before the drilldown's effect has told
   * us which month is on screen, so without this gate the first pass fired a
   * full-sized query for "all time" that nothing would ever display.
   */
  const [monthKnown, setMonthKnown] = useState(false);
  const [known, setKnown] = useState<Map<string, AdFigures | null>>(() => new Map());
  /* Spark codes are keyed by video alone: a code does not change by month. */
  const [sparks, setSparks] = useState<Map<string, SparkCode | null>>(() => new Map());
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* False once the provider unmounts, so nothing writes state into a corpse. */
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  /*
   * `ensure` IS CALLED FROM RENDER, by a table cell that has just discovered
   * which videos its row holds. So it must not call setState: it collects into
   * a ref and schedules one flush, which is what turns dozens of per-row calls
   * into a single request and keeps React out of a render loop.
   */
  const pending = useRef<Set<string>>(new Set());
  const scheduled = useRef(false);
  const [wanted, setWanted] = useState<string[]>([]);
  const asked = useRef<Set<string>>(new Set());
  const sparkAsked = useRef<Set<string>>(new Set());

  /*
   * Changing month invalidates nothing that was fetched — August's answers stay
   * correct for August — so the caches are keyed rather than cleared, and
   * flipping back to a month already looked at costs no request at all.
   */
  const setMonth = useCallback((next: string) => {
    setMonthKnown(true);
    setMonthState((cur) => (cur === (next ?? '') ? cur : (next ?? '')));
  }, []);

  const key = useCallback((id: string, m: string) => `${m}|${id}`, []);

  const ensure = useCallback((itemIds: string[]) => {
    /* Queue nothing yet; the rows re-render as soon as the month lands, because
       the context value changes, and ask again with the right bounds. */
    if (!monthKnown) return;
    let fresh = false;
    for (const id of itemIds) {
      const k = key(id, month);
      if (!id || asked.current.has(k) || pending.current.has(k)) continue;
      pending.current.add(k);
      fresh = true;
    }
    if (!fresh || scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(() => {
      scheduled.current = false;
      const batch = [...pending.current];
      pending.current.clear();
      if (batch.length) setWanted((w) => [...w, ...batch]);
    });
  }, [key, month, monthKnown]);

  useEffect(() => {
    if (wanted.length === 0) return;
    /* `wanted` holds cache keys, "month|id". The id is what the RPC is told. */
    const batch = wanted.filter((k) => !asked.current.has(k));
    if (batch.length === 0) return;
    for (const k of batch) asked.current.add(k);
    const forMonth = batch[0]?.slice(0, batch[0].indexOf('|')) ?? '';
    const ids = batch.map((k) => k.slice(k.indexOf('|') + 1));
    /* `periodBounds`, not `monthBounds`: the key may now be a day range. */
    const { from, to } = periodBounds(forMonth);
    const sparkIds = ids.filter((id) => !sparkAsked.current.has(id));
    for (const id of sparkIds) sparkAsked.current.add(id);

    /*
     * NO PER-RUN CANCELLATION, AND THAT IS THE FIX RATHER THAN AN OMISSION.
     *
     * This effect re-runs whenever `wanted` grows, and changing the month grows
     * it — so a cleanup that set `cancelled = true` discarded the request that
     * was already in flight. Both fetches completed, both returned real rows,
     * and both results were thrown away: every figure on screen showed a dash
     * while the network tab showed 200s full of data.
     *
     * Cancelling was never right here. Results are keyed by "month|id", so an
     * answer that arrives late is still the correct answer for ITS OWN key and
     * can never overwrite a newer one. The only thing worth guarding is writing
     * state after the provider itself unmounts.
     */
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const found = new Map<string, AdFigures>();
        for (let i = 0; i < ids.length; i += BATCH) {
          const slice = ids.slice(i, i + BATCH);
          const { data, error: rpcErr } = await getSupabase().rpc('euka_ad_totals_for_videos', {
            p_item_ids: slice,
            p_from: from ?? undefined,
            p_to: to ?? undefined,
          });
          if (rpcErr) throw rpcErr;
          for (const row of (data ?? []) as Array<{
            item_id: string;
            cost: number | string;
            gross_revenue: number | string;
            orders: number | string;
            currency: string | null;
            mixed_currency: boolean;
          }>) {
            found.set(row.item_id, {
              cost: Number(row.cost) || 0,
              revenue: Number(row.gross_revenue) || 0,
              orders: Number(row.orders) || 0,
              currency: row.currency,
              mixedCurrency: Boolean(row.mixed_currency),
            });
          }
        }

        const codes = new Map<string, SparkCode>();
        for (let i = 0; i < sparkIds.length; i += BATCH) {
          const slice = sparkIds.slice(i, i + BATCH);
          const { data, error: sparkErr } = await getSupabase().rpc('euka_spark_codes_for_videos', {
            p_item_ids: slice,
          });
          if (sparkErr) throw sparkErr;
          for (const row of (data ?? []) as Array<{ item_id: string; spark_code: string; expired: boolean | null }>) {
            codes.set(row.item_id, { code: row.spark_code, expired: Boolean(row.expired) });
          }
        }

        if (!alive.current) return;
        setKnown((prev) => {
          const next = new Map(prev);
          /*
           * EVERY ID ASKED ABOUT IS RECORDED, including the ones with no rows,
           * as an explicit `null`. Otherwise "we have not looked yet" and "we
           * looked and there is nothing" are the same absence, the screen
           * cannot tell a skeleton from a dash, and the missing ids get asked
           * for again on every render.
           */
          for (const id of ids) next.set(key(id, forMonth), found.get(id) ?? null);
          return next;
        });
        if (sparkIds.length) {
          setSparks((prev) => {
            const next = new Map(prev);
            for (const id of sparkIds) next.set(id, codes.get(id) ?? null);
            return next;
          });
        }
        setReady(true);
      } catch (e) {
        if (!alive.current) return;
        /* Let them be asked for again, or a blip becomes permanent blanks. */
        for (const k of batch) asked.current.delete(k);
        for (const id of sparkIds) sparkAsked.current.delete(id);
        setError((e as Error).message);
        setReady(true);
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
  }, [wanted, key]);

  const get = useCallback(
    (itemId: string) => known.get(key(itemId, month)) ?? null,
    [known, key, month]
  );

  const spark = useCallback((itemId: string) => sparks.get(itemId) ?? null, [sparks]);

  /*
   * STORED FOLLOWER COUNTS, READ ONCE. There are a few hundred handles in Paid
   * Collabs, so one paged read of the whole table is simpler and cheaper than
   * asking per row; the table is refreshed by the scheduled sync, not here.
   */
  const [storedFollowers, setStoredFollowers] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let live = true;
    (async () => {
      const out = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const { data, error: fErr } = await getSupabase()
          .from('euka_creator_followers')
          .select('handle, followers')
          .eq('found', true)
          .order('handle')
          .range(from, from + 999);
        if (fErr || !data) break;
        for (const r of data as { handle: string; followers: number | null }[]) {
          if (r.followers) out.set(r.handle, r.followers);
        }
        if (data.length < 1000) break;
      }
      if (live && alive.current) setStoredFollowers(out);
    })();
    return () => {
      live = false;
    };
  }, []);

  /*
   * BRAND PICTURES FOR THE BRANDS EUKA CANNOT DESCRIBE, read once. There are a
   * handful at most — one today — and the bucket is public, so what is stored
   * is a path and the URL is built here rather than signed.
   */
  const [brandPhotos, setBrandPhotos] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error: pErr } = await getSupabase()
        .from('collab_brand_photos')
        .select('brand, path');
      if (pErr || !data) return;
      const base = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/brand-assets/`;
      const out = new Map<string, string>();
      for (const r of data as { brand: string; path: string }[]) {
        if (r.brand && r.path) out.set(r.brand.trim().toLowerCase(), base + r.path);
      }
      if (live && alive.current) setBrandPhotos(out);
    })();
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({ ensure, get, spark, setMonth, month, ready, loading, error, storedFollowers, brandPhotos }),
    [ensure, get, spark, setMonth, month, ready, loading, error, storedFollowers, brandPhotos]
  );

  return <AdFiguresContext.Provider value={value}>{children}</AdFiguresContext.Provider>;
}

/**
 * Read the ad figures. Returns a no-op outside the provider.
 *
 * NEVER THROWS WHEN THE PROVIDER IS ABSENT, because the thing calling it is
 * vendored code we do not want to make fragile. Without a provider the columns
 * simply show nothing, which is the same as having no ad data.
 */
export function useCollabAdFigures(): Ctx {
  return (
    useContext(AdFiguresContext) ?? {
      ensure: () => {},
      get: () => null,
      spark: () => null,
      setMonth: () => {},
      month: '',
      ready: false,
      loading: false,
      error: null,
      storedFollowers: new Map(),
      brandPhotos: new Map(),
    }
  );
}
