#!/usr/bin/env node
/**
 * The Euka proxy: every mode, and who is allowed to call it.
 *
 *   SUPABASE_SERVICE_KEY=... EUKA_STAFF_PASSWORD=... node scripts/verify/euka/check-euka.mjs
 *
 * WHY THIS EXISTS. Paid Collabs asks for its Euka figures from a serverless
 * function. On the original deployment that was `/.netlify/functions/euka`;
 * here it is the `euka` Edge Function. When it is missing NOTHING ERRORS —
 * every call site is written as `.then(r => r.ok ? r.json() : null)` and
 * carries on — so the screens simply show fewer numbers than they should. That
 * is exactly how it went unnoticed after the move, and it is why this suite
 * asserts on the SHAPE of each mode rather than on the absence of an error.
 *
 * The shapes are not decoration. A dozen call sites in code we do not own
 * destructure these objects by key: `meta.stores`, `d.handles`, `d.videos`,
 * `d.avatars`, `d.tiers`, `d.people`, `d.photo`. A renamed key produces a blank
 * column, not a crash.
 *
 * IT ALSO CHECKS THE DOOR. The original answered `Access-Control-Allow-Origin:
 * *` with no Authorization at all, so its `type=discovery` mode — which returns
 * creator email addresses and phone numbers — was readable by anyone who knew
 * the URL. Ours is staff-only, and that is verified here against a real creator
 * account rather than asserted in a comment.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');

const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

/* The network here drops the occasional first connection; a single retry keeps
   a real failure distinguishable from a blip. */
async function signIn(email, password) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  for (let i = 0; i < 4; i++) {
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (!error) return c;
    if (i === 3) throw new Error(`could not sign in as ${email}: ${error.message}`);
    await new Promise((s) => setTimeout(s, 3000));
  }
}

const call = async (client, body) => await client.functions.invoke('euka', { body });

/* Their matcher, copied so this suite tests the SAME rule the app applies:
   exact normalised match, else a UNIQUE prefix match in either direction. */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function storeForBrand(stores, brandName) {
  const nb = norm(brandName);
  if (!nb || !Array.isArray(stores)) return null;
  const exact = stores.find((s) => norm(s.name) === nb);
  if (exact) return exact;
  const cands = stores.filter((s) => {
    const ns = norm(s.name);
    return ns && (ns.startsWith(nb) || nb.startsWith(ns));
  });
  return cands.length === 1 ? cands[0] : null;
}

const STAFF_PASSWORD = process.env.EUKA_STAFF_PASSWORD;
if (!STAFF_PASSWORD) throw new Error('EUKA_STAFF_PASSWORD must be set (a staff account password on dev)');
const STAFF_EMAIL = process.env.EUKA_STAFF_EMAIL || 'asad@wurxmedia.com';

const CREATOR = { email: `euka-probe-${Date.now()}@wurx.test`, password: 'Euka!2026xy' };
let creatorId = null;

