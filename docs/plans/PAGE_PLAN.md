# Page-by-page plan: minimal and practical

Written 2026-10-19. This is the brief every agent reads. It was written from **real signed-in
screenshots** of every creator page, not from the code, so the findings below are what a creator
actually sees. Screenshots are in:

`C:\Users\UMARWU~1\AppData\Local\Temp\claude\c--Users-Umar-Wurx-Wurx-Stuff-Wurx-Stuff-WurxMediaHub\37052881-914e-4213-b94e-b4230debe4e7\scratchpad\plan-shots\`

named `pg-{dark|light}-{1440|390}-{home|numbers|offers|contests|leaderboards|content|brands}.png`
(dark 1440, dark 390 and light 1440 exist for every page). **Read your page's screenshots before
you touch anything.** They are the account of the owner's test creator, "rudely": 3 accepted
offers, 16 videos, GMV $3.2K, no contests, TikTok not connected, tier Rising.

---

## 1. What "minimal and practical" means here

Rashid's instruction: *in every page keep things simple and minimal.* Turned into rules a page can
be checked against (eight of them; the last is the newest):

1. **Say it once.** A fact stated in a header is not restated in a tile. (Home shows $3.2K twice.
   Leaderboards says "you are #1" three times. Offers prints $360 three times per card.)
2. **A repeated absence is one line, not N cards.** If a whole *source* is missing (TikTok not
   connected), say so once for the page and leave the per-item field out. (Content prints "Views
   not reported ⓘ" on all 16 cards.)
3. **A control appears only if it has something to act on.** A search box over an empty list, a
   view switch with one view, a filter over four items: remove them. Rule of thumb: a
   search/sort/filter control shows only above a list of **more than 8 items**. Prefer grouping to
   filtering: a heading that reads "Declined · 2" is the filter and the answer in one.
4. **What she can do comes before what she can only read.** (Home puts "File your video — 9d
   waiting" at the very bottom, under six read-only panels.)
5. **One primary action per card.** Everything else is a link or is gone.
6. **One number per card leads.** Everything else is secondary type.
7. **Copy is exact.** "#1 of 1 creators" is wrong twice (plural, and a rank among one person means
   nothing). Never promise something the screen cannot deliver ("Briefs are on their way").

8. **No explanatory microcopy. The app does not narrate itself.** Rashid, shown "Videos with no
   figure for this sort sit at the end. They are not zero — nobody has reported them.": *"these
   type of instructions needs removal they make the app look like it is made using AI."* A
   sentence whose job is to explain how the page works, why something is absent, what a figure is
   *not*, or to reassure ("Nothing is broken", "That is expected", "Until then you still see…",
   "We do not measure…") is removed. **Keep** labels, states, numbers and button text.
   If you cannot tell whether a sentence is needed, it is not. This covers empty states,
   tooltips behind ⓘ icons, dialog bodies and descriptions. Behaviour stays (missing figures still
   sort last, null is still not zero) — it just does not announce itself.

Money is formatted by **one** formatter: `exactMoney` / `compactMoney` from `@/components/charts`.
Never write `US$` — Offers does, Content does not, and that inconsistency is a bug.

---

## 2. Constraints that are NOT negotiable

**All the current tabs stay, except the two Rashid has deleted.** "Minimal" means simplifying
*inside* each page. No agent removes, renames, regroups or reorders a rail item. The rail is
Home · My numbers · Offers · Contests · Leaderboards · My content · Brand hubs (Support is gone;
Profile is being replaced by an account menu — see agent G).

**The Brand hub is its own floor** (Rashid, 2026-10-19). Offers, Contests, Leaderboards and My
numbers therefore exist twice — globally and per-brand. They must stay *one component each* with a
brand argument, never two implementations that drift.

**Contracts that must survive unchanged** (the hub and the URLs depend on them):
- `Contests({ hubBrandId })` and `Leaderboards({ brandId })` — props the hub passes.
- My numbers reads `?brand=`, `?period=`, `?from=`, `?to=` and `?charts=` from the URL.
- The hub's `?section=` values: `overview`, `offers`, `contests`, `numbers`, `leaderboards`.
- `OfferCard` and `bucketFor` are shared by the Offers page and the hub's Offers section.
- Every string asserted in `scripts/verify/**/check-*.mjs`. If you move or reword one, update the guard in
  the same change and say so. Known ones: `Enter this contest`, `Update progress`, `Apply for
  this`, `You are in`, `with the team`, `already on this one`, `What they sell`, and
  `input[name="search"]`.

**Hard rules (each has a guard or a scar):**
- One blurred panel per page section (`wx-neo-raised`); tiles inside it are `wx-neo-raised-sm`.
  **Never add `backdrop-filter`.** At most 3 blurred layers may paint at once — and the repo guard
  only measures at scroll 0, so count at other scroll positions too.
- Motion runs under strict `LazyMotion`: a bare `motion.div` **throws**. Use `m.div`. Only
  `transform` and `opacity` may animate.
- Every size in `rem`. Tap targets ≥ 2.75rem below `sm` and on coarse pointers.
- **Null is not zero.** Import `NOT_REPORTED` from `@/components/charts`. A missing figure never
  renders as `0`.
- Commission is **not measured anywhere** — it stays "Not reported", never a guess.
- **No new TikTok calls.** No new RPCs, tables or migrations.
- **Never read or show client names or brand budgets.**
- The Leaderboards page may not contain the words payment, reward, fee, payout or earnings.
- Both themes. Dark is now near-black glass (card fill `rgba(0,0,0,0.3)`, very quiet edges); judge
  against that, not against the pale glass the pages were first designed on.
- **When you move an element, delete the original in the same edit, then grep to prove exactly one
  remains.** Duplicates from moves have shipped twice already.

---

## 3. File ownership

| Agent | Owns | Wave |
|---|---|---|
| **A** | Home + My numbers: `routes/app/Dashboard.tsx`, `routes/app/MyNumbers.tsx`, `components/creator/home/*`, `lib/creator/useHomeData.ts`, `lib/creator/useCreatorPeriod.ts`, preview `routes/dev/HomePreview.tsx` + `NumbersPreview.tsx` | 1 |
| **B** | Offers + Contests: `routes/app/Offers.tsx`, `components/creator/earn/ContestsView.tsx` (was `routes/app/Contests.tsx`, moved 2026-10-30), `components/creator/earn/*`, `OfferCard.tsx`, `ApplyDialog.tsx`, `Contest*.tsx`, preview `OffersPreview.tsx` + `ContestsPreview.tsx` | 1 |
| **C** | Content: `routes/app/Content.tsx`, `components/creator/content/*`, preview `ContentPagePreview.tsx` | 1 |
| **G** | Account menu + removing Profile: new account menu in the sidebar user chip, `routes/app/Profile.tsx` (delete), `components/creator/TikTokConnection.tsx`, `routes/OAuthTikTokCreatorCallback.tsx`, preview `AccountPreview.tsx`, and the router/nav edits that removal needs | 1 |
| **D** | Leaderboards: `routes/app/Leaderboards.tsx`, `components/creator/leaderboard/*`, preview `LeaderboardsPreview.tsx` | 2 |
| **F** | Brand hubs (marketplace): `routes/app/BrandHub.tsx`, `routes/app/Brands.tsx`, `components/creator/brand/*`, preview `BrandHubPreview.tsx`; may also delete the now-orphaned `routes/app/MyNumbers.tsx` and `routes/dev/NumbersPreview.tsx` (the latter removed 2026-10-30) | 1 (promoted) |

The Brand hub was promoted to wave 1 once Rashid redefined it as a marketplace: it no longer
embeds My numbers or Leaderboards, so it depends only on B's `OfferCard` and `Contests`, whose
contracts are frozen.

**Frozen — nobody edits these; report what you need and the lead makes the change:**
`src/styles/**` (every token is declared twice, dark first and light second — wrong-theme edits
have happened repeatedly), `components/charts/*` (16 importers), `components/creator/SearchField.tsx`
(5 importers), `components/layout/*` (the shell is shared with admin) **except** as granted to G,
`components/ui/DataState`, `app/router.tsx` and `lib/nav.ts` **except** as granted to G,
`components/landing/**`, `routes/site/**`, `components/ui/WavesField.tsx` and `AuroraBackground.tsx`.

Preview routes are **already registered** (`/dev/numbers` since removed 2026-10-30 with its preview file, `/dev/offers`, `/dev/contests`,
`/dev/leaderboards`, `/dev/content-page`, `/dev/account`, plus the existing `/dev/home` and
`/dev/brand-hub`). Replace your stub file; never edit `router.tsx` for this.

---

## 4. The pages

### Home — agent A
Seen: 1,437px tall at 1440, 2,315px at 390. Seven stacked panels. **$3.2K appears twice** (header
and the GMV tile, with a stray "Not reported" chip beside the headline). The **Commission tile is
permanently empty** and takes a quarter of the metric row. **"Up next" — "File your video, 9d
waiting", the only thing she must do — is the sixth panel.** "Top videos" shows three "Untitled
video" rows (no title data). The pipeline widget and the day-by-day chart are good.

Target: the one thing she must do is visible without scrolling; the headline figure appears once;
Commission stops costing a tile (a single line, still `NOT_REPORTED`); Top videos shows something
useful when titles are absent (brand and date) or is dropped; **Home fits in roughly two screens at
1440.** Day by day, By brand, Tier and the pipeline all stay — they come from the design Rashid
chose — so the savings come from ordering and de-duplication, not from deleting panels.
"Connect TikTok" on the applicant view must call `openAccountMenu('tiktok')` from
`@/lib/account-menu` instead of linking to `/app/profile`.

### My numbers — agent A
Seen: clean, but the chart is **~70% empty**: her figures begin 1 Oct and the axis begins 9 Sept,
so the line is squeezed into the last quarter. And it largely restates Home — the same four
figures, the same chart, and a By-brand bar chart that repeats Home's donut.

Target: the axis starts at her **first measured day** (days after that with no row stay gaps — null
is not zero). Do not remove the page. Reduce the restating where it is cheap; **the question of
whether this page should exist as a separate tab is Rashid's** and is listed in §6.

### Offers — agent B
Seen: three accepted offers, each a dense card. **$360 appears three times per card** (in the
title, as the big figure, and beside "You are in"); two progress bars; a seven-segment stage
tracker; four lines of status text. "US$360" here against "$435" on Content.

Target: an accepted card is brand, name, fee once, current stage, one action. The per-video rate
and the full detail stay reachable but are not on the face. The search box shows only when there is
enough to search. Keep `OfferCard`/`bucketFor` exports — the hub reuses them.

### Contests — agent B
Seen: zero contests, so the page is a **view switch and a search box above an empty list**.

Target: with nothing to show, one sentence and no controls. The "My progress" view appears only if
she holds an entry. Preserve the rules: deadline order comes from the database, a shut contest
she has entered stays visible ("closes the door, never the work"), standing stays anonymous.

### My content — agent C
Seen: **~49 controls** — the highest in the app. A header with a total, four status pills (one of
them 0) and an **"Add a video" button that duplicates the rail's**; then four control groups
(Videos/Jobs, three sorts, brand chips, search); a TikTok banner; then 16 cards each repeating
**"Views not reported ⓘ"**, and "Ad backed" on 15 of 16. Thumbnails are all empty placeholders.

Target: at most two control groups visible by default. The TikTok-absence is said **once** (the
banner already does it) and the per-card views row is omitted while it holds. "Ad backed" marks
the exception, not the rule. A card with no thumbnail does not spend a square on a camera icon.
The page's own "Add a video" is dropped (the rail has it). The "Connect TikTok" button must call
`openAccountMenu('tiktok')`.

### Account menu — agent G
Profile is deleted at Rashid's instruction. It held two things with no other home: connecting and
disconnecting TikTok, and editing the display name. **Decision: both move to a small menu opened
from the sidebar's user chip** ("rudely / rudely@wurxmedia.com"). Nothing else from Profile
survives; the read-only application facts, text size and theme are dropped (text size and theme
live in the top bar). The menu must be **compact** — name, a TikTok status line with one
Connect/Disconnect button, sign out. It must work on phone, where the rail is a drawer. Everything
that linked to `/app/profile` must go through `openAccountMenu`; `/app/profile` then redirects to
`/app`. The admin side uses the same chip and must be **unchanged**.

### Leaderboards — agent D (wave 2)
Seen: she is #1, so the podium shows "rudely · you", a "You are #1 of 10" card says it again, and a
third line says "You are leading the board". A search box over a ten-row list. A truncated caption
("Every day we hold figures for"). Rows span the full width with name far left and figures far
right.

Target: her position is stated once. No search box below ~9 rows. Fix the truncated caption.
Keep the banned-words rule and `Leaderboards({ brandId })`.

### Brand hubs — agent F (redefined 2026-10-19)
**Rashid's brief, verbatim:** *"Brand hubs need really good amount of work. You can see there are
way too much options and navigations as well. The page is overloaded with instructions. Whereas
the purpose of it is that the creator should be able to see the existing brands like a
marketplace and see what they are offering. This page is basically for the brands'
representations for creators so that they can see brands and their offers. Work on it very
carefully and closely. UX wise it seems very difficult to operate."*

So the Brand hub is **not** a per-brand dashboard. It is a **marketplace and showcase**:
`/app/brands` shows the brands as a browsable grid, and a brand's page shows who the brand is and
what it is offering her. **Performance analytics do not belong here** — My numbers is gone as a
page and her figures live on Home.

What was seen (real, signed-in): a header with a brand switcher dropdown, two stat tiles with
sparklines, a commission line, a six-way section control (This brand · Offers · Contests · My
numbers · Leaderboards, plus a "NEXT · Creators Library" line), then "What you can do now" and
"Where you rank" and an explanatory paragraph about what the brand has not filled in. Five
navigation devices on one screen, and more prose than content. For a brand with one offer it is
mostly instructions.

Target: **no section navigation at all.**
- **`/app/brands` is the marketplace:** a grid of brand cards — logo, name, one line on what they
  sell, how many offers are open to her. A search box only above ~8 brands. No tabs, no filters.
- **A brand's page is one scroll:** the brand (logo, name, a line), then **what it offers** —
  its offers as the same cards the Earn page uses (she can apply from here), its contests if any,
  and its products with the commission rate she would earn on each. A section with nothing in it
  does not render; it does not apologise. There is no switcher (the way to another brand is back
  to the marketplace) and no "Where you rank".
- **Drop from the hub:** the My numbers section, the Leaderboards section, the stat tiles, the
  commission line, the six-way control, the "Creators Library" line, and every paragraph
  explaining what a brand has not filled in.
- Applicants still get `LockedUntilApproved`.

**Open data question the agent must answer first:** what does `useCreatorBrands` return — only the
brands she works with, or every brand? A *marketplace* implies she can see brands she does not
work with yet. If the existing read only returns her own brands, **do not widen it** (no new
RPCs, tables or policies): build the marketplace over what she can read, and report exactly what
the gap is so Rashid can decide whether to open it up.

Contracts: `/app/brands` and `/app/brands/:slug` keep working. Old `?section=` links must still
land on the brand's page (ignore the parameter). `scripts/verify/creator/check-live.mjs` waits for the text
"What they sell" and `scripts/shots/shots-hub.mjs` iterates the old `?section=` values — update those in
the same change. `OfferCard`, `bucketFor` and `Contests({ hubBrandId })` are owned by agent B and
must be used as they are, not copied.

---

## 5. How each agent works and reports

1. Read this document, then your page's screenshots, then your code.
2. Replace your preview stub and render your page against fixtures in both themes at 390 and 1440.
   Use `domcontentloaded` and 10s+ waits — `networkidle` times out on the dev server.
3. `pnpm typecheck` only. **Never `pnpm build`** (the lead builds). No git commands.
4. You cannot sign in. The lead can: after you report, the lead captures your page from the real
   signed-in app and may send corrections.
5. **Report:** what you changed; **every control or element you removed, merged or demoted, and
   what replaced it**; every guard string you moved; anything you needed from a frozen file; and
   what you could not verify.

---

## 6. Decisions

**Decided 2026-10-19:**
1. **My numbers is removed as a page.** "No if we are showing everything at Home." The rail item is
   gone, `/app/numbers` redirects to `/app` keeping `?period=`/`?brand=`, and the `MyNumbers`
   component survives only as the Brand hub's embedded numbers section.
2. **Contests folds into Offers.** One page, labelled **Earn** in the rail, path `/app/offers`;
   `/app/contests` redirects to `/app/offers#contests`. "Make sure pages are easy to operate
   themselves as well" — so stacked sections, not a toggle.
3. **The top-bar sentence under each page title is removed** for creators (admin keeps its own).
   Rashid took the recommendation.
4. **Support and Profile are deleted.** Profile's two real jobs live in an account menu on the
   sidebar user chip.

**Still open (these were the original questions; 1–3 above are now answered):**

1. **Should My numbers stay a separate tab?** It restates Home. Keeping both is the current
   decision; collapsing them would be the largest single simplification left.
2. **The rail is now seven items** after deleting Support and Profile. Whether to go further
   (fold Contests into Offers; Leaderboards into Home) is unmade.
3. **The top bar prints a sentence under every page title** ("Everything on the table, from every
   brand you work with.") and an "Add a video" button sits in the rail *and*, until agent C
   removes it, on Content. Both are shell-level (lead's files).
4. **Rashid's earlier instruction to keep all eight tabs** is overridden for Profile and Support by
   his later, explicit "delete the profile and support page".
