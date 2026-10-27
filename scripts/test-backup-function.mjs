/**
 * Drives the `backup-data` Edge Function over HTTP, exactly the way the admin
 * screen does (it even uses the screen's own download and upload code, from
 * src/lib/backup/client.ts), against a LOCAL Supabase:
 *
 *   supabase start
 *   supabase functions serve backup-data
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_ANON_KEY=... \
 *   pnpm test:backup:function
 *
 * Proves who may call it, the password and confirmation gates, and the whole
 * life of a backup: create, download (encrypted, with pictures), rehearse,
 * restore, undo, bring in from a file, refuse a damaged file, delete.
 * REFUSES to run against anything but localhost.
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { BackupError, openBackup } from '../src/lib/backup/format.ts';
import { downloadBackupFile, uploadBackupFile, restorePicturesFromFile } from '../src/lib/backup/client.ts';

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY } = process.env;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
  console.error('Set DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY.');
  process.exit(2);
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL) || !/(127\.0\.0\.1|localhost)/.test(SUPABASE_URL)) {
  console.error('Refusing: this is not a local stack.');
  process.exit(2);
}

// When the local Edge Runtime retires a worker in the middle of an answer, a BROWSER gets an ordinary
// "failed to fetch" error (which the screen's retry handles). Node's HTTP library instead throws an
// assertion that nothing can catch. Swallow just that one, count it, and let the timeout on each
// request turn it into the same ordinary failure, so this test exercises the retry like a browser would.
let cutResponses = 0;
process.on('uncaughtException', (e) => {
  if (e && e.code === 'ERR_ASSERTION') {
    cutResponses++;
    return;
  }
  console.error(e);
  process.exit(1);
});

let failed = 0;
const ok = (c, name, extra = '') => {
  if (c) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};
const section = (s) => console.log('\n' + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const FN = SUPABASE_URL + '/functions/v1/backup-data';
const PASS = 'correct horse battery 42';
const stamp = Date.now();
// Inside the local Docker network the function sees the API as http://kong:8000. A hosted project hands out a public address.
const reach = (u) => String(u).replace('http://kong:8000', SUPABASE_URL);

async function makeUser(email, role) {
  const { data, error } = await sb.auth.admin.createUser({ email, password: PASS, email_confirm: true });
  if (error) throw new Error(error.message);
  await sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await tx.unsafe(`update public.profiles set role = $2::public.app_role where id = $1`, [data.user.id, role]);
  });
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password: PASS });
  if (e2) throw new Error(e2.message);
  return { id: data.user.id, email, token: s.session.access_token };
}

/** The raw door: always resolves with the status and body. */
async function raw(who, body) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, ...(who ? { authorization: 'Bearer ' + who.token } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  let json = {};
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, ...json };
}
/** The screen's door: throws the server's own words when it refuses. */
const doorFor = (who) => async (body) => {
  const r = await raw(who, body);
  if (r.status >= 400) throw Object.assign(new Error(r.error ?? 'failed'), { status: r.status });
  const { status: _s, ...rest } = r;
  return rest;
};

async function waitFor(fn, label, ms = 120_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + label);
    await sleep(800);
  }
}
const backupRow = async (admin, id) => (await raw(admin, { action: 'backup.list' })).backups?.find((b) => b.id === id);
const restoreRow = async (admin, id) => (await raw(admin, { action: 'backup.list' })).restores?.find((r) => r.id === id);
const finished = (admin, id) => waitFor(async () => { const r = await backupRow(admin, id); return r && r.status !== 'running' ? r : null; }, 'a backup');
const finishedRestore = (admin, id) => waitFor(async () => { const r = await restoreRow(admin, id); return r && r.status !== 'running' ? r : null; }, 'a restore');
const chunkCount = async (id) => (await sql.unsafe(`select count(*)::int n from backup.chunks where backup_id = $1::uuid`, [id]))[0].n;