try {
  const staff = await signIn(STAFF_EMAIL, STAFF_PASSWORD);

  /* ── 1. the store list, the mode whose absence caused the bug report ── */
  const meta = await call(staff, {});
  check(!meta.error, 'the store list answers a staff caller', meta.error?.message || '');
  const stores = meta.data?.stores || [];
  check(Array.isArray(stores) && stores.length > 0, 'it returns stores', `${stores.length} store(s)`);
  check(
    stores.every((s) => s && typeof s.id === 'string' && typeof s.name === 'string'),
    'every store has the { id, name } their matcher reads',
  );

  /*
   * ── 2. THE ACTUAL BUG. The brand screen said: No EUKA store named "Swisse".
   * The store is called "Swisse Wellness" upstream, which is precisely why
   * their matcher does unique-prefix matching. This asserts the whole chain:
   * the endpoint answers, the names come back, and the matcher finds it.
   */
  const swisse = storeForBrand(stores, 'Swisse');
  check(Boolean(swisse), 'the brand "Swisse" resolves to a store', swisse ? swisse.name : 'NO MATCH — this is the reported bug');

  /* Every brand in Paid Collabs, so an unmatched one is a known fact rather
     than a surprise on somebody's screen. Not a failure: a brand may genuinely
     have no Euka store. */
  const wb = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    db: { schema: 'wurxbase' },
  });
  const { data: creators } = await wb.from('creators').select('brand');
  const brands = [...new Set((creators || []).map((c) => c.brand).filter(Boolean))].sort();
  const matched = brands.filter((b) => storeForBrand(stores, b));
  const unmatched = brands.filter((b) => !storeForBrand(stores, b));
  check(
    matched.length > 0,
    `${matched.length} of ${brands.length} brands resolve to an Euka store`,
    unmatched.length ? `no store for: ${unmatched.join(', ')}` : 'all matched',
  );

  const storeId = (swisse || stores[0]).id;

  /* ── 3. creator_level · the GMV and profile source ── */
  const lvl = await call(staff, { store: storeId });
  check(!lvl.error, 'creator_level answers', lvl.error?.message || '');
  const d = lvl.data || {};
  check(d.handles && typeof d.handles === 'object', 'it returns `handles`', `${Object.keys(d.handles || {}).length} handle(s)`);
  check(d.profiles && typeof d.profiles === 'object', 'it returns `profiles`', `${Object.keys(d.profiles || {}).length} profile(s)`);
  check(d.shop && typeof d.shop === 'object', 'it returns `shop`');
  check(
    Object.values(d.handles || {}).every((v) => typeof v === 'number'),
    'every GMV is a number, not a numeric string',
    'a string would concatenate where the app sums',
  );
  const tiers = Object.values(d.profiles || {}).filter((p) => p.tier).length;
  check(tiers > 0, 'creator tiers came through', `${tiers} profile(s) carry a tier`);

  /* ── 4. posted videos ── */
  const vid = await call(staff, { store: storeId, type: 'videos' });
  check(!vid.error, 'the videos export answers', vid.error?.message || '');
  const v = vid.data || {};
  const vHandles = Object.keys(v.videos || {});
  check(v.videos && typeof v.videos === 'object', 'it returns `videos` keyed by handle', `${vHandles.length} creator(s)`);
  check('avatars' in v && 'brandPhoto' in v && 'tiers' in v, 'it returns `avatars`, `brandPhoto` and `tiers` too');

  /*
   * THE ENRICHMENT ACTUALLY ARRIVED. Asserting the keys EXIST passes just as
   * happily on `{}`, and `{}` is exactly what came back while the dashboard
   * call was 400ing for want of a brand id — no thumbnails, no Spark codes, no
   * avatars, and items 0 on every row, with the shape still perfect.
   */
  check(
    Object.keys(v.avatars || {}).length > 0,
    'creator avatars came through, not just the key',
    `${Object.keys(v.avatars || {}).length} avatar(s) — 0 means the dashboard call failed`,
  );
  check(
    Object.keys(v.tiers || {}).length > 0,
    'creator tiers came through on the videos mode',
    `${Object.keys(v.tiers || {}).length}`,
  );
  const rows = vHandles.flatMap((h) => v.videos[h]);
  check(
    rows.every((r) => typeof r.views === 'number' && typeof r.revenue === 'number'),
    'views and revenue are numbers on every row',
    `${rows.length} row(s) checked`,
  );
  const withItems = rows.filter((r) => r.items > 0).length;
  check(
    withItems > 0,
    'at least some rows carry an items count',
    `${withItems} of ${rows.length} — the dashboard enriches only five videos, so a few is right and zero is the 400`,
  );

  /* ── 5. one creator's videos, using a handle that really is in that store ── */
  if (vHandles.length) {
    const h = vHandles[0];
    const cv = await call(staff, { store: storeId, type: 'cvideos', handle: h });
    check(!cv.error, 'the per-creator export answers', cv.error?.message || '');
    check(
      cv.data?.videos && Object.prototype.hasOwnProperty.call(cv.data.videos, h),
      'it returns `videos` keyed by the handle asked for',
      `asked ${h}, got ${Object.keys(cv.data?.videos || {}).join(',') || 'nothing'}`,
    );
  }

  /* ── 6. the brand photo ── */
  const ph = await call(staff, { store: storeId, type: 'photo' });
  check(!ph.error, 'the photo mode answers', ph.error?.message || '');
  check(typeof ph.data?.photo === 'string', 'it returns a `photo` string', ph.data?.photo ? 'a URL' : 'empty, which is allowed');

  /* ── 7. discovery · PII, so only counts are printed ── */
  const disc = await call(staff, { store: storeId, type: 'discovery' });
  check(!disc.error, 'the discovery pool answers', disc.error?.message || '');

  /*
   * `typeof x === 'object'` WAS NOT AN ASSERTION. It is true of an array, and
   * `Object.keys([...504 items])` prints a healthy-looking "504 contactable
   * creator(s)" — so the array-instead-of-object shape would have sailed
   * through with a number that looks right. It is also true of `{}`.
   */
  const people = disc.data?.people;
  check(
    people && typeof people === 'object' && !Array.isArray(people),
    'it returns `people` as an object keyed by handle, not an array',
    Array.isArray(people) ? 'AN ARRAY — every consumer reads it by handle' : typeof people,
  );
  const folk = Object.values(people || {});
  check(folk.length > 0, 'the pool is not empty', `${folk.length} contactable creator(s)`);

  /*
   * TYPES, because upstream sends some of these as strings. `avg_video_views_30d`
   * comes back as "241" on most rows; forwarded raw it poisons both the numeric
   * comparison that picks the better duplicate and the views sort.
   */
  check(
    folk.every((p) => typeof p.avgViews === 'number' && typeof p.gmv === 'number' && typeof p.followers === 'number'),
    'avgViews, gmv and followers are numbers, not numeric strings',
    'upstream sends avg_video_views_30d as a string',
  );
  /* The filter is an OR — a phone with no email is kept, so an empty email is
     possible and a reimplementer who assumes otherwise drops those people. */
  check(
    folk.every((p) => (p.email || '').length > 0 || (p.phone || '').length > 0),
    'every person kept has an email or a phone',
    `${folk.filter((p) => !p.email).length} have a phone but no email, which is allowed`,
  );

  /*
   * AND THE DATE PATH, which the real caller always uses and this never did.
   * Discovery is the one mode whose window is NOT clamped to 55 days — the
   * caller sweeps 60-day windows and unions them, and a clamp added here would
   * quietly shrink the pool with every check still green.
   */
  const wide = await call(staff, { store: storeId, type: 'discovery', from: '2026-07-02', to: '2026-08-31' });
  check(!wide.error, 'discovery accepts an explicit 60-day window', wide.error?.message || '');
  check(
    wide.data?.range?.start === '2026-07-02' && wide.data?.range?.end === '2026-08-31',
    'and does NOT clamp it',
    `asked 2026-07-02..2026-08-31, got ${wide.data?.range?.start}..${wide.data?.range?.end}`,
  );

  /* ── 8. THE DOOR. A creator must not reach any of it. ── */
  let made = null;
  for (let i = 0; i < 5 && !made?.data?.user; i++) {
    made = await admin.auth.admin.createUser({ email: CREATOR.email, password: CREATOR.password, email_confirm: true });
    if (!made?.data?.user) await new Promise((s) => setTimeout(s, 8000));
  }
  if (!made?.data?.user) throw new Error('could not create a throwaway creator');
  creatorId = made.data.user.id;
  await admin.from('profiles').update({ role: 'creator', is_active: true }).eq('id', creatorId);

  const asCreator = await signIn(CREATOR.email, CREATOR.password);
  const denied = await call(asCreator, { store: storeId, type: 'discovery' });
  /*
   * A refusal must be a REFUSAL, not an empty result. Asserting only "no
   * people came back" would pass just as happily if Euka were down, which is
   * the check-that-passes-when-its-subject-is-absent trap.
   */
  check(
    Boolean(denied.error) || denied.data?.error === 'Not allowed',
    'a CREATOR is refused the discovery pool',
    denied.error ? `refused: ${denied.error.message}` : `returned ${JSON.stringify(denied.data).slice(0, 80)}`,
  );
  check(
    !denied.data?.people,
    'and gets no creator contact details',
    denied.data?.people ? `LEAKED ${Object.keys(denied.data.people).length} people` : 'none',
  );

  /* ── 9. and neither does a caller with no session at all ── */
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const out = await call(anon, {});
  check(Boolean(out.error) || out.data?.error, 'a signed-out caller is refused', out.error ? out.error.message : JSON.stringify(out.data).slice(0, 80));
} finally {
  if (creatorId) await admin.auth.admin.deleteUser(creatorId);
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
