#!/usr/bin/env node
/**
 * DEV ONLY. One demo creator with a full, believable history, so the creator
 * screens can be looked at with data in them instead of empty states.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/seed-demo-creator.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/seed-demo-creator.mjs --clean
 *
 * Rashid, 2026-10-10: "create a new creator 'rudely' and fill some dummy data
 * ... multiple offers for her and like approved from admin and his money his
 * videos etc ... i updated the ui and wanna see changes how will they look
 * when we have the data".
 *
 * ── IT WALKS THE REAL PATH, LIKE `seed-creators.mjs` ─────────────────────
 * Every row is written by the function the product itself calls, never by
 * hand: `review_application`, `save_offer`, `apply_for_offer`,
 * `review_offer_application`, `set_offer_stage`, `submit_content`,
 * `review_content`. A creator assembled by direct inserts looks right in the
 * tables and wrong on the screens — no audit trail, no stage events, no
 * committed budget — and the screens are the whole point of this script.
 *
 * ── IT LEAVES PENETREX ALONE, DELIBERATELY ──────────────────────────────
 * Penetrex is the only brand on dev with real commercials and it has $350 free
 * of $23,000 — that is Rashid's actual August retainer and this demo has no
 * business spending it. The work below goes to other brands, and a brand with
 * NO commercials row gets one; a brand that already has one is never edited.
 *
 * ── WHAT SHE ENDS UP WITH ───────────────────────────────────────────────
 * Three jobs across three brands, deliberately at different stages so the
 * money card has something in all three cells rather than two zeros: one paid,
 * one approved and awaiting payment, one still being filmed. Videos against
 * each, some approved and one still with the team, and real ad figures behind
 * them so My numbers shows GMV, spend, orders and ROI rather than an empty
 * state.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const CLEAN = process.argv.includes('--clean');
const HANDLE = process.env.DEMO_HANDLE || 'rudely';
const EMAIL = `${HANDLE}@wurxmedia.com`;
const PASSWORD = '1234567890';          /* the same as every other dev creator */
const TIER = 'rising';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(Boolean)
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }

/* THE DEV GUARD. This writes data; it must never be pointed at production. */
const PROD = 'isqepjioowzqoyhlusqo';
if (URL_.includes(PROD)) {
  console.error('REFUSING: that is the production project. This script seeds demo data.');
  process.exit(1);
}
console.log(`project: ${URL_}`);

const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const day = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);

/* ── who approves. A real approval is somebody's decision, and the RPCs
      refuse an actor who is not active staff. ──────────────────────────── */
const { data: staff } = await db.from('profiles')
  .select('id, email, role').in('role', ['admin', 'ops']).eq('is_active', true).limit(50);
const actor = (staff || []).find((s) => s.email === 'rashid@wurxmedia.com') || (staff || [])[0];
if (!actor) { console.error('no active admin or ops account to act as'); process.exit(1); }
console.log(`acting as: ${actor.email} (${actor.role})`);

/* ── find her, if she is already here ───────────────────────────────────── */
const findUser = async () => {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = (data?.users || []).find((u) => (u.email || '').toLowerCase() === EMAIL);
    if (hit) return hit;
    if ((data?.users || []).length < 200) return null;
  }
  return null;
};

