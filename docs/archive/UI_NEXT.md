# PRISM, what to build next in the UI

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

Written 2026-10-09, after the rebrand landed on `feature/prism-phase-1-tokens`.

This is a working plan, not a wish list. Every item says what it is, why it is
worth doing, how it is done in this codebase, and what it costs. Numbers in it
were measured on this branch, not estimated — where something is a guess, it
says so.

Read §1 first. It is the part that changes what the product is worth.

---

## 0. Where the UI actually is today

**Done.** The material is PRISM: neomorphic surfaces, no borders anywhere except
a `forced-colors` fallback, the kit's Ink-tinted shadows, Caprasimo and Figtree
self-hosted, the spectrum distributed properly (violet interactive, cyan
positive, blue informational, magenta warning/danger), a warp backdrop on every
tab, a floating rail and top bar, and a phone nav that carries every
destination.

**The honest gap.** Almost none of it has been seen rendered. There is no
creator login on dev and no admin credentials in the build environment, so
Home, Brand Hub, My numbers, Leaderboards, Contests and the whole admin panel
have been changed — roughly 100 files — and never looked at. **The first real
task below is not on this list: it is opening every signed-in screen and
looking at it.** Everything here assumes that happens first, because some of it
will be wrong.

---

## 1. Make it more practical

Practical means the same thing the product means: _a creator logs in and sees
their real GMV._ Every item here is judged by whether it shortens the path to a
number somebody actually wants.

### 1.1 Answer the question on the first screen, not the second

Home currently opens on Overview and shows what the creator has _agreed_, with
the pipeline a tab away. The question creators actually arrive with is closer to
**"what am I owed, and when does it land?"**

- Put the next payment — amount and expected date — in the hero, beside the
  total. It is the single most-asked question and it is currently two clicks and
  a mental sum away.
- "In progress $400" is a state, not an answer. Say _what has to happen next and
  who is holding it_: "4 of 10 videos filmed — you", or "awaiting brand
  approval — since Aug 19".
- Where a number is zero, say why. "$0 paid" with no explanation reads as
  broken; "nothing settled yet, first payment after your 10th video" does not.

**Cost:** low, it is mostly copy and one derived field. **Value:** high.

### 1.2 Make every number say how fresh it is

GMV comes from Seller Center on a delay. A figure with no timestamp is a figure
nobody fully trusts, and _transparency is the product_.

Add a quiet "updated 14 minutes ago" under the headline figure, and a visible
state when a sync has failed rather than silently showing yesterday's number.
This is the cheapest trust win available.

### 1.3 Empty states that tell you what to do

There are designed empty states already. Audit them against one rule: an empty
state must name **the next action**, not describe the emptiness. "Nothing here"
in seven pipeline columns (see the Pipeline screenshot) is seven wasted
rectangles — only the column you can act on needs words at all.

### 1.4 Keep the view the user chose

Date range, brand filter, tab and sort should survive a refresh and be in the
URL, so a creator can bookmark "my numbers, Penetrex, last 30 days" and an admin
can paste a filtered view to a colleague. `useSearchParams` is already used on
Home; extend it rather than adding state.

### 1.5 Finish the keyboard and screen-reader story

The borderless material raised the stakes here: shape is now carried by shadow
alone, so focus has to be unmistakable. Specifically:

- Every focus-visible outline survived the border purge — verify that in a
  browser, tabbing through, not by grep.
- The phone nav announces `aria-current`. The desktop rail should too.
- Live regions for anything that updates without a click (sync status, a figure
  refreshing), or screen-reader users never learn it changed.

### 1.6 One thing to stop doing

Do not add more tabs to Home. It has two; a third is how a dashboard becomes a
filing cabinet. If something new is important enough for Home, it displaces
something.

---

## 2. A more interactive dashboard

Interactive is only worth it when the interaction answers a question. Ranked by
value per unit of work.

### 2.1 Time range on everything (highest value) — BUILT, with a correction

> **What this section got wrong.** "Every figure on the page becomes a
> comparison the moment a range exists" is not true of Home. Most of it —
> the hero money, the counts band, the pipeline — is a **current-state
> snapshot** (agreed, paid, waiting), which has no time axis to compare across.
> Only the ad numbers (GMV, spend, orders, ROI) are daily rows.
>
> So the range drives a new **"Your ad numbers"** band rather than the whole
> page. The lesson generalises: before promising a comparison, check the figure
> is a _series_ and not a _balance_.

