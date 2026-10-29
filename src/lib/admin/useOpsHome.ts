import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { STAGE_META, type OfferStage } from '@/lib/offer-stages';

/**
 * What today actually looks like, across the whole product.
 *
 * The admin home read ONE table. It could say "nothing is waiting on you, the
 * queue is clear" while nine creators sat unanswered on the requests queue and
 * forty videos sat unwatched. Everything here exists to stop that sentence
 * being a lie.
 *
 * One hook, one loading state, one error state. The screen already refused to
 * guess while a count was in flight, and with three queues that discipline
 * matters more, not less: three racing queries would let the sentence flicker
 * through "all clear" on the way to the truth.
 */

interface Inbox {
  /** Waiting on US. */
  applications: number;
  requests: number;
  videos: number;
  total: number;
}

/**
 * Head-only counts: PostgREST returns the number in a header and no rows at
 * all, so this stays cheap however long the queues get.
 */
export function useInbox() {
  return useQuery({
    queryKey: ['admin', 'ops-inbox'],
    staleTime: 15_000,
    queryFn: async (): Promise<Inbox> => {
      const supabase = getSupabase();
      const [applications, requests, videos] = await Promise.all([
        supabase
          .from('applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('offer_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabase
          .from('content_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted'),
      ]);
      for (const r of [applications, requests, videos]) if (r.error) throw r.error;

      const a = applications.count ?? 0;
      const r = requests.count ?? 0;
      const v = videos.count ?? 0;
      return { applications: a, requests: r, videos: v, total: a + r + v };
    },
  });
}

interface WithCreators {
  /** Approved jobs sitting at each of these stages. */
  filming: number;
  sampleOut: number;
  awaitingPayment: number;
  /** Approved and not yet paid, however long they have been standing. */
  live: number;
  /** Approved, not paid, and not moved for a fortnight. */
  stalled: number;
}

/** Work that is waiting on THEM rather than on us. */
export function useWithCreators() {
  return useQuery({
    queryKey: ['admin', 'ops-with-creators'],
    staleTime: 30_000,
    queryFn: async (): Promise<WithCreators> => {
      const supabase = getSupabase();
      const approved = () =>
        supabase
          .from('offer_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'approved');

      const fortnightAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();

      const [filming, sampleOut, awaitingPayment, live, stalled] = await Promise.all([
        approved().eq('stage', 'content_pending'),
        approved().eq('stage', 'sample_shipped'),
        approved().eq('stage', 'payment_pending'),
        approved().neq('stage', 'paid'),
        approved().neq('stage', 'paid').lt('stage_updated_at', fortnightAgo),
      ]);
      for (const r of [filming, sampleOut, awaitingPayment, live, stalled]) {
        if (r.error) throw r.error;
      }

      return {
        filming: filming.count ?? 0,
        sampleOut: sampleOut.count ?? 0,
        awaitingPayment: awaitingPayment.count ?? 0,
        live: live.count ?? 0,
        stalled: stalled.count ?? 0,
      };
    },
  });
}

export interface OpsMoney {
  currency: string;
  paid: number;
  due: number;
  working: number;
  total: number;
}

interface StageTotalRow {
  brand_id: string;
  stage: OfferStage | null;
  currency: string;
  jobs: number;
  committed: string | number;
}

/**
 * Money across every brand, split the same three ways the creator sees.
 *
 * Reads `brand_stage_totals`, which is already grouped per brand, so this is
 * one small read rather than a scan. PER CURRENCY, like everywhere else: the
 * home screen must not be the one place that adds dollars to pounds because it
 * felt like a summary.
 */
export function useOpsMoney() {
  return useQuery({
    queryKey: ['admin', 'ops-money'],
    staleTime: 60_000,
    queryFn: async (): Promise<OpsMoney[]> => {
      const { data, error } = await getSupabase()
        .from('brand_stage_totals')
        .select('brand_id, stage, currency, jobs, committed');
      if (error) throw error;

      const byCurrency = new Map<string, OpsMoney>();
      for (const row of (data ?? []) as unknown as StageTotalRow[]) {
        const m =
          byCurrency.get(row.currency) ??
          ({ currency: row.currency, paid: 0, due: 0, working: 0, total: 0 } as OpsMoney);
        const amount = Number(row.committed ?? 0) || 0;
        const bucket = row.stage ? STAGE_META[row.stage].bucket : 'working';
        m[bucket] += amount;
        m.total += amount;
        byCurrency.set(row.currency, m);
      }
      return [...byCurrency.values()].sort((a, b) => b.total - a.total);
    },
  });
}

interface AtRisk {
  /** Brands past 80% of their allocation, worst first. */
  brands: { id: string; name: string; percent: number }[];
  /** Live offers with nobody on them and nobody waiting. */
  emptyOffers: number;
  /** Blocked attempts in the last seven days. */
  blocked: number;
}

/**
 * What deserves a look before it becomes a problem.
 *
 * The budget band comes from `budget_used_percent`, a STORED generated column
 * with its own index, so this filters in the database rather than fetching
 * every brand and doing arithmetic here.
 */
export function useAtRisk() {
  return useQuery({
    queryKey: ['admin', 'ops-at-risk'],
    staleTime: 60_000,
    queryFn: async (): Promise<AtRisk> => {
      const supabase = getSupabase();
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

      const [brands, openOffers, taken, blocked] = await Promise.all([
        supabase
          .from('brand_commercials')
          .select('brand_id, budget_used_percent, brands!inner (id, name, is_active)')
          .gte('budget_used_percent', 80)
          .eq('brands.is_active', true)
          .order('budget_used_percent', { ascending: false })
          .limit(5),
        /*
         * Live offers that a creator has to APPLY for. An offer open to
         * everyone belongs to the whole roster and has no rows to count, so
         * counting it as empty would report every one of them as a problem.
         */
        supabase
          .from('offers')
          .select('id')
          .eq('status', 'active')
          .eq('needs_application', true)
          .limit(500),
        supabase
          .from('offer_applications')
          .select('offer_id')
          .in('status', ['pending', 'approved'])
          .limit(2000),
        supabase
          .from('audit_log')
          .select('id', { count: 'exact', head: true })
          .like('action', '%_denied')
          .gte('created_at', weekAgo),
      ]);
      for (const r of [brands, openOffers, taken, blocked]) if (r.error) throw r.error;

      const withPeople = new Set(
        ((taken.data ?? []) as { offer_id: string }[]).map((r) => r.offer_id)
      );
      const emptyOffers = ((openOffers.data ?? []) as { id: string }[]).filter(
        (o) => !withPeople.has(o.id)
      ).length;

      type BrandRow = {
        brand_id: string;
        budget_used_percent: string | number | null;
        brands: { id: string; name: string } | { id: string; name: string }[] | null;
      };

      return {
        brands: ((brands.data ?? []) as unknown as BrandRow[]).map((row) => {
          // PostgREST returns an embed as an object when it can prove the
          // relationship is one to one and an array when it cannot.
          const b = Array.isArray(row.brands) ? row.brands[0] : row.brands;
          return {
            id: row.brand_id,
            name: b?.name ?? 'A brand',
            percent: Number(row.budget_used_percent ?? 0) || 0,
          };
        }),
        emptyOffers,
        blocked: blocked.count ?? 0,
      };
    },
  });
}
