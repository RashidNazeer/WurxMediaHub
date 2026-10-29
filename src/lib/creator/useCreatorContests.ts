import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { joinChannel } from '@/lib/realtime';
import { contestLifecycleOf, type ContestLifecycle } from '@/lib/contest-state';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Contests, as a CREATOR sees them.
 *
 * The staff view of the same eleven tables is `src/lib/admin/useContests.ts`,
 * and the two are deliberately separate files that may not import each other.
 * That split is what stops a creator screen quietly inheriting a query that
 * reaches for `contest_commercials`, which is the contest feature's equivalent
 * of a brand's budget: staff only at the database, no creator policy at all,
 * and none may ever be added.
 *
 * NOT ONE STATUS FILTER IN THIS FILE, AND THAT IS THE POINT.
 *
 * Row level security decides every row here. `contests_select_creator` returns
 * a contest that is on, inside its window, belonging to a live brand, to an
 * approved creator who is not barred from it. `contests_select_own_entries`
 * returns any contest they hold an entry in, whatever state it has since moved
 * to. Everything else on this screen is their own row by policy.
 *
 * So there is no `.eq('status', 'active')` here, no expiry comparison, and no
 * exclusion check. Writing one would produce the same list today and disguise
 * which layer is doing the work, and the day the policy changed the screen
 * would keep answering from a filter nobody remembered was there. It also has
 * to stay visible that an excluded creator is removed by the DATABASE: there is
 * no card to hide, no button to disable and nothing on this screen that knows
 * they were ever barred.
 *
 * WHAT A CLOSED CONTEST DOES, because it is the rule the whole feature turns
 * on: switching a contest off, or letting its deadline pass, closes the DOOR,
 * never the WORK. Anybody already in still sees it, still delivers and still
 * gets paid. Nothing in this file may ever drop a contest somebody holds an
 * entry in.
 *
 * WHAT A CREATOR MAY NOW LEARN ABOUT THE FIELD, and the exact size of it.
 * Decision D7 said no creator ever sees anything about another entrant, and
 * rule N1 said no creator reachable surface returns a count of entrants in any
 * form. Rashid amended both on 2026-08-13 to exactly one sentence: "2nd closest
 * of 5 to the GMV target". So `useMyContestStanding` below returns a rank and a
 * count, from the database function `my_contest_standing`, and NOTHING ELSE
 * about anybody else. No handle, no name, no figure, no identifier, ever, and
 * nothing in this file may reconstruct one.
 *
 * A ranking is computed across every entrant, so it can only come from a
 * security definer function that ranks the whole field and then filters down to
 * the caller. Counting rows this browser can read would answer "1 of 1" with no
 * error at all, which is the failure mode brand_rollups was written against.
 *
 * AND WHAT THE CREATOR TYPES, which is the other half of this file. They enter
 * cumulative totals, a GMV figure and a video count, and NOTHING COUNTS UNTIL
 * STAFF CONFIRM IT. Two numbers are therefore carried apart everywhere below
 * and must never be merged: `confirmed` is what the team has checked and the
 * only figure money may be owed against, and a `pending` claim is what somebody
 * typed. THE TARGET IS READ ONLY HERE, in the browser and on the wire: nothing
 * in this file writes one, and `submit_contest_progress` takes no target
 * argument at all.
 */

/* ------------------------------------------------------------------ shapes -- */

type ContestEntryStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/**
 * What a deliverable asks for. Mirrors the database enum
 * `public.contest_deliverable_type`, two values today and more later.
 */
export type ContestDeliverableType = 'gmv' | 'video_count';

/** Where one claimed set of figures has got to. Only staff can move it. */
export type ContestProgressStatus = 'pending' | 'confirmed' | 'rejected';

interface CreatorContestBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/**
 * ONE DELIVERABLE, exactly as an admin typed it: what it asks for, the target
 * to reach, and what reaching it pays.
 *
 * BOTH NUMBERS ARE REAL NUMBERS NOW, never null. The database requires them, so
 * there is no "not set yet" case left to draw and no null to mistake for a
 * zero. A reward of zero is a genuine unpaid deliverable and reads as one.
 *
 * `targetValue` IS READ ONLY, everywhere, for ever. It is drawn beside what a
 * creator has achieved and is never an input on any creator screen.
 */
export interface CreatorContestDeliverable {
  id: string;
  contestId: string;
  type: ContestDeliverableType;
  title: string;
  detail: string | null;
  /** The number to reach. Whole, 1 to 1000, when the type is video_count. */
  targetValue: number;
  rewardAmount: number;
  sortOrder: number;
}

interface CreatorContestProduct {
  contestId: string;
  productId: string;
  productName: string;
}

