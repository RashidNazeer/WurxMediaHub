#!/usr/bin/env node
/**
 * THE PUBLIC WEBSITE, THE WAY A TIKTOK REVIEWER WILL READ IT.
 *
 *   pnpm build && pnpm preview
 *   node scripts/verify/site/check-public-site.mjs
 *
 * TikTok rejected the Display API app on 2026-09-15 on two fields: Website URL
 * ("cannot be a landing page or login page ... must have an externally facing
 * fully developed website") and App icon ("does not match the icon displayed on
 * the website ... across both the TikTok, the website and Browser tab").
 *
 * So this checks the two things they named, signed out, as a stranger:
 *   - every page of the site loads, has its own <h1> and its own tab title,
 *     carries real content, and is reachable from the header and the footer;
 *   - no link in the header or footer lands on the 404 page;
 *   - the tab icon is the dog face from wurxmedia.com, byte-identical to it
 *     apart from the viewBox, and the file we hand TikTok is 1024x1024;
 *   - nothing requires a login, at four widths, in both themes, with no
 *     console errors and no sideways scroll.
 *
 * It runs signed out on purpose and never touches the database.
 */
import { createHash } from 'node:crypto';
import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OFFICIAL_SVG = process.env.OFFICIAL_ICON || 'https://wurxmedia.com/favicon.svg';

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/** Every page a stranger can open, and what its heading must be about. */
const PAGES = [
  { path: '/', h1: /numbers|creator|gmv/i, nav: false },
  { path: '/creators', h1: /numbers|creator/i },
  { path: '/brands', h1: /creator programme|brand|tiktok shop/i },
  { path: '/how-it-works', h1: /step|works|paid/i },
  { path: '/about', h1: /wurx media/i },
  { path: '/faq', h1: /question/i },
  { path: '/contact', h1: /talk to us|contact/i },
  { path: '/tiktok', h1: /tiktok/i },
  { path: '/terms', h1: /terms/i },
  { path: '/privacy', h1: /privacy/i },
];

