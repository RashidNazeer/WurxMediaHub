import { createContext, useContext, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import type Lenis from 'lenis';
import type { ScrollToOptions as LenisScrollToOptions } from 'lenis';
import { isSmoothScrollDeniedPath } from './flags';

/*
 * `import type` only, both of them. `verbatimModuleSyntax` erases these at
 * compile time, so nothing here pulls Lenis into the main chunk — the library
 * is `import()`ed inside `ScrollProvider`'s effect and only when the flag is
 * on. With the flag off, `lenis` is not in the bundle at all.
 */

export type ScrollApi = {
  /**
   * The live Lenis instance, or `null` whenever Lenis is not driving the page:
   * flag off, reduced motion, or suspended by a route.
   *
   * Reading this is for imperative work (`lenis.scrollTo`, `lenis.on`). Do NOT
   * read scroll POSITION from it to drive animation — use Motion's `useScroll`,
   * which reads the same document scroll Lenis writes. See `docs/guides/MOTION.md`.
   */
  lenis: Lenis | null;

  /** True when Lenis is driving the page right now. */
  smooth: boolean;

  /**
   * Take Lenis off the page for as long as the caller holds the handle.
   * Reference counted, so two callers cannot un-suspend each other. Returns
   * the release function, which is what makes it an effect one-liner:
   *
   *   useEffect(() => suspend('my-reason'), [suspend]);
   */
  suspend: (reason: string) => () => void;

  /**
   * Scroll to a position or an element, THROUGH Lenis when Lenis is driving.
   *
   * New code scrolls with this rather than `scrollIntoView` or `window.scrollTo`.
   * Both of those still work — Lenis keeps the native scrollbar and re-syncs
   * from the real scroll event — but they jump instead of easing, because the
   * provider turns `html { scroll-behavior: smooth }` off while Lenis is on
   * (two things easing the same `scrollTop` is the fight we are avoiding).
   */
  scrollTo: (target: number | string | HTMLElement, options?: LenisScrollToOptions) => void;

  /** Pause/resume scrolling. Used by `useScrollLock`, below. */
  stop: () => void;
  start: () => void;
};

/**
 * The default value is a working no-op API, deliberately.
 *
 * Every hook here is safe to call on a screen that has no `ScrollProvider`
 * above it — a Storybook-ish render, a test, the public pages before the
 * provider was wired in. Nothing throws, and `smooth` is simply false.
 */
const NOOP: ScrollApi = {
  lenis: null,
  smooth: false,
  suspend: () => () => {},
  scrollTo: (target, options) => {
    if (typeof window === 'undefined') return;
    if (typeof target === 'number') {
      window.scrollTo({ top: target, behavior: options?.immediate ? 'auto' : 'smooth' });
      return;
    }
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    el?.scrollIntoView({ behavior: options?.immediate ? 'auto' : 'smooth', block: 'start' });
  },
  stop: () => {},
  start: () => {},
};

export const ScrollContext = createContext<ScrollApi>(NOOP);

export function useScrollApi(): ScrollApi {
  return useContext(ScrollContext);
}

/**
 * The Lenis instance, or null. A thin read for imperative callers.
 */
export function useLenis(): Lenis | null {
  return useContext(ScrollContext).lenis;
}

/**
 * Hold smooth scroll off for as long as this component is mounted.
 *
 * This is the per-route opt-out, used from inside the route rather than from a
 * list somewhere else, so it cannot be forgotten when a path changes.
 * `PaidCollabs` calls it; see `flags.ts` for why that route in particular.
 */
export function useSuspendSmoothScroll(reason: string): void {
  const { suspend } = useScrollApi();
  useEffect(() => suspend(reason), [suspend, reason]);
}

/**
 * The deny-list half of the per-route opt-out, mounted once in `ShellLayout`
 * so every signed-in route is covered by one call.
 *
 * Belt and braces with `useSuspendSmoothScroll`: either mechanism alone keeps
 * Lenis off Paid Collabs, and because suspension is reference counted, both
 * firing at once is correct rather than a conflict.
 */
export function useSmoothScrollRouteGuard(): void {
  const { pathname } = useLocation();
  const { suspend } = useScrollApi();

  useEffect(() => {
    if (!isSmoothScrollDeniedPath(pathname)) return;
    return suspend(`route:${pathname}`);
  }, [pathname, suspend]);
}

/**
 * Stop the page scrolling behind an overlay, and put it back exactly as it was.
 *
 * WHY THIS EXISTS RATHER THAN `body { overflow: hidden }`. Four dialogs in this
 * app lock scroll by setting `document.body.style.overflow`, and that does
 * nothing to Lenis: Lenis cancels the wheel event and writes `scrollTop`
 * itself, so the page would keep gliding along behind an open modal.
 *
 * `ScrollProvider` watches `body`'s inline style and calls `stop()`/`start()`
 * for those four without them knowing, so nothing was edited to make this
 * work. New overlays should use this hook instead and skip the body style: it
 * says what it means, and it does not fight with anything.
 */
export function useScrollLock(active: boolean): void {
  const { stop, start } = useScrollApi();
  // Keep the latest functions without re-running the lock when the provider
  // re-renders: locking and unlocking a scroll position is not idempotent in
  // the eyes of a user watching the page jump.
  const fns = useRef({ stop, start });
  fns.current = { stop, start };

  useEffect(() => {
    if (!active) return;
    fns.current.stop();
    return () => fns.current.start();
  }, [active]);
}
