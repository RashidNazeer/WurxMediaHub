import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

/**
 * A creator's ad numbers.
 *
 * THERE IS NO VIDEO ID IN ANY OF THESE CALLS, and that is the security design
 * rather than an omission. The browser sends a date range and nothing else; the
 * database works out which videos are yours from `auth.uid()`. A client that
 * cannot name a video cannot ask for somebody else's, whatever it sends.
 *
 * NONE OF THIS TOUCHES TIKTOK. Every figure comes from `tiktok_video_daily`,
 * which a nightly job fills one complete day at a time. So changing the date
 * filter is free, unlimited, and instant, and a creator has no way to cause an
 * API call at all.
 *
 * `staleTime` is deliberately long. The underlying data only changes once a
 * night, so refetching on every window focus would be pure noise.
 */

const DAY = 24 * 60 * 60 * 1000;

export type PerformanceWindow = {
  earliest: string | null;
  latest: string | null;
  videos: number;
};

/**
 * WHICH CHANNEL A VIDEO CAME THROUGH.
 *
 * Rashid: "in my numbers section users can have a tab like offer videos or
 * contest videos and all videos so that they can differentiate that their
 * which video whether in offers or contest, is going well."
 *
 * 'both' is a real answer, not a fallback. Nothing stops a creator filing the
 * same video against a job AND a contest entry, and when they have, that video
 * genuinely did both. It appears under Offers and under Contests, once each,
 * and under All exactly once, so every tab's total is right on its own. Adding
 * two tabs together is the one sum this data cannot support, and no screen
 * does it.
 */
type VideoSource = 'offer' | 'contest' | 'both';

export type VideoPerformance = {
  item_id: string;
  submission_id: string;
  source: VideoSource;
  video_url: string;
  video_title: string | null;
  thumbnail_url: string | null;
  brand_id: string | null;
  brand_name: string | null;
  submitted_at: string;
  cost: number;
  gross_revenue: number;
  orders: number;
  roi: number | null;
  cost_per_order: number | null;
  currency: string | null;
  days_with_data: number;
  /** Has any ad spend ever landed on this video, over all time. */
  ads_ever: boolean;
  /** The most recent day it actually spent, over all time. */
  last_active_date: string | null;
  lifetime_cost: number;
  lifetime_revenue: number;
};

/**
 * Is GMV Max running on this video, and is it running NOW.
 *
 * ALL-TIME, NEVER RANGE-SCOPED. "Are we running ads on my video" is a fact
 * about the video, so answering it from whichever seven days happen to be
 * selected would flip the badge as somebody moved a filter, which is not an
 * answer. The money on the card stays range-scoped, because that genuinely is
 * a question about a period.
 *
 * "Running" is deliberately generous at three days. TikTok reports complete
 * days only, so the freshest figure is already yesterday's; a stricter window
 * would call a live campaign finished every time a day had no spend.
 */
export type AdState = 'running' | 'ran' | 'none';

export function adStateOf(video: VideoPerformance, latestDataDate: string | null): AdState {
  if (!video.ads_ever || !video.last_active_date) return 'none';
  if (!latestDataDate) return 'ran';
  const gapDays =
    (new Date(`${latestDataDate}T00:00:00Z`).getTime() -
      new Date(`${video.last_active_date}T00:00:00Z`).getTime()) /
    DAY;
  return gapDays <= 3 ? 'running' : 'ran';
}

export type DailyPerformance = {
  stat_date: string;
  cost: number;
  gross_revenue: number;
  orders: number;
  videos: number;
  currency: string | null;
};

/**
 * The days this creator could sensibly look at.
 *
 * `brandId` narrows every one of these to a single Brand Hub. Undefined means
 * the standalone My numbers screen, which still answers for every brand.
 */
