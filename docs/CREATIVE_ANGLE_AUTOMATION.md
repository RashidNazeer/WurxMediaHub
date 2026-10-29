# Creative angle automation: plan and change record

**Started 2026-10-06 by Umar.** Branch `feature/creative-angle-auto-categorise`,
cut from `dev` at `153f374`. Nothing here is on `dev`, deployed, or applied to
any database yet.

**This file is the record of every change made to this repository for this
work.** The change log is at the bottom; add to it in the same commit as the
change.

## What is being built

Creative angle testing (Paid Collabs → Reporting → Creative angle testing) is
filed by hand: somebody watches each video and drops it into an angle. This
makes the filing automatic.

Umar's words: *"whenever new videos or video is posted on a brand the app must
send videos and its relevant content brief to this machine and process videos in
batches of 5 and when the video link and creative angle is returned it should
automatically create (if not created yet) the angle categories like we are
creating manually and place the relevant videos (links) under the respective
category. The videos must be placed in the relevant month as well as under the
relevant brand."*

"This machine" is the video audit backend (the separate *creative project*
repository, `umar551869/Creative-Angle-Review-Agent`). It runs on Umar's PC,
reachable at a fixed public URL, and returns for each video which of the
brief's creative concepts it follows.

## Decisions Umar has made

| Date | Decision |
| --- | --- |
| 2026-10-06 | **A button and an automatic run, both.** A "Categorise new videos" button per brand, and an automatic run for brands with new videos. |
| 2026-10-06 | **A progress bar and an estimated time** on the screen while it works. |
| 2026-10-06 | A video that fits none of the brief's angles is filed under a category called **"Matched None"**. |
| 2026-10-06 | **A brand with two focus products has two briefs**, a tab each of one Google Doc. Each video is judged against both and filed under the one it follows. |
| 2026-10-06 | Videos are sent in **batches of 5**. |
| 2026-10-06 | The audit backend deletes each downloaded video as soon as its job is finished. |

## How it will work

1. The brand's brief(s) are looked up in `public.collab_brand_briefs`. The
   lookup is case insensitive and trimmed, but the filing key is not (see rule
   4 in "Design rules from the 2026-10-06 review"). The enqueue step fails
   loudly: it lists every brand that has creators but no brief, and every brief
   whose brand has no creators.
2. The Edge Function works out the brand's videos itself, from the database,
   and puts the ones not yet filed into a queue, one row per video (table to be
   built). Nothing the browser sends is trusted: the browser says only which
   brand, never which links. A video is identified by its TikTok video id (the
   digits in `/video/<id>`), not by its URL text. "Already filed" means that id
   appears in any angle of any `Brand::*` row for that brand. Videos are
   deduplicated by id before batching.
3. A background worker sends 5 videos at a time to the audit backend through an
   Edge Function that holds the backend's URL and key as secrets. One batch at a
   time across all brands, because the machine runs one job at a time. A batch
   takes 25 to 30 minutes and an Edge Function call lasts about 100 seconds, so
   the worker is a submit-then-poll state machine, not one long call. The
   provider's job id is stored on the batch row, a cron tick runs every minute,
   and each tick does one short step (submit, or one status check, or file a
   finished result). A batch spans many ticks. It is modelled on
   `supabase/functions/euka-ads-sync/index.ts`: claim the row with
   `for update skip locked` and a short lease.
4. When a batch is done, each link is filed under its angle in the row for that
   brand and the **month the video was posted** (`Brand::YYYY-MM` in
   `wurxbase.activity_logs`, action `CREATIVE_ANGLE`), creating the angle if it
   does not exist. The month is the first 7 characters of `video.date`, else the
   first 7 characters of the creator's `hiring_date`. If neither exists the video
   is skipped and reported, because it cannot be filed. Scope mirrors the
   screen: month mode only, active brands only. The key is built from the exact
   trimmed `wurxbase.creators.brand` string, compared case sensitively. The
   save replicates `saveAngles` using the service role (details in the review
   rules, 6 and 7).
5. The screen shows progress and an estimate, and the angle cards fill in as
   batches finish. Nothing in the app subscribes to angle changes (the store
   loads once at boot into a localStorage mirror), so our progress component
   calls the exported `fetchAngles()` after each batch is filed, or the open
   screen will not show the filing until it is reloaded. The button is shown
   only when `can(currentUser, 'canEditAngles')` is true (see
   `src/vendor/wurxbase/access.js`), and the Edge Function checks the same
   thing again server side. A plain `ops` account does not have that capability
   by default.

Rules the filing must keep:

- A video somebody already filed by hand is never moved.
- Typed ad spend, GMV and views overrides are never touched. Every existing key
  on every existing angle is preserved, including keys we do not know about.
- The save goes through the row's `revision` check, exactly like `saveAngles`,
  so it cannot overwrite somebody editing at the same moment. The server must
  bump `revision` itself, or a stale browser tab will silently overwrite the
  filing with its own copy.
- The same video URL never appears twice in one angle.
- If the machine is off, videos stay queued and the screen says so. Nothing is
  lost.

## What the audit backend returns

For a job (`POST /analyze`, then poll `GET /jobs/{id}`):

```json
{
  "status": "succeeded",
  "angles": { "<concept>": ["<video link>"], "Matched None": [] },
  "placements": [
    { "video": "<link>", "angle": "<concept>", "brief": "Lung Health" }
  ],
  "unplaced": [ { "video": "<link>", "reason": "could not download this link" } ]
}
```

Briefs are sent as `briefs: [{label, url, angles}]`, one entry per brief (two
for a two-product brand). A URL with `?tab=t.xxxx` reads that tab only. About 5.5
minutes per video on a first run, so a batch of 5 is 25 to 30 minutes. On top of
that, every job pays one to three minutes of brief compilation per brief,
because the brief is recompiled on every job by choice.

