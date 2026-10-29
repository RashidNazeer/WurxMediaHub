#!/usr/bin/env node
/**
 * DEV ONLY. Empties the creator side of the product: every creator and
 * applicant account, every offer, every contest.
 *
 * WHY IT EXISTS. Rashid, 2026-08-19: "delete every creator and all its videos
 * and everything, remove all offers, we will add fresh". The per-seed `--clean`
 * flags only remove what that seed made, which leaves everything created by
 * hand through the real screens behind, quietly muddying the next test.
 *
 * WHAT SURVIVES, deliberately:
 *   brands and their products   the containers the new offers will hang off
 *   staff and admin accounts    including Rashid's, and whoever approvals name
 *   audit_log                   a history that can be erased by whoever is
 *                               tidying up is not a history
 *   tiktok_video_daily          see below, this is the valuable one
 *
 * THE TIKTOK HISTORY SURVIVES ON PURPOSE, and it is worth understanding why it
 * can. That table has no foreign key to a person at all: its primary key is
 * (item_id, stat_date) and its only reference is to the ad account. The first
 * run of this proved it: 5,294 video-days of real cost and GMV sat untouched
 * while every creator who owned them was deleted, and the moment the same video
 * links are submitted again those figures reappear with no TikTok API call.
 *
 * The link back to a person is `content_submissions.embed_id`, which DOES
 * cascade away with the account, so this script writes
 * every handle-to-video mapping out to a file first. Without that file the
 * money is still in the database and nothing remembers whose it was.
 *
 * ORDER IS NOT ARBITRARY. Contests go before accounts because of a trap that no
 * foreign-key audit finds: `contest_exclusions.user_id` is ON DELETE SET NULL,
 * and the table carries `check (handle is not null or email is not null or
 * user_id is not null)`. Postgres performs the SET NULL, then re-evaluates the
 * CHECK, and if that user_id was the only identifier left the whole delete
 * ABORTS. Mid-loop, with some accounts gone and some not. Deleting the contests
 * first takes the exclusions with them, and the preflight below proves it.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/wipe-clean-slate.mjs --yes
 *   ... --yes --out <path>     where to write the video mapping
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDevProject } from '../lib/dev-guard.mjs';

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) {
  console.error(
    '\nSUPABASE_SERVICE_KEY is not set. Fetch it at run time from the CLI, never\n' +
      'from a file. See docs/OPERATIONS.md.\n'
  );
  process.exit(1);
}

/*
 * `indexOf('=')` and not `split('=')`: every Supabase key is a JWT and JWTs
 * contain '='. Splitting on all of them truncates the value. The '#' filter
 * matters too, because Object.fromEntries keeps the LAST occurrence, so a
 * commented-out duplicate would silently win.
 */
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Before the client exists. A positive match on the dev project, never a
// blocklist: a typo matching neither would sail straight through one of those.
assertDevProject(env.VITE_SUPABASE_URL, 'wipe-clean-slate.mjs');

if (!process.argv.includes('--yes')) {
  console.error(
    '\nThis deletes EVERY creator and applicant account, EVERY offer and EVERY\n' +
      'contest on dev. It cannot be undone.\n\n' +
      'Re-run with --yes if that is what you want.\n'
  );
  process.exit(1);
}

const outFlag = process.argv.indexOf('--out');
const OUT =
  outFlag > -1 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : join(tmpdir(), 'wurx-clean-slate-capture.json');

const db = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

/** PostgREST refuses an unfiltered delete, so every wipe needs a filter that matches everything. */
const NO_SUCH_ID = '00000000-0000-0000-0000-000000000000';

const COUNTED = [
  'offers',
  'offer_applications',
  'offer_stage_events',
  'content_submissions',
  'applications',
  'profiles',
  'brands',
  'brand_products',
  'contests',
  'contest_entries',
  'contest_submissions',
  'contest_awards',
  'contest_progress_updates',
  'contest_exclusions',
  'audit_log',
  'tiktok_video_daily',
];

async function countAll() {
  const out = {};
  for (const table of COUNTED) {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
    out[table] = error ? `error: ${error.message}` : (count ?? 0);
  }
  return out;
}

