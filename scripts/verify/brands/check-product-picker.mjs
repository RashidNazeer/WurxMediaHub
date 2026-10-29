#!/usr/bin/env node
/**
 * THE PRODUCT PICKER ON ONBOARDING, AND THE DEAL SPLIT UNDER IT.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/brands/check-product-picker.mjs
 *
 * Rashid, 2026-09-23: "we want to fetch products for that brand from the api so
 * when we onboard creator it will show us the dropdown to choose the product
 * from, we can also search product because list may be long ... if user has
 * chosen only one product it's fine but more than one he may have different
 * deal of videos and amount on that ... their total sum will be auto in the row
 * below ... do it for reacher and euka as well".
 *
 * So this proves four things, on the real screen:
 *   1. the dropdown is the brand's REAL catalogue — compared against what
 *      `collab-products` answers for a EUKA brand and for the REACHER one;
 *   2. searching narrows it, and a word that matches nothing says so;
 *   3. choosing a second product produces a row of fields per product, and the
 *      totals underneath are the sum, recomputed as the numbers change;
 *   4. SAVING SENDS THAT TOTAL as the deal, with the split alongside it.
 *
 * NOTHING IS WRITTEN TO PAID COLLABS. The save request is intercepted in the
 * browser and answered with a fake success, so the payload can be read without
 * a test row ever reaching Rashid's roster. The check says so out loud rather
 * than implying the whole path ran.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EUKA_BRAND = process.env.EUKA_BRAND || 'Penetrex';
const REACHER_BRAND = process.env.REACHER_BRAND || 'Irwin Naturals';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/* ── what the API says, so the screen can be compared with it ───────────── */
const api = createClient(URL_, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: signInErr } = await api.auth.signInWithPassword({
  email: process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com',
  password: process.env.COLLAB_STAFF_PASSWORD || '1234567890',
});
if (signInErr) throw new Error('sign-in failed: ' + signInErr.message);

const truth = {};
for (const brand of [EUKA_BRAND, REACHER_BRAND]) {
  const { data, error } = await api.functions.invoke('collab-products', { body: { brand } });
  if (error) throw new Error(`collab-products(${brand}): ${error.message}`);
  truth[brand] = data;
  console.log(`${brand}: ${data.products?.length ?? 0} products from ${data.source}${data.note ? ' · ' + data.note : ''}`);
}
/* CONTROLS. Every screen comparison below would pass on an empty catalogue. */
check((truth[EUKA_BRAND].products || []).length >= 3 && truth[EUKA_BRAND].source === 'euka',
  `${EUKA_BRAND} really has a EUKA catalogue to show`, `${truth[EUKA_BRAND].products?.length} products`);
check((truth[REACHER_BRAND].products || []).length >= 3 && truth[REACHER_BRAND].source === 'reacher',
  `${REACHER_BRAND} really has a REACHER catalogue to show`, `${truth[REACHER_BRAND].products?.length} products`);

