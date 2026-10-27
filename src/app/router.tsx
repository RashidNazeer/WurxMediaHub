import { lazy } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import { RouteFallback } from '@/components/layout/RouteFallback';
import { RequireAuth, RedirectIfSignedIn } from '@/components/auth/RequireAuth';
import { COLLABS_ONLY_ROLES, STAFF_ROLES } from '@/lib/auth/auth-context';

/**
 * Route table.
 *
 * THE SIGNED-IN SHELL IS LAZY, 2026-10-16, and this is worth more than it
 * looks. `ShellLayout` was imported STATICALLY here, which put the whole
 * dashboard chrome — `AppShell`, `AppSidebar`, `MobileNav`, the notification
 * bell, `nav.ts`, gsap — into the ENTRY chunk, so every visitor to the
 * marketing page downloaded and evaluated about 30KB gzipped of signed-in UI
 * they could not see. Worse, it was the only reason the Supabase client and
 * Zod were on the critical path at all: the chain ran router -> ShellLayout
 * -> AppSidebar -> useWurxbaseIdentity -> supabase. Measured: 241KB of eager
 * JS before, 164KB after that chain was cut, and this line was its root.
 *
 * It uses route-level `lazy` rather than `React.lazy`, deliberately: React
 * Router awaits the module before it commits the route, so no Suspense
 * boundary is needed above a LAYOUT route, which is exactly where a missing
 * one would be hardest to see.
 *
 * Every screen is lazy so it ships as its own chunk: a creator opening the
 * landing page should never download the admin dashboard. `HydrateFallback`
 * renders the skeleton while a chunk is in flight, never a bare spinner.
 *
 * Role lists on the guards decide WHICH SCREEN to show. They are not the
 * security boundary. Every query underneath is still filtered by row level
 * security, so a tampered token buys an empty page and nothing else.
 */
/**
 * Load a screen, and survive the deploy that happened while the tab was open.
 *
 * THE FAILURE, seen on dev on 2026-08-13 after nine deploys in an evening:
 *
 *   Unexpected Application Error!
 *   Failed to fetch dynamically imported module: /assets/Dashboard-LYjx_st3.js
 *
 * Every screen here is its own file with a content hash in its name, so a
 * deploy renames all of them. A tab opened before that deploy still holds the
 * old index, and the moment it needs a screen it has not downloaded yet it asks
 * for a filename that no longer exists on the CDN. Signing in and signing out
 * are exactly those moments, which is why it looked like an auth bug.
 *
 * It will happen to real creators too, and more often than it did to us: a
 * phone keeps a tab alive for days.
 *
 * So: try again once in case the network simply dropped the request, and if it
 * still fails, reload. A reload fetches the current index and therefore the
 * current filenames, and it keeps the URL, so somebody signing in still lands
 * where they were going. The session lives in localStorage and survives it.
 *
 * The timestamp guard is what stops a genuinely broken deploy turning into an
 * infinite refresh: at most one reload per tab per minute, and after that the
 * error is allowed through to the boundary where somebody will see it.
 */
const RELOAD_KEY = 'wx.chunk-reload';

/**
 * A screen, loaded WITHOUT blocking the navigation.
 *
 * THIS IS THE FIX FOR THE LAG RASHID KEPT REPORTING, and the difference is the
 * order two things happen in rather than how fast either of them is.
 *
 * React Router's route-level `lazy` waits for the module before it commits the
 * navigation. Measured with `pnpm measure:nav` on 2026-08-15: 291ms from click
 * to the URL changing on a first visit, 11ms once the chunk was in memory, and
 * click-to-URL and click-to-painted were the SAME number. So for a third of a
 * second nothing on screen moved at all, which is why it read as the app
 * hanging rather than loading.
 *
 * `React.lazy` behind the Suspense boundary in `ShellLayout` inverts that: the
 * URL changes immediately, the sidebar and frame stay mounted, the active menu
 * item lights up, and only the content area suspends. Same download, same
 * duration, but the app answers the click.
 *
 * THE DEPLOY RETRY IS UNCHANGED and still matters. A tab open across a deploy
 * asks for a filename that no longer exists on the CDN, so this retries once in
 * case the network simply dropped it, then reloads to pick up the new index.
 * The timestamp guard keeps a genuinely broken deploy from becoming an infinite
 * refresh: at most one reload per tab per minute.
 */