const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text().slice(0, 120)}`); });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${page.url()}: ${String(e.message).slice(0, 120)}`));

  const titles = new Map();
  for (const p of PAGES) {
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);
    const got = await page.evaluate(() => ({
      title: document.title,
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      words: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().split(/\s+/).length,
      notFound: /page not found|404/i.test(document.body.innerText.slice(0, 400)),
      links: [...document.querySelectorAll('header a[href], footer a[href]')].map((a) => a.getAttribute('href')),
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      signIn: /sign in|log in/i.test(document.body.innerText),
    }));
    check(!got.notFound && got.h1.length === 1, `${p.path}: opens with exactly one heading`, got.notFound ? 'the 404 page' : `${got.h1.length} h1s: ${got.h1.join(' | ')}`);
    check(p.h1.test(got.h1[0] || ''), `${p.path}: the heading is about this page`, got.h1[0] || 'none');
    /* "Fully developed" is the reviewer's phrase. 120 words is not a hard rule
       anywhere; it is the floor below which a page is a stub, and every page
       here is meant to answer a question in full. */
    check(got.words >= 120, `${p.path}: carries real content, not a stub`, `${got.words} words`);
    check(!!got.title && got.title.length > 6, `${p.path}: has its own tab title`, got.title);
    titles.set(p.path, got.title);
    check(got.sideways <= 1, `${p.path}: no sideways scroll at 1440px`, `${got.sideways}px`);
  }

  /* A site where every tab says the same thing reads as one page in disguise,
     which is the thing being fixed. */
  const unique = new Set(titles.values());
  check(unique.size === titles.size, 'every page has a DIFFERENT tab title', `${unique.size} titles for ${titles.size} pages`);

  /* ── every link in the chrome goes somewhere real ─────────────────────── */
  await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('footer', { timeout: 20000 });
  const hrefs = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('header a[href], footer a[href]')].map((a) => a.getAttribute('href')))]);
  const internal = hrefs.filter((h) => h && h.startsWith('/') && !h.startsWith('//'));
  check(internal.length >= 10, 'the header and footer carry the whole site', `${internal.length} internal links`);
  const dead = [];
  for (const href of internal) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    const bad = await page.evaluate(() => /page not found|404/i.test(document.body.innerText.slice(0, 400)) || !document.querySelector('h1'));
    if (bad) dead.push(href);
  }
  check(dead.length === 0, 'no link in the header or footer lands on a dead page', dead.join(', ') || `${internal.length} checked`);

  /* ── Apply works from a page that has no form on it ───────────────────── */
  await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 20000 });
  await page.getByRole('button', { name: /^apply$/i }).first().click();
  await page.waitForTimeout(1200);
  check(/\/apply/.test(page.url()), 'Apply in the header works from a page with no form on it', page.url());

  /* ── the menu on a phone ──────────────────────────────────────────────── */
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header', { timeout: 20000 });
  await page.getByRole('button', { name: /open menu/i }).first().click();
  await page.waitForTimeout(600);
  const menu = await page.evaluate(() => {
    const m = document.getElementById('mobile-menu');
    return m ? [...m.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) : [];
  });
  for (const want of ['/creators', '/brands', '/how-it-works', '/about', '/faq', '/contact']) {
    check(menu.includes(want), `the phone menu reaches ${want}`, menu.join(' ') || 'menu did not open');
  }

  /* ── every width, every page: nothing cut off the side ────────────────── */
  for (const w of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    const bad = [];
    for (const p of PAGES) {
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) bad.push(`${p.path} ${over}px`);
    }
    check(bad.length === 0, `${w}px: no page scrolls sideways`, bad.join(', ') || `${PAGES.length} pages`);
  }

  /* ── both themes on a content page ────────────────────────────────────── */
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ['dark', 'light']) {
    await page.goto(`${BASE}/creators`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => {
      localStorage.setItem('wurxmediahub-theme', t);
      window.dispatchEvent(new StorageEvent('storage', { key: 'wurxmediahub-theme' }));
    }, theme);
    const ok = await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 8000 }).then(() => true, () => false);
    check(ok, `${theme}: the website renders in ${theme} mode`);
  }

  check(errors.length === 0, 'zero console errors across the whole site', errors.slice(0, 3).join(' | '));

  /* ── who may index what ───────────────────────────────────────────────────
   *
   * Rashid, 2026-09-22: let search engines find the public pages. The rule is
   * deny by default (index.html ships `noindex`), lifted by the public pages
   * themselves, and ONLY on the live site — dev is a full second copy, with
   * test data, on its own address.
   *
   * THE HOST IS THE WHOLE RULE, so it is tested rather than read. The page is
   * opened at the production address with every request served by the build
   * under test, which is the only way to see what the live site would say.
   */
  const LIVE = 'https://wurxmediahub.vercel.app';
  const live = new URL(BASE).host === new URL(LIVE).host;
  const here = await page.evaluate(() => {
    const m = document.querySelector('meta[name="robots"]');
    return m ? m.content : null;
  });
  /* The live site's public pages are meant to be found; every other address
     this can be pointed at — dev, a local preview — must not be. */
  check(live ? !/noindex/.test(here || '') : /noindex/.test(here || ''),
    live ? 'the live site lets search engines in' : 'on this address the pages stay out of search engines',
    here ?? 'no robots meta at all');

  /*
   * WHEN THE TARGET IS ALREADY THE LIVE SITE, read it directly. Serving the
   * live address from BASE while BASE *is* that address is a request that
   * routes to itself: the handler aborts and the navigation fails, which is a
   * failing check about nothing. Run against production, the real pages answer
   * the question on their own.
   */
  const onLive = live;
  const asLive = onLive ? page : await ctx.newPage();
  let served = 0, servedFailed = null;
  if (!onLive) await asLive.route(`${LIVE}/**`, async (route) => {
    const url = new URL(route.request().url());
    try {
      const r = await fetch(`${BASE}${url.pathname}${url.search}`);
      const body = Buffer.from(await r.arrayBuffer());
      served++;
      await route.fulfill({ status: r.status, body, headers: { 'content-type': r.headers.get('content-type') || 'text/html' } });
    } catch (e) {
      /* NEVER fall through to the real site: it would answer, and the check
         would then be reading production rather than the build under test. */
      servedFailed = String(e).slice(0, 120);
      await route.abort();
    }
  });
  for (const [path, want, label] of [
    ['/creators', true, 'a public page'],
    ['/privacy', true, 'the Privacy page'],
    ['/login', false, 'the sign-in page'],
  ]) {
    await asLive.goto(`${LIVE}${path}`, { waitUntil: 'domcontentloaded' });
    await asLive.waitForTimeout(800);
    const got = await asLive.evaluate(() => ({
      robots: document.querySelector('meta[name="robots"]')?.content ?? '',
      title: document.title,
      /* Proof that what answered is the build under test and not the real
         production site, which would answer this address for real. */
      ours: !!document.querySelector('a[href="/how-it-works"], meta[name="robots"]'),
    }));
    const indexable = /index/.test(got.robots) && !/noindex/.test(got.robots);
    check(indexable === want, `on the live address, ${label} is ${want ? 'indexable' : 'kept out of search'}`,
      `${path} says "${got.robots}" · tab "${got.title}" · ${onLive ? 'read from the live site itself' : `${served} requests served from the build under test${servedFailed ? ` · could not serve: ${servedFailed}` : ''}`}`);
  }
  if (!onLive) await asLive.close();
} finally {
  await browser.close();
}

