import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * A CARD WITH DEPTH.
 *
 * Rashid asked for a 3D effect on the cards. Neomorphism already implies a
 * light source and a surface, so depth is a continuation of the material rather
 * than a new idea bolted onto it — but it is also the easiest thing on the list
 * to make look cheap, so most of what follows is constraint rather than
 * technique. See docs/archive/UI_NEXT.md §3.
 *
 * ── THE THREE LAYERS ─────────────────────────────────────────────────────────
 *
 * 1. TILT. The card rotates towards the pointer, capped at 6 degrees. Past
 *    roughly 8 the text edges blur on a non-retina screen and it stops reading
 *    as a surface and starts reading as a trick.
 *
 * 2. PARALLAX. Anything wrapped in `<TiltLift>` rises on `translateZ`, so the
 *    figure floats above its own card. THIS is the layer that actually reads as
 *    three-dimensional. Tilt on its own mostly reads as wobble, and shipping
 *    only tilt is the usual reason these effects look bad.
 *
 * 3. THE MOVING HIGHLIGHT. A soft spot that follows the pointer. Not decoration:
 *    a card that tilts while its lit edge stays put looks wrong in a way people
 *    notice immediately without being able to name it.
 *
 * ── WHY THERE IS NO REACT STATE IN HERE ──────────────────────────────────────
 *
 * A `pointermove` handler that calls `setState` re-renders the subtree on every
 * frame of every mouse movement, and on a dashboard that subtree holds live
 * figures. The handler writes CSS custom properties straight onto the node
 * instead, so React renders this component exactly once and the browser
 * composites the rest. Reads are batched into one `requestAnimationFrame`, so a
 * burst of pointer events costs one write, not twenty.
 *
 * Only `transform` and `opacity` animate — both composited. Animating
 * `box-shadow` per frame is a paint, and twenty cards doing it drops frames on
 * the mid-range Android this audience actually holds.
 *
 * ── WHEN IT DOES NOT RUN AT ALL ──────────────────────────────────────────────
 *
 * - `prefers-reduced-motion`: off entirely, not reduced. A tilting card is
 *   precisely what that setting exists to stop.
 * - Coarse pointers: there is no cursor on a phone, and most of this audience is
 *   on one. Touch gets press-depth from `wx-neo-press` instead, which is real
 *   feedback rather than an effect nobody can trigger.
 *
 * In both cases the listener is never attached, so there is no idle cost.
 */

/** Degrees of rotation at the very edge of the card. */
const MAX_TILT = 6;

export function TiltCard({
  children,
  className,
  as: Tag = 'div',
  lift = MAX_TILT,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** `section`, `li`, `article`, `form` — whatever the markup needs. */
  as?: 'div' | 'section' | 'article' | 'li' | 'form';
  /**
   * Override the tilt ceiling. 0 disables tilt but keeps the highlight.
   *
   * TURN THIS DOWN ON ANYTHING YOU CLICK INTO. Tilt moves the card's edges, so
   * on a form it moves the inputs you are aiming at — at the default 6 degrees
   * a wide card's edge travels about 26px, which is enough to make a field
   * slide out from under the cursor. Around 2 keeps the material feeling alive
   * while leaving the targets where the eye put them.
   */
  lift?: number;
  /* Everything else goes straight to the element. Without this the component
     could only ever be a decorative box: a `form` needs its `onSubmit`, a
     `section` its `aria-label`, and wrapping them in an extra div to get those
     back would mean two nested cards.
     Typed from `form` because its props are a superset here — every global HTML
     attribute plus the form-specific ones — so a `div` or `li` caller still
     typechecks for anything it could legitimately pass. */
} & Omit<ComponentPropsWithoutRef<'form'>, 'className' | 'children'>) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);
  const Component = Tag as ElementType;

  const settle = useRef<number>(0);

  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--tilt-glow', '0');

    /*
     * THE FLAG OUTLIVES THE POINTER, ON PURPOSE.
     *
     * `data-tilt` is what puts the 3D transform on the element, and the
     * transform is what costs the card its text sharpness on a non-retina
     * screen (see `wx-tilt` in global.css). So it has to come off — but not
     * immediately, or the card would snap flat instead of settling back, since
     * the transition needs the transform present to animate.
     *
     * It is dropped once the 320ms settle has run. The timer is cleared on
     * re-entry so a pointer sweeping back and forth never strips the transform
     * mid-tilt.
     */
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      el.removeAttribute('data-tilt');
    }, 340);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* Asked once, before anything is attached. */
    const quiet = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const coarse = !window.matchMedia?.('(pointer: fine)').matches;
    if (quiet || coarse) return;

    const onMove = (e: PointerEvent) => {
      /* Cancel any pending flag removal and mark the card live, so the
         transform exists for as long as it is being used and no longer. */
      window.clearTimeout(settle.current);
      el.setAttribute('data-tilt', 'on');
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        /* `getBoundingClientRect` is a layout read, so it happens inside the
           frame callback with the writes, never interleaved with them. */
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const px = (e.clientX - r.left) / r.width; /* 0 at left, 1 at right */
        const py = (e.clientY - r.top) / r.height;

        /* Y rotation follows the X axis and vice versa — that is what makes the
           card appear to lean towards the cursor rather than away from it. */
        el.style.setProperty('--tilt-y', `${(px - 0.5) * 2 * lift}deg`);
        el.style.setProperty('--tilt-x', `${(0.5 - py) * 2 * lift}deg`);
        el.style.setProperty('--tilt-mx', `${px * 100}%`);
        el.style.setProperty('--tilt-my', `${py * 100}%`);
        el.style.setProperty('--tilt-glow', '1');
      });
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', reset);
    /* A card can be scrolled out from under a still cursor, which fires no
       pointer event at all and would leave it tilted for good. */
    el.addEventListener('pointercancel', reset);
    return () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settle.current);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', reset);
      el.removeEventListener('pointercancel', reset);
    };
  }, [lift, reset]);

  return (
    /* `ElementType` rather than the literal union: a polymorphic tag cannot be
       narrowed to one element's handler types without TypeScript insisting
       every handler is a div's. The union above still constrains CALLERS. */
    <Component ref={ref as never} className={cn('wx-tilt', className)} {...rest}>
      {children}
    </Component>
  );
}

/**
 * Raises its children above the card's own surface.
 *
 * Put the figure in one of these, not the whole card body: long copy on a
 * lifted plane is harder to read, and lifting everything defeats the parallax,
 * which only exists because the layers move at different rates.
 */
export function TiltLift({
  children,
  depth = 20,
  className,
}: {
  children: ReactNode;
  /** Pixels towards the viewer. 12–28 is the useful range. */
  depth?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('wx-tilt-lift', className)}
      style={{ '--tilt-depth': `${depth}px` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