export interface CreatorContestEntry {
  id: string;
  contestId: string;
  brandId: string;
  status: ContestEntryStatus;
  /** True when the contest was on auto approve at the moment they entered. */
  autoApproved: boolean;
  currency: string;
  /**
   * Every active reward on the contest, added up and frozen at approval. It was
   * the fixed half once; nothing is contingent on a placing any more, so it is
   * now the lot. Null until approved, or if there is none.
   *
   * IT IS WHAT IS ON OFFER, NEVER WHAT IS OWED. A reward is earned by reaching
   * a target and released by staff at settlement against a CONFIRMED figure.
   */
  committedAmount: number | null;
  /** The video targets added up, frozen the same way. */
  committedVideoCount: number | null;
  note: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * What one entrant was promised, copied at the moment they were approved and
 * never read live from the contest again.
 *
 * This is why an approved card stops quoting `deliverables` and starts quoting
 * these: an admin adding, retiring or re-pricing a deliverable on Friday must
 * not rewrite what somebody agreed to on Monday. The database refuses to move a
 * type, a target or a reward on a row anybody already holds terms against.
 */
export interface CreatorContestTerm {
  id: string;
  entryId: string;
  /** The deliverable it was copied from, so a card can line the two up. */
  deliverableId: string | null;
  type: ContestDeliverableType;
  title: string;
  detail: string | null;
  targetValue: number;
  rewardAmount: number;
  currency: string;
}

/**
 * ONE CLAIM: what a creator said they had achieved, and what staff did about
 * it.
 *
 * THE FIGURES ARE CUMULATIVE TOTALS, NOT INCREMENTS, so two of these are never
 * added together. The newest confirmed one is the total, which is what
 * `contest_entry_confirmed_totals` returns and why nothing here sums anything.
 *
 * A `pending` or `rejected` row is a claim and nothing more. `staffMessage` is
 * the sentence the creator reads under a refused figure and is the only place
 * they are told why, so it is rendered wherever a rejection is.
 */
export interface CreatorProgressUpdate {
  id: string;
  entryId: string;
  gmv: number;
  videoCount: number;
  status: ContestProgressStatus;
  staffMessage: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

/**
 * WHAT ONE ENTRY HAS ACTUALLY ACHIEVED, built from confirmed claims only.
 *
 * Anything that draws a bar, names a reward or talks about money reads this and
 * never the raw claims, because an unconfirmed figure is not a total. Taken
 * from the LATEST confirmed update rather than the sum of them, in the view,
 * because the figures are cumulative.
 *
 * `claimsWaiting` is how a screen says "with the team" without pretending the
 * number in it counts yet.
 */
export interface CreatorConfirmedTotals {
  entryId: string;
  contestId: string;
  confirmedGmv: number;
  confirmedVideoCount: number;
  confirmedAt: string | null;
  claimsWaiting: number;
}

/** One row of `contest_entry_progress`, which is keyed to exactly one entry. */
interface CreatorEntryProgress {
  entryId: string;
  contestId: string;
  /** Frozen at approval. Null means an open ended entry, so draw no bar. */
  required: number | null;
  approved: number;
  waiting: number;
  needsAnotherTake: number;
  posted: number;
  stillToFilm: number;
}

export interface CreatorContest {
  id: string;
  brandId: string;
  brand: CreatorContestBrand | null;
  name: string;
  description: string | null;
  /*
   * judgingBasis is GONE, with the column. It existed so a placing would never
   * feel arbitrary, and there are no placings: the deliverables say what to do
   * in numbers, and anybody who reaches a target earns its reward.
   */
  briefUrl: string | null;
  bannerUrl: string | null;
  /** Optional picture beside the "why join" panel. */
  cardImageUrl: string | null;
  /** Why a creator should enter, one reason per line, as the admin typed it. */
  perks: string | null;
  status: 'active' | 'inactive';
  needsAdminApproval: boolean;
  opensAt: string;
  expiresAt: string;
  /** An IANA zone name, always shown, never the reader's own. Rule L6. */
  expiresAtTimezone: string;
  currency: string;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelMessage: string | null;
  /** What it asks for and what each thing pays. Read only to them, always. */
  deliverables: CreatorContestDeliverable[];
  products: CreatorContestProduct[];
  /** Their own entry, if they have one. Never anybody else's, by policy. */
  entry: CreatorContestEntry | null;
  /** Frozen terms, once approved. Empty until then. */
  terms: CreatorContestTerm[];
  progress: CreatorEntryProgress | null;
  /** Their own private target. Staff cannot read this, and never will. */
  target: number | null;
  /**
   * Everything they have ever claimed on this entry, newest first. The history
   * IS the evidence, so it is a list rather than a latest row.
   */
  progressUpdates: CreatorProgressUpdate[];
  /** The claim waiting on the team, if there is one. At most one, by index. */
  pendingClaim: CreatorProgressUpdate | null;
  /** Confirmed only. The one figure money may be owed against. */
  confirmed: CreatorConfirmedTotals | null;
  /** What they have actually earned on this entry, newest first. */
  awards: CreatorContestAward[];
}

/**
 * ONE REWARD THEY HAVE EARNED, and the only thing in this file that is money
 * rather than a figure money might one day be owed against.
 *
 * WRITTEN BY THE TEAM CONFIRMING A CLAIM, never by anything a creator does.
 * Rashid, 2026-08-14: a reward is owed the moment staff confirm the figure that
 * crosses its target. So this row existing IS the proof that a target was
 * reached and checked, which is why no screen recomputes it.
 *
 * TWO STATES ONLY. `paidAt` null is owed; anything else is paid. They are drawn
 * with the same two tokens the rest of the product uses for exactly this
 * distinction, and they are never added into one figure.
 *
 * `reachedValue` is the figure that crossed the target, frozen at the moment it
 * did. Without it a receipt written six weeks later would quote whatever their
 * total is now, which is not what anybody was paid on.
 */
interface CreatorContestAward {
  id: string;
  entryId: string;
  contestId: string;
  /** The frozen term it was earned against, so a card can name the target. */
  termId: string;
  amount: number;
  currency: string;
  reachedValue: number | null;
  /** Written by staff when they mark it paid. The creator reads it. */
  message: string | null;
  createdAt: string;
  paidAt: string | null;
}

/* ------------------------------------------------------------- the door --- */

/**
 * Where the contest itself has got to. FIVE answers, and not one of them says
 * anything about whether this creator may still work or be paid.
 *
 * "Active" is three questions wearing one word: may somebody new enter, may
 * anybody read it, and may the people already in carry on. This answers only
 * the first, which is why it is called the door.
 *
 * THE BODY LIVES IN `src/lib/contest-state.ts`, shared with the staff side. The
 * two had identical copies for a day, which is how a creator ends up reading
 * one word for a state and an admin reading another for the same row.
 */
export type ContestDoor = ContestLifecycle;

export function doorOf(c: CreatorContest, now = Date.now()): ContestDoor {
  return contestLifecycleOf(c, now);
}

/** Where THEY stand, which is a different question from the one above. */
type ContestEntryState = 'in' | 'waiting' | 'declined' | 'withdrawn' | 'none';

export function entryStateOf(c: CreatorContest): ContestEntryState {
  const s = c.entry?.status;
  if (s === 'approved') return 'in';
  if (s === 'pending') return 'waiting';
  if (s === 'rejected') return 'declined';
  if (s === 'withdrawn') return 'withdrawn';
  return 'none';
}

/** Live work outranks a shut door: they are in it, so it is still theirs. */
export function isLiveForThem(c: CreatorContest): boolean {
  const state = entryStateOf(c);
  return state === 'in' || state === 'waiting';
}

/* ------------------------------------------------------------ the reads --- */

const CONTEST_COLUMNS =
  'id, brand_id, name, description, brief_url, banner_url, card_image_url, perks, status, ' +
  'needs_admin_approval, opens_at, expires_at, expires_at_timezone, currency, ' +
  'settled_at, cancelled_at, cancel_message, ' +
  'brand:brands (id, name, slug, logo_url)';

/*
 * A ceiling rather than a page, exactly as `useAllCreatorOffers` carries one.
 * A creator's whole world here is the contests of the handful of brands they
 * work with, and the grouping that actually matters to them (in, waiting, not
 * entered) lives in a different table from the contests themselves, so paging
 * would mean paging a list whose useful order is elsewhere. If anybody ever
 * hits this number, the answer is a view, not a bigger number.
 */
const CEILING = 200;

interface ContestRow {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  brief_url: string | null;
  banner_url: string | null;
  card_image_url: string | null;
  perks: string | null;
  status: 'active' | 'inactive';
  needs_admin_approval: boolean;
  opens_at: string;
  expires_at: string;
  expires_at_timezone: string;
  currency: string;
  settled_at: string | null;
  cancelled_at: string | null;
  cancel_message: string | null;
  brand: { id: string; name: string; slug: string; logo_url: string | null } | null;
}

interface DeliverableRow {
  id: string;
  contest_id: string;
  type: ContestDeliverableType;
  title: string;
  detail: string | null;
  target_value: number;
  reward_amount: number;
  sort_order: number;
}

interface ProductRow {
  contest_id: string;
  product_id: string;
  product_name: string;
}

interface CreatorContestCatalogue {
  contests: ContestRow[];
  deliverables: DeliverableRow[];
  products: ProductRow[];
}

/**
 * Every contest this creator can see, with what it asks for and what it pays.
 *
 * THREE READS, NOT ONE NESTED SELECT. The three tables carry three different
 * policies, and a nested select that silently returns an empty array for one of
 * them looks exactly like a contest that asks for nothing. Reading them apart
 * means an error is an error and an empty list is an empty list.
 *
 * No `contest_id` filter on the deliverables or the products either. Both
 * policies are written as "exists a contest I can read", evaluated with the
 * caller's own rights, so the rows that come back are already the rows of the
 * contests above. Passing a list of ids would be the client re-deciding
 * something the database has already decided.
 */
/**
 * `brandId` narrows the catalogue to one Brand Hub.
 *
 * It is a VIEW filter and not a boundary: what a creator may read is already
 * decided by the row policy on `contests`, and this only asks for less of it.
 * The predicate is equality on `brand_id`, which `contests_brand_idx` was
 * built for, so the narrower query is also the cheaper one.
 *
 * Only the contests read changes. Entries are keyed on `contest_id`, so an
 * entry against another brand's contest simply finds no parent row here and
 * falls away on its own.
 */
function useCreatorContestCatalogue(brandId?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['creator', 'contests', brandId ?? 'all'],
    staleTime: 30_000,
    /*
     * Rule L5, the ticking clock. A contest closes because a deadline passed,
     * which writes no row, so it fires no realtime event and invalidates
     * nothing. Without this a tab left open across a deadline keeps showing
     * "Closes in 2 hours" and an Enter button on a contest nobody can enter.
     */
    refetchInterval: 60_000,
    queryFn: async (): Promise<CreatorContestCatalogue> => {
      const sb = getSupabase();

      const contestsQuery = sb
        .from('contests')
        .select(CONTEST_COLUMNS)
        // Soonest deadline first, which is the order the screen wants and the
        // order `contests_soonest_idx` was built for.
        .order('expires_at', { ascending: true })
        .limit(CEILING);
      if (brandId) contestsQuery.eq('brand_id', brandId);

      const [c, d, p] = await Promise.all([
        contestsQuery,
        sb
          .from('contest_deliverables')
          .select(
            'id, contest_id, type, title, detail, target_value, reward_amount, sort_order'
          )
          .order('sort_order', { ascending: true })
          .limit(CEILING * 8),
        sb
          .from('contest_products')
          .select('contest_id, product_id, product_name')
          .order('product_name', { ascending: true })
          .limit(CEILING * 8),
      ]);

      if (c.error) throw c.error;
      if (d.error) throw d.error;
      if (p.error) throw p.error;

      return {
        contests: (c.data ?? []) as unknown as ContestRow[],
        deliverables: (d.data ?? []) as unknown as DeliverableRow[],
        products: (p.data ?? []) as unknown as ProductRow[],
      };
    },
  });

