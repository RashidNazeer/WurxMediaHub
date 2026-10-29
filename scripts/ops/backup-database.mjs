/**
 * Back up the whole database to a file, from the command line.
 *
 *   DATABASE_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres \
 *   pnpm backup:database -- --out prism-backup.prismbackup [--passphrase "..."]
 *
 * Add SUPABASE_URL and SUPABASE_SERVICE_KEY to pack the uploaded pictures in too.
 *
 * It makes the same file the "Backup data" screen's Download button makes, and
 * the screen and restore-database.mjs can both read it. Use it for a copy kept
 * off Supabase (a scheduled job, an external disk) or when the admin screen is
 * not available.
 *
 * Needs the database password (Supabase dashboard > Project settings > Database),
 * which is NOT in the repo and must never be put in a file. Pass it in the
 * environment for the one command.
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { BackupWriter } from '../../src/lib/backup/format.ts';
import { writeLines } from '../../src/lib/backup/lines.ts';
import { packPictures } from '../../src/lib/backup/pictures.ts';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const out = arg('--out') ?? `prism-backup-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.prismbackup`;
const passphrase = arg('--passphrase');
const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to the database connection string (see the top of this file).');
  process.exit(2);
}
if (passphrase && passphrase.length < 8) {
  console.error('A passphrase needs at least 8 characters.');
  process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const id = crypto.randomUUID();
try {
  console.log('Taking a snapshot of the database...');
  const made = await sql.begin('isolation level repeatable read', async (tx) => {
    await tx.unsafe('set local statement_timeout = 0');
    return (await tx.unsafe('select backup.make($1::uuid, true) as r', [id]))[0].r;
  });
  console.log(`  ${made.total_rows} rows in ${Object.keys(made.rows).length} tables`);

  let pictures = null;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    console.log('Collecting the pictures...');
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    const refs = [];
    const { data: buckets } = await sb.storage.listBuckets();
    for (const b of buckets ?? []) {
      const walk = async (prefix) => {
        const { data } = await sb.storage.from(b.id).list(prefix, { limit: 1000 });
        for (const e of data ?? []) {
          const path = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.id == null) await walk(path);
          else {
            const { data: s } = await sb.storage.from(b.id).createSignedUrl(path, 600);
            refs.push({ bucket: b.id, path, size: Number(e.metadata?.size ?? 0), type: String(e.metadata?.mimetype ?? 'application/octet-stream'), url: s.signedUrl });
          }
        }
      };
      await walk('');
    }
    const packed = await packPictures(refs);
    pictures = { items: packed.items, skipped: packed.skipped };
    console.log(`  ${packed.items.length} pictures${packed.skipped ? `, ${packed.skipped} skipped (too big)` : ''}`);
  } else {
    console.log('(No SUPABASE_URL / SUPABASE_SERVICE_KEY, so the uploaded pictures are not included.)');
  }

  const chunks = await sql.unsafe('select seq, kind, table_id, n, hash, payload from backup.chunks where backup_id = $1::uuid order by seq', [id]);
  const writer = await BackupWriter.create({ passphrase });
  await writeLines({ chunks, pictures, write: (l) => writer.writeLine(l) });
  const bytes = await writer.finish();
  fs.writeFileSync(out, bytes);
  console.log(`\nSaved ${out} (${(bytes.length / 1048576).toFixed(1)} MB${passphrase ? ', protected by your passphrase' : ', NOT passphrase-protected: keep it somewhere private'}).`);
  if (passphrase) console.log('Keep the passphrase safe. Nobody can recover it, and without it the file is unreadable.');
} finally {
  await sql.unsafe('select backup.drop_backup($1::uuid)', [id]).catch(() => {});
  await sql.end({ timeout: 5 });
}
