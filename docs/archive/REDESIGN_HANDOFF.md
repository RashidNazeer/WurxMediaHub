# Creator redesign — where things stand

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

Written 2026-10-16, at the end of a long session, so the next one can pick up without
re-deriving any of it. **Everything below is LOCAL. Nothing has been pushed.**

---

## 1. Agents (ALL SIX FINISHED — kept here for the record and for resuming by id)

Three were mid-flight. They can be resumed by id with `SendMessage`; a new `Agent` call
would start them over with no memory of what they had already done.

| id | Job | State when the session ended |
|---|---|---|
| `ac50376bb5e647cfd` | Landing-page bugs + landing performance | **FINISHED** — see §9. Brief: the disappearing-text-on-scroll bug (reported by BOTH reviewers), Home-button visibility, primary CTA prominence, dark-mode logo, public-nav discoverability. Then a second message added: profile and fix the slideshow's load time and jitter, with before/after numbers under 4–6× CPU throttling; and the control-simplification pass. |
| `a5d254897255c47bf` | Vanta WAVES background | **FINISHED** — see §8. Replacing the CSS aurora with three.js Vanta inside `AuroraBackground.tsx` only (the single seam all five mount sites go through). Must stay behind a dynamic `import()`, fall back to the CSS aurora on reduced-motion / save-data / no-WebGL / weak device, and report the measured chunk size. A later message raised its bar: it is judged on frame cost too, and must verify touch controls do not eat scrolling at 390px. |
| `a22353230f90df8ba` | Whole-app performance + code optimisation | **FINISHED** — see §7. Owns build config, `index.html`, `main.tsx`, the Query client, `src/lib/supabase.ts`. For files owned by other agents it must report findings, not edit. Builds to `dist-perf` and previews on port 4199 so it does not fight the main `dist`. **It was mid-edit on `src/lib/creator/useMyWork.ts`** (converting imports to dynamic ones) — that file briefly failed to compile during the session and then settled. Check it first. |

**Six agents already finished**: Content, Contests+Offers, Leaderboards, Brand hub+Profile,
Notifications+Support, Signup/auth. Their reports are in the session transcript; the important
findings are summarised in §4 below.

---

## 2. What is built (all local, build green)

Steps 1–11 of the redesign brief, plus the two reviewer reports' items that were in scope.

- **Tokens** — chart palette validated (lightness band, chroma floor, colour-blind separation,
  contrast vs the real composited card). Light rim 1.03 → **1.65:1**. Dark muted text on glass
  3.69 → **4.57:1**. Measured on rendered pixels, not read off the stylesheet.
- **Charts** — `src/components/charts/`: `SparkArea`, `SparkBars`, `RingProgress`, `Donut`,
  `BrandBars` (removed 2026-10-30), `TrendLine`, `StackedBar`, `DeltaChip`, `ChartTip`, plus `chart-kit.ts`.
  Hand-rolled SVG, no chart library (see §5).
- **Navigation** — all eight tabs kept and regrouped by weight; Support added as a ninth by the
  notifications agent.
- **Home** (`CreatorHome` + `ApplicantHome`), **My numbers**, **Leaderboards**, **Contests**,
  **Offers**, **Content**, **Brand hub**, **Brands**, **Profile**, **Support**.
- **Notifications** — derived in the browser from events we already store; read state in
  `localStorage` (per-device, documented as such).

### Dev-only preview routes (absent from production builds)
Nobody on this machine has a creator login, so these exist to make the signed-in UI visible:
`/dev/charts`, `/dev/home` (`?state=empty|gaps|applicant|loading`), `/dev/content?n=`,
`/dev/notifications`. They are registered behind `import.meta.env.DEV`.

---

## 3. Known-good verification commands

```
export PATH="/c/Program Files/nodejs:/c/Users/Umar Wurx/AppData/Roaming/npm:$PATH"
pnpm typecheck
pnpm build                       # runs check-contrast, check-brand-theme, check-isolation
node scripts/verify/design/check-backdrop-ancestry.mjs
node scripts/verify/design/check-blur-budget.mjs
```

Scratchpad tools written this session (in the session scratchpad, not the repo):
`glass-contrast.mjs` (measures rim/text contrast on rendered pixels, both themes),
`blurcount.mjs` (counts blurred layers at every scroll position — the repo guard only measures
at scroll 0), `fontaudit.mjs` (counts font families actually rendered), `shoot.mjs`/`shoot2.mjs`/
`phone.mjs` (screenshots).

---

## 4. Open decisions — these need Rashid, not code

