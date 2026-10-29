# PRISM Glass — the plan

Rashid chose **glassmorphism, A–Z, the complete app**, a **self-hosted heavy
grotesque** for display type, and a **four-colour palette**. Written 2026-10-14.

Status: **plan only. No application code has been written.**

This supersedes the neomorphic direction in `design/IMPLEMENTATION_PLAN.md`
for everything to do with material and colour. The parts of that file about
_symmetry_ — one concept, one component, one token — survive unchanged and are
the reason this plan does not re-litigate them.

---

## 0. The inputs, and what was measured rather than assumed

| Input | Where |
| --- | --- |
| The design | `Downloads\prism-design-collection.html`, the **Glassmorphism** option of nine |
| The palette | `#DEFCF9` · `#CADEFC` · `#C3BEF0` · `#CCA8E9` |
| The type | "the font in the glass example" |
| Buttons and cards | a liquid-glass reference implementation, §4.4 |

The design file is an interactive style browser. It was **rendered in Chromium
and measured**, not read, because the file never states its own values.

**The glass material, as measured:**

| | |
| --- | --- |
| Cards | `backdrop-filter: blur(22px) saturate(1.08)` |
| Nav / top bar | `blur(28px)` |
| Side rail | `blur(12px)` |
| Modal card | `blur(32px)`, modal scrim `blur(12px)` |
| Radius | 22px cards and chrome · 28px modals · 13px small controls |
| Edge | `1px solid rgba(255,255,255,0.88)` plus inset white highlights top and bottom |
| Shadow | `0 16px 48px #3944680d` |
| Ground | `#d8dce9` under radial violet and blue aurora |

**The type, as measured:** h1 66px / 850 / −3.4px · h2 41px / 700 / −2px ·
h3 22px / 750 / −0.7px · body 14px · paragraph 15px. All px.

### The font question had three answers, and none of them was Inter

1. The file **declares** `Inter`.
2. The file **never embeds** it. Its only `@font-face` entries are five base64
   aliases used by the other eight styles. Chromium was asked what it actually
   painted: **`Segoe UI Black`** for the headline and **`Segoe UI`** for body.
   That is what was on screen when the direction was chosen.
3. In this codebase `Inter` **is an alias for Figtree** (`global.css`), kept
   because the vendored Paid Collabs app names Inter in dozens of declarations
   and would otherwise drop to a system font. Porting `font-family: Inter`
   literally would render Figtree.

So the real change is not the family. It is that the mock's headlines are a
**heavy, tightly-tracked grotesque** while PRISM's display face is Caprasimo, a
display serif. See §3.

---

## 1. THE THREE THINGS THAT DECIDE THIS PROJECT

Everything else is execution. These three are the ones that can make it fail.

### 1.1 The palette cannot be text, and the maths says so

Run through the `dataviz` validator, all four fail every check:

```
[FAIL] Lightness band      0.969 · 0.895 · 0.822 · 0.786 — all far too light
[FAIL] Chroma floor        0.031 · 0.047 · 0.070 · 0.098 — read as grey
[FAIL] CVD separation      #CCA8E9 ↔ #C3BEF0  ΔE 3.7 deutan
[FAIL] Normal-vision floor #CCA8E9 ↔ #C3BEF0  ΔE 5.4 — indistinguishable even
                           with full colour vision. This one is not waivable.
[WARN] Contrast vs surface 1.05 · 1.33 · 1.71 · 1.98 — none reaches 3:1
```

As text they are unusable: 1.08, 1.37, 1.76 and 2.03 against white, where the
floor is 4.5.

**This is not a reason to change the palette.** It is the same shape the PRISM
kit already hit and already solved, in its own words: _"The spectrum is a fill,
never an ink."_ The four stay exactly as given, as **fills** — aurora, glass
tints, gradients, chart bodies — and each gets a derived **ink** for text and
icons. Derived here, hue held, lightness moved until it clears 4.5:1:

| Name | Fill (as given) | Ink, light mode | Ink, dark mode |
| --- | --- | --- | --- |
| mint | `#DEFCF9` | `#0B7A6E` (4.57) | `#0D8F82` (4.53) |
| sky | `#CADEFC` | `#0D65E8` (4.55) | `#2B7BF3` (4.51) |
| periwinkle | `#C3BEF0` | `#6659D9` (4.57) | `#7B70DE` (4.51) |
| orchid | `#CCA8E9` | `#9246D0` (4.56) | `#A362D7` (4.58) |

Non-text ink at 3:1, for borders, focus rings and icons: `#0E9A8C` · `#4088F4` ·
`#877CE1` · `#AA6EDA`.

**The ΔE 5.4 finding still binds the charts.** Periwinkle and orchid cannot sit
side by side as two data series, in any mode, for anyone. Either use two of the
four in a chart, or carry a second encoding — direct labels, gaps, texture —
which `dataviz` requires anyway.

### 1.2 The fence: `backdrop-filter` has broken this app three times

`docs/guides/NEW_MACHINE.md` and `docs/archive/PRISM_PROGRESS.md` both record it: a
`backdrop-filter` above `.wurxbase-root` changes the containing block for fixed
overlays and the vendored app's modals landed 3,413px down the page. The current
top bar is opaque **specifically** to avoid it, and says so in a comment.

Choosing glass A–Z means this can no longer be avoided by not having glass. It
has to be solved. It is solvable, because the shell is already the right shape:

```
<div>                             ← ancestor of the fence · MUST stay plain
  <aside> rail card </aside>      ← sibling · MAY be glass
  <div class="flex flex-col">     ← ancestor of the fence · MUST stay plain
    <header> top bar </header>    ← sibling · MAY be glass
    <main>                        ← ancestor of the fence · MUST stay plain
      <div class="w-full px-3">   ← ancestor of the fence · MUST stay plain
        <Outlet/> → PaidCollabs → .wurxbase-root
```

**The law, and it is checkable:** no element on the ancestor chain from `<html>`
down to `.wurxbase-root` may have a computed `backdrop-filter` **or `filter`**
other than `none`. Rail, top bar, modal scrims, and every card _inside_ an
ordinary page are siblings or leaves and are free. On the Paid Collabs route
only, everything from `<main>` down to the fence stays plain and the glass is
carried by the chrome around it.

**`filter` is in that law for the same reason `backdrop-filter` is**, and it is
the easier one to add by accident. Any non-`none` `filter` on an element makes
it the containing block for `position: fixed` descendants. The liquid-glass
button recipe in §4.4 ships with `filter: contrast(3)` on a **wrapper** — drop
that wrapper anywhere above the fence, or above any fixed overlay, and the
3,413px bug returns wearing different clothes.

`scripts/verify/design/check-backdrop-ancestry.mjs` (§7) asserts this in a real browser, and
is the single most important new guard in this project.

### 1.3 Blur is the most expensive thing to composite, and the tests are blind to it

`browser.mjs` launches Chromium with `--disable-gpu`. Every browser suite is
software-rendered, so **the entire existing test suite is structurally incapable
of judging blur cost** — on a product whose creators are mostly on phones. The
skill database rates both glass styles `cost:moderate|drivers:blur`
independently.

This is the risk most likely to be discovered late and by a user. It gets a
budget (§4.3), a guard that counts layers (§7), and a real device in Phase 7.

---

## 2. The colour system

Three layers. A colour never does two jobs. Same discipline as the current kit,
new values.

**Layer 1 — the chassis, ~95% of every screen.** Neutrals only, and this is what
carries legibility.

| Role | Light | Dark | On its ground |
| --- | --- | --- | --- |
| ink | `#1A1B26` | `#F4F4FA` | 14.89:1 |
| body | `#44465A` | `#C3C5D6` | 8.06:1 |
| muted | `#5E6076` | `#A3A5B8` | 5.36:1 |
| ground | `#EDEFF7` | `#15151E` | — |

**Layer 2 — one interactive accent.** `periwinkle`/`orchid` ink is the only
interactive colour: links, focus rings, primary buttons, active tabs, the
current nav item. Nothing else wears it, and everything interactive does.

