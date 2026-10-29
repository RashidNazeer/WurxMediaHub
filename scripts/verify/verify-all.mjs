#!/usr/bin/env node
/**
 * Every suite, one command, one number at the end.
 *
 * WHY THIS EXISTS. There were eleven suites and no way to run them, so they
 * were run one at a time, from memory, and one of them was missed:
 * `verify:responsive` sat broken for two days across the whole contest build
 * and nobody noticed, because nobody ran it. A suite that is never run is worth
 * exactly as much as a suite that does not exist.
 *
 * WHAT IT IS NOT. It is not a new kind of testing. Every check it reports is a
 * check one of the existing suites already made; this only makes running all of
 * them the easy thing to do rather than the diligent thing to do.
 *
 * THREE RULES IT FOLLOWS, and each one is here because of something that has
 * already cost time on this project:
 *
 *   1. ONE SUITE AT A TIME. This machine has 7.4 GB of RAM and VS Code holds
 *      well over a gigabyte. Two Chromiums at once pushed it into the page file
 *      far enough that everything stopped. Sequential is not a simplification.
 *
 *   2. PRECONDITIONS ARE CHECKED ONCE, UP FRONT, AND NAMED. A suite that cannot
 *      run is worse than a suite that fails: `check-responsive` reported the
 *      same 24 failures every run, all of them one missing seeded account, and
 *      they read as noise. Anything missing is said once, in a sentence, with
 *      the command that fixes it.
 *
 *   3. IT MAKES ITS OWN ADMIN AND TAKES IT AWAY. Never Rashid's account, which
 *      OPERATIONS is explicit about. One throwaway for the whole run, removed in
 *      a `finally` so a crash mid-suite does not leave it behind.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/verify-all.mjs [url]
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/verify-all.mjs [url] --only=contests,live
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/verify-all.mjs [url] --skip=session
 *
 * DEV ONLY. Every suite underneath creates real accounts against the linked
 * database and deletes them again.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { assertDevProject } from '../lib/dev-guard.mjs';

/* ----------------------------------------------------------------- setup -- */

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173';
const only = valueOf('--only');
const skip = valueOf('--skip');

