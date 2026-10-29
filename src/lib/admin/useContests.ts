import { useEffect } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { joinChannel } from '@/lib/realtime';
import { useAuth } from '@/lib/auth/auth-context';
import { contestLifecycleOf, type ContestLifecycle } from '@/lib/contest-state';

/**
 * KEEP EVERY ADMIN CONTEST SCREEN CURRENT, ON ONE CHANNEL.
 *
 * `contest_entries` has been in the realtime publication since contests
 * shipped, and until 2026-08-15 no ADMIN screen ever subscribed to it. So a
 * creator applying, or withdrawing, or applying again after withdrawing,
 * changed nothing in front of whoever was looking at the contest. Rashid found
 * all three by hand, which is the worst way to find them.
 *
 * ONE channel for all of it rather than one per hook. `joinChannel` reference
 * counts, so every screen that calls this shares a single subscription and the
 * last one to unmount closes it. Adding a second channel over the same table
 * would be two sockets answering one question.
 *
 * `contests` is on it too: switching a contest on or off, cancelling it or
 * closing it moves every list that names it.
 *
 * WHAT IS DELIBERATELY NOT ON IT is `contest_progress_updates`, which is
 * outside the publication on purpose, because row security is not applied to
 * DELETE events and a creator's claimed GMV would broadcast to anybody who
 * opened an unfiltered channel. That queue refetches on a timer instead.
 */
export function useAdminContestsLive() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    return joinChannel(
      'admin-contests',
      [{ table: 'contest_entries' }, { table: 'contests' }],
      () => {
        // `all-contests` is its own key, not a child of `contests`, so listing
        // it here is load bearing: TanStack matches by prefix and would never
        // have reached it.
        for (const key of [
          'contests',
          'all-contests',
          'contest',
          'contest-entries',
          'contest-awards',
        ]) {
          void queryClient.invalidateQueries({ queryKey: ['admin', key] });
        }
      }
    );
  }, [user?.id, queryClient]);
}

/**
 * Contests, as STAFF see them.
 *
 * Reads only. Every write goes through `useManageContest`, which calls the
 * `manage-contest` Edge Function, because there is no insert, update or delete
 * policy on any of the eleven contest tables and every database function is
 * granted to `service_role` alone.
 *
 * The creator's view of the same data is a separate file on purpose, the same
 * split that keeps `useCreatorBrands` away from `useBrands`. It reads fewer
 * columns from fewer tables, and keeping the two apart is what stops a creator
 * screen quietly inheriting a query that reaches for a budget.
 *
 * NOTHING HERE MAY BE IMPORTED BY CREATOR CODE. `contest_commercials` is staff
 * only at the database, so a creator importing this would get an empty result
 * rather than a leak, but the empty result would look like a bug and somebody
 * would "fix" it.
 */

export const BRAND_CONTESTS_PAGE_SIZE = 12;

export type ContestStatus = 'active' | 'inactive';

/**
 * What a deliverable asks for. Mirrors the database enum
 * `public.contest_deliverable_type`, two values today and more later, one
 * `alter type ... add value` at a time.
 *
 * THE THREE KINDS ARE GONE, and with them rankPosition, metric, threshold and
 * the old videoCount column. Placings were dropped on 2026-08-13: anybody who
 * reaches a target earns its reward and several creators can earn the same one,
 * so there is nothing to come first in. Declared here rather than imported from
 * `useManageContest`, which already imports `ContestStatus` from this file and
 * would make the two a cycle.
 */
type ContestDeliverableType = 'gmv' | 'video_count';

/** The commercial half. Staff only, and its own table for exactly that reason. */
interface ContestCommercials {
  totalBudget: number | null;
  internalNote: string | null;
}

/**
 * ONE DELIVERABLE: a type, a target the creator has to reach, and the reward
 * for reaching it.
 *
 * BOTH NUMBERS ARE REAL NUMBERS, never null. The database requires them, so
 * there is no "not priced yet" case left to draw and no null to mistake for a
 * zero. A reward of zero is a genuine unpaid deliverable and reads as one.
 */
interface ContestDeliverable {
  id: string;
  contestId: string;
  type: ContestDeliverableType;
  title: string;
  detail: string | null;
  /** The number to reach. Whole, 1 to 1000, when the type is video_count. */
  targetValue: number;
  rewardAmount: number;
  sortOrder: number;
  isActive: boolean;
}

export interface ContestProduct {
  productId: string;
  productName: string;
  externalProductId: string;
}

export interface ContestExclusion {
  id: string;
  handle: string | null;
  email: string | null;
  userId: string | null;
  reason: string | null;
  /** How many times somebody barred has tried anyway, straight at the API. */
  attempts: number;
  lastAttemptAt: string | null;
  createdAt: string;
}