  /*
   * An admin editing a contest lands here without a reload: a new contest, a
   * renamed one, a moved deadline, a switch flipped.
   *
   * Through `joinChannel` rather than `supabase.channel()`, always. Two
   * components on one screen asking for the same channel name is what crashed
   * the whole page on 2026-08-13: `supabase.channel(name)` hands back the
   * EXISTING channel when one is open, and `.on()` after `subscribe()` throws
   * during render. See src/lib/realtime.ts.
   */
  useEffect(() => {
    return joinChannel('creator-contest-catalogue', [{ table: 'contests' }], () => {
      void queryClient.invalidateQueries({ queryKey: ['creator', 'contests'] });
    });
  }, [queryClient]);

  return query;
}

interface EntryRow {
  id: string;
  contest_id: string;
  brand_id: string;
  status: ContestEntryStatus;
  auto_approved: boolean;
  currency: string;
  committed_amount: number | null;
  committed_video_count: number | null;
  note: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}

interface TermRow {
  id: string;
  entry_id: string;
  deliverable_id: string | null;
  type: ContestDeliverableType;
  title: string;
  detail: string | null;
  target_value: number;
  reward_amount: number;
  currency: string;
}

interface ProgressUpdateRow {
  id: string;
  entry_id: string;
  gmv: number;
  video_count: number;
  status: ContestProgressStatus;
  staff_message: string | null;
  confirmed_at: string | null;
  created_at: string;
}