const screen = (load: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(async () => {
    try {
      const mod = await load();
      return { default: mod[name] as React.ComponentType };
    } catch (error) {
      try {
        const mod = await load();
        return { default: mod[name] as React.ComponentType };
      } catch {
        /* Still gone. Fall through to the reload. */
      }
      return reloadOrThrow(error);
    }
  });

/**
 * Shared by both loaders. Reloads once to pick up the current index, or gives
 * up and lets the error reach the boundary where somebody will see it.
 */
function reloadOrThrow(error: unknown): never {
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? '0');
  } catch {
    /* Private mode with storage blocked. Treat it as never reloaded. */
  }

  if (Date.now() - last > 60_000) {
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      /* As above. The reload is still worth attempting. */
    }
    window.location.reload();
    // The reload takes the page, so this never settles. A pending promise stops
    // React rendering an error in the meantime.
    throw new Promise<never>(() => {});
  }

  throw error;
}

/**
 * The blocking loader, kept for the PUBLIC routes only.
 *
 * The landing page, sign in and the rest have no shell to hold still and no
 * sidebar to keep lit, so there is nothing for a Suspense fallback to preserve
 * and blocking until the module is ready avoids a flash of empty page.
 */
const lazyRoute = (load: () => Promise<Record<string, unknown>>, name: string) => async () => {
  try {
    const mod = await load();
    return { Component: mod[name] as React.ComponentType };
  } catch (error) {
    try {
      const mod = await load();
      return { Component: mod[name] as React.ComponentType };
    } catch {
      /* Still gone. Fall through to the reload. */
    }

    let last = 0;
    try {
      last = Number(window.sessionStorage.getItem(RELOAD_KEY) ?? '0');
    } catch {
      /* Private mode with storage blocked. Treat it as never reloaded. */
    }

    if (Date.now() - last > 60_000) {
      try {
        window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        /* As above. The reload is still worth attempting. */
      }
      window.location.reload();
      // The reload takes the page, so this never settles. Returning a pending
      // promise stops the router rendering an error in the meantime.
      return new Promise<never>(() => {});
    }

    throw error;
  }
};

/* ---------------------------------------------------------- the screens -- */
/*
 * Declared once, at module scope, and this is load bearing rather than tidy.
 * `lazy()` called inside the route table would make a NEW component type on
 * every render, and React would unmount and remount the screen each time.
 *
 * The names are prefixed by side because four of them collide: there is an app
 * Brands and an admin Brands, an app BrandHub and an admin BrandHub. They are
 * different screens for different people and mixing them up would show a
 * creator the staff version.
 */
const CreatorDashboard = screen(() => import('@/routes/app/Dashboard'), 'Dashboard');
const CreatorBrandHub = screen(() => import('@/routes/app/BrandHub'), 'BrandHub');
const CreatorOffers = screen(() => import('@/routes/app/Offers'), 'Offers');
const CreatorContent = screen(() => import('@/routes/app/Content'), 'Content');
const CreatorBoard = screen(() => import('@/routes/app/Leaderboards'), 'Leaderboards');

