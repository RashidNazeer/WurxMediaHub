import { useEffect, useRef, type DependencyList, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GSAP, FENCED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * GSAP is the SECOND animation library in this app and it earns its place on
 * exactly one job: a timeline with several steps that have to be sequenced,
 * labelled, reversed or scrubbed as a unit. Motion is the default for
 * everything else and `docs/guides/MOTION.md` says where the line is.
 *
 * This file exists because raw `gsap.to(el, {...})` can do three things that
 * are already recorded bugs in this project, and TypeScript will happily let
 * you write all three:
 *
 *  1. **It can animate `filter`.** `GLASS_PLAN` §1.2: any non-`none` `filter`
 *     on an element makes it the containing block for its `position: fixed`
 *     descendants. That is the fault that put the vendored admin app's modals
 *     3,413px down the page, three times. GSAP writes inline styles, so a
 *     single `filter: 'blur(4px)'` in a tween on a wrapper is the whole bug.
 *
 *  2. **It can animate `transform` on an ancestor of the fence**, which is the
 *     SAME fault wearing different clothes — `transform` creates a containing
 *     block for fixed descendants just as `filter` does. So the dev-time guard
 *     below refuses any target that contains a `.wurxbase-root`.
 *
 *  3. **It can animate blur, shadow, width and height** — all of which are
 *     paint or layout, and all of which `GLASS_PLAN` §4.3 forbids. "Only
 *     `transform` and `opacity` animate" is a rule, not a preference.
 *
 * So the only vars this module accepts are transform components and opacity.
 * Everything else is a type error at the call site and, if something casts its
 * way past that, a thrown error in dev and a dropped property in production.
 *
 * REDUCED MOTION: a timeline built through `useGsapTimeline` is created and
 * then jumped to `progress(1)` and paused. The end state arrives, the motion
 * does not. Not slowed, not shortened — absent.
 *
 * ONE LOOP, OR AS CLOSE AS GSAP ALLOWS: GSAP keeps its own `requestAnimation-
 * Frame` ticker, and it cannot safely be taken off it (creating a tween wakes
 * the ticker again, so sleeping it is not a stable state). What keeps that from
 * becoming a third scroll authority is the rule below: **ScrollTrigger is
 * banned.** GSAP here is for short, discrete, user-triggered sequences only.
 * Its ticker idles itself when nothing is live, so it and the Lenis/Motion loop
 * are never both busy for any length of time. Scroll-driven work is Motion's
 * `useScroll`, which reads the position Lenis writes. See `ScrollProvider`.
 *
 * GSAP IS DYNAMICALLY IMPORTED. It is ~70 kB and nothing on the critical path
 * uses it. `App-*.js` is already 1,058 kB; the decision that added this library
 * named the bundle as one of the costs to weigh, so it is only downloaded by
 * the screen that actually animates with it.
 */

/* ------------------------------------------------------------ the vars --- */

/**
 * The only properties this app animates with GSAP: transform components and
 * opacity. Nothing that paints, nothing that lays out.
 *
 * If you want something that is not here, you want CSS or you want a different
 * design. `docs/guides/MOTION.md` has the list of things that must never be animated
 * and why each one is on it.
 */
export type MotionSafeVars = {
  /* Transform. `x`/`y` take px numbers or any CSS length string. */
  x?: number | string;
  y?: number | string;
  z?: number | string;
  xPercent?: number;
  yPercent?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number | string;
  rotationX?: number | string;
  rotationY?: number | string;
  rotationZ?: number | string;
  skewX?: number | string;
  skewY?: number | string;
  transformOrigin?: string;
  transformPerspective?: number;
  force3D?: boolean | 'auto';

  /* Opacity. `autoAlpha` is opacity plus `visibility`, which is the right way
     to take something out of the accessibility tree as it fades. */
  opacity?: number;
  autoAlpha?: number;

  /* Timing and control. */
  duration?: number;
  delay?: number;
  ease?: string;
  stagger?: number | gsap.StaggerVars;
  repeat?: number;
  repeatDelay?: number;
  yoyo?: boolean;
  immediateRender?: boolean;
  overwrite?: boolean | 'auto';
  paused?: boolean;
  id?: string;

  /* Callbacks. */
  onStart?: () => void;
  onUpdate?: () => void;
  onComplete?: () => void;
  onRepeat?: () => void;
  onReverseComplete?: () => void;
};

/** A timeline position: `'+=0.1'`, `'<'`, `'label'`, or a time in seconds. */
export type TimelinePosition = number | string;

const ALLOWED_VARS: ReadonlySet<string> = new Set<keyof MotionSafeVars | string>([
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'rotationX',
  'rotationY',
  'rotationZ',
  'skewX',
  'skewY',
  'transformOrigin',
  'transformPerspective',
  'force3D',
  'opacity',
  'autoAlpha',
  'duration',
  'delay',
  'ease',
  'stagger',
  'repeat',
  'repeatDelay',
  'yoyo',
  'immediateRender',
  'overwrite',
  'paused',
  'id',
  'onStart',
  'onUpdate',
  'onComplete',
  'onRepeat',
  'onReverseComplete',
]);

/**
 * Why a particular property is refused, so the error says something useful
 * rather than "not allowed".
 */
const WHY: Readonly<Record<string, string>> = {
  filter:
    'GLASS_PLAN §1.2, the fence law: a non-none `filter` makes the element the containing block for its fixed descendants. This is the 3,413px bug.',
  backdropFilter: 'GLASS_PLAN §1.2, the fence law. Same containing-block fault as `filter`.',
  webkitBackdropFilter: 'GLASS_PLAN §1.2, the fence law.',
  boxShadow: 'GLASS_PLAN §4.3: paint, not composite. Animate `transform`/`opacity` instead.',
  width: 'Layout. Animate `scaleX`, or animate nothing.',
  height: 'Layout. Animate `scaleY`, or animate nothing.',
  blur: 'GLASS_PLAN §4.3: never animate blur.',
  top: 'Layout. Animate `y`.',
  left: 'Layout. Animate `x`.',
  right: 'Layout. Animate `x`.',
  bottom: 'Layout. Animate `y`.',
  backgroundColor: 'Paint, and colour belongs to a `--wx-*` token, not to a tween.',
  color: 'Paint, and colour belongs to a `--wx-*` token, not to a tween.',
  borderRadius: 'Paint. Radius is a token.',
  clipPath: 'Paint, and expensive. Use `transform` with `overflow: hidden`.',
};

function explain(key: string): string {
  const why = WHY[key];
  return why
    ? `\`${key}\` cannot be animated here. ${why}`
    : `\`${key}\` is not on the allowed list. Only transform components and opacity may be animated (GLASS_PLAN §4.3). See docs/guides/MOTION.md.`;
}

/**
 * Throw in dev, strip in production.
 *
 * Dev throws because a motion engineer should find this the first time they run
 * the screen. Production strips because shipping a page that crashes on a
 * disallowed tween property would be worse than shipping one whose animation is
 * slightly wrong.
 */
function sanitise(vars: MotionSafeVars, where: string): MotionSafeVars {
  const bad = Object.keys(vars).filter((key) => !ALLOWED_VARS.has(key));
  if (bad.length === 0) return vars;

  const message = `[motion/gsap] ${where}: ${bad.map(explain).join(' ')}`;
  if (import.meta.env.DEV) throw new Error(message);

  console.error(message);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (ALLOWED_VARS.has(key)) clean[key] = value;
  }
  return clean as MotionSafeVars;
}