interface ConfirmedTotalsRow {
  entry_id: string;
  contest_id: string;
  confirmed_gmv: number;
  confirmed_video_count: number;
  confirmed_at: string | null;
  claims_waiting: number;
}

interface ProgressRow {
  entry_id: string;
  contest_id: string;
  required: number | null;
  approved: number;
  waiting: number;
  needs_another_take: number;
  posted: number;
  still_to_film: number;
}

interface TargetRow {
  entry_id: string;
  target: number;
}

interface AwardRow {
  id: string;
  entry_id: string;
  contest_id: string;
  term_id: string;
  awarded_amount: number;
  awarded_currency: string;
  reached_value: number | null;
  message: string | null;
  created_at: string;
  paid_at: string | null;
}

interface MyContestEntries {
  entries: EntryRow[];
  terms: TermRow[];
  progress: ProgressRow[];
  targets: TargetRow[];
  updates: ProgressUpdateRow[];
  confirmed: ConfirmedTotalsRow[];
  awards: AwardRow[];
}

/**
 * Their own side of every contest: the entry, what was promised, how much has
 * been filmed, the private number they set themselves, everything they have
 * claimed and everything the team has confirmed.
 *
 * Kept live on `contest_entries`, filtered to their own rows. A decision has to
 * land while they are looking at the screen, because being told immediately is
 * the whole point of this product. `contest_submissions` is on the same channel
 * because the progress view counts them, so a video being approved moves the
 * bar under their hands.
 *
 * The `creator_id` filter is load bearing rather than tidiness: postgres_changes
 * does not apply row security to DELETE events, so an unfiltered binding would
 * hand this browser the old row of somebody else's deleted entry.
 *
 * THE CLAIMS ARE NOT ON THAT CHANNEL, and cannot be. `contest_progress_updates`
 * is deliberately outside the realtime publication for the same reason: row
 * security is not applied to DELETE events, `delete_contest` cascades these
 * rows away, and a creator's claimed GMV would broadcast to anybody who opened
 * an unfiltered channel by hand. A claim moves because this creator typed it,
 * which invalidates below, or because staff decided it, which this browser
 * learns on the next refetch. Six reads, one round trip, because they are all
 * the same question: what is true about my own entries right now.
 */
