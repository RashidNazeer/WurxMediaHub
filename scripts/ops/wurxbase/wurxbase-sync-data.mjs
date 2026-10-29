#!/usr/bin/env node
/**
 * Bring our copy up to date with the old app WITHOUT emptying anything.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/wurxbase/wurxbase-sync-data.mjs            # dry run
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/wurxbase/wurxbase-sync-data.mjs --apply
 *
 * WHY THIS EXISTS ALONGSIDE `wurxbase-copy-data.mjs`. That one empties each
 * table and refills it from theirs, which is right for a first migration and
 * wrong for a top-up: it would discard the eight `hub_email` links, our own
 * audit history, and anything entered on our side since. Rashid asked for the
 * data to be brought level without disturbing what is already here.
 *
 * IT ONLY EVER ADDS. Rashid, after checking with Asad — who had also been
 * entering things on OUR side: *"I don't want you to delete any data that is in
 * our app. Just check if anything was added in base platform and not here, we
 * only need to add it here. And if anything was added directly from our
 * platform, it's perfect."* The two are deliberately NOT being made identical.
 *
 *   · a row they have and we do not          -> INSERT
 *   · a field EMPTY here and set there       -> filled in
 *   · a field set here, whatever they hold   -> LEFT ALONE, and reported
 *   · a video they have and we do not        -> appended
 *   · a video we have and they do not        -> kept
 *   · a row we have and they do not          -> LEFT ALONE
 *   · `hub_email`                            -> NEVER WRITTEN
 *   · `password`, which they still have      -> IGNORED, dropped here
 *
 * IT NEVER DELETES ANYTHING AND NEVER OVERWRITES ANYTHING. Not a row, not a
 * field, not a video. The worst it can do is add something you did not want,
 * which is visible and reversible; it cannot silently replace a number somebody
 * typed.
 *
 * That rule also disposes of a real hazard. An earlier draft took their value
 * on conflict, and the dry run showed it overwriting 182 true `items` counts
 * with 0 — their deployment still runs the bug fixed here on 2026-08-29, where
 * a swallowed 400 from Euka makes every sweep write zero over the real figure.
 *
 * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

/* Theirs, from their own source. Read-only throughout: this script issues no
   write of any kind against their project. */
const src = readFileSync('D:/Milestone/WurxBase/src/supabaseClient.js', 'utf8');
const THEIR_URL = (src.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
const THEIR_KEY = (src.match(/SUPABASE_KEY\s*=\s*'([^']+)'/) || [])[1];
if (!THEIR_URL || !THEIR_KEY) throw new Error('could not read their credentials');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (/prod/i.test(env.VITE_SUPABASE_URL || '') && !process.argv.includes('--i-mean-prod')) {
  throw new Error('.env.local points at production. Refusing.');
}

const theirs = createClient(THEIR_URL, THEIR_KEY, { auth: { persistSession: false } });
const ours = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }, db: { schema: 'wurxbase' },
});

/*
 * OURS ONLY — never written from theirs, whatever theirs contains.
 * `hub_email` is how a person is matched to their hub account; their table has
 * no such column, so copying their row over ours would blank it and drop the
 * whole team to the wider derived role.
 */
const NEVER_WRITE = new Set(['hub_email']);

const TABLES = [
  { name: 'creators', key: 'id' },
  { name: 'brand_monthly_budgets', key: 'id' },
  { name: 'app_users', key: 'id' },
  { name: 'join_requests', key: 'id' },
];

const page = async (client, table, key) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select('*').order(key).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
};

const vidKey = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  const m = s.match(/video\/(\d+)/);
  return m ? m[1] : s.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
};

/*
 * Take THEIR array as-is, and append only what would otherwise be lost.
 *
 * The first attempt at this deduplicated by video id while merging, and the dry
 * run showed rows going from 17 entries to 1. No distinct video was lost —
 * their app stores the same link twice on purpose sometimes, and
 * `deliveredVideoCount` already dedupes when counting — but rewriting somebody's
 * stored array to a tidier one is not a sync, it is an edit, and those
 * duplicate rows can carry different hand-typed ad codes.
 *
 * So: their array, verbatim, order and duplicates intact. Then any video that
 * exists HERE and not there is appended rather than dropped, because this
 * script is not allowed to lose data even when the two sides disagree.
 */
