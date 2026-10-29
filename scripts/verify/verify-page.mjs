#!/usr/bin/env node
/**
 * Browser smoke test.
 *
 * Rashid tests in the browser but cannot read a console, so "zero console
 * errors" has to be proven mechanically. This loads the built site in real
 * Chromium and fails if anything is wrong.
 *
 * Checks:
 *   - no console errors / warnings, no uncaught page errors, no failed requests
 *   - renders in dark AND light, with the theme toggle actually switching
 *   - no horizontal overflow at phone, tablet and desktop widths
 *   - the 404 route renders
 *   - screenshots written to .playwright/ for eyeballing
 *
 * Usage: node scripts/verify/verify-page.mjs [baseUrl]
 */

import { launchBrowser } from '../lib/browser.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SHOTS = '.playwright';
mkdirSync(SHOTS, { recursive: true });

/* ------------------------------------------------------ the brand colours -- */

/**
 * THE EXPECTED COLOURS ARE READ FROM `tokens.css`, NEVER TYPED HERE.
 *
 * They used to be three literals: rgb(10,10,10), rgb(250,248,243),
 * rgb(20,18,14). The surfaces were deliberately retuned to the design's warmer
 * near-black and paper during the creator UI rebuild on 2026-08-10, tokens.css
 * moved, and these three did not. So this suite failed on every run from that
 * day until 2026-08-14 and nobody noticed, which made it worth exactly nothing
 * for four days.
 *
 * The check was never really about those numbers. Its own comment said so: "the
 * real test of the token system: is the page actually dark?" What can genuinely
 * go wrong is the stylesheet not loading, the theme attribute not being applied,
 * or something overriding the token, and all three are caught by comparing the
 * rendered colour to whatever the token says TODAY. A deliberate palette change
 * is then not a test failure, because it is not a bug.
 *
 * `check:contrast` is what guards the palette itself, in both modes, inside the
 * build. That job is not this file's.
 */
const TOKENS = readFileSync('src/styles/tokens.css', 'utf8');

/** The `[data-theme='dark']` block, then the `[data-theme='light']` one. */
function tokenBlock(selector) {
  const at = TOKENS.indexOf(selector);
  if (at === -1) throw new Error(`no ${selector} block in tokens.css`);
  return TOKENS.slice(at, TOKENS.indexOf('\n}', at));
}

function rgbOf(block, name) {
  const m = block.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
  if (!m) throw new Error(`no ${name} in that tokens.css block`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  // The shape getComputedStyle returns, so the comparison is a plain string
  // equality rather than a colour parser nobody will maintain.
  return `rgb(${r}, ${g}, ${b})`;
}

const DARK = tokenBlock("[data-theme='dark']");
const LIGHT = tokenBlock("[data-theme='light']");

const EXPECT = {
  darkBg: rgbOf(DARK, '--wx-bg'),
  lightBg: rgbOf(LIGHT, '--wx-bg'),
  lightText: rgbOf(LIGHT, '--wx-text'),
};

const problems = [];
const note = (m) => console.log(`  ${m}`);
const bad = (m) => {
  console.error(`  FAIL  ${m}`);
  problems.push(m);
};

/** Noise that is not our code's fault and would make the check useless. */
const IGNORE = [
  /favicon\.ico/i,
  /fonts\.googleapis\.com|fonts\.gstatic\.com/i, // network flakiness, not a bug
  /Download the React DevTools/i,
];
const ignorable = (t) => IGNORE.some((re) => re.test(t));

const browser = await launchBrowser();

/**
 * Scroll the whole page, then return to the top.
 *
 * Sections fade in with `whileInView`, so anything below the fold is still at
 * opacity 0 until it has been scrolled past. Without this, a full-page
 * screenshot is mostly blank and every check below the fold is meaningless.
 */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.75;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.waitForTimeout(500);
}

/** Fail if any section is still invisible after the page has been scrolled. */
async function assertNothingInvisible(page) {
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('section, main > div, footer')]
      .filter((el) => {
        const s = getComputedStyle(el);
        return (
          el.getBoundingClientRect().height > 40 &&
          (parseFloat(s.opacity) < 0.9 || s.visibility === 'hidden')
        );
      })
      .map((el) => el.tagName + (el.id ? '#' + el.id : '') + ' opacity=' + getComputedStyle(el).opacity)
  );
  return hidden;
}

