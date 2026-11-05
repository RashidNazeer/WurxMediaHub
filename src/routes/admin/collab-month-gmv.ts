import { useMemo } from 'react';
import { creatorBrandGmv, gmvKey, type CreatorRow, type DayRange } from '@/lib/admin/month-gmv';

/**
 * WHAT THE VIDEOS A CREATOR POSTED FOR A BRAND IN THE CHOSEN DATES HAVE MADE, up to
 * now. The Brand GMV column of the Creators and Brands tables.
 *
 * Rashid, 2026-11-06: pick October and see the GMV the videos posted in October have
 * made in total on today's date. It is LIVE and is never locked: those videos keep
 * selling, so the figure rises until they stop. (A frozen month-end figure was built
 * first and dropped: it answered a different question.)
 *
 * THIS FILE IS THE SEAM, AND IT IS OURS, like `collab-ad-figures.tsx`. The vendored
 * app never imports our Supabase client; it calls this hook with the creators it
 * already holds and reads figures back. Nothing is fetched: each video's `revenue` is
 * its lifetime GMV as the Euka and Reacher syncs last reported it.
 *
 * A video belongs to the month it was POSTED in, whichever of her rows holds it, so a
 * September deal that carries an October video counts in October.
 */

export interface MonthGmvCell {
  brand: string;
  /** Videos posted in the chosen dates (each once, across all her rows for the brand). */
  videos: number;
  /** Of them: with sales, synced at $0, and not synced at all. */
  withSales: number;
  zero: number;
  unsynced: number;
  /** Their GMV so far, unrounded. */
  gmv: number;
  /** What ALL her videos for the brand have made, however old, for the hover. */
  allTimeGmv: number;
}

export interface MonthGmv {
  /** The cell for a creator row, or null when she has no video in the period. */
  forRow: (c: CreatorRow) => MonthGmvCell | null;
}

export function useMonthGmv(allCreators: CreatorRow[], range: DayRange): MonthGmv {
  const from = range?.from ?? null;
  const to = range?.to ?? null;

  const inPeriod = useMemo(
    () => creatorBrandGmv(allCreators, from && to ? { from, to } : null),
    [allCreators, from, to],
  );
  /* what all her videos for the brand have made, for the hover */
  const everything = useMemo(() => creatorBrandGmv(allCreators, null), [allCreators]);

  return useMemo<MonthGmv>(
    () => ({
      forRow: (c) => {
        const key = gmvKey(c?.brand, c?.name);
        const g = inPeriod.get(key);
        if (!g) return null;
        return {
          brand: g.brand,
          videos: g.videos,
          withSales: g.withSales,
          zero: g.zero,
          unsynced: g.unsynced,
          gmv: g.gmv,
          allTimeGmv: everything.get(key)?.gmv ?? g.gmv,
        };
      },
    }),
    [inPeriod, everything],
  );
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * The hover text for a Brand GMV cell: how many videos it is made of, in the three
 * kinds, and that it is live. Plain words, because the figure is only as useful as
 * what a person can tell about where it came from.
 */
export function describeGmv(g: MonthGmvCell | null, brand: string): string {
  const name = brand || 'this brand';
  if (!g || !g.videos) return `No video for ${name} posted in the chosen dates.`;
  const parts = [`${g.videos} video${g.videos === 1 ? '' : 's'} for ${name} posted in the chosen dates`];
  const kinds: string[] = [];
  if (g.withSales) kinds.push(`${g.withSales} with sales`);
  if (g.zero) kinds.push(`${g.zero} at $0`);
  if (g.unsynced) kinds.push(`${g.unsynced} not synced`);
  if (kinds.length) parts.push(kinds.join(', '));
  parts.push(`${money(g.allTimeGmv)} from all her videos for ${name} so far`);
  return `${parts.join(' · ')}. Live: it keeps rising as these videos sell.`;
}