**What to trust while a job runs.** Mid-run, only `status`, `phase`,
`requested_videos`, `downloaded_videos` and `elapsed_s` mean anything.
`placements`, `unplaced` and `completed_videos` are empty until the job ends.
`angles` already lists the brief's angle names with empty lists while the job
runs; that is not a result and must not be read as one.

**`POST /analyze` is not idempotent.** If the response is lost, the provider
still has a job running, and because it runs one job at a time that orphan
blocks everything for about half an hour. So the batch row is written as
`submitting` before the post, the post carries `label = <batch uuid>`, and
before any retry the worker looks for that label in `GET /jobs?limit=50`. Probe
`GET /ready` first; it needs no key. Never treat a bare HTTP 404 as "job lost":
an offline ngrok tunnel also returns a 404, but as an HTML error page. The
provider's real 404 is JSON, `{"detail": "no job <id>"}`. Only that means the
job is gone.

**"Matched None" can be provisional.** If the provider marks a placement
`needs_review`, or the job warns about missing visual evidence, treat the
result as provisional and re-run those videos once before filing them. The
evidence is cached, so a re-run is cheap. Filing a transient failure as "fits no
angle" means nobody ever looks at that video again.

**Always send `angles`** (the row's `angles` column). The backend then files
videos under exactly those names. Left to read the names out of the document by
itself, its original reader got 4 of these 11 briefs wrong: a concept typed as a
bullet was dropped, a name ending in `!` was dropped, a brief with no "Creative
Concepts" heading yielded no angles, and a "Key talking points" heading was
taken for a concept. The backend has since been given a stricter reader that
gets all 11 right, and every job reports where its names came from in
`angles_from` (`given`, `document` or `notebook`). Sending the stored list is
still what makes a second spelling of a category impossible.

`POST /briefs/angles {brief_url}` returns a brief's concept names instantly,
with no model call. Use it when somebody changes a brand's brief link, to
refresh that row's `angles`.

## Applying the migration

Whoever applies it needs access to the dev project, which lives in the Wurx
Media organisation. Umar's Supabase account is not a member of it, so Rashid
is applying this one.

```powershell
git fetch origin
git checkout feature/creative-angle-auto-categorise
supabase db push          # dev project, qinxwfdwvpkzfhcijuqw
```

Then three checks, in the SQL editor or `supabase db query`. **The second one
is the one that matters**: a brief whose brand name matches nothing in
`wurxbase.creators` is never used, and nothing anywhere says so.

```sql
-- 1. The rows landed: expect 16 across 14 brands.
select brand, product, cardinality(angles) as angles, is_active
from public.collab_brand_briefs
order by brand, position;

-- 2. Does every brief match a real Paid Collabs brand?
-- Anything listed here is a brief that will never be used.
select b.brand, b.product
from public.collab_brand_briefs b
where not exists (
  select 1 from wurxbase.creators c
  where lower(btrim(c.brand)) = lower(btrim(b.brand))
     or lower(btrim(c.brand)) = any (
          select lower(btrim(a)) from unnest(b.aliases) a)
);

-- 3. And the other way: brands posting videos that have no brief, so they
-- cannot be categorised yet.
select distinct btrim(c.brand) as brand
from wurxbase.creators c
where btrim(coalesce(c.brand, '')) <> ''
  and not exists (
    select 1 from public.collab_brand_briefs b
    where b.is_active
      and (lower(btrim(b.brand)) = lower(btrim(c.brand))
           or lower(btrim(c.brand)) = any (
                select lower(btrim(a)) from unnest(b.aliases) a))
  )
order by 1;
```

Fix anything query 2 returns by adding the real spelling to that row's
`aliases`, not by renaming `brand`. Query 3's output is expected to include
Klassy Network, Cutler Nutritions, Aqua Sonic, Inno Supps and Irwin Naturals
(see Open items); anything else on that list is a brand whose brief is missing
from the sheet.

## Turning the feature on

The code is written and builds. It does nothing at all until these four things
are in place, and each of them fails quietly rather than loudly, which is why
they are written out here rather than left to be remembered.

```powershell
# 1. The schema: the briefs, then the queue.
supabase db push

# 2. Where the audit machine is, and the key it wants. The URL is Umar's
#    ngrok domain and does not change; the key is AUDITOR_API_KEYS from the
#    backend's own .env.
supabase secrets set AUDIT_API_URL=https://atlantic-canine-hurling.ngrok-free.dev --project-ref $env:SUPABASE_PROJECT_REF_DEV
supabase secrets set AUDIT_API_KEY=<the key> --project-ref $env:SUPABASE_PROJECT_REF_DEV

# 3. The secret the scheduler presents to its own worker. Any 32+ random
#    characters; it is never seen outside the database and the function.
supabase secrets set COLLAB_ANGLES_SYNC_SECRET=<32+ random chars> --project-ref $env:SUPABASE_PROJECT_REF_DEV

# 4. Deploy both functions.
supabase functions deploy collab-angles --project-ref $env:SUPABASE_PROJECT_REF_DEV
supabase functions deploy collab-angles-sync --project-ref $env:SUPABASE_PROJECT_REF_DEV
```

Then tell the database the same two things, so `pg_cron` can reach the worker.
Run this in the SQL editor as the service role, with the SAME secret as step 3:

```sql
select public.collab_angles_set_sync_secret('<the same 32+ chars>');
select public.collab_angles_set_sync_url(
  'https://<project-ref>.supabase.co/functions/v1/collab-angles-sync');
```

A missing vault entry is not an error: `collab_angles_run_cycle()` returns null
and the cron job looks perfectly healthy while nothing is ever categorised.
That is deliberate, because production has no Paid Collabs, but it means the
only proof the wiring works is a batch actually moving.

Check it with `pnpm verify:angles-categorise`. With `AUDIT_API_URL` and
`AUDIT_API_KEY` in the environment it also asks the audit machine whether it is
awake.

## Build order

1. **The briefs, per brand.** Done on this branch (see the change log).
1a. **Prerequisite: protect the vendored files.** Generalise
   `scripts/wurxbase-patches.mjs` so it can patch `CreativeAngles.jsx` as well
   as `WurxUI.jsx`, and add a check that fails if `angleStore.js` has lost its
   `revision` handling. Without this, the hook line in step 5 is lost on the
   next re-vendor (the vendor script regenerates `CreativeAngles.jsx` and copies
   `angleStore.js` verbatim, with no fence round our revision logic). Do this
   before step 5.
2. A queue table: one row per video, with status and the angle it was given,
   plus a batch table holding the provider job id, the batch uuid used as the
   label, the state (`submitting`, `running`, and so on), a lease, and attempt
   counts. A batch that fails twice is split into single-video batches to find
   the one video causing it.
3. The Edge Function that talks to the audit backend, and the worker tick, run
   every minute as a submit-then-poll state machine (pattern: `euka-ads-sync`,
   cron → pg_net → function with a Vault secret; claim with
   `for update skip locked`, short lease). Platform wiring that fails silently
   if forgotten:
   - The cron-called function needs a `[functions.<name>] verify_jwt = false`
     block in `supabase/config.toml`. Without it pg_net's call gets 401 forever
     and the cron looks healthy while doing nothing.
   - Every new table needs `grant all privileges on table X to service_role` as
     well as RLS and policies.
   - Regenerate `src/types/database.ts` for any new table the screen reads, or
     the strict TypeScript build fails.
   - `scripts/check-role-gates.mjs` requires any function that tests for the
     `ops` role to name every staff role.
   - The button-facing function re-checks the caller server side: verify the
     JWT, require `profiles.role` to be a staff role and active, then look up
     `canEditAngles` in `wurxbase.app_users` by `hub_email`.
4. Filing results into `wurxbase.activity_logs`, replicating `saveAngles`
   (`src/vendor/wurxbase/angleStore.js`, lines 89 to 174) with the service role.
   See rules 3 to 7 below: identify videos by id, key by the exact brand string,
   month rule, optimistic-concurrency save, and the server-made angle shape.
5. The button, progress bar and estimate on the angle-testing screen. Ours goes
   in our own file under `src/routes/admin/` and hooks into the vendored
   `CreativeAngles.jsx` on one fenced line, per the vendoring rules (and only
   after step 1a, so the line survives a re-vendor). The button is gated on
   `can(currentUser, 'canEditAngles')`. The component calls `fetchAngles()`
   after each batch is filed. Progress follows rule 13 below.
6. The automatic run.
7. A `scripts/check-*.mjs` suite, and the FEATURE_MAP / OPERATIONS entries.

## Open items

- **Brand names are unverified against the database.** The rows use the names
  in Umar's sheet. Before the feature is switched on, compare them with
  `select distinct btrim(brand) from wurxbase.creators`, and add any other
  spelling to that row's `aliases`. The brief lookup is case insensitive,
  trimmed, and checks `aliases`, but it is not fuzzy. The filing key is
  different: it uses the creators table's own spelling, case sensitive
  (rule 4 below).
- **Five brands cannot be categorised yet**, and the first two need somebody to
  fix the sheet:
  - **Klassy Network**: its link is Kenashii's document
    (`1sT-cmKCfffY...`, titled "Kenashii Viral Video & Content Guide", and the
    text never mentions Klassy). Deliberately given **no row**, because a brief
    attached to the wrong brand would judge Klassy's videos against Kenashii's
    concepts. It needs its own link.
  - **Cutler Nutritions**: the linked document is readable but empty, with no
    brief written in it.
  - **Aqua Sonic, Inno Supps, Irwin Naturals**: no link in the sheet.
- **A hyperlinked cell hides its URL.** Apothecary, Kenashii and both Aurelia
  cells show a document title rather than a link, and a CSV export of the sheet
  drops the URL entirely, so those brands look like they have none. Read the
  sheet's **XLSX** export instead, which keeps the hyperlink. Anyone refreshing
  these rows from the sheet must do the same.
- **Honeysticks and Swisse have a second tab that is not a brief** (a 210
  character note, and an empty tab). Only the first tab is used. Google serves
  the FIRST tab for a tab id that does not exist, so a tab whose text matches
  tab one is not a real tab.
- **Nothing has been applied or deployed.** The repository's `.env` holds the
  dev Supabase URL and publishable key, which are enough for the browser but
  not to change the schema. Applying the migration needs a Supabase access
  token and the dev database password, so it has not been pushed and no suite
  has been run.
- **Pushed to the feature branch only** (2026-10-06), as
  `RashidNazeer <wurxmedia@gmail.com>` on Umar's instruction. That is not the
  identity OPERATIONS fixes for this repository
  (`Rashid Nazeer <286085480+RashidNazeer@users.noreply.github.com>`); Rashid
  to say if the branch should be re-authored before it merges. **Not merged
  into `dev`**, and no pull request has been opened yet; the description is
  ready in `PR_creative-angle-auto-categorise.md` one folder above the
  repository.
- **Who gets the button is not settled.** The button gates on
  `canEditAngles`, which a plain `ops` account does not have by default.
  Umar to say whether ops staff should be granted it, or only the people who
  already edit angles by hand.
- **The progress weights and the 5.5 minute fallback come from one real run.**
  Re-measure them after the first few live batches.

## Design rules from the 2026-10-06 review

A detailed review of this plan against the existing code found the points
below. Rules 1, 2, 10 and 14 are also written into "How it will work" and the
backend notes above; the rest are collected here so none is missed. All of them
are requirements for the implementation.

1. **The worker is a submit-then-poll state machine.** An Edge Function call
   lasts about 100 seconds and a batch of 5 takes 25 to 30 minutes. Persist the
   provider's job id on the batch row, run the cron tick every minute, and let
   each tick do one status check. Copy `euka-ads-sync` (claim with
   `for update skip locked`, short lease). A batch spans many ticks.
2. **Submitting is made safe against lost responses.** Write the batch row as
   `submitting` before posting. Send `label = <batch uuid>`. Before any retry,
   look for that label in `GET /jobs?limit=50`. Probe `GET /ready` first (no key
   needed). A bare 404 is not "job lost": an offline ngrok tunnel returns an
   HTML error page, and only the JSON `{"detail": "no job <id>"}` means the job
   is gone.
3. **Identify videos by TikTok video id, never by URL text.**
   `wurxbase.creators.video_codes[].video` is free text written by three
   writers (manual entry, the Euka sync, the Reacher sync), so one video
   appears in several spellings. Take the digits after `/video/`. Dedupe by id
   before batching, send canonical URLs to the provider, map results back by
   id, and file the exact string that is in `video_codes`. "Already filed"
   means that id appears in any angle of any `Brand::*` row for that brand.
4. **The brand key is the exact trimmed `wurxbase.creators.brand`, compared
   case sensitively.** The screen builds `Brand::YYYY-MM` that way
   (`caKey` and `brandVideos` in `src/vendor/wurxbase/angleStore.js`). Look the
   brief up case insensitively, but never write the briefs table's spelling
   into the key. The enqueue step fails loudly and lists brands with no brief
   and briefs with no creators.
5. **Month and scope.** Month is the first 7 characters of `video.date`, else
   the first 7 of the creator's `hiring_date`. With neither, skip the video and
   report it. Month mode only, active brands only, as on the screen.
6. **Filing replicates `saveAngles`** (`angleStore.js`, lines 89 to 174), with
   the service role. Read `id, details, revision`. Update where
   `revision = <r>`, setting the merged `details`, `revision = <r> + 1`,
   `updated_at = now()` and a readable `user_display`. If zero rows come back,
   re-read, re-merge and retry, a bounded number of times. If no row exists,
   insert with `revision: 1`; on a unique violation (23505), re-read and take
   the update path. Never delete. Never write an empty angle list. Preserve
   every existing key on every existing angle (`spend`, `gmvOverride`,
   `viewsOverride`, `adSpent`, and anything unknown). If the server does not
   bump `revision`, a stale browser tab silently overwrites the filing with its
   own copy.
7. **A server-made angle has the screen's shape.**
   `{ id, title, videos: [], spend: {}, gmvOverride: {}, viewsOverride: {} }`,
   with the id in the format of `newAngleId` ('a', then a base-36 timestamp,
   then 4 random characters), unique within the row. Add a marker key, for
   example `auto: { name: <the brief's angle name> }`, so a staff rename does
   not cause a duplicate next run. Match an existing angle by the marker first,
   then by title normalised (curly quotes to straight, whitespace collapsed,
   trimmed, case insensitive). The same video URL must never appear twice in one
   angle: the screen uses the URL as a React key, and duplicate keys produce
   console errors that the browser verification suite treats as failures.
8. **The open screen does not refresh itself.** The angle store loads once at
   boot into a localStorage mirror and nothing subscribes to changes. The
   progress component calls the exported `fetchAngles()` after each batch is
   filed.
9. **Gate the button, and re-check on the server.** The button needs
   `can(currentUser, 'canEditAngles')` (`src/vendor/wurxbase/access.js`); a
   plain `ops` account lacks it by default. The Edge Function verifies the JWT,
   requires `profiles.role` to be a staff role and active, then looks up the
   capability in `wurxbase.app_users` by `hub_email`. It trusts nothing from the
   browser. It derives the video list itself from the database and never
   accepts video URLs from the browser, because the provider downloads
   whatever links it is given.
10. **"Matched None" is provisional in two cases.** When the provider marks the
    placement `needs_review`, or the job warns about missing visual evidence,
    re-run those videos once before filing them. The evidence is cached, so a
    re-run is cheap. Filing a transient failure as "fits no angle" means nobody
    looks at the video again.
11. **Protect the vendored files first.** A hook line added to
    `src/vendor/wurxbase/CreativeAngles.jsx` is lost on the next re-vendor:
    `scripts/wurxbase-patches.mjs` patches only `WurxUI.jsx`, the vendor script
    regenerates `CreativeAngles.jsx`, and `angleStore.js` is copied verbatim
    with no fence round our revision logic. Generalising the patch script, and
    adding a check that fails if `angleStore.js` has lost its `revision`
    handling, is a prerequisite step (build order 1a).
12. **Platform wiring that fails silently if forgotten.** See build order step
    3: `verify_jwt = false` for the cron-called function in
    `supabase/config.toml`; `grant all privileges ... to service_role` on every
    new table as well as RLS and policies; regenerate `src/types/database.ts`
    for any new table the screen reads; and `scripts/check-role-gates.mjs`
    needs any function testing for the `ops` role to name every staff role.
13. **Progress and the estimate.** Use only the fields that mean something
    mid-run (see "What the audit backend returns"). Drive the bar from phase
    weights measured on a real run: brief 5 per cent, ingest 4, decode 5, speech
    and on-screen text 58, vision 16, judging 11. Keep a rolling average of
    finished batch durations per video, falling back to about 5.5 minutes per
    video, and label the figure an estimate. Add one to three minutes of brief
    compilation per brief to every job.
14. **Split a failing batch.** If a batch fails twice, split it into
    single-video batches to find the one video causing it.

## Change log

### 2026-10-06, the briefs

- **Added `supabase/migrations/20261006090000_collab_brand_briefs.sql`.**
  Creates `public.collab_brand_briefs`: one row per brief, keyed by brand name
  (like `collab_brand_photos`), with `product`, `position`, `brief_url` (a
  Google Doc, the tab in the URL), `angles` (the brief's concept names, in
  order), `is_active`, and timestamps. A unique index on brand + product, case
  insensitive. RLS on; `select` for `is_collabs_viewer()`; no write policy;
  explicit grants to `authenticated` (select) and `service_role` (all).
- **The same migration inserts 16 briefs for 14 brands**, taken from Umar's
  sheet as it stood on 2026-10-06. Every document was fetched, its real tabs
  worked out, and its "Creative Concepts" list read from the text; nothing was
  typed by hand, and a second pass checked that each document names the brand
  it is filed under. `on conflict do nothing`.

  The names are stored as category titles: the quote marks a brief puts round a
  concept are removed, so `“Visual hook”(Top performing angle)` is stored as
  `Visual hook (Top performing angle)`.

  | Brand | Product | Angles |
  | --- | --- | --- |
  | Apothecary | | 2 |
  | Aurelia | Hair Revive + Hair perfection | 2 |
  | Aurelia | Hair Perfection | 3 |
  | Yesday | | 3 |
  | Bentgo | | 3 |
  | Biostime Shop US | | 2 |
  | Dr Tobias | Colon 14 Day Cleanse | 4 |
  | Dr Tobias | Lung Health | 3 |
  | Dr. Harvey's | | 2 |
  | FlyWell | | 3 |
  | Honeysticks | | 2 |
  | JoyMode | | 3 |
  | Kenashii | | 3 |
  | Penetrex | | 4 |
  | Pure Daily Care | | 2 |
  | Swisse | | 2 |

- **`aliases` column added.** Umar, 2026-10-06: "Biostime Shop US and Biostime
  both are same". One brief answers for every spelling of a brand, so a row
  carries the others in `aliases` and the lookup checks them. Biostime Shop US
  carries `{Biostime}`.
- **Dr. Harvey's two near-identical concepts are stored as one.** The brief
  lists "It's Not Just Bad Breath, It's Their Health" and then the same title
  again with "(Variation #2)". Umar left the decision here: one creative angle,
  two executions. As two categories nothing could tell them apart, and an angle
  test compares hooks against each other, not takes of one hook. Stored once;
  a video following either execution lands in the same category. If the team
  ever wants them separated, give them names that differ.
- **Aurelia is the second two-brief brand**, and unlike Dr Tobias its two
  briefs are two separate documents rather than two tabs. Note that "Hair
  Perfection" is covered by both, with different concepts in each.
- **Added this file**, and an entry in `docs/FEATURE_MAP.md`.
- No application code, no Edge Function, no vendored file and no existing
  migration was changed.

### 2026-10-06, design review written into the plan

- **Edited this file only.** A design review of the plan against the existing
  code found 14 points the plan got wrong or left out. They are now in the plan.
- **Corrected earlier sections** rather than adding contradictions: "How it will
  work" (worker is a submit-then-poll state machine; videos identified by video
  id and derived server side; month and brand-key rules; `fetchAngles()` after
  filing; button gated on `canEditAngles` and re-checked by the server), "What
  the audit backend returns" (5.5 minutes per video plus brief compilation, which
  fields to trust mid-run, non-idempotent `POST /analyze`, the 404 trap,
  provisional "Matched None"), "Build order" (new prerequisite 1a for the
  vendored-file patch script, batch table, platform wiring, filing and screen
  detail) and "Open items" (brand key spelling, who gets the button, progress
  weights).
