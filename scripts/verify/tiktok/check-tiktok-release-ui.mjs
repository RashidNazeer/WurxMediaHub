#!/usr/bin/env node
/**
 * THE RELEASE BUTTON, ON THE REAL SCREEN.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/tiktok/check-tiktok-release-ui.mjs
 *
 * `verify:tiktok-identity` proves the rule in the database. This proves a human
 * can undo it — which is the half Rashid asked for when he said a rejection
 * "should not be permanent, we should let admin review the rejected again".
 *
 * A rule with no visible way out is the same as a permanent bar, so this check
 * exists to stop the release living only in SQL.
 *
 * IT SEEDS ITS OWN SUBJECT and reads it back on screen before releasing it.
 * Without that, "no claim is blocking anyone" and "the screen never rendered"
 * look identical — which is the failure mode this repo keeps finding.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
const SVC = process.env.SUPABASE_SERVICE_KEY;
if (!SVC) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const TAG = 'zzreleaseui';
const OPEN_ID = `${TAG}-open-id`;
let userId = null;

const browser = await launchBrowser();
try {
  /* ── seed one claim, so the screen has something true to show ────────── */
  const { data: made, error: mkErr } = await admin.auth.admin.createUser({
    email: `${TAG}@example.invalid`, password: 'Zz!check-9999-aaaa', email_confirm: true,
  });
  if (mkErr) throw new Error(`creating the test creator: ${mkErr.message}`);
  userId = made.user.id;
  const { error: connErr } = await admin.from('creator_tiktok_connections').insert({
    creator_id: userId, open_id: OPEN_ID, display_name: 'ZZ Release UI',
    scope: 'user.info.basic,video.list',
  });
  check(!connErr, 'seeded a TikTok connection for the test creator', connErr?.message);
  const { data: seeded } = await admin.from('tiktok_identities').select('id, released_at').eq('open_id', OPEN_ID);
  check((seeded ?? []).length === 1 && !seeded[0].released_at,
    'which produced exactly one LIVE claim to release', `${(seeded ?? []).length} rows`);

  /* ── the screen ──────────────────────────────────────────────────────── */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 140)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
  await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

  await page.goto(`${BASE}/admin/tiktok`, { waitUntil: 'domcontentloaded' });
  /* FilterTab renders <button role="tab">, so it is NOT matched by getByRole
     ('button') — the first version of this check reported a missing tab that
     was on the screen the whole time. */
  const tab = page.getByRole('tab', { name: /creator accounts/i }).first();
  /* WAIT FOR IT before asking whether it is there. `domcontentloaded` fires
     long before React has drawn anything, so the first version of this asked
     the question too early and reported a missing tab that the very next line
     then clicked successfully. */
  await tab.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  check(await tab.isVisible().catch(() => false), 'the Creator accounts tab is on the TikTok screen');
  await tab.click();
  await page.waitForTimeout(2500);

  const body = await page.evaluate(() => document.body.innerText);
  /* THE GUARD: the seeded claim must actually be on screen. A silently failed
     query would otherwise read as "nothing to release" and pass. */
  check(/ZZ Release UI|zzreleaseui/i.test(body), 'the seeded claim is listed on the screen',
    body.slice(0, 160).replace(/\s+/g, ' '));
  check(!/permission denied|could not|failed/i.test(body),
    'and the list loaded without an error banner');

  /* ── release it, through the button a human would press ──────────────── */
  const relBtn = page.getByRole('button', { name: /let this account apply again/i }).first();
  check(await relBtn.isVisible().catch(() => false), 'a release button is offered for a live claim');
  await relBtn.click();
  await page.waitForTimeout(400);

  /* A reason is required: the confirm must be disabled while it is empty. */
  const confirm = page.getByRole('button', { name: /^release$/i }).first();
  check(await confirm.isDisabled().catch(() => false),
    'the release cannot be confirmed without a reason');

  await page.locator('input[id^="reason-"]').first().fill('ZZ check: releasing so it can apply again');
  await page.waitForTimeout(250);
  check(!(await confirm.isDisabled().catch(() => true)), 'and can be once a reason is typed');
  await confirm.click();
  await page.waitForTimeout(3000);

  /* ── it really released, in the database, with an audit row ──────────── */
  const { data: after } = await admin.from('tiktok_identities')
    .select('id, released_at, release_reason, released_by').eq('open_id', OPEN_ID).single();
  check(!!after?.released_at, 'the claim is released in the database', JSON.stringify(after));
  check(/ZZ check/.test(String(after?.release_reason || '')), 'and the typed reason was stored',
    after?.release_reason);
  check(!!after?.released_by, 'and it recorded WHICH staff member did it', after?.released_by);

  const { data: logged } = await admin.from('audit_log')
    .select('action, subject_type, actor_email, detail')
    .eq('action', 'tiktok.identity_released').order('id', { ascending: false }).limit(1);
  check((logged ?? []).length === 1 && logged[0].subject_type === 'tiktok_identity',
    'and an audit row was written', JSON.stringify(logged?.[0] ?? null).slice(0, 140));
  check(!!logged?.[0]?.actor_email, 'naming the staff member who did it', logged?.[0]?.actor_email);

  /* ── and the released account can claim again ────────────────────────── */
  await admin.from('creator_tiktok_connections').delete().eq('creator_id', userId);
  const { error: reErr } = await admin.from('creator_tiktok_connections').insert({
    creator_id: userId, open_id: OPEN_ID, display_name: 'ZZ Release UI again',
    scope: 'user.info.basic,video.list',
  });
  const { data: reclaimed } = await admin.from('tiktok_identities')
    .select('id, released_at').eq('open_id', OPEN_ID);
  check(!reErr && (reclaimed ?? []).filter((r) => !r.released_at).length === 1,
    'after the release, the same TikTok account can claim again — the button really releases',
    `${(reclaimed ?? []).length} claims, ${(reclaimed ?? []).filter((r) => !r.released_at).length} live`);

  check(errors.length === 0, 'zero console errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
} catch (e) {
  check(false, 'the check ran to completion', String(e.message).slice(0, 160));
} finally {
  await admin.from('tiktok_identities').delete().eq('open_id', OPEN_ID);
  if (userId) {
    await admin.from('creator_tiktok_connections').delete().eq('creator_id', userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }
  const { data: left } = await admin.from('tiktok_identities').select('id').eq('open_id', OPEN_ID);
  check((left ?? []).length === 0, 'no test claim survived the cleanup', `${(left ?? []).length} left`);
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
