import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import {
  cellFor,
  storedMonthFor,
  usablePeriod,
  type BrandMonth,
  type CellRow,
  type GmvCell,
} from '@/lib/admin/creator-month-gmv';

/**
 * WHAT A CREATOR MADE FOR A BRAND BETWEEN THE DATES ON SCREEN, for the Brand GMV column
 * of the Creators and Brands tables.
 *
 * Rashid, 2026-11-06: set the date to September and see the GMV she made from 1 to 30
 * September; set it to 1 to 5 November and see those days. By sales date, from any of her
 * videos. Euka and Reacher keep daily sales and answer for any dates:
 *
 *   a whole calendar month   read from `collab_creator_month_gmv`, which `collab-gmv-sync`
 *                            fills (instant)
 *   any other range          asked live: `collab-gmv-sync` called with the range, which asks
 *                            each platform once per brand and stores nothing (a few seconds,
 *                            then remembered for ten minutes)
 *
 * See `@/lib/admin/creator-month-gmv` for the four things a cell can say (a figure, $0,
 * "under $X", a dash).
 *
 * THIS FILE IS THE SEAM, AND IT IS OURS, like `collab-ad-figures.tsx`. The vendored app
 * never imports our Supabase client; it calls this hook and reads cells back.
 *
 * A REQUEST GOES TO EUKA OR REACHER ONLY WHEN THE USER SETS DATES THAT NEED ONE. Opening the
 * page ("This month") or picking a whole month sends nothing live; a custom range is asked once,
 * when it is set, and nothing about it is stored.
 *
 * ALL TIME has no dates to ask about, so it shows a dash with a hover saying why.
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

interface LiveBody {
  brands?: { brand: string; source: 'euka' | 'reacher'; truncated: boolean; floor: number | null; rows: { handle: string; gmv: number }[] }[];
  failed?: { brand: string }[];
}

/** Any range, asked live. A reply that failed for some brands still answers for the others. */
async function readRange(from: string, to: string): Promise<Month> {
  const { data, error } = await getSupabase().functions.invoke('collab-gmv-sync', { body: { range: { from, to } } });
  if (error) throw new Error(error.message);
  const body = (data ?? {}) as LiveBody;
  const brands = new Map<string, BrandMonth>();
  const byBrand = new Map<string, Map<string, number>>();
  for (const b of body.brands ?? []) {
    const k = String(b.brand).trim();
    brands.set(k, { source: b.source, truncated: !!b.truncated, floorGmv: b.floor === null ? null : Number(b.floor) });
    byBrand.set(k, new Map(b.rows.map((r) => [String(r.handle), Number(r.gmv)] as const)));
  }
  return { brands, byBrand };
}

export function useMonthGmv(range: { from?: string; to?: string } | null | undefined): MonthGmv {
  const from = range?.from;
  const to = range?.to;
  const period = useMemo(() => usablePeriod({ from, to }), [from, to]);
  /* a stored month (or the month so far) opens with the page and asks nobody; anything else
     was typed in by the user, and is the only thing that sends a request to Euka or Reacher */
  const month = useMemo(() => storedMonthFor(period, new Date()), [period]);
  const key = period ? `${period.from}|${period.to}` : null;

  const q = useQuery({
    queryKey: ['collab-creator-gmv', month ? 'month' : 'range', month ?? key],
    queryFn: () => (month ? readMonth(month) : readRange(period!.from, period!.to)),
    enabled: period !== null,
    /* a stored month is re-read by the sync every few hours; a live range is remembered by
       the function for ten minutes: a minute here, ten for a range, is fresh enough */
    staleTime: month ? 60_000 : 10 * 60_000,
    retry: 1,
  });

  return useMemo<MonthGmv>(
    () => ({
      forRow: (c) => {
        const brand = String(c?.brand ?? '').trim();
        const data = q.data;
        return cellFor(
          c,
          period,
          data?.brands.get(brand) ?? null,
          data?.brands.has(brand) ? (data.byBrand.get(brand) ?? new Map()) : null,
        );
      },
    }),
    [q.data, period],
  );
}
