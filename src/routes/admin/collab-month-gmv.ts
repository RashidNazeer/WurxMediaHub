import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import {
  creatorBrandGmv,
  gmvKey,
  monthHasEnded,
  wholeMonthOf,
  type CreatorBrandGmv,
  type CreatorRow,
  type DayRange,
} from '@/lib/admin/month-gmv';

/**
 * A CREATOR'S GMV FOR A BRAND, for the Brand GMV column of the Creators table.
 *
 * Rashid, 2026-11-05: the total GMV a creator has made for a certain brand
 * through her videos for that brand, "at the end of the month", shown in that
 * table.
 *
 * THIS FILE IS THE SEAM, AND IT IS OURS, like `collab-ad-figures.tsx`. The
 * vendored app never imports our Supabase client; it calls this hook with the
 * creators it already holds and reads figures back.
 *
 * TWO SOURCES, and which one answers depends on what the calendar is showing:
 *
 *   FROZEN   when the picked range is exactly one WHOLE calendar month that has
 *            ended and has been frozen, the figure is the one written when the
 *            month closed (collab_gmv_snapshots). A video's GMV is a running total
 *            that every sync raises, so October's live figure keeps climbing
 *            after October ends; only the frozen one is the month-end number.
 *   LIVE     for anything else (the month still running, a week, a custom range,
 *            All Time) the figure is worked out here from the rows the screen
 *            holds, by the same calculation the database froze it with.
 *
 * A FROZEN MONTH WITH NO ROW FOR A CREATOR IS A FACT, NOT A GAP: she had no
 * dated video in that month when it closed, so the cell is a dash, even if a video
 * has since been dated into it. Her live figure is kept alongside, for the hover.
 *
 * IF THE FROZEN FIGURES CANNOT BE READ (the tables are not there yet, the network
 * dropped) the table falls back to the live figure rather than breaking.
 */

export interface MonthGmvCell extends CreatorBrandGmv {
  /** True when `gmv` is the figure written when the month closed. */
  frozen: boolean;
  /** When it was written, for a frozen figure. */
  frozenAt: string | null;
  /** How it was written: on schedule, or late for a month that had already ended. */
  source: string | null;
  /** What the same videos add up to now, for a frozen figure. */
  liveGmv: number | null;
}

export interface MonthGmv {
  /** The cell for a creator row, or null when she has no video in the period. */
  forRow: (c: CreatorRow) => MonthGmvCell | null;
}

interface Frozen {
  frozenAt: string;
  source: string;
  rows: Map<string, CreatorBrandGmv>;
}

const PAGE = 1000;

async function readFrozen(month: string): Promise<Frozen | null> {
  const db = getSupabase();
  const { data: f, error } = await db
    .from('collab_gmv_freezes')
    .select('month, frozen_at, source')
    .eq('month', month)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!f) return null;

  const rows = new Map<string, CreatorBrandGmv>();
  /* PostgREST answers at most 1000 rows, and a short answer would look like a creator
     with no frozen row, so read every page. */
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await db
      .from('collab_gmv_snapshots')
      .select('brand, creator_key, creator_name, videos, videos_with_sales, videos_zero, videos_unsynced, gmv')
      .eq('month', month)
      .order('brand')
      .order('creator_key')
      .range(from, from + PAGE - 1);
    if (e) throw new Error(e.message);
    for (const r of data ?? []) {
      rows.set(gmvKey(r.brand, r.creator_key), {
        brand: r.brand,
        creatorKey: r.creator_key,
        creatorName: r.creator_name,
        videos: r.videos,
        withSales: r.videos_with_sales,
        zero: r.videos_zero,
        unsynced: r.videos_unsynced,
        gmv: Number(r.gmv),
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return { frozenAt: String(f.frozen_at), source: String(f.source), rows };
}

export function useMonthGmv(allCreators: CreatorRow[], range: DayRange): MonthGmv {
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const month = wholeMonthOf(from && to ? { from, to } : null);
  const closed = month !== null && monthHasEnded(month);

  const live = useMemo(
    () => creatorBrandGmv(allCreators, from && to ? { from, to } : null),
    [allCreators, from, to],
  );

  const frozen = useQuery({
    queryKey: ['collab-gmv-frozen', month],
    queryFn: () => readFrozen(month as string),
    enabled: closed,
    /* A frozen month never changes, so there is nothing to refresh. */
    staleTime: 10 * 60_000,
    retry: 1,
  });

  return useMemo<MonthGmv>(() => {
    const snap = closed ? frozen.data ?? null : null;
    return {
      forRow: (c) => {
        const key = gmvKey(c?.brand, c?.name);
        const now = live.get(key) ?? null;
        if (snap) {
          const s = snap.rows.get(key);
          return {
            brand: s?.brand ?? now?.brand ?? String(c?.brand ?? '').trim(),
            creatorKey: s?.creatorKey ?? now?.creatorKey ?? '',
            creatorName: s?.creatorName ?? now?.creatorName ?? String(c?.name ?? '').trim(),
            videos: s?.videos ?? 0,
            withSales: s?.withSales ?? 0,
            zero: s?.zero ?? 0,
            unsynced: s?.unsynced ?? 0,
            gmv: s?.gmv ?? 0,
            frozen: true,
            frozenAt: snap.frozenAt,
            source: snap.source,
            liveGmv: now?.gmv ?? 0,
          };
        }
        return now
          ? { ...now, frozen: false, frozenAt: null, source: null, liveGmv: null }
          : null;
      },
    };
  }, [closed, frozen.data, live]);
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The hover text for a Brand GMV cell: how many videos it is made of, in the three
 * kinds, and whether it is frozen or live. Plain words, because the figure is only
 * as useful as what a person can tell about where it came from.
 */
export function describeGmv(g: MonthGmvCell | null, brand: string): string {
  const name = brand || 'this brand';
  if (!g || !g.videos) {
    return g?.frozen
      ? `No video posted for ${name} in this month when it was frozen (${dayOf(g.frozenAt ?? '')}).`
      : 'No video posted for this brand in the chosen dates.';
  }
  const parts = [`${g.videos} video${g.videos === 1 ? '' : 's'} for ${name}`];
  const kinds: string[] = [];
  if (g.withSales) kinds.push(`${g.withSales} with sales`);
  if (g.zero) kinds.push(`${g.zero} at $0`);
  if (g.unsynced) kinds.push(`${g.unsynced} not synced`);
  if (kinds.length) parts.push(kinds.join(', '));
  if (g.frozen && g.frozenAt) {
    const late = g.source === 'backfill' ? ', frozen after the month had ended' : '';
    const drift =
      g.liveGmv !== null && Math.round(g.liveGmv) !== Math.round(g.gmv)
        ? `. Now the same videos add up to ${money(g.liveGmv)}`
        : '';
    return `${parts.join(' · ')}. Month-end figure, frozen ${dayOf(g.frozenAt)}${late}${drift}.`;
  }
  return `${parts.join(' · ')}. Live: it changes as videos sync.`;
}
