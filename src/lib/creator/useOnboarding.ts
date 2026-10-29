import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth/auth-context';
import { useProfile, type Profile } from '@/lib/auth/useProfile';

/**
 * Which one-time moment, if any, this creator is owed.
 *
 *   'welcome'      first arrival in the hub, straight after applying
 *   'approved'     the moment they are let in
 *   null           nothing owed, show the normal screen
 */
type OnboardingMoment = 'welcome' | 'approved' | null;

/**
 * Decide it from the profile row, never from local state.
 *
 * Order matters. Somebody approved before they ever opened the hub (a fast
 * admin, or an application filed on a phone and read on a laptop) is owed the
 * congratulations, not a "welcome, you have applied" card that is already out
 * of date. So approval wins, and dismissing it settles the welcome too.
 */
function momentFor(profile: Profile | undefined): OnboardingMoment {
  if (!profile) return null;
  if (profile.role === 'creator' && !profile.approval_celebrated_at) return 'approved';
  if (!profile.welcomed_at) return 'welcome';
  return null;
}

/**
 * The one-time moments a creator is shown when they join and when they are
 * approved.
 *
 * "Once" is enforced by the database, not by this hook: the flags are columns
 * on the profile row, so clearing browser storage, switching device or signing
 * in on a friend's laptop cannot replay a celebration. The mutation writes the
 * timestamp and the profile query refetches, which is what actually closes the
 * moment; the local state below only stops it flashing back for the second or
 * two the round trip takes.
 *
 * If the write fails we still close it locally. Nagging somebody with a
 * celebration they have already dismissed, because a network blip lost the
 * acknowledgement, is worse than the flag being a moment late.
 */
export function useOnboarding() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();

  // Closed here the instant they click, before the write lands. The database
  // is what makes it permanent; this is what makes it feel like a button.
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const dismiss = useMutation({
    mutationFn: async (moment: Exclude<OnboardingMoment, null>) => {
      if (!user?.id) return;
      const now = new Date().toISOString();

      // Approval settles the welcome as well. Otherwise a creator who is
      // approved before ever opening the hub gets congratulated, and then
      // immediately welcomed as a brand new applicant.
      const patch: Record<string, string> =
        moment === 'approved'
          ? { approval_celebrated_at: now, ...(profile?.welcomed_at ? {} : { welcomed_at: now }) }
          : { welcomed_at: now };

      const { error } = await getSupabase()
        .from('profiles')
        .update(patch)
        .eq('id', user.id);

      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
    },
  });

  const owed = momentFor(profile);

  return {
    /** What to show right now, or null. */
    moment: owed && closed.has(owed) ? null : owed,
    dismiss: (moment: Exclude<OnboardingMoment, null>) => {
      setClosed((prev) => new Set(prev).add(moment));
      dismiss.mutate(moment);
    },
    /** True while the acknowledgement is in flight. */
    dismissing: dismiss.isPending,
  };
}
