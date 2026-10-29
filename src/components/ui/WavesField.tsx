import { useEffect, useRef, useState } from 'react';
import type { VantaEffect } from 'vanta/src/vanta.waves.js';

/**
 * VANTA WAVES — Rashid's background, as an UPGRADE over the CSS aurora.
 *
 * His snippet, verbatim, is the thing being honoured:
 *
 *   VANTA.WAVES({ el, mouseControls: true, touchControls: true,
 *                 gyroControls: false, minHeight: 200, minWidth: 200,
 *                 scale: 1, scaleMobile: 1 })
 *   color 0x5588 · shininess 30 · waveHeight 15 · waveSpeed 1 · zoom 1
 *
 * Three of those values are deliberately NOT passed through as written, and
 * each change has a measurement or a guard behind it. They are marked ▲ below.
 *
 * ── WHY THIS IS AN UPGRADE AND NOT THE BACKGROUND ──────────────────────────
 *
 * `AuroraBackground` always renders the CSS aurora. This component mounts ON
 * TOP of it, on a transparent canvas, and only when the device can afford it.
 * So the aurora is not a "fallback" that appears when something fails — it is
 * the ground, always painted, and the waves are the layer that may or may not
 * arrive. Nothing can flash, nothing can end up blank, and the page is
 * finished before three.js has downloaded a byte.
 *
 * ── WHAT IT COSTS, MEASURED ────────────────────────────────────────────────
 *
 * three.js r134 plus Vanta is ~150KB gzipped, which is larger than every
 * creator route chunk in this app put together (1.4K–17.7K each), and step 11
 * of the current project is about making that bundle SMALLER. So both packages
 * are behind a dynamic `import()` inside the effect below. They become their
 * own chunk, fetched after the page is interactive, and only on the devices
 * that pass the gate. The initial page load pays nothing.
 *
 * The frame cost is the real risk, and it is NOT the GPU. Vanta's WAVES
 * `onUpdate` walks all 8,181 vertices of a 100×80 mesh in JavaScript every
 * frame — a `sin`, a `cos`, a `sqrt` and a `pow` each — and then calls
 * `computeVertexNormals()` over 16,160 triangles. That is main-thread work, on
 * the same thread as React and as the landing page's scroll handlers, and
 * Rashid has already reported the home page juddering. Hence `FRAME_MS`,
 * hence the gate, and hence `prefers-reduced-motion` and a hidden tab both
 * stopping it dead.
 *
 * ── THE GATE: WHEN THE WAVES DO NOT RUN AT ALL ─────────────────────────────
 *
 * Every one of these falls back to the CSS aurora alone:
 *
 *   1. `prefers-reduced-motion: reduce`. Reactive — flipping it mid-session
 *      unmounts the field and destroys the instance.
 *   2. Save-Data, or a `slow-2g`/`2g`/`3g` effective type. The visitor or the
 *      network asking for less, in as many words. Same test, same spelling, as
 *      `HeroVisual.tsx`'s `detect()` — see THRIFTY below.
 *   3. A low-end device: fewer than 4 logical cores, or under 4GB of reported
 *      memory. Unknown counts as fine, because Safari and Firefox do not
 *      report `deviceMemory` at all and penalising them would be guessing.
 *   4. No WebGL.
 *   5. Narrower than `lg` (64rem). THE PHONE RULE, and the one that is a
 *      judgement call rather than a fact: see `WIDE`.
 *
 * `localStorage['wx.waves']` overrides 3 and 5 in either direction, spelled
 * exactly like `wx.smooth-scroll` in `lib/motion/flags.ts` and for the same
 * reason: so Rashid can try this on his own phone, and turn it off on a
 * machine where it misbehaves, without waiting for a deploy. It cannot
 * override 1, 2 or 4 — those are the visitor's or the hardware's answer, not
 * a preference.
 */

/* ============================================================ the tuning == */

/**
 * Tailwind's `lg`, in rem so it tracks the root font size exactly as `lg:`
 * does. `HeroVisual.tsx` gates its hero video on the same query.
 *
 * ▲ THE PHONE RULE. Most of this product's visitors are TikTok creators on
 * phones, and they are exactly the people who should not pay for decoration —
 * the same argument `HeroVisual` makes about its 3MB video, which also renders
 * nothing below `lg`. On a phone this would be 150KB of JavaScript, a full-DPR
 * GL context and an 8,000-vertex JS loop per frame, all behind a page that is
 * already juddering. The CSS aurora is the better answer there until somebody
 * profiles this on a real mid-range Android, which no test in this repo can
 * do (`scripts/lib/browser.mjs` runs Chromium with `--disable-gpu`).
 *
 * `wx.waves = 'on'` is how that gets tried without a deploy.
 */