**Layer 3 — semantic signals**, meaning only, never decoration. The palette is
entirely cool and contains **no warning and no danger colour**, so these are
carried over from the current kit rather than invented: danger `#B42318` light /
`#FF7A94` dark, warning `#8A5A00` / `#F0B429`. Success maps to mint ink. These
are reserved and never reused as "series 4".

**The fills** are the four as given, used as glass tints, the aurora, gradients
and chart bodies — never under text that depends on them for contrast.

---

## 3. Type

**Display: Archivo**, self-hosted variable woff2, used at 700–900. It is a
heavy grotesque, it is what the mock's `Segoe UI Black` headline was reaching
for, it is OFL, and it has precedent here — Archivo Black was this project's
display face before the PRISM rebrand.

**Interface: Figtree stays.** It is already self-hosted at 20 KB, already the
target of the `Inter` alias, and nearly the same genre as the mock's body text.
Keeping it means **the vendored Paid Collabs app needs no font work at all**,
which removes an entire category of risk from Phase 6.

**Caprasimo is retired.** It is the display serif the mock's direction replaces.

Every size stays in **rem**, against the browser's 16px, so `ui-scale.ts` keeps
working and people can still resize the app. The mock's px scale converts:
h1 66px → 4.125rem, h2 41px → 2.5625rem, h3 22px → 1.375rem, body 15px →
0.9375rem. The tight tracking is kept as `em`, so it scales with the type.

---

## 4. The glass material

### 4.1 The floor, which is what makes text safe on glass

Text contrast over a translucent surface depends on what is behind it, so it
cannot be verified from a hex value. It **can** be bounded: the aurora is ours,
its colours are known, so the worst-case backdrop is known.

**Every glass surface therefore has a minimum opacity** — its floor — chosen so
that the composite still clears 4.5:1 against the darkest and lightest backdrop
the aurora can put behind it. The floor is computed once in Phase 1 and asserted
by `check-glass-contrast.mjs` against rendered pixels, not tokens.

A glass surface that cannot meet its floor does not become glass. It becomes
opaque. There is no third option.

**A second reference, and what it is good for.** Rashid also sent the css.glass
recipe: `rgba(255,255,255,0.17)`, `blur(8.9px)`, `radius 16px`,
`0 4px 30px rgba(0,0,0,0.1)`, `1px solid rgba(255,255,255,0.1)`. It is a much
lighter touch than the mock's `blur(22px)` with a `0.88` white edge, and that is
worth having: **8.9px blur composites far cheaper than 22px**, which is the
budget §4.3 is trying to protect on phones. It is adopted as the **phone and
low-power value**, with the heavier blur reserved for desktop chrome.

Its fill cannot be adopted. At **17% white over an aurora, nothing guarantees
text contrast** — that is precisely the case §4.1 exists for, and a 10% white
border is below the 3:1 a control boundary needs under WCAG 1.4.11. So the
recipe contributes its blur and its shadow, and the fill and the edge come from
the floor.

### 4.2 The tokens

Keeping the `--wx-*` **names** is non-negotiable: `check-contrast.mjs`
hardcodes 46 pairs and fails with "token not found" if one is renamed. Values
change, names do not. New glass tokens are additive:

```
--wx-glass-blur        22px      --wx-glass-tint      (per surface, with its floor)
--wx-glass-blur-chrome 28px      --wx-glass-edge      rgba(255,255,255,.88)
--wx-glass-blur-modal  32px      --wx-glass-highlight inset top + bottom
--wx-glass-saturate    1.08      --wx-glass-shadow    0 16px 48px …
```

Every one needs a dark twin or the parity guard fails the build.

Tokens stay **hex in `tokens.css`**. The guard already failed once on
`color(srgb …)` — which Chromium returns for `color-mix` — and now fails loudly
on anything it cannot parse. The mock's modal card uses exactly that form.

### 4.3 The blur budget

