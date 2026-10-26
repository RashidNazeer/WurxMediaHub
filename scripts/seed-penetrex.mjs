#!/usr/bin/env node
/**
 * Rashid's real Penetrex roster, put into dev so the numbers can be seen.
 *
 * FOUR REAL CREATORS, TWO REAL OFFERS, FORTY-SIX REAL VIDEOS. The links are
 * ones he supplied from his own sheets, so once the sync runs these screens are
 * showing genuine spend and genuine GMV rather than invented figures. That is
 * the whole point of seeding it: a demo built on made-up money teaches you
 * nothing about whether the product reads correctly.
 *
 * THE SUBMISSION DATE COMES OUT OF THE VIDEO ID. A TikTok id carries its
 * creation time in its top 32 bits, so `7630208072048282910` is 18 April 2026.
 * That matters here rather than being a party trick: the creator screen refuses
 * to let anybody pick a date before their first video existed, and seeding
 * everything as "today" would collapse that floor and make every historic
 * figure look like it arrived this morning.
 *
 * AD CODES ARE RANDOM AND UNIQUE, as he asked. They are the creator's own
 * authorisation codes in real life and we do not have his, and nothing in the
 * reporting path reads them: the join to TikTok is the video id.
 *
 * DEV ONLY, and it refuses to run anywhere else. Re-running is safe: everything
 * is keyed and upserted, so it tops up rather than duplicating.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/seed-penetrex.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/seed-penetrex.mjs --clean
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { assertDevProject } from './lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_ = env.VITE_SUPABASE_URL ?? '';

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL_, 'seed-penetrex.mjs');
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const DEV_REF = 'qinxwfdwvpkzfhcijuqw';

if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (!URL_.includes(DEV_REF)) {
  console.error(`REFUSING TO RUN. This seeds demo data and only ever touches DEV (${DEV_REF}).`);
  process.exit(1);
}

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const clean = process.argv.includes('--clean');

/* -------------------------------------------------------------- the data -- */

/** Everything this script makes carries this, so --clean is exact. */
const TAG = 'penetrex-seed';
const PASSWORD = 'WurxPenetrex2026!';

/** The real TikTok store, already known to the product from the connection. */
const STORE_ID = '7495965060132604461';
const ADVERTISER_ID = '7427187763989987329';

const CREATORS = [
  { handle: 'babblingbrookej', name: 'Brooke J', videos: 10, reward: 40, tier: 'pro' },
  { handle: 'aarontopfinds', name: 'Aaron', videos: 10, reward: 40, tier: 'rising' },
  { handle: 'vivianiempire_', name: 'Viviani', videos: 10, reward: 40, tier: 'creator' },
  { handle: 'pandanamonium', name: 'Panda', videos: 15, reward: 40, tier: 'elite' },
];

