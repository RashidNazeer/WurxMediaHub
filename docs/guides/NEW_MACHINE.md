# Moving PRISM to a new laptop

Written on 2026-10-13, on the machine being replaced. Read this top to bottom
once before you start. It assumes the new laptop has nothing on it.

**Do the "Before you wipe the old laptop" section FIRST.** Several things this
project needs are not in the repository and cannot be recovered from GitHub. If
the old machine is gone before you copy them, some of them are gone for good.

---

## 1. Before you wipe the old laptop

Copy these off it. None of them are in git.

### 1.1 `.env` — the one that actually matters

At the repository root. It is gitignored, so cloning gives you `.env.example`
with empty values and nothing else. Without it the app cannot start.

It holds six values:

| Key                             | What it is                                                         | Recoverable?                     |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| `VITE_SUPABASE_URL`             | the dev project URL                                                | yes, from the Supabase dashboard |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key, **not** the legacy `eyJ...` anon JWT | yes, from the dashboard          |
| `STITCH_API`                    | Google Stitch, used by an MCP server, not by the app               | only if you still have it        |
| `RESEND_API`                    | email                                                              | only if you still have it        |
| `REACHER_API`                   | email verification                                                 | only if you still have it        |
| `CRUVA`                         | Cruva API                                                          | only if you still have it        |

The bottom four are third-party keys. If they are not written down anywhere
else, copying this file is the only way to keep them. **Copy `.env` to a USB
stick or your password manager now.**

It is gitignored on purpose and must stay that way. Never commit it.

### 1.2 Anything under `Downloads\` the docs refer to

`docs/archive/PROJECT_STATE_to_2026-10-13.md` mentions `Downloads\Creator Home - current\`. Check for
design exports, brand kits and briefs that only exist locally. The PRISM brand
kit itself lives at `design\prism_brand_kit\` inside the project folder, so
that one travels with the repo copy if you copy the whole folder rather than
re-cloning.

### 1.3 The dev account passwords

Three accounts were used for testing. The passwords are **not** written in this
file and must not be, because this file is committed to two GitHub repositories.
Put them in your password manager before you wipe the machine:

- `babblingbrookej@wurxmedia.com` — a creator with almost no data. Tests the
  empty and in-progress states, which is most of what the design work is about.
- `rudely@wurxmedia.com` — a creator with real GMV, orders and eight days of
  history. Tests the working state.
- `rashid@wurxmedia.com` — `docs/OPERATIONS.md` names this as the dev admin.
  **Its password was never stored anywhere**, and that is still true. If you do
  not know it, reset it from the Supabase dashboard.

`mrrashid3255@gmail.com` does **not** exist on the dev project. It was tried and
rejected; do not waste time on it.

---

## 2. Install on the new laptop

In this order.

```
1. Git                 2.55 or newer
2. Node.js             v24.20.0 was in use. Any v24 LTS is fine.
3. pnpm 11.17.0        corepack enable && corepack prepare pnpm@11.17.0 --activate
                       package.json pins packageManager, so pnpm will match itself.
