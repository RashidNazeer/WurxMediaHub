#!/usr/bin/env node
/**
 * Responsiveness guard.
 *
 * Wurx targets US and UK TikTok Shop creators, who are mostly on phones and
 * tablets, while the team works on laptops and desktops. CLAUDE.md makes that a
 * standing rule; this makes it checkable instead of a promise.
 *
 * Every signed-in screen is opened at four widths and must:
 *   * not scroll the page sideways
 *   * keep its heading and primary content visible
 *   * put no element outside the viewport
 *   * log nothing to the console
 *
 * Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/verify/design/check-responsive.mjs [baseUrl]
 */

import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';

// No service key and no .env.local needed: this suite only drives the browser
// and reads the layout back, so it can run against any deployed URL.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
}

const WIDTHS = [
  { name: 'iPhone SE', width: 375, height: 780 },
  { name: 'iPad portrait', width: 768, height: 1024 },
  { name: 'iPad landscape', width: 1024, height: 800 },
  { name: 'Laptop', width: 1440, height: 900 },
];

// A creator account to check the screens creators actually use. These are the
// ones most likely to be opened on a phone, so leaving them out would miss the
// point of this suite. Falls back to the demo seed from seed-applications.mjs.
const CREATOR_EMAIL = process.env.CREATOR_EMAIL ?? 'skinbyamara@wurxmediahub.demo';
const CREATOR_PASSWORD = process.env.CREATOR_PASSWORD ?? 'demo-password-for-dev-only-1';

