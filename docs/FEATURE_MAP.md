# Feature map

**Why this file exists.** Bugs happen when a new feature silently depends on an
old one. Delete a creator, and their campaigns must vanish from the campaigns
screen too. Add a user, and the team view must show them. This file is the
written record of those links so nothing drifts.

**Rules**

- Before touching any schema or shared logic: read the entries below for
  everything involved, and list the affected features in the step plan.
- After adding any feature: add its entry AND update every entry it touches, in
  the same commit as the code.
- A feature without an entry here is not done.

Structure carries the load first, foreign keys with a consciously chosen
`ON DELETE`, constraints, and shared SQL views so every screen reads the same
truth. This map is the second layer, not the only one.

---

## How much of a job has been filmed (job_progress)

**Files:** `src/lib/work/job-progress.ts`, `src/components/work/JobProgress.tsx`,
`src/components/creator/OfferCard.tsx`, `src/components/content/ContentCard.tsx`,
`.oxlintrc.json`,
`supabase/migrations/*_deliverables_freeze_and_job_progress.sql`,
`scripts/seed-pipeline.mjs`
**Tables:** `offer_applications.committed_video_count` (new),
**View:** `job_progress` (the project's FIRST view)

Built 2026-08-11, the first step of joining the product up (see
`UI_CONNECTIONS_PLAN.md`). Rashid: "he has offers page where he should be seen
how much content he has posted maybe a progress bar".

**Change rules**

- **The deliverable count freezes at approval**, exactly as `committed_amount`
  already did. Rashid's words: once we have approved, an admin should never be
  able to edit the number of deliverables. Nothing may read `offers.video_count`
  for a job already under way; read `committed_video_count` on the request.
  Editing the offer stays allowed and applies to whoever is approved next.
  What does NOT freeze is the brand's budget, which carries on moving on every
  approval exactly as before.
- **`security_invoker = true` on the view is not optional.** A Postgres view
  runs as its OWNER by default, which would bypass row security on both tables
  underneath and hand every creator every other creator's counts.
- **Job level counts only, forever.** This is safe to share between both sides
  because a job belongs to exactly ONE creator, so the count is complete rather
  than silently narrowed. That property does not hold one level up: a creator
  counting the people on an offer gets back 1, their own row, WITH NO ERROR.
  Never build an offer level or brand level count this way.
- **Progress follows the JOB, never the `needs_application` flag.** An offer
  with no job behind it shows no progress. This is the same rule `stateFor` in
  `useAllOffers.ts` already documents from the other side, and breaking it is
  how an admin flipping that flag once hid somebody's live work.
- Only APPROVED submissions count, matching the database's own rule.
- **The finished job lands on `payment_pending`, since 2026-08-19.** It used
  to land on `content_completed`, which is in the `working` money bucket, so a
  creator who had filmed everything and had every video approved still read
  "Your content is in and being checked" and still saw their fee counted as In
  progress. Nothing moved it but a human on a dropdown, and no admin tile
  counted jobs sitting there, so a finished job had no queue at all. Rashid's
  words: "automatically their stauts should be go to payment pending". That
  stage is a claim about US, not about them; `paid` is still a person's
  decision. `content_completed` stays in the enum and stays selectable by
  hand, and neither function snaps it forward, because it is not "before
  content done". `20260819193000_finished_jobs_catch_up.sql` walked the one job
  the old rule had already stranded, with a real stage event and a null actor.
- **`review_content` advances a job from ANY stage before content completed**,
  not the two it used to. Approving the last video while a job sat at "sample
  requested" used to strand it forever. `set_offer_stage` re-checks on arrival
  for the same reason, and `job_is_filmed()` is the single answer both use.
- **Taking an approval back walks the job out of content completed**, back to
  content pending, with a stage event the creator reads. It stops at
  content_completed and never drags a job back from payment or paid: those are
  decisions a person made.
- **`src/lib/work/` and `src/components/work/` are NEUTRAL.** Creator code may
  not import admin code and admin code may not import creator code, and that is
  now a build failure via `no-restricted-imports` in `.oxlintrc.json`, not a
  convention. It caught three real violations the day it was added, including
  the admin content screen importing `ContentCard` out of `routes/app/Content`.
  Anything both sides read goes in a neutral file.
- Shared components take everything staff-only as a PROP and contain no role
  check. A card that decides for itself whether the viewer is staff is one
  wrong boolean from being the leak.
- The creator subscription to `content_submissions` MUST pin
  `creator_id=eq.<uid>`. `postgres_changes` does not apply row security to
  DELETE events and the table has `replica identity full`, so the whole old row
  of somebody else's deleted submission would otherwise arrive.
- `node scripts/seed-pipeline.mjs` puts videos against dev's approved jobs in
  five states (`--clean` removes them). It approves through the REAL
  `review_content` rather than setting stages by hand, so it cannot drift from
  the rule and it exercises the finish path on every run.
- Any script that writes `offer_applications` directly (`check-content`,
  `check-live`, `shots-creator`) must set `committed_video_count` itself, the
  way `review_offer_application` would. A job with no agreed count can never be
  "all filmed", so forgetting it silently stops every job from finishing.
- `pnpm verify:content` must pass. It now proves the view is closed to a rival
  creator, that re-scoping an offer does not move an agreed job, and both
  stuck-job fixes.

**The admin side of the same join, 2026-08-11 (step 2)**

Files: `src/lib/work/stage-moves.ts`, `src/routes/admin/OfferRequests.tsx`,
`src/routes/admin/Content.tsx`, `src/routes/admin/AllOffers.tsx`,
`src/lib/admin/useAllOffers.ts` (`useOfferContent`).

- **The queue shows what was AGREED on an approved row, not the offer's price
  today.** It read `row.offer.reward_amount` while fetching `committed_amount`
  and ignoring it, so re-pricing an offer made the queue, the brand's budget and
  the creator's own dashboard give two answers about one promise. A PENDING row
  still shows the offer's live terms, because that is genuinely what the creator
  is asking for.
- **The catalogue asks about every offer on the page and decides on what comes
  back.** It used to skip any offer whose `needs_application` was off, so
  flipping that flag on an offer six people were mid-pipeline on erased all six
  from the screen. Rows back means report them whatever the flag says; no rows
  and the flag off means "Open to everyone". Same rule as `stateFor`.
- **"Approving this finishes the job" is a LABEL, never a confirmation step.**
  Reviewing at speed was a deliberate decision. The label copies the database
  rule exactly (a number must have been agreed, and this approval must reach
  it), or it promises something that does not happen.
- `review_content` has always returned `advanced`, and now `reopened`, and the
  screen threw both away. Finishing somebody's work looked identical to
  approving one of five. It says so now.
- **Every per-row number is one grouped read over the page**: `useJobProgressFor`,
  `useLatestStageMoves`, `useOfferPeople`, `useOfferContent`. Never one query
  per row. The content ids are deduplicated first, because several videos
  usually share one job.
- `useLatestStageMoves` deliberately does NOT select the actor. `actor_id` points
  at `profiles`, which a creator cannot read for anybody else, so an embed would
  return null rather than refusing and the panel would look broken the day
  somebody reuses it on a creator screen.
- These three screens are now on the current design language: sans eyebrows
  rather than mono, `rounded-[20px]` with `shadow-md`, `wx-skeleton` rather than
  `animate-pulse`, and the "waiting" and "to watch" chips use the stage colours
  rather than warning/success, which is the light-mode collision those tokens
  exist to end.

## Brand rollups, the roster and the creator directory

**Files:** `src/lib/admin/useBrandRollups.ts`, `src/lib/admin/useCreators.ts`,
`src/lib/admin/useOpsHome.ts`, `src/components/admin/BrandCreators.tsx`,
`src/routes/admin/Creators.tsx`, `src/routes/admin/CreatorDetail.tsx`,
`src/routes/admin/AdminDashboard.tsx`, `src/lib/tiers.ts`,
`supabase/migrations/*_brand_rollups.sql`,
`supabase/migrations/*_creator_directory.sql`
**Views:** `brand_stage_totals`, `brand_content_totals`, `brand_creator_roster`,
`creator_directory`

Steps 5 to 8 of `UI_CONNECTIONS_PLAN.md`, built 2026-08-11.

**Change rules**

- **All four are `security_invoker` AND carry `is_staff()` IN THE VIEW BODY.**
  That second guard is the difference between these and `job_progress`.
  `job_progress` is shared with creators and is safe because a job belongs to
  exactly ONE creator, so its count is complete. These group by BRAND or list
  every PERSON, where a creator would get a well formed object built from their
  own rows with no error at all. Silently narrowed is worse than refused.
- **`is_service_role()` is in that gate and must stay.** service_role carries no
  `user_role` claim, so `jwt_role()` coalesces to 'applicant' and `is_staff()`
  is FALSE for the service key. Drop it and every Edge Function and every line
  of `verify:rls` reads zero rows despite the grants, which looks like a policy
  working rather than a bug.
- **Not one of them references `brand_commercials`.** No client, no allocation,
  no spend. So a careless grant in a year cannot turn one into a way to read a
  budget. `verify:brands` asserts all four are closed to a signed-in creator and
  that none will answer a question about money.
- **Currency is a dimension, never a rounding detail.** `brand_stage_totals`
  groups by (brand, stage, CURRENCY) and every screen renders one block per
  currency. `brand_creator_roster` names a currency only when the creator has
  exactly one on that brand, and the card says so rather than adding two.
- **The views group by STAGE, not by paid/due/working.** `STAGE_META` stays the
  single source of that mapping; a bucket column in SQL would be a second copy.
- The roster uses a LATERAL for its video counts, not a left join. Postgres does
  not form equivalence classes across an outer join, so `where brand_id = $1`
  would not reach the nullable side and the whole content table would aggregate
  before the brand filter applied.
- **`creator_directory` exists because identity is split across two tables.**
  The account is `profiles`; the handle everybody types is
  `applications.tiktok_handle`. `applications.user_id` is NOT NULL UNIQUE, so
  the join cannot fan out and `count: 'exact'` stays honest.
- The brand hub's Offers tab is paged, so **Overview's counts had to move into
  the database in the same step**. Counting a paged array would have quietly
  turned "12 live of 40" into a description of the first twelve rows.
- The admin home will not say the day is clear until ALL THREE inboxes are
  empty, and it will not say anything until every count has come back. An empty
  cache and an empty queue look identical from a browser.
- `audit_log` reads must pass `subject_type` as well as `subject_id`. The index
  is `(subject_type, subject_id)` and a btree cannot serve a predicate that
  skips its leading column.
- `/admin/brands/:id`, `/admin/creators`, `/admin/creators/:id` and
  `/admin/applications/:id` are all in `check-responsive.mjs` now. Adding the
  last of those immediately found a real 375px overflow that had been there
  since the screen was built: a grid item's min-width is `auto`, so one
  unbreakable link made the page 529px wide in a 375px viewport. Any new
  two-column admin layout needs `min-w-0`.

## Content (video links and ad codes)

**Files:** `src/lib/content.ts`, `src/lib/creator/useMyContent.ts`,
`src/lib/admin/useAdminContent.ts`, `src/routes/app/Content.tsx`,
`src/routes/admin/Content.tsx`, `src/components/content/*`,
`src/components/creator/PostContentDialog.tsx`,
`supabase/functions/manage-content/`, `scripts/check-content.mjs`
**Tables:** `content_submissions`

"Content pending" was the one stage with nothing to do in it. A creator was
told to film and had nowhere to put the result.

**Change rules**

- **How much is left is now answered by the `job_progress` view**, not by
  `progressFor()` in the browser, which was deleted on 2026-08-11. See the entry
  above. It counts against the number frozen on the JOB at approval, never
  `offers.video_count`.
- **A link is a claim until somebody has watched it, AND THAT NOW GOVERNS THE
  MONEY TOO.** Until 2026-08-19 it governed only the deliverable count. The ad
  figures were gated on `ad_authorized`, which is a checkbox the creator ticks
  themselves and which this table's own comment admits "we cannot check from
  here". So a video's GMV appeared before anyone watched it, a video sent back
  for a retake kept its money on the creator's screen for ever, and â€” the sharp
  one â€” pasting another creator's TikTok URL for the same brand into an
  unreviewed submission made the nightly sync fetch THAT video's spend and hand
  it over. `status = 'approved'` is now on all five places at once: the row
  policy on `tiktok_video_daily`, the three `creator_*` read functions,
  `tiktok_days_to_backfill`, and the sync's own video query. Filtering fewer
  than all five leaves the hole open through some other query.
- **Taking an approval back has a button now.** The admin card had always told
  the reviewer "Sending it back would reopen it" beside no control that could;
  the database, the Edge Function and the `reopened` return value had all been
  there since 2026-08-11 and the success message for that path was unreachable
  code. Only the button was missing.
- **A link is a claim until somebody has watched it.** Only APPROVED
  submissions count towards an offer, and `review_content` is the ONLY thing
  that can carry a job to `content_completed`. It does that in the same
  transaction as the approval, so a job can never be short a video and marked
  done. Rashid's call, and the reason uploading does not advance anything.
- Content attaches to the **offer_application**, not the offer. "Five videos
  for $300" is a promise to one creator, so "how many are left" is only
  answerable against that request.
- No insert, update or delete policy on `content_submissions`.
  `manage-content` is the only door and it checks the role PER ACTION, like
  `manage-offer-application`. `submit_content` matches on `creator_id` as well
  as the id so nobody can post onto somebody else's job.
- **We store a LINK, never a file.** The thumbnail comes from TikTok's oEmbed,
  fetched SERVER side. Never from the browser: that endpoint omits its CORS
  headers on error responses, so a deleted post logs a CORS violation, and this
  product does not ship console errors.
- **The thumbnail URL expires.** It is signed with about two days on it, so
  `VideoThumb` asks `content.refresh` (same origin) once when the image breaks
  or was never stored. Playback does NOT depend on any of that:
  `videoIdFrom` falls back to reading the id out of the link.
- oEmbed is unauthenticated and rate limited, so a thumbnail is best effort and
  every card is designed to look right without one. Do not make anything
  depend on it.
- Editing is locked once a video is approved, or the thing we checked and the
  thing on the record could be different videos.
- `pnpm verify:content`: 26 checks, nine of them attacks run as real
  signed-in accounts, including a rival creator and a creator trying to approve
  their own work.

## Design tokens & theming

**Files:** `src/styles/tokens.css`, `src/styles/global.css`,
`scripts/check-contrast.mjs`, `src/components/theme/*`
**Tables:** none yet. Brand Hub theming (Step 6) will add `brands.theme` and
override `--wx-*` at the hub level.

**Depended on by:** every visual surface in the product.

**Change rules**

- Every colour in the app is a `var(--wx-*)` token. No hardcoded hex in
  components, that is what breaks light mode.
- A token added to `[data-theme='dark']` MUST also be added to
  `[data-theme='light']` and vice versa. `pnpm build` fails otherwise.
- Adding a new text/background combination means adding it to the `PAIRS` list
  in `scripts/check-contrast.mjs` so it is contrast-checked in both themes.
- **`--wx-stage-live`, `--wx-stage-due` and `--wx-stage-paid` are the only
  colours allowed to say where money has got to**, and each of the seven
  pipeline stages maps to exactly one of them through `STAGE_META.bucket`.
  Nothing else may use them and the pipeline may not use anything else. They
  exist because accent/warning/success collide in light mode; see DECISIONS.
- **Type is scoped, not global.** `@font-face` for Instrument Sans and Sora
  lives in `global.css` and costs nothing on its own; `.wx-app`, on the
  `AppShell` root, is what actually points `--wx-font-sans` and
  `--wx-font-display` at them. Declaring a face does not download it, so the
  public landing page still ships system fonts and its measured payload is
  unchanged. Moving those two overrides into `tokens.css` would silently put
  two font downloads on the landing page.
- The font files are OURS, in `public/fonts`, not a Google Fonts link. Both are
  variable (`font-weight: 400 700`), so there is one file per subset rather than
  one per weight, and `unicode-range` keeps latin-ext off most sessions.
- The anti-flash script in `index.html` duplicates the theme-resolution logic in
  `ThemeProvider.tsx`. Change one, change the other, same storage key
  (`wurxmediahub-theme`), same fallback.

## Routing & shell

**Files:** `src/app/router.tsx`, `src/app/providers.tsx`, `src/main.tsx`,
`src/components/layout/RouteFallback.tsx`

**Depended on by:** every screen.

**Change rules**

- Every route is lazy (`lazy: async () => ...`) so screens ship as separate
  chunks. A new route without lazy loading is a regression.
- Every route gets `HydrateFallback: RouteFallback`, skeleton, never a spinner.
- `Providers` mounts once per tab. Nothing inside it may take a `key` derived
  from the session, user id, or access token. See CLAUDE.md "Auth rules".

## Supabase client & environment

**Files:** `src/lib/supabase.ts`, `src/lib/env.ts`, `.env.example`
**Tables:** none yet.

**Depended on by:** everything that reads or writes data (from Step 1 onward).

**Change rules**

- There is exactly one Supabase client, created lazily by `getSupabase()`.
  Never call `createClient` anywhere else, two clients race on the refresh
  token and log users out at random.
- Any new browser env var must be added to the Zod schema in `env.ts`, to
  `.env.example`, AND to both Vercel projects. Missing one of the three is the
  usual cause of "works locally, blank on dev".
- Only `VITE_`-prefixed public values belong in `env.ts`. Secrets go to Edge
  Function secrets.

## Landing page (public)

**Files:** `src/routes/Landing.tsx`, `src/components/landing/*`,
`src/components/layout/Section.tsx`, `src/components/ui/Button.tsx`,
`src/content/site.ts`, `src/routes/Apply.tsx`
**Tables:** none. Stats are hardcoded marketing copy, not database reads.

**Depends on:** Design tokens, Routing, Brand mark
**Depended on by:** Applications (Step 3), every CTA points at `/apply`

**Change rules**

- All marketing copy, stats, brand names and the three steps live in
  `src/content/site.ts`. Never hardcode that text in a component.
- Partner logos are real, taken from the marquee on wurxmedia.com and stored in
  `src/assets/brands/`. Never invent a brand name or add a partner Rashid has
  not confirmed.
- Those logos are white artwork on OPAQUE BLACK. They are made theme-safe by
  `.wx-logo` (`--wx-logo-blend` / `--wx-logo-filter`), not by editing the
  images. A new logo must follow the same convention, or it will appear as a
  black rectangle in light mode.
- `.wx-marquee` paints its own background because `mask-image` creates a
  stacking context. That background MUST match the section behind it, or the
  blend breaks.
- `/apply` renders the same `<ApplyForm />` as the hero. Step 3 fills in the
  submit handler; the route must keep working so no CTA breaks.
- Adding a section: wrap it in `<Section>` for rhythm, use `<Reveal>` for the
  scroll-in, and give it a `scroll-mt` if it is an anchor target, the header is
  fixed and will otherwise cover the heading.
- Anchor links (`#how`) must not use react-router `<Link>`; `ButtonLink`
  detects a leading `#` and renders a plain `<a>`. A `<Link to="#how">` is
  treated as a route change and never scrolls.

## Applications (data)

**Files:** `supabase/migrations/*_applications.sql`,
`src/lib/auth/useApplication.ts`, `src/routes/app/Dashboard.tsx`
**Tables:** `applications` (user_id -> profiles.id, ON DELETE CASCADE, UNIQUE)

**Depends on:** Auth and profiles
**Depended on by:** Admin review (Step 4), Creator activation, Home (Step 5)

**Change rules**

- One application per account, enforced by a unique index on `user_id`. Code
  that inserts must handle error code `23505` as "they already applied".
- `status`, `reviewed_by`, `reviewed_at` and `review_note` are staff only,
  enforced by column grants AND the `applications_guard_review_columns`
  trigger. `pnpm verify:apply` proves an applicant cannot approve themselves.
- An applicant may edit their own application only while it is `pending`.
- `tiktok_handle` is stored WITHOUT the leading `@`. Step 7's identity mapping
  depends on that.
- The table is in the realtime publication with `replica identity full`. Any
  new column is therefore visible to realtime subscribers who can read the row.
  Do not put staff-private notes anywhere an applicant can read.
- Deleting an auth user cascades: profile, then application.

## Application form

**Files:** `src/components/landing/ApplyForm.tsx`,
`src/lib/schemas/application-fields.ts`, `src/lib/schemas/application.ts`,
`src/components/ui/Field.tsx`, `src/routes/Apply.tsx`
**Tables:** none yet. Step 3 adds `applications` (status defaults to `pending`).

**Depends on:** Design tokens, Button/Field primitives
**Depended on by:** Admin review (Step 4), Creator profiles (Step 1/4)

**Change rules**

- **The form is not connected to anything.** `onSubmit` fakes a delay and shows
  a success panel that states submissions are not stored. That disclosure stays
  until Step 3 is live.
- The schema is split in two ON PURPOSE. `application-fields.ts` holds the
  option lists and types and is Zod-free, so the form can render without
  pulling Zod (~60 KB gzipped) onto the landing page. `application.ts` holds the
  Zod schema and is imported lazily, on first submit. Do not import
  `application.ts` at the top of a component.
- Adding a field means updating: `application-fields.ts`, the Zod schema, the
  form JSX, the `applications` table migration, the Edge Function, and the admin
  review screen (Step 4). All six, or the field silently goes nowhere.
- Step 3 must import this exact schema inside the Edge Function and re-validate.
  Never trust the client's copy.
- `ApplyForm` is rendered in two places (hero + `/apply`). It must stay
  self-contained, no props that only one placement passes.
- `tiktokHandle` is stored WITHOUT the leading `@` (the schema strips it). Any
  identity mapping in Step 7 must assume that.

## Auth, profiles, roles and tiers

**Files:** `src/lib/auth/*`, `src/components/auth/*`, `src/routes/auth/*`,
`src/app/router.tsx`, `src/app/providers.tsx`,
`supabase/migrations/*_auth_profiles_roles_tiers.sql`
**Tables:** `profiles` (id -> auth.users.id, ON DELETE CASCADE)
**Enums:** `app_role`, `creator_tier`

**Depends on:** Supabase client
**Depended on by:** everything behind a login, from Step 3 onward

**Change rules**

- **Role and tier live only in `profiles`.** Nothing else may store them. The
  JWT copy is a cache for choosing screens, never a permission.
- A user cannot change their own role, tier or active status. That is enforced
  by three separate things and all three must survive any refactor: no INSERT
  grant, a column-level UPDATE grant on `display_name` only, and the
  `profiles_guard_privileged_columns` trigger. `pnpm verify:rls` proves it.
- Adding a column users may edit means adding it to the column grant AND
  deciding whether the guard trigger should protect it.
- `AuthProvider` must never navigate, reload, or be given a `key` tied to the
  session. Redirects belong in `RequireAuth`. This is the whole defence against
  the random-logout problem, and `pnpm verify:session` will catch a regression.
- `@/lib/supabase` is imported **dynamically** in `AuthProvider`, so the public
  landing page does not download the database client. A static import there
  quietly adds ~55 KB gzipped to every visitor. Vite's `manualChunks` also keeps
  Supabase and TanStack Query in separate chunks for the same reason.
- Deleting an auth user cascades to `profiles`. Any future table that hangs off
  a creator needs its own consciously chosen ON DELETE behaviour.
- Role gates in `router.tsx` decide which screen shows. They are not security.
  Every new table still needs its own policies.

## Brand mark

**Files:** `src/components/brand/WurxMark.tsx`, `src/assets/wurx-logo.png`,
`public/favicon.svg`

**Change rules**

- The real Wurx Media logo, taken from wurxmedia.com and downscaled from
  1641x460 (125 KB) to 228x64 (11 KB). Every usage goes through `<WurxMark />`.
- The artwork is cream and drawn for a dark background. Light mode darkens it
  with `--wx-mark-filter`, which uses `brightness()` so the mascot keeps its
  internal contrast. A plain `invert()` would flatten it to a blob.
- `public/favicon.svg` is still the older geometric gold "W" and does NOT match
  the logo. Replace it when a square icon crop is available.

## App shell & sidebar navigation

**Files:** `src/components/layout/AppShell.tsx`,
`src/components/layout/AppSidebar.tsx`, `src/lib/nav.ts`

**Depended on by:** every signed-in screen, for both creators and staff.

**Change rules**

- The navigation lives in `src/lib/nav.ts` and nowhere else. Shipping a screen
  means moving one item from `soon` to `to`, in that file.
- Items without a `to` render as plain text, never as links. A nav item that
  lands somebody on an empty page is worse than one that says "Step 6".
- The shell mounts once and is never keyed on the session. A token refresh must
  not remount it or a half-typed form is lost. `pnpm verify:session` covers it.
- Role and tier in the sidebar come from the profile row, falling back to the
  JWT claim. Claims are up to an hour stale, so a freshly approved creator would
  otherwise still be badged "Applicant".
- The desktop rail and the mobile drawer are the same component. Do not fork it.

## Staff sign in

**Files:** `src/routes/auth/StaffSignIn.tsx`, `src/components/auth/RequireAuth.tsx`,
`src/app/router.tsx`

**Change rules**

- `/admin/login` is the staff screen; `/login` is the creator one. Both call the
  same sign in. This is a different DOOR, not a different LOCK, and must never
  be described or relied on as a security control.
- No sign up link may ever appear on the staff screen. Staff accounts come from
  `scripts/create-admin.mjs` and nowhere else.
- `RequireAuth` picks the door from the path being attempted, so signing out of
  the admin panel returns you to the staff screen. Adding a new staff area means
  extending that check.
- A creator who signs in at the staff door is sent to their own dashboard. Do
  not turn that into an error: it strands people who followed a stale bookmark.

## Sign up timing (the one that keeps biting)

**Files:** `src/routes/Landing.tsx`, `src/app/router.tsx`,
`src/components/landing/ApplyForm.tsx`, `src/lib/auth/useApplication.ts`

Applying creates the account and then writes the application, as two writes.
Between those two moments the user IS signed in but has NO application, and
anything that reacts to "signed in" during that window will race the insert.

**Change rules**

- Never put a screen that can create an account behind a guard that redirects on
  sign-in. `/signup` and `/apply` are outside `RedirectIfSignedIn` for exactly
  this reason.
- `/` only redirects people who were already signed in when the page opened, not
  whoever becomes signed in while on it.
- `ApplyForm` clears the cached application query before navigating.
- `useApplication` re-checks while the answer is `null`.
- All four exist to stop one symptom: a new applicant being told "Finish your
  application" when they just did. If you touch any of them, run
  `pnpm verify:session` several times, not once. It failed roughly 3 runs in 8.

## Brand Hub (brands, products and offers)

**Files:** `src/routes/admin/Brands.tsx`, `src/routes/admin/BrandHub.tsx`,
`src/components/admin/BrandDialog.tsx`, `src/components/admin/OfferDialog.tsx`,
`src/components/admin/BrandAbout.tsx`, `src/components/admin/ProductDialog.tsx`,
`src/components/admin/ImageUploadField.tsx`, `src/lib/admin/useBrands.ts`,
`src/lib/admin/useManageBrand.ts`, `src/lib/admin/useImageUpload.ts`,
`src/lib/schemas/brand.ts`, `supabase/functions/manage-brand/`,
`supabase/migrations/*_brands_and_offers.sql`,
`supabase/migrations/*_brand_about_products_and_creator_access.sql`,
`supabase/migrations/*_brand_assets_storage.sql`, `scripts/check-brands.mjs`,
`scripts/seed-brands.mjs`
**Tables:** `brands`, `brand_commercials`, `brand_products`, `offers`
**Storage:** `brand-assets` bucket

**The domain, so nobody has to guess.** A BRAND is a seller's store on TikTok
Shop. A BRAND HUB is everything that hangs off that brand. A PRODUCT is
something the brand sells, carrying the commission we offer creators on it. An
OFFER is what the brand pays a creator for content ("five videos, $300"), and
always belongs to exactly one brand.

**Depended on by:** the creator Brand Hub (see the next entry), campaigns,
contests, promotions, discounts, creator enrolments and creator-proposed custom
offers.

**Change rules**

- **The client name, the allocated budget and what has been committed of it are
  NOT on `brands`.** They live in `brand_commercials`, one row per brand, staff
  only.
- **`budget_used` is what has been PROMISED, not paid.** It is the sum of every
  approved offer request on that brand, maintained by
  `review_offer_application` in the same transaction as the approval, so the
  request and the total can never disagree. `budget_used_percent` is a stored
  generated column so the brand list can filter on "over 80% used" in the
  database rather than fetching every brand and doing arithmetic in a browser.
  It is null when there is no allocation: a brand with no budget has not used
  0% of anything.
- **Approving is never blocked for going over budget.** Whether to overspend is
  a commercial decision, so the approve dialog says what it will cost and what
  will be left, colours the bar red past 100%, and leaves the choice to a human.
- **Deleting approved requests with the service key leaves `budget_used`
  stale**, because the running total is only ever moved by
  `review_offer_application`. Nothing a browser can reach does that, so it
  cannot happen in normal use, but a cleanup script did it on 2026-08-01 and
  left three brands claiming money nobody had promised.
  `node scripts/reconcile-budgets.mjs` puts it right, and `--dry-run` reports
  without writing. Run it after any hand cleanup that touches requests. That split is what
  makes it safe to show a brand to a creator: the budget is not a column they
  are filtered away from, it is a column that does not exist on anything they
  can read. Column level SELECT grants cannot do this job, because staff and
  creators are both `authenticated`.
  **Never move a commercial column back onto `brands`, and never add a creator
  policy to `brand_commercials`.**
- `useBrands.ts` flattens the two halves back together for admin screens, so a
  brand still reads as one object. `src/lib/creator/useCreatorBrands.ts` is a
  separate file for exactly this reason and must never import from the admin one.
- No insert, update or delete policy exists on any of these tables. Every write
  goes through `manage-brand`, which re-reads the caller's role from `profiles`,
  then calls `save_brand`, `save_brand_about`, `save_offer`, `delete_offer`,
  `save_product` or `delete_product`. Those are granted to `service_role` alone.
  Adding a write policy would open a second door.
- Each write function starts with `assert_active_staff()`, so "who may change a
  brand" is answered in exactly one place. New write functions must use it too.
- The row and its audit entry commit together, in one transaction. The delete
  functions write the audit row BEFORE the delete, so the record of what was
  removed survives the removal.
- **The slug is generated once, on creation, and never regenerated on rename.**
  Creators hold brand hub links, and the creator route is keyed on the slug.
- **Money is `numeric`, never a float. PostgREST hands it back as a JSON
  NUMBER, while the Edge Function can return the same value as a string.** Take
  either (`money()` in `useBrands.ts`), and coerce with `String()` before it
  reaches a text input. A number where a string was assumed is what crashed the
  offer dialog on 2026-07-30.
- `offers.brand_id` and `brand_products.brand_id` are not updatable. Moving one
  between brands would silently change who is paying for it.
- A product's `external_product_id` is unique per brand. Two rows for one TikTok
  Shop product would split a creator's numbers in half.
- Product `price` and `commission_rate` are both optional, like an offer's
  terms. A product gets added before its numbers are confirmed, and the cards
  say "not set" rather than printing a zero somebody reads as real.
- `needs_application` defaults to true. An offer that pays out without anybody
  signing it off has to be chosen on purpose.
- Images go straight to the `brand-assets` bucket from the browser, not through
  the Edge Function. Public read, staff-only write, 2 MB, PNG/JPG/WebP.
  **SVG is excluded on purpose:** it can carry script. Uploads are named with a
  random uuid, never the file the admin picked.
- `pnpm verify:brands` must pass after any change here. It attacks every table
  and the Edge Function as a signed-in creator, and then opens the hub that
  creator is meant to see.

## Brand Hub, creator side

**Files:** `src/routes/app/Brands.tsx`, `src/routes/app/BrandHub.tsx`,
`src/lib/creator/useCreatorBrands.ts`,
`src/components/creator/LockedUntilApproved.tsx`
**Reads:** `brands`, `brand_products`, `offers`. Nothing else.

**Depends on:** the admin side above for everything it shows.

**Change rules**

- **Who may browse is decided by `is_approved_creator()`, which reads the
  `profiles` table, NOT `is_staff()`, which reads the JWT.** A token refreshes
  about once an hour, so gating on the claim would mean somebody watches their
  approval land, clicks through, and finds an empty hub until their session
  catches up. Any future creator-facing policy must use the same function.
- Row level security decides which ROWS arrive: retired brands, inactive offers
  and hidden products never reach the browser. There is deliberately no
  `status` filter in the client queries, because adding one would disguise
  which layer is doing the work.
- These screens sit under the same guard as `/app`, so applicants can reach
  them, and are shown `LockedUntilApproved` instead. Guarding on
  `allow={['creator']}` would read the stale JWT and bounce a freshly approved
  creator. The screens read the profile row, which is current.
- The creator hub opens on **Overview**, the opposite of the admin hub. An
  admin arrives at a brand to do a job; a creator arrives to decide whether they
  want the brand at all, and decides on the brand and its products.
- **The hub header is one compact row**, not a card. It was a tall panel with
  the brand name set large, which repeated what the Overview tab says better and
  pushed the actual content off the first screen. All it has to do is say which
  hub you are standing in. `check-offer-requests.mjs` asserts the tabs start
  above 220px, so it cannot grow back by accident.
- **There is now ONE offer card**, `src/components/creator/OfferCard.tsx`, used
  by this screen and by `/app/offers`. It was written out twice and had already
  drifted: only one showed the per video rate, and only one carried a sentence
  about posting that was not true. Never fork it again.
- The offer card carries no status chip. The action at the bottom of it says
  what state the offer is in, and saying it twice made the second one look like
  a different fact.
- **The open offer note no longer says "start posting whenever you are ready".**
  Content attaches to a job, an open offer has no job behind it, and there was
  nowhere for that creator to post. Rashid's rule of 2026-08-11 is that an offer
  nobody applies for is never counted towards an offer, so the card says it is
  open to every approved creator and stops.
- The card never says "no fixed deliverable or fee on this one". Spending a line
  on the absence of something a creator never asked about is worse than silence.
- **Brands, products and offers ARE live here, as of 2026-08-11.** They were
  not, and the argument for that (a websocket per creator per hub buys nothing)
  was wrong in one specific way: an admin renaming an offer, re-pricing it,
  retiring a brand or adding a product left every creator reading that screen
  on the old version until they happened to refetch. `useCatalogueLive` is ONE
  channel covering all three tables; call it once per screen with a unique key,
  because two channels sharing a name means the second subscribe is silently
  ignored.
- `brand_products` had to be added to the realtime publication for that; brands
  and offers were already members and simply had nobody listening.
- `/admin/offers` is the catalogue and `/admin/offers/requests` is the queue.
  They are separate screens because they are separate jobs, done at different
  times. The sidebar has an **Offers** group holding both.
- **An open offer cannot report how many creators are on it.** It belongs to
  every approved creator and there is no row to count, so the admin list says
  "Open to everyone" rather than showing a zero that reads as nobody wanting it.
  Any future count over offers has to keep that distinction.
- Admin counts come from ONE grouped read over the offers on the page
  (`useOfferPeople`), never one query per row.
- **The creator dashboard filters in the browser, and that is a deliberate
  exception** to the project's server-side-filtering rule. The filters that
  matter (in, waiting, not asked) live in `offer_applications`, not `offers`,
  so paging the offers table would page a list whose useful order is in another
  table. It fetches both once, capped at 200 offers. If a creator ever has more,
  that cap is the thing to notice, and the fix is a view.
- The creator's requests are live here too, so an approval lands on this screen
  as well as inside the hub.
- Applying uses the SAME `ApplyDialog` as the brand hub. Two apply paths that
  drift apart is how one of them ends up sending something different.

## The menu, halved (2026-08-21)

**Files:** `src/lib/nav.ts`, `src/components/layout/AppSidebar.tsx`,
`src/components/brand/WurxMark.tsx`

**The collapsed rail cut the mascot in half, and had since it was built.**
`WurxMark markOnly` drew a `height Ã— height` box with `object-fit: cover`, on
the assumption that the mascot sits in a square at the left of the artwork. It
does not: measured off the file itself, it occupies x 5..78 and y 5..54 of a
228Ã—64 image, so it is 73 wide by 50 tall and a square window threw away the
rightmost 15% of its head. It is cut out by hand now â€” the artwork as a
background, scaled so the mascot fills the box exactly â€” and `MARK` in that file
carries the measured numbers. **Re-measure them if the logo is ever replaced;
nothing can tell that they have stopped matching.** `SHOT_COLLAPSED=1` on
`shots-admin.mjs` exists because the rail is otherwise only reachable by
clicking, which is why nobody had looked at it.

Rashid: *"the menu bar is very borign too much gap between and too many sections
modify it"*. Eight headings above twelve links, five of them over a single item.

**TWO RULES, and they are the whole change:**

1. **No heading over fewer than two items.** A heading over one link is not
   navigation, it is the same word twice with a gap around it.
2. **The first group has no heading at all.** Dashboard is where you land; it
   does not need to be told it is an overview.

Admin went from Overview / Review / Offers / Contests / Content / People /
Brands / Data to **Waiting on you / Running / People / Data**, grouped by the
QUESTION rather than by the table underneath â€” which is why Content moved in
beside Applications and Requests (all three are "who is waiting on me", and all
three are card grids now) and why Activity moved out of Review, which it never
was: it is the audit log, read when something needs explaining rather than
decided on. Creator and Studio lost their single-item Overview and Account
headings the same way.

**Rows are 44px on a phone and 34px above it.** The floor is the minimum tap
target and it does not move where a finger is doing the pointing; it is simply
not owed to a cursor. `40rem` is the breakpoint `wx-tap-row` already uses for
this trade in the filter bars, so the two cannot drift.

**`first:mt-0` ON A GROUP HEADING NEVER FIRES, and this cost a round trip.**
`first:` is `:first-child` **of its own parent**, and the heading is always the
first child of its group, so `mt-4 first:mt-0` resolved to `mt-0` every time
and the gap it was written to create never existed. The margin belongs on the
group `<div>`, where `first:` means the first group. Worth remembering for any
"space between sections, none before the first" pattern.

**`sectionTitleFor` is unaffected**, because it reads ITEM labels, not group
labels. `/admin/offers/requests` still resolves to Requests by longest prefix
even though Requests no longer sits under an Offers heading.
`pnpm verify:chrome` 43 of 43 covers exactly that.

## The contest card a creator sees (2026-08-22)

**Files:** `src/routes/app/Contests.tsx`, `src/lib/creator/useCreatorContests.ts`

Rashid: *"contest is not a normal thing dude it must represent a brand with
images emojis taglines"*. It was a bordered box with a heading and some labelled
rows â€” the same card an offer got, holding a different noun.

**Four bands:** the HERO (brand pill, state, name, description, countdown), what
you can EARN, the three FACTS, and WHY JOIN with its picture. The action sits
under all of it, untouched, because where a creator stands is decided by their
own entry and not by how the card looks.

**One card per row at every width.** Two of these side by side halves the hero
and squeezes the countdown.

**THE CROP IS THE WHOLE PROBLEM, and it is different on every screen.** `cover`
keeps the larger dimension and trims the other, so:

| Width | Box vs photo | What gets trimmed |
| --- | --- | --- |
| laptop | box is WIDER than 16:9 | top and bottom â€” the dark left column survives |
| phone | box is TALLER than 16:9 | **the sides**, centred |

The phone case shipped broken for one build: the middle of a product shot is the
product, so white hero text landed on a white tube and all but vanished. Fixed
by pulling the crop left below `sm` (`[object-position:22%_58%]`) AND by
switching the scrim from a left-to-right gradient to a bottom-up wash across the
whole frame â€” on a narrow screen there is no "left column" to protect, the text
spans everything.

**The scrim must not do the text's job.** The first version was 90% black over
the left plus a vertical wash. It read fine on the light theme and buried the
photograph completely on the dark one â€” a hero with no visible hero. The words
carry a `text-shadow` instead, which is readable over anything and costs the
image nothing; the scrim is now insurance for a blown-out white upload rather
than the mechanism.

**It has to be right with NO artwork**, and that is not a nicety: every contest
had a null `banner_url` until an admin uploaded one, because the column existed
for nine days with no control to fill it. No banner falls back to a gold-on-dark
gradient from tokens, no side image drops the picture and keeps the ticks, and
nothing moves.

**`perks` is split on newlines and capped at four IN THE COMPONENT**, not in
the column. A long list is trimmed on screen rather than refused at save time.

**The seconds box is deliberately absent from the countdown.** `useNow`
recomputes every 30 seconds, and a seconds figure that moves twice a minute
reads as a broken clock. Days, hours, minutes only.

## The contest editor, in five tabs (2026-08-22)

**Files:** `src/routes/admin/ContestSetup.tsx`,
`supabase/migrations/20260821200959_contest_artwork_and_perks.sql`,
`supabase/functions/manage-contest/index.ts`, `src/lib/admin/useContests.ts`,
`scripts/check-contests.mjs`

Rashid, with a design: *"admin has to sroll on one page to see who accepted
what's going on each and everything this is very bad"*. He was right. That
screen was the form, the rewards, the entry queue, the progress queue, the
products and the exclusions, all stacked, on one scroll.

**Five tabs, in the URL**: Details Â· Rewards Â· Visibility Â· Settings Â· Summary.
In the URL so "look at the rewards on this one" is a link, and so the back
button behaves. A NEW contest is locked to Details, because everything on the
other four hangs off an id that does not exist yet.

**Summary is "what is actually going on"** â€” the entry queue and the progress
queue, which is the exact question he could not answer without scrolling.
`ContestVideoQueue` is deliberately NOT there: it is not contest-scoped, it
lists every contest's videos, so on a per-contest tab it would answer a
different question than the one being asked.

**The Save button only exists on Details**, because only Details is a form. The
other four carry controls that save themselves, and the form this button submits
is not in the tree when they are open. A visible-but-inert button is worse than
an absent one.

**Sections are numbered**, from his design. Numbering turns "fill this in
somewhere on a long page" into a sequence you can be halfway through, and gives
him something to point at when he says which part is wrong.

**HOW MANY IMAGES A CONTEST NEEDS: two, and one already existed.**

| | where | status |
| --- | --- | --- |
| hero, behind the name and countdown | `contests.banner_url` | existed since 2026-08-13, with **no upload control** â€” the old form's own comment said so |
| the picture beside "why join" | `contests.card_image_url` | new |
| the brand's mark | `brands.logo_url` | existed |

Both new fields are OPTIONAL and every screen is designed to be right without
them, because the first contests will have neither and a layout that only works
once somebody uploads artwork looks broken by default. They go in the EXISTING
`brand-assets` bucket under `contests/<id>` â€” public read, staff write, 2 MB,
no SVG â€” so **nothing commercial may appear in a picture**.

**`perks` is a text column, not a `text[]`.** An array needs array-editing UI
â€” add, remove, reorder â€” for content that is three short lines typed once. One
textarea split on newlines is the same shape the offer audience box uses.

**Change rules**

- **The artwork fields MUST be seeded from the row when the form loads.**
  `save_contest` writes all three unconditionally, so a form that opened with
  them empty would wipe a contest's hero image on an edit that only meant to
  change the deadline.
- **`save_contest` was dropped by looking up its own signature**, not by naming
  the argument list. That list was stale in my head â€” `judging_basis` left the
  function when ranked placings were dropped â€” and the body was EXTRACTED from
  its migration rather than retyped for the same reason.
- **`check-contests.mjs` opens `?tab=rewards`** before driving the
  deliverables. Everything it does is still through the real controls; it just
  has to open the right drawer first.

**Still on one scroll, deliberately:** the creator's contest screens. That is
the other half of what he asked for and is the next step.

## Offer kinds, and who is allowed to see an offer (2026-08-22)

**Files:** `supabase/migrations/20260821190802_offer_kinds_and_audience.sql`,
`supabase/functions/manage-brand/index.ts`, `src/lib/schemas/brand.ts`,
`src/components/admin/OfferDialog.tsx`, `src/lib/admin/useAllOffers.ts`,
`src/lib/admin/useManageBrand.ts`, `src/components/creator/OfferCard.tsx`,
`scripts/check-offers.mjs`

Rashid, from his boss: offers divide into three, and the type carries a guard
rail rather than a note in the description.

| kind | who sees it | application |
| --- | --- | --- |
| **Retainer campaign** | only named creators. Required, and a live one cannot be empty | admin's choice |
| **Volume** | everyone, minus anyone named. His addition: exclude the people who already have their own deal | admin's choice |
| **High commission** | everyone, unless narrowed to named creators | **forced off**, checkbox hidden |

**THE LEAK THIS CLOSED WAS LIVE.** Before it, every approved creator could read
every active offer, so all 41 creators on dev could read all 31 Penetrex deals:
@dannydailyfinds is on \$800 and could see @erinragancooper is on \$2,000. The
31 were backfilled to retainers named to whoever is already on them. Checked
first, not assumed: 31 offers, 31 distinct (videos, reward) pairs, no two the
same deal, every creator on exactly one.

**Change rules**

- **The rule is written ONCE**, in `offer_is_for(offer, kind, creator)`, which
  is service-role only because it answers about anybody.
  `can_see_offer(offer, kind)` is the wrapper `authenticated` may run and takes
  no creator argument, so it cannot be asked about somebody else. The RLS policy
  and the write gate both call the same body â€” two copies is how they drift into
  disagreeing about who is allowed.
- **`apply_for_offer` IS SECURITY DEFINER, so RLS does not protect it**, and
  this is the item that would have made the whole feature decorative. Without
  its own audience check, a creator holding only an offer id â€” a stale tab, a
  copied link â€” could insert an application; the row then satisfies
  `offers_select_own_requests` and grants a PERMANENT read; and approving it
  charges `brand_commercials.budget_used`. A write path escalating into a read
  policy, ending in money. The check goes BEFORE the duplicate check, or a
  barred creator learns from the 55006 that they already have a row.
- **Approving is gated by a TRIGGER on `offer_applications`**, not by editing
  `review_offer_application`. That function has been re-issued five times
  across five migrations; copying it again to add four lines is how a body gets
  subtly retyped. The trigger fires only on the TRANSITION into approved, and
  catches every path including direct SQL.
- **`offers_select_own_requests` was NARROWED to pending and approved.** It is
  permissive and OR'd with everything else, so it ignored the audience list
  entirely: apply to a retainer, get rejected, and keep reading that creator's
  private rate for ever. Live and finished jobs keep their offer's name on every
  creator screen; a rejected request does not.
- **The mode is stored ON the audience row**, not inferred from the kind.
  Inferring it means switching an offer from Retainer to Volume silently turns
  "these three may see it" into "these three may NOT", on live money, with
  nothing on screen. A DEFERRED constraint trigger refuses the contradiction
  instead. Deferred because saving a retainer moves the offer and its list in
  some order, and a per-statement check would fire mid-flight.
- **That trigger is scoped to the row that moved.** A constraint trigger must be
  FOR EACH ROW, so a body that scanned every offer would be O(offers x rows) per
  statement â€” fine on 31, ruinous later.
- **`offer_audience` is staff-only and NOT in the realtime publication.** Its
  rows name the other creators given the same private deal.
- **`save_offer` was DROPPED and recreated**, not replaced: a new parameter
  makes an overload, and PostgREST would have resolved some callers to the old
  body, writing offers with the default kind and no audience under a success
  toast.
- **The admin pastes text; the server resolves it.** Handles or emails, newlines
  or commas, resolved against `creator_directory` with the service key. The
  browser never sends creator ids â€” a client that can name arbitrary uuids can
  put a person on a private deal. Unmatched lines ride back on the successful
  save and the dialog names them.
- **The dialog will not save until the existing list has loaded.** The offer row
  it is handed carries no audience, so seeding the box empty and saving would
  wipe a retainer's whole list on an edit that meant to fix a typo.
- **`kind` collided with an existing `kind`.** The admin filter had used that
  word for `needs_application` (`'all' | 'application' | 'open'`). It is
  `access` now, with its own dropdown beside the new one. Two "kind"s on one
  filter bar is the mix-up where an admin filters by one, gets the other, and
  every test still passes. `scripts/check-offer-requests.mjs` drives both.
- **OfferCard stopped claiming "Open to every approved creator."** That is a
  statement about audience and it is false on every restricted offer. It says
  "It is yours to take" now, which is true of everything reaching that branch.

**Proof:** `pnpm verify:offers`, 26 checks, all as a real signed-in creator
against the database rather than against a screen â€” a screen that draws nothing
proves nothing about what the policies would hand over. It covers both the read
and the write, the secrecy of the list itself, the empty-live-retainer refusal,
the mode-flip refusal, and that a creator keeps an offer they already have work
on.

## The applications queue, as cards (2026-08-21)

**Files:** `src/routes/admin/Applications.tsx`, `scripts/shots-admin.mjs`

Rashid, and he was right to be sharp about it: *"this is not waht i expcected
make it more beautiful ... like horiontal cards you are always ptting content in
a row why why why?"* Offers and Requests had become cards and this was still a
six-column table with a heading row.

**IT NAVIGATES, IT DOES NOT EXPAND.** That is the one real difference from the
other two grids. Applications HAVE a detail screen, `/admin/applications/:id`,
which is where a decision gets made after reading somebody's answers. An
accordion here would be a second, worse copy of a page that already exists.

**So the link is an OVERLAY, not a wrapper.** The card carries a checkbox and
two decision buttons, and a button inside an anchor is invalid markup that
behaves differently in every browser. The anchor is absolutely positioned across
the card, the content above it is `pointer-events-none`, and only the controls
opt back in. Same trick the old row used, which is why it survived the rewrite.

**THE OVERLAP RASHID PHOTOGRAPHED, and what actually caused it.** The table gave
`Applied` 7rem and the actions column `2.25rem`, sized for the icon button a
PENDING row shows. A decided row puts a status pill there instead, which is far
wider than 2.25rem, so it grew leftwards across the date and rendered
"Jul 20, 2026âœ“ APPROVED". A card has no fixed columns to overflow. **Any fixed
grid column sized for one state's control will do this the day another state
puts something bigger in it.**

**Select all moved out of the heading row.** There is no heading row on a grid,
so the two copies of that control â€” one in the `md` heading, one in a phone-only
bar â€” became one, shown at every width.

**Two bugs in `shots-admin.mjs` came out of shooting this**, and both made the
tool lie rather than fail:

- It waited on `networkidle`. These screens hold a Supabase realtime socket
  open, so the page may never go idle at all; dark mode would shoot and the
  first light run would hang for thirty seconds and throw. It waits for
  `domcontentloaded` and then for real content now.
- Its "every image has decoded" wait was **true of a page with no images on it**,
  because `[].every()` is true. An avatar's `<img>` only mounts once its signed
  URL arrives, so the check passed instantly and the shot came out as a page of
  initials â€” which looks exactly like the pictures being broken. It waits for at
  least one image to exist first, briefly, then for the ones that exist.
- The throwaway admin delete is retried four times. One `fetch failed` used to
  leave an account in dev for good.

## The requests queue, as cards (2026-08-21)

**Files:** `src/routes/admin/OfferRequests.tsx`,
`src/components/layout/FilterBar.tsx`, `scripts/check-offer-requests.mjs`

Rashid, straight after the offers grid: *"i like it do something with this as
well do the same"*. Same language throughout â€” `rounded-md`, three sections
split by hairlines, the money as the hero with the rate as its caption, an open
card spanning the row with the details beside it above `lg`.

**IT IS A QUEUE, AND THAT CHANGES THE STRUCTURE.** Every card carries a control
that writes: Approve and Reject on a waiting request, the stage dropdown on an
approved one. Those cannot go behind an expand, and they cannot go INSIDE the
button that expands, because a `<select>` or a `<button>` nested in another
button is invalid HTML that browsers resolve by guessing â€” and the guess is
usually that the outer one wins, so opening the stage list would have expanded
the card instead. So the card is split: the reading matter is the button, the
action bar sits outside it.

**What stays on the card is what the decision turns on:** who, which offer, the
money, how much has actually been filmed, and how long it has stood there. What
moves into the panel is what you read after deciding to look: when they asked,
the last move in the creator's own words, their note, and what you told them.

**No APPROVED chip on an approved card.** The Approved tab was forty-one
identical green pills repeating what the tab already said, and a card carrying a
stage dropdown is approved by definition. The chip is kept for **rejected** and
**withdrawn**, which are the two that would otherwise look the same.

**The progress line says the standing and nothing else.** `JobProgressBar`
already writes "0 of 5 approved, 5 still to film" under itself; the old row said
it again in a second place, and the first draft of this card did too.

**The stage dropdown lost its "Stage" eyebrow and its fixed 12rem width.** In a
labelled column that heading was doing work; in an action bar holding one control
it is a word explaining a control that explains itself. It fills the bar now, so
it fits a phone and a narrow column without a second breakpoint. The accessible
name is unchanged, on the `sr-only` label.

**`FilterTabs` was making the page scroll sideways at 375px, and had been for
a while.** It was `shrink-0` with `shrink-0` children, so any screen with five
states â€” this one, and every other queue with Waiting / Approved / Rejected /
Withdrawn / All â€” was wider than the phone it was on and "All" sat off the edge.
It wraps now. Found by the width check in `shots-admin.mjs`, not by looking.

**`verify:offer-requests` needed one edit and it is worth knowing why.** It
asserted `getByText(/5 videos for \$300/i)`, one sentence the card no longer
writes. It now asserts BOTH halves â€” the amount AND the shape of the deal â€”
rather than loosening to whichever half still matched: a card showing \$300 with
no idea how many videos buys it is exactly what that check exists to catch.

## The offers grid (2026-08-21)

**Files:** `src/routes/admin/AllOffers.tsx`, `src/lib/admin/useAllOffers.ts`,
`src/components/work/CreatorStack.tsx`, `src/components/work/CreatorFace.tsx`,
`scripts/shots-admin.mjs`

Rashid: *"Look at the offers ui how boring it is ... horizontal cards rather
than having one row it's wasting the time ... card will be minimal ... just
show mian thing such as offer name, deal value ad brand name that's it but
somethign extra for creators we can show avatras ... keep the corner radius very
low and clicking on it should show details ... i am expecting something perfect
polish the ui please."*

It was one full-width row per offer carrying four labelled columns. Now it is a
grid: 1 / 2 / 3 / 4 columns at 375 / 640 / 1280 / 1536.

**The card says four things and hides the rest.** Brand, offer, money, people.
The per-video rate, the type, what has been filmed and when it was added all
moved into the panel that opens. A card that shows everything is a row with
corners.

**The money is the largest thing on it and its caption carries the rate.** The
caption said "for 5 videos", which every one of Rashid's titles already says a
line above, so the biggest element on the card was an echo. `$40 each` is the
number two offers are actually compared on, and it is the only arithmetic on the
screen.

**The title is clamped to two lines AND floored at two lines.** Clamped so a
long one cannot make a card taller than the one beside it; floored so a short
one cannot make it shorter. In a grid, cards of unequal height read as a bug.

**THE OPEN CARD SPANS THE WHOLE ROW.** Expanding in place left a hole: a grid row
is as tall as its tallest item, so the two cards beside an open one kept their
height and the space under them went blank. It spans every column instead, and
above `lg` the details sit BESIDE the card rather than under it, so what was
clicked stays the size and shape it was clicked at. The middle section is
`flex-1` so the stretch lands there and not as a gap under the footer.

**Open state is held by offer id, never by index.** A filter or a page change
reshuffles the list, and an index would leave a different offer standing open
with somebody else's details under it. `setFilters` closes whatever is open.

**The panel animates opacity and a 6px rise, NOT height.** It is a column child
on a phone and a row child on a laptop; a height animation reads as an accordion
in one and as an unfurling flag in the other.

**Faces come from `offer_applications`, not from a join.** `creator_name` and
`creator_handle` were copied onto that row when the creator asked, so the page
still costs ONE grouped read. `useOfferPeople` keeps four per offer
(`FACES_PER_OFFER`) and the count beside them comes from `approved`, so the
+N is honest without the cache holding two hundred names for a popular offer.
Every avatar on the page is signed in one call by `useCreatorAvatars`.

**`CreatorStack` is one component for the same reason `CreatorFace` is.**
Three faces, overlapped by a third of their width, each ringed in the surface
colour so they are cut out of each other rather than smudged together, then +N.
It takes `total` separately from `faces` precisely so the two can disagree.

**Radius is `rounded-md` here, not the `rounded-xl` of Brands and Contests.**
That is his "keep the corner radius very low", asked for on this screen. The
other card screens have NOT been changed to match â€” raise it if the difference
starts to show.

**Reviewing it:** `pnpm shots:admin /admin/offers` renders both themes at 375,
768, 1024 and 1440, checks for horizontal page scroll and reports console
errors. `SHOT_CLICK='button[aria-controls^="offer-details"]'` takes a second
set with a card open, because half of a screen with an accordion on it is
invisible in a shot of its resting state.

## The pipeline, and the creator's dashboard

**Files:** `src/lib/offer-stages.ts`, `src/lib/creator/useMyWork.ts`,
`src/routes/app/Dashboard.tsx`, `src/components/creator/FirstDay.tsx`,
`src/components/creator/StageTracker.tsx`, `scripts/shots-creator.mjs`,
`src/lib/money.ts`,
`supabase/migrations/*_offer_pipeline.sql`,
`supabase/migrations/*_read_offers_you_asked_for.sql`
**Tables:** `offer_applications.stage`, `offer_stage_events`

Approving somebody is the start of the work, not the end of it. Seven stages,
from Pending request to Paid, moved by staff and watched by the creator.

**Change rules**

- **`src/lib/offer-stages.ts` is the single source of the vocabulary**, the
  order, the icons, and which money bucket each stage belongs to. Nothing
  hard-codes a sequence of its own. The SAME labels are used on both sides on
  purpose: an admin and a creator on the phone must mean the same box when they
  say "sample shipped".
- Only an APPROVED request has a stage. Pending has not started and rejected
  never will, so theirs is null rather than a first step nobody is standing on.
- **Money is bucketed by STAGE, never by status.** "Approved" says nothing about
  whether anybody has been paid. Each stage belongs to exactly one bucket, so
  paid plus due plus working always equals the total agreed and a creator can
  add the three cards up and get the big number. Adding a stage means choosing
  its bucket, or that stops being true.
- Moving a request **backwards is allowed**. A sample marked shipped that was
  not shipped has to be correctable, and refusing would only teach people to
  work around the product.
- The stage control on the admin queue applies on change with no confirmation.
  Seven stages across every creator is a lot of clicking, none of it
  destructive, all of it audited, all of it reversible.
- `offer_stage_events` is the creator-readable history, which `audit_log` can
  never be because that is staff only. Anything a creator should be able to see
  about their own work goes here.
- **A creator can always read the offer and brand behind their own request**,
  even after either is switched off. Without that policy, retiring a brand at
  the end of a campaign would blank the name of the thing somebody is still
  being paid for.
- `src/lib/money.ts` holds the formatters. Creator screens must not import from
  `src/lib/admin/*` for them, which is what they used to do.

**The home screen, rebuilt on 2026-08-11 from a design Rashid approved**

- **The only motion on it is a change.** `useJustMoved` diffs the stages between
  renders and flashes the card, bumps the figures and pops the new timeline row
  for 2.6 seconds. The FIRST load is deliberately not a change: everything would
  qualify, the whole board would flash, and people would learn to ignore it.
  There is no count-up on mount for the same reason.
- The timeline is capped at **eight** events. Four jobs walking seven stages
  generate roughly thirty, and a right column taller than the work list beside
  it turns into a wall nobody reads to the bottom of.
- **`FirstDay` is lazily loaded and must stay that way.** It reaches for the
  offers list, the brands list and `ApplyDialog`, and the dialog drags the Zod
  schema chunk behind it. Imported directly, that weight lands on the home
  screen of every creator who already has work. `verify:responsive` caught it as
  a 375px timeout, which is the only reason it did not ship.
- **Two views, both from the design, switched in the URL (`?view=pipeline`).**
  Overview answers "have I been paid and what is coming". Pipeline answers
  "what is sitting where", which is what somebody asks when three jobs are in
  flight and one has gone quiet. `PipelineBoard` is the only thing that reads
  `summary.byStage`, which `summarise()` had always computed and nothing used.
- `STAGE_META.short` exists for the places a stage is a COLUMN rather than a
  sentence: the seven-card board and the first-day grid. `creatorHint` wraps to
  three lines in a 142px column. Adding a stage means writing both.
- `pnpm shots:creator` photographs this screen with a full pipeline in it, both
  themes, four widths. It writes `offer_applications` directly rather than
  through `review_offer_application`, deliberately: the real function charges
  the brand's budget, and a throwaway creator must never move a number an admin
  is reading.

## Offer requests (creators asking, staff deciding)

**Files:** `src/routes/admin/OfferRequests.tsx`,
`src/components/admin/OfferReviewDialog.tsx`,
`src/components/creator/ApplyDialog.tsx`,
`src/lib/admin/useOfferApplications.ts`,
`src/lib/creator/useOfferApplications.ts`,
`src/lib/schemas/offer-application.ts`,
`supabase/functions/manage-offer-application/`,
`supabase/migrations/*_offer_applications.sql`,
`scripts/check-offer-requests.mjs`
**Tables:** `offer_applications`

A creator asks for the offer as it is written. An offer that needs no
application is not in here at all: it is already theirs.

**Countering an offer with your own video count and your own price shipped on
2026-07-31 and was withdrawn the same day, at Rashid's call.** The two
`proposed_*` columns went with it once he confirmed there was no data to
protect. If countering ever returns it needs: two columns, two parameters on
`apply_for_offer`, two fields in the dialog, and a branch in the queue.

**When dropping a column, grep the function bodies.** Removing those two broke
`review_offer_application`, which still named them in its audit row, and the
migration applied without a murmur: plpgsql resolves field names when a
function RUNS, so it stayed valid-looking SQL until an admin clicked Approve
and got a 500. Only `check-offer-requests.mjs` found it, because it approves a
real request through the real screen.

**Change rules**

- **This is the first thing in the product a creator can write.** Every rule
  below exists because of that.
- No insert, update or delete policy on `offer_applications`. `manage-offer-
application` is the only door, and it checks the role PER ACTION: create and
  withdraw need an active creator, review needs active staff. It is the first
  Edge Function both sides call, so a single gate at the top would have been
  wrong.
- `withdraw_offer_application` matches on `creator_id` as well as the row id,
  so a creator cannot aim it at somebody else's request. `check-offer-requests`
  proves that with a second, rival creator.
- **`proposed_video_count` and `proposed_amount` are null on everything written
  since 2026-07-31.** Null means "whatever the offer says". Even while
  countering existed they were never filled with the offer's own numbers, since
  those look identical on the day and stop being the same fact the moment an
  admin edits the offer.
- A create request arriving WITH those numbers is refused out loud, not
  stripped. It can only be a browser tab left open across the change, and
  silently agreeing somebody to the brand's price when they typed their own is
  the worst available outcome.
- The unique index is PARTIAL, covering `pending` and `approved` only. A
  rejected creator can ask again with a different number, which is the entire
  point of letting them name a price. A plain unique constraint would have
  banned them from that offer for life.
- `creator_handle`, `creator_name` and `creator_email` are SNAPSHOTTED onto the
  row, the same way `audit_log` snapshots its actor. It keeps queue search to
  one trigram index on one table, and the queue still reads correctly after a
  creator renames themselves or closes their account. The live profile is not
  joined.
- `review_offer_application` takes `for update` and refuses a second decision
  with `55006`, so two admins clicking at once cannot both decide, and cannot
  both spend the same budget.
- **`committed_amount` is a snapshot taken at approval, never read live from
  the offer.** Re-pricing an offer next month must not rewrite what a creator
  was already promised, nor a budget that has already been reported on. The
  suite proves it by re-pricing an approved offer and checking neither moved.
- **`committed_video_count` is the other half of that snapshot**, added
  2026-08-11 at Rashid's call: once approved, an admin may never change the
  number of deliverables on a job already agreed. Both are set in one place, in
  `review_offer_application`. Anything that writes an approved request directly
  (three scripts do) must stamp BOTH, or that job can never be "all filmed".
  The brand's budget is unaffected and keeps moving on every approval.
- An approved request against an offer with no fixed fee commits nothing
  measurable, so it adds nothing to the budget rather than a guessed number. It
  still counts as a creator on the offer.
- **`delete_offer` refuses while any request is pending or approved.** Settled
  ones cascade with the offer and the audit log keeps them. Deleting an offer
  somebody is waiting on is how you lose a creator.
- The creator's own requests ARE live (`replica identity full`, filtered to
  their own rows). A decision has to land while they are looking at it, for the
  same reason approval does on the dashboard.
