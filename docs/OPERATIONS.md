# Operations runbook

Everything needed to drive this project from a cold start, with no memory of
previous sessions. If something here is wrong, fix it here first.

---

## 1. Identifiers

| What              | Value                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| GitHub repo       | `RashidNazeer/WurxMediaHub` (private)                                                                 |
| Branches          | `main` = prod, `dev` = daily work. **Everything goes to `dev` only** until Rashid says "make it live" |
| Vercel team id    | `team_OL5SlbHFgyYvmXYyScEUmDo0`                                                                       |
| Vercel projects   | `wurxmediahub` (main), `wurxmediahubdev` (dev)                                                        |
| Dev URL           | https://wurxmediahubdev.vercel.app                                                                    |
| Prod URL          | https://wurxmediahub.vercel.app                                                                       |
| Supabase dev ref  | `npznoiotslruqovorrec`                                                                                |
| Supabase prod ref | `isqepjioowzqoyhlusqo`                                                                                |
| Supabase org      | `ivvtjbvjviwqotlwrqeh` ("Wurx Media")                                                                 |
| Commit identity   | `Rashid Nazeer <286085480+RashidNazeer@users.noreply.github.com>`                                     |

**Do not change the commit identity.** Rashid's personal email maps to a
different GitHub account (`TSRashid`), and Vercel's Hobby plan refuses to build
when it cannot match the commit author. Every deploy came back `BLOCKED` until
this was fixed.

## 2. Credentials

Secrets live **outside the repo** at `C:\Users\RA_shid\.wurx\cli-secrets.env`:

```
GITHUB_USERNAME, GH_TOKEN, VERCEL_TOKEN, VERCEL_TEAM_SLUG (blank),
SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD_DEV, SUPABASE_DB_PASSWORD_PROD,
SUPABASE_PROJECT_REF_DEV, SUPABASE_PROJECT_REF_PROD
```

**Never run `gh auth login`, `vercel login` or `supabase login.`** Rashid has a
separate project signed in on all three and it must not be disturbed. Every
command carries its own token instead.

Load them with this helper (recreate it in the session scratchpad if missing):

```powershell
# wurx-env.ps1
Get-Content "C:\Users\RA_shid\.wurx\cli-secrets.env" | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $v = $matches[2].Trim().Trim('"').Trim("'")
    if ($v) { Set-Item -Path "env:$($matches[1])" -Value $v }
  }
}
$env:GH_CONFIG_DIR = "<scratchpad>\ghconfig"   # keeps gh away from Rashid's real config
if ($env:Path -notlike "*scoop\shims*") { $env:Path = "$env:USERPROFILE\scoop\shims;" + $env:Path }
```

Then `. <path>\wurx-env.ps1` at the start of any command that needs a token.

The **service role key** is never stored on disk. Fetch it at run time:

```powershell
$keys = supabase projects api-keys --project-ref $env:SUPABASE_PROJECT_REF_DEV --output json |
        ConvertFrom-Json
foreach ($k in $keys) { if ($k.name -eq 'service_role' -and $k.type -eq 'legacy') {
  $env:SUPABASE_SERVICE_KEY = $k.api_key } }
```

`.env.local` (gitignored) holds the dev URL and the **publishable** key
(`sb_publishable_...`, not the legacy `eyJ...` anon JWT).

## 3. Commands

```bash
pnpm dev                 # local dev server
pnpm build               # token guard + typecheck + build. Must pass before commit
pnpm lint                # oxlint
pnpm preview             # serve dist on :4173, needed by every browser suite
```

**Run everything with one command**, and prefer this over picking suites by
hand:

```bash
pnpm verify:all [url]              # every suite below, in sequence, one summary
pnpm verify:all [url] --only=contests,live
pnpm verify:all [url] --skip=session
pnpm measure:nav [url]             # click to URL change, and click to painted,
                                   # cold and warm. ALWAYS against the LIVE url:
                                   # localhost has no latency, so "cold" is not
                                   # cold and the number flatters.
```

It checks its preconditions FIRST and names anything missing in a sentence (no
server, no service key, no demo creator) rather than letting eleven suites fail
for one reason. It makes ONE throwaway admin for the whole run and removes it in
a `finally`, so Rashid's account is never used. One suite at a time, because two
Chromiums at once put this machine into its page file. A failing suite's output
is printed in full so nothing has to be re-run to find out why.

**A SKIP exits non-zero, the same as a failure.** Something that could not be
checked must never read as safety.

**Re-run a failing FULL run before believing it.** On 2026-08-16 one reported
contests and responsive broken, every admin screen failing "content rendered",
and the screens were fine: loaded by hand at two widths and through the suite's
own storage-state path. Responsive then passed alone. The failing run took
**1313s against 721s** for the green one, because each failing check burns
twelve seconds waiting. That ratio is the tell: a wall-clock time far above
normal means suspect the machine before the code.

Why it exists: there were eleven suites and no way to run them all, so they were
run from memory and two were quietly red for days. `verify:responsive` since the
12 August wipe (a missing seeded account) and `verify:browser` since the surface
retune on 10 August (three hardcoded colours that tokens.css had moved past).
Both were found within a minute of `verify:all` existing.

Individual suites. All need a preview or live URL; most also need
`SUPABASE_SERVICE_KEY`:

```bash
pnpm verify:browser [url]   # landing page: console, both themes, responsive
pnpm verify:rls             # attacks the database as a real user
pnpm verify:session [url]   # section 11: refresh, two tabs, reopen, form survival
                            # 11 sections now. Section 9 is the identity
                            # swap: it makes a SECOND throwaway account, signs
                            # in as it in another tab, and asserts the banner
                            # names them rather than saying you were signed
                            # out. Both accounts are deleted at the end.
pnpm verify:apply  [url]    # sign up to stored application, end to end
pnpm verify:review [url]    # admin review pipeline + attacks. Needs ADMIN_EMAIL
                            # and ADMIN_PASSWORD too
pnpm verify:brands [url]    # brands and offers, end to end plus attacks.
                            # Needs ADMIN_EMAIL and ADMIN_PASSWORD too
pnpm verify:offer-requests [url]  # creators asking for offers, staff deciding,
                            # and nine attacks. Needs ADMIN_EMAIL/ADMIN_PASSWORD
pnpm verify:content [url]   # a creator posts a video, the team decides, and
                            # approving the last one finishes the job. Nine
                            # attacks. Needs SUPABASE_SERVICE_KEY
pnpm verify:live [url]      # admin moves a stage on the REAL admin screen,
                            # creator sees it on all three of their screens
                            # with no reload. Needs SUPABASE_SERVICE_KEY
pnpm check:brand-theme      # no database, no browser. Derives a full palette
                            # for 88 brand colours, including pure yellow,
                            # white, black and a full hue circle, and asserts
                            # 13 text-on-background pairs clear WCAG AA in both
                            # modes. RUNS INSIDE pnpm build, because a brand
                            # colour lives in the DATABASE and check:contrast,
                            # which only reads tokens.css, cannot see it.
                            # Since 2026-08-25 it also throws 1200 DETERMINISTIC
                            # random multi-colour themes at every stop of every
                            # gradient. BRAND_THEME_SAMPLES=40000 hammers it by
                            # hand; deterministic on purpose, because a guard
                            # that fails once and passes on the retry teaches
                            # everyone to press the button again
pnpm verify:legal           # 31 checks. /terms and /privacy render SIGNED OUT
                            # in both themes at 375 and 1440, have real content,
                            # are linked from the home page footer, and give a
                            # real contact address. They are a TikTok app
                            # SUBMISSION REQUIREMENT, so a route that quietly
                            # stops resolving would fail a review weeks later
pnpm verify:brand-theme     # 15 checks, no browser. Proves the WRITE PATH for
                            # a brand's colours: browser Zod -> Edge Function
                            # Zod -> save_brand_about -> the column. The one
                            # that matters is that a TEXT colour smuggled into
                            # the JSON is refused rather than quietly stripped,
                            # because stripping it would look like it worked.
                            # Makes its own admin, creator and brand, removes
                            # all three. Needs SUPABASE_SERVICE_KEY
node scripts/shots-brand-look.mjs http://localhost:4173
                            # the theme editor, both modes, four widths. Makes
                            # its own throwaway admin and deletes it in a
                            # finally, because no admin password is stored
                            # anywhere in this repo. Needs SUPABASE_SERVICE_KEY
pnpm verify:brand-numbers   # 17 checks, no browser. Signs in as a REAL creator
                            # and proves a Brand Hub shows that brand's money
                            # and no other. Also proves no OLD OVERLOAD of the
                            # RPCs survived: an unknown brand must return
                            # nothing. Needs SUPABASE_SERVICE_KEY
pnpm verify:numbers [n|date] # asks TikTok the same question the nightly sync
                            # asks and diffs it against tiktok_video_daily row
                            # by row. A penny of drift fails. Default 5 days,
                            # or pass a count or a single YYYY-MM-DD.
                            # Needs SUPABASE_SERVICE_KEY
pnpm verify:offers          # 26 checks, no browser. Attacks the offer audience
                            # rules as a REAL signed-in creator: a retainer they
                            # are not on must be unreadable AND unapplyable.
                            # Needs SUPABASE_SERVICE_KEY
pnpm verify:contests [url]  # 141 checks. Admin builds a contest and a
                            # deliverable on the real screens, a creator enters
                            # and claims on theirs, staff confirm it, the reward
                            # appears as owed, gets paid, and the creator sees
                            # it. Sixteen attacks. Needs SUPABASE_SERVICE_KEY.
                            # Makes its own accounts and removes them.
pnpm verify:responsive [url] # every screen at 375, 768, 1024 and 1440px.
                            # Needs ADMIN_EMAIL and ADMIN_PASSWORD, no service key
pnpm verify:chrome [url]    # the SHELL, not the screens: rail width, the hidden
                            # scrollbar, the menu keeping its scroll position
                            # when you click the last item, the mark collapsing
                            # the rail, the top bar naming the section and
                            # agreeing with the lit menu row, the content
                            # filling the width at 1280/1600/1920, and the
                            # text-size setting sticking across a reload without
                            # leaking onto the public page.
                            # Needs ADMIN_EMAIL and ADMIN_PASSWORD, no service key
pnpm shots [url] [path]     # retina screenshots of a PUBLIC page
pnpm shots:creator [url]    # the creator home WITH a full pipeline in it, both
                            # themes, four widths. Builds a throwaway creator
                            # and removes it again. Needs SUPABASE_SERVICE_KEY
node scripts/shots-collabs.mjs [url] [path]
                            # Paid Collabs (vendored WurxBase) in both themes at
                            # 1440/1024/768/390, plus the header on its own and
                            # the creators tab. Seeds THEIR session as a viewer,
                            # so a run cannot write to their database. Also
                            # reports page overflow and console errors.
                            # Needs ADMIN_EMAIL and ADMIN_PASSWORD
node scripts/check-admin.mjs <url> <email> <password> [role] [path]
node scripts/create-admin.mjs <email> <password> [role]
node scripts/wipe-clean-slate.mjs --yes        # DEV ONLY, IRREVERSIBLE.
                            # Every creator and applicant account, every offer,
                            # every contest. Keeps brands, staff, the audit log
                            # and tiktok_video_daily. Writes the handle-to-video
                            # mapping to a file first, because embed_id is the
                            # only link between a person and their TikTok money
                            # and it cascades away. Follow with reconcile-budgets.
node scripts/seed-creators.mjs [--clean]       # DEV ONLY
                            # Wurx's 41 real handles as approved creators, via
                            # the real review_application() path. Password for
                            # all of them is 1234567890, email is
                            # <handle>@wurxmedia.com. --clean removes only those
                            # 41, and only if they are creators or applicants,
                            # so it can never take Rashid's own account on the
                            # same domain.
node scripts/seed-penetrex-offers.mjs [--clean]
                            # DEV ONLY. Penetrex's August 2026 retainer from
                            # Rashid's sheet: 31 offers, 41 approved requests,
                            # $22,250 across 393 videos, each request walked to
                            # the stage the sheet says. Needs seed-creators to
                            # have run. Both paths recompute the brand's
                            # committed budget, which has no cascade of its own.
node scripts/seed-august-content.mjs [--clean] [--submitted-only]
                            # DEV ONLY. The 79 videos in the AUGUST-labelled
                            # blocks of the 20 per-creator content sheets, with
                            # their ad codes, submitted as the creator and
                            # approved as the admin, filed on the day each went
                            # up. Passes TikTok's item id as embed_id, which is
                            # what attaches real ad money. Needs the offers seed
                            # to have run first.
node scripts/check-brand-binding.mjs [brand]
                            # READ ONLY, and safe against prod. Proves one
                            # brand owns its offers, requests, videos, TikTok
                            # store and ad figures, and that nothing leaks to
                            # another brand. Run it whenever a second brand
                            # gets a store mapped.
node scripts/seed-penetrex-contest.mjs [--clean]
                            # DEV ONLY. One Penetrex contest with five entrants
                            # in five deliberate states, so the contest video
                            # queue has something in it. Walks the real
                            # functions, never writes a contest table directly.

pnpm verify:leaderboard      # 34 checks, mostly attacks. The board is the only
                            # place one creator sees another`s figures, so most
                            # of that suite is about what it must NOT hand over.

