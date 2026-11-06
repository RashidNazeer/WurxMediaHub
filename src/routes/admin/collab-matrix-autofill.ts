import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { rowHandles } from '@/lib/admin/creator-month-gmv';
import { monthKeyOf, videoHandleOf, videoIdOf } from '@/lib/admin/matrix-autofill';

/**
 * THE FIGURES THAT FILL A BRAND'S PERFORMANCE MATRIX, for `BrandMatrix` in the vendored app.
 *
 * Rashid, 2026-11-06: the GMV and Ad cells for each creator and month should fill themselves,
 * because we already fetch both. THIS FILE IS THE SEAM: the vendored app never imports our
 * Supabase client, so it asks this hook for the figures and does the writing itself, with its own
 * idea of who the canonical creator row is (see `@/lib/admin/matrix-autofill` for the rules).
 *
 *   gmv  `collab_creator_month_gmv`, keyed `${month}|${handle}`: what Euka or Reacher report she
 *        made for the brand that month, by sales date. Only months the platform was actually read
 *        for are present, and a creator Euka's cut-off top 50 did not list is absent, so a missing
 *        figure is "unknown", never a zero.
 *   ad   `euka_ad_video_month`, keyed the same way: what the ads for her videos cost that month.
 *        A video belongs to the handle in its link, or to the row's own handle for a short link.
 */

type VideoRow = { video?: unknown };
export interface MatrixRow {
  video_codes?: unknown;
  tiktok_account?: unknown;
  tiktok_account_2?: unknown;
}

export interface MatrixFigures {
  /** True once both are loaded; nothing should be written before. */
  ready: boolean;
  gmv: Map<string, number>;
  ad: Map<string, number>;
}

const PAGE = 1000;
const CHUNK = 60; // video ids per ad query: 60 videos x 14 months x campaigns stays under a page

async function readGmv(brand: string, months: string[]): Promise<Map<string, number>> {
  const db = getSupabase();
  const out = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('collab_creator_month_gmv')
      .select('month, handle, gmv')
      .eq('brand', brand)
      .in('month', months)
      .order('month')
      .order('handle')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.set(`${r.month}|${r.handle}`, Number(r.gmv));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function readAd(owner: Map<string, string>, months: string[]): Promise<Map<string, number>> {
  const db = getSupabase();
  const out = new Map<string, number>();
  const ids = [...owner.keys()];
  const dates = months.map((m) => `${m}-01`);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('euka_ad_video_month')
        .select('item_id, month, cost')
        .in('item_id', chunk)
        .in('month', dates)
        .order('item_id')
        .order('month')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const h = owner.get(String(r.item_id));
        if (!h) continue;
        const k = `${monthKeyOf(r.month)}|${h}`;
        out.set(k, (out.get(k) ?? 0) + Number(r.cost));
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

/**
 * Ad spend per creator straight from Euka's GMV Max creatives (`collab_creator_month_ad`), for the
 * brand-months where `collab-gmv-sync` read it completely. This is what replaces the older per-video
 * figures where both exist: that copy stopped refreshing on 27 October, so a month stopped on the
 * 26th. A month not in `months` of the answer was not read, and the per-video figure stands.
 */
async function readCreatorAds(
  brand: string,
  months: string[],
): Promise<{ cost: Map<string, number>; covered: Set<string> }> {
  const db = getSupabase();
  const covered = new Set<string>();
  const meta = await db
    .from('collab_brand_month_gmv')
    .select('month, ad_read')
    .eq('brand', brand)
    .in('month', months);
  if (meta.error) throw new Error(meta.error.message);
  for (const r of meta.data ?? []) if (r.ad_read) covered.add(String(r.month));

  const cost = new Map<string, number>();
  if (!covered.size) return { cost, covered };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('collab_creator_month_ad')
      .select('month, handle, cost')
      .eq('brand', brand)
      .in('month', [...covered])
      .order('month')
      .order('handle')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) cost.set(`${r.month}|${r.handle}`, Number(r.cost));
    if (!data || data.length < PAGE) break;
  }
  return { cost, covered };
}

export function useMatrixFigures(brand: string, creators: MatrixRow[], months: string[]): MatrixFigures {
  const name = String(brand ?? '').trim();
  const monthsKey = months.join(',');

  /* video id -> the handle it belongs to */
  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of creators ?? []) {
      const fallback = rowHandles(c)[0] ?? '';
      const list = Array.isArray(c?.video_codes) ? (c.video_codes as VideoRow[]) : [];
      for (const v of list) {
        const id = videoIdOf(v?.video);
        const h = videoHandleOf(v?.video) || fallback;
        if (id && h) m.set(id, h);
      }
    }
    return m;
  }, [creators]);

  const on = !!name && months.length > 0;
  const gmv = useQuery({
    queryKey: ['matrix-autofill-gmv', name, monthsKey],
    queryFn: () => readGmv(name, months),
    enabled: on,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const ad = useQuery({
    queryKey: ['matrix-autofill-ad', name, monthsKey, owner.size],
    queryFn: async () => {
      const [perVideo, fromEuka] = await Promise.all([
        owner.size ? readAd(owner, months) : Promise.resolve(new Map<string, number>()),
        readCreatorAds(name, months),
      ]);
      /* where Euka's own per-creator figure was read, it replaces the per-video sum for that month */
      const out = new Map<string, number>();
      for (const [k, v] of perVideo) if (!fromEuka.covered.has(k.split('|')[0]!)) out.set(k, v);
      for (const [k, v] of fromEuka.cost) out.set(k, v);
      return out;
    },
    enabled: on,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return useMemo<MatrixFigures>(
    () => ({
      /* a failed read must not write: half the figures would read as "none" */
      ready: on && gmv.isSuccess && ad.isSuccess,
      gmv: gmv.data ?? new Map(),
      ad: ad.data ?? new Map(),
    }),
    [on, gmv.isSuccess, gmv.data, ad.isSuccess, ad.data],
  );
}
