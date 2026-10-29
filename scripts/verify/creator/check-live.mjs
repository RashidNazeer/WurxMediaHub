/**
 * The real chain, both ends through the real UI.
 *
 * An admin changes a stage on the request queue. A creator, already looking at
 * their own screens in another browser, must see it move with no reload. This
 * is the product's central promise, and it is the one thing no suite has ever
 * driven from the admin SCREEN rather than from the database.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(env.VITE_SUPABASE_URL, 'check-live.mjs');
const admin = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const BASE = process.argv[2] ?? 'http://localhost:4173';
const PASSWORD = 'live-suite-dev-only-1';
const CREATOR = 'live-creator@wurxmediahub.test';
const STAFF = 'live-staff@wurxmediahub.test';
const made = [];
let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  failures++;
};

/**
 * One call, retried.
 *
 * This machine's link to Supabase drops a connection every so often and
 * surfaces it as `AuthRetryableFetchError: fetch failed`, which killed three
 * runs of this suite at three different points. A live-update test that reports
 * a product failure because a packet went missing is worse than a slow one.
 */
async function retry(label, fn, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = /fetch failed|timeout|ECONN|socket/i.test(String(err?.message ?? err));
      if (!transient || attempt >= tries) throw new Error(`${label}: ${err?.message ?? err}`);
      console.log(`  ..    ${label} dropped, retry ${attempt}/${tries - 1}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function makeUser(email, patch) {
  const { data, error } = await retry(`create ${email}`, () =>
    admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  );
  if (error) throw error;
  made.push(data.user.id);
  await admin.from('profiles').update(patch).eq('id', data.user.id);
  return data.user.id;
}

async function signIn(page, email, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForTimeout(2500);
}

try {
  const now = new Date().toISOString();
  const creatorId = await makeUser(CREATOR, {
    role: 'creator',
    tier: 'rising',
    display_name: 'Live Probe',
    is_active: true,
    welcomed_at: now,
    approval_celebrated_at: now,
  });
  await makeUser(STAFF, { role: 'admin', display_name: 'Live Staff', is_active: true });
  await admin.from('applications').insert({
    user_id: creatorId,
    tiktok_handle: 'liveprobe',
    niche: 'Beauty & skincare',
    worked_with_wurx: false,
    video_links: 'https://www.tiktok.com/@example/video/1',
    status: 'approved',
    reviewed_at: now,
  });

  const { data: offers } = await admin
    .from('offers')
    .select('id, brand_id, title, video_count, currency, brands!inner(slug)')
    .eq('status', 'active')
    // Deterministic, and one that needs applying for: picking any active offer
    // meant a different one each run and a suite that changed its answer.
    .eq('needs_application', true)
    .order('created_at', { ascending: true })
    .limit(1);
  if (!offers?.length) throw new Error('no active offers on dev');
  const offer = offers[0];
  const slug = offer.brands.slug;

  const { data: row, error: insErr } = await admin
    .from('offer_applications')
    .insert({
      offer_id: offer.id,
      brand_id: offer.brand_id,
      creator_id: creatorId,
      creator_handle: 'liveprobe',
      creator_name: 'Live Probe',
      creator_email: CREATOR,
      status: 'approved',
      stage: 'sample_requested',
      committed_amount: 250,
      // Snapshotted like the real approval does. A job with no agreed count
      // can never report progress, so leaving it null would draw an empty bar.
      committed_video_count: offer.video_count ?? null,
      currency: offer.currency ?? 'USD',
    })
    .select('id')
    .single();
  if (insErr) throw insErr;
  await admin.from('offer_stage_events').insert({
    application_id: row.id,
    creator_id: creatorId,
    from_stage: null,
    to_stage: 'sample_requested',
  });

  const browser = await launchBrowser();

  // Three creator screens, all open at once, all supposed to agree.
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const home = await cctx.newPage();
  home.on('pageerror', (e) => errors.push(String(e)));
  await signIn(home, CREATOR, '/login');
  await home.goto(BASE + '/app?view=pipeline', { waitUntil: 'domcontentloaded' });
  await home
    .locator('main')
    .getByText('Sample requested')
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => {});

  const offersPage = await cctx.newPage();
  offersPage.on('pageerror', (e) => errors.push(String(e)));
  await offersPage.goto(BASE + '/app/offers', { waitUntil: 'domcontentloaded' });
  await offersPage
    .locator('main')
    .getByText('Sample requested')
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => {});

  const hub = await cctx.newPage();
  hub.on('pageerror', (e) => errors.push(String(e)));
  await hub.goto(`${BASE}/app/brands/${slug}?section=offers`, {
    waitUntil: 'domcontentloaded',
  });
  await hub
    .locator('main')
    .getByText('Sample requested')
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => {});

  for (const [name, page] of [
    ['home (pipeline)', home],
    ['offers', offersPage],
    ['brand hub', hub],
  ]) {
    const seen = await page
      .locator('main')
      .getByText('Sample requested')
      .first()
      .isVisible()
      .catch(() => false);
    if (seen) ok(`${name} shows the starting stage`);
    else bad(`${name} never showed the starting stage`);
  }

  // The admin moves it, through the real screen, in another browser context.
  const actx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const staff = await actx.newPage();
  staff.on('pageerror', (e) => errors.push(String(e)));
  await signIn(staff, STAFF, '/admin/login');
  await staff.goto(BASE + '/admin/offers/requests?status=approved&q=liveprobe', {
    waitUntil: 'domcontentloaded',
  });
  const select = staff.locator(`#stage-${row.id}`);
  const found = await select
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (found) ok('the admin queue offers a stage control for this request');
  else bad('the admin queue never showed a stage control for this request');

  if (found) {
    await select.selectOption('sample_shipped');
    console.log('  ..    admin set the stage to "Sample shipped" on the real screen');

    for (const [name, page] of [
      ['home (pipeline)', home],
      ['offers', offersPage],
      ['brand hub', hub],
    ]) {
      const arrived = await page
        .locator('main')
        .getByText('Sample shipped')
        .first()
        .waitFor({ timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (arrived) ok(`${name} updated LIVE, no reload`);
      else bad(`${name} did NOT update live`);
    }

    // And the money has to follow the stage, not just the label.
    await select.selectOption('paid');
    const paid = await home
      .locator('main')
      .getByText('the money has landed')
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (paid) ok('moving to Paid moved the money on the board, live');
    else bad('the board did not follow the money to Paid');
  }

  /*
   * The catalogue, which is the half that was never live.
   *
   * A creator's own work moving is one thing. An admin renaming the offer they
   * are reading is another, and until 2026-08-11 that one sat stale behind a
   * 30 second staleTime with nothing subscribed to it.
   */
  const renamed = `Renamed live ${row.id.slice(0, 8)}`;
  await admin.from('offers').update({ title: renamed }).eq('id', offer.id);
  for (const [name, page] of [
    ['offers', offersPage],
    ['brand hub', hub],
  ]) {
    const arrived = await page
      .locator('main')
      .getByText(renamed)
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (arrived) ok(`${name} picked up an offer rename LIVE`);
    else bad(`${name} did NOT pick up an offer rename`);
  }

  // Products, which were not even in the realtime publication until today.
  const productName = `Live product ${row.id.slice(0, 8)}`;
  const { error: prodErr } = await admin.from('brand_products').insert({
    brand_id: offer.brand_id,
    name: productName,
    external_product_id: 'live-probe-' + row.id.slice(0, 8),
    commission_rate: 21,
  });
  if (prodErr) {
    bad(`could not add a product to test with: ${prodErr.message}`);
  } else {
    await hub.goto(`${BASE}/app/brands/${slug}`, { waitUntil: 'domcontentloaded' });
    await hub
      .locator('main')
      .getByText('Products')
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => {});
    // Wait for the new product to be on screen before editing it, or the edit
    // races the first read and nothing appears to have changed.
    await hub
      .locator('main')
      .getByText(productName)
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => {});
    const { error: p2 } = await admin
      .from('brand_products')
      .update({ name: `${productName} (edited)` })
      .eq('name', productName);
    if (p2) bad(`could not edit the product: ${p2.message}`);
    const arrived = await hub
      .locator('main')
      .getByText(`${productName} (edited)`)
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (arrived) ok('brand hub picked up a product edit LIVE');
    else bad('brand hub did NOT pick up a product edit');
    await admin.from('brand_products').delete().like('name', 'Live product %');
  }
  await admin.from('offers').update({ title: offer.title }).eq('id', offer.id);

  if (errors.length) bad(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  else ok('no page errors on any screen');

  await actx.close();
  await cctx.close();
  await browser.close();
} finally {
  for (const uid of made) {
    await admin.from('audit_log').delete().eq('actor_id', uid);
    await admin.auth.admin.deleteUser(uid);
  }
  console.log('\ncleaned up');
}
console.log(failures ? `\n${failures} FAILED` : '\nall good');

/*
 * AND EXIT NON-ZERO WHEN IT FAILED, which this suite did not do until
 * 2026-08-14. It printed "3 FAILED" and returned success, so anything reading
 * the exit code, which is every CI runner and now `verify:all`, would have
 * called a broken realtime chain green. The line above is for a human reading
 * the terminal; this one is for everything else.
 */
process.exit(failures === 0 ? 0 : 1);
