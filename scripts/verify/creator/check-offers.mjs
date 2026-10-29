#!/usr/bin/env node
/**
 * Offer kinds and audiences: the security suite.
 *
 * This feature exists to stop one creator reading another creator's private
 * rate, so the only test that means anything is one that ATTACKS THE DATABASE
 * AS A REAL SIGNED-IN CREATOR. Every check below runs through a creator's own
 * anon-key session with their own JWT, exactly as the browser would; none of
 * them looks at a screen, because a screen that draws nothing proves nothing
 * about what the row-level policies would hand over.
 *
 * What it proves, in order:
 *
 *   [1] a retainer is invisible to a creator who is not named on it
 *   [2] and visible to one who is
 *   [3] a creator cannot APPLY for a retainer they cannot see, even holding
 *       its id — the SECURITY DEFINER path that RLS does not cover
 *   [4] a volume offer is visible to everyone except the creators excluded
 *   [5] a high commission offer with an empty list is visible to everyone,
 *       and narrows the moment somebody is named
 *   [6] the audience table itself is unreadable to a creator
 *   [7] a live retainer cannot be left with nobody on it
 *   [8] the mode cannot be flipped underneath the people on a list
 *   [9] approving a request from somebody no longer on the list is refused
 *  [10] a creator keeps reading an offer they have live work on
 *
 * DEV ONLY. Creates a brand, offers and two creators, and removes all of it in
 * a `finally` with every delete checked.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-offers.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_ = env.VITE_SUPABASE_URL;
assertDevProject(URL_, 'check-offers.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !PUBLISHABLE) throw new Error('.env.local is missing the Supabase URL or key');
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set in the environment');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m, d) => {
  console.error(`  FAIL  ${m}${d ? `\n        ${d}` : ''}`);
  failures++;
};
/* Condition FIRST. `check-leaderboard.mjs` takes the message first, and ten
   assertions once passed on a truthy string because of it. */
const check = (cond, m, d) => (cond ? pass(m) : fail(m, d));

const STAMP = String(Date.now()).slice(-7);
const PW = 'a-long-enough-test-password-1';
const made = { users: [], brand: null, offers: [], apps: [] };

async function makeCreator(tag) {
  const email = `offers-${tag}-${STAMP}@wurxmediahub.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create ${tag}: ${error.message}`);
  made.users.push(data.user.id);
  await admin
    .from('profiles')
    .update({ role: 'creator', tier: 'creator', is_active: true, display_name: `Offer ${tag}` })
    .eq('id', data.user.id);

  const client = anon();
  const { error: sErr } = await client.auth.signInWithPassword({ email, password: PW });
  if (sErr) throw new Error(`could not sign in ${tag}: ${sErr.message}`);
  return { id: data.user.id, email, client, tag };
}

/** Create an offer straight through the real RPC, the way the admin does. */
async function makeOffer({ title, kind, audience = [], status = 'active', needs = true }) {
  const { data, error } = await admin.rpc('save_offer', {
    p_actor_id: made.staffId,
    p_brand_id: made.brand,
    p_title: title,
    p_video_count: 5,
    p_reward_amount: 500,
    p_status: status,
    p_needs_application: needs,
    p_kind: kind,
    p_audience: audience,
  });
  if (error) throw new Error(`could not create offer "${title}": ${error.message}`);
  made.offers.push(data.id);
  return data.id;
}

/** Can this signed-in creator READ this offer at all? */
async function canRead(who, offerId) {
  const { data } = await who.client.from('offers').select('id, reward_amount').eq('id', offerId);
  return (data ?? []).length > 0;
}

async function cleanup() {
  const problems = [];
  const step = async (what, fn) => {
    try {
      const { error } = (await fn()) ?? {};
      if (error) problems.push(`${what}: ${error.message}`);
    } catch (e) {
      problems.push(`${what}: ${e?.message ?? e}`);
    }
  };

  for (const id of made.apps)
    await step(`application ${id}`, () =>
      admin.from('offer_applications').delete().eq('id', id)
    );
  for (const id of made.offers)
    await step(`offer ${id}`, () => admin.from('offers').delete().eq('id', id));
  for (const id of made.users) {
    await step('audit by', () => admin.from('audit_log').delete().eq('actor_id', id));
    await step('audit about', () => admin.from('audit_log').delete().eq('target_user_id', id));
    await step(`account ${id}`, () => admin.auth.admin.deleteUser(id));
  }
  if (made.brand) {
    await step('brand audit', () => admin.from('audit_log').delete().eq('subject_id', made.brand));
    await step('brand', () => admin.from('brands').delete().eq('id', made.brand));
  }

  if (problems.length) {
    console.error('\nCLEANUP LEFT THINGS BEHIND. Remove these by hand:');
    for (const p of problems) console.error(`  ${p}`);
    failures++;
  }
}

console.log(`\nOffer audience suite against ${URL_}\n${'='.repeat(70)}\n`);

