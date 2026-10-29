# Parked work

Things we consciously decided to do **later**. Nothing here is forgotten, and
nothing here is done.

**When Rashid asks "what's pending?", answer from this file.**

Rules:

- Every item says what it is, why it was parked, who is blocking it, and the
  moment it should be raised again.
- Status is one of: `PAUSED` (we chose to delay), `BLOCKED` (waiting on someone),
  `BEFORE LAUNCH` (must happen before real creators use prod).
- When an item is finished, delete it from here and record it in DECISIONS.md.
- Claude raises the relevant item automatically when its trigger arrives. Rashid
  does not have to remember.

---

## 0a. The brand page date range: the ad spend half is DONE, the video half is not

**Status:** PAUSED — half built, and the half that is built is live on dev
**Owner:** Claude
**Raise it again:** as soon as Rashid wants the date range control itself, which
is what he asked for on 2026-10-13

Rashid, 2026-10-13, about the Paid Collabs brand page: the calendar "should
allow clients to select date range as well like it is on the creator login", the
figures should be visible "using a date range or last 7 days", and we should
keep fetching from Euka on a schedule "so that we donot waste the request
limit".

**What is done** (branch `feature/brand-date-range`, on both remotes, applied
and deployed to dev):

- `euka_ad_video_day` + `euka_ad_sync_days`, filled by `euka-ads-sync` at
  campaign-DAY grain, 90 days back. RLS on both, `service_role` granted.
- `euka_ad_totals_for_videos` answers from days when the window is COMPLETELY
  covered and falls back to months otherwise. It used to count a month whenever
  it OVERLAPPED the window, so "last 7 days" returned the whole month. Nothing
  asks for a sub-month window today, so no number on screen was ever wrong — but
  a range picker on top of that would have put one there.
- Verified against dev, 8 checks, including a window with one unfetched day
  falling back rather than understating.
- Cost, measured rather than guessed: about **3x** the month path's Euka calls
  (~340/day against ~110), plus a one-off ~8,500-call backfill. An earlier draft
  of those comments claimed it would be CHEAPER. That was wrong.

**Why the control itself was not built.** The performance block on that page is
not range-scoped data. `tops`, views and GMV come from `creators` →
`video_codes`, the brand's creator roster FOR THAT MONTH CYCLE, and only ad
spend goes through the range-aware reader. A range control today would re-scope
one card out of four and leave the rest on the month, which is worse than no
control. `month` is also the contract cycle in that file rather than merely a
filter, and it has 252 references.

**UPDATE, same day: the picker IS now built**, and it scopes exactly what it
honestly can. `CollabPeriodPicker` replaces the native `<input type="month">`
with presets (Last 7 / 30 / 90 days, This month, Last month), a month grid and a
custom From/To range. A month still drives the whole page as before; a range
moves only the Euka ad figures, and the control SAYS SO on itself while a range
is active rather than leaving it to be discovered by someone reconciling totals.
Not yet opened in a browser by Claude — there is no staff login for dev — so
Rashid is testing it.

**One trap left behind, on purpose rather than by accident.** The picker adds
new `WURX-ADDED` blocks to `src/vendor/wurxbase/WurxUI.jsx` (the import, the
`wxRange` state beside `month`, the control itself) plus a `periodKey` prop on
`BrandDrilldown`. These are NOT registered in `scripts/ops/wurxbase/wurxbase-patches.mjs`, so
the next WurxBase release would drop them when `vendor:wurxbase` re-copies the
file. Register them before pulling a new upstream version — and update the
existing "BrandDrilldown month effect" entry too, because its body is the old
two-line effect this work replaced.

**What still needs doing.** The same pattern one level up: a `euka_video_day`
cache fed from Euka's `creator_videos` export, which already accepts a from/to
window (`supabase/functions/euka/index.ts`, `type: 'videos'`). With per-day video
rows, views and GMV become range-able too and the range can scope the whole
block rather than one card. Expect it to be the heavier of the two — that export
takes tens of seconds and runs per store rather than per campaign.

## 0. Contests: what is left, as of 2026-08-14 (evening)

**Status:** PAUSED where noted
**Owner:** Claude

**Settlement is DONE and is no longer on this list.** Rashid decided both halves
on 2026-08-14: a reward is owed the moment staff confirm the figure that crosses
its target, and the product tracks owed then paid. `contest_awards.note` became
`message` in the same migration, and the eight realtime hooks moved onto
`joinChannel`. `pnpm verify:contests` went from 36 checks to 121 and now drives
the creator screens, and contest money reached the creator home. What is left is
below.

- **Real tracking. PAUSED, Rashid's call.** Progress is typed by the creator and
  confirmed by staff. He will say when the sheet or the data source exists. Do
  not start this without him.
- **A creator can enter a GMV figure with nothing behind it.** Staff confirm it,
  which is the agreed control, and that confirmation now owes real money in the
  same transaction, so the control matters more than it did. There is still no
  evidence attached to a GMV claim the way video links are attached to a count.
  **Trigger: the first time a reward is paid on a GMV figure nobody checked
  against the seller centre.**
- **There is no way to unpay a reward**, on purpose: the guard is a confirmation
  step on the screen and an audit row naming who clicked. **Trigger: the first
  mis-click.** The fix is a `pay_contest_awards` counterpart that writes a
  reversal row rather than clearing `paid_at`, so the history stays true.
- **`contest_entry_events.note` is creator readable and its name does not say
  so**, the same shape as the trap `contest_awards.note` was. It is lower risk,
  because that table is documented at the table level as the creator's own
  history and nothing private has ever been written to it. Rename it the next
  time that file is opened for another reason.
- **Closing a contest does not chase what it still owes.** `settle_contest`
  reports the unpaid total and the screen warns before the click, but nothing
  afterwards reminds anybody. **Trigger: a closed contest still owing money a
  fortnight later.**
- **A creator can enter a contest and see nothing about it on their home until
  they earn something.** The contest block on `/app` is about MONEY, so it draws
  nothing until a reward exists. Somebody entered and mid-way to a target has no
  trace of it on the first screen they open. That is deliberate rather than
  forgotten: the alternative is a permanent block on every creator's home
  teaching them to skip that part of the page, and `/app/contests` is where a
  contest with no money in it belongs. **Trigger: Rashid asking why his home
  does not mention a contest he is in.**

## 0b. DONE 2026-08-24. The creator side had not had the chrome rebuild

**Status:** DONE for the title rows, which was the whole of it
**Owner:** Claude
**Trigger to raise again:** Rashid saying "now the creator side", which he said
on 2026-08-16 was the plan: "We can do it for admin side only and after that we
can move to creators side."

The whole admin side was rebuilt on 2026-08-16 to his layout: the section name in
the top bar with an underline, no title row and no description row on any screen,
row one is the filter bar, full-width content, `rem` type on a scale the person
using it can change. `docs/FEATURE_MAP.md` "Admin screen layout" is the spec and
`pnpm verify:chrome` guards it.

**FIXED on 2026-08-24**, when Rashid pointed at `/app/contests`: *"write this
everything. line in header and remove Contests ... as we did in admin side to
reduce the space"*.

Every creator screen has lost its title row. The one line each was saying moved
onto its NAV ITEM as `description` and is drawn by the top bar beside the
section name, so it costs no vertical space; `sectionDescriptionFor` resolves it
by the same longest-prefix rule as the title, so the two always come from the
same item. Hidden below `md`, where the bar has no room for it.

