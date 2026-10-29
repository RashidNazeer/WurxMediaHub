# Backup data

Admin screen: **Data → Backup data** (`/admin/backups`). Admin role only.

A backup is a consistent copy of the whole database, taken at one instant, that
can be put back in one all-or-nothing step. It exists so that the worst day (a
wrong bulk edit, a bad deploy, a deleted brand, a lost project) is survivable.

## What a backup contains

| In it | Not in it |
|---|---|
| Every table in `public` (creators, applications, brands, offers, content, contests, audit log, TikTok connections, ad figures, ...) | The **schema** (tables, functions, policies). That is code in `supabase/migrations`. A backup restores *data* into a database that already has the right shape, and says plainly if the shape differs. |
| Every table in `wurxbase` (Paid Collabs: creators, performance, reports, access control) and any schema added later | Live sessions and one-time tokens (people sign in again) |
| The sign-in accounts: `auth.users` and `auth.identities` (email, hashed password, provider links) so a restored account signs in with the **same password** | Secrets: Edge Function secrets and the Vault |
| Counters, so new rows never reuse an id | Uploaded pictures, **unless** you download the file and tick "Include the pictures" (they live in Storage, not the database) |

The backup's own bookkeeping (`public.data_backups`, `public.data_restore_runs`,
the `backup` schema) is deliberately left out of every backup and every restore,
so the history of backups survives a restore.

## Where a backup lives

1. **Inside the database** (`backup.chunks`): every backup made on the screen. Fast to
   restore from, but it is the same database, so it is lost if the project is lost.
2. **On the device you press the button on.** **Back up now** asks for your password
   (and an optional passphrase), makes the backup, and saves it as one
   `.prismbackup` file in that device's Downloads folder. This is the copy that
   survives the project being lost. Keep it, and copy it somewhere else too.
   (`Back up inside Prism only` skips this.)
3. **A folder on your computer, taken by the read-only script** (below), for the very first
   real backup and for a copy that does not depend on Prism's own backup code:
   `Documents\Prism-backups\<date>\`.

## First backup of the REAL database (read-only, nothing changes in it)

`scripts/ops/backup-real-database.ps1` reads the database with PostgreSQL's own `pg_dump`
(run in Docker), changes nothing and installs nothing into it, and checks its own work.
You need Docker Desktop running and the **Session pooler** connection string from the
Supabase dashboard (Project settings > Database > Connection string) with your database
password filled in. The string is typed hidden and never written to disk.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ops\backup-real-database.ps1
```

Do it once for dev (`npznoiotslruqovorrec`) and once for prod (`isqepjioowzqoyhlusqo`).
It saves `prism-app-data.dump`, `prism-accounts.dump`, `row-counts.txt`, `CHECKSUMS.txt`
and `README.txt` and refuses to say "done" unless every table is in the copy.
It does not include uploaded pictures (use Download with "Include the pictures").
Tested by restoring its output into an empty database and comparing every table's row count.

## Using it

- **Back up now** makes a backup and saves a copy to this device (see above). About 10 s for
  100 MB of data on the server, then the download. Nobody is interrupted.
- **Download** saves a backup as one `.prismbackup` file on your computer:
  compressed, optionally **locked with a passphrase** (AES-256, key derived with
  PBKDF2, done in your browser; the passphrase is never sent anywhere and
  cannot be recovered), optionally with the pictures. Needs your password again.
- **Restore** has three beats: a **rehearsal** (does every step, then undoes it,
  and shows what would change), then **confirm** (password + typing `RESTORE`),
  then the restore. A **safety copy** of today's data is saved first, in the
  list as "Saved before a restore", so a restore can be undone by restoring that.
- **Use a backup file from this computer** loads a downloaded file back in. It
  then sits in the list as "From a file" and is restored the same way.

**Keep a downloaded copy somewhere else.** Stored backups live in the same
database as the data. If the project is lost, they go with it.

A restore **pauses the app briefly** (tables are locked while they are refilled:
about 25 s for 100 MB). Rehearsals do too.

## Disaster recovery: the project is gone, or nobody can sign in

The admin screen needs a working project and a signed-in admin. If you have neither:

1. Make a new Supabase project (or reset the broken one) and apply the schema:
   `supabase link --project-ref <ref>` then `supabase db push`.
2. Get the database connection string (Supabase dashboard > Project settings >
   Database). It contains the database password: put it in the environment for
   the one command, never in a file.
3. Rehearse, then restore:

   ```powershell
   $env:DATABASE_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
   pnpm restore:database -- prism-backup.prismbackup --dry-run --passphrase "..."
   pnpm restore:database -- prism-backup.prismbackup --yes     --passphrase "..."
   ```

   Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to also put the pictures back.
4. The accounts come back with their passwords, so the admin signs in as before.
5. Re-set the Edge Function secrets (`supabase secrets set ...`, OPERATIONS.md) and
   redeploy the functions. They are not part of a backup.

`pnpm backup:database -- --out file.prismbackup [--passphrase "..."]` makes the same
file from the command line, for a scheduled job or an off-site copy.

## How it is built (and why)

