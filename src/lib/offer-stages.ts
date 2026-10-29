import {
  BadgeCheck,
  Banknote,
  Clapperboard,
  PackageCheck,
  PackageOpen,
  Truck,
  Wallet,
} from 'lucide-react';

/**
 * The seven stages of an approved offer, in one place.
 *
 * The SAME words on both sides, on purpose. An admin and a creator on the
 * phone should be able to say "sample shipped" and mean the same box. Two
 * vocabularies for one pipeline is how you get a support call.
 *
 * The order here is the order of the work, and everything that draws a tracker
 * or works out where money has got to reads it from this array rather than
 * hard-coding a sequence of its own.
 */

/**
 * Where a request stands before it has a stage at all.
 *
 * Lives HERE, in the neutral vocabulary file, rather than in either side's
 * hooks. It used to live in `lib/creator/`, which meant the admin queue
 * imported a creator module to name a database enum, and creator modules are
 * exactly what admin code must never reach into. See `.oxlintrc.json`.
 *
 * Only an APPROVED request has a stage: a pending one has not started and a
 * rejected one never will.
 */
export type OfferApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export const OFFER_STAGES = [
  'pending_request',
  'sample_requested',
  'sample_shipped',
  'content_pending',
  'content_completed',
  'payment_pending',
  'paid',
] as const;

export type OfferStage = (typeof OFFER_STAGES)[number];

interface StageMeta {
  label: string;
  /** What it means, in the creator's terms. */
  creatorHint: string;
  /**
   * The same thing in three or four words.
   *
   * For the places a stage is a COLUMN rather than a sentence: the pipeline
   * board and the seven cards on a creator's first day. `creatorHint` wraps to
   * three lines in a 142px column and turns a board into a wall of text.
   */
  short: string;
  icon: typeof Truck;
  /**
   * Which money bucket a request in this stage belongs to.
   *
   * `working` is money agreed but not yet earned out, `due` is work finished
   * and waiting on us, `paid` has actually been handed over. Every stage is in
   * exactly one bucket, so the three always add up to the total agreed.
   */
  bucket: 'working' | 'due' | 'paid';
}

export const STAGE_META: Record<OfferStage, StageMeta> = {
  pending_request: {
    label: 'Pending request',
    creatorHint: 'You are on this one. The team is getting it set up.',
    short: 'we are getting it set up',
    icon: BadgeCheck,
    bucket: 'working',
  },
  sample_requested: {
    label: 'Sample requested',
    creatorHint: 'Your sample has been asked for from the brand.',
    short: 'from the brand',
    icon: PackageOpen,
    bucket: 'working',
  },
  sample_shipped: {
    label: 'Sample shipped',
    creatorHint: 'It is on its way to you.',
    short: 'on its way to you',
    icon: Truck,
    bucket: 'working',
  },
  content_pending: {
    label: 'Content pending',
    creatorHint: 'Over to you. Film it and send it in.',
    short: 'over to you to film',
    icon: Clapperboard,
    bucket: 'working',
  },
  content_completed: {
    label: 'Content completed',
    creatorHint: 'Your content is in and being checked.',
    short: 'filmed and being checked',
    icon: PackageCheck,
    bucket: 'working',
  },
  payment_pending: {
    label: 'Payment pending',
    creatorHint: 'Approved for payment. The money is on its way.',
    short: 'approved for payment',
    icon: Wallet,
    bucket: 'due',
  },
  paid: {
    label: 'Paid',
    creatorHint: 'Paid out. Nothing left to do on this one.',
    short: 'the money has landed',
    icon: Banknote,
    bucket: 'paid',
  },
};

/** Zero-based position in the pipeline, for trackers and progress bars. */
export const stageIndex = (stage: OfferStage): number => OFFER_STAGES.indexOf(stage);

/**
 * Tailwind text colour for a stage's money bucket, so anything printed NEXT to
 * a tracker agrees with it. Without this the committed amount on an offer card
 * came out indigo while the bar under it was magenta, which is two answers to one
 * question.
 */
export const stageTextTone = (stage: OfferStage): string =>
  ({ working: 'text-stage-live', due: 'text-stage-due', paid: 'text-stage-paid' })[
    STAGE_META[stage].bucket
  ];

export const isStage = (v: unknown): v is OfferStage =>
  typeof v === 'string' && (OFFER_STAGES as readonly string[]).includes(v);
