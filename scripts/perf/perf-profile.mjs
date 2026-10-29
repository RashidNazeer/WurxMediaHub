/*
 * CPU PROFILE OF A SCROLL (temporary, performance agent).
 *
 * `perf-attribute.mjs` answers "which layer costs frames" by removing things.
 * This answers the other half — "which JAVASCRIPT costs frames" — by taking a
 * real V8 sample profile during the same scroll and adding up self time per
 * function.
 *
 * It exists because the alternative is reading the source and guessing which
 * hook is expensive. Function names survive minification badly, so the output
 * is grouped by name AND by the chunk the frame came from, which is usually
 * enough to tell Motion's internals from ours.
 *
 * PERF_GPU=1 for real compositing (see the note in perf-attribute.mjs).
 * PERF_CPU is the throttle multiplier; the profile is of a throttled run, so
 * the millisecond numbers are phone-shaped rather than desktop-shaped.
 */
import { chromium } from 'playwright';
import { launchBrowser } from '../lib/browser.mjs';

const BASE = process.env.PERF_BASE || 'http://localhost:4199';
const THROTTLE = Number(process.env.PERF_CPU || 4);
const PATH_ = process.env.PERF_PATH || '/';
const TOP = Number(process.env.PERF_TOP || 25);
/* 1440 reaches the desktop-only WebGL field; 390 is the creator case. */
const WIDTH = Number(process.env.PERF_WIDTH || 390);
const HEIGHT = Number(process.env.PERF_HEIGHT || 844);

const b = process.env.PERF_GPU
  ? await chromium.launch({
      args: [
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--enable-gpu-rasterization',
        '--ignore-gpu-blocklist',
      ],
    })
  : await launchBrowser();

const ctx = await b.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  isMobile: WIDTH < 900,
  hasTouch: WIDTH < 900,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

await page.goto(BASE + PATH_, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
/* Startup finished, so the profile is of scrolling and not of booting. */
await page.waitForTimeout(6000);

await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');

await page.evaluate(async () => {
  const DURATION = 6000;
  const t0 = performance.now();
  let down = true;
  await new Promise((resolve) => {
    const tick = (now) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0) {
        const y = window.scrollY;
        if (down && y >= max - 2) down = false;
        else if (!down && y <= 2) down = true;
        window.scrollBy(0, down ? 24 : -24);
      }
      if (now - t0 < DURATION) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
});

const { profile } = await cdp.send('Profiler.stop');
await b.close();

/* Self time per node: V8 gives a flat node list plus a sample stream, so the
   sample count per node IS its self time once multiplied by the interval. */
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const deltas = profile.timeDeltas || [];
profile.samples.forEach((id, i) => {
  self.set(id, (self.get(id) || 0) + (deltas[i] || 0));
});

const rows = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  if (!n) continue;
  const cf = n.callFrame || {};
  const name = cf.functionName || '(anonymous)';
  const file = (cf.url || '').split('/').pop() || '(native)';
  const key = `${name} @ ${file}`;
  rows.set(key, (rows.get(key) || 0) + us / 1000);
}

const total = [...rows.values()].reduce((a, c) => a + c, 0);
const sorted = [...rows].sort((a, b2) => b2[1] - a[1]);

console.log(
  `path=${PATH_}  ${WIDTH}x${HEIGHT}  CPUx${THROTTLE}  gpu=${process.env.PERF_GPU ? 'on' : 'off'}  6s scroll\n`
);
console.log(`total sampled main-thread time: ${total.toFixed(0)}ms\n`);
/*
 * READ `(program)` AND `(idle)` FIRST, THEN THE FUNCTIONS.
 *
 * `(idle)` is the main thread with nothing to do and `(program)` is time
 * inside the engine and the browser rather than in any JavaScript frame —
 * style, layout, paint and compositing. If those two dominate, the scroll is
 * paint-bound and no amount of rewriting the functions below will help; go to
 * `perf-attribute.mjs` and find the layer that is expensive to draw.
 *
 * `tick` is this probe's own scroll loop. It is measurement overhead, not the
 * app, and should be ignored.
 */
console.log('    self ms   share  function @ chunk');
for (const [k, ms] of sorted.slice(0, TOP)) {
  if (ms < 1) break;
  console.log(
    `  ${ms.toFixed(1).padStart(9)}  ${((ms / total) * 100).toFixed(1).padStart(5)}%  ${k}`
  );
}