1. **TikTok signup is a CONFIGURATION fault, not code.** `redirect_uri` is a fixed server-side
   secret pinned to `wurxmediahubdev.vercel.app`, so from `prismwurx.vercel.app` a creator is
   returned to a different origin where the handshake secret does not exist, and dead-ends on
   "that link has expired". `prismwurx` is also not on TikTok's redirect allowlist. **Fix:**
   register `https://prismwurx.vercel.app/oauth/tiktok-creator/callback` and point
   `TIKTOK_CREATOR_REDIRECT_URI` at whichever origin is the real front door.
2. **Email verification is OFF**, by an earlier decision of his, pending SMTP. That — not TikTok
   — is the real "anyone can get in" gap the reviewers felt.
3. **Commission is not measured anywhere.** `commission_rate` is a product TERM; nothing links a
   performance row to a product. Three screens show "Not reported" rather than guessing. Needs a
   new RPC.
4. **A day with no row is drawn as a GAP, not a zero.** We cannot distinguish "sold nothing" from
   "not reported". If absent days really mean zero, this flips and changes every chart.
5. **Tier thresholds** ($1K/$10K/$50K) were transcribed from the migration that created the enum.
   The automation was never built, so tiers are set by hand; Home says so.
6. **Schema gaps found by the offers agent** (no placeholder UI was drawn for any): submission
   deadline on an offer, usage rights, payment method, product URL and description, per-offer
   commission rate, creator-chosen video packages (deliberately removed in July).
7. **`brand_briefs` existed since 2026-10-12, is creator-facing by design, and no creator screen
   had ever read it.** Now surfaced on offers. Worth knowing there may be more like it.
8. **Vanta/three.js costs ~150KB gzipped** — more than every creator route chunk combined. The
   agent was told to report whether it is worth it on a phone.

---

## 5. Deliberate deviations from the build prompt

- **No Recharts.** The prompt said to install it; the repo already hand-rolls SVG charts and the
  prompt's own rules (rem strokes, CSS-var theming, no path animation, gaps for nulls) fight a
  general charting library. ~12KB gzipped against ~110KB.
- **All eight tabs kept.** The prompt wanted four plus a menu; Rashid overrode that twice.
- **No `/app/earn`.** Offers and Contests stay separate for the same reason.
- **The avatar menu was built, then removed** at his request — text size and theme are back in
  the top bar, for creator and admin alike.
- **Home's panels do not blur.** Measured: with each section as `wx-neo-raised`, Home painted
  FOUR blurred layers at scrollY=800 on a 390px screen, before the top bar and bottom nav. They
  use `wx-neo-raised-sm` — same tint, rim and lift, no `backdrop-filter`. Home now contributes
  **zero** blurred layers at every scroll position.

---

## 6. Still to do

- Resume or re-check the three agents in §1.
- Run the full per-item pass/fail against both reviewer reports once they land.
- Verify everything signed in. **This is the biggest hole:** no creator login exists on this
  machine, so Leaderboards, Contests, Offers, Brand hub, Content, Support and the notification
  bell have never been seen rendered with real data. The dev preview routes cover the components,
  not the pages.
- Largest text size and reduced-motion passes.
- `scripts/verify/auth/check-apply.mjs` was patched for the new confirm-password field; other E2E suites that
  drive the signup form may need the same one-line addition.


---

## 7. Performance work (agent finished; two items applied here afterwards)

### Applied by the performance agent
- **The Supabase client and Zod were in the entry chunk** — a static chain from `router.tsx` →
  `ShellLayout` → `AppSidebar` → `useWurxbaseIdentity` → `supabase`. Every marketing visitor
  downloaded and evaluated a database client. Cut by making four leaf imports dynamic
  (`useWurxbaseIdentity`, `useProfile`, `useMyWork`, `useCreatorNotifications`) and by removing
  Zod from `src/lib/env.ts`, which used it to validate two strings.
  **Eager JS 241.1 KB → 164.0 KB gzipped (−32%).**
- **Brand SVGs carried base64 C2PA manifests** — 7,736 bytes each, in files loaded on every
  page. Stripped; all seven rendered before and after and compared as PNG hashes, pixel-identical.
  `prism-wordmark.svg` 15,556 → 7,782 bytes.
- `vite.config.ts`: named `motion-vendor` and `webgl-vendor` chunks (the latter is a tripwire —
  three+vanta is 150.9 KB gz, and if anything ever imports it statically it lands in the entry
  chunk). `index.html`: removed a duplicated font preload.
- Ruled out, so nobody re-investigates: TanStack Query is **not** causing the blinking
  (`refetchOnWindowFocus` is already false, `staleTime` 60s); no unstable context values; dead
  code is already tree-shaken to zero bytes; no duplicate deps reach the browser.