/** Open a page with console/error/request listeners attached. */
async function openPage(ctxOpts = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const found = [];
  page.on('console', (msg) => {
    const type = msg.type();
    if ((type === 'error' || type === 'warning') && !ignorable(msg.text())) {
      found.push(`console.${type}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (e) => found.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    if (!ignorable(r.url())) found.push(`requestfailed: ${r.url()}, ${r.failure()?.errorText}`);
  });
  return { ctx, page, found };
}

console.log(`\nBrowser verification against ${BASE}\n${'='.repeat(70)}`);

/* -------------------------------------------------- 1. dark mode, desktop -- */
console.log('\n[1] Dark mode, 1440x900');
{
  const { ctx, page, found } = await openPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const res = await page.goto(BASE, { waitUntil: 'networkidle' });
  if (!res || res.status() !== 200) bad(`page returned HTTP ${res?.status()}`);

  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'dark') bad(`expected data-theme="dark", got "${theme}"`);
  else note(`OK    data-theme=dark`);

  const h1 = await page.textContent('h1');
  if (!h1?.includes('Your numbers')) bad(`headline missing, got "${h1}"`);
  else note(`OK    headline renders`);

  // The real test of the token system: is the page actually dark, in the colour
  // tokens.css says today?
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg !== EXPECT.darkBg) bad(`dark background should be ${EXPECT.darkBg} per tokens.css, got ${bg}`);
  else note(`OK    background ${bg}, matching --wx-bg`);

  await scrollThrough(page);
  const hidden = await assertNothingInvisible(page);
  if (hidden.length) hidden.forEach((h) => bad(`still invisible after scrolling: ${h}`));
  else note(`OK    every section revealed after scrolling`);

  await page.screenshot({ path: `${SHOTS}/01-dark-desktop.png`, fullPage: true });
  found.forEach(bad);
  await ctx.close();
}

/* ------------------------------------------------- 2. light mode, desktop -- */
console.log('\n[2] Light mode, 1440x900 (OS preference)');
{
  const { ctx, page, found } = await openPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const theme = await page.getAttribute('html', 'data-theme');
  if (theme !== 'light') bad(`expected data-theme="light", got "${theme}"`);
  else note(`OK    data-theme=light (followed the OS setting)`);

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg !== EXPECT.lightBg)
    bad(`light background should be ${EXPECT.lightBg} per tokens.css, got ${bg}`);
  else note(`OK    background ${bg}, matching --wx-bg`);

  const color = await page.evaluate(() => getComputedStyle(document.body).color);
  if (color !== EXPECT.lightText)
    bad(`light text should be ${EXPECT.lightText} per tokens.css, got ${color}`);
  else note(`OK    text ${color}, matching --wx-text`);

  await scrollThrough(page);
  await page.screenshot({ path: `${SHOTS}/02-light-desktop.png`, fullPage: true });
  found.forEach(bad);
  await ctx.close();
}

/* ----------------------------------------------------- 3. the theme toggle -- */
console.log('\n[3] Theme toggle cycles light -> dark -> system');
{
  const { ctx, page, found } = await openPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const toggle = page.getByRole('button', { name: /theme/i });
  if ((await toggle.count()) === 0) bad('theme toggle button not found');
  else {
    const seen = [await page.getAttribute('html', 'data-theme')];
    for (let i = 0; i < 3; i++) {
      await toggle.click();
      await page.waitForTimeout(320);
      seen.push(await page.getAttribute('html', 'data-theme'));
    }
    if (!seen.includes('light') || !seen.includes('dark')) {
      bad(`toggle never reached both themes: ${seen.join(' -> ')}`);
    } else {
      note(`OK    ${seen.join(' -> ')}`);
    }

    // The choice must survive a reload, that is the whole point of storing it.
    const before = await page.getAttribute('html', 'data-theme');
    await page.reload({ waitUntil: 'networkidle' });
    const after = await page.getAttribute('html', 'data-theme');
    if (before !== after) bad(`theme not persisted across reload: ${before} -> ${after}`);
    else note(`OK    persisted "${after}" across reload`);
  }
  found.forEach(bad);
  await ctx.close();
}

/* ------------------------------------------------ 4. responsive, no overflow -- */
console.log('\n[4] Responsive, no horizontal scroll');
for (const [label, width, height] of [
  ['iPhone SE', 375, 667],
  ['iPhone 15', 393, 852],
  ['iPad', 768, 1024],
  ['Desktop', 1440, 900],
]) {
  const { ctx, page, found } = await openPage({ viewport: { width, height } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 0) bad(`${label} (${width}px): page scrolls horizontally by ${overflow}px`);
  else note(`OK    ${label} (${width}px)`);
  if (width === 393) {
    await scrollThrough(page);
    await page.screenshot({ path: `${SHOTS}/03-mobile-dark.png`, fullPage: true });
  }
  found.forEach(bad);
  await ctx.close();
}

/* ---------------------------------------------------------- 5. 404 route -- */
console.log('\n[5] Unknown route renders the 404 page');
{
  const { ctx, page, found } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/this-does-not-exist`, { waitUntil: 'networkidle' });
  const text = await page.textContent('body');
  if (!text?.includes('404')) bad('404 page did not render');
  else note('OK    404 renders');
  found.forEach(bad);
  await ctx.close();
}

/* ------------------------------------------------- 6. application form -- */
console.log('\n[6] Application form');
{
  const { ctx, page, found } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Submitting an empty form must surface errors, not silently do nothing.
  // The validator is a lazily-loaded chunk, so wait for the result rather than
  // guessing a timeout: over a real network that download is not instant.
  await page.getByRole('button', { name: /takes 60 seconds/i }).click();
  let errorCount = 0;
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('[role="alert"]').length >= 4,
      { timeout: 8000 }
    );
    errorCount = await page.locator('[role="alert"]').count();
  } catch {
    errorCount = await page.locator('[role="alert"]').count();
  }
  if (errorCount < 4) bad(`empty submit showed only ${errorCount} errors, expected 5`);
  else note(`OK    empty submit blocked with ${errorCount} field errors`);

  // Choosing "Other" must reveal the follow-up question.
  await page.selectOption('select[name="niche"]', 'Other');
  await page.waitForTimeout(420);
  const otherVisible = await page.locator('input[name="nicheOther"]').isVisible();
  if (!otherVisible) bad('choosing "Other" did not reveal the extra niche input');
  else note('OK    "Other" reveals the follow-up input');

  // A bad email must be rejected.
  await page.fill('input[name="tiktokHandle"]', '@wurxcreator');
  await page.fill('input[name="email"]', 'not-an-email');
  await page.fill('input[name="nicheOther"]', 'Home fragrance');
  await page.selectOption('select[name="workedWithWurx"]', 'yes');
  await page.fill('textarea[name="videoLinks"]', 'https://tiktok.com/@wurxcreator/video/123');
  await page.waitForTimeout(250);
  const emailInvalid = await page.locator('input[name="email"][aria-invalid="true"]').count();
  if (emailInvalid !== 1) bad('an invalid email was not flagged');
  else note('OK    invalid email rejected');

  // A password is required, because applying creates the account.
  const pwCount = await page.locator('input[name="password"]').count();
  if (pwCount !== 1) bad('the application form has no password field');
  else note('OK    password field present (applying creates the account)');

  const shortPw = await page.locator('input[name="password"][aria-invalid="true"]').count();
  if (shortPw !== 1) bad('a missing password was not flagged');
  else note('OK    missing password rejected');

  // Signing in must be reachable from the form.
  const signInLink = await page.locator('a[href="/login"]').count();
  if (signInLink < 1) bad('no way to reach sign in from the application form');
  else note('OK    existing users can get to sign in');

  // Submitting for real is covered end to end by scripts/verify/auth/check-apply.mjs,
  // which also verifies the row landed in the database and cleans up after
  // itself. Doing it here would leave junk accounts behind on every run.
  found.forEach(bad);
  await ctx.close();
}

await browser.close();

console.log(`\n${'='.repeat(70)}`);
if (problems.length) {
  console.error(`${problems.length} problem(s) found.\n`);
  process.exit(1);
}
console.log(`All browser checks passed. Screenshots in ${SHOTS}/\n`);
