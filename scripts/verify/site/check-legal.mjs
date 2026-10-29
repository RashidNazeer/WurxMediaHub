#!/usr/bin/env node
/**
 * The two legal pages are up, public, and linked.
 *
 * WHY THIS IS WORTH A SCRIPT for two pages of prose: from 2026-08-26 they are a
 * SUBMISSION REQUIREMENT. TikTok's developer portal will not accept the Display
 * API app without a live Terms of Service URL and a live Privacy Policy URL, and
 * an app reviewer opens both. A route that silently stops resolving would fail
 * an app review weeks later, with nothing in this repo having failed.
 *
 * SIGNED OUT, deliberately. Every other browser suite here signs in first. The
 * whole point of these two is that a stranger — or a reviewer who has never
 * heard of us — can read them, so this asserts they work with no session at all.
 *
 * Usage, with `pnpm build && pnpm preview` running in another shell:
 *   node scripts/verify/site/check-legal.mjs [baseUrl]
 */

import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';

const PAGES = [
  { path: '/terms', heading: /terms of service/i },
  { path: '/privacy', heading: /privacy policy/i },
];
const WIDTHS = [
  { w: 375, h: 900, name: 'phone' },
  { w: 1440, h: 950, name: 'desktop' },
];

let pass = 0;
const problems = [];
const ok = (label) => {
  console.log(`  PASS  ${label}`);
  pass++;
};
const bad = (label) => {
  console.error(`  FAIL  ${label}`);
  problems.push(label);
};

const browser = await launchBrowser();
try {
  for (const theme of ['dark', 'light']) {
    for (const { w, h, name } of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        colorScheme: theme,
      });
      await ctx.addInitScript(([t]) => window.localStorage.setItem('wurxmediahub-theme', t), [
        theme,
      ]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));

      for (const { path, heading } of PAGES) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });

        /*
         * THE HEADING FIRST, then everything else. "No errors on the page" is
         * true of a page that never rendered, which is the bug shape this repo
         * keeps meeting: a check that passes loudest when its subject is absent.
         */
        const arrived = await page
          .getByRole('heading', { level: 1, name: heading })
          .first()
          .waitFor({ timeout: 15000 })
          .then(() => true)
          .catch(() => false);
        if (arrived) ok(`${theme} ${name} ${path} renders`);
        else bad(`${theme} ${name} ${path} NEVER RENDERED`);

        // Substance, not just a shell: a stub page would pass a heading check.
        const words = await page.evaluate(
          () => (document.querySelector('main')?.textContent ?? '').trim().split(/\s+/).length
        );
        if (words > 400) ok(`${theme} ${name} ${path} has real content (${words} words)`);
        else bad(`${theme} ${name} ${path} has only ${words} words`);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        if (overflow <= 1) ok(`${theme} ${name} ${path} does not scroll sideways`);
        else bad(`${theme} ${name} ${path} scrolls ${overflow}px sideways`);
      }

      if (errors.length === 0) ok(`${theme} ${name} no console errors`);
      else bad(`${theme} ${name} console errors: ${[...new Set(errors)].join(' | ')}`);

      await ctx.close();
    }
  }

  /*
   * LINKED FROM THE SITE, not merely reachable by URL. A reviewer looks for the
   * link in the footer; a URL that exists only in a form field reads as one made
   * for the form.
   */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  /*
   * WAIT FOR THE FOOTER TO EXIST BEFORE ASKING WHAT IS IN IT.
   *
   * The first version called `isVisible()` the instant `domcontentloaded`
   * fired, which is before React has rendered anything at all, so both links
   * reported missing while sitting correctly in the source AND in the built
   * bundle. Same shape as every other version of this bug in this repo: a check
   * that returns its most alarming answer when its subject has not arrived yet.
   */
  await page
    .locator('footer')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  for (const path of ['/privacy', '/terms']) {
    const linked = await page
      .locator(`footer a[href="${path}"]`)
      .first()
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (linked) ok(`the home page footer links to ${path}`);
    else bad(`the home page footer does NOT link to ${path}`);
  }

  /*
   * And the contact address is a real mailto rather than a leftover placeholder.
   * A privacy policy whose contact line says TODO is worse than none.
   */
  await page.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' });
  const mailto = await page.locator('a[href^="mailto:"]').first().getAttribute('href');
  if (mailto && !/todo|example|placeholder|change.?me/i.test(mailto)) {
    ok(`the privacy policy gives a real contact address (${mailto.replace('mailto:', '')})`);
  } else {
    bad(`the privacy policy contact address looks like a placeholder: ${mailto}`);
  }
  await ctx.close();
} finally {
  await browser.close();
}

console.log('\n' + '='.repeat(70));
if (problems.length) {
  console.error(`${problems.length} failed, ${pass} passed.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. Both legal pages are public, readable and linked.\n`);
