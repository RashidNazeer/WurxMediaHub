# Motion in PRISM

Three animation technologies are installed. This file says which one to reach
for, what the rules are, and what must never be animated at all. Written
2026-10-14 when the motion layer (`src/lib/motion/`) was built — the first use
of either GSAP or Lenis in this app.

Read §1 and §4 before you animate anything. They are short, and every rule in
them is a bug this project has already paid for.

---

## 1. Which one

**Motion is the default. Use it unless one of the two exceptions below applies.**

| Use        | For                                                                                                                                                                        | Example in this repo                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Motion** | everything: enter/exit, layout, gestures, scroll-linked values, springs, staggered lists, anything driven by React state                                                   | `AppShell` drawer, every dialog, `Section.tsx`, `PageProgress`, `Confetti` |
| **GSAP**   | a **sequence** with several steps that must be labelled, reversed, scrubbed or re-timed as one unit, where Motion would mean orchestrating four `useAnimate` calls by hand | nothing yet                                                                |
| **CSS**    | a state change — hover, focus, open/closed, a theme swap — and anything that should keep working with JavaScript still downloading                                         | `global.css` transitions, `wx-neo-press`                                   |

### Why Motion is the default and not merely the incumbent

- It is already in the tree, already configured (`LazyMotion` + `domAnimation`
  - `MotionConfig reducedMotion="user"`), and already respects the OS reduce-motion
    setting on every animation without the author doing anything.
- It owns the app's one animation frame loop. Lenis is driven from it, so
  scroll-linked work in Motion reads a position that cannot be out of step.
- `App-*.js` is 1,058 kB. A second animation library on a screen is a second
  animation library in that screen's chunk.

### When it is actually GSAP

Reach for GSAP when the thing you are describing has a **script**: step one
moves, step two waits, step three overlaps step two by 0.1s, and the whole thing
has to be able to run backwards. That is a `gsap.timeline()` and it is three
lines; the same thing in Motion is a pile of `await`s with no handle on it.

That is the only case. "GSAP feels nicer" is not a case — it is a 70 kB
download, a second ticker, and a library whose default idiom writes inline
styles onto elements React thinks it owns.

**If you reach for GSAP, use `useGsapTimeline` from `@/lib/motion`.** Never
import `gsap` directly. The helper is what keeps the rules in §4 enforceable:
it type-checks the properties you animate, refuses targets above the WurxBase
fence, honours reduced motion, loads GSAP lazily and reverts every inline style
it wrote when the component unmounts.

### When it is actually CSS

If a designer could describe it as "this looks different when X", it is CSS.
Hover, focus, pressed, open, selected, loading. CSS transitions run on the
compositor, cost no JavaScript, work before hydration, and are already covered
by the `prefers-reduced-motion` block in `global.css`.

---

## 2. Smooth scroll (Lenis)

### It is off

`VITE_SMOOTH_SCROLL` is unset, so nothing is different from before. With the
flag off, `lenis` is not even downloaded.

To turn it on:

| How                                                          | What it does                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `localStorage.setItem('wx.smooth-scroll', 'on')` then reload | on, in that one browser, in any build. **This is how to try it.** |
| `VITE_SMOOTH_SCROLL=on` in `.env.local` or on Vercel         | on for everyone in that build. This is how it ships.              |
| `localStorage.setItem('wx.smooth-scroll', 'off')`            | forces it off, beats the env var. The escape hatch.               |

It is never on for somebody with "reduce motion" set, and never on
`/admin/collabs`.

### How Lenis and `useScroll` avoid fighting

This is the whole design and the reason the risk flagged in `DECISIONS.md`
(2026-10-14) does not land.

**There is one scroll authority and one animation frame loop.**

- **Lenis is the authority, Motion is a reader.** Lenis swallows the wheel or
  key gesture and writes `document.documentElement.scrollTop` itself, easing
  towards the target. Motion's `useScroll` measures the real document scroll on
  the browser's own `scroll` event — the same number, after Lenis wrote it. So
  the dozen existing `useScroll` call sites in `Section.tsx`,
  `HowItWorks.tsx` and `PageProgress` were not touched and do not need to be.
  There is no second scroll position anywhere in the app.
