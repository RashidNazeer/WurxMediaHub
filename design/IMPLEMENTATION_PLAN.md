# PRISM frontend rebuild — implementation plan

Neomorphic visual language. Light-first, dark retained. Mobile-first. Rebranded from
WurxMediaHub to PRISM.

Status: **plan only. No application code has been written.**

---

## 0. Tool status, checked

| | |
|---|---|
| **21st.dev MCP** | **Alive, but intermittent.** Four calls this session: two succeeded, one `ENOTFOUND`, one `ECONNREFUSED`. Retrying works. Free tier: **unlimited search, 2 component code retrievals per day, no AI generation.** |
| **ui-ux-pro-max skill** | Alive. Search script responds. |
| **Stitch MCP** | Configured; key now resolves after the VSCode restart. |

The 2-retrievals-a-day cap is a real planning constraint. We **search** 21st.dev freely for
reference and only **retrieve** code for components we have decided to build on.

---

## 1. The constraints that shape everything

### 1.1 The two example components cannot be dropped in as-is

| Problem | Detail |
|---|---|
| `framer-motion` | **Not installed, and must not be.** We use `motion` v12 behind `LazyMotion` with `strict`. Under `strict`, `motion.div` **throws at runtime**. Everything must be `m.div`. |
| `react-icons` | Not installed. Our icon set is `lucide-react`. A second icon library is a locked-stack change needing approval, and ships a duplicate of every glyph. Recommend: lucide only. |
| Hardcoded hex | `#e0e5ec`, `#2a2d32`, `#4a5568`, `bg-dark` break the rule that every colour is a `--wx-*` token. |
| Hover-only | The gradient menu expands **only on hover** and is built from `<li>`, so it is unreachable by keyboard and does nothing on touch. Breaks two rules at once. |
| `min-h-screen` | A component that sizes itself to the viewport cannot be embedded. |
| Off-brand colour | Its purple/orange/green gradients are not PRISM. Spectrum is accents-only here. |

**None of this makes them useless** — the *ideas* are good. They get rebuilt against our
tokens, our Motion, our a11y rules. The gradient menu is in fact a strong candidate for the
**mobile bottom nav**, which is the one place its expand-on-select behaviour earns its keep.

### 1.2 shadcn

There is no `components.json` and no shadcn CLI in this repo. `src/components/ui/` holds two
hand-rolled files (`Button`, `Field`) built on `cva` + `tailwind-merge`.

**Do not run `shadcn init`.** It would rewrite `global.css` and `tokens.css` with its own
`--background` / `--primary` variables, clashing with the `--wx-*` bridge and the parity
guard; pull in `tailwind-animate` and a set of Radix packages; and install components under
naming that conflicts with our PascalCase files. We keep hand-rolling, because every
component must consume our tokens and our Motion setup and CLI output does neither.

21st.dev code is **reference, not production**. If we later want Radix for Dialog/Popover/Tabs
specifically, we add that one package deliberately — a locked-stack change needing approval.

**Spending the 2 daily retrievals.** Not on the two components we already have; both must be
rewritten anyway and the metric card is ~40 lines. Spend them where the accessibility work is
genuinely hard and worth studying: **(1) a full Dialog/Sheet with focus trap**, **(2) a
neomorphic input set** (input, switch, checkbox) for the shadow recipe. Search is free and
returns previews — choose before spending. Build the token layer first, or retrieved code has
nothing to map onto.

### 1.3 Guards that will fail if we are careless

- `check-contrast.mjs` (**in build**) — parses `tokens.css` for **hex only**, asserts ~40
  named pairs and dark/light **parity**. Renaming a token, or using `oklch()`, fails the
  build. Must be updated in the same commit as the tokens.
- `check-chrome.mjs` — hard-codes root font-size **15px / 16.5px**, rail **≤250px**, exactly
  one `<h1>` per screen.
- `check-responsive.mjs` — fails on **any** horizontal overflow at 375/768/1024/1440. Soft
  shadows and glows spill easily.
- `check-brand-theme.mjs` (**in build**) — audits the per-brand hub palette derivation.
- `check-isolation.mjs` (**in build**) — guards the vendored WurxBase seam.

### 1.4 Things that are simply true

- **Paid Collabs cannot be redesigned.** ~25k lines of vendored JSX, 1.2MB of its own CSS,
  px-based. Reachable only through `--wx-*` values and two override stylesheets. Six admin
  rows point into it.
