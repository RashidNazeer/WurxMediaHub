#!/usr/bin/env node
/**
 * End to end test of the application flow.
 *
 * Applying is now the sign up, so this covers the single most important path in
 * the product: a stranger fills in the hero form and comes out the other side
 * with an account, an application in the database, and a status screen.
 *
 * It creates a real account, checks the row landed with the right values, tries
 * to tamper with it, then deletes the account. Run against DEV only.
 *
 * Usage: node scripts/verify/auth/check-apply.mjs [baseUrl]
 */

import { launchBrowser } from '../../lib/browser.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';

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
assertDevProject(env.VITE_SUPABASE_URL, 'check-apply.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');
const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const stamp = process.env.RUN_STAMP ?? 'x';
const EMAIL = `apply-${stamp}@wurxmediahub.test`;
const HANDLE = `wurxtester${stamp}`;
const PASSWORD = 'a-long-enough-test-password-1';
const VIDEOS = 'https://tiktok.com/@wurxtester/video/1234567890';

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));

const browser = await launchBrowser();
let userId = null;

try {
  console.log(`\nApplication flow against ${BASE}\n${'='.repeat(70)}`);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  console.log('\n[1] The Apply button in the header actually does something');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^apply$/i }).first().click();
  await page.waitForTimeout(900);
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute('name') ?? null
  );
  check(focused === 'tiktokHandle', `clicking Apply focuses the form (focused: ${focused})`);

  console.log('\n[2] Fill in and submit the application');
  await page.fill('input[name="tiktokHandle"]', `@${HANDLE}`);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  /* The apply form gained a confirm-password field on 2026-10-16. Without
     this the form refuses to submit and every check below it fails on a
     locator rather than on the behaviour it is meant to test. */
  await page.fill('input[name="confirmPassword"]', PASSWORD);
  await page.selectOption('select[name="niche"]', 'Fitness & recovery');
  await page.selectOption('select[name="workedWithWurx"]', 'yes');
  await page.fill('textarea[name="videoLinks"]', VIDEOS);
  await page.getByRole('button', { name: /takes 60 seconds/i }).click();

  await page.waitForURL('**/app', { timeout: 25000 }).catch(() => {});
  check(new URL(page.url()).pathname === '/app', `lands on the dashboard (got ${new URL(page.url()).pathname})`);

  // The one-time welcome, which a real new creator meets before anything else.
  const welcome = page.getByRole('button', { name: /let.s go/i });
  const sawWelcome = await welcome
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(sawWelcome, 'a brand new creator is welcomed');
  if (sawWelcome) await welcome.first().click();
  await page.waitForTimeout(1500);

  check(
    (await page.getByText(/thank you for joining/i).count()) > 0,
    'and then told their application is with the team'
  );
  check(
    (await page.getByText(new RegExp(`@${HANDLE}`, 'i')).count()) > 0,
    'the screen shows the handle they submitted'
  );

  console.log('\n[3] It really is in the database');
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const created = users.users.find((u) => u.email === EMAIL);
  userId = created?.id ?? null;
  check(Boolean(userId), 'an auth account was created');

  const { data: row, error } = await admin
    .from('applications')
    .select('tiktok_handle, niche, worked_with_wurx, video_links, status, user_id')
    .eq('user_id', userId)
    .single();

  if (error || !row) {
    fail(`no application row found: ${error?.message ?? 'missing'}`);
  } else {
    check(row.tiktok_handle === HANDLE, `handle stored without the @ (got "${row.tiktok_handle}")`);
    check(row.niche === 'Fitness & recovery', 'niche stored');
    check(row.worked_with_wurx === true, 'worked-with-Wurx answer stored (this one matters)');
    check(row.video_links === VIDEOS, 'video links stored');
    check(row.status === 'pending', 'status starts as pending');
  }

  const { data: prof } = await admin
    .from('profiles')
    .select('role, display_name')
    .eq('id', userId)
    .single();
  check(prof?.role === 'applicant', `role is applicant, not something they chose (got ${prof?.role})`);
  check(prof?.display_name === HANDLE, 'display name defaulted to their handle');

  // Snapshot before the tamper test: that test deliberately provokes a 403,
  // which the browser logs as a console error. Counting it would mean this
  // suite fails precisely because the security worked.
  const errorsBeforeTamper = consoleErrors.length;

  console.log('\n[4] An applicant cannot approve their own application');
  // Done as the applicant, straight against the REST API with their own token,
  // so it bypasses our UI entirely. This is what an attacker would actually do.
  const tamper = await page.evaluate(
    async ({ url, key, uid }) => {
      const s = JSON.parse(localStorage.getItem('wurxmediahub-auth'));
      const res = await fetch(`${url}/rest/v1/applications?user_id=eq.${uid}`, {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${s.access_token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ status: 'approved' }),
      });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    },
    { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY, uid: userId }
  );
  check(
    tamper.status >= 400,
    `self-approval refused by the database (HTTP ${tamper.status})`
  );

  // An error is not proof. Read the row back and confirm nothing moved.
  const { data: after } = await admin
    .from('applications')
    .select('status')
    .eq('user_id', userId)
    .single();
  check(after?.status === 'pending', `status is still pending afterwards (got ${after?.status})`);

  console.log('\n[5] No console errors during the normal journey');
  check(
    errorsBeforeTamper === 0,
    `clean console through sign up and dashboard (${errorsBeforeTamper})`
  );
  consoleErrors.slice(0, errorsBeforeTamper).forEach((e) => console.error(`        ${e}`));

  await ctx.close();
} catch (e) {
  fail(`unexpected error: ${e.message}`);
} finally {
  await browser.close();
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) fail(`could not delete the test account: ${error.message}`);
    else console.log('\n[cleanup] test account and its application deleted');
  }
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('Application flow works end to end.\n');