- Every write puts `target_user_id` on its audit row, so "everything that has
  happened to this creator" stays answerable with one index.
- `pnpm verify:offer-requests` must pass after any change here. It runs both
  sides in real browsers and spends most of its time attacking the creator write.

## Creator onboarding moments

**Files:** `src/lib/creator/useOnboarding.ts`, `src/components/creator/*`,
`src/routes/app/Dashboard.tsx`, `src/routes/app/Profile.tsx`,
`supabase/migrations/*_creator_onboarding_moments.sql`
**Tables:** `profiles.welcomed_at`, `profiles.approval_celebrated_at`

**Depends on:** applications (for the live status), profiles, realtime.

**Change rules**

- "Once" lives in the DATABASE, never in localStorage. A creator applies on a
  phone and signs in on a laptop; browser storage would replay the welcome as
  if they were new, and would replay the approval celebration on every cache
  clear. Any future one-time moment gets a column here, not a local flag.
- `momentFor()` decides from the profile row alone. Approval wins over the
  welcome, and dismissing approval settles both, or somebody approved before
  they ever opened the hub gets congratulated and then welcomed as a fresh
  applicant.
- The overlays cannot be dismissed by Escape, backdrop click or a close cross.
  The button IS the acknowledgement, and these appear exactly once in a
  creator's life, so a stray tap must not burn them.