export interface Contest {
  id: string;
  brandId: string;
  name: string;
  description: string | null;
  /*
   * judgingBasis is GONE, with the column. It existed so a placing would never
   * feel arbitrary, and there are no placings: the deliverable rows say what a
   * creator has to reach in numbers. Naming the column in a select now returns
   * 42703 and blanks the whole screen, so it is out of CONTEST_COLUMNS too.
   */
  briefUrl: string | null;
  bannerUrl: string | null;
  cardImageUrl: string | null;
  perks: string | null;
  status: ContestStatus;
  needsAdminApproval: boolean;
  opensAt: string;
  expiresAt: string;
  /** An IANA zone name. "Europe/London", never "+01:00". */
  expiresAtTimezone: string;
  currency: string;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const CONTEST_COLUMNS =
  'id, brand_id, name, description, brief_url, banner_url, card_image_url, perks, status, ' +
  'needs_admin_approval, opens_at, expires_at, expires_at_timezone, currency, ' +
  'settled_at, cancelled_at, cancel_message, created_at, updated_at';

interface ContestRow {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  brief_url: string | null;
  banner_url: string | null;
  card_image_url: string | null;
  perks: string | null;
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
}

const flatten = (r: ContestRow): Contest => ({
  id: r.id,
  brandId: r.brand_id,
  name: r.name,
  description: r.description,
  briefUrl: r.brief_url,
  bannerUrl: r.banner_url,
  cardImageUrl: r.card_image_url,
  perks: r.perks,
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
});

/**
 * The three axes, as one word for a screen to print.
 *
 * "Active" is not one question, it is three: may somebody new enter, may
 * anybody read it, and may the people already in still work and be paid. This
 * only answers the first, and it is deliberately NOT called `isOpen`, because
 * a closed contest still carries live work.
 *
 * THE BODY LIVES IN `src/lib/contest-state.ts` now, because the creator side
 * needs exactly the same answer in exactly the same words and may not import
 * this file. This stays here so every existing caller keeps its import.
 *
 * There is deliberately no `STATE_LABEL` beside it any more. The words belong
 * to `ContestStateChip`, which both sides draw, and a second exported map of
 * the same five phrases is how two screens end up disagreeing about one of them.
 */
type ContestState = ContestLifecycle;

export function stateOf(c: Contest, now = Date.now()): ContestState {
  return contestLifecycleOf(c, now);
}

export interface BrandContestFilters {
  search: string;
  status: 'all' | ContestStatus;
  page: number;
}

const sanitise = (raw: string) =>
  raw
    .trim()
    .replace(/[^a-zA-Z0-9 &._-]/g, '')
    .slice(0, 64);

/**
 * `_` survives `sanitise` and `_` is a single character wildcard in `ilike`, so
 * a search for "spring_2026" was matching "springX2026". Escaped rather than
 * stripped, because stripping it would stop a contest with an underscore in its
 * name being findable by its own name. `%` and `\` are already gone by the time
 * this runs; both are listed so the function is correct on its own terms.
 */
const forLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Every contest a brand runs, paged in the database.
 *
 * Paged rather than fetched whole because the Offers tab shipped unbounded and
 * had to be fixed later, once its counts had quietly started describing the
 * first twelve rows.
 */
export function useBrandContests(brandId: string | undefined, filters: BrandContestFilters) {
  const search = sanitise(filters.search);
  // Somebody entering this brand's contest has to move the count in front of
  // whoever is looking at it, not on the next reload.
  useAdminContestsLive();

  return useQuery({
    queryKey: ['admin', 'contests', brandId, { ...filters, search }],
    enabled: Boolean(brandId),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // Rule L5. A contest closes because a clock passed, which writes no row and
    // therefore fires no realtime event and invalidates nothing. Without this,
    // an admin who leaves the tab open across a deadline keeps reading an "open
    // to enter" chip on a contest nobody can enter any more.
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ rows: Contest[]; total: number }> => {
      const from = (filters.page - 1) * BRAND_CONTESTS_PAGE_SIZE;

      let q = getSupabase()
        .from('contests')
        .select(CONTEST_COLUMNS, { count: 'exact' })
        .eq('brand_id', brandId!);

      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (search) q = q.ilike('name', `%${forLike(search)}%`);

      // Soonest deadline first. A contest closing tomorrow is the one somebody
      // opened this tab to deal with.
      const { data, error, count } = await q
        .order('expires_at', { ascending: true })
        .range(from, from + BRAND_CONTESTS_PAGE_SIZE - 1);

      if (error) throw error;
      return {
        rows: ((data ?? []) as unknown as ContestRow[]).map(flatten),
        total: count ?? 0,
      };
    },
  });
}

/**
 * Counts for the status tabs, in the database rather than over a page of rows.
 *
 * THE SEARCH IS APPLIED HERE TOO, and it has to be. Counting the whole brand
 * while the list below counts the match is the same quiet disagreement that had
 * to be fixed on the Offers tab: the chips said 40 and the list showed 3, and
 * neither number was labelled as answering a different question.
 */
