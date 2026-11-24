/**
 * manage-contest
 * ---------------------------------------------------------------------------
 * Every STAFF write in the contest feature. The creator side (entering,
 * withdrawing, setting a private target, filing a video, typing what they have
 * achieved) has its own door in `enter-contest`, because the role check is
 * different and mixing them makes it harder to see which is which.
 *
 * TWO OF THE ACTIONS HERE ARE THE OTHER HALF OF A CREATOR'S SCREEN:
 *
 *   deliverable.save   what a contest asks for and what it pays. A type, a
 *                      TARGET the creator has to reach, and the REWARD for
 *                      reaching it. Staff type all three, here, and nowhere in
 *                      the product may a creator write any of them.
 *   progress.review    the confirmation that makes a claimed figure real.
 *                      Nothing a creator types counts until this runs, because
 *                      a creator typing their own GMV is a creator typing their
 *                      own payslip.
 *
 * Same shape as `manage-brand`, for the same reasons:
 *
 *   1. Verify the access token with the auth server. Not decode it.
 *   2. Read the caller's role FROM THE PROFILES TABLE. A JWT claim can be an
 *      hour stale, so somebody demoted five minutes ago is still carrying an
 *      admin claim right now. The table is the truth.
 *   3. Validate with Zod, again, even though the browser already did.
 *   4. Hand the work to one security definer function, so the row and its
 *      audit entry commit together or not at all.
 *
 * There is no insert, update or delete policy on ANY of the eleven contest
 * tables, and every database function is granted to `service_role` alone. This
 * function is the only door, and a browser could not do this even if it tried.
 *
 * Two things this function deliberately does NOT expose, and must never grow:
 *
 *   - Nothing that removes a creator from a contest they have joined. That
 *     capability does not exist in the database either, by decision on
 *     2026-08-13. Cancelling the whole contest is the only exit and it affects
 *     everybody.
 *   - Nothing that reads. Every read goes through row level security from the
 *     browser, so a bug here can never widen what somebody can see.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const money = z
  .number()
  .finite()
  .nonnegative()
  .max(99_999_999)
  // Stored as numeric(x,2). Round here rather than letting Postgres silently
  // truncate a third decimal place somebody pasted in.
  .transform((n) => Math.round(n * 100) / 100);

const currency = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/, 'Currency must be a three letter code')
  .transform((c) => c.toUpperCase());

/**
 * An IANA zone name, never an offset. "Europe/London" survives a clock change
 * and "+01:00" does not, which is the whole reason the column exists. The real
 * check is in `save_contest`, which looks the value up in `pg_timezone_names`,
 * because only the database holds that catalogue.
 */
const timezone = z
  .string()
  .trim()
  .min(1, 'Which timezone does this deadline mean?')
  .max(64)
  .regex(/^[A-Za-z]+\/[A-Za-z_+\-0-9/]+$|^UTC$/, 'That is not a timezone name');

/**
 * A link somebody will click, and `z.url()` on its own is NOT one.
 *
 * In zod 4 a bare `z.url()` only requires `new URL(value)` to parse, with no
 * protocol and no hostname check, so `javascript:alert(1)` and `http://...`
 * both passed here and were stopped by the column instead, arriving back as a
 * 23514 that humanise() flattened to "One of those values is outside what we
 * allow" on a form with eleven inputs. The columns are `~* '^https://'` and
 * `length between 12 and 2048`; this now says the same thing in a sentence,
 * first, which is what the plan's attack test 24 asks the door to do.
 */
const httpsUrl = z
  .url({
    protocol: /^https$/,
    error: 'A link has to be a full web address starting with https://',
  })
  .min(12, 'A link has to be a full web address starting with https://')
  .max(500, 'That link is too long, keep it under 500 characters');