- If the acknowledging write fails the moment still closes locally. Nagging
  somebody because a network blip lost the acknowledgement is worse than the
  flag being late.
- The dashboard carries NO account details. They live on `/app/profile`, so the
  home screen is only ever about where the creator stands with us.
- `display_name` is the only column a creator may edit, and that is a database
  fact (the column grant), not a UI choice. Do not add fields to the profile
  form without a matching grant.
- Every suite that signs somebody up has to walk through the welcome, because a
  real creator does. They each have a `dismissWelcome`-style step.

## Admin screen layout

**Files:** `src/components/layout/AppShell.tsx`,
`src/components/layout/FilterBar.tsx`, `src/lib/nav.ts` (`sectionTitleFor`),
`src/lib/ui-scale.ts`, `src/components/layout/TextSizeMenu.tsx`, every admin
route.

Rashid's rules, recorded in CLAUDE.md and binding on new features.

**The chrome, rebuilt 2026-08-16**

- **The top bar names the section, underlined, and that is the page's only
  `<h1>`.** It comes from the sidebar's own labels through `sectionTitleFor`, so
  the bar and the lit menu row cannot disagree.
- **A screen draws no title row and no description of itself.** Both came off
  every admin screen; they cost roughly 120px above the work to repeat the word
  the menu was already showing.
- **Row one is `<FilterBar>`:** tabs, search, filters on one line, translucent
  border, `rounded-lg`, with at most one primary action pinned right. Segmented
  controls are `<FilterTabs>`/`<FilterTab>`, never hand-rolled per screen.
- **A record screen keeps the record's name as an `<h2>`.** The bar answers
  "where am I", not "which one is open".
- **Corners are slight:** `rounded-md` on controls, `rounded-xl` on cards,
  `rounded-full` only on icon buttons and status pills.
- **The rail is 15rem**, its scrollbar is hidden (`wx-scroll-quiet`) while it
  still scrolls, its scroll position survives navigation, and the Wurx mark is
  the collapse control. There is no collapse arrow in the bar.
- **Type is `rem` everywhere**, scaled by one root `font-size` that the person
  using it can change from the bar. See `src/lib/ui-scale.ts`.

**Change rules**

- **The main area is left aligned against the rail, at full width**, with no
  max-width cap, and is NOT centred. Both halves of that are the same rule:
  centring drifts the content into the middle on a wide monitor and a cap stops
  it short when somebody zooms out. Either way a dead gap opens beside the
  sidebar and the page stops reading as one thing.
- **Working content starts high.** Compact headers: a back control, the name, a
  status chip if it earns its place, and the primary action, on one row.
- **Reference data lives under an Overview tab**, not stacked above the work. On
  a record with tabs the DEFAULT tab is the job. The Brand Hub opens on Offers,
  with the brand's facts one tab across.
- **Never show slugs, ids or routes to an admin.** They are plumbing.
- The `gap-px` on a `bg-line` wrapper trick paints gaps with the border colour,
  so a grid whose last row does not divide evenly shows an empty block. Use it
  only for grids with a fixed, evenly dividing item count; anything that grows
  gets separate bordered cards.

## Responsiveness

**Files:** `scripts/check-responsive.mjs`, every screen.

CLAUDE.md makes "works on phone, tablet, laptop and desktop" a binding rule,
because Wurx targets US and UK creators who are mostly on phones. This suite
makes it checkable: every screen is opened at 375, 768, 1024 and 1440px and must
render its content, log nothing, and not scroll sideways. When it fails it names
the element that is too wide.

**Change rules**

- A new signed-in screen goes in the `SCREENS` list in that script. A screen
  nobody checks is a screen that breaks on a phone.
- Assertions must be scoped to `<main>`. The desktop rail is rendered at every
  width and merely hidden by CSS, so an unscoped text match finds the sidebar's
  copy of a label and waits forever on something deliberately invisible.
- **A screen behind an id needs a `via` entry**, which opens the list and
  follows the first row. `/admin/brands/:id`, `/admin/creators/:id` and
  `/admin/applications/:id` were all invisible to this suite until 2026-08-11,
  and the very first run of the new coverage found a real 375px overflow on the
  application detail screen that had been there since it was built.
- **`min-w-0` is the fix for almost every sideways scroll, and it goes on the
  ITEM, not the container.** A flex or grid item's min-width is `auto`, so one
  unbreakable string (a URL, an email) sets a minimum for its own box and every
  box above it. `truncate` does NOT save you: it needs a definite width to
  truncate against. The application detail screen needed it in five places
  before it fitted on a phone.
- **Dialogs need their own check.** A page can pass at every width while a modal
  opened on it does not: the review dialog once pushed its heading above the top
  of a short viewport with no way to scroll back to it, and no page-level
  assertion could see that because the page itself was fine. Any new modal gets
  a case in the "modals" section, asserting its heading and its confirm button
  are actually reachable.
- A modal must scroll INSIDE ITSELF (`max-h` plus `overflow-y-auto` on the
  panel). Putting the scroll on a `fixed inset-0 flex items-center` wrapper
  looks right and is not: overflow past the container's top edge is not part of
  the scrollable region, so the top of a tall dialog becomes unreachable.
- Anything selectable on desktop must be selectable on a phone. Select-all lived
  only in the `md`-and-up column header once, which quietly made bulk review a
  desktop-only feature.

## Admin review & audit log

**Files:** `src/routes/admin/AdminDashboard.tsx`,
`src/routes/admin/Applications.tsx`, `src/routes/admin/Activity.tsx`,
`src/routes/admin/ApplicationDetail.tsx`, `src/components/admin/*`,
`src/lib/admin/*`, `src/lib/schemas/review.ts`,
`supabase/functions/review-application/`, `supabase/functions/_shared/cors.ts`,
`supabase/migrations/*_admin_review_audit_log.sql`,
`scripts/check-review.mjs`, `scripts/seed-applications.mjs`
**Tables:** `audit_log` (new), reads and writes `applications` and `profiles`

**Depends on:** Applications, Auth/profiles/roles, Realtime.
**Depended on by:** every future admin surface. Brands (Step 6), data upload
(Step 7) and money (Step 8) all reuse this shape: Edge Function re-checks the
role, one `security definer` function does the work in a transaction, audit row
written inside that same transaction.

**Change rules**

- Routes: `/admin` is the dashboard (counts and recent activity),
  `/admin/applications` is the queue, `/admin/applications/:id` the detail,
  `/admin/activity` the full audit log. The counts deliberately live on the
  dashboard so the queue opens straight onto the list.
- One decision flow: `ReviewDialog` is used by the row menu, the bulk bar and
  the detail screen. Approving one person and approving forty must not drift
  apart. Do not add a second confirm path.
- Bulk is a server-side LOOP over `review_application`, never a bulk SQL
  statement. Each application keeps its own transaction and its own audit row,
  so one bad item cannot roll back the others or slip through unlogged. The
  batch is capped at 100 in both the schema and the Edge Function.
- A single-item request still returns a real HTTP status (409 for "already
  reviewed"). A batch returns 200 with per-item results, because "nine worked,
  one did not" is not one status code.
- Only `pending` rows are selectable and only they get the action menu. Reviewed
  rows show their status badge instead.
- A decision is **never** a table update from the browser. `applications.status`
  is not in the column grant, a trigger blocks it, and
  `public.review_application()` is granted to `service_role` only. The Edge
  Function is the only door and it re-reads the caller's role from `profiles`
  rather than trusting the JWT claim, which can be an hour stale.
- Status, role, tier and the audit row move in ONE transaction. Splitting them
  into separate REST calls reintroduces the half-approved state that
  `profiles_tier_only_for_creators` exists to prevent.
- `audit_log` has a select policy for staff and **no insert, update or delete
  grant to `authenticated` at all**. Never add one. An audit trail an admin can
  edit is not an audit trail.
- Any new browser-invoked Edge Function must reuse `_shared/cors.ts`, which
  echoes `Access-Control-Request-Headers`. Our Supabase client sends a custom
  `x-application-name` header, and a hand-written allow-list silently fails the
  preflight so the action appears to do nothing.
- Every response from an Edge Function needs the CORS headers, including the
  error ones. A 403 without them reaches the browser as an opaque network
  failure and the user sees the wrong message.
- The queue is paginated in the database and its filters live in the URL. Never
  fetch every application and filter in the browser.
- Approving relies on `useApplication`'s realtime subscription to update the
  applicant. `AppShell` and `Dashboard` therefore prefer `profile.role` over
  `claims.role`; going back to the claim would make the change invisible for up
  to an hour.
- `pnpm verify:review` must pass after any change here. It approves, rejects,
  and then attacks the API as a signed-in applicant.

---

## Not built yet

These get entries as they are built. Listed so the dependency shape is visible
early.

| Feature                      | Arrives | Will depend on                 | Will be depended on by         |
| ---------------------------- | ------- | ------------------------------ | ------------------------------ |
| Auth, profiles, roles, tiers | Step 1  | Supabase client                | everything                     |
| Landing page                 | Step 2  | Design tokens                  | Applications                   |
| Home                         | Step 5  | Facts, brands, announcements   | none                           |
| Brand Hubs + theming         | Step 6  | Brands, design tokens          | My Numbers, Leaderboards       |
| Data pipeline + facts        | Step 7  | Creators, brands, identity map | My Numbers, Leaderboards, Home |
| My Numbers                   | Step 8  | Facts, Brand Hubs              | none                           |
| ~~Leaderboards~~ DONE        | Step 9  | see "The leaderboard" above    | -                              |
| Offers + Discord             | Step 10 | Tiers, Brand Hubs              | none                           |

## Contests

Built 2026-08-13 and 14. **Read docs/CONTESTS_PLAN.md before touching it**, it
holds the numbered rules and most were learned the hard way in one night.

**A contest is a list of DELIVERABLES**: a type (gmv or video_count), a target,
and a reward. Placings were dropped, so there is no ranking and no judging
sentence. Anybody who reaches a target earns its reward, and several creators
can earn the same one.

**Progress is typed by the creator and confirmed by staff.** Cumulative totals,
never increments. THE TARGET IS READ ONLY TO A CREATOR in the browser and on the
wire: no function they can reach takes a target or a reward argument, and the
creator door uses a strict object so sending one is refused rather than
stripped. A claim asks for exactly the NEW videos, so 5 to 6 asks for one link
and one ad code. The count may not go backwards.

**Nothing counts until staff confirm it.** A creator typing their own GMV is a
creator typing their own payslip, so confirmed and claimed are never added and
never drawn the same. Money is only ever owed against a confirmed figure.

**CONFIRMING IS THE MONEY EVENT** (Rashid, 2026-08-14). The moment staff confirm
a figure that crosses a target, `review_contest_progress` writes a
`contest_awards` row in the same transaction and that reward is OWED. It is not
worked out at the end of the contest, because there is nothing left to work out:
placings are gone, so nothing is contingent on anybody else.

- **`contest_awards` is a bill, not a settlement table.** Every row is money
  against one FROZEN TERM, never against the live deliverable, so an admin
  adding a deliverable on Friday cannot owe money on Monday's entry. It carries
  `reached_value`, the figure that crossed the target, frozen, so a receipt read
  six weeks later does not quote a number nobody was paid on.
- **Two states, owed then paid.** `paid_at` null is owed. `pay_contest_awards`
  takes a LIST and does the whole list in one transaction. **There is no way to
  unpay**; the guard is a confirmation step on the screen.
- **One award per promise**, as a unique constraint, and it is the double
  payment guard: a creator who reports 640 then 900 crosses the same 500 target
  twice and is paid for it once.
- **`private.award_reached_terms` is the only writer**, and it is in `private`
  because PostgREST exposes every executable function in an exposed schema, so
  in `public` a money writer taking an entry id and a figure would be an
  endpoint. The suite asserts a signed-in creator cannot reach it.
- **Rule S8 lives on payment now, not on settlement.** Paying a suspended
  creator needs `p_allow_suspended`; awarding one does not, because they keep
  everything they earned and the deliberate act is sending the money.
- **Going over budget is allowed and shown, never blocked**, the same rule the
  brand budget bar has followed since 2026-08-01. A confirmation is a statement
  about what somebody actually did, and a budget must not make us pretend they
  did less.

**`settle_contest` CLOSES a contest and moves no money.** It was rewritten on
2026-08-14 and the old five argument version was DROPPED, so nothing can pass it
outcomes. It refuses while any entry is pending (rule L12) and, new, **while any
progress claim is pending**: that claim could never be confirmed afterwards, and
confirming is the only thing that can owe somebody money, so closing over one
would silently cancel a reward already earned. It reports what is still unpaid
rather than refusing on it, and paying keeps working on a closed contest.

The name stays `settle_contest` against the instinct to rename it, because
`settled_at`, `settled_by`, the `settled` entry event and the `contest.settled`
audit action all say settled. The screen says "Close this contest".

**Standing without names.** my_contest_standing is a security definer function,
not a view, returning ONLY the caller's own position from auth.uid() with no
user id argument. It never returns another entrant's figures or identifiers.

**Two doors.** manage-contest is staff only. enter-contest requires an active
creator. A creator must never reach the staff door and cannot.

**CONTEST MONEY IS ON THE CREATOR HOME, BESIDE OFFER MONEY, NEVER IN IT.** Added
2026-08-14. `/app` used to count offer money only, which was complete until
contest rewards existed. `ContestEarnings` is its own card reading its own query
(`useContestEarnings`, one read of `contest_awards`), and the separation is
STRUCTURAL rather than a label: the offer money card's three cells add up to its
own headline by construction, which is the property that lets a creator check
our arithmetic, and a contest reward dropped in there would quietly make that
headline a lie. The card also says the rule in words, for anybody reading rather
than looking.

Three things that fall out of it, all of them real people rather than edge cases,
because contests are open to every approved creator regardless of which brands
they work with:

- **A creator with contest money is not on their first day**, and `nothingYet`
  used to say they were, sending somebody who was owed $850 to a screen telling
  them to take their first offer.
- **A creator with contest money and NO offer work does not get the money card**,
  because it would read "$0 across 0 jobs" over an empty bar and three zero
  cells, sitting above the only money they have. Their money leads, and the
  first-day panel underneath does its real job.
- **That panel's "Earned so far: Nothing yet" was hardcoded** and became a lie
  the moment it could sit under a contest reward. It says "Earned from offers"
  now, and deliberately does NOT quote the contest figure, because that figure is
  already on the screen and printing it twice invites somebody to add them.

**Screens.** /admin/contests, /admin/contests/claims, **/admin/contests/rewards**,
the Contests tab in a brand, the full screen setup form at
/admin/brands/:id/contests/:contestId, and /app/contests with two views, the list
and the creator's own dashboard. The three admin screens are three jobs: what is
running, who is waiting on us, what it cost. Rewards opens on OWED, because that
is the job; Paid is the record, one click across, in the URL.

**Traps already paid for.** The contest budget lives in contest_commercials, its
own staff only table, for the same reason the brand budget does. There is no way
to remove a creator from a contest they joined, deliberately, and the plan says
not to add one without asking. An exclusion is scoped to ONE contest. Deadlines
are stored with an IANA zone name beside them and always shown in the zone the
admin chose, never the reader's. **`contest_awards.message` is read by the
creator**, which is why it is not called `note`, the same trap as `cancel_reason`
on 2026-08-13.

**`pnpm verify:contests`, 121 checks.** It drives the admin screens, then the
CREATOR screens in a second real browser (the contest list, the entry dialog and
the progress dialog), then the whole money path: file a claim, confirm it, watch
the reward appear as owed, pay it on the rewards screen, watch the creator's own
screen say paid, then close the contest. Sixteen of them are attacks, including a
rival creator who can read none of it.

Two things in that suite worth not relearning. **Waiting for "You are in"
matched the entry dialog's own heading, "You are in the moment you tap"**, so it
passed instantly and read the database before the write landed; the dialog
CLOSING is the signal. And **every queue locator is scoped to this contest's
card**, because dev carries real seeded claims and the first Confirm button on
the screen belongs to whoever has been waiting longest.

---

## Contest videos, and the money they earn (2026-08-20)

**Files:** `src/components/admin/ContestVideoQueue.tsx`,
`src/components/admin/ContestVideoDecision.tsx`,
`src/lib/admin/useContestContent.ts`,
`src/components/admin/ContestProgressQueue.tsx`,
`src/routes/admin/ContestClaims.tsx`,
`supabase/functions/manage-contest/index.ts`,
`supabase/migrations/20260820090000_contest_money_follows_the_videos.sql`,
`supabase/migrations/20260820100000_restore_review_contest_progress.sql`,
`scripts/seed-penetrex-contest.mjs`
**Tables:** `contest_submissions`, `contest_awards`, `contest_entry_events`

Rashid, walking the flow: *"money is only owed when all videos are up for both
contest and offer it's like they will submit the video when admin see one by one
and all are approved only then money is owed."*

**Change rules**

- **Until 2026-08-20 no contest video could be decided at all.**
  `review_contest_content` had been finished, audited and granted since
  2026-08-13 and was called by NOTHING: no Edge Function action, no hook, no
  screen. `contest_submissions.status` could therefore never leave its default,
  so the admin queue's chip read "With the team" on every contest video in the
  product and the creator's list carried "Counted" and "Sent back" states that
  no code path could produce. Both screens drew three states of a column that
  had one.
- **A video target is earned by APPROVED videos, never by a typed number.**
  `private.award_reached_terms` lost its `p_video_count` argument and reads
  `private.entry_approved_videos` instead. Dropping the parameter rather than
  ignoring it was deliberate: an argument still accepted and no longer used is a
  trap for whoever passes it next in good faith.
- **GMV targets did NOT change**, and the asymmetry is the point. There are no
  videos to approve behind a GMV figure, so staff confirming it IS the control,
  and the figure is still passed in off a row the caller has locked. Approving a
  video passes `p_gmv => null` so it can never buy a GMV reward sideways.
- **Order stopped mattering.** Whichever happens last, the tenth approval or the
  confirmation of the claim, writes the bill, because both paths ask the same
  question of the same rows. There is no sequence of clicks that leaves money
  owed on work nobody approved.
- **Taking an approval back withdraws the reward, while it is only owed.**
  `private.withdraw_unearned_awards` deletes the row and writes the creator a
  `reward_withdrawn` event. It is a DELETE rather than a reversal row because
  `contest_awards_money_idx` is unique per (contest, entry, term) and a
  negative row could not sit beside it without dismantling the double-award
  guard. **A PAID award is never touched**, and the count of skipped ones comes
  back so the screen can say so rather than implying money moved.
- **One decision component, two screens.** `ContestVideoDecision` renders in
  the progress queue beside the videos that came with a claim, and again in the
  standalone queue. Drawing the same decision twice is how two screens drift.
- **The standalone queue exists because a decided claim used to hide its
  videos.** `ContestProgressQueue` reads pending claims only, and the audit log
  records a count rather than links, so a video on a settled claim was
  unreachable from anywhere in the product.
- **The queue says what the click will cost** before the button, the same way
  the offer queue says "approving this finishes the job". It reads the smallest
  video term above what is already approved, which is the one the next approval
  would cross.
- `pnpm verify:contests` is 141 checks, twenty of them this feature: confirming
  owes nothing while videos are unwatched, the first approval owes nothing, the
  last owes everything, sending one back withdraws it, the creator is told,
  re-approving owes it again, a PAID award survives all of it, and a creator
  cannot call the review function.
- **Two things that suite caught, both worth remembering.** The recreated
  `review_contest_progress` was RETYPED from its own documentation rather than
  extracted, and wrote `message` where the column is `staff_message` â€” every
  confirmation failed with 42703 â€” while also silently dropping the rule that a
  rejection must carry a sentence. And adding a second queue to the claims
  screen broke a page-wide text assertion that had only ever been a proxy for
  "the row went away"; it now waits for the row itself to detach.
- `node scripts/seed-penetrex-contest.mjs` builds one contest on dev in five
  deliberate states, walking the real functions rather than writing rows.

## One pipeline for every video (2026-08-20)

**Files:** `supabase/migrations/20260820140000_one_pipeline_for_every_video.sql`,
`supabase/migrations/20260820180000_drop_old_performance_arity.sql`,
`supabase/functions/tiktok-sync/index.ts`,
`supabase/functions/enter-contest/index.ts`,
`src/lib/creator/usePerformance.ts`, `src/routes/app/MyNumbers.tsx`
**View:** `creator_videos`

Rashid: *"we are receiving videos from user from 2 channels that is offers and
contest ... when admin approves contest videos only then creators should be able
to see the stats of contest videos."*

**Change rules**

- **`creator_videos` is the union**, offers plus contests, `security_invoker`
  so both tables' policies still decide. Everything in the ad pipeline reads it
  now: the sync's query, `tiktok_days_to_backfill`, and the three
  `creator_*` read functions. The row policy on `tiktok_video_daily` is the
  one exception and is written as two explicit `exists` instead, because a
  policy is the floor everything else stands on and should be readable without
  chasing a view somebody could widen later.
- **Widening three of the four leaves a hole either way**: a video that is
  fetched and unreadable, or readable and never fetched.
- **Deduplicate on `embed_id` before summing anything.** There is no
  uniqueness on that column anywhere, and one creator filing the same video
  against a job AND a contest entry is legitimate. `creator_video_performance`
  collapses to one row per (creator, item) and reports `source` as 'offer',
  'contest' or 'both'. A 'both' video answers to either tab, so each tab's total
  is right on its own and **adding two tabs together is the one sum this data
  cannot support**. Nothing does it.
- **Contest videos carry an `embed_id` at last.** The column existed since
  2026-08-13 and was NULL on every row, because the creator's dialog sends only
  a link and an ad code while the Edge Function and RPC both accept an id nobody
  passed. `enter-contest` derives it from the URL server side and never trusts
  a client-supplied one first: a creator who could name the id separately from
  the link could point their row at somebody else's video. The migration
  backfills existing rows the same way.
- **An id is read out of the link, never fetched.** A TikTok URL carries it,
  which is exact, free, and still works for a deleted post. oEmbed is used
  elsewhere only because the thumbnail and title are wanted too.
- **`create or replace` does not replace a function whose argument list
  changed.** Adding `p_source` to `creator_daily_performance` created a
  SECOND overload, and PostgREST resolves an RPC by the argument names a request
  happens to send, so the suite got the old body and an empty chart under a full
  set of cards. `20260820180000` drops the old arity. Adding a return column
  forces a `drop` and is safe by accident; adding an argument does not.

## The leaderboard (2026-08-20)

**Files:** `supabase/migrations/20260820160000_creator_leaderboard.sql`,
`supabase/migrations/20260820170000_leaderboard_grants.sql`,
`src/lib/creator/useLeaderboard.ts`, `src/routes/app/Leaderboards.tsx`,
`src/components/work/CreatorFace.tsx`, `scripts/check-leaderboard.mjs`

Step 9, unlocked. Rashid: *"it should show the actual money other creators have
made and where do the creator himself stands ... by gmv i mean the sum of the
gmv of all the videos of creator X."*

**Change rules**

- **GMV, and only GMV.** He said it twice, unprompted. Nothing on this screen is
  a payment, a reward or a fee, and none of those words appear on it.
- **It amends D7, and only here.** The contest standing stays anonymous because
  that screen promises in words that nobody can see who anybody else is. This
  one never made that promise. The schema-level prohibition on a contest
  leaderboard in `20260813151702` is untouched and nothing here reads a
  contest table directly.
- **One narrow `security definer` function, never a view.** A view would have
  needed a policy on `profiles` wide enough for one creator to read another's
  row, which is a far bigger hole and would stay open to every later query.
  `creator_leaderboard` returns eleven columns and cannot be asked for a
  twelfth: no email, no brand, no budget, no reward, no role, no tier. The suite
  asserts the column count, not just the absences.
- **`rank()`, not `row_number()`.** Two creators on identical GMV are
  genuinely joint.
- **Only creators with real figures appear**, Rashid's call: a board that is
  three quarters zeros reads as broken, and a zero here means "not measured
  yet", not "sold nothing". Somebody absent is told why at the top.
- **`my_leaderboard_standing` takes no id**, so it cannot be asked about
  anybody else, and the band at the top is drawn from it rather than from
  whichever page happens to be loaded.
- **The percentile is only shown in the top half.** "Top 100% of creators" is
  true and unkind, and it is what last place read before that.
- **`creator-avatars` is readable by any signed-in account now**, a deliberate
  narrow reversal of the 2026-08-19 admin-only decision. Objects are named by
  PROFILE ID, `profiles` still refuses one creator another's row, so there is
  no way to turn a name into a path from the client; the only ids a creator
  holds are the ones the board already showed them. Writing is still impossible
  for everybody.
- **`CreatorFace` moved to `src/components/work/`** because it is now drawn
  on both sides and `src/components/admin/` is closed to creator code by
  `no-restricted-imports`. Duplicating it would have been two ways of drawing
  one human.
- **`revoke all ... from public` also revokes `service_role`.** Same trap
  OPERATIONS records for new tables. The functions worked perfectly for the
  creators they are for and returned `permission denied` to every script.
- **The podium is 2-1-3 side by side and 1-2-3 stacked.** A vertical list
  starting with second place reads as second place winning.
- `pnpm verify:leaderboard` is 34 checks, most of them attacks: the private
  totals function is unreachable as an RPC, a quote in the search is data, the
  page size is capped however big a limit is asked for, a creator still cannot
  read another profile or their own unapproved money, signed-out gets nothing,
  and a creator can sign a face but never write one.

## Many brands, many ad accounts (2026-08-20)

**Files:** `supabase/migrations/20260820200000_close_the_three_leaks.sql`,
`..._20260820210000_money_rows_know_their_ad_account.sql`,
`..._20260820220000_one_brand_one_account_one_owner.sql`,
`..._20260820230000_backfill_floor_and_no_blending.sql`,
`supabase/functions/tiktok-sync/index.ts`,
`supabase/functions/tiktok-callback/index.ts`,
`supabase/functions/tiktok-connect/index.ts`,
`src/routes/admin/TikTokSettings.tsx`, `src/lib/admin/useTikTok.ts`,
`src/lib/creator/usePerformance.ts`, `src/routes/app/MyNumbers.tsx`,
`scripts/check-leaderboard.mjs`, `scripts/check-performance.mjs`

Rashid, before onboarding brands with their own ad accounts: *"there should be
proper matching of the brands with ad account ... their gmv should always be the
sum of every brand every offer/contest they are in ... the creator should never
be able to see the breakdown of other creators. This is production base scalable
saas and money sensitive please be careful here."*

Found by a five-agent audit with a refuter per finding. Twelve claims were
REFUTED and are not bugs; three CRITICALs and six HIGHs were real.

**His four standing rules. Do not re-litigate these.**

1. One brand maps to exactly ONE ad account, never shared either way.
2. Each brand gets its own TikTok Business Center connection.
3. USD only, confirmed with his boss. No FX, no conversion, no rate screen.
4. One video id belongs to ONE creator, permanently.

**Change rules**

- **The money key is `(advertiser_id, item_id, stat_date)`.** It was
  `(item_id, stat_date)` with the advertiser as a plain column, and the sync
  upserts a WHOLE ROW, so a second ad account reporting the same video on the
  same day REPLACED the first â€” usually with zeros, because a report filtered by
  item id answers for every id it is given and an account that ran no ads
  returns nothing. Silent: two healthy runs, correct `rowsWritten`, a $1,240
  day reading $0.00. **Every read sums across advertisers**, which took almost
  no change because they already grouped by item and summed. That is the tell
  that a key is wrong rather than the queries.
- **`brand_id` and `store_id` are ON the money row**, written by the sync
  from the store mapping. It is the only honest answer to "which brand paid me":
  the brand on a SUBMISSION is which brand a video was FILED against, and those
  diverge for a video two brands both promoted. `creator_brand_performance`
  reads the money row; `creator_video_performance` attributes a card to the
  brand that SPENT the most on it, not the first filing.
- **One brand, one ad account, both directions**, by two partial unique indexes
  on `tiktok_stores`, plus a refusal in `tiktok-connect` that names the
  clashing account so an admin reads a sentence rather than a constraint error.
  Penetrex's shop is authorised to BOTH ad accounts, so the settings screen
  shows it twice and mapping both was the obvious, catastrophic click.
- **One video, one creator, by TRIGGER not constraint.** The rule spans two
  tables and Postgres has no unique index across two. It fires on APPROVAL, not
  submission: two creators may both paste a link innocently, and blocking at
  submission would let anyone reserve a video they do not own by pasting first.
  Cross-creator only â€” the same creator filing one video against a job AND a
  contest is legitimate and reports as source 'both'.
- **A token per STORE, not per project.** `tiktok-sync` resolves it through
  `tiktok_stores â†’ tiktok_ad_accounts.connection_id â†’ tiktok_connections`.
  `tiktok-callback` no longer revokes every live connection; it retires only
  one the new grant supersedes. Before that, connecting brand B silently froze
  brand A.
- **The settings screen lists connections, plural**, each with its own
  Disconnect and last-checked date, and Connect stays available as *Connect
  another*. It used to render EITHER Connect OR Re-check, so a second Business
  Center could not be started at all. The pull button is one job for the whole
  project and sits outside the list.
- **The sweep is ordered and shares its ceiling.** `.order('advertiser_id')`,
  a per-store call share so one brand cannot eat the night, a PAGED video roster
  instead of a flat `.limit(2000)` that silently dropped rows and churned the
  fingerprint, and a 95-day floor on `tiktok_days_to_backfill` so a video that
  will never earn stops setting the depth for ever.
- **A sum spanning two currencies reports NULL and renders with no symbol.** USD
  only is the decision; the reads used `max(currency)`, which prints one label
  over a sum of everything. Costing nothing while the answer is USD is the point.
- **The leaderboard gate lives INSIDE the function**, reading the profiles
  table. A grant to `authenticated` is not a permission model: applicants,
  REJECTED applicants and suspended creators all hold it.
- **`creator_avatars` is staff-only again.** The board returns `avatar_path`
  from its own SECURITY DEFINER function and the client signs it; it never reads
  that table, which carries the handle of every applicant ever turned down.
- **Published tables use `replica identity default`.** Row security is not
  applied to DELETE events, so `full` broadcast whole rows. Nothing in
  `src/` reads the old row.
- **`pnpm verify:performance` [3c] proves two ad accounts ADD**: same video,
  same day, two advertisers, creator sees 400 not 100, one video, one day, and
  unchanged when pulled twice. Those ten assertions were green and WORTHLESS on
  the first run, because `check-performance` takes the CONDITION first and
  `check-leaderboard` takes the MESSAGE first. Read the output, not the exit
  code.

## Realtime, and the one rule about it

**Everything that listens to Postgres goes through `joinChannel` in
`src/lib/realtime.ts`. Nothing calls `supabase.channel()` itself.** As of
2026-08-14 that is true of every hook in the product; there are no exceptions
left.

**The bug it exists to kill**, which took the whole page down on 2026-08-13:

```
cannot add `postgres_changes` callbacks for realtime:job-progress:<uuid>
after `subscribe()`
```

`supabase.channel(name)` does NOT always make a new channel. If one with that
name is already open it hands back the EXISTING one, so when two components on
one screen both subscribe, the second calls `.on()` on an already-subscribed
channel, supabase-js throws, and because it throws during render React replaces
the page with an error screen. A creator clicking "Add a video" saw exactly that.

**Unique names are not the fix.** They stop the crash and cause a quieter
problem: N components opening N subscriptions to the same rows, and the first to
unmount tearing the channel out from under the others, because `removeChannel`
does not care who else is listening. `joinChannel` reference counts instead: the
first caller opens and subscribes, later callers add a listener, the channel goes
when the last listener does.

**What that changed when the last eight hooks moved onto it:**

- `useCatalogueLive` **lost its `key` argument**. Three screens passed 'hub',
  'brands' and 'offers' because of a comment telling callers to work around this
  exact footgun. Three subscriptions to identical rows became one.
- `useAllOffers` and `useOfferApplications` now **share the channel name
  `offer-applications:<creator>`**. Both watch one thing, this creator's own
  rows, and they had two names for it. `useOfferApplications` also had the brand
  in its NAME but never in its FILTER, so it opened one subscription per brand
  to the same rows.
- `useMyWork` keeps its own name because it watches a second table.
  `joinChannel` refuses to let two different binding sets share a name, loudly in
  development, and it is right to.

**A filter is load bearing, not tidiness.** `postgres_changes` does not apply row
security to DELETE events, so an unfiltered binding hands the browser the old row
of somebody else's deleted record. Every creator-facing binding carries
`creator_id=eq.<uuid>`.

**Two tables are deliberately OUT of the realtime publication**:
`contest_progress_updates`, because a creator's claimed GMV would broadcast on a
DELETE to anybody who opened an unfiltered channel by hand, and there is no
creator-facing reason to need it live. A decision on a claim invalidates the
query directly instead.

---

## Navigation, and why the shell is a layout route

**Files:** `src/app/router.tsx`, `src/components/layout/ShellLayout.tsx`,
`src/components/layout/ScreenFallback.tsx`, `src/components/layout/AppSidebar.tsx`,
`scripts/measure-nav.mjs`

Rebuilt 2026-08-15. Rashid said at the very start that a laggy app is the one
thing he cannot tolerate, and it is why he refused Next.js. He was describing
this, and it was ours rather than the stack's.

**THE RULE, and it is the whole entry: the URL changes FIRST, the code arrives
SECOND.** React Router's route-level `lazy` does the opposite: it waits for the
module before it commits the navigation, so nothing on screen moves at all until
the download finishes. Measured on the live URL: 291ms click-to-URL cold against
11ms warm, with click-to-URL and click-to-painted the SAME number. That sameness
is why it read as hanging rather than loading. After: **5ms cold**.

- **Every signed-in route nests under `ShellLayout`.** No screen may render its
  own `<AppShell>` again. While they did, the sidebar was part of the thing being
  swapped and a Suspense fallback would have blanked the whole page, which is
  worse than the problem. The Suspense boundary sits INSIDE AppShell for exactly
  that reason.
- **`screen()` in `router.tsx` is `React.lazy`; `lazyRoute()` is the blocking
  one and is for PUBLIC routes only.** The landing page and sign in have no shell
  to hold still, so blocking avoids a flash of empty page.
- **Declare screens at module scope, never inside the route table.** `lazy()`
  called during render makes a new component type every time and React remounts
  the screen.
- **Names are prefixed by side.** There is an app `Brands` and an admin `Brands`,
  an app `BrandHub` and an admin `BrandHub`. Mixing them shows a creator the
  staff screen.
- **Prefetch on `pointerenter`, `touchstart` and `focus`** (`prefetchRoute`).
  Cheap, and the lesser half: there is no hover on a phone, and phones are most
  creators. Failures are swallowed, because a prefetch for a screen nobody asked
  for must never surface an error.
- **The deploy-survival retry is unchanged.** A tab open across a deploy asks for
  a filename that no longer exists; retry once, then reload, at most once per tab
  per minute.
- **`pnpm measure:nav [url]` proves it.** Always measure against the LIVE url:
  localhost has no latency, so "cold" is not cold and the figure flatters.

## TikTok ads connection (2026-08-17)

**What it is.** An admin authorises our approved TikTok Business app once, and
the server can then read the ad spend, revenue and orders behind creators'
videos. This step is the connection and the brand matching only; no reporting
call and nothing creator-facing has been built yet.

**Creators are never told this exists.** They read numbers. No connect button,
no mention of TikTok as a data source, nothing in their nav.

| piece | where |
| --- | --- |
| tables + RLS | `supabase/migrations/20260817172922_tiktok_ads_connection.sql` |
| health view | `supabase/migrations/20260817182000_tiktok_connection_health.sql` |
| TikTok client, region guard | `supabase/functions/_shared/tiktok.ts` |
| account/store sync | `supabase/functions/_shared/tiktok-sync.ts` |
| admin actions | `supabase/functions/tiktok-connect/index.ts` |
| the public exchange | `supabase/functions/tiktok-callback/index.ts` |
| browser calls | `src/lib/tiktok.ts` |
| queries | `src/lib/admin/useTikTok.ts` |
| the screen | `src/routes/admin/TikTokSettings.tsx` (Data â†’ TikTok) |
| the callback page | `src/routes/OAuthTikTokCallback.tsx` (`/oauth/tiktok/callback`, PUBLIC) |
| the suite | `scripts/check-tiktok.mjs`, `pnpm verify:tiktok`, 37 checks |

**Four things about this that are load-bearing and easy to undo by accident:**

1. **`tiktok_connections` has RLS on and NO POLICIES, on purpose.** The token
   reads a client's live spend. Not readable by an admin either, and the suite
   asserts that by signing in as one and trying. Do not "fix" the missing policy.
2. **The call must not leave from India.** Supabase runs a function in the
   region nearest the caller; from Pakistan that is Mumbai, and TikTok blocks
   every Indian IP, answering `code -1 "Client IP address is in banned Country
   list"`, which reads exactly like a bad secret. Callers pin `x-region:
   ap-northeast-1` via `src/lib/tiktok.ts`, and the function refuses before
   calling out if it finds itself in an unverified region.
3. **TikTok returns HTTP 200 on failure.** The verdict is the `code` field.
   `callTikTok` is the only door and treats non-zero as thrown.
4. **`tiktok_stores.brand_id` is nullable and survives a re-check.** The sync
   upserts without touching it, because the mapping is a human decision and
   Re-check must not throw it away.

## Creator ad numbers, My numbers (2026-08-18)

**The moment the product exists for.** A creator opens `/app/numbers` and sees
the spend, GMV, orders and ROI behind their own videos. Two tabs: **Dashboard**
(totals, spend-vs-GMV over time, orders per day, best day, top performer) and
**My content** (a card per video).

| piece | where |
| --- | --- |
| cache + read functions | `supabase/migrations/20260818040000_tiktok_video_performance.sql` |
| the nightly schedule | `..._tiktok_nightly_schedule.sql`, `..._tiktok_schedule_url.sql` |
| the only thing that calls TikTok | `supabase/functions/tiktok-sync/index.ts` |
| creator queries | `src/lib/creator/usePerformance.ts` |
| charts | `src/components/creator/PerformanceChart.tsx` |
| the screen | `src/routes/app/MyNumbers.tsx` |
| the suite | `scripts/check-performance.mjs`, `pnpm verify:performance` |

**The approval gate, added 2026-08-19, is the first thing to know.** Every
function and the row policy filter on `content_submissions.status = 'approved'`.
A creator with three videos waiting to be checked sees no numbers and an empty
state that says so, rather than the old "No videos yet", which would have flatly
contradicted their own Content page. See the Content entry above for why.

**`creator_video_performance` returns one row per VIDEO, not per submission.**
It used to select `cs.id`, and the unique on that table is
`(application_id, video_url)`, so the same video filed against two jobs
produced two rows each carrying the full money, which `MyNumbers` sums into the
four tiles. The chart underneath aggregates `tiktok_video_daily` directly and
does not double count, so the tiles and the chart could quietly disagree.
`distinct on (cs.embed_id)` collapses them, keeping the earliest submission.
Invisible while everything is per-creator, and unavoidable the moment anything
sums across creators.

**Five things that are load-bearing:**

1. **Creators cannot reach TikTok at all.** Not rate limited, not quota'd:
   there is no path. A nightly job (`pg_cron`, 03:20 UTC) pulls each complete
   day once into `tiktok_video_daily`, and every creator screen reads that
   table. This is why the date filter is free and unlimited.
2. **No video id is ever sent from a browser.** The read functions take a date
   range and derive the creator's videos from `auth.uid()`. A client that
   cannot name a video cannot ask for another creator's money. `RLS` on
   `tiktok_video_daily` enforces the same thing a second time.
3. **One API call covers every video for a day**, because the `item_id` filter
   accepts a batch (probed 2026-08-18). So cost is per day, not per creator.
4. **Only MAPPED stores are synced.** Penetrex is visible from two ad accounts;
   asking both would store the same video twice and double its spend. The brand
   mapping decides which ad account a brand's money comes from.
5. **ROI and cost-per-order are never stored.** They are ratios, and a stored
   daily ROI invites somebody to average thirty of them. Revenue over cost,
   computed per range, is right at every zoom level.

**Today is never stored**, because it is still accruing and would be cached
wrong. Charts end at yesterday and the screen says so.

### The Penetrex seed (2026-08-18)

Rashid's real roster, in dev so the numbers can be looked at:
`scripts/seed-penetrex.mjs` (and `--clean`). Four creators, two offers, 46 real
video links. `scripts/backfill-tiktok.mjs <days>` drives the sync in
call-budgeted rounds for a deep history.

Sign in as any of them with `WurxPenetrex2026!`:
`babblingbrookej@wurxseed.test`, `aarontopfinds@wurxseed.test`,
`vivianiempire_@wurxseed.test`, `pandanamonium@wurxseed.test`.

**The submission date is decoded from the video id.** A TikTok id carries its
creation time in its top 32 bits, so no API call is needed and it is exact. It
matters because the creator screen will not let anybody pick a date before their
first video existed, and seeding everything as "today" would collapse that floor.

**Ad status is all-time, never range-scoped.** "Are ads running on my video" is
a fact about the video; answering it from the selected range would flip the
badge as somebody moved a filter. On the real roster 44 of 46 videos carry ads,
so two creators would otherwise be staring at blank cards with no explanation.

**"No ads" does not mean "no money", and the screens must never imply it.**
Confirmed by probe on 2026-08-21: `gross_revenue` on the video report is what
the VIDEO sold, not what its ads sold. Nine of Penetrex's videos earned \$216.92
on a single day with a `cost` of exactly 0.00. So a creator can carry GMV on a
video no brand ever advertised, and we already store it â€” a zero-cost row is a
real row, not a missing one. The opposite reading, that a video without ads has
nothing to show, is the one to watch for in copy.

**A brand's own Seller Center will always read HIGHER than ours.** The store
total for that day was \$2,349.04 against \$2,121.52 across every video, and the
gap is LIVE and product-card selling, which has no video to hang off. Our
figures are per video by design; never describe them, or a leaderboard built
from them, as the brand's GMV.

## Paid Collabs: WurxBase, vendored (2026-08-18)

## Ad spend, ROI and spark codes in Paid Collabs come from EUKA (2026-09-15)

Rashid: *"when euka is giving data we can rely on euka â€¦ let's move with euka
for now"*. For every brand whose TikTok ad account is connected INSIDE Euka,
Paid Collabs shows ad spend and ROI per video and per creator for the month on
screen, plus the spark code.

**How the numbers get there**
- **The sync.** The `euka-ads-sync` Edge Function copies Euka's GMV Max item
  reports into `euka_ad_video_month`: one row per video, campaign, ad account
  and month, and only where money moved. It copies spark codes into
  `euka_spark_codes`. pg_cron runs `euka_ads_run_cycle()` every 5 minutes, and
  staff can also start a run by hand.
- **The screen.** It reads `euka_ad_totals_for_videos(ids, from, to)` and
  `euka_spark_codes_for_videos(ids)` through `collab-ad-figures.tsx`. The rows
  have the same shape as the old `ads_totals_for_videos`, so
  `collab-ad-math.ts` is untouched: ROI comes from the sums, a duplicate link
  counts once, and a dash is never a zero.
- **Access.** Only `is_collabs_viewer()` can read these tables; creators read
  nothing. A manual run is staff-only, because it spends Euka calls.

**Why a sync and not a live call.** Measured on dev that day:
- The first request for a report window returns a 504 after about 45s; the
  same request a few seconds later answers in about 6s.
- One month across every store took 74 calls and 65 seconds.
- The spark export is capped at 150 rows a call and takes about 40s.

So each run is limited to 100 seconds of work and claims units from a queue
(`euka_ad_sync_units`, `euka_spark_sync_days`) under 10-minute leases. It
makes one quick retry when at least 12s remain. A failure waits 10 minutes
before retrying, doubling each time up to 12 hours.

**Rules learned the hard way**
- **Base URL.** GMV Max lives under `https://api.euka.ai/api/v1`, not `/v0`.
- **No paging.** Euka rejects `page` and `pageSize`, even though its spec
  documents them. Each ad account's campaigns are read as three lists (live,
  `STATUS_DISABLE`, `STATUS_DELETE`), each capped at 20. A list shorter than
  its `pageInfo.totalNumber` is recorded in `euka_ad_sync_stores.last_error`.
  Aurelia's ad account reports 81 campaigns and lets us read 43.
