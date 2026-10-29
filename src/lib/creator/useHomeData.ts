import { useMemo } from 'react';
import type { ChartPoint } from '@/components/charts';
import { sumDaily } from './daily-totals';
import {
  useBrandPerformance,
  useDailyPerformance,
  usePerformanceWindow,
  useVideoPerformance,
  type DailyPerformance,
  type PerformanceWindow,
} from './usePerformance';
import { useCreatorPeriod, type CreatorPeriod } from './useCreatorPeriod';

/**
 * EVERYTHING HOME NEEDS, FETCHED ONCE AND IN PARALLEL.
 *
 * NO TIKTOK CALL HAPPENS HERE, and that is the property to protect above all
 * others on this screen. Every figure below comes from our own nightly table
 * through four `security definer` RPCs. It is why the period chips are instant
 * and free, why a creator cannot run up a bill, and why she cannot reach
 * TikTok at all from this page. Nothing added to Home may change that.
 *
 * Caching is TanStack Query's, keyed by range and brand, so flipping between
 * 7D and 30D and back does not refetch — §5.2 asks for that explicitly.
 */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * THE FOURTH METRIC IS ORDERS, NOT VIEWS, and the data decided it.
 *
 * §5.1 asks for Views "if it can be read from our own tables without a TikTok
 * call", and otherwise Orders. `DailyPerformance` — the shape
 * `creator_daily_performance` returns — carries `stat_date`, `cost`,
 * `gross_revenue`, `orders`, `videos` and `currency`. There is no view count
 * anywhere in it. Views exist only on `creator_tiktok_videos`, which is
 * populated per video from a live TikTok call, so putting views on Home would
 * mean adding exactly the call §5.2 forbids.
 *
 * Orders is also the better partner for the other three: GMV, ad spend and
 * orders are the same transaction counted three ways, so the four tiles
 * describe one story rather than three.
 */

/**
 * COMMISSION IS NOT MEASURED ANYWHERE, so Home must not pretend otherwise.
 *
 * Searched the whole schema: `commission_rate` exists only on
 * `brand_products`, as a PERCENTAGE WE OFFER on a product — a term of the
 * deal, not a figure she earned. Nothing joins a performance row to the
 * product that produced it, so there is no honest way to turn GMV into
 * commission in this app today.
 *
 * Multiplying total GMV by some average rate would produce a number that looks
 * exactly like money and is not. So the tile renders through the
 * "Not reported" path instead, and the gap is reported to Rashid rather than
 * papered over. Giving this tile a real figure needs a new RPC, and §7's rule
 * applies: ask before changing one.
 */
export const COMMISSION_IS_MEASURED = false;

interface HomeTotals {
  gmv: number;
  spend: number;
  orders: number;
  currency: string | null;
}

export interface HomeData {
  period: CreatorPeriod;
  /** The days we hold anything for. Bounds the custom-range calendar. */
  window: PerformanceWindow | undefined;
  loading: boolean;
  /** True once we know she has no measured days at all, ever. */
  neverAnyData: boolean;
  /** True when THIS period is empty but she does have history elsewhere. */
  emptyPeriodButHasHistory: boolean;
  totals: HomeTotals;
  previous: HomeTotals | null;
  gmvSeries: ChartPoint[];
  spendSeries: ChartPoint[];
  ordersSeries: ChartPoint[];
  /** How many of her videos had ad spend behind them in the period. */
  videosWithAds: number;
  brands: { label: string; value: number; id?: string }[];
  topVideos: ReturnType<typeof useVideoPerformance>['data'];
  currency: string | null;
}

/**
 * Every day in the window, with the days we hold filled in and the rest left
 * EMPTY.
 *
 * A day the RPC did not return is `null`, not `0`. We cannot tell "she sold
 * nothing that day" from "nothing was written for that day", and those are
 * different claims — so the chart shows a gap and says nothing rather than
 * stating the stronger one. This is the §5.3 rule applied at the only place
 * that can apply it.
 */
