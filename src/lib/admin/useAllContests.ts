import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { useAdminContestsLive } from '@/lib/admin/useContests';
import type { Contest, ContestStatus } from '@/lib/admin/useContests';

/**
 * Every contest, across every brand, in one list.
 *
 * The Contests tab inside a brand answers "what is this brand running". This
 * answers the question that cuts across brands and is the reason the screen
 * exists: WHAT IS RUNNING RIGHT NOW, AND WHAT NEEDS ME. Those are different
 * jobs, so they are different screens rather than one screen with a brand
 * filter bolted on, exactly as offers already split.
 *
 * Everything here is staff only. It reads `contest_totals`, whose body is gated
 * on `is_staff() or is_service_role()`, so a creator running this query would
 * get an empty result rather than a leak. NOTHING IN THIS FILE MAY BE IMPORTED
 * BY CREATOR CODE, which `.oxlintrc.json` enforces.
 *
 * Reads only. Every write still goes through `useManageContest`.
 */

export const ALL_CONTESTS_PAGE_SIZE = 20;

/**
 * The four piles.
 *
 * `on` and `off` are the `status` column. `ended` is the pile that needs a
 * human: switched on, the deadline has gone, and nobody has settled or
 * cancelled it. It is a SUBSET OF `on` by construction, and deliberately so:
 * its four database predicates are exactly the conditions under which
 * `stateOf` returns 'closed', which is what keeps the number on the tab and the
 * chip on the row from telling two different stories. Widening this to include
 * switched-off contests would put rows reading "Closed to new entries" under a
 * tab labelled Ended, which is the same quiet disagreement the offers screen
 * had to be fixed for.
 */
export type AllContestsTab = 'all' | 'on' | 'off' | 'ended';

/** Soonest deadline first is the default because that is the job. */
export type AllContestsSort = 'deadline' | 'newest';

export interface AllContestsFilters {
  search: string;
  brandId: string;
  tab: AllContestsTab;
  sort: AllContestsSort;
  page: number;
}

export const DEFAULT_ALL_CONTESTS_FILTERS: AllContestsFilters = {
  search: '',
  brandId: '',
  tab: 'all',
  sort: 'deadline',
  page: 1,
};

export interface AllContestsRow {
  contest: Contest;
  brandName: string | null;
  brandIsActive: boolean;
}

/**
 * The whole contest row, because `stateOf` takes a whole `Contest`.
 *
 * Reading fewer columns and inventing the rest to satisfy the type would put
 * made up values one refactor away from being printed, and the columns left are
 * a description and a banner url on a page of twenty rows.
 */
/*
 * judging_basis is NOT in this list any more. The column is dropped by
 * 20260814010000, so naming it returns 42703 and blanks the whole page rather
 * than leaving one field empty.
 */
const CONTEST_COLUMNS =
  'id, brand_id, name, description, brief_url, banner_url, status, ' +
  'needs_admin_approval, opens_at, expires_at, expires_at_timezone, currency, ' +
  'settled_at, cancelled_at, cancel_message, created_at, updated_at, ' +
  'brand:brands (id, name, is_active)';

interface ContestRow {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  brief_url: string | null;
  banner_url: string | null;
  status: ContestStatus;
  needs_admin_approval: boolean;
  opens_at: string;
  expires_at: string;
  expires_at_timezone: string;
  currency: string;
  settled_at: string | null;
  cancelled_at: string | null;
  cancel_message: string | null;
  created_at: string;
  updated_at: string;
  brand: { id: string; name: string; is_active: boolean } | null;
}

const flatten = (r: ContestRow): AllContestsRow => ({
  contest: {
    id: r.id,
    brandId: r.brand_id,
    name: r.name,
    description: r.description,
    briefUrl: r.brief_url,
    bannerUrl: r.banner_url,
    // Not selected by the list query: the grid draws no artwork. Present so the
    // shared Contest type is honest about what a full row carries.
    cardImageUrl: null,
    perks: null,
    status: r.status,
    needsAdminApproval: r.needs_admin_approval,
    opensAt: r.opens_at,
    expiresAt: r.expires_at,
    expiresAtTimezone: r.expires_at_timezone,
    currency: r.currency,
    settledAt: r.settled_at,
    cancelledAt: r.cancelled_at,
    cancelMessage: r.cancel_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  },
  brandName: r.brand?.name ?? null,
  // A brand row we cannot read is not a retired brand, so the benefit of the
  // doubt goes to "still live" and only a real `false` prints the chip.
  brandIsActive: r.brand?.is_active !== false,
});

