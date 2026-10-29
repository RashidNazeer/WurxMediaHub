#!/usr/bin/env node
/**
 * Prove Paid Collabs actually runs on OUR database.
 *
 *   pnpm build && pnpm preview            # in another shell
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/wurxbase/check-wurxbase-migration.mjs
 *
 * WHY A BROWSER AND NOT A ROW COUNT. Counting rows in `wurxbase` proves the
 * copy landed; it proves nothing about whether the app reads them. Every way
 * this migration can fail is silent from the screen: a request that still goes
 * to the retired project returns real-looking data, a missing `Accept-Profile`
 * header 404s into an empty state that looks like "no records yet", and RLS
 * refusing a table returns `[]` rather than an error. So this signs in, opens
 * the screen and checks what the network actually did.
 *
 * WHAT IT ASSERTS
 *
 *   1. Not one request reaches either retired project. This is the one that
 *      matters most: a leftover URL does not error, it just quietly reports on
 *      a database nobody maintains.
 *   2. Every /rest/v1/ request the page makes comes back OK. A 401 here means
 *      RLS is refusing a table their app needs; a 404 means the schema header
 *      is missing and the request landed in `public`.
 *   3. The creators actually render — the count on screen, not in the database.
 *   4. A WRITE works end to end: their login appends a LOGIN row to
 *      activity_logs, so the row count goes up by one. Reads can succeed while
 *      writes are refused, and that failure mode is invisible until somebody
 *      loses an afternoon's typing.
 *   5. Zero console errors.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';

const RETIRED = ['bnevtdezskftlrjjgbsg', 'pfkpgmpicjcirnogxkac'];
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
const admin = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'wurxbase' },
});
const authAdmin = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const fail = [];
const pass = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

const { data: users, error: uErr } = await admin
  .from('app_users')
  .select('id,username,role,hub_email')
  .order('id');
if (uErr) throw new Error(`could not read wurxbase.app_users: ${uErr.message}`);
/*
 * THE PLAINTEXT PASSWORDS ARE GONE — asked of the database, not assumed.
 *
 * The read above already proved the table is reachable, so a failure here is
 * about the column and not about the table having vanished; and the message
 * has to name the column, or an unrelated error would pass this check by
 * failing for the wrong reason.
 */
const pwProbe = await admin.from('app_users').select('id,password').limit(1);
check(
  Boolean(pwProbe.error) && /password/i.test(pwProbe.error.message || ''),
  'wurxbase.app_users has no plaintext password column',
  pwProbe.error ? pwProbe.error.message.slice(0, 70) : 'the column still answers a select',
);

const who = users.find((u) => u.role === 'superadmin') || users[0];
/* Not used to sign in any more — nothing does. Read as evidence that
   app_users came across intact and is reachable under RLS. */
if (!who?.id) throw new Error('wurxbase.app_users looks empty; the copy did not land');

const before = await admin.from('activity_logs').select('*', { count: 'exact', head: true });
const logsBefore = before.count ?? 0;

const ME = { email: `wbm-${Date.now()}@wurx.test`, password: 'Wbm!2026xy' };
let browser;
try {
  const created = await authAdmin.auth.admin.createUser({
    email: ME.email,
    password: ME.password,
    email_confirm: true,
  });
  if (!created.data?.user) throw new Error(`createUser: ${created.error?.message}`);
  ME.id = created.data.user.id;
  await authAdmin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', ME.id);

  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  const retiredHits = [];
  const restFailures = [];
  const consoleErrors = [];
  page.on('request', (r) => {
    if (RETIRED.some((ref) => r.url().includes(ref))) retiredHits.push(r.url().slice(0, 120));
  });
  page.on('response', (r) => {
    if (!r.url().includes('/rest/v1/')) return;
    if (r.status() >= 400) restFailures.push(`${r.status()} ${decodeURIComponent(r.url()).split('/rest/v1/')[1]?.slice(0, 90)}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
  });

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', ME.email);
  await page.fill('input[name="password"]', ME.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

  await page.goto(`${BASE}/admin/collabs`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  /*
   * NO LOGIN STEP. This used to type a username and password into their own
   * sign-in screen; that screen was removed on 2026-08-28 because the person is
   * already signed in to our app, and the session is written from their real
   * identity before the chunk mounts. Leaving the old steps here would have
   * typed "Asad" into the month picker, which is what it did on the first run
   * after the change.
   */
  await page.waitForTimeout(4000);

  const text = (await page.locator('.wurxbase-root').innerText()).replace(/\s+/g, ' ');
  const askedAgain = /sign in|username|password/i.test(text.slice(0, 500));
  check(!askedAgain, 'no second sign-in — our session carries into Paid Collabs', askedAgain ? text.slice(0, 110) : '');

  /* Did the creator rows actually arrive? */
  const rows = await page
    .locator('.wurxbase-root [class*="creator-row"], .wurxbase-root tbody tr, .wurxbase-root .pc-bt-row')
    .count();
  const brandTabs = await page.locator('.wurxbase-root .brand-tab').count();
  check(rows > 0 || brandTabs > 0, 'creator data renders from wurxbase', `${rows} rows, ${brandTabs} brand tabs`);

  check(retiredHits.length === 0, 'no request reaches a retired project', retiredHits.slice(0, 3).join(' | '));
  check(restFailures.length === 0, 'every /rest/v1/ request succeeded', restFailures.slice(0, 4).join(' | '));
  check(consoleErrors.length === 0, 'zero console errors', consoleErrors.slice(0, 3).join(' | '));

  const after = await admin.from('activity_logs').select('*', { count: 'exact', head: true });
  const logsAfter = after.count ?? 0;
  check(logsAfter > logsBefore, 'a WRITE lands in our database', `activity_logs ${logsBefore} -> ${logsAfter}`);
} finally {
  if (browser) await browser.close();
  if (ME.id) await authAdmin.auth.admin.deleteUser(ME.id);
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
