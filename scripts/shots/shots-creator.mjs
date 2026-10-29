#!/usr/bin/env node
/**
 * Design-review screenshots of the CREATOR HOME, with data in it.
 *
 * `shots.mjs` can only photograph public pages. The screen that actually needs
 * reviewing is behind a login and is empty until somebody has been approved
 * onto real work, so this builds a creator with a full pipeline, photographs
 * their dashboard in both themes at four widths, and then removes everything
 * it made.
 *
 * It writes `offer_applications` DIRECTLY rather than through
 * `review_offer_application`, on purpose: the real function charges the offer
 * to the brand's budget, and a throwaway creator made for a screenshot must
 * never move a number an admin is reading. Nothing here touches
 * `brand_commercials`, so budgets cannot drift. A previous screenshot script
 * did drift them, and putting three brands back by hand is not a thing to
 * repeat.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/shots/shots-creator.mjs [baseUrl]
 *
 * Needs demo brands. Run `node scripts/seed/seed-brands.mjs` first if there are none.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { launchBrowser } from '../lib/browser.mjs';
import { assertDevProject } from '../lib/dev-guard.mjs';

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
assertDevProject(env.VITE_SUPABASE_URL, 'shots-creator.mjs');

const BASE = process.argv[2] ?? 'http://localhost:4173';
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const OUT = '.playwright';
mkdirSync(OUT, { recursive: true });

const PASSWORD = 'shots-only-dev-password-1';
const WORKING = 'shots-working@wurxmediahub.test';
const FIRSTDAY = 'shots-firstday@wurxmediahub.test';
const made = [];

const VIEWS = [
  { name: '1440', width: 1440, height: 1000 },
  { name: '1024', width: 1024, height: 900 },
  { name: '768', width: 768, height: 1000 },
  { name: '375', width: 375, height: 900 },
];

/* ------------------------------------------------------------------ setup -- */

/**
 * One database call, retried.
 *
 * Not defensive padding: this machine's link to Supabase drops a connection
 * every so often and surfaces it as `TypeError: fetch failed`, which killed
 * two runs of this script at different points. A screenshot tool that leaves
 * a throwaway account behind because a packet went missing is worse than a
 * slow one, and the label is what turns the next failure into a location.
 */
async function step(label, fn, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data, error } = await fn();
      if (error) throw error;
      return data;
    } catch (err) {
      const transient = /fetch failed|timeout|ECONN|socket/i.test(String(err?.message ?? err));
      if (!transient || attempt >= tries) {
        throw new Error(`${label}: ${err?.message ?? err}`);
      }
      console.log(`  ${label} failed (${err.message}), retry ${attempt}/${tries - 1}`);
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }
}

async function makeCreator(email, displayName, handle) {
  const data = await step('create account', () =>
    admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  );
  const id = data.user.id;
  made.push(id);

  const now = new Date().toISOString();
  await step('set the profile to an approved creator', () =>
    admin
      .from('profiles')
      .update({
        role: 'creator',
        tier: 'rising',
        display_name: displayName,
        is_active: true,
        // Both moments already spent, so neither overlay covers a screenshot.
        welcomed_at: now,
        approval_celebrated_at: now,
      })
      .eq('id', id)
  );

  await step('store their application', () =>
    admin.from('applications').insert({
      user_id: id,
      tiktok_handle: handle,
      niche: 'Beauty & skincare',
      worked_with_wurx: false,
      video_links: 'https://www.tiktok.com/@example/video/1234567890',
      status: 'approved',
      reviewed_at: now,
    })
  );

  return id;
}

/** One request, written straight in, plus the history behind it. */
async function addWork(creatorId, offer, { status, stage, amount, daysAgo, note }) {
  const created = new Date(Date.now() - daysAgo * 864e5).toISOString();
  const row = await step(`add ${status} work on "${offer.title}"`, () =>
    admin
      .from('offer_applications')
      .insert({
        offer_id: offer.id,
        brand_id: offer.brand_id,
        creator_id: creatorId,
        creator_handle: 'shotscreator',
        creator_name: 'Maya Ellison',
        creator_email: WORKING,
        status,
        stage,
        committed_amount: status === 'approved' ? amount : null,
        // The other half of the deal, snapshotted the same way the real
        // approval does it, so the photographed screens draw a real bar
        // rather than an empty one.
        committed_video_count: status === 'approved' ? (offer.video_count ?? null) : null,
        currency: offer.currency ?? 'USD',
        decision_note: note ?? null,
        decided_at: status === 'pending' ? null : created,
        created_at: created,
      })
      .select('id')
      .single()
  );
  if (status !== 'approved' || !stage) return;

  // Walk the pipeline up to wherever it has got to, so the timeline reads like
  // a real one rather than a single jump.
  const ORDER = [
    'pending_request',
    'sample_requested',
    'sample_shipped',
    'content_pending',
    'content_completed',
    'payment_pending',
    'paid',
  ];
  const upto = ORDER.indexOf(stage);
  const events = ORDER.slice(0, upto + 1).map((to, i) => ({
    application_id: row.id,
    creator_id: creatorId,
    from_stage: i === 0 ? null : ORDER[i - 1],
    to_stage: to,
    note: to === 'sample_shipped' ? 'Tracking sent to your email.' : null,
    created_at: new Date(Date.now() - (daysAgo - i * 2) * 864e5).toISOString(),
  }));
  await step('record the stage history', () => admin.from('offer_stage_events').insert(events));
}