- **Summing.** A video can run in several campaigns, and under several
  products in one campaign. The sync sums within a campaign-month, and the
  reader sums across them.
- **Month grain.** The current month, and any month closed less than 8 days
  ago, re-sync daily, because TikTok revises spend for about a week. Older
  months are done. The backfill starts at 2026-06.
- **Spark codes.** They are fetched a DAY at a time for the last 58 days, and
  `capped` marks any day that hit the 150-row limit. A code saved on the row
  always wins; Euka only fills a blank (`wxCode` in WurxUI).
- **Items sold** stays Euka's per-video `items_sold_count`, which counts units.
  The ad report only has orders, not items.
- **Connection status.** A 404 saying "TikTok Ads is not connected for this
  store" is a real answer, recorded as not connected. A timeout is recorded as
  unknown, and the store is looked up again on the next run.
- **The queue hands out the job that has waited longest**, never "newest month
  first". The first version ranked by newest month, and within two hours every
  August campaign for Penetrex and Dr Tobias was stuck. September's own
  timeout retries came back every 4 minutes and always outranked August, so
  August showed nothing. Waiting also cost August the warm answer Euka keeps
  after a timeout. Fixed in `20260915170000_euka_claim_oldest_due_first.sql`.
  **But never-fetched units go before any retry**
  (`20260915180000_euka_claim_pending_first.sql`). With pure oldest-due, nine
  Cutler Nutrition campaigns that time out on every attempt took all four
  workers in every scheduled run for 40 minutes, and "All Products" waited
  behind them.
- **A worker claims one unit at the moment it is about to fetch it.** Claiming
  in batches left whatever a run could not reach leased for 10 more minutes,
  every run. Dr Tobias's August "All Products" was claimed for over an hour and
  never fetched.
- **After 3 timeouts, a campaign-month is read a week at a time and summed.**
  Euka's own 504 says "Narrow the date range", and some large Cutler Nutrition
  campaigns failed every whole-month attempt. Splitting and summing is exact.
  If any week fails, nothing is stored for that month. Timeout retries stay 4
  minutes apart for up to 20 tries, because each try warms more weeks at Euka.
- **Discovery is bounded.** The three campaign lists per ad account are fetched
  in parallel with a 25s cap, and a run that discovers does no other work, so a
  slow store cannot push a run past the gateway's 150s limit. Scheduled runs
  measured 56 to 98s, and none timed out (read from `net._http_response`
  through the management API's `database/query`).
- **A page opened before a month synced keeps its dashes until reloaded.** The
  provider remembers "no figures" per video for that page visit, so a month
  that fills in later needs a refresh to appear.

**Guarded by** `pnpm verify:euka-ads`, plus `verify:collab-ads-ui` for the
screen.

## Top videos total, and videos by posted day (2026-09-15)

Rashid asked for two things. First, the brand page's Top videos strip should
show ten videos, not eight, with "the sum of gmv (new video gmv column)"
beside them. Second, Manage videos should "let them view the videos of a
certain date â€¦ today or any date".

**REPLACED ON 2026-09-16 by three totals (views, GMV, ad spend); see the next
section.** The single total below was the New video GMV column, added up. It
covered every row in the table, not the ten thumbnails, and summed the rounded
per-row values. That last rule is gone: the same video can sit under two
deals, and the column counts it twice.

**Ten 96px thumbnails do not fit beside a total on a laptop.** The first
version let the row scroll, which hid the tenth video under the total at
1500px. The strip is now a CSS size container (`container-type: inline-size`
on `.pc-topvids`) with exactly two shapes:
- over 1290px: full-size thumbnails, the total centred in the space to
  their right
- 1090â€“1290px: thumbnails shrink (`--tv-w`, never below 76px) so all ten
  stay beside the total
- under 1090px: the total goes above as one line and the thumbnails scroll

The total is given 14rem so its caption ("18 of 22 creators Â· May 2026")
stays on one line. The thresholds are that arithmetic: ten thumbnails, nine
gaps, the gap before the total, and the total's 14rem.

It is sized by the strip's own width, not the window's, because the sidebar
and the text-size control both change how much room the strip has. The
total's wrapper is one thumbnail tall, so the card centres on the pictures
and not on the pictures plus their names.

**The posted day is EUKA's**, written onto each saved video as `YYYY-MM-DD`
by the sweep (`buildEukaVideoPatch`). 89% of saved videos carry one: 4,667 of
5,250 on dev on 2026-09-15. The rest are pasted links EUKA has not matched
yet, and no day filter can show those, so the bar states how many there are.
"Today" is the viewer's own calendar day. An empty day names the latest day
that has posts, and one click goes there.

**The list is filtered, never re-indexed.** Every row keeps its index in
`codes`, so an edit or an auth tick made while filtered lands on the right
video. Adding rows or bulk-pasting clears the filter, because a new row has
no date and the filter would hide it the moment it appeared.

**Guarded by `pnpm verify:video-days`.** Every expected number comes from the
database first, and the check proves the modal wrote nothing.

## The public website (2026-09-22)

Built because TikTok rejected the Display API app on 2026-09-15: *"Your website
URL cannot be a landing page or login page. You must have an externally facing
fully developed website"*, and *"The app icon submitted in the Basic Info does
not match the icon displayed on the website"*.

**The pages.** `/` (the marketing page, unchanged), `/creators`, `/brands`,
`/how-it-works`, `/about`, `/faq`, `/contact`, plus the three that already
existed, `/tiktok`, `/terms` and `/privacy`. Each is its own route, lazily
loaded like every other route here, and sets **its own `document.title`** â€”
`SitePage` for the six, and `LegalPage` for the three, which all wore
index.html's title until now.
- **`/brands` is the public page. `/app/brands` is a creator's own hubs**,
  behind the login. Different things, one letter apart in a router file.
- **The copy is in `src/content/site-pages.ts`**, nothing is hardcoded in a
  component, and every company fact (registered name, address, phone, email,
  founders, the headline figures) is copied from wurxmedia.com.
- **`SiteNav` is pages now, not anchors.** It was `#how`, `#platform`,
  `#brands`, which did nothing from any page but the home page. The bar shows
  the six links from `lg` up; below that they are in the menu button, whose
  auto-close on resize moved from 768 to 1024 to match. Apply falls back to
  `/apply` when the home page's form is not on screen â€” it silently did nothing
  on the new pages before that.
- **`SiteFooter` carries the whole site in three columns** (Platform, Company,
  Legal). A reviewer reads a footer to judge how much site there is.

**One icon, everywhere.** `public/favicon.svg` is wurxmedia.com's own
`/favicon.svg`, byte-identical apart from an added `viewBox="0 0 512 512"`.
Without that viewBox the file declares width and height 512 and nothing else,
so asking for 1024 draws a 512 face in the corner of an empty square.
`public/favicon.png` (256px) is theirs too, for browsers that ignore SVG icons,
and `public/tiktok-app-icon.png` is 1024x1024 on white, rendered from the SVG,
for the TikTok portal.

**Guarded by `pnpm verify:site`** (74 checks, signed out, no database): every
page opens with exactly one heading about itself, 120+ words, its own tab title
and no duplicate titles; no header or footer link lands on a dead page; the
phone menu reaches all six; four widths with no sideways scroll; both themes;
zero console errors; and the icon is compared against the **live**
wurxmedia.com file, so the day theirs changes ours fails.

## Client sharing: read-only links into Paid Collabs (2026-09-17)

Rashid: *"a client sharing section which asad and superadmin maybe boss can
manage where they can create a link per brand or maybe multiple brands in one
link ... Clients would need no login at all ... Only read access and only the
brand they have been shared."*

**The shape of it.** `public.collab_share_links` holds a label, the brands, four
section switches, an expiry, a revoked flag and a view count â€” and the link
only as a SHA-256. `public.collab_share_views` records each open, with the
visitor's address hashed. Both tables have RLS on with **no policy at all** and
grants to `service_role` only, so nothing reaches them through the API. The
three doors are `collab_share_create` (returns the link once),
`collab_share_list` and `collab_share_revoke`, all `security definer`, all
ops-and-admin only.

**The client's path:** `/share/collabs/:token` â†’ `ShareCollab.tsx` â†’ POST to the
`collab-share` Edge Function (`verify_jwt = false`) â†’ a projection. The page
holds no Supabase client, no key and no session, and stores nothing in the
browser. It sets `noindex, nofollow, noarchive`.

**What a client sees**, from Rashid's answers that day: brand Budget and
Remaining, videos delivered, views and GMV; the ten top videos; each creator's
name, TikTok, deals circle, deal amount and per-video rate, delivery, views,
GMV and items sold; and each video with its date, views, GMV, items and **spark
code**. Never: ad spend, ROI, allocated, paid, cost per video, payment status,
phone numbers, emails, payment details, internal comments, or any row id.

**A section switched off is absent from the payload**, not hidden in the page,
and `show_videos = false` also strips the spark codes. The same is true of a
brand that is not on the link: its name does not appear in the bytes.

**Unknown, expired and revoked all answer with one 404 and one sentence**, so a
probe cannot tell a real link that expired from one that never existed.

**Month control (2026-09-17, step 2).** `collab_share_links.months` is a
whitelist of `YYYY-MM`; empty means every month. The client's switcher offers
only those months, "All time" on a scoped link means all of ITS months, and a
month asked for outside the list is answered with one inside it rather than
refused â€” a client who edits the URL sees no more than one who clicks. Rashid:
*"we need to have custom control ... like which month data"*.

**The owner's screen** is `/admin/client-links` (`ClientLinks.tsx`, hooks in
`lib/admin/useClientLinks.ts`), a row in the Paid Collabs group marked
`owners: true` in `nav.ts` â€” the group's items are otherwise filtered against
the vendored tab list, which cannot judge a row that is not a tab. ops and
admin only, at the route and again in the database. It makes a link (label,
brands, months, sections, 7â€“365 days), shows it **once**, lists every link with
its scope, expiry and view count, and revokes with a confirm.

**THE CLIENT PAGE IS THE STAFF BRANDS VIEW.** Rashid's boss, 2026-09-17: *"we
need to show them exact same view as we have they will just not be able to see
ad spend and roi at any cost"*. `ShareCollab.tsx` imports `paidcollabs.css` and
our overrides and renders inside `.wurxbase-root`, so it inherits every rule the
staff table uses â€” the five KPI cards with their progress bars, the top-videos
strip, the tier tags, the creator faces (unavatar, by handle), the hire tag. The
column template is set inline because theirs counts twelve columns and this one
has nine: #, Completed on, Creator, Deal, Videos, Total views, New video GMV,
L30 GMV, Items sold.
- **Gone:** Ad spend, ROI, Status, Contract, Actions, and the **deals circle**
  on the face. Ad spend and ROI are not in the payload at all, and neither is
  the status or the deal count (the circle counts OUR deals with a creator,
  which is ours, not the client's â€” Rashid's boss, via Rashid, 2026-09-18). The
  Deal column stays. Nothing on the page writes: no select, no input, no export.
- **The five cards use the staff formulas, not near relatives.** Allocated is
  summed from the rows, Paid is rows whose `payment_status` is exactly `Paid`,
  Cost/video is allocated Ã· committed videos. A client once saw $238 against
  staff's $46 because it divided by delivered; the UI check now compares all
  five cards against the staff arithmetic.
- **Tier and L30 GMV** are read from `collab_share_euka_cache` ONLY; the page
  makes no Euka call. `euka-ads-sync` refreshes that cache, one stale store at a
  time (`refreshOneStaleStore` in `_shared/euka-tiers.ts`), from BOTH exports,
  `creator_level` (30 days, capped at 1000 a store) and `creator_videos`, merged
  across every store. Where neither has a creator, their stored
  `creators.monthly.euka` answers, as it does on the staff screen. Awaiting Euka
  inside the request 504'd twice before this.
- **Videos** open by clicking the row, into a plain panel with the link, date,
  views, GMV, items, product and the spark code to copy.

**Copy again, details, and a new address (2026-09-18).** The link is stored now
(`collab_share_links.token`), so each row on `/admin/client-links` has Copy
link, and opens into the address with Copy and Open, the facts, and the
recent opens (`collab_share_opens`). **Give it a new address**
(`collab_share_replace`) kills the old address at once and keeps the label,
brands, months and view history. Links minted before the change have no stored
address and can only be given a new one; the row says so.

**Guarded by `pnpm verify:collab-share`** (43 checks: the tables are
unreachable, only owners mint, a link opens only its own brands and months,
expiry and revocation bite, and the real phone numbers, emails, payment
details, statuses, deal counts and ad spend figures in the database are absent
from the payload), **`pnpm verify:collab-share-ui`** (32 checks in a browser
with no session: it opens, every figure and all five cards match the staff
arithmetic, no staff control and no deals circle is on the page, a row opens to
its videos, both themes, 390px, zero console errors, and a revoked link says so
in plain words) **and `pnpm verify:client-links`** (18: make, copy, open,
details, new address, stop).

## One TikTok account, one application: the identity ledger (2026-09-28)

Rashid, designing TikTok-first signup: *"the same person should never be able to
apply again"*, and later, *"it should not be permanent, we should let admin
review the rejected again"*.

### Why a second table rather than the connection we already had

`creator_tiktok_connections` already carries a one-account guard, but it is a
PARTIAL unique index `where revoked_at is null` â€” **disconnecting frees the
TikTok account for the next profile.** That is right for "connect your account"
and exactly wrong for "you have already applied": a creator could apply, be
rejected, disconnect, and apply again forever. The rule has to outlive the
connection, the rejection and the profile, so `tiktok_identities` is its own
ledger and nothing in it is removed by a disconnect.

### The four decisions inside it

**ONE FACT, ONE WRITER.** Both routes â€” the existing Settings connect and the
signup flow to come â€” feed the ledger through a TRIGGER on the connections
table, not through a second copy of the logic in TypeScript. Two places writing
one fact is this project's most repeated bug.

**THE GENERATION COLUMN IS NOT BUREAUCRACY.** Production still runs TikTok's
SANDBOX client key, so every `open_id` on file is sandbox-scoped and WILL CHANGE
when the approved key is installed. Without recording which key vouched for an
id, the day it changes is the day the rule silently stops matching anybody, with
no error anywhere. With it, that day is a visible new generation.

**THE UNIQUE INDEX IS PARTIAL, `where released_at is null`.** A plain unique
index would make the release button do nothing at all â€” worth naming because it
is the obvious way to write this, and the check asserts a released account can
genuinely be claimed again.

**UNIQUENESS ON HANDLES APPLIES ONLY TO VERIFIED ONES.** Dev already holds a
duplicate typed handle ("roseamyg3", twice), so a bare unique index would have
aborted the migration on real data. Typed handles keep behaving as they do
today; a handle TikTok vouched for can never collide. `tiktok_handle_verified`
is in no column grant to `authenticated`, so an applicant cannot set it, and a
trigger stops them editing a handle once it is verified.

### Two faults the check found in my own code

**`release_tiktok_identity` refused `service_role`.** `is_staff()` resolves the
caller from `auth.uid()`, which is null for the service key, so every scripted
or server-side release answered "Not allowed". The staff path worked; nothing
else did.

**Its audit row could silently not exist.** The insert was
`insert ... select ... from profiles where id = v_actor` â€” when the actor has no
profiles row, that select returns nothing, the insert writes NOTHING, and the
release still succeeds. A privileged action that quietly leaves no trace is
worse than one that fails, because you never know to look. It is now an
unconditional `values (...)` with scalar sub-selects.

### And one that was already there

