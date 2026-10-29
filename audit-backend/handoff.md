# Handoff: the creative-angle audit link, for the agent working in this repo

Written 2026-10-29 (Pakistan time). Timestamps below are **UTC** unless marked;
Pakistan is UTC+5, so `2026-10-28 19:09 UTC` is `2026-10-29 00:09 PKT`.

**Read `README.md` in this folder first.** It explains what the backend is, how it
connects, where every secret lives (by name) and how Oracle is wired. This file
is the other half: **what is true right now, what is unfinished, what you must
not do, and what to do next.** Nothing here contains a secret value or a server
address; those are in `ops-local/OPERATIONS.md` (git-ignored).

---

## 1. Where things stand

| Piece | State |
|---|---|
| Backend on Oracle | **Healthy.** Docker + ngrok under systemd, both enabled; public URL answers; `/ready` shows `problems: []` |
| Link to CreatorHub | **Live end to end.** `AUDIT_API_URL` and `AUDIT_API_KEY` are set and verified by digest; the cron `collab-angles-cycle` is active; the vault matches |
| First real run | Batch 1 (5 videos) **succeeded in about 14 minutes** and its angles were filed (`filed` 47 -> 52) |
| Queue | **167 videos queued** at 19:28 UTC, so batches of 5 keep coming back to back. Batch 2 was in phase 2 with no retries |
| Database | **CreatorHub** (`qinxwfdwvpkzfhcijuqw`), the **dev** DB, primary "for now" (owner's decision) |
| Code you work in | this repo (`RashidNazeer`) **is Prism's code**; same code is pushed to `wurxmediahubdev` |
| Backend source | `audit-backend/` here is a read-only snapshot; the source of truth is `C:\Users\Umar Wurx\Wurx Stuff\Wurx Stuff\creative project` |

**Verified, not assumed** (by hash, by log, or by watching it happen): the key
halves match; the vault URL points at CreatorHub's own worker; the shared secret
matches; the edge runtime's `POST /analyze` reached the backend and got `202`;
the first job ran to `succeeded`. **Not verified:** that the filed angles are
*right*. Someone should read a few against their briefs.

## 2. The live constraint: the Gemini free quota

The backend's vision and judging use Gemini on a **free key, 500 requests/day**,
which is a few dozen videos. 167 are queued. When the quota is exhausted a batch
returns every video as `module_failed`. **The worker has no backoff** (section
5), so each video burns its 3 attempts within minutes and ends `failed`. That
loses no data but needs a manual reset.

Options, for the owner to choose: let it run and reset tomorrow; pause the cron;
or enable billing on the Gemini key (the real fix). Pausing is a DB write the
owner runs:

```sql
select cron.alter_job((select jobid from cron.job where jobname='collab-angles-cycle'), active := false);
-- resume with active := true
```

To reset failed videos (35 are `failed` from the old setup, all **historical**:
the PyAV 19 break, the report crash fixed in commit `2a933b9`, and cookie
failures, all fixed in the live backend):

```sql
update public.collab_angle_videos set status='queued', attempts=0, last_error=null where status='failed';
```

**Do not run either without the owner saying so.** Resetting re-queues work that
costs quota.

## 3. The investigation you were also asked to read: "The categorising service refused the request"

**What the message is.** `src/routes/admin/collab-angle-categorise.tsx`,
`messageFrom()` (about lines 68-95). It is the **generic fallback** shown
whenever the `collab-angles` function returns a non-2xx status **without** a
readable `{"error": ...}` body. It does not say what went wrong.

**What it is not.** `collab-angles` never calls the audit backend. It only reads
and writes CreatorHub (`angles.progress`, `angles.start`). Every failure its own
code handles returns a specific JSON `error` (401 "Not signed in", 403 "Not
allowed", 422 "has no content brief", 500 with the exception text), and the
screen would show *that*. So this message is **not an Oracle, ngrok or Gemini
problem**, and it cannot come from the function's own handler. It means the
response came from the platform in front of it.

**Evidence (CreatorHub function logs, last 24 h):**

| Function | 200 | other |
|---|---|---|
| `collab-angles` | 79 | **1 x 503** at `2026-10-28 19:30:19 UTC` (00:30 PKT) |
| `collab-angles-sync` (the worker) | 34 | 0 |

The function's console output for that window is **empty**, so its code never
ran (a handler failure would log `collab-angles failed ...` and return 500).
All neighbouring requests are 200, and the screen polls every few seconds, so
the next poll succeeded.

**Conclusion.** A single transient **platform 503** (the edge runtime could not
start or reach a worker), not a defect in this code or the backend. Nothing is
stuck; the worker kept filing. **Inference only:** the functions' version number
went 4 -> 6 during the day while their code timestamp stayed 10-26, which fits
config-only bumps such as setting secrets; a worker restart is a plausible
trigger. Not proven.

**If it recurs, the status code in the logs decides it:**

| Log shows | Means | Do |
|---|---|---|
| `401` | gateway rejected the JWT (expired session, or a token from another project). The body is `{"code":401,"message":"Invalid JWT"}`, which has no `error` field, so the screen shows the generic text | sign out and in; check the deployed app points at CreatorHub. The function sets `verify_jwt = true`; with the newer asymmetric JWT signing keys the gateway's legacy check can reject valid tokens, in which case set `verify_jwt = false` (the function already verifies the user itself via `auth.getUser`) |
| `503` repeatedly | the function fails to boot | read the function logs for the boot error; redeploy |
| `546` | resource limit (CPU or memory) on `angles.start` for a very large brand-month | the function builds big arrays in `monthOf`; paginate or trim |
| `404` | function not deployed | deploy it |

**How to see the logs.** The Management API's old `logs.all` endpoint is
**gone (HTTP 410)**; the replacement is
`GET /v1/projects/{ref}/analytics/endpoints/logs` taking **ClickHouse SQL over a
single `logs` table, filtered by the column `source`** (values include
`function_edge_logs`, `function_logs`, `edge_logs`, `auth_logs`,
`postgres_logs`). Selecting `*` or a `metadata` column fails. Always check the
reply for an `error` key: an earlier script treated an error reply as "no rows"
and wrongly reported an empty window. Or use the dashboard: Edge Functions ->
`collab-angles` -> Logs. The response's platform error code (`BOOT_ERROR`,
`WORKER_LIMIT`, ...) is not reachable through the API; look for it in the
dashboard at 19:30 UTC.

**The fix for this is written, tested and ready**: `patches/0001-...` (the screen
retries a transient 502/503/504 and names the real status and reason instead of
the generic text). See "Ready-made patches" in section 5. The owner pushes
frontend changes themselves, so these are patch files, not edits to the working
tree.

## 4. Standing decisions (do not re-litigate)

- **CreatorHub is the database from now on**, dev, primary for now.
- **Old-database traces stay as history.** Do not rewrite or delete the docs,
  the hard-coded refs in scripts (`check-angles-live.mjs`, `lib/dev-guard.mjs`,
  the seed scripts) or the untracked `.env.old-backup`. **Never delete the old
  paused WurxMedia-org projects.**
- **`Prism\PrismV1` is not to be touched** yet.
- **Never go to a paid plan** (Oracle, and the owner's general rule). Gemini
  billing is the one place where that trade-off is the owner's to make.
- **The backend stays on Oracle.** The old laptop deployment is stopped and must
  stay stopped: only one ngrok agent can hold the domain.
- **`AUDITOR_ALWAYS_RECOMPILE_BRIEF` stays `true`.**
- **Pushing the backend repo is deferred** by the owner (see section 8).

## 5. Work to do, in priority order

### 5.0 Ready-made patches (`patches/`, apply in order)

> **UPDATE 2026-10-29: 0001 and 0002 are ALREADY APPLIED. Do not apply them again;
> they would conflict.** The agent working in this repo included both (the same
> code) in commit `09d5205` on branch `fix/categorise-quota-backoff`, together
> with the worker fixes in 5.1, and **both functions are deployed** (v7). It also
> improved 0002's detector: it adds the `needs_review` notes ("no visual
> evidence", "the angle judgement returned nothing") to the pattern, and it counts
> a *queued* video without requiring `attempts > 0`, because the new worker
> deliberately does not charge an attempt for an environmental failure, so a
> video held back by a dead quota has `attempts = 0`. 0002 as written here would
> have gone silent in exactly that case. **0003 is new** and applies on top of
> `09d5205`; see 5.0b.


Both are **tested** and **not applied**: nothing in this repo's working tree has
been changed. They apply with `git apply` from the repo root (check first with
`git apply --check`). On this Windows repo git writes CRLF into the working copy
(`.gitattributes` says LF in the repo, native in the working copy), which is
expected.

| Patch | What it does | Touches |
|---|---|---|
| `0001-categorise-retry-transient-and-name-the-error.patch` | `callAngles` retries a **502/503/504** up to twice (1 s, then 3 s); a 500 is **not** retried. `messageFrom` also reads the gateway's `message` field and the HTTP status, says "sign in again" on a 401, and otherwise reports e.g. "returned an error (503): Function failed to start. This is usually temporary..." | `src/routes/admin/collab-angle-categorise.tsx` |
| `0002-gemini-trouble-note.patch` | `collab-angles` `angles.progress` now also returns `model_failures`: how many videos failed **in the last 24 h** with a reason that looks like the Gemini model (`module_failed`, quota, `RESOURCE_EXHAUSTED`, rate limit, "gemini", "model call"), counting `failed` videos and ones re-queued after a failure. The screen then shows: "N videos could not be analysed. Most likely the Gemini API is not working or its daily quota is used up (the free key allows about 500 requests a day and resets daily). They are retried up to 3 times, then stay failed until an admin resets them." | `supabase/functions/collab-angles/index.ts` and the screen |

**Why retrying is safe:** `angles.progress` only reads, and `angles.start` skips
every video already filed or queued, so repeating either cannot double-queue.
**Why a 500 is not retried:** it is the function's own handler failing and may
already have written part of its work.

**Verified:** each patch applies cleanly to the pristine files, in order;
`tsc -p tsconfig.app.json` under the project's strict config gives **0 errors**
before and after; 25 behavioural tests pass against the patched code (a single
503 is retried invisibly; three in a row give a message naming the status and
reason; 401, 403, 422 and 500 are not retried and keep their own wording; a
non-JSON 504 does not crash; a TikTok download failure and a report crash are
**not** blamed on Gemini; a 3-day-old failure does not count, so the 35
historical `failed` rows stay quiet). **Not verified:** the note on a real
screen (no browser was run), and the function on the real Deno runtime
(it was syntax-checked and its logic tested in Node).

**Deploying 0002** needs the owner: `supabase functions deploy collab-angles
--project-ref qinxwfdwvpkzfhcijuqw` after a relink (section 5.2). The screen
tolerates an older function (`model_failures` defaults to 0), so the two halves
can ship in either order. The note is a **hint**, not proof: `module_failed` also
appears when the backend's own dependencies are broken, hence "most likely".

### 5.0b Independent review of `09d5205`, and one flaw to fix (patch 0003)

**Verified independently on 2026-10-29:** `pnpm verify:angles-backoff` 56/56,
`verify:angles-categorise` 53/53 and `tsc` clean, all reproduced; both functions
live as v7 (`collab-angles-sync` 20:28 UTC, `collab-angles` 20:34 UTC), and the
deployed bundles contain the committed logic (checked by string, not byte for
byte); the cron is active and the queue is draining (`filed` 52 -> 77, `queued`
167 -> 142 between 19:28 and 20:42 UTC, no batch with an error). **Still
unproven:** the worker on a real dead-quota batch (it has run for one batch since
deploy), and the screen in a browser.

**The flaw: a bad video can never run out of attempts.** `chargesAttempt` never
charges a failure whose reason is `source` (a download failure) in a batch of
more than one video. "could not download this link" is what a blocked server
**and** a deleted or private video both say, and the old failures already include
7 of them. Two such videos always share a batch, so they are never charged, never
`failed`, and are probed once an hour for ever. Simulated with the committed
module, a queue of 172 for 7 days:

| Bad videos | filed | stuck | wasted probe batches |
|---|---|---|---|
| 0 | 172 | 0 | 0 |
| 1 | 171 | 0 | 0 |
| **2** | 170 | **2, forever** | 129 |
| **7, spread out** | 143 | **29** (22 of them good, starved behind the cooldown) | 115 |
| **7, at the head** | **0** | **172** | 137 |

The tail livelock (two or more bad videos left) is certain whatever the order.
The starvation of good videos depends on how Postgres breaks ties in
`order by created_at` (all rows from one `angles.start` share a timestamp), so it
is a risk, not a certainty. The queue should reach its tail in about 7 hours at
the observed pace. **Patch 0003 fixes it**, still never charging a model failure:
a download failure is charged when other videos in the batch downloaded fine, or
once a whole-batch download failure has repeated `SOURCE_CHARGE_AFTER` (3) times
running. It adds optional parameters with defaults, so existing calls behave as
before. In a scratch copy of `09d5205` the guard goes from 56 to **71 checks, all
passing** (15 new, including the simulated queues above); it applies cleanly with
`git apply --check`. Residual: two or more videos that legitimately have "no
visual evidence" at the very tail go through the same uncharged `needs_review`
path; rare, and the operator can resolve them.

**A second finding worth knowing:** of the 25 videos filed in the first six
batches, **20 needed one or two retries first** (11 took two attempts, 9 took
three). Most videos fail once before succeeding, which points at the free
Gemini's per-minute rate limit being hit routinely, not only the daily quota. The
old worker charged every such failure, so nine videos were one failure from
`failed`; `09d5205` stops charging them. It also means throughput is bounded by
the rate limit as well as the 500-a-day cap.

**A decision still open (the agent flagged it): a brand with a bad brief now loses
its queue.** An unshared brief or "no active brief" is a non-config refusal, so
each refusal now charges its five videos and three of them fail them: 15 videos
per three minutes, faster than the old infinite loop and destructive where that
lost nothing. Recommendation: do **not** charge those; give them the same `ENV:`
cooldown ladder instead, so the worst case is one wasted batch an hour, visible in
`collab_angle_batches`, and fixing the brief clears it with nothing lost.

Minor: the module's header comment said the backend source was read on
`2026-10-30` (tomorrow); 0003 corrects it to `2026-10-29`.

### 5.1 Fix the worker (`supabase/functions/collab-angles-sync/index.ts` and `_shared/audit-api.ts`)

Found by a static contract audit and spot-checked. **Line numbers are from that
audit; re-verify before editing.** Deploy only when the owner asks (see 7).

1. **No backoff on environmental failure (the important one).**
   `MAX_ATTEMPTS = 3` (about line 52). For each unplaced video the worker adds 1
   to `attempts` and re-queues it (about lines 277-291), then starts the next
   batch at once (about line 403). Nothing distinguishes "this video is bad"
   from "the quota is dead" or "TikTok refuses the datacentre IP". **Fix:**
   detect a batch where *every* video is unplaced for an environmental reason
   (`module_failed`, "could not download"), **do not charge attempts**, and set
   a cooldown (for example a `paused_until` value the cycle respects) with
   exponential backoff. The docs' "split a failing batch" (rule 14) is still
   unimplemented.
2. **A submit-time refusal loops forever** (about lines 426-440). Any
   `AuditRefused` (401, 403, 422, or 429 at the queue ceiling) sends the videos
   back to `queued` **without** charging attempts and the next tick builds a new
   batch, one failed batch per minute, indefinitely. **Fix:** count refusals and
   stop. Also `audit-api.ts` (about lines 119-124) reports only "HTTP 422"
   because FastAPI returns `detail` as a **list**; join it so the real reason is
   recorded.
3. **Truncate the brief label to 80 characters** (about line 116, `product` is
   sent unbounded; the backend's `max_length=80` is in `Backend/app/schemas.py`
   near lines 35-39). Currently the longest is 29, so it is latent, but one
   long product name triggers loop 2 above. One line: `.slice(0, 80)`.
4. **`needs_review` is never retried** (about lines 240 and 256-267), although
   the backend docs say to re-run once. The screen counts it as done.
5. **A 503 "GEMINI_API_KEY not set" looks like "offline"** and waits forever;
   any 5xx or non-JSON reply becomes `AuditOffline` and spends no attempt. Add a
   maximum offline duration that raises something a person will see.

Also known: there is **no worker-side deadline**. The backend's own budget is
10800 s, checked at phase boundaries. A five-video, two-brief batch is roughly
55 minutes at the old baseline, and the Oracle machine is slower, so a
three-times slowdown would trip it. Watch two-brief brands.

### 5.2 Housekeeping the owner must run (you cannot)

- **Relink the Supabase CLI** in this folder: it still targets the old dev
  project, so a `functions deploy` or `db push` from here would hit the wrong
  database. Needs the owner's own `supabase login`, then
  `supabase link --project-ref qinxwfdwvpkzfhcijuqw`. Do not hand-edit
  `supabase/.temp` (a stale `pooler-url` there would mix old and new).
- **Confirm `tiktok-nightly` is meant to be active.** It was off when first seen
  and is now on; nobody here enabled it.
- **The Euka sync cron reports `400 Input validation failed` for about 13
  stores** in its responses (it still returns 200 overall). Unrelated to the
  backend and **uninvestigated**.
- Delete the empty folder tree `C:\UMARWU~1` (left by a mistyped path; the
  harness blocks removing top-level `C:\` paths).

### 5.3 Nice to have

- **Alerting:** nothing tells anyone when no job has arrived for N hours. That
  silent failure (a paused database) hid this link for weeks, and a `/health`
  check would not have caught it. A scheduled check on `collab_angle_batches`
  recency plus the backend's `/ready` would.
- **Prism's own database** is `prism-app` (`ylyehgkxqwwonvbaiobx`), separate from
  CreatorHub; where Prism-the-product stores things long term is the owner's
  call.

## 6. How to check the live system (all read-only)

Use `README.md` section 6 for the hash method, and `ops-local/OPERATIONS.md` for
the server login. Everything below needs no secret on screen.

```
# 1. is the public URL answering?  (404 = no ngrok agent bound; 502 = agent up, backend down)
curl.exe -s -o NUL -w "%{http_code}`n" https://atlantic-canine-hurling.ngrok-free.dev/health -H "ngrok-skip-browser-warning: 1"

# 2. who has been calling it?  (on the server)  curl -s http://127.0.0.1:4040/api/requests/http?limit=100
#    non-curl user agents "Deno/... SupabaseEdgeRuntime" are the worker; POST /analyze -> 202 is a submission

# 3. the queue, in CreatorHub's SQL editor or via the Management API (SELECT only)
select status, count(*) from public.collab_angle_videos group by 1 order by 1;
select state,  count(*) from public.collab_angle_batches group by 1 order by 1;
select left(last_error,90) why, count(*) from public.collab_angle_videos where last_error is not null group by 1 order by 2 desc;

# 4. is the cron running?
select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using(jobid) order by d.start_time desc limit 6;
```

**If "nothing is categorising", check in this order:** is the Supabase project
paused (it was, for weeks), is the cron active, are `AUDIT_API_URL` /
`AUDIT_API_KEY` set, does the ngrok inspector show any POST, is the Gemini quota
gone (`module_failed`), then the backend itself.

## 7. Rules of engagement (the harness enforces several)

- **Never print, paste or commit a secret.** Verify keys by SHA-256 digest.
- **Do not read `.env` files**; the harness blocks it. Variable *names* are fine.
- **You cannot write to a secret store** (Supabase function secrets, vault). The
  harness blocks it as `Secret-Store Writes`; do not route around it. Give the
  owner the exact command and ask them to run it.
- **Do not deploy Edge Functions, push, or merge** unless the owner asks. The
  owner pushes and merges the frontend themselves.
- **Do not run the backend from `audit-backend/`.** It is a snapshot. Never
  hand-edit `auditor/` (it is generated) or this folder's copy of the backend.
- **Do not `git add -A` blindly in this repo.** `audit-backend/` shows as
  untracked; it contains no secrets, but whether it is committed is the owner's
  call. `ops-local/` is git-ignored and must stay so.
- Prefer a script file over nested shell quoting: PowerShell-inside-SSH-inside-
  bash mangled quotes twice and once silently disabled a safety check.
- Windows PowerShell 5.1 corrupts source files (BOM, mojibake). Use an editor.

## 8. Loose ends

- **Four backend commits are not on GitHub** (`cc94820` and the three before it:
  the PyAV pin, the report-crash fix, the clock fix). Push was **deferred by the
  owner**. It fails because this laptop's stored GitHub login is `RashidNazeer`
  while the repo is `umar551869/Creative-Angle-Review-Agent`, and a
  non-interactive session cannot sign in as `umar551869`. The owner runs
  `git -c credential.username=umar551869 push origin backend/upload-endpoint-and-local-hosting`
  in their own terminal. A dry-run merge of that branch into `main` is clean;
  `main`'s five extra commits are the earlier PR merges, so the route is PR #6.
  A verified copy is in `~\spare-laptop-transfer\backend.bundle`. After a second
  account is stored, pin this repo with
  `git config credential.https://github.com.username RashidNazeer`.
- **Oracle reclaim risk.** An idle Always Free instance can be reclaimed after 7
  days of low CPU, network and memory. `keepalive.timer` guards against it by
  running real work every 15 minutes and skipping when a job is active. Its
  skip check was **broken until 2026-10-28** (an ssh heredoc ate the quotes)
  and is now fixed and proven live. **Verified against Oracle's own
  metrics (2026-10-28):** with only the guard running, CPU p95 was 34% and 11.8%
  of minutes were over 20% (the cliff is 5%); before it, p95 was 2.1% and the box
  was a reclaim candidate. The 7-day window was still diluted by the idle first
  day (4.2% of minutes), projected to cross 5% within hours even with no real
  work. Re-check with `ops-local/scripts/check_not_idle.py`.
- **Free-tier dependence.** The server is on Oracle's Always Free tier and the
  vision model on Gemini's free key. Both can change terms.

## 9. Things that have gone wrong before (so you do not repeat them)

- Told the owner the cron was "posting into a dead tunnel". It was not posting
  at all: **the Supabase project was paused.**
- Reported "the backend is serving normally" for days without re-checking it,
  while Docker and ngrok were down. **Test the public URL, not `docker ps`.**
- A script treated an API error reply as "no rows" and reported an empty window.
- A `pythonw.exe` script crashed instantly because `sys.stdout` is `None` there;
  the process looked "started" but was dead. Check the log, not the PID.
- Three launch calls per cycle got the Oracle account throttled on nearly every
  cycle; restarting a loop repeatedly makes throttling worse.
- `cookies.txt` owned by the wrong user made yt-dlp fail on exit. It must be
  owned by uid 1000, mode 600.
