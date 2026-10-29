# What a creator sees, and what she should see

> **Archived 2026-10-30.** Finished or superseded work, kept for history. It describes the code and decisions as they were when it was written, so file names in it may be gone. For where things stand now read `docs/PROJECT_STATE.md`; the docs index is `docs/README.md`.

> **DECISION, 2026-10-19 (Rashid): the Brand hub stays, and it stays as its own floor.**
> Every recommendation below that treats a brand as a *filter*, or proposes removing the
> five-section hub, is **superseded** and is left in place only as the reasoning that was
> weighed. What the decision changes is spelled out in the final section, "After the decision".


A review of Prism's creator navigation against Cruva's, and a recommendation for cutting it
down. Written 2026-10-17, read out of the code (`src/lib/nav.ts`, `src/routes/app/*`) rather
than from memory, so the counts are what actually ships.

---

## 1. The short version

**A Prism creator meets nine destinations in the rail, and more navigation inside them. A Cruva
creator meets four.**

That is the whole finding. Everything below is the detail behind it and what I would do.

The deeper problem is not the count on its own — it is that **five of our nine screens exist
twice**: once globally in the rail, and again inside every Brand hub. A creator who wants to see
a contest can arrive at it two ways and cannot tell which one she is in.

---

## 2. What a creator sees today: nine tabs

The rail is grouped into four blocks. Groups are headings, not destinations.

| # | Tab | Route | What is on it |
|---|---|---|---|
| 1 | **Home** | `/app` | Her GMV for the period with a change chip; four metric tiles (GMV, Commission, Ad spend, Orders) each with its own graph; a day-by-day chart of GMV against ad spend; her pipeline (agreed money, split In progress / Awaiting payment / Paid); a donut of GMV by brand; tier progress; "Up next" actions; her top three videos. |
| 2 | **My numbers** | `/app/numbers` | The deep view behind the Home tiles. Period and brand filters, one merged chart (or one per metric), and per-metric stats — best day, daily average, days measured. A horizontal bar chart of GMV by brand. |
| | *Earn* | — | *group heading* |
| 3 | **Offers** | `/app/offers` | Every offer open to her, grouped by state: Accepted · Waiting on the team · Yours already · Open to apply for · Declined. Each card: brand, fee, per-video rate, status, one button, and a full campaign detail panel. |
| 4 | **Contests** | `/app/contests` | Contests grouped: Your entries · Open to join · Declined · Closed. Each card: brand, prize, a countdown ring, her deliverable progress, her anonymous standing, one button. |
| 5 | **Leaderboards** | `/app/leaderboards` | A podium of the top three, a sticky "You" card with her rank and the gap to the place above, then the board from 4th down. GMV only — no payment, reward or fee wording anywhere. |
| | *Your work* | — | *group heading* |
| 6 | **My content** | `/app/content` | Every video she filed, as a grid. Review status, GMV, views/likes/comments, an "Ad backed" tag. A detail sheet per video with its day-by-day chart. Also a "Jobs" view of what she still owes per job. |
| 7 | **Brand hubs** | `/app/brands` | An index of her brands, then per brand a hub with **five sections of its own**: This brand, Offers, Contests, My numbers, Leaderboards. |
| 8 | **My profile** | `/app/profile` | Display name, TikTok connection, text size, theme, account facts, application details. |
| 9 | **Support** | `/app/support` | Nine FAQ entries and one way to contact a person. |

### Navigation *inside* those tabs

The rail is only the first layer. A creator also meets:

- **Brand hub: five sections per brand** — four of which are the same screens as rail items 3, 4,
  5 and 2, scoped to one brand.
- **My numbers: four jump pills** (GMV, Commission, Ad spend, Orders) plus a period control, a
  brand control, and a combined/separate chart toggle.
- **My content: two views** (Videos, Jobs), plus sort, brand and status filters and a search.
- **Offers and Contests: five and four groups** respectively, plus a search.

Counting honestly, a creator can meet **around twenty named places** in a product whose own
brief says she opens it to answer one question.

---

## 3. What a Cruva creator sees: four tabs

