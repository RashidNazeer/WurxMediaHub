import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export interface LeaderboardRow {
  rank: number;
  creator_id: string;
  display_name: string | null;
  avatar_path: string | null;
  gmv: number;
  spend: number;
  orders: number;
  videos: number;
  currency: string | null;
  is_me: boolean;
  total_creators: number;
}

interface MyStanding {
  rank: number;
  gmv: number;
  spend: number;
  orders: number;
  videos: number;
  currency: string | null;
  total_creators: number;
  top_percent: number;
}

export const BOARD_PAGE = 25;

/**
 * The leaderboard, as a creator sees it.
 *
 * EVERY NUMBER COMES FROM ONE SECURITY DEFINER FUNCTION, never from a table.
 * `creator_leaderboard` returns eleven columns and cannot be asked for a
 * twelfth: no email, no brand, no budget, no offer, no contest, no reward. That
 * is the whole reason it is a function rather than a view a creator could
 * select from, which would have needed a policy on `profiles` wide enough to
 * let one creator read another's row and would have stayed open for ever.
 *
 * IT AMENDS D7, and only for this screen. The anonymous contest standing is
 * untouched: that screen promises in words that nobody can see who anybody else
 * is, and this one never made that promise. Rashid decided it in those terms on
 * 2026-08-20.
 *
 * THE RANGE IS ALL TIME BY DEFAULT because "who has made the most" is a
 * question about everything, not about a fortnight. The dates are still
 * parameters so a monthly board is a prop change rather than a migration.
 */
export function useLeaderboard(
  from: string,
  to: string,
  page: number,
  search: string,
  /*
   * Inside a Brand Hub, the board is that brand's own.
   *
   * THE RANK IS COMPUTED INSIDE THE BRAND, not globally and then filtered. The
   * argument goes all the way down to `private.leaderboard_totals`, underneath
   * the `rank()`, so the numbering is dense over this brand's creators and
   * `total_creators` counts them. Filtering a global board would open on
   * "#7 of 3", which is not a smaller leaderboard, it is a broken one.
   */
  brandId?: string
) {
  return useQuery({
    queryKey: [
      'creator', 'leaderboard', from, to, page, search.trim().toLowerCase(), brandId ?? 'all',
    ],
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await getSupabase().rpc('creator_leaderboard', {
        p_from: from,
        p_to: to,
        p_limit: BOARD_PAGE,
        p_offset: page * BOARD_PAGE,
        p_search: search.trim() || null,
        p_brand_id: brandId ?? null,
      });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
  });
}

/**
 * Where the person looking at it stands, fetched separately on purpose.
 *
 * Somebody ranked 42nd has to see their own row without paging to it, and the
 * band at the top of the screen is the first thing they look at. The function
 * takes no id, so it cannot be asked about anybody else.
 *
 * NO ROWS MEANS "you are not on it yet", which is a real state and not an
 * error: a creator whose videos have no figures yet is deliberately absent from
 * the board rather than sitting at the bottom on $0.
 */
export function useMyStanding(from: string, to: string, brandId?: string) {
  return useQuery({
    queryKey: ['creator', 'leaderboard', 'me', from, to, brandId ?? 'all'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MyStanding | null> => {
      const { data, error } = await getSupabase().rpc('my_leaderboard_standing', {
        p_from: from,
        p_to: to,
        p_brand_id: brandId ?? null,
      });
      if (error) throw error;
      return ((data as MyStanding[] | null) ?? [])[0] ?? null;
    },
  });
}

/**
 * The faces on the board.
 *
 * A SEPARATE HOOK FROM THE ADMIN ONE, and it has to be: `src/lib/admin/` is
 * closed to creator code by `no-restricted-imports` in `.oxlintrc.json`, which
 * is a build failure rather than a convention. The two do the same thing and
 * are allowed to, because the day one of them changes it will be for a reason
 * that belongs to one side only.
 *
 * WHAT A CREATOR CAN ACTUALLY REACH. From 2026-08-20 `creator-avatars` is
 * readable by any signed-in account, which was a deliberate narrow reversal
 * when Rashid asked for faces on this screen. Objects are named by PROFILE ID,
 * never by handle, and `profiles` still refuses one creator another's row, so
 * there is no way to turn a name into a path from the client. The only ids a
 * creator ever holds are the ones the board has already decided to show them.
 * Writing is impossible for anybody: there is no insert, update or delete
 * policy on that bucket at all.
 */
const SIGNED_URL_SECONDS = 8 * 60 * 60;
const HOLD_MS = 6 * 60 * 60 * 1000;

export function useBoardFaces(paths: readonly (string | null | undefined)[]) {
  // Sorted and deduplicated, so the cache key is about WHICH faces are on
  // screen rather than the order the board happened to render them in.
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))].sort();

  const query = useQuery({
    queryKey: ['creator', 'board-faces', list],
    enabled: list.length > 0,
    staleTime: HOLD_MS,
    gcTime: HOLD_MS,
    queryFn: async (): Promise<Record<string, string>> => {
      // One call for the whole page. Signing them one at a time would be
      // twenty-five requests to draw one board.
      const { data, error } = await getSupabase()
        .storage.from('creator-avatars')
        .createSignedUrls(list, SIGNED_URL_SECONDS);
      if (error) throw new Error(error.message);

      const out: Record<string, string> = {};
      for (const item of data ?? []) {
        // Each entry carries its own error: one object that has gone missing
        // must not take the rest of the board's faces down with it.
        if (item.error || !item.signedUrl || !item.path) continue;
        out[item.path] = item.signedUrl;
      }
      return out;
    },
  });

  // An empty map while loading and an empty map on failure. A missing picture
  // is not an error worth showing anybody; the initial is the base state.
  return query.data ?? {};
}
