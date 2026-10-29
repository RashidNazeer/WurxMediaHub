#!/usr/bin/env node
/**
 * DEV ONLY. Penetrex's August 2026 retainer, as offers and approved requests.
 *
 * THE SOURCE IS RASHID'S OWN SPREADSHEET, the "August 26 Collabs" tab of the
 * published Penetrex retainer sheet, read on 2026-08-19. The figures below are
 * transcribed from it and reconcile against its own totals exactly:
 *
 *   41 creators      $22,250 committed      393 videos      average $57/video
 *
 * WHY THE TOTAL AND NOT THE RATE IS AUTHORITATIVE. The sheet carries both a
 * "Rate per Video ($)" and a "Monthly Cost ($)", and on five rows they disagree
 * because the rate is rounded: Simply Sarah is $73 x 15 = $1,095 against a
 * stated $1,100, Erin Cooper $133 x 15 = $1,995 against $2,000. The money that
 * has actually been committed is the monthly figure, so `reward_amount` takes
 * that and the per-video rate is shown as the sheet states it.
 *
 * WHY 31 OFFERS AND NOT 41. Rashid's call: creators on identical terms share
 * one offer, and a different rate means a different offer. That is also the
 * grain the product was built on, because terms live on the OFFER and not on
 * the request. Creators take an offer as written; the two columns that once let
 * them name their own price were dropped on 2026-07-31. So 26 of these offers
 * carry one creator and 5 are shared, the largest by six.
 *
 * IT WALKS THE REAL PATH, four functions, the same ones the admin screens call
 * through their Edge Function:
 *
 *   save_offer               the brand publishes the deal
 *   apply_for_offer          the creator asks for it
 *   review_offer_application an admin approves it, which is also what moves the
 *                            brand's committed budget
 *   set_offer_stage          each step of the seven-stage pipeline, one call per
 *                            step, so the history is real rather than a single
 *                            jump to the end
 *
 * The stage each creator lands on is the sheet's own Status column: 37 at
 * content pending, 3 at payment pending, and Sarah Hilliard paid at $500, which
 * is exactly the sheet's TOTAL PAID.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-penetrex-offers.mjs
 *   ... --clean     removes the offers again, and with them every request
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const BRAND = 'Penetrex';

/**
 * One row per creator, from the sheet.
 *
 * `total` is the committed money and `rate` is what the sheet prints per video.
 * `stage` is the sheet's Status, mapped onto our pipeline:
 * Content in Progress -> content_pending, Payment Pending -> payment_pending,
 * Completed -> paid.
 */
