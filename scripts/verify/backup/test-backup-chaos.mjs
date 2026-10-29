/**
 * CRASH AND CHAOS QA for backup and restore, on a REAL local Supabase. The point of it is that
 * nothing can ever be lost: sessions are killed in the middle of a restore and of a backup,
 * writes arrive while a snapshot is taken, the same backup is restored twice, and a restore is
 * undone with its own safety copy. Needs `supabase start` (pg_cron and Auth are real here).
 *
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_KEY=<service role key> \
 *   pnpm test:backup:chaos
 *
 * REFUSES to run against anything but localhost. It kills sessions and wipes tables.
 */
import postgres from 'postgres';

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(2);
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL)) {
  console.error('Refusing: DATABASE_URL is not localhost. This test kills sessions and wipes tables.');
  process.exit(2);
}
const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SERVICE = SUPABASE_SERVICE_KEY;
let failed = 0;
const ok = (c, n, x = '') => { if (c) console.log('  ok   ' + n); else { failed++; console.log('  FAIL ' + n + (x ? ' -> ' + x : '')); } };
const svc = (tx) => tx.unsafe(`select set_config('request.jwt.claims','{"role":"service_role"}',true)`);
const stamp = Date.now();

async function fingerprints() {
  const tables = (await sql.unsafe(`select jsonb_array_elements(backup.introspect(true)) as t`)).map((r) => r.t);
  const out = {};
  for (const t of tables) {
    const r = await sql.unsafe(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) as h, count(*)::int as n from "${t.schema}"."${t.name}" x`);
    out[t.id] = r[0].n + ':' + r[0].h;
  }
  return out;
}
const state = async () => ({
  triggersOff: (await sql.unsafe(`select count(*)::int n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and t.tgenabled <> 'O' and n.nspname in ('public','wurxbase')`))[0].n,
  looseFks: (await sql.unsafe(`select count(*)::int n from pg_constraint where contype='f' and (condeferrable or condeferred) and connamespace in ('public'::regnamespace,'wurxbase'::regnamespace)`))[0].n,
});
async function waitJob(pattern, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await sql.unsafe(`select pid from pg_stat_activity where application_name='pg_cron' and query like $1 and state = 'active' limit 1`, ['%' + pattern + '%']);
    if (r.length) return r[0].pid;
    if (Date.now() > end) return null;
    await sleep(120);
  }
}
const runStatus = async (id) => (await sql.unsafe(`select status, phase, left(error, 200) as error from public.data_restore_runs where id = $1`, [id]))[0];
const bkStatus = async (id) => (await sql.unsafe(`select status, left(error, 200) as error from public.data_backups where id = $1`, [id]))[0];
async function untilDone(fn, secs = 120) { for (let k = 0; k < secs; k++) { const r = await fn(); if (r.status !== 'running') return r; await sleep(1000); } return null; }
const newRun = async (bk) => (await sql.unsafe(`insert into public.data_restore_runs (backup_id, accounts, dry_run, status, phase) values ($1, true, false, 'running', 'Restoring') returning id`, [bk]))[0].id;
const newBackup = async (kind = 'manual') => (await sql.unsafe(`insert into public.data_backups (kind, status) values ($1, 'running') returning id`, [kind]))[0].id;

(async () => {
  console.log('\nSeeding: two accounts, brands, and 400,000 ad rows so a restore takes long enough to interrupt');
  for (const who of ['admin', 'creator']) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SERVICE, authorization: 'Bearer ' + SERVICE }, body: JSON.stringify({ email: `crash-${who}-${stamp}@example.com`, password: 'correct horse battery 42', email_confirm: true }) });
    if (!r.ok) throw new Error('could not create an account');
  }
  await sql.unsafe(`truncate public.euka_ad_video_day`);
  await sql.begin(async (tx) => {
    await svc(tx);
    await tx.unsafe(`insert into public.brands (name, slug, store_id) values ('Crash Brand A', 'crash-a-${stamp}', 'crash-a-${stamp}'), ('Crash Brand B', 'crash-b-${stamp}', 'crash-b-${stamp}')`);
    await tx.unsafe(`insert into public.euka_ad_video_day (item_id, day, store_id, advertiser_id, campaign_id, cost, orders, gross_revenue, currency) select (7000000000000000000 + i)::text, date '2025-01-01' + (i % 365), 'store-'||(i%50), 'adv-'||(i%10), 'camp-'||(i/1000), round((random()*100)::numeric,2), (random()*10)::int, round((random()*500)::numeric,2), 'USD' from generate_series(1,400000) i`);
  });

  const bk = await newBackup();
  await sql.unsafe(`select backup.schedule_make($1::uuid, 'manual', null, null)`, [bk]);
  const made = await untilDone(() => bkStatus(bk));
  ok(made && made.status === 'ready', 'a backup made by the real scheduler finishes ready', JSON.stringify(made));
  const atBackup = await fingerprints();

  // the live data moves on: this is what a restore would discard
  await sql.begin(async (tx) => { await svc(tx); await tx.unsafe(`insert into public.brands (name, slug, store_id) values ('Added AFTER the backup', 'after-${stamp}', 'after-${stamp}')`); await tx.unsafe(`delete from public.euka_ad_video_day`); });
  const live = await fingerprints();
  ok(JSON.stringify(live) !== JSON.stringify(atBackup), 'the live data now differs from the backup (a restore would change it)');

  console.log('\nA. Kill the restore in the middle (and stop the retry, to look at the aftermath)');
  const run = await newRun(bk);
  await sql.unsafe(`select backup.schedule_apply($1::uuid)`, [run]);
  const pid = await waitJob(run);
  ok(pid, 'the restore runs as its own database session (pid ' + pid + ')');
  await sleep(2500);
  ok((await sql.unsafe(`select pg_terminate_backend($1::int) as k`, [pid]))[0].k, 'the session is killed mid-restore (as a crash, a restart or a timeout would)');
  await sql.unsafe(`select cron.unschedule(jobname) from cron.job where jobname like $1`, ['%' + run + '%']);
  await sleep(1500);
  const afterKill = await fingerprints();
  const diff = Object.keys(live).filter((k) => live[k] !== afterKill[k]);
  ok(diff.length === 0, 'EVERY table is exactly as it was before the restore started: nothing lost, nothing half-done', diff.join(', '));
  ok(JSON.stringify(await state()) === JSON.stringify({ triggersOff: 0, looseFks: 0 }), 'no trigger left switched off and no foreign key left loosened');
  await sql.unsafe(`update public.data_restore_runs set started_at = now() - interval '5 minutes' where id = $1`, [run]);
  await sql.unsafe(`select backup.sweep()`);
  const swept = await runStatus(run);
  ok(swept.status === 'failed' && /stopped|Nothing was changed/i.test(swept.error), 'the abandoned run is closed off as failed, in plain words, so it cannot block the next', JSON.stringify(swept));

  console.log('\nA2. Kill the restore and LET pg_cron retry: an interrupted restore completes, whole');
  const run2 = await newRun(bk);
  await sql.unsafe(`select backup.schedule_apply($1::uuid)`, [run2]);
  const pid2 = await waitJob(run2);
  await sleep(2500);
  await sql.unsafe(`select pg_terminate_backend($1::int)`, [pid2]);
  const fin = await untilDone(() => runStatus(run2), 150);
  ok(fin && fin.status === 'succeeded', 'pg_cron started the restore again by itself and it finished', JSON.stringify(fin));
  const restored = await fingerprints();
  ok(Object.keys(atBackup).every((k) => atBackup[k] === restored[k]), 'and every table is exactly the backup (including all 400,000 ad rows)');
  ok((await sql.unsafe(`select count(*)::int n from cron.job where jobname like $1`, ['%' + run2 + '%']))[0].n === 0, 'the job is gone from the schedule afterwards');
  ok(JSON.stringify(await state()) === JSON.stringify({ triggersOff: 0, looseFks: 0 }), 'with every trigger on and every foreign key strict');

  console.log('\nB. Kill a backup in the middle of its snapshot');
  const bk2 = await newBackup();
  await sql.unsafe(`select backup.schedule_make($1::uuid, 'manual', null, null)`, [bk2]);
  const pidB = await waitJob(bk2, 30000);
  ok(pidB, 'the backup runs as its own database session');
  await sleep(1500);
  await sql.unsafe(`select pg_terminate_backend($1::int)`, [pidB]);
  const b2 = await untilDone(() => bkStatus(bk2), 90);
  ok(b2 && b2.status === 'ready', 'after the kill, pg_cron ran the backup again and it finished ready', JSON.stringify(b2));
  const v2 = (await sql.unsafe(`select backup.verify($1::uuid) as r`, [bk2]))[0].r;
  ok(v2.problems.length === 0, 'with exactly one whole, valid set of pieces (never a half-written one)', v2.problems.join('; '));

  console.log('\nC. Writes arriving WHILE a backup is taken still give a consistent backup');
  const bk3 = await newBackup();
  await sql.unsafe(`select backup.schedule_make($1::uuid, 'manual', null, null)`, [bk3]);
  const pid3 = await waitJob(bk3, 30000);
  let writes = 0;
  while ((await sql.unsafe(`select 1 from pg_stat_activity where application_name='pg_cron' and query like $1 and state='active'`, ['%' + bk3 + '%'])).length) {
    await sql.begin(async (tx) => { await svc(tx); await tx.unsafe(`insert into public.brands (name, slug, store_id) values ('Written during backup', 'during-' || gen_random_uuid(), 'during-' || gen_random_uuid())`); });
    writes++;
    await sleep(40);
  }
  ok(pid3 && writes > 0, 'rows were being written while the snapshot ran (' + writes + ' writes)');
  const b3 = await untilDone(() => bkStatus(bk3), 30);
  ok(b3 && b3.status === 'ready', 'the backup still finished ready', JSON.stringify(b3));
  const v3 = (await sql.unsafe(`select backup.verify($1::uuid) as r`, [bk3]))[0].r;
  ok(v3.problems.length === 0, 'and passes its own integrity check');
  const reh = (await sql.unsafe(`select backup.apply($1::uuid, true, true, null) as r`, [bk3]))[0].r;
  ok(reh.dry_run && reh.tables.length > 50, 'and it fits together: every foreign key holds when it is rehearsed (' + reh.tables.length + ' tables)');

  console.log('\nD. Restoring the same backup twice gives the same data');
  await sql.unsafe(`select backup.apply($1::uuid, true, false, null)`, [bk]);
  const fp1 = await fingerprints();
  await sql.unsafe(`select backup.apply($1::uuid, true, false, null)`, [bk]);
  const fp2 = await fingerprints();
  ok(JSON.stringify(fp1) === JSON.stringify(fp2), 'two restores of one backup leave identical data');
  ok(Object.keys(atBackup).every((k) => atBackup[k] === fp2[k]), 'identical to the original backup point');

  console.log('\nE. Undo: the safety copy brings back what a restore threw away');
  await sql.begin(async (tx) => { await svc(tx); await tx.unsafe(`insert into public.brands (name, slug, store_id) values ('Precious new brand', 'precious-${stamp}', 'precious-${stamp}')`); });
  // the safety copy is taken right before the restore, exactly as the feature does it
  const safety = await newBackup('before_restore');
  await sql.begin('isolation level repeatable read', async (tx) => { await tx.unsafe(`select backup.run_make($1::uuid, 'before_restore', null, null)`, [safety]); });
  ok((await bkStatus(safety)).status === 'ready', 'a safety copy is saved');
  await sql.unsafe(`select backup.apply($1::uuid, true, false, null)`, [bk]);
  const gone = (await sql.unsafe(`select count(*)::int n from public.brands where slug='precious-${stamp}'`))[0].n;
  await sql.unsafe(`select backup.apply($1::uuid, true, false, null)`, [safety]);
  const back = (await sql.unsafe(`select count(*)::int n from public.brands where slug='precious-${stamp}'`))[0].n;
  ok(gone === 0 && back === 1, 'something added after a backup is removed by restoring it, and is brought back by restoring the safety copy');

  await sql.end();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll crash and chaos checks passed.');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
