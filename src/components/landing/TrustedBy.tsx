import { Container, CountUp } from '@/components/layout/Section';
import { SettleIn } from '@/components/landing/Settle';
import { TiltCard, TiltLift } from '@/components/ui/TiltCard';
import { TiltedGridHero } from '@/components/ui/TiltedGridHero';
import { BRANDS, STATS } from '@/content/site';

/*
 * HIS THREE, AS INK. THESE ARE ALREADY THE PALETTE.
 *
 * It reads like the violet/blue/teal the sweep was sent to remove and it is
 * not: `--wx-accent`, `--wx-info` and `--wx-success` are the DARKENED FORMS of
 * mint, sky and periwinkle, same hue angle, both themes:
 *
 *   #DEFCF9 mint  174deg  ->  --wx-success  #14b5a5 / #0c6c62   174deg
 *   #CADEFC sky   214deg  ->  --wx-info     #6fa3f1 / #145cc8   214-218deg
 *   #C3BEF0 peri  247deg  ->  --wx-accent   #9b93e6 / #5b4dd5   246-248deg
 *
 * MEASURED, AND THAT IS WHY THEY ARE NOT THE PASTELS. These went to
 * mint/sky/peri first — three 4px rules felt like the one place in the product
 * that wants all three swatches at once. Read back off the rendered page in the
 * light theme, against the raised card they sit on: mint 1.08:1, sky 1.37:1,
 * peri 1.76:1. A rule at 1.08:1 is not a faint rule, it is an absent one, and
 * two of the three figures lost their mark entirely.
 *
 * A 4px rule is a HAIRLINE, so the rule from the brief applies to it the way it
 * applies to a border, not the way it applies to a chart bar: a bar is read as
 * an area and a hairline is read as a line. The ink is his colour at a
 * lightness a line can actually be seen at.
 *
 * The ORDER is left exactly as it was — violet first, because it is the
 * interactive one. Nothing in the brief asks these three to run in palette
 * order; the fixed order it does ask for is the chart ramp in the Home chart,
 * where the position of a mark on the ramp is carrying meaning.
 */
const BARS = ['bg-accent', 'bg-info', 'bg-success'] as const;

/**
 * The brand roster, as the curved band wants it. `h` carries straight
 * through: it is the per-logo optical weighting the flat marquee used, and
 * the band still honours the ratio between the values.
 */
const BRAND_MARKS = BRANDS.map((brand) => ({
  src: brand.logo,
  alt: brand.name,
  h: brand.h,
}));

/** Social proof band: the brands we run, then the headline numbers. */
export function TrustedBy() {
  return (
    <section id="brands" className="scroll-mt-20">
      {/*
        THE PADDING IS HALVED HERE TOO, 2026-10-17 — same report as the hero
        above it, "extra gaps still need fixing".

        Measured at 1920 before the change, from the hero's chip row to the top
        of the first plaque: 214px of empty ground, made of the hero's 96px
        `pb-24`, this `py-9` (36), the label, this `pb-7` (28) and 22px of
        slack inside the band's own `h-64` (the plaques are centred on the
        band's axis and do not fill it). Only the last of those is structural —
        shrinking `h-64` would shrink the plaques, since `tileHeight` is a
        percentage of the band's height.

        So the three that are not structural come down: 36 -> 12 and 28 -> 16
        here, 96 -> 48 in the hero. The band now follows the hero instead of
        floating a screen's worth of nothing below it.
      */}
      {/* Full-bleed: the band runs edge to edge, not inside the container. */}
      <div className="py-3">
        <Container className="pb-4">
          <p className="text-faint text-center font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
            Trusted by creators &amp; brands worldwide
          </p>
        </Container>
        {/* The band is a size container, so its height has to be stated
            rather than left to the content. */}
        <TiltedGridHero images={BRAND_MARKS} className="h-52 w-full sm:h-60 lg:h-64" />
      </div>

      {/* And the same halving under the stat cards: `pb-16 sm:pb-20` was 80px
          at desktop, and the next section's `Section` adds its own 56px on top
          of it, so the boundary carried 136px. */}
      <Container className="pt-2 pb-8 sm:pb-10">
        {/* Three raised cards that rise out of the page one after another, each
            at its own distance, rather than one strip fading in. The figure
            floats above its own card on `TiltLift`, as on the step cards.
            `SettleIn`, not `Reveal depth` — the depth is the same, it just no
            longer un-happens when the page scrolls back past it. */}
        <ul className="grid gap-5 sm:grid-cols-3">
          {STATS.map((stat, i) => (
            <li key={stat.label}>
              <SettleIn
                rise={5.625 + i * 3.125}
                tilt={24}
                from={0.84}
                roll={(i - 1) * 5}
                delay={i * 0.09}
                className="h-full"
              >
                {/*
                  `wx-neo-raised-sm`, NOT `wx-neo-raised`, and every card on
                  the landing page and the six website pages changed with it.

                  Rashid: "optimise the home page ... take really long to load
                  and gitters." The cause is counted rather than guessed.
                  `global.css` says it in its own words on the `wx-neo-raised`
                  utility: "this puts roughly 14 of them back on the landing
                  page. If scrolling goes heavy again, this one declaration is
                  the cause and deleting it is the fix."

                  Scrolling went heavy again. Measured at 390x844: EIGHT
                  blurred layers painting at once, and THIRTEEN at 1440 — the
                  budget in docs/guides/GLASS_PLAN.md §4.3 is three, and the guard that
                  enforces it only ever samples the first viewport, which is
                  why it has been passing. The law the brief states is the same
                  one: a section is ONE blurred panel and the things inside it
                  use `-sm`. A grid of three stat cards is things inside.

                  So the blurred panels on this page are now the nav, the
                  closing call-to-action card and the footer. The cards keep
                  the fill, the rim, the edge and the lift — everything that
                  reads as the material — and give up only a blur that was
                  sitting behind an opaque-enough face.

                  The numbers are in `TiltedGridHero.tsx`, beside the other
                  half of the same fix.
                */}
                <TiltCard className="wx-neo-raised-sm h-full rounded-2xl px-6 py-9 text-center">
                  <span
                    className={`${BARS[i] ?? 'bg-accent'} mx-auto mb-6 block h-1 w-10 rounded-full`}
                    aria-hidden
                  />
                  <TiltLift depth={22}>
                    {/* Counts up to the real figure as the card arrives, each
                        a beat after the last. */}
                    <CountUp
                      value={stat.value}
                      delay={i * 180}
                      className="wx-lining font-brand block text-[clamp(2rem,5vw,3rem)] leading-none tracking-tight tabular-nums"
                    />
                  </TiltLift>
                  <span className="text-faint mt-3 block font-mono text-[0.6875rem] tracking-[0.16em] uppercase">
                    {stat.label}
                  </span>
                </TiltCard>
              </SettleIn>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