node scripts/tidy-dev.mjs [--yes] [--skip-money] [--brands "A,B"]
                            # DEV ONLY. Removes what is on dev but is not the
                            # product: test accounts (@wurxmediahub.test), test
                            # brands, and ad-money rows for videos nobody owns
                            # any more. DRY RUN unless --yes. It counts a
                            # brand's offers, jobs, videos and contests before
                            # touching it and REFUSES any that is not empty,
                            # because everything referencing brands cascades.
                            # It never touches audit_log or tiktok_sync_runs.

node scripts/sync-avatars.mjs [--refresh]
                            # DEV ONLY. Fetches each creator's TikTok profile
                            # picture ONCE into the private creator-avatars
                            # bucket, 25 at a time, and never retries somebody
                            # already tried. --refresh does everybody again.
                            # The ONLY thing that talks to unavatar.io, and it
                            # runs on Supabase's servers, not in a browser.
node scripts/seed-applications.mjs [--clean]   # demo queue data, DEV ONLY
node scripts/seed-brands.mjs [--clean]         # demo brands and offers, DEV ONLY
node scripts/seed-pipeline.mjs [--clean]       # videos against the approved jobs,
                                               # in five states, so every progress
                                               # bar has something to draw. Approves
                                               # through the REAL review_content.
                                               # DEV ONLY. Needs SUPABASE_SERVICE_KEY
node scripts/reconcile-budgets.mjs [--dry-run] # put brand budgets back in step
                                               # with their approved requests
```

Every suite creates real accounts and **deletes them afterwards**. Run against
dev only.

**A redesign re-runs every suite that asserts COPY, not just the suites for the
screens that were obviously touched.** The creator UI rebuild re-ran the content
and responsive suites but not `verify:offer-requests`, which asserts creator
copy from inside an admin flow. Two of its checks had been failing silently for
a day, on strings the redesign had deleted. If a step changes wording anywhere,
grep the `scripts/` folder for that wording before calling it done.

**Run them detached, never in the foreground.** Rashid's machine has 7.4 GB of
RAM and VS Code alone holds well over a gigabyte of it. A suite launching
Chromium on top of that pushed the machine into its page file far enough that
Windows killed the VS Code extension host mid-run ("the host unexpectedly
terminated"), which looks exactly like Claude hanging and cannot be stopped,
because there is nothing left running to stop. It also strands the test
accounts, since the cleanup step never gets to run.

```powershell
Start-Process -FilePath "node" -ArgumentList "scripts/check-brands.mjs","http://localhost:4173" `
  -WorkingDirectory "d:\Milestone\WurxMediaHub" `
  -RedirectStandardOutput "<scratchpad>\suite.log" `
  -RedirectStandardError "<scratchpad>\suite.log.err" -WindowStyle Hidden
```

Then poll the log. **Failures go to stderr**, so read the `.err` file too; a
green-looking stdout with missing PASS lines means the failures are in the
other file.

**Use a fresh log filename per run, and read with `grep -a`.** Re-running a
suite onto the same redirect target while the previous run's handle is still
open leaves the file NULL PADDED: the failure line is silently replaced with
zero bytes and only the summary survives, so the suite reports "1 check FAILED"
and the file cannot say which. `grep` also treats a file containing nulls as
binary and stops counting, which makes a full run look half finished.

**Never put `2>&1` after the `node` call inside a runner script.** PowerShell
5.1 wraps each stderr line from a native exe in an ErrorRecord, which then does
not reach `-RedirectStandardOutput` at all. The result is a log that ends
mid-suite with no failures in it and no error either, which reads exactly like
a passing run that stopped early. Redirect the two streams separately and read
both.

All suites launch Chromium through `scripts/browser.mjs`, which strips the GPU
process, extensions and background networking and caps the renderer heap. Add
new suites through it, not through `chromium.launch()` directly.

Shut the preview server down when finished. Orphaned `vite preview` processes
hold port 4173 and accumulate one per interrupted session.

The suites that need `ADMIN_EMAIL` and `ADMIN_PASSWORD` should NOT be pointed at
Rashid's account. Make a throwaway one for the run, then remove it:

```powershell
node scripts/create-admin.mjs suite-runner@wurxmediahub.test "<a password>" admin
# ... run the suite ...
# then delete the auth user and its audit rows with the service key
```

### Looking at an admin screen without a password

```bash
pnpm shots:admin /admin/offers              # both themes, 375 / 768 / 1024 / 1440
SHOT_CLICK='button[aria-controls^="offer-details"]' pnpm shots:admin /admin/offers
```

Every other browser suite wants `ADMIN_EMAIL` and `ADMIN_PASSWORD`. This one
makes a throwaway admin with the service key, signs in through the real login
form, and deletes it in a `finally`. It also reports horizontal page scroll at
each width and any console error, which is how "it works on a phone" gets
proved rather than asserted. Needs a server: `pnpm build` then `pnpm preview`.

`SHOT_CLICK` takes a second set of shots with something open. Half of a screen
carrying an accordion or a drawer is invisible in a shot of its resting state,
and that is usually the half being reviewed.

## 4. Database changes

```powershell
supabase migration new <name>
# edit supabase/migrations/<stamp>_<name>.sql
$env:SUPABASE_DB_PASSWORD = $env:SUPABASE_DB_PASSWORD_DEV
supabase db push
```

Never edit a migration that has already been applied. Add a new one.

**Every new table needs explicit grants.** "Automatically expose new tables" is
OFF on both projects, which also disables Supabase's default grants to
`service_role`, not just `anon` and `authenticated`. Forget it and Edge
Functions silently read nothing:

```sql
alter table public.x enable row level security;
grant select on public.x to authenticated;              -- plus column-scoped grants
grant all privileges on table public.x to service_role;
```

**Column-level SELECT grants cannot hide anything from a creator**, because
staff and creators are both the `authenticated` role. Anything creators must
never see goes in its OWN table with its own policy. That is why the brand
budget lives in `brand_commercials` and not in `brands`.

**Every VIEW needs `with (security_invoker = true)` and its own grants.** A
Postgres view runs as its OWNER by default, which bypasses row level security on
everything underneath it. A view over a creator-facing table without that word
hands every creator every other creator's rows, and no policy will stop it:

```sql
create view public.x with (security_invoker = true) as select ...;
grant select on public.x to authenticated;
grant all privileges on table public.x to service_role;   -- auto-expose is off
```

And a rule that no `security_invoker` can enforce: only build a view whose
grouping key belongs to exactly ONE person. A creator counting rows they cannot
all see gets a plausible small number back rather than an error, so
`job_progress` is safe (one job, one creator) while a per-offer headcount over
the same tables would silently render "12 creators" as "1".

## 4c. Storage

One bucket, `brand-assets`: brand logos and product images. Public read,
staff-only write, 2 MB, `image/png`, `image/jpeg`, `image/webp`. Created and
policed by `supabase/migrations/*_brand_assets_storage.sql`, not by hand in the
dashboard, so prod gets it from the same migration.

SVG is deliberately not allowed: it can carry script.

## 4b. Edge Functions

```powershell
supabase functions deploy <name> --project-ref $env:SUPABASE_PROJECT_REF_DEV
```

Docker is **not** required; the CLI uploads the source and bundles server side.
It prints a Docker warning anyway, which is harmless.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Never add them as secrets by hand.

Two things that have already cost time:

- **CORS must echo the requested headers.** Our Supabase client sends a custom
  `x-application-name` header on every request. A hand-written allow-list did
  not include it, so the browser's preflight failed, the function was never
  reached, and clicking Approve silently did nothing. Use
  `supabase/functions/_shared/cors.ts`.
- **Every response needs the CORS headers, including errors.** A 403 without
  them arrives in the browser as an opaque network failure.
- A freshly deployed function is cold and its first call can take several
  seconds while Deno pulls its npm dependencies. Tests must wait for the
  outcome, not sleep for a guessed number of milliseconds.

## 5. Deploying

Push to `dev`. Vercel builds automatically, roughly 25 seconds. Each project has
an Ignored Build Step so it only builds its own branch.

`wurxmediahubdev.vercel.app` is pinned to the `dev` branch through the domains
API, because Vercel's public API does not expose the "Production Branch"
setting. Vercel's dashboard therefore labels those builds "Preview". That is
expected.

Watch a deploy:

```powershell
$h = @{ Authorization = "Bearer $env:VERCEL_TOKEN" }
Invoke-RestMethod -Headers $h -Uri "https://api.vercel.com/v6/deployments?app=wurxmediahubdev&teamId=team_OL5SlbHFgyYvmXYyScEUmDo0&limit=1"
```

## 6. Accounts

| Account                | Role      | Notes                                                                                                                                   |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `rashid@wurxmedia.com` | admin     | Dev only. Created 2026-07-29 via `scripts/create-admin.mjs`. **The password is not stored anywhere, by design.** It is Rashid's to type |
| `*@wurxmediahub.demo`  | applicant | Seven demo applications on dev, password `demo-password-for-dev-only-1`. Remove with `node scripts/seed-applications.mjs --clean`       |

Test suites create `@wurxmediahub.test` accounts and delete them again. If a run
is interrupted, check for leftovers with that suffix.

Staff accounts are **never** created through the website. Public sign up always
produces an `applicant`, and nobody can change their own role. Prod will need
its own admin account created the same way.

**Staff sign in is `/admin/login`**, a separate screen with no sign up link.
Creators use `/login`. Signed-out visits to any `/admin` route are sent to the
staff door. It is a different screen, not a different lock: signing in there
grants nothing extra, and permission is still decided by row level security and
the Edge Function. Never treat the URL as a security boundary.

## 7. Windows and PowerShell quirks that have already cost time

- `&&` does not work in Windows PowerShell 5.1. Use `;` or separate calls.
- `??` and ternaries do not exist. Use `if/else`.
- Passing an **empty string** to a native exe fails. Write the file directly
  instead (this is why the git credential helper is set by editing
  `.git/config`).
- Double quotes inside a native command argument get mangled. Write commit
  messages to a file and use `git commit -F <file>`.
- `Set-Content -Encoding utf8` writes a **byte order mark**. The Supabase CLI
  refuses to parse `.env.local` if it has one. Use
  `[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))`.
- Never use PowerShell string replace on source files: it corrupts UTF-8
  (em dashes became `â€"`). Use the Edit tool.
- `System.Drawing` cannot save over a file it has open. Save to temp, then copy.
- Wildcard `Remove-Item` is sometimes blocked by the sandbox. Delete by explicit
  path.

**`PGRST303: JWT issued at future`, a 401 you can ignore ONCE.** Seen on
2026-08-25 on the first request after a scripted sign-in, and not again in
three repeats; the clock skew against Supabase measured ZERO seconds a moment
later. The token is minted by one Supabase service and checked by another, so a
sub-second difference between them can put `iat` a hair in the future on the
very first call. TanStack Query retries and the screen fills normally.

**Treat a REPEATING one differently.** If it survives a retry, or shows up on
more than the first request, check this machine's clock against the server
before touching any auth code:

```bash
curl -sS -D - -o /dev/null https://<ref>.supabase.co/rest/v1/ | grep -i "^date:"
```

**HEADLESS CHROMIUM LEAKS, and it looks exactly like a hang.** A session on
2026-08-25 left **26 orphaned chrome processes** and free memory fell to 0.67 GB;
a screenshot run then timed out after ten minutes with no error. **Kill them
before any browser suite, and suspect this first when a browser run hangs:**

```powershell
Get-Process -Name chrome, chromium, headless_shell -ErrorAction SilentlyContinue |
  Stop-Process -Force
```

## 8. House style

- **No em dashes or en dashes in the APP.** Standing instruction from Rashid.
  It covers everything a person using the product can read: components, copy,
  microcopy, labels, empty and error states, emails, seed and mock data. It does
  **not** cover `docs/` or the memory files, which he confirmed on 2026-08-24:
  *"i told you not to use em dashes in our app u are not restricted to use em
  dashes in those docs becuase it is u who need to understand"*. Those exist for
  the agent to read, so write them however reads clearest. **Do not sweep them.**
- Every colour is a `var(--wx-*)` token; the build fails if dark and light drift
  apart or if contrast drops below WCAG AA.
- Use `m.div` from Motion, never `motion.div`. `LazyMotion` runs in strict mode
  and the heavy build will throw.
- `select('*')` is banned. Name the columns.
- The public landing page must not pull in the Supabase client. It is imported
  dynamically in `AuthProvider`, and `manualChunks` keeps Supabase and TanStack
  Query in separate chunks.

## TikTok ads (added 2026-08-17)

App "Wurx Ads Reporting", App ID `7674829988993957908`, approved. One app for
both environments; only the redirect URI differs. Secrets live as Supabase
function secrets on each project, never in the repo:
`TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URI`.

Dev callback `https://wurxmediahubdev.vercel.app/oauth/tiktok/callback`,
prod `https://wurxmediahub.vercel.app/oauth/tiktok/callback`. **Prod has none of
these secrets set yet**, deliberately: prod is frozen.

