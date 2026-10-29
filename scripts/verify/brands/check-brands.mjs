#!/usr/bin/env node
/**
 * End to end test of the Brand Hub, both sides.
 *
 * Offers decide what creators get paid, and a brand's budget and client are
 * things creators must never see, so this suite spends most of its time trying
 * to break in rather than admiring the happy path.
 *
 * It creates a brand, its story, a product and offers through the real admin
 * UI, checks the database, then signs in as a real creator and does two things:
 * attacks the tables and the Edge Function, and opens the hub they are actually
 * meant to see. The second half is the one that matters most. Creators read
 * brands now, which they never used to, and the assertions that used to say
 * "a creator sees nothing" were REPLACED rather than deleted, because deleting
 * them would have removed the only guard on a client's budget.
 *
 * Cleans up after itself. Run against DEV only.
 *
 * Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... SUPABASE_SERVICE_KEY=...
 *   node scripts/verify/brands/check-brands.mjs [baseUrl]
 */

import { launchBrowser } from '../../lib/browser.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
}

const URL_BASE = env.VITE_SUPABASE_URL;

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL_BASE, 'check-brands.mjs');
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

const stamp = process.env.RUN_STAMP ?? String(Date.now()).slice(-7);
const BRAND_NAME = `Wurx Test Brand ${stamp}`;
const STORE_ID = `store-${stamp}`;
const BUDGET = '25000';
const CREATOR_EMAIL = `brandspy-${stamp}@wurxmediahub.test`;
const CREATOR_PASSWORD = 'a-long-enough-test-password-1';

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));

const made = [];
let brandId = null;
const browser = await launchBrowser();

/**
 * Poll until the database says what we are waiting for, or give up.
 *
 * Not a fixed sleep. A cold Edge Function boots Deno and pulls its dependencies
 * on the first call after a deploy, which takes seconds, and a test that
 * assumes a duration reports a product bug that is not there.
 */