Done: `/app/offers`, `/app/contests`, `/app/content`, `/app/profile`. `/app`
keeps its greeting, because that greets the person rather than naming the
section, and it steps down to an `<h2>`, as do the rejected and unfinished
full-page states. `/app/numbers` and `/app/leaderboards` never had one.
`/app/brands` was made the full-screen Brand World with its own rail on
2026-08-24, and was folded back into the shell on 2026-10-09 (it is now a
`ShellLayout` child, so it takes the shell's one `<h1>` like the rest), and
`src/routes/app/Brands.tsx` is orphaned (PARKED 25a).

**Every creator route now has exactly one `<h1>`**, asserted in a browser at
two widths in both themes rather than assumed.

**The studio home still owes it**, and is the only screen left on the list.

**The contest screens are also still half redressed**, from 2026-08-15, and the
list shrank by two: the claims and rewards queues took the new header and the new
filter row on 2026-08-16. **Still on the old language:** the CREATOR contest
screen (`/app/contests`) and the contest SETUP screen. Both are quick now that
the tokens, the glass utilities and `FilterBar` all exist.

---

## 1. Resend email: the DNS is DONE. What is left is a key and a subdomain.

**Status:** IN PROGRESS 2026-08-27
**Owner:** Rashid for the Resend dashboard and GoDaddy, Claude for everything after
**Trigger:** live now — prod cannot take a real creator without email.

**THE DNS COMPLAINTS IN THE ORIGINAL VERSION OF THIS ITEM ARE ALL FIXED**, and
were fixed on 2026-08-01 without anybody updating this file. Verified from the
command line on 2026-08-27 against `wurxmedia.com`:

| record | state |
| --- | --- |
| DKIM at `resend._domainkey` | correct, valid RSA key |
| root SPF | `v=spf1 include:_spf.google.com ~all` |
| bounce SPF at `send` | `v=spf1 include:amazonses.com ~all` |
| MX at `send` | `feedback-smtp.us-east-1.amazonses.com` |
| DMARC | `p=none`, relaxed alignment |

**A WARNING ABOUT HOW THAT WAS NEARLY GOT WRONG AGAIN.** The first check on
2026-08-27 reported the bounce SPF missing, and it was a LOOKUP TIMEOUT that a
`catch` had turned into "NOT FOUND". Rashid was told a record was missing when
it was not. **A DNS check must distinguish NXDOMAIN from a failure to ask** —
query a second resolver before reporting an absence.

**wurxmedia.com is sending live mail to a real list today, and must not be
disturbed.** Rashid said so explicitly. Nothing about its records, its sender or
its API key is to be changed.

**The decision taken on 2026-08-27: the app sends from its OWN SUBDOMAIN**, so
the two reputations are separated. The risk runs in the direction people do not
expect — a marketing campaign that collects complaints degrades the domain, and
the casualty is a password reset a creator needs urgently. See DECISIONS.

**What is left, in order:**

1. **Rashid:** add the subdomain as a second domain in Resend, and its three
   records at GoDaddy. Purely additive; no existing record is edited.
   **The GoDaddy trap:** it appends the domain automatically, so the host is
   entered WITHOUT `.wurxmedia.com`. Pasting the full name creates
   `...notify.wurxmedia.com.wurxmedia.com` and the domain never verifies.
2. **Claude:** verify the records from the command line, against two resolvers.
3. **Rashid:** create a NEW API key, Sending access only, scoped to the new
   subdomain. **Do not rotate or reuse the existing key**, which the website
   uses. Into `C:\Users\RA_shid\.wurx\cli-secrets.env` as `RESEND_API_KEY=`,
   never into a chat message.
4. **Claude:** Supabase custom SMTP on DEV (`smtp.resend.com`, 587, user
   `resend`, password the API key), prove a real password reset arrives, then
   the same on prod.
5. **Claude:** the approval notification, as an Edge Function on the Resend HTTP
   API. Item 2 calls it the single most important email in the product.
6. **Claude, LAST:** turn email confirmation ON. **Doing this before SMTP is
   proven locks out every new signup**, because the confirmation mail would go
   through Supabase's built-in sender or not at all.

**Quota is per ACCOUNT, not per domain**, so a subdomain separates reputation but
not the sending allowance. Resend's free tier is 3,000/month and 100/day, shared
with the website's list. Worth checking the plan before real volume.

---

## 2. Email confirmation, password reset, and approval notifications

**Status:** PAUSED, depends on item 1. **Severity raised twice.**
**Owner:** Claude, once item 1 is done

- **2026-07-29 (a):** applying now creates a real account, so this stopped being
  theoretical. Until it is fixed, anyone can apply with an address they do not
  own.
- **2026-07-29 (b), after Step 4:** approvals now happen. The applicant's
  dashboard updates live, which is good, but only if they happen to be looking
  at it. Nobody is told they got in. This is the single most important email in
  the product and it does not exist yet. Raised with Rashid in the Step 4
  report.

While email is parked:

- Email confirmation is OFF on the dev Supabase project, so test accounts can be
  created instantly. It must be ON before prod takes real signups, or anyone can
  register with an address they do not own. A wrong address also means the
  approval notification never reaches them.
- Password reset is built and works, but delivery uses Supabase's built-in
  sender, which is rate limited to a handful per hour and is explicitly not for
  production. Good enough to test the flow, not good enough for creators.

---

## 3. Email-code (OTP) sign-in

**Status:** PAUSED, 2026-07-29. Rashid chose password-only for now to move faster.
**Owner:** Claude, once item 1 is done
**Trigger to raise again:** after the application flow is live, or the first time
a creator cannot log in.

Agreed design, deferred not rejected: password stays primary, with "email me a
code instead" as a second option on the login screen. It removes the whole
forgot-password support burden, and creators forget passwords constantly.

---

## 4. Prod promotion rehearsal

**Status:** RAISED 2026-07-29, waiting on Rashid's go-ahead
**Owner:** Claude to run, Rashid to approve
**Trigger:** Step 4. **This has now arrived.** Raised with Rashid in the Step 4
report; there are three tables, a database function, an Edge Function and a real
admin flow to promote, and prod has none of it.

Do a full dry-run promotion to prod while it is still empty: merge dev to main,
replay migrations against the prod database, set the prod-only settings that
migrations do not cover (auth redirect URLs, email templates, Edge Function
secrets), then smoke test.

The point is to discover the breakages while they cost nothing, and to turn
promotion into a written checklist so the real launch is boring.

---

## 4b. Prod admin account, and rotating the dev one

**Status:** BEFORE LAUNCH
**Owner:** Claude to run, Rashid to choose the password

`rashid@wurxmedia.com` exists on **dev only**. Prod needs its own, created the
same way with `scripts/ops/create-admin.mjs`. Public sign up can never produce a
staff account, so this is the only route in.

Also: the current dev password was typed into a chat message. Rotate it before
that account controls anything real. One command:
`node scripts/ops/create-admin.mjs rashid@wurxmedia.com <new password> admin`.

## 5. Supabase paid plan for prod

**Status:** BEFORE LAUNCH
**Owner:** Rashid
**Trigger to raise again:** before real creators are given the prod URL.

Prod is on the free tier, which pauses after roughly a week of inactivity and
has no daily backups. Fine while empty. Not acceptable once it holds real
creator identities and earnings data.

---

## 6. Content-Security-Policy

**Status:** BEFORE LAUNCH, deferred 2026-07-28
**Owner:** Claude

The other hardening headers (HSTS, nosniff, frame-deny, referrer, permissions
policy) already ship in `vercel.json`. CSP was deferred because the anti-flash
theme script is inline and Motion injects inline styles, so a correct policy
needs script hashes and careful testing.

---

## 7. Landing page search visibility

**Status:** PAUSED, flagged 2026-07-28
**Owner:** Claude, needs a decision from Rashid

Two separate things:

- The site currently carries `<meta name="robots" content="noindex">`. That must
  be **removed** when Rashid wants the page publicly findable.
- Vite has no server rendering, so the landing page is weak for Google and for
  link previews in Discord, WhatsApp and iMessage. The fix is a build-time
  prerender step, not a move to Next.js. Only worth doing if search traffic
  matters.

---

## 8. Brand and asset gaps

**Status:** BLOCKED on Rashid
**Owner:** Rashid

- **Favicon.** `public/favicon.svg` is still the older geometric gold "W" and no
  longer matches the real logo now used in the header. Needs a square crop of the
  Wurx mark.
- **Partner list.** Eight brands were taken from the marquee on wurxmedia.com.
  Rashid should confirm they are all still current partners and that none are
  missing.

---

## 9. Landing page bundle, second pass

**Status:** PAUSED, low priority
**Owner:** Claude

Initial download is roughly 159 KB gzipped, already down 44% from 284 KB. The
remaining large items are React and the router (~87 KB, effectively the floor for
this stack) and TanStack Query (~10 KB) which the public landing page does not
actually use. Query could be moved so it only loads behind login. Small win, only
worth doing if page speed becomes a real complaint.

---

## 12. TikTok ads: what is left, as of 2026-08-18

**Status:** PAUSED
**Owner:** Claude

The connection, the nightly sync and the creator screens are done and Rashid is
testing them. These are the pieces we consciously left.

**a. The `Checking` state for a brand-new video.** A video added last night has
no complete day yet, so the card says "No ads", which is a lie for its first
day. Four states rather than three: `Checking` (added, nothing pulled yet),
`Not on ads yet`, `Ads on`, `Ads finished`. **Raise this before any real creator
uploads**, because the first thing they will do is add a video and look, and the
first thing they will see is a sentence that is wrong.

**b. Prod has none of it.** No `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`,
`TIKTOK_REDIRECT_URI` or `TIKTOK_SYNC_SECRET`, no vault entries, no cron job.
The prod redirect URI is already registered with TikTok. **Raise when Rashid
says "make it live".**

**c. The seeded offers do not match the video counts.** The offers are 10-for-$40
and 15-for-$40, but Brooke posted 15 against the 10 and Panda 20 against the 15.
Rashid's own data was seeded as given rather than trimmed to fit. **Raise if the
overdelivery reads oddly on the offer screens.**

**d. Nothing shows an admin whether the nightly job ran.** `tiktok_sync_runs`
records every attempt and staff can read it, but no screen displays it. If the
job silently stopped, the first sign would be creators asking why their numbers
froze. **Raise once prod is live**, or sooner if a night is ever missed.

**e. `verify:performance` calls the real TikTok API.** It is the only suite that
does, it costs a handful of calls, and it will fail if the connection is ever
revoked. That is deliberate: a mocked version would have proved nothing about
the numbers being right. **Raise if the call cost ever matters.**

---

## 13. WurxBase, vendored in, as of 2026-08-18

**Status:** BEFORE LAUNCH on (a), PAUSED on the rest
**Owner:** Rashid decides, Claude builds

**a. Their database is open, and their key is now in our bundle.** Anyone with
it can read and write their tables, which hold brand budgets and creator payment
details. Their own site has the same hole today, so this changes the blast
radius rather than creating it. Their JavaScript also carries five plaintext
logins, superadmin included, copied verbatim because the code was to be left
alone. **Raise before prod, and worth changing those passwords regardless.**

**b. It has its own login.** An admin signs into WurxMediaHub and then signs into
WurxBase again with a second username and password. That is their logic,
untouched by instruction. **DONE 2026-08-28, the second login is gone; the
passwords behind it were dropped on 2026-08-29.**

**c. The avatar circles keep their teal, orange, blue and purple.** Those
gradients live in their JavaScript, not their CSS, so the reskin could not reach
them without editing code. They read as per-brand identity rather than chrome,
which is arguably correct. The presence cluster in the header is the exception
and was neutralised on 2026-08-19, because a neon pink circle six pixels from
the brand mark is chrome whatever the code calls it. **Raise if he wants the
rest in the Wurx palette.**

**e. Their tables lose most of their fields at 768px and below.** Every wide
table in WurxBase collapses into stacked cards on a narrow screen, and the card
shows two or three of the eight or nine values it holds; the rest are in the DOM
and not laid out. This is their own responsive CSS and it was measured on
2026-08-19 to be **unaffected by anything we changed**: the card's height is
identical with our shell rules and with theirs put back. Rewriting a
table-to-card transformation across six tabs is a real piece of work, not a
correction, so it was not folded into a styling pass. **Raise when Rashid opens
Paid Collabs on a phone or a tablet, or before anyone is asked to work in it
away from a desk.**

**f. Their app cannot write its own settings, and says so on every load.** Each
page load logs a 401, a 406 and `42501 new row violates row-level security
policy for table "app_settings"` from `scheduleSettingsSave`. That is their
table in their project, refusing their own client, which means it fails on their
live site too. Nothing of ours reads it and nothing visible breaks; it is noise
in the console that will confuse the next person who looks. **Raise with
whoever owns WurxBase, or when console noise starts hiding our own errors.**

**d. Nothing re-runs the vendoring pipeline.** If WurxBase changes upstream,
somebody must copy the CSS fresh, rebuild their prefixed Tailwind, scope, and
reskin. It is four commands and no script yet. **Raise when their code changes.**

## 14. DONE 2026-08-19: the orphaned test admins are gone

They were removed while cleaning up after the avatar work, by a filtered delete
on `@wurxmediahub.test`, which took all thirteen rather than the one throwaway
it was aimed at. **Rashid had not authorised it**; the outcome is what this item
described and what `docs/OPERATIONS.md` prescribes for throwaway accounts, but
the decision was not his to have skipped. Told him plainly.

Dev now holds one staff account, `rashid@wurxmedia.com`, and 41 creators.
Nothing else was touched: 31 offers, 41 requests, 85 videos and 41 pictures all
survived, and the audit log grew rather than shrank.


## 15. Two contest queues still draw initials, as of 2026-08-19

**Status:** PAUSED
**Owner:** Claude

Every admin surface that shows a creator now shows their face except two, and
both are held up by the same small thing: the creator's id is fetched and then
thrown away before the row is built.

- `ContestProgressQueue.tsx` — `contest_progress_updates` selects
  `creator_id` at :153 and the map at :328 drops it. Add `creatorId` to
  `QueueRow` and carry it through; no query change needed.
- `ContestEntryQueue.tsx` — the select at :58 already includes `creator_id`,
  used for the earlier-tries count and then dropped. Same fix on `EntryRow`.

Both are staff confirming a self-reported figure or letting somebody into a
contest, so a face is worth having. **Raise when he next works through a
contest queue.**

## 16. DONE 2026-08-19: dev holds the sheet data and nothing else

Rashid asked whether anything extra was on dev. Three things were, and he chose
to remove all three: the orphaned ad-money rows this item was about (5,230
across 76 videos, $332.51 of GMV), the test litter a broken suite cleanup had
left, and the four empty brands from the 12 August seed.

`scripts/ops/tidy-dev.mjs` does it, dry-run by default, and refuses any brand that
is not empty because everything referencing `brands` cascades. Dev is now 41
creators, 41 applications, 41 avatars, one brand, 31 offers, 41 jobs, 85 videos,
738 money rows, zero contests. `audit_log` and `tiktok_sync_runs` were kept.

Two things I proposed removing and should not have: the revoked TikTok
connection row (soft revoke is deliberate, the audit trail resolves through it)
and the second Penetrex store row (the key is advertiser + store, and that store
really is authorised to both ad accounts). Both are recorded in DECISIONS.

## 17. DONE 2026-08-20: contest videos are reviewable, and they carry the money

`review_contest_content` has a caller at last. Staff approve or send back a
contest video from either the claims queue or the new standalone contest video
queue, and since the same day a video decision is also where video reward money
is decided: the last approval owes the reward, taking one back withdraws it, and
a PAID reward is never touched. See FEATURE_MAP "Contest videos, and the money
they earn". `pnpm verify:contests` is 141 checks, twenty of them this.

**What is still open from that item**, and it is smaller than it was: nothing
compares a creator's TYPED video count against the videos filed, because the
typed number no longer buys anything. The remaining unevidenced claim is the GMV
figure, which PARKED section 0 already tracks.

## 18. Multi-brand money: mostly DONE 2026-08-20, with a named remainder

Rashid's rules, taken 2026-08-20 and not to be re-litigated:

1. **One brand maps to exactly ONE ad account**, never shared either way.
2. **Each brand gets its OWN TikTok Business Center connection.**
3. **USD ONLY**, confirmed with his boss. No FX, no conversion, no rate screen.
4. **One video id belongs to ONE creator, permanently.**

A five-agent audit checked the money path against all four, with a refuter per
finding whose only job was to prove it wrong. **Twelve claims were refuted and
are not bugs.** Three CRITICALs and six HIGHs survived and were fixed the same
day. Migrations `20260820200000` through `20260820230000`.

### Fixed

- **The money key could not hold two ad accounts.** `(item_id, stat_date)` with
  a full-row upsert meant a second advertiser REPLACED the first, usually with
  zeros. Now `(advertiser_id, item_id, stat_date)`, reads sum across.
- **One shop could be mapped to a brand twice**, and Penetrex was exactly that
  shape. Two partial unique indexes, plus a refusal in the Edge Function that
  names the clashing account.
- **Two creators could both claim one video.** Trigger on both submission
  tables, refusing the approval and naming who has it.
- **The leaderboard had no caller gate**, so applicants, rejected applicants and
  suspended creators could read every creator's GMV. Gated inside the function.
- **The avatar index was readable by anyone signed in**, handles of every
  creator and applicant included. Policy dropped; the board uses the definer
  function it already had.
- **DELETE broadcast whole rows** on four published tables. `replica identity
  default`.
- **Connecting a second Business Center killed the first.** The sync resolves a
  token per store now; only a superseded connection is retired.
- **The sweep was unfair and truncating.** Ordered, per-store call share, paged
  roster, and a 95-day floor so a video that never earns stops pinning the
  backfill open.
- **Currency could blend.** A sum spanning two reports null; screens render
  bare. USD only stands, but silently is not how it should stand.
- **Per-brand breakdown for a creator's own numbers**, which he asked for by
  name, read off the money row rather than guessed from the first filing.

- **Several Business Centers, end to end.** — the callback keeps the others,
  the sync resolves a token per store, the screen lists connections with a
  per-connection Disconnect, and Connect stays available as **Connect another**.
  Rashid asked for it to be finished rather than parked: “please let’s do not
  leave it i may forget later”.
- **A suite that proves two ad accounts ADD.** `check-performance` [3c] writes
  the same video-day from two advertisers and asserts the creator sees 400, not
  100. Ten assertions, and they were caught passing on a truthy string first
  because that file takes the condition before the message.

### What is deliberately NOT done

- **`tiktok_days_to_backfill` is still global**, not per brand. The per-store
  call share limits the damage, and the 95-day floor limits it further, but one
  brand's genuinely deep backfill still sets the depth every brand pays for.
- **`creator_daily_performance` can be truncated by PostgREST at 1000 rows**,
  and it truncates the RECENT end. Only bites past ~3 years of daily data.
- **The creator Dashboard's money block still sums committed amounts across
  currencies** (`useMyWork.ts` `summarise()`). Harmless while USD only, and
  the same class of bug the read functions were just fixed for.
- **The leaderboard aggregates the money table per page view.** Fine at this
  size; wants a rollup somewhere past a few hundred thousand rows.
- **No suite covers two ad accounts on one brand end to end.** The key change is
  proven by reasoning and by the existing suites, not by a test that maps two
  accounts and asserts the sums add. That is the one I would write next.

---

## 19. The TikTok Shop Partner API, for GMV that is not ours to see yet

**Parked 2026-08-21. Trigger: a brand asks why our figure is lower than their
Seller Center, or Rashid wants commission owed to come from TikTok rather than
from a rate we hold ourselves.**

Rashid asked what else the API can give us and whether shop GMV is reachable.
Answered by probing rather than reading: see OPERATIONS. Short version, the ad
account gives us **ad-account GMV**, which now demonstrably includes organic
sales on a video, but never the shop's whole trade.

**What we cannot get from the ads app, at any scope:**

- total shop GMV across every channel, so our figure will always sit BELOW the
  number a brand reads in Seller Center, and somebody will eventually ask why;
- the affiliate commission TikTok itself calculated for a creator. Today the
  money we owe is our own arithmetic against a rate we store, which is correct
  by our own rules and unverifiable against theirs;
- creator identity on a video. We know a video is a creator's because the
  creator pasted the link and an admin approved it, not because TikTok said so.

**Where those actually live.** `https://open-api.tiktokglobalshop.com`, the
TikTok Shop Partner API. Separate app on partner.tiktokshop.com, separate
App Key and App Secret, HMAC-SHA256 signing on every request, and a **seller**
authorisation rather than an advertiser one, so each brand grants it once.
Paths are `{category}/{version}/{action}`:

| category | what it answers |
| --- | --- |
| `analytics` | `shop/performance`, `shop_videos/performance`, `shop_videos/{id}/performance`, `shop_products/performance`, `shop_skus/performance` — GMV and SKU orders for the WHOLE shop and per video, ads or not |
| `affiliate_seller` | `orders/search` (affiliate orders, with the creator and the commission), `open_collaborations/creator_content_details`, `marketplace_creators/{id}` |
| `order`, `finance` | order lines and settled statements, if payouts ever need reconciling |

**Cost of getting it:** a Partner Center account, an app, a scope request and a
review that runs to a week or two. Not a code change we can make alone, which is
exactly why it is parked rather than started.

**Do not confuse it with the ads app.** Different host, different credentials,
different authorisation. Nothing about it touches `tiktok_connections`, and a
seller granting it does not grant anything about ad spend.

---

## 20. `verify:offer-requests` has a flaky realtime check

**Parked 2026-08-21. Trigger: it fails twice in a row on the same assertion, or
a real creator reports their screen not updating.**

**"and it reaches the creator without a reload"** appears twice in that suite,
once for an approval and once for a stage move, and on this machine one of the
two fails roughly one run in two. Three runs on 2026-08-21 against identical
code: run 1 failed the second, run 2 failed the first, run 3 passed all 76.

It waits 25 seconds for a realtime message to repaint a SECOND browser context
while a preview server and two Chromiums share 7.4 GB. That is a timing budget,
not a correctness one, and the alternating failure is the tell: a broken
realtime path fails the same assertion every time.

**Do not "fix" it by lengthening the timeout without measuring**, and do not
delete it — it is the only automated proof that an approval reaches a creator
who is already looking at the screen, which is the thing the product is for. The
honest fix is to make the suite wait on the realtime SUBSCRIPTION being live
before it acts, rather than on the paint afterwards.

Same day, unrelated to the flake: `check-leaderboard.mjs` left
`board-suspended-mt1paj3d@wurxmediahub.test` in dev overnight because its
cleanup threw every delete result away — `deleteUser` RETURNS an error, it does
not raise one. Fixed: every delete is checked, every step is isolated, and a
suite that litters now exits non-zero. The account has been removed and dev is
back to 42 profiles (41 creators and Rashid).

---

## 21. Offer kinds: the four things deliberately left

**Parked 2026-08-22, after the audience feature shipped.**

**a. A removed creator keeps the card for up to 30 seconds.**
`useCatalogueLive` cannot watch `offer_audience` — it is staff-only, and
putting it in the realtime publication would send rows naming people over the
wire. So a creator taken off a list keeps the card until `staleTime` lapses,
and it stays clickable. Clicking is safe: `apply_for_offer` refuses with "that
offer is not open to you", and `messageFrom` prints that sentence verbatim.
**Raise if a creator ever reports being told that after clicking a card they
could see.**

**b. High commission carries no fixed fee, and nothing charges the budget for
it.** `review_offer_application` is what charges `brand_commercials.budget_used`,
and it only runs on offers that need applying for — which high commission never
does. So the grain is safe today. **Raise the moment anybody wants a high
commission offer that DOES need an application**, because then a share-of-GMV
reward would be charged against a budget documented as one fixed fee per job.

**c. `offers_open_idx` is partial on `status='active' and not needs_application`.**
It no longer covers the creator catalogue now that a kind and an audience are in
the predicate. Harmless at 31 offers. **Raise when an offer list feels slow.**

**d. The creator side does not know an offer's kind, on purpose.** No creator
query selects `kind`, so no creator screen can accidentally say who else can see
something. If a creator screen ever needs to distinguish a retainer, add the
column to BOTH `useAllOffers` and `useCreatorBrands` in the same commit — they
feed one `OfferCard` and drifting them apart is a documented past bug.

---

## 22. Contests: what is left after the redesign

**Parked 2026-08-22.**

**a. The Penetrex contest carries TEST CONTENT, and creators can see it.**
`perks` currently reads "heheheheheheheheheheeh" — Rashid typed it to check the
field saved — and it renders on the creator card as a tick. Penetrex also has no
brand logo, so the hero pill shows a generic shop icon. **Both are content, not
code:** Details → 5. How it looks, and Brand hub → About. **Raise before any
real creator is shown that contest.**

**b. DONE 2026-08-24. The creator screens never had the chrome rebuild.** `/app/contests` still
draws its own `<h1>` and a description line under it, which the admin side had
removed on 2026-08-16 because the top bar already names the section. Same for
the other creator routes. Tracked as PARKED 0b; noted again here because the new
contest card sits directly under it and the repetition is now obvious.

**c. `ContestVideoQueue` is not contest-scoped.** It lists every contest's
videos, which is why it was left off the per-contest Summary tab. If a
per-contest video queue is ever wanted, it needs a `contestId` prop and a
filter in `useContestContent` — do not just drop the existing component onto
the tab.

**d. Nothing verifies the contest artwork path end to end.** `verify:contests`
covers 141 things and none of them upload an image. The hero, the side image and
the perks were checked by eye at four widths in both themes. **Raise if artwork
ever comes back wrong after a save**, because there is no test that would catch
it.

---

## 23. DONE 2026-08-24. TikTok restates ad spend, and the sync never re-read a stored day

**Found and parked 2026-08-24.** Found by `pnpm verify:numbers`, which was
written for exactly this and is now in the suite list.

**What is wrong.** `tiktok-sync` skips any day it already holds: the guard is
`(advertiser_id, store_id, stat_date, videos_hash)` with a finished run, and
the comment on the `force` flag says *"a complete day cannot change"*. That is
true of `gross_revenue`, which has never moved on any day checked. **It is not
true of `cost`.** TikTok credits back invalid traffic for days that are already
closed, so the spend figure keeps moving after we have stored it, and we never
look again.

**What it had done to dev.** On 2026-08-24, before it was corrected:

| day | our spend | TikTok | overstated by |
| --- | --- | --- | --- |
| 2026-08-19 | $154.35 | $135.91 | **13.6%** |
| 2026-08-20 | $128.92 | $128.24 | 0.5% |
| all stored days | $841.24 | $817.96 | 2.8% |

GMV was correct to the penny on every single day. **Only spend drifts**, which
is the worse half: a creator sees more spend than was really charged, so the
ROI we show them is LOWER than the truth. Transparency is the product, and this
is the number being untransparent.

**Corrected on dev** by calling the sync with `force: true, days: 7`, after
which all 12 checked days matched exactly, 964 video-days compared.

**The fix, not yet applied because it changes live behaviour and costs API
calls.** The nightly cron runs `tiktok_run_nightly_sync(3)`, which posts
`{days: 3}` and no `force`, so it only fills gaps. It should re-read a rolling
window instead. Roughly one extra call per store per day per day-in-window, so
a 7 day forced window is 7 calls a night for one store rather than 1 to 3.
Open questions for Rashid: how far back to re-read, and whether to re-read
every night or weekly.

**FIXED on 2026-08-24.** The sync gained `refreshDays`, and the nightly cron
now runs `tiktok_run_nightly_sync(3, 7)`: reach back three days for anything
missing, and re-read the last seven whether or not we already hold them.

**Not `force: true`, which was the obvious fix and is a trap.** The late-video
backfill depth is only computed when `!force`, so forcing the nightly run would
have repaired stale spend and silently broken the case Rashid named, a creator
posting on the 1st and pasting the link on the 20th.

**And the first version of the fix was itself short.** The day loop runs
`back = 1..effectiveDays`, so `refreshDays: 7` with `days: 3` re-read three
days and reported seven. It would have missed the very drift it was written for,
which was four and five days back. The window now widens the loop.

**Proved end to end**, not just by reading the code: a row five days back was
deliberately overstated by $99.99 and the nightly call put it back; a row a
fortnight back was left alone, so the window is a real boundary rather than a
blanket force. `pnpm verify:numbers 20` then compared 1195 video-days against
the live API with no drift anywhere.

**Still open for prod:** prod has never synced and has none of the TikTok
secrets set. This migration and function go live with everything else when
Rashid says so.

---

## 24. Brand Hub: what the new sections still owe

**Parked 2026-08-24**, when My numbers, Contests and Leaderboards were opened
inside the creator Brand Hub.

**a. Two tabs are still empty rooms, deliberately.** Campaigns & briefs and
Creative studio have no table, no migration, no rows and no screen anywhere in
this repo. They stay marked and unclickable. **Raise it when either is actually
wanted**, and note first that nobody has yet defined what a CAMPAIGN is as
distinct from an offer or a contest. That definition is the blocker, not the
code. One thing to know before it is discussed: the landing page and the
creator welcome modal already PROMISE briefs to the open web
(`src/content/site.ts`), so this is not a quiet gap.

**b. Only ONE brand exists on dev, so brand isolation cannot be seen by eye.**
`verify:brand-numbers` proves the filter is applied, including that an unknown
brand returns nothing, but with a single brand a per-brand total equals the
global one and a leak would be INVISIBLE on screen. **Raise the moment a second
brand with real money exists**, and re-run the suite then. Better still, the
suite could make a temporary second brand and remove it, the way
`check-performance.mjs` does.

**c. The ByBrand panel ignores the source filter, and always has.** On the
standalone My numbers screen, tapping "Contest videos" narrows the tiles and
the chart but "Where your money came from" keeps showing every video, because
`creator_brand_performance` has no `p_source` argument at all. That contradicts
the screen's own comment, which says it filters in the database so everything
answers the same question. **Pre-existing, found while mapping, not introduced
here.** Inside a Brand Hub the panel is not rendered, so the bug is confined to
`/app/numbers`.

**d. `docs/FEATURE_MAP.md` section "Creator ad numbers, My numbers
(2026-08-18)" is stale in six ways** and contradicts both the code and the
newer sections of its own file: it describes a `distinct on` that no longer
exists, lists only the 2026-08-18 migration when every live body comes from
three later ones, and never mentions `p_source`, `creator_brand_performance`,
the ByBrand panel or `brand_id` on the money row. **Fix it in the same commit
as the next change to that surface.**

---

## 25. Brand World: what it still owes

**Parked 2026-08-24**, when the creator Brand Hub became a full-screen world.

**UPDATE 2026-10-09: it is no longer a world.** The hub is a normal PRISM screen
inside `ShellLayout` wearing the brand's accent, with a `HubNav` tab row in place
of the brand rail (Rashid: it looked like a different product and loaded like a
separate app). Items below were written for the world and are annotated where
that changes them.

**a. `src/routes/app/Brands.tsx` is now orphaned.** `/app/brands` opens the
first brand rather than a list, so nothing routes to that screen any more. It
is still in the repo. **Delete it, or give it a home**, next time that area is
touched. It was left rather than deleted because removing a whole screen in a
commit about theming is the sort of thing nobody finds again.

**b. Only ONE brand exists on dev, so the brand SWITCHER cannot really be
seen.** (The switcher is now the right-hand side of the `HubNav` row, shown only
when a creator has more than one brand, so with one brand it is not drawn at all.)
The rail renders the list correctly with one entry, but nobody has
watched a creator move between two worlds and the colours change. **Raise this
the moment a second brand exists**, and re-shoot: switching is the whole point
of the rail.

**c. No brand has a hero image yet.** The column, the upload control and the
crop rules are all built and the hero is designed to be right without one, but
the image path has been checked only by eye on a hub that has none. **Raise if
a hero ever comes back wrong after a save.**

**d. The world has no automated suite of its own.** `scripts/shots/shots-hub.mjs`
photographs five sections at four widths in both themes and fails on a console
error, a sideways scroll or a world that never renders, which is real cover.
(There is no brand rail now; the equivalent is the `HubNav` row.) But nothing asserts the RAIL: that both lists are present, that a locked tab
refuses a click, that the Leave link goes home. **Worth adding when the second
brand arrives**, since that is when the switcher becomes testable.

**e. Applicants reach the world.** They are allowed onto the route on purpose,
because the JWT role lags approval by up to an hour, and they see the
"this opens when you are approved" panel. That panel is NOT themed by the
brand and sits on the plain Wurx background. (Now that the hub sits inside the
shell this is the same for every state of it, not a gap.) Minor, and noted so nobody reads
it as the theming failing.

---

## 26. DONE 2026-08-25. Ad delivery status: scopes added, and what it bought

**Parked 2026-08-25**, when Rashid asked whether we can tell if an ad is
stopped, learning or queued. Probed live: **we cannot, today.**

**THE EXACT PATHS TO TICK**, quoted from TikTok's own refusals so there is
no guessing. Paste each into the "Enter an API name or path" box on the
**Scope of permission** screen of the app settings:

| category on that screen | path | what it gives |
| --- | --- | --- |
| Ads Management | `/campaign/get/` | campaign `operation_status` + `secondary_status` |
| Ads Management | `/adgroup/get/` | ad group status, where LEARNING shows |
| Ads Management | `/ad/get/` | per creative delivery status |
| Reporting | `/report/integrated/get/` | NOT status. Impressions, clicks, video views |

The first three are the status ask. The fourth is optional and unrelated: it is
the only route inside this app to engagement figures.

**TICKING IS NOT ENOUGH. The token has to be replaced.** An access token carries
the scopes it was minted with, so every existing token keeps answering 40001
until Rashid reconnects through Admin, TikTok settings and a new one is issued.

**Then re-probe before believing it:** `pnpm probe:tiktok`. Our calls go to
v1.3 for these four; if the app only offers a v2.0 scope for them, the probe is
what will say so rather than a doc.

**It is a SCOPE problem, which means it is ours and it is cheap.**
`/campaign/get/`, `/adgroup/get/`, `/ad/get/` and `/report/integrated/get/`
all answer `40001 ... lacks the required scope ... reauthorize your API App`.
That is the refusal that means OUR APP lacks the scope, not that the advertiser
withheld it. Add the scopes in the TikTok app settings, Rashid re-authorises,
done. No application to TikTok.

**What it buys:** `operation_status` (what the advertiser set) and
`secondary_status` (what TikTok is doing with it, where LEARNING and NOT
DELIVERING live). It also unlocks the integrated report, which is the only
route inside this app to impressions, clicks and video views.

**What it does NOT buy:** the GMV Max campaign objects.
`/gmv_max/campaign/get/` and `/campaign/gmv_max/info/` are a GRANT problem and
need TikTok to widen the authorisation.

**Confirmed dead ends, so nobody re-probes them:** status is not available as a
report field. `secondary_status` and `operation_status` are both refused by
name as metrics, and `campaign_id` is refused as a dimension.

**Why it matters rather than being a nice-to-have.** What a creator sees about
ads today is inferred from SPEND, not read from TikTok: "Ads running" means a
recent day had cost on it. So a campaign paused an hour ago still reads as
running until the spend stops arriving, and a campaign in learning with no
spend yet reads as "No ads".

**DONE 2026-08-25.** Rashid had the scopes approved and reconnected, and the
campaign endpoints answer. Full detail in OPERATIONS, "Ad delivery status".

**What it bought:** GMV Max campaign status per campaign
(`operation_status`, `secondary_status`, `roi_protection_compensation_status`),
plus the commercial settings this project had written off as unavailable:
`budget`, `roas_bid`, `auto_budget_enabled`, `roi_protection_enabled`,
`deep_bid_type`, the schedule and the placements.

**Two things it did NOT buy, and both matter.**

**a. A campaign still cannot be tied to a creator's video.** The video report
refuses `campaign_id` as both a dimension and a metric, and the campaign's own
`item_list` is empty with `product_video_specific_type: AUTO_SELECTION`. TikTok
chooses the videos and will not say which. So per-video ad state stays INFERRED
from spend, and a paused campaign still reads as running on a creator's screen
until the spend stops arriving. **This is now a known limit rather than an open
question.**

**b. `/report/integrated/get/` is still refused**, so impressions, clicks and
video views are still out of reach. It needs the **Consolidated Report** box
under Reporting, which was not ticked. One more scope change and reconnect.

**Still open for a future session:** nothing has been BUILT on any of this. The
campaign status and budget are readable and nothing reads them. The obvious use
is an admin-only panel on the brand's TikTok tab answering "are this brand's
campaigns actually running", which is a question Rashid has no way to answer
today. **Creators must never see the budget or the ROAS target.**

---

## 27d. REJECTED AGAIN 2026-09-15: the website, and the icon

**Status: LIVE ON PRODUCTION (2026-09-23, `d3f1555`), WAITING ON RASHID TO
RESUBMIT.** Rashid said "make it live". The public pages and the icons are on
`main` and deployed; `verify:site` is 86/86 against **wurxmediahub.vercel.app
itself**. Twenty-eight files, no migration, no Paid Collabs, no client links —
dev stays far ahead and the full "make all of it live" decision is untouched.

**The deploy had to go through the CLI**, with the PRODUCTION project's own
`.vercel/project.json` (`prj_OLeguFubM4HJApvxEbgDqCpzwNSO`, projectName
`wurxmediahub`) and `vercel deploy --prod`. The git deploy from the push to
`main` came back BLOCKED, same `TEAM_ACCESS_REQUIRED` as dev: PARKED 45, and
still Rashid's to fix.

**What is left: he resubmits.** The exact portal steps are in OPERATIONS,
"Resubmitting the TikTok app". The two prerequisites that were his are: the
site live on production (done) and `support@wurxmedia.com` existing (his).

**The history of it, in order:**
1. ~~Rashid reads the words.~~ He declined ("i don't have enough time") and sent
   wurxmedia.com and wurxmedia.com/content instead, 2026-09-22. Both were read
   and the site was corrected against them: the six services, the case studies,
   how a collaboration really runs, the creator count (ours said 5K+, theirs
   says 1,000), and the privacy policy, which denied holding phone numbers and
   payment handles that Paid Collabs has always held. **Anything about the
   business that is still wrong, only he can catch.**
2. **`support@wurxmedia.com` has to exist before we resubmit.** Rashid is
   creating it (2026-09-22). The legal pages tell people to write there, a
   reviewer may test it, and a creator asking for their data has a legal right
   to reach somebody. The Contact page gives `rajil@wurxmedia.com`, which
   wurxmedia.com publishes, so that one is already real.
3. The public pages go onto `main` on their own, as `5888faa` did.
4. He resubmits in TikTok's portal with the icon `public/tiktok-app-icon.png`
   and the Website URL `https://wurxmediahub.vercel.app/`.

**If they reject the vercel.app address itself**, the fallback is option B: the
same pages on `creators.wurxmedia.com`, which needs a DNS record and moves the
redirect URIs, the Supabase auth URLs and TikTok's URL verification.

**Raise it when:** he comes back to TikTok, or when he asks what is pending.

The diagnosis below is kept as the record of what was wrong.

**The reviewer's note, verbatim:**

> Changes to your app were not approved for production.
> Update the following fields and resubmit changes to your app: App icon ·
> Website URL
>
> Note from reviewer: Your website URL cannot be a landing page or login page.
> You must have an externally facing fully developed website.,A valid official
> website that houses information about your web and services.,The app icon
> submitted in the Basic Info does not match the icon displayed on the website.
> Please ensure the same icon is used consistently across both the TikTok, the
> website and Browser tab (favicon), then resubmit for review

**What moved since 27:** the "personal or company internal use" objection is
gone. Only these two fields are named.

### The icon, verified 2026-09-15

| where | what it shows |
| --- | --- |
| our browser tab, `public/favicon.svg` | the older geometric gold "W" on a gold square (already PARKED 8) |
| our site header, `public/wurx-logo.png` | the Wurx dog face and the "WURX Media" wordmark |
| wurxmedia.com browser tab | the dog face: `/favicon.svg` (vector) and `/favicon.png` (256px) |

Our own site disagreed with itself before TikTok compared anything. **The fix
is one mark in all three places, and it has to be the dog face**, because that
is what the official site already shows. Use one file for the TikTok app icon
and for our favicon.

**Rendering it, and the trap in doing so.** `https://wurxmedia.com/favicon.svg`
is 512×512 with NO `viewBox`. So stretching it to 1024px does not scale
what is drawn: the first render put a small face in the top-left corner of
an empty square. Add `viewBox="0 0 512 512"`, then set width and height to
1024. That renders centred and crisp (drawn area roughly x 40–469, y 111–403
of 512). It has a transparent background and a pale face, so look at it on
white before uploading.

### The website, verified 2026-09-15

Signed out, production (`main` at `62534b7`) serves one scrolling landing page
(Hero, TrustedBy, BrandMarquee, Platform, HowItWorks, ApplyForm, FinalCta),
plus `/apply`, sign in, `/terms`, `/privacy` and `/tiktok`, on a `vercel.app`
address. That is, fairly, a landing page with legal pages attached.

`wurxmedia.com` IS a fully developed official site (About, How it works,
testimonials, its own privacy and terms). But it says nothing about the hub,
and TikTok wants Terms and Privacy on the same domain as the app (see the
note in `router.tsx`).

### The two decisions only he can make

1. **Which website.**
   - **A, recommended:** turn our own public site into a real website on
     production. It gets its own pages (for creators, for brands, how it works,
     about, FAQ and contact) beside `/tiktok`, `/terms` and `/privacy`, with
     one nav, one footer and the dog face in the tab. Submit
     `https://wurxmediahub.vercel.app/`. The redirect URIs and the Terms and
     Privacy URLs stay exactly as they are.
   - **B:** the same site, on an official subdomain such as
     `creators.wurxmedia.com`. This is the strongest "official" signal, but it
     needs DNS on wurxmedia.com. It also moves every redirect URI, the
     Supabase auth URLs and TikTok's URL verification.
   - **C:** give `https://wurxmedia.com` as the Website URL. The least
     building, but that site says nothing about the hub, and Terms, Privacy
     and the redirects would all sit on a different domain.

   **Not documented anywhere we found:** whether a `vercel.app` address itself
   counts against "official". B removes that doubt; A does not.
2. **How it reaches production.** Either the public pages go onto `main` on
   their own, as the 2026-09-01 copy fix did (`5888faa`), or they wait for the
   full dev → production promotion.

### Found on the way: `main` has commits that `dev` does not

`git rev-list dev..origin/main` counts 3. One of them is `5888faa`, the
`/tiktok` page and the Terms/Privacy rewording, and **`dev`'s router has no
`/tiktok` route**. Any promotion of `dev` to production must merge `main`
into it first. Otherwise it deletes the page the resubmission points to, and
may restore the wording TikTok rejected in 27.

---

## 46. Euka ad spend per video: BUILT on dev 2026-09-15, with named gaps

**Status:** BUILT. Rashid chose Euka as the source ("let's move with euka for
now"), so the "which number wins" question below is settled: Euka wins. The
design and its rules are in FEATURE_MAP, "Ad spend, ROI and spark codes in
Paid Collabs come from EUKA".

**What is still open, with the trigger for each:**
- **Aurelia.** Euka reports 81 campaigns for its ad account but lists only 43,
  because it refuses paging. The other 38 campaigns' spend cannot be read.
  Raise it when Aurelia's totals look low, or when Euka fixes paging.
- **Brands with no ad account connected in Euka** show dashes: Apothecary,
  Biostime, Cutler Nutrition, Dangle-it, Dr. Harvey's and Nutra Harmony. Raise
  it when one of them asks why its ad spend is blank.
- **14 "Cutler Nutrition" GMV Max campaigns never answer.** They sit on
  Aurelia's ad account ("Product GMV Max_Gross revenue_Cutler Nutrition_…"),
  for June to September. Euka 504s on every request, even for a single week.
  As of 2026-09-15 18:40 UTC they were retrying every 4 minutes, up to 20
  tries. Every other connected brand's months are complete. They may be the
  campaigns carrying Cutler Nutrition creators' spend, since Cutler's own Euka
  store has no ad account connected. **Raise it when:** Cutler Nutrition or
  Aurelia ad spend is asked about and looks blank. The next lever is asking
  Euka whether these campaigns can be reported at all.
- **Spark codes on busy days.** A store-day that hits Euka's 150-row cap may be
  missing codes (`euka_spark_sync_days.capped`). Raise it when a video that
  has a code in Euka shows none.
- **Old and new numbers mixed during the backfill.** The copy fills over a few
  hours, current month first. Until then a month shows whatever has synced so
  far.

**Everything below was written before the build.**

### What the live test showed

Read-only, through the new `type: 'gmvmax'` mode on the `euka` Edge Function
(dev only).

- **The base URL was wrong at first.** Every `/v0/gmv-max/...` call answered
  "Route not found". Euka's spec declares its server as `/api/v1`, and on
  `https://api.euka.ai/api/v1` the same routes work. The older modes stay on
  `/v0`.
- **Ad accounts connected INSIDE Euka** (`/gmv-max/advertisers`): Penetrex
  has 2 (Biomax-PX, Infirst Healthcare), Dr Tobias has 2, and Aurelia,
  Longevity Box and Swisse Wellness have 1 each. **Not connected**, so Euka
  cannot give ad figures for them: Apothecary Brands, Biostime, Cutler
  Nutrition, Dangle-it, Dr. Harvey's, NUTRAHARMONY STORE.
- **The ITEM report is the one in Rashid's screenshot.** Given a
  `campaignId`, `/gmv-max/reports/item` returned EVERY video in the campaign
  in one call: 608, 327 and 497 rows for three Penetrex campaigns over 30
  days, `truncated: false`, live from TikTok.
- **Item ID is the TikTok post id.** 23 of the top 50 Penetrex videos by
  spend match a video link saved on a Paid Collabs row.
- **It fills what we cannot.** OUR TikTok ads data had figures for only 2 of
  those 23. Where both had one they agreed: once exactly (cost 303.79, GMV
  1149.66, 56 orders), once within 3% (cost 369.46 vs 358.76). That is the
  recent days being restated, not a real disagreement.
- **The store-wide creatives report cannot be paged.** It returns 50 rows
  with `hasMore: true`, and both `page` and `pageSize` get a bare 400 "Input
  validation failed", even though the spec documents them. Its synced
  coverage for Penetrex is only 2026-08-04 → 2026-09-14. So a real build reads
  the campaigns, then one item report for each.
- **Items sold is not in these reports; they give orders.** The Items sold
  column already comes from Euka's video exports (`itemsSoldCount` /
  `items_sold_count`), so it is a separate question from ad spend.

### The decision needed before building

When a video has figures from both our TikTok connection and Euka, which
wins? **Recommended:** ours where present, because it is read directly from
TikTok, and Euka only where ours is blank. Either way, every figure keeps the
month bounds that `collab-ad-figures.tsx` already applies.

**Everything below was written before the live test.**
**Raise it when:** Rashid wants per-video ad spend for a brand whose ad
account we have not connected, or asks for Euka to replace or check our
TikTok ads numbers.

**Rashid, 2026-09-15:** "does euka give us the ad spend for a particular
video? … if we give post(video) id and it returns cost ad spend gmv created
etc?"

**Answer, from Euka's own spec at `https://api.euka.ai/openapi.json`:** yes,
for GMV Max spend, but not as a lookup by post id.

| endpoint | per video | notes |
| --- | --- | --- |
| `GET /gmv-max/reports/creatives` | `itemId` (post id), `cost`, `orders`, `grossRevenue`, `costPerOrder`, `roi`, `currency`, `productImpressions`, `productClicks` | a date range, store-wide or one campaign, paged, sortable by cost/orders/revenue/roi. Read from Euka's DAILY sync, which rewrites the last 3 days; `coverage` null means nothing synced, not zero spend |
| `GET /gmv-max/reports/item` | the same, plus delivery status and click/conversion rates | live from TikTok; `campaignId` required; may be `truncated` |
| `POST /dashboard/boosted-videos` | `gmvMaxCost`, `gmvMaxRoi`, `adSales`, `acos`, `costPerOrder`, `adItemsSoldCount`, views, creator | at most 100, ranked by TRAILING-YEAR spend, not spend within the dates |
| `POST /dashboard/top-videos-by-revenue` | the same ad fields | only 5 videos. **We already call this, and discard those fields** |
| `POST /market-intelligence/tiktok/video/detail` | takes a `video_id` | ESTIMATES only: `ads_roas`, `ad_cpa`, `ads_views`, an ad flag. No spend |

**What it cannot do:** take a post id and return that video's actual spend.
The way is to pull the creatives report for the dates and match `itemId`.

**Preconditions nobody has checked:**
1. The brand's TikTok ad account must be connected inside Euka.
   `GET /gmv-max/advertisers?storeId=` answers that per store.
2. Both of our Euka keys must be allowed to read GMV Max. `GET /me` shows a
   key's brand access, not its plan.

**How to test without writing anything:** a temporary read-only mode on the
`euka` Edge Function calling `/gmv-max/advertisers` and one day of
`/gmv-max/reports/creatives` per store. The keys live only in Edge secrets.

**Why it might matter:** these are the same five numbers our own TikTok ads
pipeline reads directly from TikTok, and Euka relays TikTok. So it adds
nothing for brands whose ad account we already connected. It could fill in
brands whose ad account is connected to Euka but not to us.

---

## 45. Vercel blocks git deploys: link GitHub to the Vercel account

**Status:** OPEN, on Rashid. He said *"i will do it later remind me please"*.
**Raise it when:** the start of every session until it is done, and before
any deploy.

Since 2026-09-14, every push to `dev` comes back `BLOCKED` with "the commit
author doesn't have permission to create deployments"
(`TEAM_ACCESS_REQUIRED`). The commit identity is the same one that deployed
on 09-10. The Vercel team (Hobby plan, sole member `wurxmedia-6695`) has no
GitHub login linked, so Vercel cannot match GitHub `RashidNazeer` to a member.
A push to `main` would almost certainly be blocked the same way.

**His fix:** Vercel → Account Settings → Authentication → connect GitHub
`RashidNazeer`. Then push anything, or Redeploy, and confirm READY.

**Until then:** use the CLI route in OPERATIONS (Vercel section). Export the
sha with `git archive`, `vercel deploy` a preview of the dev project, then
`vercel alias set` it to wurxmediahubdev.vercel.app. That is how dev went live
at `aab0cf0` on 2026-09-15.

---

## 27. REJECTED 2026-09-01. Diagnosed, copy drafted, WAITING ON RASHID.

**Status:** BLOCKED, on two decisions only he can make
**Owner:** Rashid
**Raise it when:** he comes back to TikTok, or asks what is pending.

**The reviewer's note, verbatim:**

> Changes to your app were not approved for production. See why
> Note from reviewer: App will not be approved for personal or company
> internal use.,TikTok for Developers currently does not support personal or
> internal company use. Not acceptable: Display posts from the TikTok
> account(s) you or your team manage on your website.

### THE DIAGNOSIS: it is our wording, and we volunteered the exact banned word

TikTok's **App Review Guidelines**, under "Description", say in as many words:
**"Apps must not be for private or personal use."** The Content Sharing
Guidelines carry the published twin of the reviewer's sentence: *"API Clients
must not be limited to test applications and should be intended for a wide
audience, not limited to internal groups/private use."* Both pages were last
updated 2026-08-04, three weeks before we submitted, so they are the rules that
were actually applied.

We used that word about ourselves, twice, where the reviewer could not miss it:

1. The scope explanation's opening sentence: *"Wurx Media Hub is a **private**
   platform for TikTok Shop creators who work with our brands."*
2. `/terms`, the page the form tells them to check, opens "What this platform
   is" with *"Wurx Media Hub is a **private workspace, not a public
   marketplace**."* — `src/routes/legal/Terms.tsx:31`.

The sentence that refutes the rejection — *"You are an independent creator, not
an employee, worker, agent or partner"* — is the 10th of 14 headings, 78% down
a 1,286-word page, and LegalPage renders no table of contents.

**The product is not the problem.** Nothing in the Login Kit / video.list flow
matches "display posts from the TikTok account(s) you or your team manage":
each creator authorises their OWN account and the figures render only to them,
inside the signed-in app. Verified against the code, not assumed.

**Two things that partly resemble it — handle deliberately, never hide:**
- `creator_tiktok_videos` carries a staff SELECT policy as well as an own-row
  one (`20260825235328_creator_tiktok_connection.sql:208-219`). No admin screen
  reads it today, but **"only the creator can see them" would be a lie**, so
  the new copy says "that creator and Wurx Media staff helping them".
- The admin Content screen does embed creators' TikTok posts — but through
  public oEmbed and links the creators submitted, not through these scopes.

### THE BLOCKER, and it is a decision not a task

**The URLs on that form point at PRODUCTION**, which is frozen, running old
code and empty (0 profiles, 0 brands, 0 offers). Fixing the wording on dev
changes nothing a reviewer sees. **A resubmission needs a production deploy,
which is Rashid's "make it live" call and he has not given it.**

Second documented problem in the same place: TikTok requires *"an externally
facing fully developed website"* and says the Website URL *"cannot be a landing
page or login page."* We submitted the bare landing page.

### SHIPPED TO PRODUCTION 2026-09-01 — commit 5888faa on main

Rashid chose copy-only-to-prod over deploying dev, and a public page for the
connection. Both are live and verified on wurxmediahub.vercel.app:

- **Terms.tsx** no longer says "a private workspace, not a public
  marketplace". It opens on independent creators and open applications, and
  carries one sentence a reviewer cannot miss: creators own their own
  accounts and Wurx operates none of them.
- **Privacy.tsx** "our own internal rules" became "our staff data handling
  rules". The "private target" sentence was LEFT — it means a creator's own
  contest target, which is the honest use of the word.
- **NEW: /tiktok**, a signed-out page describing the connection — whose
  account it is, the two permissions, who can see the figures, how to
  disconnect. Linked from the footer. **This is the URL the resubmission
  should give as the Website URL**, not the bare landing page.
- Legal pages redated to 1 September 2026.

**Copy only: 7 files, zero migrations, zero schema, zero behaviour change.**
dev stays 39 commits and 7 migrations ahead; the "make it live" decision for
all of that is still open and untouched.

Verified signed out at 1280px in both themes: no horizontal scroll, zero
console errors, "private workspace" absent from all three pages.

### STILL TO DO — the submission itself, which only Rashid can send

The site is ready. Nobody has resubmitted anything. When he does, use the
copy below, and change the Website URL to **https://wurxmediahub.vercel.app/tiktok**.

### What he was asked, and has not yet answered

1. **Do we rewrite the Terms and Privacy wording?** It is his legal copy. The
   change is factual: "private workspace, not a public marketplace" becomes
   wording that says applications are open and approval-gated, which is what
   his own landing page already says.
2. **Does that go to production?** Nothing improves for a reviewer until it does.

**Nothing has been changed and nothing resubmitted.**

---

### What was submitted, verbatim, so a resubmission never has to re-derive it

| field | value |
| --- | --- |
| App name | `WurxMedia Hub` |
| Category | Business |
| Public description (115) | A creator platform for TikTok Shop brands. Creators see their own sales, commission and video results in one place. |
| Products | Login Kit, and only Login Kit |
| Scopes | `user.info.basic`, `video.list`, and only those two |
| Platform | Web, `https://wurxmediahub.vercel.app/` |
| Terms URL | `https://wurxmediahub.vercel.app/terms` |
| Privacy URL | `https://wurxmediahub.vercel.app/privacy` |
| Redirect URIs | prod AND dev callbacks, both already on the APP's own list |
| Reason box (101) | First submission. Requesting Login Kit and video.list so creators can see stats for their own videos. |

**The scope explanation, 932 characters, exactly as submitted:**

> Wurx Media Hub is a private platform for TikTok Shop creators who work with our brands. Creators sign in, see the offers a brand has for them, submit the videos they post, and are paid on the results.
>
> Login Kit: a creator chooses 'Connect TikTok' on their own profile page and authorises us with their own TikTok account. We use it only to know which TikTok account belongs to that creator, and to show them that account's name and picture back so they can confirm it is the right one. They can disconnect from the same screen at any time.
>
> video.list: once connected, we read the list of that creator's own public videos and show them the view, like, comment and share counts for those videos on their own profile page, so they can see how their posts performed. The figures are shown only to the creator they belong to and to Wurx staff.
>
> We never post, edit or delete anything on TikTok, and we never read another user's videos.

**Two earlier drafts were wrong and were caught before submission**, both in the
same direction — describing the product as doing something it does not:

- "for the videos they submitted to a campaign" — we read the creator's WHOLE
  recent video list, not a campaign subset. Describing LESS access than you take
  is the flag a reviewer looks for; describing more is safe.
- "alongside the sales those videos produced" — the card deliberately does the
  opposite, and says in as many words that these figures and My numbers are
  different measures that will never reconcile.

**Verified live at submission time:** `/`, `/terms`, `/privacy` and
`/oauth/tiktok-creator/callback` all return 200; the redirect URI on the form is
byte-identical to the one the deployed Edge Function sends; the scope list on
the form is identical to `DISPLAY_SCOPES`.

**One cosmetic thing left alone:** the app name is `WurxMedia Hub` while the site
and every document say `Wurx Media Hub`, with the space. Flagged to him, not
worth blocking on.

---

### The resubmission copy, drafted and checked against the code

Every line below was reconciled with what the product actually does. Do not
soften it into claiming less access than we take — that is the flag reviewers
look for, and over-claiming carries a permanent-ban clause.

**Public description (107 chars):**

> Independent TikTok Shop creators sign in to see their own sales, commission
> and video results in one place.

**Scope explanation (981 chars), no "private", "internal", "our team":**

> Wurx Media Hub is for independent TikTok Shop creators. Each owns and runs
> their own TikTok account; Wurx Media operates none of them. Any creator can
> apply on our public home page, and approved creators sign in to see the paid
> offers brands have for them and what their own posts earned.
>
> user.info.basic: a creator chooses "Connect TikTok" on their own profile page
> and authorises with their own account. We use it to know which account is
> theirs, and to show that account's name and picture back so they can confirm
> it. Connecting is optional.
>
> video.list: we read the list of that creator's own videos and show them the
> views, likes, comments and shares on the same page. Those figures are seen by
> that creator and by Wurx Media staff helping them. They are never shown on a
> public page or any other website.
>
> A creator can disconnect on the same screen: we revoke the token and delete
> the figures. We never post, edit or delete on TikTok, and never read another
> user's videos.

**Reason box (389 chars):**

> Resubmission after a rejection for personal or company internal use. That was
> our wording, not our product. Wurx Media Hub is used by independent TikTok
> Shop creators who own their own accounts, apply through our public home page,
> and connect by choice. We manage none of their accounts and display nothing
> from TikTok publicly. Same two scopes, reworded description, Terms and demo
> video.

**Hold everything else:** Login Kit only, `user.info.basic` + `video.list`
only, same Web platform, same two redirect URIs. Do NOT rename the app — the
missing space in "WurxMedia Hub" is not a rejection cause and TikTok's only
name rule is that it match the site.

### What the research could NOT settle, and he was told

- **There is no appeal route.** Resubmission through the Support form is the
  only path. No documented cooldown, no documented limit. Review takes days to
  two weeks.
- **No publicly documented case of a successful resubmission after this exact
  boilerplate could be found.** A real gap, not an abandoned search.
- **Whether an approval-gated app is approvable at all is not publicly
  documented.** What is written cuts mildly our way — the rule is about the
  AUDIENCE being wide, not about open registration, and reviewers ask for demo
  logins, which presupposes gated apps get reviewed. But nobody at TikTok has
  written "approval-gated is fine". Business risk, not a settled answer.
- A secondary framing risk, downgraded on verification but worth knowing:
  TikTok markets the Display API in audience-facing language ("enable their
  followers to view their TikTok videos without leaving your platform"), and
  ours is a per-creator dashboard. Borrow their vocabulary only where it is
  true of surfaces that already exist.

### The old note, kept because it earned its place

**Get their reason verbatim before changing anything.** TikTok's messages have
twice named the wrong field here — an authorise-page `client_key` error that was
really sandbox redirect configuration. Their stated reason is the starting
point, not the diagnosis. That held again this time: the note said "internal
use", and the actual defect was one adjective in our own copy.

---

## 27c. THE SANDBOX KEY ON PRODUCTION MAY BLOCK THE REVIEW ITSELF

**Status:** OPEN, and it is a question for Rashid before he resubmits
**Found:** 2026-09-04, by watching what production actually sends

### THE SWAP MAY HAVE TO HAPPEN BEFORE APPROVAL, NOT AFTER

Production drives the **sandbox** app: pressing Connect there builds an
authorize URL with `client_key=sbaw82kr6qc82ia76e`. 27b assumes the swap to
the real key happens once TikTok approve.

**That order may be backwards.** A TikTok sandbox only lets accounts on its
own target-users list authorise. A reviewer who opens
`wurxmediahub.vercel.app`, signs up and presses Connect with their OWN TikTok
account is not on that list — so the connection would fail for them, on the
exact screen the submission is about, for a reason that has nothing to do
with the app being reviewed.

**NOT VERIFIED, and it must not be guessed at.** What is confirmed is only
that production sends the sandbox key. Whether TikTok reviewers test the
live site themselves, and whether an unapproved app's own key would fare any
better than the sandbox one, is not documented anywhere we found.

**Two ways to take the risk off the table:**

1. **Give the reviewer the approved creator login** (`mrrashid3255@gmail.com`,
   role `creator`) **whose TikTok is already connected**, and make the demo
   video carry the whole flow. Then nothing depends on the reviewer
   authorising their own account. Cheapest, changes nothing.
2. **Add the reviewer's TikTok account to the sandbox target users** — only
possible if TikTok tell us which account they will use, which they do not.

Option 1 is what a submission should carry anyway. Raise it with him before
he sends the form.

## 27b. AFTER APPROVAL: the production key swap.

The second TikTok app exists and the flow works end to end **on production**,
proven with a real account on 2026-08-26: connected as "Code Buddy", token
stored, one video reading 1241 views / 65 likes / 4 comments / 0 shares, audit
row written. See FEATURE_MAP, "The creator TikTok connection".

**TWO SCOPES, SETTLED 2026-08-26 (late).** The app's Scopes page lists
`user.info.basic` and `video.list`. A detour that afternoon read four scopes off
a submission dialog, built the extra two and shipped them, which broke Connect
on production until it was reverted. See DECISIONS.

**Support for `user.info.profile` and `user.info.stats` is built and DORMANT** —
columns, scope-gated fields, and a totals strip on the card that hides itself
when the permission is absent. It keys off what TikTok GRANTED, never off
`DISPLAY_SCOPES`, so it is inert until those scopes are added to the app and
correct the day they are. **Do not rebuild it and do not rip it out.** Adding a
scope means widening `DISPLAY_SCOPES`, the app's Scopes page, the consent list
on the card and `/privacy` in one commit, then reconnecting.

**The swap itself, once he says the app is approved:**

- **Switch production to the APP'S OWN TikTok key.** Rashid
  asked which key that means, and "the production key" was too vague, so name it
  every time:

  | our site | TikTok credential it holds today |
  | --- | --- |
  | `wurxmediahubdev.vercel.app` | the APP's own key, `awxg…7g`, 16 chars |
  | `wurxmediahub.vercel.app` | the SANDBOX key, `sbaw…6e`, 18 chars |

  The switch is: move the `awxg…7g` **key AND its secret** onto production,
  replacing the `sbaw…` pair. It is not a new credential — it is the one already
  on dev, found at developers.tiktok.com under the app's own page, NOT inside a
  sandbox.

  **Two things that will bite:**
  - **NO LONGER INFERRED — both keys were read in full on 2026-09-04**, out of
    the authorize URLs the two sites actually build when Connect is pressed:

    | site | client_key it sends |
    | --- | --- |
    | `wurxmediahubdev.vercel.app` | `awxghd5gf1cme27g` — the APP's own |
    | `wurxmediahub.vercel.app` | `sbaw82kr6qc82ia76e` — the SANDBOX |

    The prefix convention held. No portal check is needed to identify them any
    more; the swap is putting `awxghd5gf1cme27g` and its secret onto production.
  - **The app keeps its own redirect URI list, separate from the sandbox's.**
    **ALREADY HANDLED — verified on the app's Login Kit page 2026-08-26.** Both
    `https://wurxmediahub.vercel.app/oauth/tiktok-creator/callback` and the dev
    one are on the APP's own list. Left recorded rather than deleted because the
    absence of that entry is what produced the misleading `client_key` error on
    the sandbox, and somebody will otherwise re-check it.
- **Then decide where the figures belong.** They are on the profile card because
  that is what the demo video needed. Whether they also belong beside a
  submitted video on Content, or on My numbers, is a product question nobody has
  asked yet. **They must never be presented as reconcilable with
  `tiktok_video_daily`:** these are organic lifetime totals for a whole video,
  that is the ad-driven slice, and the card says so in as many words.

## 35. DONE 2026-08-29. The dark/light audit, including the 30 unchecked claims

Rashid said "yes, run it" on 2026-08-29, and the answer turned out not to need
thirty agent votes. **The guard that should have caught these had been passing
them.** `check-collab-contrast.mjs` failed below 3.0 and merely warned between
3.0 and 4.5, on the reasoning that "large text is allowed 3.0" — which is true
of large text and false of the 9.5px and 11px labels that make up most of these
screens. It printed lines like `PASS Leaderboard: worst 4.02:1, 12 below AA`:
the failure was in the pass message.

Given the real per-element floor — 3.0 only at 24px, or 18.66px bold, and 4.5
for everything else — **30 elements failed across the six screens in both
themes**, which is the same order as the 30 unverified claims and overlaps them
substantially. All 30 are now fixed and the guard is 12/12 on the honest
thresholds.

**One mistake, thirty times: ink calibrated against the page, used on a tint.**
`--wx-text-faint` is 5.73:1 on `--wx-bg` and `pnpm check:contrast` proves
it. It is 4.02:1 on a warning-soft pill, because the tint moved the ground. The
fix each time was to put the ink back on `--wx-text` and let the tinted chip
keep carrying the meaning — colour was doing two jobs and could only do one
well. Four were different: a `tw-bg-white` button that stayed white in dark
mode, a hardcoded `#8C8C8C` footer, a green section label on green, and one
hired-by chip whose rosewood was 4.27:1 on its own background.

**Status:** DONE
**Owner:** Claude
**Raise it when:** Rashid mentions how Paid Collabs looks, or when there is
session budget to finish the verification.

Rashid, 2026-08-28: *"we need to fix dark and light mode issues there coudl be
many but i ust shraed one example run adversarial review or do wharever"*.

Six categories were audited, every finding put to three agents told to REFUTE
it. **13 confirmed and fixed, 13 refuted, and 30 that were never verified at
all** — their voters died on a session limit, and an unmeasured claim is not a
finding. They are listed below because several look serious, NOT because they
are established.

**WHAT WAS FIXED** (all in `src/routes/admin/wurxbase-overrides.css` unless
noted). The shape of nearly all of it: the vendoring pipeline mapped fills and
inks as separate declarations that never saw each other, so pairs that were
legible together came apart.

- **"New angle" was invisible in both themes**, 1.27:1 and 1.28:1 — the ink for
  the gold fill sitting on a plain well. Their own `:hover` set the accent,
  which is how we know it was meant to be an accent button all along. It also
  fronts the empty state, so a new brand-month opened with an unreadable
  invitation. **This is the example Rashid pointed at.**
- **Sortable column headers vanished under the cursor**, both themes.
- Modal header bands ran a gradient into our informational BLUE.
- **Six full-screen scrims were painted blue**, so every dialog read as an alert.
- **Every primary button was caution-amber** rather than brand gold.
- Rings drawn as cut-outs in hardcoded `#FFF` — a white halo round every face
  in dark mode.
- A sticky contract header that faded to 12%, so rows scrolled through it.
- Our own blanket field rule was the cause of two complaints rather than the
  cure: it painted the angle figures as wells (the box-inside-a-box) and its
  `color: !important` flattened six per-kind ink colours into one, deleting
  the "fetched, not typed" signal.
- A `.rep-chart` selector of ours that matched nothing — a fix somebody
  believed was in place.

**THE 30 UNVERIFIED, in the auditors' words. Treat as leads, not facts:**

- **[raw-colours]** The brand notes drawer is white with white text in dark mode
- **[raw-colours]** The Leaderboard's headline figure is hardcoded near-black on a token surface
- **[raw-colours]** Leaderboard card emphasis is exactly inverted in dark mode
- **[raw-colours]** Role pills and avatars: the ink was tokenised, the fill was not
- **[raw-colours]** Every primary button in User Management is filled with a soft token, so it reads as disabled
- **[raw-colours]** The Remove-member button is invisible until you hover it, then illegible in light mode
- **[raw-colours]** UMBtnGhost paints itself white on mouse-out and leaves its label near-white on it
- **[raw-colours]** Hovering a Settings row blanks the row you are pointing at
- **[raw-colours]** Month and period strips read inside-out in dark mode: the selected chip is the hole
- **[raw-colours]** The unread-notification dot is painted with a soft token and ringed in near-black
- **[raw-colours]** --wx-on-accent used as ink on hardcoded categorical fills, which are all dark
- **[raw-colours]** The creator detail modal is a near-white sheet in dark mode
- **[raw-colours]** The Tailwind retokenisation was half-done: gradient stops became gold, solid fills stayed blue
- **[raw-colours]** Near-white hairlines rule the Settings and Activity lists in dark mode
- **[raw-colours]** SqlQuest is a complete hardcoded light-mode modal, 52 literals, none of which can flip
- **[raw-colours]** Categorical colour arrays: eleven bare hex lists no stylesheet can reach
- **[our-overrides]** The SVG-ink !important is needed for one of four text roles in one theme, and flattens all four in both
- **[our-overrides]** The header's rim light is built from the accent, so it inverts from a highlight into a dark hairline in light mode
- **[states-and-focus]** The "New angle" button — accent ink on a surface fill, 1.27:1 in dark and 1.28:1 in light
- **[states-and-focus]** The primary buttons in the video picker and Access Control footers carry the identical defect
- **[states-and-focus]** The selected role pill in Access Control changes only its ink, to white-on-white in light mode
- **[states-and-focus]** The selection tick in the video picker is painted the same hex as its own background in dark mode
- **[states-and-focus]** The selected-video ring is a hardcoded hex that matches the dark panel it sits on
- **[states-and-focus]** The selected settings nav row uses a 10%-alpha token as ink, invisible in light mode
- **[states-and-focus]** The notes drawer textarea is hardcoded white, and it is portalled outside the fence so nothing can correct it
- **[states-and-focus]** Text selection is a 10-14% wash, so selecting a figure looks like nothing happened
- **[states-and-focus]** Every scrollbar is solid brand gold, and the thumb vanishes when you grab it
- **[states-and-focus]** The long angle table has a raw near-black Firefox scrollbar on a near-black panel
- **[states-and-focus]** The only keyboard focus ring in the vendored screen is the green that means "Payment Sent"
- **[states-and-focus]** Six hover states repaint an element the colour it already was

**A GUARD THAT LIED, AND WHY IT MATTERS MORE THAN ANY OF THEM.**
`check-collab-contrast.mjs` switched tabs by clicking a button named after
each one. Moving the six tabs into our sidebar removed those buttons, so
`if (await b.count())` found nothing, skipped silently, and it measured the
SAME screen six times while printing six passes — it went from "11 of 12" to
"12 of 12" on a change that touched no colour. It navigates by URL now and
**fails if two tabs in a row render an identical set of labels**, because the
only innocent explanation for that is that navigation stopped working. It also
signs in as superadmin: the old `lead` user is a viewer with no
`tabDiscovery`, so the sixth screen was never measured even before this.

**A REAL BUG THE FIXED GUARD FOUND, still open.** Our sidebar shows all six Paid
Collabs rows to any ops/admin, but the tab a person can actually open is gated
by their WURXBASE capability. A WurxBase `viewer` or `client` who clicks
Discovery is silently redirected to Brands with no explanation. Before the
tabs moved into our sidebar the row simply was not there. Two honest fixes:
have the vendored app publish its permitted tabs so the sidebar can hide the
rest, or land on the row and say plainly that this section is not theirs.

## 34. DONE 2026-08-29. WurxBase destroyed saved data on an ordinary click

**All six are fixed** on `fix/wurxbase-write-safety`, and the fix is not the
one that was designed. Every option in `docs/guides/WURXBASE_WRITE_SAFETY.md` was
written under "no DDL access on that project"; we have owned the schema since
2026-08-28, so the recommended JavaScript compare-and-swap — which admitted it
could not be made atomic — was replaced by one Postgres can enforce:

- a **partial unique index** on `(action, target)` for the three actions that
  store state, so one row per subject is a fact rather than a habit and
  insert-then-sweep stops being expressible;
- a **revision column**, making every save a conditional update that Postgres
  decides atomically. A stale screen changes nothing instead of flattening the
  row.

`pnpm verify:write-safety` reproduces the sequence that used to lose data:
11 checks, including that all three actions are inside the index predicate — a
typo there would have left one with the old behaviour and nothing would have
said so.

The other three were not concurrency, they were dialogs that lied: the brand
delete counted the filtered list on screen and deleted on the brand string
(5 shown, 17 removed, the extra twelve unreviewed applications, and Undo held
only the five); "Undo my changes" called `setDraft({})`, removing every
override the person had including ones somebody else set months earlier; and
the shared settings row could be written by a session whose load had failed,
because the guard was set true whether or not it succeeded.

**Original entry follows, for the record.**

## 34-was. WurxBase destroys saved data on an ordinary click, in six places

**Status:** PAUSED, needs a decision from Rashid
**Owner:** Claude
**Raise it when:** he asks about Paid Collabs reliability, before anybody new is
given a WurxBase login, or the next time Asad is in a conversation.

Found 2026-08-28 by a 100-agent audit of every write path in
`src/vendor/wurxbase/`. **Full detail and the fix design:
`docs/guides/WURXBASE_WRITE_SAFETY.md`.** Rashid has NOT approved any change yet.

**THE SHAPE, one sentence:** their screens read a `localStorage` mirror rather
than the database, a save writes whatever is in that mirror and then DELETES the
stored rows it replaces, and the load that fills the mirror swallows its own
error — so a screen that failed to load looks identical to a screen with nothing
saved, and the next click makes that emptiness permanent.

**Twenty-seven confirmed, 24 of them live:**

| Area | What happens | Severity |
|---|---|---|
| Access Control / users | Opening the user modal on a failed read reseeds five hardcoded accounts, resetting role and password | loses-saved-data |
| Access Control / users | "Undo my changes" discards every override ever stored on that person, not the ones you just made | loses-saved-data |
| Access Control / users | Permissions are loaded once and written wholesale, so a parked panel overwrites everyone else's grants | loses-saved-data |
| Creative angle testing | On a device whose mirror never loaded, "New angle" replaces the team's whole test for that brand+month with one blank angle | loses-saved-data |
| Creative angle testing | A second tab or a second teammate silently sweeps the row the other one just saved | loses-saved-data |
| Creative angle testing | A boot fetch that lands after a save overwrites the mirror wholesale, and the next edit makes the reverted state permanent on the server | loses-saved-data |
| Brand contracts | An empty modal saves nothing over the top of everything, and reports success | loses-saved-data |
| Brand contracts | The delete runs before the insert, so a failed save destroys the old row while the screen keeps showing it | loses-saved-data |
| The creator table | Deleting a brand destroys pending applications the user was never shown, and Undo cannot restore them | loses-saved-data |
| The creator table | Bulk "Hired By" writes to rows scrolled out of view and bypasses the Asad gate that exists on every other hired_by path | loses-saved-data |
| The creator table | An EUKA video with no usable date deletes the matching stored row, taking a hand-typed ad code with it | loses-saved-data |
| Discovery, brand order, realtime | scheduleSettingsSave is missing the load guard its sibling has, so mounting the app writes an empty brand_order over the team's saved order | loses-saved-data |
| Discovery, brand order, realtime | A realtime refetch rewrites the pending debounced patch, silently discarding a brand reorder the user just made | loses-saved-data |
| Discovery, brand order, realtime | settingsLoadedRef is set to true even when the settings fetch failed, so the guard lies and the next edit writes a partial list over the shared row | loses-saved-data |
| Discovery, brand order, realtime | saveDiscoveryMark deletes the existing outreach mark before inserting the new one, with no rollback of the delete, and the UI then restores the old colour it just destroyed | loses-saved-data |
| God Mode / app settings | God Mode brand delete counts approved creators but deletes every status, silently destroying pending applications | loses-saved-data |
| Access Control / users | After changing someone's role, toggling a switch off and on again deletes their stored override | corrupts-data |
| Brand contracts | A stale mirror rolls a teammate's newer terms back on the next edit | corrupts-data |
| Creative angle testing | Deleting the last angle removes the server row entirely, so the promised five-second Undo exists only in memory | annoyance |
| Creative angle testing | A half-typed figure in a cell is replaced when a late reload lands | annoyance |
| God Mode / app settings | app_settings brand_order save fires on mount with no load guard at all — an armed OVERWRITE-FROM-EMPTY held back only by RLS | annoyance |
| God Mode / app settings | settingsLoadedRef is set to true after a FAILED load, and every app_settings write refusal is swallowed to console only | annoyance |
| God Mode / app settings | Backup > Restore from file silently resets every God Mode setting when given a valid JSON file that is not a backup, and reports success | annoyance |
| God Mode / app settings | godGet's module cache is never invalidated, so a second tab's save writes back a stale snapshot over the first tab's settings | annoyance |

**NEEDS NOTHING TO GO WRONG FIRST** — these fire on a good day, on a good
connection, and are the ones to tell Asad about:

- **God Mode brand delete counts approved creators and deletes every status.**
  The dialog says "permanently removes its 5 creator records"; it also removes
  every PENDING application for that brand, which the count never included and
  Undo cannot restore. Same bug reachable from the Brand Drilldown trash icon.
- **Access Control "Undo my changes" writes `{}`** — every override that person
  ever had, including ones set months ago by somebody else.
- **Two tabs, or two people, and the second save silently wins**, on angle
  tests, contracts and permissions alike. No conflict warning, no trace.
- **Bulk "Hired By" writes to rows scrolled out of view** — the floating bar
  keeps its selection across a brand or month change — and skips the Asad-only
  gate every other `hired_by` path has.
- **Mounting the app can write an empty brand order over the team's**, because
  `scheduleSettingsSave` is missing the load guard its sibling has. One shared
  `app_settings` row, so it is everyone's ordering.

**DELETE-BEFORE-INSERT, so a failed save destroys the old row:** brand contracts
and Discovery outreach marks both delete first and have no rollback. The contract
one is the worst of the pair — it then reports "Could not save", and the mirror
keeps rendering the old terms, so nobody investigates while recovery is still
possible.

**2026-08-28: THE GROUND MOVED. RE-READ THE DESIGN BEFORE BUILDING IT.** Every
option in `docs/guides/WURXBASE_WRITE_SAFETY.md` was written under the constraint
"no DDL access on that project". That constraint is gone — their tables are in
our `wurxbase` schema now. A unique index on `(action, target)` plus an
upsert makes the angle-test AND brand-contract overwrite bugs *impossible*
rather than unlikely, in one migration, with no JavaScript to maintain across
releases. The delete-before-insert pair becomes a single upsert. **The
recommended option C was chosen partly because it did not need DDL; it may no
longer be the right answer.**

Also changed: Asad ships no more releases, so fixes go straight into
`src/vendor/wurxbase/` rather than into `wurxbase-patches.mjs`. The
one-file limitation of that script no longer needs fixing, and neither does the
build-time assertion about refused patches — both were consequences of
re-vendoring, which is over.

**WHAT WE CAN FIX ON OUR COPY:** everything now, not just the angle-test path.
Originally: only the angle-test path, and the design is
option C in the doc — a compare-and-swap. The mirror starts carrying the id of
the row it was built from; before writing, `saveAngles` asks the server which
row it currently holds using the fetch's own ordering, and refuses if it is not
the one this screen loaded, healing the mirror and telling the user. It fixes all
three angle findings, leaves their insert and sweep byte-identical so a
deliberate delete still deletes, and does not bet on `created_at` having a
default we cannot read. Two one-line swaps and one anchored insertion.

**`scripts/ops/wurxbase/wurxbase-patches.mjs` can only patch one file today** — `FILE` is
hardcoded to `WurxUI.jsx` — so it needs a small mechanical generalisation first.
**And a refused patch currently leaves THEIR unpatched file on disk**, which is
the dangerous version, so the same change must add a build-time assertion.

**REFUTED, do not re-raise:**
- **The creator table** — The EUKA auto-sync rebuilds the whole video_codes array from a snapshot taken before a long chain of network awaits
- **The creator table** — DEAD CODE TODAY — DetailModalV2's video editor truncates the array to the deal's video count and strips every metric field, on open-and-close with no edit
- **The creator table** — SAFE — the live video popup (CreatorVideosPopup) does write the whole array, but every way it can go stale is closed
- **Discovery, brand order, realtime** — The Discovery realtime handler replaces the entire marks map with no in-flight or ordering guard, and the delete half of a local save triggers it against a row that is briefly gone

## 33. NEVER DRIVE THEIR APP WITH A BROWSER ROBOT

**Status:** RULE, not a task
**Owner:** Claude
**Raise it when:** anybody is about to point a Playwright script at
`/admin/collabs`.

WurxBase talks straight to THEIR production Supabase from the browser, with no
staging copy and no auth: `bnevtdezskftlrjjgbsg`, publishable key in the
bundle, every write live. A screenshot script that clicks around that screen is
not taking screenshots, it is **using the product**, and their code has writes
on paths that look like reads.

The sharp one is `saveAngles` in `src/vendor/wurxbase/angleStore.js`:

```js
let sweep = supabase.from('activity_logs').delete().eq('action', ACTION).eq('target', key);
if (keepId != null) sweep = sweep.neq('id', keepId);   // keepId is null when the list is empty
await sweep;
```

**An empty save is an unconditional wipe of that brand-month**, with nothing
written in its place and no trace left behind. Their screen reads a
`localStorage` mirror, so a component that commits before the mirror arrives
commits an empty list.

On 2026-08-27 the `Aurelia::2026-08` angle test rendered at 00:33 PKT and was
gone at 00:37, while a screenshot script of mine was the only thing on that
screen. Asad had been working in the app until 00:31, so it cannot be pinned
either way — which is the point: **there is no way to tell, because their app
does not log a delete.**

**The rule:** read their database over REST if you need facts. Take screenshots
of OUR screens. If a shot of theirs is genuinely needed, ask Rashid to open the
page himself, or accept the screenshot Rashid already sent.

## 32. The vendoring pipeline still mistakes their browns for amber

**Status:** PAUSED
**Owner:** Claude
**Raise it when:** the Paid Collabs chrome looks too gold, or before the next
WurxBase release is vendored in.

`semanticFor` in `scripts/ops/wurxbase/vendor-wurxbase.mjs` decides whether a colour is
"saying something" from **HSV saturation**, which is a ratio and therefore
exaggerates wildly in the dark. Their whole chrome is warm dark brown, and
`#30271C` reads as 0.42 saturated at hue 33 — indistinguishable, to that
formula, from real amber. So 37 of their brown fills, and a long tail of their
hairlines, land on `--wx-warning`.

**The correct test is already written down in the comment there:** OKLab chroma.
Measured across their palette, every neutral sits at or below 0.030 (their
darkest brown 0.011, their light warm grey 0.030) and every genuinely semantic
colour at or above 0.105 (deep green `#047857`). A gate at 0.06 sits in open
space between the two and needs no tuning.

**WHY IT IS NOT SWITCHED ON.** Background and ink are themed as separate
declarations that never see each other, so a legible pair is luck rather than
design. Their Print PDF button is dark brown carrying pale cream: today both
halves go pale and it reads at 3:1. Correct the gate and the background becomes
a solid accent while the ink stays `--wx-text-muted` — **1.1:1** — and the same
happens to a count pill on Creators, a KPI pill, and a chip on Performance.
Tried on 2026-08-27: contrast went from 1 failure to 7.

**So the fix is not a better classifier, it is pairing.** Two honest routes:

1. `themeInlineStyles` already sees a whole `style={{...}}` object at once.
   When the background in that object resolves to a strong token and the colour
   resolves to a muted or faint ink, the ink should become `--wx-on-accent`.
   That covers the inline half, which is where all four regressions were.
2. For CSS rules, let `pnpm verify:collab-contrast` drive it: it already names
   the element and both colours, so each survivor becomes a `SWAPS` entry in
   `scripts/ops/wurxbase/wurxbase-patches.mjs`.

**Do not just flip the gate.** It is a one-line change that looks obviously
right and breaks four screens.

## 31. WurxBase v382: what the reskin still owes

**Status:** PAUSED
**Owner:** Claude
**Raise it when:** Rashid mentions how Paid Collabs looks, or before anybody
shows that screen to a client.

**a. DONE 2026-08-27, and it was not what this entry said it was.** The blue
was not the `PALETTE` array at all: `.cx-tr:hover` in their stylesheet is
`rgba(20,17,12,.014)`, a 1.4% wash, and the pipeline was throwing the alpha
away and painting it as a solid `--wx-info`. Fixed at the source in
`parseColour`/`withAlpha`, and the row hover is now ours in
`wurxbase-overrides.css`, because a faithful 1.4% wash is no hover at all on
our ground. The `PALETTE` array is still unreachable by the pipeline and still
tints the angle NUMBER badge, which is correct and wanted.
Original note: **The Creative angle testing selected row was a solid blue** with underlined
orange link text on it. The blue is `#1259C3`, from a `PALETTE` array of eight
categorical colours in `src/vendor/wurxbase/CreativeAngles.jsx` used to tell
angles apart. **The vendoring pipeline cannot reach it:** it themes colours that
follow a CSS property name, and a bare array of hex strings has no property to
key on. Two honest fixes — map that array in `vendor-wurxbase.mjs`, or add a
swap to `scripts/ops/wurxbase/wurxbase-patches.mjs`, which already supports in-place swaps.
**Rashid said on 2026-08-27 that he has two changes he wants here. Ask him
first; this may be one of them.**

**b. DONE 2026-08-28.** It was two badges, not one, and the cause was not the
badge. `PerfBrandSection` in `WurxUI.jsx` held five hardcoded light-mode
colours; the count pill stayed `#F1F1F4` on a near-black page while its ink
flipped to near-white. Tokenised — Active takes the success family because it is
a real state, Inactive takes neutrals because it is not a warning. Performance
in dark went from 1.10:1 to a worst of 4.9:1, and
`pnpm verify:collab-contrast` is 12 of 12.

**c. Their app cannot save its own settings.** `app_settings` returns 401 /
42501 on every write — their RLS refuses the anon key. Pre-existing, unrelated
to anything of ours, and harmless: it only means WurxBase cannot persist its own
preferences from inside our admin. Worth telling Asad rather than fixing here.

**d. Their JSX still holds categorical colour arrays and a few raw hexes**
that no stylesheet can reach. 447 inline colours in `App.jsx` and 46 in
`WurxUI.jsx` ARE themed by the pipeline now; what is left is arrays.

## 28. Brand themes: the three things deliberately left

**Status:** PAUSED
**Owner:** Claude
**Raise it when:** Rashid looks at a brand world and says one of the three
things below, which is the moment each becomes worth doing rather than before.

Multi-colour themes shipped on 2026-08-25. An admin colours the hero, the menu,
the pages and the buttons independently, up to four colours each. These were
considered and left out on purpose. (Since 2026-10-09 only the hero and the
buttons are offered; the menu and pages areas are retired, and the hub is a PRISM
screen in the shell, so "brand world" below means the hub.)

**a. The stage colours and the status colours are still not themed.** Inside a
brand world the seven-step tracker is blue, an approved badge is green and a
rejection is red, whatever the brand's colours are. That is the standing rule —
an approval has to look like an approval in every brand, and a brand whose
colour happens to be red must not turn every warning into decoration — but it is
by far the most visible thing a multi-colour theme does NOT reach. **Expect this
to be the first question.** If he wants it, the honest middle is to tint the
NEUTRAL steps of the tracker with the brand and leave the semantic ones alone;
tinting all of them means a red brand cannot show a rejection.

**b. A brand cannot pick a different palette for dark and light.** One set of
picks serves both, because the band is per mode and the hue is kept exactly.
That is the right default and it halves the ways to get a brand wrong. If a
brand ever genuinely needs two, the shape already has room: `theme.dark`
alongside the four areas, read only when present. Do not add it speculatively.

**c. Nothing themes the SIGNED-OUT screens or the Wurx side.** Login, the
dashboard, the offers list outside a hub and the whole admin panel stay Wurx
gold. A creator only enters a brand's colours by entering that brand.

**Also worth knowing:** `text-accent` inside a brand hub resolves to the
brand's FILL colour, not the measured ink. It clears AA in practice, because the
accent band sits on the opposite side of the lightness axis from the page band
in each mode, but `--wx-brand-accent-ink` is the value with the guarantee on it.
New brand-world code should prefer the ink for text. Not worth a sweep of every
existing `text-accent` today.

## 29. What the data inventory turned up, 2026-08-26

**Status:** PAUSED, five separate items, none of them started
**Owner:** Claude
**Raise it when:** Rashid asks about privacy, security or app review — or
immediately if any of these is going to prod, because (a) and (b) are about real
people's information.

A four-way inventory of the migrations, Edge Functions, storage buckets and
third-party calls was run on 2026-08-26 so the privacy policy could be accurate
rather than boilerplate. It was, and it also found these. **None is a fabricated
risk: each was read out of the code, and (b) was proven against dev.**

**a. A staff reviewer's private note about an applicant is readable BY THAT
APPLICANT.** `applications.review_note` reads like an internal note, but the
SELECT grant on `applications` is table-wide with no column list, and
`applications_select_own` is a ROW policy. So the applicant can pull the note
written about them through the API whether or not a screen ever shows it. Two
honest fixes: narrow the grant to columns, or tell staff plainly that the note is
not private. **This is the one to decide first**, because staff are writing notes
today believing they are private.

**b. Any signed-in account can list the whole `creator-avatars` bucket.**
PROVEN on dev: signed in as a real creator, `list()` returned all 41 objects.
`creator_avatars_read_signed_in` is `using (bucket_id = 'creator-avatars')` with
no further condition, and `creator_avatars_select_signed_in` on the index table
is `using (true)`, so a creator can also read the index that maps every object
path to a profile id and a TikTok handle.

Rashid DID approve showing creators each other's faces on the leaderboard
(2026-08-20), so this is not an unapproved feature. But it goes wider than the
migration's own comment claims. That comment says *"The only ids a creator ever
holds are the ones the leaderboard has already decided to show them"* — which is
false, because listing needs no id at all — and it also says *"Writing stays
impossible: there is no insert, update or delete policy on this bucket for
anybody"*, which is false too: the 2026-08-19 migration created `is_staff()`
gated insert, update and delete policies and they are still there. **Do not edit
that applied migration; correct it in a new one or leave the correction here.**

The exposure that matters is people who are NOT on any leaderboard: applicants,
including rejected ones, whose faces are in the same bucket.

**c. Nothing is ever deleted from Storage, and one bucket is public.** There is
no delete call against Storage anywhere — not in the app, the Edge Functions or
the scripts. Replacing a brand logo, hero, product photo or contest banner
uploads a new object and abandons the old one, which stays reachable by URL
forever; `brand-assets` is a PUBLIC bucket. Deleting a brand, a contest or an
account removes rows and leaves every image. The dev tidy script empties
`creator_avatars` but not the bucket, so an "erased" person's face survives as an
orphan. The privacy policy now says we keep things until asked rather than
inventing a schedule, so this is honest today, but it is not tidy.

**d. DONE 2026-08-27. The Google Fonts import is gone**, dropped by
`scripts/ops/wurxbase/vendor-wurxbase.mjs` on every vendoring, so it cannot come back with
their next release. Inter is self-hosted here, so nothing changed on screen.
Original note: **The vendored Paid Collabs CSS imported Inter from Google Fonts.** The main
product self-hosts every typeface; `src/vendor/wurxbase/App.css` and
`paidcollabs.css` still `@import` from `fonts.googleapis.com`, and it survives
into the built CSS. So an admin opening Paid Collabs makes a request to Google.
No creator screen does. A one-line fix (drop the import, the font is already
self-hosted), and it removes a third party from the admin panel entirely.

**e. `support@wurxmedia.com` must actually exist.** Both legal pages and the
TikTok app registration point at it. A reviewer may write to it and a creator
asking for erasure has a legal right to reach somebody. Set in
`src/routes/legal/legal-contact.ts`; change it there and nowhere else.

**Also worth knowing, and not a problem:** the TikTok money pipeline runs on DEV
ONLY. Prod has the TikTok secrets deliberately unset, so production ingests
nothing from TikTok today.

## 30. DONE 2026-08-26. Production launched. What it still owes.

The first production launch happened on 2026-08-26, after Rashid unpaused the
database himself. **58 migrations applied, 10 Edge Functions deployed, auth
configured, frontend shipped, sign-in proven to produce a real identity.** The
gotchas that cost time are written up in OPERATIONS under "Launching an
environment: what a migration does NOT carry" — the short version is that a
migration carries the schema and nothing else, and the access token hook
defaults to OFF, which fails in total silence.

**What production still owes, and none of it is blocking anybody today:**

**a. It is EMPTY. The data question was never answered.** 0 profiles, 0 brands,
0 offers, 0 contests, 0 money rows. Rashid said *"we will shift all our data to
prod"*, and his standing rule is *"Prod never gets test data"*. Dev holds 41
seeded creators sharing the password `1234567890`. **Ask which he means before
moving anything:** the real subset (the Penetrex brand, its products, its real
TikTok connection and the real GMV rows) is almost certainly what he wants; the
41 seeded logins should be argued against.

**b. TWO TikTok secrets are still unset on prod.** `TIKTOK_APP_ID` and
`TIKTOK_REDIRECT_URI` were set on 2026-08-26 — the app id is public and the
redirect is derivable, so neither needed asking. Outstanding:

- `TIKTOK_APP_SECRET` — **only Rashid can supply it.** It is not on this machine
  and never has been. The standing rule is that it is never written to a file;
  it lives only as an Edge Function secret, and `supabase secrets list` returns
  a DIGEST rather than a value, so it cannot be copied across from dev either.
  He gets it from TikTok for Business, the "Wurx Ads Reporting" app, Basic
  Information.
- `TIKTOK_SYNC_SECRET` — ours to generate, and it must match in TWO places: the
  Edge Function secret, and the `tiktok_sync_secret` entry in the database vault
  that the nightly cron reads. Setting one without the other fixes nothing.

**And the prod callback must be added on TIKTOK'S side**,
`https://wurxmediahub.vercel.app/oauth/tiktok/callback`, in the ads app's
allowed redirect list, or the round trip is refused.

**Then an admin connects on prod once.** Same app, no new review: the OAuth
grant is a row in `tiktok_connections`, and that table lives per database, so
prod needs its own. That is the whole of "authorising again".

**c. The nightly cron throws every night at 03:20** until (b) is done, because
`tiktok_run_nightly_sync` raises when the vault has no `tiktok_sync_secret` or
`tiktok_sync_url`. A log line in an empty project, but it is not nothing.

**d. `verify:rls` has never been run against prod.** It is the suite that
matters most on a fresh database and it needs `SUPABASE_SERVICE_KEY` for the
prod project. Worth running before anybody real signs in.

**e. Nobody has looked at production in a browser.** Every check so far was a
script. The legal pages are proven; the rest of the app on prod has been seen by
nothing with eyes.

## 36. Euka: three things found while fixing the proxy, and deliberately not fixed

**Status:** OPEN
**Owner:** Claude
**Raise it when:** somebody compares a number against the old app, or asks
why two people sweeping the same brand get different videos.

All three were found by measuring the live API on 2026-08-29 while restoring
the endpoint. None is caused by the port; all three predate it and two of
them exist on Asad's deployment too.

**a. The video window is asked for in UTC and enforced in the browser's
local time, and the difference is DELETED rather than skipped.** Euka filters
`posted_date` on its UTC calendar day. `collabWindowFor` builds
local-midnight boundaries, and `buildEukaVideoPatch` pushes anything outside
them into `outIds` and then FILTERS THOSE ROWS OUT of `video_codes` — so a
video Euka correctly returned is removed from the creator's record and its
GMV leaves the panel total. Measured on live data: at UTC+5, 143 of 19,381
rows sit in the lost band, and 590 of 19,381 (3.0%) change side depending on
the operator's clock. **Two people running the same sweep write different
video_codes.** Fixing it means comparing in UTC on both sides, which touches
their merge logic — the piece of this app that has already destroyed data
twice — so it wants its own change and its own verification.

**b. Euka's own numbers are not stable between identical calls.** Three
back-to-back identical exports seconds apart: four rows flipped
`estimated_post_rate` to 0, and one row moved `last_30d_gmv` 1017.05 to
918.28 with its tier going L1 to L0. The handle set and order were identical
each time. **There is an irreducible floor under "their number vs our
number"** — a byte-perfect port still will not tie with a side-by-side
reading. Worth knowing before anybody spends a day chasing a 2% difference.

**c. The nightly Euka check-in was never ported.**
`netlify/functions/euka-checkin-background.js` runs at 06:00 daily on their
deployment, sweeps every store and writes `monthly.euka` back onto creator
rows — in the Supabase project retired on 2026-08-28. The screens no longer
depend on it: L30 and tier now read live first and treat the stored value as
a fallback. What is still missing is the `EUKA_CHECKIN` summary row it wrote
into `activity_logs`. Port it as a scheduled Edge Function if anybody misses
that trail.

## 37. The Euka data sync is written and rehearsed, not applied

**Status:** READY, WAITING ON RASHID
**Owner:** Rashid says go, Claude runs it
**Raise it when:** he asks about the old app, the video counts, or the
cutover — or at the start of the next session, because it is the queued item.

`pnpm wurxbase:sync` is a dry run. `--apply` writes. Last rehearsal:
**10 updates, 1 insert, 0 deletes** — 4 payment marks, 3 delivery flags, 2
statuses, 4 video lists topped up, 1 creator added. Every one fills a blank.

**Do not reach for `wurxbase:copy` instead.** That one empties each table
before refilling and would discard the eight `hub_email` links, our audit
history, and everything entered on our side.

Nineteen of the 25 missing videos are hand-typed links for Aqua Sonic and
Bentgo, brands with no Euka store, so they exist in no other system and only
a sync brings them. Six are Euka videos that heal themselves.

## 38. Their old app is still live and still being written to

**Status:** OPEN
**Raise it when:** anyone compares a number between the two.

On 2026-08-31 Asad added creators at 15:53 and Usman changed workspace
settings at 16:13, in the OLD app. The same creator went into both databases
within 24 seconds and now carries a different id in each. Rashid has since
told Asad to stop; nothing enforces it.

**Their deployment still runs the bugs fixed here on 2026-08-29**, so its
numbers are actively getting worse: the swallowed 400 from Euka means every
sweep writes `items: 0` over real counts. Ours has the right figures. Do not
"correct" ours towards theirs.

## 39. Their app records nothing when money is marked paid

**Status:** OPEN
**Raise it when:** somebody asks who marked a creator paid, or before the
prod cutover.

Found while answering exactly that question. Only BULK payment edits write an
audit row; marking one creator paid from the row writes nothing to either of
their two trails. Four creators worth $2,310 were marked Paid on their side
and there is no record of who did it or when — the last logged payment change
of any kind is 18 May. Our own admin actions are audited properly; this screen
came from their code and inherited the gap. Worth closing before their team is
doing it daily.

## 40. Paid Collabs is not usable on a tablet, and that now blocks a screen he uses

**Status:** OPEN, and promoted from 13e
**Raise it when:** he opens Paid Collabs on anything narrower than a laptop —
which he does, and which is why this is no longer just a note.

Measured again 2026-09-01 at 768px: the Performance tab renders brand cards
carrying **no brand name, no GMV, no ad spend** — a drag handle, a chevron and
a video count. The values are in the DOM; their responsive CSS simply does not
lay them out. The performance sheet cannot be reached at all from there, so
everything fixed in it that day is desktop-only.

It is theirs, not ours, and that was measured rather than assumed — see the
note in memory. Rewriting a table-to-card transformation across six tabs is a
feature, not a styling pass. But he asked for this screen to be premium, and
on a tablet it is not a screen yet.

## 41. Two more canvas aliases are mis-roled, and one of them is ink

**Status:** OPEN, found 2026-09-01 while fixing the Discovery colour band
**Raise it when:** anyone reports an unreadable label in Paid Collabs, or
before the next re-vendor.

The same codemod mistake that painted the container gold left four more
aliases on tints: `--mc-cream` and `--mc-cream-lifted` on
`--wx-warning-soft`, `--f7-surface` on `--wx-info-soft`, `--f7-cream` on
`--wx-warning-soft` (App.css:3045, :3163). As CANVASES they are now inert,
because the correction overrides the container outright.

**But `--mc-cream` is also used as INK**, and there it is still wrong. Three
live buttons — `.esm-add-btn`, `.empty-clear-btn`, `.sp-team-add-btn` — set
`background: var(--mc-charcoal); color: var(--mc-cream)` on :hover, which
resolves to a light page grey behind a 10% amber. The label disappears when
you hover it. Narrow, hover-only, and a different bug from the one that was
reported, so it was left rather than folded in silently.

The other selectors carrying the same mapping — `.ph-kpi-purple`,
`.um-add-btn`, `.sp-seg-btn`, `.sp-accent-swatch`, `.login-sky`,
`.mobile-bottom-nav` — are DEAD CODE, verified: zero JSX uses anywhere in the
repo. Do not "fix" them; they paint nothing.

## 42. theme.css is entirely inert, and repairing it would turn the app gold

**Status:** OPEN, and it is a trap
**Raise it when:** anyone tries to make the vendored density, radius or
motion preferences work, or wonders why theme.css has no effect.

The v382 re-import inserted a space into all 17 of `theme.css`'s attribute
selectors — `.wurxbase-root [data-theme="dark"]` instead of
`.wurxbase-root[data-theme="dark"]` — turning every one of them from "this
element" into "a descendant of this element". Nothing matches, so that whole
file's dark/density/radius/motion layer has never applied.

**That is currently load-bearing.** theme.css:14 maps five canvas aliases onto
`var(--wx-accent)` — full-strength brand gold, not a 10% wash. The only
reason the app is not gold today is that the selectors are broken. Repair the
selectors without first correcting those five aliases and the whole of Paid
Collabs turns solid gold.

## 43. The TikTok ads pipeline is not storing most creators' videos

**Status:** OPEN, and it undercuts the product's main promise
**Raise it when:** anyone asks why a creator's ad spend is blank, or before
production gets real creators.

Found 2026-09-02 while answering a question about one creator. Erin Cooper
has **83 Penetrex videos**, and NONE of them are in `tiktok_video_daily`.
The table holds about **41 distinct videos in total**, over a window of
30 July to 30 August.

**It is not an access problem.** Asked live, TikTok answered for 33 of her 83
videos and returned real figures for August: **$3,473.70 ad spend, $5,843.33
gross revenue, 346 orders, 1.68x**. One video took 57% of the spend. So the
credentials, the endpoint and the store are all fine — the nightly sync
simply is not asking about these videos.

Two candidates, neither confirmed: the sync builds its item-id list from a
source that does not include Paid Collabs video links, or it is scoped
narrower than the brand. The call it makes is
`gmv_max/video_list/report/get/` filtered by `item_id IN [...]`, so whatever
builds that array is where to look (`supabase/functions/tiktok-sync/index.ts`).

**Why it matters more than one creator.** "A creator logs in and sees the ad
spend behind their own video" is the product. If the pipeline only covers 41
videos, most creators would see nothing and nobody would know.

## 44. Reacher: REOPENED 2026-09-23 and BUILT, for Irwin Naturals only

**Status:** BUILT on dev. Irwin Naturals syncs from Reacher every 15 minutes.
See FEATURE_MAP, "Irwin Naturals comes from Reacher, not Euka", and OPERATIONS,
"Reacher (Irwin Naturals only)".

**What changed since the notes below were written (2026-09-02):**
- **The account now has FOUR shops, and one of them is ours in a new way:**
  Irwin Naturals (12832) joined Cutler Nutrition, Biostime and Longevity. Irwin
  is a Paid Collabs brand with 27 creators and no Euka store, so Reacher is the
  only source it can have.
- **The base URL was never recorded here and cost an hour.** It is
  `https://api.reacherapp.com/public/v1` with `x-api-key` and `x-shop-id`.
  `reacher.so` is the unrelated email-verification service.
- **Still no GMV Max data**, on Irwin as on the others: zero campaigns, so no
  ad spend. Everything else about the shop is alive — 207 videos.
- **The write risk is handled structurally**: `_shared/reacher.ts` refuses any
  path not on a four-entry read allow-list.

**The open question from 2026-09-02 still stands:** `est_commission` is not one
number, and nobody is paid from it until Reacher explain the derivation.

**Raise it when:** Irwin's ad account is connected in Reacher (the spend
pipeline is built and waiting), or another brand moves onto Reacher.

Rashid, 2026-09-02: *"this is not to be built in this app reacher is diff
forget that now i just wanted to see what's available"*. Nothing was built.

What was learned, so it need not be re-derived. Reacher is an affiliate
platform for TikTok Shop sellers, not the email-verification service of the
same name. **319 endpoints**, essentially their whole product behind an API
key. His key has **read AND write** (`GET /whoami` returns `can_write: true`);
reads are 60/min, 3000/hour.

- **Three shops:** Cutler Nutrition and Biostime (US, live, collecting),
  Longevity (UK, GBP, **inactive** — never logged in, onboarding never
  finished).
- **Pro plan $599/month, on trial until 15 September 2026**, Stripe attached
  and set to charge automatically.
- **POST does not mean write.** ~59 of their POSTs are reads that carry a
  filter body; ~48 genuinely write. Their own docs say so on one endpoint.
- **No order-level creator attribution.** `POST /pnl/orders` has
  `affiliate_commission` per order x SKU, but no creator field and no
  order-id lookup — and P&L has `never_run` on both shops, so there is no
  order data at all until Reacher enable it per shop.
- **`est_commission` is not one number.** `/creators/list` is lifetime and
  ignores the date filter; `/creators/performance` is windowed and works. For
  one creator the two disagreed — a 90-day figure HIGHER than the lifetime
  one, on less GMV. Do not pay anyone from it without asking Reacher how each
  is derived.
- **Reacher holds working login access to the TikTok Shop seller accounts.**

### Re-checked 2026-09-02 evening, on Rashid asking "does it give something new?"

**The key is unchanged** (secrets file untouched since 1 Sep). What changed is
Reacher, and this time we pulled their machine-readable `openapi.json` rather
than scraping the docs page — 263 paths, 299 operations, saved to the
scratchpad. Diffed against yesterday, **seven operations are new and all but
one are GMV Max**:

- `GET /gmv-max/campaigns/{id}/spend-by-surface`, `/delivery-status`,
  `/settings`, `/changes`
- `POST /gmv-max/campaigns` and `PATCH /gmv-max/campaigns/{id}` — WRITES
- `POST /products/catalog`

**The one that would matter to us was already there and is worth knowing about:**
`GET /gmv-max/campaigns/{id}/creative-metrics` returns DAILY PER-CREATIVE
spend, impressions, clicks, conversions, revenue, ROI and the full view-rate
funnel, keyed by `material_id`. Per-creative is per-video. That is precisely
the grain PARKED 43 says our own pipeline is missing.

**But there is no GMV Max data behind any of it.** `/gmv-max/campaigns`,
`/automations`, `/spark-codes` and `/excluded-creators` are all empty on both
live shops, and `/gmv-max/dashboard` is zeros across every metric. **Verified
against a live control** rather than trusted: `/creators/performance` on the
same shops returns 27,525 creators for Cutler and 4,358 for Biostime with real
August GMV, so the account is alive and the GMV Max side is genuinely not
connected. (Yesterday an empty response is exactly what made me tell Rashid
Cutler had no creators. It has 42,045.)

**P&L is still `never_run` on both shops**, so still no order data at all.
Longevity now returns a clearer refusal — *"no TikTok seller ID on file"* —
confirming onboarding was never finished.

### THE THING THAT ACTUALLY DECIDES THIS: Reacher barely overlaps with us

| Reacher shop | one of our brands? |
| --- | --- |
| Cutler Nutrition | **no** |
| Longevity | **no** (and inactive) |
| Biostime | yes — 38 of our 1,277 Paid Collabs rows |

**Penetrex is not in Reacher at all** — our biggest brand at 259 rows and our
only Brand Hub. So Reacher can never answer PARKED 43, which is a Penetrex
question. It reaches about **3% of the roster**.

For that 3% it does add something real. Reacher knows **16 of our 19 Biostime
handles**, and holds August figures our sheet does not:

- `briceyscarbear` $3,610.91 GMV / $999.29 commission — our sheet: blank
- `supersaiyansolo` $2,780.01 / $586.13 — blank
- `vsternau`, `neptunenavigates`, `jayden_smith4` — all blank here

Where both have a number they mostly agree — `ka.devore` and `laurendauk`
match to the cent — and sometimes do not (`southernseed_` $977.31 vs our
$1,045.27). **`est_commission` is the genuinely new field; we hold no
commission figure anywhere.** The warning above still stands: their two
commission numbers disagreed with each other, so nobody gets paid from it
until Reacher explain how it is derived.

**A trap worth remembering.** A first pass reported "Reacher knows 1 of our 19"
and it was wrong. `wurxbase.creators.tiktok_account` stores a FULL URL
(`https://www.tiktok.com/@handle`), not a handle, so every comparison against
a handle silently misses. Proved by a positive and negative control on their
filter before believing the miss. Anything joining us to an external creator
source must extract the handle from that URL.

### Two things with a clock on them

1. **The key can WRITE, and now writes ad campaigns.** `can_write: true` with
   `POST /gmv-max/campaigns` (create), `PATCH` (update budget, target ROAS,
   schedule) and `POST /gmv-max/excluded-creators` (cut a creator out of
   delivery). That is money-moving capability sitting in a file. If Reacher
   offer a read-only key, take it.
2. **The trial ends 15 September 2026** — $599/month, Stripe attached, charges
   automatically. Nothing in this product uses Reacher.

His API key is outside the repo in `cli-secrets.env` as `REACHER_API`. It has
never been in a chat message or a file in this repo.


## Cruva for Pure Daily Care, Aqua Sonic and JOYMODE (parked 2026-09-24)

Rashid asked for the Reacher treatment for the three brands on Cruva. The brands
all exist; the key is valid; the data endpoints are not reachable with it.

**Trigger to bring this back:** Rashid supplies the three Cruva **Shop IDs** and
either a key that reaches the data endpoints or the endpoint names from Cruva
support. Everything already ruled out is in OPERATIONS under "Cruva, what is
already known" — start there rather than re-probing.

When it does come back, product pictures are already solved for it: the market
lookup in `_shared/product-images.ts` takes a TikTok product id and no brand id,
so Cruva products will get photographs the day their catalogue is readable.

## TikTok `user.info.profile` scope (parked 2026-09-29)

**Status:** WAITING ON RASHID
**Owner:** Rashid to apply, Claude to ship

The declared @handle. Without it the handle is derived from a video's share URL,
which works for 99.56% of real URLs but yields nothing for a creator with no
videos — at exactly the moment we promised to fill the box in.

**Trigger:** Rashid applies on the TikTok app and it appears on the app's own
**Scopes page** (not the submission dialog — reading the dialog instead cost two
hours on 2026-08-26). Then, in ONE commit: `DISPLAY_SCOPES`, the hardcoded copy
in the check, the consent list on the creator card, and `/privacy`.

**Never widen our list first.** More in our array than on the app and TikTok
refuses the authorise URL outright — Connect breaks for every creator on deploy.

## A second TikTok redirect URI (parked 2026-09-29)

**Status:** NICE TO HAVE

Signup and the Settings connect both return to `/oauth/tiktok-creator/callback`
today; the browser marks which flow it started so the page can tell them apart.
Safe, and it can only ever end in "start again", never a wrong identity. A
dedicated `/signup/tiktok/callback` would be cleaner. **Trigger:** whenever a
second redirect URI is added to the TikTok app.

## Email confirmation is now the weakest link (parked 2026-09-29)

**Status:** RASHID SAID "leave it for now, we will come to verification later"

TikTok-first signup makes identity lopsided: the TikTok half is strongly proven
and the email half is not proven at all. Nobody checks that a creator's email is
real, and it is the address used to pay and contact them.

**Trigger:** when Rashid raises verification. Needs SMTP proven FIRST, then
confirmation switched on LAST — turning it on breaks both signup paths unless
the flow survives it, which it is built to.


## 45. Retire the old Supabase project `wurxmediahub-dev` (the checks, then Rashid deletes it)

**Status:** PAUSED, on purpose. Rashid pauses the old project on 2026-10-27 and chose to come back to this **two weeks later, on or after 2026-11-10**.

**Raise it when:** that date arrives, in the first session on or after it. Say it yourself, do not wait to be asked: "It is two weeks since the move, shall
I run the checks before you delete the old project?" Do not delete anything. **Rashid deletes the project himself; the project rules say never to delete a project without asking.**

**The old project** is `npznoiotslruqovorrec` (org WurxMedia, us-east-1). The Hub now runs on CreatorHub (`qinxwfdwvpkzfhcijuqw`). See OPERATIONS, "The Hub moved to CreatorHub".

**The checks, ALL of which must be true before he deletes it:**
1. **Two weeks of normal running on CreatorHub** with nothing missing: the cron jobs (`reacher-cycle`, `euka-ads-cycle`) succeeding, the team using the Hub, the Prism site working. Look at
   `cron.job_run_details`, `reacher_sync_runs`, and the Euka function's answer in `net._http_response`.
2. **The secrets that exist ONLY in the old project.** Supabase never returns a function secret's value, so these are in no file here: **`AUDIT_API_URL` and `AUDIT_API_KEY`**
   (Rashid did not have them to hand), the four **`TIKTOK_CREATOR_*`** values (creator sign-in with TikTok; the three ads-app values were saved in `.env.local` and set on 2026-10-28), and the old project's own Euka main key. Ask whether he now has
   the Audit values. If not, THEY ARE LOST FOR GOOD the moment the project is deleted, so say that plainly. A paused project still holds them.
3. **A second copy of the backups off this laptop.** `D:\Milestone\backups\hub-dev-*` is the only other copy of the data. It holds password hashes and private files: a USB stick, not a shared drive.
4. **Free paused projects may expire.** My understanding (unverified) is that a free project paused for about 90 days can no longer be restored. Check Supabase's current rule and, if it applies,
   take any final copy before that date. A pause is not a permanent shelf.
5. **Euka keys.** The all-brands key is NEW. Nutra's key is the SAME key the old project had, and it is in use on CreatorHub now. When revoking old Euka keys, revoke only the **old main key**
   (the old project's `EUKA_API_KEY`), NEVER Nutra's.
6. Re-run `catalog-diff` / `verify` style checks only if something looks off; the old project is read-only reference now.

**Related, same trigger:** the legacy Supabase keys (all 20 Edge Functions and 92 scripts still use them) and the 70 characters of CreatorHub's legacy JWT secret that a script printed on 2026-10-27:
move to the `sb_secret` / `sb_publishable` keys, then disable the legacy keys and revoke the legacy signing key. Also: the Prism repo is behind the Hub repo (lacks 398a372 and the later commits).
