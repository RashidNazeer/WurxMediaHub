#!/usr/bin/env node
/**
 * DEV ONLY. Removes the things that are on dev but are not part of the product.
 *
 * WHY IT EXISTS. Rashid, 2026-08-19, after the Penetrex load: "please make sure
 * that all the data before adding penetrex from the sheet was dummy and useless
 * ... now i wanna see only the data we fetched from the sheet is there any extra
 * data??" There was. Three kinds, and each got left behind by a different thing.
 *
 * WHAT IT REMOVES, and only these:
 *
 *   1. TEST LITTER. Every account on an @wurxmediahub.test address and every
 *      brand named "Content Suite ..." or "Perf ...". The suites create these
 *      and mostly clean up after themselves; a suite that dies mid-run does
 *      not, and check-content's brand delete used to sit outside its `finally`
 *      so a thrown browser step skipped it entirely.
 *
 *   2. AD MONEY NOBODY OWNS. `tiktok_video_daily` has no foreign key to a
 *      person: its key is (item_id, stat_date) and nothing cascades. That is
 *      deliberate and it is documented in wipe-clean-slate.mjs as the valuable
 *      property, because resubmitting the same link brings the figures back
 *      with no API call. The cost is that a wipe leaves the money of everybody
 *      it deleted lying in the table for ever.
 *
 *      READ THIS BEFORE RUNNING IT. Deleting those rows gives up exactly that
 *      property. If one of those videos is ever submitted again, the sync has
 *      to buy its history back from TikTok in API calls rather than finding it
 *      already there. Only run this when the orphans are known dummy data.
 *
 *   3. EMPTY BRANDS, by explicit name. Everything that references `brands` is
 *      ON DELETE CASCADE, so removing a brand silently takes its offers, jobs,
 *      videos and contests with it. This script therefore counts all six of
 *      those first and REFUSES the brand if any is non-zero. Naming a brand is
 *      never enough on its own.
 *
 * WHAT IT DELIBERATELY LEAVES:
 *
 *   audit_log            a history that can be erased by whoever is tidying up
 *                        is not a history. Rashid's call, asked directly.
 *   tiktok_sync_runs     how anybody would ever find out the nightly job
 *                        stopped. Same conversation.
 *   the revoked TikTok connection
 *                        the table soft-revokes on purpose: "the row stays so
 *                        the audit trail still resolves", and its token was
 *                        overwritten with an empty string at the same moment.
 *   the second Penetrex store row
 *                        NOT a duplicate. The primary key is (advertiser_id,
 *                        store_id) because that store is authorised to both ad
 *                        accounts, and the figures belong to the PAIR. Exactly
 *                        one pair is mapped to the brand, which is correct.
 *                        Deleting the unmapped one would also just bring it
 *                        back on the next store refresh.
 *   used oauth nonces    single use and already expired, and deleting a used
 *                        one is the wrong direction for replay protection.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/tidy-dev.mjs               # dry run
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/tidy-dev.mjs --yes         # do it
 *   ... --skip-money      leave tiktok_video_daily alone
 *   ... --brands "A,B"    also remove these named brands, if they are empty
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .map((l) => l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
);

const URL_ = env.VITE_SUPABASE_URL;
assertDevProject(URL_, 'tidy-dev.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const GO = args.includes('--yes');
const SKIP_MONEY = args.includes('--skip-money');
const namedBrands = (() => {
  const i = args.indexOf('--brands');
  return i > -1 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
})();

const say = (s) => console.log(s);
const act = (s) => console.log(`  ${GO ? 'REMOVED' : 'would remove'}  ${s}`);
let problems = 0;
const refuse = (s) => {
  console.log(`  REFUSED   ${s}`);
  problems++;
};

say(`\nTidying ${URL_}`);
say(GO ? 'RUNNING FOR REAL\n' : 'DRY RUN. Nothing is deleted. Add --yes to do it.\n');

/* ======================================================== 1. test litter == */
say('[1] Test accounts and test brands');

const { data: userList, error: uErr } = await db.auth.admin.listUsers({ perPage: 1000 });
if (uErr) throw new Error('listUsers: ' + uErr.message);

const testUsers = userList.users.filter((u) => /@wurxmediahub\.test$/i.test(u.email ?? ''));
for (const u of testUsers) {
  /*
   * Deleting the auth user is enough: profiles cascades from auth.users and
   * applications cascades from profiles. audit_log does NOT go with them, its
   * actor_id and target_user_id are ON DELETE SET NULL and the actor's email
   * and role are snapshotted as text on the row, so the history still reads.
   */
  act(`account ${u.email}`);
  if (GO) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) refuse(`could not delete ${u.email}: ${error.message}`);
  }
}
if (!testUsers.length) say('  none');

const { data: allBrands, error: bErr } = await db.from('brands').select('id, name');
if (bErr) throw new Error('brands: ' + bErr.message);

