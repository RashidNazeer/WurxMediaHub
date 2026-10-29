import { cva, type VariantProps } from 'class-variance-authority';
import { Link } from 'react-router';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * THE LIQUID-GLASS CONTROL. docs/guides/GLASS_PLAN.md §4.4, with §4.5's lit edge and §4.3's
 * blur budget.
 *
 * WHAT THE MATERIAL IS. Five layers, and none of them is a blur:
 *
 *   the TINT     an opaque-enough fill — the floor from §4.1, already computed
 *                into `--wx-glass-fill` for both faces. Dark mode tints toward
 *                surface-1, light mode toward white; they are inverses, not
 *                tints of each other.
 *   the HAIRLINE a 0.0625rem border in `--wx-glass-edge`, the one real edge.
 *   the HIGHLIGHT an inset line along the top and a fainter one along the
 *                bottom, so the face has a direction. `--wx-glass-inner` on the
 *                translucent variant; `--wx-solid-inner` on `primary`, because
 *                the accent fill is a dome rather than a pane and the glass
 *                token's inner glow would frost a 2.25rem pill edge to edge.
 *   the SEAT     `inset 0 0 0.125rem` of the same edge colour, which is what
 *                stops the fill reading as a flat swatch dropped on the page.
 *   the LIFT     `--wx-glass-lift` beneath it, `--wx-glass-lift-hover` on hover.
 *
 * ON TOP OF THAT, THE TWO LIT EDGES — the part that actually reads as glass:
 *
 *   ::before     a 0.0625rem rim across the top carrying `--wx-glass-rim-top`,
 *                which fades in and out so it never terminates in a hard dot.
 *                This is the same rim §4.5 gives `Surface`, so a button and a
 *                card agree about where the light is.
 *   ::after      the reference's 45° white gradient, blurred, so the rim catches
 *                light on two edges at once. It is written `135deg` rather than
 *                `45deg`: the diagonal is the same 45°, but 45deg in CSS starts
 *                at the BOTTOM left, and the light in this product is ABOVE AND
 *                LEFT — every neomorphic highlight, both rim tokens and §4.5's
 *                card all point that way. 135deg puts the bright end on the
 *                top-left arc and leaves `--wx-glass-line` as a shade on the
 *                bottom-right, which is what a lit edge and its far edge look
 *                like. It is blurred 0.09375rem, which is the whole difference
 *                between a light catch and a painted wedge.
 *
 * `--wx-glass-rim-left` is deliberately NOT drawn. These are `rounded-full`
 * pills, so the left edge is pure curve — a 1px vertical line at x=0 is clipped
 * by the radius down to a single dot. The ::after gradient lights the entire
 * top-left arc instead, from the same light source. On `Surface`, where the
 * radius is 20px and the left edge is mostly straight, the token earns its keep.
 *
 * NO `backdrop-filter`, ANYWHERE IN THIS FILE. §4.3: the budget is three blurred
 * layers on a phone — chrome, one surface, one overlay — and a toolbar of eight
 * buttons would spend eight. Buttons take the tint and the optical edge, blur
 * belongs to chrome and overlays, and `scripts/verify/design/check-blur-budget.mjs` fails the
 * run if that ever stops being true.
 */

/*
 * The optical edge, shared by the two solid variants so `primary` and
 * `secondary` can never drift apart. Only the fill differs between them.
 */
