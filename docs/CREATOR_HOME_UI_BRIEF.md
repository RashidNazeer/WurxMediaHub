# Creator Home — UI/UX generation prompt

Paste everything below the line into the UI model. Attach the **Prism Design Kit**
folder (`prism_brand_kit/`) alongside it — the model must read
`tokens/prism.tokens.json`, `tokens/prism.css` and `README.md` from that kit.

Written for a UI generation model. Everything in it is measured from the live
product on 2026-10-09; no figure or field name is invented.

---

# BRIEF: Design the Home screen for PRISM

## 1. What this is

**PRISM** is a creator community run by Wurx Media for TikTok Shop affiliates.
Its tagline, and its entire reason to exist, is:

> **See your true TikTok Shop results.**

Creators film videos for brands. The brand puts ad money behind those videos.
Normally the creator never learns what their content actually earned. PRISM
shows them: real GMV, real ad spend, real ROI, on their own videos.

**The user is a real TikTok creator on their phone.** Not an operator, not an
analyst. Often young, often checking between filming. They came to find out one
thing: *did my videos make money, and when do I get paid.*

**Home is the screen they land on after signing in.** It is the promise being
kept or broken.

## 2. What is wrong with the Home that exists today

Design a replacement. These are the measured failures of the current one — do
not reproduce any of them:

1. **It contains no GMV, no views, no ad spend, no ROI — nothing about their
   actual results.** It shows internal admin: an offer's agreed fee, which of
   seven workflow stages the job sits in, and a log of stage changes. The
   product's one promise is absent from its front page.
2. **The largest, greenest number on the screen is `$0`**, labelled "IN YOUR
   ACCOUNT". That is the first thing a creator reads.
3. **Two of the three money cells read `$0`** for almost everyone.
4. **The headline is "Good evening, Graycie-Lea"** — a greeting set larger than
   any fact on the page.
5. **The activity feed repeats itself.** Four rows, same brand, same offer
   title, same date, differing only by stage name.
6. **Half the desktop viewport is empty.** Content stops dead around 60% height.
7. **It is laid out for a creator with a portfolio of jobs. 42 of 43 real
   creators have exactly one job** (median 1, max 1).

## 3. The design system — non-negotiable

**Follow the Prism Design Kit exactly. Do not invent colours, type sizes, radii
or shadows.** Every value you need is written out below, so this section is
self-sufficient. If the kit files are also attached
(`tokens/prism.tokens.json`, `tokens/prism.css`, `README.md`, `logos/`), read
them and let them win on any detail not covered here — in particular the logo
geometry.

The values:

- **Colour:** Ink `#14141C` text and dark grounds · White page · Mist `#F7F7FB`
  panels · Line `#ECECF3` borders · Body `#4A4A5A` paragraphs · Muted `#6B6B7B`
  captions.
- **Spectrum accents:** magenta `#FF2E8C` → violet `#9B5CFF` → blue `#2E8BFF`
  → cyan `#17E0D4`. **Accents only. Used in that order. Maximum four per view.
  Never as body text, never as a full-bleed background.**
- **Positive numbers use the cyan tag pair** (fill `#E3FBF9`, text `#0B6F69`).
- **Type:** Caprasimo 400 for display, headlines and big numbers (24px+).
  Figtree 400/500/600 for everything else. Body 15/1.55, caption 13, lead 18.
  Scale: display 96 · h1 48 · h2 30 · h3 24.
- **Radius:** 12 sm · 18 md · **24 cards** · 32 panels · 999 pills.
- **Shadows:** card `0 1px 3px rgba(20,20,28,.06)` · raised
  `0 12px 32px rgba(20,20,28,.10)`.
- **Stat card pattern (use it):** white, radius 24, padding 24, card shadow.
  Label 13/600 muted; value **Caprasimo 44**; delta as a cyan tag.
- **Logo:** lowercase `prism` wordmark, the `i` replaced by the four-stripe
  prism icon. Never recolour the stripes.

**One open question — ask, do not guess.** The kit is light-only. If you need a
dark mode, say so in your output and propose one; do not silently invent dark
values.

## 4. The data you have

**Use only what is listed here. Do not invent metrics, charts or figures.** If a
layout needs something that is not on this list, leave the space to something
that is, or say what is missing.

Every field below is real and already available to this screen.

### 4a. Identity

| Field | Type | Notes |
|---|---|---|
| `display_name` | string | First name is derived from it for greetings |
| `tier` | `creator` \| `rising` \| `pro` \| `elite` | May be null — hide the badge if so |
| `tiktok_handle` | string \| null | e.g. `@xxkissnoblissxx` |
| `avatar` | image \| null | Signed URL, may be absent |

### 4b. THE HEADLINE — their real results

This is the reason the product exists and must be the most prominent thing on
the screen. All of it is available, none of it is shown today.

| Field | Type | Meaning |
|---|---|---|
| `gross_revenue` | money | **GMV their videos generated.** The hero number. |
| `cost` | money | Ad spend the brand put behind their videos |
| `orders` | count | Orders their videos drove |
| `roi` | ratio, e.g. `1.6x` | GMV ÷ spend. Null when there is no spend. |
| `videos` | count | How many approved videos these figures cover |
| `earliest` / `latest` | date | The span the data covers |
| `daily series` | array of `{ date, gross_revenue, cost, orders }` | One row per day — enough for a sparkline or bar chart |
| `best day` | `{ date, gross_revenue }` | Already computed elsewhere |

**Rules:**
- Money is in major units (dollars), never cents.
- **A `currency` of `null` means the figures span several currencies. Render the
  number with no currency symbol.** Never guess `$`.
