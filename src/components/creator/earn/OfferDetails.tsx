import type { ReactNode } from 'react';
import { Check, Lightbulb, X } from 'lucide-react';
import { NOT_REPORTED } from '@/components/charts';
import { useCreatorProducts } from '@/lib/creator/useCreatorBrands';
import { OFFER_STAGES, STAGE_META } from '@/lib/offer-stages';
import { money, percent } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Linkify } from './Linkify';
import { formatAmount, perVideoOf } from './offer-money';
import { useCreatorBrandBriefs } from './useOfferBrief';

/**
 * EVERYTHING WE ACTUALLY HOLD ABOUT ONE OFFER, in one panel, before applying.
 *
 * Two reviewers asked for "complete campaign details before applying": the
 * brief, the hooks, the content guidelines, the products, the deliverables, the
 * payment amount and structure, the deadlines and the usage rights. This panel
 * is the audit of that list made visible — it shows every one of those that
 * exists in the database today and SAYS NOTHING AT ALL about the ones that do
 * not.
 *
 * WHAT EXISTS, AND WHERE IT LIVES
 *   offers              title, description, video_count, reward_amount,
 *                       currency, needs_application, badge_title, kind
 *   brand_briefs        title, what_to_make, hooks[], dos[], donts[]
 *                       (per BRAND, creator-readable, never shown until now)
 *   brand_products      name, image_url, price, currency, commission_rate
 *                       (per BRAND)
 *   offer_applications  committed_amount, committed_video_count, stage, note,
 *                       decision_note, decided_at
 *
 * WHAT DOES NOT EXIST, AND IS THEREFORE NOT DRAWN HERE
 *   a submission deadline on an offer      (contests have `expires_at`; offers
 *                                           have no date column at all)
 *   usage rights / licensing term          nowhere in the schema
 *   a payment method                       nowhere in the schema
 *   a payout date or payment timeline      only the seven-stage pipeline
 *   a call to action or caption requirement nowhere in the schema
 *   a product ON an offer                  no offers.product_id
 *   a commission rate ON an offer          only brand_products.commission_rate
 *
 * AN EMPTY SECTION IS NOT DRAWN, and a field we do not hold gets no row, no
 * dash and no "coming soon". A grey placeholder reading "Usage rights" would
 * tell a creator we have terms on file and are not showing them, which is a
 * worse answer than the question going unanswered.
 *
 * NO BLUR IN HERE. It renders inside `OfferCard` (`wx-neo-raised-sm`) and
 * inside `ApplyDialog` (`wx-neo-raised`, Layer C), so every box below is
 * `wx-neo-inset` — a well, not another pane of glass.
 */

/** The least an offer has to be for this panel to describe it. */
interface OfferDetailsOffer {
  id: string;
  /** Needed to reach the brand's briefs and products. Optional: see `brandId`. */
  brand_id?: string;
  title: string;
  description: string | null;
  video_count: number | null;
  reward_amount: string | number | null;
  currency: string;
  needs_application: boolean;
  brand?: { id: string; name: string; slug: string; logo_url: string | null } | null;
}

/** The frozen half of the deal, when a creator is already on it. */
interface OfferDetailsAgreed {
  committed_amount: string | number | null;
  committed_video_count: number | null;
  currency: string;
}