const WIDE = '(min-width: 64rem)';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** The `localStorage` escape hatch. Spelled like the app's other keys. */
const WAVES_KEY = 'wx.waves';

/**
 * ▲ 30fps, not 60. The per-frame cost is the vertex loop plus
 * `computeVertexNormals()`, both pure main-thread JavaScript, so halving the
 * frame rate halves it. Water at `waveSpeed: 1` moves slowly enough that 30fps
 * is not visible as stepping, and the alternative — a background that takes
 * 8ms of every 16ms frame away from the page in front of it — is.
 */
const FRAME_MS = 1000 / 30;

/**
 * ▲ `scale: 1` becomes a DPR CAP. Vanta divides: it calls
 * `setPixelRatio(devicePixelRatio / scale)`, so his `scale: 1` means "render
 * at full device pixel ratio" — on a retina laptop that is 4x the fragments of
 * a 1x render, with `antialias: true` hard-coded on top. Capping the effective
 * ratio at 1.25 is invisible on a field that is all soft gradients and is the
 * only fragment-cost lever the package exposes.
 */
const MAX_PIXEL_RATIO = 1.25;

/** Falls back to his `0x5588` if the token is missing or unreadable. */
const FALLBACK_COLOR = '#005588';

/* ============================================================== the gate == */

interface Link {
  saveData?: boolean;
  effectiveType?: string;
}

type Caps = Navigator & {
  connection?: Link;
  deviceMemory?: number;
};

/**
 * THRIFTY — the visitor or the network asking for less.
 *
 * This is `detect()` from `HeroVisual.tsx`, same two signals and same
 * spelling, deliberately not re-invented as a different policy.
 *
 * It is COPIED rather than imported, and that is a compromise worth naming:
 * `detect()` is module-private to `HeroVisual.tsx`, which is held by another
 * agent in this pass, so exporting it was not available. The right end state
 * is one `src/lib/` helper that both files import, and that is a five-line
 * follow-up once both files are free. Keeping the field names identical
 * (`thrifty`, `quiet`) is so the two read as one contract until then.
 */
function thrifty(): boolean {
  const link = (navigator as Caps).connection;
  const type = link?.effectiveType;
  return link?.saveData === true || type === 'slow-2g' || type === '2g' || type === '3g';
}

/**
 * A device that will not enjoy this. Unknown is treated as capable, for the
 * same reason `HeroVisual` treats an unknown `effectiveType` as fast: Safari
 * and Firefox do not report `deviceMemory` at all, and most of them are not
 * slow machines.
 */
function lowEnd(): boolean {
  const nav = navigator as Caps;
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  return cores < 4 || memory < 4;
}

/**
 * Is there WebGL at all? Asked once per page load on a throwaway canvas, and
 * the context is handed straight back: asking the question costs a real GL
 * context, and Chromium caps live contexts at 16.
 */
let webglAnswer: boolean | null = null;
function hasWebGL(): boolean {
  if (webglAnswer !== null) return webglAnswer;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    webglAnswer = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglAnswer = false;
  }
  return webglAnswer;
}

function override(): 'on' | 'off' | null {
  try {
    const raw = window.localStorage.getItem(WAVES_KEY);
    if (raw === 'on' || raw === '1' || raw === 'true') return 'on';
    if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  } catch {
    /* Private mode with storage blocked. No opinion, fall through. */
  }
  return null;
}

/**
 * The whole gate, in one boolean, re-evaluated when reduced motion or the
 * viewport width changes. Everything else here is a fact about the device that
 * does not change while the page is open.
 *
 * Neither this nor `useWavesEligible` is exported: `WavesField` is the only
 * caller, and oxlint's `react(only-export-components)` is right that a file
 * exporting both a component and a hook breaks fast refresh. If something else
 * ever needs the gate, it moves to its own file rather than being exported
 * from here.
 */