/**
 * THE FENCE CHECK, dev only.
 *
 * `transform` on an ancestor of `.wurxbase-root` is the same containing-block
 * fault as `filter` on one. GSAP writes inline styles, so this is reachable by
 * accident the moment somebody animates a layout wrapper. `GLASS_PLAN` §1.2
 * calls the browser-level guard "the single most important new guard in this
 * project"; this is the cheap JavaScript half of it, at the one place in the
 * app that sets inline transforms imperatively.
 */
function assertNotAboveFence(target: gsap.TweenTarget, where: string): void {
  if (!import.meta.env.DEV) return;
  const nodes: unknown[] = Array.isArray(target) ? target : [target];
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
    if (node.classList.contains('wurxbase-root')) continue;
    if (!node.querySelector('.wurxbase-root')) continue;
    throw new Error(
      `[motion/gsap] ${where}: this target is an ANCESTOR of \`.wurxbase-root\`. ` +
        'A transform on it makes it the containing block for every `position: fixed` ' +
        "descendant, which is the fault that put the vendored admin app's modals 3,413px " +
        'down the page (GLASS_PLAN §1.2). Animate something inside the fence, or nothing.'
    );
  }
}

/* ------------------------------------------------------- loading gsap --- */

type GsapApi = typeof gsap;