- **The work happens in Postgres**, in the `backup` schema (migration
  `20261027120000_backup_data.sql`): `backup.make` (snapshot, in one
  repeatable-read transaction), `backup.verify` (every piece has a SHA-256),
  `backup.apply` (the restore, one transaction: triggers off, foreign keys
  deferred, tables emptied and refilled, row counts checked, everything put back
  exactly as found; a rehearsal is the same thing rolled back on purpose).
  Counters only ever move **forward**.
- **Why not in the Edge Function:** an Edge Function gets about 2 s of CPU per
  request. A first version that read rows in JavaScript was killed by the
  platform at 400,000 rows. Postgres has no such limit.
- **Jobs run in Postgres too** (`pg_cron`, one second after being scheduled,
  unscheduling themselves). The Edge Function only schedules, so a job cannot be
  orphaned when the platform retires a function isolate, and the browser can be
  closed. `backup.sweep()` fails any job the database has no trace of, so a lost
  job can never block the next one.
- **The Edge Function `backup-data`** is only a gatekeeper: role `admin` read
  from `profiles` (not the token), password re-check for download and restore
  (5 wrong tries = 15 minute lock), `RESTORE` typed, audit log, and pages of
  chunks in and out (1.5 MB each).
- **Tables with no policies.** `public.data_backups`, `public.data_restore_runs`
  and `backup.chunks` have RLS on and no policy and no grants to `anon` or
  `authenticated`; the functions are executable by the owner only. Nobody but the
  Edge Function (as `postgres`) can read a backup. Tested in
  `scripts/verify/backup/test-backup-function.mjs`.
- **Safety rules the database enforces, whatever the page does:** a restore is
  refused if the signed-in admin would not be an active admin afterwards (no
  lock-out); if the backup is damaged or cut short; if a table not in the backup
  points at one that is (it would be wiped); and it is rolled back, with a plain
  message, if the data does not fit this database.

## Needs, to run on a project

- The migration applied (`supabase db push`).
- `pg_cron` enabled (it already is: the nightly syncs use it).
- The function deployed: `supabase functions deploy backup-data --project-ref <ref>`
  (`verify_jwt = true` is set in `config.toml`). `SUPABASE_DB_URL` is provided by the platform.
- Do **dev first**, rehearse on real data, then prod. Never restore on prod without a downloaded copy.

## Tests

| Command | Proves | Needs |
|---|---|---|
| `pnpm test:backup` | The SQL and the file code, against a real Postgres (PGlite): byte-identical restore, rehearsal changes nothing, damaged / cut-short / wrong-passphrase files refused, rollback on failure, lock-out protection, forward-only counters, jobs, orphan sweep, schema drift | nothing |
| `pnpm test:backup:live` | The same on the real schema with real accounts (sign in again with the same password), real Storage, and the real non-superuser `postgres` role; also times it | `supabase start` |
| `pnpm test:backup:chaos` | Crash and chaos: sessions killed mid-restore and mid-backup, writes during a snapshot, restoring twice, undo with the safety copy | `supabase start` |
| `pnpm test:backup:function` | The deployed function over HTTP: who may call it, password and confirm gates, create / download / rehearse / restore / undo / upload / delete, no access for anyone else | `supabase start` + `supabase functions serve backup-data` |

Measured on a local stack (96 MB of data, 400,000 rows): backup 9.5 s, rehearsal
18 s, restore including its safety copy 26 s, file download (compress + encrypt
in the browser) 55 s, 6 MB file.

## What was done to try to break it (QA, all repeatable)

| Attack | Result |
|---|---|
| Every column type the schema uses, with extremes: infinity, NaN, year 1 and 9999, 30-digit numbers, a 500 KB string, awkward arrays, JSON scalars | byte-identical after a restore. **This found a real bug** (a table with a column named `t` would have been backed up as only that column); fixed, plus two guards: every row must be a whole row, and each table's backed-up count must equal its live count at that instant |
| Kill the restore session in the middle (crash, restart) | every table exactly as before, no trigger left off, no key left loose; if pg_cron retries, the restore completes whole |
| Kill a backup in the middle | no half-written pieces; it runs again and finishes valid |
| A job that dies every time | cancelled after three tries, in plain words; a finished job is never run twice |
| Writes arriving while a backup runs | consistent snapshot; passes its integrity check and every foreign key holds |
| Restore the same backup twice; restore, then restore the safety copy | identical data; the undo brings back what the restore removed |
| A damaged, cut-short, tampered or wrong-passphrase file | refused before anything is touched |
| A backup that does not fit (foreign key to nothing, newer table pointing in) | refused, nothing changed |
| The signed-in admin absent from the backup | refused (no lock-out) |
| The Edge Platform cutting a response mid-download | the screen retries pages automatically |
| An upload refused half-way | cleaned up at once, no half-loaded copy |

Run them: `pnpm test:backup`, `test:backup:live`, `test:backup:chaos`, `test:backup:function`.

## Limits worth knowing

- A restore needs the project to have the same (or a newer) schema. Differences
  are reported, not hidden: columns that no longer exist are dropped with a
  warning; tables the backup does not know are left alone.
- Backups stored in the database use database space (about 1/8 of their size,
  Postgres compresses them). Delete ones you no longer need. The screen shows the total.
- Pictures in a downloaded file: 120 MB budget, 10 MB per picture; anything over
  is skipped and counted in the file.
- Scheduled automatic backups are not built. A `pg_cron` job calling `backup.make`
  is the natural next step.