### Applied by me afterwards (its two highest findings, in files it did not own)
- **`src/app/router.tsx` — `ShellLayout` is now lazy.** It was a static import, so ~29.6 KB gz of
  signed-in chrome sat in the entry chunk of every public page, and it was the root of the
  Supabase chain above. Uses route-level `lazy` rather than `React.lazy`, because React Router
  awaits the module before committing the route and a layout route has no Suspense boundary
  above it.
- **`src/styles/global.css` — `@keyframes wx-shimmer` now animates opacity, not
  `background-position`.** `wx-skeleton` is worn by ~20 components, so a loading dashboard was
  repainting every frame. This is very likely one of the mechanisms behind the "blinking
  dashboard" both reviewers reported. Note `check-blur-budget.mjs` did not catch it because it
  only visits `/apply` and `/login`, which never show a skeleton — **that guard should be pointed
  at a page that does.**

### The jank finding, NOT yet acted on — owner is the background agent
`.wx-aurora-field` is the prime suspect for the scroll stutter. Measured at CPU×4 on a Pixel-6
viewport, the landing page drops 94–100% of frames; hiding that one layer was the only change
that clearly helped (57 → 107 frames rendered, 96% → 24% dropped). Stopping its animation or
removing its blur did **not** help — it is the layer's geometry: `width: 200%`,
`inset: -30% -100%`, `filter: blur(34px)` over the whole oversized layer, plus a mask and two
tiled backgrounds. **Caveat the agent was careful about: that machine was running six agents and
run-to-run variance was 5–10×. Re-run `node scripts/perf/perf-attribute.mjs` with `PERF_GPU=1` on an
idle machine before acting.** Also: `scripts/lib/browser.mjs` forces `--disable-gpu`, which
software-rasterises blur — any blur conclusion drawn without `PERF_GPU=1` is an artefact.

### Measurement harness left in `scripts/`
`entry-graph.mjs` (names the bare packages a leaf import put on the critical path — **worth
adding to `pnpm build`**, it is the only thing that makes the win above regression-visible),
`perf-probe.mjs`, `perf-jank.mjs`, `perf-attribute.mjs`. Delete them if unwanted; nothing else
references them. (perf-probe, perf-jank and perf-profile were removed 2026-10-30; perf-attribute remains in `scripts/perf/`.)

### Build state at the end of the session
`pnpm build` was **failing on the landing agent's in-flight edit** — it was changing a
`SettleOptions` prop type used by `FinalCta`, `HowItWorks`, `Platform` and `TrustedBy`. My own
typecheck passed immediately before its write. **Re-run `pnpm typecheck` and `pnpm build` once
that agent finishes**; the eager-payload improvement from the lazy `ShellLayout` has not been
measured yet because of it.


---

## 8. Vanta WAVES background (agent finished)

**Shipped, desktop-only, behind a gate.** `src/components/ui/WavesField.tsx` (new),
`vanta-waves.d.ts` (new), a second leaf inside `AuroraBackground.tsx`, two tokens per theme, and
`three@0.134.0` + `vanta@0.5.24`. `global.css` was deliberately NOT touched (another agent was
hot-reloading it), so the layer's styles are inline in the component.

The CSS aurora **always renders**; the waves are a transparent canvas over it. So nothing can
flash or go blank — the aurora is the sky behind the water, not a fallback.

- **Bytes: 151.3 KB gzipped, entirely lazy.** The entry chunk pays 0.2 KB. Gated devices never
  fetch it.
- **Falls back to the aurora on:** reduced-motion (reactive), Save-Data or a 2g/3g effective
  type, no WebGL — none overridable; plus low-end device and anything narrower than `lg`/64rem
  (i.e. every phone), which `localStorage['wx.waves'] = 'on' | 'off'` can override so Rashid can
  judge it on his own handset without a deploy.
- Verified working, not merely written: 30fps cap (28.6 draws/s vs 58.9 page rAF/s), 0 draws in
  a hidden tab, DPR capped, correct destroy across 20 loads + 6 SPA navigations, theme change via
  `setOptions` on the same canvas node.
- `touchControls: false` — measured identical scroll distance (1,940px) with waves on and off at
  390px.