`verify:creator-tiktok` has been failing since **2026-09-04** and nobody saw it.
The connect gate was deliberately widened that day to admit applicants (c712f8a,
with the reasoning written in the file: the route that draws the card already
admitted them, so every applicant saw a Connect button and got a bare red "Not
allowed"). The check was last touched on 2026-08-26 and still asserted the old
403 â€” one failing assertion out of 29, in a suite nobody runs on a schedule.

It matters more now than it did: **TikTok-first signup depends on an applicant
being able to connect before approval.**

**Guarded by `pnpm verify:tiktok-identity`** (24 checks): the trigger writes the
claim, a second creator cannot claim the same account, disconnecting does NOT
unbar, a creator cannot release, a release needs a reason, a released account
CAN be claimed again, an applicant can neither set the verified flag nor edit a
verified handle, two applications cannot share a verified handle in any letter
case, and no test row survives. Every assertion reads the blocking row back
before asserting it blocks.

## Add-never-replace was half a rule, and the other half was money (2026-09-28)

Rashid: *"there is a creator on Irwin Naturals with name clarkepayne3.0 ... on
tiktok shop i can see his videos and gmv but just wanna be sure what does reacher
give us"*.

Reacher gave **$1,036.40** across three videos. We had all three videos and
**$0.00** on every one of them.

**THE MAPPING WAS NEVER WRONG.** `toVideoCode` reads `video_gmv` correctly. The
fault was the filing rule: videos were added once and never looked at again.
Reacher's own docs say affiliate data is up to three days stale, and GMV lands
days after a post â€” so a video filed on the day it went up is filed at zero, and
nothing ever went back for it. Across Irwin that was **50 of 52 videos**, and the
brand page read **$34.63** where the truth was **$1,181.44**.

The rule is now: never delete a video, never touch a row another source filed â€”
but REFRESH the figures on the ones that came from Reacher. Numbers only ever
**grow** (`Math.max`), the same rule the screens already use when two rows
disagree, so a short or partly-synced answer can never wipe money that has
already been recorded. A product name fills a blank and never overwrites one.

**Proved by reconciliation, not by the number going up:** Reacher's own GMV for
our Irwin creators is $1,181.44 across 52 videos, and Paid Collabs now holds
$1,181.44 across 52 videos. Difference $0.00.

The same run wrote **164 ad-spend rows** â€” Reacher's per-video ad feed for Irwin
started returning data on 2026-09-28, four days after the account was connected.

**The lesson generalises past this sync.** Any "add, never replace" rule against
a source whose figures ARRIVE LATE is a rule that freezes the first, emptiest
reading it ever saw. The test is not "did we file it" but "does our copy still
equal the source".

## By product, on a brand's page (2026-09-24)

**Redesigned TWICE the same day.** First after Rashid sent a mockup: *"u are
very bad at design see how beautiful this is, i want cards like this"*. He was right. The first
version was three unlabelled numbers in a row â€” legible, and it read as a data
strip rather than as a product. What the mockup had that it did not: labels, a
ghost rank numeral, the photograph given room, one row per figure with a circled
icon, and a bar under the GMV. Labels and vertical rhythm are what make a card.

`flex: 1 0 15.5rem` does two jobs in one line: a brand with two products fills
the band instead of leaving it two thirds white space, and a brand with seven
keeps every card readable and lets the row scroll rather than squeezing seven
into the width of four.

**Then again, an hour later:** *"the current card is taking too much space ...
it's very bad, it can't take too much space but still show counts properly"*.
He was right again, and the fix was the AXIS rather than the type size. The tall
card stacked four labelled figures down the page and stood about 300px high;
laid ACROSS the bottom of a wide card the same four take 206px, and nothing had
to shrink â€” the counts are still the biggest thing on it. The section became
"Product performance" with a count chip, the 2.5rem ghost numeral became a quiet
"Product 01" under the name, and the GMV share bar went.

**IT STAYS ONE ROW, and that is the part worth remembering.** Wrapping the cards
into a grid is the obvious move and makes the complaint worse: seven products at
two per row is four rows, taller than what he was objecting to. The row scrolls,
so the band costs the same height whether a brand has two products or twenty.

**His mockup drew a month dropdown in the section header and it is a static
label instead.** The screen already has a month control that every other figure
on the page obeys; a second one would be a second source of truth for the same
question, and the day they disagreed the band and the KPI cards would describe
different months while looking equally authoritative.

**`flex-basis` stops meaning width the moment the container turns vertical.** On
a phone the row becomes a column, so `flex: 1 0 24rem` gave every card a 24rem
FLOOR ON ITS HEIGHT: correct figures sitting above 250px of empty card. `flex: 0
0 auto` in the phone query is the fix, and the band went from 805px to 450px.

Rashid: *"is it possible to get the product wise gmv, product wise creators and
product wise videos ... a beautifully iconed and pilled style display without
disturbing the ui ... for the current month that user selected"*.

It was possible with no new data at all. **1,042 of the 1,049 videos posted in
September already carry the product they sold**, written by the same EUKA and
Reacher syncs that fill the table â€” so the band is a different reading of rows
the page had already loaded, not a new fetch.

### It reconciles, and that is the only thing that made it worth shipping

`wxProductTotals` dedupes **with the same key and the same rule** as
`wxVideoTotals`, which feeds the GMV card directly above it. On dev a single
TikTok video sits under two deals of one creator 32 times inside one
brand-month; a naive per-product sum would have come out higher than the card it
sits under, and two authoritative-looking numbers that disagree are worse than
one number alone. Proven per brand rather than asserted: Penetrex $1,327 = card
$1,327, Apothecary $949 = $949, Biostime $429 = $429, and the per-product video
counts add up to the Videos card too.

**The seven videos with no product are shown, not dropped** â€” under "No product
recorded". Discarding them is exactly how a breakdown quietly stops summing to
its own total.

### Two mistakes worth keeping

**The labels.** Clipping these titles from the right gave four Penetrex pills
all reading "Penetrex Daily Joint & Muscle Carâ€¦" beside four different GMV
figures â€” identical labels, which is worse than none. The first fix trimmed the
prefix every product shares; it looked tidier and did nothing at all, because
one product is called "NEW! Penetrexâ€¦" and that makes the shared prefix empty.
The label now keeps BOTH ENDS and loses the middle, which needs no assumption
about the naming being tidy: Penetrex's products differ at the tail (", 3 Oz.
Gel"), Irwin's at the head. Full title in the tooltip.

**The pictures arrive late, on purpose.** Videos carry a product NAME and no
product id, so a photograph means matching that name against the brand's own
catalogue â€” a round trip. The band renders at once with letter tiles and
upgrades in place. The match is EXACT and within one brand: anything looser puts
one product's photograph beside another's money.

### Expected videos and ad spend (2026-10-07)

Rashid: *"the videos part must also show the number of expected videos like
shown product wise 5/10 ... and i want the cards to show the summed up ad spend
as well in each card"*. Five figures now: GMV, views, creators, **videos
delivered over promised**, and **ad spend**.

**Ad spend was the easy half.** It shares the GMV's scope â€” this product's own
videos â€” so it reconciles the same way, obeys the month selector through the
same `BrandDrilldown` effect, and costs no new request: the creator rows below
ask for exactly these video ids and the provider caches by `month|id`.

**Expected videos needed a decision, because the data cannot answer it
directly.** A commitment lives on the DEAL â€” "10 videos at $40" â€” and names no
product. So "expected videos for Product 02" does not exist in the database;
only a rule for attributing a creator's promise to the products they posted
for. Two rules were put to Rashid on 2026-10-07 and he chose the first:

- **Every creator who posted for it** carries their WHOLE commitment under that
  product. Same scope as the `creators` figure beside it, which already counts a
  person under each product they touched. The two therefore agree, and a card
  can never show videos against a blank commitment.
- *Rejected:* attributing a promise only to the creator's MAIN product. That
  makes the cards sum exactly to the brand's `314 / 313` KPI, and in exchange
  prints "12 / 0" on every side product.

**So these deliberately do NOT sum to that KPI.** They overlap, exactly as the
creator counts already overlap (NUTRAHARMONY: 19 + 18 + 1 + 1 = 39 for 38
people). An overlap the neighbouring figure already has is a smaller lie than a
denominator of zero under a real delivered count.

### The guard was green while the feature was still loading

`check-product-band.mjs` passed on the first run with **every** Penetrex card
reading "â€“" for ad spend. Nothing was broken: a dash is a legal answer for a
brand with no ad data, and Penetrex's 2,270 video ids are five RPC round trips
at 500 a go â€” far past the 700ms the script waited. The check was green while
the figure it existed to prove had not arrived.

Caught by comparing the band against the **creator rows on the same screen**:
Penetrex's rows were priced ($6,618, $11.25, $30.43 â€¦) while its cards were not.
Biostime's rows were blank too, so its dashes were honest.

That comparison is now the check itself â€” `the band is priced wherever the
creator rows below it are` â€” and it calibrates itself, so no brand is hardcoded
as "should have ad spend" and it cannot rot when an ad account is connected or
dropped. 73 checks, 0 failures, four widths, zero console errors. Penetrex all
time: $45,993 / $17,327 / $5,886 / $2,794 / $996 / $235 / $5.46 across its seven
products.

### The line overlapping the number

Rashid, with a screenshot: *"the line is overlapping the number fix it as well"*.
At five columns the 1.25rem figures were wider than the cells holding them and,
with nothing to stop them, drew straight over the hairline divider into the next
column â€” "133/203" sitting on top of the rule beside it, and the headings
collapsed to "Creaâ€¦" and "Ad sâ€¦".

**Three changes, and the card had to get wider.** The type came down to
`1.1rem`, the cell padding to `0.45rem`, and `flex-basis` went `24rem` â†’
`32rem`. The row still scrolls, so a wider card costs no page width; it shows
slightly fewer products at once, which is the right trade for figures that fit.

**A clipped count is a WRONG number, not a tidy one**, which is why the width
was measured rather than guessed. `overflow: hidden` alone turned Penetrex's
"1296/1828" into "1296/18â€¦", and 30rem still clipped it: that value wants 79px
and the column had 69px. 32rem gives it about 81px. The ellipsis stays as the
last resort for a value nobody has seen yet â€” a bigger text size from the top
bar, a five-digit count â€” so the failure mode is a cut-off figure inside its own
column rather than one drawn across its neighbour.

Checked by geometry rather than by eye: a script walks every `.wx-prodcard-cell`
and asserts no child's bounding box leaves its parent and no `scrollWidth`
exceeds its `clientWidth`. That is what caught the clip the screenshot could not
show.

The pill sits on `--pc-card` (`--wx-surface-1`) because that is the ground
check:contrast section 5 already proves the green GMV ink against; the tinted
`--pc-card-2` would have been a new unproven surface for an ink calibrated
elsewhere, which is a bug this project has shipped before.

**Guarded by `pnpm verify:product-band`** (46 checks): reconciliation against
the card on three brands, a refusal to grade a brand showing no pills at all,
every pill carrying all three figures with creators never exceeding videos,
biggest earner first, and no horizontal page scroll at 375/768/1024/1440. The
responsive pass waits for a pill rather than a fixed pause â€” a fixed wait passed
at two widths and failed at the other two, which read as a layout fault and was
only timing.

## A product is compulsory from October, and videos split but money does not (2026-09-24)

Rashid: *"I want from october and onwards (not before october please) it should
be compulsory to choose the product while onboarding"* and *"we only need one
checkbox and that should be videos, users will only input no of videos that
would be auto sum and amount will be entered manually only"*.

### The date the rule reads is the ROW'S, never the clock's

This is the whole design. The same drawer edits creators hired months ago, so a
rule written as "if today is October, require a product" would start refusing to
save a September row the moment October arrived â€” **hundreds of existing rows
unsaveable because somebody opened one to fix a phone number.** That is exactly
what "not before October please" forbids, and it would have looked like a
database fault rather than a validation change.

So the rule reads `onboarded_on`, the row's own date. A row dated 2026-09-30 is
never asked for a product; move that same row to October and it is, which is
right, because it is then an October deal. `onboarded_on` is always populated â€”
today for a new creator, its own date for an edit â€” and the fallback to today
covers only a hand-cleared field.

### Two live brands have no catalogue, so "compulsory" had to include typing

**COUNT THE BRANDS BEING WORKED, NOT THE NAMES ON FILE.** The first version of
this note said "9 of 44", which was true of the distinct brand names across all
history and wrong about the business: 28 of those 44 are legacy rows with no
hiring date at all, dormant for months. Rashid saw "44" and said, correctly,
*"we have only 11"* â€” the Brands screen lists the brands active in the selected
month, and that is the roster onboarding actually touches.

Measured on 2026-09-24, of the **11 brands active in September 2026**:

| Source | Brands |
|---|---|
| Euka | 8 â€” Apothecary, Aurelia, Biostime, Dr Tobias, Dr. Harvey's, NUTRAHARMONY STORE, Penetrex, Swisse |
| Reacher | 1 â€” Irwin Naturals |
| **Neither** | **2 â€” Aqua Sonic, Pure Daily Care** |

So the gap is two brands, and both are Cruva ones. The escape hatch still
matters â€” the picker has always accepted a typed product, and when a brand has
no catalogue the hint says so â€” but it is the exception rather than half the
roster. The day Cruva is readable the gap closes entirely.

**The lesson is about the denominator.** A count taken from the database over
all time answered a different question from the one being asked, and made a
two-brand gap look like a crisis.

### Videos split per product; the money does not

It shipped on 2026-09-23 as an amount AND a video count per product. That was
wrong and Rashid corrected it the next day. A deal is one sum of money for a
body of work â€” splitting it per product asked whoever onboards to invent an
allocation nobody had agreed, and two typed numbers that must add to a third is
how they come to disagree. The video count genuinely is per product, because it
is what gets delivered, so that is the only thing split. The Amount field stays
typed however many products there are; the Videos field is the computed sum and
cannot be typed over. `deal` still carries one line, `$800 / 14 videos`, which
is what the budget, cost per video, the delivery bar and the brand cards parse.

Per-product `amount` is no longer written to `products` at all.

### The error banner got a `data-wx` hook

Not cosmetic: without one, a check cannot tell *refused with a reason* from
*silently did nothing*, and those are the only two outcomes this rule has.

**Guarded by `pnpm verify:october-product`** (15 checks), which proves BOTH
directions â€” that a 30 September row still saves with no product, and that a
1 October row will not â€” plus that a brand with no catalogue can still comply by
typing. Nothing is written: every save is intercepted, and the absence of a test
row is then proved against the database rather than assumed.

## The products get their photographs (2026-09-24)

Rashid: *"also check if images can be fetcheable for cruva and euka so we can
show images of product in dropdown"*.

**THE PREVIOUS ANSWER WAS TRUE AND STILL WRONG.** It said no picture comes with
a product, and cited real evidence: EUKA's `dashboard/products-performance`
carries a title and twenty figures and no image field, and the one endpoint that
does carry `imageUrl` â€” `social-intelligence/products` â€” is market-wide, and
asked for our own brand id answered with another company's products. Both facts
hold. What the reasoning missed is that **a LIST cannot be trusted here but a
LOOKUP BY ID can**, because the id is ours. EUKA's public spec
(`api.euka.ai/openapi.json`) has two:

```
GET  /social-intelligence/products/{productId}?brandId=â€¦   -> imageUrl
POST /market-intelligence/tiktok/product/detail (need_image: 1) -> master_image_url
```

The second takes a TikTok product id and **nothing else** â€” no brand id, no
store â€” which is how a REACHER brand with no EUKA presence anywhere gets
pictures. Irwin Naturals came out at 11 of 11.

**THE ONE-KEY-PER-STORE RULE IS NOT BENT BY THIS.** `euka-accounts.ts` insists a
store is only ever asked about with the key that returned it, because asking
account A about account B's store fills a brand's screen with another brand's
money. That rule governs STORE data. The market lookup is not store data: it
takes a public product id and returns what TikTok shows the world. The
store-scoped lookup keeps the rule exactly â€” it is only ever called with the auth
that owns the brand id being passed.

**Cached in `collab_product_images`, keyed on the TikTok product id**, because a
hundred products times one HTTP call per drawer open would make the picker
slower than the typing it replaced. A photograph changes about never, so a hit
is kept indefinitely; a MISS is stored too â€” *that* is what stops the same empty
lookup running on every open â€” and retried after a fortnight, since a listing
that went up this week often has no image indexed yet. A lookup that **times
out** writes no row at all, deliberately: a timeout is not a miss, and recording
it would mean believing in nothing for two weeks.

**THE BUG UNDERNEATH THE BUG, worth more than the feature.** The pictures
arrived at the endpoint and the screen went on drawing letter tiles, because
`wxPickable` rebuilds every product into a fresh object and `image` was simply
not among the fields copied â€” the list was written when no product had one. The
same omission sat in `toggleProd`. Nothing errored; the data was right at every
layer and the last one silently dropped it. **A field added upstream is not
added until every rebuild of that object carries it**, and the way to see it is
to read what the browser received rather than what the API returned.

The saved record is unaffected on purpose: `cleanProds` builds its own object
and does not include the picture, so no image URL is persisted where it could go
stale.

**Guarded twice, because a URL is not a picture.** `verify:product-images`
checks the endpoint per platform, and refuses to grade coverage on a brand that
returned no products at all â€” "0 of 0, 100% covered" is exactly the lie this
project keeps catching. It then **fetches** the URLs, because a CDN may refuse a
hotlink. `verify:drawer` closes the loop in a real browser with `naturalWidth`,
after waiting for every image to settle: measuring half a second after the list
opens reports "0 loaded" about pictures that are merely still arriving.

## The sync pill stops quoting a number nobody asked for (2026-09-24)

It read *"Already up to date Â· 207 videos"* and Rashid asked what 207 was. Fair
question: it was every video Reacher holds for the whole shop â€” not this brand's
filed videos, not anything that had just happened, and nothing anyone could act
on. A figure with no owner, sitting where a result belongs. Now it just says
"Already up to date".

## Onboarding is a drawer, and the products are a real dropdown (2026-09-23)

Rashid, after using the first version: *"instead of showing the popup we need to
use drawer which will actually open a side drawer with all options ... for
choosing multiple products the ui is very bad, I said it should be the dropdown
and searchable and it means it should only show the list only when we open the
dropdown, click arrow should close the list ... also use product images ... keep
the font same because boss like small fonts but ui should be perfect ... when
zooming in zooming out drawer should never overlap or miss something"*.

**The drawer** (`wx-drawer` on their own `.pc-modal`, so every rule they wrote
still applies): right edge, full height, header and footer fixed, only the
middle scrolls. Their inline `maxWidth: 620` had to go â€” an inline style beats
any stylesheet.

**IT STARTS BELOW OUR TOP BAR, and that is structural rather than taste.**
`.wurxbase-root` and `.wurxbase-fence` both carry `isolation: isolate`, so the
overlay's `z-index: 1000` is sealed inside Paid Collabs, which sits under our
shell header (`z-40`). A drawer drawn from y=0 had its title and close button
painted over: the DOM was right and the screen was wrong. Raising the z-index
cannot escape a sealed context, and portalling to `document.body` is what left
their overlays unstyled before, so the drawer begins at `--wx-topbar: 3.5rem`,
the shell header's own height, in rem so it tracks the text size and zoom.

**Two mistakes worth keeping:** a `margin-top` above a later `margin: 0` in the
same block is silently undone â€” the drawer went straight back under the bar; and
their `.pc-modal` scrolls its whole box, so without `overflow: hidden` on the
panel the "fixed" header scrolled away with everything else.

**The picker is a dropdown.** A closed trigger saying how many are chosen, a
chevron that turns, and a panel that opens on click and closes on the chevron,
on Escape, on a click outside, and after a pick. Search lives inside the panel.
The chosen products are cards with their picture; the per-product deal rows
carry the same picture, and their first column is `minmax(0, 1fr)` because a
plain `1fr` refuses to shrink below a 120-character product name and pushed the
amount and video fields out of the drawer.

**PICTURES, WHERE THERE ARE ANY.** `ProductTile` draws the image when the source
gives one and a letter tile when it does not, and a broken URL falls back to the
same tile. Today that means letters for most brands, and it is the APIs rather
than us: Euka's product list carries titles and figures and **no image field at
all**, its one endpoint with `imageUrl` (`social-intelligence/products`) indexes
TikTok at large â€” asked for our own brand id it answered with another company's
products â€” and Reacher carries `primary_image_url` only where a shop's catalogue
is populated, which Irwin's is not.

**Guarded by `pnpm verify:drawer`** (78 checks): at 100%, 125%, 150%, 175%, 200%
and phone width it measures that the drawer is at the right edge and full
height, that **nothing is painted over its header** (`elementFromPoint`, which is
what would have caught the first attempt), that Cancel and Add creator are
inside the window, that nothing spills sideways, that the type is still small,
and that the list starts closed, opens on the trigger, closes on the chevron and
on Escape without closing the drawer.

## The product picker on onboarding, and a deal per product (2026-09-23)

Rashid: *"when we onboard a creator we need to write product name â€” we want to
fetch products for that brand from the api so it will show us the dropdown to
choose the product from, we can also search product because list may be long
... if user has chosen only one product it's fine but more than one he may have
different deal of videos and amount on that ... their total sum will be auto in
the row below ... do it for reacher and euka as well"*.

**One door, two platforms.** `collab-products` takes a brand name, finds that
brand's Euka store or Reacher shop, and answers ONE shape â€” `{ id, name, image,
price, status }` â€” so the modal never knows which platform a brand is on:
- **Euka:** `POST /api/v1/dashboard/products-performance`, with the Euka BRAND
  id (not the store id â€” `storeBrandPair` exists because that mismatch is easy)
  and a 120-day window. **`pageSize` caps at 100**; 200 is a 400.
- **Reacher:** `POST /public/v1/products/catalog`. **It is empty for Irwin**, as
  their creator list is â€” that side of their sync is not populated for this shop
  â€” so the fallback derives the catalogue from `/videos/list`, where every video
  carries its product id and name, commonest first. Not a guess: the same
  products, counted from work that was really posted.
- A brand on neither platform is a **fact, not an error**: the typed box and the
  brand's focus products stay exactly as they were. An empty dropdown would
  claim the brand has no products.

**The picker** (`data-wx="product-search"`, `product-list`): the catalogue with
the brand's focus products folded in, every word of the search must match, and
the + button still adds a product nobody has ever heard of. Product names here
are paragraphs â€” Irwin's run to 120 characters â€” so the chips truncate with the
whole name in the hover; theirs had two chips overlapping each other and the
field below.

**A deal per product, once there is more than one.** One product behaves exactly
as it always did. Two or more grow an amount and a videos field each
(`data-wx="amount-N"` / `videos-N`), and the pair underneath becomes the
**total, computed and read-only** â€” two ways to type one number is how they come
to disagree.

**THE TOTAL IS WHAT `deal` CARRIES**, because `deal` is the free text every
other screen parses: the budget, Allocated, cost per video, the delivery bar,
the brand cards, the client links and every check. The split rides alongside on
`creators.products` as `{ name, url, productId, amount, videos }`, which is
additive and ignored by everything that does not know about it.

**Guarded by `pnpm verify:product-picker`** (22 checks): the dropdown is
compared against what the API answers for a Euka brand AND the Reacher one
(both controls fail the run if a catalogue is empty); search narrows it and a
word matching nothing empties it; one product keeps the typed fields; two
produce two rows; the totals are the sum and move as the numbers change and
cannot be typed over; and **pressing Save sends `$800 / 12 videos` with the
split beside it** â€” the write is intercepted in the browser, so the whole path
runs and **no test row ever reaches Paid Collabs**, which the check then proves
by looking.

## Irwin Naturals comes from Reacher, not Euka (2026-09-23)

Rashid: *"there is one brand we have Irwin Naturals, for that brand we have
Reacher api not euka ... we need same operations as we are currently doing with
euka api ... Please do not disturb anything, just for Irwin Naturals"*.

**Reacher is a different TikTok Shop affiliate platform** (reacherapp.com â€” NOT
`reacher.email`, the email checker of the same name, which cost an hour). The
Wurx key sees four shops; Irwin Naturals, shop **12832**, is the only one that
is also one of our brands, and it has no Euka store at all.

**The API, read off their own spec:**
- base `https://api.reacherapp.com/public/v1`
- `x-api-key: rk_live_â€¦` **and** `x-shop-id` on every call. `Authorization:
  Bearer` answers "Invalid token format", which is what a wrong guess looks
  like here.
- most reads are POSTs with a filter body; **`page_size` is capped at 100**, and
  101 is a 422 rather than a truncated page.

**`_shared/reacher.ts` CANNOT WRITE, by construction.** The key is
`can_write: true`, and their write endpoints create GMV Max campaigns, change
budgets and target ROAS, cut creators out of delivery, and send DMs as Wurx.
Every call goes through one allow-list of four read paths; anything else throws
before a request is made. Adding a path is the deliberate act.

**What `reacher-sync` does**, every fifteen minutes (`reacher-cycle` in pg_cron,
secret and URL in the vault, exactly like the Euka job):
1. Reads every video Reacher holds for the shop in a 120-day window.
2. **Files the ones we do not have onto the matching Irwin row**, in the same
   `video_codes` shape the team types by hand, plus `src: 'reacher'` for
   provenance. Matching is by handle, and `tiktok_account` holds a full URL â€”
   comparing that to a handle matches nothing, which once reported "Reacher
   knows 1 of our 19" when the answer was 16.
3. Writes per-video GMV Max spend into `euka_ad_video_month` with
   `source = 'reacher'`, so the brand page's Ad spend and ROI need no new
   query: `euka_ad_totals_for_videos` sums by video id and does not care which
   platform filed the row.
4. Records the run in `reacher_sync_runs`, including failures.

**The three rules that keep it from disturbing anything:** every write is
filtered to `brand = 'Irwin Naturals'`; a video already on a row is left exactly
as it is, ad code and typed figures included (**add, never replace**); and
`dryRun: true` does everything but write. The first live run was taken that way,
and a before/after snapshot of all 1,356 rows proved only Irwin's 7 rows moved.

**THERE IS NO AD SPEND YET, and that is not a fault.** Irwin's shop has zero
GMV Max campaigns connected, so every ad endpoint there is empty and no spend
row is written â€” Ad spend and ROI show a **dash, never $0**, because "nothing
was spent" is not something we know. The campaign count is recorded on every
run, so an empty spend list beside "0 campaigns" reads differently from one
beside "3 campaigns". The day someone connects that ad account, the figures
start filling with no code change.

**A PICTURE FOR A BRAND EUKA HAS NEVER HEARD OF (2026-09-23).** Every brand
face in Paid Collabs is Euka's store photo, so Irwin was a gradient letter.
`public.collab_brand_photos` holds one row per brand NAME â€” name, because Paid
Collabs brands are free text on `wurxbase.creators.brand` and most have no row
in `public.brands` at all â€” pointing at an object in the existing PUBLIC
`brand-assets` bucket. `collab-ad-figures` reads the table once and hands the
map to the vendored app; `BrandFace` uses it **only when Euka has no photo, or
when Euka's own image fails to load**, so no existing brand face changes.
`data-wx-photo` says which source won, which is what the check reads.

Put a picture there with `node scripts/brand-photo.mjs "<brand>" --tiktok
<handle> | --file <path> | --url <address>`. It refuses a brand no Paid Collabs
row carries, anything that is not PNG/JPEG/WebP, and anything over the bucket's
2MB. Irwin's came from their own site: **unavatar has a daily anonymous limit
and the creator-avatar sync had spent it**, which is why `--file` and `--url`
exist beside `--tiktok`.

**THE VIDEOS BUTTON FOLLOWS THE BRAND (2026-09-23).** Rashid: *"when we click
euka videos it says no store found obviously because we are using reacher for
Irwin Naturals"*. That button asked Euka for every brand, and for Irwin the
honest answer was "EUKA answered, but none of its stores is called Irwin
Naturals" â€” a true sentence about the wrong platform. It now reads the brand's
source once on open (`collab-products` with `probe: true`, which skips the
catalogue) and: says **Reacher videos** or **EUKA videos** BEFORE it is pressed,
runs `reacher-sync` or the Euka sweep accordingly, and reports what changed â€”
"Already up to date Â· 207 videos" is the usual answer for Irwin, because the
scheduled run got there first. The strip above the table names the same source
rather than always saying "live from EUKA".

**Guarded by `pnpm verify:reacher`** (28 checks): it reads Reacher live and
**fails if Reacher returns no videos**, because every comparison after that
would otherwise pass on an empty API. Then: every filed video exists in Reacher
with the same views, GMV and items AND is on the creator Reacher credits; no
video is filed twice; **no brand other than Irwin carries a Reacher-filed
video**; no ad row claims Reacher while no campaign exists; the 22,317 Euka ad
rows are untouched; a second run would file nothing; and on the screen the
figures appear while Ad spend stays a dash.

## Search and filter on a brand's own creator list (2026-09-23)

Rashid: *"we need to let users search the creators there should be search and
filter functionality without disturbing ui"*. The Creators tab had both; a
brand's own page had neither, and Penetrex alone lists 41 rows in one month.

**One row above the table**, the same `pc-toolbar` shape the Brands screen and
the Creators tab already use: a search box, a Filter button, and a count.
- **Search** covers name, both TikTok handles, category, product, deal and who
  hired them, from one lower-cased haystack per row built once.
- **Filters:** payment status, videos (still owed / delivered in full), hired
  by, and EUKA tier. Every chip carries its own count, and **only values this
  brand-month really contains get a chip** â€” a filter for somebody who is not
  on the brand is a dead end you can click. `data-wx="brand-filters"` on the
  panel is what the check reads.
- **"Still owed" is the row's own rule**, not a second one: the status flag
  `videos === 'Done'` OR delivery having reached the commitment, so the filter
  and the progress bar in the row can never disagree.

**IT NARROWS THE TABLE AND NOTHING ELSE.** The five cards and the top-videos
totals describe the brand's month, not the rows on screen: a budget that moved
while somebody typed a name would be a different number every time. The count
chip reads "12 of 41 creators" whenever the list is narrowed, so a filtered
list cannot be mistaken for the whole one, and the check compares the cards
before and after filtering to prove they held still.

**Their `statusOf` is not what you would guess**, and the first draft of the
check got it wrong: `payment_status === 'Paid'` is Payment Sent, `videos ===
'Done'` is **Payment Pending** (the videos are in, the money is not), and
everything else is Videos in Progress.

**Guarded by `pnpm verify:brand-search`** (31 checks): every expected set is
computed from `wurxbase.creators` â€” who matches a typed word, who is on each
status, who still owes videos, who each person was hired by â€” then compared
with the screen. A month with one status only, or nobody outstanding, FAILS as
"proves nothing". Also: group headings add up, rows renumber from one, two
filters together narrow further and never wider, the empty state names what was
searched, Reset all restores, both themes open the panel fully on screen, and
five widths keep search and Filter usable with no sideways scroll.

## New Video GMV on the Brands screen, and red ad spend (2026-09-21)

Rashid: *"i want the ad spend column values to be in red color"*, and *"sum
the new video gmv of all the brands and add it in the first row of brand's
main page ... do not disturb UI and be careful on calculations"*.

**Ad spend figures on a brand's page are `--wx-danger`** (`.wx-metric-spend`),
the ink of the Ad spend card above the table. A dash stays grey. ROI is
unchanged.

**The sixth card, New Video GMV**, sits after Videos Delivered, figure and dot
in `--wx-success`. It is computed brand by brand with `wxVideoTotals`
(WurxUI.jsx), the SAME function the brand page's Views and GMV cards now call,
over the same rows each brand page receives (`row.list`). So:
- it follows the month picker and All Time exactly as those cards do, and
  ignores the search box, as the other five cards on that row do;
- each TikTok video counts once per brand (the larger synced figure kept);
- **it is rounded once, from the exact sum.** Each brand card is rounded to the
  dollar, so adding the brand cards by hand can differ by under 50 cents a
  brand. August 2026: the brand cards add to $27,451, the exact total is
  $27,449.47, and the card says $27,449. The hover gives the exact figure and
  says it is rounded once.

**The row now sizes itself by its OWN width, not the window's**
(`.wx-kpis-wrap` is a container, `.wx-kpis-6` answers container queries): six
cards at 54rem and up, three by two below that, two by three below 26rem, and
their own `!important` phone rules still apply at 640px and 420px. From 64rem
the month controls float right and the cards sit beside them, so at a 1440px
window the row is only 771px wide. Their five-card row was sized by the window
and was **already cutting figures off below about 1300px** ("$94,090" in a
63px card at 1024); this fixes that too. Measured: one row of six at 1600px and
up, three by two from 1440 down to 1152, two by three at 1024.

**Guarded by `pnpm verify:brands-gmv`** (34 checks): the card against the
database for a month and for All Time, bracketed for live GMV; every brand in
the month opened and its own GMV card compared with the database, and those
cards added up against the new card within rounding; every ad spend figure red
and no dash red, in both themes; the new card green in both themes; and at
twelve widths, full rows, nothing cut off, clear of the month controls, no
sideways scroll. `check:contrast` section 5 proves the red and green on a
resting row and on a hovered row (their gold wash), both themes.

## Top videos: views, GMV and ad spend totals (2026-09-16)

Rashid, for his boss, in place of the single GMV total: *"3 vertical mini
cards â€¦ sum of views (in blue), GMV (green) and ad spend (red) â€¦ month wise
â€¦ and if he chooses all time show him sum of all time"*.

**They cover every row in the table below**, which the month picker already
scopes: one month, or everything under All Time. They do not cover the ten
thumbnails.