- **Never put `backdrop-filter` on an ancestor of the WurxBase fence.** It changes the
  containing block for fixed overlays; the comments record three rewrites after modals landed
  3,413px down the page.
- Fonts: **Caprasimo + Figtree** must be self-hosted woff2, scoped like today's Inter/Sora.
- The name "WurxMediaHub" is hardcoded in ~15 places including the logo component, welcome
  and approval moments, 404, footer, page titles and legal pages.

---

## 2. Symmetry — the pillar, not an afterthought

Rashid: *"there is a symmetry in the whole app from a small button or a warning to a whole tab,
and the colour symmetry is planned properly."*

The current app lost this gradually, and the audit found exactly how:

- three different "row one" patterns (FilterBar / ContestsHeader above it / bespoke tablists)
- cards at `rounded-md` in queues and `rounded-xl` on dashboards
- `h2` at five different sizes across record screens
- three loading treatments: skeletons, a bare `·`, and the text "Loading brands…"
- three confirm patterns: modal, inline "Stop it?", and a danger zone
- control heights set per screen (`h-10`, `min-h-8`, `size="sm"`)

**This is what happens without a single source of truth. The rule for PRISM:**

> **One concept, one component, one token. If it appears twice, it is imported twice —
> never rebuilt.**

### 2.1 The canonical inventory

Every one of these is built **once**, lives in `src/components/ui/`, and is the only legal way
to express that concept anywhere in the app — creator, admin, public.

**Surfaces** — `Surface` (raised | inset | flat), `Card`, `Panel`, `Well`
**Actions** — `Button` (primary | secondary | ghost | danger × sm | md | lg), `IconButton`, `Link`
**Input** — `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `SearchField`, `DateRangePicker`
**Navigation** — `Tabs`, `FilterBar`, `SideNav`, `MobileNav`, `Breadcrumb`, `Pager`
**Data** — `MetricCard`, `StatRow`, `DataTable`, `ProgressBar`, `StageTrack`, `Timeline`, `Donut`, `BarChart`, `LineChart`
**Status** — `Badge`, `Chip`, `Alert`, `Toast`, `LiveDot`
**Feedback** — `Skeleton`, `EmptyState`, `ErrorState`, `Spinner` (loaders only, never a page)
**Overlay** — `Dialog`, `Sheet`, `Popover`, `Tooltip`, `ConfirmDialog`
**Identity** — `Avatar`, `BrandMark`, `PrismWordmark`, `PrismIcon`

**One decision per axis, applied everywhere:**

| Axis | The single answer |
|---|---|
| Card radius | `lg` (24px). No exceptions. |
| Control radius | `sm` (12px). Pills only for badges, chips and bar ends. |
| Row one of every screen | `FilterBar`. Tabs, search and filters on one line, at most one primary action pinned right. |
| Page title | The top bar, and only the top bar. One `<h1>` per screen. |
| Record title | `<h2>`, one size, one weight. |
| Loading | `Skeleton` in the shape of the thing. Never a spinner, never a dash, never "Loading…". |
| Empty | `EmptyState`: icon, one line of what is missing, one line of what to do, one action. |
| Error | `ErrorState`: what failed, and a retry. |
| Destructive confirm | `ConfirmDialog`. Never inline, never bespoke. |
| Control height | `sm` 36px · `md` 44px · `lg` 52px. Three values exist. |

### 2.2 Colour symmetry — every colour has exactly one job

Three layers. A colour never does two jobs, and nothing is chosen per screen.

**Layer 1 — the chassis.** Covers ~95% of every screen. Neutrals only.
`ink` `#14141C` · `white` `#FFFFFF` · `mist` `#F7F7FB` · `line` `#ECECF3` · `body` `#4A4A5A` ·
`muted` `#6B6B7B` · `subtle` `#B9B9C8`

**Layer 2 — one interactive accent: violet.**
Links, focus rings, primary buttons, active tabs, selected rows, the current nav item.
**Nothing else is violet, and every interactive thing is.** A creator learns the colour once.

**Layer 3 — semantic signals.** Meaning only, never decoration.

| Meaning | Colour | Used by |
|---|---|---|
| Positive · growth · paid | **cyan** `#17E0D4` (ink `#0B6F69`) | GMV up, Paid, approved, success |
| In progress · informational | **blue** `#2E8BFF` | work under way, info notices |
| Attention · awaiting | **magenta** `#FF2E8C` (ink `#B0145C`) | awaiting payment, needs you, warnings |
| Destructive · error | **red — DOES NOT EXIST YET, see §8** | delete, reject, failures |

