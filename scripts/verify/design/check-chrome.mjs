#!/usr/bin/env node
/**
 * The app's chrome: the rail, the top bar, the width of the work, and the text
 * size setting.
 *
 * WHY THIS EXISTS. Every check in here is a bug Rashid found himself and
 * reported on 2026-08-16, and every one of them is invisible to the suites we
 * already had: a rail can quietly go back to 280px, a scrollbar can reappear,
 * the menu can start snapping to the top again, a max-width can creep back onto
 * the content, and `check-responsive` would call all of it healthy, because the
 * page still lays out and nothing scrolls sideways. A screen that "looks fine"
 * is exactly the state these bugs live in.
 *
 * It is deliberately about the SHELL, not about any screen's content. The
 * screens are `check-responsive`'s job.
 *
 * Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/verify/design/check-chrome.mjs [baseUrl]
 */

import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
}

let failures = 0;
let passed = 0;
const check = (ok, label, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
};
const fail = (msg) => {
  failures += 1;
  console.error(`  FAIL  ${msg}`);
};

const NAV = 'nav[aria-label="Main"]';

const browser = await launchBrowser();

try {
  /* ------------------------------------------------------------ sign in -- */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('**/admin', { timeout: 25000 }).catch(() => {});
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (
    await hello
      .first()
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await hello.first().click();
    await page.waitForTimeout(1200);
  }
  await page.waitForSelector(NAV, { timeout: 20000 });

  /* --------------------------------------------------------- 1. the rail -- */
  console.log('\n[1] The rail');

  const railWidth = await page.evaluate(
    (nav) => document.querySelector(nav).closest('aside').getBoundingClientRect().width,
    NAV
  );
  // 15rem at the default 15px root is 225px; the assertion is a ceiling, not a
  // fixed number, because the rail is `rem` and moves with the text setting.
  check(railWidth <= 250, 'the rail is narrow, not the old 280px', `${Math.round(railWidth)}px`);

  const gutter = await page.evaluate((nav) => {
    const el = document.querySelector(nav);
    return el.offsetWidth - el.clientWidth;
  }, NAV);
  check(gutter === 0, 'the menu paints no scrollbar', `gutter ${gutter}px`);

  /*
   * THE SCROLL JUMP. Rashid: scroll down, click the last item, and the menu
   * snaps back to the top.
   *
   * The viewport is squeezed on purpose. At 900px tall the menu may well fit
   * entirely, and a check that passes because there was nothing to scroll is
   * worse than no check: it would go green forever while the bug came back for
   * everybody on a laptop.
   */
  console.log('\n[2] The menu stays where you left it');
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.waitForTimeout(200);

  const start = await page.evaluate((nav) => {
    const el = document.querySelector(nav);
    el.scrollTop = el.scrollHeight;
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
  }, NAV);

  if (start.max <= 0) {
    fail('the menu does not overflow even at 560px tall, so the jump cannot be tested');
  } else {
    const lastHref = await page.evaluate((nav) => {
      const links = [...document.querySelectorAll(`${nav} a[href]`)];
      return links[links.length - 1]?.getAttribute('href') ?? null;
    }, NAV);

    if (!lastHref) fail('no link found in the menu');
    else {
      await page.click(`${NAV} a[href="${lastHref}"]`);
      await page.waitForFunction(
        (href) => window.location.pathname === href,
        lastHref,
        { timeout: 15000 }
      );
      // Long enough for any late re-render, a query settling, or a lazy chunk
      // arriving to knock the position out.
      await page.waitForTimeout(600);

      const after = await page.evaluate((nav) => document.querySelector(nav).scrollTop, NAV);
      check(
        after > start.top - 20,
        'clicking the last item does not snap the menu to the top',
        `was ${Math.round(start.top)}, now ${Math.round(after)}`
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ------------------------------------------ 3. the mark collapses it ---- */
  console.log('\n[3] The mark is the collapse control');
  await page.goto(`${BASE}/admin/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(NAV, { timeout: 20000 });

  const arrows = await page
    .locator('header')
    .getByRole('button', { name: /collapse the menu|expand the menu/i })
    .count();
  check(arrows === 0, 'there is no collapse arrow in the top bar');

  const collapser = page.getByRole('button', { name: /collapse the menu/i });
  check((await collapser.count()) === 1, 'the mark in the rail collapses it');
  const wide = await page.evaluate(
    (nav) => document.querySelector(nav).closest('aside').getBoundingClientRect().width,
    NAV
  );
  await collapser.first().click();
  await page.waitForTimeout(350);
  const narrow = await page.evaluate(
    (nav) => document.querySelector(nav).closest('aside').getBoundingClientRect().width,
    NAV
  );
  check(narrow < wide - 40, 'clicking the mark actually collapses the rail', `${Math.round(wide)} -> ${Math.round(narrow)}px`);
  await page.getByRole('button', { name: /expand the menu/i }).first().click();
  await page.waitForTimeout(350);

  /* ------------------------------------------------ 4. the bar names it --- */
  console.log('\n[4] The top bar names the section');

  const NAMED = [
    { path: '/admin/applications', name: 'Applications' },
    { path: '/admin/offers', name: 'All offers' },
    { path: '/admin/offers/requests', name: 'Requests' },
    { path: '/admin/contests', name: 'Contests' },
    { path: '/admin/contests/claims', name: 'Contests' },
    { path: '/admin/brands', name: 'Brands Hub' },
    { path: '/admin/creators', name: 'Creators' },
    { path: '/admin/activity', name: 'Activity' },
    { path: '/admin/content', name: 'Content' },
  ];

  for (const screen of NAMED) {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { timeout: 20000 });
    await page.waitForTimeout(200);

    const h1s = await page.evaluate(() =>
      [...document.querySelectorAll('h1')].map((h) => h.textContent.trim())
    );
    // Exactly one, and it is the section. Two would mean a screen has started
    // drawing its own title again, which is the thing that was removed.
    check(h1s.length === 1, `${screen.path}: exactly one h1`, JSON.stringify(h1s));
    check(h1s[0] === screen.name, `${screen.path}: the h1 is "${screen.name}"`, h1s[0] ?? '(none)');

    // And it must agree with which row the sidebar lit, or the bar is lying.
    const lit = await page.evaluate(
      (nav) =>
        document.querySelector(`${nav} a[aria-current="page"]`)?.textContent?.trim() ?? null,
      NAV
    );
    check(
      lit !== null && screen.name.startsWith(lit.slice(0, 6)),
      `${screen.path}: the bar and the lit menu row agree`,
      `bar "${h1s[0]}", menu "${lit}"`
    );
  }

  /* ---------------------------------------------------- 5. the full width - */
  console.log('\n[5] The work fills the width');
  for (const w of [1280, 1600, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`${BASE}/admin/brands`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main', { timeout: 20000 });
    await page.waitForTimeout(250);
    const fill = await page.evaluate(() => {
      const main = document.querySelector('main');
      const inner = main.firstElementChild;
      return {
        main: main.getBoundingClientRect().width,
        inner: inner.getBoundingClientRect().width,
      };
    });
    check(
      fill.inner >= fill.main - 1,
      `at ${w}px the content is not capped short of the window`,
      `${Math.round(fill.inner)} of ${Math.round(fill.main)}px`
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ------------------------------------------------------ 6. text size ---- */
  console.log('\n[6] Text size is a setting, and it sticks');
  await page.goto(`${BASE}/admin/applications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 20000 });

  const base = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  check(base === '15px', 'the app opens at the smaller default', base);

  await page.getByRole('button', { name: /text size/i }).click();
  await page.getByRole('menuitemradio', { name: /^large$/i }).click();
  await page.waitForTimeout(250);
  const large = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  check(large === '16.5px', 'picking Large changes the whole app', large);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 20000 });
  const kept = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  check(kept === '16.5px', 'the choice survives a reload', kept);

  // At the largest setting the rail must still not clip a label, which is the
  // thing that breaks when a `rem` rail meets a `px` assumption.
  const clipped = await page.evaluate((nav) => {
    return [...document.querySelectorAll(`${nav} a, ${nav} span[aria-disabled]`)]
      .map((el) => {
        const label = el.querySelector('span:not(.sr-only)');
        if (!label) return null;
        return label.scrollWidth > label.clientWidth + 1 ? label.textContent.trim() : null;
      })
      .filter(Boolean);
  }, NAV);
  check(clipped.length === 0, 'no menu label is clipped at the Large setting', clipped.join(', '));

  await page.getByRole('button', { name: /text size/i }).click();
  await page.getByRole('menuitemradio', { name: /^default$/i }).click();
  await page.waitForTimeout(250);

  /*
   * THE PUBLIC PAGE MUST NOT INHERIT IT. The setting belongs to the signed-in
   * app; the landing page was drawn at the browser's 16px and has to stay
   * there. This is the check that catches the shell forgetting to clean up.
   *
   * IT HAS TO BE A SIGNED-OUT CONTEXT, and the first version of this check was
   * wrong for exactly that reason: `Landing` bounces a signed-in user straight
   * to their home, so visiting `/` while signed in measures an ADMIN screen and
   * reports the app's own scale as a leak onto the marketing page. A separate
   * context with no storage state is the only honest way to see `/`.
   */
  const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await anonPage.waitForTimeout(500);
  check(
    !/\/(admin|app|studio)/.test(new URL(anonPage.url()).pathname),
    'signed out, / really is the public page',
    anonPage.url()
  );
  const publicSize = await anonPage.evaluate(
    () => getComputedStyle(document.documentElement).fontSize
  );
  check(publicSize === '16px', 'the public page keeps the browser default', publicSize);
  await anonCtx.close();

  /* -------------------------------------------------------- 7. console ---- */
  console.log('\n[7] Console');
  check(consoleErrors.length === 0, 'no console errors anywhere in the run', consoleErrors.join(' | '));

  await ctx.close();
} catch (e) {
  fail(`unexpected error: ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} chrome check(s) FAILED.\n`);
  process.exit(1);
}
console.log(`${passed} checks passed. The shell holds: rail, bar, width and text size.\n`);
process.exit(0);
