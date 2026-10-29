#!/usr/bin/env node
/* A BRAND-NEW SIGNUP MUST NOT MEET "Not allowed".
 *
 * Rashid signed up on production, opened his profile, and got a red
 * "Not allowed" under Connect TikTok. This creates a throwaway applicant the
 * same way a signup does, walks to the same card, and presses the same button
 * — then deletes the account again.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('d:/Milestone/WurxMediaHub/package.json');
const { createClient } = require('@supabase/supabase-js');
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const env = Object.fromEntries(readFileSync(process.env.ENV_FILE ? process.env.ENV_FILE : 'd:/Milestone/WurxMediaHub/.env.local', 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const email = `applicant-probe-${Date.now()}@wurxmedia.com`;
const PW = 'Probe!' + Math.random().toString(36).slice(2, 10);
const { data: made, error: mkErr } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
check(!mkErr, 'created a throwaway signup', mkErr ? mkErr.message : email);
if (mkErr) process.exit(1);

/* whatever a real signup produces — do not force it */
const prof = await svc.from('profiles').select('role,is_active').eq('id', made.user.id).maybeSingle();
console.log('the profile a signup gets: ' + JSON.stringify(prof.data));
check(prof.data?.role === 'applicant', 'a new signup is an applicant', String(prof.data?.role));

const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  /* Record WHERE each error came from. Once Connect is pressed the browser
     is on tiktok.com, and their login page logs its own CSP notices and a
     blocked monitoring XHR. Those are not ours and counting them made this
     check fail on a working flow. */
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ from: page.url(), text: m.text().slice(0, 140) }); });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (!/login/.test(page.url())) await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  console.log('landed on: ' + page.url());

  // The TikTok connection lives in the account menu, opened from the sidebar's
  // user chip (the Profile page is gone).
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await page.locator('[data-account-chip]:visible').first().click().catch(() => {});
  await page.waitForTimeout(1500);

  const card = await page.evaluate(() => {
    const t = document.body.innerText;
    const btn = [...document.querySelectorAll('button')].find((b) => /connect tiktok/i.test(b.textContent || ''));
    return {
      hasCard: !!document.querySelector('[role=dialog][aria-label="Your account"] section[aria-label="TikTok"]'),
      hasButton: !!btn,
      rawNotAllowed: /Not allowed/i.test(t),
      alert: (document.querySelector('[role=alert]') || {}).textContent || null,
    };
  });
  console.log('card before pressing: ' + JSON.stringify(card));
  check(card.hasCard, 'an applicant is shown the TikTok card');
  check(!card.rawNotAllowed, 'and no bare "Not allowed" before touching it', card.alert || '');

  if (card.hasButton) {
    await page.locator('button', { hasText: /connect tiktok/i }).first().click();
    await page.waitForTimeout(9000);
    /* Pressing Connect NAVIGATES to tiktok.com, so evaluating in the old
       context throws "Execution context was destroyed" — on the SUCCESS path.
       Read the URL, and only inspect the page while still on ours. */
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    let after = { url: page.url(), raw: false, alert: null };
    if (after.url.startsWith(BASE)) {
      after = await page.evaluate(() => ({
        url: location.href,
        raw: /Not allowed/i.test(document.body.innerText),
        alert: (document.querySelector("[role=alert]") || {}).textContent || null,
      })).catch(() => after);
    }
    console.log('after pressing: ' + JSON.stringify(after));
    /* Success is either a redirect to TikTok's consent page, or at worst a
       sentence — never the bare refusal. */
    const wentToTikTok = /tiktok\.com/i.test(after.url);
    check(!after.raw, 'pressing Connect no longer says "Not allowed"', after.alert || after.url.slice(0, 60));
    check(wentToTikTok || !after.alert,
      'it reaches TikTok, or fails with something a person can read',
      wentToTikTok ? 'reached TikTok consent' : (after.alert || 'no error shown'));
  } else {
    check(false, 'the Connect button is on screen for an applicant');
  }
  const ours = errors.filter((e) => e.from.startsWith(BASE));
  check(ours.length === 0, 'zero console errors of our own', ours.slice(0, 2).map((e) => e.text).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await svc.auth.admin.deleteUser(made.user.id).catch(() => {});
  const gone = await svc.from('profiles').select('id').eq('id', made.user.id).maybeSingle();
  check(!gone.data, 'the throwaway signup was deleted again', gone.data ? 'STILL THERE' : 'removed');
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