- **Added the section "Design rules from the 2026-10-06 review"**, 14 numbered
  rules for whoever implements the feature.
- No code, migration, vendored file or database was touched.

### 2026-10-07, the feature itself: queue, worker, filing and the button

Umar: *"Complete the integration."* Build-order steps 1a to 6 are now written
and building. Nothing is deployed and no database has been touched.

**The schema** (`supabase/migrations/20261007090000_collab_angle_queue.sql`):
`public.collab_angle_videos`, one row per video per brand-month, and
`public.collab_angle_batches`, one row per backend job. RLS on, read for
`is_collabs_viewer()`, no write policy, explicit `service_role` grants, both in
the realtime publication. Plus the two vault setters,
`collab_angles_run_cycle()` and the `collab-angles-cycle` cron job, each copied
from their `euka_ads_*` equivalents.

**Talking to the audit machine** (`supabase/functions/_shared/audit-api.ts`).
The one piece worth reading twice, because three different failures arrive
looking identical and want opposite responses:

- **Offline**: the machine is a PC behind a tunnel, and an absent machine is
  answered for by ngrok with an HTML page. That must not spend a retry, fail a
  batch, or resubmit a job that is still running over there. Any reply that is
  not JSON, or that carries an `ngrok-error-code` header, is offline.
- **Refused**: the machine answered, in JSON, that it will not do this. A 4xx.
  Retrying changes nothing.