/* ══════════════════════════════ CLEAN ══════════════════════════════════ */
if (CLEAN) {
  const user = await findUser();
  if (!user) { console.log(`${EMAIL} is not here. Nothing to remove.`); process.exit(0); }

  /* Her offers are hers alone (one offer per job, made for this demo), so
     removing them removes the requests and the stage events with them. */
  const { data: mine } = await db.from('offer_applications')
    .select('offer_id, brand_id').eq('creator_id', user.id);
  const offerIds = [...new Set((mine || []).map((r) => r.offer_id).filter(Boolean))];
  const brandIds = [...new Set((mine || []).map((r) => r.brand_id).filter(Boolean))];

  await db.from('content_submissions').delete().eq('creator_id', user.id);
  if (offerIds.length) await db.from('offers').delete().in('id', offerIds);
  await db.from('offer_applications').delete().eq('creator_id', user.id);
  await db.from('applications').delete().eq('user_id', user.id);
  await db.auth.admin.deleteUser(user.id);

  /*
   * AND PUT THE COMMITTED BUDGET BACK. `brand_commercials.budget_used` is a
   * running total with no cascade: delete the offers and the money stays
   * committed to nothing. That has already happened once on this project and
   * left $22,250 spent against rows that no longer existed.
   */
  for (const brandId of brandIds) {
    const { data: left } = await db.from('offer_applications')
      .select('committed_amount').eq('brand_id', brandId).eq('status', 'approved');
    const truth = (left || []).reduce((n, r) => n + (Number(r.committed_amount) || 0), 0);
    await db.from('brand_commercials').update({ budget_used: truth }).eq('brand_id', brandId);
    console.log(`  recomputed committed budget for ${brandId}: ${money(truth)}`);
  }
  /* And the brands this script invented, but ONLY if nobody else has come to
     depend on them since. A brand with somebody's work against it is not this
     script's to delete. */
  const { data: demoBrands } = await db.from('brands')
    .select('id, name').eq('client_name', 'Demo data (seed-demo-creator)');
  for (const b of demoBrands || []) {
    const { count } = await db.from('offer_applications')
      .select('id', { count: 'exact', head: true }).eq('brand_id', b.id);
    if (count && count > 0) { console.log(`  kept ${b.name}: ${count} request(s) still against it`); continue; }
    await db.from('brand_commercials').delete().eq('brand_id', b.id);
    const { error } = await db.from('brands').delete().eq('id', b.id);
    console.log(error ? `  kept ${b.name}: ${error.message}` : `  removed the demo brand ${b.name}`);
  }

  console.log(`\nRemoved ${EMAIL} and everything of hers.`);
  process.exit(0);
}

/* ══════════════════════════════ SEED ═══════════════════════════════════ */

/* ── 1. the account, by the path a real registration takes ──────────────── */
let user = await findUser();
if (user) {
  console.log(`${EMAIL} already exists — reusing it.`);
} else {
  const { data: made, error } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    /* `display_name` is the one key `handle_new_user()` reads. Omit it and the
       profile is nameless everywhere it is shown. */
    user_metadata: { display_name: HANDLE },
  });
  if (error) { console.error(`could not create the account: ${error.message}`); process.exit(1); }
  user = made.user;
  console.log(`created ${EMAIL}`);
}

/* ── 2. her application, then a real approval ───────────────────────────── */
let { data: app } = await db.from('applications')
  .select('id, status').eq('user_id', user.id).maybeSingle();
if (!app) {
  const { data: made, error } = await db.from('applications').insert({
    user_id: user.id,
    tiktok_handle: HANDLE,
    niche: 'beauty',
    niche_other: null,
    worked_with_wurx: false,
    video_links: `https://www.tiktok.com/@${HANDLE}`,
  }).select('id, status').single();
  if (error) { console.error(`application: ${error.message}`); process.exit(1); }
  app = made;
  console.log('application filed');
}
if (app.status !== 'approved') {
  const { error } = await db.rpc('review_application', {
    p_application_id: app.id, p_decision: 'approved', p_actor_id: actor.id,
    p_tier: TIER, p_note: null,
  });
  if (error) { console.error(`approval: ${error.message}`); process.exit(1); }
  console.log(`approved as a ${TIER} creator`);
}
/* An OLD creator, so she does not get the you-are-approved celebration. */
await db.from('profiles').update({
  welcomed_at: new Date(Date.now() - 60 * 86400000).toISOString(),
  approval_celebrated_at: new Date(Date.now() - 60 * 86400000).toISOString(),
}).eq('id', user.id);

/* ── 3. brands to work with, leaving Penetrex's real budget alone ───────── */
/*
 * ONLY PENETREX EXISTS CREATOR-SIDE, and it has $350 free of a $23,000 budget
 * that is Rashid's real August retainer. Spending that on a demo would make
 * the Brands screen read over-allocated and quietly corrupt a real figure.
 *
 * So the demo brings its own brands, created through `save_brand` exactly as
 * the admin screen does — which opens their commercials in the same call —
 * and marked with a client name `--clean` can find again. They are real Wurx
 * brand names that already exist on the Paid Collabs side, so nothing
 * invented appears on screen.
 */
