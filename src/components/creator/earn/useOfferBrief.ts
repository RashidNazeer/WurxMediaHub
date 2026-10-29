import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

/**
 * The brief behind an offer — what to make, the hooks, the do's and the don'ts.
 *
 * `brand_briefs` HAS EXISTED SINCE 2026-10-12 AND NO CREATOR SCREEN READ IT.
 * Every column on it is creator facing by design (read the table comment), the
 * row level security policy already lets an approved creator select it, and the
 * only thing in the codebase that touched it was the admin form that writes it.
 * So reviewers asking for "the brief, the hooks, the content guidelines" were
 * asking for three things we already hold and never showed.
 *
 * A BRIEF HANGS OFF A BRAND, NOT AN OFFER, and this hook cannot pretend
 * otherwise. There is no `offers.brief_id` and no `offer_briefs` table, so what
 * comes back is every live brief the brand has written, and the panel that
 * draws it says so in those words. Guessing which of a brand's three briefs
 * belongs to this particular offer would be inventing a join.
 *
 * LAZY ON PURPOSE. `brandId` is passed as `undefined` until a creator actually
 * opens the details, so the offers list still costs the two round trips it
 * costs today — the filtering exception in `Offers.tsx` is about the LIST, and
 * this is one offer, opened by hand, one brand at a time. React Query keys it
 * by brand, so opening three offers from one brand is still one request.
 */

interface CreatorBrandBrief {
  id: string;
  title: string;
  what_to_make: string | null;
  hooks: string[];
  dos: string[];
  donts: string[];
}

const BRIEF_COLUMNS = 'id, title, what_to_make, hooks, dos, donts, created_at';

export function useCreatorBrandBriefs(brandId: string | undefined) {
  return useQuery({
    queryKey: ['creator', 'brand-briefs', brandId],
    enabled: Boolean(brandId),
    // A brief is written once and read for a month. Longer than the offers
    // list's 30s on purpose.
    staleTime: 300_000,
    queryFn: async (): Promise<CreatorBrandBrief[]> => {
      const { data, error } = await getSupabase()
        // `is_active` is not filtered here. The creator policy on this table
        // already requires it, and a filter would only hide which layer is
        // doing the work.
        .from('brand_briefs')
        .select(BRIEF_COLUMNS)
        .eq('brand_id', brandId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CreatorBrandBrief[];
    },
  });
}