- **Missing job**: a real 404 whose JSON body says `no job <id>`. Only then are
  the batch's videos re-queued.

`POST /analyze` is not idempotent, so every submission carries the batch id as
its `label`, and a batch found half-submitted asks `GET /jobs?limit=50` for
that label before posting again. A lost reply would otherwise start a second
half-hour job and file the same videos twice.

**The worker** (`supabase/functions/collab-angles-sync/index.ts`), fired every
minute. A tick claims one batch with a three-minute lease (a conditional
update, not a row lock, so a function that dies cannot leave a lock behind),
moves it one step, and returns. Nothing waits for a batch: a batch is a row,
and its state lives in the database. When a batch finishes and there is budget
left, the next one is started in the same tick so the machine is not left idle
for a minute.

**Filing** (`supabase/functions/_shared/angle-store.ts`) replicates
`angleStore.js` lines 89 to 174 with the service role: read the revision,
update conditioned on it, bump it, retry up to five times when somebody saved
underneath us. It only ever adds. Every existing angle keeps every key it had,
including the ad spend and overrides somebody typed by hand, and a video
already filed is matched by TikTok video id across every angle of the row and
left where it is. A placement the machine itself flagged `needs_review` is not
filed at all, because "fits no angle" and "could not really tell" are
indistinguishable once filed and nobody would look again.

