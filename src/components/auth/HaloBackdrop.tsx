import { AuroraBackground } from '@/components/ui/AuroraBackground';

/**
 * THE GROUND, BEHIND EVERYTHING.
 *
 * THE GLASSFOLD SHADER IS RETIRED, 2026-10-16. Rashid asked for the aurora
 * field "in my whole app" and to "drop the current one".
 *
 * `HaloBackdrop` is kept as the seam rather than deleted, and that is the
 * whole point of it: five places mount the ground — `AuthShell`, `AppShell`,
 * `SitePage`, `Apply` and `Landing` — so having one component for it means
 * changing the ground is one edit instead of five. None of those files
 * changed to make this swap.
 *
 * The old `GlassFold.tsx` component and its WebGL fragment shader have been
 * deleted; they remain in git history if the aurora is ever replaced again.
 *
 * `intensity` carries straight through: `subtle` behind a signed-in screen,
 * where there is real work on top of the ground, and `full` on the public
 * pages.
 */
export function HaloBackdrop({
  className,
  intensity = 'full',
}: {
  className?: string;
  /** `full` behind the auth pages, hero and `/apply`; `subtle` behind the app. */
  intensity?: 'full' | 'subtle';
}) {
  return <AuroraBackground className={className} intensity={intensity} />;
}