const DEALS = [
  {
    handle: 'xxkissnoblissxx',
    name: 'Graycie-Lea J Kosz',
    rate: 35,
    videos: 15,
    total: 525,
    stage: 'content_pending',
  },
  {
    handle: 'babblingbrookej',
    name: 'Brooke Jackson',
    rate: 40,
    videos: 10,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'aarontopfinds',
    name: 'Aaron Finds',
    rate: 40,
    videos: 10,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'blahitsmebri',
    name: 'Brianna',
    rate: 40,
    videos: 5,
    total: 200,
    stage: 'content_pending',
  },
  {
    handle: 'nikkistiktokshop',
    name: 'Nikki Wilson',
    rate: 60,
    videos: 10,
    total: 600,
    stage: 'content_pending',
  },
  {
    handle: 'lowbacklab',
    name: 'Gunnar',
    rate: 160,
    videos: 10,
    total: 1600,
    stage: 'content_pending',
  },
  {
    handle: 'honestfindswithjen',
    name: 'Jen Honest',
    rate: 30,
    videos: 15,
    total: 450,
    stage: 'content_pending',
  },
  {
    handle: 'simplysarah.daily',
    name: 'Simply Sarah',
    rate: 73,
    videos: 15,
    total: 1100,
    stage: 'content_pending',
  },
  {
    handle: 'deal.dasher1',
    name: 'Andrew Poyant',
    rate: 83,
    videos: 6,
    total: 500,
    stage: 'content_pending',
  },
  {
    handle: 'vsternau',
    name: 'Victoria Sternu',
    rate: 33,
    videos: 12,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'briceyscarbear',
    name: 'Brice',
    rate: 35,
    videos: 10,
    total: 350,
    stage: 'payment_pending',
  },
  {
    handle: 'erinragancooper',
    name: 'Erin Cooper',
    rate: 133,
    videos: 15,
    total: 2000,
    stage: 'content_pending',
  },
  {
    handle: 'betterbybrian',
    name: 'Brian',
    rate: 150,
    videos: 10,
    total: 1500,
    stage: 'content_pending',
  },
  {
    handle: 'daniloshopfinds',
    name: 'Danilo',
    rate: 70,
    videos: 5,
    total: 350,
    stage: 'content_pending',
  },
  {
    handle: 'kylieehughess',
    name: 'Kylie Hughes',
    rate: 50,
    videos: 10,
    total: 500,
    stage: 'content_pending',
  },
  {
    handle: 'gmoneyh0',
    name: 'Grayson',
    rate: 31,
    videos: 10,
    total: 310,
    stage: 'content_pending',
  },
  {
    handle: 'edvivesshop',
    name: 'Ed',
    rate: 30,
    videos: 10,
    total: 300,
    stage: 'content_pending',
  },
  {
    handle: 'premiumpicks.1',
    name: 'Joel',
    rate: 42,
    videos: 10,
    total: 420,
    stage: 'content_pending',
  },
  {
    handle: 'lhdeals4225',
    name: 'Luke',
    rate: 24,
    videos: 10,
    total: 240,
    stage: 'content_pending',
  },
  {
    handle: 'sassy_relatable',
    name: 'karlie',
    rate: 54,
    videos: 5,
    total: 270,
    stage: 'content_pending',
  },
  {
    handle: 'slavicglowupsecrets',
    name: 'lana',
    rate: 70,
    videos: 5,
    total: 350,
    stage: 'content_pending',
  },
  {
    handle: 'jayden_smith4',
    name: 'Jayden Smith',
    rate: 60,
    videos: 5,
    total: 300,
    stage: 'content_pending',
  },
  {
    handle: 'hilary_reviews',
    name: 'Hailry',
    rate: 54,
    videos: 5,
    total: 270,
    stage: 'content_pending',
  },
  {
    handle: 'viraldealshunter',
    name: 'Juan',
    rate: 30,
    videos: 10,
    total: 300,
    stage: 'content_pending',
  },
  {
    handle: 'niknak2188',
    name: 'Nik',
    rate: 45,
    videos: 10,
    total: 450,
    stage: 'content_pending',
  },
  {
    handle: 'norms.finds',
    name: 'Normali Jack',
    rate: 90,
    videos: 5,
    total: 450,
    stage: 'content_pending',
  },
  {
    handle: 'holistic.rx',
    name: 'Selena',
    rate: 60,
    videos: 10,
    total: 600,
    stage: 'content_pending',
  },
  {
    handle: 'jeniffersaluzzo',
    name: 'Jennifer Saluzzo',
    rate: 32,
    videos: 10,
    total: 320,
    stage: 'content_pending',
  },
  {
    handle: 'pricejustdropped',
    name: 'Briana Wilczynski',
    rate: 40,
    videos: 10,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'vivianiempire_',
    name: 'Vivian',
    rate: 40,
    videos: 10,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'dannydailyfinds',
    name: 'Danny',
    rate: 40,
    videos: 20,
    total: 800,
    stage: 'content_pending',
  },
  {
    handle: 'willzzshop',
    name: 'Will',
    rate: 125,
    videos: 10,
    total: 1250,
    stage: 'content_pending',
  },
  {
    handle: 'luisferdeals',
    name: 'Luisfer',
    rate: 120,
    videos: 5,
    total: 600,
    stage: 'content_pending',
  },
  {
    handle: 'ka.devore',
    name: 'Kelle Ann Devora',
    rate: 40,
    videos: 10,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'neptunenavigates',
    name: 'Kelly Neptune',
    rate: 30,
    videos: 10,
    total: 300,
    stage: 'content_pending',
  },
  {
    handle: 'morgansocialco',
    name: 'Morgan',
    rate: 42,
    videos: 10,
    total: 415,
    stage: 'content_pending',
  },
  {
    handle: 'pandanamonium',
    name: 'Dana Smith',
    rate: 40,
    videos: 15,
    total: 600,
    stage: 'content_pending',
  },
  {
    handle: 'anti_job_aholic',
    name: 'Sal',
    rate: 40,
    videos: 10,
    total: 400,
    stage: 'content_pending',
  },
  {
    handle: 'johnhidalgo26',
    name: 'John',
    rate: 48,
    videos: 10,
    total: 480,
    stage: 'payment_pending',
  },
  {
    handle: 'life_w_boyz',
    name: 'Shannon',
    rate: 50,
    videos: 5,
    total: 250,
    stage: 'payment_pending',
  },
  {
    handle: 'sarahshopsss',
    name: 'Sarah Hilliard',
    rate: 100,
    videos: 5,
    total: 500,
    stage: 'paid',
  },
];

