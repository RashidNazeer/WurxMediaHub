# Project state

**Written 2026-10-30**, from `git log`, `docs/OPERATIONS.md`, `docs/guides/NEW_MACHINE.md`
(sections 5 and 6), `docs/plans/PAGE_PLAN.md` and the code. It replaces the old project-state log,
which stops at 2026-10-13 and is kept at `docs/archive/PROJECT_STATE_to_2026-10-13.md` (the
build history of everything before the PRISM rebrand lives there). Anything this file could not
confirm from the repo or git is marked **unverified**.

If this file and reality disagree, fix this file in the same commit.

## What the product is

**PRISM** is the creator platform behind Wurx Media's TikTok Shop brands (Wurx Media is the
company, PRISM is the product; see the first paragraph of `CLAUDE.md`). Creators apply once, get
approved, and enter branded **Brand Hubs** where they see their real numbers (GMV, commission,
ad spend behind their own videos), leaderboards, contests, briefs and retainer offers. Staff
manage brands, offers, contests, users and data in an admin panel, which also hosts the vendored
Paid Collabs app (`src/vendor/wurxbase/`, Asad's product, not our code).

Creator rail today (`src/lib/nav.ts`): Home, Earn, Leaderboards, My content, Brands Hub.

## Environments

| Site | Vercel project | Built from | Database | State |
| --- | --- | --- | --- | --- |
| wurxmediahubdev.vercel.app | `wurxmediahubdev` | `WurxMediaHub` repo, branch `dev` | CreatorHub | live; the daily-work site |
| prismwurx.vercel.app | `prism` | the separate `Prism` repo, `main` | CreatorHub (switched 2026-10-27) | live; the working PRISM site. Since 2026-10-29 both repos' `main` and `dev` are pushed together and sit on the same commit |
| wurxmediahub.vercel.app | `wurxmediahub` | `WurxMediaHub` repo, `main` | `wurxmediahub-prod` (**paused**) | serves the PRISM frontend against a paused database: every data call fails. A known state, not a bug to re-report |
| prism.wurxmedia.com | `prism-wurxmedia` | none (CLI deploys) | the old Prism project, already paused | not in use |

| Supabase project | Ref | Status |
| --- | --- | --- |
| `CreatorHub` (dev) | `qinxwfdwvpkzfhcijuqw` | ACTIVE, org Prism, ap-southeast-1. Dev since 2026-10-27 |
| `wurxmediahub-dev` (old dev) | `npznoiotslruqovorrec` | RETIRED 2026-10-27, only paused, never deleted (deletion: PARKED 45, not before 2026-11-10) |
| `wurxmediahub-prod` | `isqepjioowzqoyhlusqo` | INACTIVE (paused) |

Both PRISM sites share the one dev database. Remotes: `origin` is `RashidNazeer/WurxMediaHub`;
`prism` is `RashidNazeer/Prism`; this checkout has both configured, and every push goes to both.
All work happens on `dev`; `main` moves only when Rashid says "make it live". Secrets, tokens and their expiry dates
are in `docs/OPERATIONS.md` (GitHub token expires 2027-01-24, Vercel token 2027-10-27).

## What has shipped

Up to 2026-10-13 (detail in `docs/guides/NEW_MACHINE.md` section 6): the whole PRISM rebrand;
Home and My numbers on one velocity card (bars for amounts, a line for ROI); the pipeline split
into rail and work; redesigned Offers, Contests, Brand hub, Leaderboards, My content and the
Add-a-video sheet; the shared failed/empty `DataState`; the admin brand hub editor; the app
installable on a phone (PWA).

Since then, newest last (dates are commit dates):

- **2026-10-14** Euka ad figures stored per day, so a date range answers honestly; the period
  picker with date ranges on the brand page. The glass redesign planned
  (`docs/guides/GLASS_PLAN.md`), GSAP, Lenis and the React Bits fetcher added to the stack, the
  motion layer built (`docs/guides/MOTION.md`), the fence guard and blur budget added
  (`pnpm verify:backdrop-ancestry`, `verify:blur-budget`).
- **2026-10-15 to 17** The glass material applied to the creator app, the admin and the landing
  page; aurora ground, dark mode darkened; new Home and charts (`docs/archive/REDESIGN_HANDOFF.md`);
  creator navigation reviewed against Cruva (`docs/archive/CREATOR_NAVIGATION_REVIEW.md`).
- **2026-10-19** Decision: the Brand hub stays as its own floor (`docs/DECISIONS.md`). Page-by-page
  simplification (`docs/plans/PAGE_PLAN.md`): Support removed, Profile replaced by an account menu,
  a marketplace Brands Hub, Earn (offers and contests together), a podium leaderboard, one font
  family site-wide.
- **2026-10-20** Admin UI moved onto the creator app's visual language, "Brands Hub" rename;
  Reacher videos kept and filed on the creator's row for the month they were posted.
- **2026-10-26 to 27** The shared settings row stopped looping through every open session
  (`398a372`). **The dev database moved to CreatorHub** (`docs/OPERATIONS.md`, "The Hub moved to
  CreatorHub"). **Backup data** shipped: admin-only whole-database backup and restore, migration
  `20261027120000`, Edge Function `backup-data` (`docs/guides/BACKUPS.md`, OPERATIONS section 4a).
- **2026-10-28** Euka product list no longer fails with error 400 when onboarding a creator
  (`pnpm verify:euka-date-keys`).
- **2026-10-29** Creative-angle **Categorise** automation: queue screen, worker backoff when the
  Gemini quota is spent, and tests (`docs/guides/CREATIVE_ANGLE_AUTOMATION.md`,
  `pnpm verify:angles-*`, `pnpm verify:angle-functions`). Repo audit waves 1 and 2: dead code
  removed from `src/`, one unused dependency removed, `scripts/` reorganised into folders.

## In flight

- **`audit-backend/`** is an untracked snapshot of the video-audit backend at the repo root. The
  owner decides what happens to it; nobody else touches it.
- **Categorise is live on CreatorHub** (verified 2026-10-30): the pg_cron job
  `collab-angles-cycle` is active every minute, the audit backend runs in Docker behind ngrok on
  an Oracle Always Free VM (not on anyone's laptop), and the queue screen is deployed. Two
  standing constraints: the Gemini key is on the **free tier (about 500 requests a day)**, and
  the TikTok login cookies on the Oracle machine can expire, after which downloads fail (seen
  2026-10-29). The worker waits and keeps videos queued in both cases
  (`docs/guides/CREATIVE_ANGLE_AUTOMATION.md`, `pnpm verify:angles-worker`).
- **Known open item:** the hero visual asks for a 1080 painted MP4 that is not shipped on
  desktop Safari (the code falls back to the still image); a one-line fix in
  `HeroVisual.tsx` matches the comments' intent but changes what Safari users see, so it is
  untouched.
- **Legacy Supabase keys.** Edge Functions and scripts still use the legacy service and anon
  keys; the move to `sb_secret` / `sb_publishable` is listed under "Still to do" in OPERATIONS.

## What is open

The deferred work, each item with the trigger that brings it back, is in `docs/PARKED.md`. Read it
rather than relying on this list. Headlines, so you know where to look:

- Prod promotion rehearsal and prod admin account (PARKED 4, 4b); Supabase paid plan (5).
- TikTok app resubmission (PARKED 27 and its sub-sections); Content-Security-Policy (6).
- Retire the old `wurxmediahub-dev` project (PARKED 45).
- From `docs/guides/NEW_MACHINE.md` section 6, still **unverified** as of 2026-10-13: the admin
  brand pages (Briefs and Products tabs) opened in a browser; TikTok OAuth from the installed
  PWA on a real phone; the bundle size (`App-*.js` over 1 MB, mostly vendored Paid Collabs admin
  code shipped to every creator).

## How to verify

Run from the repo root. `pnpm build` is the gate before any commit.

| Command | Proves | Needs |
| --- | --- | --- |
| `pnpm build` | entry-graph, token and contrast parity, brand-theme, creator/admin isolation, `tsc -b`, then `vite build` | nothing |
| `pnpm typecheck`, `pnpm lint` | types, oxlint | nothing |
| `pnpm check:contrast` | dark/light token parity and WCAG AA | nothing |
| `pnpm verify:isolation`, `pnpm verify:entry-graph` | no creator/admin imports across the line; no heavy package on the entry path | nothing |
| `pnpm verify:angle-functions` | the shared Edge Function type check | nothing |
| `pnpm verify:angles-categorise`, `-queue`, `-backoff`, `-worker` | the Categorise automation, offline | nothing |
| `pnpm verify:browser` | real Chromium: console errors, both themes, responsive | `pnpm build` then `pnpm preview` on :4173 |
| `pnpm verify:rls`, `pnpm verify:session` | RLS holds against a real user; sign-in survives refresh and two tabs | `SUPABASE_SERVICE_KEY` in the environment |
| `pnpm verify:backdrop-ancestry`, `pnpm verify:blur-budget` | the glass fence law and blur budget | a running server |
| `pnpm verify:all [url]` | every suite in sequence, one summary | server and service key; dev only |

Full command list: `README.md`. How each suite works and its traps: `docs/OPERATIONS.md` section 3.
