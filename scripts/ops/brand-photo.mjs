#!/usr/bin/env node
/**
 * GIVE A PAID COLLABS BRAND A PICTURE.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/brand-photo.mjs "Irwin Naturals" --tiktok irwinnaturalsofficial
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/brand-photo.mjs "Irwin Naturals" --file C:/path/logo.png
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/brand-photo.mjs "Irwin Naturals" --url https://…/logo.png
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/brand-photo.mjs --list
 *
 * Brand faces in Paid Collabs come from EUKA. A brand with no Euka store — Irwin
 * Naturals is the first — has no face, and falls back to a gradient letter.
 * This puts one in the public `brand-assets` bucket and records it in
 * `collab_brand_photos`, which the screen reads only when Euka has nothing.
 *
 * THREE SOURCES, because the obvious one is not always available. `--tiktok`
 * takes the brand's own profile picture through unavatar.io, the same service
 * the creator faces use; it rate-limits (429) and has quiet days, which is why
 * `--file` and `--url` exist and why a failure here says which it was.
 *
 * It refuses anything that is not a PNG, JPEG or WebP, and anything over 2MB —
 * the bucket's own limits. An SVG is a script host and has no business in a
 * bucket somebody else's browser will render.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertDevProject } from '../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'brand-assets';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const db = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

if (argv.includes('--list')) {
  const { data, error } = await db.from('collab_brand_photos').select('*').order('brand');
  if (error) throw error;
  if (!data.length) console.log('No brand has a picture of its own yet.');
  for (const r of data) {
    console.log(`${r.brand.padEnd(24)} ${r.source.padEnd(9)} ${r.handle ? '@' + r.handle : ''} ${Math.round((r.bytes || 0) / 1024)}KB`);
    console.log(`   ${URL_}/storage/v1/object/public/${BUCKET}/${r.path}`);
  }
  process.exit(0);
}

const brand = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);
if (!brand) {
  console.error('Give the brand name exactly as Paid Collabs writes it, e.g. "Irwin Naturals".');
  process.exit(1);
}

/* The brand must really exist on a Paid Collabs row. A typo would otherwise
   sit in the table looking correct and never appear on any screen. */
const wb = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });
const { data: rows, error: rowsErr } = await wb.from('creators').select('brand').ilike('brand', brand).limit(1);
if (rowsErr) throw rowsErr;
if (!rows?.length) {
  const { data: all } = await wb.from('creators').select('brand').limit(2000);
  const names = [...new Set((all || []).map((r) => String(r.brand || '').trim()).filter(Boolean))].sort();
  console.error(`No Paid Collabs row has the brand "${brand}".`);
  console.error(`Closest: ${names.filter((n) => n.toLowerCase().includes(brand.slice(0, 4).toLowerCase())).join(', ') || names.slice(0, 8).join(', ')}`);
  process.exit(1);
}
const exact = String(rows[0].brand).trim();

/* ── get the bytes ──────────────────────────────────────────────────────── */
let buf = null, type = '', source = '', handle = null;
const tiktok = flag('tiktok'), file = flag('file'), url = flag('url');

if (file) {
  buf = readFileSync(file);
  type = file.toLowerCase().endsWith('.png') ? 'image/png'
    : file.toLowerCase().endsWith('.webp') ? 'image/webp'
      : 'image/jpeg';
  source = 'upload';
} else if (url || tiktok) {
  handle = tiktok ? String(tiktok).replace(/^@/, '').trim() : null;
  /* `fallback=false` matters: without it unavatar returns a generated initial
     image with a 200, and we would store a picture of nothing. */
  const from = url || `https://unavatar.io/tiktok/${encodeURIComponent(handle)}?fallback=false`;
  source = url ? 'url' : 'unavatar';
  const res = await fetch(from, { headers: { 'user-agent': 'wurxmediahub-brand-photo' } });
  if (!res.ok) {
    console.error(`${source} answered ${res.status}${res.status === 429 ? ' (rate limited — it does this; try again in a few minutes, or use --file)' : ''}`);
    process.exit(1);
  }
  type = (res.headers.get('content-type') || '').split(';')[0].trim();
  buf = Buffer.from(await res.arrayBuffer());
} else {
  console.error('Say where the picture comes from: --tiktok <handle>, --file <path> or --url <address>.');
  process.exit(1);
}

const ext = ALLOWED.get(type);
if (!ext) {
  console.error(`That is a ${type || 'unknown type'}. Only PNG, JPEG and WebP go in the bucket.`);
  process.exit(1);
}
if (buf.byteLength > MAX_BYTES) {
  console.error(`${Math.round(buf.byteLength / 1024)}KB is over the bucket's 2MB limit.`);
  process.exit(1);
}

/* ── store it ───────────────────────────────────────────────────────────── */
const slug = exact.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const path = `collab-brands/${slug}.${ext}`;
const { error: upErr } = await db.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true });
if (upErr) throw new Error(`uploading: ${upErr.message}`);

const { error: rowErr } = await db.from('collab_brand_photos').upsert({
  brand: exact, path, source, handle, bytes: buf.byteLength, updated_at: new Date().toISOString(),
}, { onConflict: 'brand' });
if (rowErr) throw new Error(`recording it: ${rowErr.message}`);

const publicUrl = `${URL_}/storage/v1/object/public/${BUCKET}/${path}`;
console.log(`${exact}: ${Math.round(buf.byteLength / 1024)}KB ${type} from ${source}${handle ? ` (@${handle})` : ''}`);
console.log(publicUrl);

/* Prove it is really readable without a session, which is the whole point of
   putting it in the public bucket rather than the private one. */
const back = await fetch(publicUrl);
console.log(back.ok ? 'served publicly: yes' : `served publicly: NO (${back.status}) — the screen will show the letter instead`);