/* ── the screen ─────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 140)));

  /* THE SAVE NEVER LANDS. Anything this page tries to write to the creators
     table is answered here with a fake success, so the payload can be read and
     Paid Collabs is not touched. */
  const written = [];
  await page.route('**/rest/v1/creators*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' || req.method() === 'PATCH') {
      try {
        const raw = JSON.parse(req.postData() || '{}');
        /* PostgREST inserts send an ARRAY of rows — `insert([row])` — while an
           update sends the object. A first version of this check looked for
           `body.deal` and found nothing on a save that had worked perfectly. */
        written.push({ method: req.method(), body: Array.isArray(raw) ? raw[0] : raw });
      } catch { /* not json */ }
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([{ id: 999999 }]) });
    }
    return route.continue();
  });

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
  await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

  /* ONBOARDING STARTS ON A BRAND'S PAGE: "+ Creator" lives in the brand header,
     not on the Creators tab, and it opens the modal with that brand already
     filled in — which is also how the catalogue gets fetched. */
  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(2500); }
  await page.waitForTimeout(1500);

  const openModal = async (brand) => {
    /* Open that brand, then "+ Creator" in its header. */
    if (await page.locator('.pc-back').first().isVisible().catch(() => false)) {
      await page.locator('.pc-back').first().click();
      await page.waitForTimeout(1500);
    }
    /* `\\s` and not `\s`: inside a template literal a lone backslash-s is just
       "s", so the regex would look for "sPenetrexs" and match nothing. */
    const row = page.locator('.pc-bt-row').filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${brand}\\s*$`) }) }).first();
    if (!(await row.isVisible().catch(() => false))) throw new Error(`${brand} is not on the Brands screen this month`);
    await row.click();
    await page.waitForSelector('.pc-ct-row, .pc-empty', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const add = page.getByRole('button', { name: /\+\s*creator/i }).first();
    await add.click();
    /* The picker is a DROPDOWN now: a closed trigger, and the search box only
       exists once it is open. */
    await page.waitForSelector('[data-wx="product-trigger"]', { timeout: 20000 });
    /* The brand is already filled in by the button that opened this, which is
       what triggers the catalogue fetch. Wait for it to land rather than for a
       fixed pause: a list read too early is empty for the wrong reason. */
    await page.waitForFunction(() => {
      const t = document.querySelector('[data-wx="product-trigger"]');
      return !!t && !/loading/i.test(t.textContent || '');
    }, null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(400);
    /* Open it, so the list and its search box exist for the checks below. */
    if (!(await page.locator('[data-wx="product-panel"]').first().isVisible().catch(() => false))) {
      await page.locator('[data-wx="product-trigger"]').click();
      await page.waitForTimeout(500);
    }
  };
  const closeModal = async () => {
    /* Escape closes the dropdown first, then the drawer — so press it twice. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const stillOpen = await page.locator('[data-wx="product-trigger"]').first().isVisible().catch(() => false);
    if (stillOpen) {
      const cancel = page.getByRole('button', { name: /^(cancel|close)$/i }).first();
      if (await cancel.isVisible().catch(() => false)) await cancel.click();
      await page.waitForTimeout(500);
    }
  };
  /* The row's NAME, not the row's text: every row now starts with a picture or
     a letter tile, so `textContent` reads "PPenetrex Daily Joint…" and a
     comparison against the API's names silently matches nothing. */
  const listed = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-wx="product-list"] button')]
      .map((b) => (b.querySelector('span:nth-of-type(2)') || b).textContent.trim()));

  /* ── 1. the catalogue, for both platforms ──────────────────────────── */
  for (const brand of [EUKA_BRAND, REACHER_BRAND]) {
    await openModal(brand);
    const names = await listed();
    const want = (truth[brand].products || []).map((p) => p.name);
    const shown = names.length;
    const firstFew = want.slice(0, 3).filter((n) => names.some((x) => x.startsWith(n.slice(0, 24))));
    check(shown > 0, `${brand}: the dropdown lists products rather than nothing`, `${shown} on screen, ${want.length} from the API`);
    check(firstFew.length === Math.min(3, want.length), `${brand}: and they are the API's products`, `${firstFew.length} of the API's first 3 found`);

    /* ── 2. search ───────────────────────────────────────────────────── */
    const word = (want[0] || '').split(/\s+/).find((w) => w.length > 4) || '';
    if (word) {
      await page.fill('[data-wx="product-search"]', word);
      await page.waitForTimeout(500);
      const after = await listed();
      const expected = want.filter((n) => n.toLowerCase().includes(word.toLowerCase())).length;
      check(after.length === expected && after.length <= shown,
        `${brand}: searching "${word}" narrows the list to the products that match`,
        `${after.length} shown, ${expected} expected of ${shown}`);
    }
    await page.fill('[data-wx="product-search"]', 'zzqqxx');
    await page.waitForTimeout(400);
    const none = await listed();
    check(none.length === 0, `${brand}: a word nothing matches leaves an empty list, not the whole catalogue`, `${none.length} shown`);
    await page.fill('[data-wx="product-search"]', '');
    await page.waitForTimeout(300);
    /* The chosen products now carry a picture or a letter tile; check the list
       rows do too, which is what "show selected images properly" asks for. */
    const tiles = await page.evaluate(() =>
      document.querySelectorAll('[data-wx="product-list"] button > span:first-child').length);
    check(tiles === shown, `${brand}: every row in the list carries a picture or its stand-in`, `${tiles} of ${shown}`);
    await closeModal();
  }

  /* ── 3. two products, two rows of fields, and a live total ─────────── */
  await openModal(REACHER_BRAND);
  const pick = async (n) => {
    /* Choosing one closes the list — that is the behaviour Rashid asked for —
       so it is opened again for the next pick. */
    if (!(await page.locator('[data-wx="product-panel"]').first().isVisible().catch(() => false))) {
      await page.locator('[data-wx="product-trigger"]').click();
      await page.waitForTimeout(400);
    }
    const buttons = page.locator('[data-wx="product-list"] button');
    await buttons.nth(n).click();
    await page.waitForTimeout(400);
  };
  await pick(0);
  const afterOne = await page.evaluate(() => ({
    perProduct: !!document.querySelector('[data-wx="per-product-deals"]'),
    amountReadOnly: document.querySelector('[data-wx="total-amount"]')?.readOnly ?? null,
  }));
  check(!afterOne.perProduct && afterOne.amountReadOnly === false,
    'one product: the deal is the two fields it has always been, still typed by hand',
    `per-product block ${afterOne.perProduct}, amount readOnly ${afterOne.amountReadOnly}`);

  await pick(0);
  await page.waitForSelector('[data-wx="per-product-deals"]', { timeout: 10000 });
  /* VIDEOS ARE SPLIT PER PRODUCT; THE MONEY IS NOT (Rashid, 2026-09-24).
     The amount field must stay typed however many products there are — an
     amount box per product would be asking whoever onboards to invent an
     allocation nobody agreed. */
  const rows = await page.evaluate(() => ({
    videos: document.querySelectorAll('[data-wx="per-product-deals"] input[data-wx^="videos-"]').length,
    amounts: document.querySelectorAll('[data-wx="per-product-deals"] input[data-wx^="amount-"]').length,
  }));
  check(rows.videos === 2, 'two products: one video field for each', `${rows.videos} rows`);
  check(rows.amounts === 0, 'and NO amount field per product — the money is one figure for the deal',
    `${rows.amounts} per-product amount inputs`);

  await page.fill('[data-wx="videos-0"]', '5');
  await page.fill('[data-wx="videos-1"]', '7');
  await page.fill('[data-wx="total-amount"]', '800');
  await page.waitForTimeout(500);
  const totals = await page.evaluate(() => ({
    amount: document.querySelector('[data-wx="total-amount"]')?.value,
    videos: document.querySelector('[data-wx="total-videos"]')?.value,
    amountReadOnly: document.querySelector('[data-wx="total-amount"]')?.readOnly,
    videosReadOnly: document.querySelector('[data-wx="total-videos"]')?.readOnly,
  }));
  check(totals.videos === '12', 'the video total is the sum of the parts, computed as you type',
    `${totals.videos} videos, expected 12`);
  check(totals.amountReadOnly === false, 'the amount stays typed by hand, even with several products',
    `readOnly=${totals.amountReadOnly}`);
  check(totals.videosReadOnly === true,
    'the video total cannot be typed over, so the parts and the total can never disagree');
  check(totals.amount === '800', 'and the amount that was typed is the amount that stands', `$${totals.amount}`);

  /* Change one part; the video total must follow. */
  await page.fill('[data-wx="videos-1"]', '9');
  await page.waitForTimeout(400);
  const again = await page.evaluate(() => document.querySelector('[data-wx="total-videos"]')?.value);
  check(again === '14', 'changing one product moves the video total with it', `${again}, expected 14`);

  /* ── 4. what a save would send ─────────────────────────────────────── */
  /* Name is required before the button will enable, and Playwright's own fill
     drives React's onChange properly — a hand-rolled setter + event is one more
     thing to get wrong. */
  await page.locator('.pc-field', { has: page.locator('label:text-is("Name")') }).locator('input').first()
    .fill('ZZ Picker Check');
  await page.waitForTimeout(400);
  const saveBtn = page.getByRole('button', { name: /^(add creator|save changes|save)$/i }).first();
  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^(add creator|save changes|save)$/i.test(x.textContent.trim()));
    return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
  });
  check(!!btn && !btn.disabled, 'the Save button is enabled once the row is fillable', btn ? `"${btn.text}" disabled=${btn.disabled}` : 'no save button found');
  if (btn && !btn.disabled) {
    await saveBtn.click();
    await page.waitForTimeout(3000);
  }
  const sent = written.find((w) => w.body && (w.body.deal !== undefined || Array.isArray(w.body.products)));
  check(!!sent, 'pressing Save sends the row (intercepted here, so nothing was written)',
    sent ? `${written.length} request(s) caught` : 'no write was attempted');
  if (sent) {
    const b = sent.body;
    check(/\$800\s*\/\s*14 videos/.test(String(b.deal || '')),
      'the deal it sends is the typed amount and the SUMMED video count, the line every other screen reads',
      `deal: "${b.deal}"`);
    const ps = Array.isArray(b.products) ? b.products : [];
    check(ps.length === 2 && ps.every((p) => typeof p.videos === 'number'),
      'each product carries its own video count, as a number',
      ps.map((p) => `${(p.name || '').slice(0, 18)}: ${p.videos}`).join(' · '));
    check(ps.every((p) => p.amount === undefined),
      'and NO per-product amount is stored — there is one price for the deal',
      ps.map((p) => String(p.amount)).join(', '));
    const sum = ps.reduce((s, p) => s + (Number(p.videos) || 0), 0);
    check(sum === 14, 'the video parts add up to the total that was sent', `${sum} videos`);
  }

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

/* Nothing should have reached the table: the intercept answered every write.
   Proved rather than asserted, because "I intercepted it" is exactly the kind
   of claim that is worth checking. */
const svc = process.env.SUPABASE_SERVICE_KEY
  ? createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } })
  : null;
if (svc) {
  const { data: strays } = await svc.from('creators').select('id,name').ilike('name', 'ZZ Picker Check%');
  check((strays || []).length === 0, 'and no test row reached Paid Collabs', `${(strays || []).length} found`);
} else {
  check(false, 'SUPABASE_SERVICE_KEY was set, so the no-stray-row check could run');
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
