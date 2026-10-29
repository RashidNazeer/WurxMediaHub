import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { ContestStatus } from '@/lib/admin/useContests';

/**
 * Every STAFF write in the contest feature.
 *
 * Deliberately not table writes. None of the eleven contest tables has an
 * insert, update or delete policy at all, and the database functions behind
 * these calls are granted to `service_role` alone, so the browser could not do
 * this even if it tried. The `manage-contest` Edge Function is the only door,
 * and it re-reads the caller's role from the profiles table before it opens.
 *
 * There is no action here that removes a creator from a contest they have
 * joined, and there must never be one. That capability does not exist in the
 * database either. Cancelling the whole contest is the only exit and it affects
 * everybody, which is why it reads as a fire alarm rather than a tidy-up.
 *
 * TWO OF THESE ARE THE STAFF HALF OF WHAT A CREATOR SEES. `deliverable.save`
 * writes the target and the reward, which no creator may write anywhere in this
 * product, and `progress.review` is the confirmation that turns a figure a
 * creator typed into a figure money may be owed against.
 */

/**
 * What a deliverable asks for. Mirrors the database enum
 * `public.contest_deliverable_type`, which starts at two values and grows one
 * `alter type ... add value` at a time.
 */
type ContestDeliverableType = 'gmv' | 'video_count';

/** Staff confirm or refuse a claim. `pending` is the only thing a creator writes. */
type ContestProgressStatus = 'pending' | 'confirmed' | 'rejected';

type ContestSavePayload = {
  action: 'contest.save';
  contestId?: string | null;
  brandId: string;
  name: string;
  description: string | null;
  /*
   * judgingBasis is GONE, from here, from the Edge Function and from
   * `save_contest`'s argument list. There are no placings to state a basis for:
   * a contest is a list of deliverables and each one says its target in
   * numbers. Sending the field now reaches a function that does not accept it.
   */
  /** ISO instant. Always sent with its zone, because one is meaningless alone. */
  expiresAt: string;
  /** An IANA zone name, never an offset. See rule L6. */
  expiresAtTimezone: string;
  opensAt?: string | null;
  briefUrl: string | null;
  bannerUrl: string | null;
  /** Optional picture beside "why join". Added 2026-08-22. */
  cardImageUrl?: string | null;
  /** Why a creator should enter, one reason per line. */
  perks?: string | null;
  currency: string;
  status: ContestStatus;
  needsAdminApproval: boolean;
};

/** Staff only, and its own action so the setup form cannot reach it by accident. */
type ContestCommercialsPayload = {
  action: 'contest.commercials';
  contestId: string;
  totalBudget: number | null;
  internalNote: string | null;
};

/** Closes the door, never the work. Everybody already in carries on and is paid. */
type ContestStatusPayload = {
  action: 'contest.status';
  contestId: string;
  status: ContestStatus;
};

type ContestDeletePayload = { action: 'contest.delete'; contestId: string };

/** The fire alarm. Affects every entrant, and the screen has to say so. */
type ContestCancelPayload = {
  action: 'contest.cancel';
  contestId: string;
  /** MESSAGE, not reason: the entrants read this. See decision D14. */
  message: string | null;
};

/**
 * ONE DELIVERABLE: pick a type, type the target the creator has to reach, type
 * the reward for reaching it. That is the whole popup, and the whole row.
 *
 * BOTH NUMBERS ARE REQUIRED rather than nullable, which is a change: a reward
 * used to be typed later on a row that only named a placing. Nothing is
 * contingent on a placing now, so a row without a target is meaningless and a
 * row without a reward has no purpose. Zero is a legal reward and means an
 * unpaid deliverable, which the brief-only case needs.
 *
 * SEVERAL DELIVERABLES MAY SHARE A TYPE, deliberately. 500 GMV pays 50 and 1000
 * pays 120, and one creator earns both on the way past. There is no uniqueness
 * on (contest, type) in the database and adding one here would delete tiering.
 */
