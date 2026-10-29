# PRISM rebuild — progress

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

**Read this first if you are picking the PRISM frontend rebuild up cold.** It is the running
record of what is done, what is next, and the decisions already taken. Update it in the same
commit as the work it describes.

---

## What this is

WurxMediaHub is being rebranded to **PRISM**, a social-commerce creator community by Wurx
Media for TikTok Shop affiliates. Tagline: _"See your true TikTok Shop results."_ The entire
frontend is being rebuilt in a **neomorphic** visual language — soft extruded surfaces, inset
wells, one light source from the top-left. Light-first, dark retained. Mobile-first.

## Where the inputs are

|                                          |                                                            |
| ---------------------------------------- | ---------------------------------------------------------- |
| Brand kit (colours, logos, fonts, radii) | `design/prism_brand_kit/` — now tracked in git |
| The plan (phases, team, QA, risks)       | `design/IMPLEMENTATION_PLAN.md` — now tracked       |
| Token map with contrast maths            | `design/PRISM_TOKEN_MAP.md` — now tracked          |
| Stitch design prompts (3 directions)     | not in the repo (were in the old `Redesign UI/` folder)|

**Warning (when written):** the old `Redesign UI/` folder was not in git; it is now `design/` and is. The three
design prompts were not carried over. The essential parts are reproduced below so this file alone
is enough to continue.

---

## Decisions taken

Seven questions were open. These were taken as **reversible defaults** so work could start;
each is a single token or a small change, and any can be revisited.

| #   | Question                          | Taken as                             | Why                                                                                   |
| --- | --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | PRISM has no red for danger       | **`#B42318`** light / `#FF7A94` dark | Magenta already carries "awaiting", and is not red enough to read as error            |
| 2   | Keep dark mode?                   | **Keep**                             | Parity is enforced by the build guard; dropping it is a bigger change than keeping it |
| 3   | Caprasimo on the public site?     | **Deferred**                         | The landing page deliberately loads no web fonts. Phase 4 decides                     |
| 4   | Paid Collabs                      | **Token-skin only**                  | ~25k lines vendored; Phase 6 revisits                                                 |
| 5   | Product name                      | **PRISM**, Wurx Media as the company | Affects ~15 hardcoded strings                                                         |
| 6   | Icons                             | **lucide-react only**                | No `react-icons`; a second icon set duplicates every glyph                            |
| 7   | Brand-hub colour vs violet accent | **Deferred to Phase 3**              | Hubs re-tint the palette per brand today                                              |

---

## The two rules that everything depends on

**1. Keep every `--wx-*` token NAME. Change only its VALUE.**
`scripts/build/check-contrast.mjs` hardcodes ~40 token names and fails with "token not found" if one
goes missing. Renaming to `--prism-*` breaks the build everywhere at once.

**2. `--wx-bg` is `#ECECF3`, not white or mist.**
Neomorphism needs a mid-light ground so a white highlight is visible. White on mist is
**1.18:1 — invisible**. The ground steps down; mist and white become the _raised, lit_
surfaces. This one choice is what makes the language work.

---

## Phases

| Phase | What                                                     | Status                    |
| ----- | -------------------------------------------------------- | ------------------------- |
| 0     | Decisions                                                | **Done** (defaults above) |
| 1     | Tokens, contrast guard, neo shadow layer                 | **In progress**           |
| 1b    | Fonts (Caprasimo + Figtree), PrismWordmark, rename sweep | Not started               |
| 2     | Primitives + component gallery route                     | Not started               |
| 3     | Creator app screens                                      | Not started               |
| 4     | Public site + Apply                                      | Not started               |
| 5     | Admin app (16 screens)                                   | Not started               |
| 6     | Paid Collabs token-skin                                  | Not started               |
| 7     | Hardening: mobile perf, a11y, visual regression          | Not started               |

**Gate for every phase:** `pnpm build` green (runs check-contrast, check-brand-theme,
check-isolation, tsc, vite), both themes render, no horizontal overflow at 375/768/1024/1440,
zero console errors.

---

## Log

### Phase 1 — tokens (branch `feature/prism-phase-1-tokens`)

Started 2026-10-08. Branched from `origin/dev` at `58ada7c`.

Scope: `src/styles/tokens.css` (both theme blocks) and `scripts/build/check-contrast.mjs`, in one
commit — the guard must change with the values or the build breaks.

