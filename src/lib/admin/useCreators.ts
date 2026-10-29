import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { STAGE_META, type OfferApplicationStatus, type OfferStage } from '@/lib/offer-stages';
import type { ContentStatus } from '@/lib/content';
import type { AppRole, CreatorTier } from '@/lib/auth/auth-context';

/**
 * Creators, as people rather than as rows in somebody else's queue.
 *
 * Staff only, and staff only in the database: `creator_directory` carries an
 * `is_staff()` gate in its body. Nothing under `src/lib/creator/` or
 * `src/routes/app/` may import this file, and the build fails if it tries.
 */

export const CREATOR_PAGE_SIZE = 24;

export type CreatorSort = 'newest' | 'name' | 'tier';

export interface CreatorFilters {
  search: string;
  sort: CreatorSort;
  /** Empty means everyone, including suspended accounts. */
  active: 'all' | 'active' | 'suspended';
  page: number;
}

export const DEFAULT_CREATOR_FILTERS: CreatorFilters = {
  search: '',
  sort: 'newest',
  active: 'all',
  page: 1,
};

export interface CreatorRow {
  id: string;
  email: string;
  display_name: string | null;
  role: AppRole;
  tier: CreatorTier | null;
  is_active: boolean;
  created_at: string;
  application_id: string | null;
  tiktok_handle: string | null;
  application_status: string | null;
  niche: string | null;
  reviewed_at: string | null;
}

const DIRECTORY_COLUMNS =
  'id, email, display_name, role, tier, is_active, created_at, ' +
  'application_id, tiktok_handle, application_status, niche, reviewed_at';

/** Same guard the other queues use: a comma or a bracket changes the filter. */
const sanitiseCreatorSearch = (raw: string) =>
  raw
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._@ -]/g, '')
    .slice(0, 64);

/**
 * The roster, paged and searched in the database.
 *
 * Search covers the handle as well as the name and the email, which is the
 * whole reason the directory is a view: the handle lives on `applications` and
 * everything else on `profiles`, and an admin types a handle.
 */
export function useCreators(filters: CreatorFilters) {
  const search = sanitiseCreatorSearch(filters.search);

  return useQuery({
    queryKey: ['admin', 'creators', { ...filters, search }],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<{ rows: CreatorRow[]; total: number }> => {
      const from = (filters.page - 1) * CREATOR_PAGE_SIZE;
      let q = getSupabase()
        .from('creator_directory')
        .select(DIRECTORY_COLUMNS, { count: 'exact' });

      if (filters.active === 'active') q = q.eq('is_active', true);
      if (filters.active === 'suspended') q = q.eq('is_active', false);
      if (search) {
        q = q.or(
          `tiktok_handle.ilike.*${search}*,display_name.ilike.*${search}*,email.ilike.*${search}*`
        );
      }

      if (filters.sort === 'newest') q = q.order('created_at', { ascending: false });
      if (filters.sort === 'name') q = q.order('display_name', { ascending: true });
      if (filters.sort === 'tier') q = q.order('tier', { ascending: true });

      const { data, error, count } = await q.range(from, from + CREATOR_PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as unknown as CreatorRow[], total: count ?? 0 };
    },
  });
}

/** One person, for the screen about them. */
export function useCreator(creatorId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'creator', creatorId],
    enabled: Boolean(creatorId),
    staleTime: 30_000,
    queryFn: async (): Promise<CreatorRow | null> => {
      const { data, error } = await getSupabase()
        .from('creator_directory')
        .select(DIRECTORY_COLUMNS)
        .eq('id', creatorId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as CreatorRow | null;
    },
  });
}

/* ------------------------------------------------------- work rollups ----- */

export interface CreatorWork {
  jobs: number;
  approved: number;
  pending: number;
  brands: number;
  /** Only meaningful when currencies is 1. */
  currency: string | null;
  currencies: number;
  committed: number;
  paid: number;
  due: number;
  working: number;
  videosApproved: number;
  videosWaiting: number;
}

const EMPTY_WORK: CreatorWork = {
  jobs: 0,
  approved: 0,
  pending: 0,
  brands: 0,
  currency: null,
  currencies: 0,
  committed: 0,
  paid: 0,
  due: 0,
  working: 0,
  videosApproved: 0,
  videosWaiting: 0,
};

interface JobRollupRow {
  creator_id: string;
  brand_id: string;
  status: OfferApplicationStatus;
  stage: OfferStage | null;
  currency: string;
  committed_amount: string | number | null;
}

interface ContentRollupRow {
  creator_id: string;
  status: ContentStatus;
}

/**
 * What each person on this page is worth and has delivered.
 *
 * TWO grouped reads over the ids on the page, never one pair per row. Money is
 * bucketed here with `STAGE_META` rather than in SQL, so the stage-to-bucket
 * mapping stays defined in exactly one place in the product.
 *
 * Currencies are counted rather than summed across. If somebody has work in
 * two, the screen says so instead of adding dollars to pounds.
 */
