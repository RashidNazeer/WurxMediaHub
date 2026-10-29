# Creative Audit backend: how it works, how it connects, where the secrets are

Written 2026-10-29 for an agent (or person) working in the Prism /
WurxMediaHub app who needs to understand the **creative-angle audit backend**
without having been in the conversations that built it.

> **This folder is a read-only snapshot.** It is the committed source of the
> backend at git commit `cc94820`, branch `backend/upload-endpoint-and-local-hosting`
> of the repo `umar551869/Creative-Angle-Review-Agent`. That commit and three
> before it **were not yet on GitHub** when this was written (a push was
> deferred). The source of truth is
> `C:\Users\Umar Wurx\Wurx Stuff\Wurx Stuff\creative project`. **Do not run
> the backend from here, and do not hand-edit it** — edit the original and
> re-snapshot (command in section 10).
>
> **There are no secrets in this folder** and none are described by value
> anywhere in it. `ops-local/` (git-ignored) holds the server address and Oracle
> IDs, which are account-specific rather than secret.

Reading order: this file, then **`handoff.md`** (what is true right now, what is
unfinished, and the rules of engagement; `patches/` holds two tested fixes, and
`AGENT_PROMPT.md` is the brief to paste into an agent), then `Backend/docs/06_frontend_integration.md` (the API
contract), `Backend/docs/02_pipeline_architecture.md` (what the pipeline does),
and `README.original.md` (the product-level overview).

---

## 1. What it is

A FastAPI service that **audits TikTok videos against a brand's content brief**
and answers with the **creative angle** each video follows, among the angles the
brief names. A job is 1 to 5 videos and one brief (or up to four briefs for a
brand with several products). It downloads each video, decodes frames,
transcribes speech, reads on-screen text, has a hosted vision model describe the
frames, and judges the result against the brief.

Rules that are load-bearing. Do not "improve" them away:

1. **The public API returns angles only.** Callers get
   `angle -> video links`, never the full audit report. Reports stay on the
   backend machine (`AUDITOR_PUBLIC_VIEW=angles`, reports return 403 through the
   public URL).
2. **`AUDITOR_ALWAYS_RECOMPILE_BRIEF` stays `true`.** It was an explicit
   standing instruction from the owner. Each job recompiles each brief, which
   adds 1 to 3 minutes per brief.
3. **No model ever writes a score.** Scoring is arithmetic over verdicts. An
   UNCERTAIN verdict abstains; it does not score zero.
4. **A video's identity is its TikTok numeric id**, never the URL string (the
   same video appears under many URLs).
5. **`needs_review=True` means "could not tell", not "fits nothing".** Those are
   withheld. A `Matched None` with `needs_review=False` is a real finding.
6. **One job at a time** (`AUDITOR_MAX_CONCURRENT_JOBS=1`) and one video at a
   time within a job. Concurrency multiplies model loads and breaks rate limits.

## 2. The whole system on one page

```
 Prism app (this repo, deployed on Vercel)
   staff press "Categorise"
        │  Edge Function  collab-angles           (verify_jwt = true, staff only)
        ▼
 CreatorHub  (Supabase dev project)            tables: collab_brand_briefs,
        │                                              collab_angle_videos,
        │                                              collab_angle_batches
        │  pg_cron  collab-angles-cycle  (every minute)
        │      reads two vault entries, POSTs to the worker
        ▼
 Edge Function  collab-angles-sync   (the worker, verify_jwt = false)
        │  makes batches of 5, POST /analyze, then polls GET /jobs/{id}
        │  headers: x-api-key, ngrok-skip-browser-warning: 1
        ▼
 https://atlantic-canine-hurling.ngrok-free.dev     fixed ngrok domain, free
        │  ngrok agent = a systemd unit on the Oracle VM (Restart=always)
        ▼
 Oracle Cloud VM (Always Free, Ubuntu 24.04, aarch64, 2 OCPU / 12 GB)
        │  Docker container :8000 (port 8000 is NOT open to the internet)
        │  yt-dlp -> ffmpeg -> Whisper + OCR -> Gemini -> judge -> angles
        ▼
 angles come back; the worker files them in CreatorHub as
 filed / needs_review / failed
```

**The frontend never calls the backend directly, and must not.** The API key
would ship to every browser. Everything goes through the Edge Functions, which
read it from server-side function secrets.

