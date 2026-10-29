import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { OfferApplicationStatus, OfferStage } from '@/lib/offer-stages';

/**
 * The offer queue: every creator asking for an offer, and what they asked for.
 *
 * Paginated and filtered in the database, never in the browser. This list grows
 * with every creator times every offer, so "fetch everything then filter" was
 * never an option here.
 *
 * Identity comes from the columns snapshotted onto the row when the request was
 * made, not from a join. That is deliberate: it keeps search to one trigram
 * index on one table, and it means the queue still reads correctly after a
 * creator changes their display name or their account is closed.
 */

export const OFFER_QUEUE_PAGE_SIZE = 20;

export type OfferStatusFilter = 'all' | OfferApplicationStatus;
export type OfferSortOrder = 'newest' | 'oldest';

export interface OfferQueueFilters {
  status: OfferStatusFilter;
  /** Empty means every brand. */
  brandId: string;
  /** Empty means every stage. Only meaningful alongside the approved tab. */
  stage: OfferStage | '';
  search: string;
  sort: OfferSortOrder;
  page: number;
}

export const DEFAULT_OFFER_FILTERS: OfferQueueFilters = {
  status: 'pending',
  brandId: '',
  stage: '',
  search: '',
  sort: 'newest',
  page: 1,
};

export interface OfferQueueRow {
  id: string;
  offer_id: string;
  brand_id: string;
  creator_id: string;
  creator_handle: string | null;
  creator_name: string | null;
  creator_email: string | null;
  status: OfferApplicationStatus;
  /** Where an approved request has got to. Null on anything not approved. */
  stage: OfferStage | null;
  stage_updated_at: string | null;
  /** What we agreed to pay, snapshotted at approval. */
  committed_amount: string | number | null;
  /**
   * How many videos were agreed, snapshotted at approval beside the amount.
   *
   * On an APPROVED row this and `committed_amount` are the deal. The offer's
   * own `video_count` and `reward_amount` are what it says TODAY, which is a
   * different fact the moment anybody re-prices or re-scopes it, and showing
   * today's terms against a promise already made is how the queue, the brand's
   * budget and the creator's own dashboard came to give two answers.
   */
  committed_video_count: number | null;
  /** The currency the offer was quoted in when they asked. */
  currency: string;
  note: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  offer: {
    id: string;
    title: string;
    video_count: number | null;
    reward_amount: string | number | null;
    currency: string;
  } | null;
  brand: { id: string; name: string } | null;
  /**
   * What this brand has left to promise. Staff only, and the reason the approve
   * dialog can say what a decision costs before it is made. Flattened out of
   * the nested embed by `flattenBudget` below.
   */
  budget: {
    budget_allocated: string | number | null;
    budget_used: string | number | null;
    currency: string;
  } | null;
}

type QueueRowRaw = Omit<OfferQueueRow, 'brand' | 'budget'> & {
  brand:
    | (OfferQueueRow['brand'] & {
        brand_commercials: OfferQueueRow['budget'] | OfferQueueRow['budget'][] | null;
      })
    | null;
};

/**
 * Lift the brand's budget up to the top of the row.
 *
 * The array check is not paranoia: PostgREST returns an embedded resource as an
 * object when it can prove the relationship is one to one and as an array when
 * it cannot, and that proof depends on the constraints it finds.
 */
function flattenBudget(row: QueueRowRaw): OfferQueueRow {
  const nested = row.brand?.brand_commercials ?? null;
  const budget = (Array.isArray(nested) ? nested[0] : nested) ?? null;
  const brand = row.brand ? { id: row.brand.id, name: row.brand.name } : null;
  return { ...row, brand, budget };
}

/**
 * PostgREST puts filter values straight into the query string, where a comma,
 * a bracket or a dot changes what the filter MEANS rather than being matched
 * literally. `or=(...)` is especially easy to break, so anything that is not a
 * plain search character is dropped before it can get near one.
 */
const sanitiseOfferSearch = (raw: string) =>
  raw
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._@ -]/g, '')
    .slice(0, 64);

const COLUMNS =
  'id, offer_id, brand_id, creator_id, creator_handle, creator_name, creator_email, ' +
  'status, stage, stage_updated_at, committed_amount, committed_video_count, ' +
  'currency, note, decision_note, decided_at, created_at, ' +
  'offer:offers (id, title, video_count, reward_amount, currency), ' +
  /*
   * The budget is reached THROUGH the brand, not beside it.
   *
   * `offer_applications.brand_id` points at `brands`, and `brand_commercials`
   * points at `brands` too. PostgREST will not invent a path between two tables
   * that only share a third, so asking for `brand_commercials` at the top level
   * fails. Nesting it inside the brand embed follows a real foreign key both
   * ways. Row level security still applies: a creator running this gets nothing
   * for it.
   */
  'brand:brands (id, name, brand_commercials (budget_allocated, budget_used, currency))';