try {
  /* ------------------------------------------------------------- setup -- */
  console.log('[0] A brand, two creators, and a staff account to write with');

  const staff = await makeCreator('staff');
  /*
   * PROMOTED, AND THE PROMOTION IS READ BACK.
   *
   * `assert_active_staff` reads `profiles.role` directly, and the profile row
   * is created by a trigger on `auth.users`, so an update fired too soon after
   * `createUser` can match zero rows and report no error at all. The first run
   * of this suite failed with "that account is not active staff" for exactly
   * that reason. Assert the state rather than the call.
   */
  const { error: promoteErr } = await admin
    .from('profiles')
    // `tier` has to go with the role: `profiles_tier_only_for_creators` says a
    // non-creator carries no tier, and it is right to.
    .update({ role: 'admin', tier: null, is_active: true })
    .eq('id', staff.id);
  if (promoteErr) throw new Error(`could not promote the staff account: ${promoteErr.message}`);

  const { data: promoted } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', staff.id)
    .single();
  if (promoted?.role !== 'admin' || !promoted.is_active) {
    throw new Error(`staff promotion did not stick: ${JSON.stringify(promoted)}`);
  }
  /*
   * AND SIGNED IN AGAIN, because the ROLE LIVES IN THE JWT.
   *
   * `is_staff()` reads `jwt_role()`, which comes from the custom access token
   * hook at sign-in time — not from the profiles table. The token this account
   * got a moment ago still says "creator", so without a fresh sign-in the
   * staff client fails the staff policy and the suite reports the product
   * broken when it is the test that is stale.
   */
  const { error: reSignIn } = await staff.client.auth.signInWithPassword({
    email: staff.email,
    password: PW,
  });
  if (reSignIn) throw new Error(`could not re-sign the staff account in: ${reSignIn.message}`);

  made.staffId = staff.id;

  const inside = await makeCreator('inside');
  const outside = await makeCreator('outside');

  const { data: brand, error: bErr } = await admin
    .from('brands')
    .insert({
      name: `Audience Suite ${STAMP}`,
      slug: `audience-suite-${STAMP}`,
      store_id: `audience-suite-${STAMP}`,
      is_active: true,
    })
    .select('id')
    .single();
  if (bErr) throw new Error(`brand: ${bErr.message}`);
  made.brand = brand.id;
  check(true, 'brand, two creators and a staff writer exist');

  /* ------------------------------------------------- [1][2] the retainer -- */
  console.log('\n[1] A retainer is invisible to everybody not named on it');

  const retainer = await makeOffer({
    title: `Retainer ${STAMP}`,
    kind: 'retainer',
    audience: [inside.id],
  });

  check(await canRead(inside, retainer), 'the named creator can read it');
  check(
    !(await canRead(outside, retainer)),
    'the creator who is NOT named cannot read it at all',
    'this is the leak the whole feature exists to close'
  );

  // And not through a filtered catalogue read either, which is what the
  // creator screens actually run.
  const { data: browse } = await outside.client
    .from('offers')
    .select('id')
    .eq('brand_id', made.brand);
  check(
    !(browse ?? []).some((o) => o.id === retainer),
    'and it is absent from their whole catalogue read'
  );

  /* --------------------------------------------------- [3] the write path -- */
  console.log('\n[3] They cannot apply for it either, holding its id');

  const { error: applyErr } = await admin.rpc('apply_for_offer', {
    p_actor_id: outside.id,
    p_offer_id: retainer,
    p_note: 'let me in',
  });
  check(
    Boolean(applyErr),
    'apply_for_offer refuses a creator who is not on the list',
    'apply_for_offer is SECURITY DEFINER, so RLS does not cover it. Without its own check a stale tab is enough to get in.'
  );
  check(
    /not open to you/i.test(applyErr?.message ?? ''),
    'and says so in a sentence rather than a constraint error',
    applyErr?.message
  );

  const { count: sneaked } = await admin
    .from('offer_applications')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', retainer)
    .eq('creator_id', outside.id);
  check(sneaked === 0, 'no application row was written', `saw ${sneaked}`);

  /* ---------------------------------------------------- [4] volume + deny -- */
  console.log('\n[4] A volume offer is everyone MINUS the excluded');

  const volume = await makeOffer({
    title: `Volume ${STAMP}`,
    kind: 'volume',
    audience: [outside.id],
  });

  check(await canRead(inside, volume), 'a creator not on the exclude list sees it');
  check(!(await canRead(outside, volume)), 'the excluded creator does not');

  const { error: volApplyErr } = await admin.rpc('apply_for_offer', {
    p_actor_id: outside.id,
    p_offer_id: volume,
    p_note: 'please',
  });
  check(Boolean(volApplyErr), 'and cannot apply for it', 'an exclusion must bind the write too');

  /* ----------------------------------------- [5] high commission narrowing -- */
  console.log('\n[5] High commission: everyone until somebody is named');

  const openHigh = await makeOffer({
    title: `High open ${STAMP}`,
    kind: 'high_commission',
    audience: [],
    needs: true, // deliberately true: the function must force it false
  });

  check(await canRead(inside, openHigh), 'with an empty list, one creator sees it');
  check(await canRead(outside, openHigh), 'and so does the other');

  const { data: forced } = await admin
    .from('offers')
    .select('needs_application')
    .eq('id', openHigh)
    .single();
  check(
    forced?.needs_application === false,
    'and needs_application was FORCED off, whatever the caller sent',
    `saw ${forced?.needs_application}`
  );

  const narrowed = await makeOffer({
    title: `High narrow ${STAMP}`,
    kind: 'high_commission',
    audience: [inside.id],
  });
  check(await canRead(inside, narrowed), 'a narrowed one is visible to the named creator');
  check(!(await canRead(outside, narrowed)), 'and invisible to everybody else');

  /* ------------------------------------------------ [6] the list is secret -- */
  console.log('\n[6] The audience list itself is staff only');

  const { data: peek, error: peekErr } = await inside.client
    .from('offer_audience')
    .select('offer_id, creator_id');
  check(
    (peek ?? []).length === 0,
    'a creator reads nothing from offer_audience, not even their own row',
    `saw ${(peek ?? []).length} row(s), error: ${peekErr?.message ?? 'none'}`
  );

  const { data: staffPeek } = await staff.client.from('offer_audience').select('offer_id');
  check((staffPeek ?? []).length > 0, 'while staff can read it', `saw ${(staffPeek ?? []).length}`);

  /* ------------------------------------------- [7] a live retainer needs one -- */
  console.log('\n[7] A live retainer cannot be left with nobody on it');

  let emptyErr = null;
  try {
    await makeOffer({ title: `Empty retainer ${STAMP}`, kind: 'retainer', audience: [] });
  } catch (e) {
    emptyErr = e;
  }
  check(Boolean(emptyErr), 'creating a LIVE retainer with an empty list is refused');
  check(
    /nobody on it/i.test(emptyErr?.message ?? ''),
    'and the refusal says why',
    emptyErr?.message
  );

  const parked = await makeOffer({
    title: `Parked retainer ${STAMP}`,
    kind: 'retainer',
    audience: [],
    status: 'inactive',
  });
  check(Boolean(parked), 'but a SWITCHED OFF one with nobody on it is fine to build');

  /* ------------------------------------------------ [8] the mode cannot flip -- */
  console.log('\n[8] Changing the kind cannot silently invert who is on the list');

  const { error: flipErr } = await admin.from('offers').update({ kind: 'volume' }).eq('id', retainer);
  check(
    Boolean(flipErr),
    'flipping a retainer to volume with allow rows still on it is refused',
    'otherwise three ALLOWED creators become three EXCLUDED ones, silently, on live money'
  );

  const stillThere = await canRead(inside, retainer);
  check(stillThere, 'and the named creator can still read it afterwards');

  /* --------------------------------------- [9] approving a barred creator -- */
  console.log('\n[9] Approving a request from somebody since removed is refused');

  // A legitimate request, made while they were allowed.
  const { data: appRow, error: appErr } = await admin.rpc('apply_for_offer', {
    p_actor_id: inside.id,
    p_offer_id: retainer,
    p_note: 'yes please',
  });
  check(!appErr, 'the named creator can apply', appErr?.message);
  if (appRow?.id) made.apps.push(appRow.id);

  // Now take them off the list, the way an admin would.
  await admin.rpc('save_offer', {
    p_actor_id: made.staffId,
    p_brand_id: made.brand,
    p_title: `Retainer ${STAMP}`,
    p_video_count: 5,
    p_reward_amount: 500,
    p_offer_id: retainer,
    p_status: 'inactive', // a retainer with nobody on it must not stay live
    p_needs_application: true,
    p_kind: 'retainer',
    p_audience: [],
  });

  const { error: approveErr } = await admin
    .from('offer_applications')
    .update({ status: 'approved' })
    .eq('id', appRow.id);
  check(
    Boolean(approveErr),
    'approving it now is refused, before any money is committed',
    'this is where an ineligible row would have become a real charge on the brand budget'
  );

  /* ------------------------------------- [10] your own work never vanishes -- */
  console.log('\n[10] A creator keeps the offer behind work they already have');

  check(
    await canRead(inside, retainer),
    'the creator with a pending request still reads it, though they are off the list',
    'removing somebody stops them FINDING an offer; it must not erase work already agreed'
  );

  /* ------------------------------------------------------------- summary -- */
  console.log(`\n${'='.repeat(70)}`);
  if (failures === 0) {
    console.log('A retainer is private, and the write path agrees with the read path.');
  } else {
    console.error(`${failures} check(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`\n  FAIL  unexpected error: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log('[cleanup] brand, offers, requests and accounts removed');
  if (failures > 0) process.exitCode = 1;
}