const ContestSave = z.object({
  action: z.literal('contest.save'),
  contestId: z.uuid().nullish(),
  brandId: z.uuid('A contest must belong to a brand'),
  // 120, not 160. `contests.name` is `length(trim(name)) between 1 and 120`, so
  // 160 here meant a name between the two lengths reached the column and came
  // back as an unreadable check constraint violation.
  name: z.string().trim().min(1, 'A contest needs a name').max(120, 'That name is too long, keep it under 120 characters'),
  description: z.string().trim().max(4000).nullish(),
  /*
   * judgingBasis IS GONE, and it is gone from `save_contest`'s argument list as
   * well. There are no placings to state a basis for: a contest is a list of
   * deliverables, and each one says in numbers what a creator has to reach.
   * Leaving the field here would have been worse than useless, because
   * `save_contest` was dropped and recreated one argument shorter, so a request
   * still carrying it would bind to nothing and arrive as PGRST202.
   */
  expiresAt: z.iso.datetime({ offset: true }),
  expiresAtTimezone: timezone,
  opensAt: z.iso.datetime({ offset: true }).nullish(),
  briefUrl: httpsUrl.nullish(),
  bannerUrl: httpsUrl.nullish(),
  /*
   * Artwork and selling copy, 2026-08-22. Both optional, both creator readable.
   * The picture is checked as an https URL like every other one an admin
   * supplies, because it is a string that every entrant's browser then fetches.
   */
  cardImageUrl: httpsUrl.nullish(),
  perks: z.string().trim().max(600).nullish(),
  /*
   * NO DEFAULTS ON THESE THREE, deliberately, and it is not a style choice.
   * `save_contest` writes all three unconditionally, so a caller that simply
   * left `currency` out would have had `USD` filled in here and written over a
   * GBP contest, silently, with every prize on it keeping its numbers. The only
   * caller already sends all three, and `contest.commercials` is a separate
   * action precisely so no form ever has to send a field it does not own.
   */
  currency,
  status: z.enum(['active', 'inactive']),
  needsAdminApproval: z.boolean(),
});

/** Staff only, and its own action so the setup form cannot reach it by accident. */
const ContestCommercials = z.object({
  action: z.literal('contest.commercials'),
  contestId: z.uuid(),
  totalBudget: money.nullish(),
  internalNote: z.string().trim().max(2000).nullish(),
});

/**
 * Closing the door, not stopping the work. An inactive contest still lets
 * everybody already in deliver and be paid. Settling and cancelling are
 * different acts with their own functions.
 */
const ContestStatus = z.object({
  action: z.literal('contest.status'),
  contestId: z.uuid(),
  status: z.enum(['active', 'inactive']),
});

const ContestDelete = z.object({
  action: z.literal('contest.delete'),
  contestId: z.uuid(),
});

/** The fire alarm. It affects every entrant, and the screen has to say so. */
const ContestCancel = z.object({
  action: z.literal('contest.cancel'),
  contestId: z.uuid(),
  // MESSAGE, not reason. The entrants read this. See decision D14.
  message: z.string().trim().max(500).nullish(),
});

/**
 * ONE DELIVERABLE: a type, a target the creator has to reach, and the reward
 * for reaching it. That is the whole popup behind Add deliverable, and the
 * whole row.
 *
 * THE THREE KINDS ARE GONE, and with them rankPosition, metric, threshold and
 * videoCount. Placings were dropped on 2026-08-13: anybody who reaches a target
 * earns its reward, and several creators can earn the same one, so there is
 * nothing to come first in. A video target is now a target_value like any
 * other, which is why one column is read on every screen.
 *
 * BOTH NUMBERS ARE REQUIRED, not nullish, and that mirrors
 * `save_contest_deliverable`, whose p_target_value and p_reward_amount are
 * required arguments for the same reason: a defaulted argument is how a client
 * that forgot one writes a row anyway. A reward of zero is still legal and
 * means an unpaid deliverable.
 *
 * The title is typed by the admin every time. Nothing generates one. Rashid
 * ruled that on 2026-08-13 against the recommendation, so a blank title is
 * refused here, again in the database, and again by the column.
 */
