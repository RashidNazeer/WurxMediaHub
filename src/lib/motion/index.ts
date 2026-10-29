/**
 * The motion layer.
 *
 * `docs/guides/MOTION.md` is the short version of what belongs where: Motion by
 * default, GSAP only for sequenced timelines, CSS for anything that is really a
 * state change. Read it before adding an animation anywhere in this app.
 *
 * Nothing here re-exports Motion itself. `m`, `AnimatePresence`, `useScroll`
 * and `useReducedMotion` come straight from `motion/react`, as they always
 * have — and it is `m.div`, never `motion.div`, because `LazyMotion` runs with
 * `strict` and the full component throws at runtime.
 */

export { ScrollProvider } from './ScrollProvider';
export {
  ScrollContext,
  useScrollApi,
  useLenis,
  useScrollLock,
  useSuspendSmoothScroll,
  useSmoothScrollRouteGuard,
  type ScrollApi,
} from './scroll-context';
export {
  SMOOTH_SCROLL_KEY,
  SMOOTH_SCROLL_ENV,
  SMOOTH_SCROLL_DENY_PREFIXES,
  isSmoothScrollDeniedPath,
  smoothScrollRequested,
} from './flags';
export {
  loadGsap,
  registerGsapPlugins,
  useGsapTimeline,
  gsapTo,
  type MotionSafeVars,
  type SafeTimeline,
  type TimelinePosition,
  type UseGsapTimelineOptions,
} from './gsap';