/**
 * The seven stages, in order. Walking them one at a time is deliberate: it
 * writes a real `offer_stage_events` trail, so a creator's tracker shows how
 * the work actually moved rather than appearing fully formed at the end.
 */
const STAGES = [
  'pending_request',
  'sample_requested',
  'sample_shipped',
  'content_pending',
  'content_completed',
  'payment_pending',
  'paid',
];

/* ------------------------------------------------------------------ setup -- */
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) {
  console.error(
    '\nSUPABASE_SERVICE_KEY is not set. Fetch it at run time from the CLI, never\n' +
      'from a file. See docs/OPERATIONS.md.\n'
  );
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Creates and deletes data. Dev only, checked before the client exists.
assertDevProject(env.VITE_SUPABASE_URL, 'seed-penetrex-offers.mjs');

const db = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const CLEAN = process.argv.includes('--clean');
const money = (n) => '$' + Number(n).toLocaleString();

/**
 * Recompute a brand's committed budget from the requests that actually exist.
 *
 * NOT OPTIONAL, AND NOT DECORATION. `brand_commercials.budget_used` is a
 * running total that `review_offer_application` adds to on approval. It has no
 * foreign key and no cascade, so deleting offers straight out of the table
 * leaves the money behind: the first --clean here left the whole 22,250
 * committed to offers that no longer existed, and re-seeding on top read
 * 44,500 against a 23,000 budget. Nothing errored. Nothing ever does.
 *
 * So both paths through this script end here, and the number is derived
 * rather than trusted.
 */
async function reconcile(brandId) {
  const { data: rows, error } = await db
    .from('offer_applications')
    .select('committed_amount')
    .eq('brand_id', brandId)
    .eq('status', 'approved');
  if (error) throw new Error(`could not read the approved requests: ${error.message}`);

  // Rounded to pennies: the column is numeric(14,2) and a floating point tail
  // would be written straight back as drift of its own.
  const truth =
    Math.round(
      (rows ?? []).reduce((total, r) => total + Number(r.committed_amount ?? 0), 0) * 100
    ) / 100;

  const { error: upErr } = await db
    .from('brand_commercials')
    .update({ budget_used: truth })
    .eq('brand_id', brandId);
  if (upErr) throw new Error(`could not correct the budget: ${upErr.message}`);
  return truth;
}

/* --------------------------------------------------------------- the brand -- */
const { data: brand, error: brandErr } = await db
  .from('brands')
  .select('id, name')
  .eq('name', BRAND)
  .maybeSingle();
if (brandErr) throw new Error(`could not read brands: ${brandErr.message}`);
if (!brand) {
  console.error(`\nNo brand called ${BRAND} exists. Create it first.\n`);
  process.exit(1);
}

/* -------------------------------------------------------------- the actor -- */
const { data: staff, error: staffErr } = await db
  .from('profiles')
  .select('id, email, role')
  .in('role', ['admin', 'ops'])
  .eq('is_active', true)
  .order('created_at');
if (staffErr) throw new Error(`could not find an admin: ${staffErr.message}`);

const actor =
  (staff ?? []).find((s) => s.email === 'rashid@wurxmedia.com') ??
  (staff ?? []).find((s) => s.role === 'admin') ??
  (staff ?? [])[0];
if (!actor) {
  console.error('\nNo active admin exists, so nobody can publish or approve.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ clean -- */
/*
 * Deleting the offers is the whole cleanup: offer_applications, their stage
 * events and any content submitted against them all cascade. `delete_offer()`
 * is deliberately NOT used, because it refuses any offer carrying a live
 * request, which is every one of these.
 */
if (CLEAN) {
  const { count, error } = await db
    .from('offers')
    .delete({ count: 'exact' })
    .eq('brand_id', brand.id);
  if (error) throw new Error(`could not remove the offers: ${error.message}`);
  const left = await reconcile(brand.id);
  console.log(
    `\n  ${count ?? 0} ${BRAND} offers removed, with their requests.\n` +
      `  Committed budget recomputed to ${money(left)}.\n`
  );
  process.exit(0);
}

/* ----------------------------------------------------------- who they are -- */
/*
 * Every deal must match a real account before anything is written, so a typo in
 * a handle stops the run rather than silently seeding 40 of 41.
 */
const handles = DEALS.map((d) => d.handle);
const emails = handles.map((h) => `${h}@wurxmedia.com`);
const { data: people, error: peopleErr } = await db
  .from('profiles')
  .select('id, email, display_name, role')
  .in('email', emails);
if (peopleErr) throw new Error(`could not read the creators: ${peopleErr.message}`);

const byHandle = new Map();
for (const p of people ?? []) byHandle.set(p.email.replace('@wurxmedia.com', ''), p);

const missing = handles.filter((h) => !byHandle.has(h));
if (missing.length) {
  console.error(
    `\n${missing.length} of the ${handles.length} creators do not exist yet:\n  ` +
      missing.join('\n  ') +
      `\n\nRun scripts/seed/seed-creators.mjs first.\n`
  );
  process.exit(1);
}

console.log(`\nPenetrex retainer, August 2026\n${'='.repeat(70)}`);
console.log(`  brand    ${brand.name}`);
console.log(`  actor    ${actor.email}`);
console.log(`  creators ${handles.length}`);
console.log(
  `  money    ${money(DEALS.reduce((a, d) => a + d.total, 0))} across ` +
    `${DEALS.reduce((a, d) => a + d.videos, 0)} videos\n`
);

/* ------------------------------------------------------------- real names -- */
/*
 * A real sign-up records the TikTok handle as the display name, because that is
 * all the form asks for. The sheet carries the person's actual name, which is
 * what an admin would have filled in afterwards, so the screens read as a list
 * of people rather than a list of usernames. The handle itself is untouched: it
 * still lives on their application and is shown beside the name.
 */
let renamed = 0;
for (const deal of DEALS) {
  const person = byHandle.get(deal.handle);
  if (!deal.name || person.display_name === deal.name) continue;
  const { error } = await db
    .from('profiles')
    .update({ display_name: deal.name })
    .eq('id', person.id);
  if (error) throw new Error(`renaming ${deal.handle} failed: ${error.message}`);
  renamed += 1;
}
console.log(`  ${renamed} creators now show their real name\n`);

/* ---------------------------------------------------------------- offers -- */
/*
 * Grouped by the terms themselves. Two creators share an offer when, and only
 * when, the money and the video count are identical.
 */
const groups = new Map();
for (const deal of DEALS) {
  const key = `${deal.total}/${deal.videos}`;
  if (!groups.has(key)) {
    groups.set(key, { total: deal.total, videos: deal.videos, rate: deal.rate, deals: [] });
  }
  groups.get(key).deals.push(deal);
}

const shared = [...groups.values()].filter((g) => g.deals.length > 1).length;
console.log(`  ${groups.size} offers to publish, ${shared} of them shared\n`);

let offersMade = 0;
let approved = 0;
let moves = 0;
const problems = [];

for (const group of [...groups.values()].sort((a, b) => b.total - a.total)) {
  const plural = group.videos === 1 ? '' : 's';
  /*
   * The total is in the title as well as the rate, because two groups can round
   * to the same rate and not be the same deal: 420 and 415 over ten videos are
   * both "42 a video", and two offers with identical titles is how an admin
   * approves somebody onto the wrong one.
   */
  const title =
    `Penetrex retainer, ${group.videos} video${plural}, ${money(group.total)} ` +
    `at ${money(group.rate)} a video`;
  const description =
    `${group.videos} video${plural} for Penetrex over the month, paid ${money(group.total)} in ` +
    `total at ${money(group.rate)} a video. A sample is shipped to you and it is yours to keep. ` +
    `Post to your own account and add each link here as you go.`;

  const { data: made, error: offerErr } = await db.rpc('save_offer', {
    p_actor_id: actor.id,
    p_brand_id: brand.id,
    p_title: title,
    p_video_count: group.videos,
    p_reward_amount: group.total,
    p_description: description,
    p_needs_application: true,
  });
  if (offerErr) {
    problems.push(`offer "${title}": ${offerErr.message}`);
    console.error(`  FAIL  ${title}  ${offerErr.message}`);
    continue;
  }
  offersMade += 1;
  const offerId = made?.id ?? made?.offer?.id ?? made;

  const names = group.deals.map((d) => d.name || d.handle).join(', ');
  console.log(
    `  ${title.padEnd(46)} ${String(group.deals.length).padStart(2)}  ${names.slice(0, 58)}`
  );

  for (const deal of group.deals) {
    const person = byHandle.get(deal.handle);
    try {
      /* -- the creator asks ------------------------------------------------ */
      const { data: applied, error: applyErr } = await db.rpc('apply_for_offer', {
        p_actor_id: person.id,
        p_offer_id: offerId,
        p_note: null,
      });
      if (applyErr) throw new Error(`apply: ${applyErr.message}`);
      const applicationId = applied?.id ?? applied?.application?.id ?? applied;

      /* -- the admin approves ---------------------------------------------- */
      /*
       * This is also what moves the brand's committed budget, so there is no
       * separate reconcile to remember afterwards.
       */
      const { error: reviewErr } = await db.rpc('review_offer_application', {
        p_actor_id: actor.id,
        p_application_id: applicationId,
        p_decision: 'approved',
        p_note: null,
        p_stage: 'pending_request',
      });
      if (reviewErr) throw new Error(`approve: ${reviewErr.message}`);
      approved += 1;

      /* -- and the work moves ---------------------------------------------- */
      const target = STAGES.indexOf(deal.stage);
      if (target < 0) throw new Error(`unknown stage ${deal.stage}`);
      for (let i = 1; i <= target; i++) {
        const { error: stageErr } = await db.rpc('set_offer_stage', {
          p_actor_id: actor.id,
          p_application_id: applicationId,
          p_stage: STAGES[i],
          p_note: null,
        });
        if (stageErr) throw new Error(`stage ${STAGES[i]}: ${stageErr.message}`);
        moves += 1;
      }
    } catch (e) {
      problems.push(`${deal.handle}: ${e.message}`);
      console.error(`        FAIL  ${deal.handle}  ${e.message}`);
    }
  }
}

/* ------------------------------------------------------------------ proof -- */
const countOf = async (table, filters = (q) => q) => {
  const { count } = await filters(db.from(table).select('*', { count: 'exact', head: true }));
  return count ?? 0;
};

const offerRows = await countOf('offers', (q) => q.eq('brand_id', brand.id));
const appRows = await countOf('offer_applications', (q) => q.eq('brand_id', brand.id));
const approvedRows = await countOf('offer_applications', (q) =>
  q.eq('brand_id', brand.id).eq('status', 'approved')
);
const eventRows = await countOf('offer_stage_events');

const { data: stageRows } = await db
  .from('offer_applications')
  .select('stage')
  .eq('brand_id', brand.id)
  .eq('status', 'approved');
const byStage = {};
for (const r of stageRows ?? []) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;

const committed = await reconcile(brand.id);

const { data: commercial } = await db
  .from('brand_commercials')
  .select('budget_allocated, budget_used, budget_used_percent')
  .eq('brand_id', brand.id)
  .maybeSingle();

const expected = DEALS.reduce((a, d) => a + d.total, 0);
if (committed !== expected) {
  problems.push(
    `committed budget is ${money(committed)} but the sheet says ${money(expected)}`
  );
}

console.log(`\n${'='.repeat(70)}`);
console.log(
  `  ${offersMade} offers published, ${approved} requests approved, ${moves} stage moves`
);
console.log(
  `  in the database: ${offerRows} offers, ${appRows} requests ` +
    `(${approvedRows} approved), ${eventRows} stage events`
);
console.log(`  by stage: ${JSON.stringify(byStage)}`);
if (commercial) {
  console.log(
    `  ${BRAND} budget: ${money(commercial.budget_used)} used of ` +
      `${money(commercial.budget_allocated)}  (${commercial.budget_used_percent}%)`
  );
}
console.log('');

if (problems.length) {
  console.error(`  ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 15)) console.error(`    ${p}`);
  console.error('');
  process.exit(1);
}
