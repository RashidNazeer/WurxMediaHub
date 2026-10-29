import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { STAGE_META, type OfferApplicationStatus, type OfferStage } from '@/lib/offer-stages';

/*
 * BOTH OF THESE ARE DYNAMIC IMPORTS, AND IT IS THE ENTRY CHUNK THAT DECIDES IT.
 *
 * `AppShell` renders `NotificationBell`, which calls `useCreatorNotifications`,
 * which calls this file — and `router.tsx` imports `AppShell` at the top level,
 * so this module is in the graph the browser must download and EVALUATE before
 * it can paint anything, on the public landing page as much as on a dashboard.
 *
 * A top-level `getSupabase` here therefore put `@supabase/supabase-js` — 204 KB
 * raw, 52.5 KB gzipped — into that startup path, parsed and executed by every
 * visitor. `@/lib/realtime` is in here too because it is the other static edge
 * to the same client: leaving it would have kept the whole thing in place.
 * Measured 2026-10-16 against `dist-perf`.
 *
 * Nothing about the behaviour changes. Every use below is already inside an
 * async `queryFn` or an effect, both of which only run for a signed-in creator,
 * and by then `AuthProvider` has the one shared client in memory so these
 * resolve straight out of the module cache.
 */
const supabaseClient = () => import('@/lib/supabase').then((m) => m.getSupabase());
const realtime = () => import('@/lib/realtime');

/**
 * Everything this creator has asked for, and where each one has got to.
 *
 * One read, then all the arithmetic here. The alternative is half a dozen
 * counting queries whose answers can disagree with each other for a second
 * while they land, which on a screen that talks about money is worse than
 * slower.
 *
 * Row level security means this only ever returns their own rows. The offer
 * and the brand come back even if either was later switched off, because the
 * policies added on 2026-08-01 say you can always read the thing you asked for.
 */

export interface MyWorkRow {
  id: string;
  offer_id: string;
  brand_id: string;
  status: OfferApplicationStatus;
  stage: OfferStage | null;
  stage_updated_at: string | null;
  /** What we agreed to pay. Null on anything not approved. */
  committed_amount: string | number | null;
  /**
   * How many videos were agreed, frozen at approval beside the amount. Null
   * when no number was agreed. Never use `offer.video_count` for a job that is
   * already under way: re-scoping the offer does not change the deal.
   */
  committed_video_count: number | null;
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
  brand: { id: string; name: string; slug: string; logo_url: string | null } | null;
}

export interface StageEvent {
  id: number;
  application_id: string;
  from_stage: OfferStage | null;
  to_stage: OfferStage;
  note: string | null;
  created_at: string;
}

const COLUMNS =
  'id, offer_id, brand_id, status, stage, stage_updated_at, committed_amount, ' +
  'committed_video_count, currency, note, decision_note, decided_at, created_at, ' +
  'offer:offers (id, title, video_count, reward_amount, currency), ' +
  'brand:brands (id, name, slug, logo_url)';

/** One creator's own jobs. Generous, but never unbounded. */
const MY_WORK_CAP = 200;

