import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { STAGE_META, type OfferStage } from '@/lib/offer-stages';
import type { ContentStatus } from '@/lib/content';

/**
 * What a brand's money and its content are actually doing.
 *
 * Reads the three views added on 2026-08-11. Staff only, and staff only in the
 * DATABASE rather than by convention: each view carries an `is_staff()` gate in
 * its body, so a creator running these gets zero rows rather than a brand
 * shaped object built from their own. Nothing under `src/lib/creator/` or
 * `src/routes/app/` may import this file, and `.oxlintrc.json` fails the build
 * if it tries.
 *
 * The stage-to-money mapping is NOT in the SQL. The views group by stage and
 * this file buckets with `STAGE_META`, so paid/due/working stays defined in
 * exactly one place in the product.
 */

/* ------------------------------------------------------------- money ----- */

interface StageTotalRow {
  brand_id: string;
  stage: OfferStage | null;
  currency: string;
  jobs: number;
  committed: string | number;
  videos_promised: number;
}

export interface BrandMoney {
  currency: string;
  paid: number;
  due: number;
  working: number;
  total: number;
  jobs: number;
  videosPromised: number;
}

/**
 * Where a brand's committed money has got to, ONE ENTRY PER CURRENCY.
 *
 * Never one figure. `offer_applications.currency` is per row, so a brand can
 * genuinely hold two, and adding dollars to pounds is the one arithmetic error
 * this product must not make. Screens render one block per currency, which for
 * every brand we actually run is exactly one.
 */
export function useBrandMoney(brandId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'brand-money', brandId],
    enabled: Boolean(brandId),
    staleTime: 30_000,
    queryFn: async (): Promise<BrandMoney[]> => {
      const { data, error } = await getSupabase()
        .from('brand_stage_totals')
        .select('brand_id, stage, currency, jobs, committed, videos_promised')
        .eq('brand_id', brandId!);
      if (error) throw error;

      const byCurrency = new Map<string, BrandMoney>();
      for (const row of (data ?? []) as unknown as StageTotalRow[]) {
        const m = (byCurrency.get(row.currency) ?? {
          currency: row.currency,
          paid: 0,
          due: 0,
          working: 0,
          total: 0,
          jobs: 0,
          videosPromised: 0,
        }) as BrandMoney;

        const amount = Number(row.committed ?? 0) || 0;
        // A stage should never be null on an approved row, but it is a nullable
        // column, and a job that somehow lost its stage is still work in
        // progress rather than money that vanishes out of the total.
        const bucket = row.stage ? STAGE_META[row.stage].bucket : 'working';
        m[bucket] += amount;
        m.total += amount;
        m.jobs += row.jobs;
        m.videosPromised += row.videos_promised;
        byCurrency.set(row.currency, m);
      }
      return [...byCurrency.values()].sort((a, b) => b.total - a.total);
    },
  });
}

/* ----------------------------------------------------------- content ----- */

interface ContentTotalRow {
  brand_id: string;
  status: ContentStatus;
  videos: number;
  creators: number;
  jobs: number;
  last_posted_at: string | null;
}

export interface BrandContent {
  approved: number;
  waiting: number;
  needsAnotherTake: number;
  posted: number;
  creators: number;
  lastPostedAt: string | null;
}

const EMPTY_CONTENT: BrandContent = {
  approved: 0,
  waiting: 0,
  needsAnotherTake: 0,
  posted: 0,
  creators: 0,
  lastPostedAt: null,
};

/**
 * What has actually been filmed for a brand.
 *
 * Only statuses that occur produce a row, so a brand nobody has been knocked
 * back on returns no `needs_another_take` row at all. Missing means zero here,
 * never a gap on the screen.
 */
export function useBrandContent(brandId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'brand-content', brandId],
    enabled: Boolean(brandId),
    staleTime: 30_000,
    queryFn: async (): Promise<BrandContent> => {
      const { data, error } = await getSupabase()
        .from('brand_content_totals')
        .select('brand_id, status, videos, creators, jobs, last_posted_at')
        .eq('brand_id', brandId!);
      if (error) throw error;

      const out = { ...EMPTY_CONTENT };
      for (const row of (data ?? []) as unknown as ContentTotalRow[]) {
        if (row.status === 'approved') out.approved = row.videos;
        if (row.status === 'submitted') out.waiting = row.videos;
        if (row.status === 'needs_another_take') out.needsAnotherTake = row.videos;
        out.posted += row.videos;
        // Distinct creators cannot be added across statuses without double
        // counting the same person, so the largest single status is the honest
        // floor rather than a sum that would over-report.
        out.creators = Math.max(out.creators, row.creators);
        if (
          row.last_posted_at &&
          (!out.lastPostedAt || row.last_posted_at > out.lastPostedAt)
        ) {
          out.lastPostedAt = row.last_posted_at;
        }
      }
      return out;
    },
  });
}

/* ------------------------------------------------------------ roster ----- */