- **Lenis has no `requestAnimationFrame` loop of its own.** It is constructed
  with `autoRaf: false` and ticked from Motion's loop with
  `frame.update(tick, true)`. One rAF drives Motion and Lenis. The judder this
  app already paid for was "twelve beams animating on the main thread"; three
  libraries each scheduling their own frame is the same shape of fault.
- **Native scrollbar mode.** No transform wrapper, no scroll proxy. The document
  keeps its real height and its real scrollbar, which is what keeps
  `position: sticky` working (the rail and the top bar are both sticky),
  back/forward scroll restoration working, and focus-scroll-into-view working
  for keyboard users — the browser scrolls the focused element into view
  natively, Lenis sees the resulting scroll event and re-syncs to it.

The one cost: Motion reads the position Lenis wrote on the **previous** frame,
about 16ms behind. Not perceptible, and it is what guarantees they cannot tear
against each other mid-frame.

### What it does to the things it could have broken

| Thing                                                             | What happens                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anchor links (`href="#id"`)                                       | Lenis handles them (`anchors: true`) and eases to the target, including a hash present on first load.                                                                                                                                                         |
| `position: sticky`                                                | Works. Native scroll, real document height. Verified in Chromium on the signed-in shell.                                                                                                                                                                      |
| Back/forward scroll restoration                                   | Works. The browser restores `scrollTop`; Lenis syncs from the scroll event.                                                                                                                                                                                   |
| Focus scrolled into view                                          | Works, and is instant rather than eased, which is correct for a keyboard user.                                                                                                                                                                                |
| Inner scrollers (wide tables, select panels, the phone nav strip) | Scroll natively under the pointer (`allowNestedScroll: true`). Add `data-lenis-prevent` to anything that still misbehaves.                                                                                                                                    |
| `scrollIntoView({ behavior: 'smooth' })`                          | Becomes an instant jump, because `html { scroll-behavior }` is forced to `auto` while Lenis is on — two things easing the same `scrollTop` is the fight we are avoiding. New code should call `useScrollApi().scrollTo()` instead, which eases through Lenis. |
| Modals that lock scroll with `body.style.overflow = 'hidden'`     | Handled centrally. The provider watches `body`'s inline style and stops Lenis on the transition. Four existing dialogs rely on this and were not edited.                                                                                                      |
| Paid Collabs                                                      | Lenis is never applied. Twice over: the route is in `SMOOTH_SCROLL_DENY_PREFIXES`, and `PaidCollabs` also calls `useSuspendSmoothScroll`.                                                                                                                     |

### Reduced motion

Lenis is **never constructed** when `prefers-reduced-motion: reduce` is set.
Not slowed, not switched to a 1:1 lerp — absent, so the scroll those people get
is the browser's own, on the compositor, with no JavaScript in the path.
`useReducedMotion()` is live, so turning the setting on while the tab is open
tears Lenis down within a render and puts the native scrollbar back.

### The API

```tsx
import { useScrollApi, useScrollLock, useSuspendSmoothScroll } from '@/lib/motion';

const { scrollTo, smooth, lenis } = useScrollApi();
scrollTo('#apply-form'); // eases through Lenis, or jumps if it is off
useScrollLock(dialogOpen); // stop the page behind an overlay
useSuspendSmoothScroll('my-reason'); // take Lenis off the page while mounted
```

Every one of these is a safe no-op when smooth scroll is off, which is why they
can be used unconditionally.

---

## 3. GSAP

```tsx
import { useGsapTimeline } from '@/lib/motion';

const scope = useRef<HTMLDivElement>(null);

useGsapTimeline(
  (tl) => {
    tl.from('.step', { y: 16, opacity: 0, stagger: 0.06 })
      .addLabel('arrived')
      .to('.seal', { scale: 1.06, duration: 0.18 }, '-=0.1')
      .to('.seal', { scale: 1 });
  },
  { scope, deps: [stepCount] }
);
```

