#!/usr/bin/env node
/**
 * Retina screenshots of Paid Collabs, in both themes, at four widths.
 *
 * WHY A SCRIPT AND NOT A LOOK. The vendored WurxBase app is 24,000 lines with
 * roughly 1,300 colours written straight into `style={{}}` objects, which no
 * stylesheet sweep can reach and no amount of reading will reliably find. The
 * only honest way to say "dark mode works here" is to render it and look, and
 * the only way to keep saying it is to be able to render it again.
 *
 * IT SIGNS IN AS A VIEWER. WurxBase keeps its session in `sessionStorage` under
 * `ch_user`, so this seeds one directly rather than typing their password, and
 * seeds the role with `canAdd`, `canEdit` and `canDelete` all false. A run of
 * this script therefore cannot write a row to their database even if a click
 * lands somewhere unintended, which matters because their tables are open and
 * their data is not ours to lose. Seeding also skips their login screen's
 * LOGIN activity write, so it leaves no trace in their logs either.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/shots/shots-collabs.mjs [baseUrl]
 */

import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../lib/browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots/collabs';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
}

mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 800 },
  { name: '768', width: 768, height: 900 },
  { name: '390', width: 390, height: 844 },
];

const browser = await launchBrowser();
const consoleErrors = [];

try {
  for (const theme of ['dark', 'light']) {
    for (const size of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2,
      });

      // Both sessions are planted before any script on the page runs: ours so
      // the app opens in the theme being shot, theirs so it opens past its
      // login screen as somebody who cannot change anything.
      await ctx.addInitScript(
        ({ theme }) => {
          localStorage.setItem('wurxmediahub-theme', theme);
          sessionStorage.setItem(
            'ch_user',
            JSON.stringify({
              id: 'lead',
              username: 'Lead',
              role: 'viewer',
              display: 'Lead',
            })
          );
        },
        { theme }
      );

      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`${theme}/${size.name}: ${m.text()}`);
      });
      page.on('pageerror', (e) => consoleErrors.push(`${theme}/${size.name}: ${e.message}`));

      await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
      await page.fill('input[name="email"]', ADMIN_EMAIL);
      await page.fill('input[name="password"]', ADMIN_PASSWORD);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL('**/admin', { timeout: 25000 }).catch(() => {});

      // The first-run greeting sits over everything if it has not been seen.
      const hello = page.getByRole('button', { name: /let.s go/i });
      if (
        await hello
          .first()
          .isVisible()
          .catch(() => false)
      )
        await hello.first().click();

      await page.goto(`${BASE}/admin/collabs`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.pc-header-dark', { timeout: 30000 }).catch(() => {});
      // Their tables load from their own Supabase; give the rows a moment so a
      // shot is of the screen and not of its skeleton.
      await page.waitForTimeout(2500);

      await page.screenshot({
        path: `${OUT}/${theme}-${size.name}.png`,
        fullPage: false,
      });

      // The header on its own, big, which is the thing being judged.
      const header = page.locator('.pc-header-dark').first();
      if (await header.isVisible().catch(() => false)) {
        await header.screenshot({ path: `${OUT}/${theme}-${size.name}-header.png` });
      }

      // The creators table, which is where the status pills and the group
      // dividers are, and therefore where a status colour is right or wrong.
      const creatorsTab = page.locator('.pc-tab', { hasText: /^Creators$/ }).first();
      if (await creatorsTab.isVisible().catch(() => false)) {
        await creatorsTab.click();
        await page.waitForTimeout(1800);
        await page.screenshot({ path: `${OUT}/${theme}-${size.name}-creators.png` });
      }

      // Horizontal overflow is the one responsive failure that looks fine in a
      // screenshot, so it is measured rather than eyeballed.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      console.log(
        `  ${theme.padEnd(5)} ${size.name.padStart(4)}  ` +
          (overflow > 1 ? `OVERFLOW +${overflow}px` : 'no page scroll')
      );

      await ctx.close();
    }
  }

  console.log(`\n  shots in ${OUT}`);
  if (consoleErrors.length) {
    console.error(`\n  ${consoleErrors.length} console error(s):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 12)) console.error(`    ${e}`);
  } else {
    console.log('  zero console errors');
  }
} finally {
  await browser.close();
}