// ---------------------------------------------------------------- the people --
section('Setting up an admin, an ops user and a creator');
const admin = await makeUser(`fn-admin-${stamp}@example.com`, 'admin');
const ops = await makeUser(`fn-ops-${stamp}@example.com`, 'ops');
const creator = await makeUser(`fn-creator-${stamp}@example.com`, 'creator');
const adminCall = doorFor(admin);
const B1 = crypto.randomUUID();
await sql.begin(async (tx) => {
  await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await tx.unsafe(`insert into public.brands (id, name, slug, store_id) values ($1, 'Function Test Brand', $2, $3)`, [B1, `fn-${stamp}`, `fn-store-${stamp}`]);
});
await sb.storage.from('brand-assets').upload(`fn-test-${stamp}/logo.png`, new Uint8Array([137, 80, 78, 71, 9, 8, 7]), { contentType: 'image/png', upsert: true });

section('1. Who may call it');
ok((await raw(null, { action: 'backup.list' })).status === 401, 'nobody signed in: refused (401)');
ok((await raw(creator, { action: 'backup.list' })).status === 403, 'a creator: refused (403)');
ok((await raw(ops, { action: 'backup.list' })).status === 403, 'ops is refused too: backups are admin only (403)');
ok((await raw(admin, { action: 'backup.list' })).status === 200, 'an admin: allowed');
ok((await raw(admin, { action: 'nope' })).status === 400, 'an unknown action is rejected');
ok((await sql.unsafe(`select count(*)::int n from public.audit_log where action = 'backup.denied'`))[0].n >= 2, 'refused attempts are written to the audit log');

section('1b. Nobody else can reach the backup tables');
const asCreator = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + creator.token } }, auth: { persistSession: false } });
const peekReg = await asCreator.from('data_backups').select('id').limit(1);
ok(!peekReg.data || peekReg.data.length === 0, 'a signed-in creator reads nothing from the list of backups');
const peekRuns = await asCreator.from('data_restore_runs').select('id').limit(1);
ok(!peekRuns.data || peekRuns.data.length === 0, 'nor the list of restores');
const peekChunks = await asCreator.schema('backup').from('chunks').select('seq').limit(1);
ok(Boolean(peekChunks.error) || !peekChunks.data || peekChunks.data.length === 0, 'nor the data of any backup');
const anonCall = await createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } }).rpc('backup_make');
ok(Boolean(anonCall.error), 'and the backup functions cannot be called from outside');

section('2. Make a backup');
const made = await raw(admin, { action: 'backup.create', note: 'first test' });
ok(made.status === 202 && made.backupId, 'creating answers at once with an id (202)');
const second = await raw(admin, { action: 'backup.create' });
ok(second.status === 409, 'a second backup while one runs is refused (409)', JSON.stringify(second));
const row1 = await finished(admin, made.backupId);
ok(row1.status === 'ready', 'the backup finishes ready', row1.error ?? '');
ok(row1.size_bytes > 1000 && row1.total_rows > 0, `it has a size and rows (${row1.size_bytes} bytes, ${row1.total_rows} rows)`);
ok(row1.row_counts['wurxbase.creators'] !== undefined && row1.row_counts['auth.users'] > 0, 'Paid Collabs tables and the accounts are counted');
ok(row1.note === 'first test' && row1.created_by_email === admin.email, 'note and author recorded');
ok((await chunkCount(made.backupId)) > 2, 'the data is stored in the database');

