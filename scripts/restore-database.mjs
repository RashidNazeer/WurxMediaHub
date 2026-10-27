/**
 * Put a backup file back into a database, from the command line.
 *
 * THIS IS THE WAY BACK WHEN THE ADMIN SCREEN IS NOT AVAILABLE: a brand new
 * Supabase project, a database that was wiped, or nobody able to sign in. The
 * backup contains the sign-in accounts, so after it is restored the admin can
 * sign in with the same email and password as before.
 *
 *   1. Make the (new) project's database have the right shape first:
 *        supabase link --project-ref <ref>   then   supabase db push
 *   2. Rehearse (changes nothing):
 *        DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres \
 *        pnpm restore:database -- prism-backup.prismbackup --dry-run [--passphrase "..."]
 *   3. Do it:
 *        ... same command with --yes instead of --dry-run
 *
 * Options
 *   --dry-run         do everything, then roll it back. Nothing changes.
 *   --yes             really restore. Without --yes or --dry-run nothing happens.
 *   --passphrase P    for a protected file
 *   --no-accounts     leave the sign-in accounts exactly as they are
 *   --admin <uuid>    refuse unless this account is an active admin in the backup
 *                     (protects you from locking yourself out)
 * Add SUPABASE_URL and SUPABASE_SERVICE_KEY to put the pictures in the file back.
 *
 * The restore is ONE database transaction: it completes or it changes nothing.
 * Take a copy of what is there now first if it matters (pnpm backup:database).
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { openBackup, BackupError } from '../src/lib/backup/format.ts';
import { chunksFromFile, picturesFromFile } from '../src/lib/backup/lines.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--passphrase' && args[args.indexOf(a) - 1] !== '--admin');
const flag = (n) => args.includes(n);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!file || !DATABASE_URL) {
  console.error('Usage: DATABASE_URL=... pnpm restore:database -- <file> (--dry-run | --yes) [--passphrase P] [--no-accounts] [--admin <uuid>]');
  process.exit(2);
}
if (!flag('--dry-run') && !flag('--yes')) {
  console.error('Add --dry-run to rehearse, or --yes to restore for real.');
  process.exit(2);
}
const dryRun = flag('--dry-run');
const accounts = !flag('--no-accounts');
const passphrase = arg('--passphrase');

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const id = crypto.randomUUID();
let loaded = false;
try {
  const bytes = new Uint8Array(fs.readFileSync(file));
  let opened;
  try {
    opened = await openBackup(bytes, passphrase);
  } catch (e) {
    if (e instanceof BackupError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  console.log(`Reading ${file} ...`);
  let n = 0;
  for await (const c of chunksFromFile(opened)) {
    await sql.unsafe('select backup.put_chunk($1::uuid, $2::int, $3::text, $4::text, $5::int, $6::text, $7::text)', [id, c.seq, c.kind, c.table_id, c.n, c.hash, c.payload]);
    n++;
  }
  loaded = true;
  const ver = (await sql.unsafe('select backup.verify($1::uuid) as r', [id]))[0].r;
  if (ver.problems.length) {
    console.error('This backup is damaged and was not restored:\n  ' + ver.problems.join('\n  '));
    process.exit(1);
  }
  console.log(`  ${n} pieces, ${ver.total_rows} rows, made ${String(ver.head.created_at).replace('T', ' ').slice(0, 16)} UTC. It checks out.`);

  console.log(dryRun ? 'Rehearsing the restore (nothing will change)...' : 'Restoring ...');
  const t0 = Date.now();
  const result = await sql.begin(async (tx) => {
    await tx.unsafe('set local statement_timeout = 0');
    await tx.unsafe("set local lock_timeout = '60s'");
    return (await tx.unsafe('select backup.apply($1::uuid, $2::boolean, $3::boolean, $4::uuid) as r', [id, accounts, dryRun, arg('--admin')]))[0].r;
  });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const changed = result.tables.filter((t) => t.before !== t.restored);
  console.log(`  ${result.tables.length} tables${accounts && result.accounts ? `, ${result.accounts.restored} accounts (${result.accounts.removed} removed that are not in the backup)` : ''}`);
  for (const t of changed.slice(0, 25)) console.log(`    ${t.id}: ${t.before} -> ${t.restored}`);
  if (changed.length > 25) console.log(`    ... and ${changed.length - 25} more`);
  for (const w of result.warnings) console.log('  WARNING: ' + w);
  if (result.schema.untouched.length) console.log('  Left alone (not in the backup): ' + result.schema.untouched.join(', '));

  if (!dryRun && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    let ok = 0;
    let bad = 0;
    for await (const p of picturesFromFile(await openBackup(bytes, passphrase))) {
      if ('picture' in p) {
        const { error } = await sb.storage.from(p.picture.bucket).upload(p.picture.path, p.picture.bytes, { upsert: true, contentType: p.picture.type });
        if (error) bad++;
        else ok++;
      } else bad++;
    }
    console.log(`  pictures: ${ok} put back${bad ? `, ${bad} could not be` : ''}`);
  }
  console.log(dryRun ? '\nRehearsal finished. Nothing was changed.' : '\nRestore finished.');
} catch (e) {
  console.error('\nNothing was changed. ' + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
} finally {
  if (loaded || true) await sql.unsafe('select backup.drop_backup($1::uuid)', [id]).catch(() => {});
  await sql.end({ timeout: 5 });
}
