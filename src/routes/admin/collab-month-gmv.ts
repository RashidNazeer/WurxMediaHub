import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import {
  cellFor,
  wholeMonthOf,
  type BrandMonth,
  type CellRow,
  type GmvCell,
} from '@/lib/admin/creator-month-gmv';

/**
 * WHAT A CREATOR MADE FOR A BRAND IN THE MONTH ON SCREEN, for the Brand GMV column of
 * the Creators and Brands tables.
 *
 * Rashid, 2026-11-06: set the date to September and see the GMV she made from 1 to 30
 * September, by sales date, from any of her videos. Euka and Reacher keep daily sales;
 * `collab-gmv-sync` copies their monthly answer into `collab_creator_month_gmv`, and
 * this hook reads it. See `@/lib/admin/creator-month-gmv` for the four things a cell can
 * say (a figure, $0, "under $X", a dash).
 *
 * THIS FILE IS THE SEAM, AND IT IS OURS, like `collab-ad-figures.tsx`. The vendored app
 * never imports our Supabase client; it calls this hook and reads cells back.
 *
 * ONLY A WHOLE CALENDAR MONTH HAS A FIGURE. The platforms' answers are stored per month,
 * so a week, a custom range or All Time shows a dash with a hover saying why.
 */

export interface MonthGmv {
  /** The cell for a creator row. */
  forRow: (c: CellRow) => GmvCell;
}

interface Month {
  brands: Map<string, BrandMonth>;
  byBrand: Map<string, Map<string, number>>;
}

const PAGE = 1000;

async function readMonth(month: string): Promise<Month> {
  const db = getSupabase();
  const brands = new Map<string, BrandMonth>();
  const b = await db.from('collab_brand_month_gmv').select('brand, source, truncated, floor_gmv').eq('month', month);
  if (b.error) throw new Error(b.error.message);
  for (const r of b.data ?? []) {
    brands.set(String(r.brand).trim(), {
      source: r.source as 'euka' | 'reacher',
      truncated: !!r.truncated,
      floorGmv: r.floor_gmv === null ? null : Number(r.floor_gmv),
    });
  }

  const byBrand = new Map<string, Map<string, number>>();
  /* PostgREST answers at most 1000 rows, and a short answer would look like creators who
     made nothing, so read every page. */
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('collab_creator_month_gmv')
      .select('brand, handle, gmv')
      .eq('month', month)
      .order('brand')
      .order('handle')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const k = String(r.brand).trim();
      let m = byBrand.get(k);
      if (!m) byBrand.set(k, (m = new Map()));
      m.set(String(r.handle), Number(r.gmv));
    }
    if (!data || data.length < PAGE) break;
  }
  return { brands, byBrand };
}

export function useMonthGmv(range: { from: string; to: string } | null | undefined): MonthGmv {
  const month = wholeMonthOf(range && range.from && range.to ? { from: range.from, to: range.to } : null);

  const q = useQuery({
    queryKey: ['collab-creator-month-gmv', month],
    queryFn: () => readMonth(month as string),
    enabled: month !== null,
    /* the current month is re-read by the sync every few hours; a minute is fresh enough here */
    staleTime: 60_000,
    retry: 1,
  });

  return useMemo<MonthGmv>(
    () => ({
      forRow: (c) => {
        const brand = String(c?.brand ?? '').trim();
        const data = q.data;
        return cellFor(c, month, data?.brands.get(brand) ?? null, data?.brands.has(brand) ? (data.byBrand.get(brand) ?? new Map()) : null);
      },
    }),
    [q.data, month],
  );
}
