#!/usr/bin/env node
/**
 * End to end test of creators asking for offers, and staff deciding.
 *
 * A creator takes an offer as it is written. Naming their own price shipped on
 * 2026-07-31 and was withdrawn the same day, and section [4f] holds that line.
 *
 * This is the first thing in the product a CREATOR can write, so most of this
 * suite is spent trying to make that write do something it should not: aim it
 * at somebody else's row, decide their own request, take an offer that was
 * never open, ask twice, or set their own terms.
 *
 * It drives the real browser on both sides, checks the database between steps,
 * and cleans up after itself. Run against DEV only.
 *
 * Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... SUPABASE_SERVICE_KEY=...
 *   node scripts/verify/creator/check-offer-requests.mjs [baseUrl]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';
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
assertDevProject(URL_BASE, 'check-offer-requests.mjs');
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

const stamp = process.env.RUN_STAMP ?? String(Date.now()).slice(-7);
const BRAND_NAME = `Wurx Ask Brand ${stamp}`;
const STORE_ID = `ask-store-${stamp}`;
const HANDLE = `askcreator${stamp}`;
const CREATOR_EMAIL = `ask-${stamp}@wurxmediahub.test`;
const RIVAL_EMAIL = `rival-${stamp}@wurxmediahub.test`;
const PASSWORD = 'a-long-enough-test-password-1';

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));

const made = [];
let brandId = null;
let otherBrandId = null;
const browser = await launchBrowser();

/** Poll until the database says what we are waiting for, or give up. */
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
 * `json` is parsed from the WHOLE response, `body` is trimmed for readable
 * failure messages. Parsing the trimmed copy turns any long list into "0 rows",
 * which reads exactly like row level security refusing the request.
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

const rows = (r) => (Array.isArray(r?.json) ? r.json : []);

/** Sign somebody in and land them in the app. */
async function signIn(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('**/app', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Every real creator meets the welcome once, so every suite has to walk
  // through it before it can see the screen underneath.
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
}

/** Make an approved creator, with a handle so the queue has something to find. */
async function makeCreator(email, handle) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: handle },
  });
  if (error) throw new Error(`could not create ${email}: ${error.message}`);
  made.push(data.user.id);

  await admin
    .from('profiles')
    .update({
      role: 'creator',
      tier: 'pro',
      // Settle the one-time moments that are not what this suite is about.
      welcomed_at: new Date().toISOString(),
      approval_celebrated_at: new Date().toISOString(),
    })
    .eq('id', data.user.id);

  // The handle lives on the application, not the profile, and `apply_for_offer`
  // snapshots it onto the request. Without this the admin queue has nothing to
  // search by, so a failure here has to be loud rather than silent.
  const { error: appErr } = await admin.from('applications').insert({
    user_id: data.user.id,
    tiktok_handle: handle,
    niche: 'beauty',
    worked_with_wurx: false,
    video_links: 'https://www.tiktok.com/@example/video/1234567890',
    status: 'approved',
  });
  if (appErr) throw new Error(`could not seed an application: ${appErr.message}`);

  return data.user.id;
}