/* ------------------------------------------------------------------ shots -- */

async function signIn(page, email, view = '') {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('**/app', { timeout: 30000 }).catch(() => {});
  if (view) {
    await page.goto(`${BASE}/app?view=${view}`, { waitUntil: 'domcontentloaded' });
  }
  const hello = page.getByRole('button', { name: /let.s go/i });
  if (
    await hello
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await hello.first().click();
  }
  // Wait for the content, never a fixed sleep before it: the first render is
  // skeletons and photographing those defeats the point.
  await page
    .locator('main')
    .getByText(/agreed with you so far|nothing taken yet|stage by stage/i)
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

async function shoot(browser, email, label, appView = '') {
  for (const scheme of ['dark', 'light']) {
    for (const view of VIEWS) {
      const ctx = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: 2,
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));

      await signIn(page, email, appView);

      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      const file = `${OUT}/creator-${label}-${scheme}-${view.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log(
        `  wrote ${file}${wide ? '   <-- SIDEWAYS SCROLL' : ''}` +
          (errors.length ? `   <-- ${errors.length} console error(s): ${errors[0]}` : '')
      );
      await ctx.close();
    }
  }
}

/* ----------------------------------------------------------------- run ----- */

async function cleanup() {
  for (const id of made) {
    await admin.from('audit_log').delete().eq('actor_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  console.log(`\nRemoved ${made.length} throwaway account(s).`);
}

try {
  const offers = await step('read the live offers', () =>
    admin
      .from('offers')
      .select(
        'id, brand_id, title, video_count, reward_amount, currency, needs_application, status'
      )
      .eq('status', 'active')
      .order('reward_amount', { ascending: false })
  );

  const askable = (offers ?? []).filter((o) => o.needs_application);
  if (askable.length < 4) {
    throw new Error(
      `Only ${askable.length} live offers need applying for. Run scripts/seed/seed-brands.mjs first.`
    );
  }

  console.log('\nBuilding a creator with a full pipeline');
  const working = await makeCreator(WORKING, 'Maya Ellison', 'shotscreator');

  // Spread across the pipeline so every colour in the flow bar has something
  // in it and the tracker shows different positions down the list.
  const plan = [
    { stage: 'sample_shipped', daysAgo: 8 },
    { stage: 'content_pending', daysAgo: 22 },
    { stage: 'payment_pending', daysAgo: 40 },
    { stage: 'paid', daysAgo: 60 },
  ];
  for (let i = 0; i < plan.length; i++) {
    const offer = askable[i % askable.length];
    await addWork(working, offer, {
      status: 'approved',
      stage: plan[i].stage,
      amount: Number(offer.reward_amount ?? 250),
      daysAgo: plan[i].daysAgo,
    });
  }
  if (askable[4]) {
    await addWork(working, askable[4], { status: 'pending', daysAgo: 3 });
  }
  if (askable[5]) {
    await addWork(working, askable[5], {
      status: 'rejected',
      daysAgo: 12,
      note: 'We have filled this one for now. Come back for the winter push.',
    });
  }

  console.log('Building a creator on their first day');
  await makeCreator(FIRSTDAY, 'Sam Okoye', 'shotsfirstday');

  const browser = await launchBrowser();
  console.log('\nWorking dashboard');
  await shoot(browser, WORKING, 'working');
  console.log('\nPipeline view');
  await shoot(browser, WORKING, 'pipeline', 'pipeline');
  console.log('\nFirst day');
  await shoot(browser, FIRSTDAY, 'firstday');
  await browser.close();
} finally {
  await cleanup();
}

console.log('done\n');