function valueOf(flag) {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

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
assertDevProject(env.VITE_SUPABASE_URL, 'verify-all.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const db = SERVICE
  ? createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  : null;

const STAMP = Date.now().toString(36);
const ADMIN_EMAIL = `verify-all-${STAMP}@wurxmediahub.test`;
const ADMIN_PASSWORD = 'Wx-verify-all-2026!';

/**
 * The demo creator `check-responsive` signs in as. It comes from
 * seed-applications.mjs, NOT from seed-pipeline.mjs, which is the thing that
 * cost two days: the pipeline seed only puts videos against jobs that are
 * already approved, so running it on a database with no approved work is a
 * no-op and fixes nothing.
 */
const DEMO_CREATOR = 'skinbyamara@wurxmediahub.demo';

/* ---------------------------------------------------------------- suites -- */

/*
 * Ordered cheapest first, so a broken build or a dead server is reported in
 * fifteen seconds rather than after twenty minutes of browsers. `responsive`
 * and `contests` are last because they are the two long ones.
 */
const SUITES = [
  { key: 'browser', script: 'verify/verify-page.mjs', what: 'the landing page, both themes' },
  { key: 'rls', script: 'verify/auth/check-rls.mjs', what: 'the database, attacked as a real user', needs: ['service'] },
  { key: 'tiktok', script: 'verify/tiktok/check-tiktok.mjs', what: 'the ad token, attacked as a creator and an admin', needs: ['service'] },
  { key: 'performance', script: 'verify/creator/check-performance.mjs', what: 'real ad numbers end to end, and who can read them', needs: ['service'] },
  { key: 'session', script: 'verify/auth/check-session.mjs', what: 'refresh, two tabs, reopen, form survival', needs: ['service'] },
  { key: 'apply', script: 'verify/auth/check-apply.mjs', what: 'sign up to stored application', needs: ['service'] },
  { key: 'review', script: 'verify/creator/check-review.mjs', what: 'the admin review pipeline, plus attacks', needs: ['service', 'admin'] },
  { key: 'brands', script: 'verify/brands/check-brands.mjs', what: 'brands, offers and products', needs: ['service', 'admin'] },
  { key: 'offer-requests', script: 'verify/creator/check-offer-requests.mjs', what: 'creators asking, staff deciding', needs: ['service', 'admin'] },
  { key: 'content', script: 'verify/creator/check-content.mjs', what: 'a video posted, watched and decided', needs: ['service'] },
  { key: 'live', script: 'verify/creator/check-live.mjs', what: 'a stage moving under a creator, no reload', needs: ['service'] },
  { key: 'contests', script: 'verify/creator/check-contests.mjs', what: 'contests end to end, including the money', needs: ['service'] },
  { key: 'responsive', script: 'verify/design/check-responsive.mjs', what: 'every screen at four widths', needs: ['admin', 'demo-creator'] },
  /*
   * The shell rather than the screens: rail width, the hidden scrollbar, the
   * menu keeping its scroll position, the bar naming the section, the content
   * filling the width, and the text-size setting.
   *
   * It is separate from `responsive` on purpose. Every bug it guards was one
   * Rashid found himself, and every one of them leaves a page that lays out
   * perfectly and scrolls nowhere, so `responsive` calls the lot of it healthy.
   */
  { key: 'chrome', script: 'verify/design/check-chrome.mjs', what: 'the rail, the top bar, the width and the text size', needs: ['admin'] },
];

/** Fifteen minutes each. The longest real run so far is about four. */
const TIMEOUT_MS = 15 * 60 * 1000;

/* --------------------------------------------------------------- helpers -- */

const line = (n = 70) => '='.repeat(n);
const secs = (ms) => `${(ms / 1000).toFixed(0)}s`;

/**
 * How many checks a suite reported, from its own last words.
 *
 * Every suite counts out loud and none of them agree on the wording, so this
 * reads all the shapes rather than making eleven scripts match. A blank is
 * fine: the exit code is what decides pass or fail, and this is only for the
 * summary line.
 */
function countFrom(output) {
  const patterns = [
    /(\d+)\s+passed,\s+\d+\s+failed/i,
    /(\d+)\s+checks?\s+passed/i,
    /(\d+)\s+check\(s\)\s+FAILED/i,
    /(\d+)\s+responsiveness check\(s\)\s+FAILED/i,
    /(\d+)\s+security check\(s\)\s+FAILED/i,
    /(\d+)\s+problem\(s\)\s+found/i,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m) return m[1];
  }
  // `verify-page` marks its passes with "OK" rather than "PASS", and says
  // nothing at all about how many there were when they all pass.
  const marks = output.match(/^\s*(PASS|OK)\s/gm);
  return marks ? String(marks.length) : '';
}

function run(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [`scripts/${suite.script}`, BASE], {
      env: {
        ...process.env,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
        RUN_STAMP: STAMP,
      },
      // Piped rather than inherited, so a failing suite's output can be shown
      // in full and a passing one's can be kept out of the way.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));

    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      out += `\n[verify:all] killed after ${TIMEOUT_MS / 60000} minutes`;
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code: code ?? 1, out, ms: Date.now() - started });
    });
  });
}

/* ----------------------------------------------------------- preconditions */

const problems = [];
const missing = new Set();

if (!SERVICE) {
  missing.add('service');
  problems.push(
    'SUPABASE_SERVICE_KEY is not set. Fetch it at run time, never from a file:\n' +
      '    supabase projects api-keys --project-ref $env:SUPABASE_PROJECT_REF_DEV --output json'
  );
}

console.log(`\nEvery suite, against ${BASE}\n${line()}\n`);

// Is anything actually serving? Every browser suite would otherwise fail on its
// first navigation, eleven times over, for one reason.
try {
  const res = await fetch(BASE, { redirect: 'follow' });
  if (!res.ok) throw new Error(`responded ${res.status}`);
  console.log(`  ok    ${BASE} is serving`);
} catch (err) {
  problems.push(
    `Nothing is serving at ${BASE} (${err.message}).\n` +
      '    Run `pnpm build` then `pnpm preview` in another shell, or point this at the dev URL.'
  );
}

if (db) {
  const { data } = await db.auth.admin.listUsers({ perPage: 200 });
  const users = data?.users ?? [];

  if (users.some((u) => u.email === DEMO_CREATOR)) {
    console.log(`  ok    the demo creator exists`);
  } else {
    missing.add('demo-creator');
    problems.push(
      `${DEMO_CREATOR} does not exist, so the CREATOR half of verify:responsive cannot run.\n` +
        '    Put it back with: node scripts/seed/seed-applications.mjs   (--clean removes it again)'
    );
  }
}

