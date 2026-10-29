#!/usr/bin/env node
/**
 * THE TOP VIDEOS STRIP HAS PICTURES IN IT, INCLUDING IRWIN'S.
 *
 *   pnpm build && pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-video-thumbs.mjs
 *
 * Rashid, 2026-09-29: "for irwin naturals the top videos row does not show
 * thumbnail please check that". It was every one of them: 0 of 66.
 *
 * ── THE FAILURE THIS FILE EXISTS TO PREVENT IS NOT THE BLANK ─────────────
 * It is the version of the fix that works for a day. TikTok's own oEmbed hands
 * out a perfectly good thumbnail URL with `x-expires` in it, and when this was
 * written that expiry was the NEXT DAY. Storing one would have put pictures on
 * the screen the afternoon it shipped and emptied them again by the weekend,
 * with nothing throwing and no test going red.
 *
 * So the checks below are not "is there a thumbnail". They are:
 *   · is it on the permanent store, and NOT a signed URL with an expiry,
 *   · does the image actually load, today,
 *   · and for the ones we have no picture for, is that because the store
 *     genuinely has none — proved by asking it, with controls either side, so
 *     a store answering 200 to everything cannot read as full coverage.
 *
 * Nothing is written.
 */
import { readFileSync } from 'node:fs';
import { launchBrowser, ensureAllTime } from '../../lib/browser.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const envTxt = readFileSync('.env.local', 'utf8');
const URL_ = process.env.SUPABASE_URL
  || (envTxt.match(/^VITE_SUPABASE_URL=(.*)$/m) || [])[1]?.trim() || '';
const BRAND = process.env.THUMB_BRAND || 'Irwin Naturals';
/* The one public object store every thumbnail on these screens already comes
   from. Named here so a change of host is a deliberate edit, not a drift. */
const STORE = 'https://database.euka.ai/storage/v1/object/public/creator_videos_photos';

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

if (!KEY) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'wurxbase' };
async function all(path) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: `${f}-${f + 999}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const j = await r.json(); out.push(...j); if (j.length < 1000) break;
  }
  return out;
}
const vidId = (u) => (String(u ?? '').match(/\/video\/(\d+)/) || [])[1] || null;

const creators = await all('creators?select=brand,name,video_codes');

/* ── 1. THE VIDEOS WE FILE OURSELVES HAVE PICTURES ───────────────────────── */
const ours = [];
for (const c of creators) {
  for (const v of (Array.isArray(c.video_codes) ? c.video_codes : [])) {
    if (!v || v.src !== 'reacher') continue;
    if (!String(v.video || '').trim()) continue;
    ours.push({ brand: c.brand, thumb: String(v.thumb || '').trim(), id: vidId(v.video) });
  }
}
check(ours.length > 0, 'there are videos we filed ourselves to check', `${ours.length} rows`);
if (!ours.length) {
  console.log('\nnothing filed from Reacher — the rest of this file would prove nothing.');
  process.exit(1);
}

const withPic = ours.filter((v) => v.thumb);
const without = ours.filter((v) => !v.thumb);
check(withPic.length > 0, `most of ${BRAND}'s videos carry a picture`,
  `${withPic.length} of ${ours.length}`);
check(withPic.length / ours.length >= 0.75,
  'and it is the large majority, not a handful',
  `${Math.round((withPic.length / ours.length) * 100)}%`);

/* ── 2. NONE OF THEM IS A URL THAT EXPIRES ───────────────────────────────
 * Checked across EVERY stored thumbnail, not only ours: the day somebody wires
 * a signed CDN link into any of these, this is the line that says so. */
const allThumbs = [];
for (const c of creators) {
  for (const v of (Array.isArray(c.video_codes) ? c.video_codes : [])) {
    const t = String(v?.thumb || '').trim();
    if (t) allThumbs.push(t);
  }
}
check(allThumbs.length > 0, 'there are stored thumbnails to inspect', `${allThumbs.length}`);
const expiring = allThumbs.filter((t) => /[?&](x-expires|expires|Expires|X-Amz-Expires)=/.test(t));
check(expiring.length === 0,
  'NO stored thumbnail is a signed URL that expires',
  expiring.length ? `${expiring.length}, e.g. ${expiring[0].slice(0, 80)}` : `${allThumbs.length} checked`);
const offStore = withPic.filter((v) => !v.thumb.startsWith(STORE));
check(offStore.length === 0,
  'every picture we filed points at the permanent store',
  offStore.length ? offStore[0].thumb.slice(0, 90) : `${withPic.length} checked`);

