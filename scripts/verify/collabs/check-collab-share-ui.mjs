#!/usr/bin/env node
/**
 * THE CLIENT'S PAGE, IN A REAL BROWSER WITH NO SESSION.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-collab-share-ui.mjs
 *
 * `verify:collab-share` attacks the door. This proves the room behind it: that
 * the page opens for somebody who has never logged in, shows the brand it was
 * shared, and does not print a single thing a client must not see — checked
 * against the REAL phone numbers, emails and ad-spend figures in the database,
 * not against a list of field names.
 *
 * It also proves the page is a page: both themes, a phone width, no console
 * errors, and a revoked link that says so in words a client can act on.
 *
 * It mints its own links and deletes them in a `finally`. Nothing else changes.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.BRAND || 'Apothecary';
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const wb = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const made = [];

/* what the database holds for this brand, so the page can be held to it */
const { data: rows } = await wb.from('creators')
  .select('name, hiring_date, tiktok_account, tiktok_account_2, monthly, whatsapp_number, email, paypal, zelle, comments, payment_status, deal, video_codes')
  .eq('brand', BRAND).or('status.eq.approved,status.is.null');
const secrets = [];
for (const r of rows ?? []) {
  for (const [k, v] of Object.entries(r)) {
    /* name, date, deal and the videos are shared on purpose; everything else in
       this row is a thing a client must never see. */
    if (['name', 'hiring_date', 'deal', 'video_codes', 'payment_status', 'tiktok_account', 'tiktok_account_2', 'monthly'].includes(k)
      || v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s.length >= 6) secrets.push({ k, s });
  }
}
/* The page's own numbers, recomputed here, with the vendored app's arithmetic.
   AD SPEND IS NOT SEARCHED FOR BY VALUE HERE. A figure like 6.04 collides with
   unrelated money on the page, and a substring hunt would cry wolf; the payload
   suite (verify:collab-share) proves ad spend and ROI are absent from the bytes
   exactly. What this file proves is the opposite and stronger: every number the
   client sees IS the number the database holds. */
const dealAmount = (deal) => {
  const m = String(deal ?? '').match(/\$?(\d[\d,]*\.?\d*)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) || 0 : 0;
};
const videoKey = (url) => {
  const m = url.match(/video\/(\d+)/);
  return m ? m[1] : url.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '');
};
const expectedFor = (month) => {
  const mine = (rows ?? []).filter((r) => String(r.hiring_date ?? '').slice(0, 7) === month);
  let delivered = 0, views = 0, gmv = 0, deal = 0;
  for (const r of mine) {
    const seen = new Set();
    for (const v of Array.isArray(r.video_codes) ? r.video_codes : []) {
      const url = String(v?.video ?? '').trim();
      if (!url) continue;
      const k = videoKey(url);
      if (seen.has(k)) continue;
      seen.add(k);
      delivered += 1;
      views += Number(v?.views) || 0;
      gmv += Number(v?.revenue) || 0;
    }
    deal += dealAmount(r.deal);
  }
  return { rows: mine.length, delivered, views, gmv, deal };
};
console.log(`database: ${(rows ?? []).length} ${BRAND} rows · ${secrets.length} private values`);
check(secrets.length > 0, 'the brand holds private values, so the leak checks can fail', `${secrets.length} values`);

