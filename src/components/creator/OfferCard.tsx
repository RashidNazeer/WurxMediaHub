import { brandLogo } from '@/lib/brand-logos';
import { useState } from 'react';
import { ArrowRight, Check, ChevronDown, Clock, Store, X } from 'lucide-react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StageTracker } from '@/components/creator/StageTracker';
import { JobProgressBar } from '@/components/work/JobProgress';
import { BrandChip, Note, StatusPill, type PillTone } from '@/components/creator/earn/EarnBits';
import { Linkify } from '@/components/creator/earn/Linkify';
import { OfferDetails } from '@/components/creator/earn/OfferDetails';
import { formatAmount, mentionsMoney, offerName } from '@/components/creator/earn/offer-money';
import { cn } from '@/lib/utils';
import { STAGE_META, stageTextTone } from '@/lib/offer-stages';
import { useApplyForOffer, type MyOfferApplication } from '@/lib/creator/useOfferApplications';
import { needsFilming, progressSentence, type JobProgress } from '@/lib/work/job-progress';

/**
 * One offer, as a creator sees it. ONE component, used by both screens.
 *
 * This was written out twice, once on the offers list and once inside the brand
 * hub, and the two copies had already drifted: only one showed the per video
 * rate, and only one carried a sentence about posting that was not true. Two
 * cards for one offer is how a creator gets two answers to one question.
 *
 * REBUILT 2026-10-16 to §8.2: brand chip, image, the rate in large text, a
 * one line summary, a status pill, one button.
 *
 * `wx-neo-raised-sm`, NOT `wx-neo-raised`. The old card carried the blurring
 * variant, so a grid of fifteen offers was fifteen `backdrop-filter` layers
 * against a budget of three, each one re-sampling and re-blurring its backdrop
 * on every scroll frame. The small variant is the SAME material — same fill,
 * same two lit rims, same seat — with the blur dropped, which at a card's size
 * was never readable anyway. The blur is spent once, on the panel the cards sit
 * in. See `src/components/creator/earn/EarnPanel.tsx`.
 *
 * THERE IS NO COMMISSION RATE COLUMN ON AN OFFER, and §8.2 asks for one in
 * large text. An offer on this platform is a fixed deal — n videos for a fee —
 * so the large figure is that fee, with the per video rate under it, which is
 * the nearest true thing. `products.commission_rate` exists, but products hang
 * off a BRAND rather than off an offer, and reaching for them would be a second
 * round trip on a screen whose whole filtering rule is that one beats two.
 *
 * WHAT CHANGED, 2026-10-16 (application tracking). Two reviewers reported that
 * applying made an offer disappear and that a rejection was never shown. The
 * disappearing was already fixed by the redesign — row level security keeps an
 * offer readable forever once you have asked for it
 * (`offers_select_own_requests`), and the chips now default to All. A DECLINED
 * request is where the honesty was still thin, so:
 *
 *   - the pill and the chip above the list now use the SAME word, `Declined`,
 *     where before a card pilled "Not this time" sat under a chip reading "Not
 *     applied" — two answers to one question, on the one state where being
 *     told plainly matters most;
 *   - every live request now prints its date: asked on, or declined on;
 *   - a creator can read back THE NOTE SHE SENT, with her portfolio links
 *     live, which is the only copy of it she has;
 *   - the whole campaign detail we hold sits behind the disclosure, instead of
 *     the description alone. See `earn/OfferDetails.tsx` for the audit of what
 *     exists in the schema and what does not.
 */

/** The least an offer has to be for this card to draw it. */
interface OfferCardOffer {
  id: string;
  /**
   * The brand, for the detail panel's brief and product reads.
   *
   * OPTIONAL so this interface stays a subset of what both callers already
   * pass: the offers list sends `CreatorOfferRow` and the brand hub sends
   * `CreatorOffer`, and both carry it. The panel falls back to `brand.id`, and
   * with neither it simply draws no brief — never a fetch with `undefined` in
   * the filter.
   */
  brand_id?: string;
  badge_title: string | null;
  title: string;
  description: string | null;
  video_count: number | null;
  reward_amount: string | number | null;
  currency: string;
  needs_application: boolean;
  brand?: { id: string; name: string; slug: string; logo_url: string | null } | null;
}