async function waitFor(read, ok, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (ok(last)) return last;
    if (Date.now() > deadline) {
      fail(`timed out waiting for ${label} (last saw ${JSON.stringify(last)})`);
      return last;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

/**
 * Fire a request from inside the browser, carrying that user's real token.
 *
 * `body` is trimmed for readable failure messages, but `json` is parsed from
 * the WHOLE response. Parsing the trimmed copy silently turned every long list
 * into "0 rows", which reads exactly like row level security refusing the
 * request, and is the opposite of what was happening.
 */
const asUser = (page, path, init) =>
  page.evaluate(
    async ({ url, key, path, init }) => {
      const s = JSON.parse(localStorage.getItem('wurxmediahub-auth'));
      const res = await fetch(`${url}${path}`, {
        ...init,
        headers: {
          apikey: key,
          Authorization: `Bearer ${s.access_token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, body: text.slice(0, 300), json };
    },
    { url: URL_BASE, key: ANON, path, init: init ?? {} }
  );

/** Rows from a REST response, or an empty list if it was refused. */
const rows = (r) => (Array.isArray(r?.json) ? r.json : []);

try {
  console.log(`\nBrand Hub against ${BASE}\n${'='.repeat(70)}`);

  /* ----------------------------------------------------- [1] create it -- */
  console.log('\n[1] An admin creates a brand');
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await adminCtx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) {
      consoleErrors.push(m.text());
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('**/admin', { timeout: 25000 }).catch(() => {});

  await page.goto(`${BASE}/admin/brands`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page
    .getByRole('button', { name: /add brand/i })
    .first()
    .click();
  await page.waitForTimeout(700);
  check((await page.getByRole('dialog').count()) > 0, 'the add brand dialog opens');

  await page.fill('input[name="name"]', BRAND_NAME);
  await page.fill('input[name="storeId"]', STORE_ID);
  await page.fill('input[name="clientName"]', 'Test Client Ltd');
  await page.fill('input[name="budget"]', BUDGET);
  await page
    .getByRole('button', { name: /^add brand$/i })
    .last()
    .click();

  const brand = await waitFor(
    async () =>
      (
        await admin
          .from('brands')
          .select('id, name, slug, store_id, is_active')
          .eq('store_id', STORE_ID)
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the brand to be created'
  );

  brandId = brand?.id ?? null;
  check(Boolean(brand), 'the brand reached the database');
  check(brand?.name === BRAND_NAME, `name stored (got ${brand?.name})`);
  check(
    brand?.slug?.startsWith('wurx-test-brand-'),
    `a URL safe slug was generated (got ${brand?.slug})`
  );
  check(brand?.is_active === true, 'a new brand is active');

  // The client and the budget are NOT on the brand. They live in their own
  // staff-only table, which is what makes it safe to show a brand to a creator
  // at all. One save writes both halves in one transaction.
  const { data: commercials } = await admin
    .from('brand_commercials')
    .select('client_name, budget_allocated, currency')
    .eq('brand_id', brandId)
    .maybeSingle();

  check(Boolean(commercials), 'a commercial record was written alongside it');
  check(commercials?.client_name === 'Test Client Ltd', 'client name stored, in that table');
  check(
    Number(commercials?.budget_allocated) === Number(BUDGET),
    `budget stored exactly (got ${commercials?.budget_allocated})`
  );
  check(commercials?.currency === 'USD', 'currency defaults to USD');

  const brandColumns = Object.keys(brand ?? {});
  check(
    !brandColumns.includes('budget_allocated') && !brandColumns.includes('client_name'),
    `and the brands table itself carries neither (${brandColumns.join(', ')})`
  );

  const { data: brandLog } = await admin
    .from('audit_log')
    .select('action, actor_email')
    .eq('subject_id', brandId);
  check(
    (brandLog ?? []).some((r) => r.action === 'brand.created'),
    'creating a brand is audited'
  );

  /* ------------------------------------------------ [2] duplicate store -- */
  console.log('\n[2] Two brands cannot share a store id');
  await page.goto(`${BASE}/admin/brands`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page
    .getByRole('button', { name: /add brand/i })
    .first()
    .click();
  await page.waitForTimeout(700);
  await page.fill('input[name="name"]', `${BRAND_NAME} clone`);
  await page.fill('input[name="storeId"]', STORE_ID);
  await page
    .getByRole('button', { name: /^add brand$/i })
    .last()
    .click();

  const refused = await page
    .getByText(/already uses that store id/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(refused, 'the duplicate is refused, in plain English');
  const { count: brandCount } = await admin
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', STORE_ID);
  check(brandCount === 1, `and only one brand exists with that store id (${brandCount})`);

  await page
    .getByRole('button', { name: /^cancel$/i })
    .last()
    .click();
  await page.waitForTimeout(600);

  /* ----------------------------------------------------- [3] the offer -- */
  console.log('\n[3] An offer inside the hub');
  await page.goto(`${BASE}/admin/brands/${brandId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  check(
    (await page.getByRole('heading', { name: BRAND_NAME }).count()) > 0,
    'the brand hub opens on the right brand'
  );

  // The hub lands on Offers, not on a summary, because that is what somebody
  // came to a brand to do. The facts live one tab across.
  //
  // This used to read the explanation line under the tab, "What this brand pays
  // creators for content". That line was deleted on 2026-08-16 along with every
  // other title and description row in the admin panel. The replacement is the
  // action in the Offers filter row, which only that tab draws, so the check
  // still fails if the hub opens on Overview. Deliberately not the tab BUTTON,
  // which is present whichever tab is showing.
  check(
    (await page.getByRole('button', { name: /new offer/i }).count()) > 0,
    'it opens straight onto offers, not onto a wall of facts'
  );
  check(
    (await page.getByText(/\$25,000/).count()) === 0,
    'and the brand facts are not stacked above the work'
  );
  check(
    (await page.getByText(/\/wurx-test-brand/i).count()) === 0,
    'the slug is not shown to an admin, it is plumbing'
  );

  await page.getByRole('tab', { name: /overview/i }).click();
  await page.waitForTimeout(800);
  check(
    (await page.getByText(/\$25,000/).count()) > 0,
    'Overview carries the budget, as money rather than a raw number'
  );
  check((await page.getByText(STORE_ID).count()) > 0, 'and the store id');

  await page.getByRole('tab', { name: /^offers$/i }).click();
  await page.waitForTimeout(800);

  await page
    .getByRole('button', { name: /new offer|create the first offer/i })
    .first()
    .click();
  await page.waitForTimeout(700);

  // An empty field must LOOK empty. These started life as "5" and "300", which
  // are indistinguishable from typed values, so the form appeared filled in and
  // the errors under it read as a bug rather than an instruction.
  const hints = await page.evaluate(() =>
    ['videoCount', 'rewardAmount', 'title'].map((n) => ({
      name: n,
      value: document.querySelector(`[name="${n}"]`)?.value,
      placeholder: document.querySelector(`[name="${n}"]`)?.placeholder,
    }))
  );
  check(
    hints.every((h) => h.value === ''),
    'a new offer form starts genuinely empty'
  );
  check(
    hints.every((h) => /^e\.g\. /.test(h.placeholder ?? '')),
    `every example is prefixed so it cannot be mistaken for a value (${hints
      .map((h) => h.placeholder)
      .join(' | ')})`
  );

  // A corrected field must clear its own error. It used to stay red until the
  // next submit, so somebody who typed 0, was told "between 1 and 1000", then
  // fixed it to 1 still saw the complaint and assumed they were still wrong.
  await page.fill('input[name="title"]', 'Draft');
  await page.fill('input[name="videoCount"]', '0');
  await page.fill('input[name="rewardAmount"]', '10');
  await page.getByRole('button', { name: /^create offer$/i }).click();
  await page.waitForTimeout(600);
  check(
    (await page.getByText(/between 1 and 1000 videos/i).count()) > 0,
    'zero videos is refused'
  );
  await page.fill('input[name="videoCount"]', '1');
  await page.waitForTimeout(400);
  check(
    (await page.getByText(/between 1 and 1000 videos/i).count()) === 0,
    'and correcting it clears the error, without another submit'
  );

  // With "needs application" ticked, the offer has to say what it involves and
  // what it pays: somebody has to be able to apply against it.
  check(
    (await page.getByText(/needs a description of what to deliver/i).count()) > 0,
    'an offer creators apply for demands a description'
  );

  // Same dialog, still open. Fill it in properly this time.
  await page.fill('input[name="title"]', 'Starter bundle');
  await page.fill('input[name="badgeTitle"]', 'TOP PICK');
  await page.fill(
    'textarea[name="description"]',
    'Five in-feed videos, posted within 30 days.'
  );
  await page.fill('input[name="videoCount"]', '5');
  await page.fill('input[name="rewardAmount"]', '300');
  await page.waitForTimeout(400);
  check(
    (await page.getByText(/5 videos for \$300/i).count()) > 0,
    'the deal is summarised before it is saved'
  );
  await page.getByRole('button', { name: /^create offer$/i }).click();

  const offer = await waitFor(
    async () =>
      (
        await admin
          .from('offers')
          .select(
            'id, title, badge_title, video_count, reward_amount, currency, status, needs_application'
          )
          .eq('brand_id', brandId)
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the offer to be created'
  );

  check(Boolean(offer), 'the offer reached the database');
  check(offer?.video_count === 5, `video count stored (got ${offer?.video_count})`);
  check(
    Number(offer?.reward_amount) === 300,
    `reward stored exactly (got ${offer?.reward_amount})`
  );
  check(offer?.badge_title === 'TOP PICK', 'badge stored');
  check(offer?.status === 'active', 'status defaults to active');
  check(
    offer?.needs_application === true,
    'needs application defaults to true, so nothing is given away by accident'
  );
  const saysApply = await page
    .getByText(/apply first/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(saysApply, 'and the card says so');

  // A dialog left open would cover the page, and every later click would time
  // out against an overlay rather than a missing button. Fail loudly here
  // instead, where the cause is obvious.
  const dialogGone = await page
    .getByRole('dialog')
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(dialogGone, 'and the dialog closes itself after a successful save');

  /* ------------------------------------------------- [4] edit the offer -- */
  console.log('\n[4] Editing it');

  /*
   * Opened through the DOM rather than with a Playwright locator.
   *
   * Every WAITING action on `getByRole('button', { name: /^edit$/i })` hangs on
   * this page, while the same locator's `count()` returns exactly 1 and every
   * other button on the same page clicks fine. Measured at the moment of
   * failure: the element is visible, enabled, the topmost thing at its own
   * centre, the same DOM node for seconds, and the URL is not changing; a
   * screenshot shows an ordinary page. That is a harness quirk, not a defect in
   * the product, so it is worked around rather than chased further.
   *
   * The thing a real click would catch, an overlay swallowing input, is covered
   * by the "dialog closes itself" check above.
   */
  await page
    .getByRole('button', { name: /^edit$/i })
    .first()
    .click();
  await page.waitForTimeout(1200);

  // Opening the editor once threw, which took the whole page down with it:
  // PostgREST hands `numeric` back as a NUMBER, and the dialog called `.trim()`
  // on it. Assert the dialog is really there, and that nothing was thrown,
  // because a crashed page also has "no errors on screen".
  const thrown = consoleErrors.filter((e) => /TypeError|is not a function/i.test(e));
  check(thrown.length === 0, `opening the editor threw nothing (${thrown[0] ?? 'clean'})`);
  check(
    (await page.locator('input[name="rewardAmount"]').count()) > 0,
    'the edit dialog opens'
  );

  await page.fill('input[name="rewardAmount"]', '450.55');
  await page.locator('input[name="needsApplication"]').uncheck();
  await page.getByRole('button', { name: /^save changes$/i }).click();

  const edited = await waitFor(
    async () =>
      (
        await admin
          .from('offers')
          .select('reward_amount, needs_application')
          .eq('id', offer.id)
          .single()
      ).data,
    (r) => r?.needs_application === false,
    'the offer edit to land'
  );
  check(
    Number(edited?.reward_amount) === 450.55,
    `pennies survive the round trip (got ${edited?.reward_amount})`
  );
  check(edited?.needs_application === false, 'the offer is now open to all');

  /*
   * WAIT FOR THE CARD, not for 1200 milliseconds.
   *
   * This was a fixed sleep and it failed one run in several, most recently on
   * 2026-08-15, where it reported a working screen as broken. The write has
   * already landed by here; what is being waited on is a realtime event, then
   * an invalidation, then a refetch, then a render, and that chain is not 1.2
   * seconds wide on a loaded machine. Sleeping a guessed number of milliseconds
   * before a DOM assertion is the single most common flake in this repo and
   * OPERATIONS says so.
   */
  const cardUpdated = await page
    .getByText(/open to all/i)
    .first()
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  check(cardUpdated, 'the card updated without a reload');

  /* --------------------------------------------- [4b] the brand's story -- */
  console.log('\n[4b] The About tab, and products');
  await page.getByRole('tab', { name: /^about$/i }).click();
  await page.waitForSelector('input[name="tagline"]', { state: 'visible', timeout: 20000 });

  await page.fill('input[name="tagline"]', 'Recovery, Simplified');
  await page.fill(
    'textarea[name="description"]',
    'A test brand used to prove creators can read a brand without reading its budget.'
  );
  await page.getByRole('button', { name: /^save details$/i }).click();

  const about = await waitFor(
    async () =>
      (await admin.from('brands').select('tagline, description').eq('id', brandId).single())
        .data,
    (r) => r?.tagline === 'Recovery, Simplified',
    "the brand's story to save"
  );
  check(about?.tagline === 'Recovery, Simplified', 'the tagline saves');
  check((about?.description ?? '').startsWith('A test brand'), 'and so does the description');

  const { data: aboutLog } = await admin
    .from('audit_log')
    .select('action')
    .eq('subject_id', brandId)
    .eq('action', 'brand.about_updated');
  check((aboutLog ?? []).length > 0, 'and the edit is audited like every other write');

  /*
   * PRODUCTS HAVE THEIR OWN TAB NOW. They used to sit under the bottom half of
   * About, so this walked straight from saving the story into adding a product
   * without moving. Since 2026-10-12 the brand hub follows the order a creator
   * reads it in — About, Products, Briefs, Offers, Contests, Creators — and
   * products are a tab of their own, so this has to go there first.
   */
  await page.getByRole('tab', { name: /^products$/i }).click();
  await page.waitForSelector('[data-section="products"], button', {
    state: 'visible',
    timeout: 20000,
  });

  await page
    .getByRole('button', { name: /add product|add the first product/i })
    .first()
    .click();
  await page.waitForSelector('input[name="externalProductId"]', {
    state: 'visible',
    timeout: 20000,
  });

  await page.fill('input[name="name"]', 'Recovery Cream, 2 oz');
  await page.fill('input[name="externalProductId"]', `prod-${stamp}`);
  await page.fill('input[name="price"]', '16.98');
  await page.fill('input[name="commissionRate"]', '25');
  await page.fill('input[name="badgeTitle"]', 'HERO');
  // `.last()`: the section's own "Add product" button is still on the page
  // behind the dialog, so an unqualified locator matches two things.
  await page
    .getByRole('button', { name: /^add product$/i })
    .last()
    .click();

  const product = await waitFor(
    async () =>
      (
        await admin
          .from('brand_products')
          .select('id, name, price, commission_rate, badge_title, currency, is_active')
          .eq('brand_id', brandId)
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the product to be created'
  );
  check(Boolean(product), 'the product reached the database');
  check(Number(product?.price) === 16.98, `price stored exactly (got ${product?.price})`);
  check(
    Number(product?.commission_rate) === 25,
    `commission stored (got ${product?.commission_rate})`
  );
  check(product?.badge_title === 'HERO', 'badge stored');

  // Two rows for one TikTok Shop product would split a creator's numbers in
  // half, so the same id cannot be used twice on one brand.
  const duplicateProduct = await asUser(page, '/functions/v1/manage-brand', {
    method: 'POST',
    body: JSON.stringify({
      action: 'product.save',
      brandId,
      name: 'Duplicate',
      externalProductId: `prod-${stamp}`,
    }),
  });
  check(
    duplicateProduct.status === 409 && /already has a product/i.test(duplicateProduct.body),
    `a repeated product id is refused, in plain English (HTTP ${duplicateProduct.status})`
  );

  /* ---------------------------------------------------- [5] the attacks -- */
  console.log('\n[5] Attacks, run as a real signed-in creator');
  const { data: spy } = await admin.auth.admin.createUser({
    email: CREATOR_EMAIL,
    password: CREATOR_PASSWORD,
    email_confirm: true,
  });
  made.push(spy.user.id);
  await admin.from('profiles').update({ role: 'creator', tier: 'pro' }).eq('id', spy.user.id);

  const spyCtx = await browser.newContext();
  const spyPage = await spyCtx.newPage();
  const spyErrors = [];
  spyPage.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) {
      spyErrors.push(m.text());
    }
  });
  spyPage.on('pageerror', (e) => spyErrors.push(`pageerror: ${e.message}`));
  await spyPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await spyPage.fill('input[name="email"]', CREATOR_EMAIL);
  await spyPage.fill('input[name="password"]', CREATOR_PASSWORD);
  await spyPage.getByRole('button', { name: /^sign in$/i }).click();
  await spyPage.waitForURL('**/app', { timeout: 25000 }).catch(() => {});
  await spyPage.waitForTimeout(1800);

  /*
   * a. Brands.
   *
   * This pair replaced the old "a creator sees zero brands" assertion when the
   * creator hub was built. Deleting it instead would have quietly removed the
   * only thing standing between a creator and a client's budget. A creator is
   * SUPPOSED to read brands now. What they must never reach is the money.
   */
  const readBrands = await asUser(spyPage, '/rest/v1/brands?select=id,name,slug,tagline');
  check(
    rows(readBrands).length > 0,
    `a creator can read brands (${rows(readBrands).length} rows, HTTP ${readBrands.status})`
  );

  // Asking for the budget by name. It is not a column on this table any more,
  // so PostgREST cannot even parse the request, and the refusal carries no
  // number with it.
  const reachForBudget = await asUser(
    spyPage,
    '/rest/v1/brands?select=id,budget_allocated,client_name'
  );
  check(
    reachForBudget.status >= 400 &&
      !reachForBudget.body.includes(BUDGET) &&
      !reachForBudget.body.includes('Test Client'),
    `but a budget is not a column they can ask for (HTTP ${reachForBudget.status})`
  );

  // And the table it did move to is closed to them.
  const reachForCommercials = await asUser(
    spyPage,
    '/rest/v1/brand_commercials?select=brand_id,budget_allocated,client_name'
  );
  check(
    rows(reachForCommercials).length === 0,
    `nor read the table it lives in (${rows(reachForCommercials).length} rows, HTTP ${reachForCommercials.status})`
  );

  /*
   * a2. THE FOUR STAFF VIEWS, added 2026-08-11.
   *
   * `job_progress` is deliberately shared with creators and is safe because a
   * job belongs to exactly ONE creator, so a job level count is complete rather
   * than narrowed. These four group by BRAND or list every PERSON, where that
   * property does not hold: a creator reading them would get a well formed
   * brand-shaped object built from their own rows, with no error at all.
   *
   * So they carry an `is_staff()` gate in the view body as well as
   * security_invoker, and must return NOTHING here. A number that has been
   * silently narrowed is worse than one that refuses.
   */
  for (const view of [
    'brand_stage_totals?select=brand_id,stage,currency,jobs,committed',
    'brand_content_totals?select=brand_id,status,videos,creators',
    'brand_creator_roster?select=brand_id,creator_id,creator_handle,committed,paid',
    'creator_directory?select=id,email,display_name,tiktok_handle',
  ]) {
    const name = view.split('?')[0];
    const got = await asUser(spyPage, `/rest/v1/${view}`);
    check(
      rows(got).length === 0,
      `a creator gets nothing from ${name} (${rows(got).length} rows, HTTP ${got.status})`
    );
  }

  // And none of the four can be asked about a brand's money by name.
  for (const view of ['brand_stage_totals', 'brand_creator_roster', 'creator_directory']) {
    const got = await asUser(
      spyPage,
      `/rest/v1/${view}?select=budget_allocated,budget_used,client_name`
    );
    check(
      got.status >= 400 && !got.body.includes(BUDGET) && !got.body.includes('Test Client'),
      `and ${view} has no budget or client column to ask for (HTTP ${got.status})`
    );
  }

  // b. Offers. Live ones yes, switched-off ones no.
  const readOffers = await asUser(
    spyPage,
    '/rest/v1/offers?select=id,title,reward_amount,status'
  );
  check(
    rows(readOffers).length > 0,
    `a creator can read live offers (${rows(readOffers).length} rows, HTTP ${readOffers.status})`
  );
  check(
    rows(readOffers).every((o) => o.status === 'active'),
    'and every one of them is active, because row level security filtered the rest'
  );

  // b2. A retired brand takes its offers and products with it.
  await admin.from('brands').update({ is_active: false }).eq('id', brandId);
  const whileRetired = await asUser(
    spyPage,
    `/rest/v1/offers?brand_id=eq.${brandId}&select=id`
  );
  const retiredProducts = await asUser(
    spyPage,
    `/rest/v1/brand_products?brand_id=eq.${brandId}&select=id`
  );
  await admin.from('brands').update({ is_active: true }).eq('id', brandId);
  check(
    rows(whileRetired).length === 0 && rows(retiredProducts).length === 0,
    `retiring a brand hides its offers and products immediately (${rows(whileRetired).length}, ${rows(retiredProducts).length})`
  );

  // b3. Products carry the commission, which is exactly what they came for.
  const readProducts = await asUser(
    spyPage,
    '/rest/v1/brand_products?select=id,name,price,commission_rate'
  );
  check(
    rows(readProducts).some((p) => Number(p.commission_rate) === 25),
    `a creator can read products and their commission (${rows(readProducts).length} rows, HTTP ${readProducts.status})`
  );

  // b4. An applicant still in review gets none of it. The gate is the profiles
  // table, not the token, so this takes effect the moment a role changes.
  await admin.from('profiles').update({ role: 'applicant', tier: null }).eq('id', spy.user.id);
  const asApplicant = await asUser(spyPage, '/rest/v1/brands?select=id');
  const applicantOffers = await asUser(spyPage, '/rest/v1/offers?select=id');
  await admin.from('profiles').update({ role: 'creator', tier: 'pro' }).eq('id', spy.user.id);
  check(
    rows(asApplicant).length === 0 && rows(applicantOffers).length === 0,
    `somebody still in review sees nothing, on the same token (${rows(asApplicant).length}, ${rows(applicantOffers).length})`
  );

  // c0. Writing a product is refused the same way everything else is.
  const insertProduct = await asUser(spyPage, '/rest/v1/brand_products', {
    method: 'POST',
    body: JSON.stringify({
      brand_id: brandId,
      name: 'Mine',
      external_product_id: `stolen-${stamp}`,
    }),
  });
  check(
    insertProduct.status >= 400,
    `inserting a product is refused (HTTP ${insertProduct.status})`
  );

  const raiseCommission = await asUser(spyPage, `/rest/v1/brand_products?id=eq.${product.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ commission_rate: 99 }),
  });
  const { data: afterCommission } = await admin
    .from('brand_products')
    .select('commission_rate')
    .eq('id', product.id)
    .single();
  check(
    raiseCommission.status >= 400 || Number(afterCommission?.commission_rate) === 25,
    `cannot raise their own commission (HTTP ${raiseCommission.status}, still ${afterCommission?.commission_rate})`
  );

  // c. Write a brand straight to the table.
  const insertBrand = await asUser(spyPage, '/rest/v1/brands', {
    method: 'POST',
    body: JSON.stringify({ name: 'Mine now', slug: `mine-${stamp}`, store_id: `x-${stamp}` }),
  });
  check(insertBrand.status >= 400, `inserting a brand is refused (HTTP ${insertBrand.status})`);

  // d. Raise their own reward.
  const raiseReward = await asUser(spyPage, `/rest/v1/offers?id=eq.${offer.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ reward_amount: 999999 }),
  });
  const { data: afterRaise } = await admin
    .from('offers')
    .select('reward_amount')
    .eq('id', offer.id)
    .single();
  check(
    raiseReward.status >= 400 || Number(afterRaise?.reward_amount) === 450.55,
    `cannot raise their own reward (HTTP ${raiseReward.status}, still ${afterRaise?.reward_amount})`
  );

  // e. Call the Edge Function.
  const viaFunction = await asUser(spyPage, '/functions/v1/manage-brand', {
    method: 'POST',
    body: JSON.stringify({
      action: 'offer.save',
      brandId,
      title: 'Free money',
      videoCount: 1,
      rewardAmount: 100000,
    }),
  });
  check(
    viaFunction.status === 403,
    `the Edge Function refuses a creator (HTTP ${viaFunction.status})`
  );

  const { data: denied } = await admin
    .from('audit_log')
    .select('action')
    .eq('action', 'brand.write_denied')
    .eq('actor_id', spy.user.id);
  check((denied ?? []).length > 0, 'and the attempt is recorded with their name on it');

  // f. Call the database functions directly.
  const directRpc = await asUser(spyPage, '/rest/v1/rpc/save_offer', {
    method: 'POST',
    body: JSON.stringify({
      p_actor_id: spy.user.id,
      p_brand_id: brandId,
      p_title: 'Free money',
      p_video_count: 1,
      p_reward_amount: 100000,
    }),
  });
  check(
    directRpc.status >= 400,
    `save_offer is unreachable with a user token (HTTP ${directRpc.status})`
  );

  const directBrand = await asUser(spyPage, '/rest/v1/rpc/save_brand', {
    method: 'POST',
    body: JSON.stringify({ p_actor_id: spy.user.id, p_name: 'Mine', p_store_id: 'x' }),
  });
  check(
    directBrand.status >= 400,
    `save_brand is unreachable too (HTTP ${directBrand.status})`
  );

  // g. No token at all.
  const anonCall = await fetch(`${URL_BASE}/functions/v1/manage-brand`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'brand.save', name: 'Anon', storeId: 'anon' }),
  });
  check(anonCall.status === 401, `an anonymous call is rejected (HTTP ${anonCall.status})`);

  const { count: stillOne } = await admin
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', STORE_ID);
  check(stillOne === 1, 'after all of that, nothing was created or changed');

  /* ------------------------------------------- [5b] the creator's own hub -- */
  // The attacks above prove the database holds. This proves the screen a real
  // creator actually looks at is built on that, and that nothing internal
  // leaked into the markup on the way.
  console.log('\n[5b] The hub, as the creator sees it');

  await spyPage.goto(`${BASE}/app/brands`, { waitUntil: 'domcontentloaded' });
  await spyPage.waitForTimeout(2500);
  check((await spyPage.getByText(BRAND_NAME).count()) > 0, 'the brand is listed for them');

  await spyPage.goto(`${BASE}/app/brands/${brand.slug}`, { waitUntil: 'domcontentloaded' });
  /*
   * WAIT FOR THE PRODUCT, which is the LAST thing on this screen to arrive.
   *
   * This was `waitForTimeout(2500)`, and on 2026-08-15 it failed with the
   * tagline present and the product missing: the brand and its products are two
   * separate reads, and only one of them had landed. A guessed sleep that is
   * long enough on a quiet machine is not long enough on a loaded one, and it
   * reported a working screen as broken.
   *
   * Swallowing the timeout is deliberate. If the product genuinely never
   * renders, the checks below still run and still fail, with their own wording,
   * rather than the suite dying on a raw Playwright error.
   */
  await spyPage
    .getByText('Recovery Cream, 2 oz')
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {});
  check(
    (await spyPage.getByRole('heading', { name: BRAND_NAME }).count()) > 0,
    'and its hub opens on the brand itself'
  );
  check(
    (await spyPage.getByText('Recovery, Simplified').count()) > 0,
    'the tagline the admin wrote is there'
  );
  check((await spyPage.getByText('Recovery Cream, 2 oz').count()) > 0, 'so is the product');
  check((await spyPage.getByText('25%').count()) > 0, 'with the commission on it');

  // The whole point of the split, checked on the rendered page rather than only
  // on the wire.
  const hubText = await spyPage.evaluate(() => document.body.innerText);
  check(
    !hubText.includes('25,000') && !hubText.includes('Test Client'),
    'and neither the budget nor the client appears anywhere on the page'
  );

  await spyPage.getByRole('tab', { name: /^offers$/i }).click();
  await spyPage.waitForTimeout(1200);
  check(
    (await spyPage.getByText('Starter bundle').count()) > 0,
    'the offers tab shows the live offer'
  );
  check(
    (await spyPage.getByText(/already on this one/i).count()) > 0,
    'and says it is already theirs, because it was saved needing no application'
  );

  const offersText = await spyPage.evaluate(() => document.body.innerText);
  check(
    !offersText.includes('25,000') && !offersText.includes('Test Client'),
    'still nothing internal on the offers tab'
  );

  // An applicant reaching the same address is told what it is waiting on,
  // rather than being shown an empty page that reads like a bug.
  await admin.from('profiles').update({ role: 'applicant', tier: null }).eq('id', spy.user.id);
  await spyPage.goto(`${BASE}/app/brands`, { waitUntil: 'domcontentloaded' });
  await spyPage.waitForTimeout(2500);
  check(
    (await spyPage.getByText(/opens when you are approved/i).count()) > 0,
    'somebody still in review is told what they are waiting for'
  );
  check((await spyPage.getByText(BRAND_NAME).count()) === 0, 'and sees no brand names at all');
  await admin.from('profiles').update({ role: 'creator', tier: 'pro' }).eq('id', spy.user.id);

  const spyReal = spyErrors.filter(
    (e) => !/Failed to load resource.*(400|401|403|409)/i.test(e)
  );
  check(spyReal.length === 0, `the creator's screens log nothing (${spyReal.length})`);
  spyReal.slice(0, 3).forEach((e) => console.error(`        ${e}`));

  /* ------------------------------------------------------- [6] deleting -- */
  console.log('\n[6] Deleting an offer keeps the record');
  // Back to the Offers tab explicitly. The page was last left on Products
  // (About, before products moved to their own tab), which carries its own
  // "Delete <product>" buttons, so a first-match locator there deletes a
  // product and then cheerfully reports that the offer survived.
  //
  // Reloading the record no longer lands on Offers either: since 2026-10-12 the
  // hub opens on About, the first thing a creator sees. So say which tab.
  await page.goto(`${BASE}/admin/brands/${brandId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('tab', { name: /^offers$/i }).click();
  await page.waitForTimeout(1500);
  // The button is labelled "Delete Starter bundle", not just "Delete": with
  // several offers on screen, "Delete" alone tells a screen reader nothing.
  await page
    .getByRole('button', { name: /^delete\s+\S/i })
    .first()
    .click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /yes, delete/i }).click();

  const offersLeft = await waitFor(
    async () =>
      (
        await admin
          .from('offers')
          .select('id', { count: 'exact', head: true })
          .eq('brand_id', brandId)
      ).count,
    (n) => n === 0,
    'the offer to be deleted'
  );
  check(offersLeft === 0, `the offer is gone (${offersLeft} left)`);

  const { data: deleteLog } = await admin
    .from('audit_log')
    .select('action, detail')
    .eq('subject_id', offer.id)
    .eq('action', 'offer.deleted');
  check((deleteLog ?? []).length === 1, 'and the audit log still says what it was');
  check(
    deleteLog?.[0]?.detail?.title === 'Starter bundle',
    'including its title and reward, after the row itself is gone'
  );

  /* ------------------------------------------- [6b] offers with no terms -- */
  // Not every offer is "N videos for $X". A boosted commission rate or an open
  // collaboration has no fixed deliverable and no fixed fee, and forcing a
  // number into those only gets a made up one typed in. Run last, on an empty
  // brand, so it cannot disturb anything above.
  console.log('\n[6b] An offer with no fixed terms');
  await page
    .getByRole('button', { name: /new offer|create the first offer/i })
    .first()
    .click();
  await page.waitForSelector('input[name="title"]', { state: 'visible', timeout: 20000 });

  await page.fill('input[name="title"]', 'Boosted commission');
  await page.getByRole('button', { name: /^create offer$/i }).click();
  await page.waitForTimeout(900);
  const termsDemanded = await page.locator('[role="alert"]').allInnerTexts();
  check(
    termsDemanded.some((t) => /how many videos/i.test(t)),
    `with "needs application" ticked the terms are required (${termsDemanded.join(' | ') || 'none'})`
  );

  await page.locator('input[name="needsApplication"]').uncheck();
  await page.waitForTimeout(600);
  const afterUntick = await page.locator('[role="alert"]').allInnerTexts();
  check(
    afterUntick.length === 0,
    `unticking it drops every requirement (${afterUntick.join(' | ') || 'none'})`
  );

  await page.getByRole('button', { name: /^create offer$/i }).click();
  const openOffer = await waitFor(
    async () =>
      (
        await admin
          .from('offers')
          .select('id, video_count, reward_amount, needs_application')
          .eq('brand_id', brandId)
          .eq('title', 'Boosted commission')
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the offer with no fixed terms to be created'
  );
  check(
    openOffer?.video_count === null && openOffer?.reward_amount === null,
    `it saves with no videos and no reward (${openOffer?.video_count}, ${openOffer?.reward_amount})`
  );
  const saysNoTerms = await page
    .getByText(/no fixed deliverable or fee/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(saysNoTerms, 'and its card says so rather than printing a zero');

  // The server holds the same line with the browser bypassed entirely.
  const bypass = await asUser(page, '/functions/v1/manage-brand', {
    method: 'POST',
    body: JSON.stringify({
      action: 'offer.save',
      brandId,
      title: 'Sneaky',
      needsApplication: true,
      description: 'Something',
    }),
  });
  check(
    bypass.status === 400 && /how many videos/i.test(bypass.body),
    `and the server demands them too when they must apply (HTTP ${bypass.status})`
  );

  /* -------------------------------------------------------- [7] console -- */
  console.log('\n[7] Console');
  // This suite deliberately provokes refusals: a duplicate store id, and a
  // creator reaching for things they may not have. The browser logs each of
  // those as a failed request, and counting them would mean the suite fails
  // precisely because the security worked. Anything else, including a 500 or a
  // thrown error, still counts.
  // 400 a rejected offer with missing terms, 401 anonymous, 403 a creator
  // reaching for staff things, 409 a duplicate store id. All provoked here on
  // purpose.
  const expected = /Failed to load resource.*(400|401|403|409)/i;
  const real = consoleErrors.filter((e) => !expected.test(e));
  const refusals = consoleErrors.length - real.length;
  check(real.length === 0, `no unexpected console errors (${real.length})`);
  real.slice(0, 3).forEach((e) => console.error(`        ${e}`));
  console.log(`        (${refusals} deliberate refusals logged by the browser, ignored)`);

  await spyCtx.close();
  await adminCtx.close();
} catch (e) {
  fail(`unexpected error: ${e.message}`);
  console.error(e.stack);
} finally {
  await browser.close();

  if (brandId) {
    await admin.from('audit_log').delete().eq('subject_id', brandId);
    const { data: offerIds } = await admin.from('offers').select('id').eq('brand_id', brandId);
    for (const o of offerIds ?? []) {
      await admin.from('audit_log').delete().eq('subject_id', o.id);
    }
    const { data: productIds } = await admin
      .from('brand_products')
      .select('id')
      .eq('brand_id', brandId);
    for (const p of productIds ?? []) {
      await admin.from('audit_log').delete().eq('subject_id', p.id);
    }
    // Offers, products and the commercial row all cascade off the brand.
    await admin.from('brands').delete().eq('id', brandId);
  }
  for (const id of made) {
    await admin.from('audit_log').delete().eq('actor_id', id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) fail(`could not delete a test account: ${error.message}`);
  }
  console.log('\n[cleanup] test brand, offers, audit rows and accounts removed');
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('The Brand Hub works, and holds up under attack.\n');
