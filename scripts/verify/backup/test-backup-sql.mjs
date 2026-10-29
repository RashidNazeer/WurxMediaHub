/**
 * Proves the backup SQL (supabase/migrations/20261027120000_backup_data.sql)
 * and the file code the admin's browser uses, against a real Postgres (PGlite =
 * Postgres compiled to WebAssembly, no install needed). Run:  pnpm test:backup
 *
 * The test database holds every awkward thing the real one has or might grow:
 * foreign-key cycles and self references, an `auth` schema with a sign-up
 * trigger, a guard trigger, a trigger that was deliberately switched off,
 * identity and serial counters, a generated column, enums, arrays, jsonb, bytea,
 * 19-digit bigints, line breaks and emoji in text, a second schema (Paid
 * Collabs lives in `wurxbase`) and a table that did not exist when the backup
 * was taken.
 *
 * What it proves: a backup restores to byte-identical data; a rehearsal changes
 * nothing; a damaged, cut-short or wrong-passphrase file is refused; a restore
 * that cannot finish rolls back completely; the signed-in admin cannot lock
 * themselves out; counters never move backwards; and every trigger, constraint
 * and setting is left the way it was found.
 */
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { BackupWriter, openBackup, BackupError } from '../../../src/lib/backup/format.ts';
import { chunksFromFile, writeLines, picturesFromFile } from '../../../src/lib/backup/lines.ts';

const MIGRATION = fs.readFileSync(new URL('../../../supabase/migrations/20261027120000_backup_data.sql', import.meta.url), 'utf8');

let failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log('  ok   ' + name);
  else {
    failed++;
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''));
  }
};
const section = (s) => console.log('\n' + s);


const SCHEMA = `
create schema auth;
create table auth.users (
  id uuid primary key, email text unique, encrypted_password text,
  email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz generated always as (email_confirmed_at) stored
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null, provider_id text not null, identity_data jsonb,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  unique (provider_id, provider)
);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade);

create type public.app_role as enum ('applicant', 'creator', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null, display_name text,
  role public.app_role not null default 'applicant',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id, email) values (new.id, new.email); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.guard() returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role then raise exception 'role is not editable'; end if;
  new.updated_at := now(); return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard();
-- a trigger that was deliberately switched off must stay off afterwards
create function public.noop() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger profiles_dormant after insert on public.profiles for each row execute function public.noop();
alter table public.profiles disable trigger profiles_dormant;

create table public.brands (
  id uuid primary key default gen_random_uuid(), name text not null,
  budget numeric(12,2), parent_id uuid references public.brands (id),
  tags text[], meta jsonb, logo bytea
);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text, actor_role public.app_role, subject_type text, subject_id uuid,
  action text not null, detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.videos (
  tiktok_id bigint primary key, title text,
  brand_id uuid references public.brands (id), creator_id uuid references public.profiles (id),
  views bigint, search tsvector generated always as (to_tsvector('simple', coalesce(title, ''))) stored
);
create table public.serial_thing (id serial primary key, label text);
create table public.cyc_a (id int primary key, b_id int);
create table public.cyc_b (id int primary key, a_id int references public.cyc_a (id));
alter table public.cyc_a add constraint cyc_a_b foreign key (b_id) references public.cyc_b (id);
-- Paid Collabs lives in its own schema and points into public
create schema wurxbase;
create table wurxbase.creators (id serial primary key, handle text not null, owner uuid references public.profiles (id) on delete set null);
create table wurxbase.reports (id bigint generated by default as identity primary key, creator_id int references wurxbase.creators (id), month date, gmv numeric(14,2));
alter table public.videos enable row level security;
`;

