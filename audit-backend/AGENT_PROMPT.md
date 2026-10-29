# Prompt for the agent working in this repo

Paste everything below the line into the agent as its first message.

---

You are taking over the **creative-angle categorisation feature** in this repo
(`WurxMediaHub\RashidNazeer`, which is Prism's code). It has three parts. You
must understand all three, and how they connect, **before you change anything**.

## What the feature is

Staff open a brand's month in the admin screen and press **Categorise**. Each of
that brand's TikTok videos is judged against the brand's content brief (a Google
Doc) and filed under the **creative angle** it follows. The judging is done by a
separate service, the **audit backend**. A video takes minutes, so the work is
queued and drained by a worker in batches of 5.

## The three parts and the link

1. **Frontend** (this repo): `src/routes/admin/collab-angle-categorise.tsx` is
   the button, the progress ring and the status line. It talks only to the
   `collab-angles` Edge Function.
2. **Edge Functions** (this repo, Supabase project **CreatorHub**, the dev
   database): `collab-angles` is the staff-facing API (progress, start, reads
   and writes the queue tables). `collab-angles-sync` is the **worker**, driven
   by the pg_cron job `collab-angles-cycle` every minute. It is the only thing
   that calls the audit backend, through `_shared/audit-api.ts`.
3. **Audit backend**: a FastAPI service on an Oracle Always Free VM behind a
   fixed ngrok URL. Its source is a read-only snapshot in `audit-backend/Backend/`.

The chain: screen -> `collab-angles` -> queue tables -> cron -> `collab-angles-sync`
-> `POST /analyze` and polling `GET /jobs/{id}` over ngrok -> backend (yt-dlp,
Whisper, OCR, **Gemini**, judging) -> angles back -> filed in CreatorHub.

**Two facts people get wrong:** the browser must never call the backend (the API
key would ship to every visitor), and **`collab-angles` never calls the backend at
all**, so an error on the screen is a Supabase problem, not an Oracle one.

## Read, in this order

1. `audit-backend/README.md`: how it all works, where each secret lives (by name).
2. `audit-backend/handoff.md`: **what is true right now**, what is unfinished,
   the rules of engagement, and the investigation of the screen's
   "refused the request" error.
3. `audit-backend/patches/`: two ready, tested patches (see handoff 5.0).
4. `docs/CREATIVE_ANGLE_AUTOMATION.md` (read its numbered findings list).
5. The code, in this order: `collab-angle-categorise.tsx`,
   `supabase/functions/collab-angles/index.ts`, `collab-angles-sync/index.ts`,
   `_shared/audit-api.ts`, `_shared/angle-store.ts`, and the migrations
   `20261006090000_collab_brand_briefs.sql` and `20261007090000_collab_angle_queue.sql`.
6. `audit-backend/Backend/docs/06_frontend_integration.md` (the API contract) and
   `02_pipeline_architecture.md`.

## Before you touch anything, answer these in a few lines each

- Why can't the frontend call the backend directly, and what does call it?
- What does "The categorising service refused the request" actually mean, and why
  is it not a backend problem?
- What happens to a video when the Gemini quota runs out, and why is that worse
  than it should be? (Look at `MAX_ATTEMPTS` and what the worker does with unplaced videos.)
- How do you prove the Supabase half and the backend half share the same API key
  without printing it?
- Which of these can you do yourself, and which must the owner run?

If you cannot answer one, you have not read enough; go back.

## Rules (the harness enforces several of these; do not try to route around them)

- **Never print, paste or commit a secret.** Verify keys by SHA-256 digest.
- **Do not read `.env` files.** Variable *names* are fine.
- **You cannot write to a secret store** (Supabase function secrets, vault). Give
  the owner the exact command instead.
- **Do not deploy Edge Functions, push, or merge.** The owner does those.
  **`audit-backend/` is a read-only snapshot**; never edit it, and never hand-edit
  `Backend/auditor/` (it is generated).
- **Do not touch `Prism\PrismV1`.** Do not delete or rewrite references to the
  old Supabase projects; they are history. Never delete those projects.
- **CreatorHub is the database from now on** (dev, primary for now).
- **Never go to a paid plan.** Gemini billing is the one place that is the
  owner's call, not yours.
- `AUDITOR_ALWAYS_RECOMPILE_BRIEF` stays `true`.
- Use a script file, not nested shell quoting. Windows PowerShell 5.1 corrupts
  source files; use an editor.

## Your first tasks

1. **Check the live state, read-only,** using handoff section 6. Report: is the
   public URL up, is the cron active, what do `collab_angle_videos` and
   `collab_angle_batches` look like, and is anything being retried?
2. **Tell the owner about the Gemini quota.** 167 videos were queued, the free
   key allows about 500 requests a day, and the worker has no backoff. They must
   choose: let it run, pause the cron, or enable billing. Do not choose for them.
3. **Read handoff 5.0 and 5.0b.** Patches 0001 and 0002 are already applied (in
   commit `09d5205`); do not apply them again. Review **0003**, which fixes a
   flaw found in that commit: a bad video could never run out of attempts, so two
   of them stuck the queue for ever. Do not apply it without being asked; it is the
   owner's to push and deploy.
4. **Then the open decision** in 5.0b (a brand with a bad brief losing its queue),
   and what remains of 5.1.

Report what you found, not what you assume. If something in the handoff looks
wrong when you check it, say so; it was written from one session's evidence.