const EDGE = [
  // THE HAIRLINE. Written as an arbitrary property rather than `border` +
  // `border-[color]` so the width lands in rem and tailwind-merge treats the
  // whole edge as one thing a caller's `className` can override or leave alone.
  '[border:0.0625rem_solid_var(--wx-glass-edge)]',
  // A disabled control does not lift. It was `disabled:shadow-none` on the
  // neomorphic secondary and the reason has not changed. The HIGHLIGHT, SEAT
  // and LIFT live on each variant rather than here: two `[box-shadow:…]`
  // classes on one element would be two rules of equal specificity, and which
  // one wins would come down to the order Tailwind happened to emit them in.
  'disabled:[box-shadow:none]',

  // THE TOP RIM, §4.5. A hairline strip, not a border: a border cannot fade.
  "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[0.0625rem] before:content-['']",
  'before:[background-image:var(--wx-glass-rim-top)]',

  /*
   * THE 45° CATCH, §4.4.
   *
   * THE STOPS ARE LENGTHS, NOT PERCENTAGES, and that is a measured correction
   * rather than a style. At `14%` the white reached 43px along the diagonal of
   * a full-width button, which is PAST the 28px of left padding — so on the
   * 384px `Sign in` the catch washed the first glyphs and the worst pixel under
   * the label measured 4.03:1 in light mode, under AA. A percentage stop scales
   * with the button; the padding does not. At `1rem` the catch dies 16px along
   * the diagonal and the nearest glyph starts at 24px on the tightest size
   * (`sm`), so the label always sits on undiluted fill and §4.1's floor holds
   * for the text as well as the face. Verified off rendered pixels at all four
   * sizes, narrow and full-width, in both themes: every pixel under the label
   * is the fill itself, so the label's contrast is the token pair's and nothing
   * this component draws can erode it. A ratio is not quoted here on purpose —
   * the accent is also written at runtime by `brand-theme.ts`, so the number
   * belongs to the palette, not to the material.
   *
   * `pointer-events-none` because it covers the whole control.
   */
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']",
  'after:[background-image:linear-gradient(135deg,var(--wx-glass-edge)_0,transparent_1rem,transparent_calc(100%_-_1rem),var(--wx-glass-line)_100%)]',
  'after:[filter:blur(0.09375rem)]',

  /*
   * FORCED COLORS. Windows High Contrast discards `box-shadow` outright, so a
   * shadow-only control there is an invisible rectangle — §4.3 says the edge
   * must be a border in that mode, not a shadow. This variant already carries a
   * real border, so it only needs the system colour; `ButtonBorder` rather than
   * one of our tokens, because the whole point is to honour the colours the user
   * chose. Same keyword and same reasoning as the `forced-colors` block in
   * global.css. The two lit edges go: both are gradients, which forced-colors
   * does not recolour, so they would survive as stray coloured bars on a page
   * that is supposed to be two colours.
   */
  'forced-colors:[border-color:ButtonBorder] forced-colors:before:hidden forced-colors:after:hidden',
];

/**
 * The one button in the product. Every call to action goes through this so
 * hover, focus and disabled states can never drift between screens.
 */
