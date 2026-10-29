import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router';
import { HaloBackdrop } from '@/components/auth/HaloBackdrop';
import { SiteNav } from '@/components/landing/SiteNav';
import { Hero } from '@/components/landing/Hero';
import { TrustedBy } from '@/components/landing/TrustedBy';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Platform } from '@/components/landing/Platform';
import { FinalCta } from '@/components/landing/FinalCta';
import { SiteFooter } from '@/components/landing/SiteFooter';
import { PageProgress } from '@/components/layout/Section';
import { RouteFallback } from '@/components/layout/RouteFallback';
import { useAuth, HOME_FOR_ROLE } from '@/lib/auth/auth-context';
import { allowIndexing } from '@/lib/seo';

/**
 * The public marketing page. Roadmap Step 2.
 *
 * Anyone already signed in is sent straight to their own home. The whole point
 * of this page is to persuade a stranger to apply, and someone who has already
 * applied should not have to find their own dashboard by typing a URL.
 *
 * Deliberately NOT applied to `/apply`. If a sign up succeeds but the
 * application insert does not, the dashboard sends people back there to finish,
 * and a redirect here would trap them in a loop.
 */
export function Landing() {
  const { status, claims } = useAuth();

  /**
   * Only redirect people who were ALREADY signed in when they opened this page.
   *
   * Not "whoever is signed in right now". Applying signs you up, so the moment
   * the account is created this component would otherwise fire a redirect while
   * the form is still writing the application row. The dashboard then mounts
   * early, asks whether there is an application, is truthfully told no, and
   * greets somebody who has just applied with "Finish your application".
   *
   * So: remember the first settled auth state and act on that. Someone who
   * signs in while on this page is mid-flow, and the form navigates them itself
   * once its work is actually done.
   */
  /* The front page of the public website, so search engines may have it — on
     the real site only, never on dev. */
  useEffect(() => allowIndexing(), []);

  const settled = useRef<'signedOut' | 'signedIn' | null>(null);
  if (settled.current === null && status !== 'loading') settled.current = status;

  // Still reading the stored session. Rendering the marketing page first would
  // show it for a moment and then yank it away, which reads as a glitch.
  if (status === 'loading') return <RouteFallback />;
  if (settled.current === 'signedIn' && status === 'signedIn' && claims) {
    return <Navigate to={HOME_FOR_ROLE[claims.role]} replace />;
  }

  return (
    <div /* NO `bg-bg` HERE. An opaque wrapper painted over the ground and the
       optical loops, so the background stopped at the hero. body paints the
       ground; this just needs height. */
    className="min-h-dvh">
      {/*
        THE BACKGROUND, MOUNTED ONCE AT THE PAGE ROOT.

        It used to live inside `Hero`, wrapped in a `ParallaxLayer`. That layer
        carries a `transform`, a transformed ancestor becomes the containing
        block for `position: fixed`, and Hero is `relative overflow-hidden` — so
        the backdrop was clipped to the hero's own box and the landing page had a
        hard horizontal seam partway down it, background above and bare
        `--wx-bg` below. Rashid: "you see this layer creating difference? It must
        not exist."

        THIS DIV IS THE RIGHT HOST BECAUSE IT IS PLAIN. No `transform`, no
        `filter`, no `contain`, no clip — nothing between it and the viewport.
        Keep it that way: the same property that would clip this backdrop is the
        one the fence law in `docs/guides/GLASS_PLAN.md` §1.2 forbids above
        `.wurxbase-root`, for the same underlying reason.

        Note it is OUTSIDE `<main class="overflow-x-clip">` as well. `clip` on
        that element would do to a fixed child exactly what the hero's
        `overflow-hidden` did.
      */}
      <HaloBackdrop className="pointer-events-none fixed inset-0 -z-10" />
      <PageProgress />
      <SiteNav />
      {/* `overflow-x-clip` (not `hidden`, which would make <main> a scroll
          container): the scroll layers only ever move vertically, but a rotated
          card or an oversized glow disc must never be able to widen the page. */}
      <main className="overflow-x-clip">
        <Hero />
        <TrustedBy />
        <HowItWorks />
        <Platform />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