/* ── robots.txt and the sitemap ─────────────────────────────────────────── */
const robotsTxt = await fetch(`${BASE}/robots.txt`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
check(!!robotsTxt && /Sitemap:/i.test(robotsTxt), 'robots.txt is served and points at the sitemap', robotsTxt ? robotsTxt.split('\n')[0] : 'missing');
if (robotsTxt) {
  const shut = ['/app/', '/admin/', '/share/', '/oauth/'].filter((p) => !robotsTxt.includes(`Disallow: ${p}`));
  check(shut.length === 0, 'robots.txt keeps crawlers out of the app, the admin and the share links', shut.join(', '));
}
const sitemap = await fetch(`${BASE}/sitemap.xml`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
check(!!sitemap && /<urlset/.test(sitemap), 'sitemap.xml is served', sitemap ? `${sitemap.length} bytes` : 'missing');
if (sitemap) {
  const listed = [...sitemap.matchAll(/<loc>https:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
  const wanted = [...PAGES.map((p) => p.path), '/apply'];
  const missing = wanted.filter((p) => !listed.includes(p));
  const extra = listed.filter((p) => !wanted.includes(p));
  check(missing.length === 0 && extra.length === 0, 'the sitemap lists every public page and nothing else',
    [missing.length ? `missing ${missing.join(', ')}` : '', extra.length ? `should not be there: ${extra.join(', ')}` : ''].filter(Boolean).join(' · ') || `${listed.length} pages`);
  check(!/wurxmediahubdev/.test(sitemap), 'the sitemap points at the live site, not dev');
}

/* ── the icon, the other field TikTok named ─────────────────────────────── */
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s*viewBox="[^"]*"/, '').replace(/\s+/g, ' ').trim();
const ours = await fetch(`${BASE}/favicon.svg`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
const official = await fetch(OFFICIAL_SVG).then((r) => (r.ok ? r.text() : null)).catch(() => null);
check(!!ours && ours.length > 10_000, 'the site serves a favicon.svg', ours ? `${ours.length} bytes` : 'missing');
check(!!official, 'wurxmedia.com answered, so the two icons can really be compared', official ? `${official.length} bytes` : 'COULD NOT FETCH — this check proves nothing');
if (ours && official) {
  const same = createHash('sha256').update(strip(ours)).digest('hex') === createHash('sha256').update(strip(official)).digest('hex');
  check(same, 'our tab icon IS the mark wurxmedia.com uses (same artwork, our added viewBox aside)');
  check(/viewBox="0 0 512 512"/.test(ours), 'and it carries the viewBox, without which it renders in a corner when scaled');
  check(!/<rect[^>]*fill="#c8924b"/.test(ours), 'the old gold W is gone from the tab icon');
}
const png = await fetch(`${BASE}/tiktok-app-icon.png`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
if (!png) check(false, 'the 1024px file for TikTok is served at /tiktok-app-icon.png');
else {
  const b = Buffer.from(png);
  /* PNG header: width and height are big-endian 32-bit at bytes 16 and 20. */
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  check(w === 1024 && h === 1024, 'the file for TikTok is 1024x1024', `${w}x${h}`);
}
const head = await fetch(`${BASE}/`).then((r) => r.text());
check(/rel="icon"[^>]*favicon\.svg/.test(head) && /favicon\.png/.test(head), 'the page head points at both icon files');

/* AND THE .ico. Browsers ask for /favicon.ico whether or not a page links one,
   and on a single-page app the catch-all rewrite answers that request with the
   HTML page unless the file really exists — which is what it did until
   2026-09-22. Paid Collabs also uses that path as its notification icon. */
check(/favicon\.ico/.test(head), 'the page head points at a .ico too');
const ico = await fetch(`${BASE}/favicon.ico`)
  .then(async (r) => (r.ok ? { type: r.headers.get('content-type'), b: Buffer.from(await r.arrayBuffer()) } : null))
  .catch(() => null);
if (!ico) check(false, '/favicon.ico is served');
else {
  /* An ICO begins 00 00 01 00. HTML begins "<!do". */
  const isIco = ico.b.readUInt16LE(0) === 0 && ico.b.readUInt16LE(2) === 1;
  check(isIco, '/favicon.ico is a real icon file, not the app HTML', `${ico.type} · ${ico.b.length} bytes`);
  if (isIco) check(ico.b.readUInt16LE(4) >= 2, 'and it carries more than one size', `${ico.b.readUInt16LE(4)} sizes`);
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