**Each TikTok video is counted once.** The same video sits under two deals of
one creator: 84 times in Penetrex's history, and none in September 2026.
Adding the columns would put Penetrex's all-time views at 10.0M instead of
7.9M, and would count the ad money for those videos twice as well. So a total
can come in under a calculator run down the column, and the hover text says
how many videos were counted once. Where two rows carry different synced
figures for one video, the larger is kept, because views and GMV only grow.
- **Views:** the videos' synced view counts.
- **GMV:** New video GMV (each video's revenue), added up, then rounded once.
- **Ad spend:** Euka's, from the same reader and the same period as the Ad
  spend column (`wxAdsHook`, then `euka_ad_totals_for_videos`), for the
  distinct video ids. While it loads it shows "â€¦". With no Euka data it shows
  a dash, never $0. Two currencies show "Mixed" and are never added together.
  If the load fails it shows a dash, with the reason in the hover text.
  `data-state` and `data-value` exist for the check.

**Colours:** `--wx-info`, `--wx-success` and `--wx-danger`, because he asked
for blue, green and red by name. Each card is an 8% tint of its ink.
`check:contrast` section 4 proves the figure and the label on each tint.

**Layout:** the same container queries as the old total. At full size the
three cards stack in the 14rem column, 39px each, **pinned to the strip's
right edge and centred top to bottom on the whole row of tiles** (Rashid, the
same day: "put them on extreme right please? Also in center"). The old total
centred on the pictures alone, which leaves the cards sitting high beside the
names under them. When the thumbnails shrink
(about 1440px) the cards are 32px each. Below a 1090px strip they sit above
the thumbnails as a row of three, and wrap on a phone. The strip still hides
when no video has GMV in the period (their rule), and the totals hide with it.

**The video figures are live.** The page's Euka sweep writes fresh views into
the rows while it is open: All Time views moved by 73 during one check run.
So the check reads the database before and after the screen.

**Guarded by `pnpm verify:topvids-stats`:** the month and All Time against the
database, colours in both themes, and seven widths.

## Deals badge and the L0â€“L7 tier palette (2026-09-16)

Rashid: beside the L tier tag, "a small circular avatar showing no of deals
with that creator", and "the color scheme of l1, l2 ..l7 tags is not good",
pointing at Euka's own tier tags.

**The badge follows the month picker.** A deal is one row in
`wurxbase.creators`. With a month chosen it counts that month's deals across
EVERY brand, so the same person reads the same on the brand page and the
Creators tab; under All Time it counts their whole history. Rashid asked for
this after seeing the lifetime version: *"month wise brand deals not overal"*.
Brand-and-month together was rejected, because a brand page row IS that
brand's deal for that month, so the circle would say 1 on nearly every row.
People are matched on the trimmed, lower-cased name,
the same key the Creators tab's deals filter already uses. It sits on the bottom-right corner of the
creator's round face (`.pc-facewrap`) on the brand page
(`DrilldownCreatorRow`) and the Creators tab (`CreatorsTabRow`). It shows
even when the person has no tier yet, and never shows a zero.
- **Beside the tier tag was built first and rejected.** It took 31px from
  every name. At 1600px the brand page's names fell from 48px to 17px ("B.."),
  and at 1440px they were already squeezed before it. On the face's corner it
  costs the name nothing, and the check measures that.
- **The badge counts the MONTH, not the tab's own list.** `CreatorsTab` gets
  every row (`allCreators`) and filters it by the chosen month itself, because
  its visible list is narrowed by the search and the filters too, and a circle
  that changed while you typed in the search box would be nonsense. Its
  existing `dealsByPerson` still counts the visible rows, because that is what
  the deals filter chips are about. Two different questions.
- The brand page's `month` prop is already `''` under All Time; the Creators
  tab keeps the real month and a separate `allTime`, so it blanks the month
  itself. Get that wrong and All Time silently shows one month's count.
- The badge is neutral (surface, strong border, body ink) on purpose. The tier
  tag beside it carries the colour, and a second hue would read as a second
  tier.

**One tier palette, and it is Euka's hues:** L1 blue, L2 violet, L3 teal, L4
green, L5 lime, L6 amber, L7 orange, L0 neutral. The team reads tiers in Euka
all day. The inks are tokens (`--wx-tier-0`â€¦`7`, both themes). Every tag and
chip is a 12% tint of its ink on a card with a 40% border
(`wurxbase-overrides.css`, "tier palette").
- **Their v295 block defined a tier palette and then never used it.** Every
  badge and chip rule under it set its own colours, which is how L3 and L4
  were the same brown, and why L5â€“L7 read as warnings. All tier surfaces now
  read one `--t`. The selected tier button in Unique Creators is the ink as a
  solid fill, with `--wx-text-inverse` on it.
- `check:contrast` has a third section: each tier's ink against ITS OWN tint,
  and the inverse label against the solid ink, in both themes. A pair check
  on tokens cannot see a tint ([[ink-on-tinted-surfaces]] in memory).

**Guarded by `pnpm verify:tier-deals`.** Every badge on both screens is
compared with a count made from the database, and in both themes every tier
tag must wear its own tier's token, eight distinct inks.

## Followers on the Creators tab (2026-09-18)

Rashid: *"can we add a new column of followers as well"*, then *"we also need
to have filter so users can filter creators on follower"*, then, on the gaps,
*"is there any other way of fetching their follower count other than euka?
maybe through handle"*.

**The column** (`followers` in `godSettings.js`, after TikTok) and **the
filter** (a Followers section in the Creators tab's existing Filter panel, with
buckets from `WX_FOLLOWER_BUCKETS` and a "No count yet" bucket; Reset all
clears it) both read ONE function, `wxFollowersOf(euka, stored, handles)` in
`WurxUI.jsx`, so the chip counts and the cells can never disagree. It returns
`{ n, source }`:
1. **`shop`** â€” the live Euka shop profiles the tab already sweeps for tiers
   and L30 (the largest figure across stores and both of the creator's handles).
2. **`lookup`** â€” otherwise, `public.euka_creator_followers`, loaded once per
   visit by `collab-ad-figures.tsx` (`storedFollowers`, paged, `found = true`).
The cell's hover names the source, and carries `data-source` for the check.

**Why a second source.** The shop exports describe only creators active in one
of OUR shops in the last 30 days: 380 of 464 people had no count, and none of
those gaps were spelling mismatches. Euka's market intelligence
(`POST /api/v1/market-intelligence/tiktok/creator/rank`) searches TikTok's
whole creator population by keyword and returns `creator_handle` and
`creator_followers`.
- **A search is not a lookup.** Only a result whose normalised handle EQUALS
  ours is stored (`followersForHandle` in `_shared/euka-followers.ts`); a near
  match is somebody else. Where both sources know a creator the two counts must
  agree within 50% â€” the first eleven all did (@dulcedagda: 361,800 shop,
  378,200 lookup).
- **Its required fields were learnt from its 400s:** `region`, `language`,
  `currency`, `date_range` and `sort_field`, which is an OBJECT
  `{ field, type }`, not a string.
- **Filled by the five-minute `euka-ads-sync`**, after the tier cache, when at
  least 40s of the run is left: `fillFollowers` takes four handles (never asked
  first, then the oldest), 1.2s apart, and re-checks each after 30 days.
- **Euka rations fresh lookups.** A handle it has answered before comes back
  at once; new ones, after a few dozen, get `503 "Market Intelligence service
  is unavailable"`. Two failures in a row end the batch. A failure is written
  with `found = false`, the reason in `last_error`, and a `checked_at` that
  brings it back in about a day. Left unrecorded, one failing handle sat first
  in every run and nobody behind it was ever asked.
- The table: `handle` (lower case, no @) is the key; RLS on, SELECT for
  `is_collabs_viewer()`, writes by `service_role` only.
  `euka_followers_for_handles(text[])` is the batch reader.

**Probe by hand:** the staff-gated `euka` function takes
`{ "type": "micreator", "keyword": "<handle>" }` and returns Euka's raw answer
with its status.

**Guarded by `pnpm verify:followers`** (16 checks). The expected numbers come
from Euka through the `euka` function and from the stored table, NOT from the
screen. It waits for the app's own "sweep complete" marker
(`wurx_euka_l30_v10` in localStorage, `complete: true`) before comparing. It
also checks that a bucket filter leaves only creators in that bucket and really
narrows the list, that "No count yet" leaves only dashes, that no name is
squeezed under 40px, no sideways scroll, and that the two sources agree where
both answer.

## Euka: as many accounts as we hold keys for (2026-09-09)

One Euka key can cover many brands â€” ours covers **ten** â€” but a brand can
also arrive with an account of its own. Nutra did: a separate account whose
key returns exactly one store, `NUTRAHARMONY STORE`, invisible to our
existing key.

**Keys are a list now, and one rule keeps the data honest:**

> A STORE IS ONLY EVER ASKED ABOUT WITH THE KEY THAT RETURNED IT.

Never a fallback, never "try the other one". Asking account A about a store
owned by account B is how one brand's screen fills with another brand's
numbers, and on this product those numbers are somebody's commission. An
unknown store is **refused**, not guessed at.

**Adding brand number twelve is a secret change, not a code change.**
`EUKA_API_KEY` keeps its exact meaning and stays first, so a deployment
that never sets the new variable behaves identically to before. Extra keys
go in `EUKA_API_KEYS`, comma or whitespace separated:

```
supabase secrets set EUKA_API_KEYS=key1,key2 --project-ref <ref>
```

**A key that fails is COUNTED, not swallowed.** If one account is down its
stores vanish from the merged list, and a caller looking for one of them
would otherwise be told "no such store" â€” a lie about the brand instead of
the truth about the account. The store list carries `accountsUnavailable`,
and the per-store refusal says which of the two happened.

**The brand name still has to match a store name**, through
`eukaStoreForBrand`: normalise, exact, else a unique prefix match. A Paid
Collabs brand called "Nutra", "NutraHarmony" or "Nutra Harmony" all resolve
to `NUTRAHARMONY STORE` and nothing else competes.

**Guarded by `pnpm verify:euka-accounts`** â€” asserts all ten original stores
are still listed and still answer with real data, that the new one does too,
and that an unknown store is refused rather than served by some other
account.

**One transient worth knowing:** a Penetrex full-window call once took 150s
and died with a 546, then succeeded twice in ~9s with no code change. Euka
is occasionally slow on a large export; a 546 here is not automatically a
bug in this function.

## A field is not a highlight (2026-09-03)

Our override painted every Paid Collabs input `--wx-surface-2`. In light that
is #f0ede8 on a white card â€” **a grey band behind text, which is what a
SELECTION looks like**, and that is exactly how Rashid read it.

**`--wx-field` now, and it has two right answers**: white in light, where the
edge does the work, and a real well in dark, where a border alone on
near-black does not read. Both defined in `tokens.css`; parity guard passes.

**Two inputs are deliberately NOT fields.** This rule has twice built the
box-inside-a-box Rashid objected to â€” the angle cells and the sheet figures
were already exempt, and the top-bar month picker is the third: it sits
flush inside a pill that already draws the surface and the edge. It is now
named `pc-chrome-input` rather than discriminated by `type="month"`, because
the budget editor has a real month FIELD that must still look like one.

## The notifications were never hidden (2026-09-03)

The panel opens on screen, on top, in the right colours, in both themes â€”
measured, not assumed. **What was invisible was the unread marker**: a 9px
dot painted in `--wx-danger-soft`, a 10% wash meant for surfaces, ringed in a
hardcoded `#30271C` that is a dark smudge on a light top bar. Solid
`--wx-danger` now, ringed in `--wx-bg`.

The four header buttons were `--wx-surface-2` at **10% on transparent** with
cream literals hardcoded in their JS hover handlers. Tokens now.

**Guarded by `pnpm verify:collab-chrome`**, and half of it is a SOURCE scan on
purpose: these were inline styles and JS hover handlers, which no rendered
check can see while the unread count is zero.

## The EUKA button now names its own fault (2026-09-03)

`eukaJson()` returns null on every failure â€” the right contract, since all
their call sites degrade on null. But the EUKA videos button turned that
null into `No EUKA store named "<brand>"`, so **six different faults arrived
as one sentence that names the brand and blames the data**:

| what actually happened | what it used to say |
| --- | --- |
| request blocked before it left the browser | No EUKA store named X |
| session rejected by the server (401) | No EUKA store named X |
| account not on the EUKA allow-list (403) | No EUKA store named X |
| function not deployed (404) | No EUKA store named X |
| `EUKA_API_KEY` unset (500) | No EUKA store named X |
| EUKA itself down (502) | No EUKA store named X |
| the brand really has no store | No EUKA store named X |

`lastEukaFailure()` in `supabaseClient.js` now keeps the reason and the
button prints it in the drilldown, where a sentence fits. The genuine
no-store case lists the stores EUKA actually returned, so a name mismatch
is visible rather than inferred. **The null contract is unchanged.**

**Errors stay up 22 seconds, not 7.** Seven is right for "Already up to
date" and useless for a reason, and Rashid cannot open a console â€” the
screen is the only channel there is.

**Two theories were tested and both were wrong.** A full localStorage:
filled to the quota, the app carried on, no error. A dead-but-present
session: the app signs you out and returns to login rather than showing
this. Neither explains a profile that fails while a fresh profile on the
same laptop works â€” which is why the fix is to make the screen say what
happened rather than to guess.

**Guarded by `pnpm verify:euka-errors`** â€” forces all four causes with
request interception and asserts each names itself and that none of them
says "No EUKA store named".

## Creative angles are scoped to a MONTH (2026-09-03)

An angle test lives in **one brand in one month** â€” comparing a September
hook against a January one measures the season, not the hook. They are
stored in `wurxbase.activity_logs`, `action = CREATIVE_ANGLE`, one row per
`Brand::YYYY-MM`, and read through a localStorage mirror that `fetchAngles()`
fills once at boot.

**They are fully shared and always were.** Asad reported he could not see
the tests Masifa set up; it was read as an access problem and it was not.
He is superadmin with nothing withheld, all seven staff accounts are `ops`
and active, and reading as him returns all six rows. His browser already
held every one.

**The screen was the bug.** Every test is August; the report opens on the
CURRENT month. He was looking at an empty September that said only "start
your first angle" â€” nothing on it hinted four tests existed a month back.
Every empty state now lists the tests that DO exist (brand Â· month Â· count)
and one click goes there.

**Wire the month jump through `WurxUI.jsx`, not `App.jsx`.** App has its own
`dateFilter`, but Paid Collabs renders reporting via `reportingNode` and
hands it a filter DERIVED from WurxUI's `month`/`allTime`. Setting App's state
changes nothing on the screen people use. Wired wrong first; the browser
check caught it because the click left the header on September.

**Guarded by `pnpm verify:angles`** â€” signs in as the superadmin and as the
IPC who wrote the tests, opens on the empty current month, and asserts both
that the screen says where the tests are and that one click renders them.

## Roles, and what each one reaches (2026-09-02)

Eight roles. **The model is allow-list throughout**, which is the single most
important thing to know: a role that exists but is named nowhere can read and
write nothing, so adding one is safe by construction.

| role | reaches |
| --- | --- |
| `admin` | everything Â· Paid Collabs superadmin |
| `ops` | the admin app Â· Paid Collabs admin |
| `creator` / `applicant` | the creator app |
| `creative_strategist` | /studio |
| `ads_manager` | STAFF since 2026-09-15: everything `ops` reaches Â· Paid Collabs superadmin |
| `affiliate_team_lead` / `operations_lead` | Paid Collabs only, READ only |

**Never add a role to `public.is_staff()` to let somebody SEE a screen.** It
guards SEVENTY policies across creators, applications, offers, contests,
brands and TikTok money, so it means "is staff" and nothing narrower. The
read-only roles use `public.is_collabs_viewer()` instead â€” one schema,
SELECT only; writes to wurxbase still answer to `is_staff()`.

### Ads Manager became staff (2026-09-15)

Rashid: *"ads manager will have the same edit access as asad and rashid has
which means they can edit anything"*, and asked whether that meant Subhan
or the role, he chose the role. So `ads_manager` is in `is_staff()` now,
deliberately. The rule above is about people who only read; this is the
owner deciding who is staff.

**"Staff" is written in THREE places and they must agree.**
`pnpm verify:role-gates` asserts it from source:
1. `STAFF_ROLES` in `src/lib/auth/auth-context.ts`, which the router, the
   sidebar and the Paid Collabs identity hook all read.
2. `public.is_staff()`, plus the definer functions that read `profiles.role`
   themselves: `assert_active_staff`, `review_application`,
   `refresh_content_preview` and `is_approved_creator`. All are in
   `20260915120000_ads_manager_is_staff.sql`.
3. The hand-typed staff test in each Edge Function: manage-brand,
   manage-contest, manage-content, manage-offer-application,
   review-application, sync-creator-avatars and tiktok-creator. Euka
   already admitted the role.

**Admin-only stays admin-only** (`jwt_role() = 'admin'`): editing other
people's profiles, TikTok connection health, and TikTok ads connect/sync.
Asad is `ops` and does not have these either.

**Inside Paid Collabs `ads_manager` maps to `superadmin`.** Asad carries that
role through his `app_users` row, and Rashid through `admin`. It opens
everything that goes by role: every edit, Payment Sent, and Delete in the
creator editor. Two deletes check a username rather than a role
(`isAsadActor()`): the row trash icon and the performance matrix delete.
They stay Asad-only, for Rashid too. That was decided on 2026-09-02 and was
not reopened.

**`review_application` now refuses to review ANY team account**, the two
read-only roles included. Approving a stray application can never turn a
colleague into a creator.

**Proven by** `pnpm verify:ads-manager`. It runs 19 checks: an Ads Manager
reads every staff table, writes a Paid Collabs deal as a no-op, and passes
the manage-brand gate, while the same probes refuse an Affiliate Team Lead.
`pnpm verify:ads-manager-ui` is the browser half. To create an account:
`pnpm staff:ads-manager <email> <password> [name]`.

**Adding another role of this kind**, in order: the enum value in its OWN
migration (Postgres will not let a new label be USED in the transaction that
added it), then name it in `is_collabs_viewer()`, then add it to
`COLLABS_ONLY_ROLES` in `src/lib/auth/auth-context.ts` â€” the router, the
sidebar and the Paid Collabs identity hook all read that one list. TypeScript
then names every exhaustive role map needing an entry.

**Export and print are a FLOOR.** `forcedPermsFor()` runs after the role
grants and after any `app_users.custom_perms` override, so a mistaken grant
in Access Control cannot open a CSV of creator earnings.

**The read-only roles do not inherit from `app_users`.** Staff do (Asad's eight, and Ads Manager), which is the
point of that lookup; for these an inherited `role: 'admin'` would silently
promote a read-only account to full edit on money.

### What "viewer only" actually took (2026-09-02, later)

Rashid asked whether the three could change a deal's STATUS, having
refused to click it on live rows to find out. They could not â€” but the
question found four things that were true and one that mattered.

**The status dropdown opened for them.** `WurxStatusDropdown` had no gate
at all; only the "Payment Sent" OPTION was gated. The write was refused at
two layers below it, so nothing was ever at risk, but on a money screen a
menu that opens reads as permission for the moment before it scolds you.
It is a plain `<span>` pill now for anyone without `canEdit`.

**EVERY EXPORT PATH WAS OPEN, and export is the one thing the database
cannot refuse.** The rows are already legitimately on screen; the CSV is
built and downloaded entirely in the browser. `forcedPermsFor()` withheld
`canExportCsv` correctly and `App.jsx` honoured it â€” but App.jsx is the
OLD screen. `WurxUI.jsx`, the one people see, never asked. Seven paths
were open: brand budgets, the full deal table, the outreach list WITH
EMAIL ADDRESSES, discovery, the leaderboard and two clipboard copies. All
seven now go through `canExport()`, at the button AND inside the function.

**A permission helper read from a React effect is null on first paint.**
`_actorUser` is a module variable set by `setAuditActor` in a `useEffect`,
and an effect that sets no state triggers no re-render. While it only fed
`logAudit()` that cost an attribution; the moment the new gates read it,
a stale null would have stripped ADMINS of their controls until some
unrelated fetch re-rendered them. It is now set during render as well.

**The browser check was a denylist and it passed on both holes.** It held
a list of button labels somebody had thought of ("save", "delete",
"export"â€¦) and passed anything else, and it ran on the creators tab only.
The status pill's label is the status itself, and the Brands tab was never
looked at. It is an ALLOWLIST across all six tabs now, plus the brand
drilldown and the angles tab, and it asserts the ADMIN side too â€” a gate
that over-fires is as much a bug as one that never fires. 42 checks became
116.

**A contrast bug surfaced that had always been there.** The Reporting
hero's downward-delta chip inks itself in `--wx-text-muted` on a danger
wash: 4.35:1 dark, 3.51:1 light. It only renders when a month is DOWN on
the one before, so every previous run had nothing to measure and reported
green. Now `--wx-danger` on `--wx-danger-soft`, matching its own sibling.

**Verified by `pnpm verify:collabs-viewer-rls`** (attacks the database as each
role with a real session) **and `pnpm verify:collabs-viewer`** (the browser
half: menu, typed URLs, no write control, zero console errors).

### One canvas, all the way down (2026-09-01)

**Every full-height surface in Paid Collabs paints `--wx-bg`.** There are
three of them stacked: our `.wurxbase-root .wurxbase-shell`, their
`.app-root` (min-height 100vh), and their `.pc-app`. Their content is
often shorter than the shell, so whenever those three disagree about colour
the difference shows as a band across the bottom of the screen.

**The correction lives in `wurxbase-overrides.css` and must satisfy three
things at once:** more than one class of specificity, `!important`, and it
must name `.app-root` â€” that is the element covering the visible area, and
a rule written only for `.wurxbase-root` leaves the band exactly where it is.

**Verify with `pnpm verify:collab-canvas`** (86 checks). It measures every
tab in both themes TWICE â€” once at 1.2s and once at 12s â€” because the fault
is loudest while their content is still short, which is precisely the
screenshot that was reported. It asserts that the empty region BELOW their
app is the page canvas, and deliberately not that the page shows a single
colour: a tall white card on Brands is not a seam.

### The performance sheet (2026-09-01)

The brand drilldown on the Performance tab: a hundred creators down, ten
months across, every cell an editable GMV and ad spend. It is the densest
surface in the product and the only one that is almost entirely numbers.

**Its geometry lives in `WurxUI.jsx`, its paint in `wurxbase-overrides.css`.**
`FROZEN_W` 344 Â· `MONTH_W` 184 Â· `SUM` 82/152/152/58. The month width is
not a taste decision: two figures share it, and each half must hold
**123,456.78** â€” a six-figure month, not the largest number in the database
today. At 170px each half had 53px for a value measuring 61 and every
five-figure GMV printed short.

**Structure comes from rules, never fills.** White ground, a hairline to the
left of each month, a 4.3% band (`--wx-sheet-band`) on alternating months so
the eye can run across, a faint wash (`--wx-sheet-summary`) on the three
total columns, green GMV and red ad spend right-aligned on tabular numerals.
A sealed month â€” before the creator joined â€” is a faint padlock on nothing.
Anything that starts filling cells again is a regression.

**The identity column is sticky, 344px, and does not shrink until 900px.**
Below that the handle goes and it halves. The width is `--mx-frozen-w`, read
by the grid template, so breakpoints stay in CSS.

**The sheet opens on the newest month**, measured off the last header tile,
not by scrolling to the end â€” the end is the total columns, and scrolling
there pushes every month off-screen.

**The pinned header is a fixed mirror, and it tracks `.wurxbase-fence`.**
Sticky cannot reach the viewport from inside a horizontal scroller, so they
clone the header into a fixed bar. Two things it needs in our shell that it
did not need in theirs: a scroll listener on the fence (the window never
scrolls here), and its `scrollLeft` synced when the clone MOUNTS, or it
opens at column zero over a body scrolled elsewhere.

**Verified by two suites, and both were extended to see it at all:**
`pnpm verify:collab-controls` now asserts no figure is clipped, that a cell
holds the reference number, that the totals receive their own clicks and that
the page never scrolls sideways, at 1500/1280/1024. `pnpm verify:collab-contrast`
now OPENS a brand â€” it only ever measured the brand list, 157 headings, and
reported the tab green â€” and reads `input` VALUES, which have no text node and
so had never been measured once. Together they found 60 real contrast
failures on first run.

### Where their overlays go, and why it matters (2026-08-31)

**Three elements, three jobs, and mixing them broke half the controls.**

| element | job |
| --- | --- |
| `.wurxbase-root .wurxbase-shell` | carries the class their CSS is fenced under |
| `.wurxbase-fence` | the scroller |
| `#wurxbase-portal-host` | where every overlay is portalled |

**Every `createPortal` in the vendored tree goes to `wxPortalHost()`, never
`document.body`.** `document.body` is outside `.wurxbase-root`, so their own
fenced rules cannot reach it and the overlay renders with NO styling â€” which
looks exactly like a control that does nothing, not like a bug.

**The fence must never be a containing block.** No `transform`, no
`contain`. Their contract and creator editors render INLINE, so no portal
reaches them; inside a containing block their `position: fixed` is measured
against a scrolled box and the dialog opens off-screen, then drags the page
to the top as the browser scrolls its autofocused input into view.

**A track carrying a control needs a `minmax` floor.** `.pc-cell` centres
and does not clip, so a starved column spills into its neighbours and
whichever element is positioned wins the click. This is the failure mode to
suspect whenever a control "does nothing" â€” check `elementFromPoint` at its
centre before anything else.

**Verify with `pnpm verify:collab-controls`** (21 checks). It asserts on HIT
TESTING and POSITION rather than existence, because in all three of the bugs
it was written for, every element existed, was visible, and was correctly
styled the whole time.


### Where the Euka figures come from (2026-08-29)

Every Euka-derived number on these screens â€” last-30-day GMV, creator tiers,
brand photos, posted videos with their views and revenue, per-creator
engagement, and the whole Discovery pool â€” arrives through **one Edge
Function**, `supabase/functions/euka`, reached from the seam as
`eukaJson({ store, type, from, to, handle })`.

**It replaces a Netlify function that never came with them.** Their app
fetches `/.netlify/functions/euka` in twelve places. That function lived only
in the original developer's Netlify deployment; the vendoring copied their
`src/` and a Netlify function sits outside it. On Vercel the path 404s, and
every call site is written as `.then(r => r.ok ? r.json() : null)` â€” so
NOTHING ERRORED and every one of those figures was simply absent for eleven
days. The visible symptom was a red pill on a brand: `No EUKA store named
"Swisse"`. That is one missing endpoint, not a dozen bugs.

**Six modes, and their shapes are load-bearing.** A dozen call sites in code
we do not own destructure these by key, so a renamed key is a blank column
rather than an error:

| call | returns |
| --- | --- |
| `eukaJson()` | `{ range, stores: [{id,name}] }` |
| `eukaJson({store})` | `{ range, handles, profiles, shop }` |
| `eukaJson({store,type:'videos'})` | `{ range, videos, avatars, brandPhoto, tiers }` |
| `eukaJson({store,type:'cvideos',handle})` | `{ range, videos: {handle: rows} }` |
| `eukaJson({store,type:'discovery'})` | `{ range, people }` |
| `eukaJson({store,type:'photo'})` | `{ photo }` |

**NOT EVERY BRAND HAS A STORE, and that is not a bug.** Euka has ten stores;
Paid Collabs tracks thirty brands. Six match. A brand with no store shows no
Euka figures because there are none to show. The match is by name â€”
normalised, then a UNIQUE prefix in either direction, which is how the brand
"Swisse" finds the store "Swisse Wellness". An ambiguous prefix matches
nothing on purpose: it will not guess between two stores.

**Three things are deliberately different from theirs.** The API key is a
function secret rather than a string literal in a committed file. The caller
is verified and must be staff â€” theirs answered `*` with no Authorization at
all, and `type=discovery` returns creator email addresses and phone numbers.
And it takes a POST, because `functions.invoke` sends one and gets the session
token attached for free.

**Their 60-day cliff is real and undocumented by them.** The export returns
ZERO ROWS, with a 200, for a range wider than about sixty days â€” which looks
exactly like "this brand has no videos". Every window is clamped to 55 days
and callers needing more history sweep several.

**Verify with** `pnpm verify:euka` (every mode against live Euka, plus the door:
a creator and a signed-out caller are both refused) and `pnpm verify:euka-ui`
(the red pill is gone from a real browser, and a brand photo rendered).


### The team, and how somebody is recognised (2026-08-29)

**There is no password anywhere in this feature.** Their sign-in went on
2026-08-28; the `password` column went on 2026-08-29, and so did the five
hardcoded logins that had been shipping in the browser bundle. `pnpm
verify:isolation` fails the build if a `password:` or `.password` appears in
the vendored tree again.

**A person is matched by `wurxbase.app_users.hub_email`** against the address
they signed in to the hub with. That row supplies their WurxBase role and
their per-person overrides â€” never our role, because ours would make every
`ops` account their `admin`, full edit on deals and money, and two of their
eight people are viewers. Our role still decides whether somebody reaches
/admin/collabs at all; that gate is ours.

**NOTHING MAY MOUNT THEIR APP UNTIL `useWurxbaseIdentity().pending` IS
FALSE.** Their App reads its session once, in a `useState` initialiser, and
never looks again. Mount it during the lookup and it takes the fallback role
â€” the wider one â€” and the correction that arrives 200ms later reaches
sessionStorage and nothing else. The sidebar stays right, because it reads
the hook live, so the menu is correct while every button on the screen is
not. This was live for a few hours on 2026-08-29 and no guard noticed.

**A row with no hub email falls back to the derived role, which is the more
generous answer.** That is safe only because the route guard sits above it,
and it is why the Team screen shows "no hub email" in red on every unlinked
row. Fill them in at: the gear -> User Management -> pencil -> Hub email.

**The gear IS the way into Settings.** Their panel opened from the user chip;
our chrome hides that chip, which silently closed User Management, Access
Control and God Mode along with it. The gear sits beside the bell and appears
only for somebody who has something behind it. If it ever disappears, those
three screens disappear with it, and nothing else will say so â€” `pnpm
verify:wurxbase-team` checks it for exactly that reason.

**No Sign out lives in here.** One session, the hubâ€™s, ended from the hubâ€™s
own top bar. The two that used to be here cleared the vendored appâ€™s stored
user and left a blank screen behind, with the person still signed in.

**Ink on a tinted chip is `--wx-text`.** `--wx-text-faint` is calibrated
against `--wx-bg` and measures 4.02:1 on a warning-soft pill. Thirty labels
across these six screens were that one mistake. The chip keeps its hue; the
text stops competing with it.


The whole WurxBase dashboard runs inside our admin at `/admin/collabs`, sidebar
item **Paid Collabs** under Data. **Admin only**; no creator nav mentions it and
no creator route reaches it.

| piece | where |
| --- | --- |
| their app, verbatim | `src/vendor/wurxbase/` |
| the seam | `src/routes/admin/PaidCollabs.tsx` |
| our corrections | `src/routes/admin/wurxbase-overrides.css` |
| the header, ours | `src/routes/admin/wurxbase-chrome.css` |
| shooting it | `scripts/shots-collabs.mjs` |
| the fence | `wurxbase-fence` in `src/styles/global.css` |

**`src/vendor/wurxbase/` is a verbatim copy and stays one.** Rashid's
instruction: the code, features and logic change by not one line; only the look
is ours. Not converted to TypeScript, not refactored, not linted to our rules.
Three files are `.jsx` because Vite will not parse JSX out of a `.js` file, and
their CSS sits beside them so every import resolves unchanged.

**Their CSS is fenced under `.wurxbase-root`.** All 28,000 lines were rewritten
by a postcss pass, because they style `body`, `*` and bare elements and would
otherwise restyle the whole product permanently the first time anybody opened
the page â€” a lazily loaded chunk injects its CSS and never takes it back.

**Scoping a selector does nothing about `position: fixed`.** Their shell is
fixed, so it covered the window and swallowed clicks meant for our sidebar. The
wrapper carries a `transform`, which makes it the containing block for fixed
descendants.

**The reskin was a codemod**: 4,673 colours and 700 font stacks onto
`var(--wx-*)`, mapped by the property each colour sits on, so their screens
follow our light and dark modes and our text-size control.

### Three rules for changing the look in here

**1. Doubling the class, not `!important`, is how our CSS wins.** Their
stylesheet ships inside the lazily loaded vendor chunk, so it is injected AFTER
whatever `PaidCollabs.tsx` imports. A rule of ours written `.wurxbase-root .x`
has the same specificity as theirs and therefore LOSES on order. Write
`.wurxbase-root.wurxbase-root .x`. This was found the expensive way: a status
palette that was correct in the source and had no effect on the screen.

**2. `!important` is only for their inline styles.** Their header is drawn from
`style={{}}` objects, roughly forty hardcoded colours the codemod could never
see, and an inline style beats any stylesheet. Their hover handlers write inline
backgrounds too, so hover has to be restated in CSS rather than left to their
JavaScript.

**3. Never let them own `<html>`.** Their `applyPrefsToDOM` writes
`data-theme`, `data-accent`, `data-density`, `data-radius` and
`data-motion` onto the document element, and `data-theme` is the attribute our
entire palette switches on. Theirs defaults to `light`, so opening this screen
turned the whole admin light and it stayed light after leaving, because our
provider only writes that attribute when the theme changes and nothing had
changed. `PaidCollabs.tsx` reclaims it with a MutationObserver and mirrors the
other four onto the fence, where their scoped rules read them.

### Two things to know before changing anything

**1. Their anon key ships in our bundle, and their tables allow anyone holding
it to read and write.** That is the same exposure their live Netlify site has
today, but it is on our domain now as well. Their data includes brand budgets
and creator payment details. **If their Supabase RLS is ever tightened, do it
knowing this app reads it too** â€” a change made "on WurxBase" will silently
break Paid Collabs here and nobody would connect the two.

**2. The three databases do not disturb each other, and that was tested.** Only
one auth token exists in the browser, `wurxmediahub-auth`, byte-identical before
and after using theirs; their clients create no auth storage at all, because
their apps authenticate against a hardcoded user list rather than Supabase Auth;
and there are zero GoTrue multiple-instance warnings, which is the exact symptom
of the random-logout class of bug. Re-run that check if their client setup
changes.

## Being signed in as somebody else (2026-08-19)

| what | where |
| --- | --- |
| detection | `src/lib/auth/AuthProvider.tsx` |
| the banner | `src/components/auth/IdentitySwapBanner.tsx` |
| mounted for both sides | `src/components/layout/AppShell.tsx` |
| proof | `scripts/check-session.mjs` section 9 |

**One session per browser per origin, and that cannot be changed.** Supabase
keeps it in localStorage, which belongs to the origin and not to the tab, so
signing in as a creator anywhere in a browser replaces the admin everywhere in
it. The product does not try to prevent that. It announces it.

**The banner is in `AppShell`, which both admin and creator routes render
through `ShellLayout`.** There is no creator-side copy and there must not be:
one banner, one detector, both sides.

**A swap is TWO auth events and the first one lies.** Signing out over there and
straight back in as somebody else fires `SIGNED_OUT` then `SIGNED_IN`. Test
the identity the TAB STARTED AS, carried in a ref across both, or the banner
freezes on "you were signed out" while somebody else is plainly signed in. That
exact wrong message is what Rashid reported, twice.

**It must clear itself.** If the original person signs back in, the screen is up
to date again and the warning has to go on its own. Nobody dismisses a banner
that is telling them something untrue; they stop reading banners.

**Do not paint a fixed banner with a `*-soft` token.** They are translucent
washes for tinting cards. On a phone this one wrapped to five lines and the page
showed through it.


## Brand World, the creator side of a Brand Hub (2026-08-24)

**Files:** `src/routes/app/BrandHub.tsx` Â· `src/components/brand/BrandWorldShell.tsx`
Â· `src/components/brand/BrandWorldHero.tsx` Â· `src/components/layout/WorldLayout.tsx`
Â· `src/lib/brand-theme.ts` Â· `scripts/check-brand-theme.mjs` Â· `scripts/shots-hub.mjs`
Â· migration `20260824170709_brand_world_look.sql`

**Shape.** `/app/brands` and `/app/brands/:slug` sit OUTSIDE `ShellLayout`, under
their own `WorldLayout`, so the Wurx sidebar and top bar are gone. The rail
carries two lists: the brands, and the open brand's sections. `/app/brands` with
no slug opens the first brand rather than an index.

**The rules that are not obvious.**

1. **The admin picks FILLS. The product picks INKS.** This is the whole safety
   story and everything else follows from it. Nothing an admin can reach is a
   text colour; every one of those is computed by measuring contrast against
   every fill it will cross. It is why the four-colours-per-area editor added on
   2026-08-25 is no more dangerous than the single picker it replaced.
   `deriveBrandTheme()` works in OKLCH, not HSL, because HSL's lightness is a
   lie and a ramp that looks even for a blue brand collapses for a yellow one.
2. **A foreground must clear the WORST background it appears on.** The first
   version computed each text colour against one background and used it on
   several, and `check-brand-theme` failed all 88 test colours immediately. Body
   text derived against the page then printed on a card; hero text derived
   against the dark end of a gradient then shown over the light end.
3. **The world rebinds the ordinary `--wx-*` tokens for its subtree**, which is
   what themes every existing component with no component changes. Success,
   danger and warning are deliberately NOT rebound: a red brand must not turn
   every approved badge into a warning.
4. **`check-contrast` cannot see a database colour**, which is the whole reason
   `check-brand-theme` exists and runs inside `pnpm build`.
5. **The hero needs a height of its own.** Without one it is only as tall as its
   text, so the box ran 1.41:1 on a phone to 5.31:1 on a monitor and `cover`
   threw away 72% of the picture. Artwork sizes are measured, in OPERATIONS.

## Multi-colour brand themes (2026-08-25)

**Files:** `src/lib/brand-theme.ts` (the whole thing) Â·
`src/components/admin/BrandLookField.tsx` Â· `scripts/check-brand-theme.mjs` Â·
`src/lib/schemas/brand.ts` Â· `supabase/functions/manage-brand/index.ts` Â·
migration `20260825174347_brand_theme_areas.sql`

Rashid: *"some brands have multo color themes so our app should be designed
accoridnlgy"*. An admin now colours four areas independently, up to four colours
each, and anything they do not touch is still derived from `brands.brand_color`
exactly as before.

**The shape.** `brands.theme` jsonb, or null. Four optional areas â€” `hero`,
`rail`, `page`, `accent` â€” each `{ stops: [hexâ€¦] }`, plus `angle` on the hero
and `tone` on the hero and rail. **Fills only.** `brand_theme_ok()` refuses an
unknown key, which is how a `text` colour would arrive.

**The rules that are not obvious, and four of the five cost something to learn.**

1. **A band per area per mode is what keeps the promise.** A picked colour keeps
   its hue and its chroma exactly; only its LIGHTNESS is clamped, and only if it
   falls outside what that area can carry. That is why an admin can be handed
   sixteen pickers: the fills can never wander somewhere no single ink reaches.
2. **A band must never straddle the middle of the lightness axis.** The first
   accent band was 0.38â€“0.62 in light mode and **869 of 1200 random themes
   failed on it inside a minute.** A button's label is ONE colour: white fails
   at the pale end, black at the deep end, and an admin picking one colour from
   each half ships a button nobody can read. Each mode's band now sits entirely
   on one side â€” deep buttons with white in light mode, bright ones with dark
   ink in dark mode, which is what the derived theme always did at 0.45 and
   0.72.
3. **The audit had to learn about the MIDDLE of a gradient.** `CONTRACT` names
   single colours, so a four-stop hero had two fills no pair mentioned, and the
   middle of a gradient is exactly where a heading stops being readable.
   `STOP_CONTRACT` walks every stop of every gradient.
4. **It found a real bug in the ORIGINAL one-colour code.** The accent gradient
   ran accent â†’ heroTo, which in dark mode is 0.72 lightness down to 0.42, so
   half of every gradient button was far darker than the colour its label was
   chosen against. Nothing measured it because the gradient was assembled in
   `paletteToVars` while the contract named `accent`. It is now a tight step
   AWAY from the ink, the same shape Wurx's own tokens use.
5. **`brand-theme.ts` must stay ONE file.** `check-brand-theme.mjs` transpiles
   it with raw `tsc` and imports it from plain Node; the moment it imports a
   sibling the emitted specifier has no `.js` and Node refuses it, and the guard
   silently stops running inside the build. Splitting it is a two-line change
   that disarms the alarm.
6. **Turning an area on changes nothing.** The editor pre-fills with the colours
   that area is already showing, so customising starts from the current look
   rather than from a blank row of pickers.

**Guards, and they cover different failures.** `pnpm verify:brand-theme`
covers the PIPE: 15 checks over the network proving the Edge Function and the
column refuse what the browser refuses, including a text colour smuggled into
the JSON, and that a creator cannot repaint a brand. `pnpm check:brand-theme`
covers the MATHS, inside `pnpm build`: 88 base colours plus
1200 deterministic random multi-colour themes, every stop, both modes, plus
assertions that a custom area actually CHANGES the palette (safe-but-useless is
the failure no contrast check can see) and that an uncustomised brand derives
exactly as before. `BRAND_THEME_SAMPLES=40000` hammers it by hand; that was run
before the migration was written.

## The creator offers page (2026-08-25)

**Files:** `src/routes/app/BrandHub.tsx` (`Offers`, `OfferSummary`,
`bucketFor`) Â· `src/components/creator/OfferCard.tsx`

Rashid: *"polish the ui more specially the offers page of brand hubs for
creators"*. It was a bare grid in database order.

- **`bucketFor` is ONE function** because the strip, the tab counts and the card
  list must agree. Three copies is how a tab reads "Under way 2" and draws
  three cards.
- **Work comes first.** live â†’ open â†’ paid, in every view.
- **A pending request counts as under way**, not open: a creator waiting on us
  does not think an offer is still open to them, and showing it as open invites
  applying twice.
- **Tabs appear only when two piles are non-empty**, and an empty pile gets no
  tab. A filter over one pile is furniture.
- **The strip sums `committed_amount`, never `reward_amount`**, grouped by
  currency. The offer's own figure is what the NEXT person would get; summing it
  promises money that was never theirs.
- **No `layoutId` on the tab underline.** This app mounts
  `LazyMotion features={domAnimation} strict`, which does not ship the layout
  engine, so a shared-layout underline warns on every click.

**Depended on by:** the creator Brand Hub sections, which are the same screens
the sidebar opens with a `brandId` passed in. One screen, two places, so a fix
to the numbers cannot land in one and miss the other.

## Brand-scoped creator numbers (2026-08-24)

**Files:** migration `20260824152633_brand_scoped_creator_numbers.sql` Â·
`src/lib/creator/usePerformance.ts` Â· `useLeaderboard.ts` Â· `useCreatorContests.ts`
Â· `scripts/check-brand-numbers.mjs`

**The rule, and it is Rashid's:** a video belongs to a brand through the offer or
contest it was filed against. The MONEY belongs to the brand whose ad account
paid. Both apply together: a hub LISTS videos filed there and SUMS only that
brand's money rows on them.

**Three traps, all met:**

1. `create or replace` with a new argument makes a SECOND OVERLOAD. Every
   signature is dropped by its exact arity first. `verify:brand-numbers` proves
   it by asking for a brand that does not exist and requiring zero rows.
2. **The predicate goes in three places** in `creator_video_performance`: `mine`
   decides which videos exist, `ranged` the money in the period, `lifetime` the
   ads-running state. Miss one and the tiles are right while the counts are
   global.
3. **Rank is computed INSIDE the brand**, underneath the `rank()`, or the board
   opens on "#7 of 3".


## The two legal pages (2026-08-26)

**Files:** `src/routes/legal/LegalPage.tsx` (the shell) Â· `Terms.tsx` Â·
`Privacy.tsx` Â· `legal-contact.ts` Â· `scripts/check-legal.mjs` Â·
`src/styles/global.css` (the `wx-prose` utility) Â·
`src/components/landing/SiteFooter.tsx`

`/terms` and `/privacy`, public and unauthenticated. They exist because
**TikTok's developer portal will not accept an app without both URLs**, on the
same domain as the app, and a reviewer opens them.

**The rules that are not obvious.**

1. **The privacy policy may only claim what the code enforces.** It was written
   from an actual four-way inventory of the migrations, Edge Functions, storage
   buckets and third-party calls, then reconciled line by line. The first draft
   contained a flat falsehood that survived until the inventory caught it: *"Other
   creators cannot see your figures."* The leaderboard shows every creator every
   other creator's name, face, GMV, ad spend, orders and video count, on Rashid's
   own 2026-08-20 decision. **An overclaiming privacy policy is a false statement,
   not a tidy one.**
2. **It does not quote a retention period, because nothing enforces one.** There
   is no delete call against Storage anywhere in this repo and no purge job on
   any table, so it says plainly that we keep things until asked to stop.
3. **It addresses applicants, including rejected ones.** They are a data subject
   with the weakest position and the one a policy most often forgets, and their
   rows and their fetched faces persist indefinitely.
4. **Not `SiteNav`, and the footer anchors had to change.** That header carries
   `#how` and `#platform`, which are sections of the LANDING page; on a legal
   page every one was a link that scrolled nowhere. The footer's were made
   absolute (`/#how`) in the same pass, because the footer is reused here.
5. **`wx-prose` rather than a typography plugin.** A plugin is hundreds of
   kilobytes to style two documents and ships its own colour scale, which is
   exactly what `check:contrast` exists to stop leaking in.
6. **One `legal-contact.ts` for the address and the names**, because they also
   go into the TikTok app registration and three copies is how one of them ends
   up pointing at a mailbox nobody reads.

**Guard.** `pnpm verify:legal`, 31 checks: both pages render **signed out**, in
both themes, at 375 and 1440, with real content, no console errors and no
sideways scroll; the home page footer links to both; and the contact address is
not a placeholder. It waits for the footer to exist before reading it â€” the
first version asked at `domcontentloaded` and reported both links missing while
they sat correctly in the source AND the bundle.

## The creator TikTok connection (2026-08-26)

**Files:** `supabase/migrations/20260825235328_creator_tiktok_connection.sql` Â·
`20260826000638_creator_tiktok_tokens_reachable.sql` Â·
`supabase/functions/_shared/tiktok-display.ts` Â· `tiktok-creator/` Â·
`tiktok-creator-callback/` Â· `src/lib/creator/useTikTokAccount.ts` Â·
`src/components/creator/TikTokConnection.tsx` Â·
`src/routes/OAuthTikTokCreatorCallback.tsx` Â· `scripts/check-creator-tiktok.mjs`

A creator connects their OWN TikTok account and sees their profile, their
follower count, and the views, likes, comments and shares on their own videos.
**Working end to end on production since 2026-08-26**, verified with a real
account: connection stored, token stored, video figures correct, audit row
written.

**TWO SCOPES. `user.info.basic` and `video.list`, and that is what the app is
approved for.**

| scope | what it gives | where it shows |
| --- | --- | --- |
| `user.info.basic` | open id, display name, avatar | the name and face on the card |
| `video.list` | per-video views, likes, comments, shares | the video rows |

**`DISPLAY_SCOPES` MUST EQUAL THE APP'S SCOPES PAGE, and the two ways of getting
it wrong fail completely differently.** Both happened on 2026-08-26, in this
order, within two hours:

- **FEWER in the code than on the app** â†’ authorisation still works, and the app
  is rejected at review as "requests permissions it does not use", with the
  consent screen in the demo video visibly showing fewer permissions than the
  application asks for. Invisible from inside the product, because the consent
  screen is generated FROM the code.
- **MORE in the code than on the app** â†’ **TikTok refuses the authorise URL and
  the Connect button stops working for everyone, instantly.** No error appears
  anywhere on our side. This one shipped to production.

**The second was caused by fixing the first from the wrong source.** A
submission dialog listed four scopes; the app's own **Scopes** page listed two.
**The Scopes page is the authority.** `verify:creator-tiktok` [8] pins the list,
and section [6] now asserts the scope on the LIVE authorise URL the deployed
function builds â€” the source check is only a proxy for what is actually sent.

**Support for `user.info.profile` and `user.info.stats` is built and dormant.**
The columns, the field gating and the card's totals strip all exist and are
driven by the scope TikTok GRANTED, never by `DISPLAY_SCOPES`, so they cost
nothing while unused. Adding either scope to the app is one line here plus a
reconnect â€” and `/privacy` and the consent list on the card must widen in the
same commit, or the product starts over-claiming.

**THE SECOND TIKTOK INTEGRATION, and it shares nothing with the first.**

| | ads (2026-08-17) | creator (2026-08-26) |
| --- | --- | --- |
| host | business-api.tiktok.com | open.tiktokapis.com |
| authorises | a BRAND's ad account | a CREATOR's own account |
| done by | a Wurx admin | the creator, for themselves |
| gives | cost, GMV, orders | views, likes, comments, shares |

Different apps, different credentials, different hosts. Do not merge the two
shared modules. Confusing them cost a whole round of scope applications on
2026-08-25.

**The rules that are not obvious.**

1. **`private` IS NOT REACHABLE FROM AN EDGE FUNCTION.** The tokens went there
   first, because a schema PostgREST does not expose looked like the strongest
   possible protection. It was: `.schema('private')` returns **PGRST106 Invalid
   schema** for every role, service_role included, because the exposed-schema
   list is PostgREST *configuration* and is checked before the role is. The
   callback would have taken a live token, thrown it away, said "Connected", and
   never been able to revoke the grant it left running at TikTok. Tokens now
   live in `public.creator_tiktok_tokens` with **RLS on and NO POLICIES**, which
   denies every user role outright while service_role bypasses RLS. Same
   protection, actually reachable.
2. **A CHECK THAT PASSES ON AN EMPTY TABLE IS NOT A CHECK.** The suite asserted
   "a creator cannot read the token table" and passed â€” on PGRST106, an error
   meaning the schema does not exist rather than permission denied â€” over a
   table left empty because its own setup insert had failed the same way. It now
   proves the token is there first and accepts only a real `42501`. **Third time
   this shape has bitten this repo.**
3. **Read `user_role`, never `role`,** anywhere a JWT is inspected. `role` is
   Supabase's own claim and always says `authenticated`.
4. **`admin.rpc(...)` has no `.catch()`.** It is a Thenable, not a Promise, so
   `.catch()` throws "not a function" before the request is made and surfaces as
   a 500 with a non-JSON body. Use try/catch.
5. **Scope client queries by `creator_id` explicitly.** The owner policy and the
   staff policy are both PERMISSIVE, so they OR: a staff account left to RLS
   alone matches every row, and `maybeSingle()` hands them somebody else's
   connection to display as their own.
6. **TikTok's `create_time` is unix SECONDS.** Read as milliseconds every video
   lands in January 1970.
7. **A withheld figure is `null`, never `0`.** A zero is a number a creator
   would believe about their own video.
8. **Trim every pasted credential.** The real client key arrived 17 characters
   long for a 16 character key â€” a trailing newline from the paste. TikTok then
   says "client key not recognised", which reads exactly like a wrong key, so
   the natural response is to re-copy the same value and fail again.
9. **THE user/info FIELD LIST IS BUILT FROM THE GRANTED SCOPE, NEVER FROM
   `DISPLAY_SCOPES`.** Asking for a field whose scope was not granted does not
   omit that field, it fails the WHOLE call with `scope_not_authorized`. Two
   real cases make this constant: a creator can decline one permission on the
   consent screen, and every token minted before 2026-08-26 carries only
   `user.info.basic,video.list` â€” production included, because it runs the
   sandbox key until approval. `fetchUser` reads `connections.scope`, and falls
   back to the basic fields rather than failing, so widening the ask cannot
   break connections that already exist.
10. **A withheld figure is hidden or dashed, and the two are different.** No
   permission granted â†’ the totals strip is not rendered at all. Permission
   granted but the number missing â†’ a dash. Rendering three dashes for somebody
   who never granted the scope tells them they have no followers, no likes and
   no videos, which is a lie about their own account rather than an absence.
11. **`likes_count` is `bigint`.** A large account's lifetime likes pass 2^31,
   and an `integer` would overflow into silent nonsense on somebody's own
   profile.
12. **`profile_deep_link` is third-party data going into an `href`.** React
   escapes text but renders `href="javascript:..."` happily, so the scheme is
   checked before it becomes a link. Not a live threat from TikTok; it is the
   one string on that card somebody else chooses.

**Guards, two of them.**

`pnpm verify:creator-tiktok`, **27 checks** against the database and the Edge
Functions: the token is unreachable even by its owner, one creator cannot see
another's handle or follower count, the nonce is burned before the TikTok
exchange, replays and expiries are refused, a forged `creator_id` in the request
body is ignored â€” and section [8] reads the SOURCE, pinning `DISPLAY_SCOPES` to
the four on the application and checking the consent list on the card still
names what they read.

`pnpm verify:tiktok-card`, **18 checks** in a real browser, because the card has
a branch nothing else can reach: the totals strip is HIDDEN without
`user.info.stats` and SHOWN with it. Those two look identical in the database
and identical from the Edge Function. Needs `pnpm build` then `pnpm preview`.
It seeds `likes_count: null` on purpose so the dash branch is exercised rather
than assumed, and asserts 375 / 768 / 1440 with no sideways scroll.

## Ad Spend and ROI inside Paid Collabs (2026-08-26)

**Files:** `supabase/migrations/20260826170848_ads_totals_for_videos.sql` Â·
`src/routes/admin/collab-ad-math.ts` Â· `src/routes/admin/collab-ad-figures.tsx` Â·
`src/routes/admin/PaidCollabs.tsx` Â· `src/routes/admin/wurxbase-overrides.css` Â·
`src/vendor/wurxbase/WurxUI.jsx` (WURX-ADDED blocks) Â·
`scripts/check-collab-ads.mjs` Â· `scripts/check-collab-ads-ui.mjs`

Two columns on a brand's creator list â€” **Ad spend** and **ROI** â€” and the same
two figures against each individual video inside an expanded creator.

**BOTH ARE SCOPED TO THE MONTH SELECTOR, and that is not optional.** Everything
beside them on that screen â€” the budget, the allocation, the GMV â€” is filtered
by the month control at the top, so a lifetime ad spend sitting in the same row
is a DIFFERENT PERIOD in the same line of numbers, inviting a comparison that is
not valid. The first version shipped that way and Rashid caught it in testing.
"All Time" sends null bounds and means exactly that.

**The day boundary is the AD ACCOUNT'S, not ours.** `stat_date` was filed under
the advertiser's timezone (`Etc/GMT+5`) by the sync, because that is the only
boundary TikTok reports against. So "August" here is the advertiser's August; a
range in any other timezone would move a day's money across a month end.

**THE JOIN IS TIKTOK'S VIDEO ID, AND NO BRAND NAMES ARE MATCHED.** Rashid
expected to have to map Paid Collab brand names onto ours and worried about
spelling. None of that is needed. Their video links carry the numeric TikTok id,
their own `getTikTokVideoId` already extracts it, and `tiktok_video_daily.item_id`
IS that number. A video either has ad figures or it does not, exactly. Every
brand with a connected ad account lights up with no configuration; the rest show
dashes, which is the honest answer rather than a zero. On dev, 15 of Penetrex's
41 creators carry real figures.

**The rules that are not obvious.**

1. **ROI IS REVENUE OVER THE SUMS, NEVER AN AVERAGE OF RATIOS.** The migration
   that created `tiktok_video_daily` says it outright â€” "a ratio cannot be
   summed" â€” and only this version agrees with what TikTok reports. On the test
   pair (spend 100 â†’ 200 back, spend 1 â†’ 9 back) the correct answer is 2.07x and
   the plausible wrong one is 5.5x. That is the number somebody would proudly
   put in a report.
2. **DEDUPE BY VIDEO ID BEFORE SUMMING COST.** The vendored app warns that the
   same link can sit in `video_codes` twice after a bulk paste. Counting it
   twice inflates delivery; charging it twice inflates a brand's real ad spend.
3. **A DASH IS NOT A ZERO.** No ad data means we cannot answer, which is a
   different statement from "nothing was spent", and only one of them is a claim.
4. **The RPC is SECURITY INVOKER**, so the existing policies on
   `tiktok_video_daily` decide the rows: staff see everything, a creator sees
   only their own APPROVED videos, and it adds no reach the caller did not
   already have. A DEFINER function here would have handed every creator the
   company's ad spend.
5. **THE SCREEN IS RENDERED BY `WurxUI.jsx`, NOT `App.jsx`.** Both files contain
   a creators table with similar columns; only WurxUI's is reachable at
   `/admin/collabs`. The first implementation went into `App.jsx`, built and
   passed its data tests, and changed nothing on screen. **Open the page and
   look before choosing an insertion point.**
6. **THERE ARE TWO PER-VIDEO LAYOUTS.** A brand synced with EUKA gets a table
   (`.pc-vxp-table`); every other brand gets cards (`.pc-vxm-grid`). Patching
   only the table ships a feature that works on some brands and silently does
   nothing on the rest.
7. **A CSS GRID NEEDS ITS TRACK LIST RESTATED.** Their lists are grids with an
   explicit `grid-template-columns`, so adding a header cell without adding a
   track pushes every later column one place along. Our overrides restate both
   lists, and the UI suite asserts the header cell count, the row cell count and
   the computed track count all agree.
8. **NEVER CANCEL AN IN-FLIGHT FETCH WHOSE RESULT IS CACHED BY KEY.** The
   provider's effect re-runs whenever its wanted-list grows, and setting the
   month grows it â€” so a `return () => { cancelled = true }` cleanup discarded
   the request already in the air. **Both fetches completed, both returned real
   rows, and both results were thrown away**: every figure on screen read as a
   dash while the network tab showed 200s full of data, and nothing errored
   anywhere. Cancelling was never right here, because results are keyed
   `month|id` and a late answer is still the correct answer for its own key.
   The only thing worth guarding is writing state after the provider unmounts,
   which is now an `alive` ref.
9. **NOTHING IS FETCHED UNTIL THE PERIOD IS KNOWN.** The rows render before the
   drilldown's effect reports the month, so without a gate the first pass fired
   a full-sized all-time query â€” 357 ids asked for and discarded on every brand
   open. Waiting one render halves the traffic and costs nothing visible.

**The seam, and why the isolation guard still passes.** All our database access
is in `collab-ad-figures.tsx`, which the route mounts as a provider. The
vendored file reads the answers from a React context and holds no connection of
its own â€” the arrangement `check-isolation.mjs` names itself: "If it needs
something of ours, pass it in as a prop from the route."

**Guards.** `pnpm verify:collab-ads`, 22 checks, no server needed: the pure
arithmetic transpiled and run in Node, then the RPC against real rows, then a
creator trying to read another creator's spend. `pnpm verify:collab-ads-ui`,
**15 checks** in a real browser: both headers, header/row/grid-track counts in
agreement, the computed style proving our CSS won the cascade, the per-video
figures in whichever of the two layouts rendered, that switching to All Time
actually changes the figures â€” the only way to prove the month bounds reach the
screen â€” and **the request economy measured rather than asserted**. It counts
the video ids inside every request body, because a flat request count cannot
tell batching from per-row fetching once the row count changes underneath it.
Measured on dev: one request to open a brand, and 424 ids per call across a
period switch.

## Vendoring a WurxBase release (2026-08-27)

**Files:** `scripts/vendor-wurxbase.mjs` Â· `scripts/wurxbase-patches.mjs` Â·
`scripts/check-collab-contrast.mjs`

```bash
node scripts/vendor-wurxbase.mjs "<path to their src/>"
node scripts/wurxbase-patches.mjs          # re-applies OUR Ad spend / ROI blocks
pnpm build && pnpm preview                 # then, in another shell:
pnpm verify:collab-contrast                # the one that catches a bad reskin
pnpm verify:collab-ads && pnpm verify:collab-ads-ui
```

**WHY THIS IS A COMMITTED PIPELINE NOW.** The first vendoring in August 2026 was
a one-off codemod that was never kept. When v382 arrived the whole transform had
to be reconstructed from its own output, which only worked because our copy
still carried the answers. It will not be reconstructible twice.

**THE COLOUR MAPPING IS FOUR PASSES, IN DESCENDING CONFIDENCE.**

| pass | what it is | v382 |
| --- | --- | --- |
| verbatim | the selector+property existed before, so OUR value is kept exactly | 3,995 |
| learned | their colour lined up against our token elsewhere in the file | 754 |
| curated | a hand-written table for what their new UI introduced | 510 |
| nearest | perceptual, in OKLab, restricted to tokens of the same ROLE | 474 |

Only the last can be wrong, so it is counted and printed. **The reference copy
is read from `git show HEAD:`, never from the working tree** â€” read it from
disk and the second run learns from the first run's mistakes, which then look
like decisions and are re-applied forever.

**Three bugs this found, all of which produce valid CSS and a broken screen.**

1. **A comment between two declarations glues itself to the next property.**
   Splitting a rule body on `;` leaves the previous line's trailing comment in
   front of the next property name, so `--sheet-head-bg` arrived as
   `"<comment> --sheet-head-bg"`, stopped starting with `--`, was filed as an
   unknown role and kept its raw `#F1F3F4`. A light spreadsheet header inside
   the dark theme, and nothing anywhere errored.
2. **A CUSTOM PROPERTY CARRIES ITS ROLE ONLY IN ITS NAME.** Everything starting
   with `--` was first filed as "other" and left untouched, so their entire
   variable layer kept its original colours: near-black creator names on a
   near-black table. **862 text elements below 3:1 on one tab.**
3. **A namespace is not a role.** `sheet` was in the fill list, so every
   `--sheet-*` variable resolved to a fill, including `--sheet-line`.

**`pnpm verify:collab-contrast` is the guard, and it is the only honest one.**
It renders the page in BOTH themes, walks every text node, resolves what is
actually painted behind it â€” compositing translucent layers bottom-up â€” and
fails below 3:1. Source CSS cannot answer this: it cannot tell you what ends up
on top of what. It also reports elements sitting on a GRADIENT as unmeasured
rather than guessing, because `getComputedStyle` gives no colour for one and
pretending otherwise invented four failures a run on a perfectly good gold pill.

**What v382 brought:** capability-based permissions (`access.js`,
`AccessControl.jsx`), God Mode settings with configurable columns
(`godSettings.js`, `GodMode.jsx`), creative angle testing (`CreativeAngles.jsx`,
`angleStore.js`), per-month brand contracts (`brandContract.js`), SQL Quest
replacing the read-only SQL playground (`SqlQuest.jsx`), and a Performance
dashboard inside `WurxUI.jsx`. Their `PaidCollabs.jsx` is unchanged.

**Our Ad spend and ROI columns survived untouched**, re-applied by the patch
script at anchors that all still existed; only `BrandDrilldown` had changed, by
gaining two props. `verify:collab-ads` 30 and `verify:collab-ads-ui` 15 both
still pass against the new code.

**Also fixed while the file was open:** the Google Fonts `@import` is dropped by
the pipeline, which closes **PARKED 29(d)** â€” Inter is self-hosted here, so
nothing changes on screen and no admin's browser talks to Google any more.

### The reskin guard, second pass (2026-08-27, evening)

**Rashid opened the Reporting tab and it was unusable** â€” muted text on a brown
slab, an opaque disc across the chart, an off-palette blue totals band. The
guard had reported a pass, because **it was checking four of the six tabs**.
Reporting and Discovery were never opened. A guard that covers part of a surface
and reports a pass is worse than no guard, because it is believed.

Four more failures of the same family, all found by fixing the guard rather than
by looking harder:

1. **It skipped every element on a gradient**, calling them "unmeasured" and
   passing. 49 of them were on the reporting screen â€” exactly where the problem
   was. Gradients are now measured at their colour stops, worst stop wins.
2. **It read `color` on SVG text.** SVG is painted by `fill`, so twelve chart
   labels were reported as white-on-white while their `fill` was perfectly
   readable. Twelve invented failures on the one screen with real ones.
3. **The inline-style pass themed only the FIRST colour in a value**, so a
   two-stop gradient kept its second stop: `var(--wx-warning-soft) 0%,
   #2A2118 100%`, a permanently dark pill behind theme-coloured ink.
4. **The backreference in that pass pointed at the wrong group.** `STYLE_PROP`
   is itself a capture group, so the quote is group 2 and `\1` asked the value
   to be closed by the property NAME. It matched nothing, themed none of the 468
   inline colours, and built cleanly.

**Semantic tokens are no longer candidates for the perceptual fallback.**
`--wx-info` means "information"; using it as the nearest match for their brand
blue is what put a blue band across a gold product. A non-semantic colour
resolves to a neutral or the accent, and a genuinely semantic one is routed by
HUE through `semanticFor`.

**The patch script gained in-place SWAPS**, for a colour written inline in their
JSX where no stylesheet can reach it and no class exists to aim at.

Result: light theme clean on all six tabs, dark clean on five with one count
badge outstanding. `pnpm verify:collab-contrast`.

### Creative angle testing: where the data lives (2026-08-27)

Reported as "showing no data", investigated, **not a bug**. Worth writing down so
nobody spends an evening on it twice.

An angle test is one row in THEIR `activity_logs`, action `CREATIVE_ANGLE`,
target `"Brand::YYYY-MM"` â€” their own comment explains why: *"this belongs in
its own table, but the project has no DDL access, so it rides in activity_logs
the way the brand contracts and Discovery marks already do."*

**So it is scoped to ONE brand in ONE month**, deliberately: comparing a
September hook against a January one measures the season, not the hook. Pick a
brand and month nobody has saved a test for and the empty state is the correct
answer. On 2026-08-27 their database held exactly two, `Aurelia::2026-08` and
`Vidge Pets::2026-07`.

**`fetchAngles()` is called once, from `App.jsx`, and its error is SWALLOWED**
(`.catch(() => {})`). It writes a `localStorage` mirror and dispatches a
`wurx-angles` event; the screen reads the mirror, never the network. So a
failure there is invisible in every direction: no error, no data, and an empty
state that looks deliberate.

**MEASURING THEIR DATABASE: FILTER FOR A HOST THAT IS NOT OURS.** A probe that
takes the first `/rest/v1/` request it sees gets OUR project, because our app
issues its calls first. Doing that reported every one of their tables missing
and produced a confident, wrong "the table does not exist".

### Paid Collabs writes: there is nothing to enable (2026-08-27)

Rashid asked whether the admin could be given write access to Paid Collabs
without touching our database. **It already has it, and our database is not
involved at any point.**

WurxBase talks straight from the browser to THEIR Supabase project
`bnevtdezskftlrjjgbsg`, with a publishable key that ships in our bundle and
theirs. **Their app never authenticates to Supabase** â€” there is not one
`supabase.auth` call in their whole codebase. Their login checks a row in
`app_users` and puts the user in `sessionStorage` as `ch_user`. So the key IS
the permission model, and it permits everything: INSERT, UPDATE and DELETE on
`activity_logs` all succeed, and INSERT into `creators` gets past permissions
and fails only on a missing NOT NULL column.

**What actually limits an admin is `can(user, key)` in `access.js`, which is
pure client-side.** Role `admin` â€” which is what `usman` is â€” does NOT include
`canEditVideos`, `canDelete`, `canGodMode`, `canManageUsers` or `canGrantAccess`.
Only `asad` is `superadmin`. Their `custom_perms` already grant `usman`
`canEditAngles` and `canEditAdSpend`.

**`app_users` is world-readable with that key, passwords included**, along with
all 1241 creators and every money figure. Their exposure, not one we introduced,
but Asad should hear it.

`PaidCollabs.jsx` points at a SECOND project, `pfkpgmpicjcirnogxkac`, which no
longer exists (NXDOMAIN on the system resolver and on 8.8.8.8, with the live
project as a control). Nothing imports that file, so nothing is broken by it.

**`Prefer: tx=rollback` IS NOT HONOURED BY SUPABASE.** It is a real PostgREST
feature and it is not enabled here: both a probe INSERT and a probe UPDATE came
back 201/200 and were COMMITTED. Verify a "rolled back" write by reading the
row afterwards, or do not send it. Both were found and undone.

### Paid Collabs runs on our database (2026-08-28)

**Where the data is:** the `wurxbase` schema of our own project, eight tables,
copied out of `bnevtdezskftlrjjgbsg` and left intact there. `creators` 1249,
`activity_logs` 2348, `app_users` 8, `join_requests` 4,
`brand_monthly_budgets` 38, `audit_logs` 2, `app_settings` and
`revoked_sessions` empty.

**How their code reaches it:** one seam,
`src/vendor/wurxbase/supabaseClient.js`, which borrows the single application
client and scopes it to the schema. Nothing else in the vendored tree imports
ours, and `verify:isolation` fails the build if that changes.

**What had to change beyond the client, and why each was invisible:**

- **Eight realtime filters said `schema: 'public'`.** Left alone they would
  subscribe to OUR tables of the same name and deliver nothing, with a healthy
  subscription and no error.
- **Five hand-built `fetch` calls** in the latency dot, the diagnostics panel
  and SQL Quest carried a hardcoded project URL and key. They would have gone on
  querying the retired database and reporting healthy numbers about it. They use
  `wurxbaseRest()` now, which adds the schema header and the session token.
- **The tables had to join the `supabase_realtime` publication.** A repointed
  filter on an unpublished table produces no events at all.
- **`app_settings` needs `replica identity full`** because their handler
  diffs the old row on UPDATE, and the default payload carries only the key.

**What became possible that was not before:** they had no DDL access on that
project, which is why creative angle tests, brand contracts and Discovery marks
all ride inside `activity_logs` as one row per subject, and why their saves
delete-then-insert. We own the schema now, so those can become real tables with
real constraints. See PARKED 34.

**Still true:** `app_users.password` is plaintext. It was copied as-is because
their login screen still reads it to check a password in the browser. It is no
more exposed than before â€” the key that could read it shipped in the page source
â€” and it goes away with the sign-in-from-our-side step.

### Paid Collabs: one sign-in, and rows that mean what they say (2026-08-28)

**There is no second login.** Rashid: *"when admin is already in app no need of
signin obviously so remove it"*. Their screen checked a typed password against
`app_users.password` â€” plaintext, in a table anyone with the browser key could
read â€” so it was never the boundary. Our own sign-in and the RLS on the
`wurxbase` schema are.

**`src/lib/wurxbase-identity.ts` is the whole bridge**, and the only place the
mapping lives:

| our role | theirs | what that means |
| --- | --- | --- |
| `admin` | `superadmin` | everything, God Mode and user management included |
| `ops` | `admin` | every tab and every daily action; no God Mode, no managing users, no hard delete |

Nobody else reaches the route â€” it is behind `allow={['ops','admin']}`.

**THE MOUNT WAITS FOR THE IDENTITY, and skipping that is a race you lose.**
Their `App` reads `ch_user` from `sessionStorage` in a `useState` initialiser â€”
once, at mount, never again. Writing the session in an effect let the chunk
mount first, find nothing, and render their login screen, which then persists
because nothing re-reads the key. The route holds the skeleton until
`isPending` clears. `isPending` and not `data`, so a profile that fails to load
still mounts the app and degrades to their login screen rather than to a
skeleton that never resolves.

**THE ARRIVAL ROW IS WRITTEN BY US NOW.** Their login was the only thing
writing a `LOGIN` row to `wurxbase.activity_logs`, and that row is how anyone
reading the log later knows who was in Paid Collabs that day. The route writes
it once per browser session â€” the same cadence their login had â€” with the real
person's name, and swallows failures because a footnote must not cost somebody
their screen.

**THE SIDEBAR ONLY OFFERS ROWS THAT OPEN.** Rashid, on tabs a person lacks:
*"if it was u remove it i dont want any leak"*. `navForRole` prunes the Paid
Collabs group through `wurxbaseTabsFor`, and drops the heading if nothing
survives. It does NOT know about per-person `custom_perms` or a God Mode tab
hidden for the workspace â€” both live in their database and would make the
sidebar depend on a fetch. The route still falls back to the first permitted
tab, so those cases degrade to the old behaviour rather than to something
broken.

**`pnpm verify:wurxbase-signin`** proves it: no second screen, the app renders
straight away, the session names the real person, our admin maps to their
superadmin, and zero console errors.


## Product groups on a brand's creator table (2026-09-29)

`src/vendor/wurxbase/WurxUI.jsx` Â· `wxCreatorProduct`, `wxKnownProducts`,
`wxProductOrder`, `wxSplitByProduct`, `wxProductPics`, `WxGroupMenu`, and the
`wxTable` memo in the brand drilldown. Styles: `.wx-pgroup*` / `.wx-prow` in
`src/routes/admin/wurxbase-overrides.css`. Guard: `pnpm verify:product-groups`.

Rashid: *"organize and show product wise creators and for the ui i exactly want
the ui as u can see in ss2"*.

**ONE CREATOR APPEARS ONCE. This is the rule the whole feature rests on.** The
row is per-creator and carries per-creator money; listing somebody under each of
their products shows that money twice. Measured on dev: 10 of Penetrex's 34
September creators straddle products, and a row-per-product table is 53 rows for
34 people. A creator is placed under the product MOST of their distinct videos
are for â€” ties break on GMV, then name â€” and the band header says how many of
its creators also posted elsewhere.

**Where a creator with no videos goes.** Ten of Irwin Naturals' 27 September
creators have none. They fall back to the product they were onboarded with,
which is why that field is compulsory from October. The legacy free-text
`product` column is used only when it MATCHES a product the brand actually has:
that column holds an email address on at least one live row, and a group header
is no place to find that out.

**The order is the band's order, not a second opinion.** `wxProductOrder` reads
`wxProductTotals` â€” the same ranking the Product performance strip draws itself
from â€” so the two halves of the screen can never disagree about which product
leads. A product that exists only as an onboarding choice has no GMV to rank by
and follows, alphabetically. "No product recorded" is always last.

**The band's creator counts and the groups' will differ, and that is correct.**
The band counts everyone who touched a product (overlapping: NUTRAHARMONY reads
19 + 18 + 1 + 1 for 38 people); the groups partition the same people and add up
to the header pill. Do not "fix" one to match the other â€” they answer different
questions, and each reconciles with the total beside it.

**Grouping happens only when there is something to group by** (two or more
distinct products in view). Two of the eleven brands on screen in September â€”
Pure Daily Care and Aqua Sonic, both on Cruva â€” carry no product anywhere and
keep the flat table.

**A band is per PRODUCT PER STATUS, and folds alone.** The same product appears
under every payment status it has creators in. Keying the collapsed set on the
product alone meant folding one also folded its twins further down the page:
thirteen rows vanished for a click that promised nine. The key is
`${statusKey}::${productKey}`.

**THE ROWS MUST NOT LOSE A SINGLE PIXEL OF WIDTH, and this shipped wrong once.**
The first version indented grouped rows 22px and inset the section another 24px.
`.pc-ct-row` is a twelve-column grid with no slack â€” Status is 1.16fr of 8.9 and
the pill in it is 151px, which already overflows below roughly 1300px. Take 46px
more and it overflows at 1500 too, and an overflowing cell is painted over by
the cell after it: the status pill, the contract pencil and the eye button all
stopped receiving their own clicks, with nothing visibly wrong. So the header
carries the inset, the rows keep the full card width, and the tree is drawn
inside the row's own 24px of left padding (rail at 10px, elbow to 18px, both
`pointer-events: none`). `verify:product-groups` measures the row against the
card and probes all three controls, because this is not a mistake to make twice.

**The label is middle-truncated, shared with the band** (`wxShortProduct`). Five
of NUTRAHARMONY's products begin "NUTRA HARMONY" and four of Penetrex's begin
"Penetrex Daily Joint & Muscle Car", so an end-clip gives a column of identical
headers. Both halves of the screen shorten the same name the same way; two
copies would drift.

**One catalogue fetch per brand.** `wxProductPics` is a module-level promise
cache shared by the band and the groups â€” it was two Edge Function round trips.
A FAILURE is dropped from the cache so the next mount asks again: "could not
reach the catalogue once" must never harden into "this brand has no pictures".


## Thumbnails for videos we file ourselves (2026-09-29)

`supabase/functions/_shared/video-thumbs.ts` Â· called from `reacher-sync`.
Guard: `pnpm verify:video-thumbs`.

**REACHER HAS NO THUMBNAIL.** Their spec: `/videos/list` and
`/videos/performance` return ids, urls, handles, product, counts and money, and
no image field. The three schemas in their spec that do carry one are a trending
feed, a weekly report's top five, and an ads row â€” none is a lookup for a video
we hold. Their `social-intelligence` routes 404 for us, and so does the control,
which is what makes that "not on our plan" rather than "no data".

**NEVER STORE TIKTOK'S oEMBED URL.** It works, needs no key, and carries
`x-expires` â€” measured at ONE DAY on 2026-09-29. It is the perfect shape of bug
for this project: right on the day it ships, silently empty a week later.

**The source is the store every existing thumbnail already comes from**, keyed
on TikTok's video id:
`https://database.euka.ai/storage/v1/object/public/creator_videos_photos/<id>.webp`.
Permanent, unsigned, and because the key is TikTok's id rather than anything of
EUKA's it answers for brands EUKA does not run â€” 60 of Irwin's 66.

**Existence is checked, not assumed.** Six of the sixty-six have no object; a
guessed URL renders a broken-image icon, which is worse than the placeholder.

**There is no cache table, deliberately.** The row IS the cache: a video with a
thumbnail is never asked about again, and the only ids re-asked on a later run
are the ones with no picture yet â€” exactly the set worth retrying, since a video
posted this morning may be indexed by tonight.

**The strip degrades to the placeholder**, via `WxVideoThumb`. It used to render
`<img>` with no `onError`, so a URL that stopped answering showed the browser's
torn-page glyph in the middle of the brand page.

## A finished deal moves itself to Payment Pending (2026-09-29)

`supabase/functions/reacher-sync/index.ts`. Guard: `pnpm verify:deal-complete`.

Rashid: *"why does not it automatically move towards payment pending, asad did it
manually"*. Because this function wrote `video_codes` and nothing else, while
BOTH browser paths that write videos â€” the EUKA merge and the video editor's
save â€” recompute the `videos` flag from the deal every time. **Irwin is the only
brand Reacher fills, which is why it was the only brand where it had to be done
by hand.**

**The flag is the status.** `statusOf` reads Payment Pending off
`videos === 'Done'` whenever the row is not `Paid`. So the fix is one field.

**Forward only.** The browser also flips Done back to In Progress when videos
are removed; this function never removes one, so a reverse could only ever undo
a human's decision. A row already `Paid` is skipped entirely â€” paid is further
along than owed. `payment_status` is NOT written: the screens derive the status
from the flag, so writing it would change nothing and could overwrite a field a
human owns.

**`parseDealVideos` NOW EXISTS TWICE** â€” `WurxUI.jsx` and `reacher-sync`. Change
one, change the other. `verify:deal-complete` lifts both out of their files by
source and runs them over every deal string that exists (294 distinct on dev)
plus the shapes the parser claims to read, and fails on any disagreement. It
also guards against both copies agreeing on nothing.

**NOT enforced: "nothing is flagged Done without having delivered".** 444 rows on
dev are exactly that and none is a bug â€” a deal gets renegotiated, a link never
gets pasted, a creator is released early. Staff own that direction. The only
rule the machine enforces is that it never LEAVES somebody out.


## The creator contract, redrawn (2026-10-02)

`src/routes/admin/contract-paper.js` (ours) Â· `src/routes/admin/wurx-mark.js`
(the wordmark, inline) Â· `src/vendor/wurxbase/contractPdf.js` delegates to it.
Guard: `pnpm verify:contract-pdf`.

Rashid, with a mockup: *"update the ui of the contract it's very boring and also
add some extra stuff in it ... i want exactly that UI"*.

**A REDRAW, NOT A REWRITE.** The words all still come from `CONTRACT_SECTIONS`
and the per-creator editor. What changed is the paper.

**IT STAYS LETTER PORTRAIT, PAGES STACKED.** Rashid: *"the second page should be
vertical below the first one like we currently have"*. His mockup shows two
pages side by side because it is a design preview; that is not the document.

**THE WORDMARK IS INLINE BASE64, NOT A FETCH.** The PDF is drawn in a click
handler. A network hiccup on a fetched logo would produce a contract with a
blank header, and nothing would look wrong until it reached a creator.

**THE WATERMARK IS VECTOR CIRCLES, NOT THE LOGO AT LOW OPACITY.** It stays crisp
at any zoom and cannot flatten into a grey smudge on a printer that does not do
transparency.

**THE TOKENISER IS WHERE THE OLD RENDERER WENT WRONG.** It split text on
whitespace and re-joined with single spaces, so `**September 30, 2026**.` came
out as "September 30, 2026 ." â€” three times on the payment page. `tokenise()`
carries whether a space was really there and is exported so it can be tested as
a pure function; `verify:contract-pdf` does exactly that before it opens a
browser.

**THE SUITE DRIVES THE APP, deliberately.** The renderer draws the signature on
a canvas and stamps a PNG, and Node has neither, so a check that imported the
module would pass on a document that comes out of a browser with a hole in the
header. It clicks the button a person clicks and reads the file that lands.
Images are told apart BY SIZE (228x64 mark, 360x110 signature) because "at least
two images" is satisfied by the mark alone â€” a transparent PNG becomes an image
plus its alpha mask.

**`agency` is a field, not a constant**, defaulting to "Wurx Media", so a brand
handled under another name can be given one without touching the renderer.

**STILL OPEN: how a real signature gets in.** Unchanged for now â€” the Brand
Representative line is auto-signed by drawing `fields.signerName` in a script
face. See DECISIONS.

## Backfilling video thumbnails (2026-10-02)

`scripts/backfill-video-thumbs.mjs` Â· dry run by default, `--write` to apply.

Irwin's blanks are fixed inside `reacher-sync` because that function files
Irwin's videos. Everywhere else videos arrive through the BROWSER and no
server-side job owns them, so there is nowhere for the same code to live.

**It only ever ADDS**, never replaces or removes, and never touches any other
field. Re-running is safe and useful: a video with a picture is skipped, so a
later run only asks about the ones still blank â€” which is the set worth asking
about again, since a video posted this week may be indexed next week.

**Controls run before AND after the sweep.** If the store ever answered 200 to
an impossible id, every "found it" would be a lie and the run would fill the
table with broken links; the script refuses to write in that case.

First run: 1,397 blanks, 1,100 filled (79%), 188 rows written, across 18 brands.

## The brief a brand follows, and filing angles automatically (2026-10-06, IN PROGRESS)

**Not finished and not on `dev`.** Branch `feature/creative-angle-auto-categorise`.
The plan, Umar's decisions, the open items and the record of every change are in
[`CREATIVE_ANGLE_AUTOMATION.md`](CREATIVE_ANGLE_AUTOMATION.md). Read that first.

**Files:** `supabase/migrations/20261006090000_collab_brand_briefs.sql` Â·
`supabase/migrations/20261007090000_collab_angle_queue.sql` Â·
`supabase/functions/collab-angles/` Â· `supabase/functions/collab-angles-sync/` Â·
`supabase/functions/_shared/audit-api.ts` Â·
`supabase/functions/_shared/angle-store.ts` Â·
`src/routes/admin/collab-angle-categorise.tsx` Â·
`src/routes/admin/wurxbase-overrides.css` (the `wx-cat-` block) Â·
`scripts/wurxbase-patches.mjs` Â· `scripts/check-angles-categorise.mjs`
(`pnpm verify:angles-categorise`)

What exists so far:

- The queue (`collab_angle_videos`) and one row per backend job
  (`collab_angle_batches`), drained by `collab-angles-sync` on a one-minute
  cron. `collab-angles` is the button's door: it derives the video list from
  `wurxbase.creators` server side and queues it.
- A Categorise button in the angle-testing header, hooked into the vendored
  `CreativeAngles.jsx` through a `WURX-ADDED` fence, with a progress ring.
- `public.collab_brand_briefs` (`supabase/migrations/20261006090000_collab_brand_briefs.sql`):
  one row per brief, keyed by brand NAME like `collab_brand_photos`, with
  `aliases` for the brand's other spellings. A brand with two focus products
  has two rows, either a Google Doc tab each (Dr Tobias) or two separate
  documents (Aurelia), which is why the tab is in `brief_url`. `angles` holds
  the brief's concept names; they become the angle-testing categories. That
  migration inserts 16 briefs for 14 brands.

Change rules:

- **The brand name must match `wurxbase.creators.brand`**, trimmed and case
  insensitive, or be listed in that row's `aliases`. A row whose name matches
  nothing is simply never used, so a typo fails silently. Check the names
  before switching the feature on.
- **A brand gets no row rather than a wrong one.** Klassy Network's link in the
  source sheet is Kenashii's document, so it is deliberately absent: a brief
  attached to the wrong brand judges that brand's videos against another
  brand's concepts, and the answer still looks plausible.
- **Refresh these rows from the sheet's XLSX export, not its CSV.** Several
  cells are hyperlinks showing a document title, and a CSV export drops the URL
  silently, which reads as "this brand has no brief".
- **The filer only ever adds.** It writes `wurxbase.activity_logs` conditioned
  on the `revision` it read and bumps it, exactly as `angleStore.js` does. Drop
  that and a browser tab left open silently replaces the filing with its own
  stale copy of the angles.
- **A video already filed by a person is never moved**, matched by TikTok video
  id across every angle of the row rather than by comparing link text.
- **Four things must be in place or the feature does nothing, quietly**: both
  migrations applied, the `AUDIT_API_URL` / `AUDIT_API_KEY` /
  `COLLAB_ANGLES_SYNC_SECRET` function secrets, the two vault entries, and both
  functions deployed. `collab_angles_run_cycle()` returns null rather than
  raising when the vault is empty, so the cron history looks healthy either
  way. See "Turning the feature on" in `CREATIVE_ANGLE_AUTOMATION.md`.
- **Keep the tab in the URL.** Without `?tab=`, Google exports every tab as one
  text and two products' concepts are judged as one brief.
- **Do not rename an angle in `angles` casually.** The names are the categories
  already filed into `wurxbase.activity_logs`; a renamed concept opens a second
  category beside the first.
- Nothing writes this table from the browser. A change goes through an Edge
  Function with the service key, once that function exists.

## Why the Performance tab was mostly dashes (2026-10-07)

**Files:** `src/vendor/wurxbase/WurxUI.jsx` (`WxBlank`, `wxMoneyBlank`, the
`wxRows`/`wxCells`/`wxEntered` counters in `PerformanceTab`) Â·
`src/routes/admin/wurxbase-overrides.css`

Rashid, with a screenshot of brand after brand showing "-": *"figure out why
data is not being shown? What is the reason for missing data."*

### The reason

**The Performance tab's GMV, Ad and ROAS columns have exactly one source: the
month cells somebody types into the matrix by hand.** The file says so at the
top of `PerformanceTab` â€” *"Aggregates ONLY from the manually-entered monthly
matrix data (`creators.monthly` JSONB). Per-deal `c.gmv` / `c.ad_spent` fields
are NOT used here."* Nothing syncs into those cells. The nightly Euka sync does
write into `monthly`, but only `monthly.euka.l30`.

Measured against dev rather than inferred, by reproducing the tab's own
arithmetic over all 1,484 creator rows: **9 of 44 brands have ever had a figure
entered.** The other 35 have zero cells.

| | last month entered |
|---|---|
| Penetrex, Swisse | **2026-08** |
| Dr. Harvey's, Biostime, Dr Tobias, Aurelia, Apothecary | 2026-09 |
| Aqua Sonic, Pure Daily Care | **2026-08 only, ever** |
| 35 others incl. NUTRAHARMONY, Irwin, Bentgo, JOYMODE | never |

So on 2026-10-07 nobody had entered September for Penetrex or Swisse, and
nobody had entered October for anyone. Even where it is filled it is partial:
Penetrex's $184,167 is 80 of its 286 creator rows.

**This is not a broken sync.** The synced money (Euka and Reacher per video)
feeds the Brands tab and the product band and never reaches this tab. The two
disagree accordingly: this tab says Penetrex ad spend is $105,601 (typed), the
product cards say $45,993 (Euka, all time).

### What was done about it, and what was not

Rashid chose the smaller of two options on 2026-10-07: **explain the blanks,
change no figure.** The larger option â€” feeding these columns from the synced
data â€” moves numbers people have been reading for months and stays his call.

Three silences were all drawn as the same "-": never entered, a real recorded
zero, and (in the Videos column) no creator hired in the period on screen. Only
the middle one means "nothing happened"; the other two mean "we are not saying".
Now a brand with nothing entered reads **Not entered** with a tooltip saying the
column is typed in by hand, a genuine nil keeps its dash, and the Videos blank
explains that the column is scoped to the month by hire date and is not a count
of all the brand's videos. A partly-filled brand carries `80 of 280 rows
entered` under its name, because its total is the sum of whatever somebody got
round to and the row gave no hint of that.

Verified on dev: 44 rows, **0 blanks without a reason**, 0 console errors, and
every figure byte-identical to before (Dr Tobias $9,630 / $13,980 / 0.69x,
Aurelia $6,782 / $26,924 / 0.25x, Swisse $4,551 / $23,724 / 0.19x).

`scripts/check-performance.mjs` was NOT run: it needs `SUPABASE_SERVICE_KEY`,
which the machine this was built on does not have. It is an RLS test that
creates and deletes rows, so it exercises nothing this change touches.

### The fix: fall back to the sync, never override what was typed (2026-10-07)

Rashid: *"suggest the appropriate fix and make the fix for me"*.

**The obvious fix would have destroyed history, which is why it is not the one
built.** Measured on dev before a line was written, comparing the typed matrix
against `euka_ad_video_month` per brand AND per month:

- The Euka rows begin **2026-06**; the typed cells go back to **2025-12**.
  Feeding these columns from the sync deletes **21 brand-months**.
- **Biostime, Aqua Sonic and Pure Daily Care have no Euka rows at all.** They
  would have gone from real figures to nothing.
- Where both exist they sometimes agree to the dollar (Apothecary 2026-08:
  $23,553 both ways) and sometimes do not (Penetrex 2026-06: $24,594 typed
  against $13,275 synced; Dr Tobias 2026-08: $9,385 against $2,160).
- But the sync covers **12 brand-months the typed data misses**, including
  October for seven brands, and NUTRAHARMONY and Irwin Naturals, never typed at
  all, which between them have 581 delivered videos.

So: **typed if it exists, synced only where nothing was ever typed.** With no
way to say which is right where they disagree, the figure a human put there
wins â€” it is the record of what was agreed and what people have been reading
for months. No figure on screen changed; 35 brands that showed nothing can now
show something.

A synced figure carries a dotted underline and the word `synced`, with a
tooltip saying it is not part of the typed record and that the two sources do
not always agree. Same ink and size as a typed figure, because it is a real
number â€” a loud badge would make the brands we know least about the loudest
rows on the page.

**All time on both sides**, because the aggregation already says "ALWAYS
all-time sum across c.monthly"; asking the sync a different question would put
two periods in one column. Ids are gathered only for brands with nothing typed,
since a typed brand's figures win regardless.

Verified on dev at 1440/1024/768/375px: every typed figure identical, the two
newly-populated brands matching the database exactly (NUTRAHARMONY $3,031 /
$2,473 / 1.23x, Irwin $9,980 / $12,953 / 0.77x), 0 blanks without a reason, 0
console errors.

**A geometry check caught what the screenshot could not.** At 1024px
"1.23xÂ·synced" measured wider than the ROAS cell, the tightest column on the
row, and spilled â€” invisible at 1440px where it was being looked at. The word
is now dropped in that column rather than shrunk; the dotted underline and
tooltip still carry the provenance, and the two columns beside it say it in
words on the same row.
## Any date range, and one brand at a time, on My numbers (2026-10-07)

**Files:** `src/lib/creator/date-range.ts` (new, pure) Â·
`src/components/creator/DateRangePicker.tsx` (new) Â·
`src/components/creator/BrandFilter.tsx` (new) Â· `src/routes/app/MyNumbers.tsx`

Rashid, with a screenshot of a two-month picker: *"the data can be displayed for
any date range ... Make it like a calender okay?"* and *"In the numbers tab I
want a drop down to select different brands for whom I want to see the
numbers."*

### Nothing in the database had to change

`creator_video_performance`, `creator_daily_performance` and
`creator_brand_performance` already take `p_from` and `p_to` as plain dates and
filter `between p_from and p_to`, inclusive, and the first three already take
`p_brand_id` â€” the Brand Hub has passed it since 2026-08-24. The old screen
offered four fixed ranges because the UI chose to, not because the data did. No
migration, no RPC change.

**The brand filter is not a security boundary and does not need to be.** Those
functions are `security invoker` and every one filters `creator_id =
auth.uid()` underneath, so a brand id typed into the network tab can only narrow
the caller's own rows; an unknown brand returns nothing rather than somebody
else's figures.

### What replaced what

Four tabs (All time / 7 days / 30 days / By month) and a month walker became one
button that opens a two-month calendar with nine shortcuts. Six are Rashid's
from the picker he sent; "All time" is kept because it was the default and is
the honest answer for a creator three weeks in; **"This month" and "Last month"
are kept because the control they replace was a month walker he asked for by
name** â€” *"what did I earn in July"* â€” and losing that in a redesign would be a
regression dressed as an improvement.

The note that was deleted said the ranges were *"deliberately a set of ranges
rather than two date pickers"*. That was right while the only questions were
this week and this month; it stops being right the moment somebody wants a
campaign's fortnight.

### The decisions worth keeping

- **Hand-built, no dependency.** The stack is locked and every colour must be a
  `--wx-*` token; theming a third-party calendar into that is more work than the
  grid, and it would be the only library of its kind in the repo.
- **A portal, not an absolute panel.** `RowActions` already learned that a panel
  inside `FilterBar` is clipped by any ancestor that scrolls. It measures the
  trigger, flips above when there is no room, and is pulled back inside the
  viewport by the same 8px gutter `check-responsive` measures.
- **Everything is UTC.** A stat date is an ad account's day as TikTok closed it.
  `new Date(y, m, d)` is local time and lands the boundary a day out east of
  Greenwich, which here means a day's money filed under the wrong month.
- **Today is never offered.** The nightly job writes a day only once it is
  complete, so the ceiling is yesterday, capped again at `window.latest`.
- **A shortcut that overshoots still answers.** "Last 12 months" for a creator
  who joined in August clamps to their first video rather than showing nothing.
- **Tabs left, filters right.** Rashid asked the row to stay "practical and
  symmetrical"; what you are LOOKING AT stays left, what you are NARROWING BY is
  pinned right in the `action` slot, so the bar reads as two halves.
- **Two windows, usually one request.** The brand list is built from the
  creator's whole history at the route's scope, not from the chosen range â€”
  otherwise picking a brand would empty the dropdown that picked it. With
  nothing picked the two window queries share a key and cost one request.
- **The brand list comes from the videos, not from `creator_brand_performance`**,
  which only knows brands with MONEY rows: a creator whose first videos have
  earned nothing would get an empty dropdown from that source, and that is
  exactly the creator most likely to go looking for one.
- **A native `<select>` for the brand.** The screen already carries one
  hand-built popover; a second bespoke listbox is two keyboard implementations
  to keep correct for no gain, and most creators here are on a phone.
- The dropdown is drawn as soon as the creator has one brand. **It first hid
  itself below two**, on the reasoning that a control which can only say one
  thing reads as broken — and that shipped, and Rashid could not find the
  feature he had asked for. Every one of the fifteen creators with approved
  videos on dev has them with exactly ONE brand, so the rule hid it from every
  account anybody could sign in as. A control nobody can see is worse than a
  control with one option in it. The lesson is not about dropdowns: a rule that
  hides a feature below some threshold has to be checked against the data it
  will actually meet, or the threshold is a guess that silently deletes the
  work.

### Verified

30 date-maths assertions pass in Node against the pure module â€” leap years
(Feb 2024 vs 2026), year boundaries, inclusive spans, clamping at both ends, and
"the ceiling is yesterday, never today". `tsc` clean, tokens pass, isolation ok,
vite builds, no new lint findings.

**NOT verified in a browser, and it should be before this merges.** The demo
creator account the scripts default to (`skinbyamara@wurxmediahub.demo`) does
not exist on dev, and this machine has no service key to make one, so the
sign-in returns 400 and the screen was never reached. The geometry of the
popover at 375px is the untested risk; a browser check is written and ready at
`scripts/check-numbers-range.mjs` once there is a creator login to run it with.

## The Brand Hub sidebar: one section instead of two (2026-10-07)

**Files:** `src/routes/app/BrandHub.tsx`

Rashid, circling them: *"I want the circled elements removed and instead there
should be only one element named Creators Library"*. "Campaigns & briefs"
(Next) and "Creative studio" (Later) are gone; "Creators Library" takes their
place.

It keeps the marked-but-unclickable treatment the two it replaces had, because
nothing is behind it yet either, and that is the rule the list exists for: a
creator should see the shape of what is coming without being able to click into
an empty room.

### The channel filter is gone (2026-10-08)

Rashid, circling it: *"the circled this I want you to remove it and keep it all
time by default."* The All videos / Offer videos / Contest videos tabs are
removed; the screen always answers for every video, and the date range still
opens on All time.

**It was his own feature, added 2026-08-20**, and the reason it goes is the
reason it was a liability: **it could be left switched on.** The tabs held their
state while every figure on the screen answered a narrower question than the
heading implied — the screenshot that prompted this had Contest videos selected
and a $0.00 GMV with nothing on screen saying why. A filter that can be left on
and is easy to miss costs more than the slice it offers.

The "narrowed to nothing" empty state went with it. It existed only to explain a
filter that could be left on, and there is no longer one to explain.

**Nothing was removed from the data layer.** `creator_video_performance` and
`creator_daily_performance` keep their `p_source` parameter and `My content`
still labels each card's channel, so the question can be asked again without a
migration.

## The creator dashboard, recomposed (2026-10-08)

**Files:** `src/routes/app/Dashboard.tsx` · `src/styles/tokens.css` (the
`--wx-card-*` and `--wx-hero-wash` layer) · `src/styles/global.css`
(`wx-card`, `wx-card-lift`, `wx-card-hero`)

Rashid's brief: a premium creator-economy dashboard, "highly symmetrical",
"subtle but noticeable 3D depth", explicitly not a gaming or crypto look, and
"do not just add shadows to the existing UI — recompose the dashboard".

### The composition, which was the actual problem

- **The container capped at 1140px.** On a wide screen the dashboard sat in the
  left two thirds with the rest of the page empty beside it. That is the "large
  unused areas" in the brief: not too little content, a container too narrow to
  use the room. Now 1400px and centred.
- **The KPI boxes lived in the right column, under the timeline**, taking
  whatever width was left after the work list. They are now their own band
  directly under the money, four equal columns of the page grid, two on a phone
  so they do not push the work list below the fold.
- **Work and Activity were `auto-fit` equal columns**, so the work a creator
  came to act on got exactly as much room as the log of what already happened.
  Now an explicit 7 / 5 split from `lg`, stacking work-before-activity below it.
- **One gap value.** It was `gap-[14px]` between sections and other numbers
  inside them, so nothing aligned across a boundary. `gap-4` is the scale's own
  step and follows the text-size control, which a hardcoded 14px never did.

### Depth as four layers, not a drop shadow

`wx-card` is one class used by every card on the screen, which is what makes it
read as one product rather than a pile of panels. A face that is lighter at the
top so the card has a direction, a warm hairline rim, a 1px inset highlight
along the upper edge, and a shadow beneath rather than around. Hover lifts 2px
and only on cards that are actually links — a hover state on something you
cannot click is a promise the interface does not keep.

**The light-mode twins are not copies.** In the dark the card is lighter than
the page and a white top edge reads as a light source; on white that highlight
is invisible and a lighter face is indistinguishable from the background, so
there the shadow does the work. Copying the dark values across would have
produced tokens that technically exist and visibly do nothing — parity
satisfied, intent lost.

### The timeline

Each row draws its own segment of rail rather than one absolute line down the
section, so it cannot drift out of step with the dots when a row wraps. The last
row stops short, which gives the sequence an end instead of running off the
edge. The horizontal rules between rows are gone: with a rail joining the dots,
a line through every row cut the very thing meant to connect them.

### What was deliberately not done

- **The sidebar.** The brief asks for it to be restyled; it is shared with the
  admin app and asserted by `check-chrome.mjs` (rail width, the single `h1` per
  screen, the text-size menu's roles). Restyling it changes every admin screen
  and is its own step.
- **21st.dev was not consulted.** The MCP is configured and still unauthorised:
  the key lives in a user environment variable and the running VSCode process
  cannot see variables set after it launched. Needs a full VSCode restart, not
  a Claude Code one.

### Verified, and the gap

`tsc` clean, token parity passes (8 new tokens x 2 modes), brand-theme passes,
isolation ok, vite builds.

**Not seen in a browser.** There is still no usable creator login on dev, and
`/app/*` is reachable only by `applicant` and `creator`. Every structural claim
above is from the code, not from looking at it. The figures are the real ones
from the screen (0 of 10 approved, 10 still to film) — the brief quoted 4/10,
which does not match the data.


## Which brands the Brands screen lists (2026-10-09)

`src/vendor/wurxbase/WurxUI.jsx` · `rememberedMonth`, `wxElsewhere`, the
`brands-elsewhere` notice, `BrandsTab`'s `onPickMonth`.
Guard: `pnpm verify:brand-visibility`.

**THE LIST IS MONTH-SCOPED AND THE MONTH IS REMEMBERED IN THE BROWSER.**
`brandRows` is built from the creators hired in the selected month plus the
budget rows for that month. A brand with a budget and no creators therefore
exists in exactly one month, and a browser parked on another month cannot see
it — which is indistinguishable, on screen, from the brand never having been
saved.

That cost the team two bug reports. The giveaway each time was that **the same
account behaved differently on two laptops**: permissions follow the account, so
whatever differs must be machine-local. It was `wurx_ui_state_v1.month`.

**The month is now stamped with the day it was chosen** and only restored on
that day. Deliberate month-switching still survives a reload; a month does not
survive into the next one.

**And the screen names what it is not showing.** `wxElsewhere` finds brands with
a budget in a LATER month that are absent from the current list, and the notice
offers a one-click switch. Deliberately limited to the present and the future:
listing every brand from every month made the notice permanent furniture.

**`BrandsTab` has `month` but not `setMonth`.** Anything in it that needs to
change the month takes `onPickMonth` from the parent — the existing convention,
also used by `LeaderboardTab`. A bare `setMonth` inside `BrandsTab` compiles and
throws at click time into a console nobody reads.

## When a platform cannot answer for one brand (2026-10-09)

`supabase/functions/collab-products/index.ts`.

**A 5xx from EUKA is EUKA's, and it can be specific to one store.** HoneySticks
503s on every attempt while Penetrex answers normally in the same second — so
"is the platform down" and "is our key wrong" are both the wrong question. The
way to tell is a control brand in the same run.

**Never pass an upstream status code to a person.** The picker prints the note
verbatim, so `Euka answered 503` is what somebody onboarding a creator read. The
note now names the brand, says whose fault it is, and says what to do instead
(type the product and press Enter — which the October product rule already
allows for exactly this case). `upstreamStatus` carries the number for anything
that wants it.

**One retry, on 5xx only.** A blip should not send somebody to the fallback; a
4xx is an answer and retrying it only spends the drawer's time. Not three
retries — HoneySticks fails every time and making a person wait twelve seconds
to be told the same thing is its own bug.