- **Lazily imported.** GSAP is only downloaded by a screen that calls this.
- **Scoped.** Pass `scope`. Selector strings resolve inside it, and cleanup
  reverts inside it. A timeline that can select anything on the page will
  eventually select the wrong thing.
- **Reverted on unmount.** `gsap.context().revert()` removes the inline styles
  GSAP wrote as well as killing the tweens. Without that a remount leaves a
  `transform` on an element forever — which is a wrong-looking screen, and on
  the wrong element a containing block for fixed overlays. See §4.
- **Reduced motion:** the timeline is built, then jumped to `progress(1)` and
  paused. The end state arrives on the first frame; the motion does not.
  Callbacks are suppressed on that jump, so an `onComplete` that opens a dialog
  does not fire on mount.
- **Plugins** go through `registerGsapPlugins(api, Plugin)`, which is
  idempotent however many callers ask.

### Banned GSAP plugins, and why

| Plugin           | Why                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScrollTrigger`  | it makes GSAP a second scroll authority, which is the exact risk this whole design exists to avoid. Scroll-driven work is Motion's `useScroll`, which reads the position Lenis writes. |
| `ScrollSmoother` | Lenis is the smooth-scroll implementation. Two is one too many.                                                                                                                        |
| `ScrollToPlugin` | programmatic scrolling goes through `useScrollApi().scrollTo`.                                                                                                                         |
| `Observer`       | it binds wheel and touch gestures, which Lenis owns.                                                                                                                                   |

`registerGsapPlugins` throws by name on all four. If one of them ever becomes
genuinely necessary, that is a `DECISIONS.md` entry and a `scrollerProxy`
wiring job, not an import.

### Why GSAP keeps its own ticker

It has to. Creating a tween wakes GSAP's ticker, so putting it to sleep and
driving `gsap.updateRoot` from Motion's loop is not a stable state. What keeps
that from becoming a third loop is the rule above: **GSAP is for short,
discrete, user-triggered sequences only** — never scroll-driven, never ambient.
Its ticker idles itself when nothing is live, so it and the Motion/Lenis loop
are never both busy for any length of time.

---

## 4. What must never be animated. Any of the three.

**Only `transform` and `opacity` animate.** Everything on this list is either a
recorded bug in this repo or a rule in `GLASS_PLAN`.

| Never animate                                  | Why                                                                                                                                                                                                                                                                                                                               | Do this instead                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `filter`                                       | **The fence law, `GLASS_PLAN` §1.2.** A non-`none` `filter` makes the element the containing block for its `position: fixed` descendants. This is the fault that put the vendored admin app's modals 3,413px down the page, three times. GSAP writes inline styles, so one `filter` in one tween on one wrapper is the whole bug. | nothing. Design it without.                                 |
| `backdrop-filter`                              | Same containing-block fault, plus `GLASS_PLAN` §4.3: blur is the most expensive thing to composite, and every browser test in this repo runs `--disable-gpu` so **the test suite is structurally incapable of noticing**.                                                                                                         | cross-fade two surfaces that already have their blur.       |
| blur, of anything                              | `GLASS_PLAN` §4.3, in its own words: never animate blur.                                                                                                                                                                                                                                                                          | `opacity`.                                                  |
| `box-shadow`                                   | Paint, not composite.                                                                                                                                                                                                                                                                                                             | `opacity` on a shadow layer, or `transform` on the element. |
| `width` / `height`                             | Layout. Reflows every sibling.                                                                                                                                                                                                                                                                                                    | `scaleX` / `scaleY`, or Motion's `layout` prop.             |
| `top` / `left` / `right` / `bottom` / margins  | Layout.                                                                                                                                                                                                                                                                                                                           | `x` / `y`.                                                  |
| `background-color` / `color` / `border-radius` | Paint, and colour belongs to a `--wx-*` token rather than to a tween.                                                                                                                                                                                                                                                             | a CSS transition on a class change.                         |
| `clip-path`                                    | Paint, and expensive.                                                                                                                                                                                                                                                                                                             | `transform` inside `overflow: hidden`.                      |

### And one more, which is not a property

**Never animate `transform` on an ancestor of `.wurxbase-root`.** `transform`
creates a containing block for fixed descendants exactly as `filter` does, so
it is the same bug with a different property name. `useGsapTimeline` refuses
such a target in dev with a thrown error; Motion cannot check it for you, so
when you put a `m.div` with a transform around page content, check what is
inside it.

### A transform that has settled must be removed

A 3D transform promotes the element to its own compositing layer **even when it
resolves to identity**, and a layer is rasterised once, so text inside goes soft
on a non-retina screen. `Section.tsx`'s `ScrollDepth` already drops to
`transform: none` the instant it arrives; anything new that animates a transform
on a block of text does the same.

---

## 5. Motion's two house rules, repeated because they bite

- **`m.div`, never `motion.div`.** `LazyMotion` runs with `strict`, so the full
  component **throws at runtime**. Hooks — `useScroll`, `useReducedMotion`,
  `useTransform`, `AnimatePresence` — import normally. This is the first thing
  to convert in any copied-in component (React Bits, 21st.dev).
- **Reduced motion is already handled** for anything animated with Motion, by
  `MotionConfig reducedMotion="user"` in `src/app/providers.tsx`. Call
  `useReducedMotion()` yourself only when the right answer is to render
  something _different_ rather than to animate it less — which is usually
  rendering nothing, as `PageProgress` does.

---

## 6. The files

| File                                | What it is                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/motion/flags.ts`           | the switch, and the route deny-list                                                                   |
| `src/lib/motion/ScrollProvider.tsx` | Lenis: lifecycle, the shared frame loop, the body-lock bridge, teardown                               |
| `src/lib/motion/scroll-context.ts`  | `useScrollApi`, `useLenis`, `useScrollLock`, `useSuspendSmoothScroll`, `useSmoothScrollRouteGuard`    |
| `src/lib/motion/gsap.ts`            | `useGsapTimeline`, `loadGsap`, `registerGsapPlugins`, the allowed-property type and its runtime guard |
| `src/lib/motion/index.ts`           | the barrel. Import from `@/lib/motion`.                                                               |

