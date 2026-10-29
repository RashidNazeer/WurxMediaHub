#!/usr/bin/env node
/**
 * DEV ONLY. Creates Wurx's 41 real creators from the backend, each carrying
 * exactly what a real registration would have produced.
 *
 * WHY FROM THE BACKEND. Rashid gave 41 real TikTok handles on 2026-08-19 and
 * asked for the accounts to exist without anybody filling in 41 forms. The
 * point is that they must be INDISTINGUISHABLE from creators who applied and
 * were approved: same rows, same columns, same approval path, no half state.
 *
 * SO IT WALKS THE REAL PATH, not a shortcut:
 *
 *   1. `auth.admin.createUser` with `display_name` in the metadata, because
 *      that is the one key `handle_new_user()` reads, and the real form puts
 *      the TikTok handle there (ApplyForm.tsx). Omit it and every profile is
 *      nameless.
 *   2. The trigger writes `profiles` (id, email, display_name), role
 *      'applicant', tier null. Nothing else may insert into that table: there
 *      is no INSERT policy and no INSERT grant.
 *   3. An `applications` row with the same six columns the browser writes.
 *      Without it the creator home decides they never applied and shows the
 *      "finish your application" screen even though the role says creator.
 *   4. `review_application()`, the same Postgres function the admin Review
 *      screen reaches through its Edge Function. It moves status, role, tier
 *      and the audit row together, in one transaction. Setting those columns
 *      by hand instead would produce a creator nobody ever let in, and an
 *      Activity screen where 41 people appear from nowhere.
 *   5. The two onboarding stamps, so they are OLD creators. Leave
 *      `approval_celebrated_at` null and every one of them gets the
 *      you-are-approved celebration on first sign-in. That is the exact half
 *      state Rashid reported the last time creators were seeded.
 *
 * WHAT RASHID CHOSE, 2026-08-19:
 *   email     <handle>@wurxmedia.com, because the handles are unique so the
 *             addresses are too, and nothing has to be invented
 *   password  1234567890 for all of them. Exactly PASSWORD_MIN (10), so the
 *             real sign-in form accepts it as well as the server
 *   state     approved creators, nothing pending
 *   tier      Creator, the starting tier, for all 41
 *
 * VIDEO LINKS: he said to skip them, but `applications.video_links` is NOT NULL
 * with a length check and must contain a link, so it cannot be skipped. Each
 * one gets their own TikTok profile URL, which is true, derived only from the
 * handle he gave, and useful to an admin who clicks it.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-creators.mjs
 *   ... --clean     removes only these 41 accounts again
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

/* ------------------------------------------------------------- the people -- */
/** Rashid's list, verbatim and in his order. */
const HANDLES = [
  'xxkissnoblissxx',
  'babblingbrookej',
  'aarontopfinds',
  'blahitsmebri',
  'nikkistiktokshop',
  'lowbacklab',
  'honestfindswithjen',
  'simplysarah.daily',
  'deal.dasher1',
  'vsternau',
  'briceyscarbear',
  'erinragancooper',
  'betterbybrian',
  'daniloshopfinds',
  'kylieehughess',
  'gmoneyh0',
  'edvivesshop',
  'premiumpicks.1',
  'lhdeals4225',
  'sassy_relatable',
  'slavicglowupsecrets',
  'jayden_smith4',
  'hilary_reviews',
  'viraldealshunter',
  'niknak2188',
  'norms.finds',
  'holistic.rx',
  'jeniffersaluzzo',
  'pricejustdropped',
  'vivianiempire_',
  'dannydailyfinds',
  'willzzshop',
  'luisferdeals',
  'ka.devore',
  'neptunenavigates',
  'morgansocialco',
  'pandanamonium',
  'anti_job_aholic',
  'johnhidalgo26',
  'life_w_boyz',
  'sarahshopsss',
];

const DOMAIN = 'wurxmedia.com';
const PASSWORD = '1234567890';
const TIER = 'creator';

/*
 * The nine real niches, copied from src/lib/schemas/application-fields.ts.
 * "Other" is excluded on purpose: picking it would need a `niche_other` string
 * invented for somebody, and the database does NOT validate this column at all
 * (only its length), so a value the real form could never produce would land
 * silently and look genuine forever.
 */
const NICHES = [
  'Beauty & skincare',
  'Health & wellness',
  'Fitness & recovery',
  'Home & kitchen',
  'Fashion & accessories',
  'Food & beverage',
  'Baby & kids',
  'Pets',
  'Tech & gadgets',
];

