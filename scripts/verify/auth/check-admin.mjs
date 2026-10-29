#!/usr/bin/env node
/**
 * Confirms a staff account can sign in and reaches the right screen with the
 * right JWT claim. Run after scripts/ops/create-admin.mjs.
 *
 * Usage: node scripts/verify/auth/check-admin.mjs <baseUrl> <email> <password> [expectedRole] [expectedPath]
 */

import { launchBrowser } from '../../lib/browser.mjs';

const [BASE, EMAIL, PASSWORD, ROLE = 'admin', EXPECT = '/admin'] = process.argv.slice(2);

// Staff sign in at their own door. It is a separate screen, not a separate
// lock: permission is still decided by row level security, never by the URL.
const DOOR = EXPECT.startsWith('/admin') ? '/admin/login' : '/login';
if (!BASE || !EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/verify/auth/check-admin.mjs <baseUrl> <email> <password> [role] [path]');
  process.exit(1);
}

let failures = 0;
const check = (c, m) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`);
  if (!c) failures++;
};

const browser = await launchBrowser();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

console.log(`\nStaff sign in against ${BASE}\n${'='.repeat(70)}\n`);

await page.goto(`${BASE}${DOOR}`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL(`**${EXPECT}`, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

check(new URL(page.url()).pathname === EXPECT, `lands on ${EXPECT} (got ${new URL(page.url()).pathname})`);

const claims = await page.evaluate(() => {
  const raw = localStorage.getItem('wurxmediahub-auth');
  if (!raw) return null;
  const s = JSON.parse(raw);
  const payload = s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const p = JSON.parse(atob(payload));
  return { role: p.user_role, tier: p.user_tier, active: p.user_active };
});

check(Boolean(claims), 'a session was stored');
check(claims?.role === ROLE, `JWT carries the ${ROLE} role (got ${claims?.role})`);
check(claims?.active === true, 'account is active');
check(errors.length === 0, `no console errors (${errors.length})`);
errors.slice(0, 3).forEach((e) => console.error(`        ${e}`));

await browser.close();

console.log(`\n${'='.repeat(70)}`);
if (failures) {
  console.error(`${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('Staff sign in works.\n');