const AdminHome = screen(() => import('@/routes/admin/AdminDashboard'), 'AdminDashboard');
const AdminApplications = screen(() => import('@/routes/admin/Applications'), 'Applications');
const AdminApplicationDetail = screen(
  () => import('@/routes/admin/ApplicationDetail'),
  'ApplicationDetail'
);
const AdminAllOffers = screen(() => import('@/routes/admin/AllOffers'), 'AllOffers');
const AdminOfferRequests = screen(
  () => import('@/routes/admin/OfferRequests'),
  'OfferRequests'
);
const AdminAllContests = screen(() => import('@/routes/admin/AllContests'), 'AllContests');
const AdminContestClaims = screen(
  () => import('@/routes/admin/ContestClaims'),
  'ContestClaims'
);
const AdminContestRewards = screen(
  () => import('@/routes/admin/ContestRewards'),
  'ContestRewards'
);
const AdminContestSetup = screen(() => import('@/routes/admin/ContestSetup'), 'ContestSetup');
const AdminContent = screen(() => import('@/routes/admin/Content'), 'AdminContent');
const AdminActivity = screen(() => import('@/routes/admin/Activity'), 'Activity');
const AdminClientLinks = screen(() => import('@/routes/admin/ClientLinks'), 'ClientLinks');
const AdminBackups = screen(() => import('@/routes/admin/Backups'), 'Backups');
const AdminTikTok = screen(() => import('@/routes/admin/TikTokSettings'), 'TikTokSettings');
const AdminPaidCollabs = screen(() => import('@/routes/admin/PaidCollabs'), 'PaidCollabs');
const AdminBrands = screen(() => import('@/routes/admin/Brands'), 'Brands');
const AdminBrandHub = screen(() => import('@/routes/admin/BrandHub'), 'BrandHub');
const AdminCreators = screen(() => import('@/routes/admin/Creators'), 'Creators');
const AdminCreatorDetail = screen(
  () => import('@/routes/admin/CreatorDetail'),
  'CreatorDetail'
);

const StudioHome = screen(() => import('@/routes/studio/StudioHome'), 'StudioHome');

/**
 * START THE DOWNLOAD BEFORE THE CLICK.
 *
 * The layout change above means a cold section answers instantly and then shows
 * a skeleton for about a quarter of a second while its code arrives. This
 * removes the skeleton in the common case: touching a menu item with a pointer,
 * or reaching it with the keyboard, begins the fetch, so by the time the click
 * lands the module is usually already in memory and the screen is simply there.
 *
 * It is the cheap half, not the important half. There is no hover on a phone,
 * which is most creators, and they are the reason the layout change had to be
 * done properly rather than papered over with this.
 *
 * Safe to call as often as you like: an import is cached by the bundler, so
 * repeat calls are a map lookup. Failures are swallowed on purpose, because a
 * prefetch that fails must never surface an error for a screen nobody has asked
 * for yet; the real navigation will retry and report it properly.
 */
const PREFETCH: Record<string, () => Promise<unknown>> = {
  '/app': () => import('@/routes/app/Dashboard'),
  '/app/brands': () => import('@/routes/app/Brands'),
  '/app/offers': () => import('@/routes/app/Offers'),
  '/app/content': () => import('@/routes/app/Content'),
  '/app/leaderboards': () => import('@/routes/app/Leaderboards'),
  '/admin': () => import('@/routes/admin/AdminDashboard'),
  '/admin/applications': () => import('@/routes/admin/Applications'),
  '/admin/activity': () => import('@/routes/admin/Activity'),
  '/admin/backups': () => import('@/routes/admin/Backups'),
  '/admin/tiktok': () => import('@/routes/admin/TikTokSettings'),
  // Deliberately NOT prefetched: it is a very large vendored bundle and nobody
  // who never opens it should download it on a hover.
  '/admin/offers': () => import('@/routes/admin/AllOffers'),
  '/admin/offers/requests': () => import('@/routes/admin/OfferRequests'),
  '/admin/contests': () => import('@/routes/admin/AllContests'),
  '/admin/contests/claims': () => import('@/routes/admin/ContestClaims'),
  '/admin/contests/rewards': () => import('@/routes/admin/ContestRewards'),
  '/admin/content': () => import('@/routes/admin/Content'),
  '/admin/brands': () => import('@/routes/admin/Brands'),
  '/admin/creators': () => import('@/routes/admin/Creators'),
  '/studio': () => import('@/routes/studio/StudioHome'),
};

export function prefetchRoute(to: string) {
  const load = PREFETCH[to];
  if (load) void load().catch(() => {});
}