function useMyContestEntries() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['creator', 'contest-entries'],
    staleTime: 15_000,
    queryFn: async (): Promise<MyContestEntries> => {
      const sb = getSupabase();

      const [e, t, g, k, u, f, w] = await Promise.all([
        sb
          .from('contest_entries')
          .select(
            'id, contest_id, brand_id, status, auto_approved, currency, committed_amount, ' +
              'committed_video_count, note, decision_note, decided_at, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(CEILING),
        sb
          .from('contest_entry_terms')
          .select(
            'id, entry_id, deliverable_id, type, title, detail, target_value, ' +
              'reward_amount, currency'
          )
          .limit(CEILING * 8),
        sb
          .from('contest_entry_progress')
          .select(
            'entry_id, contest_id, required, approved, waiting, needs_another_take, ' +
              'posted, still_to_film'
          )
          .limit(CEILING),
        sb.from('contest_entry_targets').select('entry_id, target').limit(CEILING),
        /*
         * EVERY CLAIM THEY HAVE EVER MADE, newest first, and their own only:
         * `contest_progress_updates` has one creator policy and it is
         * `creator_id = auth.uid()`. No filter is written here for the same
         * reason none is written anywhere else in this file, and the ordering
         * is the one `contest_progress_updates_creator_idx` was built for.
         *
         * Rejected rows are kept rather than filtered. They carry the sentence
         * staff wrote, they are why a video count cannot go back down, and
         * hiding them would leave a creator wondering what happened.
         */
        sb
          .from('contest_progress_updates')
          .select(
            'id, entry_id, gmv, video_count, status, staff_message, confirmed_at, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(CEILING * 4),
        /*
         * THE CONFIRMED TOTALS, which are the only totals. A view, keyed to an
         * entry, which belongs to exactly one person, so this browser's count
         * over its own rows is complete rather than silently narrowed. Anything
         * that draws a bar or names money reads this and never the claims.
         */
        sb
          .from('contest_entry_confirmed_totals')
          .select(
            'entry_id, contest_id, confirmed_gmv, confirmed_video_count, ' +
              'confirmed_at, claims_waiting'
          )
          .limit(CEILING),
        /*
         * WHAT THEY HAVE ACTUALLY EARNED, and whether it has been paid.
         *
         * This is the bill, and it is the truth about money rather than a
         * calculation this browser does. A screen adding up which targets look
         * reached would be reading the contest's deliverables AS THEY ARE
         * TODAY, while a reward is owed against the FROZEN TERM somebody agreed
         * to, so an admin adding a deliverable on Friday would make Monday's
         * dashboard claim money nobody owes.
         *
         * Own rows only: `contest_awards_select_own` is `creator_id =
         * auth.uid()` and there is no other creator policy on the table, which
         * is the same reason no filter is written anywhere else in this file.
         */
        sb
          .from('contest_awards')
          .select(
            'id, entry_id, contest_id, term_id, awarded_amount, awarded_currency, ' +
              'reached_value, message, created_at, paid_at'
          )
          .order('created_at', { ascending: false })
          .limit(CEILING * 8),
      ]);

      if (e.error) throw e.error;
      if (t.error) throw t.error;
      if (g.error) throw g.error;
      if (k.error) throw k.error;
      if (u.error) throw u.error;
      if (f.error) throw f.error;
      if (w.error) throw w.error;

      return {
        entries: (e.data ?? []) as unknown as EntryRow[],
        terms: (t.data ?? []) as unknown as TermRow[],
        progress: (g.data ?? []) as unknown as ProgressRow[],
        targets: (k.data ?? []) as unknown as TargetRow[],
        updates: (u.data ?? []) as unknown as ProgressUpdateRow[],
        confirmed: (f.data ?? []) as unknown as ConfirmedTotalsRow[],
        awards: (w.data ?? []) as unknown as AwardRow[],
      };
    },
  });

  useEffect(() => {
    if (!user?.id) return;

    return joinChannel(
      `creator-contest-entries:${user.id}`,
      [
        { table: 'contest_entries', filter: `creator_id=eq.${user.id}` },
        { table: 'contest_submissions', filter: `creator_id=eq.${user.id}` },
        /*
         * Money landing is the most felt moment in the product, so a reward
         * being marked paid has to arrive under their hands rather than on the
         * next refetch. Filtered to their own id for the same load bearing
         * reason as the other two: postgres_changes does not apply row security
         * to DELETE events.
         */
        { table: 'contest_awards', filter: `creator_id=eq.${user.id}` },
      ],
      () => {
        void queryClient.invalidateQueries({ queryKey: ['creator', 'contest-entries'] });
      }
    );
  }, [user?.id, queryClient]);

  return query;
}

/* ----------------------------------------------------------- the joining -- */

const flattenDeliverable = (d: DeliverableRow): CreatorContestDeliverable => ({
  id: d.id,
  contestId: d.contest_id,
  type: d.type,
  title: d.title,
  detail: d.detail,
  targetValue: Number(d.target_value),
  rewardAmount: Number(d.reward_amount),
  sortOrder: d.sort_order,
});

const flattenTerm = (t: TermRow): CreatorContestTerm => ({
  id: t.id,
  entryId: t.entry_id,
  deliverableId: t.deliverable_id,
  type: t.type,
  title: t.title,
  detail: t.detail,
  targetValue: Number(t.target_value),
  rewardAmount: Number(t.reward_amount),
  currency: t.currency,
});

const flattenUpdate = (u: ProgressUpdateRow): CreatorProgressUpdate => ({
  id: u.id,
  entryId: u.entry_id,
  gmv: Number(u.gmv),
  videoCount: u.video_count,
  status: u.status,
  staffMessage: u.staff_message,
  confirmedAt: u.confirmed_at,
  createdAt: u.created_at,
});

/* ----------------------------------------------------- what the form needs -- */

/**
 * THE HIGHEST VIDEO COUNT EVER CLAIMED ON THIS ENTRY, whatever became of it.
 *
 * The same figure `submit_contest_progress` computes, and it counts REJECTED
 * claims too, deliberately: the videos filed against one exist and were
 * reviewed, so re-asking for them would file them twice. A form that used the
 * confirmed count instead would ask for the same six links a second time and
 * then be refused by the database, which is the worst of both.
 */
export function videosAlreadyDeclared(updates: CreatorProgressUpdate[]): number {
  return updates.reduce((max, u) => (u.videoCount > max ? u.videoCount : max), 0);
}

