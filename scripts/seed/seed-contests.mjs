#!/usr/bin/env node
/**
 * Test creators, entered into contests, so the standing has a field.
 *
 * "2nd closest of 5" needs five people. Dev has one creator account, so this
 * makes a handful of throwaway ones, walks them through the real functions
 * rather than inserting rows, and can take them all away again.
 *
 * Everything it makes is named so `--clean` can find exactly what it made and
 * nothing else. Never run this against prod.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-contests.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-contests.mjs --clean
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { assertDevProject } from '../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(env.VITE_SUPABASE_URL, 'seed-contests.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

/** Everything this script makes carries this, so --clean is exact. */
const SUFFIX = '@wurxmediahub.contest';
const PASSWORD = 'contest-demo-for-dev-only-1';

/**
 * Deliberately varied, because a field where everybody has done the same thing
 * proves nothing about a standing. The numbers are what each creator will claim
 * once progress exists; entering them is a later step in this script.
 */
const CREATORS = [
  { handle: 'mayaonmain', name: 'Maya Ellis' },
  { handle: 'thekitchenrun', name: 'Dev Patel' },
  { handle: 'nora.tries', name: 'Nora Whitfield' },
  { handle: 'bigsmallhaul', name: 'Tom Achebe' },
  { handle: 'quietcorner', name: 'Sasha Lindqvist' },
];

const clean = process.argv.includes('--clean');

/* ------------------------------------------------------------------ clean -- */

if (clean) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const mine = (users?.users ?? []).filter((u) => u.email?.endsWith(SUFFIX));

  console.log(`\nRemoving ${mine.length} contest test creator(s)\n`);
  for (const u of mine) {
    // Their entries, submissions and events go with the profile through the
    // foreign keys. The audit rows do not, so they are cleared by actor.
    await admin.from('audit_log').delete().eq('actor_id', u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`  removed  ${u.email}`);
  }
  console.log('\nDone.\n');
  process.exit(0);
}

/* ------------------------------------------------------------------- seed -- */

const { data: staff, error: staffErr } = await admin
  .from('profiles')
  .select('id, email')
  .in('role', ['admin', 'ops'])
  .eq('is_active', true)
  .limit(1)
  .maybeSingle();

if (staffErr || !staff) throw new Error('No active admin found. Run scripts/ops/create-admin.mjs first.');

const { data: contests, error: contestErr } = await admin
  .from('contests')
  .select('id, name, needs_admin_approval, status')
  .eq('status', 'active');

if (contestErr) throw contestErr;
if (!contests?.length) {
  console.log('\nNo ACTIVE contest to enter. Switch one on first, then run this again.\n');
  process.exit(0);
}

console.log(`\nSeeding contest creators into ${env.VITE_SUPABASE_URL}`);
console.log(`Acting as ${staff.email}, ${contests.length} active contest(s)\n`);

for (const c of CREATORS) {
  const email = `${c.handle.replace(/[^a-z0-9]/g, '')}${SUFFIX}`;

  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const already = (existing?.users ?? []).find((u) => u.email === email);

  let userId = already?.id;
  if (!userId) {
    const { data: made, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) {
      console.log(`  FAILED  ${c.handle}  ${error.message}`);
      continue;
    }
    userId = made.user.id;
  }

  // Straight to an approved creator. The application flow has its own seed
  // script and is not what this one is testing.
  const { error: profileErr } = await admin
    .from('profiles')
    .update({ role: 'creator', tier: 'creator', is_active: true, display_name: c.name })
    .eq('id', userId);

  if (profileErr) {
    console.log(`  FAILED  ${c.handle}  ${profileErr.message}`);
    continue;
  }

  /*
   * The handle is NOT on the profile. It is typed on the application, and
   * `creator_directory` reads it by joining the two, so a creator with no
   * application row shows up everywhere in the admin panel with a blank handle.
   * That is what a real approved creator looks like, so the seed builds one.
   */
  const { data: hasApplication } = await admin
    .from('applications')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!hasApplication) {
    const { error: appErr } = await admin.from('applications').insert({
      user_id: userId,
      tiktok_handle: c.handle,
      niche: 'other',
      niche_other: 'Seeded for contest testing',
      worked_with_wurx: false,
      // TEXT, not an array, and the column wants between 8 and 1000 characters.
      video_links: `https://www.tiktok.com/@${c.handle}`,
      status: 'approved',
      reviewed_by: staff.id,
      reviewed_at: new Date().toISOString(),
      review_note: 'Seeded for contest testing.',
    });
    if (appErr) console.log(`    no application row for ${c.handle}: ${appErr.message}`);
  }

  let entered = 0;
  for (const contest of contests) {
    // Through the real function, so every refusal that applies to a creator
    // applies here too. A second run is a no-op rather than a duplicate.
    const { error: applyErr } = await admin.rpc('apply_for_contest', {
      p_actor_id: userId,
      p_contest_id: contest.id,
      p_note: null,
    });

    if (applyErr) {
      if (!/already/i.test(applyErr.message)) {
        console.log(`    ${c.handle} could not enter ${contest.name}: ${applyErr.message}`);
      }
      continue;
    }
    entered += 1;

    // A contest the team approves needs approving, or nobody is actually in and
    // the standing has nothing to rank.
    if (contest.needs_admin_approval) {
      const { data: entry } = await admin
        .from('contest_entries')
        .select('id')
        .eq('contest_id', contest.id)
        .eq('creator_id', userId)
        .maybeSingle();

      if (entry) {
        const { error: reviewErr } = await admin.rpc('review_contest_entry', {
          p_actor_id: staff.id,
          p_entry_id: entry.id,
          p_decision: 'approved',
          p_note: 'Seeded for testing.',
        });
        if (reviewErr) console.log(`    could not approve ${c.handle}: ${reviewErr.message}`);
      }
    }
  }

  console.log(`  ready    ${c.handle.padEnd(16)} ${c.name.padEnd(18)} entered ${entered}`);
}

/*
 * The addresses, printed, because the handle is NOT the address: punctuation is
 * stripped to build one, so `nora.tries` signs in as `noratries@...`. Printing
 * the handle alone sent me to a login that could not work.
 */
console.log('\nSign in as any of them with:');
for (const c of CREATORS) {
  console.log(`  ${c.handle.replace(/[^a-z0-9]/g, '')}${SUFFIX}`);
}
console.log(`\nPassword for all of them: ${PASSWORD}`);
console.log('Remove them again with: node scripts/seed/seed-contests.mjs --clean\n');