/**
 * PostgREST puts filter values straight into the query string, where a comma or
 * a bracket changes what the filter MEANS rather than being matched literally.
 */
const sanitise = (raw: string) =>
  raw
    .trim()
    .replace(/[^a-zA-Z0-9 &._-]/g, '')
    .slice(0, 64);

/**
 * `_` survives `sanitise` and `_` is a single character wildcard in `ilike`, so
 * a search for "spring_2026" matches "springX2026" without this. The same
 * escape `useContests` applies, kept identical on purpose: two search boxes
 * over the same column that disagree about wildcards is a support call nobody
 * can answer. `%` and `\` are already gone by the time this runs; both are
 * listed so the function is correct on its own terms.
 */
const forLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Which brands are called that.
 *
 * The search box searches a contest name AND a brand name, and a brand name
 * lives on a different table. PostgREST cannot `or` across an embedded resource
 * without turning the embed into an inner join, which would then silently drop
 * every contest whose brand row is unreadable, so the brand half is resolved to
 * ids first and matched with `brand_id.in.(...)`. `brands` is a small table and
 * this is one extra round trip on a search only.
 */
async function brandIdsNamed(search: string): Promise<string[]> {
  if (!search) return [];
  const { data, error } = await getSupabase()
    .from('brands')
    .select('id')
    .ilike('name', `%${forLike(search)}%`);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string }[]).map((b) => b.id);
}

/**
 * ONE definition of what each tab means, used by the list AND by the counts.
 *
 * The counts on the chips and the rows in the list have to be answers to the
 * same question. Writing the predicates twice is how the offers screen ended up
 * saying 40 on a chip above a list of 3, so there is exactly one of them and
 * both callers go through here.
 */
function contestQuery(
  select: string,
  options: { count: 'exact'; head: boolean },
  tab: AllContestsTab,
  brandId: string,
  search: string,
  brandIds: string[],
  nowIso: string
) {
  let q = getSupabase().from('contests').select(select, options);

  if (brandId) q = q.eq('brand_id', brandId);

  if (tab === 'on') q = q.eq('status', 'active');
  if (tab === 'off') q = q.eq('status', 'inactive');
  if (tab === 'ended') {
    // The four conditions under which `stateOf` says 'closed'. Nothing else.
    q = q
      .eq('status', 'active')
      .lte('expires_at', nowIso)
      .is('settled_at', null)
      .is('cancelled_at', null);
  }

  if (search) {
    const clauses = [`name.ilike.*${forLike(search)}*`];
    if (brandIds.length > 0) clauses.push(`brand_id.in.(${brandIds.join(',')})`);
    q = q.or(clauses.join(','));
  }

  return q;
}

/**
 * The list itself, paged and filtered in the database.
 *
 * This grows with every brand times every contest and has no ceiling, so it is
 * never fetched whole. `now` is read inside the query function rather than
 * being part of the key: a clock in the key would rebuild the cache on every
 * tick and throw away the page under whoever is reading it.
 */
export function useAllContests(filters: AllContestsFilters) {
  const search = sanitise(filters.search);
  useAdminContestsLive();

  return useQuery({
    queryKey: ['admin', 'all-contests', { ...filters, search }],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // Rule L5. A deadline passing writes no row, so it fires no realtime event
    // and invalidates nothing. Without this, a tab left open across a deadline
    // keeps showing "Open to enter" on a contest nobody can enter, and the
    // Ended pile never grows the row somebody is meant to act on.
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ rows: AllContestsRow[]; total: number }> => {
      const from = (filters.page - 1) * ALL_CONTESTS_PAGE_SIZE;
      const nowIso = new Date().toISOString();
      const brandIds = await brandIdsNamed(search);

      const q = contestQuery(
        CONTEST_COLUMNS,
        { count: 'exact', head: false },
        filters.tab,
        filters.brandId,
        search,
        brandIds,
        nowIso
      );

      // Soonest deadline first. A contest closing tomorrow, or one that closed
      // yesterday and is still sitting there, is what somebody opened this
      // screen to deal with.
      const ordered =
        filters.sort === 'newest'
          ? q.order('created_at', { ascending: false })
          : q.order('expires_at', { ascending: true });

      const { data, error, count } = await ordered.range(
        from,
        from + ALL_CONTESTS_PAGE_SIZE - 1
      );

      if (error) throw error;
      return {
        rows: ((data ?? []) as unknown as ContestRow[]).map(flatten),
        total: count ?? 0,
      };
    },
  });
}