section('3. Download it (password again, passphrase, pictures)');
ok((await raw(admin, { action: 'backup.download_start', backupId: made.backupId, password: 'wrong' })).status === 403, 'a wrong password is refused');
ok((await raw(admin, { action: 'backup.chunks', backupId: made.backupId, ticket: 'a'.repeat(64), afterSeq: 0 })).status === 403, 'pages cannot be fetched without the ticket the password check hands out');
const dl = await downloadBackupFile(adminCall, { backupId: made.backupId, password: PASS, passphrase: 'a long secret phrase', withPictures: true, fetcher: (u, signal) => fetch(reach(u), { signal }) });
ok(dl.bytes.length > 1000 && dl.filename.endsWith('.prismbackup'), `the file is built (${dl.bytes.length} bytes)`);
ok(dl.pictures.count >= 1, 'pictures are packed in (' + dl.pictures.count + ')');
let needs = '';
try { await openBackup(dl.bytes); } catch (e) { needs = e instanceof BackupError ? e.code : String(e); }
ok(needs === 'needs_passphrase', 'the file cannot be read without its passphrase');
ok(!Buffer.from(dl.bytes).includes('fn-admin-'), 'and nothing readable is in it');
const plain = await downloadBackupFile(adminCall, { backupId: made.backupId, password: PASS, withPictures: false });
ok((await openBackup(plain.bytes)).header.encrypted === false, 'a file can also be made without a passphrase');
ok((await sql.unsafe(`select count(*)::int n from public.audit_log where action = 'backup.downloaded'`))[0].n >= 2, 'downloads are in the audit log');

section('4. Rehearse a restore');
await sql.begin(async (tx) => {
  await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await tx.unsafe(`delete from public.brands where id = $1`, [B1]);
});
const reh = await raw(admin, { action: 'backup.restore', backupId: made.backupId, dryRun: true });
ok(reh.status === 202 && reh.restoreId, 'a rehearsal starts (202) and needs no password');
const rehRow = await finishedRestore(admin, reh.restoreId);
ok(rehRow.status === 'succeeded' && rehRow.dry_run === true, 'the rehearsal succeeds', rehRow.error ?? '');
ok(rehRow.result.tables.length > 50 && rehRow.result.backup.total_rows === row1.total_rows, 'it reports every table');
ok(rehRow.safety_backup_id === null, 'a rehearsal does not make a safety copy');
ok((await sql.unsafe(`select count(*)::int n from public.brands where id = $1`, [B1]))[0].n === 0, 'a rehearsal changed nothing');

section('5. Restore for real (the gates)');
const base = { action: 'backup.restore', backupId: made.backupId, dryRun: false };
ok((await raw(admin, { ...base, password: PASS })).status === 400, 'no confirmation word: refused');
ok((await raw(admin, { ...base, confirm: 'restore', password: PASS })).status === 400, 'the wrong word (lower case): refused');
ok((await raw(admin, { ...base, confirm: 'RESTORE' })).status === 400, 'no password: refused');
ok((await raw(admin, { ...base, confirm: 'RESTORE', password: 'nope' })).status === 403, 'wrong password: refused');
ok((await raw(ops, { ...base, confirm: 'RESTORE', password: PASS })).status === 403, 'ops cannot restore');

section('6. Restore for real');
const real = await raw(admin, { ...base, confirm: 'RESTORE', password: PASS });
ok(real.status === 202, 'a real restore starts');
const realRow = await finishedRestore(admin, real.restoreId);
ok(realRow.status === 'succeeded' && realRow.dry_run === false, 'the restore succeeds', realRow.error ?? '');
const back = await sql.unsafe(`select name from public.brands where id = $1`, [B1]);
ok(back.length === 1 && back[0].name === 'Function Test Brand', 'the deleted brand is back');
ok(Boolean(realRow.safety_backup_id), 'a safety copy of the data from before was saved');
const safety = await backupRow(admin, realRow.safety_backup_id);
ok(safety && safety.status === 'ready' && safety.kind === 'before_restore', 'the safety copy is ready and labelled');
ok(Boolean(await backupRow(admin, made.backupId)), 'the list of backups survived the restore (the backup you restored from is still there)');
ok((await sql.unsafe(`select count(*)::int n from public.audit_log where action = 'backup.restored'`))[0].n >= 1, 'the restore is in the audit log (written after it)');
ok((await raw(admin, { action: 'backup.list' })).status === 200, 'the admin is still signed in and allowed afterwards');