- **Never nest `backdrop-filter`.** Nested blur compounds cost for no visual
  gain. A glass card inside a glass panel is one of them, not two.
- **At most 3 blurred layers painting at once** on a phone: chrome, one surface,
  one overlay.
- **Below `md`**, chrome keeps its blur and page cards fall back to the opaque
  tint. Phones get the look where it is seen and not where it is scrolled past.
- **Never animate blur.** Animate `transform` and `opacity` only.
- `prefers-reduced-transparency` and `forced-colors` both drop to opaque
  surfaces with a real border. Under `forced-colors` shadows disappear entirely,
  so the edge must be a border there, not a shadow.

### 4.4 Buttons and cards: the liquid-glass recipe

Rashid supplied a reference implementation (2026-10-14) and it is the right
look — the skill database classes it `liquid-glass`, Apple's dynamic material,
and its own checklist is _"use for navigation and controls, keep content on a
separate layer, apply colour judiciously, test reduced transparency, test
reduced motion, verify text and control contrast."_

**What is kept.** The optical edge is the whole trick and it transfers intact:
a hairline `border`, four inset highlight shadows at opposing corners, an inner
`inset 0 0 2px` to seat it, a drop shadow to lift it, and a blurred
`::after` carrying a 45° white gradient so the rim catches light on two edges.
That is what reads as a piece of glass rather than a grey box, and it is
precisely the edge that `check-boundaries.mjs` needs anyway.

**What must change before it ships. Each of these is a rule in this document,
not a preference:**

| In the reference | Why it cannot ship as-is | Becomes |
| --- | --- | --- |
| `filter: contrast(3)` on `.fx-layer` | §1.2 — a `filter` wrapper is a containing block for fixed overlays, and it distorts every colour beneath it, so rendered contrast stops matching the tokens | dropped; the rim gradient already carries the effect without it |
| `backdrop-filter` on **every** button | §4.3 — a toolbar of eight buttons is eight blur layers. This is the budget's worst case | blur on chrome and overlays; buttons take the opaque tint and keep the optical edge |
| `z-index: 500` / `501` | Collides with the app's scale: header is 40, drawer and modals 50. 500 puts a button above every modal | the existing z-scale |
| `--w: 260px`, `--h: 75px`, `font-size: 25px` | §3 — px opts out of `ui-scale.ts`, and a fixed-width button is not responsive | rem, with the width intrinsic to the label |
| `<div class="box">` | Not focusable, no role, no accessible name, `user-select: none` | a real `<button>`, with a focus ring that clears 3:1 against glass |
| `transition: .25s` on everything | No `prefers-reduced-motion` path; `translateY` and `scale` only, never blur | `m.button` under Motion's strict `LazyMotion`, reduced-motion respected |
| `color: #3e3e3e` | §4.2 — raw hex in a component | `--wx-*` ink tokens |

The 75px height clears the 44px tap floor comfortably; that part is already
right.

### 4.5 The card: lit edges, and one trap worth keeping

A third reference (2026-10-14) supplies the **card** material, and its good idea
is the one to carry forward: a 1px `::before` across the top fading in and out,
and a 1px `::after` down the left fading out — **a light source at top-left
catching two edges**. That is the same direction the neomorphic layer already
used and the same logic as the button's opposing inset highlights, so the whole
system agrees about where the light comes from. Adopted, as `Surface`'s rim.

Adopted with it: `blur(10px)` — in the same cheap band as the css.glass 8.9px
and far below the mock's 22px — and `radius: 20px`, which rounds to the card
value in §0.

**NOT adopted, and one of them is a bug.** `inset 0 0 32px 16px
rgba(255,255,255,1.6)` — **alpha above 1 is invalid and clamps**. Chromium
resolves it to `rgb(255, 255, 255)`: a fully opaque white inner glow, 32px blur,
**16px spread**. Rendered side by side against the same ground, it floods about
40px of every edge, swamps the very `::before`/`::after` rim the recipe exists to
draw, and turns the card into a frosted white blob. Corrected to `0.16` it is
clean glass. Anyone copying this snippet gets the flood and will blame the
backdrop-filter.