export function OfferDetails({
  offer,
  agreed,
  /**
   * Whether to fetch the brand's brief and products.
   *
   * FALSE UNTIL A CREATOR ASKS. The offers list is deliberately two round trips
   * for the whole screen; a brief fetched for all fifteen cards on mount would
   * throw that away. The card passes `true` only once its disclosure is open,
   * and the apply dialog passes `true` on mount, because by then she has
   * chosen one offer and is deciding whether to commit to it.
   */
  loadBrand = false,
  /**
   * Whether to draw the money block.
   *
   * FALSE IN THE APPLY DIALOG, and only there. That dialog's whole job is to
   * restate the deal she is agreeing to, in one sentence, directly above the
   * button — so drawing the same fee again three lines lower would be the
   * figure twice on one screen, which is how somebody starts wondering whether
   * it is two payments. Everything else in here is detail the dialog does not
   * otherwise carry.
   */
  showMoney = true,
  /**
   * The brand's name, for the callers whose offer row does not embed it.
   *
   * The apply dialog already knows it (it prints it under the title) while its
   * `CreatorOffer` carries only `brand_id`, so without this the brief would be
   * introduced as "written by the brand" on the one screen that can say who.
   */
  className,
}: {
  offer: OfferDetailsOffer;
  agreed?: OfferDetailsAgreed | null;
  loadBrand?: boolean;
  showMoney?: boolean;
  brandName?: string;
  className?: string;
}) {
  const brandId = offer.brand_id ?? offer.brand?.id;
  const key = loadBrand ? brandId : undefined;

  const { data: briefs } = useCreatorBrandBriefs(key);
  const { data: products } = useCreatorProducts(key);

  /*
   * THE AGREED DEAL WINS OVER THE OFFER'S OWN FIGURES, exactly as on the card.
   * Both numbers freeze at approval, so an offer re-priced afterwards must not
   * rewrite what somebody is already working to.
   */
  const live = agreed?.committed_amount != null || agreed?.committed_video_count != null;
  const amount = live ? agreed!.committed_amount : offer.reward_amount;
  const videoCount = live ? agreed!.committed_video_count : offer.video_count;
  const currency = live ? agreed!.currency : offer.currency;
  const perVideo = perVideoOf(amount, videoCount);

  const liveBriefs = briefs ?? [];
  const liveProducts = products ?? [];

  return (
    <div className={cn('flex flex-col gap-3.5', className)}>
      {/* ------------------------------------------------- the money -- */}
      {showMoney ? (
        <Block title={live ? 'What was agreed with you' : 'What this pays'}>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
            <Fact
              label={live ? 'Agreed fee' : 'Fee'}
              value={formatAmount(amount, currency)}
              big
            />
            {/*
            NULL IS NOT ZERO, AND IT IS NOT A DASH EITHER.
            `video_count` is nullable because an offer can have no fixed
            deliverable at all, so a missing number is a figure we do not hold
            rather than a count of none. `NOT_REPORTED` is the house word for
            that, and the line under this grid says what it means here.
          */}
            <Fact
              label="Videos"
              value={videoCount === null ? NOT_REPORTED : String(videoCount)}
              muted={videoCount === null}
            />
            <Fact
              label="Per video"
              value={perVideo === null ? NOT_REPORTED : formatAmount(perVideo, currency)}
              muted={perVideo === null}
            />
          </dl>


          {/*
          A PER-OFFER COMMISSION RATE DOES NOT EXIST, so this panel never prints
          one. `brand_products.commission_rate` is real and creator facing, but
          it belongs to a PRODUCT, and a product belongs to a BRAND rather than
          to an offer. The products section below shows it as what it is — the
          brand's catalogue rate — and nothing here adds it to the fee.
        */}
        </Block>
      ) : null}

      {/* ------------------------------------------------ how it is paid -- */}
      <Block title="How you get paid">
        <ol className="flex flex-col gap-1.5">
          {OFFER_STAGES.map((stage, i) => (
            <li key={stage} className="flex items-baseline gap-2">
              <span className="text-faint wx-numeric w-[1.25rem] shrink-0 text-[0.6875rem] font-semibold">
                {i + 1}.
              </span>
              <span className="text-text text-[0.8125rem] font-medium">
                {STAGE_META[stage].label}
              </span>
              <span className="text-muted min-w-0 text-[0.75rem]">
                {STAGE_META[stage].short}
              </span>
            </li>
          ))}
        </ol>
        {/*
          SAID PLAINLY RATHER THAN DRAWN AS AN EMPTY FIELD. There is no payment
          method column, no payout date and no invoice flow in the schema — the
          seven stages above are the entire payment timeline we hold. A row
          labelled "Payment method" with nothing in it would imply we have one
          on file.
        */}
      </Block>

      {/* --------------------------------------------------- the brief -- */}
      {offer.description ? (
        <Block title="What this involves">
          <p className="text-muted text-[0.875rem] leading-relaxed whitespace-pre-line">
            <Linkify text={offer.description} />
          </p>
        </Block>
      ) : null}

      {/* ----------------------------------------- the brand's briefs -- */}
      {liveBriefs.length > 0 ? (
        <Block
          title={liveBriefs.length === 1 ? 'The brief' : 'The briefs'}
        >
          <div className="flex flex-col gap-3">
            {liveBriefs.map((brief) => (
              <div
                key={brief.id}
                className="border-line border-t pt-3 first:border-t-0 first:pt-0"
              >
                <h4 className="text-text text-[0.875rem] font-semibold">{brief.title}</h4>
                {brief.what_to_make ? (
                  <p className="text-muted mt-1.5 text-[0.8125rem] leading-relaxed whitespace-pre-line">
                    <Linkify text={brief.what_to_make} />
                  </p>
                ) : null}

                <Lines
                  title="Hooks to try"
                  lines={brief.hooks}
                  icon={<Lightbulb size={13} aria-hidden />}
                  tone="text-muted"
                />
                <Lines
                  title="Do"
                  lines={brief.dos}
                  icon={<Check size={13} aria-hidden />}
                  tone="text-stage-paid"
                />
                <Lines
                  title="Do not"
                  lines={brief.donts}
                  icon={<X size={13} aria-hidden />}
                  tone="text-danger"
                />
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {/* ------------------------------------------------- the products -- */}
      {liveProducts.length > 0 ? (
        <Block
          title="What they sell"
        >
          <ul className="flex flex-col gap-2">
            {liveProducts.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="wx-neo-inset grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg"
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-text block truncate text-[0.8125rem] font-medium">
                    {p.name}
                  </span>
                  <span className="text-faint block text-[0.6875rem]">
                    {p.price === null ? NOT_REPORTED : money(p.price, p.currency)}
                  </span>
                </span>
                {p.commission_rate !== null ? (
                  <span className="text-muted wx-numeric shrink-0 text-[0.75rem] font-semibold">
                    {percent(p.commission_rate)} commission
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {/*
            NO PRODUCT LINK, AND THAT IS A SCHEMA GAP RATHER THAN AN OVERSIGHT.
            `brand_products` carries `external_product_id` — the product's id on
            TikTok Shop — and no URL column. Building a shop link out of that id
            would be guessing at somebody else's URL scheme and shipping a
            creator a dead tap. A `product_url` column is the fix; it is named in
            the report rather than invented here.
          */}
        </Block>
      ) : null}
    </div>
  );
}

/** One headed well inside the panel. `wx-neo-inset`, never another blur. */
function Block({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="wx-neo-inset rounded-xl p-3">
      <h3 className="text-faint text-[0.625rem] font-bold tracking-[0.14em] uppercase">
        {title}
      </h3>
      {note ? <p className="text-faint mt-1 text-[0.6875rem] leading-relaxed">{note}</p> : null}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** One labelled figure. The label is the `dt`, so it is read with its value. */
function Fact({
  label,
  value,
  big = false,
  muted = false,
}: {
  label: string;
  value: string;
  big?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-faint text-[0.625rem] font-semibold tracking-[0.1em] uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'font-display wx-numeric mt-0.5 font-bold break-words',
          big ? 'text-[1.125rem] leading-tight' : 'text-[0.9375rem] leading-tight',
          muted ? 'text-faint text-[0.8125rem] font-semibold' : 'text-text'
        )}
        style={
          big && !muted ? { color: 'var(--wx-brand-accent-ink, var(--wx-accent))' } : undefined
        }
      >
        {value}
      </dd>
    </div>
  );
}

/** One of a brief's three short lists. Nothing is drawn for an empty one. */
function Lines({
  title,
  lines,
  icon,
  tone,
}: {
  title: string;
  lines: string[];
  icon: ReactNode;
  tone: string;
}) {
  if (lines.length === 0) return null;

  return (
    <div className="mt-2.5">
      <p className="text-faint text-[0.625rem] font-semibold tracking-[0.1em] uppercase">
        {title}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {lines.map((line, i) => (
          <li key={`${i}-${line.slice(0, 12)}`} className="flex items-start gap-2">
            <span aria-hidden className={cn('mt-[0.1875rem] shrink-0', tone)}>
              {icon}
            </span>
            <span className="text-muted min-w-0 text-[0.8125rem] leading-relaxed">
              <Linkify text={line} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
