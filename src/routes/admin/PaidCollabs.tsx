import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getSupabase } from '@/lib/supabase';
import { isCollabsOnlyRole, useAuth } from '@/lib/auth/auth-context';
import { useProfile } from '@/lib/auth/useProfile';
import { wurxbaseSession } from '@/lib/wurxbase-identity';
import { useWurxbaseIdentity } from '@/lib/useWurxbaseIdentity';
import { setApcViewer } from '@/vendor/wurxbase/supabaseClient';
import { useTheme } from '@/components/theme/theme-context';
import { useSuspendSmoothScroll } from '@/lib/motion';
// Both win on specificity rather than on order. See the header of each file:
// the vendored CSS ships in a lazily loaded chunk, so "loaded after theirs" is
// not something an import position in here can promise.
import './wurxbase-overrides.css';
import './wurxbase-chrome.css';

/**
 * Paid Collabs: the WurxBase dashboard, running inside WurxMediaHub.
 *
 * WHAT THIS IS. WurxBase is a separate Create React App project another
 * developer built, roughly 24,000 lines of plain JavaScript covering creators,
 * brands, budgets, performance, reporting and paid collaborations. Rashid asked
 * for it to be brought in **whole and unchanged** — his words, no code, no
 * logic, nothing on that side to change — with only the styling made ours.
 *
 * So `src/vendor/wurxbase/` is a verbatim copy. It is not converted to
 * TypeScript, not refactored, not linted to our rules and not tidied. When it
 * needs to change, it changes there, in its own idiom. This file is the only
 * seam between it and the rest of the product, and it does four things:
 *
 *   1. ADMIN ONLY. The route guard keeps creators out, and the sidebar never
 *      offers it to them. Nothing in here is creator-facing.
 *   2. FENCES ITS CSS. WurxBase styles `body`, `*` and bare elements, written
 *      for a site of its own. Every one of its selectors was rewritten to sit
 *      under `.wurxbase-root`, so it cannot reach a single pixel of the rest of
 *      the product. Without that, opening this page once would restyle
 *      everything, permanently, because a lazily loaded chunk injects its CSS
 *      and never takes it back.
 *   3. HANDS IT THE THEME. Its stylesheets switch on `data-theme` on the root
 *      element. Ours lives on `<html>`, and the fence is a div, so the value is
 *      mirrored onto it and kept in step.
 *   4. LOADS IT LAZILY. It is a large bundle with jsPDF, PptxGenJS and SheetJS
 *      inside, and nobody who never opens this screen should pay for any of it.
 */

import { CollabAdFiguresProvider } from './collab-ad-figures';

const WurxBaseApp = lazy(() => import('@/vendor/wurxbase/App'));