Wired in at `src/app/providers.tsx` (the provider),
`src/components/layout/ShellLayout.tsx` (the route guard) and
`src/routes/admin/PaidCollabs.tsx` (the explicit opt-out).

---

## 7. Still owed

- ~~No automated guard asserts the fence law in a browser.~~ **It does now.**
  `scripts/verify/design/check-backdrop-ancestry.mjs` was written on this same session, in
  parallel with this work, which is why the note above said otherwise. It runs
  as `pnpm verify:backdrop-ancestry` and reports exit 0 against this motion
  layer. The dev-time check in `gsap.ts` is still worth having — it is the only
  thing that catches an imperative inline transform at the moment it is written,
  rather than on the next guard run.

  **What was actually proved about this layer, 2026-10-14:** with the flag on,
  `html` gains `.lenis` and `lenis.js` loads, and the chain from `<html>` down
  to `#root` stays plain — no transform wrapper, no filter, document height
  unchanged at 4450px, real scroll position, zero console errors in both states.
  That is the native-scrollbar claim verified rather than asserted, and it is
  what keeps Lenis clear of the fence.

  Still unproved: the Paid Collabs route itself, which needs the staff login
  (`GLASS_PLAN` §10 item B). Both the route deny-list and the explicit
  `useSuspendSmoothScroll` are reasoned from the code, not watched on screen.
- **Lenis has not been measured on a real phone.** Every browser suite here runs
  `--disable-gpu`, so none of them can judge what smooth scroll costs on a
  mid-range Android. That measurement is a precondition for turning the flag on
  for everyone, not for turning it on for one reviewer.
- **The Paid Collabs suspension is logic-verified, not browser-verified.** It
  needs staff credentials this machine does not have.
