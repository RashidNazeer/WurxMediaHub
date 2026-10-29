#!/usr/bin/env node
/**
 * How long does clicking a menu item actually take?
 *
 * WHY THIS EXISTS. Rashid: "when I am navigating I can feel the lag, like the
 * app is hanging... clicking on any section should immediately move to that
 * section." Before changing the router I wanted a number rather than a hunch,
 * and afterwards I want to be able to prove the change did something.
 *
 * WHAT IT MEASURES, both timed INSIDE the page with `performance.now()` so
 * Playwright's own round trip is not in the figure:
 *
 *   urlAt    click -> the URL actually changes. This is the one that matters.
 *            Until it moves, nothing on screen has changed at all: the old
 *            screen is still sitting there and the app looks hung.
 *   paintAt  click -> the new screen's own words are on screen.
 *
 * COLD vs WARM is the whole point. Route level `lazy` downloads a chunk before
 * it will change the URL, so the FIRST visit to a section pays for a network
 * round trip while showing the old screen, and the second visit does not. If
 * cold is slow and warm is fast, the chunk fetch is the lag, and prefetching or
 * a Suspense boundary fixes it. If both are slow, it is something else and I
 * would be fixing the wrong thing.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/perf/measure-nav.mjs [url]
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { launchBrowser } from '../lib/browser.mjs';
import { assertDevProject } from '../lib/dev-guard.mjs';

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
assertDevProject(env.VITE_SUPABASE_URL, 'measure-nav.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const db = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

/**
 * Where we click, where it should land, and a word only that screen says.
 *
 * `labels` is a LIST because the contests menu item was three rows called "All
 * contests", "Claims" and "Rewards" until 2026-08-15 and is one row called
 * "Contests" after it. This script has to run against both, or it cannot
 * measure the before and the after of its own fix.
 */
const HOPS = [
  { labels: ['Applications'], path: '/admin/applications', marker: 'Applications' },
  { labels: ['Contests', 'All contests'], path: '/admin/contests', marker: 'Contests' },
  { labels: ['Content'], path: '/admin/content', marker: 'Content' },
  { labels: ['Brands Hub'], path: '/admin/brands', marker: 'Brand' },
  { labels: ['Creators'], path: '/admin/creators', marker: 'Creators' },
];

/**
 * One navigation, timed from inside the page.
 *
 * The click is dispatched on the real anchor, so React Router's own handler
 * runs exactly as it does for a person. Polling at 4ms is finer than a frame,
 * so the figure is not quantised to 16ms steps.
 */
async function timeHop(page, hop) {
  return page.evaluate(
    ({ labels, path, marker }) =>
      new Promise((resolve, reject) => {
        const link = [...document.querySelectorAll('a')].find(
          (a) => labels.includes(a.textContent.trim()) && a.getAttribute('href')
        );
        if (!link) return reject(new Error(`no menu link called ${labels.join(' or ')}`));

        const t0 = performance.now();
        let urlAt = null;

        const started = Date.now();
        const iv = setInterval(() => {
          if (urlAt === null && location.pathname === path) urlAt = performance.now() - t0;

          if (urlAt !== null) {
            const main = document.querySelector('main');
            const text = main ? main.innerText : '';
            if (new RegExp(marker, 'i').test(text)) {
              clearInterval(iv);
              resolve({ urlAt, paintAt: performance.now() - t0 });
              return;
            }
          }
          if (Date.now() - started > 20_000) {
            clearInterval(iv);
            reject(new Error(`timed out going to ${path}`));
          }
        }, 4);

        link.click();
      }),
    hop
  );
}

const ms = (n) => `${Math.round(n)}ms`;
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nNavigation timing against ${BASE}\n${'='.repeat(70)}`);

const email = `nav-timer-${Date.now().toString(36)}@wurxmediahub.test`;
const password = 'Wx-nav-timer-2026!';
const { data: made, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) throw error;
await db.from('profiles').update({ role: 'admin' }).eq('id', made.user.id);

const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/admin/login'), { timeout: 20_000 });
  await page.waitForTimeout(1500);

  const rounds = [];
  // Three laps. Lap one pays for every chunk; laps two and three have them all
  // in memory, so the difference between the laps IS the chunk fetch.
  for (let lap = 1; lap <= 3; lap += 1) {
    console.log(`\nLap ${lap}${lap === 1 ? '  (cold: every chunk is a fresh download)' : '  (warm)'}`);
    console.log(`  ${pad('section', 16)}${pad('click -> url', 16)}click -> painted`);
    for (const hop of HOPS) {
      const { urlAt, paintAt } = await timeHop(page, hop);
      rounds.push({ lap, label: hop.labels[0], urlAt, paintAt });
      console.log(`  ${pad(hop.labels[0], 16)}${pad(ms(urlAt), 16)}${ms(paintAt)}`);
      // Let the screen settle so the next hop is not timed against a page still
      // running its own queries.
      await page.waitForTimeout(700);
    }
  }

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const cold = rounds.filter((r) => r.lap === 1);
  const warm = rounds.filter((r) => r.lap > 1);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  cold  click -> url      median ${ms(median(cold.map((r) => r.urlAt)))}`);
  console.log(`  cold  click -> painted  median ${ms(median(cold.map((r) => r.paintAt)))}`);
  console.log(`  warm  click -> url      median ${ms(median(warm.map((r) => r.urlAt)))}`);
  console.log(`  warm  click -> painted  median ${ms(median(warm.map((r) => r.paintAt)))}`);
  console.log('');
} finally {
  await browser.close();
  await db.from('audit_log').delete().eq('actor_id', made.user.id);
  await db.auth.admin.deleteUser(made.user.id);
  console.log('throwaway admin removed\n');
}