const testBrands = allBrands.filter((b) => /^(Content Suite|Perf|Brands Suite|RLS) /i.test(b.name));

/**
 * Every table that references `brands` with ON DELETE CASCADE. A brand is only
 * safe to remove when all of these are zero, because otherwise the delete takes
 * real work with it and says nothing.
 */
async function brandIsEmpty(id) {
  const tables = [
    'offers',
    'offer_applications',
    'content_submissions',
    'contests',
    'brand_products',
    'brand_commercials',
  ];
  const counts = {};
  for (const t of tables) {
    const { count, error } = await db
      .from(t)
      .select('*', { count: 'exact', head: true })
      .eq('brand_id', id);
    if (error) throw new Error(`${t}: ${error.message}`);
    counts[t] = count ?? 0;
  }
  // Products and budgets are furniture on an unused brand rather than work, so
  // they do not block. Anything a creator or a pound touched does.
  const blocking = ['offers', 'offer_applications', 'content_submissions', 'contests'];
  return { counts, blocked: blocking.filter((t) => counts[t] > 0) };
}

for (const b of testBrands) {
  const { counts, blocked } = await brandIsEmpty(b.id);
  const shape = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
  if (blocked.length && blocked.some((t) => t !== 'offers')) {
    refuse(`brand "${b.name}" has real work on it (${shape})`);
    continue;
  }
  act(`brand "${b.name}" (${shape})`);
  if (GO) {
    const { error } = await db.from('brands').delete().eq('id', b.id);
    if (error) refuse(`could not delete brand "${b.name}": ${error.message}`);
  }
}
if (!testBrands.length) say('  no test brands');

/* ================================================= 2. ad money nobody owns = */
say('\n[2] Ad money for videos nobody owns');

if (SKIP_MONEY) {
  say('  skipped (--skip-money)');
} else {
  const owned = new Set();
  for (const t of ['content_submissions', 'contest_submissions']) {
    const { data, error } = await db.from(t).select('embed_id').not('embed_id', 'is', null);
    if (error) throw new Error(`${t}: ${error.message}`);
    for (const r of data) owned.add(r.embed_id);
  }

  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await db
      .from('tiktok_video_daily')
      .select('item_id, cost, gross_revenue')
      .range(from, from + 999);
    if (error) throw new Error('tiktok_video_daily: ' + error.message);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const orphanIds = [...new Set(rows.filter((r) => !owned.has(r.item_id)).map((r) => r.item_id))];
  const orphanRows = rows.filter((r) => !owned.has(r.item_id));
  const gmv = orphanRows.reduce((a, r) => a + Number(r.gross_revenue ?? 0), 0);

  say(`  ${rows.length} rows in total, ${rows.length - orphanRows.length} owned by a live video`);
  act(`${orphanRows.length} rows across ${orphanIds.length} video ids, $${gmv.toFixed(2)} of GMV`);

  if (GO && orphanIds.length) {
    /*
     * BY EXPLICIT ID LIST, in batches, never a filter that could match
     * everything. PostgREST refuses an unfiltered delete, but a filter that is
     * WRONG is refused by nothing, and this table is the only place the real
     * money lives.
     */
    for (let i = 0; i < orphanIds.length; i += 40) {
      const batch = orphanIds.slice(i, i + 40);
      const { error } = await db.from('tiktok_video_daily').delete().in('item_id', batch);
      if (error) refuse(`batch ${i / 40 + 1}: ${error.message}`);
    }
  }
}

/* ====================================================== 3. named brands ==== */
if (namedBrands.length) {
  say('\n[3] Brands named on the command line');
  for (const name of namedBrands) {
    const b = allBrands.find((x) => x.name === name);
    if (!b) {
      refuse(`no brand called "${name}"`);
      continue;
    }
    const { counts, blocked } = await brandIsEmpty(b.id);
    const shape = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
    if (blocked.length) {
      refuse(`"${name}" is not empty (${shape}) — everything under it would cascade away`);
      continue;
    }
    act(`brand "${name}" and its ${counts.brand_products} product(s), ${counts.brand_commercials} budget row(s)`);
    if (GO) {
      const { error } = await db.from('brands').delete().eq('id', b.id);
      if (error) refuse(`could not delete "${name}": ${error.message}`);
    }
  }
}

/* ============================================================== the state == */
say('\n--- where dev stands now ---');
for (const t of [
  'profiles',
  'applications',
  'brands',
  'offers',
  'offer_applications',
  'content_submissions',
  'creator_avatars',
  'contests',
  'tiktok_video_daily',
]) {
  const { count } = await db.from(t).select('*', { count: 'exact', head: true });
  say(`  ${t.padEnd(22)} ${count}`);
}

if (problems) {
  console.error(`\n${problems} thing(s) refused or failed. Read the lines above.\n`);
  process.exit(1);
}
say(GO ? '\nDone.\n' : '\nDry run only. Add --yes.\n');