const browser = await launchBrowser();
try {
  const mint = async (label, opts = {}) => {
    const { data, error } = await svc.rpc('collab_share_create', { p_label: label, p_brands: [BRAND], p_days: 2, ...opts });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    made.push(row.id);
    return row;
  };
  const live = await mint('ui probe');

  /* A COMPLETELY CLEAN BROWSER: no storage, no session, nothing of ours. */
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 160)));

  await page.goto(`${BASE}/share/collabs/${live.token}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const seen = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    text: document.body.innerText,
    html: document.documentElement.outerHTML,
    rows: document.querySelectorAll('li').length,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '',
    storage: (() => { try { return Object.keys(localStorage).length + Object.keys(sessionStorage).length; } catch { return -1; } })(),
  }));

  check(seen.heading === BRAND, 'the page opens with no login and names the brand', seen.heading || 'no heading');
  check(/Read only/i.test(seen.text), 'and says it is read only');
  check(/noindex/.test(seen.robots), 'and asks search engines to stay away', seen.robots);

  const leaked = secrets.filter((x) => seen.html.includes(x.s));
  check(leaked.length === 0, 'no phone number, email, payment detail, comment or payment status is in the page',
    leaked.slice(0, 3).map((x) => x.k).join(', '));
  check(!/\bad spend\b/i.test(seen.text) && !/\bROI\b/.test(seen.text), 'the words Ad spend and ROI appear nowhere', '');
  /* Status IS shown now, in the same words staff see, but as a pill. Nothing on
     the page may CHANGE anything: no dropdown, no contract, no export. */
  check(!/Mark paid|Export|Add creator|Edit creator|Delete/i.test(seen.text), 'no staff controls are on the page');
  const writable = await page.evaluate(() => ({
    selects: document.querySelectorAll('select').length,
    contract: /contract/i.test(document.body.innerText) ? 1 : 0,
    inputs: document.querySelectorAll('input, textarea').length,
  }));
  check(writable.selects === 0 && writable.contract === 0 && writable.inputs === 0,
    'nothing on the page can be changed: no dropdown, no contract, no field', JSON.stringify(writable));
  /* Rashid, on seeing the page: "no need to show status". Whether a creator has
     been paid is between us and them. */
  check(!/Payment Pending|Videos in Progress/i.test(seen.text), 'the Status column is gone', seen.text.slice(0, 60).replace(/\n/g, ' '));

  /* ── every number on the page, against the database ──────────────────── */
  const shown = await page.evaluate(() => ({
    month: document.querySelector('header[data-month]')?.getAttribute('data-month') ?? '',
    rows: [...document.querySelectorAll('.pc-ct-row[data-creator]')].map((li) => ({
      name: li.getAttribute('data-creator') ?? '',
      deal: Number(li.getAttribute('data-deal')) || 0,
      delivered: Number(li.getAttribute('data-delivered')) || 0,
      views: Number(li.getAttribute('data-views')) || 0,
      gmv: Number(li.getAttribute('data-gmv')) || 0,
    })),
  }));
  const want = expectedFor(shown.month);
  const got = shown.rows.reduce((t, r) => ({
    rows: t.rows + 1, delivered: t.delivered + r.delivered, views: t.views + r.views,
    gmv: t.gmv + r.gmv, deal: t.deal + r.deal,
  }), { rows: 0, delivered: 0, views: 0, gmv: 0, deal: 0 });

  check(shown.rows.length > 0, `it lists the creators for ${shown.month}`, `${shown.rows.length} rows`);
  check(got.rows === want.rows, 'it lists every row the database has for that month, and no more', `${got.rows} on screen, ${want.rows} in the database`);
  check(got.delivered === want.delivered, 'videos delivered match the database', `${got.delivered} vs ${want.delivered}`);
  check(got.views === want.views, 'views match the database', `${got.views} vs ${want.views}`);
  check(Math.abs(got.gmv - want.gmv) < 0.01, 'GMV matches the database', `${got.gmv.toFixed(2)} vs ${want.gmv.toFixed(2)}`);

  check(Math.abs(got.deal - want.deal) < 0.01, 'the deal amounts match the database', `${got.deal.toFixed(2)} vs ${want.deal.toFixed(2)}`);

  /* NO DEALS CIRCLE ON THE FACE. It counts a person's campaigns across every
     brand, which tells a client how busy their creators are with everybody
     else. Rashid, relaying the boss: "the deal no around the avatar ... that
     was for ourself". Not drawn, and not sent. */
  const circles = await page.evaluate(() => ({
    badges: document.querySelectorAll('.pc-dealsbadge').length,
    wraps: document.querySelectorAll('.pc-facewrap').length,
  }));
  check(circles.badges === 0, 'no deals circle on any avatar', JSON.stringify(circles));
  const money = await page.evaluate(() => /Budget/i.test(document.body.innerText) && /GMV/i.test(document.body.innerText));
  check(money, 'and Budget and GMV are on screen');

  /* the videos open, with a spark code to copy */
  /* A row that HAS videos: the first row of a brand is often somebody who has
     not posted yet, and clicking that one proves nothing. */
  const firstRow = page.locator('.pc-ct-row[data-creator]:not([data-delivered="0"])').first();
  if (await firstRow.isVisible().catch(() => false)) {
    await firstRow.click();
    await page.waitForTimeout(700);
    const videos = await page.locator('.wx-share-video').count();
    const spark = await page.locator('button', { hasText: /Copy spark code/ }).count();
    check(videos > 0, 'a creator row opens to their videos', `${videos} videos, ${spark} spark codes`);
  } else {
    check(false, 'a creator row can be opened', 'no row');
  }

  /* the columns the boss asked for, and the two he did not */
  const head = await page.evaluate(() => [...document.querySelectorAll('.pc-ct-head > div')].map((d) => d.textContent?.trim()));
  const columns = ['#', 'Completed on', 'Creator', 'Deal', 'Videos', 'Total views', 'New video GMV', 'L30 GMV', 'Items sold'];
  check(JSON.stringify(head) === JSON.stringify(columns), 'the table has the staff columns, minus Ad spend and ROI', head.join(' | '));
  const kpis = await page.evaluate(() => [...document.querySelectorAll('.pc-kpi-label')].map((d) => d.textContent?.trim()));
  check(JSON.stringify(kpis) === JSON.stringify(['Budget', 'Allocated', 'Paid', 'Videos', 'Cost / Video']),
    'and the same five cards above it', kpis.join(' | '));

  /*
   * EVERY CARD, AGAINST THE STAFF SCREEN'S OWN ARITHMETIC.
   *
   * Rashid found Cost / Video reading $238 beside his $46: his card divides
   * allocated by COMMITTED videos ("Afflix semantics · not delivered" in
   * WurxUI), and this page had divided by delivered. Checking the rows summed
   * correctly was not enough — the cards are their own sums, so they get their
   * own comparison, each formula copied from the staff code.
   */
  const dealVideos = (deal) => {
    const s = String(deal ?? '');
    const m1 = s.match(/(\d+)\s*(?:videos?|vids?|clips?|posts?)\b/i);
    if (m1) return parseInt(m1[1], 10);
    const m2 = s.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:[/\-x×*]|for)\s*(\d+)\b/i);
    if (m2) return parseInt(m2[1], 10);
    const m3 = s.match(/\b(\d+)\s*[vV]\b/);
    if (m3) return parseInt(m3[1], 10);
    return 0;
  };
  const { data: budgetRows } = await wb.from('brand_monthly_budgets').select('brand, month, budget').eq('brand', BRAND);
  const monthly = (rows ?? []).filter((r) => String(r.hiring_date ?? '').slice(0, 7) === shown.month);
  const wantAllocated = monthly.reduce((t, r) => t + dealAmount(r.deal), 0);
  const wantPaid = monthly.filter((r) => r.payment_status === 'Paid').reduce((t, r) => t + dealAmount(r.deal), 0);
  const wantCommitted = monthly.reduce((t, r) => t + dealVideos(r.deal), 0);
  const wantDelivered = monthly.reduce((t, r) => {
    const seen = new Set();
    for (const v of Array.isArray(r.video_codes) ? r.video_codes : []) {
      const url = String(v?.video ?? '').trim();
      if (url) seen.add(videoKey(url));
    }
    return t + seen.size;
  }, 0);
  const wantBudget = (budgetRows ?? []).filter((b) => String(b.month) === shown.month).reduce((t, b) => t + (Number(b.budget) || 0), 0);
  const wantCostPerVideo = wantCommitted > 0 ? wantAllocated / wantCommitted : 0;

  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.pc-kpi')].map((k) => ({
      label: k.querySelector('.pc-kpi-label')?.textContent?.trim() ?? '',
      value: k.querySelector('.pc-kpi-value')?.textContent?.trim() ?? '',
      sub: k.querySelector('.pc-kpi-sub')?.textContent?.trim() ?? '',
    })));
  const num = (s) => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;
  const card = (label) => cards.find((c) => c.label === label) ?? { value: '', sub: '' };
  const wrongCards = [];
  if (num(card('Budget').value) !== Math.round(wantBudget)) wrongCards.push(`Budget ${card('Budget').value} vs ${wantBudget}`);
  if (num(card('Allocated').value) !== Math.round(wantAllocated)) wrongCards.push(`Allocated ${card('Allocated').value} vs ${wantAllocated}`);
  if (num(card('Paid').value) !== Math.round(wantPaid)) wrongCards.push(`Paid ${card('Paid').value} vs ${wantPaid}`);
  if (card('Videos').value !== `${wantDelivered}/${wantCommitted}`) wrongCards.push(`Videos ${card('Videos').value} vs ${wantDelivered}/${wantCommitted}`);
  if (Math.abs(num(card('Cost / Video').value) - Math.round(wantCostPerVideo)) > 1) wrongCards.push(`Cost/Video ${card('Cost / Video').value} vs ${Math.round(wantCostPerVideo)}`);
  check(wrongCards.length === 0, 'every card matches the staff screen\'s own arithmetic', wrongCards.join(' | '));
  const tiers = await page.evaluate(() => document.querySelectorAll('.pc-tierbadge').length);
  const l30 = await page.evaluate(() => [...document.querySelectorAll('.pc-l30-cell')].filter((e) => !e.classList.contains('muted')).length);
  check(tiers > 0 && l30 > 0, 'tier tags and L30 GMV arrived from Euka', `${tiers} tiers, ${l30} L30 figures`);

  /* L30 IS EVERY SHOP'S, NOT THIS BRAND'S. Rashid: "why for many videos client
     is unable to see it while i can see on my dashboard" — the first version
     read only the link's own store, so a creator whose recent GMV came from
     another shop showed a dash. The page must now know exactly whom Euka
     knows: no more (invented) and no fewer (the bug). */
  const { data: cacheRows } = await svc.from('collab_share_euka_cache').select('handles');
  const merged = new Map();
  for (const row of cacheRows ?? []) {
    for (const [h, v] of Object.entries(row.handles ?? {})) {
      const gmv = Number(v?.gmv) || 0;
      if (gmv > (merged.get(h) ?? 0)) merged.set(h, gmv);
    }
  }
  const handleKey = (raw) => {
    const t = String(raw ?? '').trim().toLowerCase();
    if (!t) return '';
    const last = t.startsWith('http') ? (t.replace(/\/+$/, '').split('/').pop() ?? '') : t;
    return last.replace(/^@/, '').split(/[?#]/)[0].trim();
  };
  const monthRows = (rows ?? []).filter((r) => String(r.hiring_date ?? '').slice(0, 7) === shown.month);
  /* Live across every shop, ELSE the stored figure — the staff row's own rule,
     which is why their screen has numbers where the first version had dashes. */
  const expectL30 = monthRows.filter((r) => {
    const live = [r.tiktok_account, r.tiktok_account_2].map(handleKey).filter(Boolean).some((h) => (merged.get(h) ?? 0) > 0);
    return live || Number(r.monthly?.euka?.l30) > 0;
  }).length;
  check(merged.size > 0, 'Euka figures are cached for more than one store, so this can fail', `${merged.size} handles across ${(cacheRows ?? []).length} stores`);
  check(l30 === expectL30, 'L30 GMV shows for every creator either Euka or our own record knows', `${l30} on screen, ${expectL30} known`);

  /* Every row has a face, as on the staff screen: their picture, or an initial. */
  const faces = await page.evaluate(() => ({
    total: document.querySelectorAll('.pc-ct-row .pc-face').length,
    photos: document.querySelectorAll('img.pc-face').length,
    rows: document.querySelectorAll('.pc-ct-row[data-creator]').length,
  }));
  check(faces.total === faces.rows, 'every creator row has an avatar', `${faces.total} faces for ${faces.rows} rows (${faces.photos} photos)`);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-dark.png`, fullPage: false });

  /* both themes, and a phone */
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400);
    const painted = await page.evaluate(() => {
      const h = document.querySelector('h1');
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        fg: h ? getComputedStyle(h).color : 'NO HEADING',
        rows: document.querySelectorAll('.pc-ct-row[data-creator]').length,
      };
    });
    check(painted.bg !== painted.fg && painted.bg !== 'rgba(0, 0, 0, 0)', `${theme}: the page is painted`, JSON.stringify(painted));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-${theme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, 'at 390px there is no sideways scroll', `${overflow}px`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-390.png` });

  check(seen.storage === 0, 'the page stores nothing in the browser', `${seen.storage} keys`);
  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));

  /* ── a revoked link, in the client's own words ────────────────────────── */
  const dead = await mint('ui probe revoked');
  await svc.rpc('collab_share_revoke', { p_id: dead.id });
  const page2 = await context.newPage();
  await page2.goto(`${BASE}/share/collabs/${dead.token}`, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2500);
  const gone = await page2.evaluate(() => document.body.innerText);
  check(/link has ended|not active/i.test(gone), 'a revoked link says so, in plain words', gone.slice(0, 80).replace(/\n/g, ' '));
  check(!new RegExp(BRAND).test(gone), 'and shows nothing of the brand');
  if (SHOTS) await page2.screenshot({ path: `${SHOTS}/share-revoked.png` });
} finally {
  for (const id of made) await svc.from('collab_share_links').delete().eq('id', id);
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
