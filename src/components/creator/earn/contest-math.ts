import type { CreatorContest } from '@/lib/creator/useCreatorContests';
import type { DeliverableLike } from '@/components/creator/ContestEntryDialog';

/**
 * The arithmetic the contest tile draws, in one testable place.
 *
 * NOTHING HERE READS THE CLOCK ITSELF. `now` arrives from `useNow`, the same
 * way the door and entry helpers take it, so one interval drives every card on
 * the screen and a unit test can hand it a fixed instant.
 */

/** Under this, the countdown ring switches to the warning token. §8.1. */
const URGENT_MS = 48 * 3_600_000;

/**
 * WHICH ROWS A CARD IS ALLOWED TO QUOTE.
 *
 * `contest_entry_terms` is copied at approval and never read live from the
 * contest again, so an admin adding, retiring or re-pricing a deliverable
 * afterwards legitimately differs from what this entrant holds. Once somebody
 * is in, the card quotes WHAT THEY WERE PROMISED; before that, what is on
 * offer. Printing today's rows above a bar counting against a frozen target is
 * one card saying two things at once.
 */
export function rowsFor(contest: CreatorContest): {
  rows: DeliverableLike[];
  promised: boolean;
} {
  const inIt = contest.entry?.status === 'approved';
  const promised = inIt && contest.terms.length > 0;
  return { rows: promised ? contest.terms : contest.deliverables, promised };
}

/**
 * The prize line: everything on the table if every target is reached.
 *
 * WHAT IS ON OFFER, NEVER WHAT IS OWED. Money is owed against a CONFIRMED
 * progress figure and nothing else, which is why this is labelled as a ceiling
 * and is never drawn in the paid token.
 *
 * `null` when the contest names no reward at all, so the caller can say so in
 * words instead of printing a zero. A contest with rewards that all happen to
 * be 0 is a real zero and comes back as 0.
 */
export function prizeTotal(contest: CreatorContest): { amount: number | null; currency: string } {
  const { rows } = rowsFor(contest);
  const currency = contest.entry?.currency ?? contest.currency;
  if (rows.length === 0) return { amount: null, currency };
  let total = 0;
  for (const r of rows) total += r.rewardAmount;
  return { amount: total, currency };
}

export interface Countdown {
  /** Milliseconds left, floored at 0. */
  leftMs: number;
  /**
   * How much of the contest's own length is still to run, 0 to 1.
   *
   * `null` when the window is not a window — a contest whose `opensAt` is not
   * before its `expiresAt` has no length to take a share of, and a ring drawn
   * at an invented fraction is a chart that states something nobody measured.
   */
  share: number | null;
  /** The big thing in the middle of the ring. */
  centre: string;
  /** The quiet line under it. */
  sub: string;
  /** True under 48 hours, which is what moves the ring to the warning token. */
  urgent: boolean;
}

/**
 * Time left on a contest, as a share of the contest's own length.
 *
 * COUNTS IN THE UNIT THAT CAN STILL CHANGE SOMEBODY'S DAY, which is rule L15's
 * reasoning applied to a ring: "1 day left" at 23:00 and at 01:00 are twenty
 * two hours apart and only one of them is worth dropping everything for. So
 * under 48 hours it counts hours, and under an hour it counts minutes.
 *
 * NO SECONDS, deliberately. `useNow` ticks every 30 seconds, and a seconds
 * figure that only moves twice a minute reads as a frozen clock.
 */
export function countdownOf(contest: CreatorContest, now: number): Countdown {
  const ends = Date.parse(contest.expiresAt);
  const opens = Date.parse(contest.opensAt);
  const leftMs = Number.isNaN(ends) ? 0 : Math.max(0, ends - now);

  const length = Number.isNaN(ends) || Number.isNaN(opens) ? 0 : ends - opens;
  const share = length > 0 ? Math.max(0, Math.min(1, leftMs / length)) : null;

  const urgent = leftMs > 0 && leftMs < URGENT_MS;

  if (leftMs <= 0) return { leftMs, share, centre: '0', sub: 'days left', urgent: false };

  const hours = leftMs / 3_600_000;
  if (hours < 1) {
    // Ceiled, so the last stretch never prints "0 minutes left".
    const m = Math.max(1, Math.ceil(leftMs / 60_000));
    return { leftMs, share, centre: String(m), sub: m === 1 ? 'min left' : 'mins left', urgent };
  }
  if (hours < 48) {
    const h = Math.ceil(hours);
    return { leftMs, share, centre: String(h), sub: h === 1 ? 'hour left' : 'hours left', urgent };
  }
  const d = Math.ceil(hours / 24);
  return { leftMs, share, centre: String(d), sub: d === 1 ? 'day left' : 'days left', urgent };
}

interface Filmed {
  /** Approved videos. A real count, so a real 0 is a 0. */
  done: number;
  /**
   * What was agreed, frozen at approval. `null` is an OPEN ENDED entry — there
   * is no denominator, so there is no bar and no "0 of 0".
   */
  required: number | null;
  /** "2 of 3 videos", or null when there is nothing to count against. */
  label: string | null;
  /** 0 to 1, or null. Feeds the bar's width and nothing else. */
  share: number | null;
}

/** Her deliverables, as one sentence and one fraction. §8.1. */
export function filmedOf(contest: CreatorContest): Filmed {
  const p = contest.progress;
  if (!p) return { done: 0, required: null, label: null, share: null };

  const required = p.required;
  if (required === null || required <= 0) {
    return { done: p.approved, required: null, label: null, share: null };
  }

  return {
    done: p.approved,
    required,
    label: `${p.approved} of ${required} ${required === 1 ? 'video' : 'videos'}`,
    share: Math.max(0, Math.min(1, p.approved / required)),
  };
}