/**
 * HOW MANY LINKS AND AD CODES TO ASK FOR: the INCREASE, never the total.
 *
 * Going from 5 to 6 asks for one. Rashid was explicit, the database refuses any
 * other number by naming both, and this is the one place the browser computes
 * it so no screen can invent its own arithmetic. Negative is impossible by
 * clamping here and refused by the database anyway: a count may never go back
 * down, because that would orphan videos staff have already looked at.
 */
export function newVideosNeeded(
  nextCount: number,
  updates: CreatorProgressUpdate[]
): number {
  return Math.max(0, Math.round(nextCount) - videosAlreadyDeclared(updates));
}

/** The claim sitting with the team, if there is one. At most one, by index. */
function pendingClaimOf(updates: CreatorProgressUpdate[]): CreatorProgressUpdate | null {
  return updates.find((u) => u.status === 'pending') ?? null;
}

/**
 * WHERE THEY SAY THEY ARE, which is a different question from where the team
 * says they are, and the two are drawn apart on purpose.
 *
 * The figures are cumulative, so this is the latest claim if one is waiting and
 * the confirmed figure otherwise. NOT the larger of the two: a claim may
 * correct a figure DOWNWARDS, because somebody who fat fingered 6400 has to be
 * able to fix it, and quietly keeping the bigger number would leave a creator
 * looking at a GMV they had just told us was wrong.
 *
 * Feed this to `DeliverableProgress` as `claimed` and the confirmed totals as
 * `confirmed`. It draws them as two different things because an unconfirmed
 * figure is a claim about money.
 */
export function claimedTotalsOf(
  updates: CreatorProgressUpdate[],
  confirmed: CreatorConfirmedTotals | null
): { gmv: number; videoCount: number } {
  const pending = pendingClaimOf(updates);
  if (pending) return { gmv: pending.gmv, videoCount: pending.videoCount };
  return {
    gmv: confirmed?.confirmedGmv ?? 0,
    videoCount: confirmed?.confirmedVideoCount ?? 0,
  };
}

/**
 * Everything on one screen, stitched.
 *
 * The two halves are separate queries because they change for different
 * reasons and at different speeds: the catalogue moves when an admin edits
 * something, their own entries move when somebody decides or when they film.
 * Joining them here rather than in the database is the same call
 * `useAllCreatorOffers` made, and for the same reason: the grouping a creator
 * actually wants crosses two tables with two different policies.
 *
 * THE NEWEST ENTRY PER CONTEST WINS. Somebody rejected in March can enter again
 * in June, and somebody who withdrew can change their mind, so a contest can
 * carry several rows and only the newest describes today. The partial unique
 * index guarantees at most one of them is live.
 */