`DateRangePicker` already exists, is well tested, and is used on My numbers. Put
it on Home. Every figure on the page becomes a comparison the moment a range
exists, and with it:

- **Comparison to the previous period.** "+24% vs September" is from the brand
  kit's own mock, and it turns a number into a direction.
- **Sparkline per KPI.** A 40px line behind each figure costs almost nothing and
  removes the need to open a chart to know the shape.

### 2.2 Drill-down instead of navigation

Clicking a KPI should open what it is made of, in place. Clicking "$400 in
progress" should reveal the one job it comes from without leaving Home. The
Pipeline tab is already this data; the interaction is what is missing.

Use a disclosure in the card, not a modal. A modal on a dashboard is a dead end;
an inline expansion keeps the context that made you curious.

### 2.3 Live updates where they matter

Supabase Realtime is in the stack and unused in the UI. Two places earn it:

- **A stage moving.** When an admin approves a video, the creator's pipeline
  should move without a refresh. This is the moment the product is _about_.
- **Contest leaderboards**, where the whole point is the position changing.

Everywhere else, polling with the existing `staleTime` is correct and cheaper.
Realtime on a dashboard that does not change is a socket held open for nothing.

### 2.4 Chart interaction

`PerformanceChart` (removed 2026-10-30) has tooltips. Add a crosshair that reads **both** series at
the hovered date, and make the legend a toggle. On touch there is no hover, so
the crosshair must follow a drag — that is the whole reason this is listed as
work rather than a one-liner.

### 2.5 Goal and pace — BUILT, with a correction

> **What this section got wrong.** "The pace needed to finish on time" cannot be
> computed, because **nothing in the schema carries a deadline** — not offers,
> not applications, not `job_progress`. A "needed pace" with no due date would
> be invented, and inventing a number on the one screen whose whole promise is
> transparency is the worst possible place to do it.
>
> So it reports the creator's **actual** pace and the finish date that pace
> implies: "2.1 a week so far: at that pace the last one is approved around
> 3 Nov." Only approved videos count, it stays quiet until a job is three days
> old, and it says nothing once the job is done.
>
> **A needed pace needs a deadline on offers first.** That is a schema change,
> so it belongs in `PARKED.md`, not here.

---

## 3. 3D in the cards

This is achievable and it suits the material — neomorphism already implies a
light source and a surface, so depth is a continuation rather than a new idea.
It is also the item most likely to look cheap if done carelessly, so the
constraints matter more than the technique.

### 3.1 The technique

Pointer-tracked tilt, driven by CSS custom properties, with the rotation on the
card and the perspective on its container:

```
container:  perspective: 1000px
card:       transform: rotateX(var(--rx)) rotateY(var(--ry)) translateZ(0)
            transition: transform 220ms var(--wx-ease)
```

Set `--rx` / `--ry` from pointer position in a `pointermove` handler, clamped to
about **6 degrees**. Past roughly 8 the text edges start to blur on a non-retina
screen and it reads as a gimmick.

Three layers of depth, in order of cost:

1. **Tilt** — the card itself (above).
2. **Parallax** — the figure inside it moves on `translateZ(20px)`, so the
   number floats above its own card. This is the effect that actually reads as
   3D; tilt alone mostly reads as wobble.
3. **Moving highlight** — a radial gradient following the pointer. This one is
   _mandatory_, not decoration: a card that tilts while its lit edge stays put
   looks wrong in a way people notice without being able to say why.

### 3.2 The constraints, every one of which is load-bearing here

- **`m.*`, never `motion.*`.** `LazyMotion` runs in `strict` mode; `motion.div`
  throws at runtime. This has already broken a screen once.
- **The light stays top-left.** The whole material is built on one light source.
  A tilt that moves the highlight to the wrong edge breaks every neighbouring
  card, not just the tilted one.
- **`(pointer: fine)` only.** There is no cursor on a phone, and most of the
  audience is on one. Touch gets a press-depth on `:active` instead, which the
  `wx-neo-press` utility already does.
- **`prefers-reduced-motion`: off entirely.** Not reduced — off. A tilting card
  is exactly what that setting exists to stop.
- **Never a `backdrop-filter` above `.wurxbase-root`.** It has broken the
  vendored admin app's layout three times. Depth there must come from transforms
  and shadows only.
- **Transform and opacity only.** No animating `box-shadow` per frame: it is a
  paint, not a composite, and 20 cards doing it will drop frames on a mid-range
  Android — which is the device this audience is actually holding.
