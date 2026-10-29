#!/usr/bin/env node
/* THREE THINGS ASAD'S TEAM ASKED FOR, on the Paid Collabs Creators tab:
 *   the tier pills actually filter, deals-per-person filters, and the CSV
 *   carries GMV. Asserts on what the screen and the file actually do.
 */
import { launchBrowser } from '../../lib/browser.mjs';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const PW = process.env.COLLAB_STAFF_PASSWORD || '1234567890';
const SP = (process.env.TMPDIR || process.env.TEMP || '.') + '/';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PW);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 40000 }).catch(() => {});
const hi = page.getByRole('button', { name: /let.s go/i });
if (await hi.first().isVisible().catch(() => false)) await hi.first().click();
await page.goto(`${BASE}/admin/collabs/creators`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(16000);

const rowCount = () => page.evaluate(() => document.querySelectorAll('.pc-cv-row').length);
const chips = () => page.evaluate(() => ({
  tiers: [...document.querySelectorAll('.pc-tierpill')].map((p) => ({
    label: (p.querySelector('.pc-tierpill-l') || {}).textContent,
    items: [...p.querySelectorAll('.pc-tierpill-chip')].map((c) => ({
      text: c.textContent.trim(), tag: c.tagName, on: c.classList.contains('on'),
      label: (c.childNodes[0] && c.childNodes[0].textContent || '').trim(),
      count: Number((c.querySelector('b') || {}).textContent || 0),
    })),
  })),
}));

/* WAIT FOR THE EUKA SWEEP TO STOP MOVING.
   Tier counts are built from a background L30 sweep that keeps merging for
   the first half-minute, so a chip read at click time and a KPI read two
   seconds later legitimately disagree. Earlier runs saw L2 at 20, 21, 24 and
   28. Asserting during that is the check lying about a moving subject. */
const tierSig = () => page.evaluate(() =>
  [...document.querySelectorAll('.pc-tierpill-chip')].map((c) => c.textContent.trim()).join('|'));
let last = null, stable = 0;
for (let i = 0; i < 40 && stable < 3; i++) {
  const sig = await tierSig();
  stable = sig && sig === last ? stable + 1 : 0;
  last = sig;
  if (stable < 3) await page.waitForTimeout(2000);
}
console.log('tier counts settled after waiting: ' + last);

const before = await rowCount();
const c0 = await chips();
console.log('strips: ' + JSON.stringify(c0.tiers.map((t) => t.label + ' [' + t.items.map((i) => i.text).join(' ') + ']')));
check(before > 0, 'the creators list has rows to filter', before + ' rows');

/* ── 1 · the tier chips are real buttons and they filter ─────────────── */
const tierStrip = c0.tiers.find((t) => /euka tiers/i.test(t.label || ''));
check(!!tierStrip, 'the EUKA Tiers strip is on screen');
check(tierStrip && tierStrip.items.every((i) => i.tag === 'BUTTON'),
  'every tier chip is a real button, not a span',
  tierStrip ? [...new Set(tierStrip.items.map((i) => i.tag))].join(',') : '');

if (tierStrip && tierStrip.items.length) {
  /* Pick by LABEL, click by INDEX. The chip renders 'L2' and '20' adjacent,
     so its textContent reads 'L220' — parsing that as a number gave 220 and
     matching it as text clicked L0. Both halves come from the DOM now. */
  const idx = tierStrip.items.findIndex((i) => i.label === 'L2');
  const pick = idx >= 0 ? idx : 0;
  /* The EUKA L30 sweep keeps landing while this runs, so tier counts move.
     Read the chip's count at the MOMENT of the click, not from a snapshot
     taken sixteen seconds earlier — that is the check-while-loading trap. */
  const target = await page.evaluate((i) => {
    const c = document.querySelectorAll('.pc-tierpill-chip')[i];
    return { label: (c.childNodes[0].textContent || '').trim(), count: Number(c.querySelector('b').textContent) };
  }, pick);
  await page.locator('.pc-tierpill-chip').nth(pick).click();
  await page.waitForTimeout(2500);
  const afterTier = await rowCount();
  const nowOn = await page.evaluate(() => [...document.querySelectorAll('.pc-tierpill-chip.on')].map((c) => c.textContent.trim()));
  console.log(`  clicked ${target.label} (count ${target.count}) → ${afterTier} rows (was ${before}); selected: ${nowOn.join(',')}`);
  check(afterTier < before, 'clicking a tier narrows the list', `${before} → ${afterTier}`);
  /* The chip counts PEOPLE — it dedupes by name — while the list shows their
     DEALS, so 20 L2 creators legitimately produce 26 rows. Comparing the two
     was the check misreading the subject, twice. The guarantee that actually
     matters to somebody using this is that the Unique Creators pill agrees
     with the chip they just pressed. */
  const unique = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.pc-kpipill-btn, [class*=kpipill]')]
      .find((e) => /Unique Creators/.test(e.textContent || ''));
    /* No regex. Written as one, the backslashes were eaten in transit and
       it became /Unique Creatorss*([d,]+)/ — matching nothing, three times. */
    const t = b ? b.textContent : '';
    const digits = [...t].filter((ch) => ch >= '0' && ch <= '9').join('');
    return digits ? Number(digits) : null;
  });
  check(unique === target.count,
    'and Unique Creators agrees with the chip that was pressed',
    `chip says ${target.count}, Unique Creators says ${unique}, rows ${afterTier}`);
  check(nowOn.length === 1, 'the pressed chip shows as selected', nowOn.join(',') || 'none marked');
  /* press again to clear */
  await page.locator('.pc-tierpill-chip.on').first().click();
  await page.waitForTimeout(2000);
  check(await rowCount() === before, 'pressing it again clears the filter', String(await rowCount()));
}

