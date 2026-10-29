import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { NOT_REPORTED, compact, compactMoney, exactMoney } from '@/components/charts';
import type { LeaderboardRow } from '@/lib/creator/useLeaderboard';
import { addDays, iso } from '@/lib/creator/date-range';

/*
 * The pieces the board is built from. Nothing here invents a figure: every
 * function reshapes what `creator_leaderboard` / `my_leaderboard_standing`
 * returned. The board function returns one total per creator, so there is no
 * per-creator trend and no rank change for anybody but the signed-in creator,
 * and the screen shows none. No RPC was changed.
 */

export type RangeKey = 'week' | 'month' | 'all';

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

interface BoardWindow {
  from: string;
  to: string;
}

/** Older than any figure this product holds, so "all time" means all of it. */
const ALL_TIME_FROM = '2000-01-01';

/**
 * A chip to two dates, in UTC. Calendar weeks (Monday first) and calendar
 * months, because the chips say "This week" and "This month".
 */
export function rangeWindow(key: RangeKey): BoardWindow {
  const to = iso(new Date());
  if (key === 'all') return { from: ALL_TIME_FROM, to };
  if (key === 'month') return { from: `${to.slice(0, 7)}-01`, to };
  const back = (new Date(`${to}T00:00:00Z`).getUTCDay() + 6) % 7;
  return { from: addDays(to, -back), to };
}

/** RPC numerics arrive as numbers or strings; a missing one stays missing. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A null currency means the sum spans more than one, so it gets no symbol:
 * ranking dollars against pounds under one symbol is not a ranking.
 */
export function faceMoney(v: unknown, currency: string | null): string {
  const n = num(v);
  if (n === null) return NOT_REPORTED;
  return currency ? compactMoney(n, currency) : compact(n);
}

/** The exact figure, for a `title`. */
export function tipMoney(v: unknown, currency: string | null): string {
  const n = num(v);
  if (n === null) return NOT_REPORTED;
  return currency
    ? exactMoney(n, currency)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

/** Places moved, positive meaning up the board; null when there is nothing to compare. */
export function placesMoved(now: number, before: number | null | undefined): number | null {
  if (before === null || before === undefined) return null;
  return before - now;
}

/**
 * Five rows around a given rank, which the paged hook cannot express (they can
 * straddle a page boundary). Same RPC, different offset.
 */
export function useBoardSlice({
  from,
  to,
  offset,
  limit,
  brandId,
  enabled,
}: {
  from: string;
  to: string;
  offset: number;
  limit: number;
  brandId?: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ['creator', 'leaderboard', 'slice', from, to, offset, limit, brandId ?? 'all'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await getSupabase().rpc('creator_leaderboard', {
        p_from: from,
        p_to: to,
        p_limit: limit,
        p_offset: offset,
        p_search: null,
        p_brand_id: brandId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
  });
}

/** What the list draws: a creator, or the fold between the top and her. */
export type BoardItem = { kind: 'row'; row: LeaderboardRow } | { kind: 'gap'; hidden: number };

/** How many places at the top stay visible when the list folds around her. */
const TOP_SHOWN = 5;

/**
 * The list as drawn. When she is on the part of the board on screen, it is the
 * rows as they came. When she is further down, it is the top, a fold that says
 * how many places it stands for, then the rows around her.
 */
export function buildItems(
  rows: LeaderboardRow[],
  near: LeaderboardRow[],
  fold: boolean
): BoardItem[] {
  const plain = (): BoardItem[] => rows.map((row) => ({ kind: 'row', row }));
  if (!fold) return plain();

  const top = rows.filter((r) => r.rank <= TOP_SHOWN);
  const lastTop = top.at(-1)?.rank ?? rows[0]?.rank ?? 0;
  const tail = near.filter((r) => r.rank > lastTop);
  if (tail.length === 0) return plain();

  const hidden = tail[0]!.rank - lastTop - 1;
  return [
    ...top.map((row): BoardItem => ({ kind: 'row', row })),
    ...(hidden > 0 ? [{ kind: 'gap', hidden } as BoardItem] : []),
    ...tail.map((row): BoardItem => ({ kind: 'row', row })),
  ];
}