export function useOfferApplications(filters: OfferQueueFilters) {
  const search = sanitiseOfferSearch(filters.search);

  return useQuery({
    queryKey: ['admin', 'offer-applications', { ...filters, search }],
    // Keep the previous page on screen while the next one loads, or every page
    // change flashes an empty list and reads as a bug.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async (): Promise<{ rows: OfferQueueRow[]; total: number }> => {
      const from = (filters.page - 1) * OFFER_QUEUE_PAGE_SIZE;

      let q = getSupabase().from('offer_applications').select(COLUMNS, { count: 'exact' });

      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.brandId) q = q.eq('brand_id', filters.brandId);
      if (filters.stage) q = q.eq('stage', filters.stage);
      if (search) {
        q = q.or(
          `creator_handle.ilike.*${search}*,creator_name.ilike.*${search}*,creator_email.ilike.*${search}*`
        );
      }

      const { data, error, count } = await q
        .order('created_at', { ascending: filters.sort === 'oldest' })
        .range(from, from + OFFER_QUEUE_PAGE_SIZE - 1);

      if (error) throw error;
      return {
        rows: ((data ?? []) as unknown as QueueRowRaw[]).map(flattenBudget),
        total: count ?? 0,
      };
    },
  });
}

type OfferApplicationCounts = Record<OfferApplicationStatus, number>;

/**
 * Counts for the tabs and the dashboard.
 *
 * `head: true` means PostgREST returns the count in a header and no rows at
 * all, so this stays cheap however long the queue gets.
 */
export function useOfferApplicationCounts() {
  return useQuery({
    queryKey: ['admin', 'offer-application-counts'],
    staleTime: 30_000,
    queryFn: async (): Promise<OfferApplicationCounts> => {
      const supabase = getSupabase();
      const statuses: OfferApplicationStatus[] = [
        'pending',
        'approved',
        'rejected',
        'withdrawn',
      ];

      const results = await Promise.all(
        statuses.map((s) =>
          supabase
            .from('offer_applications')
            .select('id', { count: 'exact', head: true })
            .eq('status', s)
        )
      );

      const counts: OfferApplicationCounts = {
        pending: 0,
        approved: 0,
        rejected: 0,
        withdrawn: 0,
      };
      results.forEach((r, i) => {
        if (r.error) throw r.error;
        counts[statuses[i]!] = r.count ?? 0;
      });
      return counts;
    },
  });
}

/** Brands that actually have requests, for the filter. One grouped read. */
export function useBrandsWithRequests() {
  return useQuery({
    queryKey: ['admin', 'offer-application-brands'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await getSupabase()
        .from('offer_applications')
        .select('brand_id, brand:brands (id, name)');
      if (error) throw error;

      const seen = new Map<string, string>();
      for (const row of (data ?? []) as unknown as OfferQueueRow[]) {
        if (row.brand) seen.set(row.brand.id, row.brand.name);
      }
      return [...seen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/** Everything a decision touches, in one place so the two hooks agree. */
function refreshAfterDecision(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-applications'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-application-counts'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-people'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  // Approving spends budget, so the brand list and hub are now wrong too.
  void queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
  void queryClient.invalidateQueries({ queryKey: ['admin', 'brand'] });
  void queryClient.invalidateQueries({ queryKey: ['creator'] });
}

export function useReviewOfferApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      decision: 'approved' | 'rejected';
      note: string | null;
      /** Where the work starts. Ignored on a rejection. */
      stage?: OfferStage;
    }): Promise<OfferQueueRow> => {
      const { data, error } = await getSupabase().functions.invoke('manage-offer-application', {
        body: { action: 'application.review', ...input },
      });
      if (error) throw new Error(await messageFrom(error));
      return (data as { result: OfferQueueRow }).result;
    },
    onSuccess: () => refreshAfterDecision(queryClient),
  });
}

/**
 * Moving a request along the pipeline.
 *
 * Applies immediately rather than behind a confirmation. Seven stages times
 * every creator on every brand is a lot of clicking, none of it destructive,
 * all of it audited and reversible by picking a different stage.
 */
export function useSetOfferStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      applicationId: string;
      stage: OfferStage;
      note?: string | null;
    }): Promise<OfferQueueRow> => {
      const { data, error } = await getSupabase().functions.invoke('manage-offer-application', {
        body: { action: 'application.stage', ...input },
      });
      if (error) throw new Error(await messageFrom(error));
      return (data as { result: OfferQueueRow }).result;
    },
    onSuccess: () => refreshAfterDecision(queryClient),
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`, which is the
 * actual Response. Without this an admin sees that sentence instead of
 * "that was already approved".
 */
async function messageFrom(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Body was not JSON. Fall through to the generic message.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'That did not go through. Try again.';
}