**Its honest recommendation, which I agree with: keep it desktop-only.** The cost is not the
bytes, it is ~41ms of main-thread JS per frame at phone-class CPU — Vanta's `onUpdate` walks
8,181 vertices and recomputes normals over 16,160 triangles every frame, with no lever to shrink
the mesh. On a page already reported as juddering, that measured +40% blocked main-thread time
during scroll on a phone viewport. Even on desktop it is ~23% of one core, continuously. If the
landing perf work wants that back, this is the cheapest quarter-core in the app to reclaim —
one `const` in `WavesField.tsx`.

**Also flagged, pre-existing and NOT caused by the waves:** the dark CSS aurora's own brightest
ground scores **4.36 for `--wx-text-muted` and 2.30 for `--wx-text-faint`** with the waves off
entirely — both under the 4.5 floor. `check-contrast.mjs` cannot see this because it compares
TOKENS, not composited pixels (muted vs `--wx-bg` scores 14.78). This is a real hole in the
aurora's tuning and should be fixed there. The scratchpad tool `glass-contrast.mjs` is the way to
measure it.

**One small debt it named:** `detect()` is module-private to `HeroVisual.tsx`, so it copied the
two environment signals with identical field names rather than importing them. A five-line
follow-up to put one helper in `src/lib/` once that file is free.


---

## 9. Landing page (agent finished) and the aurora fix

### The disappearing text — found, and it was not what anyone assumed
Not `.text-brand-blend` and not `LoadWords`; both were already correct. The cause: the landing
reveals were scroll-**linked**, not scroll-**triggered**. `ScrollDepth`/`ScrollWords` (ScrollWords removed 2026-10-30) in
`Section.tsx` compute opacity as a pure function of scroll progress, so scrolling back UP
un-assembles a heading to **opacity 0 while it is still on screen**. Measured: three H2s at
exactly 0.000 on the upward pass.

Fixed with a new `src/components/landing/Settle.tsx` (`SettleWords`/`SettleIn`) — an
`IntersectionObserver` that fires once and disconnects, transitioning `transform`/`opacity` only.
`Section.tsx` was off-limits (shared with the signed-in app), so the four landing sections switched
to the new component. After: **0 elements under 0.9 opacity on the upward pass**, both themes,
both widths; 0 under 0.95 with reduced motion.

### Other real finds
- **The closing CTA was a dead button** — `FinalCta` called `focusApplyForm()` looking for
  `#apply-form`, which has only existed on `/apply` since the form left the hero on 2026-10-15.
  The home page's largest call to action did nothing. Now a link.
- **The hero had no primary action at all**, and the header's `Apply` was hidden on phones.
- **Blurred layers on the landing page: 19–22 in the DOM, up to 13 painting at once** against a
  budget of 3. `check-blur-budget.mjs` passed throughout because it only samples the first
  viewport. Cards in grids moved to `wx-neo-raised-sm` → **3 in the DOM, 3 at once, 0 animated.**
- **The slideshow tiles had `backdrop-filter` on a permanently rotating element** — a re-blur
  every frame, forever, on or off screen. Blur removed; fill, hairline and radius kept.
- **Six parallax layers that painted nothing** (leftovers from discs deleted on 2026-10-15),
  each running a transform every scroll frame. Deleted, with 19 `useScroll` subscriptions.
- **Dark-mode logo claim was already false** — `PrismMark` picks artwork from the resolved theme
  and is correct on every public surface. The favicon deliberately uses the light tile.

### The aurora, fixed here afterwards
Both the landing agent and the performance agent independently measured `.wx-aurora-field` as the
dominant remaining cost (21–23fps with it, 56–57fps hidden, 8 interleaved runs). It was
**200% × 160% of the viewport — 3.2 viewports of pixels — under a 34px blur, behind every page.**

Now `140% × 124%` (1.74 viewports) at `blur(20px)`. The halving is exact rather than arbitrary:
the drift slides the element −50% of its OWN width, so width and horizontal overscan must stay in
proportion or the frame is exposed mid-loop. Verified by screenshot — no bare corner, no visible
edge, the field still reads the same, because the source is a repeating linear gradient that was
already low-frequency.

**Not yet measured** on an idle machine. Re-run `node scripts/perf/perf-attribute.mjs` with
`PERF_GPU=1` to confirm the gain; this machine was running six agents.

### Left for whoever picks this up
- `motion`'s `measure` costs ~1065ms of CPU under 4× throttle — the largest non-idle entry, from
  the remaining `useScroll`/`useInView` users (`PageProgress`, hero parallax, `ProgressThread`,
  `CountUp`), not the reveals.
- `CountUp` calls `toLocaleString` on every rAF frame for three counters (~182ms). A hoisted
  `Intl.NumberFormat` makes it near-free.
