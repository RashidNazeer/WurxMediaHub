import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { AppRole, CreatorTier } from '@/lib/auth/auth-context';
import type { ApplicationStatus } from '@/lib/auth/useApplication';
import { reviewSchema, type ReviewInput } from '@/lib/schemas/review';

interface ReviewResult {
  application_id: string;
  user_id: string;
  status: ApplicationStatus;
  role: AppRole;
  tier: CreatorTier | null;
  reviewed_at: string;
}

interface ReviewOutcome {
  /** How many actually went through. */
  reviewed: number;
  /** Per application, so a partial batch can be explained rather than hidden. */
  failures: { applicationId: string; error: string }[];
  first: ReviewResult | null;
}

/**
 * Approve or reject one application, or a whole selection of them.
 *
 * Deliberately NOT a table update. The browser could not do this one even if it
 * tried: `applications.status` is not in the column grant, a trigger blocks it,
 * and the database function that performs the change is granted to the service
 * role alone. The Edge Function is the only door, and it re-reads the caller's
 * role from the profiles table before it opens.
 *
 * A batch is one request, and the server loops. Each application is still its
 * own transaction with its own audit row, so a bad item cannot roll back the
 * good ones and cannot slip through unlogged.
 */
export function useReviewApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReviewInput): Promise<ReviewOutcome> => {
      const parsed = reviewSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'That decision was not valid');
      }
      const { applicationIds, decision, tier, note } = parsed.data;

      const { data, error } = await getSupabase().functions.invoke('review-application', {
        body: {
          applicationIds,
          decision,
          tier: decision === 'approved' ? tier : null,
          note: note || null,
        },
      });

      if (error) throw new Error(await messageFrom(error));

      const body = data as {
        result?: ReviewResult | null;
        results?: { applicationId: string; ok: boolean; error?: string }[];
      };
      const results = body.results ?? [];
      const failures = results
        .filter((r) => !r.ok)
        .map((r) => ({ applicationId: r.applicationId, error: r.error ?? 'Refused' }));

      return {
        reviewed: results.filter((r) => r.ok).length || (body.result ? 1 : 0),
        failures,
        first: body.result ?? null,
      };
    },

    onSuccess: () => {
      // Everything that could now be stale. Cheap, and much safer than trying
      // to patch four caches by hand. Invalidating the whole `application`
      // branch covers every id in a batch without listing them.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'applications'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'application-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'application'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`, which is the
 * actual Response. Without this a reviewer would see that sentence instead of
 * "already reviewed as approved".
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