function eligible(): boolean {
  /* 1, 2 and 4 are not overridable. Nobody opts into a GL loop they asked a
     browser setting to stop, and nothing can opt into a GPU that is absent. */
  if (window.matchMedia(REDUCED).matches) return false;
  if (thrifty()) return false;
  if (!hasWebGL()) return false;

  const forced = override();
  if (forced) return forced === 'on';

  /* A weak machine no longer loses the background: it gets a STILL picture
     (a few frames, then the loop stops) instead of nothing. See `still` below. */

  /*
   * THE PHONE RULE IS GONE, 2026-10-17, AND RASHID CHOSE IT WITH THE NUMBER
   * IN FRONT OF HIM.
   *
   * It used to end `return window.matchMedia(WIDE).matches` — waves on
   * desktop only. The measurement behind that gate has not changed and is not
   * disputed: Vanta's `onUpdate` walks every vertex in JavaScript each frame,
   * allocating per vertex and then recomputing normals, which came to roughly
   * 41ms of main-thread work per frame at phone-class CPU and +40% blocked
   * main-thread time during a scroll. It is CPU vertex animation, not a
   * shader, so no device-pixel-ratio cap reduces it.
   *
   * He was shown that, and the alternative of a free static texture, and
   * asked for the real thing on phones anyway. So the width gate is removed
   * and the honest cost is recorded here instead of being quietly enforced.
   *
   * The gates that remain are the ones that are not about taste: a browser
   * that asked for less motion, a device asking to save data, no WebGL at
   * all, and genuinely low-end hardware — that last one still overridable
   * with `localStorage['wx.waves'] = 'on'`.
   *
   * `WIDE` is still used by the resize listener in `useWavesEligible`, which
   * is harmless, and kept so re-gating by width is a one-line change back.
   */
  return true;
}

function useWavesEligible(): boolean {
  /*
   * An initialiser, not an effect, so the FIRST paint already knows the
   * answer. A mount-then-decide would start the download on every device and
   * then throw it away on the phones.
   */
  const [ok, setOk] = useState(eligible);

  useEffect(() => {
    const reduced = window.matchMedia(REDUCED);
    const wide = window.matchMedia(WIDE);
    const sync = () => setOk(eligible());
    reduced.addEventListener('change', sync);
    wide.addEventListener('change', sync);
    /* Re-ask on mount: a media query can have changed between the initialiser
       and the effect, and in development StrictMode guarantees it is asked
       twice anyway. */
    sync();
    return () => {
      reduced.removeEventListener('change', sync);
      wide.removeEventListener('change', sync);
    };
  }, []);

  return ok;
}

/* ============================================================ the colour == */

/**
 * `--wx-waves-color` from `tokens.css`, which declares it in BOTH theme
 * blocks. Vanta WAVES takes ONE colour and his `0x5588` is a very dark navy
 * that reads as a hole on a white page, so light mode needs its own value and
 * this is how it gets one.
 *
 * `THREE.Color#set` accepts a CSS hex string, so the token's own text is
 * passed through untouched — but only after it is checked, because `set()` on
 * something it cannot parse logs a warning and leaves the material black.
 * A colour this project cannot read falls back to his value rather than to a
 * guess.
 */
function readColor(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--wx-waves-color')
    .trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : FALLBACK_COLOR;
}

/* ========================================================= the component == */