export const ROSTER_PAGE_SIZE = 20;

export type RosterTab = 'all' | 'on' | 'waiting' | 'declined';
export type RosterSort = 'committed' | 'newest' | 'delivered';

export interface RosterFilters {
  tab: RosterTab;
  search: string;
  sort: RosterSort;
  page: number;
}

export const DEFAULT_ROSTER_FILTERS: RosterFilters = {
  tab: 'all',
  search: '',
  sort: 'committed',
  page: 1,
};

export interface RosterRow {
  brand_id: string;
  creator_id: string;
  creator_handle: string | null;
  creator_name: string | null;
  creator_email: string | null;
  jobs: number;
  jobs_approved: number;
  jobs_pending: number;
  jobs_rejected: number;
  jobs_working: number;
  jobs_due: number;
  jobs_paid: number;
  videos_promised: number;
  /** More than one and the money below cannot be added up or printed. */
  currency_count: number;
  committed_currency: string | null;
  committed: string | number;
  paid: string | number;
  due: string | number;
  first_asked_at: string | null;
  last_decided_at: string | null;
  last_moved_at: string | null;
  videos_posted: number;
  videos_approved: number;
  videos_waiting: number;
  videos_needs_another_take: number;
  last_posted_at: string | null;
}

const ROSTER_COLUMNS =
  'brand_id, creator_id, creator_handle, creator_name, creator_email, ' +
  'jobs, jobs_approved, jobs_pending, jobs_rejected, jobs_working, jobs_due, jobs_paid, ' +
  'videos_promised, currency_count, committed_currency, committed, paid, due, ' +
  'first_asked_at, last_decided_at, last_moved_at, ' +
  'videos_posted, videos_approved, videos_waiting, videos_needs_another_take, last_posted_at';

/**
 * PostgREST puts filter values straight into the query string, where a comma or
 * a bracket changes what the filter MEANS. Same guard the offer queue uses.
 */
const sanitiseRosterSearch = (raw: string) =>
  raw
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._@ -]/g, '')
    .slice(0, 64);

/**
 * Who is working on this brand, PAGED IN THE DATABASE.
 *
 * A grouped list cannot be paged in a browser: you would have to fetch every
 * request the brand has ever had to know what page two is, and it would
 * truncate silently rather than erroring once that outgrew a single read.
 */
export function useBrandRoster(brandId: string | undefined, filters: RosterFilters) {
  const search = sanitiseRosterSearch(filters.search);

  return useQuery({
    queryKey: ['admin', 'brand-roster', brandId, { ...filters, search }],
    enabled: Boolean(brandId),
    staleTime: 15_000,
    queryFn: async (): Promise<{ rows: RosterRow[]; total: number }> => {
      const from = (filters.page - 1) * ROSTER_PAGE_SIZE;
      let q = getSupabase()
        .from('brand_creator_roster')
        .select(ROSTER_COLUMNS, { count: 'exact' })
        .eq('brand_id', brandId!);

      if (filters.tab === 'on') q = q.gt('jobs_approved', 0);
      if (filters.tab === 'waiting') q = q.gt('jobs_pending', 0);
      // Turned down means turned down and nothing else in flight, or somebody
      // with one rejection and two live jobs would read as declined.
      if (filters.tab === 'declined') {
        q = q.gt('jobs_rejected', 0).eq('jobs_approved', 0).eq('jobs_pending', 0);
      }
      if (search) {
        q = q.or(
          `creator_handle.ilike.*${search}*,creator_name.ilike.*${search}*,creator_email.ilike.*${search}*`
        );
      }

      if (filters.sort === 'committed') q = q.order('committed', { ascending: false });
      if (filters.sort === 'newest') q = q.order('first_asked_at', { ascending: false });
      if (filters.sort === 'delivered') q = q.order('videos_approved', { ascending: false });

      const { data, error, count } = await q.range(from, from + ROSTER_PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as RosterRow[], total: count ?? 0 };
    },
  });
}

/** Counts for the roster tabs. Cheap: PostgREST returns a header, not rows. */
export function useRosterCounts(brandId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'roster-counts', brandId],
    enabled: Boolean(brandId),
    staleTime: 30_000,
    queryFn: async (): Promise<Record<RosterTab, number>> => {
      const base = () =>
        getSupabase()
          .from('brand_creator_roster')
          .select('creator_id', { count: 'exact', head: true })
          .eq('brand_id', brandId!);

      const [all, on, waiting, declined] = await Promise.all([
        base(),
        base().gt('jobs_approved', 0),
        base().gt('jobs_pending', 0),
        base().gt('jobs_rejected', 0).eq('jobs_approved', 0).eq('jobs_pending', 0),
      ]);
      for (const r of [all, on, waiting, declined]) if (r.error) throw r.error;

      return {
        all: all.count ?? 0,
        on: on.count ?? 0,
        waiting: waiting.count ?? 0,
        declined: declined.count ?? 0,
      };
    },
  });
}
