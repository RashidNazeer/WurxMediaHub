import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { joinChannel } from '@/lib/realtime';
import { useAuth } from '@/lib/auth/auth-context';
import type { OfferApplicationStatus, OfferStage } from '@/lib/offer-stages';

/**
 * What this creator has asked for, and what came back.
 *
 * Row level security means this only ever returns their own rows, so there is
 * no `creator_id` filter in the query. A creator cannot see who else applied
 * for an offer or what anybody else was offered, and that is a policy in the
 * database rather than a filter here.
 */

export interface MyOfferApplication {
  id: string;
  offer_id: string;
  brand_id: string;
  status: OfferApplicationStatus;
  /**
   * Where approved work has got to. Carried here as well as on the dashboard
   * so every screen that shows an approved offer can say the same thing. "You
   * are in" on one screen and "sample shipped" on another is two answers to
   * one question.
   */
  stage: OfferStage | null;
  /** What we agreed to pay. Null on anything not approved. */
  committed_amount: string | number | null;
  /**
   * How many videos were agreed, snapshotted at approval alongside the amount.
   * Null when no number was agreed, or on anything not approved.
   *
   * Read this, never `offers.video_count`, anywhere a creator is already on the
   * offer. Re-scoping an offer must not change the deal somebody is already
   * working to, so the two numbers legitimately differ and the frozen one is
   * the true one.
   */
  committed_video_count: number | null;
  /** The currency the offer was quoted in when they asked. */
  currency: string;
  note: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

const COLUMNS =
  'id, offer_id, brand_id, status, stage, committed_amount, committed_video_count, ' +
  'currency, note, decision_note, decided_at, created_at';

/**
 * Every request this creator has made inside one brand's hub, newest first.
 *
 * Kept live. A decision has to land while they are looking at it, the same way
 * their approval does on the dashboard, because being told immediately is the
 * whole point of the product.
 */
export function useMyOfferApplications(brandId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['creator', 'my-offer-applications', brandId],
    enabled: Boolean(brandId),
    staleTime: 15_000,
    queryFn: async (): Promise<MyOfferApplication[]> => {
      const { data, error } = await getSupabase()
        .from('offer_applications')
        .select(COLUMNS)
        .eq('brand_id', brandId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as MyOfferApplication[];
    },
  });

  /*
   * Narrowed to this creator's own rows. Row level security would filter it
   * anyway, but there is no reason to be told about rows we then discard.
   *
   * THE BRAND IS NOT IN THE CHANNEL NAME ANY MORE, deliberately. It never was
   * in the FILTER, so `my-offer-applications:<brand>:<creator>` opened a
   * separate subscription per brand to exactly the same rows, and a third to
   * the same rows again from `useAllOffers`. One name, reference counted, one
   * socket, and every listener still hears everything.
   */
  useEffect(() => {
    if (!brandId || !user?.id) return;

    return joinChannel(
      `offer-applications:${user.id}`,
      [{ table: 'offer_applications', filter: `creator_id=eq.${user.id}` }],
      () => {
        void queryClient.invalidateQueries({
          queryKey: ['creator', 'my-offer-applications'],
        });
      }
    );
  }, [brandId, user?.id, queryClient]);

  return query;
}

type ApplyPayload = {
  action: 'application.create';
  offerId: string;
  note: string | null;
};

type WithdrawPayload = { action: 'application.withdraw'; applicationId: string };

/**
 * Asking for an offer, and changing your mind.
 *
 * Not a table write. `offer_applications` has no insert or update policy at
 * all; the Edge Function re-reads who the caller is from the profiles table and
 * calls a security definer function that writes the row and its audit entry
 * together.
 */
export function useApplyForOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ApplyPayload | WithdrawPayload) => {
      const { data, error } = await getSupabase().functions.invoke(
        'manage-offer-application',
        { body: payload }
      );
      if (error) throw new Error(await messageFrom(error));
      return (data as { result: MyOfferApplication }).result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['creator', 'my-offer-applications'] });
      // The offers dashboard reads the same rows through its own query, and a
      // creator who applies from one screen must not see the other disagree.
      void queryClient.invalidateQueries({ queryKey: ['creator', 'all-my-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-applications'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-people'] });
    },
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`, which is the
 * actual Response. Without this a creator sees that sentence instead of
 * "You have already asked for this one".
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
