#!/usr/bin/env node
/**
 * The eight real people, signing in with their real accounts.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... ROSTER_PASSWORD=... node scripts/verify/wurxbase/check-wurxbase-roster.mjs
 *
 * WHY THIS AND NOT `verify:wurxbase-perms`. That one proves the MECHANISM: it
 * borrows a row, points it at a throwaway account and shows a viewer stays a
 * viewer. This proves the DATA — that the eight addresses actually entered
 * match the eight rows, that each person's own role is what greets them, and
 * that nobody arrives with more than Asad gave them. The mechanism was right
 * for a day before the addresses existed; being right about both is the thing
 * that matters on Monday.
 *
 * It signs in as three of the eight, one per outcome that differs: the
 * superadmin, a middle role, and a viewer. Signing in as all eight would take
 * four times as long to test the same three answers.
 *
 * ROSTER_PASSWORD is read from the environment and never written down here.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const PW = process.env.ROSTER_PASSWORD;
if (!PW) throw new Error('ROSTER_PASSWORD must be set (the shared password these accounts were created with)');
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');

const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'wurxbase' },
});

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

/* Every row is linked, and no two people share an address. */
const { data: rows, error } = await wb.from('app_users').select('id,display,role,hub_email').order('id');
if (error) throw error;
const linked = rows.filter((r) => r.hub_email);
check(linked.length === rows.length, `all ${rows.length} people are linked to a hub email`,
  rows.filter((r) => !r.hub_email).map((r) => r.id).join(', ') || 'none missing');
const addresses = linked.map((r) => r.hub_email.toLowerCase());
check(new Set(addresses).size === addresses.length, 'no two people share an address',
  `${addresses.length} addresses, ${new Set(addresses).size} distinct`);

/* One per distinct outcome: the keys, a working role, and a viewer. */
const WHO = ['superadmin', 'ipc', 'viewer']
  .map((role) => rows.find((r) => r.role === role))
  .filter(Boolean);
check(WHO.length === 3, 'found a superadmin, an ipc and a viewer to test with', WHO.map((w) => w.id).join(', '));

const browser = await launchBrowser();
try {
  for (const who of WHO) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', who.hub_email);
    await page.fill('input[name="password"]', PW);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    const arrived = await page
      .waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    check(arrived, `${who.display} can sign in`, who.hub_email);
    if (!arrived) { await ctx.close(); continue; }

    const hello = page.getByRole('button', { name: /let.s go/i });
    if (await hello.first().isVisible().catch(() => false)) await hello.first().click();
    await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    /* Their own row's role greeted them, not one derived from ours. Every one
       of these accounts is `ops` on our side, which derives to their `admin` —
       so seeing anything else here is the lookup working. */
    const session = await page.evaluate(() => {
      try { return JSON.parse(sessionStorage.getItem('ch_user') || 'null'); } catch { return null; }
    });
    check(session?.role === who.role, `${who.display} arrives as ${who.role}`,
      `got ${session?.role ?? '(nothing)'} — 'admin' for everybody would mean the lookup is not running`);
    /* The session id is OUR auth uuid on purpose — it is what makes their
       audit trail name the real person rather than a shared login. What proves
       the match is the role, checked above: every one of these accounts is
       `ops` on our side, which derives to their `admin`, so any other answer
       can only have come from their own row. */
    check(Boolean(session?.display), `${who.display} is named in their audit session`,
      session?.display || '(nothing)');

    const tabs = (await page.locator('aside a[href^="/admin/collabs/"]').allTextContents())
      .map((t) => t.trim()).filter(Boolean);
    if (who.role === 'viewer') {
      check(!tabs.some((t) => /discovery/i.test(t)), `${who.display} is not offered Discovery`, tabs.join(' | '));
    } else {
      check(tabs.length > 0, `${who.display} is offered ${tabs.length} Paid Collabs rows`, tabs.join(' | '));
    }

    /* The gear is the only door to User Management. Only their superadmin
       should find one that leads anywhere. */
    const gears = await page.locator('.pc-head-settings').count();
    if (who.role === 'viewer') {
      check(gears === 0, `${who.display} is offered no settings gear`, `${gears} found`);
    } else {
      check(gears === 1, `${who.display} has the settings gear`, `${gears} found`);
    }

    check(errors.length === 0, `${who.display}: zero console errors`, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
