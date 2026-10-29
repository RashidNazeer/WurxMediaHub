import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTheme } from '@/components/theme/theme-context';
import './hero-visual.css';

/**
 * THE LOOPING PRODUCT ANIMATION, in the hero's right-hand column.
 *
 * 22 seconds, silent, square, one cut per theme with identical timing, and the
 * last frame is the first frame so it loops without a visible restart. Adapted
 * from the `prism-hero` bundle's own `HeroVisual.tsx`; the file picking is its
 * logic, the loading policy below is not — the bundle shipped `preload="auto"`
 * and `autoplay`, which is a 3MB download racing the hero's first paint and a
 * loop that keeps painting while the page is scrolled past it.
 *
 * Media lives in `public/hero/` and is therefore served as-is: Vite never
 * bundles it, never hashes it and never inlines it, which is what you want for
 * a file this size. (The stock footage licence note, `public/hero/CREDITS.md`, was removed 2026-10-30.)
 *
 * ── WHAT A VISITOR ACTUALLY DOWNLOADS ──────────────────────────────────────
 *
 * One poster, then at most one video, and only if all of these hold:
 *
 *   1. The viewport is `lg` or wider. Below that this renders NOTHING — not a
 *      `display: none` video, which still fetches its poster, but no element.
 *      The two-column grid only exists at `lg`; on a phone the hero is one
 *      column, the animation would be a 1:1 block shoving the call to action
 *      below the fold, and its three phone screens would be illegible at
 *      343px anyway. It is decorative (`aria-hidden`), and most of this
 *      product's visitors are on phones, so they are exactly the people who
 *      should not pay megabytes for decoration.
 *   2. First paint is over. The `src` is attached after `load` and an idle
 *      callback, so the video never competes with the hero's own paint.
 *   3. The slot is on screen, per `IntersectionObserver`.
 *   4. Motion is wanted, and the connection is not asking us to go easy:
 *      `prefers-reduced-motion`, `saveData` and a 2g/3g `effectiveType` all
 *      get the poster as a still and fetch no video at all.
 *
 * `preload="none"` is doing real work here: between attaching the `src` and
 * the first `play()` the browser fetches nothing, so an off-screen slot that
 * was armed and then scrolled away never costs a byte.
 *
 * ── WHICH FILE ─────────────────────────────────────────────────────────────
 *
 * Chrome, Edge and Firefox get the transparent WebM, so the page's own ground
 * — rings, glows and all — shows through behind the cards. Safari and every
 * iPhone/iPad browser cannot play transparent video, so they get the MP4 with
 * the page colour painted in, and `hero-visual.css` feathers its edges with a
 * mask (never a `filter`, see §1.2 there).
 *
 * The 1080 cut is only fetched when the slot really is bigger than 720 device
 * pixels AND the link looks fast; a 1x desktop at 1440 renders this at about
 * 518px, so the common desktop case is the 720 file and saves ~2.1MB.
 *
 * THE 1080 PAINTED MP4s ARE NOT SHIPPED (they were 4.7–4.9MB each). The MP4
 * path is Safari and iPad only and it is the deliberately soft one — its edges
 * are masked away — so it takes the 720 cut everywhere and is upscaled on a
 * retina Mac. Nothing on the WebM path is affected.
 */

/** Everything is served from `public/hero/`, so this is a real URL, not an import. */
const BASE = '/hero/';

/** Tailwind's `lg`. In rem so it tracks the root font size exactly as `lg:` does. */
const WIDE = '(min-width: 64rem)';

/** Above this many device pixels across, the 720 cut would be an upscale. */
const SMALL_CUT = 720;

interface Link {
  saveData?: boolean;
  effectiveType?: string;
}

/**
 * The browser's own facts, read once. None of this changes while the page is
 * open — a visitor does not switch from Safari to Firefox mid-scroll — so it
 * is state with an initialiser rather than an effect, which is also what puts
 * the poster on screen in the FIRST paint instead of the second.
 */
function detect(): { alpha: boolean; thrifty: boolean; fast: boolean } {
  const ua = navigator.userAgent;
  const ios =
    /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  const alpha =
    !ios && !safari && document.createElement('video').canPlayType('video/webm; codecs="vp9"') !== '';

  const link = (navigator as Navigator & { connection?: Link }).connection;
  const type = link?.effectiveType;
  return {
    alpha,
    /* Save-Data is the visitor asking for less, in as many words. A 2g or 3g
       effective type is the same request made by the network. */
    thrifty: link?.saveData === true || type === 'slow-2g' || type === '2g' || type === '3g',
    /* Unknown is treated as fast: Safari and Firefox do not implement this at
       all, and penalising them for it would be guessing. */
    fast: type === undefined || type === '4g',
  };
}

