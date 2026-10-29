# The creator interface, as it exists today

A complete description of what a creator sees, has and can do inside Prism, written as the
starting point for a redesign.

Everything here was read out of the code on 2026-10-16 (`feature/glass-redesign`, `f91a4c9`).
Where the code and this document disagree, the code is right and this is stale — the file
paths are given throughout so anything can be checked in a minute.

> **Status note, 2026-10-30.** This is a snapshot of 2026-10-16. The page-by-page simplification of
> 2026-10-19 (`docs/plans/PAGE_PLAN.md`) removed Support and Profile, merged Offers and Contests
> into Earn and made the Brands Hub a marketplace, so screen-level detail below is out of date.
> The current rail is in `src/lib/nav.ts`. Files named below that were later deleted are marked
> "(removed 2026-10-30)".

One thing to know before reading: **nobody on this machine has a creator login.** Every screen
below is described from its source, not from using it. That matters most for the parts about
feel rather than structure.

---

## 1. Who is on the other side of this interface

### Two roles share the whole creator app

`src/app/router.tsx` guards every screen below with `RequireAuth allow={['applicant', 'creator']}`.
So an **applicant** — somebody who has applied and not yet been approved — reaches exactly the
same routes a **creator** does. The difference is what each screen gives them once inside, not
which doors exist.

An applicant hits `LockedUntilApproved` (`src/components/creator/LockedUntilApproved.tsx`) where
a creator would get a brand hub. Its words: *"This opens when you are approved."*

This is a deliberate design, and it is worth keeping or changing **consciously** in a redesign:
the applicant walks the real building with most rooms locked, rather than being parked in a
waiting area. It sets an expectation of what approval buys.

### Four tiers, which are not roles

`src/lib/tiers.ts`:

| tier | label |
|---|---|
| `creator` | Creator |
| `rising` | Rising |
| `pro` | Pro |
| `elite` | Elite |

A note in that file is worth repeating, because it has bitten before: a creator on the starting
tier is a *Creator* with the tier *Creator*. Wherever both appear, label the tier **as a tier** or
it reads as a bug.

Tiers decide what she is offered, not what she can see.

---

## 2. The shell she is always inside

`src/components/layout/ShellLayout.tsx` → `AppShell.tsx`. Every signed-in route nests under it,
creator and admin alike — which is why changing the rail or the top bar changes both.

- **Desktop**: a left rail (`AppSidebar`), a top bar with the section name, a text-size control
  and a theme toggle.
- **Phone**: the rail becomes a slide-over drawer; navigation moves to a fixed bottom bar
  (`MobileNav.tsx`) that tracks the browser's own toolbar via `visualViewport`.
- **Behind everything**: the aurora field (`AuroraBackground.tsx`, mounted through `HaloBackdrop`).

### Her navigation, in order (`src/lib/nav.ts`)

1. **Home** — `/app`
2. **My numbers** — `/app/numbers`
3. **Brand hubs** — `/app/brands`
4. **Leaderboards** — `/app/leaderboards`
5. **Offers** — `/app/offers`
6. **Contests** — `/app/contests`
7. **My content** — `/app/content`
8. **My profile** — `/app/profile`

Eight destinations. For a redesign that is the first real question: **are these eight things of
equal weight?** They are presented as though they are. "My numbers" is described in its own
source as *"the moment the product exists for"*, and it sits as item two in a flat list next to
"My profile".

---

## 3. Every screen

### Home — `/app` (`routes/app/Dashboard.tsx`, 1,344 lines)

The landing screen after sign-in, and the most conditional screen in the app: it renders
differently for an applicant mid-application, a newly approved creator, and a working creator.
It carries the onboarding overlay, the welcome and approval moments
(`WelcomeMoment`, `ApprovedMoment`, `FirstDay` (removed 2026-10-30)), the stage tracker for her application, and a
summary of her work in flight.

Reads: `useProfile`, `useApplication`, `useOnboarding`, `useMyWork`, `useMyStageEvents`,
`useWorkSummary` (removed 2026-10-30).

For a redesign: this screen is doing at least three jobs — onboarding, application status,
and a work dashboard. Worth asking whether they should be one screen.

### My numbers — `/app/numbers` (`MyNumbers.tsx`, 956 lines)

The product's centre. Her real GMV, the commission on it, and the ad spend put behind her
videos.

Two tabs — **Dashboard** and **My content** — defaulting to Dashboard, because the first
question is *"how am I doing"*, not *"list my videos"*. Filters: brand, and a date range.
Sections jump-linked as **Money**, **Day by day**, **Videos & ads**, **By brand**.

Two properties any redesign has to preserve:

- **No TikTok call happens here.** A nightly job writes complete days to our own table and this
  reads that table. It is why the date filter is instant and free, and why a creator cannot run
  up a bill or reach TikTok at all.
- **Figures are TikTok's own**, in TikTok's currency, and nothing is rounded into looking
  better than it is.

Reads: `usePerformance` → `creator_performance_window`, `creator_daily_performance`,
`creator_video_performance`, `creator_brand_performance`.

### Brand hubs — `/app/brands` and `/app/brands/:slug`

`Brands.tsx` (112 lines) is the index: every brand she can work with. What appears is decided
by the database, not the screen — retired brands never arrive, and the client name and budget
live in a table she cannot read at all.

`BrandHub.tsx` (1,161 lines) is one brand, with three lazy-loaded sections: **numbers**,
**contests**, **leaderboards**. An applicant gets `LockedUntilApproved` here.

Reads: `useCreatorBrands` → `brands`, `brand_products`, `offers`.