export function useBrandContestCounts(brandId: string | undefined, rawSearch = '') {
  const search = sanitise(rawSearch);

  return useQuery({
    queryKey: ['admin', 'contests', brandId, 'counts', search],
    enabled: Boolean(brandId),
    staleTime: 15_000,
    queryFn: async (): Promise<{ all: number; active: number; inactive: number }> => {
      const sb = getSupabase();
      const base = () => {
        const q = sb
          .from('contests')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brandId!);
        return search ? q.ilike('name', `%${forLike(search)}%`) : q;
      };

      const [all, active, inactive] = await Promise.all([
        base(),
        base().eq('status', 'active'),
        base().eq('status', 'inactive'),
      ]);

      if (all.error) throw all.error;
      return {
        all: all.count ?? 0,
        active: active.count ?? 0,
        inactive: inactive.count ?? 0,
      };
    },
  });
}

/**
 * One contest and everything inside it, for the setup screen.
 *
 * Five reads rather than one nested select, because the commercial row is in a
 * different table with a different policy and a nested select that silently
 * returns null for it would look identical to a contest with no budget set.
 */
export function useContest(contestId: string | undefined) {
  useAdminContestsLive();

  return useQuery({
    queryKey: ['admin', 'contest', contestId],
    enabled: Boolean(contestId),
    staleTime: 10_000,
    queryFn: async (): Promise<{
      contest: Contest | null;
      commercials: ContestCommercials | null;
      deliverables: ContestDeliverable[];
      products: ContestProduct[];
      exclusions: ContestExclusion[];
    }> => {
      const sb = getSupabase();
      const id = contestId!;

      const [c, m, d, p, x] = await Promise.all([
        sb.from('contests').select(CONTEST_COLUMNS).eq('id', id).maybeSingle(),
        sb
          .from('contest_commercials')
          .select('total_budget, internal_note')
          .eq('contest_id', id)
          .maybeSingle(),
        sb
          .from('contest_deliverables')
          .select(
            'id, contest_id, type, title, detail, target_value, reward_amount, ' +
              'sort_order, is_active'
          )
          .eq('contest_id', id)
          .order('sort_order', { ascending: true }),
        sb
          .from('contest_products')
          .select('product_id, product_name, external_product_id')
          .eq('contest_id', id)
          .order('product_name', { ascending: true }),
        sb
          .from('contest_exclusions')
          .select('id, handle, email, user_id, reason, attempts, last_attempt_at, created_at')
          .eq('contest_id', id)
          .order('created_at', { ascending: false }),
      ]);

      if (c.error) throw c.error;
      if (m.error) throw m.error;
      if (d.error) throw d.error;
      if (p.error) throw p.error;
      if (x.error) throw x.error;

      interface DRow {
        id: string;
        contest_id: string;
        type: ContestDeliverableType;
        title: string;
        detail: string | null;
        /*
         * numeric(14, 2) arrives as a string over PostgREST whenever it does not
         * fit a double cleanly, which is why both of these go through Number()
         * below rather than being trusted as they land.
         */
        target_value: number | string;
        reward_amount: number | string;
        sort_order: number;
        is_active: boolean;
      }
      interface PRow {
        product_id: string;
        product_name: string;
        external_product_id: string;
      }
      interface XRow {
        id: string;
        handle: string | null;
        email: string | null;
        user_id: string | null;
        reason: string | null;
        attempts: number;
        last_attempt_at: string | null;
        created_at: string;
      }
      const mm = m.data as unknown as {
        total_budget: number | null;
        internal_note: string | null;
      } | null;

      return {
        contest: c.data ? flatten(c.data as unknown as ContestRow) : null,
        commercials: mm
          ? { totalBudget: mm.total_budget, internalNote: mm.internal_note }
          : null,
        deliverables: ((d.data ?? []) as unknown as DRow[]).map((r) => ({
          id: r.id,
          contestId: r.contest_id,
          type: r.type,
          title: r.title,
          detail: r.detail,
          targetValue: Number(r.target_value),
          rewardAmount: Number(r.reward_amount),
          sortOrder: r.sort_order,
          isActive: r.is_active,
        })),
        products: ((p.data ?? []) as unknown as PRow[]).map((r) => ({
          productId: r.product_id,
          productName: r.product_name,
          externalProductId: r.external_product_id,
        })),
        exclusions: ((x.data ?? []) as unknown as XRow[]).map((r) => ({
          id: r.id,
          handle: r.handle,
          email: r.email,
          userId: r.user_id,
          reason: r.reason,
          attempts: r.attempts,
          lastAttemptAt: r.last_attempt_at,
          createdAt: r.created_at,
        })),
      };
    },
  });
}