Also dropped: the fixed `240px × 360px`, which is not responsive, and the
`rgba(255,255,255,0.11)` fill, which the floor in §4.1 governs.

**A correction to §4.4 while this is in view.** WCAG 1.4.11's 3:1 applies to
user-interface components and meaningful graphics — **not to a decorative card
edge**. So a `rgba(255,255,255,0.3)` rim is perfectly legal on a `Surface`, and
the 3:1 requirement binds on `Button`, inputs, and anything focusable. Treating
every edge as a control boundary would make the whole material heavier than it
needs to be, for no accessibility gain.

**One primitive, used everywhere.** This becomes `Button` and `Surface` in
`src/components/ui/`, built once, and is the only legal way to draw a button or
a card anywhere in the product — creator, admin, public. It is not reimplemented
per screen. That rule is inherited from the existing plan and is the reason the
current app drifted into three card radii and five `h2` sizes.

---

## 5. The issues this redesign also fixes

Rashid: _"we will be implementing all UI fixes in this redesign."_ So this is the
register, and every item is assigned to a phase rather than left to be
remembered. **Scanned against the tree on 2026-10-14**, not copied from the
older audits — two of which turned out to be wrong, noted below.

### 5.1 Trust, which is what the product sells

| # | Issue | Where | Phase |
| --- | --- | --- | --- |
| 1 | **ROI prints `0.00x`.** `roi = cost > 0 ? revenue / cost : null`, so 52 cents of spend against no GMV reads as "we spent money and got nothing back" — the exact phrasing the admin side forbids | `MyNumbers.tsx:220` | 3 · **needs Rashid**: below what spend is it too small to judge? |
| 2 | **No figure says how fresh it is.** GMV arrives from Seller Center on a delay; a number with no timestamp is a number nobody fully trusts, and a failed sync silently shows yesterday's | creator screens | 3 |
| 3 | **Zeroes do not say why.** "$0 paid" reads as broken where "nothing settled yet, first payment after your 10th video" does not | Home, My numbers | 3 |

### 5.2 Rule violations, as they stand today

| # | Issue | Where | Phase |
| --- | --- | --- | --- |
| 4 | **Hardcoded hex outside `tokens.css`.** All of it carries the retired violet/spectrum and must move to the new palette anyway | `ShareCollab.tsx` ×10 (client-facing), `HaloBackdrop.tsx:52` SPECTRUM ×4, `ThemeProvider.tsx:56` theme-colour meta, `brand-theme.ts:601` `DEFAULT_BRAND_COLOR` | 1 and 4 |
| 5 | **px type sizes**, which opt out of `ui-scale.ts` | `ShareCollab.tsx:676` `fontSize: 12`; `wurxbase-chrome.css`, `wurxbase-overrides.css` | 4 · vendored CSS in 6 |
| 6 | **Layout caps against "content fills the width"** | `ApplicationDetail.tsx:49, :120, :335`, `ClientLinks.tsx:330` | 5 |

**The earlier audit was wrong about the caps and this corrects it.** It listed
five admin screens; most of those hits are `max-w-sm` / `max-w-prose` on a `<p>`,
which is line-length control and is *required* by the 35–75 character rule. Only
the four above cap a layout container. A sweep would have removed the wrong ones.

### 5.3 Accessibility and interaction

| # | Issue | Phase |
| --- | --- | --- |
| 7 | **Focus visibility.** Glass carries shape by shadow, so a focus ring has to be unmistakable, at ≥3:1 against a translucent surface. `check-focus.mjs` | 2 |
| 8 | **No live regions** for anything that updates without a click — sync status, a figure refreshing. Screen-reader users never learn it changed | 3 |
| 9 | **Reduced transparency and forced colors.** New, and glass-specific: under `forced-colors` shadows vanish entirely and a borderless glass control becomes invisible | 2 |
| 10 | **Tap targets ≥44×44 at 375px**, with ≥8px between them | 2 |
| — | ~~`aria-current` missing on the desktop rail~~ — **already done**, `AppSidebar.tsx:453` and `MobileNav.tsx:164`. Recorded so nobody fixes it twice | closed |