### Leaderboards — `/app/leaderboards` (517 lines)

What every creator's videos have actually sold. Three rules are written into the source and
each is a design constraint:

- **The number is GMV and only GMV.** Not a payment, not a reward, not a fee — and none of
  those words appear on the screen.
- **Names are shown.** This is the one place that is not anonymous; the contest standing stays
  anonymous deliberately.
- **Only creators with real figures appear.** A zero would mean *"not measured yet"*, not
  *"sold nothing"*, so absence is explained rather than shown as nil.

Reads: `creator_leaderboard`, `my_leaderboard_standing`.

### Offers — `/app/offers` (261 lines)

Every offer open to her across every brand — the answer to *"what is on the table anywhere"*,
which previously meant visiting each hub in turn.

Filtering is done **in the browser**, deliberately against the project's usual rule: the states
that matter ("am I in", "am I waiting", "have I not asked") live in a different table from the
offers, so one round trip beats two.

Reads: `useAllOffers`, `useOfferApplications` → `offers`, `offer_applications`.

### Contests — `/app/contests` (1,356 lines — the largest creator screen)

Every contest open to her, ordered by **which deadline runs out first**, in the database,
because that matches why she opened the screen.

The governing rule: *a contest that is switched off or past its deadline closes the **door**,
never the **work***. Anyone already entered still sees it, still delivers and still gets paid,
so a contest she holds an entry in is never dropped from this list.

Supporting components: `ContestDashboard`, `ContestEntryDialog`, `ContestProgressDialog`,
`ContestEarnings` (removed 2026-10-30), `Confetti`.

Reads (the widest surface in the app): `contests`, `contest_entries`, `contest_entry_targets`,
`contest_entry_terms`, `contest_entry_progress`, `contest_entry_confirmed_totals`,
`contest_deliverables`, `contest_products`, `contest_progress_updates`, `contest_awards`, and
`my_contest_standing`.

### My content — `/app/content` (845 lines)

Every video she filed and how each is doing. **Three sources joined in the browser**, because
no single one has it all:

| source | gives |
|---|---|
| `useMyContent` → `content_submissions` | the filed video and its review status |
| `useVideoPerformance` (by submission id) | the ad story and the GMV behind it |
| `useTikTokVideos` (by post id in the link) | views, likes, comments |

Each is optional; a video with no match in a source simply shows nothing from it.

**Null is not zero.** A figure TikTok withheld, or an account that is not connected, is left
**out** — never drawn as `0`. Any redesign of these cards has to keep a visual difference
between *nothing to report* and *zero*.

### My profile — `/app/profile` (243 lines)

Her own account: identity and settings, *"nothing heavier"*. Display name (blank clears it,
capped at 60 characters), and the TikTok connection (`TikTokConnection.tsx`,
`creator_tiktok_connections`).

---

## 4. The data she has

Everything the creator app can read, in one place.

**Through RPCs** (the database decides what she may see):

- `creator_performance_window`, `creator_daily_performance`, `creator_video_performance`,
  `creator_brand_performance`
- `creator_leaderboard`, `my_leaderboard_standing`
- `my_contest_standing`

**Through tables**: `profiles`, `brands`, `brand_products`, `offers`, `offer_applications`,
`offer_stage_events`, `content_submissions`, `creator_tiktok_connections`,
`creator_tiktok_videos`, `contest_awards`, and the ten contest tables listed above.

### What she cannot see, and that is the point

- **Other creators' money**, except GMV on the leaderboard, where it is named and deliberate.
- **The contest standing is anonymous** — unlike the leaderboard.
- **Brand budgets and client names.** They live in tables the creator app never queries.
- **Anything in Paid Collabs** (`/admin/collabs/*`), which is staff-only and carries its own
  1 MB bundle the creator never downloads.

---

## 5. What a redesign must not break

These are not style preferences. Each has a guard in `scripts/` that fails the build, or a
scar in the history.

1. **No `filter` or `backdrop-filter` on an ancestor of `.wurxbase-root`.** Either creates a
   containing block for `position: fixed` and sends modals thousands of pixels down the page.
   `check-backdrop-ancestry.mjs`.
2. **Only `transform` and `opacity` may animate**, and at most 3 blurred layers may paint at
   once. `check-blur-budget.mjs`. Its known blind spot: it measures at scroll 0 only.
3. **Contrast.** `check-contrast.mjs` covers ~46 token pairs — but **skips translucent tokens by
   design**, so glass surfaces are not checked by anything. Text on glass has to be measured by
   hand.
4. **44px tap targets** below `sm`, and on any coarse pointer.
5. **Every size in `rem`.** A text-size control scales the root font size; `px` ignores it.
6. **Null is not zero** (My content, and everywhere a figure can be withheld).
7. **Both themes, always.** Several bugs this week existed in one theme only.

### Current known weak points, honestly

- **Light mode glass is nearly edgeless.** Measured: white rims read 1.03–1.14:1 against the
  fill, so cards are defined by their drop shadow alone.
- **Dark muted text on glass measures 3.68–5.09:1** in places — below AA 4.5 — because a 10%
  white fill lightens the card. No guard catches it.
- **The creator app's load time has not been profiled.** The landing page is fine (427 KB,
  FCP 1.2 s on a throttled phone); the 1 MB `App-*.js` and 638 KB `App-*.css` are admin-only.
  Where the signed-in creator cost actually is, nobody has measured — it needs a login.
- **Eight flat navigation items** of visibly unequal importance.
- **Home is three screens in a trench coat**: onboarding, application status, work dashboard.