function toSeries(
  rows: DailyPerformance[] | undefined,
  from: string | null,
  to: string | null,
  pick: (r: DailyPerformance) => number
): ChartPoint[] {
  if (!from || !to) return [];
  const byDate = new Map((rows ?? []).map((r) => [r.stat_date, r]));
  const out: ChartPoint[] = [];
  /* THE AXIS STARTS AT HER FIRST MEASURED DAY, not at the window's floor. The
     floor is the day her first video existed, which can be weeks before the
     first figure landed, and drawing that stretch left most of the chart
     empty. Days AFTER the first measured one with no row remain `null` gaps. */
  let first: string | null = null;
  for (const r of rows ?? []) {
    if (r.stat_date >= from && r.stat_date <= to && (first === null || r.stat_date < first)) {
      first = r.stat_date;
    }
  }
  const start = Date.parse(`${first ?? from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += DAY) {
    const date = iso(new Date(t));
    const row = byDate.get(date);
    out.push({
      label: new Date(t).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }),
      value: row ? Number(pick(row)) : null,
    });
  }
  return out;
}

export function useHomeData(): HomeData {
  /* The window is asked for WITHOUT a brand, so changing the brand filter
     cannot move her period under her. */
  const windowQ = usePerformanceWindow();
  const period = useCreatorPeriod(windowQ.data);
  const brand = period.brandId ?? undefined;

  const daily = useDailyPerformance(period.from, period.to, null, brand);
  const prevDaily = useDailyPerformance(period.prevFrom, period.prevTo, null, brand);
  const videos = useVideoPerformance(period.from, period.to, null, brand);
  const brandSplit = useBrandPerformance(period.from, period.to);

  return useMemo(() => {
    const rows = daily.data ?? [];
    const cur = sumDaily(rows);
    const prevRows = prevDaily.data ?? [];

    const currency = rows.find((r) => r.currency)?.currency ?? null;

    const totals: HomeTotals = {
      gmv: cur.revenue,
      spend: cur.cost,
      orders: cur.orders,
      currency,
    };

    /* No previous window means no comparison, NOT a comparison against zero.
       `DeltaChip` renders that as "Not reported" rather than inventing a rise
       from nothing. */
    const prevSums = sumDaily(prevRows);
    const previous: HomeTotals | null =
      period.prevFrom && prevRows.length > 0
        ? {
            gmv: prevSums.revenue,
            spend: prevSums.cost,
            orders: prevSums.orders,
            currency,
          }
        : null;

    const loading =
      windowQ.isLoading || daily.isLoading || videos.isLoading || brandSplit.isLoading;

    const neverAnyData = !windowQ.isLoading && !windowQ.data?.earliest;
    const emptyPeriodButHasHistory =
      !loading && rows.length === 0 && Boolean(windowQ.data?.earliest);

    return {
      period,
      window: windowQ.data,
      loading,
      neverAnyData,
      emptyPeriodButHasHistory,
      totals,
      previous,
      gmvSeries: toSeries(daily.data, period.from, period.to, (r) => r.gross_revenue),
      spendSeries: toSeries(daily.data, period.from, period.to, (r) => r.cost),
      ordersSeries: toSeries(daily.data, period.from, period.to, (r) => r.orders),
      videosWithAds: (videos.data ?? []).filter((v) => Number(v.cost) > 0).length,
      brands: (brandSplit.data ?? []).map((b) => ({
        label: b.brand_name ?? 'Unknown brand',
        value: Number(b.gmv),
        id: b.brand_id ?? undefined,
      })),
      topVideos: [...(videos.data ?? [])]
        .sort((a, b) => Number(b.gross_revenue) - Number(a.gross_revenue))
        .slice(0, 3),
      currency,
    };
  }, [
    period,
    daily.data,
    daily.isLoading,
    prevDaily.data,
    videos.data,
    videos.isLoading,
    brandSplit.data,
    brandSplit.isLoading,
    windowQ.data,
    windowQ.isLoading,
  ]);
}