**The button** (`src/routes/admin/collab-angle-categorise.tsx`), hooked into
the vendored screen's header through a `WURX-ADDED` fence, with
`scripts/wurxbase-patches.mjs` generalised so it can patch more than
`WurxUI.jsx` and the hook survives a re-vendor. The progress ring is an
absolutely positioned SVG outline that takes no layout space, so the header
does not move, drawn with `stroke-dasharray` over `done / total` where done
counts every state a video can end in. It polls every five seconds while work
is in flight and calls `fetchAngles()` when the filed count rises, so the cards
fill in without a reload.

**Proven, not assumed.** `pnpm build` passes. `pnpm verify:angles-categorise`
(new, 43 checks) passes, including a live call to the audit machine. The exact
request the worker sends was run against the live backend with a two-brief
brand: it answered `angles_from = ['Colon 14 Day Cleanse: given', 'Lung
Health: given']`, which is both briefs judged against the angle names stored
here rather than names it guessed from the documents.

**Not done.** Nothing is deployed: this machine's Supabase account is not in
the Wurx Media organisation. The automatic nightly run (build order 6) is not
built; the button is the manual trigger and the cron worker drains the queue.
`src/types/database.ts` has not been regenerated, which matters only once
something in the screen reads the new tables directly rather than through the
Edge Function.