```bash
pnpm verify:tiktok       # 37 checks, no browser, needs SUPABASE_SERVICE_KEY
supabase functions deploy tiktok-connect tiktok-callback
```

**The region trap, which costs an afternoon if you meet it cold.** Supabase runs
an edge function in the region nearest the caller. From Pakistan that is Mumbai,
`ap-south-1`, and TikTok blocks every Indian IP because India banned TikTok in
2020. The reply is `code -1 "Client IP address is in banned Country list."`,
which reads exactly like a bad app secret. Every call goes through
`src/lib/tiktok.ts`, which pins `x-region: ap-northeast-1`; the functions also
check their own region and refuse before calling out. Verified working:
ap-northeast-1, ap-southeast-1, eu-west-2, us-east-1.

**THE NIGHTLY RUN RE-READS THE LAST SEVEN DAYS, and this is not optional.**
`cron.schedule('tiktok-nightly', '20 3 * * *', tiktok_run_nightly_sync(3, 7))`.
The first number is how far back to reach for figures we are MISSING; the
second re-reads that many recent days even though we already hold them, because
**TikTok restates `cost` after a day has closed** (it credits back invalid
traffic). `gross_revenue` has never moved. Before this, dev was overstating
spend by 2.8% overall and 13.6% on one day, which makes a creator's ROI read
LOWER than the truth.

Two traps, both met and both now written into the code:

- **Do not use `force: true` on the nightly run.** The late-video backfill
  depth is only computed when `!force`, so forcing it fixes spend and breaks a
  creator pasting a link nineteen days late. `force` is for a manual repair.
- **`refreshDays` must widen the day loop.** The loop runs
  `back = 1..effectiveDays`, so `refreshDays: 7` with `days: 3` re-reads three
  days and reports seven.

Check it with `pnpm verify:numbers`, and repair a specific stretch by hand with
a `{ days: N, force: true }` call to `tiktok-sync` as an admin.

**GMV Max reporting is v2.0, not v1.3.** At v1.3 the report path exists and
fails with a useless "ERROR Message." and the video endpoint 404s. Built and
syncing since 2026-08-18; noted here so the next person does not lose the day
to it.

### What the TikTok API will and will not give us

Probed 2026-08-18, re-probed in full 2026-08-21 against the live Penetrex
account. Nothing here is read from a doc: the docs and the grant disagree, and
the only honest source is what the account answers.

```bash
pnpm probe:tiktok              # every candidate endpoint, with TikTok's own verdict
pnpm probe:tiktok --metrics    # one metric per request, the only way to get a full list
pnpm probe:tiktok --reconcile  # add every video up and compare it with the store
```

It creates a throwaway admin in dev to authenticate with and deletes it again,
so it needs `SUPABASE_SERVICE_KEY`. It cannot write to TikTok: it goes through
the `raw.probe` action, which is GET only, `/open_api/` only, TikTok's host
only.

**READ THE REFUSAL. There are two of them and they mean opposite things.**

| TikTok's words | what it means | who can fix it |
| --- | --- | --- |
| `advertiser does not grant you /x/:GET permission` | the ASSET was never granted to this app at authorisation | TikTok, on application, or a wider grant from the advertiser |
| `Permission error: ... lacks the required scope ... reauthorize your API App` | OUR APP does not carry that scope at all | us, in the TikTok app settings, then Rashid re-authorises |

The second one is the cheap one and it is easy to misread as the first.

**Granted today, and answering.**

| endpoint | gives |
| --- | --- |
| `/gmv_max/video_list/report/get/` (v2.0) | per video: cost, gross_revenue, orders, roi, cost_per_order |
| `/gmv_max/report/get/` (v2.0) | the STORE: the same plus `net_cost`, by day, by hour, by product |
| `/gmv_max/store/list/` | the stores under an ad account, and `store_authorized_bc_id` |
| `/gmv_max/identity/get/` | the shop's own TikTok identity, name and avatar |
| `/gmv_max/store/shop_ad_usage_check/` | whether custom shop ads are running |
| `/gmv_max/video/get/` | videos eligible for custom shop ads (empty on this shop) |
| `/advertiser/info/`, `/oauth2/advertiser/get/` | the ad accounts, their currency and timezone |

**The metric list is complete and it is short.** Asked one metric per request on
2026-08-21, because the report names only the FIRST metric it dislikes and a
long list therefore proves nothing:

- store level: `cost`, `net_cost`, `gross_revenue`, `orders`, `roi`,
  `cost_per_order`, and `currency` arrives whether asked for or not.
- video level: the same **minus `net_cost`**.

Everything else is refused by name: impressions, clicks, ctr, cpc, cpm,
video_views, conversion, conversion_rate, buyers, unit_sales, refund,
gross_revenue_roi, net_cost_roi, live_gmv, product_gmv, organic_gmv, total_gmv,
gmv. **There are no view or engagement figures anywhere in GMV Max reporting.**

**Dimensions.** The store report takes `stat_time_day`, `stat_time_hour` and
`spu_id`, and refuses `item_id`, `campaign_id` and `order_source`. The
video report takes `item_id` and ONLY `item_id`: it refuses `stat_time_day`
as a second dimension, which is why the sync asks day by day rather than once
per range. `/gmv_max/live_list/report/get/` and
`/gmv_max/product_list/report/get/` do not exist, at either version.

**Spend per product is a dead end**, though GMV per product is fine: every penny
of cost lands in the `spu_id = -1` bucket.

**The video report carries ORGANIC sales, and this is the important one.** On
2026-08-15 the store had 9,430 videos with a row, and NINE of them earned money
with no ad spend at all, \$216.92 of it. So `gross_revenue` on a video is what
that video sold, not what its ads sold, and a creator sees their GMV whether or
not the brand ever ran an ad on the video. We already store it: `cost` is
simply 0 on those rows.

**The store total is bigger than its videos, and always will be.** Same day:

```
store report          cost 1492.25   gmv 2349.04   orders 125
sum of 9,430 videos   cost 1380.72   gmv 2121.52   orders 112
```

The \$227.52 gap is LIVE and product-card selling, which has no `item_id` to
hang off. **Never present a store figure as the sum of the creators' videos**,
and never derive one from the other.

### Ad delivery status: we HAVE it, at campaign level (2026-08-25)

Rashid had the scopes approved and reconnected. Re-probed straight afterwards.
Everything below is what the live Penetrex account answered, not documentation.

**THE TOKEN IS THE WHOLE TRICK, and it cost a round trip.** Approving scopes
changes nothing on its own: an access token permanently carries the scopes it was
minted with. Ours was eight days older than the approval and kept answering
`40001` until it was replaced. The connection row shows it plainly, five scopes
before and eight after. **After any scope change, reconnect, then check
`tiktok_connections.connected_at` before believing a probe.**

**What works now.**

```
/gmv_max/campaign/get/    filtering is REQUIRED and gmv_max_promotion_types
                          inside it is required. One of LIVE_GMV_MAX or
                          PRODUCT_GMV_MAX. Penetrex has 5 PRODUCT and 0 LIVE.
/campaign/gmv_max/info/   takes campaign_id, returns the whole campaign
/campaign/get/            granted, returns 0 rows: no classic auction campaigns
/adgroup/get/, /ad/get/   granted, 0 rows for the same reason
```

**The status fields, with the values this account actually returns:**

| field | means | seen |
| --- | --- | --- |
| `operation_status` | what the advertiser set | `ENABLE` |
| `secondary_status` | what TikTok is doing with it | `CAMPAIGN_STATUS_ENABLE` |
| `roi_protection_compensation_status` | ROI protection | `IN_EFFECT` |

Every campaign is running, so those are the only values seen. **The full
`secondary_status` set cannot be listed until a campaign is actually paused or
in learning**, and inventing the rest from a doc is exactly what this section
exists not to do. The one enumeration TikTok did hand over is the `primary_status`
FILTER: `STATUS_DELETE`, `STATUS_DELIVERY_OK`, `STATUS_DISABLE`.

**Trick worth reusing: TikTok's 40002 errors enumerate the allowed values.**
Sending a deliberately wrong one comes back "value is not one of the allowed
values, value is X, correct is A, B". That is how both lists above were found,
without a single doc.

**`/campaign/gmv_max/info/` carries the commercial settings** that this file
used to call unavailable: `budget` (100), `roas_bid` (1.5),
`auto_budget_enabled`, `roi_protection_enabled`, `deep_bid_type`
(`VO_MIN_ROAS`), `optimization_goal`, `billing_event`, the schedule, the
placements and the identity. **Creators must never see any of it**, for the same
reason they never see a brand's budget.

**EVERY FIELD, with this account's real values, 2026-08-25.**

`/gmv_max/campaign/get/` returns nine fields per campaign. Penetrex has five,
all PRODUCT_GMV_MAX, zero LIVE_GMV_MAX:

| field | Penetrex |
| --- | --- |
| `campaign_id` | 1872694034054241 and four others |
| `campaign_name` | Remaining Products · Arthritis 2oz · Daily Joint & Muscle Care 8oz · 3oz · Joint & Muscle Therapy 2oz |
| `objective_type` | `PRODUCT_SALES` |
| `operation_status` | `ENABLE` |
| `secondary_status` | `CAMPAIGN_STATUS_ENABLE` |
| `roi_protection_compensation_status` | `IN_EFFECT` |
| `create_time` / `modify_time` | oldest 2025-11-05, all modified in August |
| `advertiser_id` | 7427187763989987329 |

**THE FILTER VOCABULARY AND THE RETURNED VOCABULARY ARE DIFFERENT, and that
trips you up if you assume otherwise.** You FILTER with `STATUS_DELIVERY_OK`,
`STATUS_DISABLE`, `STATUS_DELETE` (TikTok's own list, for both
`primary_status` and `secondary_status`). What comes BACK is a
`CAMPAIGN_STATUS_*` value. So the returned set cannot be derived from the
filter set.

**Only one returned value has been SEEN, because every campaign is live.**
Queried all three buckets on both ad accounts: DELIVERY_OK returns all five,
DISABLE and DELETE return zero. **The paused, learning and not-delivering values
are still unknown, and the only honest way to learn them is to pause a campaign
in Ads Manager for a minute and re-probe.** Do not fill them in from a doc.

`/campaign/gmv_max/info/` returns about thirty fields. The ones that matter:

```
budget 100            roas_bid 1.5           deep_bid_type VO_MIN_ROAS
auto_budget:          current 100, maximum 200, +50% per increase,
                      2 increases left, next +50
roi_protection_enabled true       optimization_goal VALUE    billing_event OCPM
schedule 2026-08-05 -> 2036-08-02 (SCHEDULE_FROM_NOW)
age_groups 18-24 .. 55-100        location_ids 6252001 (US)
placements PLACEMENT_TIKTOK       shopping_ads_type PRODUCT
affiliate_posts_enabled true      accelerate_testing_for_new_videos OFF
product_specific_type CUSTOMIZED_PRODUCTS   item_group_ids [2 ids]
identity_list [{ identity_id, identity_type TTS_TT, store_id }]
```

**`item_list` is EMPTY and `product_video_specific_type` is `AUTO_SELECTION`,**
which is the single most consequential line here: it is why a campaign cannot
name its videos. See the limit below.

**CREATORS MUST NEVER SEE ANY OF THE COMMERCIAL FIELDS.** Budget, ROAS target,
the auto-budget ladder and the targeting are the brand's, and the rule that
splits a brand's money from a creator's is the same one that put
`brand_commercials` in its own table.

**THE LIMIT, and it decides what can be built.** A campaign cannot be tied to a
creator's video:

```
video report, dimension campaign_id  ->  Invalid dim: campaign_id is not exist
video report, metric    campaign_id  ->  Invalid metric: campaign_id not support
campaign.item_list                   ->  []   product_video_specific_type: AUTO_SELECTION
```

TikTok picks the videos itself and will not say which. So we can tell a BRAND
whether its campaigns are running, and we still cannot tell a CREATOR whether
the ad on their particular video is paused. Anything per video stays inferred
from spend, with the caveat that a paused campaign reads as running until the
spend stops arriving.

### Impressions and views per video: NOT POSSIBLE, and not for want of a scope

Asked on 2026-08-25 after the scope round. The answer is no, and it is worth
being blunt about it because it is easy to keep chasing.

**Three separate walls, any one of which is fatal.**

**1. The scope is still missing.** `/report/integrated/get/` answers `40001`.
The **Consolidated Report** box under Reporting was not ticked. That one is
fixable.

**2. The integrated report has NO VIDEO LEVEL.** TikTok enumerated its own
`data_level` values when sent a bogus one, and there are eight:

```
AUCTION_ADVERTISER   AUCTION_CAMPAIGN   AUCTION_ADGROUP   AUCTION_AD
RESERVATION_ADVERTISER  RESERVATION_CAMPAIGN  RESERVATION_ADGROUP  RESERVATION_AD
```

Advertiser, campaign, ad group, ad. **Nothing per video.** So even with the
scope, impressions could never be attributed to one creator's video through it.