## 3. Where each piece lives

| Piece | Location |
|---|---|
| Backend source (this snapshot) | `audit-backend/Backend/` (`app/` API, `auditor/` pipeline, `docs/`, `tests/`, `tools/`, `deploy/`) |
| Caller code in the app | `supabase/functions/_shared/audit-api.ts`, `collab-angles/index.ts`, `collab-angles-sync/index.ts`, `_shared/angle-store.ts` |
| Queue schema and the cron | `supabase/migrations/20261006090000_collab_brand_briefs.sql`, `20261007090000_collab_angle_queue.sql` |
| The staff screen | `src/routes/admin/collab-angle-categorise.tsx` |
| The feature's own doc | `docs/CREATIVE_ANGLE_AUTOMATION.md` (read its numbered findings list) |
| Wiring checks | `pnpm verify:angles-categorise` (offline), `scripts/check-angles-live.mjs` (needs a service key) |
| Database | Supabase project **CreatorHub**, ref `qinxwfdwvpkzfhcijuqw`, the **dev** database, primary "for now" |
| Public URL | `https://atlantic-canine-hurling.ngrok-free.dev` |
| Server | an Oracle Always Free VM; address and IDs in `ops-local/OPERATIONS.md` |

`auditor/` is **generated** from a notebook (`phases_1_to_7_BATCH.ipynb`, which
is not in the repo) and executed in notebook cell order by `auditor/runtime.py`.
You cannot `from auditor.vision import ...`; reach the pipeline through
`runtime.load()` or `app.services.pipeline`. **Never hand-edit `auditor/`.**

## 4. The pipeline, briefly

Seven phases (`Backend/docs/02_pipeline_architecture.md` has the detail):
download and decode, speech (faster-whisper large-v3-turbo) and on-screen text
(RapidOCR), vision (hosted Gemini), compile the brief into requirements, build
evidence on one timeline, judge each requirement on a three-rung ladder
(deterministic, embedding with BGE, then an LLM), then score and report.

Everything is content-addressed (`stage_key(name, version, [hashes], {config})`),
so re-running a video reuses its artifacts. **Bump a stage's version in the same
edit that changes its output**, or stale results are served silently.

Measured on the Oracle VM (2 OCPU, 12 GB): a **5-video batch took about 14
minutes**. Phase 3 (vision) dominates. The first job also downloads about 1.8 GB
of model weights into the `audit-models` volume, which is deliberate
(`BAKE_MODELS=false`).

## 5. The API, as the worker uses it

Base URL as above. Every request carries `x-api-key: <key>` (all endpoints
except `/health`, `/ready`, `/metrics`) and `ngrok-skip-browser-warning: 1`.

| Call | Purpose |
|---|---|
| `POST /analyze` | `{video_urls, briefs:[{url,label,angles}], label}` returns `202 {job_id}`. **Not idempotent.** |
| `GET /jobs/{id}` | `status` is `queued`, `running`, `succeeded`, `partial` or `failed`; read `placements` and `unplaced` |
| `GET /jobs` | recent jobs |
| `GET /ready`, `/health` | readiness (`problems: []`) and liveness |
| `GET /config` | effective settings, secrets shown only as lengths |

Production limits: **5 videos per job**, a 2 MB JSON body, a queue of 20, a job
budget of 10800 s. The brief must be a *publicly readable* Google Doc (an
unshared one returns an HTML sign-in page that would otherwise compile into
real-looking requirements, so it is refused). The brief `label` is limited to
**80 characters** and `briefs` to 4 per job and 12 angles each; breaking these
gives a `422`.

## 6. Secrets: where each lives, who uses it, how to check it without printing it

**Never print, log, paste or commit a value.** Everything below is by name.