type DeliverableSavePayload = {
  action: 'deliverable.save';
  deliverableId?: string | null;
  contestId: string;
  type: ContestDeliverableType;
  /** Typed by the admin, every time. Nothing generates one. See decision Q11. */
  title: string;
  detail: string | null;
  /**
   * The number the creator has to reach. A whole number of videos, 1 to 1000,
   * when the type is video_count. Read only to creators in the browser AND on
   * the wire: no function a creator can reach takes a target argument.
   */
  targetValue: number;
  /** What reaching it pays. Zero means an unpaid deliverable, never "not set". */
  rewardAmount: number;
  sortOrder: number;
  isActive: boolean;
};

/** Retire, never delete. A row somebody holds terms against is part of a promise. */
type DeliverableRetirePayload = {
  action: 'deliverable.retire';
  deliverableId: string;
};

/**
 * Confirming or refusing what one creator says they have achieved.
 *
 * NOTHING COUNTS UNTIL THIS RUNS, and that is the whole reason the action
 * exists: a creator types their own GMV, so an unconfirmed figure is a claim
 * about money rather than a total. Money is only ever owed against a confirmed
 * one.
 *
 * IT CARRIES NO FIGURES. Staff decide on WHAT THE CREATOR TYPED and cannot edit
 * it into something else, because a figure somebody else rewrote is not a claim
 * anybody made. A wrong one is refused with a sentence and the creator sends
 * the right one.
 *
 * MESSAGE, NOT REASON (decision D14). The creator reads it, it is the only
 * place they are told why, and a rejection without one is refused at the door
 * and again in the database.
 *
 * It decides nothing about the videos: those are reviewed one by one through
 * `manage-content`, so confirming a count of six is not a decision about six
 * videos.
 */
type ProgressReviewPayload = {
  action: 'progress.review';
  updateId: string;
  status: Exclude<ContestProgressStatus, 'pending'>;
  message: string | null;
};

/**
 * ONE CONTEST VIDEO, WATCHED AND DECIDED.
 *
 * The twin of `content.review` on the offer side, and it did not exist until
 * 2026-08-20. `review_contest_content` had been finished in the database since
 * 2026-08-13 with no caller at all, so no contest video could ever leave
 * 'submitted' and both screens drew states nothing could produce.
 *
 * IT MOVES MONEY. Rashid's rule, decided the same day: a video reward is owed
 * when the last video is approved, not when a creator claims a number and not
 * when staff confirm one. So approving the tenth video of ten writes the bill,
 * and sending one back withdraws it again unless it has already been paid. The
 * result carries both figures so the screen can say which happened.
 */
type ContestContentReviewPayload = {
  action: 'content.review';
  contentId: string;
  status: 'approved' | 'needs_another_take';
  /** The creator reads this. Optional, exactly as on the offer side. */
  note: string | null;
};

/** What review_contest_content hands back, so a screen can report the money. */
export type ContestContentReviewResult = {
  approved_videos: number;
  rewards: { awards: number; amount: number; currency?: string };
  withdrawn: { withdrawn: number; amount: number; already_paid: number; currency?: string };
};

/**
 * LETTING SOMEBODY INTO A CONTEST, OR TURNING THEM AWAY.
 *
 * This did not exist until 2026-08-15 and its absence was the whole of a bug
 * Rashid found by hand: on a contest that needs approval, a creator applied,
 * saw "With the team", and waited for ever, because nothing in the product
 * could answer. `review_contest_entry` had been in the database since day one
 * with no caller but the seed script.
 *
 * NOTE IS READ BY THE CREATOR. `blockReason` is staff only. Turning somebody
 * away and barring them are two decisions: a refusal leaves them free to apply
 * again, and `block` also writes an exclusion scoped to this one contest.
 */
type EntryReviewPayload = {
  action: 'entry.review';
  entryId: string;
  decision: 'approved' | 'rejected';
  /** MESSAGE to the creator, whatever the column is called. */
  note: string | null;
  block: boolean;
  /** Staff only, and genuinely a reason: no creator can ever read it. */
  blockReason: string | null;
};

type ProductsSetPayload = {
  action: 'products.set';
  contestId: string;
  productIds: string[];
};

/** Scoped to ONE contest. Never a brand, never an account. See decision D5. */
type ExclusionSavePayload = {
  action: 'exclusion.save';
  contestId: string;
  handle: string | null;
  email: string | null;
  userId?: string | null;
  /** Staff only, and genuinely a reason: no creator can ever read it. */
  reason: string | null;
};

