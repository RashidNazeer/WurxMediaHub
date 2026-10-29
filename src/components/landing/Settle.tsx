import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';

/*
 * THE LANDING PAGE'S REVEALS. TWO BUGS AND A COST, ALL IN ONE FILE.
 *
 * ── 1. THE DISAPPEARING TEXT ────────────────────────────────────────────────
 *
 * TWO REVIEWERS, THE SAME REPORT, INDEPENDENTLY: "there is a bug when
 * scrolling up and down the landing page, causing the text to disappear."
 *
 * They are describing `ScrollDepth` and `ScrollWords` (since removed) in
 * `src/components/layout/Section.tsx`, which this file replaces for the
 * landing sections. Both drive OPACITY from a `useScroll` progress as a pure
 * function of where the page is — so the value is not an entrance at all, it
 * is a position readout. Scroll down and a heading assembles; scroll back up
 * by the same amount and it un-assembles, to opacity 0, WHILE IT IS STILL ON
 * SCREEN.
 *
 * Measured off the rendered page at localhost:5173 (headless Chromium, dark,
 * 1440x900), stepping the scroll in 120px increments down and then back up and
 * reading the effective opacity of every heading intersecting the viewport:
 *
 *   H2 "Three steps from application to ea..."   effective opacity 0.000, top 97% of viewport
 *   H2 "Most agencies show you a screensho..."   effective opacity 0.000, top 87%
 *   H2 "Find out what your videos are actu..."   effective opacity 0.000, top 98%
 *   P  "Every brand you work with gets its..."   effective opacity 0.207, top 100%
 *
 * Same at 390x844, and the screenshot of the upward pass shows the Platform
 * heading mid-sentence: three words solid, three faded, one rolled four
 * degrees off the baseline. After this change the same sweep reports ZERO
 * elements under 0.9 opacity on the upward pass, at both widths.
 *
 * ── 2. THE COST ─────────────────────────────────────────────────────────────
 *
 * Rashid: "optimise the home page the slide show and a few other stuff take
 * really long to load and gitters."
 *
 * A CPU profile of the landing page under 4x throttling puts `measure` inside
 * `motion`'s scroll machinery at 1081ms — the largest single entry that is not
 * idle or the VM itself. It is large because the page mounted roughly twenty
 * `useScroll` targets: sixteen reveals plus the section parallax. Every one of
 * them is geometry that has to be re-measured as the page moves.
 *
 * AN ENTRANCE DOES NOT NEED ANY OF THAT. Once the reveal is one-way — and it
 * has to be one-way, that is bug 1 — the scroll position is only ever being
 * used to answer "has this arrived yet". An `IntersectionObserver` answers
 * that off the main thread, once, and then disconnects. The motion itself is a
 * CSS transition on `transform` and `opacity`, which the compositor runs with
 * no JavaScript per frame at all.
 *
 * So: no motion values, no scroll subscription, no per-frame work, and a file
 * half the size. What is given up is the SCRUB — the old version tied the
 * depth to the thumb, and this plays it at its own speed on arrival. That is
 * the trade, and it is worth making: the scrub was only ever visible on the
 * way in, and it is what made the way out look broken.
 *
 * ── 3. WHY HERE AND NOT IN `Section.tsx` ────────────────────────────────────
 *
 * That module is shared with the signed-in app and the six website pages and
 * belongs to another owner. These are the landing sections' own reveals, so
 * they live beside the landing sections.
 *
 * Transform and opacity only, which is what `scripts/verify/design/check-blur-budget.mjs`
 * enforces, and off entirely under `prefers-reduced-motion`. Travel is written
 * in `rem`, not `px`, so it tracks the text-size setting like everything else.
 */

/** The one easing in the product, written out because this is plain CSS. */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * True once the element has first entered the viewport, and true for ever
 * after. The observer disconnects on the way out, so a settled block costs
 * nothing at all from then on.
 *
 * The bottom margin means a block has to be properly on screen rather than
 * one pixel over the edge, which is what stops an entrance playing where it
 * cannot be seen.
 */