**3. GMV Max video reporting refuses every view metric BY NAME**, which is the
one that closes the door for good:

```
impressions · video_views · video_play_actions · clicks · ctr · reach · views
        all -> "Invalid metric: <name> not support"
```

**And a fourth, for completeness:** GMV Max campaigns have no auction ad groups
or ads at all. `/adgroup/get/` and `/ad/get/` are granted and return ZERO rows.
So even AUCTION_ADGROUP and AUCTION_AD reporting would have nothing to report on
for this account.

**What ticking Consolidated Report would actually buy:** possibly campaign-level
impressions and clicks, and possibly nothing, since it is unclear whether GMV
Max campaigns appear in auction reporting at all. It is one tick to find out and
it is NOT the per-video engagement anybody wanted. **Do not promise a creator
their view count on the strength of it.**

**The honest summary for the product:** for GMV Max, TikTok's advertising API
gives money per video and engagement per campaign, and never engagement per
video. Views per video would have to come from somewhere else entirely, which
is the TikTok Shop Partner API territory recorded in PARKED 19, or from a
creator pasting their own figures.

**Not granted, and each would need TikTok to widen the authorisation:**
`/gmv_max/exclusive_authorization/get/`, `/identity/get/`, `/bc/get/`,
`/bc/asset/get/`, `/advertiser/balance/get/`.

**CORRECTED 2026-08-25.** `/gmv_max/campaign/get/` and `/campaign/gmv_max/info/`
used to be on that list, and the reason they were is a lesson worth keeping:
they answered `advertiser does not grant you`, which the table above says means
the ASSET was withheld. It did not. They were refused because our app carried no
scope for them, and the moment Rashid added it they started answering. **A
"does not grant" refusal does not always mean what the table says**, so try the
scope before concluding TikTok has to be asked.

Daily budget, target ROAS and optimisation mode are therefore AVAILABLE now.

**Missing a SCOPE rather than a grant, which is ours to add:**
`/report/integrated/get/` and `/campaign/get/`. The integrated report is the
ordinary Ads Manager reporting API and is the only route inside this app to
impressions, clicks and video views. Adding the scope in the TikTok app settings
and having Rashid re-authorise is the whole job; no application to TikTok.

**Total shop GMV — every sale the shop makes, not just the ad-driven ones — is
not in this API at all.** It lives in the TikTok Shop Partner API, which is a
different product with its own app, its own signing and its own authorisation.
See PARKED for what it would give us and what it costs to get.


### Nothing here can delete prod, and nothing here can touch WurxBase

**Every script that deletes anything now refuses to run outside dev.** Twenty of
them create accounts, write rows and remove them again, and until 2026-08-18
seventeen trusted whatever `.env.local` happened to say. One edited env file and
a routine `pnpm verify:all` would have made throwaway admins in the live
database and deleted rows on the way out.

`scripts/lib/dev-guard.mjs` is a POSITIVE check: it must recognise the dev
project, not merely fail to recognise prod, because a typo matching neither
would otherwise sail through. Pointing `.env.local` anywhere else produces:

```
REFUSING TO RUN.
check-tiktok.mjs creates and deletes data, so it only ever runs against the DEV
project (npznoiotslruqovorrec).
```

**WurxBase's and Paid Collaborations' databases are unreachable from here.**
Every script resolves its connection from `VITE_SUPABASE_URL`, which is ours.
Their project refs (`bnevtdezskftlrjjgbsg`, `pfkpgmpicjcirnogxkac`) appear
nowhere in `scripts/`, so no suite, seed or wipe can reach a row of their data.
Deleting anything of theirs takes a human pressing a button inside their own UI.

**The two scripts that delete on purpose**, as opposed to cleaning up after
themselves, both carry their own guard as well and both name what they will
remove before doing it: `wipe-offers-contests.mjs` and `seed-penetrex.mjs
--clean`.

### One database, one client, one schema

**Changed on 2026-08-28, and this section used to say the opposite.** Until then
there were two products on two Supabase projects, and `verify:isolation`
forbade the vendored app from importing our client at all. Rashid consolidated:
*"now there is only one main copy and that is our own copy in this app we are
moving everything here... I want to have only one app being managed from one
side."*

**WurxBase's eight tables now live in the `wurxbase` SCHEMA of our own
project.** Separation by project is gone; separation by schema replaces it.

| what | where | reached by |
| --- | --- | --- |
| WurxMediaHub | `public` on `npznoiotslruqovorrec` | our code |
| WurxBase | `wurxbase` on the same project | the vendored app, through one seam |
| ~~WurxBase's old project~~ | `bnevtdezskftlrjjgbsg` | retired, data copied out |
| ~~Paid Collaborations~~ | `pfkpgmpicjcirnogxkac` | the project no longer exists |

**The seam is `src/vendor/wurxbase/supabaseClient.js` and nothing else.** It
borrows the one application client and scopes it: `getSupabase().schema('wurxbase')`.
That is why their ninety-two `.from('creators')` calls needed no rewrite, and
why their `creators` can never be confused with our `profiles`.

```js
export const supabase = {
  from:    (t) => getSupabase().schema('wurxbase').from(t),
  channel: (...a) => getSupabase().channel(...a),   // realtime is on the root client
};
```

**`pnpm verify:isolation` now asserts the new rule** and still runs inside
`pnpm build`:

1. nothing anywhere names a retired project or its old publishable key;
2. the vendored code constructs no client of its own (one client, or two race to
   refresh the same token and people get logged out at random);
3. only the seam imports ours;
4. no vendored realtime filter still says `schema: 'public'` — it would
   subscribe to OUR table of the same name and deliver nothing, silently;
5. no vendored file handles a `password:` or `.password` again. There is no
   sign-in in this app any more and `wurxbase.app_users` has no password column
   to write one to, so a reappearance is a mistake rather than a decision. A
   comment about the history stays legal: the check matches code, not prose.

#### The Paid Collabs suites

All of them need `pnpm build` then `pnpm preview` in another shell, and
`SUPABASE_SERVICE_KEY` in the environment (fetch it at run time, section 2).

```bash
pnpm verify:wurxbase         # the migration landed, one sign-in, writes reach us
pnpm verify:wurxbase-signin  # no second login, the audit names the real person
pnpm verify:wurxbase-perms   # a viewer of theirs stays a viewer, whatever we are
pnpm verify:wurxbase-team    # Team screen: settings reachable, hub email saves
pnpm verify:write-safety     # the sequence that used to lose data loses nothing
pnpm verify:collab-canvas    # one page colour, six tabs, both themes, and
                            # measured while LOADING as well as settled
pnpm verify:collab-controls  # every row control receives its own clicks
                            # and the performance sheet is checked by
                            # the same suite: no figure clipped, a cell
                            # holds 123,456.78, no sideways page scroll,
                            # at 1500/1280/1024. Needs COLLAB_STAFF_PASSWORD.
pnpm wurxbase:sync           # DRY RUN by default; --apply to write
node scripts/check-collab-contrast.mjs   # every label, both themes, per-size AA
```

**The contrast one judges each element against its own floor**, 3.0 only at
24px or 18.66px bold and 4.5 otherwise. It used to fail below 3.0 and warn
above it, which passed thirty real failures while printing them in the pass
line as "12 below AA". If you change it, do not reintroduce a single floor.

#### The two settings that are not in git

**PostgREST must be told the schema exists.** Tables and grants are not enough;
without this every request 404s.

```powershell
# read it first, then add to the list rather than replacing it
Invoke-RestMethod -Method GET -Uri "https://api.supabase.com/v1/projects/$ref/postgrest" -Headers @{Authorization="Bearer $env:SUPABASE_ACCESS_TOKEN"}
Invoke-RestMethod -Method PATCH -Uri "https://api.supabase.com/v1/projects/$ref/postgrest" `
  -Headers @{Authorization="Bearer $env:SUPABASE_ACCESS_TOKEN"; 'Content-Type'='application/json'} `
  -Body '{"db_schema":"public,graphql_public,wurxbase"}'
```

**A raw REST call needs `Accept-Profile: wurxbase`.** The client sends it for
you; hand-built `fetch` calls do not. Use `wurxbaseRest()` from the seam.

#### Moving the data

```bash
SUPABASE_SERVICE_KEY=... node scripts/wurxbase-copy-data.mjs           # copy
SUPABASE_SERVICE_KEY=... node scripts/wurxbase-copy-data.mjs --verify  # counts only
```

Safe to run twice: each table is emptied before it is filled, so a half-finished
run leaves no duplicates. It refuses to run when `.env.local` points at prod
unless `--i-mean-prod` is passed.

**Ids are preserved and the sequences must be moved afterwards**, or the next
insert collides with a row that already exists. The script prints the three
`setval` statements; run them through the Management API query endpoint.

`activity_logs.id` is load-bearing, which is why ids are kept: `saveAngles`
writes a row, keeps its id and sweeps `.neq('id', keepId)`. Renumbering would
be invisible until the first save deleted the wrong row.

#### Proving it actually moved

```bash
pnpm build && pnpm preview
SUPABASE_SERVICE_KEY=... node scripts/check-wurxbase-migration.mjs
```

Counting rows proves the copy landed and nothing else. **Every way this
migration fails is silent from the screen:** a request still going to the
retired project returns real-looking data, a missing schema header 404s into
something that reads as "no records yet", and RLS refusing a table returns an
empty array rather than an error. So the check signs in, opens the screen, and
asserts on what the network did — including that a WRITE lands, because reads
can succeed while writes are refused.

**One expected 406 on the very first load ever.** `app_settings` starts empty
and their `fetchSettings` self-heals it: `.single()` on no rows returns
PGRST116, which their code catches and upserts `{id: 1}`. It happens once and
never again.

#### What is still true about deletes

Every script that deletes anything still refuses to run outside dev via
`scripts/lib/dev-guard.mjs`. What changed is that WurxBase's data is now
*inside* our project, so it is covered by our backups and point-in-time recovery
for the first time — their old project had none. It is also now reachable by our
service key, which it never was before: treat `wurxbase.*` with the same care
as `public.*`.

### vercel.json has a strict schema, and a comment in it kills the deployment

Two deployments failed with no build log and a duration of `?`, which is what a
CONFIG VALIDATION failure looks like: the deployment is rejected before the build
starts, so there is nothing to read. The cause was a `_comment` key I had added
inside a rewrite to explain it:

```
Invalid vercel.json - `rewrites[0]` should NOT have additional property `_comment`.
```

**Never put a comment in `vercel.json`.** It rejects unknown keys anywhere.
Explanations go here instead.

**Validate it locally rather than by deploying.** `vercel build` runs the real
pipeline including config validation:

```bash
vercel link --token $VERCEL_TOKEN --scope wurxmedia-6695s-projects --project wurxmediahubdev --yes
vercel build --token $VERCEL_TOKEN --yes      # "Build completed successfully."
```

**And check the deployment reached READY, not just that the push succeeded.**
A green `git push` says nothing about the build. `vercel ls wurxmediahubdev`
shows the state; a run with duration `?` never built at all.

**When a git deploy comes back `BLOCKED` (`TEAM_ACCESS_REQUIRED`)**, Vercel
can no longer match the GitHub commit author to a team member. On 2026-09-15
the cause was that the Vercel account had no GitHub login linked. The real
fix is Rashid's: Vercel → Account Settings → Authentication → connect GitHub
`RashidNazeer`. Until then, dev can still be deployed from the CLI, because
the token belongs to the team owner. The commit author is not checked:

```bash
# 1. export EXACTLY the pushed commit, so nothing local rides along
git archive <sha> | tar -x -C <scratch>/deploy-<sha>
cp .vercel/project.json <scratch>/deploy-<sha>/.vercel/   # projectName MUST be wurxmediahubdev
# 2. a PREVIEW of the dev project — never --prod (the dev project's production
#    branch is main, and --prod is not what the dev URL serves)
cd <scratch>/deploy-<sha> && vercel deploy --yes --token $VERCEL_TOKEN
# 3. wurxmediahubdev.vercel.app is a dev-BRANCH domain, so a CLI deploy is not
#    attached to it automatically. Point it by hand:
vercel alias set <deployment-host> wurxmediahubdev.vercel.app --token $VERCEL_TOKEN --scope wurxmedia-6695s-projects
```

**Scripting it, two traps (2026-09-16):** the deployment URL is NOT the last
line of stdout. That line is `}` from a JSON dump, and the URL is on the
`Preview  https://…` line on stderr. Take the host from that line. Also,
`.vercel/project.json` is pretty-printed (`"projectName": "wurxmediahubdev"`,
with a space), so a grep for `"projectName":"` finds nothing and stops an
`&&` chain without a word. Load tokens in Git Bash with
`set -a; . <(tr -d '\r' < C:/Users/RA_shid/.wurx/cli-secrets.env); set +a`.
A bare `git push` then fails with "Invalid username or token", because the
credential helper reads `GH_TOKEN` from the environment.

Both env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) apply to
all targets with no branch scoping, so a CLI preview builds against the same
dev database as a git one. Confirm by comparing the live `assets/index-*.js`
name with the tested local `dist/`. To roll back, alias the domain to the
previous deployment's host. The next git deploy that succeeds takes the
domain back automatically.