/** The five states §8.2's chips filter by, as one pill each. */
function pillFor(
  offer: OfferCardOffer,
  request: MyOfferApplication | undefined
): { tone: PillTone; label: string } {
  /*
   * A LIVE REQUEST WINS OVER WHAT THE OFFER SAYS ABOUT ITSELF, and the order
   * here matches `stateFor` in `useAllOffers.ts` exactly so the pill can never
   * disagree with the chip that filtered the card onto the screen.
   *
   * `Declined` IS THE CHIP'S OWN WORD, and that is the point of the rename. It
   * read "Not this time" while the only chip it could appear under said "Not
   * applied", so the one state a creator most needs stated plainly was stated
   * twice, differently. The sentence under the button still says "Not this
   * time" — a pill names a state, a note talks to a person.
   */
  if (request?.status === 'approved') return { tone: 'live', label: 'Accepted' };
  if (request?.status === 'pending') return { tone: 'waiting', label: 'Waiting' };
  if (!offer.needs_application) return { tone: 'live', label: 'Yours already' };
  if (request?.status === 'rejected') return { tone: 'bad', label: 'Declined' };
  return { tone: 'open', label: 'Not applied' };
}

/**
 * "12 Oct", for a date a creator wants to place rather than measure.
 *
 * No timezone named, deliberately: unlike a contest deadline this is a date in
 * the past, so which side of midnight it fell on in another zone changes
 * nothing anybody can act on. `formatDeadline` is for the dated ones.
 */
function onDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function OfferCard({
  offer,
  request,
  progress,
  showBrand = false,
  grouped = false,
  onApply,
}: {
  offer: OfferCardOffer;
  /** Their newest request on this offer, if they have ever made one. */
  request: MyOfferApplication | undefined;
  /** How much of the job has been filmed. Only ever present once approved. */
  progress: JobProgress | undefined;
  /** The brand row, for the list. Inside a hub it is noise. */
  showBrand?: boolean;
  /**
   * The card sits under a heading that already names its state ("Accepted",
   * "Declined"), so the pill would say it a second time. The hub's flat list
   * passes nothing and keeps the pill.
   */
  grouped?: boolean;
  onApply: () => void;
}) {
  /*
   * ONCE THEY ARE ON IT, THE CARD SHOWS THE DEAL THEY WERE GIVEN.
   *
   * Both numbers freeze at approval. Re-scoping or re-pricing an offer applies
   * to whoever is approved next, so the offer's own figures and this creator's
   * can legitimately differ, and printing today's offer above a bar counting
   * against a frozen five is how one card says two things at once.
   */
  const agreed = request?.status === 'approved';
  const videoCount = agreed ? request.committed_video_count : offer.video_count;
  const rewardAmount = agreed ? request.committed_amount : offer.reward_amount;
  const currency = agreed ? request.currency : offer.currency;

  const pill = pillFor(offer, request);

  /*
   * THE DETAIL PANEL FETCHES NOTHING UNTIL THIS IS TRUE.
   *
   * A native `<details>` renders its contents whether it is open or not, so
   * without this a list of fifteen cards would fire fifteen brief reads and
   * fifteen product reads on mount — exactly the second round trip the offers
   * screen is built to avoid. `onToggle` is the element's own event, so the
   * disclosure is still a real `<details>`: open and closed for free, keyboard
   * operable for free.
   *
   * WHAT IT COSTS is find-on-page inside a SHUT panel, which a plain
   * `<details>` gives you. Paid knowingly: the only prose in there that a
   * creator would search for is the offer's own description, and that is
   * already in the DOM on the card face above — clamped to one line, not
   * truncated — so the browser still finds a shut card by its brief.
   */
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="wx-neo-raised-sm relative flex h-full flex-col overflow-hidden rounded-xl">
      {agreed ? (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[0.1875rem]"
          /* The agreed-deal stripe: sky into periwinkle, the same ramp as the
             gradient CTAs. Nothing sits on it, so there is no text to
             re-colour. It is ONLY on a live card — a hairline on every card is
             decoration; on the two or three she is actually on, it is the thing
             that finds them in a grid of twelve. */
          style={{
            background:
              'linear-gradient(135deg, var(--wx-brand-sky) 0%, var(--wx-brand-peri) 100%)',
          }}
        />
      ) : null}

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        {/* ------------------------------------------------- top row -- */}
        <div className="flex items-start justify-between gap-2">
          {showBrand && offer.brand ? (
            <BrandChip
              brand={{
                name: offer.brand.name,
                slug: offer.brand.slug,
                logoUrl: offer.brand.logo_url,
              }}
              className="min-w-0"
            />
          ) : offer.badge_title ? (
            <span
              className="bg-accent-soft shrink-0 rounded-full px-2.5 py-1 text-[0.625rem] font-bold tracking-[0.12em] uppercase"
              style={{ color: 'var(--wx-brand-accent-ink, var(--wx-accent))' }}
            >
              {offer.badge_title}
            </span>
          ) : (
            <span />
          )}

          {/*
            THE STATUS PILL. The card used to carry none on purpose — the action
            at the bottom said what state the offer was in, and saying it twice
            made the second one read as a different fact. §8.2 asks for it, and
            it earns its place now that the chips above the list filter by the
            same four words: a pill that does not match the chip she tapped is
            the one thing a creator would notice, so `pillFor` is driven by the
            same branch order as `stateFor`.
          */}
          {grouped ? null : <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
        </div>

        {/* ------------------------------------- image, title and rate -- */}
        <div className="flex items-start gap-3">
          <OfferImage brand={offer.brand ?? null} />

          <div className="min-w-0 flex-1">
            <h3 className="font-display text-text text-[1rem] leading-snug font-semibold tracking-[-0.01em] break-words">
              {offerName(offer.title)}
            </h3>

            {/*
              THE NUMBER THEY CAME FOR, in large text. A creator scanning a grid
              is comparing exactly two things: how much work, and how much
              money. They used to be the same size as the surrounding prose, so
              every comparison meant reading rather than glancing.

              A NULL FEE IS NOT A ZERO. `formatAmount` answers "To confirm",
              because an offer the team will scope with her is not an offer
              worth nothing.
            */}
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className="font-display wx-numeric text-[1.375rem] leading-none font-bold"
                style={{ color: 'var(--wx-brand-accent-ink, var(--wx-accent))' }}
              >
                {formatAmount(rewardAmount, currency)}
              </span>
              {videoCount !== null ? (
                <span className="text-muted text-[0.75rem]">
                  for {videoCount} {videoCount === 1 ? 'video' : 'videos'}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* ------------------------------------------ one line summary -- */}
        {offer.description && !agreed && !mentionsMoney(offer.description) ? (
          <p className="text-muted line-clamp-1 text-[0.8125rem] leading-relaxed">
            {offer.description}
          </p>
        ) : null}

        {/* ------------------------------------ their own request, read back -- */}
        {request && !agreed && request.status !== 'withdrawn' ? (
          <YourRequest request={request} />
        ) : null}

        {/* ---------------------------------- where their work has got to -- */}
        {agreed ? <AgreedBody request={request} progress={progress} /> : null}

        {/* ------------------------------------------------- one button -- */}
        <div className="mt-auto pt-1">
          <OfferAction offer={offer} request={request} progress={progress} onApply={onApply} />
        </div>
      </div>

      {/*
        THE WHOLE CAMPAIGN DETAIL IS BEHIND A DISCLOSURE, not printed on every
        card.

        Rashid: "we need to make this card with minimum information and then
        accordion open up with more info". The face carries the brand, the
        money, the state and one line of the brief; this carries everything
        else we hold — what it pays and how, the payment path, the brief, the
        brand's hooks and do's and don'ts, and their products.

        IT IS DRAWN ON EVERY CARD NOW, not only on offers with a description.
        The money and the payment path are true of every offer, and they are
        the two things both reviewers said were missing before applying.

        A `<details>` rather than state and a div: it is open and closed for
        free and keyboard operable for free. Its contents mount only once it is
        open, which is what keeps fifteen cards from firing thirty reads on
        mount; the description itself is already in the DOM on the face above
        (clamped to one line, not truncated), so the browser's own
        find-on-page still reaches the brief text of a shut card.
      */}
      <details
        className="group border-line border-t"
        onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
      >
        <summary className="text-muted hover:text-text ease-brand flex min-h-[2.75rem] cursor-pointer list-none items-center gap-1.5 px-3.5 text-[0.8125rem] font-semibold transition-colors marker:content-none sm:min-h-[2.25rem] pointer-coarse:min-h-[2.75rem] [&::-webkit-details-marker]:hidden">
          <ChevronDown
            size={14}
            aria-hidden
            className="shrink-0 transition-transform duration-200 group-open:rotate-180"
          />
          <span className="group-open:hidden">Details</span>
          <span className="hidden group-open:inline">Hide details</span>
        </summary>
        {detailsOpen ? (
          <div className="border-line border-t p-3.5">
            {agreed ? <AgreedProgress request={request} progress={progress} /> : null}
            <OfferDetails
              offer={offer}
              agreed={agreed ? request : null}
              loadBrand={detailsOpen}
            />
          </div>
        ) : null}
      </details>
    </div>
  );
}

/**
 * The picture on the card. §8.2 asks for the product image.
 *
 * THERE IS NO PRODUCT ON AN OFFER. `offers` carries no product id and no image
 * column; products hang off a brand, and a creator-side read of them across
 * every brand would be a second round trip on a screen whose filtering rule is
 * deliberately one. So the image is the BRAND's own mark, which is the picture
 * this card can actually stand behind.
 *
 * IT HAS TO BE RIGHT WITH NO ARTWORK AT ALL. Plenty of brands have a null
 * `logo_url`, so the fallback is an accent-on-surface gradient built from
 * tokens with a shop glyph on it — a brand with no logo must not look like a
 * brand whose logo failed to load, and nothing shifts position either way.
 */
function OfferImage({
  brand,
}: {
  brand: { name: string; slug: string; logo_url: string | null } | null;
}) {
  return (
    <span
      aria-hidden
      className="wx-neo-inset grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl"
    >
      {brandLogo(brand?.slug, brand?.logo_url) ? (
        <img
          src={brandLogo(brand?.slug, brand?.logo_url) ?? ''}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full bg-white object-contain p-0.5"
        />
      ) : (
        <span className="from-accent/25 to-surface-2 grid size-full place-items-center bg-gradient-to-br">
          <Store size={18} aria-hidden className="text-faint" />
        </span>
      )}
    </span>
  );
}

/**
 * THE REQUEST SHE MADE, READ BACK TO HER: when she asked, and what she sent.
 *
 * Reviewers: "creators should be able to revisit applied offers and clearly
 * see whether an application is Pending, Approved, or Rejected". The pill
 * answers which; this answers when, and reminds her what she said — the note
 * she typed is stored on her row and was never shown back anywhere in the
 * product, so the only copy of her own pitch was in the admin queue.
 *
 * HER PORTFOLIO LINKS ARE LIVE HERE, through `Linkify`, which is the reviewers'
 * fourth item. Nothing in this subtree renders user-supplied HTML: `Linkify`
 * returns React nodes, so a note containing a tag has that tag printed.
 *
 * Only for a request that is still a question — pending, or declined. Once she
 * is approved, `AgreedBody` below takes over and her pitch is history.
 */
function YourRequest({ request }: { request: MyOfferApplication }) {
  const declined = request.status === 'rejected';
  const when = onDate(
    declined ? (request.decided_at ?? request.created_at) : request.created_at
  );
  const asked = onDate(request.created_at);

  return (
    <div className="border-line flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[0.8125rem] font-semibold">
          {declined ? 'Declined' : 'Waiting on the team'}
        </span>
        {when ? (
          <span className="text-faint wx-numeric text-[0.75rem]">
            {declined ? `declined ${when}` : `asked ${when}`}
          </span>
        ) : null}
      </div>

      {/* The date she asked, kept even on a declined row: "asked on the 2nd,
          heard back on the 9th" is the fact she is actually reconstructing. */}
      {declined && asked && asked !== when ? (
        <p className="text-faint text-[0.75rem]">You asked on {asked}.</p>
      ) : null}

      {request.note ? (
        <div className="wx-neo-inset rounded-xl px-3 py-2.5">
          <span className="text-faint text-[0.625rem] font-semibold tracking-[0.1em] uppercase">
            What you sent
          </span>
          <p className="text-muted mt-1 text-[0.8125rem] leading-relaxed whitespace-pre-line">
            <Linkify text={request.note} />
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Where an accepted job has got to, on the card face: ONE line naming the stage
 * and ONE quieter line under it. The fee is not here, because it is already the
 * large figure above; printing it a second time beside "You are in" was the
 * complaint. The seven-step tracker and the progress bar moved into the
 * disclosure (`AgreedProgress`), where they are one tap away.
 *
 * "You are in" and "Paid out" are fixed points for
 * `scripts/check-offer-requests.mjs`, so they stay as the first words.
 */
function AgreedBody({
  request,
  progress,
}: {
  request: MyOfferApplication;
  progress: JobProgress | undefined;
}) {
  const stage = request.stage ?? 'pending_request';
  const paid = stage === 'paid';
  /* While work is being filmed the useful second line is how many are done; in
     every other stage it is what happens next. Never both. */
  const filming = stage === 'content_pending' || stage === 'content_completed';
  const second =
    filming && progress && progress.required !== null
      ? progressSentence(progress)
      : paid
        ? 'Nothing left to do on this one.'
        : STAGE_META[stage].creatorHint;

  return (
    <div className="border-line flex flex-col gap-1 border-t pt-3">
      <p className={cn('text-[0.8125rem] font-semibold', stageTextTone(stage))}>
        {paid ? 'Paid out' : `You are in · ${STAGE_META[stage].label}`}
      </p>
      <p className="text-muted text-[0.8125rem] leading-relaxed">{second}</p>

      {/* What the team wrote back, with any link in it live. */}
      {request.decision_note ? (
        <p className="text-muted mt-1 text-[0.8125rem] leading-relaxed whitespace-pre-line">
          <Linkify text={request.decision_note} />
        </p>
      ) : null}
    </div>
  );
}

/** The tracker and the bar, one tap down. Only mounts once the disclosure opens. */
function AgreedProgress({
  request,
  progress,
}: {
  request: MyOfferApplication;
  progress: JobProgress | undefined;
}) {
  return (
    <div className="border-line mb-3.5 flex flex-col gap-3 border-b pb-3.5">
      <StageTracker stage={request.stage ?? 'pending_request'} />
      {progress ? <JobProgressBar progress={progress} compact /> : null}
    </div>
  );
}

/**
 * ONE BUTTON: Apply, Waiting, or Start. §8.2.
 *
 * THE LABELS ARE THE HOUSE WORDS WHERE A GUARD DEPENDS ON THEM.
 * `scripts/check-offer-requests.mjs` clicks "Apply for this" by accessible name
 * and waits on "with the team", "You are in" and "already on this one" by text,
 * so those four phrases are fixed points. "Start" is the new one, and it is a
 * link rather than a button because it goes somewhere: Content, filtered to
 * this job, which is where a video is actually attached.
 */
function OfferAction({
  offer,
  request,
  progress,
  onApply,
}: {
  offer: OfferCardOffer;
  request: MyOfferApplication | undefined;
  progress: JobProgress | undefined;
  onApply: () => void;
}) {
  const withdraw = useApplyForOffer();

  /*
   * LIVE WORK IS DECIDED FIRST, before anything the offer says about itself.
   *
   * `needs_application` used to be checked first, which was wrong the moment an
   * admin switched it off on an offer somebody had already been approved for:
   * the card said "you are already on this one" and swallowed their stage,
   * their tracker and the money they were owed.
   *
   * Rashid, 2026-08-11, on the same rule from the other side: an offer nobody
   * has to apply for is never counted towards an offer. So progress follows the
   * JOB, never the flag.
   */
  if (request?.status === 'approved') {
    /*
     * START, offered only while there is actually something to film. A job
     * whose videos are all in and counted has nothing to start, and a button
     * that leads to an empty form is the same bug as offering Withdraw once
     * work has been filed.
     */
    if (progress && !needsFilming(progress)) return null;

    return (
      <ButtonLink
        to={`/app/content?job=${request.id}`}
        size="sm"
        className="w-full justify-center sm:w-auto"
      >
        Start
        <ArrowRight size={15} aria-hidden />
      </ButtonLink>
    );
  }

  if (request?.status === 'pending') {
    return (
      <div className="flex flex-col gap-2">
        {/* The card already prints the offer's numbers a few lines above, and
            those are exactly what was asked for, so there is nothing to repeat
            here. */}
        <Note tone="waiting" icon={<Clock size={15} />}>
          <span className="font-semibold">With the team.</span>
        </Note>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={withdraw.isPending}
          onClick={() =>
            withdraw.mutate({ action: 'application.withdraw', applicationId: request.id })
          }
        >
          {withdraw.isPending ? 'Withdrawing...' : 'Withdraw'}
        </Button>
        {withdraw.error ? (
          <p role="alert" className="text-danger text-[0.75rem]">
            {(withdraw.error as Error).message}
          </p>
        ) : null}
      </div>
    );
  }

  /*
   * Open to everyone, and nothing under way on it.
   *
   * It used to add "No application needed. Start posting whenever you are
   * ready", which was simply false: content attaches to a JOB, an open offer
   * has no job behind it, and there was nowhere for that creator to post. It
   * now says what is actually true and stops.
   *
   * IT DOES NOT SAY "Open to every approved creator", and from 2026-08-21 that
   * is a claim this card cannot make: offers carry an audience, so a high
   * commission offer can be narrowed to named creators and a volume offer can
   * exclude them. The card has no way to know which it is looking at, nor
   * should it, since who else can see an offer is not a creator's business.
   */
  if (!offer.needs_application) {
    return (
      <Note tone="live" icon={<Check size={15} />}>
        <span className="font-semibold">You are already on this one.</span>
      </Note>
    );
  }

  /*
   * DECLINED, AND SAID SO RATHER THAN SWALLOWED.
   *
   * The reviewers' report: "an application just disappears". It does not — row
   * level security keeps an offer readable forever once a request exists on it
   * (`offers_select_own_requests`) — but a declined row had nowhere of its own
   * to sit above the list, so it was only ever findable under All. It has its
   * own chip now, and this says the rest.
   *
   * THE REASON IS NOT OPTIONAL-LOOKING. When the team wrote one, it is the
   * whole value of this state, so it goes on its own line with its links live
   * rather than being appended to the sentence, where a long reason ran into
   * "Not this time" and read as one run-on apology.
   */
  if (request?.status === 'rejected') {
    return (
      <div className="flex flex-col gap-2">
        <Note tone="bad" icon={<X size={15} />}>
          {/* NO REASON IS INVENTED HERE. We do not know why, only that the
              team did not take it forward; `decision_note` below is the only
              place a reason can come from. "It went to somebody else" would be
              a guess about a row that does not say so. */}
          <span className="font-semibold">Not this time.</span>
          {request.decision_note ? (
            <span className="mt-1.5 block font-medium whitespace-pre-line">
              <Linkify text={request.decision_note} />
            </span>
          ) : null}
        </Note>
        <Button variant="secondary" size="sm" className="self-start" onClick={onApply}>
          Ask again
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" className="w-full justify-center sm:w-auto" onClick={onApply}>
      Apply for this
    </Button>
  );
}