### 5.4 The view a person chose does not survive a refresh

`useSearchParams` is used across the admin screens and on four creator screens,
but **not** on `MyNumbers`, `Leaderboards`, `Offers`, `Profile` or `Brands`.
My numbers is the money screen and the one most worth bookmarking — "Penetrex,
last 30 days" should be a URL a creator can return to and an admin can paste to
a colleague. **Phase 3.**

### 5.5 Empty, loading and failed

`DataState.tsx` already exists and is good — it replaced 79 hand-written error
branches and gave creator screens a retry that works. It gets **extended, never
rebuilt**. One rule to apply across it: an empty state names **the next action**
rather than describing the emptiness. Seven pipeline columns each saying
"Nothing here" is six wasted rectangles. **Phase 2 for the component, 3 and 5
for the copy.**

### 5.6 The bundle, which glass does not help

`App-*.js` is **1,058 kB raw / 304 kB gzipped**. `xlsx`, `pptxgenjs`, `jspdf`
and `jspdf-autotable` are imported only by admin and vendored code, and every
creator downloads all of it on a phone to reach screens they cannot open. This
is the biggest outstanding performance job in the project and it predates this
redesign. Glass adds CSS, not JS, so it neither helps nor hurts — but shipping a
blur-heavy UI on top of a 1 MB bundle on a mid-range Android is the combination
to avoid. **Phase 7, and it is a real piece of work, not a tidy-up.**

### 5.7 Verification debt carried in

| # | Issue | Phase |
| --- | --- | --- |
| 11 | **The admin brand pages have never been opened in a browser** — Briefs, Products and the brand leaderboard are the newest code in the project. They typecheck. Nobody has looked at them | 5, and needs the admin login |
| 12 | **`check-brands.mjs` was edited but never run** — its edits are reasoned from markup, not proven | 5 |
| 13 | **TikTok OAuth from the installed PWA** returns through the system browser and may land in a different context, on a product explicitly engineered against random logouts | 7, needs a real phone |

---

## 5.8 What the inventory found, 2026-10-14 — corrections to this plan

A full read-only scan of the tree ran after §5 was written. It corrects the plan
in one load-bearing way and several smaller ones.

**THE NAME COLLISION, AND IT BLOCKS §4.2.** `--wx-glass-blur`, `--wx-glass-fill`,
`--wx-glass-panel`, `--wx-glass-line`, `--wx-glass-rim` and `--wx-glass-glow`
**already exist** in `tokens.css` with different meanings (`--wx-glass-blur` is
`24px`). §4.2 proposed adding `--wx-glass-blur: 22px`, `--wx-glass-tint` and
`--wx-glass-edge` as if the namespace were free. It is not, and
`check-contrast.mjs` is name-sensitive, so a careless add silently redefines a
token six components already read. **Phase 2 starts by deleting the dead
material, not by adding to it** — see the next point.

**Three complete card materials are already built and DEAD.** `wx-card`,
`wx-card-lift` and `wx-card-hero` (~60 lines of CSS and 14 tokens) have **zero**
uses. `wx-glass` and `wx-glass-panel` — the only real `backdrop-filter`
utilities in the codebase — have zero uses; two components carry comments
explaining why they chose *not* to use them. `wx-glass-hover` has exactly one
consumer. So "one concept, one component" is partly a **deletion** job, and this
is already one failed attempt at it sitting in the tree.

**The surface sprawl is bigger than assumed.** Nine live patterns draw a card
today, across 454 class occurrences, plus **202 bespoke `rounded-* + bg-*`
surfaces in 60 files** that no token or utility change can reach — each must be
visited by hand. There is **no `Surface` or `Card` component at all**; every
card in the product is a div and a class string.

**Raw `<button>` outnumbers the shared one: 103 against 90.** The entire shell —
`AppSidebar`, `MobileNav`, `FilterBar`, `TextSizeMenu`, `ThemeToggle` — is 100%
hand-rolled, and that is exactly the chrome §4.4 wants carrying the glass.