The rewrite excludes `.netlify/`. That exclusion is now VESTIGIAL and is kept
only because editing `vercel.json` has killed deployments twice: nothing calls
that path any more. Until 2026-08-29 WurxBase fetched
`/.netlify/functions/euka` in twelve places, a Netlify function that was never
vendored in because the copy took their `src/` and it lived outside it. Without
the exclusion the SPA answered with index.html and a 200, so their code called
`.json()` on HTML and threw `Unexpected token '<'`; a real 404 let their own
handling degrade to null instead, which is why nothing ever errored and the
figures were simply missing. Square brackets are avoided in the pattern:
`source` is parsed with path-to-regexp, and a character class is not worth the
risk.

### The Euka proxy

Those twelve call sites now go through `eukaJson()` in the seam to the
`euka` Edge Function. **The API key is a secret and must never enter the
repository** — the original had it as a string literal in a committed file,
which is why it should be rotated.

```powershell
# the key, straight from wherever you keep it, into the function environment
supabase secrets set "EUKA_API_KEY=<key>" --project-ref $env:SUPABASE_PROJECT_REF_DEV
supabase functions deploy euka --project-ref $env:SUPABASE_PROJECT_REF_DEV
```

**Production needs both of those run again with the prod ref.** A function and
its secrets do not travel with a migration or a git push, and a missing
`EUKA_API_KEY` is answered with a loud 500 rather than an empty result, on
purpose: an empty result is indistinguishable from "this brand has no data",
which is the failure that hid this for eleven days.

**Never wait on `networkidle` on a Paid Collabs route.** It never settles on a
screen holding a realtime socket, and these screens now also fire ten Euka
calls that take seconds each upstream, so a perfectly healthy page blows the
30 second navigation limit. Navigate with `domcontentloaded` and wait for the
content you actually need.

## Screenshot scripts

`pnpm build && pnpm preview` in another shell, then:

```bash
node scripts/shots-hub.mjs      # the creator Brand Hub: 5 sections x 4 widths
                                # x 2 themes = 40 shots into shots/hub/.
                                # Signs in as a real creator with real money,
                                # writes nothing, and FAILS on a console error
                                # or any sideways page scroll.
```

Two traps it encodes, both of which have cost time here. `networkidle` never
settles on a screen holding a realtime socket, so it waits for the skeletons to
clear instead. And `[].every()` is TRUE, so waiting for "every image loaded"
passes instantly on a page whose images have not started; it checks the list is
non-empty first.

## A brand's colours: what an admin can set, and what we do with it

Since 2026-08-25 a brand carries `brands.brand_color` (one hex, the fallback
for everything) **and** `brands.theme` (jsonb, or null).

```jsonc
{
  "v": 1,
  "hero":   { "stops": ["#dc0945", "#1d3149", "#c8924b"], "angle": 120, "tone": "light" },
  "rail":   { "stops": ["#1d3149", "#0a0a0a"], "tone": "auto" },
  "page":   { "stops": ["#dc0945", "#1d3149"] },   // stop 2 tints the CARDS
  "accent": { "stops": ["#dc0945", "#c8924b"] }
}
```

Hero takes up to four stops, the rest up to three. `angle` is hero-only,
`tone` is hero and menu only, and every hex must be lower case. **Fills only:
there is no text colour in this shape and adding one would silently remove the
readability guarantee for every brand.** `brand_theme_ok()` refuses an unknown
key for exactly that reason, so a hand-written `update` cannot smuggle one in.

To set or clear one from the CLI, as service_role (dev only):

```powershell
# ... load env and SUPABASE_SERVICE_KEY as in section 2 ...
$h = @{ apikey = $env:SUPABASE_SERVICE_KEY
        Authorization = "Bearer $($env:SUPABASE_SERVICE_KEY)"
        'Content-Type' = 'application/json' }
$body = '{"theme": null}'      # or a full theme object
Invoke-RestMethod -Method Patch -Headers $h -Body $body `
  -Uri "$($env:VITE_SUPABASE_URL)/rest/v1/brands?slug=eq.penetrex"
```

**The band is the safety, and the numbers in it are measurements.** A picked
colour keeps its hue and its chroma and has only its LIGHTNESS clamped into what
the area can carry, so no combination reaches a place where one ink cannot be
read. The one that cost time: a band must never straddle the middle of the
lightness axis, because a button's label is a single colour. See
`bandFor()` in `src/lib/brand-theme.ts`.

**`src/lib/brand-theme.ts` must stay one file.** `check-brand-theme.mjs`
transpiles it with raw `tsc` and imports it from plain Node; a sibling import
emits a specifier with no `.js` on it, Node refuses to resolve it, and the guard
stops running inside the build without failing it.

## The creator TikTok connection (Display API)

Separate app, separate portal, separate credentials from the ads integration.
See FEATURE_MAP for the table that tells them apart.

**Secrets, per project.** `TIKTOK_CREATOR_CLIENT_KEY`,
`TIKTOK_CREATOR_CLIENT_SECRET`, `TIKTOK_CREATOR_REDIRECT_URI`. The key and
secret come from developers.tiktok.com and are Rashid's to paste; the code
`.trim()`s all three, because a pasted credential very often carries a newline.

```powershell
pnpm verify:creator-tiktok   # 27 checks against dev. Needs SUPABASE_SERVICE_KEY
pnpm verify:tiktok-card      # 18 checks in a real browser. Needs a server AND the key
```

**Fetching the service key on this machine, and the trap in it.** PowerShell 5.1
does not unroll the array `ConvertFrom-Json` returns, so the obvious one-liner

```powershell
# WRONG. $_.name is the whole array of names, so the filter matches everything
# and .api_key returns all four keys joined. Supabase then says "Invalid API key".
$key = (supabase projects api-keys ... | ConvertFrom-Json |
        Where-Object { $_.name -eq 'service_role' }).api_key
```

silently produces a key-shaped string that is four keys long. Build the array
explicitly and **assert the shape before using it**, or the failure arrives much
later looking like an auth bug:

```powershell
$arr = @()
foreach ($item in (supabase projects api-keys --project-ref <ref> --output json |
                   ConvertFrom-Json)) { $arr += $item }
if ($arr.Count -eq 1 -and $arr[0] -is [array]) { $arr = $arr[0] }
$key = [string]($arr | Where-Object { $_.name -eq 'service_role' }).api_key
if ($key -notmatch '^eyJ' -or $key.Length -lt 100) { throw 'not a single JWT' }
```

**The admin-only diagnostic**, when TikTok says something unhelpful:

```
POST /functions/v1/tiktok-creator   { "action": "creds.probe" }
```

It asks TikTok's token endpoint to redeem a deliberately invalid code and
reports the answer verbatim, plus the SHAPE of the credentials (length, prefix,
whether whitespace is riding along) and never their value. **The distinction it
draws is the whole point:** a complaint about the CODE means the key and secret
are fine and the problem is elsewhere; a complaint about the CLIENT means they
are not.

**TWO TIKTOK ERRORS THAT LIE ABOUT WHICH FIELD IS WRONG.**

- On the authorise page, "correct the following: **client_key**" was NOT the
  client key. Both key/secret pairs were provably valid at the token endpoint.
  It was **sandbox configuration**: a sandbox keeps its OWN redirect URI list,
  and adding the callback to the app does not add it to the sandbox.
- A 302 from the authorise URL to `/login` **proves nothing about the key**.
  TikTok routes a signed-out visitor to log in BEFORE validating anything, so a
  probe that reads that as success is wrong. It cost two false "accepted"
  verdicts here.

**Prod runs the SANDBOX key** (`sbaw…`) so the demo video can be recorded before
approval; dev runs the production app key (`awxg…`). **After approval, prod must
switch to the production key** or real creators cannot connect. PARKED 27.

**THE APP IS APPROVED FOR TWO SCOPES: `user.info.basic` and `video.list`.**
`DISPLAY_SCOPES` must equal that list exactly, and the two ways of drifting fail
completely differently:

| drift | what happens | when you find out |
| --- | --- | --- |
| code asks for FEWER than the app | authorisation works | at review, weeks later, rejected as "requests permissions it does not use" |
| code asks for MORE than the app | **TikTok refuses the authorise URL; Connect breaks for everyone** | immediately, and silently — nothing errors on our side |

**READ THE APP'S `Scopes` PAGE, NOT A SUBMISSION DIALOG.** On 2026-08-26 a
submission dialog listed four scopes while the Scopes page listed two. Acting on
the dialog put a four-scope request on production and broke Connect for about
twenty minutes.

```powershell
# What the DEPLOYED function actually sends, which is the only thing TikTok
# validates. verify:creator-tiktok [6] asserts this on dev; for prod, sign in
# and read the scope parameter off the authorise URL connect.start returns.
```

**A SANDBOX KEEPS ITS OWN SCOPE LIST, exactly as it keeps its own redirect URI
list.** Adding a scope to the app does NOT add it to the sandbox, and vice
versa. The redirect list already produced a misleading `client_key` error on the
authorise page; the scope list is the same trap one field over. **Check both
lists before changing either.**

**A WIDER SCOPE LIST DOES NOT REACH AN EXISTING CONNECTION.** A token
permanently carries the scopes it was minted with, so after adding scopes a
creator must **disconnect and reconnect** to get them. Nothing in the product
can do this for them and nothing warns them — the card simply keeps hiding the
totals strip, correctly, because the permission genuinely is not there.

## Paid Collabs: the Ad Spend and ROI columns

```powershell
pnpm verify:collab-ads      # 30 checks, no server. Needs SUPABASE_SERVICE_KEY
pnpm verify:collab-ads-ui   # 15 checks in a browser. Needs a server AND the key
```

**The figures are MONTH-SCOPED**, driven by Paid Collabs' own month selector;
"All Time" sends null bounds. The range applies to `stat_date`, the
ADVERTISER's day (`Etc/GMT+5`), because that is the only boundary TikTok files
against — a range in any other timezone moves a day's money across a month end.

**Request economy, measured rather than promised:** one RPC to open a brand, and
around 424 video ids per call when a period changes. The UI suite counts the ids
inside each request body, because a flat request count cannot tell batching from
per-row fetching once the row count changes underneath it.

**THE SCREEN IS `WurxUI.jsx`, NOT `App.jsx`.** Both vendored files contain a
creators table; only WurxUI's is reachable at `/admin/collabs`. An
implementation in App.jsx builds, passes every data test, and changes nothing on
screen. Open the page and look before choosing where to edit.

**Our additions are fenced in `WURX-ADDED ... WURX-END` blocks.** To re-vendor
after pulling upstream changes, grep for those markers and re-apply them; the
build's own `verify:isolation` still forbids the vendored code from naming our
project or importing our Supabase client.

**Their lists are CSS grids, so a new column needs a new TRACK**, restated in
`wurxbase-overrides.css`. Add a header cell without a track and every later
column shifts one place along, which looks like a styling wobble and is actually
a creator's status showing under "Actions".

## Launching an environment: what a migration does NOT carry

Learned on 2026-08-26, launching production for the first time. `supabase db
push` moved all 58 migrations and the database still could not run the product.
**Everything below is per project and invisible to migrations.**

```powershell
# ... load env as in section 2 ...
$ref = $env:SUPABASE_PROJECT_REF_PROD
$env:SUPABASE_URL = "https://$ref.supabase.co"
# service + publishable keys from: supabase projects api-keys --project-ref $ref
pnpm verify:prod-ready     # 30 read-only checks: tables, late columns, buckets,
                           # every Edge Function deployed, and what is in there
pnpm verify:signin         # makes ONE throwaway account, reads its token,
                           # deletes it. The only way to prove the auth hook
```

**1. The custom access token hook is a DASHBOARD SETTING and it defaults to OFF.**
This is the quietest possible failure: sign-in succeeds, the password works, and
the token carries no `user_role`, so every policy treats the person as a
stranger and nothing they own is visible. Nothing errors anywhere. Read or set it
through the Management API rather than clicking:

```powershell
$h = @{ Authorization = "Bearer $($env:SUPABASE_ACCESS_TOKEN)"; 'Content-Type' = 'application/json' }
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/config/auth" -Headers $h |
  Select-Object hook_custom_access_token_enabled, site_url, uri_allow_list
$body = @{
  hook_custom_access_token_enabled = $true
  hook_custom_access_token_uri     = 'pg-functions://postgres/public/custom_access_token_hook'
  site_url                         = 'https://wurxmediahub.vercel.app'
  uri_allow_list                   = 'https://wurxmediahub.vercel.app/**'
} | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "https://api.supabase.com/v1/projects/$ref/config/auth" -Headers $h -Body $body
```

**READ `user_role`, NEVER `role`.** `role` is Supabase's own built-in claim and
is always the string `authenticated`, on a working project and a broken one
alike. Reading it reported the hook dead on the production launch, twice, where
it was working perfectly. The app reads `user_role`, `user_tier`, `user_active`.

**2. `site_url` defaults to `http://localhost:3000` and `uri_allow_list` to
empty.** Password-reset and confirmation emails point at localhost until you fix
it. Prod's allow list deliberately does NOT include localhost, unlike dev's.