Not in scope: fonts, the logo, the rename, and any screen. Screens will look half-dressed
after this phase. That is expected and correct.

---

## Gotchas that have already cost time

- **Never put `backdrop-filter` on an ancestor of the WurxBase fence.** It changes the
  containing block for fixed overlays; three rewrites are recorded after modals landed 3,413px
  down the page.
- **`browser.mjs` runs Chromium with `--disable-gpu`.** Every browser test is software
  rendered, so it cannot judge shadow or blur cost. A real mid-range phone is required.
- **`ensureAllTime` detects the active state by reading `rgb(255,255,255)`.** A palette whose
  active state is not white-on-accent breaks every suite that calls it.
- **`verify:all` runs 13 of ~60 suites** and excludes every `collab-*` check — including the
  only one that reads real rendered pixels.
- **Nothing enforces the no-hex or rem-only rules.** 11 violations already exist in 3 files and
  the build passes.
- **Under `forced-colors`, shadows disappear.** A borderless neomorphic control becomes
  invisible — which is why every control carries a hairline as well as its shadows.
- **`motion`, not `framer-motion`.** `LazyMotion` runs with `strict`, so `motion.div` throws at
  runtime. Always `m.div`.
- **No service key on this machine** (403 on the dev project), so fixtures must be made through
  the product's own flows: sign up, then approve as staff.
- **Test creator**: `wx-test-creator@wurxmediahub.dev` / `wurx-test-creator-2026!` — approved,
  one Penetrex job at content pending. Made via the real flows, not SQL.

---

## The token map, reproduced

Light is primary; dark is derived. Keep the names.

| Token              | Light     | Dark      |
| ------------------ | --------- | --------- |
| bg                 | `#ECECF3` | `#1B1B26` |
| surface-1          | `#F1F1F7` | `#212130` |
| surface-2          | `#F7F7FB` | `#282838` |
| surface-3 / field  | `#E2E2EB` | `#15151E` |
| text               | `#14141C` | `#F5F5FA` |
| text-muted         | `#4A4A5A` | `#B9B9C8` |
| text-faint         | `#62627A` | `#A2A2B6` |
| text-inverse       | `#F7F7FB` | `#1B1B26` |
| border             | `#DCDCE6` | `#2E2E40` |
| border-strong      | `#C9C9D6` | `#3E3E54` |
| border-interactive | `#80809A` | `#7C7C96` |
| accent             | `#6A2FE0` | `#A878FF` |
| accent-hover       | `#4A16B8` | `#BC97FF` |
| accent-active      | `#3A0F96` | `#CBB0FF` |
| on-accent          | `#FFFFFF` | `#14141C` |
| success            | `#0B6F69` | `#17E0D4` |
| danger             | `#B42318` | `#FF7A94` |
| warning            | `#8A5A00` | `#F0B429` |
| info               | `#0B5CC4` | `#5CA8FF` |
| stage-live         | `#4E56D3` | `#8EA0FF` |
| stage-due          | `#965500` | `#F5AE4B` |
| stage-paid         | `#007C3A` | `#5BCC80` |
| tier-0             | `#62627A` | `#A2A2B6` |

**Three failures caught by the maths before any code was written**, all caused by the darker
ground: light `stage-due` `#9F5B00` → 4.4978 (use `#965500`), dark `tier-0` `#9d9387` → 4.37
(use `#A2A2B6`), dark accent raw violet `#9B5CFF` → 3.70 (use `#A878FF`).

**The spectrum is a fill, never an ink.** All four fail as text on white — cyan is 1.66:1. Use
the inks: violet `#5A1FD0`, cyan `#0B6F69`, magenta `#B0145C`, blue `#0B5CC4` (new, the kit
has none).

**Neo shadow layer**, light source top-left — highlight `(-x,-y)`, shadow `(+x,+y)`:

| Token                  | Light                    | Dark                      |
| ---------------------- | ------------------------ | ------------------------- |
| `--wx-neo-light`       | `rgba(255,255,255,0.90)` | `rgba(255,255,255,0.045)` |
| `--wx-neo-dark`        | `rgba(130,130,160,0.32)` | `rgba(0,0,0,0.55)`        |
| `--wx-pressed-surface` | `#E7E7EF`                | `#181822`                 |

