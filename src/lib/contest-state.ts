/**
 * Where a contest itself has got to, defined ONCE for both sides of the product.
 *
 * Three screens each grew their own copy of this on 2026-08-13: the Contests tab
 * inside a brand, the cross brand admin list, and the creator's own screen. All
 * three agreed on the day they were written, which is the dangerous kind of
 * duplication: the next person to add a state, or to reword "Deadline passed",
 * fixes one or two of them and ships a contest wearing two different words on
 * two different screens.
 *
 * NEUTRAL ON PURPOSE. It is in `src/lib/` rather than in `src/lib/admin/` or
 * `src/lib/creator/`, because both sides need it and neither may import the
 * other. It reads four plain fields and knows nothing about money, about
 * budgets, or about who is looking.
 *
 * "Active" is three questions wearing one word: may somebody new enter, may
 * anybody read it, and may the people already in carry on. THIS ANSWERS ONLY
 * THE FIRST. A closed contest still carries live work, which is why nothing
 * here is called `isOpen` and why no screen may hide an entry behind it.
 */

export type ContestLifecycle = 'open' | 'off' | 'closed' | 'settled' | 'cancelled';

/** The four facts that decide it. Both `Contest` and `CreatorContest` carry them. */
interface ContestLifecycleFacts {
  status: 'active' | 'inactive';
  expiresAt: string;
  settledAt: string | null;
  cancelledAt: string | null;
}

/**
 * `now` is a parameter rather than a call to `Date.now()` inside, which is what
 * lets a screen tick it on a timer and what makes it testable. Rule L15.
 */
export function contestLifecycleOf(
  c: ContestLifecycleFacts,
  now = Date.now()
): ContestLifecycle {
  if (c.cancelledAt) return 'cancelled';
  if (c.settledAt) return 'settled';
  if (c.status === 'inactive') return 'off';
  if (Date.parse(c.expiresAt) <= now) return 'closed';
  return 'open';
}

/**
 * The words, and they are the same words for staff and for creators.
 *
 * "Closed to new entries" rather than "Off", because the sentence a creator
 * needs is the one that says their own work carries on.
 */
export const CONTEST_STATE_LABEL: Record<ContestLifecycle, string> = {
  open: 'Open to enter',
  off: 'Closed to new entries',
  closed: 'Deadline passed',
  settled: 'Settled',
  cancelled: 'Cancelled',
};