**Radius is worse than three values.** 795 occurrences across **20 distinct
values**, and `--radius-2xl` / `--radius-3xl` are **not mapped** to the token
scale, so 62 uses — including every `DataState` card and five `TiltCard` sites —
already sit outside the system.

**The z-index point in §4.4 was understated.** `z-index: 500` and `600` are each
already used ×4 by the vendored CSS, which also runs `2147483000`. Non-vendor
TSX has `z-[60]` ×2 and `z-[100]` ×1 escaping the stated scale.

**§5.5 was wrong about `DataState`.** It holds for the creator app (7 of 8
screens) and **not** for admin: of 19 admin screens only one adopted it, and ~24
still hand-roll. `MyNumbers` and `Dashboard` — the two screens Phase 3 cares
most about — have **zero** `DataState` usage. Loading also has **three** parallel
implementations (`wx-skeleton` ×100, `NeoSkeleton`, the two route fallbacks) and
`DataState` does not cover loading at all, so "extended, never rebuilt" means
adding a concept it does not have.

**Two scope leaks.** `ShareCollab.tsx` is Phase 4 but imports `paidcollabs.css`
and opens a `.wurxbase-root`, so Phase 4 touches vendored CSS that §6 assigns to
Phase 6. And `src/routes/studio/StudioHome.tsx` is a **17-line stub** routed at
`/studio` that appears in no phase — it is either dead or an undesigned screen.

**One thing the inventory got wrong**, recorded so it is not repeated:
`scripts/verify/design/check-backdrop-ancestry.mjs` is not pre-existing. It was written by
another engineer on this same session, minutes earlier.

---

## 6. Phases, each with a gate

Nothing proceeds until its gate passes. Every gate includes `pnpm build` green,
both themes, no horizontal overflow at 375/768/1024/1440, zero console errors.

| Phase | What | Issues closed | Gate adds |
| --- | --- | --- | --- |
| **0** | This plan, the derived inks, the glass floors computed | — | Rashid approves |
| **1** | `tokens.css` rewritten + `check-contrast.mjs` updated **in the same commit** | 4 (tokens) | parity, 46 pairs |
| **1b** | Archivo self-hosted, Caprasimo removed, rem scale | — | no FOIT, no CLS |
| **2** | Glass primitives + the component gallery route | 7, 9, 10, and `DataState` extended | every primitive × state, both themes, keyboard |
| **3** | Creator app: Home, My numbers, Brand hub, Offers, Contests, Leaderboards, My content, Profile | **1, 2, 3**, 8, §5.4, §5.5 copy | per screen, on a real login |
| **4** | Public site + Apply | 4 and 5 in `ShareCollab` | its own performance budget |
| **5** | Admin, 16 screens | 6, 11, 12 | admin login |
| **6** | Paid Collabs: token-skin through `--wx-*` and the two override sheets, **chrome glass, fence plain** | 5 (vendored CSS) | `check-backdrop-ancestry` |
| **7** | Hardening: real phone, a11y, reduced transparency, forced colors, visual regression, **the bundle split** | §5.6, 13 | a mid-range Android |

Phase 1 will leave screens looking half-dressed. That is expected and correct.

**Two phases cannot start without something that is not in this repository.**
Phase 3 needs a working creator login on dev and Phase 5 needs the admin one;
issue 11 has been open since the brand pages were written precisely because
nobody had them. Phase 7 needs a real mid-range Android. Getting those is on the
critical path, not a detail — see `docs/guides/NEW_MACHINE.md` §1.3 and §7.

---

## 7. The guards this needs, because nothing existing covers it

