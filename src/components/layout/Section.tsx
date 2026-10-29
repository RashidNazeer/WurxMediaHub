import { useEffect, useRef, type ReactNode } from 'react';
import {
  m,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { cn } from '@/lib/utils';

/** Page gutter + max width. Every section uses this so nothing drifts. */
export function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  // max-w-7xl (1280px): on a ~1280px viewport the content fills the width and
  // the awkward sliver of side margin disappears.
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-5 sm:px-8', className)}>{children}</div>
  );
}

/** Vertical rhythm for a page section. */
export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // scroll-mt clears the fixed header so anchor jumps don't hide the heading.
    /*
     * HALVED, 2026-10-16. Rashid, pointing at the band between the Platform
     * cards and the closing call to action: "decrease these type of extra
     * spacings as well in the landing page to around 50%".
     *
     * It was `py-20 sm:py-28` — 112px top AND bottom at desktop, 80px on a
     * phone. Three sections carry it, so every boundary between them stacked
     * 224px of nothing at 1440 and 160px at 375. Measured, which is why this
     * is a halving of the PADDING rather than a guess at the gap: 56px a side
     * leaves 112px between sections, still a clear break without the dead
     * band.
     */
    <section id={id} className={cn('scroll-mt-20 py-10 sm:py-14', className)}>
      <Container>{children}</Container>
    </section>
  );
}

/**
 * Small uppercase label above a section heading. Monospace and letter-spaced,
 * with a live accent dot, the one recurring motif across the marketing page.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted inline-flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
      <span className="bg-accent size-1.5 rounded-full" aria-hidden />
      {children}
    </span>
  );
}

/**
 * Fades content up as it scrolls into view. `once` so a section never
 * re-animates when the user scrolls back, that reads as jittery, not polished.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  depth,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  /** Opt in to scroll-driven depth instead of the one-shot fade. See `ScrollDepth`. */
  depth?: ScrollDepthOptions;
}) {
  const quiet = useReducedMotion();
  /* Reduced motion keeps the plain fade, which is the only thing it needs. */
  if (depth && !quiet) {
    return (
      <ScrollDepth {...depth} className={className}>
        {children}
      </ScrollDepth>
    );
  }
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </m.div>
  );
}

/* ============================================================================
   SCROLL DEPTH
   ============================================================================ */

interface ScrollDepthOptions {
  /** Pixels the block starts below its resting place. */
  rise?: number;
  /** Degrees it starts tipped back about its top edge (rotateX), settling to 0. */
  tilt?: number;
  /** Scale it starts at, settling to 1. */
  from?: number;
  /** Degrees it starts rolled about its centre (rotate), settling to 0. Alternate the sign across a row. */
  roll?: number;
  /** Where in the viewport (0 = top, 1 = bottom) it finishes settling. Lower is slower. Default 0.55. */
  settle?: number;
}

/**
 * A block that GAINS DEPTH AS IT ENTERS, driven by scroll position rather than
 * fired once on arrival.
 *
 * Progress runs from the block's top touching the bottom of the viewport to its
 * top reaching 55% of the way up. Over that span it rises into place, un-tips
 * from a slight `rotateX`, scales up to full size and fades in, all four tied to
 * the thumb, so scrolling back un-does it. It is `once`-less on purpose: a
 * parallax that only plays on the way down feels like a one-shot animation
 * rather than a surface you are moving past.
 *
 * WHY THESE FOUR AND NOTHING ELSE. They are `transform` and `opacity`, which
 * the compositor handles without touching layout or paint. `rotateX` is applied
 * with `transformPerspective`, which is a perspective baked into this one
 * element's own matrix, so a grid of these has one vanishing point per card
 * exactly like `TiltCard` does. There is NO `translateZ` here: under a
 * perspective that makes an element physically larger, and at rest this block
 * resolves to scale 1 with 0 rotation, so it is the size it was drawn at.
 *
 * Callers must not put this on an element that is also a `TiltCard`: both want
 * `transform`. Wrap the card instead, which is how `HowItWorks` uses it.
 *
 * Off entirely under `prefers-reduced-motion` (see `Reveal`, which is the only
 * thing that mounts this).
 */