if (problems.length > 0) {
  console.log('');
  for (const p of problems) console.log(`  !!    ${p}\n`);
}

// A missing service key is fatal: eight of the eleven need it and the two that
// do not are the least interesting. Everything else degrades to a named SKIP.
if (missing.has('service')) {
  console.error(`${line()}\nCannot run without the service key. Nothing was attempted.\n`);
  process.exit(1);
}
if (problems.some((p) => p.startsWith('Nothing is serving'))) {
  console.error(`${line()}\nCannot run without a server. Nothing was attempted.\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------- run -- */

const chosen = SUITES.filter(
  (s) => (!only || only.includes(s.key)) && (!skip || !skip.includes(s.key))
);

const results = [];
let adminId = null;

try {
  if (chosen.some((s) => s.needs?.includes('admin'))) {
    const { data, error } = await db.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`could not make a throwaway admin: ${error.message}`);
    adminId = data.user.id;
    const { error: roleErr } = await db.from('profiles').update({ role: 'admin' }).eq('id', adminId);
    if (roleErr) throw new Error(`could not promote the throwaway admin: ${roleErr.message}`);
    console.log(`  ok    throwaway admin made, and it is not Rashid's\n`);
  }

  for (const suite of chosen) {
    const blocked = (suite.needs ?? []).filter((n) => missing.has(n));
    if (blocked.length > 0) {
      console.log(`SKIP  ${suite.key.padEnd(16)} ${suite.what}`);
      console.log(`      needs ${blocked.join(', ')}, see above\n`);
      results.push({ ...suite, state: 'skipped', count: '', ms: 0 });
      continue;
    }

    process.stdout.write(`RUN   ${suite.key.padEnd(16)} ${suite.what} ... `);
    const { code, out, ms } = await run(suite);
    const count = countFrom(out);
    const passed = code === 0;

    console.log(`${passed ? 'PASS' : 'FAIL'}  ${count ? `${count} checks, ` : ''}${secs(ms)}`);

    if (!passed) {
      // Shown in full rather than summarised. The whole point is not having to
      // run it again to find out what happened.
      console.log(`\n${'-'.repeat(70)}`);
      console.log(out.trimEnd());
      console.log(`${'-'.repeat(70)}\n`);
    }

    results.push({ ...suite, state: passed ? 'passed' : 'failed', count, ms });
  }
} finally {
  if (adminId) {
    await db.from('audit_log').delete().eq('actor_id', adminId);
    await db.from('audit_log').delete().eq('target_user_id', adminId);
    await db.auth.admin.deleteUser(adminId);
    console.log('  ok    throwaway admin removed');
  }
}

/* --------------------------------------------------------------- summary -- */

const failed = results.filter((r) => r.state === 'failed');
const skipped = results.filter((r) => r.state === 'skipped');
const passedCount = results.filter((r) => r.state === 'passed').length;
const totalChecks = results.reduce((n, r) => n + (Number(r.count) || 0), 0);
const totalMs = results.reduce((n, r) => n + r.ms, 0);

console.log(`\n${line()}`);
for (const r of results) {
  const mark = r.state === 'passed' ? 'PASS' : r.state === 'failed' ? 'FAIL' : 'SKIP';
  console.log(
    `  ${mark}  ${r.key.padEnd(16)} ${(r.count ? `${r.count} checks` : '').padEnd(12)} ${
      r.ms ? secs(r.ms) : ''
    }`
  );
}
console.log(line());

if (failed.length === 0 && skipped.length === 0) {
  console.log(
    `\nAll ${passedCount} suites green. ${totalChecks} checks in ${secs(totalMs)}.\n`
  );
} else {
  console.log(
    `\n${passedCount} suite(s) green, ${failed.length} failed, ${skipped.length} skipped. ` +
      `${totalChecks} checks in ${secs(totalMs)}.`
  );
  if (failed.length > 0) console.log(`Failed: ${failed.map((f) => f.key).join(', ')}`);
  if (skipped.length > 0) console.log(`Skipped: ${skipped.map((f) => f.key).join(', ')}`);
  console.log('');
}

// A SKIP is not a pass. Something that could not be checked is reported as a
// non-zero exit, or the next person to run this reads silence as safety.
process.exit(failed.length === 0 && skipped.length === 0 ? 0 : 1);