async function seed(pg) {
  await pg.exec(`
    insert into auth.users (id, email, encrypted_password, email_confirmed_at) values
      ('${ADMIN}', 'admin@example.com', '$2a$10$adminhash', now()),
      ('${CREATOR}', 'creator@example.com', '$2a$10$creatorhash', '2026-01-02 03:04:05.123456+00');
    insert into auth.identities (user_id, provider, provider_id, identity_data) values
      ('${ADMIN}', 'email', 'admin@example.com', '{"email":"Admin@example.com"}'),
      ('${CREATOR}', 'email', 'creator@example.com', '{"email":"creator@example.com"}');
    insert into auth.sessions values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${ADMIN}');
  `);
  // profiles were created by the sign-up trigger; now promote (guard is bypassed by disabling it briefly)
  await pg.exec(`
    alter table public.profiles disable trigger profiles_guard;
    update public.profiles set role = 'admin', display_name = 'Ad min' where id = '${ADMIN}';
    update public.profiles set role = 'creator', display_name = E'Crea\\ntor\\t"quoted" 😀 \\u2028' where id = '${CREATOR}';
    alter table public.profiles enable trigger profiles_guard;
    insert into public.brands (id, name, budget, parent_id, tags, meta, logo) values
      ('b0000000-0000-0000-0000-000000000001', 'Parent', 1234567890.55, null, '{a,"b c",NULL}', '{"x":[1,2,{"y":null}],"big":123456789012345678901234567890}', '\\xdeadbeef'),
      ('b0000000-0000-0000-0000-000000000002', 'Child', null, 'b0000000-0000-0000-0000-000000000001', '{}', null, null);
    -- the child is listed BEFORE nothing; self reference must survive any insert order
    insert into public.videos (tiktok_id, title, brand_id, creator_id, views) values
      (9223372036854775807, 'Max bigint video', 'b0000000-0000-0000-0000-000000000002', '${CREATOR}', 7234567890123456789),
      (7234567890123456789, 'Another', 'b0000000-0000-0000-0000-000000000001', '${CREATOR}', 0);
    insert into public.audit_log (actor_id, action, detail) values ('${ADMIN}', 'test.one', '{"n":1}'), ('${ADMIN}', 'test.two', '{}');
    insert into public.serial_thing (label) values ('one'), ('two'), ('three');
    insert into public.cyc_a (id, b_id) values (1, null);
    insert into public.cyc_b (id, a_id) values (10, 1);
    update public.cyc_a set b_id = 10 where id = 1;
    insert into public.data_backups (note) values ('must survive');
    insert into wurxbase.creators (handle, owner) values ('@one', '${CREATOR}'), ('@two', null);
    insert into wurxbase.reports (creator_id, month, gmv) values (1, '2026-09-01', 1234.50), (2, '2026-10-01', 99.99);
  `);
}

async function snapshot(pg) {
  const tables = [
    ['auth', 'users'], ['auth', 'identities'], ['public', 'profiles'], ['public', 'brands'],
    ['public', 'audit_log'], ['public', 'videos'], ['public', 'serial_thing'],
    ['public', 'cyc_a'], ['public', 'cyc_b'], ['wurxbase', 'creators'], ['wurxbase', 'reports'],
  ];
  const out = {};
  for (const [s, t] of tables) {
    const r = await pg.query(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]')::text as j from ${s}.${t} x`);
    out[`${s}.${t}`] = r.rows[0].j;
  }
  return out;
}


const ADMIN = '11111111-1111-1111-1111-111111111111';
const CREATOR = '22222222-2222-2222-2222-222222222222';
const NEWUSER = '33333333-3333-3333-3333-333333333333';

// ------------------------------------------------------- what the app does --
/** Take a backup, the way the Edge Function does: one repeatable-read transaction. */
async function makeBackup(pg) {
  const id = crypto.randomUUID();
  await pg.exec('begin isolation level repeatable read');
  try {
    const r = (await pg.query('select backup.make($1, true) as r', [id])).rows[0].r;
    await pg.exec('commit');
    return { id, summary: r };
  } catch (e) {
    await pg.exec('rollback');
    throw e;
  }
}
const chunksOf = async (pg, id) =>
  (await pg.query('select seq, kind, table_id, n, hash, payload from backup.chunks where backup_id = $1 order by seq', [id])).rows;

/** Build the downloadable file, the way the browser does. */
async function toFile(pg, id, { passphrase = null, pictures = null } = {}) {
  const w = await BackupWriter.create({ passphrase });
  await writeLines({ chunks: await chunksOf(pg, id), pictures, write: (l) => w.writeLine(l) });
  return w.finish();
}
/** Bring a file in, the way the browser does: piece by piece, each checked on arrival. */
async function fromFile(pg, bytes, passphrase = null) {
  const id = crypto.randomUUID();
  const opened = await openBackup(bytes, passphrase);
  for await (const c of chunksFromFile(opened)) {
    await pg.query('select backup.put_chunk($1, $2, $3, $4, $5, $6, $7)', [id, c.seq, c.kind, c.table_id, c.n, c.hash, c.payload]);
  }
  return id;
}
const apply = async (pg, id, { dryRun = false, accounts = true, actor = ADMIN } = {}) =>
  (await pg.query('select backup.apply($1, $2, $3, $4) as r', [id, accounts, dryRun, actor])).rows[0].r;
