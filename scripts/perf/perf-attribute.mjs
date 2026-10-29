/*
 * JANK ATTRIBUTION (temporary, performance agent).
 *
 * `perf-jank.mjs` says the landing page drops almost every frame while
 * scrolling. This says WHY, by re-running the same scroll with one suspect
 * neutralised at a time and comparing. Nothing here edits the app: each
 * variant is a stylesheet or an emulation applied to the loaded page, so the
 * numbers point at an owner without changing anybody's file.
 *
 * Variants:
 *   baseline          as shipped
 *   aurora-still      .wx-aurora-field stops drifting, everything else stands
 *   aurora-unblurred  its `filter: blur()` removed, the layer still there
 *   aurora-hidden     the layer gone entirely
 *   glass-off         backdrop-filter removed (the glass system)
 *   no-animation      every CSS animation and transition stopped
 *   reduced-motion    the OS "reduce motion" setting the app already honours
 *
 * EVERY VARIANT RUNS `PERF_REPEATS` TIMES, INTERLEAVED, AND THE MEDIAN OF THE
 * MEDIANS IS WHAT IS REPORTED. That is not caution for its own sake: on
 * 2026-10-16 one variant measured 21ms and 83ms on consecutive runs of the
 * same build, because other work on the machine moved underneath it. Running
 * each variant once and ranking the results produced a confident, wrong
 * answer. Interleaving matters too — six runs of A then six of B would blame
 * A for whatever else started halfway through.
 *
 * CPU throttled, mobile viewport. Set PERF_GPU=1: without it WebGL never
 * initialises and blur is software-rasterised, which changes the ranking.
 */
import { chromium } from 'playwright';
import { launchBrowser } from '../lib/browser.mjs';

const BASE = process.env.PERF_BASE || 'http://localhost:4199';
const THROTTLE = Number(process.env.PERF_CPU || 4);
const PATH_ = process.env.PERF_PATH || '/';
const REPEATS = Number(process.env.PERF_REPEATS || 3);

/*
 * PERF_WIDTH defaults to a phone, because that is what creators use. Set it to
 * 1440 to reach the things gated behind `min-width: 64rem` — the Vanta/three.js
 * wave field is desktop-only, so at 390px the `webgl-off` row below is
 * identical to baseline and proves nothing.
 */
const WIDTH = Number(process.env.PERF_WIDTH || 390);
const HEIGHT = Number(process.env.PERF_HEIGHT || 844);

const NO_BACKDROP = `backdrop-filter:none !important;-webkit-backdrop-filter:none !important`;

const VARIANTS = {
  baseline: { css: null },
  /*
   * THE NULL CONTROL. READ THIS ROW BEFORE ANY OTHER.
   *
   * Its stylesheet targets an attribute nothing in this app has, so it changes
   * nothing and MUST land on the same fps as `baseline`. When it does not, the
   * machine is too busy for this suite and the ordering of every other row is
   * meaningless.
   *
   * This is here because that is exactly what happened on 2026-10-17. A
   * `webgl-hidden` row was measured at 390px, where `useWavesEligible()` has
   * already returned false and there is no WebGL element to hide — verified by
   * DOM probe at 390/768/1024/1440px — so it was an accidental null control.
   * It came out at 32fps against a baseline of 8fps. Nothing was hidden and
   * the page got four times faster, which is the whole lesson: the numbers
   * from that run supported a confident ranking that was pure scheduler noise.
   * Without a control row there was no way to see it, and the conclusion would
   * have been published.
   */
  'control-noop': { css: `[data-wx-no-such-attribute]{outline:0}` },
  'aurora-still': { css: `.wx-aurora-field{animation:none !important}` },
  'aurora-unblurred': { css: `.wx-aurora-field{filter:none !important}` },
  'aurora-hidden': { css: `.wx-aurora-field{display:none !important}` },
  /* The GL canvas keeps rendering when hidden, so this stops the compositor
     having to put it on screen but NOT three.js drawing it. The pair of rows
     therefore separates "costly to composite" from "costly to run". */
  'webgl-hidden': { css: `[data-wx-waves]{display:none !important}` },
  'glass-off': { css: `*,*::before,*::after{${NO_BACKDROP}}` },
  'no-animation': { css: `*,*::before,*::after{animation:none !important;transition:none !important}` },
  'reduced-motion': { css: null, reducedMotion: 'reduce' },
};