**3. Edge Functions are not deployed by a migration.** `supabase functions
deploy --project-ref <ref>` with no function name deploys all of them, and it
reads `verify_jwt` from `config.toml`, so the public callback stays public.

**4. Their secrets are separate again.** Prod launched without
`TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URI` and
`TIKTOK_SYNC_SECRET`, so the three TikTok functions answer 500. Nothing else is
affected. Compare the two projects with `supabase secrets list --project-ref`,
which prints names and digests but never values.

**5. The nightly cron IS created by a migration, and it throws when the vault is
empty.** `tiktok_run_nightly_sync` reads `tiktok_sync_secret` and
`tiktok_sync_url` from Supabase Vault and raises if either is missing, so a
fresh project logs a failure at 03:20 every night until TikTok is configured
there. Harmless, but it is not nothing.

**6. Storage buckets DO come from the migrations.** `brand-assets` (public) and
`creator-avatars` (private) both existed on prod straight after the push, which
is worth knowing so nobody creates them by hand and ends up with two.

## Brand artwork: the exact sizes (measured 2026-08-24)

**Hero image: 2400 x 1000 px, which is 2.4:1.** JPG or WebP, under 2 MB.

Measured rather than chosen. The hero is full width, so its shape changes with
the screen: with the browser at 375px the box is **1.41:1**, and at 1920px it is
**3.98:1**. `object-fit: cover` fills the box and trims the rest, so no single
export fits every width. 2.4:1 is the geometric middle of that range, which puts
the worst case at about 40% trimmed at either end instead of 72% at one.

Before 2026-08-24 the hero had no height of its own and was only as tall as its
text, so the box ran to **5.31:1** on a wide monitor and threw away 72% of the
picture. It now has `min-h` steps per breakpoint. **If those change, re-measure
and update this number**, do not guess it.

**Where to put the subject.** The middle is always safe; the edges are not.

- **Vertically: keep everything that matters inside the middle 60%.** The top
  and bottom 20% are trimmed on a wide screen.
- **Horizontally: put the product right of centre.** A wide screen shows the
  full width with the headline over the LEFT, so the left third wants to be
  quiet: sky, wall, blur, gradient. A phone shows the full height and trims the
  sides, and the crop is anchored at 58% for exactly this reason, so a
  right-of-centre subject survives both.

**NO TEXT IN THE IMAGE, and this is the one that has already bitten us.** We
draw "Create with <brand>." and the brand's own line over the top of it. Rashid's
first upload was a marketing banner carrying "New Advanced Joint & Muscle Pain
Relief Cream" and a SHOP NOW button, and the two sets of words landed on each
other. A photograph, a texture or a product shot on a plain ground. No logos, no
headlines, no buttons.

**Logo: 512 x 512 px, square, transparent PNG**, under 300 KB.

It is rendered as a small rounded square, 28px in the rail and 34px in the hero,
and it is cropped with `cover`, so a non-square logo loses its ends. A wordmark
does not survive at 28px: use the icon or the monogram. Rashid's first upload
was already square but 1254 x 1254 and 1.28 MB, which is four times the pixels
anybody sees and about five times the weight.

**Contest artwork is a different shape and is documented with contests**: the
card banner is a tall hero, not this.

## MCP servers (added 2026-08-24)

**Google Stitch**, a UI design service that generates and edits screens from a
prompt and can carry a design system across them. Declared in `.mcp.json` at the
repo root:

```json
{
  "mcpServers": {
    "stitch": {
      "type": "http",
      "url": "https://stitch.googleapis.com/mcp",
      "headers": { "X-Goog-Api-Key": "${STITCH_API}" }
    }
  }
}
```

**`.mcp.json` is committed, so it may never contain the key itself.** Claude
Code expands `${VAR}` inside `url`, `headers`, `env`, `command` and `args` from
its own process environment, so the file carries a reference and the machine
carries the value.

**Where the value lives, and why there.** `STITCH_API` is a persistent **Windows
user environment variable**, set once with:

```powershell
[Environment]::SetEnvironmentVariable('STITCH_API', '<key>', 'User')
```

Three other homes were considered and rejected. A literal key in `.mcp.json`
would be committed. `.claude/settings.json` and a `headersHelper` are both gated
on `projects["d:/Milestone/WurxMediaHub"].hasTrustDialogAccepted` in
`~/.claude.json`, which is currently `false`, and an untrusted folder connects
the server **with no auth header at all** rather than failing loudly. Writing
the server straight into `~/.claude.json` works, but Claude Code rewrites that
file while it runs, so an edit made from inside a session can be flushed away.
`.mcp.json` is read only from Claude Code's side, which is why it wins.

The same value is also in `.env.local`, where Rashid originally put it. Nothing
in the app reads it. **Rotating the key means changing both places.**

**A restart is required.** A new value in the user environment reaches only
processes started after it was set, so VS Code has to be reopened before the
server connects. If the variable is missing, Claude Code does not fail: it sends
the literal text `${STITCH_API}` as the header and reports a missing-variable
warning in `claude mcp list`.

**Verified on 2026-08-24** by reading the URL out of `.mcp.json`, expanding the
header from the registry value rather than from the current shell, and calling
the server: `initialize` returned protocol `2024-11-05`, `tools/list` returned
15 tools. Note that `Invoke-RestMethod` **hangs** on this endpoint, because the
response advertises `text/event-stream`. Use `curl` with `--max-time`.

## The read-only Paid Collabs roles, and Ads Manager

Affiliate Team Lead and Operations Lead read Paid Collabs and see no other
screen. They cannot write anywhere, including inside Paid Collabs.

**Ads Manager is NOT one of them since 2026-09-15.** It is full staff, the
same as Ops (see FEATURE_MAP, "Ads Manager became staff"). Subhan
(`subhan@wurxmedia.com`) is the only one, on dev.

```bash
# create or repair an Ads Manager (dev). Refuses an account holding any role
# other than ads_manager or a fresh applicant.
SUPABASE_SERVICE_KEY=... node scripts/create-ads-manager.mjs \
  someone@wurxmedia.com '<password>' 'Display Name'
pnpm verify:ads-manager          # 19 checks, needs the service key
pnpm verify:ads-manager-ui       # browser, needs a preview server and
                                 # ADS_MANAGER_PASSWORD

# create or repair one (dev). Refuses to touch an account that is not already
# one of the three, so it cannot silently demote a colleague.
SUPABASE_SERVICE_KEY=... node scripts/create-collabs-viewer.mjs \
  atl@wurxmedia.com affiliate_team_lead

pnpm verify:collabs-viewer-rls   # attacks the DB as each role. Needs the service key.
pnpm verify:collabs-viewer       # the browser half. Needs a preview server.
pnpm verify:angles       # 12 checks. Creative angles are findable by the
                         # whole team: an empty month must SAY where the
                         # tests are and one click must reach them. Needs a
                         # preview server and COLLAB_STAFF_PASSWORD.
pnpm verify:euka-errors  # 8 checks. Every way the EUKA videos button can
                         # fail must name its own cause instead of blaming
                         # the brand name. Needs a preview server and
                         # COLLAB_STAFF_PASSWORD.
pnpm verify:euka-accounts # 9 checks. Every Euka account we hold a key for
                         # answers for its OWN stores and no other. Needs a
                         # staff login; hits the deployed function, so it
                         # needs no key of its own.
pnpm verify:collab-chrome # 17 checks. Fields must not look like selected
                         # text, and the unread dot must be visible. Half
                         # source scan, because the colours were inline
                         # styles. Needs a preview server.
```

**The boundary is `public.is_collabs_viewer()`**, used only by the wurxbase
SELECT policies. Never add a read-only role to `is_staff()`: that function
guards seventy policies across the whole public schema, and it means staff.

**Export and print are withheld** by `forcedPermsFor()` in
`src/lib/wurxbase-identity.ts`, applied after every other grant, so an override
in Access Control cannot open them.

## Euka keys

**Euka's full API spec is public at `https://api.euka.ai/openapi.json`**
(docs page `https://api.euka.ai/docs`; `docs.euka.ai` does not resolve). It
has 54 paths, including GMV Max ad reporting per video (PARKED 46). Read the
spec before assuming what Euka can or cannot return.

**The spec's server is `/api/v1`, not `/v0`.** The function's older modes use
`https://api.euka.ai/v0`. The GMV Max routes exist only under
`https://api.euka.ai/api/v1` (verified 2026-09-15). Check a route without a
key: 401 or 400 means it exists, 404 means it does not. Mode 7
(`type: 'gmvmax'`, `op: advertisers | campaigns | creatives | item`) relays
those reads and passes Euka's own status back as `upstreamStatus`.

### The Euka ad-figures sync (`euka-ads-sync`)

Copies GMV Max spend per video, and spark codes, into our database. See
FEATURE_MAP, "Ad spend, ROI and spark codes in Paid Collabs come from EUKA".

**Secrets on dev, set 2026-09-15:**
- the function secret `EUKA_ADS_SYNC_SECRET`
- the vault entries `euka_ads_sync_secret` and `euka_ads_sync_url`, written by
  `euka_ads_set_sync_secret()` and `euka_ads_set_sync_url()` running as the
  service role

The secret was generated at run time and never written to a file. To rotate
it, generate a new one and set all three again.

**The schedule.** The pg_cron job `euka-ads-cycle` calls `euka_ads_run_cycle()`
every 5 minutes. When the vault is empty it returns NULL and does nothing. On
production that is deliberate, because Paid Collabs does not exist there. On
dev, `pnpm verify:euka-ads` step [9] fails if the vault is empty.

**Running it by hand:** POST `/functions/v1/euka-ads-sync` with a staff session
and `{"discover": true, "budgetMs": 100000}`. Progress lives in three tables:
- `euka_ad_sync_stores`: which stores are connected, and campaigns listed vs
  reported
- `euka_ad_sync_units`: per campaign-month status, `last_error` and `due_at`
- `euka_spark_sync_days`: per store-day spark-code status

**WHEN A BRAND LINKS A NEW AD ACCOUNT IN EUKA, RUN DISCOVERY.** Only discovery
reads the campaign list, and it runs every six hours, so a newly linked account
(or a newly created campaign) shows nothing until then. This is the first thing
to try when somebody says "we connected it and I see no data" — before
investigating anything.

Sign in as staff with the Supabase JS client, then
`functions.invoke('euka-ads-sync', { body: { discover: true } })`. A run that
discovers stops there by design, so invoke it once more with `{}` to work the
new units; the 5-minute cron would do that anyway.

Then confirm, with the management API:

```sql
select campaign_name, month, status, row_count, cost
from euka_ad_sync_units where store_name = '<store>' order by campaign_name, month;
```

Worked example, 2026-09-17: Apothecary's store had ONE campaign, a deleted
"All Products" with no rows, so every figure was correctly empty. After
discovery it had four, and "Ezy Dose Push Button" carried $24,530 in August
and $14,976 in September. Total time about two minutes.
`BRAND=Apothecary MONTH=2026-09 pnpm verify:euka-ads-ui` then passed 5/5
against the live dev site. **Tell whoever asked to reload the page**: the
screen caches "no figures" for the visit.

`pnpm verify:euka-ads` runs 21 checks: sums across campaigns, month
separation, currencies, replace-not-add, who can read, who can run the sync,
and the vault. `pnpm verify:euka-ads-ui` compares every creator's Ad spend and
ROI on screen with the database for one brand and month (defaults: Penetrex,
2026-09). It needs a preview server and that month synced.

`EUKA_API_KEY` is the original account (ten stores). Additional accounts go
in `EUKA_API_KEYS`, comma or whitespace separated. Both are Edge Function
secrets and neither has ever been in the repo or in git history.

```powershell
supabase secrets set EUKA_API_KEYS=<key>[,<key2>] --project-ref $env:SUPABASE_PROJECT_REF_DEV
supabase functions deploy euka --project-ref $env:SUPABASE_PROJECT_REF_DEV
```

Set on **dev** 2026-09-09 for Nutra. Production was NOT changed: Paid
Collabs is dev-only (there is no `wurxbase` schema on prod), so nothing on
production calls Euka.

### Client share links (Paid Collabs)

A link shows one or more brands, read only, to somebody with no account. See
FEATURE_MAP, "Client sharing: read-only links into Paid Collabs".

**The normal way is the screen:** `/admin/client-links`, in the Paid Collabs
group, ops and admin only. Make a link, copy it once, revoke it there.

**The terminal tool** is for scripts and for when a link is needed without a
browser. With `SUPABASE_SERVICE_KEY` in the environment:

```bash
node scripts/share-link.mjs new "Apothecary - Sarah" Apothecary 30
node scripts/share-link.mjs new "Two brands" "Apothecary,Penetrex" 90 ktcv
node scripts/share-link.mjs list
node scripts/share-link.mjs revoke <id>
```

`sections` is any of k (top numbers), t (top videos), c (creators), v (videos);
the default is all four.

