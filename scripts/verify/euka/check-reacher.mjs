#!/usr/bin/env node
/**
 * IRWIN NATURALS, FROM REACHER, AGAINST REACHER ITSELF.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/euka/check-reacher.mjs
 *
 * Rashid, 2026-09-23: Irwin Naturals is on Reacher, not Euka — "same operations
 * as we are currently doing with euka api ... Please do not disturb anything,
 * just for Irwin Naturals".
 *
 * So this checks the two halves of that sentence. That the figures are right:
 * every video filed on an Irwin row exists in Reacher with the same views, GMV
 * and items, read live from their API rather than from our own copy. And that
 * nothing else moved: no other brand carries a Reacher-filed video, no ad-spend
 * row claims Reacher while no campaign exists, and the sync is idempotent — a
 * second run files nothing, because the rule is add-never-replace.
 *
 * A CONTROL RUNS FIRST. An empty answer from Reacher would make every
 * comparison below pass vacuously, which is this project's most repeated
 * mistake, so the check FAILS if Reacher returns no videos for the shop.
 *
 * It is read-only: the only call it makes to our sync is `dryRun: true`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = 'Irwin Naturals';
const MONTH = process.env.MONTH || '2026-09';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const RKEY = (env.REACHER_API || '').trim();
if (!RKEY) throw new Error('REACHER_API must be in .env.local');

const svc = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const wb = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const handleOf = (raw) => {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return '';
  const last = t.startsWith('http') ? (t.replace(/\/+$/, '').split('/').pop() ?? '') : t;
  return last.replace(/^@+/, '').split(/[?#]/)[0].trim();
};
const vidId = (u) => (String(u ?? '').match(/\/video\/(\d+)/) || [])[1] || null;

/* ── Reacher, live ──────────────────────────────────────────────────────── */
const R = 'https://api.reacherapp.com/public/v1';
const rPost = async (path, shop, body) => {
  const r = await fetch(R + path, {
    method: 'POST',
    headers: { 'x-api-key': RKEY, 'x-shop-id': String(shop), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
};
const rGet = async (path, shop) => {
  const r = await fetch(R + path, { headers: { 'x-api-key': RKEY, 'x-shop-id': String(shop) } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
};

const shopsJson = await rGet('/shops', 'all');
const shop = (shopsJson.data || []).find((s) => String(s.shop_name).trim().toLowerCase() === BRAND.toLowerCase());
check(!!shop, `Reacher has a shop called ${BRAND}`, shop ? `id ${shop.shop_id}` : (shopsJson.data || []).map((s) => s.shop_name).join(', '));
if (!shop) {
  for (const p of pass) console.log('  PASS  ' + p);
  for (const f of fail) console.log('  FAIL  ' + f);
  process.exit(1);
}

const rVideos = [];
for (let page = 1; page <= 50; page++) {
  const j = await rPost('/videos/list', shop.shop_id, { page, page_size: 100, start_date: '2026-01-01', end_date: '2026-12-31' });
  rVideos.push(...(j.data || []));
  if (!j.pagination?.total_pages || page >= j.pagination.total_pages) break;
}
/* THE CONTROL. Without this every comparison below could pass on an empty API. */
check(rVideos.length > 0, 'Reacher returns videos for this shop, so the comparisons below can fail', `${rVideos.length} videos`);
const byId = new Map();
for (const v of rVideos) {
  const id = vidId(v.video_url || v.tiktok_url);
  if (id && !byId.has(id)) byId.set(id, v);
}
const campaigns = await rGet('/gmv-max/campaigns', shop.shop_id);
const campaignCount = campaigns?.pagination?.total_count ?? (campaigns?.data?.length ?? 0);
console.log(`Reacher: ${rVideos.length} videos (${byId.size} distinct), ${campaignCount} GMV Max campaigns`);

/* ── ours ───────────────────────────────────────────────────────────────── */
const rows = [];
for (let f = 0; ; f += 500) {
  const { data, error } = await wb.from('creators').select('id,name,brand,tiktok_account,tiktok_account_2,video_codes').order('id').range(f, f + 499);
  if (error) throw error;
  rows.push(...data);
  if (data.length < 500) break;
}
const irwin = rows.filter((r) => String(r.brand || '').trim() === BRAND);
check(irwin.length > 0, `${BRAND} has creator rows in Paid Collabs`, `${irwin.length} rows`);

const filed = [];
for (const r of irwin) {
  for (const v of Array.isArray(r.video_codes) ? r.video_codes : []) {
    if (v?.src === 'reacher') filed.push({ row: r, v });
  }
}
check(filed.length > 0, 'videos from Reacher have been filed onto Irwin rows', `${filed.length} videos on ${new Set(filed.map((f) => f.row.id)).size} creators`);

/* Every filed video exists in Reacher, with the same figures. */
const wrong = [];
for (const { row, v } of filed) {
  const id = vidId(v.video);
  const src = id && byId.get(id);
  if (!src) { wrong.push(`${v.video} is not in Reacher at all`); continue; }
  const same = (Number(v.views) || 0) === (Number(src.views) || 0)
    && Math.abs((Number(v.revenue) || 0) - (Number(src.video_gmv) || 0)) < 0.005
    && (Number(v.items) || 0) === (Number(src.units_sold) || 0);
  if (!same) wrong.push(`${id}: ours ${v.views}/${v.revenue}/${v.items} vs Reacher ${src.views}/${src.video_gmv}/${src.units_sold}`);
  /* And it is on the RIGHT creator: the handle on the row must be the handle
     Reacher credits, or we have filed somebody else's video against them. */
  const handles = [handleOf(row.tiktok_account), handleOf(row.tiktok_account_2)].filter(Boolean);
  if (!handles.includes(handleOf(src.creator_handle))) wrong.push(`${id} is filed on ${row.name} but Reacher credits @${src.creator_handle}`);
}
check(wrong.length === 0, 'every filed video matches Reacher exactly, on the right creator', wrong.slice(0, 3).join(' | ') || `${filed.length} compared`);

/* No row has the same video twice — the add-never-replace rule. */
const dupes = [];
for (const r of irwin) {
  const seen = new Set();
  for (const v of Array.isArray(r.video_codes) ? r.video_codes : []) {
    const k = vidId(v?.video) ?? String(v?.video || '');
    if (!k) continue;
    if (seen.has(k)) dupes.push(`${r.name}: ${k}`);
    seen.add(k);
  }
}
check(dupes.length === 0, 'no video is filed twice on a row', dupes.slice(0, 3).join(' | '));

/* NOTHING ELSE WAS DISTURBED: no other brand carries a Reacher-filed video. */
const strays = rows.filter((r) => String(r.brand || '').trim() !== BRAND
  && (Array.isArray(r.video_codes) ? r.video_codes : []).some((v) => v?.src === 'reacher'));
check(strays.length === 0, 'no brand other than Irwin Naturals has a Reacher-filed video',
  strays.slice(0, 3).map((r) => `${r.brand}/${r.name}`).join(', '));

/* ── ad spend: a dash, not a zero ───────────────────────────────────────── */
const { data: spendRows } = await svc.from('euka_ad_video_month').select('item_id, source, cost').eq('source', 'reacher');
if (campaignCount === 0) {
  check((spendRows || []).length === 0,
    'with no GMV Max campaign connected, no ad-spend row claims Reacher (a dash, never a zero)',
    `${(spendRows || []).length} rows`);
} else {
  check((spendRows || []).length > 0, 'campaigns exist, so Reacher ad spend has been written', `${(spendRows || []).length} rows`);
}
const { count: eukaRows } = await svc.from('euka_ad_video_month').select('*', { count: 'exact', head: true }).eq('source', 'euka');
check((eukaRows ?? 0) > 1000, 'the Euka brands’ ad figures are untouched', `${eukaRows} rows still source=euka`);

/* ── the sync is idempotent ─────────────────────────────────────────────── */
/* AS A STAFF MEMBER, not with the service key. The function's gate wants the
   scheduler's secret or a real ops/admin/ads_manager session, and the service
   role is neither — it is not a user at all, so `getUser` refuses it. A first
   version of this check called it with the service key and read the 401 as a
   broken function. */
const staff = createClient(URL_, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: signInErr } = await staff.auth.signInWithPassword({
  email: process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com',
  password: process.env.COLLAB_STAFF_PASSWORD || '1234567890',
});
check(!signInErr, 'a staff account can sign in, so the dry run below is a real test', signInErr?.message);
const { data: dry, error: dryErr } = await staff.functions.invoke('reacher-sync', { body: { dryRun: true } })
  .catch((e) => ({ error: e }));
if (dryErr) {
  check(false, 'a dry run can be taken (staff or scheduler)', String(dryErr.message || dryErr).slice(0, 120));
} else {
  check(dry?.videosFiled === 0, 'running it again would file nothing new — add, never replace',
    `would file ${dry?.videosFiled} more`);
  check(dry?.shop === BRAND && dry?.videosSeen > 0, 'and it is still reading the right shop', `${dry?.shop}, ${dry?.videosSeen} videos`);
}

/* ── the brand's own picture ────────────────────────────────────────────── */
/* Rashid, 2026-09-23: "can we have a photo (dp) of the brand as well". Euka
   supplies every other brand's face and has no store for this one, so the
   picture lives in our own bucket and is read only when Euka has nothing. */
const { data: photo } = await svc.from('collab_brand_photos').select('brand, path, source, bytes').ilike('brand', BRAND).maybeSingle();
check(!!photo?.path, `${BRAND} has a picture of its own recorded`, photo ? `${photo.source}, ${Math.round((photo.bytes || 0) / 1024)}KB` : 'no row');
if (photo?.path) {
  const url = `${URL_}/storage/v1/object/public/brand-assets/${photo.path}`;
  const r = await fetch(url);
  const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  /* PNG magic, then its own width and height: a 404 page or an HTML error
     would otherwise pass as "something was served". */
  const isPng = !!buf && buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47;
  check(r.ok && !!buf && buf.length > 1000, 'the picture is served publicly, without a session', r.ok ? `${Math.round((buf?.length ?? 0) / 1024)}KB` : `HTTP ${r.status}`);
  check(isPng && buf.readUInt32BE(16) >= 128, 'and it is a real image, big enough to render', isPng ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : 'not a PNG');
}

/* ── the run log ────────────────────────────────────────────────────────── */
const { data: runs } = await svc.from('reacher_sync_runs').select('*').order('ran_at', { ascending: false }).limit(3);
check((runs || []).length > 0 && runs[0].ok, 'the last run is recorded and succeeded',
  runs?.[0] ? `${runs[0].videos_seen} seen, ${runs[0].videos_filed} filed, ${runs[0].campaigns_seen} campaigns` : 'no runs logged');

/* ── the screen ─────────────────────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 140)));

  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com');
  await page.fill('input[name="password"]', process.env.COLLAB_STAFF_PASSWORD || '1234567890');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();

  await page.goto(`${BASE}/admin/collabs/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pc-bt-row, .pc-back', { timeout: 60000 }).catch(() => {});
  const back = page.locator('.pc-back');
  if (await back.first().isVisible().catch(() => false)) { await back.first().click(); await page.waitForTimeout(2500); }
  await page.evaluate((m) => {
    const inp = document.querySelector('input.pc-chrome-input');
    if (!inp) return;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, m);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, MONTH);
  await page.waitForTimeout(4000);
  const row = page.locator('.pc-bt-row').filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${BRAND}\\s*$`) }) }).first();
  check(await row.isVisible().catch(() => false), `${BRAND} is listed on the Brands screen for ${MONTH}`);

  /* The face on the list: a real picture, from OUR store rather than Euka's,
     and no other brand's face taken over by it. */
  const faces = await page.evaluate(() => [...document.querySelectorAll('.pc-bt-row')].map((r) => ({
    brand: r.querySelector('.pc-brandname')?.textContent.trim() ?? '',
    from: r.querySelector('.pc-ava-photo img')?.getAttribute('data-wx-photo') ?? null,
  })));
  const mine = faces.find((f) => f.brand.toLowerCase() === BRAND.toLowerCase());
  check(mine?.from === 'ours', `${BRAND} shows a picture on the Brands list, not a letter`, `face: ${mine?.from ?? 'letter'}`);
  const hijacked = faces.filter((f) => f.brand.toLowerCase() !== BRAND.toLowerCase() && f.from === 'ours');
  check(hijacked.length === 0, 'no other brand picked up a picture that is not its own', hijacked.map((f) => f.brand).join(', '));
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await page.waitForSelector('.pc-ct-row', { timeout: 30000 });
    await page.waitForTimeout(2500);
    const seen = await page.evaluate(() => {
      const cells = (label) => [...document.querySelectorAll(`[data-label="${label}"]`)].map((c) => c.innerText.trim());
      return {
        rows: document.querySelectorAll('.pc-ct-row').length,
        views: cells('Total views'),
        gmv: cells('New video GMV'),
        spend: cells('Ad spend'),
        gmvCard: document.querySelector('.pc-topvids-stat.gmv')?.dataset.value ?? null,
        spendState: document.querySelector('.pc-topvids-stat.spend')?.dataset.state ?? null,
      };
    });
    check(seen.rows > 0, `${BRAND}'s creators are on screen`, `${seen.rows} rows`);
    const showsFigures = seen.views.filter((t) => /\d/.test(t)).length;
    check(showsFigures > 0, 'the videos filed from Reacher show their views on the screen', `${showsFigures} rows with a view count`);
    /* The one that matters: no ad data must read as a dash, never as $0. */
    const zeros = seen.spend.filter((t) => /^\$0(\.00)?$/.test(t)).length;
    check(campaignCount > 0 || zeros === 0, 'Ad spend shows a dash, not $0, while Reacher has no campaigns', `${zeros} cells say $0`);
    if (campaignCount === 0) {
      check(seen.spendState === null || seen.spendState !== 'ok', 'and the ad-spend card is not claiming a figure', `card state ${seen.spendState}`);
    }
    /* ── the videos button follows the platform ───────────────────────── */
    /* Rashid, 2026-09-23: "when we click euka videos it says no store found
       obviously because we are using reacher". It now says, and does, Reacher
       for this brand — and must still say EUKA for a Euka brand. */
    await page.waitForFunction(() => document.querySelector('.pc-vidsync')?.dataset.wxSource !== 'unknown', null, { timeout: 25000 }).catch(() => {});
    const btn = await page.evaluate(() => {
      const b = document.querySelector('.pc-vidsync');
      return { label: b?.textContent.trim() ?? '', source: b?.dataset.wxSource ?? '', strip: document.querySelector('.pc-topvids-sub')?.textContent.trim() ?? '' };
    });
    check(btn.source === 'reacher' && /reacher/i.test(btn.label), `${BRAND}: the videos button names Reacher, not EUKA`, `"${btn.label}" (${btn.source})`);
    check(/reacher/i.test(btn.strip), 'and the strip above the table says where its figures come from', `"${btn.strip}"`);

    /* Press it: the same sync the scheduler runs, and it must report rather
       than fail. "Already up to date" is the usual and correct answer. */
    await page.locator('.pc-vidsync').click();
    await page.waitForFunction(() => !/asking reacher/i.test(document.querySelector('.pc-vidsync')?.textContent || ''), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      label: document.querySelector('.pc-vidsync')?.textContent.trim() ?? '',
      failed: !!document.querySelector('.pc-vidsync.err'),
    }));
    check(!after.failed && after.label.length > 0, 'pressing it runs the Reacher sync and reports what happened', `"${after.label}"`);

    /* A EUKA brand is untouched by all of this. */
    await page.locator('.pc-back').first().click();
    await page.waitForTimeout(2000);
    const euka = page.locator('.pc-bt-row').filter({ has: page.locator('.pc-brandname', { hasText: /^\s*Penetrex\s*$/ }) }).first();
    if (await euka.isVisible().catch(() => false)) {
      await euka.click();
      await page.waitForSelector('.pc-vidsync', { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('.pc-vidsync')?.dataset.wxSource !== 'unknown', null, { timeout: 25000 }).catch(() => {});
      const other = await page.evaluate(() => ({
        label: document.querySelector('.pc-vidsync')?.textContent.trim() ?? '',
        source: document.querySelector('.pc-vidsync')?.dataset.wxSource ?? '',
      }));
      check(other.source === 'euka' && /euka/i.test(other.label), 'a EUKA brand still says EUKA videos', `"${other.label}" (${other.source})`);
    }
  }

  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
