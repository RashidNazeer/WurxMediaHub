#!/usr/bin/env node
/**
 * DO THE PRODUCTS IN THE ONBOARDING PICKER HAVE PICTURES?
 *
 *   node scripts/verify/brands/check-product-images.mjs
 *
 * Rashid, 2026-09-24: "also check if images can be fetcheable for cruva and
 * euka so we can show images of product in dropdown".
 *
 * The picker drew a letter tile for nearly every product, on the reasoning that
 * neither API carried an image. That was true of the endpoints we were reading
 * and false of the API as a whole: EUKA has two lookups keyed on the exact
 * TikTok product id, and an id is not a guess.
 *
 * THIS IS A CHECK THAT CANNOT PASS ON AN EMPTY ANSWER. The failure mode that
 * would sail through a naive version is "0 products, 0 without pictures, 100%
 * covered" — so every brand here must return products at all before its
 * coverage is even looked at, and the picture URLs are FETCHED, not merely
 * counted, because a URL that 403s is a broken tile on the screen and a pass
 * on paper.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
const { data: session, error: signInError } = await sb.auth.signInWithPassword({
  email: process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com',
  password: process.env.COLLAB_STAFF_PASSWORD || '1234567890',
});
if (signInError || !session?.session) {
  console.error('could not sign in as staff:', signInError?.message);
  process.exit(1);
}
const token = session.session.access_token;

const ask = async (brand) => {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/collab-products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand }),
    signal: AbortSignal.timeout(90_000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/* One brand per platform we read, so a platform-shaped failure cannot hide
   behind another platform's success. */
const BRANDS = [
  { name: 'Penetrex', expect: 'euka' },
  { name: 'Swisse', expect: 'euka' },
  { name: 'Irwin Naturals', expect: 'reacher' },
];

const seenUrls = [];
for (const b of BRANDS) {
  const t0 = Date.now();
  const { status, body } = await ask(b.name);
  const ms = Date.now() - t0;
  check(status === 200, `${b.name}: the picker's endpoint answers`, `HTTP ${status}`);
  if (status !== 200 || !body) continue;

  const products = Array.isArray(body.products) ? body.products : [];
  /* THE GUARD THAT MAKES THE REST MEAN ANYTHING. */
  check(products.length > 0, `${b.name}: returns products at all`, `${products.length} products, source ${body.source}, ${body.note || 'no note'}`);
  if (!products.length) continue;

  check(body.source === b.expect, `${b.name}: reads from ${b.expect}`, `got ${body.source}`);

  const withImg = products.filter((p) => typeof p.image === 'string' && /^https?:\/\//.test(p.image));
  const pct = Math.round((withImg.length / products.length) * 100);
  console.log(`  · ${b.name}: ${withImg.length}/${products.length} products have a picture (${pct}%) via ${body.source}, ${ms}ms`);
  check(withImg.length > 0, `${b.name}: at least some products carry a picture`, `${withImg.length} of ${products.length}`);
  seenUrls.push(...withImg.slice(0, 3).map((p) => ({ brand: b.name, name: p.name, url: p.image })));
}

/* A URL is not a picture until something serves it. TikTok's CDN is entitled to
   refuse us, and if it does the drawer shows a broken tile while every count
   above still says "covered". */
for (const u of seenUrls.slice(0, 6)) {
  let ok = false, detail = '';
  try {
    const r = await fetch(u.url, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    const type = r.headers.get('content-type') || '';
    const len = Number(r.headers.get('content-length') || 0);
    ok = r.ok && /^image\//.test(type);
    detail = `HTTP ${r.status} ${type}${len ? ` ${Math.round(len / 1024)}KB` : ''}`;
  } catch (e) {
    detail = String(e.message || e).slice(0, 60);
  }
  check(ok, `${u.brand}: its picture actually loads (${String(u.name).slice(0, 34)})`, detail);
}

/* And the cache must have been written, or every open pays the full price. */
const { count } = await sb.from('collab_product_images').select('*', { count: 'exact', head: true });
check((count ?? 0) > 0, 'the picture cache was written', `${count ?? 0} rows`);

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