**NOT through the SQL editor or the management API.** Both run as `postgres`,
whose JWT is not the service role, so `collab_share_create` raises "Only an
admin can create a client link" — the gate working, not a fault. The tool uses
supabase-js with the service key, which `is_service_role()` recognises.

The client's address is `https://wurxmediahubdev.vercel.app/share/collabs/<token>`
(production once it goes live). **The link is the credential: 192 random bits.**
Since 2026-09-18 it is stored as well as its SHA-256, so the owner's screen can
copy it again (DECISIONS says why). Links minted before that have no stored
address; the screen's **Give it a new address** issues one and kills the old
one, keeping the history. That is also the move when a link has spread.

**Watching a link.** `collab_share_list()` carries `view_count` and
`last_viewed_at`; `public.collab_share_views` holds one row per open, with the
visitor address hashed and salted per link. A count climbing far beyond one
client is the only sign a shared secret gives that it has spread.

```bash
pnpm verify:collab-share      # 43 checks, attacks the door. Needs SUPABASE_SERVICE_KEY
pnpm verify:collab-share-ui   # 32 checks in a real browser with no session.
                              # Needs a preview server and SUPABASE_SERVICE_KEY
pnpm verify:client-links      # 18 checks on the owner's screen. Same needs.
```

All three mint their own links and delete them in a `finally`. They write
nothing to Paid Collabs.

### Follower counts looked up by handle (Euka market intelligence)

The Creators tab's Followers column falls back to
`public.euka_creator_followers` when the shop data has no count. See
FEATURE_MAP, "Followers on the Creators tab". It fills by itself: every
five-minute `euka-ads-sync` run asks Euka about four handles. **Nothing needs
running by hand.**

**Is it filling?** The summary JSON of each sync run carries
`followers: { looked, found, missed, failed, why }`. Or read the table with
supabase-js and the service key (the management API works too, it is a plain
table): `found = true` rows are counts, `last_error` rows are Euka refusals
waiting about a day for a retry. On 2026-09-18 at 16:50 UTC: 465 handles
known, 75 found, 0 clean misses, 11 refused, 379 not yet asked.

**`503 "Market Intelligence service is unavailable"` is rationing, not an
outage.** In the same minute that five new handles got 503, a handle Euka had
answered before got 200. Do not raise the batch size to go faster; fifteen
back to back drew 503s from a healthy service. The fill takes a day or two.

**Probe one handle**, signed in as staff with supabase-js:
`functions.invoke('euka', { body: { type: 'micreator', keyword: '<handle>' } })`
returns `{ upstreamStatus, payload }`, Euka's answer untouched.

```bash
pnpm verify:followers   # 16 checks. Needs a preview server and SUPABASE_SERVICE_KEY
```

## Resubmitting the TikTok app (written 2026-09-23)

Only Rashid can send it. Everything technical is done and live.

**Prerequisites, both checked before he opens the portal:**
- The website is live on production — done, `d3f1555`, `verify:site` 86/86
  against `wurxmediahub.vercel.app` itself.
- **`support@wurxmedia.com` must exist and be read.** Both legal pages send
  people there and a reviewer may test it. He said on 2026-09-22 he would
  create it. The Contact page uses `rajil@wurxmedia.com`, which wurxmedia.com
  publishes, so that address is already real.

**In the portal** (developers.tiktok.com → Manage apps → WurxMedia Hub):

| field | what to do |
| --- | --- |
| App icon | upload `https://wurxmediahub.vercel.app/tiktok-app-icon.png` (1024×1024) |
| Website URL | `https://wurxmediahub.vercel.app/` — the root, now a real site, NOT `/tiktok` as the 27 note said |
| Terms URL | `https://wurxmediahub.vercel.app/terms`, unchanged |
| Privacy URL | `https://wurxmediahub.vercel.app/privacy`, unchanged |
| Products | Login Kit only. Change nothing |
| Scopes | `user.info.basic` + `video.list` only. Change nothing |
| Description, scope explanation | **leave exactly as they are** — the second rejection did not mention them, so they passed. Editing text that passed only creates new risk |
| Reason box | **120 CHARACTERS, not words.** Rashid hit the limit on 2026-09-23 with a 534-character draft. Use: `Both fixed: the icon now matches our website, and the website URL is a full multi-page site. Scopes unchanged.` (110) |
| Demo access | the connected creator login, see below |

**GIVE THE REVIEWER A DEMO LOGIN, and this is not optional politeness.**
Production still drives the SANDBOX TikTok app (`sbaw82kr6qc82ia76e`, PARKED
27b/27c). A reviewer who signs up on the live site and presses Connect with
their own account is not on the sandbox's target-user list, so it fails on the
exact screen under review. Rashid chose on 2026-09-23 to hand them the already
connected creator account rather than swap the key first. **Do not swap the key
without him asking:** whether an unapproved app's own key behaves better is
undocumented, and the swap changes a live credential.

**MEASURE ANYTHING THAT GOES IN A PORTAL BOX.** The reason box takes 120
characters. The public description took 115 on the first submission, which
should have been the clue. A draft that does not fit is not a small
inconvenience: it is discovered while he is in the form, mid-submission.

**Afterwards:** reviews take days to two weeks. If it is rejected again, get
their note verbatim BEFORE changing anything — on this app their stated reason
has twice named the wrong field.

## Reacher (Irwin Naturals only)

Reacher is the affiliate platform Irwin Naturals sells through. Everything else
is Euka. See FEATURE_MAP, "Irwin Naturals comes from Reacher, not Euka".

**It is `reacherapp.com`.** `reacher.email` / `api.reacher.so` is an unrelated
email-verification service with the same name, and it answers 403 to everything,
which reads exactly like a bad key.

```
base   https://api.reacherapp.com/public/v1
auth   x-api-key: rk_live_…        (Authorization: Bearer → "Invalid token format")
shop   x-shop-id: 12832 | 1,2,3 | all     — required on EVERY call
pages  page / page_size, page_size ≤ 100  — 101 is a 422
docs   https://docs.reacherapp.com  ·  spec at /openapi.json (297 paths)
```

**Secrets on dev:** `REACHER_API_KEY` (the function secret) and
`REACHER_SYNC_SECRET`, plus the vault entries `reacher_sync_secret` and
`reacher_sync_url`, written by `reacher_set_sync_secret()` and
`reacher_set_sync_url()` running as the service role. The key is in
`.env.local` as `REACHER_API` for the check script. **Never write it anywhere
else** — it can create ad campaigns.

**The schedule:** pg_cron job `reacher-cycle` calls `reacher_run_cycle()` every
15 minutes. Empty vault means it returns NULL and does nothing, which is what
production does — there is no Paid Collabs and no Irwin Naturals there.

**Running it by hand**, signed in as ops/admin/ads_manager:
`functions.invoke('reacher-sync', { body: { dryRun: true } })` reports what it
would file and writes nothing. Drop `dryRun` to do it. The service role CANNOT
call it: the gate wants the scheduler's secret or a real user.

**What a run says:** `reacher_sync_runs` holds one row per run — videos seen,
videos filed, creators matched, spend rows, campaigns seen, and the failure
reason when `ok` is false.

**~~NO AD SPEND IS NOT A FAULT~~ — THE ADS ARE CONNECTED NOW (2026-09-29).**
Irwin's shop reports **4 campaigns and 164 spend rows**, and the brand page
shows real Ad spend and ROI. The note that used to sit here — "no GMV Max
campaign connected, `campaigns_seen` is 0, the column shows a dash" — was true
when it was written and is not any more. Rashid asked on 2026-09-25 to "check
that ad account for Irwin Naturals is connected now"; it is.

**What is still true from that note:** zero campaigns is not by itself a fault,
and the way to tell an empty ads side from a broken key is the control — the
same key returning real videos for the shop proves the account is alive.

### Thumbnails for the videos we file

`reacher-sync` fills a blank `thumb` from the one public object store every
thumbnail on these screens already comes from, keyed on TikTok's video id:

```
https://database.euka.ai/storage/v1/object/public/creator_videos_photos/<videoId>.webp
```

**Reacher has no thumbnail to give.** Checked against their own spec: neither
`/videos/list` nor `/videos/performance` carries an image field, and their
`social-intelligence` routes answer 404 for us — as does the control, so that
is "not on our plan" rather than "no data".

**DO NOT USE TIKTOK'S oEMBED, however well it works.**
`https://www.tiktok.com/oembed?url=…` needs no key and hands back a real
thumbnail — with `x-expires` in the URL, which on 2026-09-29 was the NEXT DAY.
Storing one puts pictures on the screen for a day and empties them again with
nothing failing.

There is no cache table: a video with a thumbnail is never asked about again,
and the only ids re-asked are the ones with no picture yet, which is exactly the
set worth retrying. 60 of Irwin's 66 resolved; the other 6 are genuinely absent
from the store and keep the play-symbol placeholder.

```bash
pnpm verify:video-thumbs   # 14 checks. Needs SUPABASE_SERVICE_KEY and a preview
                           # server. Proves no stored URL carries an expiry.
pnpm verify:deal-complete  # 20 checks. Needs SUPABASE_SERVICE_KEY and
                           # COLLAB_STAFF_PASSWORD (the service role cannot call
                           # reacher-sync, so it signs in to dry-run it).
```

### A finished deal moves itself to Payment Pending

The status on screen is derived from the `videos` flag. Both browser paths that
write videos recompute it from the deal on every save; `reacher-sync` did not,
so a creator whose videos come from Reacher finished their deal and stayed in
"Videos in Progress" until a human noticed. **Irwin is the only brand Reacher
fills, which is why it was the only brand where Asad was doing it by hand.**

The rule is forward-only: it never writes a status backwards, never touches a
row that is already `Paid`, and never writes `payment_status` — the screens read
Payment Pending from the flag whenever the row is not Paid, so there is nothing
to gain and a human's field to lose.

`parseDealVideos` now exists twice, in `WurxUI.jsx` and in `reacher-sync`.
**Change one and change the other**; `verify:deal-complete` runs both copies
over every deal string that exists and fails if they ever disagree.

```bash
pnpm verify:reacher   # 19 checks. Needs SUPABASE_SERVICE_KEY, REACHER_API in
                      # .env.local, and a preview server
```

### A brand picture for a brand EUKA does not cover

Paid Collabs draws every brand face from Euka's store photo. A brand with no
Euka store — Irwin Naturals — shows a gradient letter until it is given one.

```bash
SUPABASE_SERVICE_KEY=... node scripts/brand-photo.mjs "Irwin Naturals" --tiktok irwinnaturalsofficial
SUPABASE_SERVICE_KEY=... node scripts/brand-photo.mjs "Irwin Naturals" --file C:/path/logo.png
SUPABASE_SERVICE_KEY=... node scripts/brand-photo.mjs "Irwin Naturals" --url https://…/logo.png
SUPABASE_SERVICE_KEY=... node scripts/brand-photo.mjs --list
```

It stores the file in the public `brand-assets` bucket under
`collab-brands/<slug>.<ext>` and records it in `collab_brand_photos`. The
screen prefers Euka's photo and reads this only when there is none.

**`--tiktok` goes through unavatar.io, which has a DAILY anonymous limit** that
`sync-creator-avatars` also spends: a 429 saying "Daily anonymous rate limit
reached" means try tomorrow or use a file. Irwin's picture came from the logo
on their own website instead (their Shopify CDN serves it at any size —
`?width=512&height=512`), which is why `--file` and `--url` exist.

### The onboarding product picker (`collab-products`)

One Edge Function answers "what does this brand sell", for Euka brands and
Reacher ones alike. Staff (and the read-only Paid Collabs roles) only.

```js
// signed in as staff
await supabase.functions.invoke('collab-products', { body: { brand: 'Penetrex' } })
// → { source: 'euka' | 'reacher' | 'none', store, products: [{id,name,image,price,status}], note }
```

- **Euka** needs the brand id, not the store id, and `pageSize` ≤ 100.
- **Reacher's `/products/catalog` is empty for Irwin**, so the function falls
  back to the products named on that shop's videos. The `note` says when it did.
- `source: 'none'` means neither platform has that brand — most of the 43 Paid
  Collabs brands. The modal then behaves exactly as it did before.

```bash
pnpm verify:product-picker   # 22 checks. Needs a preview server, and
                             # SUPABASE_SERVICE_KEY for the no-stray-row proof
```

### The onboarding drawer

```bash
pnpm verify:drawer          # 78 checks at 100/125/150/175/200% zoom and phone width
pnpm verify:product-picker  # 24 checks on the dropdown and the deal split
```