const DeliverableSave = z.object({
  action: z.literal('deliverable.save'),
  deliverableId: z.uuid().nullish(),
  contestId: z.uuid(),
  type: z.enum(['gmv', 'video_count'], { error: 'Pick what this deliverable asks for' }),
  title: z.string().trim().min(1, 'Give this deliverable a short name').max(160),
  // The column's own bound. A door narrower than the column refuses work the
  // database would have taken; a door wider than it hands the admin a
  // constraint violation instead of a sentence.
  detail: z.string().trim().max(1000).nullish(),
  /*
   * ABOVE ZERO, because a deliverable earned by entering is not a deliverable,
   * and rounded to the two decimal places numeric(14, 2) stores rather than
   * letting Postgres truncate a third one silently.
   *
   * The 100 million ceiling is the typo guard `save_contest_deliverable`
   * carries, quoted here so it is a sentence rather than a numeric overflow.
   * Whether a video target is whole and under 1000 depends on `type`, so it is
   * checked after the union: a `.refine()` on a member stops it being a plain
   * object and `discriminatedUnion` needs plain objects.
   */
  targetValue: z
    .number()
    .finite()
    .positive('A deliverable needs a target above zero for the creator to reach')
    .max(100_000_000, 'That target looks like a typo')
    .transform((n) => Math.round(n * 100) / 100),
  rewardAmount: money,
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

/**
 * THE CONFIRMATION THAT MAKES A CLAIMED FIGURE REAL, and the only way a
 * progress update ever leaves `pending`.
 *
 * It carries no figures. Staff confirm or refuse WHAT THE CREATOR TYPED; they
 * do not get to edit it into something else, because a figure somebody else
 * rewrote is not a claim anybody made. If it is wrong it is refused with a
 * sentence and the creator sends the right one.
 *
 * MESSAGE, NOT REASON (decision D14). The creator reads this, it is the only
 * place they are told why, and `review_contest_progress` refuses a rejection
 * with nothing said. That refusal is mirrored below the union so an admin gets
 * the question rather than a round trip.
 *
 * It does NOT decide anything about the videos. Contest videos are reviewed one
 * by one through `manage-content`, decided by Rashid on 2026-08-13, so
 * confirming a count of six is not a decision about six videos.
 */
const ProgressReview = z.object({
  action: z.literal('progress.review'),
  updateId: z.uuid(),
  status: z.enum(['confirmed', 'rejected'], { error: 'A decision is confirmed or rejected' }),
  // 500, the length `contest_progress_updates.staff_message` allows.
  message: z.string().trim().max(500, 'Keep that under 500 characters').nullish(),
});

/**
 * ONE CONTEST VIDEO, WATCHED AND DECIDED, added 2026-08-20.
 *
 * `review_contest_content` has existed, finished and audited, since
 * 2026-08-13 and had NO CALLER: no action here, no hook, no screen. So
 * `contest_submissions.status` could never leave its default and every contest
 * video in the product read "With the team" for ever, while the creator's own
 * list carried "Counted" and "Sent back" states nothing could produce.
 *
 * The comment on `progress.review` used to say contest videos are reviewed
 * through `manage-content`. They are not and never were: that function only
 * knows `content_submissions`, which is the OFFER table. This is the door.
 *
 * SINCE 2026-08-20 IT ALSO MOVES MONEY, which is why it lives beside the other
 * money actions rather than in `manage-content`. Rashid: "money is only owed
 * when all videos are up ... admin see one by one and all are approved only
 * then money is owed." The last approval that reaches a video target owes the
 * reward; taking an approval back withdraws it again unless it is already paid.
 */
const ContentReview = z.object({
  action: z.literal('content.review'),
  contentId: z.uuid(),
  // 'submitted' is not a decision, and the database refuses it too.
  status: z.enum(['approved', 'needs_another_take'], {
    error: 'A decision is approve or send back',
  }),
  // 500, the length `contest_submissions.decision_note` allows.
  note: z.string().trim().max(500, 'Keep that under 500 characters').nullish(),
});

/**
 * Retire, never delete. Once anybody holds frozen terms against a row, the row
 * is part of a promise and deleting it would leave the promise pointing at
 * nothing. There is no delete function for a deliverable at all.
 */
const DeliverableRetire = z.object({
  action: z.literal('deliverable.retire'),
  deliverableId: z.uuid(),
});

/** The whole set at once, so removing one is the same call as adding one. */
const ProductsSet = z.object({
  action: z.literal('products.set'),
  contestId: z.uuid(),
  productIds: z.array(z.uuid()).max(100),
});

/**
 * Barring somebody. Scoped to ONE contest, never a brand and never an account,
 * by decision D5. It stops new entries only: anybody already in stays in, and
 * nothing here can pull them out.
 */
// NOT refined here. A `.refine()` stops this being a plain object, and
// `discriminatedUnion` needs plain objects, so the "name somebody" rule is
// checked after the union instead. Getting this wrong makes the whole action
// unreachable rather than merely unvalidated, which is worse.
const ExclusionSave = z.object({
  action: z.literal('exclusion.save'),
  contestId: z.uuid(),
  handle: z.string().trim().max(64).nullish(),
  email: z.email('That is not an email address').max(320).nullish(),
  userId: z.uuid().nullish(),
  // Staff only. This one really is a reason: no creator can ever read it.
  reason: z.string().trim().max(500).nullish(),
});

const ExclusionRemove = z.object({
  action: z.literal('exclusion.remove'),
  exclusionId: z.uuid(),
});

/**
 * LETTING SOMEBODY INTO A CONTEST, OR TURNING THEM AWAY.
 *
 * THIS ACTION DID NOT EXIST UNTIL 2026-08-15, AND THAT WAS A HOLE, NOT A GAP.
 * `review_contest_entry` shipped in the first contest migration and was called
 * by exactly one thing: the seed script. So on a contest with
 * `needs_admin_approval` on, a creator applied, saw "With the team", and waited
 * for ever, because there was no door in the product for anybody to answer
 * through. The contest suite never caught it because it sets its own contest to
 * auto-approve, so it walked past the one path that was broken.
 *
 * TWO MESSAGES, AND THEY GO TO DIFFERENT PEOPLE. `note` is read by the creator
 * this is about. `blockReason` is staff only and never leaves the team. They
 * were one field once and that is exactly the trap `cancel_reason` was.
 */
const EntryReview = z.object({
  action: z.literal('entry.review'),
  entryId: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  // THE CREATOR READS THIS.
  note: z.string().trim().max(500).nullish(),
  /*
   * Turning somebody away and barring them are two decisions, not one. Refusing
   * this entry leaves them free to apply again; blocking also writes an
   * exclusion for THIS contest, which is scoped to one contest by decision D5.
   */
  block: z.boolean().default(false),
  // STAFF ONLY. No creator can ever read it.
  blockReason: z.string().trim().max(500).nullish(),
});

/**
 * Closing a contest. It moves no money and takes no outcomes: rewards are owed
 * the moment staff confirm the figures that earn them, and paid separately,
 * both of which keep working after this.
 *
 * The old five argument `settle_contest` was dropped on 2026-08-14, so this
 * action never existed against it and cannot be carrying a stale shape.
 */
const ContestSettle = z.object({
  action: z.literal('contest.settle'),
  contestId: z.uuid(),
  // The creator reads this on their own entry timeline.
  message: z.string().trim().max(500).nullish(),
});

/**
 * Marking earned rewards paid. A LIST, because the screen is a queue of
 * everything we owe across every contest and paying a run of people in one
 * sitting is the actual job. One id is a list of one.
 *
 * `allowSuspended` is not a convenience flag. Paying somebody whose account we
 * have switched off is a decision, so the database refuses without it and the
 * screen has to ask out loud (rule S8).
 */
const AwardPay = z.object({
  action: z.literal('award.pay'),
  awardIds: z
    .array(z.uuid())
    .min(1, 'Pick at least one reward to mark paid')
    .max(100, 'That is more than 100 rewards at once'),
  // THE CREATOR READS THIS, on every reward in the list.
  message: z.string().trim().max(500).nullish(),
  allowSuspended: z.boolean().default(false),
});

const Body = z.discriminatedUnion('action', [
  ContestSave,
  ContestCommercials,
  ContestStatus,
  ContestDelete,
  ContestCancel,
  ContestSettle,
  DeliverableSave,
  DeliverableRetire,
  EntryReview,
  ProgressReview,
  ContentReview,
  ProductsSet,
  ExclusionSave,
  ExclusionRemove,
  AwardPay,
]);

/** SQLSTATE from the database functions to something HTTP shaped. */
const STATUS_FOR_PG: Record<string, number> = {
  '42501': 403, // insufficient privilege
  P0002: 404, // no data found
  '23505': 409, // unique violation
  '23503': 409, // still referenced, for example entrants waiting on a decision
  '55006': 409, // object in use, the double click guard on settle and cancel
  '22023': 400, // invalid parameter value, most of our own refusals
  '23514': 400, // check constraint violation
};

/**
 * Turn a raw Postgres complaint into something a human can act on.
 *
 * Most of our refusals are raised with 22023 and already carry a sentence
 * written for a person, so they pass through untouched. The ones worth
 * translating are the constraint violations, where Postgres names an index.
 */
function humanise(message: string, code: string | undefined): string {
  if (code === '23505') {
    /*
     * OUR OWN SENTENCE WINS. Several of these functions raise 23505 carrying a
     * sentence written for a person, precisely because a raw duplicate key
     * error is not one, and the needle tests below used to throw those away and
     * return "That already exists" instead: the raw error the needles were
     * written to catch would have matched, so the fallback only ever fired on
     * the good message. Anything that is not raw Postgres text was written for
     * a person, so it goes back untouched.
     */
    if (!message.includes('duplicate key')) return message;
    /*
     * The `rank_idx` needle went with the index. Two deliverables of the same
     * type on one contest is the TIERED shape Rashid asked for by name (500
     * pays 50, 1000 pays 120), so there is no uniqueness on a deliverable left
     * to violate, and a needle for an index that no longer exists is a sentence
     * somebody later reads as the rule.
     */
    if (message.includes('one_pending_idx')) {
      return 'That creator already has an update waiting to be confirmed';
    }
    if (message.includes('exclusion')) return 'That person is already barred from this contest';
    /*
     * The placement and outcome needles went with placings and the outcome row
     * on 2026-08-14. What is left is the one that stops a creator being paid
     * twice for crossing the same target twice, and it should never reach a
     * human at all: `award_reached_terms` skips a term that already has a row,
     * so this only fires on a genuine race between two confirmations.
     */
    if (message.includes('one_per_term')) {
      return 'That reward has already been recorded for this entrant';
    }
    return 'That already exists';
  }
  if (code === '23514') return 'One of those values is outside what we allow';
  return message;
}

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

  // ---------------------------------------------------------- who is this --
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return reply({ error: 'Not signed in' }, 401);

  // Service role from here on. Nothing above this line was trusted.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor, error: actorErr } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', userData.user.id)
    .single();

  if (actorErr || !actor) return reply({ error: 'Not allowed' }, 403);

  // Ads Manager is staff since 2026-09-15, the same as ops. Mirrors is_staff().
  const isStaff = actor.role === 'admin' || actor.role === 'ops' || actor.role === 'ads_manager' || actor.role === 'ops_lead';
  if (!isStaff || !actor.is_active) {
    // A real account reaching for something it is not entitled to. Kept.
    await admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'contest.write_denied',
      subject_type: 'contest',
      detail: { reason: actor.is_active ? 'not staff' : 'account inactive' },
    });
    return reply({ error: 'Not allowed' }, 403);
  }

  // ------------------------------------------------------------ the input --
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Expected a JSON body' }, 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? 'That request was not valid' }, 400);
  }
  const input = parsed.data;

  /*
   * Checked after the union rather than inside it: a `.refine()` on a member
   * stops it being a plain object, and `discriminatedUnion` needs plain
   * objects. Getting that wrong makes the whole action unreachable rather than
   * merely unvalidated, which is worse.
   *
   * WHAT A VIDEO TARGET IS ALLOWED TO BE, in the two sentences
   * `save_contest_deliverable` raises, because a check constraint violation on
   * `contest_deliverables_video_target_whole` is not one. The database is still
   * the guarantee; this is only the wording arriving sooner.
   */
  if (input.action === 'deliverable.save' && input.type === 'video_count') {
    if (!Number.isInteger(input.targetValue)) {
      return reply(
        { error: `A video target is a whole number of videos, not ${input.targetValue}` },
        400
      );
    }
    if (input.targetValue > 1000) {
      return reply({ error: 'A video target above 1000 is a typo, not a contest' }, 400);
    }
  }

  // A refusal with nothing said is a creator with nothing to act on, and this
  // is the one screen where the sentence is the whole product. Refused in
  // `review_contest_progress` too; asked here so the admin is asked rather than
  // told after a round trip.
  if (
    input.action === 'progress.review' &&
    input.status === 'rejected' &&
    !input.message?.trim()
  ) {
    return reply({ error: 'Say what was wrong with these figures, the creator reads it' }, 400);
  }

  // Barring somebody has to name them somehow. Checked here rather than in the
  // schema for the discriminatedUnion reason above.
  if (input.action === 'exclusion.save' && !input.handle && !input.email && !input.userId) {
    return reply({ error: 'Give a handle or an email address' }, 400);
  }

  // ------------------------------------------------------------- do it ----
  let rpc: { data: unknown; error: { message?: string; code?: string } | null };

  if (input.action === 'contest.save') {
    rpc = await admin.rpc('save_contest', {
      p_actor_id: actor.id,
      p_brand_id: input.brandId,
      p_name: input.name,
      p_expires_at: input.expiresAt,
      p_expires_at_timezone: input.expiresAtTimezone,
      p_contest_id: input.contestId ?? null,
      p_description: input.description ?? null,
      p_brief_url: input.briefUrl ?? null,
      p_banner_url: input.bannerUrl ?? null,
      p_card_image_url: input.cardImageUrl ?? null,
      p_perks: input.perks ?? null,
      p_opens_at: input.opensAt ?? null,
      p_currency: input.currency,
      p_status: input.status,
      p_needs_admin_approval: input.needsAdminApproval,
    });
  } else if (input.action === 'contest.commercials') {
    rpc = await admin.rpc('save_contest_commercials', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_total_budget: input.totalBudget ?? null,
      p_internal_note: input.internalNote ?? null,
    });
  } else if (input.action === 'contest.status') {
    rpc = await admin.rpc('set_contest_status', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_status: input.status,
    });
  } else if (input.action === 'contest.delete') {
    rpc = await admin.rpc('delete_contest', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
    });
  } else if (input.action === 'contest.cancel') {
    rpc = await admin.rpc('cancel_contest', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_message: input.message ?? null,
    });
  } else if (input.action === 'contest.settle') {
    /*
     * Closing, not paying. The database refuses while any entry OR any progress
     * claim is still waiting, because a claim that can never be confirmed is a
     * reward silently cancelled, and it returns what is still unpaid so the
     * screen can say so.
     */
    rpc = await admin.rpc('settle_contest', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_message: input.message ?? null,
    });
  } else if (input.action === 'award.pay') {
    /*
     * The moment money leaves. One transaction for the whole list: if the
     * eleventh row refuses, the first ten roll back, because a partial success
     * with no way to see which half landed is worse than a refusal.
     */
    rpc = await admin.rpc('pay_contest_awards', {
      p_actor_id: actor.id,
      p_award_ids: input.awardIds,
      p_message: input.message ?? null,
      p_allow_suspended: input.allowSuspended,
    });
  } else if (input.action === 'deliverable.save') {
    rpc = await admin.rpc('save_contest_deliverable', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_type: input.type,
      p_title: input.title,
      p_target_value: input.targetValue,
      p_reward_amount: input.rewardAmount,
      p_deliverable_id: input.deliverableId ?? null,
      p_detail: input.detail ?? null,
      p_sort_order: input.sortOrder,
      p_is_active: input.isActive,
    });
  } else if (input.action === 'deliverable.retire') {
    rpc = await admin.rpc('retire_contest_deliverable', {
      p_actor_id: actor.id,
      p_deliverable_id: input.deliverableId,
    });
  } else if (input.action === 'entry.review') {
    /*
     * The decision a creator has been staring at "With the team" waiting for.
     * The database takes the entry FOR UPDATE before it reads its status, so
     * two admins answering the same request in the same second produce one
     * decision and one 55006, which arrives below as a 409.
     */
    rpc = await admin.rpc('review_contest_entry', {
      p_actor_id: actor.id,
      p_entry_id: input.entryId,
      p_decision: input.decision,
      p_note: input.note ?? null,
      p_block: input.block,
      p_block_reason: input.blockReason ?? null,
    });
  } else if (input.action === 'progress.review') {
    /*
     * The staff half of the one thing in this feature that is about money. The
     * database takes the row FOR UPDATE before it reads its status, so two
     * admins deciding the same claim in the same second get one decision and
     * one 55006, which arrives below as a 409 carrying "that update was already
     * confirmed" rather than as a silent second write.
     */
    rpc = await admin.rpc('review_contest_progress', {
      p_actor_id: actor.id,
      p_update_id: input.updateId,
      p_status: input.status,
      p_message: input.message ?? null,
    });
  } else if (input.action === 'content.review') {
    /*
     * One video, watched and decided. Since 2026-08-20 this is also where video
     * reward money is decided, in the same transaction as the decision, so a
     * creator can never be owed for work nobody approved and can never keep an
     * unpaid reward for work that was sent back.
     */
    rpc = await admin.rpc('review_contest_content', {
      p_actor_id: actor.id,
      p_content_id: input.contentId,
      p_status: input.status,
      p_note: input.note ?? null,
    });
  } else if (input.action === 'products.set') {
    rpc = await admin.rpc('set_contest_products', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_product_ids: input.productIds,
    });
  } else if (input.action === 'exclusion.remove') {
    rpc = await admin.rpc('remove_contest_exclusion', {
      p_actor_id: actor.id,
      p_exclusion_id: input.exclusionId,
    });
  } else {
    rpc = await admin.rpc('save_contest_exclusion', {
      p_actor_id: actor.id,
      p_contest_id: input.contestId,
      p_handle: input.handle ?? null,
      p_email: input.email ?? null,
      p_user_id: input.userId ?? null,
      p_reason: input.reason ?? null,
    });
  }

  if (rpc.error) {
    /*
     * An unrecognised SQLSTATE is OUR fault, not the admin's, so it is a 500
     * and it is logged, exactly as manage-brand does it. The case this is
     * written for is the one this feature's own migration warns about: an
     * argument list drifting gives PGRST202 and "Could not find the function
     * public.save_contest(...) in the schema cache", which used to arrive in
     * the admin's red bar as a 400, as though they had typed something wrong,
     * with no server trace to find it by.
     */
    const status = STATUS_FOR_PG[rpc.error.code ?? ''] ?? 500;
    if (status === 500) console.error('manage-contest failed', input.action, rpc.error);
    return reply(
      {
        error:
          status === 500
            ? 'Something went wrong at our end saving that. It has been logged.'
            : humanise(rpc.error.message ?? 'That did not work', rpc.error.code),
      },
      status
    );
  }

  return reply({ result: rpc.data });
});