| Secret | Lives in | Used by | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | backend `.env` on the server | vision, brief compile, judging | **Free tier: 500 requests/day**, exhausted quickly. Enabling billing is the real fix |
| `AUDITOR_API_KEYS` | backend `.env` | the backend checks callers against it | **A comma-separated list**, so keys can rotate with no downtime |
| `AUDIT_API_KEY` | Supabase function secret, CreatorHub | the worker sends it as `x-api-key` | must equal one entry of `AUDITOR_API_KEYS` |
| `AUDIT_API_URL` | Supabase function secret | the worker | the ngrok URL, **no trailing slash** |
| `COLLAB_ANGLES_SYNC_SECRET` | Supabase function secret **and** vault `collab_angles_sync_secret` | cron to worker | the two must be identical |
| vault `collab_angles_sync_url` | Supabase vault | the cron | must be CreatorHub's *own* worker URL; an old project's URL here sends the cron to the wrong database |
| `cookies.txt` | server, bind-mounted at `/app/cookies.txt` | yt-dlp, TikTok downloads | a logged-in session; **must be owned by uid 1000 (the container user), mode 600**, or yt-dlp cannot save refreshed cookies |
| ngrok authtoken | ngrok config on the server | the tunnel | the account must own the domain, or the domain is refused while auth itself succeeds |
| `HUGGING_FACE_HUB_TOKEN` | backend `.env` | avoids anonymous rate limits on the weight download | `HF_WRITE_TOKEN` is only for a deploy kit, unused |
| SSH key | the owner's laptop `~/.ssh` | reaching the server | key auth only |
| OCI API key | the owner's laptop `~/.oci` | launching and inspecting the Oracle instance | not needed for day-to-day |
| `SUPABASE_ACCESS` | this repo's local `.env` | the Supabase **Management API** (read-only audits) | the Supabase CLI rejects its format (it wants `sbp_...`) |

**Comparing the two halves of the key without exposing it.** Supabase reports a
SHA-256 digest for each function secret. Hash the backend's key *inside the
container* and compare digests:

```
# on the server, inside the container; prints only a hash
sudo docker compose exec -T api sh -c 'printf %s "$(echo $AUDITOR_API_KEYS | cut -d, -f1)" | sha256sum'
# compare with:  supabase secrets list --project-ref qinxwfdwvpkzfhcijuqw   (the AUDIT_API_KEY digest)
```

**Rotating the key:** add the new key to `AUDITOR_API_KEYS` (comma-separated),
`docker compose up -d` on the server (a plain `restart` does not re-read
`env_file`), set the new `AUDIT_API_KEY` in Supabase, then remove the old one.

**Rules for an AI agent:** do not read `.env` files; do not write to a secret
store (setting Supabase secrets is blocked by the harness and must be run by the
owner); verify by digest and by public-URL behaviour instead. Inside a
container, scripts need `-e PYTHONPATH=/app`.

## 7. Oracle: what it is and how it is wired

- **Oracle Cloud Always Free**, home region `me-dubai-1`. The home region is
  permanent, Always Free exists only there, and it has a **single availability
  domain**.
- The VM is `VM.Standard.A1.Flex`, **2 OCPU / 12 GB**, aarch64. The preferred
  4 OCPU / 24 GB never became available (about 1,040 launch attempts over 8
  days); 12 GB clears the ~4 GB working set. Shapes under 8 GB (1 OCPU / 6 GB,
  `E2.1.Micro`) are deliberately avoided: an OOM kill looks like a hang.
- **Nothing is exposed except SSH.** Port 8000 is not in the security list. The
  ngrok tunnel is the only way in, so the key never crosses plain HTTP and
  needs no TLS setup.
- **systemd units**, all `enabled` so they return after a reboot with nobody
  logged in: `docker`, `ngrok` (`Restart=always`, fixed `--url`), and
  `keepalive.timer`. The container is `restart: unless-stopped`.
- **Idle guard.** Oracle may reclaim an Always Free instance whose 7-day p95 CPU,
  network *and* memory are all under 20%. `keepalive.timer` runs every 15
  minutes; it skips when a job is queued or running, otherwise runs
  `tools/check_deps.py` inside the container as real work (a canary for silent
  dependency breakage), then tops up to 70 s at the lowest priority.
  **Measured, not assumed** (OCI Monitoring, 2026-10-28): before the guard existed
  the box was idle by Oracle's rule (CPU p95 **2.1%**, memory about 10%); with only
  the guard, CPU p95 was **34%** and **11.8% of minutes were over 20%** against a
  5% cliff. Memory plays no part (about 10%), so CPU is the lever. A young
  instance's 7-day window still contains its idle first day, so the share climbs
  over several days; `ops-local/scripts/check_not_idle.py` re-checks it at any time
  and projects when it crosses.