**If it ever appears under the top bar again:** `.wurxbase-root` and
`.wurxbase-fence` carry `isolation: isolate`, so nothing inside Paid Collabs can
paint over our shell header whatever its z-index. The drawer is offset by
`--wx-topbar` (3.5rem, the header's own height) for that reason. Do not "fix" it
by raising a z-index; it cannot work from inside a sealed stacking context.

### Product pictures

```bash
pnpm verify:product-images   # 19 checks: the endpoint per platform, then FETCH the URLs
pnpm verify:drawer           # 84 checks, including that the photographs render in a browser
```

Pictures come from EUKA by **exact TikTok product id**, never from a list:

```
GET  /social-intelligence/products/{productId}?brandId=…      our own shop's record
POST /market-intelligence/tiktok/product/detail  need_image:1  market data, id only
```

The second needs no brand id, so it works for Reacher and Cruva brands too. Any
EUKA key may ask it — that is not a breach of the one-key-per-store rule, which
is about store data. Answers are cached in `public.collab_product_images`;
delete a row to force a re-ask.

### Cruva, what is already known — do not re-derive this

The key lives in `.env.local` as `CRUVA_API`. **It is valid**: a bogus key of the
same shape gets `403 Unauthorized`, the real one gets through.

| Fact | Evidence |
|---|---|
| Base is `https://api.cruva.com`, auth is `x-api-key` | `/health` returns `{"status":"ok"}` |
| Server is gunicorn; a missing route is `404 {"error":"Not found"}` | response headers |
| Every call needs an `X-Shop-Id` header | `400 {"error":"Missing X-Shop-Id header"}` |
| The key reaches **only** `/community/campaigns/list` and `/community/campaigns/get` | swept ~400 candidate paths derived from their own operation names |
| There is no OpenAPI spec, no `/docs`, no public API article | probed; help centre has no API page |
| `mcp.cruva.com` lists all 106 operations to **any** bearer token | a bogus key gets the same list — so `tools/list` is public and the key is NOT an MCP credential |
| Actually calling an MCP tool needs OAuth | `401 expected JWE compact serialization` |
| The key cannot mint an OAuth token | `/oauth/token` answers `unsupported_grant_type` for every grant |

**A rate limiter will make a sweep lie to you.** Running eight requests at once
returns `429` for everything, and a 429 is not a 404 — a concurrent sweep
reported 366 "live routes" that were all rate-limit responses. Probe one at a
time, with a gap, and keep a known-good path as a control.

What Cruva's MCP catalogue shows it *has*, for when a working key arrives:
`search_videos`, `search_crm_affiliates`, `search_brand_products`,
`list_gmv_max_campaigns` and `list_gmv_max_creatives` — the last being
**per-video ad spend**, which is better than Reacher gives us.

**Still needed from Rashid:** the three Cruva Shop IDs, and the endpoint names
from Cruva support.

### Reacher's ad side

```bash
pnpm verify:reacher-ads   # campaigns per shop, the 90-day limit, and the chunked window
```

**`/gmv-max/videos/summary` refuses any range longer than 90 days** —
`400 INVALID_REQUEST "Date range exceeds maximum of 90 days."` — and the sync
asks for 120. It never failed only because the call sits behind
`if (campaigns > 0)` and Irwin has none, so **the day Irwin's ad account was
connected would have been the day the sync broke.** `videoSpend` now splits the
window into chunks of at most 90 days and SUMS the parts per video and campaign.

Summing, not concatenating, matters: the caller files every row under one month
and upserts on `(item_id, month, advertiser_id, campaign_id)`, so two chunks
holding the same video would not double-count — the second would silently
overwrite the first, and a quarter's spend would quietly become one month's.

Ad-account state on 2026-09-24, read from Reacher:

| Shop | GMV Max campaigns |
|---|---|
| Biostime | 6 (Euka is the source for this brand in our app, so nothing to do) |
| Cutler Nutrition | 29 (not a Paid Collabs brand) |
| **Irwin Naturals** | **0 — not connected** |
| Longevity | 0 |

Irwin's ad spend and ROI stay a dash until Rashid connects GMV Max on that shop
in TikTok. It is a dash and not a zero on purpose: zero is a claim about money.

### The October product rule

```bash
pnpm verify:october-product   # 15 checks, both directions, nothing written
```

The rule keys on the row's own `onboarded_on`, NOT on today's date. That is
deliberate and must stay that way: the same drawer edits old creators, and a
clock-based rule would make every pre-October row unsaveable the moment October
arrived. The constant is `WX_PRODUCT_REQUIRED_FROM` in `WurxUI.jsx`.

**Catalogue coverage, measured 2026-09-24.** Count the brands ACTIVE IN THE
MONTH, which is what the Brands screen lists and what onboarding touches — not
the 44 distinct brand names in the table, 28 of which are dormant rows carrying
no hiring date:

| Source | Of the 11 brands active in Sep 2026 |
|---|---|
| Euka | 8 |
| Reacher | 1 (Irwin Naturals) |
| **Neither** | **2 — Aqua Sonic, Pure Daily Care (both Cruva)** |

For those two the product is typed, and the drawer says so. Re-measure by
calling `collab-products` with `{ brand, probe: true }` for each brand in the
month, and count the month rather than the whole table.

### The by-product band

```bash
pnpm verify:product-band   # 46 checks, including that the pills add up to the GMV card
```

It reads `sortedCreators` — the same rows the table below shows — so it is
scoped to the selected month by construction. `wxProductTotals` MUST keep using
the same dedupe key and rule as `wxVideoTotals`; if they drift, the pills stop
adding up to the card above them and both numbers look authoritative.

Pictures are matched from `collab-products` by EXACT product name within the one
brand. Videos carry a product name and no product id, so there is no id to join
on — do not loosen that match.

The catalogue is fetched ONCE per brand and shared with the product groups
below, via `wxProductPics` — a module-level promise cache in `WurxUI.jsx`. A
failed fetch is dropped from it so the next mount asks again.

### "A brand is missing" / "it is not syncing"

```bash
pnpm verify:brand-visibility   # 24 checks, needs SUPABASE_SERVICE_KEY + preview
```

**Check the MONTH before anything else, and check it on the machine that cannot
see the brand.** The Brands screen lists the brands with a creator or a budget
in the selected month, and that month is remembered per browser in
`wurx_ui_state_v1`. A brand with a budget and no creators lives in one month
only.

**The tell that it is not permissions:** the same account behaving differently
on two laptops. Policies follow the account. If the account is not the variable,
stop looking at RLS.

To confirm from the outside, read `wurxbase.brand_monthly_budgets` for the brand
and note its `month`; then read it again signed in AS the person who cannot see
it, which proves the row is readable to them. Both were true for HoneySticks on
2026-10-09, which is what pointed at the browser.

A month chosen today still sticks; one chosen on an earlier day no longer does.

### A platform that answers for some brands and not others

`collab-products` returns **200 with an empty list and a `note`** when EUKA or
Reacher cannot answer — it is not an error from our side and must not be read as
one. The note is a sentence for the person; `upstreamStatus` carries the code.

**Always run a control brand in the same breath.** EUKA 503s for HoneySticks on
every attempt while returning ten products for Penetrex seconds later, so "EUKA
is down" and "our key is wrong" were both wrong. One brand failing is their
store, not their service.

### The creator contract PDF

```bash
pnpm verify:contract-pdf        # 32 checks, needs pnpm preview on :4173
node scripts/backfill-video-thumbs.mjs          # dry run, every brand
node scripts/backfill-video-thumbs.mjs --write  # apply. Needs SUPABASE_SERVICE_KEY
```

The design is in `src/routes/admin/contract-paper.js`, which is OURS; the
vendored `contractPdf.js` delegates to it on one fenced line. The wordmark is
inline base64 (`wurx-mark.js`) so the renderer stays synchronous — a fetched
logo would give a blank header on a bad network and nothing would look wrong.

**ALL TIME, NOT THE CURRENT MONTH, in any suite that opens a brand.** Use
`ensureAllTime(page)` from `scripts/browser.mjs`. Three suites failed on 1
October for no reason other than the date: a brand with no creators this month
is not on the Brands screen at all, and a brand whose creators are all in one
payment status correctly draws no status dividers. **It is a toggle** — clicking
it blindly once per brand turns it on, off, on, and silently tests the middle
brand on the current month, which is why it is a function and not two lines.

### Product groups in the creator table

```bash
pnpm verify:product-groups   # 98 checks, needs pnpm preview on :4173
```

Grouping is on whenever two or more distinct products are in view; otherwise the
table stays flat. Brands used by the suite: `PG_BRANDS` (default
`Penetrex,Dr Tobias`) and `PG_FLAT_BRAND` (default `Pure Daily Care` — pick one
with NO product on any video, and one that actually has creators in the month on
screen, or the check grades a brand it never opened).

**The checks that matter, and why they are worded that way:**

- **No creator is listed twice.** Every row carries per-creator money; a person
  under two products shows their GMV, views, ad spend and ROI twice.
- **The groups add up** to the rows on screen AND to the "N creators" pill next
  to the search box. The band above will NOT match — it overlaps by design.
- **A grouped row is as wide as the card.** `.pc-ct-row` is a twelve-column grid
  with no spare width: Status is 1.16fr of 8.9 and the pill in it is 151px. Take
  even 20px off and the pill overflows, and the next cell paints over it — three
  controls go dead with nothing visibly wrong. Never indent these rows; draw
  inside the row's own 24px of left padding.

**A NOTE ON `verify:collab-controls`, fixed 2026-09-29.** Its overlap probe
counted `document.elementFromPoint` returning nothing as "a neighbour is on top
of it". That is also what it returns for a point OUTSIDE THE VIEWPORT, and the
first table row now sits below a 1000px fold (the by-product band, then the
group header, are above it). The suite stood at six failures describing a bug
that did not exist. It now scrolls the row into view, counts empty points
separately, and FAILS if it could not sample any. If you see that suite report a
control as covered, check the row is on screen before believing it.

### The TikTok identity ledger

```bash
pnpm verify:tiktok-identity   # 24 checks against the real database
pnpm verify:creator-tiktok    # 29 - proves the Settings flow did not move
```

`public.tiktok_identities` is the permanent record of which TikTok account has
claimed an application. It is NOT `creator_tiktok_connections`: that table frees
the account on disconnect by design, which is right for connecting and wrong for
applying.

**To let a barred TikTok account apply again**, call
`release_tiktok_identity(identity_id, reason)` - staff or service_role, a reason
is required, and it writes an `audit_log` row. Deleting the ledger row is not the
way; the release is the auditable path.

**`app_generation`** records which TikTok app key vouched for an `open_id`.
Everything today is `sandbox-2026`. **On the day production moves to the approved
key, every open_id changes** - that is a new generation, a one-time amnesty for
every barred account, and every existing creator must reconnect before their
identity row is current. Diary item, not a bug.

### TikTok's return parameters and the Supabase client

```bash
pnpm verify:oauth-strip   # 8 checks, needs pnpm preview running
```

`src/lib/supabase.ts` is `detectSessionInUrl: true` with PKCE, so the moment it
loads it looks for `?code=` in the address and tries to exchange it. TikTok sends
creators back to `/oauth/tiktok-creator/callback` (and admins to
`/oauth/tiktok/callback`) with exactly that shape.

The strip therefore lives in **index.html**, beside the theme script, because it
has to run before the module graph loads. The parameters are handed to the page
on `window.__wxOAuthReturn`. Do not move this into React: an effect runs long
after the client has been built.

The ads side returns `auth_code` and the creator side `code`; both are captured.

### Releasing a TikTok account, from the screen

Admin -> Data -> **TikTok** -> **Creator accounts**. Live claims first, released
ones underneath with the reason and the date. "Let this account apply again"
needs a sentence before it will submit - required by the database, not the form.

```bash
pnpm verify:tiktok-release   # 16 checks: seeds a claim, releases it THROUGH THE UI,
                             # proves the audit row and that it can claim again
```

**A test fixture that deletes creators must delete their claims too.**
`tiktok_identities.profile_id` is ON DELETE SET NULL by design, so a suite that
removes its test accounts leaves orphans behind - they show as "A TikTok account
- the account that claimed it has been deleted". Four had accumulated from
`check-creator-tiktok` before anyone looked; its cleanup now removes them.

### TikTok-first signup

```bash
pnpm verify:tiktok-signup    # 24 - the guards: browser binding, ticket rules, handle
pnpm verify:tiktok-identity  # 25 - one TikTok, one application, and the release
pnpm verify:tiktok-guards    # 13 - the three Settings-connect defects, closed
pnpm verify:tiktok-release   # 16 - the staff release, through the real screen
pnpm verify:oauth-strip      # 8  - TikTok's code never reaches the Supabase client
pnpm verify:creator-tiktok   # 29 - the Settings flow did not move
```

**The flow.** `/signup` -> Continue with TikTok -> TikTok -> back to
`/oauth/tiktok-creator/callback` -> a ticket is kept in sessionStorage -> email
and password (`supabase.auth.signUp`, browser to Supabase) -> `claim` binds the
proven identity -> the application is written, and a trigger takes its handle
from the ledger.

**WE MINT NO SESSIONS.** Supabase issues them, exactly as before. If anyone ever
proposes minting one server-side, read DECISIONS first.

**One callback address serves two flows.** Signup and the Settings connect both
return to `/oauth/tiktok-creator/callback`; the browser leaves a marker in
sessionStorage so the page knows which. A missing marker falls through to the
creator flow and refuses there - "start again", never a wrong identity.

**If Connect breaks for everyone after a deploy**, check `DISPLAY_SCOPES`
against the TikTok app's own Scopes page. More in our array than on the app and
TikTok refuses the authorise URL outright.