4. Supabase CLI        2.119.0 was in use. scoop install supabase, or the installer.
5. VS Code + Claude Code
```

`pnpm install` will fetch Playwright, but **not** its browsers. Run this or
every verification script fails with a confusing launch error:

```powershell
pnpm exec playwright install chromium
```

**`docs/guides/DEPENDENCIES.md` is the companion to this file**: every package, what
each one is for, which of them reach the creator's phone, and what is
deliberately absent and why.

### Clone both remotes

The project lives in two GitHub repositories, kept byte-identical:

```powershell
git clone https://github.com/RashidNazeer/Prism.git PRISM
cd PRISM
git remote rename origin prism
git remote add origin https://github.com/RashidNazeer/WurxMediaHub.git
git fetch origin
```

The naming matters only because every note in these docs says `origin` means
WurxMediaHub and `prism` means Prism. Keep it that way or the instructions stop
matching.

Then restore `.env` from section 1.1 and:

```powershell
pnpm install
pnpm dev
```

### Git authentication

The old machine used Windows Credential Manager (`credential.helper=manager`),
so the GitHub token is in the OS vault and will not travel. On first push you
will be prompted; sign in as the GitHub user you normally use.

**Commits are authored as `RashidNazeer <wurxmedia@gmail.com>`.** The old machine
set this per-command rather than globally. Set it globally on the new one and
stop thinking about it:

```powershell
git config --global user.name "RashidNazeer"
git config --global user.email "wurxmedia@gmail.com"
```

### Supabase CLI

**Never run `supabase login`.** The docs say so because a separate project is
signed in and must not be disturbed. On a brand new laptop that no longer
applies — there is nothing to disturb — so log in once, then stop.

Then link the repository to the DEV project:

```powershell
supabase link --project-ref qinxwfdwvpkzfhcijuqw
```

This writes `supabase/.temp/`, which is gitignored. **A git worktree does not
inherit it**, which cost an hour on the old machine: any `supabase` command run
from a worktree answers "Cannot find project ref" until you copy that folder
across from the main checkout.

---

## 3. What you are working on

PRISM is the creator platform for Wurx Media's TikTok Shop brands. Creators
apply once, get approved, and see their real numbers: GMV, commission and the ad
spend behind their own videos, plus leaderboards, contests, briefs and retainer
offers. Admins manage brands, campaigns, users and data.

**Transparency is the product.** The moment that matters is a creator logging in
and seeing their real GMV.

Read these in the repository, in this order, every session:

1. `CLAUDE.md` — the working rules. It wins over everything, including this file.
2. `docs/PROJECT_STATE.md` — where things are. Rewritten 2026-10-30; the old
   file (stale from 2026-10-13, its NEXT ACTION dated 2026-09-29) is kept at
   `docs/archive/PROJECT_STATE_to_2026-10-13.md`. Section 6 below is the
   picture as of 2026-10-13.
3. `docs/PARKED.md` — work deliberately deferred, each with the trigger that
   should bring it back.
4. `docs/OPERATIONS.md` — project ids, commands, deploy flow and the Windows
   traps. **One thing in it is wrong for you**: it says credentials live at
   `C:\Users\RA_shid\.wurx\cli-secrets.env`. That path was from yet another
   machine and did not exist on the one being replaced either. See section 5.
5. `docs/FEATURE_MAP.md` — only the entries you are about to touch. This is the
   long one and it is where the real reasoning lives.

---

## 4. The stack, which is locked

React 19 + Vite + TypeScript strict · Tailwind v4 + shadcn/ui, heavily themed ·
TanStack Query for all server state · React Router, code-split · Motion for
animation · Zod on every input · Supabase (Postgres, Auth, RLS, Realtime,
Storage, Edge Functions) · Vercel · pnpm.

No Next.js. No ORM. No state library beyond TanStack Query. Changing any of this
needs Rashid's approval.

Rough size, so you know what you are opening: 93 migrations, 21 Edge Functions,
125 scripts, 18 docs.

### Commands

```powershell
pnpm dev              # local dev server
pnpm build            # token guard + tsc + vite build. Must pass before commit
pnpm typecheck        # tsc -b
pnpm lint             # oxlint
pnpm format           # prettier --write
pnpm check:contrast   # dark/light token parity + WCAG. Runs inside build
pnpm verify:browser   # real Chromium: console errors, both themes, responsive
pnpm verify:rls       # attacks the database as a real user, proves RLS holds
pnpm verify:session   # refresh, two tabs, reopen, form survival
pnpm shots            # retina screenshots for design review
```

`verify:rls` and `verify:session` need `SUPABASE_SERVICE_KEY` in the
environment. Fetch it at run time; never write it to a file:

```powershell
$keys = supabase projects api-keys --project-ref qinxwfdwvpkzfhcijuqw --output json | ConvertFrom-Json
foreach ($k in $keys) { if ($k.name -eq 'service_role') { $env:SUPABASE_SERVICE_KEY = $k.api_key } }
```

---

## 5. Where everything lives

### Two repositories, kept identical

| Remote   | URL                                    |
| -------- | -------------------------------------- |
| `origin` | `github.com/RashidNazeer/WurxMediaHub` |
| `prism`  | `github.com/RashidNazeer/Prism`        |

Every push goes to both. As of 2026-10-13 all branches are byte-identical on
both, with `main`, `dev` and `feature/prism-phase-1-tokens` all on the same
commit.

### Three deployed sites, each built from ONE branch

| Site                         | Branch              | Database         |
| ---------------------------- | ------------------- | ---------------- |
| `prismwurx.vercel.app`       | a non-`main` branch | dev (live)       |
| `wurxmediahubdev.vercel.app` | `dev`               | dev (live)       |
| `wurxmediahub.vercel.app`    | `main`              | **prod, PAUSED** |

This is the question that comes up most: _"why does it look old / why is it
broken?"_ The answer is almost always **which branch that site builds from**,
not the code. On 2026-10-12 `main` was brought up to the same commit as `dev`,
so all three now serve PRISM.

### Two Supabase projects

| Project             | Ref                    | Status                              |
| ------------------- | ---------------------- | ----------------------------------- |
| `CreatorHub` (dev)  | `qinxwfdwvpkzfhcijuqw` | ACTIVE, ap-southeast-1, org Prism. Dev since 2026-10-27, the one you use |
| `wurxmediahub-dev`  | `npznoiotslruqovorrec` | RETIRED 2026-10-27 (org WurxMedia went over its free quota). Only ever paused, never deleted. |
| `wurxmediahub-prod` | `isqepjioowzqoyhlusqo` | **INACTIVE / paused**               |

**There is only one dev database and both PRISM sites share it.** `prismwurx`
and `wurxmediahubdev` are the same data. There is no separate "Prism database".
If the two are ever meant to stop sharing, that is real work: a new project, all
93 migrations, every Edge Function, new keys and seed data.

**Production is a live trap right now.** `wurxmediahub.vercel.app` serves the
PRISM frontend against a paused database with no migrations applied and no Edge
Functions deployed. It will look correct and fail on every data call: no
sign-in, no GMV, no brands. Rashid was told this twice and asked for it anyway,
so it is a known state, not a bug to re-report. Bringing prod up means: resume
the project, apply all migrations in order, deploy every Edge Function,
regenerate types, then smoke-test.

### Database changes

```powershell
supabase migration new <name>
# edit supabase/migrations/<stamp>_<name>.sql
supabase db push --dry-run     # ALWAYS. It names exactly which migrations run
supabase db push
supabase gen types typescript --linked > src/types/database.ts
```

Never edit a migration that has already been applied; add a new one. Every new
table needs RLS enabled from creation, deny by default, **and** explicit grants
including `grant all privileges on table X to service_role;` — "Automatically
expose new tables" is OFF, which also disables the default grants to
`service_role`, and forgetting it makes Edge Functions silently read nothing.

When you regenerate types, write the file with Node rather than a PowerShell
redirect. See the traps in section 8.

---

## 6. Where things actually stand

`PROJECT_STATE.md` was stale when this was written (it has since been rewritten, 2026-10-30). This is the real picture as of 2026-10-13.

### Shipped and merged

The whole PRISM rebrand, on `main` and `dev` on both repos. Including, most
recently:

- **Home and My numbers** rebuilt around one shared "velocity" card: a GMV hero,
  four stat tiles, and a chart that uses **bars for amounts and a line for ROI**.
  That split is a correctness rule, not taste — a line between daily totals
  draws slopes that never happened.
- **The pipeline** split into a rail (dots and labels only) and the work sitting
  on it, which removed about a thousand pixels of dead space.
- **Offers, Contests, the brand hub, Leaderboards, My content, Profile and the
  Add-a-video sheet**, all redesigned by five parallel agents against the
  redesign brief, then merged and verified.
- **A shared failed/empty/freshness component** (`src/components/ui/DataState.tsx`)
  with a retry that works. Before it, there were 79 hand-written error branches
  and `refetch` appeared in five files, all of them admin — no creator-facing
  screen offered a way to try again.
- **The brand hub editor** on the admin side, with its migration applied to dev
  and `manage-brand` redeployed.
- **The app is installable on a phone** (PWA): manifest, four icons rendered
  from the PRISM tile, and a deliberately almost-inert service worker.

### Verified, by looking

The creator app on two accounts (one with real data, one nearly empty), all
eight screens, at 1440 light and 375 dark: zero console errors, zero horizontal
page overflow. The PWA was checked against a real production preview: 24 checks,
all passing.

### NOT verified, and this is the honest list

1. **The admin brand pages have never been opened in a browser.** The Briefs
   tab, the Products tab and the brand leaderboard are the newest code in the
   project, written against a migration applied the same day. They typecheck and
   build. Nobody has looked at them. This needs the dev admin login.
2. **TikTok OAuth from the installed app.** That flow leaves to the system
   browser and returns, and in standalone mode the return can land in a
   different context. This product is explicitly engineered against random
   logouts, so it deserves a real phone before anyone is told it is safe.
3. **`scripts/verify/brands/check-brands.mjs`** was edited to follow the brand hub's new tab
   order but could not be run — it needs a service key the old machine did not
   have. The edits are reasoned from the markup, not proven.

### Next up, roughly in order

- Close the three unverified items above.
- The bundle: `App-*.js` is **1,055 kB** raw, nearly all of it the vendored Paid
  Collabs admin code, shipped to every creator who can never open it. This is
  the biggest remaining performance problem and it has been outstanding a while.
- "Fix the file structure of the codes", asked for and not done.
- `docs/PROJECT_STATE.md` needs rewriting to match reality (done 2026-10-30).

---

## 7. Logging in, for testing

Two creator accounts and one admin, listed in section 1.3. Passwords are not in
this file on purpose.

Sign-in doors:

- `/login` — creators and applicants
- `/admin/login` — staff. The router allows only `applicant` and `creator` into
  `/app/*`, so a staff account cannot browse the creator app and vice versa.

For scripted checks, sign in once, grab the storage state, and reuse it across
contexts rather than logging in per page. Every verification script in
`scripts/` that needs a browser does it that way; copy one.

---

## 8. Traps that cost real time. Read this twice.

### PowerShell will corrupt your source files

`Get-Content` / `Set-Content` on Windows PowerShell 5.1 read a file as the ANSI
codepage and write it back as UTF-8, silently re-encoding every non-ASCII
character. **It reached users**: the public site rendered a client's name with
the wrong letters, and a non-breaking space in a chart came out as a visible
`Â` under six labels.

**Never round-trip a source file through PowerShell.** Use the editor, or Node.
The same applies to `supabase gen types ... > file`: redirect adds a BOM. Write
it with `[System.IO.File]::WriteAllText(path, text, UTF8Encoding($false))` or
with Node.

PowerShell also mangles inline `node -e "..."` scripts containing quotes,
regexes or braces. Write a `.mjs` file and run it instead; it fails less and
reads better.

### A check that reports everything failing is probably a broken check

This happened twice in one session. A branch audit reported all fifteen branches
unpushed; the real cause was that `cmd` does not treat `'` as a quote, so git got
a truncated `--format` and returned no hashes at all. Before relaying an alarming
result, ask whether the tool could be the thing that is broken.

### Measure, do not reason, about layout

Several bugs were only ever found by asking the browser what it painted:

- A floating header pinned at `top-3` leaves a 12px window **above** it that page
  content scrolls through. Opaque does not help; only closing the gap does.
- A probe that reports "the widest overflowing element" will blame decorative
  blobs that are already clipped and cannot widen anything. Discard anything an
  ancestor clips before naming a culprit.
- `-mx-4 px-4` against a `px-3` page gutter is 4px of horizontal page scroll.

### Motion is in strict mode

`motion.div` **throws at runtime**. Use `m.div` from `motion/react`. Hooks like
`useScroll` and `useReducedMotion` import normally.

### Other standing rules worth remembering

- **No borders anywhere.** Shadows and the neomorphic utilities carry every
  edge. The only exception is the `forced-colors` block in `global.css`.
- **Content fills the width.** Never centred, never a max-width cap.
- **Every type size in rem**, never px. The 44px tap floor is the only
  sanctioned px.
- **Every colour is a `--wx-*` token**, and a token added to one theme must
  exist in the other. `check-contrast.mjs` fails the build otherwise.
- **Never trust a role, tier or `creator_id` from the client.** Identity comes
  from `auth.uid()` and JWT claims. Hiding a button is never the security
  boundary; the database is.
- **Browser bundle may contain only the Supabase URL and publishable key.**
  Service-role keys live only in Edge Function secrets.

---

## 9. First day on the new laptop, as a checklist

```
[ ] .env copied over and in place at the repo root
[ ] pnpm install
[ ] pnpm exec playwright install chromium
[ ] pnpm dev            -> the site loads at localhost
[ ] pnpm build          -> passes (this runs the token guards too)
[ ] git config user.name / user.email set globally
[ ] git push to a throwaway branch, confirm GitHub auth works, delete it
[ ] supabase login, then supabase link --project-ref qinxwfdwvpkzfhcijuqw
[ ] supabase migration list  -> connects and lists ~93 applied migrations
[ ] sign in at /login as a creator account -> you see real numbers
[ ] read CLAUDE.md, then PARKED.md
```

If `pnpm build` passes and you can sign in and see a GMV figure, the machine is
set up correctly. Everything else is detail.

---

## 10. One thing to fix early

`docs/OPERATIONS.md` section 2 points at a credentials file that does not exist
and has not existed on the last two machines. Either recreate it at the path it
names, or edit that section to describe what you actually do. Leaving it wrong
sends the next person — or the next agent — hunting for a file that was never
there, which is exactly what happened on the machine this file was written on.
