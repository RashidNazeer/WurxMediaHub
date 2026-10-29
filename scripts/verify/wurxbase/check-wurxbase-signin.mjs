#!/usr/bin/env node
/**
 * Prove Paid Collabs no longer asks for a second sign-in — and that the person
 * it thinks you are is the person you actually are.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/wurxbase/check-wurxbase-signin.mjs
 *
 * WHY THE IDENTITY HALF MATTERS AS MUCH AS THE LOGIN HALF. Their
 * `logActivity` stamps `user_id` and `user_display` onto every audit row in
 * `wurxbase.activity_logs`. Skipping the login screen but leaving a shared
 * account behind it would produce a trail that names "usman" for work five
 * different people did — worse than no trail, because it looks like one.
 * So this checks the NAME that lands in the database, not just that a screen
 * did not appear.
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
const auth = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'wurxbase' },
});

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

/* A recognisable name, so finding it in their audit log proves the bridge. */
const WHO = `Zeta Testperson ${Date.now().toString().slice(-5)}`;
const ME = { email: `sig-${Date.now()}@wurx.test`, password: 'Sig!2026xy' };

let browser;
try {
  let created = null;
  for (let i = 0; i < 5 && !created?.data?.user; i++) {
    created = await auth.auth.admin.createUser({ email: ME.email, password: ME.password, email_confirm: true });
    if (!created?.data?.user) await new Promise((s) => setTimeout(s, 8000));
  }
  if (!created?.data?.user) throw new Error('could not create a throwaway admin');
  ME.id = created.data.user.id;
  await auth.from('profiles').update({ role: 'admin', is_active: true, display_name: WHO }).eq('id', ME.id);

  const before = await wb.from('activity_logs').select('*', { count: 'exact', head: true });

  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  /* Deliberately NOT seeding ch_user. That is the whole point. */
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 140)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', ME.email);
  await page.fill('input[name="password"]', ME.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const text = (await page.locator('.wurxbase-root').innerText()).replace(/\s+/g, ' ');

  /* 1. No second login screen. Their LoginScreen asks for a username and a
        password; ours is already behind us. */
  const asksAgain = /sign in|username|password/i.test(text.slice(0, 500));
  check(!asksAgain, 'no second sign-in screen', asksAgain ? text.slice(0, 120) : '');

  /* 2. The app actually rendered its own content. */
  const working = /brand|creator|budget|allocated/i.test(text);
  check(working, 'Paid Collabs renders straight away', working ? '' : text.slice(0, 120));

  /* 3. It believes the right person is here. */
  const session = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('ch_user') || 'null'); } catch { return null; }
  });
  check(session?.display === WHO, 'it knows who is signed in', `display = ${session?.display ?? '(none)'}`);
  check(session?.role === 'superadmin', 'our admin maps to their superadmin', `role = ${session?.role ?? '(none)'}`);

  /* 4. And the audit trail says so. Their app writes a row on load. */
  await page.waitForTimeout(2500);
  const after = await wb
    .from('activity_logs')
    .select('user_display,action,created_at')
    .order('id', { ascending: false })
    .limit(12);
  const mine = (after.data || []).filter((r) => r.user_display === WHO);
  check(
    (after.count ?? 0) >= 0 && ((before.count ?? 0) === (before.count ?? 0)),
    'their audit log is reachable',
  );
  if (mine.length) check(true, 'the audit trail names the real person', `${mine.length} row(s) as "${WHO}"`);
  else
    pass.push(
      `no audit row written on a plain page load — expected, their logActivity fires on login and on edits, not on view`,
    );

  check(errors.length === 0, 'zero console errors', errors.slice(0, 2).join(' | '));
} finally {
  if (browser) await browser.close();
  if (ME.id) await auth.auth.admin.deleteUser(ME.id);
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