function ScrollDepth({
  children,
  className,
  rise = 56,
  tilt = 14,
  from = 0.94,
  roll = 0,
  settle = 0.55,
}: ScrollDepthOptions & { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', `start ${settle}`],
  });
  const opacity = useTransform(scrollYProgress, [0, 0.55], [0, 1]);
  /* ONE transform string, and `none` once the block has arrived. A 3D transform
     promotes the element to its own compositing layer even when it resolves to
     identity, and a layer is rasterised once, so text inside goes soft on a
     non-retina screen. Nothing that is not moving may carry a transform. */
  const transform = useTransform(scrollYProgress, (p) => {
    if (p >= 0.999) return 'none';
    const t = 1 - p;
    /* SUB-PIXEL WHILE MOVING. This rounded `translateY` to whole pixels, which
       made every scroll-driven block advance in 1px steps — the judder Rashid
       reported. Rounding bought nothing here: the element already drops to
       `none` the instant it settles, so the rounding only ever applied while
       the block was in motion, which is precisely when a fractional offset is
       invisible and smoothness is the whole point. */
    return `perspective(1200px) translateY(${(rise * t).toFixed(2)}px) rotateX(${(tilt * t).toFixed(2)}deg) rotate(${(roll * t).toFixed(2)}deg) scale(${(1 - (1 - from) * t).toFixed(4)})`;
  });

  return (
    <m.div
      ref={ref}
      className={className}
      style={{ transform, opacity, transformOrigin: '50% 0%' }}
    >
      {children}
    </m.div>
  );
}

/**
 * Progress of a section through the viewport, for `ParallaxLayer`s to read.
 * `start start` to `end start` is "from the section's top at the top of the
 * screen until its bottom has left it", which is the span a hero is on screen.
 * Pass the other offsets for a section that begins lower down.
 */
export function useSectionScroll(
  offset: ['start start' | 'start end', 'end start' | 'end end'] = ['start end', 'end start']
) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset });
  return { ref, progress: scrollYProgress };
}

/**
 * A layer that moves at its own rate against the page: translate `from` px at
 * progress 0 to `to` px at progress 1. Layers given different ranges drift
 * relative to each other, which is the whole of parallax, and is what makes a
 * flat page read as stacked planes.
 *
 * It renders a plain `div` under `prefers-reduced-motion`: off, not slowed.
 * Vertical only. Horizontal travel is the classic cause of page-wide sideways
 * scroll, so this never offers it.
 */
