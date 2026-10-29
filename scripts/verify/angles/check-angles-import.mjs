#!/usr/bin/env node
/* THE APPLY HALF, ON A SCRATCH TEST THIS SCRIPT CREATES AND REMOVES.
 *
 * The team's real angle tests are all AUGUST, and Khushi and Masifa are
 * actively working in them, so none of this goes anywhere near those. It
 * seeds one throwaway angle in a brand-month that holds nothing, imports
 * figures onto it, reads them back OUT OF THE DATABASE rather than off the
 * screen, and deletes the row again — verifying the delete, and verifying
 * every real row is still there afterwards.
 */
import { launchBrowser } from '../../lib/browser.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('d:/Milestone/WurxMediaHub/package.json');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const PW = process.env.COLLAB_STAFF_PASSWORD || '1234567890';
const SP = 'C:/Users/RA_shid/AppData/Local/Temp/claude/d--Milestone-WurxMediaHub/64441b35-f230-4eb0-b9a0-4801b8a2f9e6/scratchpad/';
const BRAND = 'Penetrex';
const MONTH = '2026-07';
const TARGET = BRAND + '::' + MONTH;
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const env = Object.fromEntries(readFileSync('d:/Milestone/WurxMediaHub/.env.local', 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const wb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

/* every real row, so the end of this can prove none of them moved */
const realBefore = (await wb.from('activity_logs').select('target,updated_at,user_display')
  .eq('action', 'CREATIVE_ANGLE')).data || [];
check(!realBefore.some((r) => r.target === TARGET), 'the scratch subject holds nothing to begin with', TARGET);

/* find real July videos for this brand, the way the screen would */
const creators = (await wb.from('creators').select('brand,hiring_date,video_codes').eq('brand', BRAND)).data || [];
const urls = [];
for (const c of creators) {
  for (const v of (Array.isArray(c.video_codes) ? c.video_codes : [])) {
    const u = String((v && v.video) || '').trim();
    const m = String((v && v.date) || '').slice(0, 7) || String(c.hiring_date || '').slice(0, 7);
    if (u && m === MONTH && !urls.includes(u)) urls.push(u);
    if (urls.length >= 6) break;
  }
  if (urls.length >= 6) break;
}
check(urls.length >= 3, 'found real videos in the scratch month to test against', urls.length + ' videos');
if (urls.length < 3) { console.log('cannot test'); process.exit(1); }

const seeded = await wb.from('activity_logs').insert({
  action: 'CREATIVE_ANGLE',
  target: TARGET,
  user_display: 'import-test',
  details: { angles: [{ id: 'scratch1', title: 'Scratch angle', videos: urls, spend: {}, gmvOverride: {}, viewsOverride: {} }] },
}).select('id,revision').maybeSingle();
check(!seeded.error, 'seeded a throwaway angle', seeded.error ? seeded.error.message : 'ok');
if (seeded.error) { console.log('SEED FAILED: ' + seeded.error.message); process.exit(1); }

const pick = urls[2];
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PW);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
  const hi = page.getByRole('button', { name: /let.s go/i });
  if (await hi.first().isVisible().catch(() => false)) await hi.first().click();
  await page.goto(`${BASE}/admin/collabs/reporting`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(13000);
  await page.locator('button', { hasText: /creative angle testing/i }).first().click();
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const inp = document.querySelector('input.pc-chrome-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(inp, '2026-07');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(10000);

  const chips = await page.evaluate(() => [...document.querySelectorAll('.cx-chip')].map((c) => c.textContent.trim()));
  console.log('on: ' + chips.join(' / '));
  check(chips.some((c) => /1 angle/i.test(c)), 'the seeded angle is on screen', chips.join(' / '));

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('button', { hasText: /^\s*CSV\s*$/ }).first().click(),
  ]);
  await dl.saveAs(SP + 'apply-src.csv');
  const rows = readFileSync(SP + 'apply-src.csv', 'utf8').replace(/^\ufeff/, '').trim().split(/\r\n/);
  const cell = (l, i) => (l.match(/"([^"]*)"/g) || [])[i].slice(1, -1);
  const got = rows.slice(1).map((l) => cell(l, 1));
  check(got.length === urls.length, 'the sheet exported every video in the angle', got.length + ' of ' + urls.length);

  const out = [rows[0]];
  rows.slice(1).forEach((l) => {
    const a = cell(l, 0), u = cell(l, 1);
    out.push(u === pick ? `"${a}","${u}","7777","1,234.50","$99.25",""` : l);
  });
  /* REVERSED, to prove the row order carries no meaning */
  writeFileSync(SP + 'apply-edited.csv', '\ufeff' + [out[0], ...out.slice(1).reverse()].join('\r\n'), 'utf8');

  await page.setInputFiles('input[type=file]', SP + 'apply-edited.csv');
  await page.waitForTimeout(2500);
  const staged = await page.evaluate(() => (document.querySelector('.cx-imp') || {}).innerText || '');
  console.log('staged: ' + staged.replace(/\s+/g, ' ').slice(0, 150));
  check(/3 figures would change/i.test(staged.replace(/\s+/g, ' ')), 'three figures staged, from one reversed row');
  await page.locator('.cx-imp-b.primary').click();
  await page.waitForTimeout(10000);

  const after = await wb.from('activity_logs').select('details').eq('action', 'CREATIVE_ANGLE').eq('target', TARGET).maybeSingle();
  let d = after.data && after.data.details;
  if (typeof d === 'string') d = JSON.parse(d);
  const angle = d && Array.isArray(d.angles) ? d.angles[0] : null;
  check(!!angle, 'the import reached the database');
  if (angle) {
    console.log('\nstored against ' + pick.slice(-19) + ':');
    console.log('  viewsOverride ' + JSON.stringify((angle.viewsOverride || {})[pick]));
    console.log('  gmvOverride   ' + JSON.stringify((angle.gmvOverride || {})[pick]));
    console.log('  spend         ' + JSON.stringify((angle.spend || {})[pick]));
    check(Number((angle.viewsOverride || {})[pick]) === 7777, 'views landed on the RIGHT video', String((angle.viewsOverride || {})[pick]));
    check(Number((angle.gmvOverride || {})[pick]) === 1234.5, 'GMV parsed past the thousands comma', String((angle.gmvOverride || {})[pick]));
    check(Number((angle.spend || {})[pick]) === 99.25, 'ad spend parsed past the dollar sign', String((angle.spend || {})[pick]));
    const bled = urls.filter((u) => u !== pick).filter((u) =>
      (angle.spend || {})[u] != null || (angle.gmvOverride || {})[u] != null || (angle.viewsOverride || {})[u] != null);
    check(bled.length === 0, 'and nothing was written onto any OTHER video', bled.length + ' others touched');
  }
} finally {
  await browser.close();
  const del = await wb.from('activity_logs').delete().eq('action', 'CREATIVE_ANGLE').eq('target', TARGET);
  const left = (await wb.from('activity_logs').select('id').eq('action', 'CREATIVE_ANGLE').eq('target', TARGET)).data || [];
  check(left.length === 0, 'the throwaway test was removed again', left.length + ' left' + (del.error ? ' · ' + del.error.message : ''));
  const realAfter = (await wb.from('activity_logs').select('target,updated_at,user_display').eq('action', 'CREATIVE_ANGLE')).data || [];
  const MINE = ['import-test', 'Asad'];
  const missing = realBefore.filter((b) => !realAfter.some((a) => a.target === b.target));
  const changed = realBefore.filter((b) => realAfter.some((a) => a.target === b.target && a.updated_at !== b.updated_at));
  /* A row this run touched would carry this run's actor. One that moved and
     still carries a teammate's name is a teammate working, which is normal on
     a live database and is not a failure. */
  const byMe = changed.filter((b) => {
    const a = realAfter.find((x) => x.target === b.target);
    return a && MINE.includes(String(a.user_display || '')) && !MINE.includes(String(b.user_display || ''));
  });
  const byThem = changed.filter((b) => !byMe.includes(b));
  check(missing.length === 0, 'no real angle test disappeared', missing.map((m) => m.target).join(', ') || 'none');
  check(byMe.length === 0, 'this run wrote to nothing it did not create', byMe.map((m) => m.target).join(', ') || 'none');
  if (byThem.length) {
    console.log('  note · ' + byThem.map((b) => b.target + ' moved while this ran, still owned by ' +
      (realAfter.find((x) => x.target === b.target) || {}).user_display).join('; ') + ' — a teammate working, not this script.');
  }
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