const DEMO_CLIENT = 'Demo data (seed-demo-creator)';
const WANTED = ['Aurelia', 'Dr Tobias', 'Swisse'];
const { data: existingBrands } = await db.from('brands').select('id, name, slug').order('name');
let allBrands = existingBrands || [];
for (const name of WANTED) {
  if (allBrands.some((b) => b.name.toLowerCase() === name.toLowerCase())) continue;
  const { error } = await db.rpc('save_brand', {
    p_actor_id: actor.id,
    p_name: name,
    /* `demo-` is this project's convention for a seeded store id, and it
       gives --clean a second marker besides the client name. */
    p_store_id: `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    p_brand_id: null,
    p_client_name: DEMO_CLIENT,
    p_budget: 10000,
    p_currency: 'USD',
    p_is_active: true,
  });
  if (error) console.log(`  (could not create ${name}: ${error.message})`);
  else console.log(`  created the brand ${name} with a $10,000 budget`);
}
({ data: allBrands } = await db.from('brands').select('id, name, slug').order('name'));

const { data: commercials } = await db.from('brand_commercials').select('brand_id, budget_allocated, budget_used');
const hasCommercials = new Set((commercials || []).map((c) => c.brand_id));
/* Penetrex is excluded on purpose: see above. */
const usable = (allBrands || []).filter((b) => !/penetrex/i.test(b.name));
if (usable.length < 1) { console.error('no brands to work with'); process.exit(1); }

const JOBS = [
  { videos: 6, rate: 55, stage: 'paid',             done: 6, waiting: 0 },
  { videos: 5, rate: 70, stage: 'payment_pending',  done: 5, waiting: 0 },
  { videos: 8, rate: 45, stage: 'content_pending',  done: 3, waiting: 2 },
];
const picked = usable.slice(0, JOBS.length);
console.log(`\nbrands: ${picked.map((b) => b.name).join(', ')}`);

const STAGES = ['pending_request', 'sample_requested', 'sample_shipped',
  'content_pending', 'content_completed', 'payment_pending', 'paid'];

const madeJobs = [];
/* Already hers? Then this is a re-run, and a second offer for the same brand
   would double her money rather than restore it. */
const { data: alreadyHers } = await db.from('offer_applications')
  .select('brand_id').eq('creator_id', user.id);
const worksWith = new Set((alreadyHers || []).map((r) => r.brand_id));

for (const [i, brand] of picked.entries()) {
  const job = JOBS[i];
  const total = job.videos * job.rate;
  if (worksWith.has(brand.id)) {
    console.log(`  ${brand.name}: already hers, left alone`);
    const { data: existing } = await db.from('offer_applications')
      .select('id').eq('creator_id', user.id).eq('brand_id', brand.id).limit(1).maybeSingle();
    if (existing) madeJobs.push({ ...job, brand, applicationId: existing.id, total });
    continue;
  }

  /* A brand with no commercials row cannot carry committed money. Create one
     generously; never touch a brand that already has one. */
  if (!hasCommercials.has(brand.id)) {
    const { error } = await db.from('brand_commercials')
      .insert({ brand_id: brand.id, budget_allocated: 10000, budget_used: 0 });
    if (error) console.log(`  (could not open commercials for ${brand.name}: ${error.message})`);
    else console.log(`  opened a $10,000 budget for ${brand.name}`);
  }

  const title = `${brand.name} retainer, ${job.videos} videos, ${money(total)} at ${money(job.rate)} a video`;
  const { data: offer, error: offerErr } = await db.rpc('save_offer', {
    p_actor_id: actor.id,
    p_brand_id: brand.id,
    p_title: title,
    p_video_count: job.videos,
    p_reward_amount: total,
    p_description: `${job.videos} videos for ${brand.name} over the month, paid ${money(total)} in total `
      + `at ${money(job.rate)} a video. A sample is shipped to you and it is yours to keep. `
      + `Post to your own account and add each link here as you go.`,
    p_needs_application: true,
  });
  if (offerErr) { console.error(`  offer: ${offerErr.message}`); continue; }
  const offerId = offer?.id ?? offer;

  const { data: applied, error: applyErr } = await db.rpc('apply_for_offer', {
    p_actor_id: user.id, p_offer_id: offerId, p_note: null,
  });
  if (applyErr) { console.error(`  apply: ${applyErr.message}`); continue; }
  const applicationId = applied?.id ?? applied;

  const { error: revErr } = await db.rpc('review_offer_application', {
    p_actor_id: actor.id, p_application_id: applicationId,
    p_decision: 'approved', p_note: null, p_stage: 'pending_request',
  });
  if (revErr) { console.error(`  approve: ${revErr.message}`); continue; }

  for (let s = 1; s <= STAGES.indexOf(job.stage); s++) {
    const { error } = await db.rpc('set_offer_stage', {
      p_actor_id: actor.id, p_application_id: applicationId, p_stage: STAGES[s], p_note: null,
    });
    if (error) { console.error(`  stage ${STAGES[s]}: ${error.message}`); break; }
  }
  madeJobs.push({ ...job, brand, applicationId, total });
  console.log(`  ${title.padEnd(58)} -> ${job.stage}`);
}

/* ── 4. her videos, and the ad money behind them ────────────────────────── */
let submitted = 0, approvedCount = 0;
const itemIds = [];
for (const job of madeJobs) {
  for (let v = 0; v < job.done + job.waiting; v++) {
    /* A TikTok item id is 19 digits. Derived from the job so a re-run makes
       the same ids and `submit_content` recognises them rather than doubling. */
    const itemId = String(76_000_000_000_000_00000n
      + BigInt(Math.abs(hash(`${HANDLE}:${job.brand.slug}:${v}`)) % 9_000_000_000));
    const url = `https://www.tiktok.com/@${HANDLE}/video/${itemId}`;
    const { data: made, error } = await db.rpc('submit_content', {
      p_actor_id: user.id,
      p_application_id: job.applicationId,
      p_video_url: url,
      p_ad_code: `#WURX${itemId.slice(-6)}`,
      p_ad_authorized: true,
      p_thumbnail_url: null,
      p_video_title: null,
      p_video_author: `@${HANDLE}`,
      p_embed_id: itemId,            /* the only join between her and the money */
    });
    if (error) {
      if (!/duplicate key|23505/i.test(error.message)) console.error(`  video: ${error.message}`);
      continue;
    }
    submitted++;
    itemIds.push({ itemId, brandId: job.brand.id });
    /* The first `done` of each job are accepted; the rest stay with the team,
       so the progress bars have something to show in both states. */
    if (v < job.done) {
      const contentId = made?.id ?? made;
      const { error: rErr } = await db.rpc('review_content', {
        p_actor_id: actor.id, p_content_id: contentId, p_status: 'approved', p_note: null,
      });
      if (!rErr) approvedCount++;
    }
  }
}
console.log(`\n${submitted} videos submitted, ${approvedCount} approved`);

/* Real ad figures, a few days each, so GMV / spend / orders / ROI are not
   empty. Ends YESTERDAY: today is never stored, and the screens know it. */
let rows = 0, gmv = 0, spend = 0;
for (const { itemId, brandId } of itemIds) {
  const days = 4 + (Math.abs(hash(itemId)) % 5);
  for (let d = 0; d < days; d++) {
    const cost = 3 + (Math.abs(hash(`${itemId}:c:${d}`)) % 28);
    const revenue = Math.round(cost * (1.2 + (Math.abs(hash(`${itemId}:r:${d}`)) % 240) / 100) * 100) / 100;
    const orders = 1 + (Math.abs(hash(`${itemId}:o:${d}`)) % 6);
    const { error } = await db.from('tiktok_video_daily').upsert({
      item_id: itemId,
      stat_date: day(d + 1),
      advertiser_id: '7427187763989987329',
      cost, gross_revenue: revenue, orders,
      currency: 'USD',
      store_id: '7495965060132604461',
      brand_id: brandId,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'item_id,stat_date,advertiser_id' });
    if (!error) { rows++; gmv += revenue; spend += cost; }
  }
}
console.log(`${rows} days of ad figures: ${money(Math.round(gmv))} GMV on ${money(Math.round(spend))} spend`
  + ` (${spend > 0 ? (gmv / spend).toFixed(2) : '-'}x)`);

console.log(`\n${'='.repeat(66)}`);
console.log(`  Sign in as  ${EMAIL}  /  ${PASSWORD}`);
console.log(`  ${madeJobs.length} jobs · ${money(madeJobs.reduce((n, j) => n + j.total, 0))} agreed`
  + ` · ${submitted} videos · ${TIER} tier`);
console.log(`  Remove it all again:  node scripts/seed-demo-creator.mjs --clean`);
console.log('='.repeat(66));

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return h;
}
