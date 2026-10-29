import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * A creator's own TikTok account: whether it is connected, and what their
 * videos actually did.
 *
 * NOT the ads connection. That one is a brand's ad account, wired up by an
 * admin, and creators must never see it. This is the creator's own account,
 * connected by them, for them, and revocable by them.
 *
 * THERE IS NO TOKEN IN ANYTHING THIS FILE CAN REACH. The tables it reads hold
 * no token by design. They live in `creator_tiktok_tokens`, which has RLS on
 * and NO POLICIES AT ALL, so every user role is denied outright and only the
 * service role, which bypasses RLS, can touch it. So there is nothing here to
 * leak even if a policy elsewhere is written wrongly.
 */

interface TikTokAccount {
  creator_id: string;
  open_id: string;
  display_name: string | null;
  avatar_url: string | null;

  /*
   * FROM user.info.profile, and EVERY ONE IS NULLABLE.
   *
   * Not defensive typing. A creator can decline a permission on TikTok's
   * consent screen, and anything connected before 2026-08-26 was granted only
   * `user.info.basic,video.list` — so "we were never told" is a real, common
   * state that has to survive all the way to the screen rather than being
   * flattened into an empty string on the way.
   */
  username: string | null;
  profile_deep_link: string | null;
  is_verified: boolean | null;

  /** From user.info.stats. `null` means not known. NEVER read a null as zero. */
  follower_count: number | null;
  likes_count: number | null;
  video_count: number | null;
  profile_synced_at: string | null;

  scope: string;
  connected_at: string;
  last_synced_at: string | null;
  last_error: string | null;
  revoked_at: string | null;
}

export interface TikTokVideo {
  video_id: string;
  title: string | null;
  cover_image_url: string | null;
  share_url: string | null;
  duration: number | null;
  posted_at: string | null;
  /** Nullable on purpose: a figure TikTok withheld must not read as zero. */
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  share_count: number | null;
  fetched_at: string;
}

/*
 * NAMED, NEVER `select('*')`.
 *
 * The house rule about wide tables is only half of it. The other half is that a
 * star would silently pick up whatever column is added to this table next, and
 * this is a table whose whole design note says "readable by its owner, so
 * anything in it is in the browser". A list you have to edit is a list somebody
 * has to think about.
 */
const ACCOUNT_COLUMNS =
  'creator_id, open_id, display_name, avatar_url, username, profile_deep_link, ' +
  'is_verified, follower_count, likes_count, video_count, profile_synced_at, ' +
  'scope, connected_at, last_synced_at, last_error, revoked_at';

/**
 * Is this creator's TikTok connected, and as whom?
 *
 * FILTERED BY THE CALLER'S OWN ID, and not left to RLS to narrow.
 *
 * There are TWO policies on this table and they are PERMISSIVE, so they are
 * OR'd: "your own row" OR "you are staff". An ops or admin account — which is
 * allowed to connect a TikTok of its own — would therefore match EVERY row, and
 * `maybeSingle()` would either throw or hand them somebody else's connection to
 * display as their own. Scoping here is not defence in depth, it is the query
 * meaning what it says.
 */
export function useTikTokAccount() {
  const { user } = useAuth();
  const me = user?.id;

  return useQuery({
    queryKey: ['creator', 'tiktok-account', me],
    enabled: Boolean(me),
    staleTime: 30_000,
    queryFn: async (): Promise<TikTokAccount | null> => {
      const { data, error } = await getSupabase()
        .from('creator_tiktok_connections')
        .select(ACCOUNT_COLUMNS)
        .eq('creator_id', me!)
        .maybeSingle();
      if (error) throw error;
      const row = data as unknown as TikTokAccount | null;
      /*
       * A REVOKED ROW IS NOT A CONNECTION. It is kept so that "they
       * disconnected" and "they never connected" stay different states for
       * staff, but to this screen it means the same as nothing.
       */
      return row && !row.revoked_at ? row : null;
    },
  });
}

/**
 * Their own videos, newest first. Empty until the first refresh lands.
 *
 * Scoped by id for the same reason as the connection above: the staff policy
 * beside the owner policy is permissive, so a staff account left to RLS alone
 * would see every creator's videos listed as their own.
 */
export function useTikTokVideos(enabled: boolean) {
  const { user } = useAuth();
  const me = user?.id;

  return useQuery({
    queryKey: ['creator', 'tiktok-videos', me],
    enabled: enabled && Boolean(me),
    staleTime: 60_000,
    queryFn: async (): Promise<TikTokVideo[]> => {
      const { data, error } = await getSupabase()
        .from('creator_tiktok_videos')
        .select(
          'video_id, title, cover_image_url, share_url, duration, posted_at, ' +
            'view_count, like_count, comment_count, share_count, fetched_at'
        )
        .eq('creator_id', me!)
        .order('posted_at', { ascending: false, nullsFirst: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as TikTokVideo[];
    },
  });
}

type Action = 'connect.start' | 'videos.refresh' | 'disconnect';

/**
 * The three things a creator can do, all through one Edge Function.
 *
 * Deliberately not table writes: `creator_tiktok_connections` has no insert,
 * update or delete policy for anybody, so the browser could not do this even if
 * it tried. The function re-derives who they are from their token rather than
 * believing an id in the request.
 */
export function useTikTokAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (action: Action) => {
      const { data, error } = await getSupabase().functions.invoke('tiktok-creator', {
        body: { action },
      });
      if (error) {
        /*
         * The useful message is in the RESPONSE BODY, not in the error. The
         * client wraps a non-2xx into a generic FunctionsHttpError whose text
         * is "Edge Function returned a non-2xx status code", which tells a
         * creator nothing about what to do next.
         */
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? (error as Error).message);
      }
      return data as { url?: string; ok?: boolean; count?: number };
    },
    onSuccess: (_data, action) => {
      if (action === 'connect.start') return; // the page is about to navigate away
      void qc.invalidateQueries({ queryKey: ['creator', 'tiktok-account'] });
      void qc.invalidateQueries({ queryKey: ['creator', 'tiktok-videos'] });
    },
  });
}

/**
 * Finish the handshake, from the callback page.
 *
 * Separate from the above because it hits the PUBLIC function: the person
 * coming back from tiktok.com may have no session in that tab, which is the
 * whole reason that function does not require one.
 */
export function useTikTokFinish() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ code, state }: { code: string; state: string }) => {
      const { data, error } = await getSupabase().functions.invoke('tiktok-creator-callback', {
        body: { code, state },
      });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? (error as Error).message);
      }
      return data as { ok: boolean; displayName: string | null };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['creator', 'tiktok-account'] });
    },
  });
}