- `src/lib/focus-apply.ts` (removed 2026-10-30) now has no importers; left in place because `ApplyForm.tsx` may want it.
- `src/components/layout/MobileNav.tsx:122` calls `useEffect` conditionally — a rules-of-hooks
  **correctness** bug, pre-existing, flagged by oxlint.


---

## 10. Second round (session continued)

Rashid reviewed the live site and sent new work. Four agents were resumed rather than respawned
(a fresh `Agent` call loses everything they learned):

| id | Resumed to do |
|---|---|
| `a5d254897255c47bf` | **Neutralise the background.** "black shaded in dark mode and white shaded in light mode in such a way that all the patterns are visible", and remove the "coloured glare". |
| `ac50376bb5e647cfd` | **Hero visual: too large, and not aligned with the copy beside it.** Worst at ~1900px. |
| `a22353230f90df8ba` | **Re-measure with `PERF_GPU=1`** now the machine is quieter, plus its own unblocked findings (the `MobileNav` rules-of-hooks bug, `CountUp`'s per-frame `toLocaleString`, motion's `measure`), and wire `entry-graph.mjs` into `pnpm build` as a regression guard. |
| `ae844eccbb7da3893` | **Contests control simplification** — the prescription it wrote itself but could not apply, as the file belonged to another agent at the time. |

### The "coloured glare" — diagnosed before delegating
Measured, so the agent is not guessing: it is **not** an exposed edge from my aurora shrink. On a
1900px viewport `.wx-aurora-field` spans -77..2583, so nothing is uncovered. The band he boxed is
the aurora's own radial mask — `radial-gradient(130% 100% at 88% 0%, #000 28%, transparent 88%)` —
pouring a coloured bloom in from the top right. That *is* the "previous background" he means.

### Nav tint removed (done here)
`--wx-glass-fill-nav` → `var(--wx-glass-fill)` and `--wx-nav-brightness` → `1`, in both theme
blocks. The bar carried a fill unlike any card's (52% near-black dark / 58% white light) plus a
`brightness()` of 0.72/1.18 inside its `backdrop-filter`; together those darkened or lifted the
ground wherever the bar crossed it. The nav is now the same material as a card. **Nav blur was
already 8px and already matched the cards** — only the tint was the problem.

**Watch this:** the dark nav went from 52% near-black to 10% white, so its text now sits almost
directly on the ground. The background agent has been asked to include nav text contrast in its
sweep. If raising the wave opacity for visibility pushes nav text under the floor, that is a
trade-off to surface — **not** something to fix by quietly re-tinting the bar, which is the thing
that was asked to be removed.

---

## 11. Two accepted trade-offs (Rashid's decision, 2026-10-17)

Both were put to him with the measurement in hand. Neither is an oversight; do not "fix" either
one without asking him first.

### The nav bar stays untinted, and its text fails contrast mid-scroll
`--wx-glass-fill-nav` is the card fill and `--wx-nav-brightness` is `1`, so the bar no longer
changes the tone of the ground it crosses — which is what he asked for.

The cost, measured across the whole landing page every 300px: nav text is **1.70:1 in dark and
2.36:1 in light** against a 4.5 floor, at scroll positions where a bright section heading passes
under the bar. At scroll 0 it is fine (6.4–7.3 both themes). Restoring the tint would fix it
(8.06 / 5.07) and is exactly the smear he asked to remove.

Established by the background agent: **the ground is not the cause.** With the wave field and the
shade switched off entirely it still measures 1.86 / 2.34. It is the tint removal alone.

He was offered an opaque-on-scroll bar (the recommendation), restoring the tint, or leaving it,
and **chose to leave it**. Recorded here as a known accessibility failure rather than a bug.
The options if it is ever revisited: opaque bar on scroll, a text shadow, or clearance under
the bar — none of which are a tint.

### The WebGL wave field runs on phones
The width gate in `WavesField.tsx` is removed. The measurement behind that gate is not disputed
and has not changed: Vanta's `onUpdate` walks every vertex in JavaScript each frame, allocating
per vertex and then recomputing normals — about **41ms of main-thread work per frame at
phone-class CPU, and +40% blocked main-thread time during a scroll.** It is CPU vertex
animation, not a shader, so no pixel-ratio cap reduces it.

He was shown that number alongside a free static-texture alternative and asked for the real
waves on phones anyway. The gates that remain are the ones that are not about taste:
reduced-motion, Save-Data, no WebGL, and genuinely low-end hardware (that last one still
overridable with `localStorage['wx.waves'] = 'on'`).

**If phone scrolling is reported as stuttering again, this is the first thing to suspend** — and
it is one line in `WavesField.tsx` to put the width gate back.