- **Figures run to yesterday, never today.** Label the freshness, e.g.
  "current to 8 Oct".
- ROI is computed as total GMV ÷ total spend — never an average of per-video
  ratios.

### 4c. Standing against other creators

| Field | Type | Notes |
|---|---|---|
| `rank` | ordinal | e.g. 7 |
| `total_creators` | count | e.g. 112 → "#7 of 112" |
| `top_percent` | integer 1–100 | **Only ever show this when it is 50 or below.** Never tell someone they are in the bottom half. |

Absent entirely for a creator with no GMV yet — design for its absence.

### 4d. Their work, and the money agreed for it

| Field | Type | Notes |
|---|---|---|
| `brand.name` | string | e.g. "Penetrex" |
| `offer.title` | string | e.g. "Penetrex retainer, 15 videos, $525 at $35 a video" — long, plan for wrapping |
| `committed_amount` | money \| null | **Null renders as "To confirm", not $0** |
| `stage` | 1 of 7 | `pending_request` → `sample_requested` → `sample_shipped` → `content_pending` → `content_completed` → `payment_pending` → `paid` |
| `money.paid` / `money.due` / `money.working` | money | Settled · approved and on its way · still being worked |
| `required` / `approved` / `waiting` / `needs_another_take` | counts | Videos committed · accepted · with the team · sent back |
| `remaining` | count \| null | Still to film |

**Remember: almost every creator has exactly one job.** Design the one-job case
as the normal case and let it scale to several — not the other way round.

### 4e. Contest money

| Field | Type | Notes |
|---|---|---|
| `owed` / `paid` | money | Won but unpaid · already sent |
| `closest unreached target` | `{ targetValue, rewardAmount }` | What they are playing for next |
| `confirmedGmv` / `confirmedVideoCount` | money / count | Progress staff has confirmed |
| `claimsWaiting` | count | Claims sitting with the team |
| `expiresAt` | date | Contest deadline |

**Never add claimed figures to confirmed ones.** A claim is what the creator
says; confirmed is what staff verified. They are different kinds of fact.

### 4f. Their own TikTok account — only if they connected it

| Field | Type |
|---|---|
| `follower_count`, `likes_count`, `video_count` | counts, account lifetime |
| recent videos: `cover_image_url`, `view_count`, `like_count`, `comment_count` | the only organic engagement data in the product |

**These are often `null`, and null is not zero.** If a count is missing, omit it
— never print `0`.

### 4g. What else exists to link to

Home sits beside: My numbers · Brand hubs · Leaderboards · Offers · Contests ·
My content · My profile. The primary action in the app is **"Add a video"**.

## 5. What to design

Produce the **creator Home screen**, in these states:

### State A — the main case: a working creator with results
The screen most creators should see. Priority order, highest first:

1. **Their GMV.** The hero. Caprasimo, large. With the period it covers and
   how fresh it is. Spend, orders and ROI support it — they do not compete
   with it.
2. **The shape of it over time.** A sparkline or small bar chart from the daily
   series. Pill bars, spectrum order, per the kit.
3. **What they are owed and when.** Paid · approved and on its way · still
   being worked. Plain language, no `$0` cells shouting at them.
4. **Their current job and what it needs from them.** Brand, what it is, how
   many videos are in and how many are left, and one clear action — Add a
   video — when something is outstanding.
5. **Standing, if they have one.** "#7 of 112". Quiet, not a scoreboard.
6. **Contests, if they are in one.** What they are playing for next and how
   close they are.

### State B — approved, has a job, no GMV yet
They have taken work but no ad data exists. **Do not show empty charts or
`$0` heroes.** Show the job, what it needs, and an honest line about when
numbers will appear.

### State C — brand new, nothing taken
No work at all. This is a first-run screen: what PRISM is, what happens next,
and the offers open to them. Warm, short, one obvious action.

### State D — something failed
**The product has no error state anywhere today.** Design one: a calm card that
says the numbers could not be loaded and offers a retry, clearly distinct from
"you have no data". A creator must never be shown an empty screen because a
request failed.

Also design: **loading** (skeletons matching the real layout, never spinners).

## 6. Hard constraints

- **Mobile first and mobile best.** Creators are on phones. Design 375px first,
  then 768, 1024, 1440. **No horizontal scrolling at any width.** Wide things
  scroll inside their own container.
- **No dead space.** The current screen leaves 40% of a desktop viewport empty.
  The layout must look composed at every width.
- **Every type size in `rem`**, never `px` — the app has a user-controlled text
  size that scales the whole interface from the root font size.
- **No hardcoded colours.** Every colour must be a token from the Prism kit.
- **Touch targets at least 44px.** Anything reachable only by hover needs a tap
  equivalent.
- **Respect `prefers-reduced-motion`.**
- Target stack, so keep it buildable: **React + Tailwind + shadcn/ui**.

## 7. Tone

Plain, warm, specific. No jargon, no hype, no exclamation marks. The existing
product gets this right and it should be kept — real examples from it:

- "Nothing here" rather than `$0` for an empty column.
- "This one went to somebody else. You can ask again any time."
- "Over to you. Film it and send it in."
- "Nothing has moved yet. Every step the team takes on your work lands here."

Numbers do the shouting. Words stay calm.

## 8. What to deliver

1. The **Home screen**, states A–D, at **375px and 1440px** minimum.
2. A short note on **what you placed where and why**, in priority order.
3. Your **dark-mode answer** — either a proposed dark palette consistent with
   the kit, or a clear statement that Home should be light-only.
4. Call out **anything you wanted and could not have** from the data list in
   section 4.

**Do not invent data.** If a figure is not in section 4, it does not exist.