- **Not on everything.** Tilt the hero card and the KPI cards. A list of 40 rows
  that all wobble is noise, and it makes a dense screen unreadable.

### 3.3 How to know it worked

Record a trace on a throttled CPU and confirm the frames stay composited. The
existing browser harness runs `--disable-gpu`, so **it cannot answer this
question** — it must be a real browser.

---

## 4. Optimisation

All figures measured from `vite build` on this branch.

### 4.1 What the bundle actually looks like

| Chunk             | Raw         | Gzip      | What it is                    |
| ----------------- | ----------- | --------- | ----------------------------- |
| `App-*.js`        | 1,055.88 kB | 303.40 kB | the vendored Paid Collabs app |
| `App-*.css`       | 638.05 kB   | 81.42 kB  | its stylesheet                |
| `xlsx`            | 424.70 kB   | 141.48 kB | spreadsheet export            |
| `paidcollabs.css` | 378.48 kB   | 51.01 kB  | our overrides for it          |
| `react-vendor`    | 275.98 kB   | 87.61 kB  | React                         |
| `supabase-vendor` | 204.74 kB   | 52.53 kB  | Supabase client               |
| `html2canvas`     | 199.56 kB   | 46.78 kB  | PDF rendering                 |
| `index.es`        | 151.48 kB   | 48.93 kB  | jsPDF's ESM build             |

**The vendored admin app is the problem, and it is not close.** One chunk is
1 MB raw, and with its two stylesheets it is roughly 2 MB of the build. Nothing
else on this list matters by comparison.

### 4.2 The findings worth acting on

**`jspdf` is statically imported in two places** — `src/routes/admin/contract-paper.js:48`
and `src/vendor/wurxbase/contractPdf.js:17`. Everywhere else the heavy libraries
are loaded with `await import(...)`, which is correct and already done. Those two
static imports are what can drag jsPDF and its 151 kB ESM chunk into a chunk
that loads eagerly. **Check whether they do before changing anything** — if the
file is only reached from an already-lazy route, this is free and not worth
touching.

**`staleTime` is set in 41 files, 99 times.** The performance habit in
`CLAUDE.md` is being followed. Do not "fix" this.

**The CSS is large but compresses well** — 638 kB to 81 kB gzip. It is not the
first thing to chase.

### 4.3 In order

1. **Confirm the vendored app is route-split.** `router.tsx:196` lazy-loads
   `PaidCollabs`, so it should already be off the critical path. Verify it with
   a coverage trace rather than by reading the code — a single static import
   anywhere in the graph undoes it.
2. **Check the two `jspdf` static imports** (above).
3. **Make `Dashboard.tsx` smaller.** 1,154 lines in one file is hard to review
   and guarantees that any change re-renders more than it needs to. Split by
   section — hero, KPI band, pipeline, timeline — each with its own memo
   boundary.
4. **Then measure before doing anything else.** Not bundle size: Largest
   Contentful Paint and Interaction to Next Paint on a mid-range Android on 4G.
   The audience is US and UK TikTok Shop creators, who are overwhelmingly on
   phones. A 300 kB gzip chunk that is never fetched on the creator path costs
   them nothing, and a 20 kB one on the critical path might.

### 4.4 Do not bother with

- Replacing `xlsx` or `html2canvas`. They are admin-only, already lazy, and
  swapping a working export library is risk with no user-visible return.
- Shaving the fonts. They are 52.4 kB total for both faces across two subsets,
  after Inter's 130 kB was removed. That is already good.

---

## 5. Suggested order

1. **Look at every signed-in screen in a browser.** Nothing below is worth doing
   on top of something broken, and ~100 files of UI changes are unverified.
2. §1.1, §1.2, §1.3 — practical wins, mostly copy and one derived field.
3. §2.1 — the date range on Home, which unlocks comparisons and sparklines.
4. §4.3 steps 1 and 2 — cheap, and they answer whether there is a real problem.
5. §3 — the 3D cards, once the screens are known good.
6. §2.3 — Realtime, last, because it is the most moving parts for the narrowest
   benefit.

---

## 6. Open questions for Rashid

- **Next payment date** (§1.1): is the expected date derivable from the stage
  and the brand's terms, or does somebody type it? This changes whether §1.1 is
  an afternoon or a schema change.
- **Tilt on the admin panel too**, or creator screens only? The admin panel is a
  working tool and the effect may just get in the way there.
- **How fresh is "fresh"** (§1.2)? Knowing the real sync interval decides
  whether the timestamp reassures or alarms.