export function usePerformanceWindow(brandId?: string) {
  return useQuery({
    queryKey: ['creator', 'performance', 'window', brandId ?? 'all'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PerformanceWindow> => {
      const { data, error } = await getSupabase().rpc('creator_performance_window', {
        p_brand_id: brandId ?? null,
      });
      if (error) throw error;
      const row = (data as PerformanceWindow[] | null)?.[0];
      return row ?? { earliest: null, latest: null, videos: 0 };
    },
  });
}

export function useVideoPerformance(
  from: string | null,
  to: string | null,
  /** null asks for every video, whichever channel it arrived through. */
  source: 'offer' | 'contest' | null = null,
  /** Set inside a Brand Hub. Videos filed there, and only that brand's money. */
  brandId?: string
) {
  return useQuery({
    queryKey: ['creator', 'performance', 'videos', from, to, source ?? 'all', brandId ?? 'all'],
    enabled: Boolean(from && to),
        /*
     * KEEP THE OLD FIGURES ON SCREEN WHILE THE NEW ONES LOAD.
     *
     * Two reviewers independently reported the dashboard "blinking". This is
     * why: the range and brand are part of the query KEY, so tapping 30D after
     * 7D is a brand-new query with no data, every chart on the page empties at
     * once, the skeleton takes over and the whole screen flashes. The figures
     * had not changed — only which ones we were asking for.
     *
     * `keepPreviousData` holds the previous answer in place until the next one
     * lands, so a period change updates the numbers instead of demolishing the
     * page. The admin side already does this on three screens for the same
     * reason.
     */
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<VideoPerformance[]> => {
      const { data, error } = await getSupabase().rpc('creator_video_performance', {
        p_from: from,
        p_to: to,
        p_source: source,
        p_brand_id: brandId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as VideoPerformance[];
    },
  });
}

export function useDailyPerformance(
  from: string | null,
  to: string | null,
  source: 'offer' | 'contest' | null = null,
  brandId?: string
) {
  return useQuery({
    queryKey: ['creator', 'performance', 'daily', from, to, source ?? 'all', brandId ?? 'all'],
    enabled: Boolean(from && to),
        /*
     * KEEP THE OLD FIGURES ON SCREEN WHILE THE NEW ONES LOAD.
     *
     * Two reviewers independently reported the dashboard "blinking". This is
     * why: the range and brand are part of the query KEY, so tapping 30D after
     * 7D is a brand-new query with no data, every chart on the page empties at
     * once, the skeleton takes over and the whole screen flashes. The figures
     * had not changed — only which ones we were asking for.
     *
     * `keepPreviousData` holds the previous answer in place until the next one
     * lands, so a period change updates the numbers instead of demolishing the
     * page. The admin side already does this on three screens for the same
     * reason.
     */
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<DailyPerformance[]> => {
      const { data, error } = await getSupabase().rpc('creator_daily_performance', {
        p_from: from,
        p_to: to,
        p_source: source,
        p_brand_id: brandId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as DailyPerformance[];
    },
  });
}

/* ------------------------------------------------------- which brand paid -- */

type BrandPerformance = {
  brand_id: string | null;
  brand_name: string | null;
  gmv: number;
  spend: number;
  orders: number;
  videos: number;
  roi: number | null;
  currency: string | null;
};

/**
 * What this creator made, split by the brand whose ad account actually paid.
 *
 * Rashid asked for it by name: "let creators see that in which brand they got
 * how many money so they can analyse that in which brand they have what money."
 *
 * IT READS THE MONEY ROW, NOT THE SUBMISSION, and that distinction is the whole
 * feature. A submission records which brand a creator FILED a video against;
 * the money row records which brand's ad account paid for a given day of it.
 * For an ordinary video those agree. For a video two brands both promoted they
 * do not, and only the money row can split it honestly — before this, the brand
 * on a card was whichever offer the video happened to be filed against first,
 * which is a guess wearing a fact's clothes.
 *
 * It takes no creator argument, so it cannot be asked about anybody else, and
 * it reads through the same row policy as every other creator money read.
 */
export function useBrandPerformance(from: string | null, to: string | null) {
  return useQuery({
    queryKey: ['creator', 'performance', 'brands', from, to],
    enabled: Boolean(from && to),
        /*
     * KEEP THE OLD FIGURES ON SCREEN WHILE THE NEW ONES LOAD.
     *
     * Two reviewers independently reported the dashboard "blinking". This is
     * why: the range and brand are part of the query KEY, so tapping 30D after
     * 7D is a brand-new query with no data, every chart on the page empties at
     * once, the skeleton takes over and the whole screen flashes. The figures
     * had not changed — only which ones we were asking for.
     *
     * `keepPreviousData` holds the previous answer in place until the next one
     * lands, so a period change updates the numbers instead of demolishing the
     * page. The admin side already does this on three screens for the same
     * reason.
     */
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BrandPerformance[]> => {
      const { data, error } = await getSupabase().rpc('creator_brand_performance', {
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as BrandPerformance[];
    },
  });
}
