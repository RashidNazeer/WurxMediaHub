#!/usr/bin/env node
/**
 * Content, end to end and both ends through the real UI.
 *
 * A creator posts a video against their own job. The team watches it and
 * decides. Approving the last one an offer asked for is what finishes the job,
 * and that has to happen in the database rather than in a screen, so the
 * creator's dashboard must move on its own.
 *
 * Nine of these are attacks. `content_submissions` is the second thing in this
 * product a creator can write and the first that can finish a piece of work, so
 * the interesting question is not whether the form works, it is whether a
 * creator can post onto somebody else's job, edit an approved video, or decide
 * on their own content.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-content.mjs [baseUrl]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
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

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const URL_BASE = env.VITE_SUPABASE_URL;

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL_BASE, 'check-content.mjs');
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

const PASSWORD = 'content-suite-dev-only-1';
const CREATOR = 'content-creator@wurxmediahub.test';
const RIVAL = 'content-rival@wurxmediahub.test';
const STAFF = 'content-staff@wurxmediahub.test';
const made = [];

/*
 * The brand this suite makes, recorded OUTSIDE the try so the cleanup in
 * `finally` can still see it. See the note down there for why that matters.
 */
const madeBrand = { id: null };

let passes = 0;
let failures = 0;
const ok = (m) => {
  console.log(`  PASS  ${m}`);
  passes++;
};
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  failures++;
};

async function retry(label, fn, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const transient = /fetch failed|timeout|ECONN|socket/i.test(String(err?.message ?? err));
      if (!transient || attempt >= tries) throw new Error(`${label}: ${err?.message ?? err}`);
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

/** A signed-in client, exactly what a browser holds. */
async function asUser(email) {
  const client = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** Call the function the way the app does, and report what came back. */
async function callFn(client, body) {
  const { data, error } = await client.functions.invoke('manage-content', { body });
  if (!error) return { ok: true, data };
  let message = error.message ?? '';
  const ctx = error.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const parsed = await ctx.json();
      if (parsed?.error) message = parsed.error;
    } catch {
      /* not JSON */
    }
  }
  return { ok: false, status: ctx?.status, message };
}