type ExclusionRemovePayload = {
  action: 'exclusion.remove';
  exclusionId: string;
};

/**
 * Closing a contest. It is NOT a payment, and that changed on 2026-08-14.
 *
 * Rewards are owed the moment staff confirm the figures that earn them, so by
 * the time a contest closes there is nothing left to work out. Closing says the
 * event is over: no more entries, no more claims, no more confirmations. Paying
 * carries on afterwards and is a separate action.
 *
 * The database refuses to close a contest with a claim still waiting, because
 * that claim could never be confirmed afterwards and confirming is the only
 * thing that can owe somebody money. It returns what is still unpaid rather
 * than refusing on it, so the screen warns before the click.
 */
type ContestSettlePayload = {
  action: 'contest.settle';
  contestId: string;
  /** MESSAGE, not reason: every entrant reads this on their own timeline. */
  message: string | null;
};

/**
 * Marking earned rewards paid. The second and last state money has here.
 *
 * A LIST, because the screen is a queue of everything we owe across every
 * contest and clearing a run of it in one sitting is the job. One reward is a
 * list of one, so there is a single code path.
 *
 * `allowSuspended` is not a convenience. The database refuses to pay somebody
 * whose account we have switched off unless this is set, so the screen has to
 * ask out loud rather than let it through with the rest (rule S8).
 *
 * THERE IS NO WAY BACK. Nothing unpays a reward, so the screen confirms first.
 */
type AwardPayPayload = {
  action: 'award.pay';
  awardIds: string[];
  /** THE CREATOR READS THIS, on every reward in the list. */
  message: string | null;
  allowSuspended: boolean;
};

type ManageContestPayload =
  | ContestSavePayload
  | ContestCommercialsPayload
  | ContestStatusPayload
  | ContestDeletePayload
  | ContestCancelPayload
  | ContestSettlePayload
  | DeliverableSavePayload
  | DeliverableRetirePayload
  | EntryReviewPayload
  | ProgressReviewPayload
  | ContestContentReviewPayload
  | ProductsSetPayload
  | ExclusionSavePayload
  | ExclusionRemovePayload
  | AwardPayPayload;

export function useManageContest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ManageContestPayload): Promise<unknown> => {
      const { data, error } = await getSupabase().functions.invoke('manage-contest', {
        body: payload,
      });
      if (error) throw new Error(await messageFrom(error));
      return (data as { result: unknown }).result;
    },

    onSuccess: () => {
      // Cheap, and much safer than patching several caches by hand. An admin
      // must not have to wait on a websocket to see their own edit.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'contests'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'contest'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      /*
       * The claims queue. `contest_progress_updates` is deliberately NOT in the
       * realtime publication, because row security is not applied to DELETE
       * events and a creator's claimed GMV would broadcast to anybody who
       * opened an unfiltered channel. So a decision reaching the queue is this
       * line, and nothing else: staff must not have to reload to see that the
       * claim they just confirmed has left the list.
       */
      void queryClient.invalidateQueries({ queryKey: ['admin', 'contest-progress'] });
      /*
       * The rewards queue. A confirmation writes the bill in the same
       * transaction, so confirming a claim is also the moment money appears
       * here, and an admin who clears a claim and then opens Rewards must not
       * find it stale.
       */
      void queryClient.invalidateQueries({ queryKey: ['admin', 'contest-awards'] });
      // The entries queue. Deciding one has to take it off the screen without a
      // reload, the same as every other queue in the admin panel.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'contest-entries'] });
      /*
       * The contest video queue. Deciding a video has to take it off the screen
       * the same way, and since 2026-08-20 that decision can also owe or
       * withdraw money, so the rewards queue above matters here too.
       */
      void queryClient.invalidateQueries({ queryKey: ['admin', 'contest-content'] });
      // The creator side reads the same contests through different queries, so
      // an admin who is also looking at a hub sees their own edit there too.
      void queryClient.invalidateQueries({ queryKey: ['creator'] });
    },
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`, which is the
 * actual Response. Without this an admin would see that sentence instead of
 * "somebody has already been promised this deliverable as it stands, so add a
 * new one instead of changing it", which is the one that tells them what to do
 * next.
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