From the screenshots, Cruva's rail is **Home, Trends, Earn, Messages**, with the account at the
bottom of the rail.

| Tab | What is on it |
|---|---|
| **Home** | A single banner: Total GMV, Total posts, Campaigns. Five sub-tabs (Home, Campaigns, Ad Programs, Usage Rights, My Content). Then one centred empty state — "You're all caught up. Nothing needs you right now." — with one button, *Find opportunities*. Below that, "My Brands" as a row of avatars. |
| **Trends** | A discovery feed: Videos / Products / Creators / Saved, with Date, Performance, Category and Market filters. Ranked videos with view counts and GMV, each tied to a product. |
| **Earn** | A search box, four sorts (Most popular, Most recent, Highest earning, My brands), then a grid of programme cards. Each card: brand, programme name, **one big number** (e.g. "7.5% of ad-driven sales"), payout cadence, how many creators are in, and one button — *Join* or *Request to Join*. |
| **Messages** | Channels and Direct messages. |

### What Cruva does that we do not

1. **Four rail items.** Everything else is a sub-tab or a filter. The rail answers "where do I
   live", not "what can I look at".
2. **Sub-navigation lives inside Home**, not spread across the rail. Campaigns, Ad Programs,
   Usage Rights and My Content are sub-tabs of Home — one place, five faces.
3. **The empty state is one sentence and one button.** "You're all caught up" with *Find
   opportunities*. Ours answers an empty brand with three full-height cards that each apologise
   separately.
4. **One number per card.** An Earn card leads with the commission rate in large type. Everything
   else on the card is secondary. Ours leads with a fee and then adds a per-video rate, a status
   pill, a stage tracker and a detail panel.
5. **Social proof as a figure** — "263 creators in" is a reason to join, and it costs one line.
6. **Messages.** A creator can talk to a brand. We have no messaging at all.
7. **Trends.** A reason to open the app when she has nothing waiting. Ours has none — if nothing
   is due, Prism has nothing to show her.

### What we do that Cruva does not

Worth keeping in view, because the answer is not "copy Cruva":

- **Real measured performance.** GMV, ad spend and orders from a nightly import, per day, per
  brand, per video. Cruva's Home showed `$0` with no history behind it. This is our strongest
  asset and the brief's own reason for the product existing.
- **Contests with deliverable tracking** and an anonymous standing.
- **A leaderboard** that names creators on GMV.
- **Honest absence.** "Not reported" never shown as `0`, everywhere a figure can be missing.

---

## 4. What to keep, and what to drop

Judged by one test: **does this need to be a place in the rail, or is it a view of something
else?**

### Keep as rail items (4)

| Keep | Why |
|---|---|
| **Home** | The money, the actions, the answer to "how am I doing". The product's reason to exist. |
| **Earn** | One place for Offers *and* Contests. Both answer "what can I do to make more". A creator does not think "I want an offer rather than a contest" — she thinks "what is on the table". |
| **Content** | Everything she has filed and how it did. A real, distinct job. |
| **Profile / Settings** | Her account, TikTok connection, theme, text size, and Support folded in. |

### Fold in, do not delete

| Today | Becomes |
|---|---|
| **My numbers** | The deep view *behind Home's tiles*, reached by tapping a tile. It is already built this way — it does not need a rail seat as well. |
| **Contests** | A section of **Earn**, beside Offers. |
| **Leaderboards** | A card on **Home** ("You are #1 of 9") that opens the full board. It is a motivator, not a daily destination; a creator does not open the app to read a leaderboard. |
| **Brand hubs** | A **filter**, not a floor of the building. Tap a brand anywhere — the donut on Home, a brand chip on an offer — and see that brand's view of screens that already exist. This removes the five-section hub entirely, and with it the duplication of Offers, Contests, My numbers and Leaderboards. |
| **Support** | A link in the account menu. |

**That is nine rail items down to four**, and roughly twenty named places down to about eight.

### Drop outright

- **The five-section Brand hub.** It is the single largest source of duplication in the product
  and the screen the owner has already described as "really difficult for creators to operate".
