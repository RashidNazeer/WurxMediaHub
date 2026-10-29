import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { Brand, BrandBrief, BrandProduct, Offer } from '@/lib/admin/useBrands';
import type { BrandThemeConfig } from '@/lib/brand-theme';

/**
 * Every write in the Brand Hub.
 *
 * Deliberately not table writes. `brands`, `offers`, `brand_products` and
 * `brand_commercials` have no insert, update or delete policy at all, and the
 * database functions behind these calls are granted to `service_role` alone,
 * so the browser could not do this even if it tried. The Edge Function is the
 * only door, and it re-reads the caller's role from the profiles table before
 * it opens.
 */

type BrandSavePayload = {
  action: 'brand.save';
  brandId?: string | null;
  name: string;
  storeId: string;
  clientName: string | null;
  budget: number | null;
  currency: string;
  isActive: boolean;
};

type OfferSavePayload = {
  action: 'offer.save';
  offerId?: string | null;
  brandId: string;
  badgeTitle: string | null;
  title: string;
  description: string | null;
  /** Null is legitimate: an offer can have no fixed deliverable or fee. */
  videoCount: number | null;
  rewardAmount: number | null;
  currency: string;
  status: 'active' | 'inactive';
  needsApplication: boolean;

  /*
   * BOTH REQUIRED, NEVER OPTIONAL, and that is a security decision rather than
   * a typing preference. Made optional, TypeScript stays green while a caller
   * omits them, `save_offer` writes its defaults, and a retainer meant for
   * three named creators ships to every creator on the platform with a success
   * toast on screen. A compiler error is the cheapest possible place to catch
   * that.
   *
   * `audience` is the raw pasted text. Resolving a handle to a person is a
   * staff-only lookup and happens in the Edge Function.
   */
  kind: 'retainer' | 'volume' | 'high_commission';
  audience: string;
};

type OfferDeletePayload = { action: 'offer.delete'; offerId: string };

/**
 * The brand's story. Its own action, so the About form cannot touch the name,
 * the store id or the budget by sending a stale copy of them back.
 */
type BrandAboutPayload = {
  action: 'brand.about';
  brandId: string;
  logoUrl: string | null;
  tagline: string | null;
  description: string | null;
  /** The one colour the creator's Brand Hub accent and hero are derived from. */
  brandColor: string | null;
  heroUrl: string | null;
  /**
   * The areas an admin coloured by hand, or null for "derive all of them".
   *
   * Fills only. No text colour reaches the database, which is what lets an
   * admin be given four pickers per area without being given a way to ship a
   * hub creators cannot read.
   */
  theme: BrandThemeConfig | null;
  /** The founder, shown in the hub introduction. All optional. */
  founderName: string | null;
  founderRole: string | null;
  founderNote: string | null;
};

type BriefSavePayload = {
  action: 'brief.save';
  briefId?: string | null;
  brandId: string;
  title: string;
  whatToMake: string | null;
  hooks: string[];
  dos: string[];
  donts: string[];
  isActive: boolean;
};

type BriefDeletePayload = { action: 'brief.delete'; briefId: string };

type ProductSavePayload = {
  action: 'product.save';
  productId?: string | null;
  brandId: string;
  name: string;
  externalProductId: string;
  imageUrl: string | null;
  /** Null is legitimate: a product can be listed before its numbers land. */
  price: number | null;
  currency: string;
  commissionRate: number | null;
  badgeTitle: string | null;
  isActive: boolean;
};

type ProductDeletePayload = { action: 'product.delete'; productId: string };

type ManagePayload =
  | BrandSavePayload
  | BrandAboutPayload
  | OfferSavePayload
  | OfferDeletePayload
  | ProductSavePayload
  | ProductDeletePayload
  | BriefSavePayload
  | BriefDeletePayload;

interface ManageResult {
  row: Brand | Offer | BrandProduct | BrandBrief;
  /** Pasted lines that matched no creator. Empty on everything but offers. */
  unmatched: string[];
}

export function useManageBrand() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ManagePayload): Promise<ManageResult> => {
      const { data, error } = await getSupabase().functions.invoke('manage-brand', {
        body: payload,
      });
      if (error) throw new Error(await messageFrom(error));
      const body = data as {
        result: Brand | Offer | BrandProduct | BrandBrief;
        unmatched?: string[];
      };
      /*
       * `unmatched` rides back on a SUCCESSFUL save of an offer whose pasted
       * creator list had lines we could not match to anybody. Rashid asked for
       * exactly that: save what matched, name what did not. It is carried
       * through here rather than swallowed, because the only place it can be
       * shown is the dialog that sent it.
       */
      return { row: body.result, unmatched: body.unmatched ?? [] };
    },

    onSuccess: () => {
      // Cheap, and much safer than patching five caches by hand. Realtime also
      // refreshes the open offer list, but an admin must not have to wait on a
      // websocket to see their own edit.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'brands'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'brand'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offers'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'all-offers'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'all-offer-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-kind-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'offer-audience'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'briefs'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      // The creator hub reads the same rows through different queries, so an
      // admin who is also looking at a hub sees their own edit there too.
      void queryClient.invalidateQueries({ queryKey: ['creator'] });
    },
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`, which is the
 * actual Response. Without this an admin would see that sentence instead of
 * "Another brand already uses that store id".
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