export function PaidCollabs() {
  const { resolved } = useTheme();
  const fence = useRef<HTMLDivElement>(null);

  /*
   * NO SMOOTH SCROLL ON THIS SCREEN, EVER.
   *
   * Lenis takes the wheel gesture away from the browser and writes `scrollTop`
   * itself. WurxBase scrolls itself inside this fence, positions its own
   * overlays, and is 24,000 lines nobody here is going to re-test; a second
   * authority over the page's scrolling above it is not a trade worth making
   * for a glide. `GLASS_PLAN` §1.2 is about `filter` rather than scroll, but it
   * is the same lesson three rewrites long: nothing above this fence gets to
   * change how the fence behaves.
   *
   * Said here as well as in `SMOOTH_SCROLL_DENY_PREFIXES`, so moving or
   * renaming the route cannot quietly turn it back on. Suspension is reference
   * counted, so both firing is correct rather than a conflict. A no-op while
   * the flag is off, which is the default.
   */
  useSuspendSmoothScroll('paid-collabs');

  /*
   * Their CSS reads `data-theme` off the element its rules are anchored to.
   * That anchor used to be `<html>`; scoping moved it to this div, so the value
   * has to arrive here. Kept in an effect rather than rendered as a prop so it
   * follows a theme change made while the screen is open.
   *
   * AND THE OTHER DIRECTION, which is the whole reason this effect got longer.
   * WurxBase has its own appearance settings, and `applyPrefsToDOM` writes all
   * five of them straight onto `<html>`: theme, accent, density, radius,
   * motion. One of those five is `data-theme`, which is the exact attribute
   * `src/styles/tokens.css` switches our entire palette on, and theirs defaults
   * to `light`. So opening this screen turned the whole admin light, and it
   * STAYED light after leaving it, because our provider only writes that
   * attribute when the theme actually changes and nothing had changed.
   *
   * Rather than edit their file, the seam takes the attribute back: an observer
   * puts our theme straight back on `<html>` whenever they set it, and mirrors
   * their other four onto the fence, where their own scoped rules read them.
   * Their settings panel therefore still works inside here, on everything
   * except the theme, which our toggle owns because our toggle is the one that
   * moves the rest of the product with it.
   */
  useEffect(() => {
    const el = fence.current;
    if (!el) return;

    const html = document.documentElement;
    const theirs = ['data-accent', 'data-density', 'data-radius', 'data-motion'];

    const reclaim = () => {
      if (html.getAttribute('data-theme') !== resolved) {
        // Writing this fires the observer again; the guard above stops there.
        html.setAttribute('data-theme', resolved);
      }
      el.setAttribute('data-theme', resolved);
      for (const name of theirs) {
        const value = html.getAttribute(name);
        if (value === null) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
    };

    reclaim();
    const observer = new MutationObserver(reclaim);
    observer.observe(html, {
      attributes: true,
      attributeFilter: ['data-theme', ...theirs],
    });

    return () => {
      observer.disconnect();
      // Leave the document as we found it: our theme, and none of their four.
      html.setAttribute('data-theme', resolved);
      for (const name of theirs) html.removeAttribute(name);
    };
  }, [resolved]);

  /*
   * The tab is the route. `replace` on the correction so a mistyped URL does
   * not leave a dead entry in the back button, and `push` when their app
   * changes tab itself, because that IS navigation and should be undoable.
   */
  /*
   * NO SECOND SIGN-IN.
   *
   * Rashid: *"when admin is already in app no need of signin obviously so
   * remove it"*. Their login screen checked a typed password against a
   * plaintext column, which was never the boundary — our own sign-in and the
   * RLS under the `wurxbase` schema are. So the session their app reads is
   * written here, from the person who is already signed in, BEFORE the lazy
   * chunk mounts and looks for it.
   *
   * Their `logActivity` stamps `user_id` and `user_display` onto every
   * audit row, so this is also what makes that trail truthful: it now names the
   * actual person rather than whichever shared account was typed in.
   *
   * `useLayoutEffect`, not `useEffect`: their App reads sessionStorage in a
   * `useState` initialiser, and an effect that runs after paint would let it
   * decide nobody is signed in and render the login screen for one frame.
   */
  const { user } = useAuth();
  const { data: profile, isPending: profilePending } = useProfile();
  /* Their own role and overrides where we can find them; our mapping if not. */
  const identity = useWurxbaseIdentity();
  /* An APC viewer's queries are pointed at brand-scoped views. Set BEFORE the
     app mounts (it waits on `identityReady`), and re-set on every render of
     this layout so a role change cannot leave the flag stale. */
  setApcViewer(profile?.role === 'apc_viewer');
  useLayoutEffect(() => {
    if (!user?.id) return;
    try {
      sessionStorage.setItem(
        'ch_user',
        JSON.stringify(
          {
            ...wurxbaseSession({
              id: user.id,
              displayName: profile?.display_name,
              email: user.email,
              role: profile?.role,
            }),
            /* Their row wins where it exists: the role Asad set, and the
               overrides he tuned. `can()` reads both. */
            role: identity.role,
            custom_perms: identity.customPerms,
            /* And their own spelling of the person's name, where we found it.
               Their audit trail has said "Farkhan Saleem" for months; falling
               back to an email local part would have made the same person
               appear twice in one log under two names. */
            ...(identity.display ? { display: identity.display } : null),
          },
        ),
      );
    } catch {
      /* A browser with storage blocked falls back to their login screen, which
         is the old behaviour rather than a broken screen. */
    }
  }, [user?.id, user?.email, profile?.display_name, profile?.role, identity.role, identity.customPerms, identity.display]);

  /*
   * Written by the layout effect above; the app may not mount before it is
   * true, or their one-shot read of sessionStorage finds an empty key.
   *
   * `identity.pending` BELONGS IN HERE AND WAS MISSING UNTIL 2026-08-29.
   *
   * Their App reads `ch_user` once, in a `useState` initialiser, and never
   * looks again. Waiting only for our profile meant mounting it during the
   * ~200ms the WurxBase lookup takes, so it read the FALLBACK role — the
   * derived one, which turns every `ops` account into their `admin`. The
   * correction landed in sessionStorage a moment later and their App never saw
   * it. Fahad, a viewer, arrived able to add, edit and delete.
   *
   * Nothing said so. The sidebar drew four rows because it reads the hook
   * live, and `verify:wurxbase-perms` passed because it read sessionStorage,
   * which was eventually right. Both were looking at the corrected value; only
   * their App was holding the wrong one.
   */
  const identityReady = Boolean(user?.id) && !profilePending && !identity.pending;

  /*
   * THEIR AUDIT TRAIL KEEPS ITS ARRIVAL RECORD.
   *
   * Removing their login screen removed the only thing that wrote a LOGIN row
   * to `wurxbase.activity_logs`, and that row was not decoration: it is how
   * anybody looking at the log later knows who was in Paid Collabs on a given
   * day. Losing it would have made every later CREATOR_UPDATE sit in the log
   * with no record of who arrived to make it.
   *
   * Once per browser session, not once per navigation — the same cadence their
   * login had. Failures are swallowed on purpose: this is a footnote, and an
   * admin who cannot write a log line should still get their screen.
   */
  useEffect(() => {
    if (!identityReady || !user?.id) return;
    /*
     * The read-only roles cannot write here, so do not ask.
     *
     * Affiliate Team Lead and Operations Lead have SELECT on the wurxbase
     * schema and nothing more, by design. (Ads Manager is staff, and logs in.) This insert was refused for
     * them on every visit — correctly — and printed a 403 in the console each
     * time. An expected failure logged as an error is how a real one gets
     * missed, and it was the last thing standing between this screen and a
     * clean console for these accounts.
     *
     * Losing their LOGIN line costs nothing an auditor would want: they cannot
     * change a creator, a deal, a payment or a video, so there is no action of
     * theirs for the row to be evidence about.
     */
    if (isCollabsOnlyRole(profile?.role)) return;
    const MARK = 'wurxbase_session_logged';
    try {
      if (sessionStorage.getItem(MARK)) return;
      sessionStorage.setItem(MARK, '1');
    } catch {
      return;
    }
    const display =
      (profile?.display_name || '').trim() || (user.email || '').split('@')[0] || 'Wurx staff';
    void getSupabase()
      .schema('wurxbase')
      .from('activity_logs')
      .insert({
        user_id: user.id,
        user_display: display,
        action: 'LOGIN',
        target: null,
        details: { via: 'wurxmediahub', role: identity.role, matched: identity.matched },
      })
      .then(() => undefined, () => undefined);
  }, [identityReady, user?.id, user?.email, profile?.display_name, profile?.role]);

  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  /*
   * Fall back to the first tab this person may actually open, not blindly to
   * Brands — a viewer has no Discovery and, one day, may have no Brands.
   *
   * NOT WHILE THE PROFILE IS STILL LOADING. Until it lands, `profile?.role` is
   * undefined, which resolves to their weakest role, which has no Discovery —
   * so an admin opening /admin/collabs/discovery got bounced to Brands before
   * the app had any idea who they were. The contrast guard caught it by asking
   * for the sixth screen and being handed the first, which is exactly the
   * silent redirect this fallback was added to stop.
   */
  const requested = String(tabParam);
  const allowed = identity.tabs;
  const tab = profilePending
    ? requested
    : allowed.includes(requested)
      ? requested
      : (allowed[0] ?? 'brands');
  useEffect(() => {
    if (profilePending) return;
    if (tabParam !== tab) navigate(`/admin/collabs/${tab}`, { replace: true });
  }, [tabParam, tab, navigate, profilePending]);
  const handleTabChange = useCallback(
    (next: string) => {
      if (next && next !== tab) navigate(`/admin/collabs/${next}`);
    },
    [navigate, tab],
  );

  return (
    <div
      ref={fence}
      className="wurxbase-root wurxbase-shell -mx-4 -my-4 sm:-mx-6"
      data-theme={resolved}
    >
      {/*
        THEIR OVERLAYS LAND HERE, and where it sits is the whole point.

        Their app portals ten things to `document.body` — the status dropdown,
        the video and ad-code modal behind the eye icon, the notes drawer, the
        Discovery mark popup, the confirm dialog, the sticky matrix header.
        `document.body` is outside `.wurxbase-root`, so every one of their
        `.wurxbase-root .pc-*` rules missed and those overlays rendered with no
        styling at all: the status menu came out as a bare full-width block at
        the very bottom of the document, which on screen is indistinguishable
        from a button that does nothing.

        This host is INSIDE `.wurxbase-root`, so their CSS matches, and OUTSIDE
        `.wurxbase-fence`, so a `position: fixed` overlay is measured against
        the viewport rather than against a scrolled, transformed box. Both
        halves are necessary; either alone leaves the overlay unstyled or
        off-screen.

        Paint order is not an argument here: their overlays carry their own
        z-index (9999 on the status menu, higher on the modals), and this host
        holds nothing of its own to sit under.
      */}
      <div id="wurxbase-portal-host" className="wurxbase-portals" />
      {/*
        THE ONE PLACE OUR DATA REACHES THEIR APP, and it only goes one way.

        Their creators hold delivered TikTok video URLs; we hold what those
        videos cost to advertise and what they sold. This provider does the
        lookup against OUR database and hands the answers down; the vendored
        code reads them out of a context and holds no connection of its own.

        That is the arrangement pnpm verify:isolation exists to keep, and the
        one it names itself: "If it needs something of ours, pass it in as a
        prop from the route." Their app still cannot name our project, and
        nothing of ours can name either of theirs.
      */}
      {/* The scroller, and the box their fixed chrome is trapped inside. */}
      <div className="wurxbase-fence">
      <CollabAdFiguresProvider>
        <Suspense fallback={<div className="wx-skeleton m-4 h-96 rounded-xl" />}>
          {/*
            NOT MOUNTED UNTIL WE KNOW WHO IS HERE.

            Their App reads `ch_user` out of sessionStorage in a `useState`
            initialiser — once, at mount, and never again. Writing the session
            in an effect is therefore a race we lose whenever the profile query
            has not settled yet: the chunk mounts, finds nothing, and renders
            their login screen. Which is exactly what happened, and the login
            screen then persists because nothing re-reads the key.

            So the skeleton stays until the identity is settled. `isPending`
            rather than `data`, so a profile that fails to load still mounts
            the app — degrading to their login screen, which is the old
            behaviour, rather than to a skeleton that never resolves.
          */}
          {identityReady ? (
            <WurxBaseApp tab={tab} onTabChange={handleTabChange} embedded />
          ) : (
            <div className="wx-skeleton m-4 h-96 rounded-xl" />
          )}
        </Suspense>
      </CollabAdFiguresProvider>
      </div>
    </div>
  );
}