export function HeroVisual() {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  const quiet = useReducedMotion() ?? false;

  const box = useRef<HTMLDivElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  /** Where the animation had got to, so a theme swap can carry on from there. */
  const at = useRef(0);

  const [env] = useState(detect);
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  const [painted, setPainted] = useState(false);
  const [seen, setSeen] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  /** `null` until the slot has been measured; the video has no `src` before that. */
  const [large, setLarge] = useState<boolean | null>(null);
  const [broken, setBroken] = useState(false);

  /*
   * Poster only, no video fetched at all.
   *
   * `!env.alpha` JOINS THIS LIST, 2026-10-16. Rashid: "on mobile devices the
   * background of video is not completely transparent".
   *
   * That path served the PAINTED MP4, which has the page colour baked into
   * every frame — on an iPhone it is a filled rectangle sitting on the glass
   * ground, which is exactly what he is seeing. Measured out of the files:
   * the light cut's corner is rgb(229,231,239) and its CENTRE, the phone
   * artwork itself, is rgb(224,219,248). Ten levels apart. No blend mode can
   * separate a backdrop from its content at that distance — `screen` or
   * `multiply` would eat the phone along with the field behind it, so the
   * usual white-on-black trick is not available here.
   *
   * The only format Safari will play with real transparency is HEVC WITH AN
   * ALPHA CHANNEL, which needs Apple's own encoder on a Mac; ffmpeg here
   * cannot produce it. So until such an export exists, those browsers get the
   * transparent POSTER instead of an opaque video. A still with a correct
   * background beats a moving rectangle with a wrong one.
   *
   * REVERSED SAME DAY, on his instruction: "the video stopped playing on mobile
   * devices fix it." Everything above is still true — the MP4 is a painted
   * rectangle and there is no transparent cut for Safari — so this is a choice
   * between two wrong things, and he chose motion. The painted cut is back, and
   * `hero-visual.css` now hides its field far harder than the bundle did: a 26%
   * feather on each axis plus a radial mask on the corners, against the
   * original 7%.
   *
   * THE REAL FIX IS AN ASSET, NOT CODE. Safari plays transparent video only as
   * HEVC WITH AN ALPHA CHANNEL, which needs Apple's encoder on a Mac. ffmpeg
   * here cannot even read the existing WebM's alpha plane to convert it
   * ("Requested planes not available"), and the source bundle contains no
   * alpha-bearing master — only these same WebMs, the painted MP4s and two
   * still posters. Given that export, `!env.alpha` stops being a branch at all.
   */
  const still = quiet || env.thrifty || broken;

  const stem = `${BASE}prism-hero${dark ? '-dark' : ''}${large ? '' : '-720'}`;
  const src =
    still || large === null ? undefined : env.alpha ? `${stem}-alpha.webm` : `${stem}.mp4`;
  /*
   * WEBP, NOT PNG, ON THE ALPHA PATH. The poster is the one thing this
   * component adds to FIRST PAINT -- it is fetched before any video and it is
   * what the visitor looks at while the video arrives -- and it was a 203 KB
   * PNG. Re-encoded at q82 it is 42.6 KB light and 29.0 KB dark, 79% and 84%
   * smaller, with the alpha intact (ffprobe reports yuva420p; a flattened
   * poster would have painted a hard square over the ground).
   *
   * ALWAYS THE WEBP NOW, 2026-10-16. The JPG was for the MP4 path, which is
   * gone: a JPG cannot carry transparency, so serving it to Safari was the
   * second half of the opaque-rectangle bug. Safari has supported WebP with
   * alpha since 14, which is well below this product's floor.
   */
  const poster = `${BASE}prism-hero${dark ? '-dark' : ''}-poster.webp`;

  /* The column itself comes and goes with the breakpoint. */
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /*
   * FIRST PAINT FIRST. The hero is above the fold, so the observer below fires
   * immediately and without this latch "load when visible" would mean "load
   * during the hero's first paint" — the exact thing `preload="auto"` was
   * dropped for.
   */
  useEffect(() => {
    let done = false;
    const go = () => {
      if (!done) setPainted(true);
    };
    let idle = 0;
    let timer = 0;
    let cap = 0;
    const soon = () => {
      /* `typeof`, not `'requestIdleCallback' in window`: the lib declares it,
         so `in` narrows the else branch to `never` and the fallback stops
         compiling, while Safari still does not actually ship it. */
      if (typeof window.requestIdleCallback === 'function') {
        idle = window.requestIdleCallback(go, { timeout: 300 });
      } else {
        timer = window.setTimeout(go, 150);
      }
    };
    if (document.readyState === 'complete') soon();
    else window.addEventListener('load', soon, { once: true });
    /*
     * A HARD CEILING ON THE WAIT, 2026-10-15. Rashid: "it took very long to
     * load".
     *
     * Deferring to `load` is right in principle and far too patient in
     * practice: `load` does not fire until EVERY other subresource on the
     * page has finished -- the shader, the background photograph, the brand
     * band's eight logos, every chunk of JS -- and only then did this wait up
     * to another 2 s of idle before it so much as attached a `src`. On a cold
     * visit that is seconds of an empty square before the download even
     * starts.
     *
     * So `load` and the idle slot become an OPPORTUNITY, not a precondition:
     * whichever comes first, the video is armed by 1.2 s. The ordering it was
     * protecting is still protected, because `preload="none"` means arming
     * costs nothing by itself and the real fetch is still gated on the
     * observer.
     */
    cap = window.setTimeout(go, 1200);
    return () => {
      done = true;
      window.removeEventListener('load', soon);
      if (idle) window.cancelIdleCallback(idle);
      if (timer) window.clearTimeout(timer);
      if (cap) window.clearTimeout(cap);
    };
  }, []);

  /*
   * ONLY PLAY WHEN VISIBLE. A 22-second loop painting behind five sections of
   * scrolled-past page is pure battery, and on a laptop it is a fan.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setOnScreen(entry.isIntersecting);
        if (entry.isIntersecting) setSeen(true);
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wide, still]);

  /*
   * ARM. Measured, not guessed: by the time both latches are up the slot has a
   * real width, so the 720/1080 choice is made against the pixels this element
   * will actually fill rather than against a breakpoint.
   */
  useEffect(() => {
    if (still || !painted || !seen || large !== null) return;
    const width = box.current?.clientWidth ?? 0;
    /* THE 1080 CUT IS DESKTOP-ONLY, deliberately. Below `lg` a retina phone
       measures well past SMALL_CUT -- 375 CSS px at DPR 3 is 1125 -- and would
       pull the 5.2 MB file over exactly the connection least able to afford
       it. `wide` no longer decides WHETHER the video renders, only whether the
       large cut is eligible. */
    setLarge(wide && env.fast && width * (window.devicePixelRatio || 1) > SMALL_CUT);
  }, [wide, still, painted, seen, large, env.fast]);

  /*
   * A THEME SWITCH CARRIES ON FROM THE SAME MOMENT. Both cuts are frame-for-
   * frame identical in timing, so the swap only has to restore the clock. This
   * effect is declared BEFORE the one that calls `play()` on purpose: effects
   * run in order, so the listener is attached before anything can make the new
   * file start loading.
   */
  useEffect(() => {
    const el = video.current;
    if (!el || !src) return;
    const resume = at.current;
    const onReady = () => {
      if (resume <= 0) return;
      const span = el.duration;
      try {
        el.currentTime = Number.isFinite(span) && span > 0 ? resume % span : resume;
      } catch {
        /* A seek can be refused before the file is seekable; the loop recovers. */
      }
    };
    el.addEventListener('loadedmetadata', onReady, { once: true });
    return () => el.removeEventListener('loadedmetadata', onReady);
  }, [src]);

  /* Play and pause. `muted` is set on the element too: an unmuted autoplay is
     refused outright, and React has historically dropped the attribute. */
  useEffect(() => {
    const el = video.current;
    if (!el || !src) return;
    el.muted = true;
    if (onScreen) void el.play().catch(() => undefined);
    else el.pause();
  }, [onScreen, src]);

  /*
   * IT RENDERS ON A PHONE NOW. Rashid, 2026-10-15: "Video is not visible on
   * phone".
   *
   * This used to `return null` below `lg`, on the reasoning that a decorative
   * 1:1 video is a poor thing to hand a phone. He has overruled that, and the
   * cost is still bounded by everything else in this component rather than by
   * the breakpoint: `preload="none"` means the element costs nothing until the
   * observer says it is on screen, the 1080 cut is now desktop-only (above),
   * and reduced-motion, Save-Data and a 2g/3g `effectiveType` still get the
   * poster and fetch no video at all.
   *
   * The dead-gap worry that justified `null` over `display: none` does not
   * apply any more either: the grid item has real content at every width, so
   * the hero's `gap-12` is now separating two things instead of opening a
   * 3rem band under the copy.
   */
  return (
    /* Decorative, so it is hidden from the accessibility tree and nothing in it
       can be focused or announced. The headline beside it is the content. */
    <div ref={box} className="wx-hero-visual" aria-hidden="true">
      {/* `is-painted` is back on the VIDEO only, and only where the cut is the
          painted MP4. The poster never needs it: that one carries real alpha in
          both themes, so feathering it would just dim artwork which already
          ends in nothing. */}
      {still ? (
        <img src={poster} alt="" draggable={false} />
      ) : (
        <video
          ref={video}
          className={env.alpha ? undefined : 'is-painted'}
          poster={poster}
          src={src}
          preload="none"
          muted
          loop
          playsInline
          tabIndex={-1}
          disablePictureInPicture
          onTimeUpdate={(e) => {
            at.current = e.currentTarget.currentTime;
          }}
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}