/* ── 3. THE IMAGES ACTUALLY LOAD, TODAY ─────────────────────────────────── */
const sample = withPic.slice(0, 5);
let loaded = 0;
for (const v of sample) {
  const r = await fetch(v.thumb, { method: 'GET' }).catch(() => null);
  if (r && r.ok && String(r.headers.get('content-type') || '').startsWith('image/')) loaded++;
}
check(sample.length > 0 && loaded === sample.length,
  'the stored pictures still load and are images',
  `${loaded} of ${sample.length}`);

/* ── 4. THE BLANKS ARE REALLY BLANK ──────────────────────────────────────
 * With controls either side, because a store that answered 200 to everything
 * would make "we asked and there is none" indistinguishable from "we never
 * asked", and both would look like a pass. */
const ctlA = await fetch(`${STORE}/0000000000000000000.webp`, { method: 'HEAD' }).catch(() => null);
let stillMissing = 0, unexpectedlyThere = [];
for (const v of without.slice(0, 20)) {
  if (!v.id) continue;
  const r = await fetch(`${STORE}/${v.id}.webp`, { method: 'HEAD' }).catch(() => null);
  if (r && r.ok) unexpectedlyThere.push(v.id); else stillMissing++;
}
const ctlB = await fetch(`${STORE}/1111111111111111111.webp`, { method: 'HEAD' }).catch(() => null);
check(!!ctlA && !ctlA.ok && !!ctlB && !ctlB.ok,
  'the controls hold: the store refuses an impossible id, before and after',
  `${ctlA?.status} / ${ctlB?.status}`);
check(unexpectedlyThere.length === 0,
  'every video left without a picture is one the store genuinely has none for',
  unexpectedlyThere.length
    ? `${unexpectedlyThere.length} DO have one and were not filled: ${unexpectedlyThere.slice(0, 3).join(', ')}`
    : `${stillMissing} asked, all absent`);

/* ── 5. THE STRIP RENDERS THEM ──────────────────────────────────────────── */
const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
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
  await page.waitForSelector('.pc-bt-row', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const row = page.locator('.pc-bt-row')
    .filter({ has: page.locator('.pc-brandname', { hasText: new RegExp(`^\\s*${BRAND}\\s*$`) }) }).first();
  if (!(await row.count().catch(() => 0))) {
    check(false, `${BRAND} is on the Brands screen`);
  } else {
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    /*
     * ALL TIME, NOT THE MONTH THE CLOCK HAPPENS TO BE IN.
     *
     * The brand page opens on the current month, so on 1 October this file
     * started reporting "0 tiles" for a strip that was working perfectly — the
     * new month simply had no videos in it yet. A guard that fails when the
     * date rolls over is a guard nobody will trust the second time. All Time
     * asks the question the check is actually about: are the videos we hold
     * showing their pictures.
     */
    await ensureAllTime(page);
    await page.waitForSelector('.pc-topvid, .pc-empty', { timeout: 40000 }).catch(() => {});
    /* Wait for the strip to settle rather than for a fixed pause. */
    let last = -1, same = 0;
    for (let i = 0; i < 30; i++) {
      const n = await page.locator('.pc-topvid').count().catch(() => -1);
      same = n === last ? same + 1 : 0;
      last = n;
      if (n > 0 && same >= 1) break;
      await page.waitForTimeout(600);
    }
    /* LET THE PICTURES FINISH. They are `loading="lazy"`, so a tile below the
       fold has not started, and an <img> that has not finished reports neither
       painted nor broken — measuring here gave "0 broken, 2 painted" out of ten
       images, which is a pass built on eight unanswered questions. Scroll the
       strip into view and wait for them to complete. */
    await page.locator('.pc-topvid').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('.pc-topvid img.pc-topvid-thumb')];
      return imgs.length > 0 && imgs.every((i) => i.complete);
    }, null, { timeout: 25000 }).catch(() => {});

    const strip = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.pc-topvid')];
      const imgs = [...document.querySelectorAll('.pc-topvid img.pc-topvid-thumb')];
      return {
        tiles: tiles.length,
        imgs: imgs.length,
        placeholders: document.querySelectorAll('.pc-topvid .pc-topvid-ph').length,
        /* An <img> that failed to load reports naturalWidth 0 — which is the
           broken-icon case, and the reason the component has a fallback. */
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
        painted: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    });
    check(strip.tiles > 0, `${BRAND}: the top videos strip has tiles`, `${strip.tiles}`);
    check(strip.imgs > 0, `${BRAND}: and they carry real <img> thumbnails now`,
      `${strip.imgs} images, ${strip.placeholders} placeholders`);
    check(strip.broken === 0, `${BRAND}: none of them is a broken image`,
      `${strip.broken} broken, ${strip.painted} painted`);
    /* The one that stops the line above being a pass over unanswered images:
       nearly all of them must have actually finished and drawn. */
    check(strip.imgs > 0 && strip.painted >= strip.imgs - 1,
      `${BRAND}: and the pictures actually painted`,
      `${strip.painted} of ${strip.imgs}`);
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
