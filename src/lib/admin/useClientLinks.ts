import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

/**
 * The client share links, for the screen that manages them.
 *
 * EVERY CALL HERE IS AN RPC, not a table read. `collab_share_links` has RLS on
 * with no policy and no grant to `authenticated`, so there is nothing to select
 * from the browser even as an admin: the three functions are the only doors,
 * and each re-checks the caller's role in the database. See the migration
 * 20260917213000_collab_client_shares.sql.
 *
 * `collab_share_list` never returns anything a link could be rebuilt from — the
 * link exists in one response, at creation, and nowhere afterwards.
 */

export type ClientLink = {
  id: string;
  label: string;
  /** The link itself. Null for links minted before 2026-09-18; those are replaced, not recovered. */
  token: string | null;
  token_hint: string;
  brands: string[];
  months: string[];
  show_kpis: boolean;
  show_top_videos: boolean;
  show_creators: boolean;
  show_videos: boolean;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_viewed_at: string | null;
  view_count: number;
  is_live: boolean;
};

type NewClientLink = {
  label: string;
  brands: string[];
  months: string[];
  days: number;
  showKpis: boolean;
  showTopVideos: boolean;
  showCreators: boolean;
  showVideos: boolean;
};

export function useClientLinks() {
  return useQuery({
    queryKey: ['client-links'],
    queryFn: async (): Promise<ClientLink[]> => {
      const { data, error } = await getSupabase().rpc('collab_share_list');
      if (error) throw error;
      return (data ?? []) as ClientLink[];
    },
    staleTime: 30_000,
  });
}

/**
 * Which brands exist in Paid Collabs, and which months each one has work in.
 *
 * Paged, because PostgREST stops at 1000 rows without a word and Paid Collabs
 * passed that months ago: a brand missing from this list would look to an admin
 * like a brand that cannot be shared.
 */
export function useCollabScope() {
  return useQuery({
    queryKey: ['collab-scope'],
    queryFn: async (): Promise<{ brand: string; months: string[] }[]> => {
      const rows: { brand: string | null; hiring_date: string | null }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await getSupabase()
          .schema('wurxbase')
          .from('creators')
          .select('brand, hiring_date')
          .order('id')
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...((data ?? []) as typeof rows));
        if ((data ?? []).length < 1000) break;
      }
      const byBrand = new Map<string, Set<string>>();
      for (const r of rows) {
        const brand = String(r.brand ?? '').trim();
        if (!brand) continue;
        const month = String(r.hiring_date ?? '').slice(0, 7);
        if (!byBrand.has(brand)) byBrand.set(brand, new Set());
        if (/^\d{4}-\d{2}$/.test(month)) byBrand.get(brand)!.add(month);
      }
      return [...byBrand.entries()]
        .map(([brand, months]) => ({ brand, months: [...months].sort().reverse() }))
        .sort((a, b) => a.brand.localeCompare(b.brand));
    },
    staleTime: 5 * 60_000,
  });
}

export function useCreateClientLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewClientLink) => {
      const { data, error } = await getSupabase().rpc('collab_share_create', {
        p_label: input.label,
        p_brands: input.brands,
        p_days: input.days,
        p_months: input.months,
        p_show_kpis: input.showKpis,
        p_show_top_videos: input.showTopVideos,
        p_show_creators: input.showCreators,
        p_show_videos: input.showVideos,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; token: string; expires_at: string };
      return row;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['client-links'] }),
  });
}

type LinkOpen = { viewed_at: string; visitor: string | null; user_agent: string | null };

/** When a link was opened, newest first. Never an address: only a salted hash. */
export function useClientLinkOpens(id: string | null) {
  return useQuery({
    queryKey: ['client-link-opens', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<LinkOpen[]> => {
      const { data, error } = await getSupabase().rpc('collab_share_opens', { p_id: id, p_limit: 50 });
      if (error) throw error;
      return (data ?? []) as LinkOpen[];
    },
    staleTime: 30_000,
  });
}

/** A new address for the same link. The old one dies immediately. */
export function useReplaceClientLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await getSupabase().rpc('collab_share_replace', { p_id: id });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as { id: string; token: string; expires_at: string };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['client-links'] }),
  });
}

export function useRevokeClientLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await getSupabase().rpc('collab_share_revoke', { p_id: id });
      if (error) throw error;
      return id;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['client-links'] }),
  });
}