- **Deployment tooling is not in this snapshot** (it lives on the owner's
  laptop): a launcher that retried for capacity, `post_launch.py` which stages
  and uploads, and `remote_setup.sh` which runs **detached on the server** so a
  sleeping laptop cannot kill a 20-minute ARM build. Copies are in
  `ops-local/`. They ship `git archive HEAD`, never `scp -r` (the working tree
  carries a multi-GB `.venv` and cache).
- **The old laptop deployment is stopped and must stay stopped.** Only one ngrok
  agent can hold the domain.

## 8. Operating it

```
docker compose ps                              # container + (healthy)
docker compose logs --no-log-prefix --since 30m | grep -E "ERROR|FAILED|MODEL CALL"
docker compose build && docker compose up -d   # after a code change, ~20 s with cache
```

**When someone says "it is not working", check in this order.** It is ordered by
how often each has been the answer:

1. **Is the ngrok agent up?** Test the **public URL**, never just `docker ps`:
   a healthy container behind a dead tunnel looks fine. `404` means no agent is
   bound; `502` means the agent is up but the backend is down.
2. Is the container healthy, and does `/ready` say `problems: []`?
3. **Is the Gemini quota exhausted?** Every video comes back `module_failed`.
4. Did the caller stop? **No request reaching the backend is not a backend
   fault.** Check CreatorHub (is the project paused, is the cron active, are
   `AUDIT_API_URL` / `AUDIT_API_KEY` set). The ngrok inspector on the server
   (`127.0.0.1:4040/api/requests/http`) shows exactly who has called.
5. Transient Google Docs errors cluster and clear; retry before concluding a
   brief is broken. An unshared doc gives "exported as empty text".

## 9. State, known problems, and traps

**State on 2026-10-29.** The link is live end to end. The first real batch (5
videos) ran to `succeeded` in about 14 minutes and its angles were filed in
CreatorHub. **167 videos were queued**, so the worker will keep submitting
5-video batches back to back.

**The Gemini quota is the live constraint.** 500 requests/day is a few dozen
videos. Once exhausted, a batch returns every video as `module_failed`.

**Worker bugs (in this repo's Edge Functions; none fixed or deployed):**

- **No backoff.** An environmental failure (quota, TikTok refusing the
  datacentre IP) is treated as a per-video failure. Each video's `attempts`
  goes up and it is re-queued at once; after `MAX_ATTEMPTS = 3` it is `failed`.
  A dead quota can burn a whole queue in minutes and needs a manual reset.
- **A submit-time refusal loops forever**, creating one failed batch a minute,
  and the 422 `detail` is lost as plain "HTTP 422".
- **The `product` label is not truncated to 80 characters**, which makes the
  backend return 422 and triggers the loop above.
- **`needs_review` is never retried**, although the docs say to re-run once.
- A 503 "GEMINI_API_KEY not set" looks like "offline" and waits forever.

**Traps that cost real time:**

- **`av` is pinned `<19`.** PyAV 19 removed an argument faster-whisper still
  passes, which silently killed every transcription while looking like a mild
  "no visual evidence" warning. Only a real job catches it, not tests.
- **A clock jump used to kill healthy jobs** (the VM resyncs after host sleep).
  The budget now uses `time.monotonic()`.
- **CRLF poisons things.** A trailing CR in `.env` makes a key fail as a `401`
  that looks like a wrong key. Ship `.env` as LF.
- `GET /jobs` rereads every job file; it stays fast only while the job count is
  modest.
- PowerShell 5.1 corrupts source files (BOM, mojibake). Use an editor.
- Port 8000 locally: never bind a local process there while Docker owns it.

## 10. Refreshing this snapshot

From a PowerShell in the original repo (the source of truth):

```
cd "C:\Users\Umar Wurx\Wurx Stuff\Wurx Stuff\creative project"
git archive --format=tar HEAD Backend complete.md | tar -x -C "<path to>\RashidNazeer\audit-backend"
```

**Name the paths, exactly as above.** A bare `git archive HEAD` also extracts the
repo's own root `README.md` and would overwrite this file. Naming `Backend` and
`complete.md` leaves `README.md`, `README.original.md` and `ops-local/` alone.
If files were deleted in the source, delete `audit-backend\Backend` first so
the copy does not keep them. Only tracked files are written, so `.env`,
`cookies.txt`, `.venv` and `data/` can never come along, which is why this is
safe to put beside a repo that gets deployed. Update the commit hash in the
banner at the top when you do it.