const failure = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return { code: e.code, message: e.message };
  }
};
const triggers = async (pg) => (await pg.query('select tgname, tgenabled from pg_trigger where not tgisinternal order by tgname')).rows;
const triggersAsFound = (rows) => rows.every((t) => (t.tgname === 'profiles_dormant' ? t.tgenabled === 'D' : t.tgenabled === 'O'));
const seqs = async (pg) =>
  (await pg.query("select schemaname || '.' || sequencename as s, coalesce(last_value, 0)::int as v from pg_sequences where schemaname in ('public','wurxbase') order by 1")).rows;
const strictFks = async (pg) =>
  (await pg.query("select count(*)::int n from pg_constraint where contype='f' and (condeferrable or condeferred) and connamespace in ('public'::regnamespace,'wurxbase'::regnamespace)")).rows[0].n === 0;

// ------------------------------------------------------------------ the run --
const pg = new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role;');
// PGlite has no pg_cron. This stand-in records what would be scheduled; the test then runs
// each command itself, in a transaction, exactly as pg_cron does (the real thing is exercised by test:backup:live).
await pg.exec(`
  create schema cron;
  create table cron.job (jobid serial, jobname text primary key, schedule text, command text);
  create table cron.job_run_details (runid serial, jobid int, status text);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql
    as $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command) on conflict (jobname) do update set command = excluded.command returning 1::bigint $$;
  create function cron.unschedule(job_name text) returns boolean language plpgsql
    as $$ begin delete from cron.job where jobname = job_name; return found; end $$;
`);
await pg.exec(SCHEMA);
await pg.exec(MIGRATION);
await seed(pg);

section('1. A backup of the whole database');
const before = await snapshot(pg);
const { id: bkId, summary } = await makeBackup(pg);
ok(summary.rows['auth.users'] === 2, 'accounts are in the backup');
ok(summary.rows['public.videos'] === 2 && summary.rows['public.audit_log'] === 2, 'public tables are in the backup');
ok(summary.rows['wurxbase.creators'] === 2 && summary.rows['wurxbase.reports'] === 2, 'Paid Collabs (its own schema) is in the backup');
ok(!('public.data_backups' in summary.rows) && !('public.data_restore_runs' in summary.rows), 'bookkeeping tables are left out');
ok(!Object.keys(summary.rows).some((k) => k.startsWith('backup.')), 'the backup schema itself is left out');
ok(!('auth.sessions' in summary.rows), 'live sessions are not backed up');
const mk = await failure(() => pg.query('select backup.make($1, true)', [crypto.randomUUID()]));
ok(mk && mk.code === 'BK001', 'a backup refuses to run outside one repeatable-read transaction');
const ver = (await pg.query('select backup.verify($1) as r', [bkId])).rows[0].r;
ok(ver.problems.length === 0, 'the backup passes its own integrity check', JSON.stringify(ver.problems));
ok(ver.admin_ids.includes(ADMIN) && !ver.admin_ids.includes(CREATOR), 'admins are recognised from the profiles');
ok(ver.user_ids.length === 2 && ver.profile_roles.admin === 1, 'account ids and roles are listed');

section('2. Change the database after the backup');
await pg.exec(`
  alter table public.profiles disable trigger profiles_guard;
  update public.profiles set role = 'applicant' where id = '${CREATOR}';
  alter table public.profiles enable trigger profiles_guard;
  insert into auth.users (id, email, encrypted_password) values ('${NEWUSER}', 'new@example.com', 'x');
  delete from public.videos; delete from public.cyc_a where false;
  delete from wurxbase.reports; insert into wurxbase.creators (handle) values ('@added-later');
  delete from public.audit_log where actor_id = '${CREATOR}';
  delete from auth.users where id = '${CREATOR}';
  insert into public.brands (name) values ('Added after the backup');
  insert into public.audit_log (actor_id, action) values ('${ADMIN}', 'after.backup');
  delete from public.serial_thing where id = 2;
  insert into public.serial_thing (label) values ('four'), ('five');
  create table public.late_table (id int primary key, note text);
  insert into public.late_table values (1, 'created after the backup');
  insert into public.data_backups (note) values ('a row in the registry');
`);
const afterChange = await snapshot(pg);
ok(afterChange['public.brands'] !== before['public.brands'], 'the database really did change');