export function useCreatorContests(brandId?: string) {
  const catalogue = useCreatorContestCatalogue(brandId);
  const mine = useMyContestEntries();

  const contests = useMemo((): CreatorContest[] => {
    const rows = catalogue.data?.contests ?? [];
    if (rows.length === 0) return [];

    const deliverables = new Map<string, CreatorContestDeliverable[]>();
    for (const d of catalogue.data?.deliverables ?? []) {
      const list = deliverables.get(d.contest_id) ?? [];
      list.push(flattenDeliverable(d));
      deliverables.set(d.contest_id, list);
    }

    const products = new Map<string, CreatorContestProduct[]>();
    for (const p of catalogue.data?.products ?? []) {
      const list = products.get(p.contest_id) ?? [];
      list.push({
        contestId: p.contest_id,
        productId: p.product_id,
        productName: p.product_name,
      });
      products.set(p.contest_id, list);
    }

    // Newest first out of the query, so the first one seen is the one that
    // describes today.
    const entryFor = new Map<string, EntryRow>();
    for (const e of mine.data?.entries ?? []) {
      if (!entryFor.has(e.contest_id)) entryFor.set(e.contest_id, e);
    }

    const termsFor = new Map<string, CreatorContestTerm[]>();
    for (const t of mine.data?.terms ?? []) {
      const list = termsFor.get(t.entry_id) ?? [];
      list.push(flattenTerm(t));
      termsFor.set(t.entry_id, list);
    }

    const progressFor = new Map<string, CreatorEntryProgress>();
    for (const g of mine.data?.progress ?? []) {
      progressFor.set(g.entry_id, {
        entryId: g.entry_id,
        contestId: g.contest_id,
        required: g.required,
        approved: g.approved,
        waiting: g.waiting,
        needsAnotherTake: g.needs_another_take,
        posted: g.posted,
        stillToFilm: g.still_to_film,
      });
    }

    const targetFor = new Map<string, number>();
    for (const k of mine.data?.targets ?? []) targetFor.set(k.entry_id, k.target);

    // Newest first out of the query, and kept in that order per entry: the most
    // recent claim is the one a card leads with.
    const updatesFor = new Map<string, CreatorProgressUpdate[]>();
    for (const u of mine.data?.updates ?? []) {
      const list = updatesFor.get(u.entry_id) ?? [];
      list.push(flattenUpdate(u));
      updatesFor.set(u.entry_id, list);
    }

    // Newest first out of the query and kept that way per entry, so a card
    // leads with the reward they most recently earned.
    const awardsFor = new Map<string, CreatorContestAward[]>();
    for (const w of mine.data?.awards ?? []) {
      const list = awardsFor.get(w.entry_id) ?? [];
      list.push({
        id: w.id,
        entryId: w.entry_id,
        contestId: w.contest_id,
        termId: w.term_id,
        amount: Number(w.awarded_amount),
        currency: w.awarded_currency,
        reachedValue: w.reached_value === null ? null : Number(w.reached_value),
        message: w.message,
        createdAt: w.created_at,
        paidAt: w.paid_at,
      });
      awardsFor.set(w.entry_id, list);
    }

    const confirmedFor = new Map<string, CreatorConfirmedTotals>();
    for (const f of mine.data?.confirmed ?? []) {
      confirmedFor.set(f.entry_id, {
        entryId: f.entry_id,
        contestId: f.contest_id,
        confirmedGmv: Number(f.confirmed_gmv),
        confirmedVideoCount: f.confirmed_video_count,
        confirmedAt: f.confirmed_at,
        claimsWaiting: f.claims_waiting,
      });
    }

    return rows.map((r): CreatorContest => {
      const row = entryFor.get(r.id) ?? null;
      const updates = row ? (updatesFor.get(row.id) ?? []) : [];
      const entry: CreatorContestEntry | null = row
        ? {
            id: row.id,
            contestId: row.contest_id,
            brandId: row.brand_id,
            status: row.status,
            autoApproved: row.auto_approved,
            currency: row.currency,
            committedAmount: row.committed_amount,
            committedVideoCount: row.committed_video_count,
            note: row.note,
            decisionNote: row.decision_note,
            decidedAt: row.decided_at,
            createdAt: row.created_at,
          }
        : null;

      return {
        id: r.id,
        brandId: r.brand_id,
        brand: r.brand
          ? {
              id: r.brand.id,
              name: r.brand.name,
              slug: r.brand.slug,
              logoUrl: r.brand.logo_url,
            }
          : null,
        name: r.name,
        description: r.description,
        briefUrl: r.brief_url,
        bannerUrl: r.banner_url,
        cardImageUrl: r.card_image_url,
        perks: r.perks,
        status: r.status,
        needsAdminApproval: r.needs_admin_approval,
        opensAt: r.opens_at,
        expiresAt: r.expires_at,
        expiresAtTimezone: r.expires_at_timezone,
        currency: r.currency,
        settledAt: r.settled_at,
        cancelledAt: r.cancelled_at,
        cancelMessage: r.cancel_message,
        deliverables: deliverables.get(r.id) ?? [],
        products: products.get(r.id) ?? [],
        entry,
        terms: entry ? (termsFor.get(entry.id) ?? []) : [],
        progress: entry ? (progressFor.get(entry.id) ?? null) : null,
        target: entry ? (targetFor.get(entry.id) ?? null) : null,
        progressUpdates: updates,
        pendingClaim: pendingClaimOf(updates),
        // Null until the team has confirmed something, and null is NOT a zero:
        // a screen says nothing is confirmed yet rather than printing 0 GMV,
        // which would read as "you have sold nothing".
        confirmed: entry ? (confirmedFor.get(entry.id) ?? null) : null,
        awards: entry ? (awardsFor.get(entry.id) ?? []) : [],
      };
    });
  }, [catalogue.data, mine.data]);

  return {
    contests,
    // The catalogue decides whether there is a screen at all. Their own rows
    // arriving a moment later fills the cards in, and a card is honest without
    // them: "not entered yet" is what a contest with no entry row means.
    isLoading: catalogue.isLoading,
    isError: catalogue.isError || mine.isError,
    error: (catalogue.error ?? mine.error) as Error | null,
  };
}

/* -------------------------------------------------------------- standing -- */

/**
 * "2nd closest of 5 to the GMV target." That sentence, and nothing else.
 *
 * Every number here is either the caller's own or an aggregate over the field.
 * There is no handle, no name, no identifier and no other entrant's figure, and
 * nothing may ever be added: this is the exact width of the amendment Rashid
 * made to decision D7 and rule N1 on 2026-08-13.
 *
 * IT TAKES NO USER ID, and that is the database's doing rather than this hook's
 * politeness. `my_contest_standing` reads `auth.uid()` itself, so there is no
 * argument a curious person could change into somebody else. It ranks the whole
 * field inside a security definer function and then filters down to the
 * caller's own row, which is the only shape that is both true and safe: ranking
 * the rows this browser can read would answer "1 of 1" with no error at all.
 *
 * NULL WHEN THERE IS NOTHING TO SAY. A creator with no approved entry in that
 * contest gets zero rows, which is the same answer as a contest that does not
 * exist, so this is not a discovery tool either. A screen draws nothing rather
 * than inventing a place.
 *
 * Ties share a place: two creators on the same confirmed GMV are both 2nd and
 * the next is 4th, because inventing an order between two people who are level
 * is both untrue and a fact about somebody else.
 */
interface MyContestStanding {
  /** How many people are in it. No hint of who. */
  entrants: number;
  /** The caller's own confirmed figures, the same ones the totals view carries. */
  confirmedGmv: number;
  confirmedVideoCount: number;
  /** 1 is closest. Ranked on confirmed figures only, so it lags reality. */
  gmvPlace: number;
  videoPlace: number;
}

interface StandingRow {
  entrants: number;
  confirmed_gmv: number;
  confirmed_video_count: number;
  gmv_place: number;
  video_place: number;
}