### 2026-10-07, which product each video is for

Umar: "I want to see for which product each video is made."

**The product was never missing.** `brandVideos` in `angleStore.js` has always
returned `product` off `video_codes`, and the angle drawer has always rendered
it -- appended to the date as `date · product` inside `.cx-who small`. That
element is a single `white-space: nowrap` line with an ellipsis, and the
product sits at the END of the string, so it is the first thing cut. For a
brand whose products are called "Penetrex Daily Joint & Muscle Care, 3 Oz.
Gel", none of it survived. **Data that is rendered and then clipped away looks
exactly like data that was never there**, which is why this read as a missing
feature rather than a styling fault.

Three changes, all through `scripts/wurxbase-patches.mjs` so they survive the
next re-vendor:

- **swap `product off the date line`** -- the date line goes back to being just
  the date.
- **patch `product per video`** -- the product gets its own element,
  `<small className="wx-prod">`, with the full name on `title`.
- **swap `find by product too`** -- the drawer's filter already matched on
  product; only its placeholder failed to say so, so nobody would think to try
  it. Now "Find a creator or product".

`.wx-prod` is styled in `src/routes/admin/wurxbase-overrides.css` as a chip in
`--wx-accent-soft`, the same fill the Brands screen uses for its own product
labels, so one product looks like itself on both screens.

**A data fix came with it.** `swap keep a product the first row lacked`:
`brandVideos` deduped with `if (seen.has(url)) return;`, so where the same link
sits on two rows of `video_codes` -- which happens whenever a creator has two
deals for it, 32 times in one brand-month on dev -- the product was taken from
whichever row came first, and lost entirely if that row had none. It now
backfills, never overwrites. This is the rule `wxProductTotals` already applies
on the Brands screen ("where two rows disagree the richer row wins"), so the
two screens no longer disagree about what a video sold.

**A trap worth recording, because the patch script cannot catch it.** The first
version of the date-line swap used `to: "String(f.v.date || '').slice(0, 10)"`
-- a prefix of its own `from`. The idempotency check is `src.includes(sw.to)`,
so it matched the UNSWAPPED text, reported "already swapped", and changed
nothing. The product then rendered twice, once clipped and once not. **A swap
whose `to` is a substring of its `from` silently no-ops.** The `to` now carries
a trailing comment so it cannot match the original.

**Proven.** `pnpm build` passes, the patch script is idempotent (16 blocks, a
second run applies nothing), and `pnpm verify:angles-categorise` passes 53
checks.

### 2026-10-07, angle -> product -> videos

Umar, pointing at the Brands screen: "under each angle there are products and
then under each products there are videos", and the band should carry the
product's picture as that screen's group row does.

So the angle is the category and a product is a foldable band inside it. The
per-video product chip added earlier that same day is **gone**: inside a band it
repeated the band's own name on every row.

**The arrangement has no React in it.** `src/routes/admin/collab-angle-products.ts`
holds `wxAngleRows` and nothing else, so Node can import it and run the shipped
function. `src/routes/admin/collab-angle-product-band.tsx` is the band;
`collab-angle-product-pics.ts` fetches the pictures. That split exists so the
rules below are tested rather than asserted in a comment.

The rules, each one a check in `pnpm verify:angle-products`:

