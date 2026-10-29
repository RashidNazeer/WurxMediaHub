import { useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { FormError } from '@/components/auth/AuthShell';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { collectFieldErrors } from '@/lib/schemas/brand';
import {
  offerApplicationSchema,
  type OfferApplicationInput,
} from '@/lib/schemas/offer-application';
import { money } from '@/lib/money';
import { OfferDetails } from '@/components/creator/earn/OfferDetails';
import { formatAmount, perVideoOf } from '@/components/creator/earn/offer-money';
import { useApplyForOffer } from '@/lib/creator/useOfferApplications';
import type { CreatorOffer } from '@/lib/creator/useCreatorBrands';

/**
 * Asking for an offer.
 *
 * A creator takes the deal on the table. There is nothing to negotiate here,
 * so this restates exactly what they are asking for and gives them one place to
 * say something alongside it.
 *
 * The confirmation step earns its keep even with nothing to fill in: this is a
 * commitment about money, and a single unguarded click is how somebody ends up
 * on a deal they were only reading about.
 *
 * WHAT CHANGED, 2026-10-16. Two reviewers: "creators should have access to
 * complete campaign details before applying". This dialog IS before applying,
 * and it carried one sentence of terms and the offer's description. It now
 * carries everything we actually hold — the payment path, the brand's brief,
 * its hooks and do's and don'ts, and its products — through
 * `earn/OfferDetails`, which also documents the fields the schema does not
 * have and therefore does not draw.
 *
 * ITS OWN TERMS LINE STAYS, and the detail panel below is told not to repeat
 * the fee (`showMoney={false}`). What she is agreeing to belongs in one
 * sentence directly above the button; the same figure again further down is
 * how somebody starts counting it twice.
 */
export function ApplyDialog({
  offer,
  brandName,
  onClose,
}: {
  offer: CreatorOffer;
  brandName: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { initialSelector: 'textarea' });

  const [values, setValues] = useState<OfferApplicationInput>({ note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const apply = useApplyForOffer();
  const busy = apply.isPending;

  /*
   * ESCAPE CLOSES IT, AND THAT IS WHY THERE IS NO LONGER A "Cancel" BUTTON.
   *
   * Rashid, 2026-10-16: "ditch the buttons where you can for easier
   * usability". This footer carried two buttons where only one of them was a
   * decision — Send request. Cancel was the third way out of a dialog that
   * already closes on the X in the corner and on a tap outside it, and on a
   * phone it sat directly beside the submit button, which is how somebody
   * cancels the thing they meant to send.
   *
   * It could only go once Escape worked, because the X is a 2.75rem target in
   * a corner and a scrim tap is a mouse gesture: a keyboard user was relying
   * on Cancel. `useFocusTrap` handles Tab only, deliberately, so the key goes
   * here where the thing being closed is.
   *
   * NOT WHILE THE REQUEST IS IN FLIGHT. Escape during a submit would close the
   * dialog over a mutation she cannot then see the result of.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const hasTerms = offer.video_count !== null && offer.reward_amount !== null;
  const perVideo = perVideoOf(offer.reward_amount, offer.video_count);

  const set = (note: string) => {
    const next = { note };
    setValues(next);
    if (submitted) setErrors(collectFieldErrors(offerApplicationSchema, next));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const next = collectFieldErrors(offerApplicationSchema, values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const parsed = offerApplicationSchema.parse(values);
    apply.mutate(
      { action: 'application.create', offerId: offer.id, note: parsed.note || null },
      { onSuccess: onClose }
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Apply for ${offer.title}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => !busy && onClose()}
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      <m.div
        ref={panelRef}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="wx-neo-raised relative max-h-[100dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-6 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">{offer.title}</h2>
            <p className="text-muted mt-1 text-[0.875rem]">{brandName}</p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="text-muted hover:text-accent -mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-lg transition-colors"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <form onSubmit={submit} noValidate className="mt-6">
          <FormError>{apply.error ? (apply.error as Error).message : ''}</FormError>

          {/*
            EXACTLY WHAT THEY ARE AGREEING TO, RESTATED.

            The two sentences in here are fixed points:
            `scripts/verify/creator/check-offer-requests.mjs` waits on "5 videos for $300" and
            on "confirm what this one involves". Changing either means changing
            that guard in the same commit.
          */}
          <div className="wx-neo-inset rounded-xl px-4 py-3.5">
            {hasTerms ? (
              <>
                <span className="text-faint font-mono text-[0.625rem] tracking-[0.14em] uppercase">
                  You would be asking for
                </span>
                <span className="wx-numeric mt-1 block text-[0.9375rem] font-semibold">
                  {offer.video_count} {offer.video_count === 1 ? 'video' : 'videos'} for{' '}
                  <span className="text-accent">
                    {money(offer.reward_amount, offer.currency)}
                  </span>
                </span>
                {/* THE RATE SHE IS REALLY COMPARING. The admin queue has
                    printed "$60 each" since August; the creator side made her
                    do the division in her head on the one screen where the
                    number decides whether she says yes. */}
                {perVideo !== null ? (
                  <span className="text-muted wx-numeric mt-0.5 block text-[0.75rem]">
                    {formatAmount(perVideo, offer.currency)} per video
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted text-[0.875rem] leading-relaxed">
                Terms to be confirmed by the team.
              </span>
            )}
          </div>

          {/*
            EVERYTHING ELSE WE HOLD, open, not behind a second disclosure. She
            is deciding right now, so the brief, the guidelines and the payment
            path are on screen rather than one tap away. The dialog already
            scrolls (`overflow-y-auto` on the panel above) and is a bottom
            sheet on a phone.
          */}
          <div className="mt-4">
            <OfferDetails offer={offer} brandName={brandName} loadBrand showMoney={false} />
          </div>

          <div className="mt-5">
            <Field
              label="Anything to add"
              error={errors.note}
              /* Says that a pasted link works, because it now does: anything
                 starting http:// or https:// comes back as a live link on your
                 own card. See `earn/Linkify.tsx`. */
              hint="Optional."
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  name="note"
                  maxLength={1000}
                  rows={3}
                  placeholder="e.g. I already use this product, so I can post within a week."
                  value={values.note}
                  disabled={busy}
                  onChange={(e) => set(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>
          </div>

          {/*
            ONE BUTTON. The only decision on this screen is whether to ask, so
            that is the only button on it. Getting out is the X above, a tap
            outside, or Escape — three ways, none of them sitting a thumb's
            width from Send.
          */}
          <div className="mt-7">
            <Button type="submit" disabled={busy} className="w-full sm:w-auto">
              {busy ? 'Sending...' : 'Send request'}
            </Button>
          </div>
        </form>
      </m.div>
    </div>
  );
}
