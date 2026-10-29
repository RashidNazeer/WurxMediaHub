#!/usr/bin/env node
/**
 * End to end test of the admin review pipeline.
 *
 * This is the step where the product starts changing people's accounts, so the
 * suite is built around one idea: an error message is not proof. Every time
 * something is supposed to be blocked, the row is read back afterwards to
 * confirm nothing moved.
 *
 * It creates throwaway accounts, drives the real browser, attacks the API as a
 * signed-in applicant, then deletes everything it made. Run against DEV only.
 *
 * Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... SUPABASE_SERVICE_KEY=...
 *   node scripts/check-review.mjs [baseUrl]
 */

import { launchBrowser } from './browser.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from './lib/dev-guard.mjs';

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
assertDevProject(URL_BASE, 'check-review.mjs');
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

const stamp = process.env.RUN_STAMP ?? String(Date.now()).slice(-7);
const PASSWORD = 'a-long-enough-test-password-1';

const PEOPLE = [
  { key: 'known', handle: `wurxrev${stamp}known`, worked: true },
  { key: 'fresh', handle: `wurxrev${stamp}fresh`, worked: false },
  // Three more, only ever touched by the bulk step. Deliberately not "known",
  // so they cannot disturb the fast-track filter assertions above.
  { key: 'bulk1', handle: `wurxrev${stamp}bulka`, worked: false, bulk: true },
  { key: 'bulk2', handle: `wurxrev${stamp}bulkb`, worked: false, bulk: true },
  { key: 'bulk3', handle: `wurxrev${stamp}bulkc`, worked: false, bulk: true },
];

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));

const made = [];
const appIds = [];
const browser = await launchBrowser();