try {
  console.log(`\nOffer requests against ${BASE}\n${'='.repeat(70)}`);

  /* ------------------------------------------------------- [0] the setup -- */
  console.log('\n[0] A brand with three kinds of offer');

  const { data: staff } = await admin
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'ops'])
    .eq('is_active', true)
    .limit(1)
    .single();

  const { data: brand, error: brandErr } = await admin.rpc('save_brand', {
    p_actor_id: staff.id,
    p_name: BRAND_NAME,
    p_store_id: STORE_ID,
    p_brand_id: null,
    p_client_name: 'Ask Client Ltd',
    p_budget: 41000,
    p_currency: 'USD',
    p_is_active: true,
  });
  if (brandErr || !brand) throw new Error(`could not create the brand: ${brandErr?.message}`);
  brandId = brand.id;
  check(Boolean(brandId), 'the brand exists');

  const makeOffer = async (title, videos, reward, needsApplication) => {
    const { data, error } = await admin.rpc('save_offer', {
      p_actor_id: staff.id,
      p_brand_id: brandId,
      p_title: title,
      p_video_count: videos,
      p_reward_amount: reward,
      p_description: 'Something to make.',
      p_currency: 'USD',
      p_status: 'active',
      p_needs_application: needsApplication,
    });
    if (error) throw new Error(`could not create "${title}": ${error.message}`);
    return data;
  };

  const fixed = await makeOffer('Fixed terms deal', 5, 300, true);
  const openEnded = await makeOffer('Name your price', null, null, true);
  const takeIt = await makeOffer('Already yours', 1, 60, false);
  check(
    Boolean(fixed?.id && openEnded?.id && takeIt?.id),
    'three offers: fixed terms, open ended, and one nobody has to ask for'
  );

  // A second brand, with its own budget, used for one thing only: proving that
  // approving somebody on the first brand does not touch the second.
  const { data: otherBrand } = await admin.rpc('save_brand', {
    p_actor_id: staff.id,
    p_name: `${BRAND_NAME} neighbour`,
    p_store_id: `${STORE_ID}-b`,
    p_brand_id: null,
    p_client_name: 'Neighbour Ltd',
    p_budget: 5000,
    p_currency: 'USD',
    p_is_active: true,
  });
  otherBrandId = otherBrand?.id ?? null;
  check(Boolean(otherBrandId), 'a second brand exists, to prove budgets do not leak sideways');

  const creatorId = await makeCreator(CREATOR_EMAIL, HANDLE);
  const rivalId = await makeCreator(RIVAL_EMAIL, `rival${stamp}`);
  check(Boolean(creatorId && rivalId), 'two approved creators exist');

  /* -------------------------------------------------- [1] the creator's view */
  console.log('\n[1] What a creator sees before asking');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) {
      consoleErrors.push(m.text());
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await signIn(page, CREATOR_EMAIL);
  await page.goto(`${BASE}/app/brands/${brand.slug}?section=offers`, {
    waitUntil: 'domcontentloaded',
  });

  // Waited for, not slept on. A fixed pause is a guess about how fast the
  // machine and the network are today, and this suite runs against a live
  // deployment on a laptop that is also running everything else.
  const offersOnScreen = await page
    .getByText('Fixed terms deal')
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);

  check(offersOnScreen, 'the offers are on screen');
  check(
    (await page.getByText(/already on this one/i).count()) > 0,
    'an offer nobody has to apply for says it is already theirs'
  );
  check(
    (await page.getByText(/no fixed deliverable or fee/i).count()) === 0,
    'and the old "no fixed deliverable" line is gone for good'
  );

  // The header used to be a tall card with the name set large, pushing the
  // actual content off the first screen.
  const headerBottom = await page
    .getByRole('tablist', { name: /brand hub sections/i })
    .evaluate((el) => el.getBoundingClientRect().bottom);
  check(
    headerBottom < 220,
    `the tabs start high on the page, not below a hero (${Math.round(headerBottom)}px)`
  );

  /* ------------------------------------------------ [2] taking it as offered */
  console.log('\n[2] Taking an offer as it is written');
  // Named by its card, never "the first Apply on the page". Cards are newest
  // first, so an unscoped click applies for whichever offer was created last.
  const offerCard = (title) => page.locator('li').filter({ hasText: title });

  await offerCard('Fixed terms deal')
    .getByRole('button', { name: /apply for this/i })
    .first()
    .click();
  await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 20000 });

  // An offer is taken as it stands. There is nothing to choose and nothing to
  // type, so the dialog must not present either.
  check(
    (await page.locator('input[name="videoCount"], input[name="amount"]').count()) === 0,
    'the dialog has no way to change the terms'
  );
  check(
    (await page.getByText(/5 videos for \$300/i).count()) > 0,
    'and restates exactly what they are asking for'
  );
  await page.getByRole('button', { name: /^send request$/i }).click();

  const asOffered = await waitFor(
    async () =>
      (
        await admin
          .from('offer_applications')
          .select('id, status, currency, creator_handle')
          .eq('offer_id', fixed.id)
          .eq('creator_id', creatorId)
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the request to be stored'
  );
  check(asOffered?.status === 'pending', 'it lands as pending');
  check(
    asOffered?.currency === 'USD',
    `the currency the offer was quoted in is recorded (${asOffered?.currency})`
  );
  check(
    asOffered?.creator_handle === HANDLE,
    `the handle is snapshotted onto the row (got ${asOffered?.creator_handle})`
  );
  const withTeam = await page
    .getByText(/with the team/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(withTeam, 'and the card says it is with the team');

  /* ------------------------------------------------ [3] an offer with no terms */
  console.log('\n[3] An offer whose terms have not been written down');
  await offerCard('Name your price')
    .getByRole('button', { name: /apply for this/i })
    .first()
    .click();
  await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 20000 });

  // A creator is not punished for an admin leaving a field empty. They can
  // still ask; the team confirms what it involves.
  check(
    (await page.getByText(/confirm what this one involves/i).count()) > 0,
    'they can still ask, and are told the team will confirm the detail'
  );
  await page.fill('textarea[name="note"]', 'I already use this every day.');
  await page.getByRole('button', { name: /^send request$/i }).click();

  const openRequest = await waitFor(
    async () =>
      (
        await admin
          .from('offer_applications')
          .select('id, note, currency')
          .eq('offer_id', openEnded.id)
          .eq('creator_id', creatorId)
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the request to be stored'
  );
  check(Boolean(openRequest?.id), 'the request is stored');
  check(openRequest?.note?.startsWith('I already use'), 'along with the note they wrote');

  /* --------------------------------------------------------- [4] the attacks */
  console.log('\n[4] Attacks, run as a real signed-in creator');

  // a. Write the row by hand.
  const insertDirect = await asUser(page, '/rest/v1/offer_applications', {
    method: 'POST',
    body: JSON.stringify({
      offer_id: fixed.id,
      brand_id: brandId,
      creator_id: creatorId,
      status: 'approved',
    }),
  });
  check(insertDirect.status >= 400, `inserting a request by hand is refused (HTTP ${insertDirect.status})`);

  // b. Approve their own.
  const selfApprove = await asUser(
    page,
    `/rest/v1/offer_applications?id=eq.${asOffered.id}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }
  );
  const { data: stillPending } = await admin
    .from('offer_applications')
    .select('status')
    .eq('id', asOffered.id)
    .single();
  check(
    selfApprove.status >= 400 || stillPending?.status === 'pending',
    `cannot approve their own request (HTTP ${selfApprove.status}, still ${stillPending?.status})`
  );

  // c. Approve their own through the front door.
  const viaFunction = await asUser(page, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({
      action: 'application.review',
      applicationId: asOffered.id,
      decision: 'approved',
    }),
  });
  check(
    viaFunction.status === 403,
    `and the Edge Function refuses a creator reviewing (HTTP ${viaFunction.status})`
  );
  const { data: denied } = await admin
    .from('audit_log')
    .select('action')
    .eq('action', 'offer_application.write_denied')
    .eq('actor_id', creatorId);
  check((denied ?? []).length > 0, 'the attempt is recorded with their name on it');

  // d. Ask twice.
  const twice = await asUser(page, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({ action: 'application.create', offerId: fixed.id }),
  });
  check(
    twice.status === 409,
    `asking for the same offer twice is refused (HTTP ${twice.status})`
  );

  // e. Ask for an offer that never needed asking.
  const pointless = await asUser(page, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({ action: 'application.create', offerId: takeIt.id }),
  });
  check(
    pointless.status === 400 && /already yours/i.test(pointless.body),
    `applying for an open offer is refused, in plain English (HTTP ${pointless.status})`
  );

  /*
   * f. Naming their own terms anyway.
   *
   * Countering shipped and was withdrawn the same day, so this is exactly what
   * a browser tab left open across the change would send. It has to be refused
   * out loud rather than quietly stripped, or somebody who typed "12 videos for
   * $900" gets a cheerful success and finds they agreed to the brand's number.
   */
  const ownPrice = await asUser(page, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({
      action: 'application.create',
      offerId: fixed.id,
      videoCount: 12,
      amount: 900,
    }),
  });
  check(
    ownPrice.status === 400 && /as it stands/i.test(ownPrice.body),
    `naming their own price is refused, in plain English (HTTP ${ownPrice.status})`
  );
  // The refusal has to be the whole story. An error message is not proof that
  // nothing was written, so count the rows rather than trust the status code.
  const { count: stillOne } = await admin
    .from('offer_applications')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', fixed.id)
    .eq('creator_id', creatorId);
  check(stillOne === 1, `and no second request was created by it (${stillOne})`);

  // g. Read somebody else's request.
  const rivalCtx = await browser.newContext();
  const rivalPage = await rivalCtx.newPage();
  await signIn(rivalPage, RIVAL_EMAIL);
  /*
   * The error was being thrown away, which made this check lie.
   *
   * If this RPC fails, for any reason including a transient network blip on the
   * machine running the suite, no request is ever created and the read below
   * comes back empty. The check then reports "a creator sees only their own
   * requests (0 rows)", which reads like a row level security failure and is
   * nothing of the kind. Set-up failing must not be reported as the thing under
   * test failing.
   */
  const rivalApplied = await admin.rpc('apply_for_offer', {
    p_actor_id: rivalId,
    p_offer_id: fixed.id,
    p_note: 'mine',
  });
  if (rivalApplied.error) {
    throw new Error(`set-up failed, the rival could not apply: ${rivalApplied.error.message}`);
  }
  const spying = await asUser(rivalPage, '/rest/v1/offer_applications?select=id,creator_id');
  check(
    rows(spying).length > 0 && rows(spying).every((r) => r.creator_id === rivalId),
    `a creator sees only their own requests (${rows(spying).length} rows, all theirs: ${rows(spying).every((r) => r.creator_id === rivalId)})`
  );

  // h. Withdraw somebody else's.
  const stealWithdraw = await asUser(rivalPage, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({
      action: 'application.withdraw',
      applicationId: asOffered.id,
    }),
  });
  check(
    stealWithdraw.status === 404,
    `and cannot withdraw somebody else's (HTTP ${stealWithdraw.status})`
  );
  await rivalCtx.close();

  /* --------------------------------------------------------- [5] the queue */
  console.log('\n[5] The admin queue');
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const adminPage = await adminCtx.newPage();
  adminPage.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) {
      consoleErrors.push(`admin: ${m.text()}`);
    }
  });
  adminPage.on('pageerror', (e) => consoleErrors.push(`admin pageerror: ${e.message}`));

  await adminPage.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await adminPage.fill('input[name="email"]', ADMIN_EMAIL);
  await adminPage.fill('input[name="password"]', ADMIN_PASSWORD);
  await adminPage.getByRole('button', { name: /^sign in$/i }).click();
  await adminPage.waitForURL('**/admin', { timeout: 30000 }).catch(() => {});

  await adminPage.goto(`${BASE}/admin/offers/requests`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(3000);

  check(
    (await adminPage.getByText(`@${HANDLE}`).count()) > 0,
    'the request is in the queue, under the creator handle'
  );
  /*
   * The card was rebuilt on 2026-08-21 and the deal is no longer one sentence.
   * The amount is the hero and the shape of the deal is its caption, so this
   * asserts BOTH halves rather than loosening to whichever one still matched:
   * a card showing $300 with no idea how many videos buys it is exactly the
   * thing this check exists to catch.
   */
  const queueText = await adminPage.evaluate(() => document.body.innerText);
  check(
    queueText.includes('$300') && /5\s+videos/i.test(queueText) && /\$60\s+each/i.test(queueText),
    'with the deal spelled out as numbers, so the decision needs no second screen'
  );

  // Search narrows to one creator.
  await adminPage.fill('input[name="search"]', HANDLE);
  await adminPage.press('input[name="search"]', 'Enter');
  await adminPage.waitForTimeout(2000);
  check(
    (await adminPage.getByText(`@rival${stamp}`).count()) === 0,
    'searching by handle drops everyone else'
  );
  await adminPage.fill('input[name="search"]', '');
  await adminPage.press('input[name="search"]', 'Enter');
  await adminPage.waitForTimeout(1500);

  // Brand filter.
  await adminPage.selectOption('select[name="brand"]', { label: BRAND_NAME });
  await adminPage.waitForTimeout(2000);
  check(
    (await adminPage.getByText(`@${HANDLE}`).count()) > 0,
    'filtering by brand keeps this brand'
  );

  /* ------------------------------------------------------ [6] the decision */
  console.log('\n[6] Approving, and the creator being told');
  /*
   * Bring the creator's screen back to the offers tab and leave it there, so
   * the decision has to arrive on its own.
   *
   * Waiting for the card proves the page has loaded AND gives its realtime
   * channel time to attach, which is what the check at the end of this section
   * depends on. Sleeping 2.5 seconds and hoping races the socket on a live
   * deployment, and then blames the product for losing the message.
   */
  await page.goto(`${BASE}/app/brands/${brand.slug}?section=offers`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByText(/with the team/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  /*
   * Scoped to the row, not "the first Approve button on the page".
   *
   * The queue is newest first and this suite deliberately creates several
   * requests, so an unscoped click decides whichever one happens to sort first
   * and then reports that the one being watched never changed. It cost half an
   * hour once already.
   */
  const rowFor = (title) =>
    adminPage
      .locator('li')
      .filter({ hasText: title })
      // Both creators asked for the fixed terms offer, so the title alone is
      // not enough to name a single row.
      .filter({ hasText: `@${HANDLE}` });

  await rowFor('Fixed terms deal')
    .getByRole('button', { name: /^approve$/i })
    .first()
    .click();
  await adminPage.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 20000 });
  check(
    (await adminPage.getByText(/taking it exactly as offered|they are asking for/i).count()) > 0,
    'the dialog restates the terms being agreed to'
  );
  await adminPage.fill('textarea[name="note"]', 'Happy with that.');
  await adminPage.getByRole('button', { name: /yes, approve/i }).click();

  const approved = await waitFor(
    async () =>
      (
        await admin
          .from('offer_applications')
          .select('status, decided_by, decided_at, decision_note')
          .eq('id', asOffered.id)
          .single()
      ).data,
    (r) => r?.status === 'approved',
    'the approval to land'
  );
  check(approved?.status === 'approved', 'the request is approved');
  check(Boolean(approved?.decided_by && approved?.decided_at), 'with who decided it and when');
  check(approved?.decision_note === 'Happy with that.', 'and what they said');

  const { data: approvalLog } = await admin
    .from('audit_log')
    .select('action, target_user_id')
    .eq('subject_id', asOffered.id)
    .eq('action', 'offer_application.approved');
  check((approvalLog ?? []).length === 1, 'the decision is audited');
  check(
    approvalLog?.[0]?.target_user_id === creatorId,
    'against the creator it was about, not just the admin who made it'
  );

  // The creator was never told to refresh.
  const toldLive = await page
    .getByText(/you are in/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(toldLive, 'and it reaches the creator without a reload');

  /* ------------------------------------------------------ [6b] the budget */
  // Approving is the moment money stops being a plan and becomes a promise.
  console.log('\n[6b] What approving does to the budget');

  const readBudget = async (id) =>
    (
      await admin
        .from('brand_commercials')
        .select('budget_allocated, budget_used, budget_used_percent')
        .eq('brand_id', id)
        .single()
    ).data;

  const spent = await readBudget(brandId);
  check(
    Number(spent?.budget_used) === 300,
    `the offer's price is charged to the brand (used ${spent?.budget_used} of ${spent?.budget_allocated})`
  );
  check(
    Number(spent?.budget_used_percent) === Number((300 / 41000 * 100).toFixed(2)),
    `and the percentage is worked out in the database (${spent?.budget_used_percent}%)`
  );

  const untouched = await readBudget(otherBrandId);
  check(
    Number(untouched?.budget_used) === 0,
    `the other brand's budget did not move (${untouched?.budget_used})`
  );

  const { data: committed } = await admin
    .from('offer_applications')
    .select('committed_amount')
    .eq('id', asOffered.id)
    .single();
  check(
    Number(committed?.committed_amount) === 300,
    `what was promised is written on the request itself (${committed?.committed_amount})`
  );

  /*
   * Re-pricing the offer afterwards must not rewrite history. The creator was
   * promised 300 and the budget was charged 300, and neither changes because
   * somebody edited the offer next month.
   */
  await admin.rpc('save_offer', {
    p_actor_id: staff.id,
    p_brand_id: brandId,
    p_title: 'Fixed terms deal',
    p_video_count: 5,
    p_reward_amount: 999,
    p_offer_id: fixed.id,
    p_description: 'Something to make.',
    p_currency: 'USD',
    p_status: 'active',
    p_needs_application: true,
  });
  const afterRepricing = await readBudget(brandId);
  const { data: stillCommitted } = await admin
    .from('offer_applications')
    .select('committed_amount')
    .eq('id', asOffered.id)
    .single();
  check(
    Number(afterRepricing?.budget_used) === 300 &&
      Number(stillCommitted?.committed_amount) === 300,
    `re-pricing the offer does not rewrite a promise already made (used ${afterRepricing?.budget_used}, committed ${stillCommitted?.committed_amount})`
  );

  // A creator must never see any of this.
  const peeking = await asUser(
    page,
    '/rest/v1/brand_commercials?select=brand_id,budget_used,budget_used_percent'
  );
  check(
    rows(peeking).length === 0,
    `a creator cannot read what a brand has spent (${rows(peeking).length} rows, HTTP ${peeking.status})`
  );

  /* ---------------------------------------------------- [6c] the pipeline */
  // Approving is the start of the work, not the end of it. Seven stages, the
  // same words on both sides, and the creator told at every step.
  console.log('\n[6c] Moving through the pipeline');

  const { data: started } = await admin
    .from('offer_applications')
    .select('stage, stage_updated_at')
    .eq('id', asOffered.id)
    .single();
  check(started?.stage === 'pending_request', `approving starts the pipeline (${started?.stage})`);
  check(Boolean(started?.stage_updated_at), 'and stamps when it started');

  const { data: firstEvent } = await admin
    .from('offer_stage_events')
    .select('from_stage, to_stage')
    .eq('application_id', asOffered.id);
  check(
    (firstEvent ?? []).length === 1 && firstEvent[0].from_stage === null,
    `with a first event that came from nowhere (${JSON.stringify(firstEvent)})`
  );

  /*
   * The creator is watching their dashboard. Nothing below tells them to look.
   *
   * Waiting for the stage to appear also proves the page has finished loading
   * and its realtime channel has had time to attach, which is what the check
   * further down actually depends on. Acting before that races the socket and
   * blames the product for it.
   */
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  const stageOnBoard = await page
    .getByText(/pending request/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(stageOnBoard, 'the creator dashboard shows the stage they are at');
  await page.waitForTimeout(1500);

  // Admin moves it along, through the real control on the real screen.
  await adminPage.goto(`${BASE}/admin/offers/requests?status=approved`, {
    waitUntil: 'domcontentloaded',
  });
  await adminPage.waitForTimeout(2500);
  await rowFor('Fixed terms deal').locator('select[name="stage"]').first()
    .selectOption('sample_shipped');

  const shipped = await waitFor(
    async () =>
      (await admin.from('offer_applications').select('stage').eq('id', asOffered.id).single())
        .data,
    (r) => r?.stage === 'sample_shipped',
    'the stage to change'
  );
  check(shipped?.stage === 'sample_shipped', 'an admin can move it along');

  const { data: events } = await admin
    .from('offer_stage_events')
    .select('from_stage, to_stage')
    .eq('application_id', asOffered.id)
    .order('created_at', { ascending: false })
    .limit(1);
  check(
    events?.[0]?.from_stage === 'pending_request' && events?.[0]?.to_stage === 'sample_shipped',
    `and the move is recorded both ends (${JSON.stringify(events?.[0])})`
  );

  // Live, with no reload, the same way an approval arrives.
  const toldLiveAboutStage = await page
    .getByText(/sample shipped/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(toldLiveAboutStage, 'and it reaches the creator without a reload');

  // Money follows the stage, not the status.
  await admin.rpc('set_offer_stage', {
    p_actor_id: staff.id,
    p_application_id: asOffered.id,
    p_stage: 'paid',
    p_note: 'Sent this morning.',
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Waited for rather than slept on. The headline counts up, and a fixed pause
  // is a guess about how fast somebody else's machine is.
  const countedAsPaid = await page
    .getByText('$300')
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  const board = await page.evaluate(() => document.body.innerText);
  /*
   * Copy updated 2026-08-11. This asserted "paid to you so far", which the
   * creator home stopped saying when it was rebuilt from Rashid's approved
   * design, and the suite was not re-run against it, so it had been failing
   * quietly ever since. The money card now leads with "Agreed with you so far"
   * and splits it into Paid, Awaiting payment and In progress.
   *
   * Both halves are asserted on purpose: the figure alone would pass while the
   * money sat in the wrong bucket, and "money follows the STAGE, never the
   * status" is the rule this check exists to defend.
   */
  check(
    countedAsPaid && /agreed with you so far/i.test(board) && /\bpaid\b/i.test(board),
    'once it is marked paid the creator dashboard counts it as money received'
  );

  // A creator cannot move their own work along, however much they would like to.
  const selfAdvance = await asUser(page, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({
      action: 'application.stage',
      applicationId: asOffered.id,
      stage: 'paid',
    }),
  });
  check(
    selfAdvance.status === 403,
    `a creator cannot set their own stage (HTTP ${selfAdvance.status})`
  );

  // They can read their own history, and nobody else's.
  const ownEvents = await asUser(page, '/rest/v1/offer_stage_events?select=id,creator_id');
  check(
    rows(ownEvents).length > 0,
    `a creator can read their own pipeline history (${rows(ownEvents).length} rows)`
  );
  const rivalCtx2 = await browser.newContext();
  const rivalPage2 = await rivalCtx2.newPage();
  await signIn(rivalPage2, RIVAL_EMAIL);
  const otherEvents = await asUser(rivalPage2, '/rest/v1/offer_stage_events?select=id');
  check(
    rows(otherEvents).length === 0,
    `and another creator sees none of it (${rows(otherEvents).length} rows)`
  );
  await rivalCtx2.close();

  // A stage only exists on approved work.
  const stageOnPending = await admin.rpc('set_offer_stage', {
    p_actor_id: staff.id,
    p_application_id: openRequest.id,
    p_stage: 'paid',
  });
  check(
    Boolean(stageOnPending.error) && /only an approved request/i.test(stageOnPending.error.message),
    `a pending request has no stage to set (${stageOnPending.error?.message ?? 'it was allowed'})`
  );

  // Deciding twice is refused, whichever admin gets there second.
  const again = await asUser(adminPage, '/functions/v1/manage-offer-application', {
    method: 'POST',
    body: JSON.stringify({
      action: 'application.review',
      applicationId: asOffered.id,
      decision: 'rejected',
    }),
  });
  check(again.status === 409, `a second decision on the same request is refused (HTTP ${again.status})`);

  /* ------------------------------------------------------ [7] the refusal */
  console.log('\n[7] Rejecting, and asking again');
  // Back to the pending list explicitly. Section [6c] leaves this page filtered
  // to approved work, and a reload would keep that filter, hide the request
  // about to be rejected, and time out looking for a button that is not there.
  await adminPage.goto(`${BASE}/admin/offers/requests`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(2500);
  await rowFor('Name your price')
    .getByRole('button', { name: /^reject$/i })
    .first()
    .click();
  await adminPage.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 20000 });
  await adminPage.fill('textarea[name="note"]', 'Not at that price for now.');
  await adminPage.getByRole('button', { name: /yes, reject/i }).click();

  const rejected = await waitFor(
    async () =>
      (
        await admin
          .from('offer_applications')
          .select('id, status, decision_note')
          .eq('creator_id', creatorId)
          .eq('status', 'rejected')
          .maybeSingle()
      ).data,
    (r) => Boolean(r?.id),
    'the rejection to land'
  );
  check(Boolean(rejected), 'the other request is rejected');

  const afterRejection = await readBudget(brandId);
  check(
    Number(afterRejection?.budget_used) === 300,
    `rejecting somebody costs nothing (${afterRejection?.budget_used})`
  );

  // A rejection is not a ban. The partial unique index only covers pending and
  // approved rows, so they can come back with a different number.
  const reapply = await admin.rpc('apply_for_offer', {
    p_actor_id: creatorId,
    p_offer_id: openEnded.id,
    p_note: 'Trying again.',
  });
  check(!reapply.error, `a rejected creator can ask again (${reapply.error?.message ?? 'ok'})`);

  /* ------------------------------------------------- [7b] the dashboards */
  // Both sides gained a screen that crosses brands. Before these, seeing an
  // offer meant remembering which brand it belonged to and going in through
  // the hub.
  console.log('\n[7b] The two offer dashboards');

  await adminPage.goto(`${BASE}/admin/offers`, { waitUntil: 'domcontentloaded' });
  await adminPage.waitForTimeout(2500);
  check(
    (await adminPage.getByText('Fixed terms deal').count()) > 0,
    'the admin sees offers from every brand in one list'
  );
  check(
    (await adminPage.getByText(/open to everyone/i).count()) > 0,
    'an offer nobody has to apply for says so, rather than showing nobody on it'
  );

  // Searching narrows to one offer, and the brand filter to one brand.
  await adminPage.fill('input[name="search"]', 'Fixed terms');
  await adminPage.press('input[name="search"]', 'Enter');
  await adminPage.waitForTimeout(2000);
  check(
    (await adminPage.getByText('Already yours').count()) === 0,
    'searching drops the offers that do not match'
  );
  await adminPage.fill('input[name="search"]', '');
  await adminPage.press('input[name="search"]', 'Enter');
  await adminPage.waitForTimeout(1500);

  /*
   * `access`, not `kind`, since 2026-08-21. They were the same control until
   * offers gained a real kind — retainer, volume, high commission — and the
   * old "does a creator have to apply" filter had to give the word back. Two
   * dropdowns now, and this one is the access one.
   */
  await adminPage.selectOption('select[name="access"]', 'open');
  await adminPage.waitForTimeout(2000);
  check(
    (await adminPage.getByText('Fixed terms deal').count()) === 0 &&
      (await adminPage.getByText('Already yours').count()) > 0,
    'and filtering to open offers hides the ones that need applying for'
  );

  // And the new axis filters independently of it.
  await adminPage.selectOption('select[name="access"]', 'all');
  await adminPage.selectOption('select[name="kind"]', 'retainer');
  await adminPage.waitForTimeout(2000);
  check(
    (await adminPage.getByText('Fixed terms deal').count()) === 0,
    'filtering to retainers hides a volume offer'
  );
  await adminPage.selectOption('select[name="kind"]', 'volume');
  await adminPage.waitForTimeout(2000);
  check(
    (await adminPage.getByText('Fixed terms deal').count()) > 0,
    'and filtering to volume brings it back'
  );
  await adminPage.selectOption('select[name="kind"]', 'all');

  // The creator's own dashboard, with the approval from [6] on it.
  await page.goto(`${BASE}/app/offers`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  check(
    (await page.getByText('Fixed terms deal').count()) > 0,
    'the creator sees offers from every brand in one list'
  );
  /*
   * The offers screen shows the PIPELINE, not just "you are in".
   *
   * It used to say only that, while the dashboard for the same offer said
   * "paid". Two screens giving two answers about one offer is worse than
   * either answer being missing, and it is what Rashid found.
   *
   * By this point [6c] has walked this one all the way to paid.
   */
  check(
    (await page.getByText(/paid out/i).count()) > 0,
    'an approved offer shows where it has actually got to, not just "you are in"'
  );
  /*
   * Also updated 2026-08-11, and stale for the same reason. `StageTracker`
   * captions the current step as "7. Paid" rather than "7 of 7"; it has drawn
   * seven bars either way, and the point of the check is that the offer card
   * and the dashboard draw the SAME tracker rather than two pictures of one
   * pipeline.
   */
  check(
    (await page.getByText(/7\.\s*Paid/i).count()) > 0,
    'with the same seven step tracker the dashboard uses'
  );
  check(
    (await page.getByText('$300').count()) > 0,
    'and what it paid'
  );

  /*
   * THERE IS NO "you are in" TAB ANY MORE. THERE ARE NO TABS AT ALL.
   *
   * This line used to click a chip named "you are in". The Earn redesign of
   * 2026-10-16 renamed the chips to §8.2's four names, so it had been failing
   * on a locator rather than on a behaviour; the simplification pass later the
   * same day deleted the chip row outright, on Rashid's instruction to "ditch
   * the buttons where you can". The list is GROUPED by status instead, each
   * group headed and counted, so what this section tested — that an approved
   * offer is filed under the right status and a different offer is not — is
   * now true with nothing tapped at all.
   *
   * "You are in" is still asserted further up, where it belongs: it is the
   * sentence on an approved CARD, and sections [6] and [6c] wait on it.
   */
  check(
    (await page.getByRole('tab', { name: /you are in|not applied|^accepted/i }).count()) === 0,
    'the offers screen asks her to pick a status before showing her anything: it does not'
  );
  check(
    (await page.getByRole('heading', { name: /^accepted$/i }).count()) > 0,
    'an approved offer is filed under a heading she did not have to tap for'
  );

  /*
   * AND IT IS FILED UNDER THE RIGHT ONE.
   *
   * Read out of the DOM rather than off the whole page: every group is on
   * screen at once now, so `body.innerText` would contain every offer whatever
   * the grouping did. The section around the "Accepted" heading is the claim
   * being made.
   */
  const inOnly = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((el) =>
      el.textContent?.trim().toLowerCase().startsWith('accepted')
    );
    return heading?.closest('section')?.innerText ?? '';
  });
  check(
    inOnly.includes('Fixed terms deal') && !inOnly.includes('Name your price'),
    'and the Accepted group holds only those'
  );

  /*
   * A DECLINED APPLICATION IS STILL ON SCREEN, UNDER ITS OWN HEADING.
   *
   * Two reviewers reported that applying makes an offer vanish and that a
   * rejection is never shown. The first was never true of the data — row level
   * security keeps an offer readable forever once a request exists on it
   * (`offers_select_own_requests`) — but a declined row used to be filed under
   * "Not applied", the one name that contradicts it, while its own card said
   * "Not this time". Both now say Declined.
   *
   * This creator has nothing declined at this point in the run (section [8]
   * rejects `rivalPage`'s request, not hers), so what is asserted is the only
   * thing that must be true either way: an EMPTY status draws no heading, and
   * an approved offer is never filed under Declined.
   */
  const declinedOnly = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((el) =>
      el.textContent?.trim().toLowerCase().startsWith('declined')
    );
    return heading?.closest('section')?.innerText ?? '';
  });
  check(
    !declinedOnly.includes('Fixed terms deal'),
    'and an approved offer is never filed under Declined'
  );


  /*
   * THE SEARCH BOX APPEARS ONLY ABOVE EIGHT OFFERS (page plan, 2026-10-19: a
   * control shows only when it has something to act on). This suite seeds a
   * handful, so the box must be ABSENT here; the no-results sentence is
   * asserted only if some future seed grows past the threshold.
   */
  if ((await page.locator('input[name="search"]').count()) === 0) {
    check(true, 'a short list of offers draws no search box');
  } else {
    await page.fill('input[name="search"]', 'nothing matches this');
    await page.waitForTimeout(900);
    check(
      (await page.getByText(/nothing matches that/i).count()) > 0,
      'a search with no results says so rather than showing an empty page'
    );
  }

  // The brand hub is the third screen that can show the same offer, and all
  // three have to agree. Left until last on purpose: it navigates away, and
  // everything above still needs the offers screen underneath it.
  await page.goto(`${BASE}/app/brands/${brand.slug}?section=offers`, {
    waitUntil: 'domcontentloaded',
  });
  const hubAgrees = await page
    .getByText(/paid out/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(hubAgrees, 'and the brand hub says the same thing about the same offer');

  // The brand list carries the budget, and can be filtered by how much of it is
  // gone. 300 of 41,000 is under 1%, so this brand belongs in "under 50".
  await adminPage.goto(`${BASE}/admin/brands?q=${encodeURIComponent(BRAND_NAME)}`, {
    waitUntil: 'domcontentloaded',
  });
  await adminPage.waitForTimeout(2500);
  check(
    (await adminPage.getByText(/committed/i).count()) > 0,
    'the brand card shows how much of the budget is committed'
  );

  await adminPage.selectOption('select[name="budget"]', 'under50');
  await adminPage.waitForTimeout(2500);
  check(
    (await adminPage.getByText(BRAND_NAME).count()) > 0,
    'filtering to brands under 50% used keeps this one'
  );

  await adminPage.selectOption('select[name="budget"]', 'over80');
  await adminPage.waitForTimeout(2500);
  check(
    (await adminPage.getByText(BRAND_NAME).count()) === 0,
    'and filtering to over 80% used drops it, in the database rather than the browser'
  );

  /* -------------------------------------------- [8] offers people rely on */
  console.log('\n[8] An offer somebody is waiting on');
  const blocked = await admin.rpc('delete_offer', {
    p_actor_id: staff.id,
    p_offer_id: fixed.id,
  });
  check(
    Boolean(blocked.error) && /waiting on this offer/i.test(blocked.error?.message ?? ''),
    `deleting an offer with a live request is refused (${blocked.error?.message ?? 'it was allowed'})`
  );

  /* -------------------------------------------------------- [9] console -- */
  console.log('\n[9] Console');
  // This suite provokes refusals on purpose: a creator reviewing, a duplicate
  // request, an offer that needed no application. The browser logs each as a
  // failed request, and counting them would mean failing because the security
  // worked.
  const expected = /Failed to load resource.*(400|401|403|404|409)/i;
  const real = consoleErrors.filter((e) => !expected.test(e));
  check(real.length === 0, `no unexpected console errors (${real.length})`);
  real.slice(0, 3).forEach((e) => console.error(`        ${e}`));
  console.log(
    `        (${consoleErrors.length - real.length} deliberate refusals logged by the browser, ignored)`
  );

  await adminCtx.close();
  await ctx.close();
} catch (e) {
  fail(`unexpected error: ${e.message}`);
  console.error(e.stack);
} finally {
  await browser.close();

  for (const id of [brandId, otherBrandId].filter(Boolean)) {
    const { data: offerIds } = await admin.from('offers').select('id').eq('brand_id', id);
    const { data: requestIds } = await admin
      .from('offer_applications')
      .select('id')
      .eq('brand_id', id);
    for (const r of requestIds ?? []) {
      await admin.from('audit_log').delete().eq('subject_id', r.id);
    }
    // Requests cascade with the offer, but the audit rows above do not.
    await admin.from('offer_applications').delete().eq('brand_id', id);
    for (const o of offerIds ?? []) {
      await admin.from('audit_log').delete().eq('subject_id', o.id);
    }
    await admin.from('audit_log').delete().eq('subject_id', id);
    await admin.from('brands').delete().eq('id', id);
  }
  for (const id of made) {
    await admin.from('audit_log').delete().eq('actor_id', id);
    await admin.from('audit_log').delete().eq('target_user_id', id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) fail(`could not delete a test account: ${error.message}`);
  }
  console.log('\n[cleanup] test brand, offers, requests, audit rows and accounts removed');
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('Creators can ask, staff can decide, and nobody can do it for them.\n');