/*
 * A FIXED-DURATION SCROLL, AND FRAMES-PER-SECOND AS THE HEADLINE.
 *
 * The first version of this walked the page in `setTimeout` steps and reported
 * the median gap between animation frames. Two things were wrong with that.
 * The sample was tiny — about 40 frames — so one hiccup moved the median by
 * tens of milliseconds, and the scroll finished sooner on a fast variant than
 * a slow one, so the variants were not even measured over the same window.
 * Run that way, `no-animation` came out SLOWER than baseline, which cannot be
 * true and was the tell that the numbers were noise.
 *
 * So: scroll for exactly DURATION milliseconds, moving a little on every frame
 * the way a fling does, and count how many frames actually got rendered. Over
 * a fixed window that count IS the frame rate, it needs no percentile, and one
 * stall costs it a few frames rather than relocating a median.
 */
const SCROLL = async () => {
  const DURATION = 6000;
  const intervals = [];
  const t0 = performance.now();
  let last = t0;
  let frames = 0;
  let down = true;

  await new Promise((resolve) => {
    const tick = (now) => {
      intervals.push(now - last);
      last = now;
      frames += 1;

      /* Turn round at the ends rather than stopping, so a short page and a
         long one are both scrolling for the whole window. */
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

  const elapsed = performance.now() - t0;
  const f = intervals.slice(1).sort((a, b) => a - b);
  const pct = (p) => Math.round(f[Math.floor((f.length - 1) * p)] || 0);
  return {
    fps: Math.round((frames / elapsed) * 1000 * 10) / 10,
    frames,
    median: pct(0.5),
    p95: pct(0.95),
    worst: Math.round(f[f.length - 1] || 0),
    dropped: Math.round((f.filter((x) => x > 32).length / f.length) * 100),
  };
};

/*
 * PERF_GPU=1 LAUNCHES WITHOUT `--disable-gpu`, AND FOR THIS SUITE THAT MATTERS.
 *
 * `browser.mjs` disables the GPU for every suite — see its header, it is about
 * this machine's RAM — and its own note says to take the flags off for a suite
 * that needs a real GPU. This is that suite. `backdrop-filter` and
 * `filter: blur()` are exactly what is being weighed here, and software
 * rasterisation makes both look far worse than they are on a phone, which has
 * a GPU. Measured 2026-10-16: the same page, the same scroll, put the median
 * frame at 178ms software-rendered and 37ms GPU-rasterised, and the ranking of
 * the variants changed with it. Reading the software number as a phone number
 * would send somebody off to rewrite the wrong stylesheet.
 *
 * ALSO: THESE NUMBERS NEED AN IDLE MACHINE, which is a real limitation rather
 * than a caveat. Repeating one pair six times while five other agents and two
 * dev servers were running produced medians from 21ms to 83ms for the SAME
 * variant. Any single run here is an anecdote; run each variant at least three
 * times on a quiet machine before believing an ordering.
 */
/*
 * A FRESH BROWSER PER RUN, not one browser reused for every context.
 *
 * Reusing one Chromium for 21 contexts let renderer memory and GC pressure
 * build up across the sweep, so a variant measured late scored worse than the
 * same variant measured early — drift that interleaving cannot cancel because
 * it is monotonic rather than random. Launching per run costs a couple of
 * seconds and buys an independent measurement.
 */
const launch = () =>
  process.env.PERF_GPU
    ? chromium.launch({
        args: [
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--no-first-run',
          '--no-default-browser-check',
          '--enable-gpu-rasterization',
          '--ignore-gpu-blocklist',
        ],
      })
    : launchBrowser();
/** One measured scroll of one variant, in its own fresh browser. */
async function run(cfg) {
  const b = await launch();
  const ctx = await b.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    isMobile: WIDTH < 900,
    hasTouch: WIDTH < 900,
    ...(cfg.reducedMotion ? { reducedMotion: cfg.reducedMotion } : {}),
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(BASE + PATH_, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  /* Let startup finish, so what follows is steady-state jank rather than the
     tail of the load being blamed on scrolling. */
  await page.waitForTimeout(6000);
  if (cfg.css) await page.addStyleTag({ content: cfg.css });
  await page.waitForTimeout(600);
  const out = await page.evaluate(SCROLL);
  await ctx.close();
  await b.close();
  return out;
}

const samples = new Map(Object.keys(VARIANTS).map((k) => [k, []]));

for (let pass = 1; pass <= REPEATS; pass += 1) {
  for (const [name, cfg] of Object.entries(VARIANTS)) {
    samples.get(name).push(await run(cfg));
    process.stderr.write(`  pass ${pass}/${REPEATS}  ${name}\n`);
  }
}


const mid = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

const rows = [...samples].map(([name, runs]) => ({
  name,
  fps: mid(runs.map((r) => r.fps)),
  frames: mid(runs.map((r) => r.frames)),
  median: mid(runs.map((r) => r.median)),
  p95: mid(runs.map((r) => r.p95)),
  worst: mid(runs.map((r) => r.worst)),
  dropped: mid(runs.map((r) => r.dropped)),
  /* The spread across repeats. If this is as wide as the gap between two
     variants, the ordering of those two means nothing. */
  spread: Math.min(...runs.map((r) => r.fps)) + '-' + Math.max(...runs.map((r) => r.fps)),
}));
console.log(
  `path=${PATH_}  ${WIDTH}x${HEIGHT}  CPUx${THROTTLE}  ` +
    `gpu=${process.env.PERF_GPU ? 'on' : 'off (software rasterisation)'}  ` +
    `repeats=${REPEATS} (medians of ${REPEATS}, interleaved)\n`
);
console.log(
  'variant'.padEnd(18) + '   fps  frames  median    p95   worst  dropped   fps spread'
);
for (const r of rows)
  console.log(
    r.name.padEnd(18) +
      String(r.fps).padStart(6) +
      String(r.frames).padStart(8) +
      String(r.median + 'ms').padStart(8) +
      String(r.p95 + 'ms').padStart(7) +
      String(r.worst + 'ms').padStart(8) +
      String(r.dropped + '%').padStart(9) +
      ('  ' + r.spread + 'fps').padStart(15)
  );
console.log(
  '\n`fps spread` is the min-max across repeats. Where it overlaps another' +
    "\nvariant's, those two variants are not distinguishable in this run."
);

/*
 * The control check, stated rather than left for the reader to notice. A run
 * that fails this has still produced a number for every row, which is exactly
 * why it needs saying out loud.
 */
const base = rows.find((r) => r.name === 'baseline');
const ctrl = rows.find((r) => r.name === 'control-noop');
if (base && ctrl) {
  const worse = Math.max(base.fps, ctrl.fps);
  const better = Math.min(base.fps, ctrl.fps) || 0.1;
  const ratio = worse / better;
  console.log(
    `\ncontrol: baseline ${base.fps}fps vs control-noop ${ctrl.fps}fps ` +
      `(${ratio.toFixed(2)}x apart)`
  );
  console.log(
    ratio <= 1.25
      ? 'CONTROL OK — the two should match, and do. The ordering above is usable.'
      : 'CONTROL FAILED — these two are the SAME page and did not match, so this\n' +
        'machine is too contended for this suite. DO NOT rank the rows above.\n' +
        'Close other work, or raise PERF_REPEATS, and run it again.'
  );
}
