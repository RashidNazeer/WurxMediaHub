import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { ChartPoint } from '@/components/charts';

/**
 * ONE VIDEO, DAY BY DAY — only for the sheet that is open.
 *
 * §9 asks the detail sheet for "a `TrendLine` of that video's GMV by day", and
 * none of the three sources this page joins can answer that: `useMyContent` has
 * no money in it, `useTikTokVideos` has no money in it, and
 * `creator_video_performance` returns ONE AGGREGATE ROW PER VIDEO for the whole
 * range, with no days inside it. There is no creator RPC that returns a day
 * series for a single video.
 *
 * So this reads `tiktok_video_daily` directly — the same table every creator
 * money RPC already reads, one row per video per complete day.
 *
 * WHY THAT IS SAFE, AND WHY IT IS STILL WORTH FLAGGING. The table's own policy
 * `tiktok_video_daily_select_own` exists for exactly this: a creator may select
 * the rows whose `item_id` matches an `embed_id` on one of THEIR OWN
 * `content_submissions`. An id belonging to somebody else returns no rows, in
 * the database, whatever the browser sends. But `usePerformance.ts` makes a
 * point of the fact that no creator call NAMES a video, so that a client which
 * cannot name one cannot ask about one, and this call does name one. It is
 * defended by the policy rather than by the shape of the call, which is a
 * weaker guarantee of the same fact. A `creator_video_daily(p_from, p_to)` RPC
 * returning every video's days, filtered by `auth.uid()` in the database and
 * picked apart in the browser, would restore the stronger guarantee; until then
 * this is the narrowest read that answers the question.
 *
 * NO TIKTOK CALL IS INVOLVED. This is our own nightly table, like everything
 * else on this screen, so it is free, instant and un-rationed.
 *
 * It is `enabled` only while a sheet is open, so a grid of 300 cards costs
 * nothing, and the result is cached per video for five minutes — a complete day
 * never changes, so a row fetched once is correct forever.
 */

interface VideoDay {
  stat_date: string;
  cost: number;
  gross_revenue: number;
  orders: number;
  currency: string | null;
}

export function useVideoDaily(itemId: string | null) {
  return useQuery({
    queryKey: ['creator', 'video-daily', itemId],
    enabled: Boolean(itemId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VideoDay[]> => {
      const { data, error } = await getSupabase()
        .from('tiktok_video_daily')
        .select('stat_date, cost, gross_revenue, orders, currency')
        .eq('item_id', itemId!)
        .order('stat_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as VideoDay[];
    },
  });
}

const DAY = 24 * 60 * 60 * 1000;

const label = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * Two series on ONE CONTINUOUS DAY AXIS, with gaps where there is no row.
 *
 * A day the sync never wrote is an absence, so it becomes `null` and the line
 * BREAKS over it. Filling it with 0 would state that the video sold nothing
 * that day, which is a different and much worse claim — and `linePaths` in the
 * chart kit is built to break rather than to join, so the gap survives all the
 * way to the pixels.
 *
 * The axis runs from the first reported day to the last, never wider: an empty
 * stretch before the video existed reads as "you earned nothing" rather than
 * "there was nothing yet", which is the same mistake the old all-time range helper avoided.
 */
export function toSeries(days: VideoDay[]): {
  gmv: ChartPoint[];
  spend: ChartPoint[];
  currency: string | null;
} {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return { gmv: [], spend: [], currency: null };

  const byDate = new Map(days.map((d) => [d.stat_date, d]));
  const gmv: ChartPoint[] = [];
  const spend: ChartPoint[] = [];

  const end = new Date(`${last.stat_date}T00:00:00Z`).getTime();
  /* A hard ceiling on the axis so one stray historic row cannot ask the browser
     to lay out ten thousand points. Two years of a video is already far more
     than anybody reads. */
  for (
    let t = new Date(`${first.stat_date}T00:00:00Z`).getTime(), i = 0;
    t <= end && i < 800;
    t += DAY, i += 1
  ) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const day = byDate.get(iso);
    gmv.push({ label: label(iso), value: day ? day.gross_revenue : null });
    spend.push({ label: label(iso), value: day ? day.cost : null });
  }

  /* The currency the figures ARRIVED in. Several in one video's history means
     we cannot name one, so nothing is guessed — the same rule the strip on the
     old page followed. */
  const codes = new Set(days.map((d) => d.currency));
  return { gmv, spend, currency: codes.size === 1 ? (first.currency ?? null) : null };
}
