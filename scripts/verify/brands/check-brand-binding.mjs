#!/usr/bin/env node
/**
 * Proves that one brand's money is that brand's money.
 *
 * WHY IT EXISTS. Rashid, 2026-08-19: "note one thing here that all this is for
 * penetex brand not any other even the gmv max data offers videos each and
 * everything i hope it's binded towards that right??" It is, and a sentence
 * saying so is worth less than something that can be re-run the day a second
 * brand goes live.
 *
 * WHAT IT CHECKS, from the outside in:
 *   offers, requests and videos all carry the brand, and point at each other
 *   within it, and no other brand has picked any of them up
 *   the TikTok store is mapped to exactly this brand, and to nothing else
 *   every ad figure in the database came from that brand's advertiser
 *   no other brand names a video those figures belong to
 *   only this brand has money committed
 *
 * THE ONE THING WORTH UNDERSTANDING. `tiktok_video_daily` carries no brand
 * column at all: it is keyed (item_id, stat_date), because that is what TikTok
 * gives us. The binding to a brand runs entirely through
 * `content_submissions.embed_id`, and every function that reads the figures
 * joins through it, so a video nobody has submitted is invisible to everybody.
 * The corollary is the last check here: if the SAME TikTok video were ever
 * submitted under two brands, both would show the same money, because the join
 * is on the video id alone.
 *
 * READ ONLY, and deliberately not behind the dev guard. It writes nothing, and
 * the question it answers is one worth being able to ask about prod.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/brands/check-brand-binding.mjs [brand]
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const BRAND = process.argv[2] ?? 'Penetrex';

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

const db = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

let failures = 0;
const check = (ok, message, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${message}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};
// Every call is checked. A query naming a column that does not exist returns an
// error and no rows, and an unread error reads exactly like "nothing found",
// which is how this very script first reported that no store was mapped at all.
const must = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result;
};

const { data: brands } = must(await db.from('brands').select('id, name').order('name'));
const brand = brands.find((b) => b.name === BRAND);
if (!brand) {
  console.error(
    `\nNo brand called ${BRAND}. There is: ${brands.map((b) => b.name).join(', ')}\n`
  );
  process.exit(1);
}
const others = brands.filter((b) => b.id !== brand.id);

console.log(`\nIs everything bound to ${BRAND}?\n${'='.repeat(70)}`);
console.log(`  against ${env.VITE_SUPABASE_URL}`);
console.log(`  other brands: ${others.map((b) => b.name).join(', ') || 'none'}\n`);

/* ---------------------------------------------------------------- offers -- */
const { data: offers } = must(await db.from('offers').select('id, brand_id'));
const mine = offers.filter((o) => o.brand_id === brand.id);
check(offers.length === mine.length, `all ${offers.length} offers belong to ${BRAND}`);
for (const b of others) {
  const n = offers.filter((o) => o.brand_id === b.id).length;
  if (n) check(false, `${b.name} also has offers`, `${n}`);
}

/* -------------------------------------------------------------- requests -- */
const { data: apps } = must(
  await db.from('offer_applications').select('id, brand_id, offer_id, creator_id')
);
const offerIds = new Set(mine.map((o) => o.id));
check(
  apps.every((a) => a.brand_id === brand.id),
  `all ${apps.length} requests are filed under ${BRAND}`
);
check(
  apps.every((a) => offerIds.has(a.offer_id)),
  'every request points at one of those offers'
);

/* --------------------------------------------------------------- videos -- */
const { data: subs } = must(
  await db
    .from('content_submissions')
    .select('id, brand_id, offer_id, application_id, creator_id, embed_id')
);
const appById = new Map(apps.map((a) => [a.id, a]));
const ours = subs.filter((c) => c.brand_id === brand.id);
check(
  ours.every((c) => offerIds.has(c.offer_id)),
  `all ${ours.length} videos point at those offers`
);
check(
  ours.every((c) => appById.has(c.application_id)),
  'every video hangs off one of those requests'
);
check(
  ours.every((c) => appById.get(c.application_id)?.creator_id === c.creator_id),
  "no video is attached to somebody else's job"
);

/* ------------------------------------------------------------ the store -- */
const { data: stores } = must(
  await db.from('tiktok_stores').select('store_id, advertiser_id, name, brand_id')
);
const mappedHere = stores.filter((s) => s.brand_id === brand.id);
const mappedElsewhere = stores.filter((s) => s.brand_id && s.brand_id !== brand.id);
check(mappedHere.length >= 1, `a TikTok store is mapped to ${BRAND}`, `${mappedHere.length}`);
check(
  mappedElsewhere.length === 0,
  'no store is mapped to another brand',
  `${mappedElsewhere.length}`
);
for (const s of stores) {
  const to = s.brand_id
    ? (brands.find((b) => b.id === s.brand_id)?.name ?? 'unknown brand')
    : 'not mapped';
  console.log(`        store ${s.store_id}  advertiser ${s.advertiser_id}  ->  ${to}`);
}

/* --------------------------------------------------------------- the money -- */
const daily = [];
for (let from = 0; ; from += 1000) {
  const { data } = must(
    await db
      .from('tiktok_video_daily')
      .select('item_id, advertiser_id')
      .range(from, from + 999)
  );
  daily.push(...data);
  if (data.length < 1000) break;
}
const advertisers = new Set(daily.map((d) => d.advertiser_id));
const ourAdvertisers = new Set(mappedHere.map((s) => s.advertiser_id));
check(
  [...advertisers].every((a) => ourAdvertisers.has(a)),
  `every ad figure came from ${BRAND}'s advertiser`,
  [...advertisers].join(', ')
);

const embedIds = new Set(ours.map((c) => c.embed_id).filter(Boolean));
const videosWithFigures = new Set(daily.map((d) => d.item_id));
const attached = [...videosWithFigures].filter((id) => embedIds.has(id));
const orphans = videosWithFigures.size - attached.length;
console.log(
  `        ${daily.length} video-days over ${videosWithFigures.size} videos; ` +
    `${attached.length} attached to a ${BRAND} video, ${orphans} attached to nothing`
);

/*
 * The one that actually matters. A figure reaches a person only through
 * `content_submissions.embed_id`, so the question is whether any OTHER brand
 * names a video these figures belong to. If one did, two brands would be
 * showing the same money.
 */
const foreign = subs.filter(
  (c) => c.brand_id !== brand.id && videosWithFigures.has(c.embed_id)
);
check(
  foreign.length === 0,
  'no other brand names a video these figures belong to',
  `${foreign.length}`
);

/* -------------------------------------------------------------- the budget -- */
const { data: commercials } = must(
  await db.from('brand_commercials').select('brand_id, budget_allocated, budget_used')
);
for (const c of commercials) {
  const b = brands.find((x) => x.id === c.brand_id);
  if (!b || b.id === brand.id) continue;
  check(Number(c.budget_used) === 0, `${b.name} has nothing committed`, `$${c.budget_used}`);
}

console.log(`\n${'='.repeat(70)}`);
if (failures) {
  console.error(`\n${failures} binding check(s) FAILED.\n`);
  process.exit(1);
}
console.log(`\n  Everything is bound to ${BRAND}, and nothing leaks out of it.\n`);
