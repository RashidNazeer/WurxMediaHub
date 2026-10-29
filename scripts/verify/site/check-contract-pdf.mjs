#!/usr/bin/env node
/**
 * THE CREATOR CONTRACT, AS IT COMES OUT OF THE REAL APP.
 *
 *   pnpm build && pnpm preview
 *   node scripts/verify/site/check-contract-pdf.mjs
 *
 * Rashid, 2026-10-02, with a mockup: "all i want is to update the ui of the
 * contract it's very boring and also add some extra stuff in it".
 *
 * ── WHY IT DRIVES THE APP INSTEAD OF CALLING THE RENDERER ────────────────
 * The renderer draws a signature on an offscreen canvas and stamps a base64
 * PNG of the wordmark, and neither of those exists in Node — so a check that
 * imported the module and called it would pass on a document that comes out of
 * a browser with a hole where the header should be. This clicks the button a
 * person clicks, catches the file the browser saves, and reads THAT.
 *
 * jsPDF writes uncompressed streams, so the saved file can be searched for the
 * words that should be in it without adding a PDF library to the repo.
 *
 * Nothing is written to the database. The download is saved to a temp file and
 * deleted.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../../lib/browser.mjs';
import { tokenise, segmentsOf } from '../../../src/routes/admin/contract-paper.js';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const BRAND = process.env.CONTRACT_BRAND || 'Irwin Naturals';
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/* ════════════════════════════════════════════════════════════════════════
   1. THE TEXT TOKENISER, where the old renderer quietly mangled sentences.
   This is a pure function and is tested as one, because the failure it had
   is invisible to every check that only asks whether a PDF appeared.
   ════════════════════════════════════════════════════════════════════════ */
{
  const t = tokenise(segmentsOf('ends on **September 30, 2026**.'));
  const words = t.map((x) => x.w);
  check(words.join('|') === 'ends|on|September|30,|2026|.',
    'the tokeniser keeps every word, including the full stop', words.join('|'));
  const dot = t[t.length - 1];
  check(dot && dot.w === '.' && dot.sp === false,
    'A FULL STOP AFTER A BOLD RUN CARRIES NO SPACE — the "2026 ." bug',
    dot ? `sp=${dot.sp}` : 'no token');
  check(t.find((x) => x.w === 'on')?.sp === true,
    'and an ordinary word still gets its space');
  check(t.find((x) => x.w === '2026')?.b === true,
    'the bold run is still marked bold');
  check(tokenise(segmentsOf('**all at once**. A minimum'))
    .filter((x) => x.w === '.' || x.w === 'A')
    .map((x) => x.sp).join(',') === 'false,true',
    'mid-sentence: the stop glues on, the next sentence does not');
  check(tokenise(segmentsOf('')).length === 0, 'empty text makes no tokens');
  check(tokenise(segmentsOf('one'))[0].sp === false, 'the first word never carries a leading space');
}

/* ════════════════════════════════════════════════════════════════════════
   2. THE DOCUMENT A PERSON ACTUALLY GETS
   ════════════════════════════════════════════════════════════════════════ */