export function ParallaxLayer({
  progress,
  from,
  to,
  scaleTo,
  rotateTo,
  className,
  children,
}: {
  progress: MotionValue<number>;
  from: number;
  to: number;
  /** Optional scale at progress 1 (starts at 1). */
  scaleTo?: number;
  /** Optional rotation in degrees at progress 1 (starts at 0). For glow discs, not for text. */
  rotateTo?: number;
  className?: string;
  children?: ReactNode;
}) {
  const quiet = useReducedMotion();
  /* Sub-pixel translation, and `none` at identity rather than an identity
     matrix. This rounded to whole pixels, which stepped the parallax 1px at a
     time and was a large part of the scroll judder: these layers travel
     hundreds of pixels, so the steps were obvious. See `ScrollDepth` above. */
  const transform = useTransform(progress, (p) => {
    const y = from + (to - from) * p;
    const s = 1 + ((scaleTo ?? 1) - 1) * p;
    const r = (rotateTo ?? 0) * p;
    /* A tolerance, not an equality test. `y` is a float now, so it lands on
       0.0001 rather than 0 and the identity case would never be recognised. */
    if (Math.abs(y) < 0.05 && Math.abs(s - 1) < 0.0005 && Math.abs(r) < 0.05) return 'none';
    return `translateY(${y.toFixed(2)}px) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
  });
  if (quiet) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} style={{ transform }}>
      {children}
    </m.div>
  );
}

/* ============================================================================
   HEADLINES THAT ASSEMBLE, NUMBERS THAT COUNT, A PAGE THAT KNOWS HOW FAR IT IS
   ============================================================================ */

/** Splits text into words, each keeping its trailing space so wrapping is unchanged. */
function wordsOf(text: string) {
  return text.split(' ').filter(Boolean);
}

/**
 * Splits a phrase into words for a parent `m.*` with `variants` to stagger on
 * load. Children use the `hidden`/`show` variant names, so they inherit the
 * parent's orchestration. Pass `quiet` to render plain text.
 */
export function LoadWords({
  text,
  className,
  quiet,
}: {
  text: string;
  className?: string;
  quiet?: boolean;
}) {
  if (quiet) return <span className={className}>{text}</span>;
  const words = wordsOf(text);
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <m.span
            className="inline-block"
            variants={{
              hidden: { opacity: 0, y: 40, rotate: i % 2 ? 5 : -5 },
              show: {
                opacity: 1,
                y: 0,
                rotate: 0,
                transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
              },
            }}
          >
            {w}
          </m.span>
          {i < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </span>
  );
}

/**
 * A figure that counts up to its real value when it scrolls into view, then
 * stops EXACTLY on it. The value is split into prefix / number / suffix
 * ("100M+", "1,000+") so the unit never changes while it counts.
 *
 * The final value is what React renders, so with scripts slow, with reduced
 * motion, or in a crawler it is the true figure. The animation only rewrites the
 * text node in place with rAF: no React state, no re-render per frame, and no
 * layout change because the box is centred and tabular.
 */
export function CountUp({
  value,
  className,
  duration = 1600,
  delay = 0,
}: {
  value: string;
  className?: string;
  duration?: number;
  delay?: number;
}) {
  const quiet = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' });
  const match = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(value);

  useEffect(() => {
    const node = ref.current?.firstChild;
    if (!match || !node) return;
    if (quiet) {
      node.nodeValue = value;
      return;
    }
    const prefix = match[1] ?? '';
    const numText = match[2] ?? '0';
    const suffix = match[3] ?? '';
    const target = Number(numText.replace(/,/g, ''));
    const decimals = numText.includes('.') ? (numText.split('.')[1] ?? '').length : 0;
    const grouped = numText.includes(',');
    /*
     * ONE FORMATTER, BUILT ONCE, NOT ONE PER FRAME.
     *
     * `Number.prototype.toLocaleString(locale, options)` constructs a fresh
     * `Intl.NumberFormat` on every call — building one is the expensive half
     * of formatting a number, and this was doing it inside a
     * `requestAnimationFrame` loop. Three counters animating for 1.6s is ~290
     * formatter constructions, and it showed: 182ms of scripting under 4x CPU
     * throttle, measured 2026-10-16, for work whose answer never changes.
     *
     * `Intl.NumberFormat` is the same API with the setup hoisted out of the
     * loop, so the per-frame cost is just `.format()`. Identical output: the
     * options are the ones that were being passed, and `toLocaleString`
     * delegates to this constructor anyway.
     */
    const nf = new Intl.NumberFormat('en-US', {
      useGrouping: grouped,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const fmt = (n: number) => `${prefix}${nf.format(n)}${suffix}`;
    if (!inView) {
      node.nodeValue = fmt(0);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(Math.max((now - t0) / duration, 0), 1);
      const eased = 1 - Math.pow(1 - p, 4);
      node.nodeValue = p >= 1 ? value : fmt(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `match` is derived from `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, quiet, value, duration, delay]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

/**
 * A hairline along the top of the viewport that fills with how far down the
 * page you are. It is the one element that belongs to no section, which is the
 * point: it carries across every boundary. `scaleX` only; absent under reduced
 * motion.
 */
export function PageProgress() {
  /*
   * THE SUBSCRIPTION IS INSIDE THE INNER COMPONENT, SO REDUCED MOTION NEVER
   * OPENS ONE.
   *
   * `useScroll()` was called here and the result thrown away one line later
   * when `quiet` was true — a hook cannot be called conditionally, so the only
   * way to skip the work is to move it behind a component that is not
   * rendered. Someone who has asked their operating system to stop animations
   * was still paying for a scroll listener feeding a motion value that drives
   * an element returning `null`.
   *
   * It is a small cost — a windowless `useScroll` reads `scrollY` and measures
   * nothing, and the 2026-10-17 profile put all of Motion at ~18ms across a 6s
   * scroll — so this is tidiness with a number attached rather than a fix for
   * the jank. The jank is paint; see the aurora findings.
   */
  const quiet = useReducedMotion();
  if (quiet) return null;
  return <PageProgressBar />;
}

function PageProgressBar() {
  const { scrollYProgress } = useScroll();
  return (
    <m.div
      aria-hidden
      /* Sky into periwinkle, the one ramp. It is `aria-hidden` decoration and
         conveys nothing a reader needs, which is what lets a 3px pastel bar be
         the right answer here: it reads strongly on the dark page and softly on
         the light one, and nothing is lost either way. */
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-left [background-image:linear-gradient(90deg,var(--wx-brand-sky)_0%,var(--wx-brand-peri)_100%)]"
      style={{ scaleX: scrollYProgress }}
    />
  );
}