section('7. Undo it with the safety copy');
await sql.begin(async (tx) => {
  await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
  await tx.unsafe(`delete from public.brands where id = $1`, [B1]);
});
const undo = await raw(admin, { action: 'backup.restore', backupId: realRow.safety_backup_id, dryRun: false, confirm: 'RESTORE', password: PASS });
const undoRow = await finishedRestore(admin, undo.restoreId);
ok(undoRow.status === 'succeeded', 'restoring the safety copy works too', undoRow.error ?? '');
ok((await sql.unsafe(`select count(*)::int n from public.brands where id = $1`, [B1]))[0].n === 0, 'and puts everything back the way it was just before the restore (the brand is deleted again)');

section('8. Bring a backup in from a file on the computer');
const up = await uploadBackupFile(adminCall, dl.bytes, 'a long secret phrase');
ok(up.backupId && up.totalRows === row1.total_rows, 'an encrypted file goes up and is checked (' + up.totalRows + ' rows)');
const upRow = await backupRow(admin, up.backupId);
ok(upRow.kind === 'uploaded' && upRow.status === 'ready', 'it appears in the list as brought in');
const reh2 = await raw(admin, { action: 'backup.restore', backupId: up.backupId, dryRun: true });
const reh2Row = await finishedRestore(admin, reh2.restoreId);
ok(reh2Row.status === 'succeeded', 'and can be rehearsed like any other backup');
await sb.storage.from('brand-assets').remove([`fn-test-${stamp}/logo.png`]);
const putSigned = async (bucket, path, token, bytes, type) => !(await sb.storage.from(bucket).uploadToSignedUrl(path, token, bytes, { contentType: type })).error;
const pics = await restorePicturesFromFile(adminCall, putSigned, dl.bytes, 'a long secret phrase');
ok(pics.restored >= 1 && pics.failed.length === 0, 'the pictures in the file are put back', JSON.stringify(pics));
ok(!(await sb.storage.from('brand-assets').download(`fn-test-${stamp}/logo.png`)).error, 'the picture is in Storage again');

let wrongPass = '';
try { await uploadBackupFile(adminCall, dl.bytes, 'not the passphrase'); } catch (e) { wrongPass = e instanceof BackupError ? e.code : String(e); }
ok(wrongPass === 'wrong_passphrase', 'a wrong passphrase is refused before anything is sent');
let notBackup = '';
try { await uploadBackupFile(adminCall, new TextEncoder().encode('this is not a backup\nat all'), null); } catch (e) { notBackup = e instanceof BackupError ? e.code : String(e); }
ok(notBackup === 'not_a_backup', 'a file that is not a backup is refused');

// a file changed after it was made: refused by the database, and nothing is left behind
const lines = [];
for await (const l of (await openBackup(plain.bytes)).lines()) lines.push(l);
const { BackupWriter } = await import('../src/lib/backup/format.ts');
const w = await BackupWriter.create();
for (const l of lines) await w.writeLine(l.includes('"t":"public.profiles"') ? l.replace('"role": "admin"', '"role": "ADMINX"') : l);
const before = (await sql.unsafe(`select count(distinct backup_id)::int n from backup.chunks`))[0].n;
let tampered = '';
try { await uploadBackupFile(adminCall, await w.finish(), null); } catch (e) { tampered = e.message; }
ok(/damaged on the way/.test(tampered), 'a file changed after it was made is refused by the database', tampered);
ok((await sql.unsafe(`select count(distinct backup_id)::int n from backup.chunks`))[0].n === before, 'and no half-loaded copy is left behind');

section('9. Delete');
const del = await raw(admin, { action: 'backup.delete', backupId: up.backupId });
ok(del.status === 200 && !(await backupRow(admin, up.backupId)), 'a backup can be deleted');
ok((await chunkCount(up.backupId)) === 0, 'and its data is removed too');
ok((await raw(admin, { action: 'backup.delete', backupId: crypto.randomUUID() })).status === 404, 'deleting something that is not there says so');

await sb.storage.from('brand-assets').remove([`fn-test-${stamp}/logo.png`]);
await sql.end({ timeout: 5 });
if (cutResponses) console.log(`\n(${cutResponses} answer(s) were cut off by the local runtime and recovered by the automatic retry)`);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll function checks passed.');
process.exit(failed ? 1 : 0);
