#!/usr/bin/env node
/**
 * The contest suite.
 *
 * Drives the ADMIN SCREENS in a real browser: the Contests tab inside a brand,
 * and the setup screen that creates one. Then attacks the same data as a real
 * signed-in creator over the wire, because a screen looking right proves
 * nothing about who can read the money behind it.
 *
 * Makes its own throwaway accounts and removes them again, so it never touches
 * Rashid's admin. Run against dev only.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-contests.mjs [url]
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
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
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const URL = env.VITE_SUPABASE_URL;

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL, 'check-contests.mjs');
const PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (name) => {
  pass += 1;
  console.log(`  PASS  ${name}`);
};
const bad = (name, detail) => {
  fail += 1;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));

const STAMP = Date.now().toString(36);
const ADMIN_EMAIL = `contests-admin-${STAMP}@wurxmediahub.test`;
const CREATOR_EMAIL = `contests-creator-${STAMP}@wurxmediahub.test`;
// A second creator who does NOTHING, and exists only to prove that being signed
// in is not the same as being allowed to read somebody else's money.
const RIVAL_EMAIL = `contests-rival-${STAMP}@wurxmediahub.test`;
const PW = 'Wx-contests-suite-2026!';
const CONTEST_NAME = `Suite contest ${STAMP}`;

/*
 * The numbers the whole money half turns on, in one place, because they are
 * asserted from four directions: the deliverable the admin types, the frozen
 * term, the figure the creator claims, and the reward that confirming owes.
 * REACHED is deliberately past TARGET, so confirming crosses it.
 */
const TARGET = 500;
const REWARD = 120;
const REACHED = 640;
const BUDGET = 4321;

const made = { users: [], contests: [] };

async function makeUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw error;
  made.users.push(data.user.id);
  const patch = role === 'creator' ? { role: 'creator', tier: 'creator' } : { role: 'admin' };
  const { error: pErr } = await admin.from('profiles').update(patch).eq('id', data.user.id);
  if (pErr) throw pErr;
  return data.user.id;
}