let loading: Promise<GsapApi> | null = null;
let loaded: GsapApi | null = null;

/**
 * Plugins that must never be registered, and why. Checked by name so it holds
 * however the plugin is imported.
 */
const BANNED_PLUGINS: Readonly<Record<string, string>> = {
  ScrollTrigger:
    'it makes GSAP a second scroll authority, which is the exact risk DECISIONS.md flags for 2026-10-14. Scroll-driven work uses Motion `useScroll`, which reads the position Lenis writes.',
  ScrollSmoother: 'Lenis is the smooth-scroll implementation. Two is one too many.',
  ScrollToPlugin:
    'programmatic scrolling goes through `useScrollApi().scrollTo`, so it eases through Lenis when Lenis is driving.',
  Observer:
    'it binds wheel and touch gestures, which Lenis owns. If you need a gesture, take it from Motion or from a plain listener on the element itself.',
};

const registered = new Set<unknown>();

/**
 * Register GSAP plugins, once, whatever order callers arrive in.
 *
 * Idempotent: the same plugin passed twice is registered once, so this is safe
 * to call from a component body or an effect that re-runs.
 */
export function registerGsapPlugins(api: GsapApi, ...plugins: object[]): void {
  const fresh: object[] = [];
  for (const plugin of plugins) {
    const name =
      (plugin as { name?: string }).name ??
      (plugin as { constructor?: { name?: string } }).constructor?.name ??
      '';
    const banned = BANNED_PLUGINS[name];
    if (banned) {
      throw new Error(
        `[motion/gsap] ${name} must not be registered in this app: ${banned} See docs/guides/MOTION.md.`
      );
    }
    if (registered.has(plugin)) continue;
    registered.add(plugin);
    fresh.push(plugin);
  }
  if (fresh.length > 0) api.registerPlugin(...fresh);
}

/**
 * Load GSAP, configure it once, and hand back the api.
 *
 * Everything in `gsap.defaults` here is a decision, not a taste: a short
 * duration because this app animates to confirm an action rather than to put on
 * a show, `power2.out` because motion should decelerate into place, and
 * `overwrite: 'auto'` because a tween left fighting another tween over the same
 * property is the commonest GSAP bug there is.
 */
export function loadGsap(): Promise<GsapApi> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import('gsap').then(({ gsap: api }) => {
    api.defaults({ duration: 0.4, ease: 'power2.out', overwrite: 'auto' });
    api.config({ nullTargetWarn: import.meta.env.DEV, force3D: true });
    loaded = api;
    return api;
  });
  return loading;
}

/* ------------------------------------------------------- the facade ----- */

/**
 * A timeline you can only put legal things on.
 *
 * Every method narrows its vars to `MotionSafeVars`, so a `filter` or a `width`
 * is a type error where you write it rather than a rendering bug somebody finds
 * later. `raw` is the escape hatch for the genuinely unusual — reaching for it
 * means you are outside the rules above, so say why in a comment.
 */
export type SafeTimeline = {
  to: (
    target: gsap.TweenTarget,
    vars: MotionSafeVars,
    position?: TimelinePosition
  ) => SafeTimeline;
  from: (
    target: gsap.TweenTarget,
    vars: MotionSafeVars,
    position?: TimelinePosition
  ) => SafeTimeline;
  fromTo: (
    target: gsap.TweenTarget,
    from: MotionSafeVars,
    to: MotionSafeVars,
    position?: TimelinePosition
  ) => SafeTimeline;
  set: (target: gsap.TweenTarget, vars: MotionSafeVars) => SafeTimeline;
  addLabel: (label: string, position?: TimelinePosition) => SafeTimeline;
  call: (fn: () => void, position?: TimelinePosition) => SafeTimeline;
  /** The underlying GSAP timeline. Unguarded on purpose. */
  raw: gsap.core.Timeline;
};

