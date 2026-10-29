#!/usr/bin/env node
/**
 * The Brand Hub, as a creator sees it, every section, both themes, four widths.
 *
 * Rashid checks work in a browser and cannot read a console, so a section is
 * not "enabled" until somebody has looked at it on a phone and on a laptop in
 * dark and light. This signs in as a REAL dev creator with real money at the
 * real brand, walks every tab, and photographs it.
 *
 * It writes nothing. No throwaway creator, no seeded rows: it uses a creator
 * who already has approved videos, so what is photographed is what Rashid will
 * see when he signs in as the same person.
 *
 * Usage, with `pnpm build && pnpm preview` running in another shell:
 *   SUPABASE_SERVICE_KEY=... node scripts/shots/shots-hub.mjs [baseUrl]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from '../lib/browser.mjs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

assertDevProject(env.VITE_SUPABASE_URL, 'shots-hub.mjs');
const BASE = process.argv[2] ?? 'http://localhost:4173';
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = '1234567890';
const OUT = 'shots/hub';
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { w: 375, h: 900, name: 'phone' },
  { w: 768, h: 1100, name: 'tablet' },
  { w: 1024, h: 900, name: 'laptop' },
  { w: 1440, h: 950, name: 'desktop' },
];
const SECTIONS = ['overview', 'offers'];

const { data: brand } = await admin.from('brands').select('id, name, slug').limit(1).single();

/* The creator with the most money at that brand: the most that can look wrong. */
const { data: subs } = await admin
  .from('content_submissions')
  .select('creator_id')
  .eq('brand_id', brand.id)
  .eq('status', 'approved');
const tally = {};
for (const r of subs ?? []) tally[r.creator_id] = (tally[r.creator_id] ?? 0) + 1;
const creatorId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
const { data: who } = await admin
  .from('profiles')
  .select('email, display_name')
  .eq('id', creatorId)
  .single();

console.log(`\n${brand.name} hub, as ${who.display_name} <${who.email}>`);
console.log(`Sections: ${SECTIONS.join(', ')}\n`);

const errors = [];

async function settle(page) {
  /*
   * NOT `networkidle`. These screens hold a realtime socket open, so the network
   * is never idle and the wait times out on every single shot.
   *
   * WAIT FOR THE WORLD TO EXIST BEFORE WAITING FOR IT TO FINISH, and this order
   * is the whole thing. "No skeletons on the page" is TRUE of a page that has
   * not rendered yet, so the first version of this returned instantly on a
   * blank frame and photographed forty screens of loading bars while reporting
   * every one of them fine. Same family as `[].every()` being true of an empty
   * list: a check that passes loudest when its subject is absent.
   *
   * So: the world root first, then the skeletons, then the images.
   */
  /*
   * AND IT REPORTS RATHER THAN SWALLOWS. A `.catch(() => {})` here is what let
   * a whole run of loading screens pass as green: the wait failed, nothing said
   * so, and the screenshot was taken anyway.
   */
  const arrived = await page
    .locator('[data-brand-world]')
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  await page
    .waitForFunction(() => document.querySelectorAll('.wx-skeleton').length === 0, {
      timeout: 20000,
    })
    .catch(() => {});
  /*
   * "EVERY IMAGE IS LOADED" IS TRUE TOO EARLY, TWICE OVER.
   *
   * `[].every()` is true of a page with no images, which is the version of this
   * bug already written down. The subtler one bit on 2026-08-24: the app shell
   * paints two Wurx logos immediately, so `images.length > 0 && all complete`
   * is satisfied while the card underneath has not rendered its photograph yet.
   * The screenshot then catches the fallback gradient and looks exactly like a
   * broken image.
   *
   * So it waits for the set to be complete AND STILL complete a moment later,
   * which is what catches an image that arrives after the first check.
   */
  const allLoaded = () =>
    page
      .waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), {
        timeout: 10000,
      })
      .catch(() => {});
  await allLoaded();
  await page.waitForTimeout(400);
  await allLoaded();
  return arrived;
}

const browser = await launchBrowser();
try {
  for (const theme of ['dark', 'light']) {
    for (const { w, h, name } of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        deviceScaleFactor: 2,
        colorScheme: theme,
      });
      await ctx.addInitScript(
        ([t]) => window.localStorage.setItem('wurxmediahub-theme', t),
        [theme]
      );
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[${theme} ${name}] ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`[${theme} ${name}] ${e.message}`));

      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      await page.fill('input[name="email"]', who.email);
      await page.fill('input[name="password"]', PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL('**/app**', { timeout: 30000 }).catch(() => {});
      const hello = page.getByRole('button', { name: /let.s go/i });
      if (await hello.first().isVisible({ timeout: 4000 }).catch(() => false)) {
        await hello.first().click();
      }

      for (const section of SECTIONS) {
        const q = section === 'overview' ? '' : `?section=${section}`;
        await page.goto(`${BASE}/app/brands/${brand.slug}${q}`, {
          waitUntil: 'domcontentloaded',
        });
        const arrived = await settle(page);
        if (!arrived) {
          errors.push(`[${theme} ${name}] ${section} never rendered the brand world`);
        }
        const file = `${OUT}/${theme}-${name}-${section}.png`;
        await page.screenshot({ path: file, fullPage: true });

        // No horizontal page scroll, at any width. Checked, not assumed.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        const flag =
          (arrived ? '' : '  <-- NEVER RENDERED') +
          (overflow > 1 ? `  <-- PAGE SCROLLS ${overflow}px SIDEWAYS` : '');
        console.log(`  ${theme.padEnd(5)} ${String(w).padStart(4)}px ${section.padEnd(13)} ${file}${flag}`);
        if (overflow > 1) errors.push(`[${theme} ${name}] ${section} scrolls ${overflow}px sideways`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of [...new Set(errors)]) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\nEvery section, both themes, four widths. No console errors, no sideways scroll.\n');