/**
 * A REDIRECT THAT KEEPS THE QUERY STRING.
 *
 * `/app/numbers` and `/app/contests` are gone as pages (Rashid, 2026-10-19:
 * My numbers folds into Home; Contests folds into Earn). Old links still exist
 * — in notifications, in a contest's "see your progress" link, in anything
 * ever sent to a creator — and some of them carry state: `?period=` and
 * `?brand=` for numbers, `?view=progress` for contests. A bare `<Navigate>`
 * would drop it and land her somewhere that has forgotten what she asked for.
 */
function RedirectKeepingSearch({ to, hash }: { to: string; hash?: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export const router = createBrowserRouter([
  /* ------------------------------------------------------------- public -- */
  {
    path: '/',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/Landing'), 'Landing'),
  },
  /*
   * WHERE TIKTOK SENDS AN ADMIN BACK AFTER THEY AUTHORISE US.
   *
   * PUBLIC ON PURPOSE, and it is the only route in the product that has to be:
   * the browser arrives here straight from tiktok.com and may carry no hub
   * session in that tab. What makes it safe is the single-use `state` nonce,
   * minted by an admin-only edge function and burned server side, rather than
   * this route being hard to reach. See supabase/functions/tiktok-callback.
   */
  {
    path: '/oauth/tiktok/callback',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/OAuthTikTokCallback'), 'OAuthTikTokCallback'),
  },
  /*
   * WHERE TIKTOK SENDS A CREATOR BACK, as opposed to an admin.
   *
   * Public for the same reason as its sibling above: somebody returning from
   * tiktok.com may carry no session in that tab, and a creator who approved
   * inside TikTok's in-app browser on a phone is exactly who this is for. The
   * single-use state nonce, burned server side, is what makes it safe.
   */
  {
    path: '/oauth/tiktok-creator/callback',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(
      () => import('@/routes/OAuthTikTokCreatorCallback'),
      'OAuthTikTokCreatorCallback'
    ),
  },
  {
    path: '/apply',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/Apply'), 'Apply'),
  },
  /*
   * ───────────────────────── THE WEBSITE, added 2026-09-22 ─────────────────
   *
   * TikTok rejected the Display API app a second time on 2026-09-15: "Your
   * website URL cannot be a landing page or login page. You must have an
   * externally facing fully developed website ... A valid official website
   * that houses information about your web and services." We had one scrolling
   * marketing page, the two legal pages and /tiktok.
   *
   * These six are the rest of the site, reachable from the header and the
   * footer of every public page, on the same domain as the app, its Terms, its
   * Privacy and both OAuth redirect URIs — which is the other reason not to
   * move the submission to wurxmedia.com. Copy lives in src/content/site-pages.
   */
  {
    path: '/creators',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/site/Creators'), 'Creators'),
  },
  {
    /* NOT /app/brands, which is a creator's own brand hubs behind the login. */
    path: '/brands',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/site/Brands'), 'Brands'),
  },
  {
    path: '/how-it-works',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/site/HowItWorksPage'), 'HowItWorksPage'),
  },
  {
    path: '/about',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/site/About'), 'About'),
  },
  {
    path: '/faq',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/site/Faq'), 'Faq'),
  },
  {
    path: '/contact',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/site/Contact'), 'Contact'),
  },
  /*
   * A CLIENT'S READ-ONLY VIEW OF THE BRANDS THEY WERE SHARED.
   *
   * Public because the person opening it has no account here and is never
   * getting one — Rashid, 2026-09-17: "clients would need no login at all".
   * What makes it safe is the link itself: 192 random bits, kept only as a
   * SHA-256, with an expiry and a revoke switch, checked by the `collab-share`
   * function, which answers with a projection that cannot carry ad spend, ROI,
   * payment details or anybody's phone number. This route renders what that
   * function returns and holds no key of its own.
   */
  {
    path: '/share/collabs/:token',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/ShareCollab'), 'ShareCollab'),
  },
  /*
   * THE TWO LEGAL PAGES, public and unauthenticated on purpose.
   *
   * TikTok's developer portal will not accept an app without a Terms of Service
   * URL and a Privacy Policy URL, both reachable by anybody, both on the same
   * domain as the app. Registering the Display API app on 2026-08-26 is what
   * forced them into existence; they are linked from the site footer as well,
   * because a reviewer looks for the link and not only the URL.
   */
  {
    path: '/terms',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/legal/Terms'), 'Terms'),
  },
  {
    path: '/privacy',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/legal/Privacy'), 'Privacy'),
  },
  /*
   * And the third one, added 2026-09-01 after the Display API app was rejected.
   *
   * TikTok require that the website URL on a submission is "an externally
   * facing fully developed website" and "cannot be a landing page or login
   * page". Ours was the marketing page, and no signed-out page anywhere
   * described the TikTok connection at all — so a reviewer could read that we
   * sell a creator platform but could not see the feature they were reviewing.
   * This is the URL that submission should name.
   */
  {
    path: '/tiktok',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/legal/TikTokConnection'), 'TikTokConnection'),
  },
  // /signup is the same screen, and deliberately NOT behind the
  // "already signed in? go home" guard.
  //
  // Applying creates the account, so that guard used to fire the instant sign
  // up returned, which is BEFORE the application row is written. The dashboard
  // then mounted, asked whether an application existed, was truthfully told no,
  // and cached that answer, greeting somebody who had just applied with
  // "Finish your application". The form navigates people itself once its work
  // has actually finished.
  {
    path: '/signup',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/Apply'), 'Apply'),
  },

  /* ------------------------------------------ signed out only (auth) ----- */
  {
    Component: RedirectIfSignedIn,
    children: [
      {
        path: '/login',
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/routes/auth/SignIn'), 'SignIn'),
      },
      // The staff door. A separate SCREEN, not a separate lock: it exists so
      // the team is not greeted by a page selling them on applying, and so no
      // sign up route sits anywhere near it. Permission is still decided by row
      // level security and the Edge Function, never by which URL you used.
      {
        path: '/admin/login',
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/routes/auth/StaffSignIn'), 'StaffSignIn'),
      },
      {
        path: '/forgot-password',
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/routes/auth/ForgotPassword'), 'ForgotPassword'),
      },
    ],
  },

  // Reset lives outside the guard above: arriving on this link creates a
  // temporary session, so a "you are already signed in" redirect would bounce
  // people away from the very page they need.
  {
    path: '/reset-password',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/auth/ResetPassword'), 'ResetPassword'),
  },

  /* ---------------------------------------------------------- signed in -- */
  /*
   * EVERY SIGNED-IN ROUTE NESTS UNDER `ShellLayout`, added 2026-08-15 to make
   * navigation instant. The shell holds the sidebar, the top bar and the page
   * frame, and it stays mounted across a navigation, so the URL and the active
   * menu item change the moment you click and only the content area suspends.
   * Read the block on `screen()` above for the measurements behind it.
   */
  {
    Component: () => <RequireAuth allow={['applicant', 'creator']} />,
    children: [
      {
        /* A FALLBACK, OR THE FIRST LOAD IS A BLANK SCREEN.
           `lazyRoute` BLOCKS until the module resolves, and React Router
           renders nothing in the meantime unless the route says what to
           show. Every other lazy route in this file carries one; these
           five did not when the shell was made lazy, so a cold first
           open on a phone — where the chunk takes real time — sat blank
           until it arrived. Reported from a real handset. */
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/components/layout/ShellLayout'), 'ShellLayout'),
        children: [
          {
            path: '/app',
            element: <CreatorDashboard />,
          },
          {
            // The Profile page is gone; what it held lives in the account menu on the
            // sidebar's user chip. Old links and bookmarks land on Home.
            path: '/app/profile',
            element: <Navigate to="/app" replace />,
          },
          // Applicants are allowed onto these routes on purpose, and are shown a
          // "this opens when you are approved" panel instead of the hub.
          //
          // Guarding them with allow={['creator']} would read the role from the
          // JWT, which lags approval by up to an hour, so somebody who had just
          // watched the confetti would be bounced back to their dashboard. The
          // screens read the profile row, which is current, and the database
          // refuses the rows either way.

          {
            path: '/app/offers',
            element: <CreatorOffers />,
          },
          // Contests get their own place in the menu on BOTH sides, the same way
          // offers do. Reaching them only by walking into a brand first was the
          // wrong shape and Rashid caught it.
          {
            path: '/app/contests',
            element: <RedirectKeepingSearch to="/app/offers" hash="#contests" />,
          },
          {
            path: '/app/content',
            element: <CreatorContent />,
          },
          {
            path: '/app/numbers',
            element: <RedirectKeepingSearch to="/app" />,
          },
          {
            path: '/app/leaderboards',
            element: <CreatorBoard />,
          },
          /* SUPPORT PAGE REMOVED, 2026-10-19, at Rashid's instruction ("delete the
             profile and support page"). The URL redirects home rather than
             404ing so a bookmark or a link in an old email still lands
             somewhere. Help and contact remain on the public /contact page. */
          {
            path: '/app/support',
            element: <Navigate to="/app" replace />,
          },
          /*
           * THE BRAND HUB IS A SCREEN OF THIS APP, so it nests here with the rest.
           *
           * It used to sit outside ShellLayout and draw its own rail and top bar,
           * and every entry into or out of a hub unmounted the whole shell and
           * mounted a different one: a full remount, which is what made it load
           * "like a completely separate app" (Rashid, 2026-10-09). Nested here the
           * rail, the top bar and the backdrop stay mounted across the move and
           * only the content area suspends, exactly as for Offers or My numbers.
           *
           * The brand survives as an accent colour, a logo and a hero, applied
           * inside the content by BrandHub. It does not repaint the page.
           *
           * Applicants may reach it, as with the routes above, and are shown the
           * "this opens when you are approved" panel by the screen itself.
           */
          {
            path: '/app/brands',
            element: <CreatorBrandHub />,
          },
          {
            path: '/app/brands/:slug',
            element: <CreatorBrandHub />,
          },
        ],
      },
    ],
  },

  {
    /*
     * PAID COLLABS, ON ITS OWN GUARD, and this is why it is not in the block
     * below with the rest of /admin.
     *
     * Affiliate Team Lead and Operations Lead see this screen and no other.
     * Leaving Paid Collabs inside the staff guard and adding those roles there
     * would have opened Applications, Creators, Offers, Contests, Brands,
     * TikTok and the audit log to them in the same edit — every one of which
     * reads money.
     *
     * The guard decides which SCREEN renders. It is not the boundary: what
     * they may actually read is `public.is_collabs_viewer()` on the wurxbase
     * SELECT policies, and writes there still answer to `is_staff()`. If this
     * list were widened by mistake tomorrow, they would reach a screen whose
     * every query returns nothing.
     */
    Component: () => <RequireAuth allow={[...STAFF_ROLES, ...COLLABS_ONLY_ROLES]} />,
    children: [
      {
        /* A FALLBACK, OR THE FIRST LOAD IS A BLANK SCREEN.
           `lazyRoute` BLOCKS until the module resolves, and React Router
           renders nothing in the meantime unless the route says what to
           show. Every other lazy route in this file carries one; these
           five did not when the shell was made lazy, so a cold first
           open on a phone — where the chunk takes real time — sat blank
           until it arrived. Reported from a real handset. */
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/components/layout/ShellLayout'), 'ShellLayout'),
        children: [
          {
            path: '/admin/collabs',
            element: <Navigate to="/admin/collabs/brands" replace />,
          },
          {
            path: '/admin/collabs/:tab',
            element: <AdminPaidCollabs />,
          },
        ],
      },
    ],
  },

  {
    /*
     * CLIENT LINKS, ON A NARROWER GUARD THAN THE REST OF STAFF.
     *
     * ops and admin only. `STAFF_ROLES` has included ads_manager since
     * 2026-09-15, and handing a brand's numbers to somebody outside the company
     * is an owner's decision, not a staff one. The guard only picks the screen:
     * the real boundary is `collab_share_create` / `_list` / `_revoke`, which
     * re-check the caller's role in the database, so this list being widened by
     * mistake would give somebody an empty screen rather than a live link.
     */
    Component: () => <RequireAuth allow={['admin', 'ops']} />,
    children: [
      {
        /* A FALLBACK, OR THE FIRST LOAD IS A BLANK SCREEN.
           `lazyRoute` BLOCKS until the module resolves, and React Router
           renders nothing in the meantime unless the route says what to
           show. Every other lazy route in this file carries one; these
           five did not when the shell was made lazy, so a cold first
           open on a phone — where the chunk takes real time — sat blank
           until it arrived. Reported from a real handset. */
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/components/layout/ShellLayout'), 'ShellLayout'),
        children: [{ path: '/admin/client-links', element: <AdminClientLinks /> }],
      },
    ],
  },

  {
    /*
     * BACKUP DATA, ADMIN ONLY, narrower even than client links.
     *
     * A backup holds every account, every password hash and the TikTok
     * connection details, and a restore can replace the whole database. The
     * guard only picks the screen: the real boundary is the backup-data Edge
     * Function, which re-reads the caller's role from the profiles table, asks
     * for the password again before a download or a restore, and writes the
     * audit log. Widening this list by mistake would give somebody a screen
     * whose every button is refused.
     */
    Component: () => <RequireAuth allow={['admin']} />,
    children: [
      {
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/components/layout/ShellLayout'), 'ShellLayout'),
        children: [{ path: '/admin/backups', element: <AdminBackups /> }],
      },
    ],
  },

  {
    Component: () => <RequireAuth allow={STAFF_ROLES} />,
    children: [
      {
        /* A FALLBACK, OR THE FIRST LOAD IS A BLANK SCREEN.
           `lazyRoute` BLOCKS until the module resolves, and React Router
           renders nothing in the meantime unless the route says what to
           show. Every other lazy route in this file carries one; these
           five did not when the shell was made lazy, so a cold first
           open on a phone — where the chunk takes real time — sat blank
           until it arrived. Reported from a real handset. */
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/components/layout/ShellLayout'), 'ShellLayout'),
        children: [
          {
            path: '/admin',
            element: <AdminHome />,
          },
          {
            path: '/admin/applications',
            element: <AdminApplications />,
          },
          {
            path: '/admin/applications/:id',
            element: <AdminApplicationDetail />,
          },
          // Offers is a section with two screens: the catalogue of everything we
          // run, and the queue of creators waiting on a decision. They answer
          // different questions and are worked at different times.
          {
            path: '/admin/offers',
            element: <AdminAllOffers />,
          },
          {
            path: '/admin/offers/requests',
            element: <AdminOfferRequests />,
          },
          // Three screens, three jobs: what is running, who is waiting on us, and
          // what it has cost. Different questions, worked at different times of day,
          // and a screen that tries to answer two of them answers neither well.
          {
            path: '/admin/contests',
            element: <AdminAllContests />,
          },
          {
            path: '/admin/contests/claims',
            element: <AdminContestClaims />,
          },
          {
            path: '/admin/contests/rewards',
            element: <AdminContestRewards />,
          },
          {
            path: '/admin/content',
            element: <AdminContent />,
          },
          {
            path: '/admin/activity',
            element: <AdminActivity />,
          },
          {
            path: '/admin/tiktok',
            element: <AdminTikTok />,
          },
          /*
           * Paid Collabs is six sidebar rows now, not one row with a tab rail
           * inside it. The tab is the ROUTE, so the browser back button, a
           * bookmark and a link into Reporting all work like every other screen in
           * the product — none of which was true while the tab lived in component
           * state.
           *
           * /admin/collabs on its own redirects to Brands rather than 404ing: it
           * is what the sidebar pointed at until today and what any saved link
           * still says.
           */
          {
            path: '/admin/brands',
            element: <AdminBrands />,
          },
          {
            path: '/admin/brands/:id',
            element: <AdminBrandHub />,
          },
          // A full screen rather than a dialog, ruled 2026-08-13: a contest carries
          // a dozen fields plus three lists inside it. `new` and an id share one
          // component, because creating and editing are the same form with one
          // different verb on the button.
          {
            path: '/admin/brands/:id/contests/:contestId',
            element: <AdminContestSetup />,
          },
          {
            path: '/admin/creators',
            element: <AdminCreators />,
          },
          {
            path: '/admin/creators/:id',
            element: <AdminCreatorDetail />,
          },
        ],
      },
    ],
  },
  {
    Component: () => <RequireAuth allow={['creative_strategist']} />,
    children: [
      {
        /* A FALLBACK, OR THE FIRST LOAD IS A BLANK SCREEN.
           `lazyRoute` BLOCKS until the module resolves, and React Router
           renders nothing in the meantime unless the route says what to
           show. Every other lazy route in this file carries one; these
           five did not when the shell was made lazy, so a cold first
           open on a phone — where the chunk takes real time — sat blank
           until it arrived. Reported from a real handset. */
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/components/layout/ShellLayout'), 'ShellLayout'),
        children: [
          {
            path: '/studio',
            element: <StudioHome />,
          },
        ],
      },
    ],
  },
  {
    Component: () => <RequireAuth />,
    children: [
      {
        path: '/suspended',
        HydrateFallback: RouteFallback,
        lazy: lazyRoute(() => import('@/routes/Suspended'), 'Suspended'),
      },
    ],
  },

  /*
   * THE CHART GALLERY, DEV ONLY.
   *
   * Every chart in the family, both themes, with real, gapped, zero, lone and
   * all-null data. It is the only place the "null is not zero" rule can be
   * checked at a glance, because real data never contains the awkward cases on
   * the day you need them.
   *
   * `import.meta.env.DEV` is a compile-time constant, so in a production build
   * this spreads an empty array and the page is not in the bundle at all —
   * hidden by absence rather than by an unlinked URL. Open it with `pnpm dev`
   * at /dev/charts.
   */
  ...(import.meta.env.DEV
    ? [
        /* PRE-REGISTERED PREVIEW ROUTES, 2026-10-19 — one per page, each backed by a
           stub its owner replaces, so no one edits this file to add their own. */
        {
          path: '/dev/numbers',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/NumbersPreview'), 'NumbersPreview'),
        },
        {
          path: '/dev/offers',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/OffersPreview'), 'OffersPreview'),
        },
        {
          path: '/dev/contests',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/ContestsPreview'), 'ContestsPreview'),
        },
        {
          path: '/dev/leaderboards',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/LeaderboardsPreview'), 'LeaderboardsPreview'),
        },
        {
          path: '/dev/content-page',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/ContentPagePreview'), 'ContentPagePreview'),
        },
        {
          path: '/dev/account',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/AccountPreview'), 'AccountPreview'),
        },
        {
          path: '/dev/charts',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/ChartGallery'), 'ChartGallery'),
        },
        {
          /* The notification rows, which only exist signed in. */
          path: '/dev/notifications',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/NotificationsPreview'), 'NotificationsPreview'),
        },
        {
          /* The content grid at 1, 2, 3 and many videos — the counts where a
             stretched column shows up and a full page never does. */
          path: '/dev/content',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/ContentPreview'), 'ContentPreview'),
        },
        {
          /* Home against made-up figures, both themes, because there is no
             creator login on this machine to open the real one with. */
          path: '/dev/home',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/HomePreview'), 'HomePreview'),
        },
        {
          /* The Brand Hub overview, for the same reason, at the two counts
             that decide whether the 2026-10-17 rework worked: a brand with
             NOTHING filled in, and one with everything. */
          path: '/dev/brand-hub',
          HydrateFallback: RouteFallback,
          lazy: lazyRoute(() => import('@/routes/dev/BrandHubPreview'), 'BrandHubPreview'),
        },
      ]
    : []),

  /* --------------------------------------------------------------- 404 --- */
  {
    path: '*',
    HydrateFallback: RouteFallback,
    lazy: lazyRoute(() => import('@/routes/NotFound'), 'NotFound'),
  },
]);
