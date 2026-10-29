#!/usr/bin/env node
/**
 * Prove the Team screen still works now that the passwords are gone.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/wurxbase/check-wurxbase-team.mjs
 *
 * WHY THIS EXISTS. Their user-management screen was built around a plaintext
 * password: it asked for one when adding somebody, showed one when editing,
 * and printed one in a "share these credentials" dialog. The column was
 * dropped on 2026-08-29, so every one of those paths would now write to a
 * column that does not exist — and an insert that 400s in a modal is exactly
 * the kind of breakage nobody notices until Monday.
 *
 * In its place the screen edits `hub_email`, which is what actually decides
 * anything now: it is how a person is matched to their role when they arrive
 * from our sign-in. So this is also the screen Rashid and Asad will use to
 * fill in the eight addresses, and it needs to work.
 *
 * It edits a REAL row — there is no fake one to use, and a fake one would not
 * prove the join works against the data that exists — then puts the value
 * back in a finally.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');

const auth = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'wurxbase' },
});

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

const ME = { email: `team-${Date.now()}@wurx.test`, password: 'Team!2026xy' };
const TYPED = `typed-${Date.now()}@wurxmedia.com`;
let subject = null;
let browser;

try {
  /* Somebody real to edit — a viewer, so a mistake here cannot widen access. */
  const { data: rows } = await wb.from('app_users').select('id,display,role,hub_email').eq('role', 'viewer').order('id');
  if (!rows?.length) throw new Error('no viewer row in wurxbase.app_users to edit');
  subject = rows[0];
  /* Cleared deliberately, so the "no hub email" warning has something true to
     be about, and so the save below is putting a real value back rather than
     overwriting one. Restored from `subject.hub_email` in the finally. */
  await wb.from('app_users').update({ hub_email: null }).eq('id', subject.id);

  let created = null;
  for (let i = 0; i < 5 && !created?.data?.user; i++) {
    created = await auth.auth.admin.createUser({ email: ME.email, password: ME.password, email_confirm: true });
    if (!created?.data?.user) await new Promise((s) => setTimeout(s, 8000));
  }
  if (!created?.data?.user) throw new Error('could not create a throwaway admin');
  ME.id = created.data.user.id;
  /* ADMIN of ours, which maps to their superadmin — the only role that may
     manage users at all. */
  await auth.from('profiles').update({ role: 'admin', is_active: true, display_name: 'Team Probe' }).eq('id', ME.id);

  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  /* A failed insert shows up as a 4xx on the REST call, not always as a
     console error, so watch the network too. */
  const badWrites = [];
  page.on('response', (r) => {
    if (/\/rest\/v1\/app_users/.test(r.url()) && r.status() >= 400) badWrites.push(`${r.status()} ${r.request().method()}`);
  });

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', ME.email);
  await page.fill('input[name="password"]', ME.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  /* 1. There is no Sign out inside Paid Collabs any more. It ended a session
        that no longer exists and left a blank screen behind. */
  const signOuts = await page.locator('.pc-head-out').count();
  check(signOuts === 0, 'no second Sign out inside Paid Collabs', `${signOuts} found in the header`);

  /* Settings, then User Management.
     The gear is the ONLY door to Settings now. Their panel used to open from
     the user chip, and the chip is hidden in our chrome because our own top
     bar already says who you are — which quietly shut User Management, Access
     Control and God Mode behind a control that no longer renders. */
  const gear = page.locator('.pc-head-settings');
  check(await gear.count() > 0, 'an admin has a way into Paid Collabs settings at all');
  await gear.first().click();
  await page.waitForTimeout(1200);
  const usersRow = page.getByText('User Management', { exact: false }).first();
  check(await usersRow.isVisible().catch(() => false), 'an admin can reach User Management');
  await usersRow.click();
  await page.waitForTimeout(2500);

  const modalText = await page.locator('body').innerText();

  /* 2. The word Password is gone from the screen entirely. */
  check(!/password/i.test(modalText), 'the Team screen asks for no password', 'a password field would write to a dropped column');

  /*
   * 3. An unlinked member is flagged as such.
   *
   * THE SUBJECT IS CLEARED ON PURPOSE ABOVE, and that is the point. This first
   * asserted the warning appeared on whatever happened to be on screen, which
   * passed on 2026-08-29 only because another suite had just deleted somebody's
   * address by accident. A check that needs the data to be broken in order to
   * pass will pass for the wrong reason sooner or later.
   */
  check(/no hub email/i.test(modalText), 'a member with no hub email is flagged as such',
    `${subject.display} was cleared before opening the screen`);

  /* 4. Editing a member and saving an email actually persists. This is the
        exact action the eight addresses will be entered with. */
  const row = page.locator(`.um-row[data-member="${subject.id}"]`);
  check(await row.count() === 1, 'the member is listed once', `${await row.count()} row(s) for ${subject.id}`);
  await row.first().scrollIntoViewIfNeeded().catch(() => {});
  await row.first().locator('.um-edit-btn').click();
  await page.waitForTimeout(1200);

  const emailInput = page.locator('input[placeholder*="Hub email"]').first();
  const opened = await emailInput.isVisible().catch(() => false);
  check(opened, 'the edit dialog offers a Hub email field');
  if (opened) {
    await emailInput.fill(TYPED);
    await page.getByRole('button', { name: /^save$/i }).first().click();
    await page.waitForTimeout(3000);

    const after = await wb.from('app_users').select('hub_email').eq('id', subject.id).single();
    check(
      (after.data?.hub_email || '').toLowerCase() === TYPED.toLowerCase(),
      'the typed hub email reached the database',
      `stored = ${after.data?.hub_email ?? '(nothing)'}`,
    );
  }

  check(badWrites.length === 0, 'no app_users write was rejected', badWrites.join(', ') || 'none');
  check(errors.length === 0, 'zero console errors', errors.slice(0, 2).join(' | '));
} finally {
  if (browser) await browser.close();
  if (subject) await wb.from('app_users').update({ hub_email: subject.hub_email ?? null }).eq('id', subject.id);
  if (ME.id) await auth.auth.admin.deleteUser(ME.id);
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
