import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { joinChannel } from '@/lib/realtime';
import { useAuth } from '@/lib/auth/auth-context';
import { CONTENT_COLUMNS, type ContentRow } from '@/lib/content';

/**
 * Everything this creator has posted, newest first.
 *
 * Row level security returns their own rows and nothing else, so there is no
 * `creator_id` filter here. A creator cannot see another creator's videos or
 * ad codes, and that is a policy in the database rather than a filter in a
 * query somebody could forget.
 *
 * Kept live, because the decision on a video is the thing they are waiting for.
 *
 * The ceiling is deliberate and it matters more than it looks. PostgREST
 * truncates at its own row cap with no signal at all, and now that the counts
 * come from `job_progress` in the database rather than from these rows, the
 * counts would stay right past the cap while the LIST quietly stopped. That is
 * a screen saying "5 of 5 approved" above a grid holding four of them.
 */
const MY_CONTENT_CAP = 500;

export function useMyContent() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['creator', 'my-content'],
    staleTime: 15_000,
    queryFn: async (): Promise<ContentRow[]> => {
      const { data, error } = await getSupabase()
        .from('content_submissions')
        .select(CONTENT_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(MY_CONTENT_CAP);
      if (error) throw error;
      return (data ?? []) as unknown as ContentRow[];
    },
  });

  useEffect(() => {
    if (!user?.id) return;

    return joinChannel(
      `my-content:${user.id}`,
      [{ table: 'content_submissions', filter: `creator_id=eq.${user.id}` }],
      () => {
        void queryClient.invalidateQueries({ queryKey: ['creator', 'my-content'] });
        // An approval can be the thing that finishes a job, and the job lives
        // on the dashboard. Leaving that stale would mean the two screens
        // disagreed about whether the work was done.
        void queryClient.invalidateQueries({ queryKey: ['creator', 'my-work'] });
      }
    );
  }, [user?.id, queryClient]);

  return query;
}

type ContentPayload =
  | {
      action: 'content.create';
      applicationId: string;
      videoUrl: string;
      adCode: string;
      adAuthorized: boolean;
    }
  | {
      action: 'content.update';
      contentId: string;
      videoUrl: string;
      adCode: string;
      adAuthorized: boolean;
    }
  | { action: 'content.delete'; contentId: string };

/**
 * Posting, fixing and removing a video.
 *
 * Not a table write. `content_submissions` has no insert, update or delete
 * policy at all; the Edge Function re-reads who the caller is from `profiles`
 * and calls a security definer function that also checks the job is theirs.
 */
export function useMyContentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ContentPayload) => {
      const { data, error } = await getSupabase().functions.invoke('manage-content', {
        body: payload,
      });
      if (error) throw new Error(await messageFrom(error));
      return (data as { result: ContentRow }).result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['creator', 'my-content'] });
      void queryClient.invalidateQueries({ queryKey: ['creator', 'my-work'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'content'] });
    },
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`. Without this a
 * creator sees that sentence instead of "You have already posted that link".
 */
async function messageFrom(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      // Body was not JSON. Fall through to the generic message.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'That did not go through. Try again.';
}