This maps cleanly onto the three kinds of money, which is the ambiguity we must fix anyway:
**agreed/in-progress = blue · awaiting = magenta · paid = cyan.** Violet stays interactive;
that is four colours, which is exactly the kit's "max four per view" ceiling.

### 2.3 How symmetry is enforced, not hoped for

Consistency decays under deadline unless a machine holds it. New checks, specified in §6:
a **component gallery** route rendering every primitive in every state; a **banned-pattern
lint** (no raw hex, no px type, no bespoke card/tab/loading markup outside `ui/`); and a
**token-usage check**.

---

## 3. Phases, each with a gate

Nothing proceeds until the gate passes. Each phase ends with `pnpm build` green and the
relevant guards run.

### Phase 0 — Decisions (blocking, see §8)
No code. Rashid answers the open questions.

### Phase 1 — Foundation
Tokens rewritten to PRISM for both modes · `check-contrast.mjs` updated in the same commit ·
Caprasimo + Figtree self-hosted · `PrismWordmark`/`PrismIcon` components · the rename sweep ·
neomorphic shadow/hairline tokens added.
**Gate:** build green, contrast passes both themes, every screen still renders (it will look
half-dressed — that is expected), no horizontal overflow.

### Phase 2 — Primitives
The full §2.1 inventory, built once, with pressed state, hairline, focus ring and
reduced-motion for each. Plus the component gallery route.
**Gate:** gallery renders every primitive × every state in both themes; keyboard pass; 3:1
boundary check; 44px targets.

### Phase 3 — Creator app (highest value first)
Home → My numbers → Brand hub → Offers → Contests → Leaderboards → My content → Profile →
applicant / first-day / rejected / suspended states.
**Gate per screen:** 375/768/1024/1440, both themes, zero console errors, empty + loading +
error states designed, QA sign-off.

### Phase 4 — Public site and Apply
Landing, the six marketing pages, legal, Apply. This is the only conversion point in the
product and gets its own performance budget.

### Phase 5 — Admin app
16 screens. Dashboard, queues, records, then the heavy ones (ContestSetup 1,328 lines,
BrandHub, OfferRequests, AllOffers, TikTokSettings).

### Phase 6 — Paid Collabs
Token-skin only, through `--wx-*` and the two override sheets. Then a decision on whether any
of it gets rebuilt natively.

### Phase 7 — Hardening
Mid-range phone performance, reduced motion, final a11y sweep, visual regression.

---

## 4. Mobile and responsive

Mobile-first, not desktop-shrunk. Most PRISM creators are on phones.

- **Breakpoints:** 375 · 768 · 1024 · 1440. Every screen checked at all four.
- **Navigation:** bottom nav on phones (the gradient-menu idea, rebuilt and keyboard-operable),
  rail from `lg`.
- **Tables become cards** below `md`. Nothing scrolls the page sideways; wide things scroll
  inside their own container.
- **Tap targets ≥44×44**, spacing ≥8px between them.
- **Neomorphism costs more on mobile.** Dual box-shadows are expensive to composite. On phones:
  reduce to a single shadow pair, drop decorative glows, and never animate shadow — animate
  `transform` and `opacity` only.
- **Safe areas** for notches and home indicators on the bottom nav.
- Phase 7 budgets real numbers on a mid-range Android, not a desktop throttle.

---

## 5. The team

I am the team lead. All agents run **Sonnet 4.5**.

**Working now (prep):**
1. **Design-systems engineer** — the complete PRISM → `--wx-*` mapping for both modes, with
   real contrast maths for all ~40 guard pairs, the spectrum ink variants, and the new
   neomorphic tokens.
2. **Component-library engineer** — the conversion spec for both 21st.dev components and the
   full primitive inventory.
3. **QA lead** — guard-by-guard impact, coverage gaps, the phase test plan, new checks.

**To be spawned per phase:**
4. **Creator-app implementer** — Phase 3 screens.
5. **Admin-app implementer** — Phase 5 screens.
6. **Accessibility QA** — keyboard, screen reader, focus, contrast, 1.4.11 boundaries.
7. **Responsive/mobile QA** — four widths, tap targets, safe areas, performance.
8. **Regression QA** — the existing `verify:*` suites, data correctness, no behaviour change.

**Standing rule:** implementers never merge their own work. QA runs against a built preview,
not a dev server, and reports with evidence.

---

## 6. QA

