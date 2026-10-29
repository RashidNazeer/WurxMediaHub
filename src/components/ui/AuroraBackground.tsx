import { cn } from '@/lib/utils';
import { WavesField } from '@/components/ui/WavesField';

/**
 * THE GROUND, EVERYWHERE — the CSS aurora field, with Vanta WAVES over it.
 *
 * VANTA WAVES, 2026-10-16. Rashid asked for his `VANTA.WAVES` snippet as the
 * app-wide background. It is added HERE, in this one file, because this is the
 * seam: `HaloBackdrop` delegates to this component and five places mount it —
 * `AuthShell`, `AppShell`, `SitePage`, `Apply` and `Landing` — so the swap is
 * one edit and none of those five changed.
 *
 * IT IS A SECOND LAYER, NOT A REPLACEMENT. The CSS aurora below still renders
 * on every device, every time. `WavesField` mounts a transparent GL canvas
 * over it and only when the device can afford it, so the aurora is the ground
 * and the waves are the upgrade — not a fallback that appears after something
 * fails. Nothing can flash and nothing can end up blank, and the page is
 * finished before three.js has downloaded a byte. `WavesField.tsx` has the
 * full list of conditions that leave the aurora alone; the short version is
 * reduced motion, Save-Data, a low-end device, no WebGL, or a phone.
 *
 * ── THE AURORA ITSELF, unchanged ───────────────────────────────────────────
 *
 * Adapted from the 21st.dev `aurora-background`, not copied. Four things in
 * the original cannot ship here, and each one is a rule this codebase already
 * enforces with a guard:
 *
 * 1. IT IS A BACKDROP, NOT A WRAPPER. The original wraps `children` in a
 *    `<main>` that also holds the filtered layer. Here the filtered layer must
 *    never be an ANCESTOR of page content: `filter` creates a containing block
 *    for every `position: fixed` descendant, which is what put the Paid
 *    Collabs modals 3,413px down the page three times. `docs/guides/GLASS_PLAN.md` §1.2,
 *    asserted by `scripts/verify/design/check-backdrop-ancestry.mjs`. So this renders a
 *    sibling layer and takes no children at all, exactly as `HaloBackdrop`
 *    did.
 *
 * 2. IT ANIMATES `transform`, NOT `background-position`. The original moves
 *    `background-position` for 60s on a blurred, screen-sized element — a full
 *    repaint every frame of the most expensive thing on the page.
 *    `check-blur-budget.mjs` asserts that only `transform` and `opacity`
 *    animate (§4.3), so the drift is a `translate3d` on a wider-than-viewport
 *    field instead. Same movement, composited.
 *
 * 3. THE COLOURS ARE RASHID'S, NOT THE DEMO'S. The original hard-codes
 *    Tailwind blues and indigos through a `flattenColorPalette` plugin that
 *    needs `tailwind.config.js`; this project configures Tailwind v4 in CSS
 *    and has no such file. The gradients read `--wx-aurora-*`, which resolve
 *    to mint / sky / periwinkle per theme in `tokens.css`.
 *
 * 4. NO `framer-motion`. The project already runs `motion` under a strict
 *    `LazyMotion`, where a bare `motion.div` throws; nothing here needs a
 *    motion component anyway.
 *
 * `intensity` is kept from `HaloBackdrop` so the five mount sites did not have
 * to change: signed-in screens ask for `subtle`, public pages take the full
 * field.
 */
export function AuroraBackground({
  className,
  intensity = 'full',
}: {
  className?: string;
  intensity?: 'full' | 'subtle';
}) {
  return (
    /*
     * STILL NO `children`, and still a sibling of page content rather than an
     * ancestor of it. That is rule 1 above and it is what adding a WebGL
     * canvas here must not break: `WavesField` renders its own leaf `<div>`
     * inside this wrapper, beside `.wx-aurora-field`, and neither this wrapper
     * nor anything in it carries a `filter` or a `backdrop-filter`.
     */
    <div aria-hidden className={cn('overflow-hidden', className)}>
      <div className="wx-aurora-field" data-intensity={intensity} />
      <WavesField intensity={intensity} />
    </div>
  );
}