interface AllContestsCounts {
  all: number;
  on: number;
  off: number;
  ended: number;
}

/**
 * The tab counts, COUNTED IN THE DATABASE rather than over a page of rows.
 *
 * The search and the brand filter are applied here too, and they have to be.
 * Counting every contest while the list below counts the match is the same
 * disagreement that had to be fixed on the offers screen: the chips described
 * one question and the list answered another, and neither said which.
 *
 * Cheap: PostgREST answers a head request with a header, not with rows.
 */
export function useAllContestCounts(search: string, brandId: string) {
  const clean = sanitise(search);

  return useQuery({
    queryKey: ['admin', 'all-contest-counts', { search: clean, brandId }],
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AllContestsCounts> => {
      const nowIso = new Date().toISOString();
      const brandIds = await brandIdsNamed(clean);

      const count = (tab: AllContestsTab) =>
        contestQuery(
          'id',
          { count: 'exact', head: true },
          tab,
          brandId,
          clean,
          brandIds,
          nowIso
        );

      const [all, on, off, ended] = await Promise.all([
        count('all'),
        count('on'),
        count('off'),
        count('ended'),
      ]);

      if (all.error) throw all.error;
      if (on.error) throw on.error;
      if (off.error) throw off.error;
      if (ended.error) throw ended.error;

      return {
        all: all.count ?? 0,
        on: on.count ?? 0,
        off: off.count ?? 0,
        ended: ended.count ?? 0,
      };
    },
  });
}

/** How many creators are waiting on a decision, and how many are in. */
export interface ContestPeople {
  pending: number;
  approved: number;
}

/**
 * The two numbers this screen is for, read out of `contest_totals`.
 *
 * ONE GROUPED READ FOR THE WHOLE PAGE, never one query per row, and counted by
 * Postgres rather than by fetching entries and counting them here. The view is
 * grouped by (contest, currency) because summing two currencies into one figure
 * is the one arithmetic error this product must never make, so a contest can
 * come back as more than one row and the counts are added up. In practice
 * `contests.currency` pins a contest to one.
 *
 * A contest nobody has entered has NO ROW in the view at all, which is why the
 * caller must tell a missing entry apart from a zero rather than printing 0.
 */
export function useContestPeople(contestIds: string[]) {
  const key = [...contestIds].sort().join(',');

  return useQuery({
    queryKey: ['admin', 'contest-people', key],
    enabled: contestIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Record<string, ContestPeople>> => {
      const { data, error } = await getSupabase()
        .from('contest_totals')
        .select('contest_id, entries_pending, entries_approved')
        .in('contest_id', contestIds);
      if (error) throw error;

      const out: Record<string, ContestPeople> = {};
      for (const row of (data ?? []) as unknown as {
        contest_id: string | null;
        entries_pending: number | null;
        entries_approved: number | null;
      }[]) {
        if (!row.contest_id) continue;
        const p = (out[row.contest_id] ??= { pending: 0, approved: 0 });
        p.pending += row.entries_pending ?? 0;
        p.approved += row.entries_approved ?? 0;
      }
      return out;
    },
  });
}

/**
 * Every brand that has ever run a contest, for the brand filter.
 *
 * Built from the contests themselves rather than from the brand list, so the
 * filter never offers a brand that would return an empty screen.
 *
 * BOUNDED, because `contests` grows with every brand times every contest and
 * this project's habit is that no growable list is ever fetched whole.
 * PostgREST has no `distinct`, so the de-duplication happens below and the read
 * has to be capped instead. Newest first, so the cap can only ever cost the
 * filter a brand that stopped running contests long ago rather than one
 * somebody is looking for today. If this is ever reached, the answer is a view
 * of distinct (brand_id) rather than a bigger number here.
 */
const BRAND_FILTER_SCAN = 2000;

export function useBrandsWithContests() {
  return useQuery({
    queryKey: ['admin', 'brands-with-contests'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await getSupabase()
        .from('contests')
        .select('brand_id, brand:brands (id, name)')
        .order('created_at', { ascending: false })
        .limit(BRAND_FILTER_SCAN);
      if (error) throw error;

      const seen = new Map<string, string>();
      for (const row of (data ?? []) as unknown as {
        brand: { id: string; name: string } | null;
      }[]) {
        if (row.brand) seen.set(row.brand.id, row.brand.name);
      }
      return [...seen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