Existing suites keep running: `check-contrast`, `check-brand-theme`, `check-isolation` (in
build), plus `verify:responsive`, `verify:chrome`, `verify:browser`, `verify:rls`,
`verify:session`.

### What our testing genuinely cannot see today

The QA audit found five gaps that matter specifically for this redesign. Stated plainly so
nobody mistakes a green build for a verified one:

1. **`browser.mjs` launches Chromium with `--disable-gpu`.** Every browser suite runs on
   software rendering. It is therefore **useless for judging the cost of box-shadows or
   backdrop blur** — the single biggest performance risk in a neomorphic UI. Needs a real
   device, or CDP CPU throttling with a trace.
2. **No mobile emulation anywhere.** No `isMobile`, no `hasTouch`, no WebKit/Safari. Only the
   viewport width changes. Tap targets, safe areas and Safari shadow rendering are untested.
3. **`verify:all` runs 13 of ~60 suites.** It excludes every `collab-*` suite — including
   `check-collab-contrast`, which is the *only* check we have that reads actual rendered
   pixels. A green `verify:all` says almost nothing about the visual layer.
4. **Nothing enforces the hex rule or the rem rule.** A grep already finds 11 violations in 3
   files today, and the build passes. Human review is the only guard.
5. **Nothing tests keyboard, focus visibility, forced-colors or 200% text zoom.** Under
   `forced-colors` **shadows disappear entirely** — a borderless neomorphic control becomes
   invisible. This alone justifies the mandatory hairline.

One more trap: `ensureAllTime` in the shared browser helper detects the active state by
reading `rgb(255, 255, 255)`. A PRISM palette whose active state is not white-on-accent
**breaks every suite that calls it.**

**New checks to write:**
- `check-primitives.mjs` — the gallery route renders every primitive × state in both themes
  with no console errors.
- `check-boundaries.mjs` — every interactive control has a ≥3:1 perceivable boundary
  (WCAG 1.4.11). **This is the one neomorphism fails by default.**
- `check-focus.mjs` — every focusable element has a visible focus indicator at ≥3:1.
- `check-no-raw-style.mjs` — no hex literals and no `text-[Npx]` outside `src/vendor`.
- `check-tap-targets.mjs` — ≥44×44 at 375px.
- `check-overflow.mjs` — extend the responsive suite to the screens it does not cover, and to
  open overlays (today it only ever tests closed popovers).

**Fixtures needed.** `wx-test-creator@wurxmediahub.dev` exists and has one job at content
pending. We still need: an applicant, a rejected applicant, a suspended account, a
multi-brand creator, a creator with contest money, and a creator with real GMV. All can be
made through the product's own flows plus a staff approval, as that one was.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Neomorphism fails WCAG 1.4.11 by design | Mandatory hairline on every control; `check-boundaries.mjs` |
| Contrast guard blocks the build on day one | Tokens and guard updated in the same commit; maths done up front |
| Paid Collabs stays visibly old | Accepted and planned for; decide in Phase 6 |
| Soft shadows cost frames on phones | Reduced shadow set on mobile; animate transform/opacity only |
| Symmetry decays mid-project | Gallery + banned-pattern lint; one primitive per concept |
| 2 component retrievals a day | Search freely, retrieve only what we build on |
| Scope: ~25 screens | Phase gates; creator app ships before admin |

---

## 8. Decisions needed before Phase 1

1. **PRISM has no red.** Destructive actions and errors need one — magenta is already carrying
   "attention/awaiting" and is not red enough to read as danger. Do we add a red to the kit,
   or reassign magenta to danger and find another colour for awaiting?
2. **Dark mode: keep or drop?** PRISM is specified light-first. Dark exists today, is enforced
   by the parity guard, and doubles the design work. Keep it, or drop it with the guard
   relaxed?
3. **Does the public site get Caprasimo?** It currently loads **no** web fonts on purpose, for
   landing performance. Caprasimo in the hero costs a request on the conversion page.
4. **Paid Collabs**: token-skin only, or rebuild any of it natively? This is the largest
   single scope question in the project.
5. **Name**: is the product now "PRISM" everywhere, or "PRISM by Wurx Media"? Affects ~15
   hardcoded strings, page titles, legal pages and emails.
6. **Icons**: confirm lucide-only (no `react-icons`).
7. **Brand hub theming**: hubs currently re-tint the whole palette per brand. Does that survive
   PRISM, and if so does a brand colour override violet as the interactive accent?