function reconcileVideos(mine, theirsArr) {
  const a = Array.isArray(mine) ? mine : [];
  const b = Array.isArray(theirsArr) ? theirsArr : [];

  /*
   * ADD ONLY. Rashid, 2026-08-31, after checking with Asad — who confirmed he
   * had also been entering things on OUR side: *"i don't want you to delete any
   * data that is in our app, just check if anything was added in base platform
   * and not here, we only need to add it here; and if anything was added
   * directly from our platform, it's perfect."*
   *
   * So the two are NOT being made identical. Ours keeps everything it has,
   * exactly as it has it, and only gains the videos it is missing. Nothing
   * already here is rewritten — not a metric, not an ad code, not a date.
   * That also makes the whole class of "their zero overwrote our number"
   * impossible rather than merely handled.
   */
  const ourKeys = new Set(a.map((v) => vidKey(v?.video)).filter(Boolean));
  const toAdd = b.filter((v) => { const k = vidKey(v?.video); return k && !ourKeys.has(k); });
  if (!toAdd.length) return { merged: a, added: 0, onlyMine: 0, onlyHere: [], fieldsKept: 0 };
  return { merged: [...a, ...toAdd], added: toAdd.length, onlyMine: 0, onlyHere: [], fieldsKept: 0 };
}

/*
 * EMPTY IS EMPTY. A column holding `null` on one side and `[]` on the other is
 * not a difference worth writing, and treating it as one turned this dry run
 * into 1,223 "changes" that would have rewritten almost every creator row to
 * no effect. Normalise the empties before comparing.
 */
const norm = (v) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? v : null;
  if (typeof v === 'object') return Object.keys(v).length ? v : null;
  if (v === '') return null;
  return v;
};
const same = (x, y) => JSON.stringify(norm(x)) === JSON.stringify(norm(y));

/*
 * `monthly` IS A CACHE, NOT A FACT, and it is skipped by default.
 *
 * It holds the Euka figures their nightly job refreshes, so it differs on
 * nearly every row simply because their cron ran this morning and ours does not
 * exist. Our screens read Euka LIVE now and fall back to this only when the
 * live sweep cannot see a creator, so copying it changes almost nothing on
 * screen while making the sync touch 1,000+ rows — and a sync that rewrites
 * everything is one nobody can check. `--with-cache` includes it.
 */