async function cleanup() {
  for (const id of made.contests) {
    await admin.from('audit_log').delete().eq('subject_id', id);
    await admin.from('contests').delete().eq('id', id);
  }
  await admin.from('contests').delete().like('name', 'Suite contest %');
  // The audit rows this suite writes are keyed on the ACTOR as well as the
  // subject: paying a reward and confirming a claim are logged against the
  // throwaway admin, and deleting the account would otherwise orphan them.
  for (const id of made.users) {
    await admin.from('audit_log').delete().eq('actor_id', id);
    await admin.from('audit_log').delete().eq('target_user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
}

/**
 * What the entry dialog is actually saying, when the row it should have written
 * is not there. A failing assertion that only says "false" costs a whole run to
 * diagnose, and this dialog refuses for six different reasons.
 */
async function enterFailureDetail(dialog) {
  try {
    return (await dialog.innerText()).replace(/\s+/g, ' ').slice(0, 400);
  } catch {
    return 'the dialog is gone, and no entry was written';
  }
}

/**
 * THE MAIN CONTENT AREA, NEVER THE WHOLE PAGE.
 *
 * OPERATIONS has said "scope assertions to <main>" since three suites were
 * found searching the whole document and matching the sidebar. This one was
 * still clicking `text=New contest` unscoped, and on 2026-08-15 the rebuilt
 * sidebar grew a gradient button that also said New contest. Playwright happily
 * clicked the sidebar, the browser navigated somewhere reasonable, and the
 * suite failed twenty seconds later on a URL that made no sense.
 *
 * The button was ALSO wrong, and that is the more useful half of what this
 * caught: it named an action and performed a navigation to a list you cannot
 * create anything from. Both were fixed. This helper is so the next duplicate
 * label is a non-event.
 */
const main = (page) => page.locator('main');

async function signIn(page, email) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/admin/login'), { timeout: 20_000 });
}

console.log(`\nContests suite against ${BASE}\n${'='.repeat(70)}\n`);

const browser = await launchBrowser();
const errors = [];

try {
  const adminId = await makeUser(ADMIN_EMAIL, 'admin');
  await makeUser(CREATOR_EMAIL, 'creator');
  await makeUser(RIVAL_EMAIL, 'creator');

  const { data: brand } = await admin
    .from('brands')
    .select('id, name')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!brand) throw new Error('No active brand on dev to hang a contest off');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // ------------------------------------------------------------- the tab --
  console.log('1. The Contests tab');
  await signIn(page, ADMIN_EMAIL);
  await page.goto(`${BASE}/admin/brands/${brand.id}?section=contests`, {
    waitUntil: 'domcontentloaded',
  });
  await main(page).getByText('New contest').first().waitFor({ timeout: 20_000 });
  ok('the tab renders and offers a new contest');

  const bodyText = await page.textContent('body');
  check(
    'no id, slug or route is shown to an admin',
    !bodyText.includes(brand.id),
    'the brand uuid appears on screen'
  );

  // ------------------------------------------------------- creating one --
  console.log('\n2. Creating a contest through the screen');
  await main(page).getByText('New contest').first().click();
  await page.waitForURL(/\/contests\/new$/, { timeout: 20_000 });
  ok('the setup screen is its own route, not a dialog');

  // By label, not by an attribute. The first version of this suite found the
  // name box by maxlength and broke the moment that number was corrected.
  const nameBox = () => page.getByLabel('Name', { exact: true });
  await nameBox().fill(CONTEST_NAME);
  await page.fill('input[type="date"]', '2027-03-14');
  await page.fill('input[type="time"]', '23:59');

  const echo = await page.textContent('body');
  check(
    'the deadline is echoed as a creator will read it, with a zone',
    /14 Mar 2027, 11:59pm [A-Z]{2,5}/.test(echo),
    'no zone-named deadline echo found on the form'
  );

  await page.click('button[type="submit"]');
  await page.waitForURL(/\/contests\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  ok('saving lands on the saved contest');

  const { data: saved } = await admin
    .from('contests')
    .select('id, name, expires_at, expires_at_timezone, status, needs_admin_approval')
    .eq('name', CONTEST_NAME)
    .maybeSingle();
  check('the contest reached the database', Boolean(saved));
  if (!saved) throw new Error('nothing to test the money half against');
  if (saved) {
    made.contests.push(saved.id);
    // Staff only, and the creator half below proves it never reaches a browser
    // that is not staff. Set through the real function so the audit row exists.
    await admin.rpc('save_contest_commercials', {
      p_actor_id: adminId,
      p_contest_id: saved.id,
      p_total_budget: BUDGET,
      p_internal_note: null,
    });
    check('its timezone was stored as an IANA name', /^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/.test(saved.expires_at_timezone), saved.expires_at_timezone);
    check('a new contest is off until switched on', saved.status === 'inactive', saved.status);
  }

  // ------------------------------------------------------ what it refuses --
  console.log('\n3. What the screen refuses');
  await page.goto(`${BASE}/admin/brands/${brand.id}/contests/new`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByLabel('Name', { exact: true }).fill(`Suite contest ${STAMP} past`);
  await page.fill('input[type="date"]', '2020-01-01');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]', { timeout: 10_000 });
  const alertText = await page.textContent('[role="alert"]');
  check('a deadline in the past is refused', /passed/i.test(alertText), alertText);

  const { count: pastCount } = await admin
    .from('contests')
    .select('id', { count: 'exact', head: true })
    .eq('name', `Suite contest ${STAMP} past`);
  check('and nothing was written when it refused', (pastCount ?? 0) === 0);

  // --------------------------------------------------------- every width --
  console.log('\n4. Every width, both themes');
  for (const width of [375, 768, 1024, 1440]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${BASE}/admin/brands/${brand.id}?section=contests`, {
        waitUntil: 'domcontentloaded',
      });
      await main(page).getByText('New contest').first().waitFor({ timeout: 20_000 });
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      check(`tab has no sideways scroll at ${width}px ${theme}`, !scrolls);

      await page.goto(`${BASE}/admin/brands/${brand.id}/contests/new`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByLabel('Name', { exact: true }).waitFor({ timeout: 20_000 });
      const formScrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      check(`setup has no sideways scroll at ${width}px ${theme}`, !formScrolls);
    }
  }

  // ------------------------------------------------------- tap targets ---
  console.log('\n5. Tap targets');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE}/admin/brands/${brand.id}?section=contests`, {
    waitUntil: 'domcontentloaded',
  });
  await main(page).getByText('New contest').first().waitFor({ timeout: 20_000 });
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href]')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => (el.textContent ?? '').trim().slice(0, 30))
      .filter(Boolean)
  );
  check('every control is at least 44px tall on a phone', small.length === 0, small.join(' | '));

  // ---------------------------------------------- a deliverable, on screen --
  console.log('\n6. Adding a deliverable through the popup');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  /*
   * `?tab=rewards`, since 2026-08-22. The contest screen used to be one scroll
   * carrying the form, the rewards, both queues, the products and the
   * exclusions; Rashid asked for it to be five tabs, so the deliverables are no
   * longer on the page this used to land on. Everything below still drives the
   * real controls, it just has to open the right drawer first.
   */
  await page.goto(`${BASE}/admin/brands/${brand.id}/contests/${saved.id}?tab=rewards`, {
    waitUntil: 'domcontentloaded',
  });
  /*
   * The trigger and the dialog's submit BOTH say "Add deliverable", so every
   * locator here is scoped to the dialog rather than to the page. The setup
   * form behind it carries a Name field of its own, which is the trap that made
   * this worth writing down.
   */
  await page.getByRole('button', { name: 'Add deliverable' }).first().click();
  const popup = page.getByRole('dialog', { name: 'Add a deliverable' });
  await popup.waitFor({ timeout: 15_000 });

  await popup.getByLabel('Name', { exact: true }).fill('Suite GMV target');
  await popup.getByLabel(/^Target GMV/).fill(String(TARGET));
  await popup.getByLabel(/^Reward/).fill(String(REWARD));
  await popup.locator('button[type="submit"]').click();

  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    'Suite GMV target',
    { timeout: 20_000 }
  );
  ok('the deliverable popup saves and the row appears');

  const { data: deliverable } = await admin
    .from('contest_deliverables')
    .select('id, type, target_value, reward_amount, is_active')
    .eq('contest_id', saved.id)
    .maybeSingle();

  check('the target and the reward reached the database', Boolean(deliverable));
  if (deliverable) {
    check(
      'the target is exactly what was typed',
      Number(deliverable.target_value) === TARGET,
      String(deliverable.target_value)
    );
    check(
      'the reward is exactly what was typed',
      Number(deliverable.reward_amount) === REWARD,
      String(deliverable.reward_amount)
    );
  }

  /*
   * Switched on and open to everybody, through the database rather than the
   * form, because the form path for both is already covered above and what is
   * being set up here is the CREATOR half. Auto approval keeps the entry flow to
   * one click, which is the flow most contests will actually run.
   */
  await admin
    .from('contests')
    .update({ status: 'active', needs_admin_approval: false })
    .eq('id', saved.id);

  // ------------------------------------------------- the creator's screens --
  console.log('\n7. The creator, in a real browser');
  const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cpage = await cctx.newPage();
  cpage.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[creator] ${m.text()}`);
  });
  cpage.on('pageerror', (e) => errors.push(`[creator] ${String(e)}`));

  await cpage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await cpage.fill('input[type="email"]', CREATOR_EMAIL);
  await cpage.fill('input[type="password"]', PW);
  await cpage.click('button[type="submit"]');
  await cpage.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20_000 });
  ok('the creator can sign in through the screen');

  await cpage.goto(`${BASE}/app/contests`, { waitUntil: 'domcontentloaded' });
  await cpage.waitForFunction((n) => document.body.innerText.includes(n), CONTEST_NAME, {
    timeout: 20_000,
  });
  ok('the creator contest screen lists a live contest');

  const creatorText = await cpage.textContent('body');
  check(
    'the creator is shown the target and the reward',
    creatorText.includes('Suite GMV target'),
    'the deliverable is not named on the creator screen'
  );
  check(
    'no contest budget appears anywhere on the creator screen',
    !creatorText.includes(String(BUDGET)),
    'the contest budget is rendered to a creator'
  );

  // ---------------------------------------------------------- entry dialog --
  console.log('\n8. The entry dialog');
  /*
   * SCOPED TO THIS CONTEST'S CARD, not to the first matching button on the
   * page. Dev carries other live contests, every approved creator can see all
   * of them, and the first Enter button on the screen belongs to whichever one
   * closes soonest. The name carries a timestamp, so exactly one card matches.
   */
  const card = cpage.locator('li').filter({ hasText: CONTEST_NAME });
  await card.getByRole('button', { name: 'Enter this contest' }).click();

  const enterDialog = cpage.getByRole('dialog');
  await enterDialog.waitFor({ timeout: 15_000 });
  ok('the entry dialog opens');

  const dialogText = await enterDialog.innerText();
  check(
    'the dialog says what the contest pays before they commit',
    dialogText.includes('Suite GMV target'),
    'the deliverable is not shown in the entry dialog'
  );
  check(
    'and it is the contest they tapped',
    dialogText.includes(CONTEST_NAME),
    'the dialog opened on a different contest'
  );

  await enterDialog.locator('button[type="submit"]').click();

  /*
   * THE DIALOG CLOSING IS THE SIGNAL, not a phrase on the page.
   *
   * The first version of this waited for "You are in" in the body text, which
   * passed INSTANTLY against the dialog's own heading, "You are in the moment
   * you tap". So the suite read the database before the entry had been written
   * and reported the feature broken. A dialog that closes only when the write
   * came back is the thing that actually says it worked.
   */
  await enterDialog.waitFor({ state: 'detached', timeout: 25_000 });
  await card.getByText('You are in', { exact: false }).first().waitFor({ timeout: 20_000 });
  ok('entering lands them in the contest');

  const { data: entry, error: entryErr } = await admin
    .from('contest_entries')
    .select('id, status, creator_id')
    .eq('contest_id', saved.id)
    .maybeSingle();

  check(
    'the entry reached the database',
    Boolean(entry),
    entryErr?.message ?? (await enterFailureDetail(enterDialog))
  );
  if (!entry) throw new Error('no entry, so there is nothing to claim against');
  check('and it was approved without a decision', entry?.status === 'approved', entry?.status);

  const { data: frozen } = await admin
    .from('contest_entry_terms')
    .select('id, type, target_value, reward_amount')
    .eq('entry_id', entry.id);

  check('the promise was frozen onto the entry', (frozen ?? []).length === 1);
  check(
    'the frozen reward is the one they were shown',
    Number(frozen?.[0]?.reward_amount) === REWARD,
    String(frozen?.[0]?.reward_amount)
  );

  // ------------------------------------------------------- progress dialog --
  console.log('\n9. The progress dialog');
  await cpage.reload({ waitUntil: 'domcontentloaded' });
  await cpage
    .locator('li')
    .filter({ hasText: CONTEST_NAME })
    .getByRole('button', { name: 'Update progress' })
    .click();

  const progressDialog = cpage.getByRole('dialog');
  await progressDialog.waitFor({ timeout: 15_000 });
  ok('the progress dialog opens');

  const progressText = await progressDialog.innerText();
  check(
    'the dialog says nothing counts until the team confirms it',
    /confirm/i.test(progressText),
    'no confirmation caveat on the progress dialog'
  );

  // A target field would be a creator typing their own payslip. There is not
  // one, on the wire or on the screen, and this is the screen half.
  const editableTarget = await cpage.evaluate(() =>
    [...document.querySelectorAll('input, textarea')].some(
      (el) =>
        !el.disabled &&
        !el.readOnly &&
        /target|reward/i.test(
          (el.getAttribute('name') ?? '') + (el.getAttribute('aria-label') ?? '')
        )
    )
  );
  check('no target or reward is editable by a creator', !editableTarget);

  await progressDialog.getByLabel('Total GMV so far').fill(String(REACHED));
  await progressDialog.getByLabel('Videos posted so far').fill('1');
  await progressDialog.getByRole('button', { name: 'Continue' }).click();

  /*
   * EXACTLY ONE PAIR OF BOXES, because the count moved from 0 to 1. This is the
   * rule Rashid was explicit about: going from five to six asks for ONE link,
   * not six, and the database refuses any other number by naming both.
   */
  await progressDialog.getByLabel('Video link').waitFor({ timeout: 15_000 });
  const linkBoxes = await progressDialog.getByLabel('Video link').count();
  check('the dialog asks for exactly the NEW videos, not the total', linkBoxes === 1, String(linkBoxes));

  await progressDialog
    .getByLabel('Video link')
    .fill(`https://www.tiktok.com/@suite/video/${STAMP}1`);
  await progressDialog.getByLabel('Ad code').fill(`SUITE-${STAMP}`);

  await progressDialog.getByRole('button', { name: 'Send to the team' }).click();
  await progressDialog
    .getByText('with the team', { exact: false })
    .first()
    .waitFor({ timeout: 25_000 });
  ok('a claim can be filed from the dialog');

  const { data: claim } = await admin
    .from('contest_progress_updates')
    .select('id, gmv, status')
    .eq('entry_id', entry.id)
    .maybeSingle();

  check('the claim reached the database as PENDING', claim?.status === 'pending', claim?.status);
  check('carrying the figure they typed', Number(claim?.gmv) === REACHED, String(claim?.gmv));

  const { count: earlyAwards } = await admin
    .from('contest_awards')
    .select('id', { count: 'exact', head: true })
    .eq('contest_id', saved.id);
  check(
    'NOTHING is owed on an unconfirmed claim, even one past the target',
    (earlyAwards ?? 0) === 0,
    `${earlyAwards} award(s) written before anybody confirmed anything`
  );

  // ------------------------------------------- confirming is what owes money --
  console.log('\n10. Confirming a claim owes the money');
  await page.goto(`${BASE}/admin/contests/claims`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.body.innerText.includes(n), CONTEST_NAME, {
    timeout: 20_000,
  });
  ok('the claim is waiting on the claims screen');

  /*
   * SCOPED TO THIS CONTEST'S CARD. Dev carries real seeded claims from other
   * creators, and the first Confirm button on this queue belongs to whoever has
   * been waiting longest. Confirming one of those would owe real money to
   * somebody this suite has nothing to do with, and then delete nothing on the
   * way out.
   */
  await page
    .locator('li')
    .filter({ hasText: CONTEST_NAME })
    // And the one with a Confirm button on it. Since 2026-08-20 the contest
    // video queue on this same screen also renders `li`s carrying this contest's
    // name, so naming the contest alone no longer names one row.
    .filter({ has: page.getByRole('button', { name: 'Confirm these figures' }) })
    .first()
    .getByRole('button', { name: 'Confirm these figures' })
    .click();
  /*
   * WAIT FOR THE ROW ITSELF TO GO, not for text to leave the page.
   * It used to watch the whole body for the contest name, which worked only
   * while this screen had nothing else on it that could mention a contest.
   * From 2026-08-20 it also carries the contest VIDEO queue, whose rows belong
   * to the same contest, so a page-wide check waits 25 seconds for text that is
   * legitimately still there and then calls a working feature broken.
   *
   * The row is identified the way a person would: the one about this contest
   * that still has a Confirm button on it. Nothing else on the screen has one.
   */
  await page
    .locator('li')
    .filter({ hasText: CONTEST_NAME })
    .filter({ has: page.getByRole('button', { name: 'Confirm these figures' }) })
    .first()
    .waitFor({ state: 'detached', timeout: 25_000 });
  ok('confirming clears it from the progress queue');

  const { data: award } = await admin
    .from('contest_awards')
    .select('id, awarded_amount, awarded_currency, reached_value, paid_at, creator_id, term_id')
    .eq('contest_id', saved.id)
    .maybeSingle();

  check('confirming wrote the reward', Boolean(award));
  if (award) {
    check(
      'for exactly what the deliverable promised',
      Number(award.awarded_amount) === REWARD,
      String(award.awarded_amount)
    );
    check('and it is OWED, not paid', award.paid_at === null);
    check(
      'the figure that crossed the target is frozen on it',
      Number(award.reached_value) === REACHED,
      String(award.reached_value)
    );
    check('it points at the frozen promise, not at the live deliverable', award.term_id === frozen?.[0]?.id);
  }

  // Confirming twice must not pay twice. The claim is already decided, so this
  // is the second decision guard, and the award constraint behind it.
  const secondDecision = await admin.rpc('review_contest_progress', {
    p_actor_id: adminId,
    p_update_id: claim.id,
    p_status: 'confirmed',
    p_message: null,
  });
  check('a second decision on the same claim is refused', Boolean(secondDecision.error));

  const { count: awardCount } = await admin
    .from('contest_awards')
    .select('id', { count: 'exact', head: true })
    .eq('contest_id', saved.id);
  check('and no second reward was written', (awardCount ?? 0) === 1, String(awardCount));

  // --------------------------------------------------- the creator sees it --
  console.log('\n11. The creator sees what they are owed');
  await cpage.goto(`${BASE}/app/contests?view=progress`, { waitUntil: 'domcontentloaded' });
  await cpage.waitForFunction(
    () => /Owed to you/.test(document.body.innerText),
    undefined,
    { timeout: 20_000 }
  );
  ok('the creator dashboard says what is owed to them');

  const owedText = await cpage.textContent('body');
  check(
    'and names the reward it was earned against',
    owedText.includes('Suite GMV target'),
    'the reward is not named on the creator dashboard'
  );

  /*
   * THE HOME SCREEN, which is the one they open first and the one that said
   * they had been paid nothing until 2026-08-14.
   *
   * This suite creator has NO offer work at all, which makes the M10 assertion
   * exact rather than approximate: their offer money is zero, so if the two
   * pots were ever added the headline would carry the contest reward, and if
   * they are kept apart it cannot.
   */
  await cpage.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  /*
   * CASE INSENSITIVE, and that is not laziness. `innerText` returns RENDERED
   * text, so it applies `text-transform`, and this eyebrow carries `uppercase`.
   * The literal "From contests" is in the source and never on the rendered
   * page. `textContent` would not transform it, which is why the assertions
   * below, which read textContent, can be exact.
   */
  const sawContestMoney = await cpage
    .waitForFunction(() => /from contests/i.test(document.body.innerText), undefined, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);

  const homeText = await cpage.textContent('body');
  check(
    'the creator HOME shows contest money',
    sawContestMoney,
    homeText.replace(/\s+/g, ' ').slice(0, 500)
  );
  check(
    'the home says the reward is owed',
    /Owed to you/.test(homeText),
    'no owed figure on the home screen'
  );
  /* The sentence "Contest rewards are their own pot... never added together" was
     removed (page plan rule 8: the app does not narrate itself). The two pots are
     still separate figures, asserted by the "Owed to you" check above. */

  /*
   * NO CARD OF ZEROS ABOVE THEIR REAL MONEY. This creator has taken no offer,
   * so the offer money block would read "$0 across 0 jobs" over an empty flow
   * bar and three zero cells, sitting above the only money they have. Every
   * figure in it would be true and the screen would read as broken.
   */
  check(
    'a contest-only creator is not shown an offer money card full of zeros',
    !/Agreed with you so far/.test(homeText),
    'the zeroed offer money card is drawn above their contest money'
  );
  check(
    'and the first day panel does not call that money nothing',
    !/Earned so far\s*Nothing yet/.test(homeText.replace(/\s+/g, ' ')),
    'the first day panel says they have earned nothing while owing them money'
  );

  /*
   * RULE M10, and it is worth saying what this check can and cannot prove. It
   * is VACUOUS for this creator, because the offer block is not drawn for them
   * at all, so there is no figure the reward could have been added into. What
   * actually enforces M10 is structural: two components, two queries, no shared
   * arithmetic, and the sentence asserted above. The check is kept because the
   * day somebody gives this suite's creator offer work as well, it stops being
   * vacuous and starts being the real test.
   */
  const offerHeadline = (await cpage.getByText('Agreed with you so far').count())
    ? await cpage.getByText('Agreed with you so far').locator('xpath=../..').innerText()
    : '';
  check(
    'contest money is never counted into the offer headline (rule M10)',
    !offerHeadline.includes(String(REWARD)),
    `the offer headline carries the contest reward: ${offerHeadline.replace(/\s+/g, ' ').slice(0, 160)}`
  );

  // ------------------------------------------------------------- paying it --
  console.log('\n12. Paying it, on the rewards screen');
  await page.goto(`${BASE}/admin/contests/rewards`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.body.innerText.includes(n), CONTEST_NAME, {
    timeout: 20_000,
  });
  ok('the reward is waiting on the rewards screen');

  // Scoped for the same reason the claims queue is: dev owes real money to real
  // seeded creators, and paying one of theirs would be a lie this suite leaves
  // behind.
  await page
    .locator('li')
    .filter({ hasText: CONTEST_NAME })
    .locator('input[type="checkbox"]')
    .check();
  await page.getByRole('button', { name: 'Mark paid' }).click();
  await page.waitForFunction(
    () => /Yes, mark it paid|Yes, mark them paid/.test(document.body.innerText),
    undefined,
    { timeout: 15_000 }
  );
  ok('marking paid asks first');

  const confirmText = await page.textContent('body');
  check(
    'and says plainly that it cannot be undone',
    /cannot be undone/i.test(confirmText),
    'no irreversibility warning before paying'
  );

  await page.getByRole('button', { name: /Yes, mark (it|them) paid/ }).click();
  await page.waitForFunction(
    (n) => !document.body.innerText.includes(n),
    CONTEST_NAME,
    { timeout: 25_000 }
  );
  ok('the paid reward leaves the owed list');

  const { data: afterPay } = await admin
    .from('contest_awards')
    .select('paid_at, paid_by')
    .eq('id', award.id)
    .maybeSingle();
  check('the database says it is paid', Boolean(afterPay?.paid_at));
  check('and records who said so', afterPay?.paid_by === adminId);

  const payAgain = await admin.rpc('pay_contest_awards', {
    p_actor_id: adminId,
    p_award_ids: [award.id],
    p_message: null,
    p_allow_suspended: false,
  });
  check('paying the same reward twice is refused', Boolean(payAgain.error));

  await cpage.goto(`${BASE}/app/contests?view=progress`, { waitUntil: 'domcontentloaded' });
  await cpage.waitForFunction(() => /\bPaid\b/.test(document.body.innerText), undefined, {
    timeout: 20_000,
  });
  ok('and the creator sees it as paid');

  await cpage.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
  await cpage.waitForFunction(
    () => /Paid to you/.test(document.body.innerText),
    undefined,
    { timeout: 20_000 }
  );
  const homePaid = await cpage
    .getByText('From contests')
    .locator('xpath=../..')
    .innerText();
  check(
    'the home moves it from owed to paid',
    /Paid to you/.test(homePaid) && /nothing waiting/.test(homePaid),
    homePaid.replace(/\s+/g, ' ').slice(0, 200)
  );

  // ------------------------------------------- video money follows videos --
  /*
   * RASHID'S RULE, 2026-08-20: "money is only owed when all videos are up ...
   * admin see one by one and all are approved only then money is owed."
   *
   * Everything above this section is about a GMV target, where staff confirming
   * the figure IS the control and still owes the money. This section is the
   * other kind, and it is the one that changed: a video target is earned by
   * APPROVED videos, so the ninth of ten owes nothing and the tenth owes
   * everything, whatever anybody typed.
   *
   * It runs against the database rather than the browser deliberately. The
   * screen is checked in section 7 and the console in the last section; what
   * needs proving here is that money cannot be owed for work nobody approved,
   * and that is a property of the function, not of a button.
   */
  console.log('\n13. A video reward is earned by approving the videos');

  const VIDEO_TARGET = 2;
  const VIDEO_REWARD = 75;

  const vDeliverable = await admin.rpc('save_contest_deliverable', {
    p_actor_id: adminId,
    p_contest_id: saved.id,
    p_type: 'video_count',
    p_title: 'Suite video target',
    p_target_value: VIDEO_TARGET,
    p_reward_amount: VIDEO_REWARD,
    p_deliverable_id: null,
    p_detail: null,
    p_sort_order: 9,
    p_is_active: true,
  });
  check('a video target can be added', !vDeliverable.error, vDeliverable.error?.message);

  /*
   * The terms are frozen ONTO AN ENTRY at approval, and this entry was approved
   * before the video target existed, so it does not carry it. That is the rule
   * working, not a problem: adding a deliverable must never rewrite what
   * somebody already agreed to. A second entrant is the honest way to test the
   * new term, and it is also the shape a real contest takes when a target is
   * added mid-flight.
   */
  const vEmail = `contests-video-${STAMP}@wurxmediahub.test`;
  const vId = await makeUser(vEmail, 'creator');

  const vEntry = await admin.rpc('apply_for_contest', {
    p_actor_id: vId,
    p_contest_id: saved.id,
    p_note: null,
  });
  check('a second creator can enter', !vEntry.error, vEntry.error?.message);
  const vEntryId = vEntry.data?.id ?? vEntry.data?.entry?.id;

  const { data: vTerms } = await admin
    .from('contest_entry_terms')
    .select('id, type, target_value, reward_amount')
    .eq('entry_id', vEntryId)
    .eq('type', 'video_count');
  check('and the video target is frozen onto their entry', (vTerms ?? []).length === 1);

  // Two videos, filed the way a creator files them. The count and the list have
  // to agree or the database refuses, which is itself the rule under test.
  const vClaim = await admin.rpc('submit_contest_progress', {
    p_actor_id: vId,
    p_entry_id: vEntryId,
    p_gmv: 0,
    p_video_count: VIDEO_TARGET,
    p_videos: [
      { video_url: 'https://www.tiktok.com/@wurxsuite/video/7500000000000000101', ad_code: 'SUITEV1', ad_authorized: true },
      { video_url: 'https://www.tiktok.com/@wurxsuite/video/7500000000000000102', ad_code: 'SUITEV2', ad_authorized: true },
    ],
  });
  check('they file the videos with the claim', !vClaim.error, vClaim.error?.message);

  const owedFor = async () => {
    const { data } = await admin
      .from('contest_awards')
      .select('id, awarded_amount, paid_at, term_id')
      .eq('entry_id', vEntryId)
      .not('term_id', 'is', null);
    return data ?? [];
  };

  // CONFIRMING THE CLAIM MUST NOT PAY. This is the whole change: the figure is
  // right, the creator typed the truth, and nobody has watched anything yet.
  const vConfirm = await admin.rpc('review_contest_progress', {
    p_actor_id: adminId,
    p_update_id: vClaim.data?.id ?? vClaim.data?.update?.id,
    p_status: 'confirmed',
    p_message: null,
  });
  check('the claim can be confirmed', !vConfirm.error, vConfirm.error?.message);
  check('but confirming owes NOTHING while the videos are unwatched', (await owedFor()).length === 0);

  const { data: vFiled } = await admin
    .from('contest_submissions')
    .select('id')
    .eq('entry_id', vEntryId)
    .order('created_at', { ascending: true });
  check('both videos are on the entry', (vFiled ?? []).length === 2);

  const first = await admin.rpc('review_contest_content', {
    p_actor_id: adminId,
    p_content_id: vFiled[0].id,
    p_status: 'approved',
    p_note: null,
  });
  check('the first approval goes through', !first.error, first.error?.message);
  check('and owes nothing on its own', (await owedFor()).length === 0);

  const second = await admin.rpc('review_contest_content', {
    p_actor_id: adminId,
    p_content_id: vFiled[1].id,
    p_status: 'approved',
    p_note: null,
  });
  check('the LAST approval owes the reward', Number(second.data?.rewards?.amount) === VIDEO_REWARD, JSON.stringify(second.data?.rewards));

  const afterBoth = await owedFor();
  check('and there is exactly one award, unpaid', afterBoth.length === 1 && afterBoth[0].paid_at === null);

  // THE OTHER DIRECTION. Nine of ten is not a reward.
  const back = await admin.rpc('review_contest_content', {
    p_actor_id: adminId,
    p_content_id: vFiled[1].id,
    p_status: 'needs_another_take',
    p_note: 'Reshoot with the product visible.',
  });
  check('sending an approved video back withdraws the reward', Number(back.data?.withdrawn?.withdrawn) === 1, JSON.stringify(back.data?.withdrawn));
  check('and the award row is gone', (await owedFor()).length === 0);

  const { data: withdrawnEvent } = await admin
    .from('contest_entry_events')
    .select('kind, note')
    .eq('entry_id', vEntryId)
    .eq('kind', 'reward_withdrawn');
  check('the creator is told in their own timeline', (withdrawnEvent ?? []).length === 1);

  // And it comes back when the work does.
  const again = await admin.rpc('review_contest_content', {
    p_actor_id: adminId,
    p_content_id: vFiled[1].id,
    p_status: 'approved',
    p_note: null,
  });
  check('re-approving owes it again', Number(again.data?.rewards?.amount) === VIDEO_REWARD, JSON.stringify(again.data?.rewards));

  /*
   * THE SAFETY PROPERTY, and the reason withdrawal is not a blanket delete.
   * Once money has actually been sent, a video decision must not quietly erase
   * the record of it. The creator is short a video and that is a conversation,
   * not a database write.
   */
  const paidNow = await admin.rpc('pay_contest_awards', {
    p_actor_id: adminId,
    p_award_ids: (await owedFor()).map((a) => a.id),
    p_message: null,
    p_allow_suspended: false,
  });
  check('the reward can be paid', !paidNow.error, paidNow.error?.message);

  const afterPaid = await admin.rpc('review_contest_content', {
    p_actor_id: adminId,
    p_content_id: vFiled[1].id,
    p_status: 'needs_another_take',
    p_note: 'Changed my mind after paying.',
  });
  check('a PAID reward is never withdrawn', Number(afterPaid.data?.withdrawn?.withdrawn) === 0, JSON.stringify(afterPaid.data?.withdrawn));
  check('and the screen is told why', Number(afterPaid.data?.withdrawn?.already_paid) === 1);
  const stillThere = await owedFor();
  check('the paid award is still on the bill', stillThere.length === 1 && stillThere[0].paid_at !== null);

  /*
   * A creator cannot reach any of this. `review_contest_content` is granted to
   * service_role alone, like every other contest writer, and a creator holding
   * the id of their own video is the person most likely to try.
   */
  const asVideoCreator = createClient(URL, PUB, { auth: { persistSession: false } });
  await asVideoCreator.auth.signInWithPassword({ email: vEmail, password: PW });
  const creatorTries = await asVideoCreator.rpc('review_contest_content', {
    p_actor_id: adminId,
    p_content_id: vFiled[0].id,
    p_status: 'approved',
    p_note: null,
  });
  check('a creator cannot approve a contest video', Boolean(creatorTries.error));
  await asVideoCreator.auth.signOut();

  // ------------------------------------------------------- closing it -------
  console.log('\n14. Closing the contest');
  const closeWithClaim = await admin.rpc('settle_contest', {
    p_actor_id: adminId,
    p_contest_id: saved.id,
    p_message: null,
  });
  check('a contest with no waiting claim closes', !closeWithClaim.error, closeWithClaim.error?.message);

  const { data: closed } = await admin
    .from('contests')
    .select('settled_at, settled_by')
    .eq('id', saved.id)
    .maybeSingle();
  check('it is recorded as closed, with an actor', Boolean(closed?.settled_at && closed?.settled_by));

  const closeAgain = await admin.rpc('settle_contest', {
    p_actor_id: adminId,
    p_contest_id: saved.id,
    p_message: null,
  });
  check('closing it twice is refused', Boolean(closeAgain.error));

  // ---------------------------------------------- creator widths and console --
  console.log('\n15. The creator screens at every width');
  for (const width of [375, 768, 1024, 1440]) {
    for (const theme of ['dark', 'light']) {
      await cpage.setViewportSize({ width, height: 900 });
      await cpage.emulateMedia({ colorScheme: theme });
      await cpage.goto(`${BASE}/app/contests`, { waitUntil: 'domcontentloaded' });
      await cpage.waitForFunction((n) => document.body.innerText.includes(n), CONTEST_NAME, {
        timeout: 20_000,
      });
      const scrolls = await cpage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      check(`creator contests has no sideways scroll at ${width}px ${theme}`, !scrolls);

      /*
       * THE HOME, WITH CONTEST MONEY ON IT, which is the only place this data
       * can be checked at width. `verify:responsive` drives a creator built
       * from the offer pipeline and has never had a contest reward, so it
       * would photograph the card's absence and call it a pass.
       */
      await cpage.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' });
      await cpage.waitForFunction(
        () => /from contests/i.test(document.body.innerText),
        undefined,
        { timeout: 20_000 }
      );
      const homeScrolls = await cpage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      check(`the home with contest money has no sideways scroll at ${width}px ${theme}`, !homeScrolls);
    }
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${BASE}/admin/contests/rewards?view=paid`, { waitUntil: 'domcontentloaded' });
  /*
   * "Contest rewards" was this screen's h1 until 2026-08-15, when the three
   * contest screens gained one shared header and the h1 became "Contests" with
   * All / Claims / Rewards beside it. This assertion went stale the moment that
   * shipped, which is the class OPERATIONS warns about by name: after a copy
   * change, grep `scripts/` for the old wording. I did not, and this caught it.
   *
   * It now waits on the screen's OWN content rather than on a page title, which
   * is the thing that cannot be renamed by a layout change somewhere else.
   */
  await page.waitForFunction(
    () => /rewards already paid|nothing has been paid yet/i.test(document.body.innerText),
    undefined,
    { timeout: 20_000 }
  );
  const rewardScrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  check('the rewards screen has no sideways scroll on a phone', !rewardScrolls);

  const rewardSmall = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href]')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => (el.textContent ?? '').trim().slice(0, 30))
      .filter(Boolean)
  );
  check('every rewards control is at least 44px tall on a phone', rewardSmall.length === 0, rewardSmall.join(' | '));

  await cctx.close();


  // ------------------------------------------------- the money, on the wire --
  console.log('\n16. As a real creator, over the wire');
  const asCreator = createClient(URL, PUB, { auth: { persistSession: false } });
  const { error: sErr } = await asCreator.auth.signInWithPassword({
    email: CREATOR_EMAIL,
    password: PW,
  });
  check('the creator can sign in', !sErr, sErr?.message);

  const commercials = await asCreator.from('contest_commercials').select('total_budget');
  check(
    'a creator reads nothing from the budget table',
    (commercials.data ?? []).length === 0,
    JSON.stringify(commercials.data)
  );

  const asColumn = await asCreator.from('contests').select('id, total_budget');
  check('a budget is not a column they can even ask for', Boolean(asColumn.error));

  const exclusions = await asCreator.from('contest_exclusions').select('id');
  check('a creator reads nothing from the exclusion list', (exclusions.data ?? []).length === 0);

  const targets = await asCreator.from('contest_entry_targets').select('entry_id');
  check("a creator reads nobody else's private target", (targets.data ?? []).length === 0);

  const totals = await asCreator.from('contest_totals').select('contest_id');
  check('a creator reads nothing from the staff totals view', (totals.data ?? []).length === 0);

  const writeAttempt = await asCreator
    .from('contests')
    .insert({ brand_id: brand.id, name: 'creator made this' });
  check('a creator cannot insert a contest', Boolean(writeAttempt.error));

  const fnAttempt = await asCreator.functions.invoke('manage-contest', {
    body: { action: 'contest.delete', contestId: saved?.id ?? made.contests[0] },
  });
  check('a creator is refused by the edge function', Boolean(fnAttempt.error));

  /*
   * THE MONEY ATTACKS. Everything above is about what a creator can READ.
   * These are about what they can do to the bill, which is the part that pays
   * them, so every one of them is run as a real signed-in creator against the
   * real endpoint rather than reasoned about.
   */
  const ownAwards = await asCreator.from('contest_awards').select('id, awarded_amount');
  check(
    'a creator reads their OWN rewards',
    (ownAwards.data ?? []).length >= 1,
    'the earner cannot see what they earned'
  );

  const payViaFn = await asCreator.functions.invoke('manage-contest', {
    body: { action: 'award.pay', awardIds: [award.id], message: null, allowSuspended: false },
  });
  check('a creator cannot mark their own reward paid', Boolean(payViaFn.error));

  const payViaRpc = await asCreator.rpc('pay_contest_awards', {
    p_actor_id: adminId,
    p_award_ids: [award.id],
    p_message: null,
    p_allow_suspended: false,
  });
  check('and cannot reach the pay function directly either', Boolean(payViaRpc.error));

  const settleViaRpc = await asCreator.rpc('settle_contest', {
    p_actor_id: adminId,
    p_contest_id: saved.id,
    p_message: null,
  });
  check('a creator cannot close a contest', Boolean(settleViaRpc.error));

  // The writer lives in `private` precisely so PostgREST cannot see it. If this
  // ever succeeds, somebody has moved it into an exposed schema and a creator
  // can pay themselves.
  const awardViaRpc = await asCreator.rpc('award_reached_terms', {
    p_entry_id: entry.id,
    p_gmv: 999999,
    p_video_count: 999,
    p_actor_id: adminId,
    p_event_note: null,
  });
  check('the reward writer is not reachable as an RPC at all', Boolean(awardViaRpc.error));

  /*
   * There is no update policy on contest_awards at all, and PostgREST answers a
   * filtered-away UPDATE with success and zero rows rather than with an error.
   * So the assertion is on the ROW, not on the response: an attack that changes
   * nothing and reports nothing is exactly what this should look like.
   */
  await asCreator
    .from('contest_awards')
    .update({ awarded_amount: 99_999, paid_by: entry.creator_id })
    .eq('id', award.id);

  const { data: afterAttack } = await admin
    .from('contest_awards')
    .select('awarded_amount, paid_by')
    .eq('id', award.id)
    .maybeSingle();

  check(
    'a creator cannot raise their own reward',
    Number(afterAttack?.awarded_amount) === REWARD,
    String(afterAttack?.awarded_amount)
  );
  check(
    'and cannot rewrite who paid it',
    afterAttack?.paid_by === adminId,
    'a creator wrote onto the reward row'
  );

  const awardInsert = await asCreator.from('contest_awards').insert({
    contest_id: saved.id,
    entry_id: entry.id,
    creator_id: entry.creator_id,
    term_id: frozen[0].id,
    awarded_amount: 99999,
    awarded_currency: 'USD',
  });
  check('a creator cannot invent a reward for themselves', Boolean(awardInsert.error));

  const awardTotals = await asCreator.from('contest_award_totals').select('contest_id');
  check(
    'a creator reads nothing from the rewards rollup',
    (awardTotals.data ?? []).length === 0,
    JSON.stringify(awardTotals.data)
  );

  await asCreator.auth.signOut();

  // -------------------------------------------------- somebody else's money --
  console.log('\n17. A rival creator');
  const asRival = createClient(URL, PUB, { auth: { persistSession: false } });
  const { error: rErr } = await asRival.auth.signInWithPassword({
    email: RIVAL_EMAIL,
    password: PW,
  });
  check('the rival can sign in', !rErr, rErr?.message);

  const rivalAwards = await asRival.from('contest_awards').select('id');
  check(
    "a creator reads NOTHING of another creator's rewards",
    (rivalAwards.data ?? []).length === 0,
    JSON.stringify(rivalAwards.data)
  );

  const rivalTerms = await asRival.from('contest_entry_terms').select('id');
  check(
    "and nothing of another creator's frozen promise",
    (rivalTerms.data ?? []).length === 0
  );

  const rivalClaims = await asRival.from('contest_progress_updates').select('id, gmv');
  check("and nothing of another creator's claimed figures", (rivalClaims.data ?? []).length === 0);

  const rivalStanding = await asRival.rpc('my_contest_standing', { p_contest_id: saved.id });
  check(
    'the standing tells a non-entrant nothing at all',
    !rivalStanding.error && (rivalStanding.data ?? []).length === 0,
    JSON.stringify(rivalStanding.data ?? rivalStanding.error)
  );

  await asRival.auth.signOut();


  // ------------------------------------------------------------ console ---
  console.log('\n18. The console');
  check('zero console errors across every screen and width', errors.length === 0, errors.join('\n        '));
} catch (err) {
  bad('the suite itself threw', String(err));
} finally {
  await browser.close();
  await cleanup();
}

console.log(`\n${'='.repeat(70)}`);
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