const show = (label, counts) => {
  console.log(`\n${label}`);
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${String(n).padStart(6)}  ${table}`);
  }
};

console.log(`\nClean slate against ${env.VITE_SUPABASE_URL}\n${'='.repeat(70)}`);

const before = await countAll();
show('Before', before);

/* ------------------------------------------------- 1. who is being deleted -- */
/*
 * The list comes from `profiles.role`, never from an email domain and never
 * from auth.admin.listUsers, whose default page is 50: a wipe that iterated one
 * page would leave accounts behind and print a confident total.
 */
const targets = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('profiles')
    .select('id, email, display_name, role')
    .in('role', ['applicant', 'creator'])
    .order('created_at')
    .range(from, from + 999);
  if (error) throw new Error(`could not list creators: ${error.message}`);
  targets.push(...data);
  if (data.length < 1000) break;
}

const staffBefore = await db
  .from('profiles')
  .select('*', { count: 'exact', head: true })
  .in('role', ['creative_strategist', 'ops', 'admin']);

console.log(
  `\n  ${targets.length} creator/applicant accounts to delete, ` +
    `${staffBefore.count ?? 0} staff accounts to keep`
);

if (targets.length === 0)
  console.log('  (nothing to delete, carrying on to offers and contests)');

const ids = targets.map((t) => t.id);

/* --------------------------------------- 2. capture what cannot be rebuilt -- */
/*
 * `embed_id` is the ONLY thing that connects a person to their TikTok money.
 * The money survives this script; the connection does not. Written outside the
 * repo, because it is a working file and not a source file.
 */
let capture = { videos: [], exclusions: [], writtenAt: new Date().toISOString() };

if (ids.length) {
  const { data: subs, error: subErr } = await db
    .from('content_submissions')
    .select('creator_id, embed_id, video_url, created_at')
    .in('creator_id', ids);
  if (subErr) throw new Error(`could not read content submissions: ${subErr.message}`);

  const handleFor = new Map(targets.map((t) => [t.id, t.display_name ?? t.email]));
  capture.videos = (subs ?? []).map((s) => ({
    handle: handleFor.get(s.creator_id) ?? s.creator_id,
    embed_id: s.embed_id,
    video_url: s.video_url,
    submitted_at: s.created_at,
  }));

  const { data: bans } = await db
    .from('contest_exclusions')
    .select('contest_id, user_id, handle, email')
    .in('user_id', ids);
  capture.exclusions = bans ?? [];
}

writeFileSync(OUT, JSON.stringify(capture, null, 2));
console.log(
  `\n  captured ${capture.videos.length} video links and ${capture.exclusions.length} exclusions`
);
console.log(`  -> ${OUT}`);

/* ---------------------------------------------------------- 3. the offers -- */
/*
 * One parent delete. offer_applications, offer_stage_events and
 * content_submissions all cascade from it, and doing it before the accounts
 * means offers nobody ever applied to go too.
 *
 * NOT the delete_offer() RPC, which raises 23503 for any offer with a pending
 * or approved request. That guard is right for an admin clicking a button and
 * wrong for a clean slate.
 */
const delOffers = await db.from('offers').delete({ count: 'exact' }).neq('id', NO_SUCH_ID);
if (delOffers.error) throw new Error(`deleting offers failed: ${delOffers.error.message}`);
console.log(`\n  offers deleted: ${delOffers.count ?? 0}`);

/* -------------------------------------------------------- 4. the contests -- */
const delContests = await db.from('contests').delete({ count: 'exact' }).neq('id', NO_SUCH_ID);
if (delContests.error)
  throw new Error(`deleting contests failed: ${delContests.error.message}`);
console.log(`  contests deleted: ${delContests.count ?? 0}`);

/* --------------------------------- 5. preflight the CHECK-constraint traps -- */
/*
 * Five columns are ON DELETE SET NULL underneath a CHECK that the null would
 * break. Contests going first should have cleared all of them; this proves it
 * rather than hoping, because the failure mode is an abort part way through the
 * account loop.
 */
if (ids.length) {
  const blockers = [];

  const lastBan = await db
    .from('contest_exclusions')
    .select('*', { count: 'exact', head: true })
    .in('user_id', ids)
    .is('handle', null)
    .is('email', null);
  if (lastBan.count)
    blockers.push(`contest_exclusions barred by account only: ${lastBan.count}`);

  for (const [table, column] of [
    ['contests', 'settled_by'],
    ['contests', 'cancelled_by'],
    ['contest_progress_updates', 'confirmed_by'],
    ['contest_awards', 'paid_by'],
  ]) {
    const { count } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, ids);
    if (count) blockers.push(`${table}.${column}: ${count}`);
  }

  if (blockers.length) {
    console.error(
      `\nSTOPPING BEFORE THE ACCOUNTS.\n\n` +
        `These rows would be set to null by the delete and then fail their own\n` +
        `CHECK constraint, aborting part way through:\n\n` +
        blockers.map((b) => `  ${b}`).join('\n') +
        `\n\nClear them first. Nothing has been deleted except offers and contests.\n`
    );
    process.exit(1);
  }
  console.log('  preflight: no CHECK constraint can abort the account delete');
}

/* -------------------------------------------------------- 6. the accounts -- */
/*
 * Deleting the auth user is the whole thing: profiles cascades from it, and
 * applications, offer_applications, content_submissions, contest_entries and
 * the rest cascade from profiles. Staff references (reviewed_by, awarded_by,
 * actor_id) are SET NULL, so no admin account is touched.
 *
 * The error is read on EVERY call. A sibling script discards it and prints
 * "removed" unconditionally, which is how a bulk delete reports success for
 * accounts that are still there.
 */
/*
 * THE TIKTOK IDENTITY LEDGER DOES NOT CASCADE, AND THAT IS DELIBERATE.
 *
 * `tiktok_identities.profile_id` is ON DELETE SET NULL, because a claim has to
 * outlive the account — otherwise deleting a creator would quietly unbar the
 * TikTok account they applied with, and "one TikTok, one application" would be
 * one account deletion away from meaningless.
 *
 * On DEV that is exactly wrong for a clean slate: wipe the creators, and the
 * next person to connect the SAME TikTok account is refused by a claim whose
 * owner no longer exists. Rashid met this on 2026-09-04 with his own account
 * and it looks like a bug rather than the rule working. So the wipe releases
 * every claim belonging to an account it is about to delete — released, not
 * deleted, so the history is still readable.
 */
if (ids.length) {
  const { data: freed, error: freeErr } = await db
    .from('tiktok_identities')
    .update({
      released_at: new Date().toISOString(),
      release_reason: 'Released by the dev clean-slate wipe: the account that claimed it was removed.',
    })
    .in('profile_id', ids)
    .is('released_at', null)
    .select('id');
  if (freeErr) throw new Error(`could not release TikTok claims: ${freeErr.message}`);
  console.log(`\n  released ${(freed ?? []).length} TikTok identity claim(s) so the accounts can be used again`);
}

let deleted = 0;
const failures = [];

for (const person of targets) {
  const { error } = await db.auth.admin.deleteUser(person.id);
  if (error) failures.push(`${person.email}: ${error.message}`);
  else deleted += 1;
  if (deleted % 10 === 0 && deleted) process.stdout.write(`  ${deleted} deleted\r`);
}

console.log(`\n  accounts deleted: ${deleted}/${targets.length}`);
for (const f of failures.slice(0, 10)) console.error(`    FAILED  ${f}`);

/* ------------------------------------------------------------- 7. proof --- */
const after = await countAll();
show('After', after);

const mustBeZero = [
  'offers',
  'offer_applications',
  'offer_stage_events',
  'content_submissions',
  'applications',
  'contests',
  'contest_entries',
  'contest_submissions',
  'contest_awards',
  'contest_progress_updates',
  'contest_exclusions',
];

let bad = 0;
for (const table of mustBeZero) {
  if (after[table] !== 0) {
    console.error(
      `\n  FAIL  ${table} still holds ${after[table]} rows. A cascade did not fire.`
    );
    bad += 1;
  }
}

const staffAfter = await db
  .from('profiles')
  .select('*', { count: 'exact', head: true })
  .in('role', ['creative_strategist', 'ops', 'admin']);

if (staffAfter.count !== staffBefore.count) {
  console.error(
    `\n  FAIL  staff accounts went from ${staffBefore.count} to ${staffAfter.count}. ` +
      `That was never the intent.`
  );
  bad += 1;
}
if (after.brands !== before.brands) {
  console.error(`\n  FAIL  brands went from ${before.brands} to ${after.brands}.`);
  bad += 1;
}
if (after.tiktok_video_daily !== before.tiktok_video_daily) {
  console.error(
    `\n  FAIL  tiktok_video_daily went from ${before.tiktok_video_daily} to ` +
      `${after.tiktok_video_daily}. The ad history was supposed to survive.`
  );
  bad += 1;
}
if (after.audit_log !== before.audit_log) {
  console.error(`\n  FAIL  audit_log changed. It is never touched.`);
  bad += 1;
}

console.log(`\n${'='.repeat(70)}`);
if (bad || failures.length) {
  console.error(`\n${bad + failures.length} problem(s). Do not assume this worked.\n`);
  process.exit(1);
}
console.log(
  `\n  Clean. ${deleted} accounts, ${delOffers.count ?? 0} offers and ` +
    `${delContests.count ?? 0} contests gone.\n` +
    `  Brands, staff, the audit log and ${after.tiktok_video_daily} video-days of\n` +
    `  TikTok history are untouched.\n\n` +
    `  Next: node scripts/ops/reconcile-budgets.mjs   (brand budgets still name the deleted offers)\n`
);