/* ── 2 · deals per person ────────────────────────────────────────────── */
const dealStrip = (await chips()).tiers.find((t) => /^deals$/i.test(String(t.label || '').trim()));
check(!!dealStrip, 'the Deals strip is on screen', dealStrip ? dealStrip.items.map((i) => i.text).join(' ') : 'MISSING');
if (dealStrip && dealStrip.items.length) {
  console.log('  deals chips: ' + dealStrip.items.map((i) => i.text).join('  '));
  const di = dealStrip.items.findIndex((i) => i.label === '2×');
  const dpick = di >= 0 ? di : dealStrip.items.length - 1;
  const two = dealStrip.items[dpick];
  const n = parseInt(two.label, 10);
  const people = two.count;
  const tierLen = (c0.tiers[0] && c0.tiers[0].items.length) || 0;
  await page.locator('.pc-tierpill-chip').nth(tierLen + dpick).click();
  await page.waitForTimeout(2500);
  const afterDeals = await rowCount();
  console.log(`  clicked ${two.label}${people} → ${afterDeals} rows`);
  check(afterDeals > 0, `filtering to ${n} deals shows rows`, afterDeals + ' rows');
  check(afterDeals === n * people, 'and the row count is exactly people x deals', `${people} people x ${n} deals = ${n * people}, list shows ${afterDeals}`);
  await page.locator('.pc-tierpill-chip.deals.on').first().click();
  await page.waitForTimeout(2000);
}

/* ── 3 · the CSV carries GMV ─────────────────────────────────────────── */
await page.evaluate(() => {
  const cb = document.querySelector('.pc-cv-row input[type=checkbox]');
  if (cb) cb.click();
});
await page.waitForTimeout(1500);
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.locator('button', { hasText: /^\s*CSV\s*$/ }).first().click(),
]);
await dl.saveAs(SP + 'creators-out.csv');
const csv = readFileSync(SP + 'creators-out.csv', 'utf8').trim().split(/\r?\n/);
const head = csv[0].split(',');
console.log('  CSV header: ' + csv[0]);
console.log('  CSV row 1 : ' + (csv[1] || '(none)'));
check(head.includes('L30 GMV'), 'the creators CSV has a GMV column', csv[0]);
check(csv.length > 1, 'and at least one row', (csv.length - 1) + ' rows');

check(errors.length === 0, 'zero console errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
