#!/usr/bin/env node
/**
 * Is production actually ready, or does it only have the tables?
 *
 * WHY THIS EXISTS. A migration carries the schema and nothing else. Everything
 * below is configured PER PROJECT, in the dashboard or by a separate command,
 * and every one of them is invisible to `supabase db push`. Prod ran all 58
 * migrations on 2026-08-26 and was still missing several of these, which is
 * exactly the failure this guards: a database that looks complete and an app
 * that cannot sign anybody in.
 *
 * It only READS. It creates nothing and changes nothing, so it is safe to run
 * against production as often as you like.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/verify/site/check-prod-ready.mjs
 */

import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL_BASE || !SERVICE) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');

const db = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

let pass = 0;
const gaps = [];
const ok = (l) => {
  console.log(`  PASS  ${l}`);
  pass++;
};
const gap = (l, fix) => {
  console.error(`  GAP   ${l}`);
  gaps.push({ l, fix });
};

console.log(`\nChecking ${URL_BASE}\n`);

/* ------------------------------------------------------------- tables -- */
console.log('[1] The tables the product cannot run without');
const TABLES = [
  'profiles',
  'applications',
  'brands',
  'brand_commercials',
  'brand_products',
  'offers',
  'offer_applications',
  'content_submissions',
  'contests',
  'contest_entries',
  'audit_log',
  'tiktok_connections',
  'tiktok_video_daily',
  'creator_avatars',
];
for (const t of TABLES) {
  const { error } = await db.from(t).select('*', { head: true, count: 'exact' }).limit(0);
  if (error) gap(`table ${t} is not reachable: ${error.message}`, 'the migrations did not all land');
  else ok(`table ${t}`);
}

/* ------------------------------------------------- the columns added late -- */
console.log('\n[2] Columns added by the newest migrations');
for (const [table, col] of [
  ['brands', 'theme'],
  ['brands', 'brand_color'],
  ['brands', 'hero_url'],
]) {
  const { error } = await db.from(table).select(col, { head: true }).limit(0);
  if (error) gap(`${table}.${col} is missing`, 'a late migration did not land');
  else ok(`${table}.${col}`);
}

/* ------------------------------------------------------------ buckets -- */
console.log('\n[3] Storage buckets');
const { data: buckets, error: bucketErr } = await db.storage.listBuckets();
if (bucketErr) {
  gap(`cannot list buckets: ${bucketErr.message}`, 'check the service key');
} else {
  const byName = new Map((buckets ?? []).map((b) => [b.name, b]));
  for (const [name, wantPublic] of [
    ['brand-assets', true],
    ['creator-avatars', false],
  ]) {
    const b = byName.get(name);
    if (!b) {
      gap(`bucket ${name} does not exist`, `create it, public=${wantPublic}`);
    } else if (b.public !== wantPublic) {
      gap(
        `bucket ${name} is public=${b.public}, should be ${wantPublic}`,
        `change it in the dashboard`
      );
    } else {
      ok(`bucket ${name} (public=${b.public})`);
    }
  }
}

/* ------------------------------------------------- the access token hook -- */
console.log('\n[4] The custom access token hook');
/*
 * THE ONE THAT BREAKS EVERYTHING QUIETLY. Without it a JWT carries no `role`
 * and no `tier`, so every signed-in person is treated as a stranger: the app
 * loads, sign-in succeeds, and then nothing they own is visible to them. The
 * function is created by a migration; ENABLING it is a dashboard setting that
 * no migration can reach, which is the whole reason it is checked separately.
 */
const { error: hookErr } = await db.rpc('custom_access_token_hook', {
  event: { user_id: '00000000-0000-0000-0000-000000000000', claims: {} },
});
if (hookErr && /does not exist|not find/i.test(hookErr.message)) {
  gap('the custom_access_token_hook function does not exist', 'a migration did not land');
} else {
  ok('the custom_access_token_hook function exists');
  console.log(
    '        NOTE: whether it is ENABLED is an Auth setting no API exposes.\n' +
      '        Confirm in the dashboard: Authentication -> Hooks -> Customize Access Token.\n' +
      '        The symptom if it is off: sign-in works and then nothing is visible.'
  );
}

/* ------------------------------------------------------ edge functions -- */
console.log('\n[5] Are the Edge Functions actually deployed');
/*
 * ASKED WITH A RAW FETCH, AND THE STATUS CODE IS THE ANSWER.
 *
 * The first version of this used `functions.invoke()` and treated "no error I
 * recognise" as success. It reported the function deployed on a project where
 * `supabase functions list` returned an empty table — the client wraps a 404
 * into a generic FunctionsHttpError whose message says nothing about 404, so
 * the pattern never matched and the check passed on a project with ZERO
 * functions on it. A check that lies in the reassuring direction is worse than
 * no check, and it lied to me on a production launch.
 *
 * 404 means not deployed. Anything else — 401, 400, 500 — means something is
 * there and answering, which is all this needs to establish.
 */
const FUNCTIONS = [
  'manage-brand',
  'manage-content',
  'manage-contest',
  'manage-offer-application',
  'enter-contest',
  'review-application',
  'sync-creator-avatars',
  'tiktok-connect',
  'tiktok-callback',
  'tiktok-sync',
];
for (const fn of FUNCTIONS) {
  const res = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);

  if (!res) gap(`${fn} could not be reached at all`, 'check the project URL');
  else if (res.status === 404) gap(`${fn} is NOT deployed`, `supabase functions deploy ${fn}`);
  else ok(`${fn} is deployed (answered ${res.status})`);
}

/* ------------------------------------------------------------- is empty -- */
console.log('\n[6] What is actually in there');
for (const t of ['profiles', 'brands', 'offers', 'contests', 'tiktok_video_daily']) {
  const { count } = await db.from(t).select('*', { head: true, count: 'exact' });
  console.log(`        ${t.padEnd(20)} ${count ?? 0} row(s)`);
}

console.log('\n' + '='.repeat(70));
if (gaps.length) {
  console.error(`\n${gaps.length} gap(s) between "the migrations ran" and "production works":\n`);
  for (const g of gaps) console.error(`  - ${g.l}\n      fix: ${g.fix}`);
  console.error('');
  process.exit(1);
}
console.log(`${pass} checks passed. The database side of production is ready.\n`);
