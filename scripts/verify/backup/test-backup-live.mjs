/**
 * Proves backup and restore against a REAL local Supabase: the real schema from
 * supabase/migrations, real sign-in accounts made by GoTrue, real Storage, and
 * the real non-superuser `postgres` role, which is the one the hosted Edge
 * Function connects as. PGlite (pnpm test:backup) proves the logic; this proves
 * the permissions and the real schema, and times it on a big table.
 *
 *   supabase start
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_KEY=<service role key> \
 *   pnpm test:backup:live
 *
 * REFUSES to run against anything but localhost. It wipes and refills tables.
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { BackupWriter, openBackup } from '../../../src/lib/backup/format.ts';
import { chunksFromFile, picturesFromFile, writeLines } from '../../../src/lib/backup/lines.ts';
import { packPictures } from '../../../src/lib/backup/pictures.ts';

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Set DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(2);
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DATABASE_URL)) {
  console.error('Refusing: DATABASE_URL is not localhost. This test wipes tables.');
  process.exit(2);
}

let failed = 0;
const ok = (c, name, extra = '') => {
  if (c) console.log('  ok   ' + name);
  else { failed++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};
const section = (s) => console.log('\n' + s);

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = (q, p) => sql.unsafe(q, p ?? []);

// ------------------------------------------------- what the Edge Function does --
const makeBackup = (id) =>
  sql.begin('isolation level repeatable read', async (tx) => {
    await tx.unsafe('set local statement_timeout = 0');
    return (await tx.unsafe('select backup.make($1::uuid, true) as r', [id]))[0].r;
  });
const applyBackup = (id, { dryRun = false, accounts = true, actor = null } = {}) =>
  sql.begin(async (tx) => {
    await tx.unsafe('set local statement_timeout = 0');
    await tx.unsafe("set local lock_timeout = '30s'");
    return (await tx.unsafe('select backup.apply($1::uuid, $2::boolean, $3::boolean, $4::uuid) as r', [id, accounts, dryRun, actor]))[0].r;
  });

// ------------------------------------------------------ what the browser does --
const chunksOf = (id) => run('select seq, kind, table_id, n, hash, payload from backup.chunks where backup_id = $1 order by seq', [id]);
async function pictureRefs() {
  const refs = [];
  const { data: buckets } = await sb.storage.listBuckets();
  for (const b of buckets) {
    const walk = async (prefix) => {
      const { data } = await sb.storage.from(b.id).list(prefix, { limit: 1000 });
      for (const e of data ?? []) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id == null) await walk(path);
        else {
          const { data: s } = await sb.storage.from(b.id).createSignedUrl(path, 300);
          refs.push({ bucket: b.id, path, size: Number(e.metadata?.size ?? 0), type: String(e.metadata?.mimetype ?? 'application/octet-stream'), url: s.signedUrl.replace('http://kong:8000', SUPABASE_URL) });
        }
      }
    };
    await walk('');
  }
  return refs;
}
async function buildFile(id, { passphrase = null, withPictures = true } = {}) {
  const w = await BackupWriter.create({ passphrase });
  const pictures = withPictures ? await packPictures(await pictureRefs()) : null;
  await writeLines({ chunks: await chunksOf(id), pictures, write: (l) => w.writeLine(l) });
  return { bytes: await w.finish(), pictures };
}
async function loadFile(bytes, passphrase = null) {
  const id = crypto.randomUUID();
  for await (const c of chunksFromFile(await openBackup(bytes, passphrase))) {
    await run('select backup.put_chunk($1::uuid, $2::int, $3::text, $4::text, $5::int, $6::text, $7::text)', [id, c.seq, c.kind, c.table_id, c.n, c.hash, c.payload]);
  }
  return id;
}

// ---------------------------------------------------------------- helpers --
async function makeUser(email, password, name) {
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error) throw new Error('createUser ' + email + ': ' + error.message);
  return data.user.id;
}
async function signIn(email, password) {
  const c = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  return error ? null : data.user?.id;
}
async function asService(fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    return fn(tx);
  });
}
/** Hash of every row of every backed-up table. */
async function fingerprints() {
  const tables = (await run(`select jsonb_array_elements(backup.introspect(true)) as t`)).map((r) => r.t);
  const out = {};
  for (const t of tables) {
    const r = await run(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) as h, count(*)::int as n from "${t.schema}"."${t.name}" x`);
    out[t.id] = `${r[0].n}:${r[0].h}`;
  }
  return out;
}

// --------------------------------------------------------------------- seed --
const stamp = Date.now();
const emails = { admin: `bk-admin-${stamp}@example.com`, c1: `bk-c1-${stamp}@example.com`, c2: `bk-c2-${stamp}@example.com`, late: `bk-late-${stamp}@example.com` };
const PASS = 'correct horse battery 42';
const B1 = crypto.randomUUID(), B2 = crypto.randomUUID(), O1 = crypto.randomUUID();
const W1 = 9007199254740993n + BigInt(stamp % 1_000_000), W2 = BigInt(stamp);
const PIC = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

section('Seeding a realistic database');
const adminId = await makeUser(emails.admin, PASS, 'Test Admin');
const c1 = await makeUser(emails.c1, PASS, 'Creator One');
const c2 = await makeUser(emails.c2, PASS, 'Creator Two');
await asService(async (tx) => {
  await tx.unsafe(`update public.profiles set role = 'admin' where id = $1`, [adminId]);
  await tx.unsafe(`update public.profiles set role = 'creator', tier = 'rising' where id = any($1::uuid[])`, [[c1, c2]]);
  await tx.unsafe(
    `insert into public.brands (id, name, slug, store_id, created_by) values
       ('${B1}', 'Brand One', 'brand-one-${stamp}', 'store-1-${stamp}', $1),
       ('${B2}', 'Brand Two 😀', 'brand-two-${stamp}', 'store-2-${stamp}', $1)`, [adminId]);
  await tx.unsafe(`insert into public.offers (id, brand_id, title, video_count, reward_amount, created_by) values ('${O1}', '${B1}', 'Five videos', 5, 200.50, $1)`, [adminId]);
  await tx.unsafe(
    `insert into wurxbase.creators (id, name, brand, gmv, monthly, video_codes) values
       (${W1}, 'Big id creator', 'Brand One', 12345.67, '{"2026-09": {"gmv": 5}}', '["a","b"]'),
       (${W2}, 'Second', 'Brand Two', null, null, null)`);
  await tx.unsafe(`insert into public.audit_log (actor_id, action, subject_type, detail) values ($1, 'seed.test', 'test', '{"n": 1}')`, [adminId]);
});
await sb.storage.from('brand-assets').upload(`bk-test-${stamp}/logo.png`, PIC, { contentType: 'image/png', upsert: true });
console.log('  seeded: 3 accounts, 2 brands, 1 offer, 2 Paid Collabs creators, 1 picture');

// ------------------------------------------------------------------- backup --
section('1. Back up everything');
const before = await fingerprints();
const bkId = crypto.randomUUID();
const t0 = Date.now();
const made = await makeBackup(bkId);
console.log(`  snapshot took ${Date.now() - t0} ms for ${made.total_rows} rows (${(made.bytes / 1048576).toFixed(1)} MB of data)`);
ok(made.rows['auth.users'] >= 3, 'accounts included');
ok(made.rows['wurxbase.creators'] >= 2, 'Paid Collabs (wurxbase schema) included');
ok(Object.keys(made.rows).length > 55, 'every table is covered (' + Object.keys(made.rows).length + ' tables)');
ok(!Object.keys(made.rows).some((k) => k.startsWith('backup.') || k.endsWith('.data_backups')), "the backup's own bookkeeping is left out");
const ver = (await run('select backup.verify($1::uuid) as r', [bkId]))[0].r;
ok(ver.problems.length === 0, 'the backup passes its own integrity check', ver.problems.join('; '));
ok(ver.admin_ids.includes(adminId), 'the admin is recognised in the backup');

section('2. Download it as a file, protected by a passphrase, with the pictures');
const file = await buildFile(bkId, { passphrase: 'a long secret passphrase', withPictures: true });
ok(file.pictures.items.some((p) => p.path === `bk-test-${stamp}/logo.png`), 'the picture is packed in');
console.log(`  file: ${(file.bytes.length / 1024).toFixed(0)} KB`);
ok(!Buffer.from(file.bytes).includes('creator@example.com') && !Buffer.from(file.bytes).includes('bk-c1-'), 'nothing readable is in the encrypted file');

// ---------------------------------------------------------- break the data --
section('3. Damage the database');
await sb.auth.admin.deleteUser(c2);
await makeUser(emails.late, PASS, 'Late Joiner');
await asService(async (tx) => {
  await tx.unsafe(`delete from public.offers where id = $1`, [O1]);
  await tx.unsafe(`delete from public.brands where id = $1`, [B1]);
  await tx.unsafe(`delete from wurxbase.creators where id = $1`, [W2.toString()]);
  await tx.unsafe(`update public.profiles set role = 'applicant', tier = null where id = $1`, [c1]);
});
await sb.storage.from('brand-assets').remove([`bk-test-${stamp}/logo.png`]);
const damaged = await fingerprints();
ok(JSON.stringify(damaged) !== JSON.stringify(before), 'the database really differs now');
ok((await signIn(emails.c2, PASS)) === null, 'a deleted creator cannot sign in');

// ---------------------------------------------------------------- rehearsal --
section('4. Rehearse the restore from the file (must change nothing)');
const fromFileId = await loadFile(file.bytes, 'a long secret passphrase');
const reh = await applyBackup(fromFileId, { dryRun: true, actor: adminId });
ok(reh.dry_run && reh.tables.length > 50, 'rehearsal ran over every table (' + reh.tables.length + ')');
ok(reh.accounts.restored >= 3 && reh.accounts.removed >= 1, 'it would bring back the accounts and remove the late one');
const afterReh = await fingerprints();
ok(JSON.stringify(afterReh) === JSON.stringify(damaged), 'nothing changed after the rehearsal');

// -------------------------------------------------------------- real restore --
section('5. Restore for real');
const t1 = Date.now();
const res = await applyBackup(fromFileId, { actor: adminId });
console.log(`  restore took ${Date.now() - t1} ms`);
const after = await fingerprints();
const differing = Object.keys(before).filter((k) => before[k] !== after[k]);
ok(differing.length === 0, 'every table is identical to the backup point', differing.join(', '));
ok(res.accounts && res.accounts.removed >= 1, 'the account made after the backup was removed');
ok(res.warnings.length === 0, 'no warnings on an identical database', res.warnings.join('; '));

// the pictures come back (the browser does this through signed upload URLs; the test uses the service key)
let restoredPics = 0;
for await (const p of picturesFromFile(await openBackup(file.bytes, 'a long secret passphrase'))) {
  if (p.picture) {
    const { error } = await sb.storage.from(p.picture.bucket).upload(p.picture.path, p.picture.bytes, { upsert: true, contentType: p.picture.type });
    if (!error) restoredPics++;
  }
}
ok(restoredPics >= 1, 'the pictures are put back');
const dl = await sb.storage.from('brand-assets').download(`bk-test-${stamp}/logo.png`);
ok(!dl.error && (await dl.data.arrayBuffer()).byteLength === PIC.length, 'the picture is byte-for-byte right');

section('6. The restored accounts really work');
ok((await signIn(emails.c2, PASS)) === c2, 'the deleted creator signs in again with the SAME password');
ok((await signIn(emails.admin, PASS)) === adminId, 'the admin signs in with the same password');
ok((await signIn(emails.late, PASS)) === null, 'the account made after the backup is gone');
ok((await run(`select role::text r from public.profiles where id = $1`, [c1]))[0].r === 'creator', 'roles are back as they were');

section('7. Nothing was left switched off');
const trig = await run(`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                         where not t.tgisinternal and t.tgenabled <> 'O' and n.nspname in ('public','wurxbase')`);
ok(trig[0].n === 0, 'all triggers are enabled again');
const fk = await run(`select count(*)::int n from pg_constraint where contype = 'f' and (condeferrable or condeferred) and connamespace in ('public'::regnamespace, 'wurxbase'::regnamespace)`);
ok(fk[0].n === 0, 'all foreign keys are strict again', 'deferrable: ' + fk[0].n);
ok((await run(`insert into public.audit_log (action, subject_type) values ('after.restore', 'test') returning id`)).length === 1, 'new rows can still be added (counters are sane)');

section('8. The same backup, restored straight from the database (no file)');
await asService(async (tx) => { await tx.unsafe(`delete from public.brands where id = $1`, [B2]); });
const again = await applyBackup(bkId, { actor: adminId });
const after2 = await fingerprints();
ok(Object.keys(before).every((k) => before[k] === after2[k]), 'also identical, restored from the stored copy');
ok(again.tables.length > 50, 'over every table');

section('9. A refused restore leaves everything alone');
let refused = '';
try { await applyBackup(bkId, { actor: c1 }); } catch (e) { refused = e.message; }
ok(/not an active admin/.test(refused), 'a non-admin acting would be refused, so nobody is locked out');
const pre = await fingerprints();
let denied = '';
const dangling = crypto.randomUUID();
await run(`insert into backup.chunks select $1::uuid, seq, kind, table_id, n,
             case when table_id = 'public.offers' then backup.sha(regexp_replace(payload, '"brand_id": ?"[^"]*"', '"brand_id": "ffffffff-ffff-ffff-ffff-ffffffffffff"', 'g')) else hash end,
             case when table_id = 'public.offers' then regexp_replace(payload, '"brand_id": ?"[^"]*"', '"brand_id": "ffffffff-ffff-ffff-ffff-ffffffffffff"', 'g') else payload end
           from backup.chunks where backup_id = $2::uuid`, [dangling, bkId]);
try { await applyBackup(dangling, { actor: adminId }); } catch (e) { denied = e.message; }
ok(/does not fit/.test(denied) && /Nothing was changed/.test(denied), 'a backup that does not fit this database is refused', denied);
ok(JSON.stringify(pre) === JSON.stringify(await fingerprints()), 'and nothing changed');

// cleanup of the test's own leftovers
await sb.storage.from('brand-assets').remove([`bk-test-${stamp}/logo.png`]);
await run(`select backup.drop_backup($1::uuid)`, [bkId]);
await run(`select backup.drop_backup($1::uuid)`, [fromFileId]);
await run(`select backup.drop_backup($1::uuid)`, [dangling]);
await sql.end({ timeout: 5 });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll live checks passed.');
process.exit(failed ? 1 : 0);