export function useMyWork() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['creator', 'my-work'],
    staleTime: 15_000,
    queryFn: async (): Promise<MyWorkRow[]> => {
      const supabase = await supabaseClient();
      const { data, error } = await supabase
        .from('offer_applications')
        .select(COLUMNS)
        .order('created_at', { ascending: false })
        // Explicit, like the offers list. Every growable read in this product
        // states its own ceiling rather than inheriting PostgREST's, which
        // truncates silently and would leave the money on this screen quietly
        // short of the truth.
        .limit(MY_WORK_CAP);
      if (error) throw error;
      return (data ?? []) as unknown as MyWorkRow[];
    },
  });

  // A stage change has to land while they are looking at it. Being told
  // immediately is the entire product.
  /*
   * ITS OWN NAME, not the shared `offer-applications:<id>` one, because it
   * watches a SECOND table as well. `joinChannel` refuses to let two different
   * binding sets share a name, loudly in development, and it is right to: a
   * caller joining this name expecting only offer_applications would silently
   * be woken by stage events too.
   *
   * The two invalidations are kept apart even though both fire the same first
   * key, because a stage event also moves the timeline and an application
   * change does not.
   */
  /*
   * `joinChannel` ARRIVES ASYNCHRONOUSLY, SO THE TEARDOWN IS TRACKED BY HAND.
   *
   * React wants a cleanup function back from the effect body, synchronously,
   * and the module that provides `joinChannel` is now a dynamic import (see the
   * note at the top of this file). So the effect returns its own cleanup
   * immediately and that cleanup covers both orders it can run in: after the
   * channel was joined, when it calls `leave`; and before, when `cancelled`
   * stops the join from ever happening. Without the flag, an effect that was
   * cleaned up during the import would subscribe a channel nobody unsubscribes
   * — the leak `realtime.ts` exists to prevent.
   */
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let cancelled = false;
    let leave: (() => void) | undefined;

    void realtime().then(({ joinChannel }) => {
      if (cancelled) return;
      leave = joinChannel(
        `my-work:${userId}`,
        [
          { table: 'offer_applications', filter: `creator_id=eq.${userId}` },
          { table: 'offer_stage_events', event: 'INSERT', filter: `creator_id=eq.${userId}` },
        ],
        () => {
          void queryClient.invalidateQueries({ queryKey: ['creator', 'my-work'] });
          void queryClient.invalidateQueries({ queryKey: ['creator', 'my-stage-events'] });
        }
      );
    });

    return () => {
      cancelled = true;
      leave?.();
    };
  }, [user?.id, queryClient]);

  return query;
}

/** The creator's own history through the pipeline, newest first. */
export function useMyStageEvents(limit = 40) {
  return useQuery({
    queryKey: ['creator', 'my-stage-events', limit],
    staleTime: 15_000,
    queryFn: async (): Promise<StageEvent[]> => {
      const supabase = await supabaseClient();
      const { data, error } = await supabase
        .from('offer_stage_events')
        .select('id, application_id, from_stage, to_stage, note, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as StageEvent[];
    },
  });
}

export interface WorkSummary {
  /** Approved and not finished. */
  active: number;
  approved: number;
  waiting: number;
  declined: number;
  /** Distinct brands they have been approved for. */
  brands: number;
  money: {
    /** Handed over. */
    paid: number;
    /** Work done, waiting on us. */
    due: number;
    /** Agreed, still being worked. */
    working: number;
    /** All three together: everything ever agreed. */
    total: number;
    currency: string;
  };
  /** How many approved requests sit in each stage, for the pipeline chart. */
  byStage: Record<OfferStage, { count: number; amount: number }>;
}

const EMPTY_STAGES = () =>
  Object.fromEntries(
    (Object.keys(STAGE_META) as OfferStage[]).map((s) => [s, { count: 0, amount: 0 }])
  ) as Record<OfferStage, { count: number; amount: number }>;

/**
 * Turn the rows into the numbers a dashboard shows.
 *
 * Money is bucketed by STAGE, never by status, because "approved" says nothing
 * about whether anybody has been paid. Each stage belongs to exactly one bucket
 * (see `STAGE_META`), so paid plus due plus working always equals the total
 * agreed, and a creator can add the three cards up and get the big number.
 *
 * An approved request with no fixed fee contributes nothing to the money and
 * still counts as work. Pretending it is worth zero would be a lie in the other
 * direction.
 */
export function summarise(rows: MyWorkRow[]): WorkSummary {
  const byStage = EMPTY_STAGES();
  const money = { paid: 0, due: 0, working: 0, total: 0, currency: 'USD' };
  const brands = new Set<string>();

  let approved = 0;
  let waiting = 0;
  let declined = 0;
  let active = 0;

  for (const row of rows) {
    if (row.status === 'pending') waiting += 1;
    if (row.status === 'rejected') declined += 1;
    if (row.status !== 'approved') continue;

    approved += 1;
    brands.add(row.brand_id);
    if (row.currency) money.currency = row.currency;

    const stage = row.stage ?? 'pending_request';
    const amount = Number(row.committed_amount ?? 0) || 0;

    byStage[stage].count += 1;
    byStage[stage].amount += amount;

    const bucket = STAGE_META[stage].bucket;
    money[bucket] += amount;
    money.total += amount;
    if (stage !== 'paid') active += 1;
  }

  return {
    active,
    approved,
    waiting,
    declined,
    brands: brands.size,
    money,
    byStage,
  };
}