Dark is **redrawn, not inverted**: a pale highlight on black reads as glow, so dark keeps the
highlight at 4–5% white and uses true black for the shadow.

---

## Session 2026-10-08 (b): shell, halo, spectrum

Rashid reviewed light mode and raised six things. All six are fixed; what follows is what
was actually wrong, because several of my first diagnoses were incorrect.

### The phone nav: one bug, not two

"Why all the nav bar elements are not in smaller screens? And the navigator is also not
accurate, it doesn't point to the tab you are on."

Both halves were `.slice(0, 5)` in `AppShell`. A creator has seven destinations. Open the
sixth and the bar not only lacked the item, it had nothing matching the current URL to
light, so `activeIndex` was `-1` and the lamp went out. The cap is gone: up to five share
the width, beyond that each keeps a thumb-sized minimum and the bar scrolls, with the
active item scrolled into view. Also fixed in `MobileNav`: the lamp is the list's first
child, so `children[activeIndex]` pointed one item left of the truth whenever a lamp was
drawn. It now queries `[data-nav-item]`, and re-measures on `document.fonts.ready` and via
`ResizeObserver` (neither the rail collapsing nor the text-size control fires `resize`).

### The halo: VANTA cannot work on a light ground

The important finding, measured rather than assumed. HALO's ring is **additive light**. On
Ink it produces the spectrum; on a near-white ground every channel is already near 255, so
it clips to white and vanishes. Same clip, same page:

| theme | mean saturation | distinct colours |
| ----- | --------------- | ---------------- |
| dark  | 0.308           | 593              |
| light | 0.015           | 1                |

Removing the scrim (0.55 to 0.22) moved light from 1 colour to 4, so the scrim was never
what hid it. A light base, a violet base and a dark base were all tried; the first two gave
a white blob and the third a dark slab, which is the login Rashid called pathetic.

**So light mode paints its own aurora in CSS** in the kit's four spectrum colours, and dark
keeps VANTA. After: light saturation 0.128 with luminance still 0.875 (a light page).
The halo is now mounted once in `AppShell` for every tab rather than on Home alone, so
moving between tabs does not tear down a WebGL context.

### Colour: the spectrum was collapsed onto violet

"I see only purple everywhere." Correct, and against the kit, which assigns
magenta = accent 1, violet = accent 2 and **primary interactive only**, blue = accent 3,
cyan = accent 4 / growth. Fixed in light mode:

- `--wx-info` was `#5a1fd0`, a **violet under a blue tint**. Now `#1559ce`.
- `--wx-stage-live` likewise violet with a blue tint. Now `#1559ce`.
- `--wx-danger-soft` was a leftover **red** under a magenta ink. Now magenta.

`#1559CE` is derived (6.26:1 on white): the kit ships dark inks for violet, cyan and
magenta but **none for blue**.

The kit also says spectrum colours are never full-bleed backgrounds, so the card gradients,
the sheet band and the glass glow are Ink-tinted neutrals rather than the violet I had just
put there.

### Live gold still in the palette

Not just stale comments. `--wx-accent-gradient-hover` was `#d8a15b -> #f0bb72`, so hovering
the primary button in dark mode turned it **gold**. Also gold: `--wx-card-rim-hover`, two
card gradients, `--wx-sheet-band`, `--wx-glass-glow` and `--wx-warning-soft` (a yellow wash
under a magenta ink). All replaced. `DEFAULT_BRAND_COLOR` is now PRISM violet.

### The "black border lines"

My first guess, double borders on neo surfaces, was **wrong** - there were none. The real
cause was cards never converted at all, still `border border-line bg-surface-1 shadow-*`,
sitting beside converted ones. Creator screens, the Brand Hub and the shell are now one
material. The top bar's `border-b` and the rail's `border-r` are gone; both drew a hard
rule across a soft page.

### The sidebar is a card

Per Rashid. `AppSidebar` paints nothing now; the rail wraps it in a floating
`wx-neo-raised` card inside `p-3`, and the mobile drawer supplies its own `bg-bg` because
it slides over live content and must be opaque.

### Not verified

Nothing under `/app/*` has been seen in a browser - there is still no creator login on dev.
The login page is verified in both themes with real WebGL (SwiftShader; the repo's
`browser.mjs` uses `--disable-gpu`, so it cannot test this). Responsive widths for the new
rail card and scrolling phone bar are unverified.