export function useMyContestStanding(contestId: string | null | undefined) {
  return useQuery({
    queryKey: ['creator', 'contest-standing', contestId],
    enabled: Boolean(contestId),
    /*
     * A minute. A standing only moves when a member of staff confirms
     * somebody's claim, which is a human decision rather than a stream of
     * events, and it is ranked on confirmed figures that lag reality anyway.
     */
    staleTime: 60_000,
    queryFn: async (): Promise<MyContestStanding | null> => {
      const { data, error } = await getSupabase().rpc('my_contest_standing', {
        p_contest_id: contestId,
      });
      if (error) throw error;

      // A set returning function, so this is an array of nought or one.
      const row = (data as StandingRow[] | null)?.[0];
      if (!row) return null;

      return {
        entrants: row.entrants,
        confirmedGmv: Number(row.confirmed_gmv),
        confirmedVideoCount: row.confirmed_video_count,
        gmvPlace: row.gmv_place,
        videoPlace: row.video_place,
      };
    },
  });
}

/* --------------------------------------------------------------- writing -- */

type EnterContestPayload = {
  action: 'contest.enter';
  contestId: string;
  note: string | null;
};

type WithdrawEntryPayload = { action: 'contest.withdraw'; entryId: string };

/** NULL clears it. Changing a target and dropping one are the same act. */
type SetTargetPayload = {
  action: 'contest.target';
  entryId: string;
  target: number | null;
};

/**
 * ONE NEW VIDEO, filed with an update. Exactly the new ones, never the ones
 * already declared: 5 to 6 sends one of these, not six.
 */
type ContestProgressVideo = {
  videoUrl: string;
  adCode: string;
  adAuthorized?: boolean;
  thumbnailUrl?: string | null;
  videoTitle?: string | null;
  videoAuthor?: string | null;
  embedId?: string | null;
};

/**
 * WHAT THEY HAVE ACHIEVED, TYPED BY THEM, WAITING FOR STAFF.
 *
 * LOOK AT WHAT IS NOT IN THIS TYPE, because it is the security design rather
 * than an omission. There is no target, no reward, no status, no creator id and
 * no other entrant. A creator may write their own achievement and nothing else.
 * The Edge Function's schema for this action is STRICT, so a field that is not
 * listed here is refused outright rather than quietly dropped, and
 * `submit_contest_progress` takes no target or reward argument at all: there is
 * nothing to forget to validate, because there is nothing to pass.
 *
 * THE FIGURES ARE CUMULATIVE TOTALS. "I am at 640 GMV and 6 videos", never "I
 * did 140 more". GMV may go down, because a fat fingered 6400 has to be
 * fixable. THE VIDEO COUNT MAY NOT, because videos are filed and reviewed one
 * by one and a lower count would orphan work staff have already looked at.
 *
 * `videos` carries exactly the INCREASE, which is what `newVideosNeeded` above
 * computes. The database refuses any other number by naming both.
 *
 * IT LANDS AS A CLAIM. Nothing here is money until staff confirm it.
 */
type SubmitProgressPayload = {
  action: 'progress.submit';
  entryId: string;
  gmv: number;
  videoCount: number;
  videos: ContestProgressVideo[];
};

/**
 * Entering, withdrawing, the private target, and saying what they have done.
 *
 * Not a table write, and there is no way to make it one: not one of the eleven
 * contest tables carries an insert, update or delete policy, and every database
 * function behind them is granted to `service_role` alone. The `enter-contest`
 * Edge Function re-reads who the caller is from the profiles table and calls a
 * security definer function that writes the row, its history and its audit
 * entry in one transaction.
 *
 * A SEPARATE DOOR from `manage-contest`, which is staff only. Same reason
 * `useApplyForOffer` and the admin's review mutation are separate: the role
 * check is different, and a shared hook is how the wrong one gets called.
 */
export function useEnterContest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      payload:
        | EnterContestPayload
        | WithdrawEntryPayload
        | SetTargetPayload
        | SubmitProgressPayload
    ) => {
      const { data, error } = await getSupabase().functions.invoke('enter-contest', {
        body: payload,
      });
      if (error) throw new Error(await messageFrom(error));
      return (data as { result: unknown }).result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['creator', 'contest-entries'] });
      /*
       * The catalogue too, and not only for tidiness. Entering an auto approve
       * contest freezes terms in the same transaction, and the card has to stop
       * quoting the contest's live deliverables and start quoting the frozen
       * ones the moment it does.
       */
      void queryClient.invalidateQueries({ queryKey: ['creator', 'contests'] });
      /*
       * And their standing, which is a separate query keyed per contest.
       * Filing a claim does not move it, because a claim is not confirmed, but
       * the videos filed with it move `contest_entry_progress`, and a creator
       * who has just typed something and sees two figures disagree will believe
       * the wrong one. Invalidating the whole prefix costs one small call.
       */
      void queryClient.invalidateQueries({ queryKey: ['creator', 'contest-standing'] });
    },
  });
}

/**
 * Pull the real message out of a failed function call.
 *
 * `functions.invoke` reports any non-2xx as a generic "Edge Function returned a
 * non-2xx status code" and hides the body on `error.context`, which is the
 * actual Response. Without this a creator sees that sentence instead of "that
 * contest closed on 31 Aug 2026 23:59 UTC", which is the whole reason the
 * database writes its refusals as sentences.
 *
 * A copy of the one in `useOfferApplications`, which is deliberately not
 * exported: three lines duplicated inside the same folder beats a shared
 * helper that later grows a special case for one caller.
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