function wrap(tl: gsap.core.Timeline): SafeTimeline {
  const safe: SafeTimeline = {
    to: (target, vars, position) => {
      assertNotAboveFence(target, 'timeline.to');
      tl.to(target, sanitise(vars, 'timeline.to'), position);
      return safe;
    },
    from: (target, vars, position) => {
      assertNotAboveFence(target, 'timeline.from');
      tl.from(target, sanitise(vars, 'timeline.from'), position);
      return safe;
    },
    fromTo: (target, from, to, position) => {
      assertNotAboveFence(target, 'timeline.fromTo');
      tl.fromTo(
        target,
        sanitise(from, 'timeline.fromTo'),
        sanitise(to, 'timeline.fromTo'),
        position
      );
      return safe;
    },
    set: (target, vars) => {
      assertNotAboveFence(target, 'timeline.set');
      tl.set(target, sanitise(vars, 'timeline.set'));
      return safe;
    },
    addLabel: (label, position) => {
      tl.addLabel(label, position);
      return safe;
    },
    call: (fn, position) => {
      tl.call(fn, undefined, position);
      return safe;
    },
    raw: tl,
  };
  return safe;
}

/* ------------------------------------------------------------- the hook - */

export type UseGsapTimelineOptions = {
  /**
   * The element GSAP's selector strings resolve inside, and the boundary its
   * cleanup reverts. Pass it. A timeline that can select anything on the page
   * will eventually select the wrong thing.
   */
  scope?: RefObject<Element | null>;
  /** Rebuild when these change. Same contract as `useEffect`. */
  deps?: DependencyList;
  /** Build nothing at all while this is false (data not loaded yet, etc.). */
  enabled?: boolean;
};

/**
 * Build a GSAP timeline for as long as a component is mounted, and take every
 * trace of it back out again when the component goes.
 *
 * WHY `gsap.context` RATHER THAN KEEPING THE TIMELINE: `ctx.revert()` removes
 * the inline styles GSAP wrote as well as killing the tweens. Without it a
 * remount leaves `transform: translateY(…)` sitting on an element forever,
 * which is both a wrong-looking screen and — on the wrong element — a
 * containing block for fixed overlays. See the fence note at the top.
 *
 * REDUCED MOTION: the timeline is still built, then jumped to its end and
 * paused, so whatever the sequence was supposed to arrive at is simply there on
 * the first frame.
 */
export function useGsapTimeline(
  build: (tl: SafeTimeline, api: GsapApi) => void,
  { scope, deps = [], enabled = true }: UseGsapTimelineOptions = {}
): void {
  const reduced = useReducedMotion();

  // The build closure is read at effect time, not captured in the dep list, so
  // an inline arrow does not rebuild the timeline on every render. `deps` is
  // the stated contract for when it should rebuild.
  const latest = useRef(build);
  latest.current = build;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let ctx: gsap.Context | null = null;

    void loadGsap().then((api) => {
      if (cancelled) return;
      ctx = api.context(() => {
        const tl = api.timeline({ paused: true });
        latest.current(wrap(tl), api);
        if (reduced) {
          // End state, no motion. `true` suppresses the callbacks, so an
          // `onComplete` that opens a dialog does not fire on mount.
          tl.progress(1, true).pause();
        } else {
          tl.play();
        }
      }, scope?.current ?? undefined);
    });

    return () => {
      cancelled = true;
      ctx?.revert();
    };
    // `deps` must be a stable LENGTH across renders, exactly as for any hook's
    // dependency array. React compares by index, not by name. The spread is the
    // same shape GSAP's own `useGSAP` uses and the linter cannot see through it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reduced, scope, ...deps]);
}

/**
 * A one-off tween, for the rare case that is genuinely not a sequence and
 * genuinely not reachable from Motion. Resolves once the tween is created, not
 * when it finishes.
 *
 * Prefer `useGsapTimeline`. A tween with no owner is a tween nobody cleans up.
 */
export async function gsapTo(
  target: gsap.TweenTarget,
  vars: MotionSafeVars
): Promise<gsap.core.Tween> {
  assertNotAboveFence(target, 'gsapTo');
  const api = await loadGsap();
  const safe = sanitise(vars, 'gsapTo');
  const tween = api.to(target, safe);
  // Reduced motion is read from the media query rather than a hook, because
  // this is callable outside React.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    tween.progress(1, true).pause();
  }
  return tween;
}