- Biggest earner leads, so the product carrying an angle is read first.
- A video with no product is kept, under one honest label, always last, even
  when a real product earns less. Dropping it is how a breakdown stops summing
  to the angle total above it.
- If NOT ONE video in the angle names a product there are no bands at all --
  otherwise the whole list sits inside a single row reading "No product
  recorded", which is noise.
- One product spelled `Gel`, `gel` and ` GEL ` is one band.
- Folding hides rows and never changes a band's counts or figures. A total that
  moves when you fold a section is a total nobody can trust.
- Bands are open by default and the fold state is per card: two angles sell
  different products, so one shared set would fold a band in an angle nobody
  touched.

**The pictures come from `collab-products`**, the same catalogue the Brands
screen reads, so one product cannot show two different pictures on two screens.
One fetch per brand, shared by every band in every angle; a failure is never
cached; a missing or 404 image falls back to a neutral tile of the same size
rather than the browser's torn-image glyph.

**Brand-agnostic, and enforced.** `check-angle-products.mjs` refuses a brand
name anywhere in those three modules, comments included -- it caught one in a
comment of mine on the first run. There is no brand and no list of known
products in the grouping; it groups on whatever `product` the rows carry.

**What it still cannot prove.** Whether a given brand's `video_codes` rows carry
a product at all is a data question. With `SUPABASE_SERVICE_KEY` set the script
reports coverage brand by brand and fails if a brand with videos has a product
on none of them. The repo `.env` holds only the publishable key, which is
refused (`permission denied for schema wurxbase`) because `wurxbase` is granted
to signed-in roles -- correct behaviour, not a misconfiguration. `docs` note:
the same answer comes out of the SQL editor without any key, with the query in
the commit message for this change.

**A trap closed for good.** `wurxbase-patches.mjs` now REFUSES a swap whose `to`
is a substring of its `from`. Its idempotency check is `src.includes(sw.to)`, so
such a swap matched the unswapped text, reported "already swapped", exited 0 and
changed nothing -- which is how the product briefly rendered twice.

**Proven.** `pnpm build`, `pnpm verify:isolation`, `pnpm verify:angle-products`
(35 checks) and `pnpm verify:angles-categorise` (53 checks) all pass, and the
patch script is idempotent at 20 blocks.

### 2026-10-30, the worker stops spending videos on a dead quota

Gemini stays on the free key (about 500 requests a day), so a spent quota is an
ordinary daily event and not an outage. Before this, the worker charged every
unplaced video one attempt and started the next batch at once: a dead quota
moved a whole queue to `failed` in minutes, and each video had been blamed for
something that was never its fault.

**How a dead quota actually reaches the worker** (read from
`audit-backend/Backend`, not assumed): as `unplaced` videos whose reason is the
bare word `module_failed` (the job itself still says `succeeded`), AND as
`needs_review` *placements* whose note is "no visual evidence" or "the angle
judgement returned nothing". The second form matters: the worker used to count
those as placed, so a batch hit by the quota looked like a success.

**What changed** (`collab-angles-sync`, `_shared/audit-api.ts`, and the new
`_shared/angle-backoff.ts`, which has no imports so it can be tested):

- **Environmental failures are not charged**, in a batch of more than one
  video. A bad video among good ones is caught anyway: it ends up alone in a
  later batch, where it IS charged. A lone video is always charged, or a video
  that fails by itself would sit at the head of the queue for ever and block
  everything behind it. TikTok download refusals follow the same rule.
- **A wait before the next batch.** When nothing in a batch was confidently
  placed and every reason (unplaced reasons and `needs_review` notes alike) is
  environmental, the batch is marked `ENV:` in its `error`. The worker then
  waits 5, 10, 20, 40, then 60 minutes between batches for as long as they keep
  failing that way; any other batch ends the run, so a recovered quota clears
  it with no reset. No migration: it reads the last ten finished batches. In
  flight work is never held up. A dead day costs about one probe batch an hour
  on the audit machine (CPU, almost no quota).
- **A refused submit no longer loops.** It used to put the videos back uncharged
  and build the same batch every minute for ever. A 401/403 (our key) now waits
  like the above; a 429 (their queue is full) is a wait, not a failure; any
  other refusal charges the videos, so three of them end it. A batch that fails
  three times for our own reasons (no brief, say) charges them too.
- **The 422 reason is recorded.** FastAPI's `detail` is a list; it was reduced to
  "HTTP 422".
- **Brief labels are cut to 80 characters**, the backend's limit.
- **`needs_review` is re-run once** before anyone is asked to look, as the
  backend's docs say, unless the whole batch was environmental (then it is
  simply tried again later, uncharged). A placement that filing neither wrote
  nor recognised is charged instead of sitting queued for ever.
- **Unreachable for over 6 hours** closes the batch with an `ENV:` error and
  returns its videos uncharged, instead of waiting for ever.

**Known limits, so nobody is surprised:**

- **A brand-level fault now costs a brand its queue.** An unreadable or
  unshared brief (a 422 naming `briefs.*`) or "no active brief" is the same for
  every video of that brand. It used to loop for ever and lose nothing; now it
  charges five videos per batch until every queued video of that brand is
  `failed`. Treating those as brand-scoped (no charge, no global cooldown)
  needs a decision about where to record the pause, so it is not done.
- **A dead quota at brief compile does not fail the job.** With the auto
  backend the audit machine falls back to its rule engine and flags
  `BACKEND_DEGRADED`, so a job can run on a degraded brief while Gemini is down.
  That is the backend's behaviour, not the worker's.
- **A quota that dies part way through a batch** with some videos already
  placed leaves the rest uncharged and the next batch tries again at once; the
  cooldown starts with the first batch where nothing was placed.