const LINKS = {
  /*
   * ALL FIFTY-ONE OF HERS, in the four batches Rashid supplied them in. The
   * first fifteen were only the first batch, and the gap that exposed it was
   * real: he saw $3.47 in the ad centre against our $2.99, and the missing
   * spend was on videos we had never been told about. The store carries 9,487
   * videos, so "we do not hold a link for it" is the normal case rather than
   * the exception, and every number we show is only ever as complete as the
   * links we have.
   */
  babblingbrookej: [
    // April
    '7630208072048282910', '7630551774436298015', '7630872247577742622',
    '7631316194221460766', '7631644752257027358', '7632038910918429983',
    '7632404173996199199', '7632406941356002591', '7632414513018522911',
    '7632417200292252958', '7632420063013817630', '7632420680436305182',
    '7632422561124486430', '7632710359266135326', '7632717847621405983',
    // May
    '7636892072808631583', '7636894148494101791', '7637250950326963487',
    '7637939909742939422', '7637941847263825183', '7637945761132498206',
    '7638746812727168286', '7639490296006315294', '7639833842261495070',
    '7640541235156995359', '7640545010894589214', '7640545756906032414',
    '7642070146445495583', '7642073720130899231', '7642085792331943199',
    // June and July
    '7651288392793197855', '7651588092251360542', '7651775645646638367',
    '7652461270255406366', '7653060524598463775', '7653844164257385758',
    '7653859139700919583', '7654282046486973726', '7654585486345915678',
    '7654664848965487902', '7655050084249341214', '7655043724010900767',
    '7655047961319116063', '7655048243591613726', '7662488806548868382',
    // August
    '7671384531437358366', '7671385109861305630', '7672530408994589983',
    '7673615923315576094', '7673618528729042206', '7674746216772570398',
  ],
  aarontopfinds: [
    '7670315704591174943', '7671047209890155806', '7671409453299748126',
    '7671867251150114078', '7672584197575396638', '7673348668136672542',
  ],
  vivianiempire_: [
    '7666261332915670286', '7667389676302519566', '7668560704588303630',
    '7668490415263321358', '7668749715885837582',
  ],
  pandanamonium: [
    '7651469269569506574', '7652014735717698829', '7655533892195175693',
    '7655945040564423950', '7656165585297870094', '7656288982241676557',
    '7656287848160660749', '7656994451734285582', '7656923747248590093',
    '7656873770782641422', '7656993109284293901', '7656993938066197773',
    '7658517412328852750', '7658290065742793997', '7658518220671831309',
    '7659011476098780430', '7659268701849439501', '7659779770342739213',
    '7659782477480856846', '7659783852646321422',
  ],
};

/**
 * When a TikTok video was posted, read out of its own id.
 *
 * The top 32 bits of a TikTok id are a unix timestamp. No API call, no guessing,
 * and it is exact.
 */
const postedAt = (itemId) => new Date(Number(BigInt(itemId) >> 32n) * 1000);

const adCode = () => `PNX-${randomUUID().slice(0, 8).toUpperCase()}`;

const emailFor = (handle) => `${handle}@wurxseed.test`;

/* --------------------------------------------------------------- cleanup -- */

async function removeAll() {
  console.log('\nRemoving the Penetrex seed\n');

  const { data: brand } = await db
    .from('brands')
    .select('id')
    .eq('slug', 'penetrex')
    .maybeSingle();

  if (brand) {
    // Unmap first, so the store row survives with its TikTok metadata intact.
    await db
      .from('tiktok_stores')
      .update({ brand_id: null, mapped_by: null, mapped_at: null })
      .eq('brand_id', brand.id);
    // Content, applications and offers all cascade from the brand.
    await db.from('brands').delete().eq('id', brand.id);
    console.log('  brand, offers, applications and content removed');
  }

  for (const c of CREATORS) {
    const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
    const user = (list?.users ?? []).find((u) => u.email === emailFor(c.handle));
    if (user) {
      await db.from('audit_log').delete().eq('actor_id', user.id);
      await db.auth.admin.deleteUser(user.id);
      console.log(`  ${c.handle} removed`);
    }
  }

  console.log('\nThe TikTok connection and its ad accounts were left alone.\n');
}

if (clean) {
  await removeAll();
  process.exit(0);
}

/* ------------------------------------------------------------------ seed -- */

console.log(`\nSeeding the real Penetrex roster into ${URL_}\n${'='.repeat(66)}\n`);

/* 1. the brand */
let { data: brand } = await db
  .from('brands')
  .select('id, name')
  .eq('slug', 'penetrex')
  .maybeSingle();

if (!brand) {
  const { data, error } = await db
    .from('brands')
    .insert({
      name: 'Penetrex',
      slug: 'penetrex',
      store_id: STORE_ID,
      client_name: 'Biomax Health Products LLC',
      budget_allocated: 25000,
      currency: 'USD',
      is_active: true,
      tagline: 'Relief that works where it hurts.',
    })
    .select('id, name')
    .single();
  if (error) throw new Error(`could not create the brand: ${error.message}`);
  brand = data;
  console.log('  brand      Penetrex created');
} else {
  console.log('  brand      Penetrex already there');
}