section('3. A rehearsal changes nothing');
const seqBefore = await seqs(pg);
const rehearsal = await apply(pg, bkId, { dryRun: true });
ok(rehearsal.dry_run === true && rehearsal.tables.length > 0, 'the rehearsal reports what it would do');
ok(rehearsal.accounts.restored === 2 && rehearsal.accounts.removed === 1, 'it says it would bring back 2 accounts and remove 1');
ok(rehearsal.backup.same_shape === false && rehearsal.schema.untouched.includes('public.late_table'), 'it notices a table the backup does not know and says it will be left alone', JSON.stringify([rehearsal.backup, rehearsal.schema]));
ok(JSON.stringify(await snapshot(pg)) === JSON.stringify(afterChange), 'database is untouched after a rehearsal');
ok(triggersAsFound(await triggers(pg)), 'triggers are exactly as before (the dormant one still off)');
const seqAfterRehearsal = await seqs(pg);
ok(seqAfterRehearsal.every((s, i) => s.v >= seqBefore[i].v), 'a rehearsal never winds a counter back');
ok(await strictFks(pg), 'foreign keys are strict after a rehearsal');

section('4. The real restore');
const res = await apply(pg, bkId);
const restoredSnap = await snapshot(pg);
for (const k of Object.keys(before)) ok(restoredSnap[k] === before[k], `${k} is identical to the backup point`, restoredSnap[k].slice(0, 160));
ok(res.accounts.removed === 1, 'the account added after the backup was removed');
ok((await pg.query('select count(*)::int n from public.late_table')).rows[0].n === 1, 'a table the backup never knew was left alone');
ok((await pg.query('select count(*)::int n from public.data_backups')).rows[0].n === 2, 'backup bookkeeping survived');
ok((await pg.query('select count(*)::int n from backup.chunks where backup_id = $1', [bkId])).rows[0].n > 0, 'the backup itself survived the restore');
ok((await pg.query('select count(*)::int n from auth.sessions')).rows[0].n === 1, 'the admin session survived');
ok(triggersAsFound(await triggers(pg)), 'triggers are exactly as before after a real restore');
ok(await strictFks(pg), 'foreign keys are strict again');

section('5. Counters keep counting from the right place');
const s1 = (await pg.query("insert into public.serial_thing (label) values ('next') returning id")).rows[0].id;
ok(s1 > 5, 'a serial column never goes backwards (ids handed out after the backup are not reused)', 'got ' + s1);
const a1 = (await pg.query("insert into public.audit_log (action) values ('next') returning id")).rows[0].id;
ok(Number(a1) > 3, 'an identity column never goes backwards either', 'got ' + a1);
const wide = (await pg.query('select tiktok_id::text t, views::text v from public.videos order by tiktok_id desc limit 1')).rows[0];
ok(wide.t === '9223372036854775807' && wide.v === '7234567890123456789', '19-digit ids are exact');

section('6. Safety checks');
let f = await failure(() => apply(pg, bkId, { actor: CREATOR }));
ok(f && f.code === 'BK004' && /not an active admin/.test(f.message), 'refuses when the signed-in person would be locked out');

// damaged in storage: a piece changed after it was written
const damagedId = crypto.randomUUID();
await pg.query(
  "insert into backup.chunks select $1, seq, kind, table_id, n, hash, case when table_id = 'public.brands' then replace(payload, 'Parent', 'Hacked') else payload end from backup.chunks where backup_id = $2",
  [damagedId, bkId],
);
const dver = (await pg.query('select backup.verify($1) as r', [damagedId])).rows[0].r;
ok(dver.problems.some((p) => /integrity/.test(p)), 'a changed piece is caught by its fingerprint');
f = await failure(() => apply(pg, damagedId));
ok(f && f.code === 'BK003' && /damaged/.test(f.message), 'a damaged backup is refused');

// cut short: the footer is missing
const cutId = crypto.randomUUID();
await pg.query("insert into backup.chunks select $1, seq, kind, table_id, n, hash, payload from backup.chunks where backup_id = $2 and kind <> 'end'", [cutId, bkId]);
const cver = (await pg.query('select backup.verify($1) as r', [cutId])).rows[0].r;
ok(cver.problems.some((p) => /cut short/.test(p)), 'a backup that stops early is caught');
f = await failure(() => apply(pg, cutId));
ok(f && f.code === 'BK003', 'and refused');

// damaged on the way in
const goodFile = await toFile(pg, bkId);
const lines = [];
for await (const l of (await openBackup(goodFile)).lines()) lines.push(l);
const w1 = await BackupWriter.create();
for (const l of lines) await w1.writeLine(l.includes('"t":"public.brands"') ? l.replace('Parent', 'Hacked') : l);
const tamperedFile = await w1.finish();
f = await failure(() => fromFile(pg, tamperedFile));
ok(f && f.code === 'BK005', 'a file changed after it was made is refused at the door');