const SKIP = new Set(process.argv.includes('--with-cache') ? [] : ['monthly']);

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}`);
console.log(`  from ${THEIR_URL.split('//')[1].split('.')[0]}  into  ${env.VITE_SUPABASE_URL.split('//')[1].split('.')[0]}.wurxbase\n`);

let totalUpdates = 0, totalInserts = 0, totalOursOnly = 0;

for (const { name, key } of TABLES) {
  const [T, O] = await Promise.all([page(theirs, name, key), page(ours, name, key)]);
  const ourCols = new Set(Object.keys(O[0] || T[0] || {}));
  const byId = new Map(O.map((r) => [String(r[key]), r]));

  const updates = [];
  const inserts = [];
  const fieldTally = {};
  let keptTally = 0;
  const conflicts = [];
  let videoNotes = [];

  for (const t of T) {
    const id = String(t[key]);
    const o = byId.get(id);

    if (!o) {
      const row = {};
      for (const k of Object.keys(t)) if (ourCols.has(k) && !NEVER_WRITE.has(k)) row[k] = t[k];
      inserts.push({ id, row, label: t.name || t.brand || id });
      continue;
    }

    const patch = {};
    for (const k of Object.keys(t)) {
      if (!ourCols.has(k) || NEVER_WRITE.has(k) || SKIP.has(k)) continue;
      if (k === 'video_codes') {
        const { merged, onlyMine, onlyHere, fieldsKept } = reconcileVideos(o[k], t[k]);
        if (fieldsKept) keptTally += fieldsKept;
        if (onlyMine) {
          videoNotes.push(
            `${t.name || id} (id ${id}): ${onlyMine} video(s) exist only here, kept — ` +
            onlyHere.slice(0, 2).map((v) => `${vidKey(v.video) || '(no url)'}${v.adCode ? ' code=' + v.adCode : ''}`).join(', ')
          );
        }
        if (!same(merged, o[k])) patch[k] = merged;
        continue;
      }
      /*
       * FILL A BLANK, NEVER REPLACE A VALUE. If we already hold something for
       * this field it stays, even when theirs differs — anything entered on our
       * side is deliberate, and this script has no way to tell a newer edit
       * from an older one. Only a field that is empty here and set there is
       * written.
       */
      if (same(t[k], o[k])) continue;
      if (norm(o[k]) !== null) {
        conflicts.push(`${t.name || id}.${k}: ours ${JSON.stringify(norm(o[k]))} kept, theirs ${JSON.stringify(norm(t[k]))} ignored`);
        continue;
      }
      patch[k] = t[k];
    }
    if (Object.keys(patch).length) {
      for (const k of Object.keys(patch)) fieldTally[k] = (fieldTally[k] || 0) + 1;
      updates.push({ id, label: t.name || t.brand || id, patch, before: o });
    }
  }

  const oursOnly = O.filter((r) => !T.some((t) => String(t[key]) === String(r[key])));

  console.log(`── ${name}`);
  console.log(`   theirs ${T.length}   ours ${O.length}   to update ${updates.length}   to insert ${inserts.length}   only here ${oursOnly.length}`);
  if (Object.keys(fieldTally).length) {
    if (keptTally) console.log('   ' + keptTally + ' value(s) kept from our side where theirs was empty (their items bug)');
    console.log('   fields affected: ' + Object.entries(fieldTally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  }
  totalUpdates += updates.length; totalInserts += inserts.length; totalOursOnly += oursOnly.length;

  for (const u of updates.slice(0, 40)) {
    const fields = Object.keys(u.patch).map((k) => {
      if (k === 'video_codes') {
        const b = Array.isArray(u.before[k]) ? u.before[k].length : 0;
        return `video_codes ${b} -> ${u.patch[k].length}`;
      }
      return `${k}: ${JSON.stringify(u.before[k]) ?? 'null'} -> ${JSON.stringify(u.patch[k])}`;
    });
    console.log(`     ${String(u.label).slice(0, 22).padEnd(23)} ${fields.join('  |  ').slice(0, 150)}`);
  }
  if (updates.length > 40) console.log(`     … and ${updates.length - 40} more`);
  for (const i of inserts.slice(0, 20)) console.log(`     + NEW  ${String(i.label).slice(0, 30)} (id ${i.id})`);
  for (const r of oursOnly.slice(0, 10)) console.log(`     · kept (only here): ${String(r.name || r.id).slice(0, 30)} (id ${r[key]})`);
  for (const n of videoNotes.slice(0, 10)) console.log(`     · ${n}`);

  if (APPLY) {
    for (const u of updates) {
      const { error } = await ours.from(name).update(u.patch).eq(key, u.id);
      if (error) throw new Error(`update ${name} ${u.id}: ${error.message}`);
    }
    for (const i of inserts) {
      const { error } = await ours.from(name).insert([i.row]);
      if (error) throw new Error(`insert ${name} ${i.id}: ${error.message}`);
    }
    console.log(`   applied: ${updates.length} update(s), ${inserts.length} insert(s)`);
  }
  console.log('');
}

console.log('─'.repeat(60));
console.log(`${APPLY ? 'applied' : 'would apply'}: ${totalUpdates} update(s), ${totalInserts} insert(s), 0 deletes`);
console.log(`${totalOursOnly} row(s) exist only here and were left untouched`);
if (!APPLY) console.log('\nnothing was written. re-run with --apply to make these changes.');
else console.log('\nNow re-check: pnpm verify:wurxbase-roster  (hub_email is never written here, but prove it)');