const dir = mkdtempSync(join(tmpdir(), 'wx-contract-'));
const browser = await launchBrowser();
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, acceptDownloads: true });
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
  check(await row.count().catch(() => 0) > 0, `${BRAND} is on the Brands screen`);
  if (await row.count().catch(() => 0)) {
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click();
    await page.waitForSelector('.pc-ct-row', { timeout: 40000 }).catch(() => {});
    /* Wait for the table to settle — the empty state shows while it loads. */
    let last = -1, same = 0;
    for (let i = 0; i < 30; i++) {
      const n = await page.locator('.pc-ct-row').count().catch(() => -1);
      same = n === last ? same + 1 : 0; last = n;
      if (n > 0 && same >= 1) break;
      await page.waitForTimeout(600);
    }

    const btn = page.locator('.pc-ct-row .pc-contract-btn').first();
    check(await btn.count().catch(() => 0) > 0, 'a creator row offers a contract to download');

    if (await btn.count().catch(() => 0)) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 40000 }),
        btn.click(),
      ]).catch((e) => { check(false, 'clicking it produces a download', String(e.message).slice(0, 80)); return []; });

      if (download) {
        const name = download.suggestedFilename();
        check(/\.pdf$/i.test(name), 'the file is a PDF', name);
        const path = join(dir, 'contract.pdf');
        await download.saveAs(path);
        const raw = readFileSync(path);
        const txt = raw.toString('latin1');

        /*
         * WHAT WAS ACTUALLY DRAWN, in order.
         *
         * Searching the raw bytes for "AGENCY:" finds nothing, and that is not
         * a missing label: the letter-spaced ones are drawn a CHARACTER AT A
         * TIME, because PDF has no tracking setting — the stream holds `(A) Tj
         * (G) Tj (E) Tj`. The first version of this file probed the bytes and
         * reported three labels missing that are plainly on the page. Pulling
         * the drawn strings out in order and joining them asks the right
         * question: what does this document say?
         */
        const drawn = [...txt.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)]
          .map((m) => m[1].replace(/\\([()\\])/g, '$1'))
          .join('');
        check(drawn.length > 1000, 'the document has text in it to read', `${drawn.length} characters drawn`);

        check(raw.length > 20_000, 'it is a real document, not an empty shell', `${Math.round(raw.length / 1024)}KB`);

        /* ── the page, as a piece of paper ──────────────────────────── */
        const boxes = [...txt.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
          .map((m) => `${Math.round(+m[1])}x${Math.round(+m[2])}`);
        check(boxes.length >= 2, 'it runs to more than one page', `${boxes.length} pages`);
        check(boxes.length > 0 && boxes.every((b) => b === '612x792'),
          'EVERY page is letter portrait — the pages stack vertically, as Rashid asked',
          [...new Set(boxes)].join(' '));

        /* ── the chrome ─────────────────────────────────────────────── */
        /*
         * TWO DIFFERENT images, and they are told apart BY SIZE.
         *
         * "at least two image objects" was the first version of this check and
         * it proved nothing: the wordmark alone is embedded more than once (a
         * transparent PNG becomes an image plus its alpha mask), so a document
         * with no signature at all would have sailed through. The mark is
         * 228x64 — `public/wurx-logo.png`, byte for byte — and the signature is
         * whatever the canvas in `contract-paper.js` is sized to, 360x110.
         * Node has no canvas, so this is also the assertion that would catch a
         * renderer that only works outside a browser.
         */
        const sizes = [...txt.matchAll(/\/Subtype\s*\/Image(?:.|\n){0,240}?\/Width\s+(\d+)(?:.|\n){0,120}?\/Height\s+(\d+)/g)]
          .map((m) => `${m[1]}x${m[2]}`);
        check(sizes.includes('228x64'), 'the wordmark is embedded, at its own size',
          sizes.join(' ') || 'no images found');
        check(sizes.includes('360x110'),
          'and the signature the BROWSER draws on a canvas is in the file',
          sizes.join(' ') || 'no images found');
        const feet = (txt.match(/wurxmedia\.com/g) || []).length;
        check(feet >= boxes.length, 'every page carries the footer',
          `${feet} footers for ${boxes.length} pages`);
        check(/\b01 \/ 0\d/.test(txt), 'the pages are numbered "01 / 04"');

        /* ── what the document says ─────────────────────────────────── */
        for (const [probe, why] of [
          ['CREATION AGREEMENT', 'the title'],
          ['CONTENT', 'the eyebrow above it'],
          ['BRAND:', 'the brand line in the parties box'],
          ['CREATOR:', 'the creator line'],
          ['AGENCY:', 'the agency line, which is new'],
          ['EFFECTIVE DATE:', 'the effective date'],
          ['Purpose', 'the first section'],
          ['Signatures', 'the signatures page'],
          ['Brand Representative', 'the brand signing block'],
          ['Agency Representative', 'the AGENCY signing block, which is new'],
          ['wurxmedia.com', 'the footer'],
        ]) {
          check(drawn.includes(probe), `it says ${why}`, probe);
        }
        /* The creator this row is for, not a stranger's name. */
        check(/Irwin Naturals/.test(drawn), 'and it names the brand it was generated from');

        /* ── the signatures are on a page of their own ──────────────── */
        const pages = txt.split('/MediaBox');
        const sigPage = pages.findIndex((p) => p.includes('Signature'));
        check(sigPage > 1, 'the signatures are not on the first page', `page index ${sigPage}`);

        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  check(errors.length === 0, 'zero console errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