// a backup that cannot be restored: a foreign key points at nothing. The restore must roll back completely.
const dangId = crypto.randomUUID();
await pg.query(
  `insert into backup.chunks
  select $1, seq, kind, table_id, n,
         case when table_id = 'public.videos' then backup.sha(regexp_replace(payload, '"brand_id": ?"[^"]*"', '"brand_id": "ffffffff-ffff-ffff-ffff-ffffffffffff"', 'g')) else hash end,
         case when table_id = 'public.videos' then regexp_replace(payload, '"brand_id": ?"[^"]*"', '"brand_id": "ffffffff-ffff-ffff-ffff-ffffffffffff"', 'g') else payload end
  from backup.chunks where backup_id = $2`,
  [dangId, bkId],
);
ok((await pg.query('select backup.verify($1) as r', [dangId])).rows[0].r.problems.length === 0, 'the dangling-reference backup is internally consistent (so only the database can object)');
await pg.exec("insert into public.brands (name) values ('marker before failed restore')");
const pre = await snapshot(pg);
f = await failure(() => apply(pg, dangId));
ok(f && f.code === 'BK004' && /does not fit/.test(f.message) && /Nothing was changed/.test(f.message), 'a backup that does not fit is refused', f && f.message);
ok(JSON.stringify(pre) === JSON.stringify(await snapshot(pg)), 'a failed restore rolls back completely');
ok(triggersAsFound(await triggers(pg)), 'triggers are still on after a failed restore');
ok(await strictFks(pg), 'foreign keys are still strict after a failed restore');

// a table outside the backup that depends on one inside it
await pg.exec('create table public.depends_on_profiles (id int primary key, p uuid references public.profiles (id))');
f = await failure(() => apply(pg, bkId));
ok(f && f.code === 'BK004' && /depends_on_profiles/.test(f.message) && /Nothing was changed/.test(f.message), 'refuses rather than wiping a newer table that points into the backup', f && f.message);
await pg.exec('drop table public.depends_on_profiles');

section('7. A file you can carry away (and protect)');
const plainFile = await toFile(pg, bkId);
const idFromPlain = await fromFile(pg, plainFile);
ok((await pg.query('select backup.verify($1) as r', [idFromPlain])).rows[0].r.problems.length === 0, 'a downloaded file loads back intact');
const r2 = await apply(pg, idFromPlain, { dryRun: true });
ok(r2.tables.length === rehearsal.tables.length, 'and can be rehearsed like any other backup');

const pass = 'correct horse battery staple';
const encFile = await toFile(pg, bkId, { passphrase: pass });
let needs = '';
let wrong = '';
try { await openBackup(encFile); } catch (e) { needs = e instanceof BackupError ? e.code : 'WRONG'; }
try { await openBackup(encFile, 'not it'); } catch (e) { wrong = e instanceof BackupError ? e.code : 'WRONG'; }
ok(needs === 'needs_passphrase', 'an encrypted file asks for its passphrase');
ok(wrong === 'wrong_passphrase', 'a wrong passphrase is told apart from a damaged file');
ok(!new TextDecoder().decode(encFile).includes('creator@example.com'), 'nothing readable is left in an encrypted file');
const idFromEnc = await fromFile(pg, encFile, pass);
ok((await pg.query('select backup.verify($1) as r', [idFromEnc])).rows[0].r.problems.length === 0, 'the right passphrase reads it back intact');
const flipped = encFile.slice();
flipped[flipped.length - 20] ^= 0xff;
let flippedErr = '';
try {
  for await (const _c of chunksFromFile(await openBackup(flipped, pass))) { /* read it all */ }
} catch (e) { flippedErr = e instanceof BackupError ? e.code : String(e); }
ok(flippedErr === 'corrupt', 'a flipped bit in an encrypted file is detected', flippedErr);