- **The numbered Overview sections** inside it ("1 MEET THE BRAND", "2 WHAT THEY SELL", "3 WHAT
  TO MAKE"). The numbering implies a sequence that does not exist, and for a brand that has filled
  nothing in it is three full-height cards saying nothing.
- **The "Creators Library" section** marked NEXT and unclickable. A disabled tab is an advert for
  something that does not exist, taking a seat from something that does.

---

## 5. How to make ours simple and minimal

Six changes, in the order I would do them. The first three are structural; the rest are habits
that stop it growing back.

### 1. Four rail items, and sub-tabs inside Home

Home · Earn · Content · Account. Everything else becomes a view, a filter or a card. This is the
Cruva shape, and it was also the original brief's recommendation before it was overruled.

### 2. A brand is a filter, not a floor

The deepest cut available. Delete the per-brand hub and let a brand *narrow* the screens that
already exist. A creator then learns one Offers screen, not two.

### 3. An absence costs one line, never a card

A brand with nothing filled in should say so once, quietly, and point at what she *can* do.
Cruva's "You're all caught up" plus one button is the pattern. Ours currently spends a screen and
a half to say nothing is there.

### 4. One number per card

Lead with the figure that decides whether she acts — the commission rate, the fee, the GMV —
large, and demote everything else. A card with four competing figures is a card nobody reads.

### 5. A control must change what she sees

Every filter, toggle, chip row and segmented control earns its place or goes. Prefer, in order:
delete it and show the content; make it a link to a place; and only then a toggle. Grouping beats
filtering when a list is short — a heading that says "Declined · 2" is both the filter and the
answer.

### 6. Give her a reason to open it when nothing is due

This is the gap Cruva's **Trends** fills and we have nothing for. If a creator has no action
waiting, Prism currently shows her a dashboard she has already seen. The cheapest honest version
using data we already hold: *her own* best-performing videos and the brands where her money is
growing — a "what is working for you" view, not a market feed.

---

## 6. The one thing to decide first

**Does a brand deserve its own floor of the building, or is it a filter?**

Everything else follows from that answer. If a brand is a filter, four of the nine tabs collapse
on their own and the hardest screen in the product disappears. If a brand keeps its own hub, the
duplication stays and the rail stays long whatever else is tidied.

My recommendation is that it is a filter.

---

### A note on the record

The owner asked twice during the redesign to **keep all eight tabs** ("keep all the current tabs
please"), and that was implemented — the rail was regrouped by weight rather than cut, and
Support was added as a ninth. This document is the answer to a different question, asked later:
what *should* be dropped to make the app simple. The two are not in conflict, but the
recommendation above does reverse that earlier decision, and it should be taken deliberately
rather than by drift.


---

## After the decision: the Brand hub stays a floor

Rashid decided on 2026-10-19 that the Brand hub is worth keeping as a separate destination.
That settles section 6, and it changes what "simple" has to mean here.

**What is superseded.** The "fold in" row for Brand hubs, the "drop outright" bullet on the
five-section hub, and recommendation 2 ("a brand is a filter, not a floor") no longer apply.

**What it costs, stated plainly.** Offers, Contests, Leaderboards and My numbers will keep
existing twice: once across all her brands, once inside each hub. That duplication was the
strongest argument for the filter, and keeping the floor means accepting it.

**What that makes the real design problem.** If a screen exists twice, the two copies have to be
recognisably the *same screen narrowed to one brand*, not two screens that happen to share a
name. Concretely:

- One component per screen, with a brand argument, rather than two implementations that drift.
  (The Offers screen is already close: the hub's Offers section reuses the same cards and the
  same bucketing.)
- The hub says what it is. A creator inside a hub should never wonder whether she is looking at
  all her contests or this brand's.
- The hub earns its floor by leading with what she can act on for *that brand* — the shape the
  reworked Overview now has — rather than by repeating the global screens in miniature.

**What is unaffected.** The other recommendations do not depend on the brand question and still
stand for discussion: absences costing one line, one number per card, every control changing what
she sees, and a reason to open the app when nothing is due. The rail count is a separate
decision from this one and has not been made.