export function useCreatorWork(creatorIds: string[]) {
  const key = [...creatorIds].sort().join(',');

  return useQuery({
    queryKey: ['admin', 'creator-work', key],
    enabled: creatorIds.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<Map<string, CreatorWork>> => {
      const supabase = getSupabase();
      const [jobs, content] = await Promise.all([
        supabase
          .from('offer_applications')
          .select('creator_id, brand_id, status, stage, currency, committed_amount')
          .in('creator_id', creatorIds),
        supabase
          .from('content_submissions')
          .select('creator_id, status')
          .in('creator_id', creatorIds),
      ]);
      if (jobs.error) throw jobs.error;
      if (content.error) throw content.error;

      const out = new Map<string, CreatorWork>();
      const brandsSeen = new Map<string, Set<string>>();
      const currenciesSeen = new Map<string, Set<string>>();

      for (const row of (jobs.data ?? []) as unknown as JobRollupRow[]) {
        const w = out.get(row.creator_id) ?? { ...EMPTY_WORK };
        w.jobs += 1;
        if (row.status === 'pending') w.pending += 1;

        if (row.status === 'approved') {
          w.approved += 1;
          (
            brandsSeen.get(row.creator_id) ??
            brandsSeen.set(row.creator_id, new Set()).get(row.creator_id)!
          ).add(row.brand_id);
          const amount = Number(row.committed_amount ?? 0) || 0;
          if (row.committed_amount != null) {
            (
              currenciesSeen.get(row.creator_id) ??
              currenciesSeen.set(row.creator_id, new Set()).get(row.creator_id)!
            ).add(row.currency);
          }
          // A stage should never be null on an approved row, but the column is
          // nullable and lost work is still in progress, not money that
          // disappears out of the total.
          const bucket = row.stage ? STAGE_META[row.stage].bucket : 'working';
          w[bucket] += amount;
          w.committed += amount;
        }
        out.set(row.creator_id, w);
      }

      for (const row of (content.data ?? []) as unknown as ContentRollupRow[]) {
        const w = out.get(row.creator_id) ?? { ...EMPTY_WORK };
        if (row.status === 'approved') w.videosApproved += 1;
        if (row.status === 'submitted') w.videosWaiting += 1;
        out.set(row.creator_id, w);
      }

      for (const [id, w] of out) {
        w.brands = brandsSeen.get(id)?.size ?? 0;
        const cur = currenciesSeen.get(id);
        w.currencies = cur?.size ?? 0;
        w.currency = cur && cur.size === 1 ? [...cur][0]! : null;
      }
      return out;
    },
  });
}

/* ---------------------------------------------------------- their work ---- */

export interface CreatorJob {
  id: string;
  offer_id: string;
  brand_id: string;
  status: OfferApplicationStatus;
  stage: OfferStage | null;
  stage_updated_at: string | null;
  committed_amount: string | number | null;
  committed_video_count: number | null;
  currency: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  offer: { id: string; title: string } | null;
  brand: { id: string; name: string } | null;
}

/** Every job one creator has, across every brand. */
export function useCreatorJobs(creatorId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'creator-jobs', creatorId],
    enabled: Boolean(creatorId),
    staleTime: 15_000,
    queryFn: async (): Promise<CreatorJob[]> => {
      const { data, error } = await getSupabase()
        .from('offer_applications')
        .select(
          'id, offer_id, brand_id, status, stage, stage_updated_at, committed_amount, ' +
            'committed_video_count, currency, decision_note, decided_at, created_at, ' +
            'offer:offers (id, title), brand:brands (id, name)'
        )
        .eq('creator_id', creatorId!)
        .order('created_at', { ascending: false })
        // On the index (creator_id, created_at desc). Bounded, like every other
        // growable read in this product.
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as CreatorJob[];
    },
  });
}

interface CreatorHistoryRow {
  id: number;
  action: string;
  subject_type: string;
  detail: Record<string, unknown> | null;
  actor_email: string | null;
  created_at: string;
}

/**
 * Everything that has ever been done TO this creator.
 *
 * `audit_log.target_user_id` was added on day one with its own partial index
 * for exactly this question, and no query has used it until now.
 *
 * It is the record of what STAFF did. Posting a video writes no audit row, so
 * the creator's own half of the conversation only appears here once we have
 * answered it. That is a real gap and the screen says so rather than implying
 * the person did nothing.
 */
export function useCreatorHistory(creatorId: string | undefined, limit = 50) {
  return useQuery({
    queryKey: ['admin', 'creator-history', creatorId, limit],
    enabled: Boolean(creatorId),
    staleTime: 30_000,
    queryFn: async (): Promise<CreatorHistoryRow[]> => {
      const { data, error } = await getSupabase()
        .from('audit_log')
        .select('id, action, subject_type, detail, actor_email, created_at')
        .eq('target_user_id', creatorId!)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as CreatorHistoryRow[];
    },
  });
}