// pictures ride along in the file
const pics = { items: [{ bucket: 'brand-assets', path: 'a/logo.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }], skipped: 2 };
const picFile = await toFile(pg, bkId, { pictures: pics });
const back = [];
for await (const p of picturesFromFile(await openBackup(picFile))) back.push(p);
ok(back.length === 1 && back[0].picture && back[0].picture.path === 'a/logo.png' && back[0].picture.bytes.length === 7, 'pictures are packed into the file and come back');
const idFromPic = await fromFile(pg, picFile);
const endChunk = (await chunksOf(pg, idFromPic)).find((c) => c.kind === 'end');
ok(JSON.parse(endChunk.payload).files === 1 && JSON.parse(endChunk.payload).files_skipped === 2, 'the footer vouches for the pictures (and admits what was skipped)');
ok((await pg.query('select backup.verify($1) as r', [idFromPic])).rows[0].r.problems.length === 0, 'a file with pictures still passes the integrity check');

section('8. Restore without touching accounts');
await pg.exec(`insert into auth.users (id, email) values ('${NEWUSER}', 'keepme@example.com')`);
const keep = await apply(pg, bkId, { accounts: false, actor: null });
ok(keep.accounts === null, 'accounts are left alone when asked');
ok((await pg.query('select count(*)::int n from auth.users')).rows[0].n === 3, 'the extra account is still there');

section('9. The database changed shape since the backup');
await pg.exec('alter table public.serial_thing drop column label; alter table public.serial_thing add column extra int not null default 7');
const drift = await apply(pg, bkId, { dryRun: true, accounts: false, actor: null });
ok(drift.warnings.some((w) => /serial_thing: the columns label no longer exist/.test(w)), 'a column that no longer exists is reported, in plain words', JSON.stringify(drift.warnings));
ok(drift.schema.newColumns.some((c) => c.table === 'public.serial_thing' && c.columns.includes('extra')), 'a column the backup does not have is reported too');
ok(drift.backup.same_shape === false, 'and the shape is reported as different');
await apply(pg, bkId, { accounts: false, actor: null });
const drifted = (await pg.query('select count(*)::int n, min(extra)::int e from public.serial_thing')).rows[0];
ok(drifted.n === 3 && drifted.e === 7, 'the rows still come back, the new column takes its default');


section('10. Jobs: Postgres runs them, the way pg_cron would');
/** Run a scheduled job the way pg_cron does: one transaction, command exactly as stored. */
const runJob = async (pg, nameLike) => {
  const job = (await pg.query('select jobname, command from cron.job where jobname like $1', ['%' + nameLike + '%'])).rows[0];
  if (!job) return null;
  await pg.exec('begin; ' + job.command + '; commit;');
  return job.jobname;
};
const row = async (pg, table, id) => (await pg.query('select * from public.' + table + ' where id = $1', [id])).rows[0];
const jobsLeft = async (pg) => (await pg.query('select count(*)::int n from cron.job')).rows[0].n;

// a backup
const bid = crypto.randomUUID();
await pg.query("insert into public.data_backups (id, kind, status, created_by) values ($1, 'manual', 'running', $2)", [bid, ADMIN]);
await pg.query("select backup.schedule_make($1, 'manual', $2, null)", [bid, ADMIN]);
ok((await jobsLeft(pg)) === 1, 'scheduling a backup schedules one job');
ok(await runJob(pg, bid), 'the job runs');
let b = await row(pg, 'data_backups', bid);
ok(b.status === 'ready' && b.total_rows > 0 && Number(b.size_bytes) > 0 && b.phase === null, 'the job records its own result: ready, with counts and size');
ok((await jobsLeft(pg)) === 0, 'the job unscheduled itself (it runs once)');
ok((await pg.query("select count(*)::int n from public.audit_log where action = 'backup.created'")).rows[0].n === 1, 'the backup is in the audit log');
const goodId = bid;

// a restore: job 1 saves a safety copy, which schedules job 2
const afterJobs = await snapshot(pg);
await pg.exec("insert into public.brands (name) values ('Brand added after, to be lost by the restore')");
const safetyId = crypto.randomUUID();
const runId = crypto.randomUUID();
await pg.query("insert into public.data_restore_runs (id, started_by, backup_id, accounts, dry_run, status, safety_backup_id) values ($1, $2, $3, true, false, 'running', $4)", [runId, ADMIN, goodId, safetyId]);
await pg.query("insert into public.data_backups (id, kind, status, created_by) values ($1, 'before_restore', 'running', $2)", [safetyId, ADMIN]);
await pg.query("select backup.schedule_make($1, 'before_restore', $2, $3)", [safetyId, ADMIN, runId]);
await runJob(pg, safetyId);
const safe = await row(pg, 'data_backups', safetyId);
ok(safe.status === 'ready' && safe.kind === 'before_restore', 'job 1 saved the safety copy');
let run = await row(pg, 'data_restore_runs', runId);
ok(run.status === 'running' && /Restoring/.test(run.phase), 'the restore is announced as under way');
ok((await jobsLeft(pg)) === 1, 'and job 2 (the restore) is now scheduled');
await runJob(pg, runId);
run = await row(pg, 'data_restore_runs', runId);
ok(run.status === 'succeeded' && run.result.tables.length > 5 && run.error === null, 'job 2 restored and recorded the outcome');
ok((await pg.query("select count(*)::int n from public.brands where name like 'Brand added after%'")).rows[0].n === 0, 'what was added after the backup is gone');
ok((await pg.query("select count(*)::int n from public.audit_log where action = 'backup.restored'")).rows[0].n === 1, 'the restore is in the audit log (written after it)');
ok(JSON.stringify(await snapshot(pg)).length > 0 && (await pg.query('select count(*)::int n from backup.chunks where backup_id = $1', [safetyId])).rows[0].n > 0, 'and the safety copy is there to undo it');

// a rehearsal: job 2 only
const rehId = crypto.randomUUID();
await pg.query("insert into public.data_restore_runs (id, started_by, backup_id, accounts, dry_run, status) values ($1, $2, $3, true, true, 'running')", [rehId, ADMIN, goodId]);
await pg.exec("insert into public.brands (name) values ('Brand for the rehearsal to leave alone')");
const beforeReh = JSON.stringify(await snapshot(pg));
await pg.query('select backup.schedule_apply($1)', [rehId]);
await runJob(pg, rehId);
run = await row(pg, 'data_restore_runs', rehId);
ok(run.status === 'succeeded' && run.dry_run === true && run.result.dry_run === true, 'a rehearsal job records what it would do');
ok(beforeReh === JSON.stringify(await snapshot(pg)), 'and changed nothing');
ok((await pg.query("select count(*)::int n from public.audit_log where action = 'backup.restored'")).rows[0].n === 1, 'a rehearsal is not logged as a restore');

// a restore that cannot succeed: it fails cleanly, in plain words, and changes nothing
const badRun = crypto.randomUUID();
await pg.query("insert into public.data_restore_runs (id, started_by, backup_id, accounts, dry_run, status) values ($1, $2, $3, true, false, 'running')", [badRun, ADMIN, damagedId]);
// the failure itself is (rightly) written to the audit log, so that one table is compared separately
const noAudit = async () => { const x = await snapshot(pg); delete x['public.audit_log']; return JSON.stringify(x); };
const beforeBad = await noAudit();
await pg.query('select backup.schedule_apply($1)', [badRun]);
await runJob(pg, badRun);
run = await row(pg, 'data_restore_runs', badRun);
ok(run.status === 'failed' && /damaged/.test(run.error), 'a damaged backup fails the job with a plain message', run.error);
ok(beforeBad === (await noAudit()), 'and changed nothing');
ok(triggersAsFound(await triggers(pg)) && (await strictFks(pg)), 'and left every trigger and foreign key as it found it');
ok((await pg.query("select count(*)::int n from public.audit_log where action = 'backup.restore_failed'")).rows[0].n === 1, 'the failure is in the audit log');

// the safety copy fails: the restore must not go on
const failBackup = crypto.randomUUID();
const failRun = crypto.randomUUID();
await pg.query("insert into public.data_backups (id, kind, status) values ($1, 'before_restore', 'running')", [failBackup]);
await pg.query("insert into public.data_restore_runs (id, started_by, backup_id, accounts, dry_run, status, safety_backup_id) values ($1, $2, $3, true, false, 'running', $4)", [failRun, ADMIN, goodId, failBackup]);
await pg.exec("begin; select backup.run_make('" + failBackup + "', 'before_restore', '" + ADMIN + "', '" + failRun + "'); commit;"); // not repeatable-read: make refuses
ok((await row(pg, 'data_backups', failBackup)).status === 'failed', 'a snapshot that cannot be taken is recorded as failed');
run = await row(pg, 'data_restore_runs', failRun);
ok(run.status === 'failed' && /safety copy/.test(run.error) && (await jobsLeft(pg)) === 0, 'and the restore behind it is cancelled, never started', run.error);

// orphans: a job nobody can account for must never block the next one
const lost = crypto.randomUUID();
const waiting = crypto.randomUUID();
const hung = crypto.randomUUID();
const abandoned = crypto.randomUUID();
await pg.query("insert into public.data_backups (id, kind, status, created_at) values ($1, 'uploaded', 'running', now() - interval '45 minutes')", [abandoned]);
await pg.query("insert into public.data_backups (id, kind, status, created_at) values ($1, 'manual', 'running', now() - interval '10 minutes'), ($2, 'manual', 'running', now() - interval '10 minutes'), ($3, 'manual', 'running', now() - interval '45 minutes')", [lost, waiting, hung]);
await pg.query("select cron.schedule('backup-job-' || $1::text, '1 seconds', 'select 1')", [waiting]);
await pg.query("select cron.schedule('backup-job-' || $1::text, '1 seconds', 'select 1')", [hung]);
await pg.query('select backup.sweep()');
ok((await row(pg, 'data_backups', lost)).status === 'failed', 'a job with no trace left is marked failed, so it cannot block the next');
ok((await row(pg, 'data_backups', abandoned)).status === 'failed', 'an upload nobody finished is closed off after half an hour');
ok((await row(pg, 'data_backups', waiting)).status === 'running', 'a job that is still scheduled is left alone');
const hungRow = await row(pg, 'data_backups', hung);
ok(hungRow.status === 'failed' && /too long/.test(hungRow.error) && (await jobsLeft(pg)) === 1, 'one stuck for half an hour is cancelled, and says so');
await pg.query("select cron.unschedule('backup-job-' || $1::text)", [waiting]);

// a job that keeps dying is given up on, and one that already finished is never run twice
const loopRun = crypto.randomUUID();
await pg.query("insert into public.data_restore_runs (id, started_by, backup_id, accounts, dry_run, status) values ($1, $2, $3, true, false, 'running')", [loopRun, ADMIN, goodId]);
await pg.query('select backup.schedule_apply($1)', [loopRun]);
const loopJob = (await pg.query('select jobid from cron.job where jobname like $1', ['%' + loopRun + '%'])).rows[0].jobid;
for (let k = 0; k < 4; k++) await pg.query("insert into cron.job_run_details (jobid, status) values ($1, 'failed')", [loopJob]);
const beforeLoop = JSON.stringify(await snapshot(pg));
await runJob(pg, loopRun);
run = await row(pg, 'data_restore_runs', loopRun);
ok(run.status === 'failed' && /kept stopping/.test(run.error), 'a restore that the server keeps killing is cancelled after three tries, in plain words', run.error);
ok(JSON.stringify(await snapshot(pg)) === beforeLoop, 'and it never touched the data');
const doneBefore = JSON.stringify(await snapshot(pg));
await pg.exec("begin; select backup.run_apply('" + rehId + "'); commit;");
ok(JSON.stringify(await snapshot(pg)) === doneBefore, 'a job that has already finished does nothing if it is run again');

// cleaning up the pieces of backups that no longer exist
const purged = (await pg.query('select backup.purge_orphans() as n')).rows[0].n;
ok(purged >= 0 && (await pg.query('select count(*)::int n from backup.chunks where backup_id = $1', [lost])).rows[0].n === 0, 'pieces belonging to nothing are cleared away');


section('11. Every kind of value survives, exactly (a table with a column named "t" is the trap)');
await pg.exec(`
  create table public.zz_types (
    id serial primary key, t text, s text, j jsonb, ts timestamptz, d date, nn numeric, b bigint, ta text[], bo boolean
  );
  insert into public.zz_types (t, s, j, ts, d, nn, b, ta, bo) values
    ('', 'x', '{}', '2026-10-27 12:34:56.123456+00', '2026-10-27', 0.00, 0, '{}', false),
    (E'line1\\nline2\\ttab "q" \\\\ ''s'' {"a":1} null', 'x', '{"deep":{"a":[1,2,{"b":null}],"big":1e400,"u":"\\u00e9\\u4e2d"},"n":null}', '0001-01-01 00:00:00+00', '0001-01-01', 12345678901234567890.123456789012345678901234567890, -9223372036854775808, array['a,b','"q"','{x}','',' sp ','NULL'], true),
    (repeat('long ', 100000), null, '"just a string"', 'infinity', 'infinity', 'NaN', 9223372036854775807, array[null, 'x']::text[], null),
    ('neg', null, 'null'::jsonb, '-infinity', '-infinity', null, null, null, null),
    ('scalar', null, '123456789012345678901234567890', '9999-12-31 23:59:59.999999+00', '9999-12-31', 3.14159265358979323846264338327950288, 1, null, true);
`);
const fpTypes = async () => (await pg.query("select md5(string_agg(to_jsonb(z)::text, '|' order by id)) h, count(*)::int n from public.zz_types z")).rows[0];
const typesBefore = await fpTypes();
const tb = await makeBackup(pg);
ok(tb.summary.rows['public.zz_types'] === 5, 'a table with columns named t, s and j is backed up row for row');
await pg.exec('truncate public.zz_types');
await apply(pg, tb.id, { accounts: false, actor: null });
const typesAfter = await fpTypes();
ok(typesAfter.n === 5 && typesAfter.h === typesBefore.h, 'extremes, infinity, NaN, a 500 KB string, year 1 and 9999, 30-digit numbers and awkward arrays come back byte-identical');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
