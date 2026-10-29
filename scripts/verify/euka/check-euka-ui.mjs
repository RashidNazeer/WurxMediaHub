#!/usr/bin/env node
/**
 * The Euka figures, on the screen, in a real browser.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... EUKA_STAFF_PASSWORD=... node scripts/verify/euka/check-euka-ui.mjs
 *
 * `check-euka.mjs` proves the endpoint returns the right shapes. This proves
 * the app USES them — which is a different question, and the one Rashid
 * actually reported: he opened a brand and saw a red pill reading
 * `No EUKA store named "Swisse"`.
 *
 * That pill is the perfect assertion because it is the app's own verdict on
 * whether Euka reached it. It appears when the store lookup found nothing, and
 * before this fix it appeared for every brand, because the endpoint the lookup
 * depends on had never existed on this deployment.
 *
 * IT ASSERTS THE PILL IS ABSENT **AND** THAT THE SCREEN IT SHOULD BE ON
 * ACTUALLY LOADED. "No error message on the page" is trivially true of a page
 * that never rendered, and this project has been bitten by that shape of check
 * more than once.
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

const STAFF_EMAIL = process.env.EUKA_STAFF_EMAIL || 'asad@wurxmedia.com';
const STAFF_PASSWORD = process.env.EUKA_STAFF_PASSWORD;
if (!STAFF_PASSWORD) throw new Error('EUKA_STAFF_PASSWORD must be set');

/* The brand to open. Swisse is the one in the bug report, and it is the
   interesting case: upstream the store is called "Swisse Wellness", so it only
   resolves through the unique-prefix matcher. */
const BRAND = process.env.EUKA_BRAND || 'Swisse';

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

let browser;
try {
  browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  /* Every call the page makes to the function, so "it worked" can be told
     apart from "it was never asked". */
  const calls = [];
  page.on('response', (r) => {
    if (/\/functions\/v1\/euka/.test(r.url())) calls.push(r.status());
  });
  const answered = () => calls.length;

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', STAFF_EMAIL);
  await page.fill('input[name="password"]', STAFF_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

  /*
   * NOT `networkidle`. OPERATIONS.md records that it never settles on a screen
   * holding a realtime socket, and this screen now also fires several Euka
   * calls that take seven seconds each upstream — so the page is perfectly
   * healthy and the wait times out anyway. Wait for the CONTENT instead.
   */
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-ava, [class*=brand]', { timeout: 45000 }).catch(() => {});

  /*
   * WAIT FOR THE CALLS, NOT FOR A CLOCK. Nine seconds is ample against
   * localhost and nowhere near enough against a deployed site, where the round
   * trip is browser to Vercel to Supabase to Euka. Tuned to localhost, this
   * reported "the page calls the euka function — 0 call(s)" against a
   * deployment that was in fact making twenty-two of them: the site was right
   * and the check was early. Poll for the first answer, then give the rest a
   * moment to land and paint.
   */
  for (let i = 0; i < 60 && answered() === 0; i++) await page.waitForTimeout(1000);
  await page.waitForTimeout(10000);

  /* 1. The brands screen is really up, so everything below is about Euka
        rather than about an empty page. */
  const brandRow = page.getByText(BRAND, { exact: false }).first();
  const onScreen = await brandRow.isVisible().catch(() => false);
  check(onScreen, `the brands list rendered and shows ${BRAND}`);
  if (!onScreen) throw new Error('brands list never rendered — nothing below would mean anything');

  /* 2. The function is actually being called, and answering. */
  check(calls.length > 0, 'the page calls the euka function', `${calls.length} call(s)`);
  check(
    calls.length > 0 && calls.every((s) => s < 400),
    'every euka call succeeded',
    calls.length ? `statuses: ${[...new Set(calls)].join(', ')}` : 'none were made',
  );

  /* 3. Open the brand and look for the app's own verdict. */
  await brandRow.click();
  await page.waitForTimeout(9000);

  const body = await page.locator('body').innerText();
  check(
    /budget/i.test(body) || /allocated/i.test(body),
    `the ${BRAND} record opened`,
    'the drilldown header should be on screen',
  );

  /* THE BUG, in the app's own words. */
  const complaint = /No EUKA store named/i.test(body);
  check(
    !complaint,
    `no "No EUKA store named" warning on ${BRAND}`,
    complaint ? 'STILL THERE — the lookup found nothing' : 'gone',
  );

  /* 4. And something Euka-derived is actually on screen. The brand face is
        the top product photo fetched from Euka; a real <img> in the avatar
        slot means the photo mode reached the page, not just the network. */
  const faces = await page.locator('.pc-ava-photo img').count();
  check(faces > 0, 'an Euka brand photo rendered', `${faces} photo avatar(s)`);

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: `shots/euka-${BRAND.toLowerCase()}.png`, fullPage: false });
  console.log(`\n  shot: shots/euka-${BRAND.toLowerCase()}.png`);
} finally {
  if (browser) await browser.close();
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
