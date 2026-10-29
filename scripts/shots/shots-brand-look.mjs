#!/usr/bin/env node
/**
 * The brand theme editor, as an admin uses it, both themes, four widths.
 *
 * Rashid checks work in a browser and cannot read a console, so a control is
 * not "built" until somebody has opened it on a phone and on a laptop in dark
 * and light. This one matters more than most: it is sixteen colour pickers, and
 * sixteen colour pickers that wrap badly at 375px are worse than one.
 *
 * IT MAKES ITS OWN ADMIN AND REMOVES IT AGAIN. There is no stored admin
 * password anywhere in this repo, deliberately, so `verify:chrome` cannot run
 * unattended and neither could this. It follows the pattern `check-brands.mjs`
 * already uses: create a throwaway staff account with the service key, drive
 * the real UI as that person, delete the account in a `finally`.
 *
 * It also leaves the BRAND alone. It reads whatever theme is stored, opens
 * every area so the pickers are on screen, and never saves. Nothing about a
 * real brand changes because somebody took a photograph of it.
 *
 * Usage, with `pnpm build && pnpm preview` running in another shell:
 *   SUPABASE_SERVICE_KEY=... node scripts/shots/shots-brand-look.mjs [baseUrl]
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

assertDevProject(env.VITE_SUPABASE_URL, 'shots-brand-look.mjs');
const BASE = process.argv[2] ?? 'http://localhost:4173';
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = 'shots/brand-look';
mkdirSync(OUT, { recursive: true });

const EMAIL = `shots-look-${Date.now()}@wurx.test`;
const PASSWORD = 'ShotsLook!2026';

const WIDTHS = [
  { w: 375, h: 1200, name: 'phone' },
  { w: 768, h: 1200, name: 'tablet' },
  { w: 1024, h: 1200, name: 'laptop' },
  { w: 1440, h: 1200, name: 'desktop' },
];

const { data: brand } = await admin.from('brands').select('id, name, slug').limit(1).single();
console.log(`\nThe look editor on ${brand.name}\n`);

const errors = [];
let userId = null;

try {
  const { data: made, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  userId = made.user.id;
  await admin.from('profiles').update({ role: 'admin' }).eq('id', userId);

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
        await page.fill('input[name="email"]', EMAIL);
        await page.fill('input[name="password"]', PASSWORD);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.waitForURL('**/admin**', { timeout: 30000 }).catch(() => {});

        await page.goto(`${BASE}/admin/brands/${brand.id}?section=about`, {
          waitUntil: 'domcontentloaded',
        });

        /*
         * THE WORLD FIRST, THEN THE WAITING. "No skeletons" is true of a page
         * that has not rendered, which is how a previous run photographed forty
         * loading screens and called every one of them fine. So the anchor that
         * only exists once the form is real comes first.
         */
        const field = page.getByRole('group', { name: /the brand.s look/i }).first();
        const arrived = await field
          .waitFor({ timeout: 20000 })
          .then(() => true)
          .catch(() => false);
        if (!arrived) {
          // Some builds render the label without a group role; fall back to text.
          await page
            .getByText(/hero banner/i)
            .first()
            .waitFor({ timeout: 10000 })
            .catch(() => {});
        }
        await page
          .waitForFunction(() => document.querySelectorAll('.wx-skeleton').length === 0, {
            timeout: 20000,
          })
          .catch(() => {});

        // Shut, so the four areas and the two previews fit one frame.
        await page.screenshot({ path: `${OUT}/${theme}-${name}-closed.png`, fullPage: true });

        /*
         * OPEN EVERY AREA. This is the state that can go wrong: four colour
         * inputs, a remove button each, an Add button, an angle slider and two
         * tone pills, inside a 375px column.
         */
        /*
         * MATCHED ON A PREFIX, not an exact string. Each of these buttons has
         * its hint inside it, so its accessible name is the label AND the
         * sentence under it: `/^menu$/` matched nothing and the Menu area was
         * photographed shut while the other three were open.
         */
        for (const label of [/^hero banner/i, /^menu/i, /^pages and cards/i, /^buttons and highlights/i]) {
          const row = page.getByRole('button', { name: label }).first();
          if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
            await row.click();
            await page.waitForTimeout(120);
          }
        }
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${theme}-${name}-open.png`, fullPage: true });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        if (overflow > 1) errors.push(`[${theme} ${name}] scrolls ${overflow}px sideways`);
        console.log(
          `  ${theme.padEnd(5)} ${String(w).padStart(4)}px  ${OUT}/${theme}-${name}-*.png` +
            (overflow > 1 ? `  <-- PAGE SCROLLS ${overflow}px SIDEWAYS` : '')
        );

        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  /*
   * The throwaway admin goes whatever happened above. An account with `admin`
   * on it, left behind by a screenshot script, is the kind of thing nobody
   * finds until it matters.
   */
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    console.log(`\nRemoved the throwaway admin ${EMAIL}`);
  }
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of [...new Set(errors)]) console.error(`  ${e}`);
  process.exit(1);
}
console.log('\nThe look editor, both themes, four widths. No console errors, no sideways scroll.\n');