/* ------------------------------------------------------------------ setup -- */
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) {
  console.error(
    '\nSUPABASE_SERVICE_KEY is not set. Fetch it at run time from the CLI, never\n' +
      'from a file. See docs/OPERATIONS.md.\n'
  );
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Creates and deletes accounts. Dev only, checked before the client exists.
assertDevProject(env.VITE_SUPABASE_URL, 'seed-creators.mjs');

const db = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const CLEAN = process.argv.includes('--clean');

const emailFor = (handle) => `${handle}@${DOMAIN}`;

/*
 * Deterministic, so two runs produce identical people and a re-run is a top-up
 * rather than a reshuffle. Math.random() would make the seed unreproducible and
 * every screenshot a different set of facts.
 */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/*
 * "50 percent have already worked with Wurx." Taken as EXACTLY 21 of 41 rather
 * than a coin flip per person, which would land somewhere near half and never
 * on it. Chosen by hash order, so which 21 is stable but not the order he typed
 * them in.
 */
const WORKED_WITH_WURX = new Set(
  [...HANDLES].sort((a, b) => hash(`worked:${a}`) - hash(`worked:${b}`)).slice(0, 21)
);

const DAY = 24 * 60 * 60 * 1000;

/** Spread joining dates over the last few months so nobody looks minted today. */
function datesFor(handle) {
  const appliedDaysAgo = 30 + (hash(`applied:${handle}`) % 150); // 30-179 days
  const waitedDays = 1 + (hash(`waited:${handle}`) % 6); // reviewed 1-6 days later
  const applied = new Date(Date.now() - appliedDaysAgo * DAY);
  const reviewed = new Date(applied.getTime() + waitedDays * DAY);
  return { applied, reviewed };
}

/* ------------------------------------------------------------------ clean -- */
if (CLEAN) {
  console.log(`\nRemoving the ${HANDLES.length} seeded creators\n${'='.repeat(70)}\n`);

  const emails = HANDLES.map(emailFor);
  const { data: rows, error } = await db
    .from('profiles')
    .select('id, email, role')
    .in('email', emails);
  if (error) throw new Error(`could not read the seeded profiles: ${error.message}`);

  /*
   * Role is checked as well as the address. Rashid's own account is on this
   * domain, and a --clean that could delete the product owner because his email
   * matched a pattern is not a cleanup, it is a loaded gun.
   */
  const safe = (rows ?? []).filter((r) => r.role === 'creator' || r.role === 'applicant');
  const skipped = (rows ?? []).length - safe.length;

  let removed = 0;
  const failed = [];
  for (const row of safe) {
    const { error: delErr } = await db.auth.admin.deleteUser(row.id);
    if (delErr) failed.push(`${row.email}: ${delErr.message}`);
    else removed += 1;
  }

  console.log(`  ${removed} removed`);
  if (skipped) console.log(`  ${skipped} left alone (not a creator or applicant)`);
  for (const f of failed) console.error(`  FAILED  ${f}`);
  console.log('');
  process.exit(failed.length ? 1 : 0);
}

/* ------------------------------------------------------- who approves them -- */
/*
 * A real approval is somebody's decision, and review_application refuses an
 * actor who is not active staff. Rashid's own account first, because these are
 * his creators; any active admin otherwise.
 */
const { data: staff, error: staffErr } = await db
  .from('profiles')
  .select('id, email, role, is_active')
  .in('role', ['admin', 'ops'])
  .eq('is_active', true)
  .order('created_at');
if (staffErr) throw new Error(`could not find an approver: ${staffErr.message}`);

const actor =
  (staff ?? []).find((s) => s.email === `rashid@${DOMAIN}`) ??
  (staff ?? []).find((s) => s.role === 'admin') ??
  (staff ?? [])[0];

if (!actor) {
  console.error(
    '\nNo active admin or ops account exists, so nobody can approve these\n' +
      'applications. Make one with scripts/ops/create-admin.mjs first.\n'
  );
  process.exit(1);
}

console.log(`\nSeeding ${HANDLES.length} creators into ${env.VITE_SUPABASE_URL}`);
console.log(`${'='.repeat(70)}`);
console.log(`  approved by ${actor.email} (${actor.role})`);
console.log(`  password for all: ${PASSWORD}\n`);

/* ------------------------------------------------------------------ build -- */
let created = 0;
let reused = 0;
const problems = [];

for (const [index, handle] of HANDLES.entries()) {
  const email = emailFor(handle);
  const niche = NICHES[hash(`niche:${handle}`) % NICHES.length];
  const worked = WORKED_WITH_WURX.has(handle);
  const { applied, reviewed } = datesFor(handle);
  const label = `${String(index + 1).padStart(2)}/${HANDLES.length}  ${handle.padEnd(20)}`;

  try {
    /* -- 1. the account ---------------------------------------------------- */
    let userId = null;
    const { data: made, error: makeErr } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      // The ONLY metadata key the trigger reads. The real form puts the handle
      // here, so this does too.
      user_metadata: { display_name: handle },
    });

    if (makeErr) {
      // Already there from an earlier run: find them and carry on, so this is a
      // top-up rather than a failure.
      const { data: existing } = await db
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      if (!existing) throw new Error(`could not create the account: ${makeErr.message}`);
      userId = existing.id;
      reused += 1;
    } else {
      userId = made.user.id;
      created += 1;
    }

    /* -- 2. wait for the trigger ------------------------------------------- */
    /*
     * `handle_new_user` runs AFTER INSERT on auth.users. Updating profiles
     * before the row exists matches zero rows, returns NO error and reports
     * success, so this reads it back rather than sleeping on a guess.
     */
    let profileReady = false;
    for (let attempt = 0; attempt < 20 && !profileReady; attempt++) {
      const { data } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (data) profileReady = true;
      else await new Promise((r) => setTimeout(r, 150));
    }
    if (!profileReady) throw new Error('the profile row never appeared');

    /* -- 3. the application ------------------------------------------------ */
    const { data: already } = await db
      .from('applications')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle();

    let applicationId = already?.id ?? null;

    if (!applicationId) {
      // The same six columns the browser writes, and nothing else. Status,
      // reviewer and dates are staff columns and are set by the approval below.
      const { data: app, error: appErr } = await db
        .from('applications')
        .insert({
          user_id: userId,
          tiktok_handle: handle,
          niche,
          niche_other: null,
          worked_with_wurx: worked,
          video_links: `https://www.tiktok.com/@${handle}`,
        })
        .select('id')
        .single();
      if (appErr) throw new Error(`application insert failed: ${appErr.message}`);
      applicationId = app.id;
    }

    /* -- 4. a real approval ------------------------------------------------ */
    if (already?.status !== 'approved') {
      const { error: rpcErr } = await db.rpc('review_application', {
        p_application_id: applicationId,
        p_decision: 'approved',
        p_actor_id: actor.id,
        p_tier: TIER,
        p_note: null,
      });
      if (rpcErr) throw new Error(`approval failed: ${rpcErr.message}`);
    }

    /* -- 5. make them old -------------------------------------------------- */
    /*
     * Backdated so nobody looks minted this morning, and both onboarding stamps
     * filled in so no seeded creator is met by the you-are-approved celebration
     * on their first sign-in.
     *
     * NEVER name tiktok_handle in a profiles patch: the column does not exist,
     * and naming it discards the WHOLE patch and still returns success.
     */
    const { error: appDateErr } = await db
      .from('applications')
      .update({
        created_at: applied.toISOString(),
        updated_at: reviewed.toISOString(),
        reviewed_at: reviewed.toISOString(),
      })
      .eq('id', applicationId);
    if (appDateErr) throw new Error(`backdating the application failed: ${appDateErr.message}`);

    const { error: profErr } = await db
      .from('profiles')
      .update({
        created_at: applied.toISOString(),
        welcomed_at: reviewed.toISOString(),
        approval_celebrated_at: reviewed.toISOString(),
      })
      .eq('id', userId);
    if (profErr) throw new Error(`backdating the profile failed: ${profErr.message}`);

    /* -- 6. prove it ------------------------------------------------------- */
    /*
     * Read back rather than assume. The seed that shipped before this one
     * reported 4 creators and had in fact made 4 applicants with no tier,
     * because one bad column name silently voided every update.
     */
    const { data: check, error: checkErr } = await db
      .from('profiles')
      .select('role, tier, display_name, approval_celebrated_at')
      .eq('id', userId)
      .single();
    if (checkErr) throw new Error(`could not read the profile back: ${checkErr.message}`);
    if (check.role !== 'creator') throw new Error(`role is ${check.role}, not creator`);
    if (check.tier !== TIER) throw new Error(`tier is ${check.tier}, not ${TIER}`);
    if (check.display_name !== handle) throw new Error(`display name is ${check.display_name}`);
    if (!check.approval_celebrated_at)
      throw new Error('the approval celebration is still pending');

    console.log(
      `  ok  ${label}  ${niche.padEnd(22)} ${worked ? 'worked with Wurx' : 'new to Wurx'}`
    );
  } catch (e) {
    problems.push(`${handle}: ${e.message}`);
    console.error(`  FAIL ${label}  ${e.message}`);
  }
}

/* ----------------------------------------------------------------- proof --- */
const { count: creatorCount } = await db
  .from('profiles')
  .select('*', { count: 'exact', head: true })
  .eq('role', 'creator');

const { count: approvedCount } = await db
  .from('applications')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'approved');

const { count: pendingCount } = await db
  .from('applications')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'pending');

console.log(`\n${'='.repeat(70)}`);
console.log(`  ${created} created, ${reused} already existed`);
console.log(
  `  ${creatorCount} creators in the database, ${approvedCount} approved applications`
);
console.log(`  ${pendingCount} still pending (should be 0)`);
console.log(
  `  ${WORKED_WITH_WURX.size} of ${HANDLES.length} have worked with Wurx before ` +
    `(${Math.round((WORKED_WITH_WURX.size / HANDLES.length) * 100)}%)`
);
console.log(`\n  Sign in as any of them with ${PASSWORD}`);
console.log(`  e.g. ${emailFor(HANDLES[0])}\n`);

if (problems.length) {
  console.error(`  ${problems.length} did not finish:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  process.exit(1);
}
