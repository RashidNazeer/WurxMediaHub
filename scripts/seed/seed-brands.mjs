#!/usr/bin/env node
/**
 * Seed demo brands and offers on DEV so the Brand Hub has something in it.
 *
 * Uses the real database functions rather than raw inserts, so the seeded rows
 * go through the same validation and land in the audit log exactly as they
 * would if an admin had typed them. Never run this against prod.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-brands.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-brands.mjs --clean
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
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
assertDevProject(env.VITE_SUPABASE_URL, 'seed-brands.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

// Store ids all share this prefix so --clean can find exactly what it made.
const PREFIX = 'demo-';

const BRANDS = [
  {
    name: 'Vitauthority',
    storeId: `${PREFIX}vitauthority`,
    client: 'Vitauthority LLC',
    budget: 48000,
    tagline: 'Wellness & Weight Support',
    about:
      'Clean, science-backed supplements with a loyal repeat customer base. Creators do best here with honest before-and-after storytelling rather than hard selling.',
    products: [
      {
        name: 'Multi Collagen Burn, 30 servings',
        externalId: `${PREFIX}vit-collagen-burn`,
        price: 49.99,
        commission: 25,
        badge: 'HERO',
      },
      {
        name: 'Lean Bliss Greens, 30 servings',
        externalId: `${PREFIX}vit-greens`,
        price: 39.99,
        commission: 22,
      },
      {
        name: 'Daily Multivitamin, 60 count',
        externalId: `${PREFIX}vit-multi`,
        price: 24.99,
        commission: 20,
      },
    ],
    offers: [
      {
        badge: 'TOP PICK',
        title: 'Starter bundle',
        description:
          'Five in-feed videos featuring the hero product, posted within 30 days. Hook in the first two seconds.',
        videos: 5,
        reward: 300,
        needsApplication: true,
      },
      {
        // Not "OPEN": the card already carries an "open to all" chip derived
        // from needs_application, and two badges saying the same thing reads
        // like a bug.
        badge: 'QUICK START',
        title: 'Single video test',
        description: 'One video, no commitment. A good way to see if we fit.',
        videos: 1,
        reward: 75,
        needsApplication: false,
      },
      {
        title: 'Volume deal',
        description: 'Twenty videos across the quarter, paid monthly.',
        videos: 20,
        reward: 1400,
        needsApplication: true,
      },
    ],
  },
  {
    name: 'BruMate',
    storeId: `${PREFIX}brumate`,
    client: 'BruMate Inc',
    budget: 32000,
    tagline: 'Drinkware That Keeps Up',
    about:
      'Insulated drinkware with a strong outdoor and tailgate audience. Product in use beats product on a shelf every single time.',
    products: [
      {
        name: 'Hopsulator Trio, 16 oz',
        externalId: `${PREFIX}bru-hopsulator`,
        price: 29.99,
        commission: 18,
        badge: 'HERO',
      },
      {
        name: 'Era Tumbler, 25 oz',
        externalId: `${PREFIX}bru-era`,
        price: 34.99,
        commission: 18,
      },
    ],
    offers: [
      {
        badge: 'SEASONAL',
        title: 'Summer drinkware push',
        description: 'Three videos with the tumbler range, outdoors, before the end of August.',
        videos: 3,
        reward: 240,
        needsApplication: true,
      },
      {
        title: 'Unboxing only',
        description: 'One unboxing video. Open to anyone on the roster.',
        videos: 1,
        reward: 60,
        needsApplication: false,
      },
    ],
  },
  {
    name: 'Physicians Choice',
    storeId: `${PREFIX}physicians-choice`,
    client: 'Physicians Choice',
    budget: 60000,
    tagline: 'Gut Health, Backed by Research',
    about:
      'Probiotics and digestive health, sold on evidence. Claims are checked before anything goes live, so scripts are approved in advance here.',
    products: [
      {
        name: 'Probiotic 60 Billion CFU, 30 count',
        externalId: `${PREFIX}pc-probiotic-60`,
        price: 27.95,
        commission: 24,
        badge: 'HERO',
      },
      {
        name: 'Prebiotic Fiber, 30 servings',
        externalId: `${PREFIX}pc-prebiotic`,
        price: 21.95,
        commission: 20,
      },
      {
        // No price and no commission on purpose: this is the "numbers are not
        // in yet" case, and the cards have to handle it without printing a
        // zero somebody would read as real.
        name: 'Digestive Enzymes, 60 count',
        externalId: `${PREFIX}pc-enzymes`,
      },
    ],
    offers: [
      {
        badge: 'HIGHEST PAYING',
        title: 'Gut health series',
        description: 'Ten videos telling one story across the month. Script approval required.',
        videos: 10,
        reward: 900,
        needsApplication: true,
      },
    ],
  },
  {
    name: 'Bentgo',
    storeId: `${PREFIX}bentgo`,
    client: 'Bentgo',
    budget: 18000,
    offers: [],
  },
];

const clean = process.argv.includes('--clean');

const { data: staff, error: staffErr } = await admin
  .from('profiles')
  .select('id, email')
  .in('role', ['admin', 'ops'])
  .eq('is_active', true)
  .limit(1)
  .maybeSingle();

if (staffErr || !staff) {
  throw new Error('No active admin found. Run scripts/ops/create-admin.mjs first.');
}

if (clean) {
  const { data: existing } = await admin
    .from('brands')
    .select('id, name')
    .like('store_id', `${PREFIX}%`);

  console.log(`\nRemoving ${(existing ?? []).length} demo brand(s)\n`);
  for (const b of existing ?? []) {
    const { data: offers } = await admin.from('offers').select('id').eq('brand_id', b.id);
    for (const o of offers ?? []) {
      await admin.from('audit_log').delete().eq('subject_id', o.id);
    }
    const { data: products } = await admin
      .from('brand_products')
      .select('id')
      .eq('brand_id', b.id);
    for (const p of products ?? []) {
      await admin.from('audit_log').delete().eq('subject_id', p.id);
    }
    await admin.from('audit_log').delete().eq('subject_id', b.id);
    // Offers, products and the commercial row all go with the brand: every one
    // of those foreign keys cascades.
    await admin.from('brands').delete().eq('id', b.id);
    console.log(`  removed  ${b.name}`);
  }
  console.log('\nDone.\n');
  process.exit(0);
}

console.log(`\nSeeding demo brands into ${env.VITE_SUPABASE_URL}`);
console.log(`Acting as ${staff.email}\n`);

for (const b of BRANDS) {
  const { data: existing } = await admin
    .from('brands')
    .select('id')
    .eq('store_id', b.storeId)
    .maybeSingle();

  const { data: saved, error } = await admin.rpc('save_brand', {
    p_actor_id: staff.id,
    p_name: b.name,
    p_store_id: b.storeId,
    p_brand_id: existing?.id ?? null,
    p_client_name: b.client,
    p_budget: b.budget,
    p_currency: 'USD',
    p_is_active: true,
  });

  if (error) {
    console.log(`  FAILED  ${b.name}  ${error.message}`);
    continue;
  }

  const brandId = saved.id;
  let added = 0;
  let productsAdded = 0;

  if (b.tagline || b.about) {
    const { error: aboutErr } = await admin.rpc('save_brand_about', {
      p_actor_id: staff.id,
      p_brand_id: brandId,
      // No logo: seeding one would mean shipping image files, and an empty
      // logo is a state the screens have to handle anyway.
      p_logo_url: null,
      p_tagline: b.tagline ?? null,
      p_description: b.about ?? null,
    });
    if (aboutErr) console.log(`    FAILED about: ${aboutErr.message}`);
  }

  for (const p of b.products ?? []) {
    const { data: alreadyProduct } = await admin
      .from('brand_products')
      .select('id')
      .eq('brand_id', brandId)
      .eq('external_product_id', p.externalId)
      .maybeSingle();

    const { error: productErr } = await admin.rpc('save_product', {
      p_actor_id: staff.id,
      p_brand_id: brandId,
      p_name: p.name,
      p_external_product_id: p.externalId,
      p_product_id: alreadyProduct?.id ?? null,
      p_image_url: null,
      p_price: p.price ?? null,
      p_currency: 'USD',
      p_commission_rate: p.commission ?? null,
      p_badge_title: p.badge ?? null,
      p_is_active: true,
    });

    if (productErr) console.log(`    FAILED product "${p.name}": ${productErr.message}`);
    else productsAdded += 1;
  }

  for (const o of b.offers) {
    const { data: already } = await admin
      .from('offers')
      .select('id')
      .eq('brand_id', brandId)
      .eq('title', o.title)
      .maybeSingle();

    const { error: offerErr } = await admin.rpc('save_offer', {
      p_actor_id: staff.id,
      p_brand_id: brandId,
      p_title: o.title,
      p_video_count: o.videos,
      p_reward_amount: o.reward,
      p_offer_id: already?.id ?? null,
      p_badge_title: o.badge ?? null,
      p_description: o.description ?? null,
      p_currency: 'USD',
      p_status: 'active',
      p_needs_application: o.needsApplication,
    });

    if (offerErr) console.log(`    FAILED offer "${o.title}": ${offerErr.message}`);
    else added += 1;
  }

  console.log(
    `  ready    ${b.name.padEnd(20)} ${added} offer(s), ${productsAdded} product(s)`
  );
}

console.log('\nRemove them again with: node scripts/seed/seed-brands.mjs --clean\n');