const button = cva(
  [
    // `relative` for the two rim pseudo-elements. No z-index, so this creates
    // no stacking context and cannot reorder anything at the 68 call sites.
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    /*
     * NOT `transition-all`. Tailwind's `all` expands to every animatable
     * property, which silently includes `filter`, `backdrop-filter` and
     * `box-shadow` — the three things docs/guides/GLASS_PLAN.md §4.3 forbids animating,
     * because each one re-rasterises the element every frame rather than
     * riding the compositor. On a glass button that is the difference between
     * a hover and a stutter. The list is explicit so adding a shadow or a blur
     * to this component later cannot quietly opt it back in.
     *
     * `translate` AND `scale` ARE IN THE LIST BECAUSE TAILWIND 4 STOPPED
     * WRITING `transform`. `-translate-y-*` and `scale-*` now compile to the
     * individual `translate` and `scale` properties, which
     * `transition-property: transform` does not cover — measured here as a lift
     * that snapped instead of easing. They are the same thing to the
     * compositor, so this is still "transform and opacity only" (§4.3), spelled
     * the way the generated CSS spells it. `transform` stays for call sites
     * that pass one of their own.
     */
    'font-medium transition-[transform,translate,scale,opacity,background-color,border-color,color] duration-200 ease-brand',
    'disabled:pointer-events-none disabled:opacity-50',
    /*
     * FOCUS, AND WHY IT IS HEAVIER THAN IT LOOKS. Glass carries its shape in
     * shadow, and a shadow says nothing about which control has focus — so the
     * ring is the one place this component is allowed to shout. WCAG 1.4.11
     * binds here: a button is a user-interface component (it does NOT bind on
     * §4.5's decorative card rim, which is why that one may stay at 0.3 white).
     *
     * `--wx-accent` solid, not `--wx-accent-ring`: the ring token is the accent
     * at 45% alpha, which cannot be shown to clear 3:1 over a translucent face.
     * Solid accent measures 6.87:1 on the dark ground and 5.13:1 on the light
     * one (tokens.css), and the 0.125rem offset puts it on the page rather than
     * on the fill, so even `primary` — an accent button — gets an unmistakable
     * accent ring with a page-coloured gap inside it.
     *
     * An outline rather than a ring: `box-shadow` is already carrying four
     * layers of material here and focus must not have to share with them.
     */
    'focus-visible:[outline:0.1875rem_solid_var(--wx-accent)]',
    'focus-visible:[outline-offset:0.125rem]',
  ],
  {
    variants: {
      variant: {
        /*
         * THE ACCENT CARRIES THE LIGHT. Same optical edge as `secondary`, over
         * the accent fill instead of the glass tint, plus one extra shadow:
         * `--wx-accent-ring` as a cast underneath, so the primary action throws
         * a faint violet onto the page the way a lit object would. That is what
         * `wx-neo-accent` was for, in a material that does not need a dome.
         * `--wx-on-accent` is contrast-checked against the fill in tokens.css.
         */
        primary: [
          ...EDGE,
          // HIS COLOUR, LITERALLY. The fill is #C3BEF0 as given and the label is ink,
          // which is the only way a pastel carries text: the colour itself is
          // 1.76:1 on white, ink on it is 10.1:1.
          '[background:var(--wx-accent-fill)] [color:var(--wx-on-accent-fill)]',
          /*
           * THE BOUNDARY, AND IT IS AN ACCESSIBILITY FIX, NOT A FLOURISH.
           *
           * WCAG 1.4.11 wants 3:1 between a control and its background. This
           * fill is Rashid's #C3BEF0 and it measures 1.31:1 against the light
           * page — a pastel pill on pale paper has almost no shape, and the
           * glass hairline is white at 85%, which against that page adds
           * nothing. The fill is not negotiable, so the EDGE carries it: a
           * hairline in the accent ink, overriding the shared glass one.
           *
           * Dark overrides nothing of substance — the same pastel on #202024
           * is already 9.23:1 — so its token stays a faint white and the
           * contrast keeps coming from the fill.
           */
          '[border:0.0625rem_solid_var(--wx-accent-fill-edge)]',
          'hover:[background:var(--wx-accent-fill-hover)] active:[background:var(--wx-accent-fill-active)]',
          '[box-shadow:var(--wx-solid-inner),var(--wx-glass-lift),0_0.25rem_1rem_var(--wx-accent-ring)]',
          'hover:[box-shadow:var(--wx-solid-inner),var(--wx-glass-lift-hover),0_0.5rem_1.5rem_var(--wx-accent-ring)]',
        ],
        /*
         * THE GLASS ITSELF. The fill is the floor from §4.1 — 72% toward
         * surface-1 in the dark, 58% toward white in the light — which is what
         * makes the label's contrast provable over an aurora nobody can predict.
         *
         * `prefers-reduced-transparency` drops it to an opaque surface, as
         * §4.3 requires. There is no blur to drop, so the fill is the whole of
         * it. Tailwind has no built-in variant for that query yet, hence the
         * arbitrary one.
         */
        secondary: [
          ...EDGE,
          // HIGHLIGHT, SEAT, LIFT — one `box-shadow`, three jobs. The hover
          // state re-declares the whole stack because box-shadow is NEVER in
          // the transition list, so this is a hard swap by design: the lift
          // changes with the pointer, the geometry does not animate.
          '[box-shadow:var(--wx-glass-inner),inset_0_0_0.125rem_var(--wx-glass-edge),var(--wx-glass-lift)]',
          'hover:[box-shadow:var(--wx-glass-inner),inset_0_0_0.125rem_var(--wx-glass-edge),var(--wx-glass-lift-hover)]',
          '[background-color:var(--wx-glass-fill)] hover:[background-color:var(--wx-glass-fill-hover)]',
          'hover:text-accent',
          '[@media(prefers-reduced-transparency:reduce)]:bg-surface-1',
        ],
        /*
         * LIGHT-WEIGHT ON PURPOSE. No fill, no edge, no lift, no pseudo-rims —
         * a row of ghost actions must not read as a row of buttons. It gains a
         * hint of the glass tint on hover so a pointer is still answered, and a
         * real border under forced-colors because there it has nothing else.
         */
        ghost: [
          'text-muted hover:text-accent',
          'hover:[background-color:var(--wx-glass-fill)]',
          'active:[background-color:var(--wx-glass-well)]',
          'forced-colors:[border:0.0625rem_solid_ButtonBorder]',
        ],
        // Lighter still: text, and the underline it earns on hover. Offset in
        // rem like every other length in this file.
        link: 'text-accent underline-offset-[0.25rem] hover:underline forced-colors:underline',
      },
      // PILLS, AT EVERY SIZE. The brand kit: "Buttons, tags and chart bars are
      // full pills." One shape for all four sizes, matching the round icon
      // buttons beside them in the top bar. The heights are Tailwind's rem
      // scale (2.25 / 2.75 / 3.25 / 3.75rem), so they track the text-size
      // control instead of pinning to physical pixels — §3.
      //
      // `pointer-coarse:h-11` is the 44px tap floor and the ONE sanctioned px
      // in the material: 2.75rem is exactly 44px at the default root size, and
      // a finger does not scale with a type setting.
      size: {
        sm: 'h-9 pointer-coarse:h-11 rounded-full px-4 text-[0.8125rem]',
        md: 'h-11 rounded-full px-5 text-sm',
        lg: 'h-13 rounded-full px-7 text-[0.9375rem]',
        xl: 'h-15 rounded-full px-9 text-base font-semibold',
      },
    },
    /*
     * REDUCED MOTION, HANDLED ONCE. The press and the hover lift are the only
     * transforms in the component and they are both behind `motion-safe`, which
     * is `prefers-reduced-motion: no-preference` — so for anybody who has asked
     * the OS for less motion the geometry simply never moves. Transform and
     * opacity only, never blur, never box-shadow, never width or height (§4.3).
     * `link` is excluded: nudging a text link is noise.
     */
    compoundVariants: [
      {
        variant: ['primary', 'secondary', 'ghost'],
        class: 'motion-safe:hover:-translate-y-[0.0625rem] motion-safe:active:scale-[0.98]',
      },
    ],
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

type ButtonVariants = VariantProps<typeof button>;

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<'button'> & ButtonVariants) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

/** Same look, but renders a router link (or an <a> for external URLs). */
export function ButtonLink({
  to,
  className,
  variant,
  size,
  external,
  children,
  ...props
}: {
  to: string;
  external?: boolean;
  children: ReactNode;
  className?: string;
} & ButtonVariants &
  Omit<ComponentProps<'a'>, 'href' | 'className' | 'children'>) {
  const classes = cn(button({ variant, size }), className);

  if (external) {
    return (
      <a href={to} target="_blank" rel="noreferrer noopener" className={classes} {...props}>
        {children}
      </a>
    );
  }

  // Same-page anchors must NOT go through the router, <Link to="#how"> is
  // treated as a route change and never scrolls.
  if (to.startsWith('#')) {
    return (
      <a href={to} className={classes} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link to={to} className={classes} {...props}>
      {children}
    </Link>
  );
}