/* 2. the TikTok store mapped to it, so the sync knows where the money is */
const { error: mapErr } = await db
  .from('tiktok_stores')
  .update({ brand_id: brand.id, mapped_at: new Date().toISOString() })
  .eq('store_id', STORE_ID)
  .eq('advertiser_id', ADVERTISER_ID);
console.log(
  mapErr
    ? `  mapping    FAILED: ${mapErr.message}`
    : '  mapping    Penetrex store matched to the brand'
);

/* 3. the two offers */
const offerFor = {};
for (const spec of [
  { videos: 10, title: '10 videos for Penetrex' },
  { videos: 15, title: '15 videos for Penetrex' },
]) {
  const { data: existing } = await db
    .from('offers')
    .select('id')
    .eq('brand_id', brand.id)
    .eq('video_count', spec.videos)
    .maybeSingle();

  if (existing) {
    offerFor[spec.videos] = existing.id;
    console.log(`  offer      ${spec.title} already there`);
    continue;
  }

  const { data, error } = await db
    .from('offers')
    .insert({
      brand_id: brand.id,
      title: spec.title,
      description:
        'Post honest videos about Penetrex and tag the product. We run the ads behind them, ' +
        'and you see exactly what they earn.',
      video_count: spec.videos,
      reward_amount: 40,
      currency: 'USD',
      status: 'active',
      needs_application: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create an offer: ${error.message}`);
  offerFor[spec.videos] = data.id;
  console.log(`  offer      ${spec.title} created`);
}

/* 4. the creators, their accepted offer, and their videos */
console.log('');
let totalVideos = 0;

for (const c of CREATORS) {
  const email = emailFor(c.handle);

  const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
  let user = (list?.users ?? []).find((u) => u.email === email);

  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: c.name, tiktok_handle: c.handle, seed: TAG },
    });
    if (error) throw new Error(`could not create ${c.handle}: ${error.message}`);
    user = data.user;
  }

  /*
   * NO `tiktok_handle` HERE. It lives on `applications`, not on `profiles`, and
   * naming it made the whole update fail with "column does not exist" while the
   * script carried on reporting success. Every creator ended up as an
   * `applicant` with no tier, which is exactly the "behaving differently" Rashid
   * hit when he signed in.
   *
   * Hence the error check. A seed that fails quietly is worse than one that
   * fails loudly, because the product then looks broken instead of the script.
   */
  const { error: profileErr } = await db
    .from('profiles')
    .update({
      role: 'creator',
      is_active: true,
      display_name: c.name,
      // An approved creator has a tier, and several screens read it.
      tier: c.tier,
    })
    .eq('id', user.id);
  if (profileErr) throw new Error(`could not set up ${c.handle}: ${profileErr.message}`);

  /*
   * THE PLATFORM APPLICATION, APPROVED AND BACKDATED.
   *
   * Rashid, testing: "the creators account is behaving differently ... make it
   * like they are old creator nothing pending on admin approval". This is why.
   * Creating the account and setting the role to `creator` is not enough: the
   * creator home reads the `applications` row to decide what to show, and with
   * no row at all it correctly concludes this person has not applied yet and
   * shows them the "finish your application" screen.
   *
   * So each one gets an approved application, reviewed a fortnight before their
   * first video, which is what an established creator's history actually looks
   * like.
   */
  const firstVideo = postedAt(LINKS[c.handle][0]);
  const appliedAt = new Date(firstVideo.getTime() - 14 * 86_400_000).toISOString();
  const reviewedAt = new Date(firstVideo.getTime() - 12 * 86_400_000).toISOString();

  const { data: existingApplication } = await db
    .from('applications')
    .select('id, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existingApplication) {
    const { error } = await db.from('applications').insert({
      user_id: user.id,
      tiktok_handle: c.handle,
      niche: 'Health & wellness',
      worked_with_wurx: true,
      video_links: LINKS[c.handle]
        .slice(0, 3)
        .map((id) => `https://www.tiktok.com/@${c.handle}/video/${id}`)
        .join('\n'),
      status: 'approved',
      reviewed_at: reviewedAt,
      review_note: 'Approved during onboarding.',
      created_at: appliedAt,
      updated_at: reviewedAt,
    });
    if (error) throw new Error(`could not approve ${c.handle}: ${error.message}`);
  } else if (existingApplication.status !== 'approved') {
    await db
      .from('applications')
      .update({ status: 'approved', reviewed_at: reviewedAt })
      .eq('id', existingApplication.id);
  }

  const offerId = offerFor[c.videos];

  let { data: application } = await db
    .from('offer_applications')
    .select('id')
    .eq('offer_id', offerId)
    .eq('creator_id', user.id)
    .maybeSingle();

  if (!application) {
    /*
     * The offer request, already decided. Dated a week before their first
     * video, because a creator does not post the same minute they are let onto
     * a job, and "requested today, approved today, fifteen videos already
     * posted" is a history that never happened.
     */
    const requestedAt = new Date(firstVideo.getTime() - 7 * 86_400_000).toISOString();
    const { data, error } = await db
      .from('offer_applications')
      .insert({
        offer_id: offerId,
        brand_id: brand.id,
        creator_id: user.id,
        status: 'approved',
        creator_handle: c.handle,
        creator_name: c.name,
        created_at: requestedAt,
        updated_at: requestedAt,
      })
      .select('id')
      .single();
    if (error) throw new Error(`could not accept the offer for ${c.handle}: ${error.message}`);
    application = data;
  } else {
    await db.from('offer_applications').update({ status: 'approved' }).eq('id', application.id);
  }

  const items = LINKS[c.handle];
  let made = 0;

  for (const itemId of items) {
    const videoUrl = `https://www.tiktok.com/@${c.handle}/video/${itemId}`;
    const { data: existing } = await db
      .from('content_submissions')
      .select('id')
      .eq('application_id', application.id)
      .eq('video_url', videoUrl)
      .maybeSingle();
    if (existing) continue;

    const posted = postedAt(itemId).toISOString();
    const { error } = await db.from('content_submissions').insert({
      application_id: application.id,
      creator_id: user.id,
      brand_id: brand.id,
      offer_id: offerId,
      creator_handle: c.handle,
      creator_name: c.name,
      video_url: videoUrl,
      ad_code: adCode(),
      ad_authorized: true,
      embed_id: itemId,
      status: 'approved',
      video_title: `${c.name} on Penetrex`,
      video_author: `@${c.handle}`,
      created_at: posted,
      updated_at: posted,
    });
    if (error) throw new Error(`could not add a video for ${c.handle}: ${error.message}`);
    made++;
  }

  totalVideos += items.length;
  const first = postedAt(items[0]).toISOString().slice(0, 10);
  const last = postedAt(items[items.length - 1]).toISOString().slice(0, 10);
  console.log(
    `  ${c.handle.padEnd(18)} ${String(items.length).padStart(2)} videos ` +
      `(${made} new)  ${first} to ${last}  ->  ${c.videos} for $${c.reward}`
  );
}

/* ------------------------------------------------------------- what next -- */

const oldest = Math.min(
  ...Object.values(LINKS)
    .flat()
    .map((id) => postedAt(id).getTime())
);
const daysBack = Math.ceil((Date.now() - oldest) / 86_400_000) + 2;

console.log(`\n${'='.repeat(66)}`);
console.log(`  ${CREATORS.length} creators, ${totalVideos} videos, oldest posted ${daysBack - 2} days ago.`);
console.log(`\n  Sign in as any of them:`);
for (const c of CREATORS) console.log(`    ${emailFor(c.handle).padEnd(32)} ${PASSWORD}`);
console.log(`\n  Now pull the numbers, which needs ${daysBack} days of history:`);
console.log(`    node scripts/backfill-tiktok.mjs ${daysBack}\n`);