| Script | What it asserts |
| --- | --- |
| **`check-backdrop-ancestry.mjs`** | **no ancestor of `.wurxbase-root` carries a `backdrop-filter`.** The one that protects §1.2 |
| `check-glass-contrast.mjs` | rendered text contrast over every glass surface, against the real aurora, in both themes |
| `check-blur-budget.mjs` | layer count per screen, no nested `backdrop-filter`, no blur in a transition |
| `check-reduced-transparency.mjs` | opaque fallback under `prefers-reduced-transparency` and `forced-colors` |
| `check-boundaries.mjs` | every control has a ≥3:1 perceivable edge (WCAG 1.4.11) |
| `check-focus.mjs` | visible focus indicator at ≥3:1 — raised stakes, glass carries shape by shadow |
| `check-no-raw-style.mjs` | no hex literals, no `text-[Npx]`, outside `src/vendor` |
| `check-tap-targets.mjs` | ≥44×44 at 375px |

Two existing traps to respect while writing them: `ensureAllTime` in the shared
browser helper detects active state by reading `rgb(255,255,255)`, so a palette
whose active state is not white-on-accent breaks every suite that calls it; and
`verify:all` runs 13 of ~60 suites and excludes every `collab-*` check.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Blur costs frames on real phones | §4.3 budget; Phase 7 on a real device; the suite cannot see this |
| A `backdrop-filter` reaches the fence | `check-backdrop-ancestry.mjs`, in the build |
| Text unreadable over glass | the floor, §4.1, measured on rendered pixels |
| Periwinkle vs orchid indistinguishable | never adjacent as series; second encoding always |
| Contrast guard blocks the build on day one | tokens and guard change in the same commit |
| Brand-hub per-brand theming vs a fixed palette | open, §9 |
| Scope: ~25 screens plus 25k vendored lines | phase gates; creator app ships before admin |

---

## 9. Still open

1. **Brand hubs re-tint the palette per brand.** With a fixed four-colour
   identity, does a brand's colour still override the accent inside its hub, or
   does it become a hero-only accent? Phase 3 needs an answer.
2. **Dark mode.** Kept, because the parity guard enforces it and dropping it is
   a bigger change than keeping it — but the palette was given as light values
   only and every dark twin here is derived, not chosen.
3. **The aurora on the landing page.** It is currently scroll-driven and was
   expensive once already. Glass plus scroll-driven aurora on a phone is the
   worst case in the product.

---

## 10. What I will need from Rashid, and the exact moment to ask

He has these and will hand them over when asked — 2026-10-14: _"that is on my
end just remind me when needed."_ So **he does not have to remember; this file
does.** Each item names the trigger that should raise it, the same way
`PARKED.md` works. Fold these into `PARKED.md` when this branch merges.

| # | What | Trigger — raise it the moment this is true | Blocks |
| --- | --- | --- | --- |
| A | **A working creator login on dev.** Two exist per `docs/guides/NEW_MACHINE.md` §1.3: `babblingbrookej@wurxmedia.com` (nearly empty — tests the states most of the design work is about) and `rudely@wurxmedia.com` (real GMV, orders, eight days of history) | Phase 2's gate passes and Phase 3 is the next step | Phase 3 |
| B | **The dev admin login**, `rashid@wurxmedia.com`. Its password was never stored anywhere; if he does not have it, it resets from the Supabase dashboard | Phase 4's gate passes and Phase 5 is the next step | Phase 5, and issues 11 and 12 |
| C | **A real mid-range Android**, in his hands or anyone's | Phase 6 is done and hardening starts | Phase 7, and the blur budget |
| D | **The ROI threshold** — below what ad spend is the figure too small to judge, rather than printing `0.00x` | the moment My numbers is opened in Phase 3 | issue 1 only, not the phase |

**Nothing above blocks the start of this work, and that is the point of the
phase order.** Phases 1, 1b, 2 and 4 — the token layer, the type, every glass
primitive with its gallery, and the whole public site — need no login at all.
That is the foundation and roughly half the visible surface. The asks only
arrive once the signed-in screens do.

Two of these are old debts, not new ones. There has been no usable creator login
on dev for the entire PRISM rebrand, which is why about a hundred files were
changed and never looked at, why the brand dropdown shipped invisible, and why
issue 11 exists at all. Getting A and B before Phase 3 is what stops this
redesign repeating that.