- Nothing on the screen shows a batch's `error`, so an `ENV:` cooldown is visible
  only in the table. Patch 0002's Gemini note counts a queued video only if its
  `attempts` is above zero, and uncharged videos have none, so it would read
  zero during exactly this case; the queued half of its test should key on a
  model-looking `last_error` alone.
- Rule 14 (split a failing batch to find the one bad video) is still not built.

**Proven:** `pnpm verify:angles-backoff` (56 checks: every real reason string
from the audit machine, the lone-video rule, the `needs_review` quota case, and
a simulated day of dead quota across 167 videos in which at most the one lone
tail video fails) and `pnpm verify:angles-categorise` (53). **Not proven:** the
worker on the real Deno runtime against the real database; it was syntax
checked only.

**Deploy** (the owner; the CLI in this folder may still be linked to the OLD
project, so relink first and name the project every time):

```
supabase link --project-ref qinxwfdwvpkzfhcijuqw
supabase functions deploy collab-angles-sync --project-ref qinxwfdwvpkzfhcijuqw
```

**Screen patches applied, 2026-10-30** (`audit-backend/patches/0001` and `0002`,
with three changes made while applying them so they fit the worker above):

- The Gemini note counts a QUEUED video by its `last_error` alone, not by
  `attempts > 0`, because the worker no longer charges an attempt for a spent
  quota. As written, the note would have read zero in exactly the case it exists
  for. Its pattern also knows the audit machine's `needs_review` notes.
- The note no longer says "retried up to 3 times"; it says they are tried again
  automatically with longer waits, which is what now happens.
- The start message ("Already categorising 5 videos") shows ahead of the standing
  model note instead of being hidden by it.

Needs `supabase functions deploy collab-angles --project-ref qinxwfdwvpkzfhcijuqw`
for the note to appear; the screen works against the old function (it reads 0).

### 2026-10-30, the Categorise queue screen

Umar: staff must be able to SEE the queue, see which brands' videos are in it,
and EDIT it; then: the Categorise button should open the queue showing every
status and those features.

**The Categorise button now opens a dialog instead of starting a run.** Starting
this brand's month is the first control inside it. Below that is every brand and
month in the queue, in the order the worker will take them, with a chip per
status (All, Waiting, With the audit server, Failed, Needs a look, Filed,
Skipped) and a count badge on the button for what is still to do. A pause shows
as a notice with the reason in plain words ("TikTok is refusing downloads from
the audit server...") instead of a queue that silently does nothing.

**Edits**, per brand and month or per selected video: move a brand to the front
("Run next"), remove the whole brand or chosen videos, put failed or flagged
videos back with fresh attempts. Removing only takes a video out of the queue;
Categorise queues it again.

**Where it lives.** Reads and writes are `queue.*` actions on `collab-angles`
(list, remove, remove_group, retry, retry_group, prioritise), behind the same
staff check, audited, and naming rows by id, brand and month only, never a link.
The screen is `src/routes/admin/collab-angle-queue.tsx`, mounted from the
Categorise button, so the vendored `CreativeAngles.jsx` is untouched. The shared
call helper moved to `collab-angles-api.ts` because the two files would
otherwise import each other.

**Rules the function enforces, not only the screen:** a video that is `sent` is
at the audit machine and is never removed or retried; `filed` and `skipped` are
history and are listed but read-only; the history is fetched separately from the
pending list so a long run of filed videos cannot push waiting ones off the end;
history totals are exact while the listed history is the latest 400. "Run next"
works by making the brand's waiting videos one second older than the oldest
waiting video, since the worker orders by `created_at`.

**Proven:** `pnpm verify:angles-queue` (42 checks, and it was shown to fail when
the removable list or an action name is broken), `pnpm build`, the function's
exact selects run against CreatorHub. **Not proven:** the dialog in a browser and
the edits against a real staff session. Nobody on this machine has a staff
login, so the first real use is the first real test.

### 2026-10-30, the worker is tested against a Gemini outage and recovery

`pnpm verify:angles-worker` runs the REAL `collab-angles-sync` handler in Node
with only its edges replaced: an in-memory database (`scripts/lib/mock-supabase.mjs`),
a fake audit backend that can be switched between healthy, Gemini down,
recovering, offline and 503, and a controllable clock so a day of cron ticks
(once a minute, as scheduled) runs in a moment. 29 checks:

- Gemini down: videos return to the queue uncharged, the batch is marked `ENV:`,
  and the worker waits (5, 10, 20, 40, then an hour) instead of sending more.
- Twelve hours of that: about one probe batch an hour at the end, every video
  still queued, none charged, none failed.
- Quota back: it notices within the hour with nobody pressing anything, files all
  of the videos, clears the wait, and does not keep waiting.
- Dying part way through a batch, and Gemini "answering" but unable to see the
  videos (the `needs_review` form): kept and not charged, then filed on recovery.
- A video that fails alone still runs out of attempts, so it cannot block the queue.
- Audit machine unreachable, or answering 503 "GEMINI_API_KEY not set": the batch
  is held, nothing is charged, and it finishes when the service is back.

Run against the worker as it was before these fixes (4ab6d9c), 16 of the 29
fail: the five videos were charged an attempt at once, the next batch went out
immediately, and `needs_review` videos were parked. It passes only the offline
and 503 cases, which were already correct.

**What it does not prove:** that the live audit machine produces exactly these
reason strings (they were read from its source), or the real Deno runtime. The
live batch history on CreatorHub shows the same `ENV:` pattern happening for
real, including the "no visual evidence" form that is the Gemini vision pass
failing, followed by a recovery.
