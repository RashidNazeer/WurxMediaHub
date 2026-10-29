#!/usr/bin/env node
/**
 * DEV ONLY. Clears every offer and every contest so the screens can be built up
 * from scratch by hand.
 *
 * WHY IT EXISTS. Rashid asked for a clean slate on 2026-08-16 to test offers and
 * contests by adding them himself. The seed scripts each have a `--clean` that
 * removes only what that script made, which is right for seeded demo data and
 * useless here: anything created by hand through the real screens stays behind
 * and quietly muddies the next test.
 *
 * WHAT IT REMOVES, and he chose this scope explicitly:
 *   offers                -> and by cascade offer_applications,
 *                            offer_stage_events, and content_submissions,
 *                            because a video hangs off the application
 *   contests              -> and by cascade contest_commercials,
 *                            contest_deliverables, contest_products,
 *                            contest_exclusions, contest_entries,
 *                            contest_entry_terms, contest_entry_targets,
 *                            contest_entry_events, contest_progress_updates,
 *                            contest_submissions and contest_awards
 *
 * WHAT IT KEEPS: brands and their products, every profile and account, and every
 * creator application. Those are the containers and the people; this only clears
 * the commercial work inside them.
 *
 * THE AUDIT LOG IS NEVER TOUCHED. It is the record of who did what, and a
 * history that can be erased by whoever is tidying up is not a history. Rows
 * naming deleted offers stay, which is correct.
 *
 * BUDGETS ARE RECONCILED AFTERWARDS. A brand's committed figure is derived from
 * its approved offer applications, so deleting those without reconciling leaves
 * every brand card claiming money is committed to offers that no longer exist.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/wipe-offers-contests.mjs --yes
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) {
  console.error(
    'SUPABASE_SERVICE_KEY is not set. Fetch it at run time from the CLI, never from a file.\n' +
      'See docs/OPERATIONS.md.'
  );
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.VITE_SUPABASE_URL ?? '';

/*
 * THE GUARD, and it is the most important thing in this file.
 *
 * This deletes real rows and cannot be undone, so it only ever runs against
 * dev. The check is positive: it RECOGNISES the dev project rather than merely
 * failing to recognise prod, because a typo matching neither would sail
 * straight through a blocklist.
 *
 * It used to be a second copy of the project ref, inline. It is the shared
 * module now: two copies of the one string that decides which database gets
 * emptied is exactly the thing that goes stale on the day dev moves.
 */
assertDevProject(url, 'wipe-offers-contests.mjs');

if (!process.argv.includes('--yes')) {
  console.error(
    'This deletes every offer and every contest on DEV, and cannot be undone.\n' +
      'Re-run with --yes if that is what you want.'
  );
  process.exit(1);
}

const db = createClient(url, SERVICE, { auth: { persistSession: false } });

const COUNTED = [
  'brands',
  'brand_products',
  'offers',
  'offer_applications',
  'offer_stage_events',
  'content_submissions',
  'contests',
  'contest_commercials',
  'contest_deliverables',
  'contest_products',
  'contest_exclusions',
  'contest_entries',
  'contest_entry_terms',
  'contest_entry_targets',
  'contest_entry_events',
  'contest_progress_updates',
  'contest_submissions',
  'contest_awards',
  'profiles',
  'applications',
];

const countAll = async () => {
  const out = {};
  for (const t of COUNTED) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true });
    out[t] = count ?? 0;
  }
  return out;
};

console.log(`\nDEV: ${url}\n`);
const before = await countAll();

/*
 * Delete the PARENTS only and let the cascades do the rest. Deleting children by
 * hand first would be more code doing the same job, and every hand-written order
 * is a chance to miss a table that gets added later.
 *
 * `neq('id', ...)` on an impossible uuid is how PostgREST is asked to delete
 * every row: it refuses an unfiltered delete, which is a good default.
 */
const NONE = '00000000-0000-0000-0000-000000000000';

const { error: contestErr, count: contestsGone } = await db
  .from('contests')
  .delete({ count: 'exact' })
  .neq('id', NONE);
if (contestErr) {
  console.error(`could not delete contests: ${contestErr.message}`);
  process.exit(1);
}
console.log(`  removed ${contestsGone ?? 0} contest(s), and their children by cascade`);

const { error: offerErr, count: offersGone } = await db
  .from('offers')
  .delete({ count: 'exact' })
  .neq('id', NONE);
if (offerErr) {
  console.error(`could not delete offers: ${offerErr.message}`);
  process.exit(1);
}
console.log(
  `  removed ${offersGone ?? 0} offer(s), and their applications and videos by cascade`
);

const after = await countAll();

console.log(`\n${'='.repeat(58)}`);
console.log(`${'table'.padEnd(28)}${'before'.padStart(8)}${'after'.padStart(8)}`);
console.log('-'.repeat(58));
for (const t of COUNTED) {
  const changed = before[t] !== after[t];
  console.log(
    `${t.padEnd(28)}${String(before[t]).padStart(8)}${String(after[t]).padStart(8)}` +
      (changed ? '   cleared' : '')
  );
}
console.log('='.repeat(58));

const leftover = [
  'offers',
  'offer_applications',
  'offer_stage_events',
  'content_submissions',
  'contests',
  'contest_commercials',
  'contest_deliverables',
  'contest_entries',
  'contest_entry_terms',
  'contest_entry_events',
  'contest_progress_updates',
  'contest_submissions',
  'contest_awards',
].filter((t) => after[t] > 0);

if (leftover.length) {
  console.error(`\nSTILL HAS ROWS: ${leftover.join(', ')}`);
  console.error('A cascade did not fire. Do not assume this worked.');
  process.exit(1);
}

// The people and the containers must survive, or this did something it was not
// asked to. Cheap to assert, and the one mistake that would really hurt.
if (after.brands !== before.brands || after.profiles !== before.profiles) {
  console.error('\nBrands or profiles changed. That was never the intent.');
  process.exit(1);
}

console.log('\nEvery offer and contest is gone. Brands, products and people untouched.');
console.log(
  'Next: node scripts/ops/reconcile-budgets.mjs   (brand budgets still name the deleted offers)\n'
);
process.exit(0);