function useArrived<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || arrived) return;
    /* No observer (very old browser, or a test harness): show the content.
       Never leave text at opacity 0 because a capability was missing. */
    if (typeof IntersectionObserver === 'undefined') {
      setArrived(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArrived(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [arrived]);

  return { ref, arrived };
}

/* ============================================================================
   HEADINGS THAT ASSEMBLE ONCE
   ============================================================================ */

/**
 * A heading whose words rise into place as it arrives, and then stay there.
 * Plain text under `prefers-reduced-motion`.
 *
 * NOT FOR `.text-brand-blend`. The gradient is painted on the wrapper and
 * clipped to its glyphs, and a transformed descendant paints into its own
 * layer in WebKit — so the clipped background never reaches the words while
 * `-webkit-text-fill-color: transparent` is inherited by them. That is the
 * invisible "Finally yours." on Rashid's phone, and it is why the hero line
 * passes `quiet` to `LoadWords`. The same rule holds here.
 */
export function SettleWords({ text, className }: { text: string; className?: string }) {
  const quiet = useReducedMotion();
  const { ref, arrived } = useArrived<HTMLSpanElement>();

  if (quiet) return <span className={className}>{text}</span>;

  const words = text.split(' ').filter(Boolean);
  return (
    <span ref={ref} className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <span
            className="inline-block"
            style={{
              /* The whole line is in by 0.6s + the last delay, and the delays
                 are capped so a fourteen-word heading does not take twice as
                 long to arrive as a seven-word one. */
              transform: arrived
                ? 'none'
                : `translateY(1.75rem) rotate(${i % 2 ? 3 : -3}deg)`,
              opacity: arrived ? 1 : 0,
              transition: `transform 0.7s ${EASE} ${Math.min(i * 0.055, 0.5)}s, opacity 0.5s ${EASE} ${Math.min(i * 0.055, 0.5)}s`,
              willChange: arrived ? undefined : 'transform, opacity',
            }}
          >
            {w}
          </span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </span>
  );
}

/* ============================================================================
   BLOCKS THAT GAIN DEPTH ONCE
   ============================================================================ */

interface SettleOptions {
  /** Rem the block starts below its resting place. */
  rise?: number;
  /** Degrees it starts tipped back about its top edge, settling to 0. */
  tilt?: number;
  /** Scale it starts at, settling to 1. */
  from?: number;
  /** Degrees it starts rolled about its centre. Alternate the sign across a row. */
  roll?: number;
  /** Seconds to wait before it starts, for staggering a row. */
  delay?: number;
}

/**
 * A block that rises, un-tips and fades in as the page reaches it — once.
 *
 * `rotateX` rides on the perspective baked into this element's own matrix, so
 * a grid of these has one vanishing point per card rather than a shared one.
 * No `translateZ`: under a perspective that makes a block physically larger,
 * and at rest this resolves to scale 1 at 0 degrees, which is the size it was
 * drawn at.
 *
 * Do not put this on an element that is also a `TiltCard` — both want
 * `transform`. Wrap the card, which is how every caller here uses it.
 *
 * The resting state is `transform: none`, not an identity matrix. A 3D
 * transform promotes the element to its own compositing layer even when it
 * resolves to identity, and a layer is rasterised once, so text inside goes
 * soft on a non-retina screen. `will-change` is dropped at the same moment,
 * for the same reason.
 */
export function SettleIn({
  children,
  className,
  rise = 3.5,
  tilt = 14,
  from = 0.94,
  roll = 0,
  delay = 0,
}: SettleOptions & { children: ReactNode; className?: string }) {
  const quiet = useReducedMotion();
  const { ref, arrived } = useArrived<HTMLDivElement>();

  if (quiet) return <div className={className}>{children}</div>;

  const style: CSSProperties = {
    transform: arrived
      ? 'none'
      : `perspective(75rem) translateY(${rise}rem) rotateX(${tilt}deg) rotate(${roll}deg) scale(${from})`,
    opacity: arrived ? 1 : 0,
    transformOrigin: '50% 0%',
    transition: `transform 0.75s ${EASE} ${delay}s, opacity 0.55s ${EASE} ${delay}s`,
    willChange: arrived ? undefined : 'transform, opacity',
  };

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