const SCREENS = [
  /*
   * WHAT `expect` IS ALLOWED TO POINT AT.
   *
   * Every admin screen lost its <h1> title row and its description paragraph on
   * 2026-08-16. The section name lives in the shell's top bar now, where
   * AppShell renders it as the page's only <h1>. That broke eight rows below:
   * some named copy that no longer exists ("Good to see you", "Every deal on
   * the table", "Every video the roster has posted"), the rest named the
   * deleted heading itself (/^brands$/, /^creators$/, /^activity$/,
   * /^applications$/, /offer requests/).
   *
   * THE OBVIOUS REPAIR WAS THE WRONG ONE. Pointing these at the new top-bar
   * name would have been worse than leaving them broken, because the bar is
   * drawn from the route rather than from the screen: "Brands" would be on
   * screen even if Brands.tsx rendered nothing at all, and this suite would
   * report a healthy layout for a blank page. That is the same mistake as the
   * sidebar incident recorded further down, where an unscoped search matched
   * the rail's own link and reported a bug that did not exist. The match is
   * scoped to <main>, and the top bar sits outside <main>, so nothing here can
   * be satisfied by the shell even by accident.
   *
   * So each row names something only the SCREEN can put on the page: a filter
   * tab, a control in its own filter row, a label on its own data, or its empty
   * state. Prefer whatever survives an empty dev database AND a failed query,
   * because neither is a layout bug and both would otherwise read as one.
   */
  // The three inbox tiles ARE the dashboard, and they render in every state
  // including the one where the counts failed to load. check-review.mjs asserts
  // this same string, so the two suites cannot drift apart on it.
  { path: '/admin', name: 'Dashboard', expect: /people asking to join/i },
  // The "Worked with Wurx" toggle in the filter row, and deliberately NOT one
  // of the column headings: that row is `hidden md:grid`, so anything taken
  // from it is genuinely invisible at 375px and this suite would fail a healthy
  // phone layout on every run.
  { path: '/admin/applications', name: 'Applications', expect: /worked with wurx/i },
  // Filter tab labels. They come from static arrays in the route files, so they
  // hold up with no rows, no matches, or a dead database, none of which is a
  // responsiveness failure.
  { path: '/admin/offers', name: 'All offers', expect: /switched off/i },
  { path: '/admin/offers/requests', name: 'Offer requests', expect: /withdrawn/i },
  /*
   * Activity has no filter row at all, on purpose, so there is no static
   * control to aim at. These are the two ends of the one list it does draw: its
   * pager once the log has entries, its empty state when it truly has none. The
   * error state ("The log would not load") matches neither, which is the point,
   * a screen that failed to load must not pass as a screen that laid out fine.
   */
  {
    path: '/admin/activity',
    name: 'Activity',
    expect: /nothing has happened yet|\d+ to \d+ of \d+/i,
  },
  // The tab is in the filter row and the view switch beside it defaults to
  // Submissions, so this is on screen before any content has loaded.
  { path: '/admin/content', name: 'Content', expect: /another take/i },
  // The primary action in the filter row, which this screen keeps in every
  // state, loading and empty included.
  { path: '/admin/brands', name: 'Brands', expect: /add brand/i },
  // Creators has no button and no tabs, only a search box and two selects, and
  // an <option> inside a closed <select> has no box to measure so it can never
  // count as visible. This is the card's own money label, with both empty
  // states behind it, the same shape as Creator detail below.
  {
    path: '/admin/creators',
    name: 'Creators',
    expect: /agreed|no creators yet|nobody matches that/i,
  },
  /*
   * SCREENS BEHIND AN ID.
   *
   * These have never been width-checked, and the brand hub is the screen with
   * the most on it in the whole admin panel: eight tabs, a money split, a
   * content card and a paged roster. The suite has no service key so it cannot
   * invent an id; `via` makes it open the list and follow the first row, the
   * way a person would. A list with nothing in it is reported and skipped
   * rather than failed, because an empty dev database is not a layout bug.
   */
  {
    path: '/admin/brands',
    via: 'a[href^="/admin/brands/"]',
    name: 'Brand hub',
    // The hub lands on Offers rather than on a summary, and this is the action
    // in that tab's filter row. It used to be the line above it, "What this
    // brand pays creators for content", which went with every other description
    // row on 2026-08-16. Still proves the same thing the old one did: the
    // default tab drew its own body, not just the eight tab buttons.
    expect: /new offer/i,
  },
  {
    path: '/admin/creators',
    via: 'a[href^="/admin/creators/"]',
    name: 'Creator detail',
    expect: /agreed|nothing taken yet/i,
  },
  {
    path: '/admin/applications',
    via: 'a[href^="/admin/applications/"]',
    name: 'Application detail',
    expect: /^application$/i,
  },
  { path: '/app', name: 'Creator home', expect: /joining|welcome to wurx|not this time/i, as: 'creator' },
  { path: '/app/brands', name: 'Creator brand hubs', expect: /brand hubs/i, as: 'creator' },
  { path: '/app/offers', name: 'Creator offers', expect: /everything on the table/i, as: 'creator' },
  {
    path: '/app/content',
    name: 'Creator content',
    expect: /every video you have filmed|nothing to film yet/i,
    as: 'creator',
  },
  // The expectation covers both states on purpose. This suite has no service
  // key, so it cannot promote its own account, and the demo creator may be
  // approved or still in review depending on what was last seeded. Either way
  // the screen has to render and must not scroll sideways, which is what is
  // being measured here.
  {
    path: '/app/brands/vitauthority',
    name: 'Creator brand hub',
    expect: /vitauthority|opens when you are approved/i,
    as: 'creator',
  },
  /*
   * The leaderboard, added 2026-08-20. The expectation covers both of its real
   * states, because this suite has no service key and cannot decide whether its
   * demo creator has figures: either they are on the board, or the band at the
   * top tells them why they are not. Both have to lay out, and neither may
   * scroll the page sideways — the board is a four column table on a laptop and
   * a stack of cards on a phone, and that fold is the thing being measured.
   */
  {
    path: '/app/leaderboards',
    name: 'Creator leaderboard',
    expect: /you are not on the board yet|top \d+% of creators|the board is empty/i,
    as: 'creator',
  },
  { path: '/admin/login', name: 'Staff sign in', expect: /staff access/i, anon: true },
  { path: '/login', name: 'Creator sign in', expect: /welcome back/i, anon: true },
];

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));

const browser = await launchBrowser();