export function WavesField({ intensity = 'full' }: { intensity?: 'full' | 'subtle' }) {
  const ok = useWavesEligible();
  const hostRef = useRef<HTMLDivElement | null>(null);

  /* Read inside the effect, so changing `intensity` never tears down the GL
     context. */
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    if (!ok) return;
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let effect: VantaEffect | null = null;
    /** Everything the async setup wired up, so cleanup works whenever it runs. */
    let teardown: (() => void) | null = null;

    void (async () => {
      /*
       * THE LAZY CHUNK. This is the only place either package is named, and
       * both names are static strings so Rollup can see them and split them
       * out. The ESM source is imported rather than `vanta/dist/*.min.js`
       * because that bundle's webpack wrapper returns an empty exports object
       * — its effect is only reachable through `window.VANTA` — while
       * `src/vanta.waves.js` has a real `export default`. (`src/helpers.js`
       * does assign `Number.prototype.clamp` on the way past. It is confined
       * to this chunk and this is not the file that can fix it.)
       */
      const [THREE, waves] = await Promise.all([
        import('three'),
        import('vanta/src/vanta.waves.js'),
      ]);
      if (cancelled || !hostRef.current) return;

      const dpr = window.devicePixelRatio || 1;
      /* Vanta DIVIDES by this, so above 1 means fewer pixels. See MAX_PIXEL_RATIO. */
      const scale = Math.max(1, dpr / MAX_PIXEL_RATIO);
      const subtle = intensityRef.current === 'subtle';

      const instance = waves.default({
        el: hostRef.current,
        THREE,

        /* ---- his snippet ---- */
        mouseControls: true,
        /*
         * ▲ touchControls OFF. Vanta binds `touchstart` and `touchmove` on
         * WINDOW, and although the handler never calls `preventDefault` (so it
         * would not actually block scrolling), it does a
         * `getBoundingClientRect()` and a camera update on every touchmove —
         * work on the main thread during the one interaction that must never
         * stutter. There is nothing to gain: this is the background, there is
         * no reason to steer it with a thumb, and the field only runs at `lg`
         * and wider in the first place. A background that eats scroll is worse
         * than no background.
         */
        touchControls: false,
        gyroControls: false,
        minHeight: 200,
        minWidth: 200,
        scale,
        scaleMobile: scale,
        color: readColor(),
        shininess: 30,
        waveHeight: subtle ? 9 : 15,
        waveSpeed: 1,
        zoom: 1,

        /*
         * TRANSPARENT, so the CSS aurora underneath is the sky behind the
         * water instead of being painted over. Vanta's default is alpha 1 with
         * no `backgroundColor`, which clears to black.
         */
        backgroundAlpha: 0,
      });

      if (cancelled) {
        instance.destroy();
        return;
      }
      effect = instance;

      /* The live field is drawing: let go of the still picture underneath (see
         `--wx-static-bg` in global.css), two frames on so there is no blank. */
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (!cancelled) document.documentElement.classList.add('wx-waves-live');
        })
      );

      /*
       * THE `scroll` LISTENER GOES, AND NOTHING IS LOST BY IT.
       *
       * `mouseControls: true` binds `windowMouseMoveWrapper` to BOTH
       * `mousemove` and `scroll`. A scroll event has no `clientX`/`clientY`,
       * so on that path the handler computes `undefined - rect.left` → NaN,
       * fails its own bounds check and returns having done nothing except a
       * `getBoundingClientRect()` — a forced layout flush on every scroll
       * event, on the page Rashid reports juddering. The mousemove binding,
       * which is the parallax he actually asked for, stays.
       */
      window.removeEventListener('scroll', instance.windowMouseMoveWrapper);

      /* ------------------------------------------------- the frame loop --- */

      /*
       * Vanta re-arms with `window.requestAnimationFrame(this.animationLoop)`,
       * reading the property each time, so replacing it throttles the loop
       * without forking the package. `inner` is the method Vanta bound in its
       * own constructor, so calling it re-arms through the wrapper below.
       */
      const inner = instance.animationLoop.bind(instance);
      let paused = false;
      let last = 0;
      /* Weak devices draw the pattern, let it settle for a few frames, then stop. */
      const still = lowEnd();
      let drawn = 0;

      const loop = () => {
        if (paused) {
          instance.req = 0;
          return;
        }
        if (still && drawn >= 4) {
          instance.req = 0;
          return;
        }
        const now = performance.now();
        if (now - last < FRAME_MS - 1) {
          instance.req = window.requestAnimationFrame(loop);
          return;
        }
        last = now;
        drawn += 1;
        inner();
      };
      instance.animationLoop = loop;

      const pause = () => {
        if (paused) return;
        paused = true;
        if (instance.req) window.cancelAnimationFrame(instance.req);
        instance.req = 0;
      };

      const resume = () => {
        if (!paused) return;
        paused = false;
        last = 0;
        loop();
      };

      /*
       * A WEBGL LOOP BEHIND A BACKGROUND TAB IS A BATTERY BUG, and Vanta does
       * not stop on its own — its `isOnScreen()` skips the render but keeps
       * requesting frames forever.
       */
      const onVisibility = () => (document.hidden ? pause() : resume());
      document.addEventListener('visibilitychange', onVisibility);
      if (document.hidden) pause();

      /*
       * OFF-SCREEN IS FREE. This layer is `position: fixed`, so on its own
       * this earns little; what it catches is every way the host can stop
       * being painted without the tab being hidden — a route whose container
       * is `display: none`, an ancestor collapsed to zero size. Each of those
       * is a GL loop running forever drawing nothing.
       */
      const seen = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) resume();
        else pause();
      });
      seen.observe(hostRef.current);

      /* --------------------------------------------------------- theme ---- */

      /*
       * `setOptions`, NOT a remount. `onUpdate` re-reads `options.color` every
       * frame, so the new colour lands on the next frame and the GL context,
       * the mesh and the 8,000-vertex buffer all survive the swap. Rebuilding
       * them to change one colour would be a visible stall on every theme
       * toggle.
       */
      const themes = new MutationObserver(() => {
        instance.setOptions({ color: readColor() });
        /* Paused is not stale: push one frame so the colour actually lands. */
        if (paused) inner();
      });
      themes.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      teardown = () => {
        document.removeEventListener('visibilitychange', onVisibility);
        seen.disconnect();
        themes.disconnect();
        pause();
        /*
         * Vanta's `destroy()` disposes the geometry and materials and detaches
         * the canvas, but it never touches the renderer — and it nulls
         * `this.renderer` on the way out, so the handle has to be taken first.
         * Releasing the context matters: Chromium kills the OLDEST live context
         * once there are 16, which on a long session of route changes is how a
         * background quietly goes blank.
         */
        const renderer = instance.renderer;
        instance.destroy();
        renderer?.forceContextLoss?.();
        renderer?.dispose?.();
      };
    })().catch(() => {
      /*
       * A FAILED CHUNK IS NOT AN ERROR WORTH BREAKING ANYTHING FOR.
       *
       * This was `void (async () => { ... })()` with nothing catching it, so a
       * `three`/`vanta` chunk that failed to arrive — a flaky first load on a
       * phone, exactly the case this field was just un-gated for — became an
       * unhandled rejection. It could not blank the app, because this runs in
       * an effect rather than in render, but it logged a hard error for a
       * decoration and left nothing to say what happened.
       *
       * The CSS ground underneath has already painted and always does, so the
       * honest behaviour is simply: no waves, no noise.
       */
    });

    return () => {
      cancelled = true;
      document.documentElement.classList.remove('wx-waves-live');
      if (teardown) teardown();
      else effect?.destroy();
      effect = null;
    };
  }, [ok]);

  if (!ok) return null;

  return (
    /*
     * `position: fixed` ON THIS ELEMENT, not left to the mount point.
     *
     * Two of the five mount sites pass `absolute inset-0` (`AuthShell`,
     * `Apply`), and Vanta sizes its canvas from `el.offsetWidth/offsetHeight`.
     * Taking the position from the wrapper would therefore hand it the height
     * of the whole scrolling document on those two pages — a canvas several
     * thousand pixels tall, scrolling with the content. Fixed here, it is the
     * viewport on all five, and the background does not scroll.
     *
     * `data-wx-waves` is a hook for `scripts/`, not for CSS.
     *
     * NOTHING IN THIS STYLE OBJECT IS A `filter` OR A `backdrop-filter`, AND
     * NOTHING EVER MAY BE. §1.2: either one here makes this element the
     * containing block for every `position: fixed` descendant in the document,
     * which is the fault that put the Paid Collabs modals 3,413px down the
     * page three times. `scripts/verify/design/check-backdrop-ancestry.mjs` asserts it.
     * `opacity` is safe and is not on that list — it creates a stacking
     * context, not a containing block — and it is static, never animated, so
     * the blur budget's §4.3 rule is untouched too.
     *
     * The opacity comes from `--wx-waves-opacity`, which `tokens.css` declares
     * per theme, so the field's weight is a token decision and not a number
     * buried in a component. `subtle` is the signed-in screens, where there is
     * real work on top of the ground.
     */
    <div
      ref={hostRef}
      aria-hidden
      data-wx-waves={intensity}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        /*
         * THE SIGNED-IN SCREENS NO LONGER DIM THE PATTERN, 2026-10-19.
         *
         * This was `calc(var(--wx-waves-opacity) * 0.55)` for `subtle`, a
         * weight chosen when the ground behind the app was a loud coloured
         * aurora that needed quieting. The ground is neutral now, so the dim
         * only removed the pattern: measured in the signed-in app the host sat
         * at opacity 0.33 against 0.6 on the landing page, and with the glass
         * panels over it Rashid's question was "where did the background go
         * while we redesigned everything?". It is the same 0.6 the contrast
         * sweep was done at, so no text contrast changes. `intensity` still
         * drives `waveHeight` (a flatter mesh behind the app), which is the
         * part of "subtle" that was ever about calm.
         */
        opacity: 'var(--wx-waves-opacity)',
      }}
    />
  );
}
