#!/usr/bin/env node
/**
 * Paid Collabs paints ONE canvas, all the way down.
 *
 *   pnpm build && pnpm preview
 *   COLLAB_STAFF_PASSWORD=... node scripts/verify/collabs/check-collab-canvas.mjs
 *
 * WHY THIS EXISTS. Rashid photographed the Discovery tab: the top 375px was
 * the page colour and the 473px below it was a tan block. Three rules in their
 * stylesheet paint the container, all `!important`, all commented as a PAGE —
 * "App surface", "Canvas: warm cream everywhere", "Lift body bg so cards stand
 * out" — and the retokenising sweep had handed every one of them a 10% tint.
 * Upstream, the winning rule was `#F4F5F7`: a near-white page grey chosen so
 * white cards would lift off it. A codemod cannot tell a pale canvas from a
 * tint, and this is the third time that has cost us a surface.
 *
 * It went unseen for a fortnight for two reasons worth knowing:
 *
 *   1. IT IS LIGHT-MODE ONLY. Their file carries 214 dark-only rules and no
 *      light-only ones, and one of them already repainted `.app-root` for dark.
 *      Treat any tint bug found here as light-only until measured otherwise.
 *   2. IT IS LOUDEST WHILE LOADING, because that is when their content is
 *      shortest. A check that waits for a settled page would not have caught
 *      the screenshot that was actually sent. So every tab is measured TWICE,
 *      once at 1.2s and again at 12s.
 *
 * WHAT IT ASSERTS, and what it deliberately does not: the empty region BELOW
 * their app must be the page canvas. An earlier version asked whether the page
 * crossed two wide bands of different colour, and flagged the tall white card
 * on Brands — a card on a page is not a seam, and a guard that cannot tell
 * them apart gets switched off within a week.
 *
 * Proven to fail before it was trusted: run it with
 * BASE_URL=https://wurxmediahubdev.vercel.app against any build before
 * 2026-09-01 and it reports 40 failures.
 */
const { launchBrowser } = await import('../../lib/browser.mjs');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUT = process.env.SHOT_DIR || 'shots/collab-canvas';
const TABS = ['brands', 'creators', 'performance', 'reporting', 'leaderboard', 'discovery'];
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const PASSWORD = process.env.COLLAB_STAFF_PASSWORD;
if (!PASSWORD) throw new Error('COLLAB_STAFF_PASSWORD must be set');
const { mkdirSync } = await import('node:fs');
mkdirSync(OUT, { recursive: true });

const pass = [], fail = [];
const check = (ok, msg, d) => (ok ? pass : fail).push(d ? `${msg} — ${d}` : msg);

const PROBE = () => {
  const get = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { bg: getComputedStyle(el).backgroundColor, h: Math.round(r.height), top: Math.round(r.top) };
  };
  // the bands of colour a reader crosses going down the middle of the page
  const x = Math.round(innerWidth / 2);
  const bands = [];
  for (let y = 120; y < innerHeight - 4; y += 8) {
    const el = document.elementFromPoint(x, y);
    if (!el) continue;
    // the painted colour is the first opaque background up the tree
    let n = el, bg = 'rgba(0, 0, 0, 0)';
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; }
      n = n.parentElement;
    }
    const last = bands[bands.length - 1];
    if (!last || last.bg !== bg) bands.push({ from: y, to: y, bg });
    else last.to = y;
  }
  // what is painted in the gap between the bottom of their app and the fence
  const paintAt = (y) => {
    let n = document.elementFromPoint(x, y);
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)') return { y, bg: c, cls: (n.className || '').toString().slice(0, 40) };
      n = n.parentElement;
    }
    return { y, bg: 'rgba(0, 0, 0, 0)', cls: '' };
  };
  const app = document.querySelector('.pc-app');
  const fence = document.querySelector('.wurxbase-fence');
  let below = null;
  if (app && fence) {
    const ab = app.getBoundingClientRect().bottom;
    const fb = Math.min(fence.getBoundingClientRect().bottom, innerHeight);
    if (fb - ab > 60) below = paintAt(Math.round(ab + (fb - ab) / 2));
  }
  const cs = getComputedStyle(document.querySelector('.wurxbase-root'));
  const hex = cs.getPropertyValue('--wx-bg').trim();
  // resolve the token to the rgb() form getComputedStyle reports
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;background:${hex}`;
  document.body.appendChild(probe);
  const pageCanvas = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return {
    root: get('.wurxbase-root'),
    appRoot: get('.app-root'),
    pcApp: get('.pc-app'),
    fence: get('.wurxbase-fence'),
    wxBg: hex,
    pageCanvas,
    below,
    bands,
  };
};

const browser = await launchBrowser();
try {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
    await ctx.addInitScript(({ t }) => { localStorage.setItem('wurxmediahub-theme', t); }, { t: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
    const hello = page.getByRole('button', { name: /let.s go/i });
    if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

    for (const tab of TABS) {
      await page.goto(`${BASE}/admin/collabs/${tab}`, { waitUntil: 'domcontentloaded' });
      /* EARLY, deliberately: the reported screenshot was taken while Discovery
         was still "Finding stores…". A check that only looks at a settled page
         would not have seen the bug at all. */
      await page.waitForTimeout(1200);
      const early = await page.evaluate(PROBE);
      await page.waitForTimeout(11000);
      const settled = await page.evaluate(PROBE);
      await page.screenshot({ path: `${OUT}/${theme}-${tab}.png` });

      for (const [when, r] of [['loading', early], ['settled', settled]]) {
        if (!r.root) { check(false, `${theme}/${tab} ${when}: no container rendered`); continue; }
        /*
         * Every full-height surface paints the PAGE CANVAS. Compared against
         * the resolved token rather than against the literal gold, so this
         * still means something after a palette change — a guard written as
         * "not rgba(138,95,31,0.1)" would pass the day the tint moved.
         */
        check(r.root.bg === r.pageCanvas, `${theme}/${tab} ${when}: the container paints the page canvas`, `${r.root.bg} vs ${r.pageCanvas}`);
        if (r.appRoot) {
          check(r.appRoot.bg === r.pageCanvas, `${theme}/${tab} ${when}: .app-root paints the page canvas`, `${r.appRoot.bg} vs ${r.pageCanvas}`);
        }
        if (r.pcApp) {
          check(r.pcApp.bg === r.root.bg, `${theme}/${tab} ${when}: their app matches the container`, `${r.pcApp.bg} vs ${r.root.bg}`);
        }
        /*
         * THE ASSERTION THAT IS ACTUALLY THE BUG: the empty region BELOW their
         * app is the page canvas. An earlier version of this asked whether the
         * page crossed two wide bands of different colour, and flagged the tall
         * white card on Brands — a card on a page is not a seam, and a check
         * that cannot tell them apart would have been turned off within a week.
         */
        if (r.below) {
          check(r.below.bg === r.pageCanvas,
            `${theme}/${tab} ${when}: the empty area below their app is the page canvas`,
            `${r.below.bg} at y=${r.below.y}, canvas is ${r.pageCanvas}`);
        }
      }
    }
    check(errors.length === 0, `${theme}: zero console errors`, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