try {
  console.log(`\nResponsiveness against ${BASE}\n${'='.repeat(70)}`);

  // Sign in once at a wide size, then reuse the session at every width.
  const signInOnce = async (door, email, password, landing) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${door}`, { waitUntil: 'networkidle' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(`**${landing}`, { timeout: 25000 }).catch(() => {});
    // Clear the one-time welcome if this account has never seen it, so the
    // screens underneath are what actually gets measured.
    const hello = page.getByRole('button', { name: /let.s go/i });
    if (
      await hello
        .first()
        .waitFor({ state: 'visible', timeout: 6000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await hello.first().click();
      await page.waitForTimeout(1500);
    }
    const state = await ctx.storageState();
    await ctx.close();
    return state;
  };

  const session = await signInOnce('/admin/login', ADMIN_EMAIL, ADMIN_PASSWORD, '/admin');
  const creatorSession = await signInOnce(
    '/login',
    CREATOR_EMAIL,
    CREATOR_PASSWORD,
    '/app'
  );

  for (const size of WIDTHS) {
    console.log(`\n[${size.name}] ${size.width}x${size.height}`);

    for (const screen of SCREENS) {
      const ctx = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        ...(screen.anon
          ? {}
          : { storageState: screen.as === 'creator' ? creatorSession : session }),
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

      /*
       * `domcontentloaded`, not `networkidle`.
       *
       * Several screens hold an open realtime websocket, which means the
       * network is never idle and the wait can only ever time out. Even on the
       * screens that do not, waiting for silence on a live deployment from a
       * busy laptop times out often enough to look like a layout bug. What this
       * suite actually needs is below: the expected content visible, and the
       * page measured once it is.
       */
      await page.goto(`${BASE}${screen.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);

      // Follow the first row into the screen behind it, for anything that
      // lives at an id this suite cannot know.
      if (screen.via) {
        const link = page.locator(`main ${screen.via}`).first();
        const there = await link
          .waitFor({ state: 'visible', timeout: 8000 })
          .then(() => true)
          .catch(() => false);
        if (!there) {
          console.log(`  SKIP  ${screen.name}: nothing in ${screen.path} to open`);
          await ctx.close();
          continue;
        }
        await link.click();
        await page.waitForTimeout(1800);
      }

      // Scoped to <main> on purpose. The desktop rail is rendered at every
      // width and merely hidden by CSS below `lg`, so an unscoped search finds
      // the sidebar's "Applications" link, waits for something deliberately
      // invisible, and reports a layout bug that does not exist.
      const seen = await page
        .locator('main')
        .getByText(screen.expect)
        .first()
        .waitFor({ state: 'visible', timeout: 12000 })
        .then(() => true)
        .catch(() => false);

      // A page wider than its viewport is the classic mobile failure: the whole
      // layout slides sideways and half the controls sit off screen.
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      }));

      // Find WHICH element is too wide, so a failure is actionable rather than
      // "something, somewhere, is 12px too big".
      const culprits =
        overflow.doc > overflow.win + 1
          ? await page.evaluate(() => {
              const bad = [];
              for (const el of document.querySelectorAll('body *')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > window.innerWidth + 1) {
                  bad.push(
                    `${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 60)} right=${Math.round(r.right)}`
                  );
                }
                if (bad.length >= 3) break;
              }
              return bad;
            })
          : [];

      const label = `${screen.name} ${screen.path}`;
      check(seen, `${label}: content rendered`);
      check(
        overflow.doc <= overflow.win + 1,
        `${label}: no sideways scroll (page ${overflow.doc}px in ${overflow.win}px)`
      );
      culprits.forEach((c) => console.error(`        too wide: ${c}`));
      check(errors.length === 0, `${label}: clean console (${errors.length})`);
      errors.slice(0, 2).forEach((e) => console.error(`        ${e}`));

      await ctx.close();
    }
  }
  /* ------------------------------------------------------- modals ------- */
  // Screens are only half the story: a dialog is a separate layout that can be
  // taller than a phone. The review dialog once put its own heading above the
  // top of a short viewport with no way to scroll to it, and a page-level
  // check could never have seen that, because the PAGE was fine.
  const SHORT = [
    { name: 'iPhone SE, short', width: 375, height: 600 },
    { name: 'Phone landscape', width: 740, height: 360 },
  ];

  for (const size of SHORT) {
    console.log(`\n[${size.name}] ${size.width}x${size.height}, review dialog`);
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      storageState: session,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/applications?status=pending`, {
      waitUntil: 'networkidle',
    });
    // Wait for the list itself, not a guessed delay: an empty page and a
    // still-loading one look identical, and skipping quietly would hide the
    // very bug this section exists to catch.
    await page
      .waitForSelector('a[href^="/admin/applications/"]', { timeout: 15000 })
      .catch(() => {});

    const selectAll = page
      .getByRole('checkbox', { name: /select every pending application/i })
      .locator('visible=true');
    if ((await selectAll.count()) === 0) {
      console.log('        skipped: nothing pending to select');
      await ctx.close();
      continue;
    }

    await selectAll.first().check();
    await page.getByRole('button', { name: /^approve$/i }).first().click();
    await page.waitForTimeout(700);

    const dialog = page.getByRole('dialog');
    check((await dialog.count()) > 0, `${size.name}: the dialog opened`);

    // The heading must be inside the viewport, or reachable by scrolling the
    // dialog. Anything above y=0 with no scroll is lost for good.
    const heading = dialog.getByRole('heading').first();
    const reachable = await heading
      .evaluate((el) => {
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      })
      .catch(() => false);
    check(reachable, `${size.name}: the dialog heading can actually be seen`);

    const confirm = page.getByRole('button', { name: /^yes,/i }).first();
    const confirmReachable = await confirm
      .evaluate((el) => {
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      })
      .catch(() => false);
    check(confirmReachable, `${size.name}: the confirm button can be reached`);

    await ctx.close();
  }
} catch (e) {
  fail(`unexpected error: ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} responsiveness check(s) FAILED.\n`);
  process.exit(1);
}
console.log('Every screen holds up from phone to desktop.\n');