try {
  console.log('\nContent, end to end\n' + '='.repeat(70));
  const now = new Date().toISOString();

  const creatorId = await makeUser(CREATOR, {
    role: 'creator',
    tier: 'rising',
    display_name: 'Content Creator',
    is_active: true,
    welcomed_at: now,
    approval_celebrated_at: now,
  });
  const rivalId = await makeUser(RIVAL, {
    role: 'creator',
    tier: 'rising',
    display_name: 'Rival Creator',
    is_active: true,
    welcomed_at: now,
    approval_celebrated_at: now,
  });
  await makeUser(STAFF, { role: 'admin', display_name: 'Content Staff', is_active: true });

  for (const [id, handle] of [
    [creatorId, 'contentcreator'],
    [rivalId, 'contentrival'],
  ]) {
    await admin.from('applications').insert({
      user_id: id,
      tiktok_handle: handle,
      niche: 'Beauty & skincare',
      worked_with_wurx: false,
      video_links: 'https://www.tiktok.com/@example/video/1',
      status: 'approved',
      reviewed_at: now,
    });
  }

  /*
   * A brand of our own, with a two-video offer.
   *
   * Two, so "approving the last one finishes the job" is a real transition
   * rather than a single-step coincidence. Made here rather than borrowed from
   * the seed so the suite does not depend on what happens to be on dev.
   */
  const stamp = Date.now().toString(36);
  const { data: brand, error: brandErr } = await admin
    .from('brands')
    .insert({
      name: `Content Suite ${stamp}`,
      slug: `content-suite-${stamp}`,
      store_id: `content-suite-${stamp}`,
      is_active: true,
    })
    .select('id')
    .single();
  if (brandErr) throw brandErr;
  madeBrand.id = brand?.id ?? null;

  const { data: offer, error: offerErr } = await admin
    .from('offers')
    .insert({
      brand_id: brand.id,
      title: 'Content suite offer',
      description: 'Two videos, for the suite.',
      video_count: 2,
      reward_amount: 200,
      currency: 'USD',
      needs_application: true,
      status: 'active',
    })
    .select('id')
    .single();
  if (offerErr) throw offerErr;

  const jobFor = async (id, handle) => {
    const { data, error } = await admin
      .from('offer_applications')
      .insert({
        offer_id: offer.id,
        brand_id: brand.id,
        creator_id: id,
        creator_handle: handle,
        creator_email: `${handle}@wurxmediahub.test`,
        status: 'approved',
        stage: 'content_pending',
        committed_amount: 200,
        /*
         * The terms, snapshotted, exactly as `review_offer_application` does.
         *
         * This suite writes the job directly rather than approving it through
         * the real function, because that one charges the brand's budget and a
         * throwaway creator must never move a number an admin is reading. The
         * price of that shortcut is that anything the real function stamps has
         * to be stamped here too: a job with no agreed count can never be "all
         * filmed", so leaving this out would silently stop every job in the
         * suite from ever finishing.
         */
        committed_video_count: 2,
        currency: 'USD',
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  };
  const job = await jobFor(creatorId, 'contentcreator');
  const rivalJob = await jobFor(rivalId, 'contentrival');

  const creator = await asUser(CREATOR);
  const rival = await asUser(RIVAL);
  const staff = await asUser(STAFF);

  /* ------------------------------------------------------------ posting -- */
  console.log('\n[1] A creator posting their own work');

  const first = await callFn(creator, {
    action: 'content.create',
    applicationId: job,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000001',
    adCode: 'SUITE-AD-0001',
    adAuthorized: true,
  });
  if (first.ok) ok('a creator can post a video against their own job');
  else bad(`posting failed: ${first.message}`);
  const firstId = first.data?.result?.id;

  const dupe = await callFn(creator, {
    action: 'content.create',
    applicationId: job,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000001',
    adCode: 'SUITE-AD-DUPE',
    adAuthorized: true,
  });
  if (!dupe.ok && /already posted/i.test(dupe.message)) {
    ok('the same link twice against one job is refused, in words');
  } else bad(`a duplicate link was accepted: ${JSON.stringify(dupe).slice(0, 120)}`);

  const noScheme = await callFn(creator, {
    action: 'content.create',
    applicationId: job,
    videoUrl: 'tiktok.com/@wurxsuite/video/2',
    adCode: 'SUITE-AD-0002',
  });
  if (!noScheme.ok) ok('a link that is not https is refused');
  else bad('a link with no scheme was accepted');

  /* ------------------------------------------------------------ attacks -- */
  console.log('\n[2] Attacks, run as real signed-in accounts');

  const ontoRival = await callFn(creator, {
    action: 'content.create',
    applicationId: rivalJob,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000009',
    adCode: 'SUITE-AD-STEAL',
  });
  if (!ontoRival.ok) {
    ok('a creator cannot post onto somebody else’s job');
  } else bad(`posting onto another creator's job was allowed: ${ontoRival.message}`);

  const rivalReads = await rival
    .from('content_submissions')
    .select('id, ad_code')
    .eq('id', firstId);
  if ((rivalReads.data ?? []).length === 0) {
    ok('a rival creator cannot read the first creator’s video or ad code');
  } else bad('a rival creator could read another creator’s submission');

  const rivalEdits = await callFn(rival, {
    action: 'content.update',
    contentId: firstId,
    videoUrl: 'https://www.tiktok.com/@rival/video/7300000000000000010',
    adCode: 'SUITE-AD-HIJACK',
  });
  if (!rivalEdits.ok) ok('a rival creator cannot edit a submission that is not theirs');
  else bad('a rival creator edited another creator’s submission');

  const creatorReviews = await callFn(creator, {
    action: 'content.review',
    contentId: firstId,
    status: 'approved',
    note: null,
  });
  if (!creatorReviews.ok) {
    ok('a creator cannot approve their own content');
  } else bad('a creator approved their own content');

  const directInsert = await creator.from('content_submissions').insert({
    application_id: job,
    creator_id: creatorId,
    brand_id: brand.id,
    offer_id: offer.id,
    video_url: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000011',
    ad_code: 'SUITE-AD-DIRECT',
  });
  if (directInsert.error) ok('a straight table insert is refused, there is no insert policy');
  else bad('a creator wrote content_submissions directly, bypassing the function');

  const directUpdate = await creator
    .from('content_submissions')
    .update({ status: 'approved' })
    .eq('id', firstId);
  const { data: afterDirect } = await admin
    .from('content_submissions')
    .select('status')
    .eq('id', firstId)
    .single();
  if (directUpdate.error || afterDirect?.status !== 'approved') {
    ok('a creator cannot mark their own content approved straight against the table');
  } else bad('a creator approved their own content with a table update');

  /* ------------------------------------------------------------ editing -- */
  console.log('\n[3] Fixing a mistake');

  const edited = await callFn(creator, {
    action: 'content.update',
    contentId: firstId,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000002',
    adCode: 'SUITE-AD-FIXED',
    adAuthorized: true,
  });
  if (edited.ok && edited.data?.result?.ad_code === 'SUITE-AD-FIXED') {
    ok('a creator can fix their own submission while it is with the team');
  } else bad(`editing failed: ${edited.message}`);

  /* ------------------------------------------------- the team decides ---- */
  console.log('\n[4] The team decides, and the job finishes');

  const sentBack = await callFn(staff, {
    action: 'content.review',
    contentId: firstId,
    status: 'needs_another_take',
    note: 'Hook is too slow, please re-cut the first two seconds.',
  });
  if (sentBack.ok) ok('staff can ask for another take, with a note');
  else bad(`sending back failed: ${sentBack.message}`);

  const { data: afterSendBack } = await admin
    .from('content_submissions')
    .select('status, decision_note')
    .eq('id', firstId)
    .single();
  if (afterSendBack?.decision_note?.startsWith('Hook is too slow')) {
    ok('the reason is stored where the creator can read it');
  } else bad('the note did not reach the row');

  const reposted = await callFn(creator, {
    action: 'content.update',
    contentId: firstId,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000003',
    adCode: 'SUITE-AD-RECUT',
    adAuthorized: true,
  });
  const { data: afterRepost } = await admin
    .from('content_submissions')
    .select('status, decision_note')
    .eq('id', firstId)
    .single();
  if (reposted.ok && afterRepost?.status === 'submitted' && !afterRepost.decision_note) {
    ok('re-posting after a knock-back puts it back with the team and clears the reason');
  } else bad('a re-posted video kept its old rejection');

  const approveOne = await callFn(staff, {
    action: 'content.review',
    contentId: firstId,
    status: 'approved',
    note: null,
  });
  if (approveOne.ok && approveOne.data?.result?.advanced === false) {
    ok('one of two approved does NOT finish the job');
  } else bad('the job finished on the first of two videos');

  const { data: midway } = await admin
    .from('offer_applications')
    .select('stage')
    .eq('id', job)
    .single();
  if (midway?.stage === 'content_pending')
    ok('the stage is untouched while a video is missing');
  else bad(`the stage moved early, to ${midway?.stage}`);

  const lockedEdit = await callFn(creator, {
    action: 'content.update',
    contentId: firstId,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000099',
    adCode: 'SUITE-AD-SWAP',
  });
  if (!lockedEdit.ok && /approved/i.test(lockedEdit.message)) {
    ok('an approved video cannot be swapped out underneath the team');
  } else bad('an approved video was edited after approval');

  const lockedDelete = await callFn(creator, {
    action: 'content.delete',
    contentId: firstId,
  });
  if (!lockedDelete.ok) ok('an approved video cannot be removed by the creator');
  else bad('an approved video was deleted by the creator');

  const second = await callFn(creator, {
    action: 'content.create',
    applicationId: job,
    videoUrl: 'https://www.tiktok.com/@wurxsuite/video/7300000000000000004',
    adCode: 'SUITE-AD-0004',
    adAuthorized: true,
  });
  const secondId = second.data?.result?.id;
  const approveTwo = await callFn(staff, {
    action: 'content.review',
    contentId: secondId,
    status: 'approved',
    note: null,
  });
  if (approveTwo.ok && approveTwo.data?.result?.advanced === true) {
    ok('approving the LAST video finishes the job');
  } else bad('the job did not finish when the last video was approved');

  const { data: finished } = await admin
    .from('offer_applications')
    .select('stage')
    .eq('id', job)
    .single();
  /*
   * PAYMENT PENDING, not content completed. Changed 2026-08-19: the last
   * approval now says "we owe them" rather than "their work is in and being
   * checked", because the checking is the approval that just happened. The
   * stage it used to land on is still in the enum and an admin can still pick
   * it by hand; nothing lands there on its own any more.
   */
  if (finished?.stage === 'payment_pending') {
    ok('the job is at payment pending, moved by the database');
  } else bad(`the job is at ${finished?.stage}, not payment pending`);

  const { data: events } = await admin
    .from('offer_stage_events')
    .select('to_stage, note')
    .eq('application_id', job)
    .eq('to_stage', 'payment_pending');
  if ((events ?? []).length === 1) {
    ok('the creator can read why it moved, in their own timeline');
  } else bad('no stage event was written for the creator');

  const { data: audit } = await admin
    .from('audit_log')
    .select('action, detail')
    .eq('subject_id', secondId);
  if ((audit ?? []).some((a) => a.action === 'content.reviewed')) {
    ok('the decision is in the audit log');
  } else bad('the decision was not audited');

  /* ----------------------------------------------------- job_progress ---- */
  console.log('\n[5] How much of the job has been filmed, and who may ask');

  const mineProgress = await creator
    .from('job_progress')
    .select('application_id, required, approved, waiting, posted')
    .eq('application_id', job);
  const mine = mineProgress.data?.[0];
  if (mine && mine.required === 2 && mine.approved === 2) {
    ok('a creator reads their own job from job_progress, 2 of 2 approved');
  } else bad(`job_progress gave the creator ${JSON.stringify(mineProgress.data)}`);

  /*
   * THE ONE THAT MATTERS. The view is `security_invoker`, so the policies on
   * the tables underneath still decide the rows. Without that word a view runs
   * as its OWNER and hands every creator every other creator's counts.
   */
  const rivalProgress = await rival
    .from('job_progress')
    .select('application_id, required, approved')
    .eq('application_id', job);
  if ((rivalProgress.data ?? []).length === 0) {
    ok('a rival creator gets NOTHING from job_progress for a job that is not theirs');
  } else bad(`a rival read another creator's progress: ${JSON.stringify(rivalProgress.data)}`);

  // It carries no commercial column at all, so even a careless grant later
  // cannot turn it into a way to read a brand's budget.
  const commercial = await creator
    .from('job_progress')
    .select('budget_allocated, budget_used, client_name');
  if (commercial.error) {
    ok('job_progress has no budget or client column to ask for');
  } else bad('job_progress answered a question about a brand’s money');

  /* ------------------------------------------------- the terms are frozen -- */
  console.log('\n[6] The deal is frozen at approval');

  // Re-scope the offer underneath somebody already working it. This is exactly
  // what Rashid asked for on 2026-08-11: once approved, an admin must never be
  // able to change the number of deliverables on a job already agreed.
  await admin.from('offers').update({ video_count: 9, reward_amount: 999 }).eq('id', offer.id);

  const { data: frozenRow } = await admin
    .from('offer_applications')
    .select('committed_video_count, committed_amount')
    .eq('id', job)
    .single();
  const rescoped = await creator
    .from('job_progress')
    .select('required, approved')
    .eq('application_id', job);
  if (frozenRow?.committed_video_count === 2 && rescoped.data?.[0]?.required === 2) {
    ok('re-scoping the offer to 9 videos does NOT move an agreed job off 2');
  } else {
    bad(
      `the agreed count moved: job says ${frozenRow?.committed_video_count}, ` +
        `progress says ${rescoped.data?.[0]?.required}`
    );
  }
  if (Number(frozenRow?.committed_amount) !== 999) {
    ok('and re-pricing it does not move the money either');
  } else bad('re-pricing the offer rewrote what the creator was promised');

  await admin.from('offers').update({ video_count: 2, reward_amount: 200 }).eq('id', offer.id);

  /* -------------------------------------------- a job cannot get stuck ---- */
  console.log('\n[7] A job cannot be stranded at "all filmed"');

  const unApprove = await callFn(staff, {
    action: 'content.review',
    contentId: secondId,
    status: 'needs_another_take',
    note: 'On reflection the product is out of frame.',
  });
  const { data: reopened } = await admin
    .from('offer_applications')
    .select('stage')
    .eq('id', job)
    .single();
  if (unApprove.ok && reopened?.stage === 'content_pending') {
    // This is now the payment_pending case, which the old guard refused: it
    // required the job to be sitting exactly at content_completed, and since
    // 2026-08-19 the approval itself puts it a stage further on.
    ok('taking an approval back walks the job out of payment pending');
  } else {
    bad(`un-approving left the job at ${reopened?.stage} with a video missing`);
  }

  /*
   * Now strand it on purpose.
   *
   * `review_content` used to advance only from `sample_shipped` and
   * `content_pending`. A creator whose sample was never marked shipped still
   * filmed the videos, and approving the last one left the job at "sample
   * requested" forever, with nothing left to approve that could ever fix it.
   */
  await admin
    .from('offer_applications')
    .update({ stage: 'sample_requested' })
    .eq('id', job);

  const lastOne = await callFn(staff, {
    action: 'content.review',
    contentId: secondId,
    status: 'approved',
    note: null,
  });
  const { data: rescued } = await admin
    .from('offer_applications')
    .select('stage')
    .eq('id', job)
    .single();
  if (lastOne.ok && rescued?.stage === 'payment_pending') {
    ok('the last approval finishes the job from ANY stage, not just two of seven');
  } else {
    bad(`a fully filmed job was stranded at ${rescued?.stage}`);
  }

  /* ------------------------------------------------------------ browser -- */
  console.log('\n[8] The screens, in a real browser');

  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', CREATOR);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('**/app', { timeout: 30000 }).catch(() => {});

  await page.goto(BASE + '/app/content', { waitUntil: 'domcontentloaded' });
  const seen = await page
    .locator('main')
    .getByText('SUITE-AD-RECUT')
    .first()
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (seen) ok('the creator sees their own videos and ad codes on My content');
  else bad('My content did not show the creator their submissions');

  // The job board moved behind its own section on 2026-08-11: My content lands
  // on Submissions now, because the summary was taller than a viewport and you
  // had to scroll past it every time to reach the work.
  await page.goto(`${BASE}/app/content?view=dashboard`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('main')
    .getByText('What each job still needs')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});

  const covered = await page
    .locator('main')
    .getByText('All in and approved')
    .first()
    .isVisible()
    .catch(() => false);
  if (covered) ok('the job board says the job is covered');
  else bad('the job board did not report the finished job');

  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  if (process.env.SHOTS) {
    mkdirSync('.playwright', { recursive: true });
    await page.screenshot({ path: '.playwright/content-creator.png', fullPage: true });
  }
  if (!wide) ok('My content does not scroll sideways');
  else bad('My content scrolls sideways');

  // A SEPARATE context. Reusing the creator's carries their session, and
  // /admin/login redirects a signed-in visitor away from the form, so there was
  // no email field to fill and the suite died on the last check.
  const actx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const staffPage = await actx.newPage();
  staffPage.on('pageerror', (e) => errors.push(String(e)));
  await staffPage.goto(BASE + '/admin/login', { waitUntil: 'domcontentloaded' });
  await staffPage.fill('input[name="email"]', STAFF);
  await staffPage.fill('input[name="password"]', PASSWORD);
  await staffPage.getByRole('button', { name: /^sign in$/i }).click();
  await staffPage.waitForTimeout(2500);
  await staffPage.goto(BASE + '/admin/content?status=all&q=SUITE-AD-RECUT', {
    waitUntil: 'domcontentloaded',
  });
  const staffSees = await staffPage
    .locator('main')
    .getByText('SUITE-AD-RECUT')
    .first()
    .waitFor({ timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (process.env.SHOTS) {
    await staffPage.screenshot({ path: '.playwright/content-admin.png', fullPage: true });
  }
  if (staffSees) ok('the team can find a video by its ad code');
  else bad('the admin search did not find the video by ad code');

  if (errors.length === 0) ok('no console errors on either screen');
  else bad(`console errors: ${errors.slice(0, 3).join(' | ')}`);

  await actx.close();
  await ctx.close();
  await browser.close();

  /* ------------------------------------------------------------- tidy up -- */
  await admin.from('audit_log').delete().eq('subject_id', firstId);
  await admin.from('audit_log').delete().eq('subject_id', secondId);
} finally {
  /*
   * THE BRAND IS DELETED HERE, not on the last line of the try.
   *
   * It used to be up there, so any throw before it — a browser step that cannot
   * reach the preview server, which is exactly what happened on 2026-08-19 —
   * skipped the delete and left a brand and its offer on dev for ever. Rashid
   * found them when he asked what extra data was on the project.
   *
   * And every delete is CHECKED. They were all fire-and-forget, so a foreign
   * key that refused reported nothing and the row simply stayed. Order matters:
   * the accounts go first because `applications` cascades from `profiles` and
   * `profiles` cascades from `auth.users`, then the brand, which cascades its
   * own offers.
   */
  const tidy = async (what, thunk) => {
    const { error } = await thunk();
    if (error) console.error(`  LEFT BEHIND  ${what}: ${error.message}`);
  };

  for (const id of made) {
    await tidy(`audit rows for ${id}`, () =>
      admin.from('audit_log').delete().eq('actor_id', id)
    );
    await tidy(`account ${id}`, () => admin.auth.admin.deleteUser(id));
  }
  if (madeBrand.id) {
    await tidy('the suite brand', () => admin.from('brands').delete().eq('id', madeBrand.id));
  }
  console.log('\ncleaned up');
}

console.log('\n' + '='.repeat(70));
if (failures > 0) {
  console.error(`${failures} check(s) FAILED, ${passes} passed\n`);
  process.exit(1);
}
console.log(`${passes} checks passed.\n`);