/** Sign in through the real login screen, the way a person would. */
async function signIn(ctx, email, password, expectPath, door = '/login') {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}${door}`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(`**${expectPath}`, { timeout: 25000 }).catch(() => {});
  return { page, errors };
}

/**
 * Poll until the database says what we are waiting for, or give up.
 *
 * Not a fixed sleep. A cold Edge Function has to boot Deno and pull its
 * dependencies on the first call after a deploy, which can take several
 * seconds, and a test that assumes a duration reports a product bug that is not
 * there. Waiting for the outcome is both faster in the normal case and honest
 * in the slow one.
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

/** Fire a request from inside the browser, carrying that user's real token. */
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
      return { status: res.status, body: (await res.text()).slice(0, 300) };
    },
    { url: URL_BASE, key: ANON, path, init: init ?? {} }
  );

try {
  console.log(`\nAdmin review pipeline against ${BASE}\n${'='.repeat(70)}`);

  /* ------------------------------------------------------------ [0] setup */
  console.log('\n[0] Seed two applicants');
  for (const p of PEOPLE) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `${p.handle}@wurxmediahub.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: p.handle },
    });
    if (error) throw new Error(`could not create ${p.handle}: ${error.message}`);
    p.userId = data.user.id;
    made.push(data.user.id);

    const { data: app, error: appErr } = await admin
      .from('applications')
      .insert({
        user_id: p.userId,
        tiktok_handle: p.handle,
        niche: 'Beauty & skincare',
        worked_with_wurx: p.worked,
        video_links: `https://www.tiktok.com/@${p.handle}/video/7300000000000000000`,
      })
      .select('id')
      .single();
    if (appErr) throw new Error(`could not seed application: ${appErr.message}`);
    p.applicationId = app.id;
    appIds.push(app.id);
  }
  pass(`two applicants seeded (${PEOPLE.map((p) => p.handle).join(', ')})`);

  /* ------------------------------------------------- [1] the staff door -- */
  console.log('\n[1] The staff door');
  const doorCtx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const doorPage = await doorCtx.newPage();

  // A bookmarked admin link, opened signed out, should offer the staff screen
  // rather than a page inviting you to apply.
  await doorPage.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await doorPage.waitForTimeout(1500);
  check(
    new global.URL(doorPage.url()).pathname === '/admin/login',
    `signed out, /admin offers the staff door (got ${new global.URL(doorPage.url()).pathname})`
  );
  check(
    (await doorPage.getByText(/staff access/i).count()) > 0,
    'the staff screen says it is for staff'
  );
  check(
    (await doorPage.getByRole('link', { name: /apply|sign up|join/i }).count()) === 0,
    'it offers no way to sign up, because staff accounts are never self-serve'
  );
  await doorCtx.close();

  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const { page: adminPage, errors: adminErrors } = await signIn(
    adminCtx,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    '/admin',
    '/admin/login'
  );
  console.log('\n[1b] The dashboard, then the queue');
  check(
    new global.URL(adminPage.url()).pathname === '/admin',
    `signing in lands on the dashboard (got ${new global.URL(adminPage.url()).pathname})`
  );
  await adminPage.waitForTimeout(2500);
  /*
   * Copy updated 2026-08-11. The home stopped being about one queue: it now
   * counts applications, offer requests and videos, and will not say the day is
   * clear until all three are empty. The tile is labelled "Applications" rather
   * than "Awaiting review", and what this check is really defending is
   * unchanged: the counts live here so the queue can open straight onto a list.
   */
  check(
    (await adminPage.getByText(/people asking to join/i).count()) > 0,
    'the dashboard carries the counts, so the queue does not have to'
  );
  /*
   * THE OTHER TWO TILES, not the sentence that used to sit above them.
   *
   * This read /waiting on you|are all clear/ until 2026-08-16, when the greeting
   * and the line under it went the way of every other description row in the
   * admin panel. Both halves of that regex were in the deleted sentence, so it
   * could no longer match anything.
   *
   * What it was defending is unchanged and is now asserted directly rather than
   * through prose: the home counts offer requests and videos as well as
   * applications, so it cannot call the day clear on one queue's strength. These
   * are the two other tiles' own hint lines, scoped to <main> because the rail
   * carries links of nearly the same name.
   */
  const otherInboxes = await Promise.all([
    adminPage.locator('main').getByText(/creators asking for a deal/i).count(),
    adminPage.locator('main').getByText(/work waiting on a decision/i).count(),
  ]);
  check(
    otherInboxes.every((n) => n > 0),
    `and it counts all three inboxes, not just applications (${otherInboxes.join(', ')})`
  );

  await adminPage.getByRole('link', { name: /^applications$/i }).first().click();
  await adminPage.waitForURL('**/admin/applications', { timeout: 20000 }).catch(() => {});
  check(
    new global.URL(adminPage.url()).pathname === '/admin/applications',
    `the sidebar reaches the queue (got ${new global.URL(adminPage.url()).pathname})`
  );

  const rowLink = (handle) =>
    adminPage.locator(`a[aria-label="Open the application from @${handle}"]`);

  await adminPage.waitForSelector('a[href^="/admin/applications/"]', { timeout: 20000 });
  check(await rowLink(PEOPLE[0].handle).first().isVisible(), 'the seeded applicant appears in the queue');
  check(await rowLink(PEOPLE[1].handle).first().isVisible(), 'the second applicant appears too');
  /*
   * SCOPED TO <main>, which is the rule this suite already follows elsewhere
   * and this line did not.
   *
   * The sidebar prints the signed-in admin's own email, and OPERATIONS says to
   * run these suites as a throwaway `@wurxmediahub.test` account rather than
   * as Rashid. So an unscoped search finds the RUNNER'S email in the rail and
   * reports that the queue is leaking applicants' addresses, which it is not.
   */
  check(
    (await adminPage.locator('main').getByText(/@wurxmediahub\.test/i).count()) === 0,
    'rows show the handle only, not the email, so they stay compact'
  );

  /* ----------------------------------------------------------- [2] filters */
  console.log('\n[2] Filters and search');
  /*
   * NARROW TO THIS RUN'S OWN APPLICANTS FIRST, and this is the fix for a real
   * failure rather than tidiness.
   *
   * These two assertions used to filter the WHOLE QUEUE and then expect this
   * run's two applicants to be visible in it. That held only while dev's queue
   * was small enough to fit on one page. On 2026-08-15 seven demo applications
   * went back on dev (verify:responsive needs the account they come with), the
   * filtered list paged, this suite's own rows fell off page one, and it
   * reported a working filter as broken.
   *
   * A suite must not assume it owns the database it runs against. Every handle
   * here shares the run stamp, so searching for that prefix puts this run's
   * applicants, and nobody else's, in view. The filter assertion underneath is
   * then about the FILTER, which is what it was always meant to be about.
   */
  await adminPage.fill('input[name="search"]', `wurxrev${stamp}`);
  await adminPage.press('input[name="search"]', 'Enter');
  await rowLink(PEOPLE[1].handle).first().waitFor({ timeout: 20_000 });

  await adminPage.getByRole('button', { name: /worked with wurx/i }).click();
  // Wait for the row that must GO, rather than for a guessed number of
  // milliseconds. Fixed sleeps before a DOM assertion are the most common flake
  // in this repo.
  await rowLink(PEOPLE[1].handle)
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {});
  check(
    (await rowLink(PEOPLE[0].handle).count()) === 1 &&
      (await rowLink(PEOPLE[1].handle).count()) === 0,
    'the "worked with Wurx" filter narrows to people we already know'
  );

  await adminPage.getByRole('button', { name: /worked with wurx/i }).click();
  await rowLink(PEOPLE[1].handle).first().waitFor({ timeout: 20_000 });

  await adminPage.fill('input[name="search"]', PEOPLE[1].handle);
  await adminPage.press('input[name="search"]', 'Enter');
  await rowLink(PEOPLE[0].handle)
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {});
  check(
    (await rowLink(PEOPLE[1].handle).count()) === 1 &&
      (await rowLink(PEOPLE[0].handle).count()) === 0,
    'search by handle finds exactly one'
  );
  check(
    adminPage.url().includes(`q=${PEOPLE[1].handle}`),
    'filters live in the URL, so the view is shareable'
  );

  /* ------------------------------- [3] the applicant is watching, live ---- */
  console.log('\n[3] The applicant sits on their dashboard while this happens');
  const applicantCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const { page: applicantPage, errors: applicantErrors } = await signIn(
    applicantCtx,
    `${PEOPLE[0].handle}@wurxmediahub.test`,
    PASSWORD,
    '/app'
  );
  // Clear the one-time welcome first, the way a real creator does.
  const hello = applicantPage.getByRole('button', { name: /let.s go/i });
  if (
    await hello
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await hello.first().click();
  }
  await applicantPage.waitForTimeout(1500);
  check(
    (await applicantPage.getByText(/thank you for joining/i).count()) > 0,
    'they are currently waiting on a decision'
  );

  /* ------------------------------------------------------- [4] approve --- */
  console.log('\n[4] Approve');
  await adminPage.goto(`${BASE}/admin/applications/${PEOPLE[0].applicationId}`, {
    waitUntil: 'networkidle',
  });
  await adminPage.waitForTimeout(1200);
  check(
    (await adminPage.getByRole('heading', { name: `@${PEOPLE[0].handle}` }).count()) > 0,
    'the detail screen shows the right application'
  );
  check(
    (await adminPage.getByText(/worked with wurx/i).count()) > 0,
    'it flags that Wurx has worked with them before'
  );

  await adminPage.getByRole('button', { name: /^approve$/i }).click();
  await adminPage.waitForTimeout(600);
  check(
    (await adminPage.getByRole('dialog').count()) > 0,
    'a confirmation step stands between a click and a real account change'
  );
  await adminPage.selectOption('select[name="tier"]', 'pro');
  await adminPage.fill('textarea[name="note"]', 'Great skincare content, welcome in.');
  await adminPage.getByRole('button', { name: /yes, approve/i }).click();

  const approved = await waitFor(
    async () =>
      (
        await admin
          .from('applications')
          .select('status, reviewed_by, reviewed_at, review_note')
          .eq('id', PEOPLE[0].applicationId)
          .single()
      ).data,
    (r) => r?.status === 'approved',
    'the approval to land'
  );
  check(approved?.status === 'approved', `application is approved (got ${approved?.status})`);
  check(Boolean(approved?.reviewed_by), 'the reviewer was recorded');
  check(Boolean(approved?.reviewed_at), 'the review time was recorded');
  check(
    approved?.review_note === 'Great skincare content, welcome in.',
    'the note was stored'
  );

  const { data: promoted } = await admin
    .from('profiles')
    .select('role, tier')
    .eq('id', PEOPLE[0].userId)
    .single();
  check(promoted?.role === 'creator', `they are now a creator (got ${promoted?.role})`);
  check(promoted?.tier === 'pro', `their tier is pro (got ${promoted?.tier})`);

  // No wait needed: the audit row is written inside the same transaction as the
  // two updates above, so if the status moved this row exists. That is the
  // whole point of doing it in one function rather than three REST calls.
  const { data: logRows } = await admin
    .from('audit_log')
    .select('action, actor_email, target_user_id, detail')
    .eq('subject_id', PEOPLE[0].applicationId);
  const approvalLog = (logRows ?? []).find((r) => r.action === 'application.approved');
  check(Boolean(approvalLog), 'an audit row was written');
  check(approvalLog?.actor_email === ADMIN_EMAIL, `the audit row names the admin (got ${approvalLog?.actor_email})`);
  check(approvalLog?.detail?.tier === 'pro', 'the audit row records the tier granted');

  /* ------------------------------------ [5] the applicant's screen moved -- */
  console.log('\n[5] The applicant sees it without touching anything');
  // The congratulations arrives on its own, while they are sitting there. This
  // is the moment the whole product is selling, so it is worth asserting hard.
  const sawIt = await applicantPage
    .getByText(/you are in/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check(sawIt, 'they are congratulated live, with no refresh');
  check(
    (await applicantPage.getByText(/pro tier/i).count()) > 0,
    'the tier they were given is named'
  );
  check(
    (await applicantPage.getByText(/great skincare content/i).count()) > 0,
    'the reviewer note reached them'
  );

  await applicantPage.getByRole('button', { name: /see my hub/i }).click();
  /*
   * WAITED FOR, not slept on. What they land on is the first-day screen, which is a
   * LAZILY LOADED chunk on purpose (it drags the apply dialog and the whole Zod
   * schema chunk behind it), so a fixed two second pause is a guess about how
   * fast somebody else's machine is on the day.
   */
  await applicantPage
    .locator('main')
    .getByText(/welcome|nothing taken yet|agreed with you so far/i)
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .catch(() => {});
  /*
   * And then a short settle, which the fixed sleep here used to provide by
   * accident. Dismissing the moment closes it LOCALLY first and writes
   * `approval_celebrated_at` behind that, deliberately, so a network blip
   * cannot nag somebody with a celebration they already dismissed. The checks
   * below read that column, so they have to let the write land.
   */
  await applicantPage.waitForTimeout(1500);
  /*
   * Copy fixed 2026-08-11. This asserted the literal text "welcome to wurx",
   * which nothing renders: `WelcomeMoment` puts that string in the overlay's
   * `aria-label`, and `getByText` matches text nodes, not labels. Its visible
   * heading is "Welcome, <name>".
   *
   * Third stale assertion found today, all the same shape: a suite that checks
   * CREATOR copy from inside an admin flow, left behind when the creator home
   * was rebuilt. OPERATIONS now says a redesign re-runs every suite that
   * asserts copy, not just the obvious ones.
   *
   * The alternation is deliberate: dismissing the approval leaves them either
   * on the welcome moment or on the hub itself, depending on whether they had
   * ever opened it before, and both are correct outcomes of this click.
   */
  check(
    (await applicantPage
      .locator('main')
      .getByText(/welcome|nothing taken yet|agreed with you so far/i)
      .count()) > 0,
    'dismissing it leaves them on their creator home'
  );

  // The whole point of recording this in the database: it must never come back.
  await applicantPage.reload({ waitUntil: 'networkidle' });
  await applicantPage.waitForTimeout(2500);
  check(
    (await applicantPage.getByText(/you are in/i).count()) === 0,
    'and it does not fire again on reload'
  );

  const { data: celebrated } = await admin
    .from('profiles')
    .select('approval_celebrated_at, welcomed_at')
    .eq('id', PEOPLE[0].userId)
    .single();
  check(
    Boolean(celebrated?.approval_celebrated_at),
    'the moment was recorded against the account, not the browser'
  );

  /* ---------------------------------------------------------- [6] reject -- */
  console.log('\n[6] Reject');
  await adminPage.goto(`${BASE}/admin/applications/${PEOPLE[1].applicationId}`, {
    waitUntil: 'networkidle',
  });
  await adminPage.waitForTimeout(1000);
  await adminPage.getByRole('button', { name: /^reject$/i }).click();
  await adminPage.waitForTimeout(700);
  await adminPage.getByRole('button', { name: /yes, reject/i }).click();

  const rejected = await waitFor(
    async () =>
      (
        await admin
          .from('applications')
          .select('status')
          .eq('id', PEOPLE[1].applicationId)
          .single()
      ).data,
    (r) => r?.status === 'rejected',
    'the rejection to land'
  );
  check(rejected?.status === 'rejected', `application is rejected (got ${rejected?.status})`);

  const { data: stillApplicant } = await admin
    .from('profiles')
    .select('role, tier')
    .eq('id', PEOPLE[1].userId)
    .single();
  /* ------------------------------------------------- [6b] the row menu ---- */
  console.log('\n[6b] The row menu and bulk review');
  await adminPage.goto(`${BASE}/admin/applications?q=${stamp}bulk`, {
    waitUntil: 'networkidle',
  });
  await adminPage.waitForSelector('a[href^="/admin/applications/"]', { timeout: 20000 });

  const bulk = PEOPLE.filter((p) => p.bulk);
  check(
    (await adminPage.locator('a[href^="/admin/applications/"]').count()) === bulk.length,
    `the search narrowed to the ${bulk.length} bulk applicants`
  );

  // The menu replaces the "pending" badge, so the row offers actions instead of
  // just telling you a status you already filtered by.
  await adminPage
    .getByRole('button', { name: new RegExp(`actions for @${bulk[0].handle}`, 'i') })
    .first()
    .click();
  await adminPage.waitForTimeout(500);
  const tiktokLink = adminPage.getByRole('menuitem', { name: /view tiktok profile/i });
  check((await tiktokLink.count()) > 0, 'the row menu offers their TikTok profile');
  check(
    (await tiktokLink.first().getAttribute('href')) ===
      `https://www.tiktok.com/@${bulk[0].handle}`,
    'and it points at the right profile'
  );
  check(
    (await adminPage.getByRole('menuitem', { name: /^approve$/i }).count()) > 0 &&
      (await adminPage.getByRole('menuitem', { name: /^reject$/i }).count()) > 0,
    'the row menu can approve and reject without opening the application'
  );
  await adminPage.keyboard.press('Escape');
  await adminPage.waitForTimeout(300);

  // Select all pending on the page, then approve the lot in one go.
  await adminPage
    .getByRole('checkbox', { name: /select every pending application/i })
    .first()
    .check();
  await adminPage.waitForTimeout(400);
  check(
    (await adminPage.getByText(new RegExp(`${bulk.length} selected`, 'i')).count()) > 0,
    `selecting all ticks ${bulk.length} of them`
  );

  await adminPage.getByRole('button', { name: /^approve$/i }).first().click();
  await adminPage.waitForTimeout(700);
  check(
    (await adminPage.getByRole('dialog').count()) > 0,
    'bulk approval asks for confirmation too'
  );
  await adminPage.selectOption('select[name="tier"]', 'rising');
  await adminPage.getByRole('button', { name: /yes, approve all/i }).click();

  const bulkDone = await waitFor(
    async () =>
      (
        await admin
          .from('applications')
          .select('id, status')
          .in(
            'id',
            bulk.map((p) => p.applicationId)
          )
      ).data,
    (rows) => Array.isArray(rows) && rows.every((r) => r.status === 'approved'),
    'the bulk approval to land'
  );
  check(
    Array.isArray(bulkDone) && bulkDone.every((r) => r.status === 'approved'),
    `all ${bulk.length} were approved in one action`
  );

  const { data: bulkProfiles } = await admin
    .from('profiles')
    .select('role, tier')
    .in(
      'id',
      bulk.map((p) => p.userId)
    );
  check(
    (bulkProfiles ?? []).every((p) => p.role === 'creator' && p.tier === 'rising'),
    'each of them became a creator on the tier that was chosen'
  );

  // Each application is its own transaction with its own audit row, so a batch
  // must never collapse into a single log entry.
  const { data: bulkLog } = await admin
    .from('audit_log')
    .select('id, action')
    .in(
      'subject_id',
      bulk.map((p) => p.applicationId)
    );
  check(
    (bulkLog ?? []).filter((r) => r.action === 'application.approved').length === bulk.length,
    `the audit log has one row per person, not one for the batch (${(bulkLog ?? []).length})`
  );

  check(
    stillApplicant?.role === 'applicant' && stillApplicant?.tier === null,
    'a rejection does not touch their role or tier'
  );

  // Snapshot before the attacks: they deliberately provoke 4xx responses, which
  // the browser logs as console errors. Counting those would mean this suite
  // fails precisely because the security worked.
  const adminErrorsBefore = adminErrors.length;
  const applicantErrorsBefore = applicantErrors.length;

  /* --------------------------------------------------------- [7] attacks -- */
  console.log('\n[7] Attacks, run as a real signed-in applicant');
  const victim = PEOPLE[1];
  const { page: attackPage } = await signIn(
    await browser.newContext(),
    `${victim.handle}@wurxmediahub.test`,
    PASSWORD,
    '/app'
  );
  await attackPage.waitForTimeout(1500);

  // a. Call the Edge Function and approve yourself.
  const selfApprove = await asUser(attackPage, '/functions/v1/review-application', {
    method: 'POST',
    body: JSON.stringify({
      applicationId: victim.applicationId,
      decision: 'approved',
      tier: 'elite',
    }),
  });
  check(selfApprove.status === 403, `self-approval through the Edge Function refused (HTTP ${selfApprove.status})`);

  const { data: afterSelf } = await admin
    .from('profiles')
    .select('role, tier')
    .eq('id', victim.userId)
    .single();
  check(
    afterSelf?.role === 'applicant' && afterSelf?.tier === null,
    'and they really are still an applicant afterwards'
  );

  // b. That attempt should be in the log, with their name on it.
  const { data: denied } = await admin
    .from('audit_log')
    .select('action, actor_email')
    .eq('action', 'application.review_denied')
    .eq('actor_id', victim.userId);
  check((denied ?? []).length > 0, 'the blocked attempt was recorded in the audit log');

  // c. Read everyone else's applications.
  const readAll = await asUser(
    attackPage,
    '/rest/v1/applications?select=id,tiktok_handle,status'
  );
  let visible = [];
  try {
    visible = JSON.parse(readAll.body);
  } catch {
    visible = [];
  }
  check(
    Array.isArray(visible) && visible.length === 1 && visible[0]?.id === victim.applicationId,
    `an applicant sees only their own application (${Array.isArray(visible) ? visible.length : '?'} rows)`
  );

  // d. Read the audit log.
  const readLog = await asUser(attackPage, '/rest/v1/audit_log?select=id,action');
  let logVisible = [];
  try {
    logVisible = JSON.parse(readLog.body);
  } catch {
    logVisible = [];
  }
  check(
    Array.isArray(logVisible) && logVisible.length === 0,
    `the audit log is invisible to a non-staff account (${Array.isArray(logVisible) ? logVisible.length : '?'} rows)`
  );

  // e. Write to the audit log, to cover their tracks.
  const forgeLog = await asUser(attackPage, '/rest/v1/audit_log', {
    method: 'POST',
    body: JSON.stringify({ action: 'application.approved', subject_type: 'application' }),
  });
  check(forgeLog.status >= 400, `the audit log cannot be written from a browser (HTTP ${forgeLog.status})`);

  // f. Call the database function directly, skipping the Edge Function.
  const directRpc = await asUser(attackPage, '/rest/v1/rpc/review_application', {
    method: 'POST',
    body: JSON.stringify({
      p_application_id: victim.applicationId,
      p_decision: 'approved',
      p_actor_id: victim.userId,
      p_tier: 'elite',
    }),
  });
  check(
    directRpc.status >= 400,
    `the review function is not reachable with a user token (HTTP ${directRpc.status})`
  );

  // g. No token at all.
  const anonCall = await fetch(`${URL_BASE}/functions/v1/review-application`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId: victim.applicationId, decision: 'approved', tier: 'elite' }),
  });
  check(anonCall.status === 401, `an anonymous call is rejected (HTTP ${anonCall.status})`);

  /* ------------------------------------------- [8] no double decisions ---- */
  console.log('\n[8] The same application cannot be decided twice');
  const again = await asUser(adminPage, '/functions/v1/review-application', {
    method: 'POST',
    body: JSON.stringify({
      applicationId: PEOPLE[0].applicationId,
      decision: 'rejected',
    }),
  });
  check(again.status === 409, `a second decision is refused (HTTP ${again.status})`);
  check(/already reviewed/i.test(again.body), 'and it says why, in plain English');

  const { data: unchanged } = await admin
    .from('applications')
    .select('status')
    .eq('id', PEOPLE[0].applicationId)
    .single();
  check(unchanged?.status === 'approved', 'the first decision stands');

  /* ----------------------------------------------- [9] a clean console ---- */
  console.log('\n[9] Console');
  check(adminErrorsBefore === 0, `no console errors on the admin path (${adminErrorsBefore})`);
  adminErrors.slice(0, adminErrorsBefore).forEach((e) => console.error(`        ${e}`));
  check(
    applicantErrorsBefore === 0,
    `no console errors on the applicant path (${applicantErrorsBefore})`
  );
  applicantErrors.slice(0, applicantErrorsBefore).forEach((e) => console.error(`        ${e}`));
} catch (e) {
  fail(`unexpected error: ${e.message}`);
  console.error(e.stack);
} finally {
  await browser.close();

  // Audit rows survive account deletion on purpose (the FK is ON DELETE SET
  // NULL), which is right in production and only noise on dev. These belong to
  // applications this script invented, so they go with it.
  if (appIds.length) {
    await admin.from('audit_log').delete().in('subject_id', appIds);
  }
  if (made.length) {
    await admin.from('audit_log').delete().in('actor_id', made);
    for (const id of made) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) fail(`could not delete a test account: ${error.message}`);
    }
    console.log('\n[cleanup] test accounts, applications and their audit rows deleted');
  }
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('The admin review pipeline works, and holds up under attack.\n');
