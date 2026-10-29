#!/usr/bin/env node
/**
 * FILL THE BLANK VIDEO THUMBNAILS ON EVERY BRAND.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/backfill-video-thumbs.mjs          # dry run
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/backfill-video-thumbs.mjs --write  # for real
 *
 * Rashid, 2026-10-02, after the Irwin fix: "yes please fix as u just said".
 *
 * Irwin's blanks were fixed inside `reacher-sync`, because that function is
 * what files Irwin's videos. Everywhere else the videos arrive through the
 * BROWSER — the EUKA merge and the video editor — and no server-side job owns
 * them, so there is nowhere for the same code to live. Hence a script: it is
 * re-runnable, it only ever ADDS a picture to an entry that has none, and it is
 * a dry run unless `--write` is passed.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
 * It never removes a thumbnail, never replaces one, never touches any other
 * field on the row, and never touches a row it found nothing for. The write is
 * the row's `video_codes` array with some blank `thumb` strings filled in and
 * everything else byte-for-byte as it was read.
 *
 * ── WHY IT IS SAFE TO RE-RUN ──────────────────────────────────────────────
 * A video with a picture is skipped, so a second run only asks about the ones
 * still blank — which is exactly the set worth asking about again, because a
 * video posted this week may be indexed next week.
 *
 * The source, the reasoning, and why TikTok's own oEmbed is the wrong answer
 * are all in `supabase/functions/_shared/video-thumbs.ts`. Short version: that
 * URL carries an expiry measured in hours.
 */
import { readFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');
const KEY = process.env.SUPABASE_SERVICE_KEY;
const URL_ = process.env.SUPABASE_URL
  || (readFileSync('.env.local', 'utf8').match(/^VITE_SUPABASE_URL=(.*)$/m) || [])[1]?.trim() || '';
const STORE = 'https://database.euka.ai/storage/v1/object/public/creator_videos_photos';
const CONCURRENCY = 8;

if (!KEY) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'wurxbase' };

async function all(path) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: `${f}-${f + 999}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const j = await r.json(); out.push(...j); if (j.length < 1000) break;
  }
  return out;
}
const vidId = (u) => (String(u ?? '').match(/\/video\/(\d+)/) || [])[1] || null;

/* THE CONTROLS COME FIRST. If the store answered 200 to an id that cannot
   exist, every "found it" below would be a lie and the run would fill the whole
   table with broken links. */
const ctlA = await fetch(`${STORE}/0000000000000000000.webp`, { method: 'HEAD' }).catch(() => null);
if (!ctlA || ctlA.ok) {
  console.error(`control failed: an impossible id answered ${ctlA ? ctlA.status : 'nothing'}. Refusing to run.`);
  process.exit(1);
}
console.log(`control ok (impossible id → HTTP ${ctlA.status})`);

const rows = await all('creators?select=id,brand,name,video_codes');
console.log(`${rows.length} creator rows read`);

/* Every id that needs a picture, and which entries are waiting on it. One id
   can sit on several rows; asking twice for one answer is a wasted request. */
const need = new Map();
let blanks = 0, withPic = 0;
for (const row of rows) {
  const list = Array.isArray(row.video_codes) ? row.video_codes : [];
  for (const rec of list) {
    if (!rec || !String(rec.video ?? '').trim()) continue;
    if (String(rec.thumb ?? '').trim()) { withPic++; continue; }
    blanks++;
    const id = vidId(rec.video);
    if (!id) continue;
    const bucket = need.get(id) ?? [];
    bucket.push({ rowId: row.id, rec });
    need.set(id, bucket);
  }
}
console.log(`${withPic} videos already have a picture · ${blanks} do not · ${need.size} distinct ids to ask about`);
if (!need.size) { console.log('nothing to do.'); process.exit(0); }

const ids = [...need.keys()];
let cursor = 0, found = 0, absent = 0;
const touchedRows = new Set();
const t0 = Date.now();
const worker = async () => {
  for (;;) {
    const i = cursor++;
    if (i >= ids.length) return;
    const id = ids[i];
    const r = await fetch(`${STORE}/${id}.webp`, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok) {
      found++;
      for (const { rowId, rec } of need.get(id)) { rec.thumb = `${STORE}/${id}.webp`; touchedRows.add(rowId); }
    } else {
      absent++;
    }
    if ((found + absent) % 200 === 0) {
      process.stdout.write(`  asked ${found + absent}/${ids.length} · found ${found}\r`);
    }
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nasked ${ids.length} ids in ${Math.round((Date.now() - t0) / 1000)}s · ${found} have a picture · ${absent} do not`);

/* And the control again, AFTER the sweep: a store that started answering 200 to
   everything part way through would otherwise look like a very good run. */
const ctlB = await fetch(`${STORE}/1111111111111111111.webp`, { method: 'HEAD' }).catch(() => null);
if (!ctlB || ctlB.ok) {
  console.error(`control failed AFTER the sweep (${ctlB ? ctlB.status : 'nothing'}). NOT writing.`);
  process.exit(1);
}
console.log(`control ok after the sweep (HTTP ${ctlB.status})`);

/* Per brand, so the result is readable rather than one number. */
const perBrand = new Map();
for (const row of rows) {
  if (!touchedRows.has(row.id)) continue;
  const n = (Array.isArray(row.video_codes) ? row.video_codes : [])
    .filter((v) => String(v?.thumb ?? '').startsWith(STORE)).length;
  const b = row.brand || '(none)';
  perBrand.set(b, (perBrand.get(b) || 0) + n);
}
console.log('\nbrand | videos that gained a picture');
for (const [b, n] of [...perBrand.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${b} | ${n}`);
console.log(`\n${touchedRows.size} rows would change.`);

if (!WRITE) {
  console.log('\nDRY RUN — nothing written. Pass --write to apply.');
  process.exit(0);
}

let written = 0;
for (const row of rows) {
  if (!touchedRows.has(row.id)) continue;
  const r = await fetch(`${URL_}/rest/v1/creators?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', 'Content-Profile': 'wurxbase', Prefer: 'return=minimal' },
    body: JSON.stringify({ video_codes: row.video_codes }),
  });
  if (!r.ok) { console.error(`row ${row.id}: ${r.status} ${await r.text()}`); process.exit(1); }
  written++;
  if (written % 50 === 0) process.stdout.write(`  wrote ${written}/${touchedRows.size}\r`);
}
console.log(`\nwrote ${written} rows.`);
