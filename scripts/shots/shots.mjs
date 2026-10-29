#!/usr/bin/env node
/**
 * Design-review screenshots.
 *
 * Captures retina (2x) images of a page in dark and light, at desktop and
 * phone widths, so the design can be reviewed without opening a browser.
 * Scrolls the whole page first, otherwise `whileInView` sections are still
 * invisible and the shot is mostly empty.
 *
 * Usage:
 *   node scripts/shots/shots.mjs [baseUrl] [path]
 *   node scripts/shots/shots.mjs http://localhost:4173 /apply
 */

import { launchBrowser } from '../lib/browser.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const PATHNAME = process.argv[3] ?? '/';
const OUT = '.playwright';
mkdirSync(OUT, { recursive: true });

const slug = PATHNAME === '/' ? 'home' : PATHNAME.replace(/\W+/g, '-').replace(/^-|-$/g, '');

const VIEWS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 393, height: 852 },
];

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.75;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 130));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
  await page.waitForTimeout(600);
}

const browser = await launchBrowser();

for (const scheme of ['dark', 'light']) {
  for (const view of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    await page.goto(BASE + PATHNAME, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800); // let entrance animations and counters settle
    await scrollThrough(page);

    // Above-the-fold crop, which is what actually gets judged.
    await page.screenshot({
      path: `${OUT}/${slug}-${scheme}-${view.name}-fold.png`,
      clip: { x: 0, y: 0, width: view.width, height: view.height },
    });
    await ctx.close();
    console.log(`  wrote ${OUT}/${slug}-${scheme}-${view.name}-fold.png`);
  }
}

await browser.close();
console.log('done');
