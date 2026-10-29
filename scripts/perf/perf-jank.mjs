/*
 * SCROLL JANK PROBE (temporary, performance agent).
 *
 * Rashid's complaint is two things, and they need two measurements: pages that
 * "take really long to load" (perf-probe.mjs) and pages that "gitter" once
 * they are up. This measures the second one, which load metrics cannot see.
 *
 * It scrolls the page the way a thumb does and records the interval between
 * animation frames. At 60Hz a frame is 16.7ms, so anything past ~32ms means at
 * least one frame was dropped and the motion visibly steps.
 *
 * CPU is throttled because the complaint is about phones.
 *
 * KNOWN BLIND SPOT: `scripts/lib/browser.mjs` launches with `--disable-gpu`, so a
 * WebGL background (WavesField/three.js) never initialises here and its cost
 * is NOT in these numbers. Said plainly in the report rather than papered over.
 */
import { launchBrowser } from '../lib/browser.mjs';

const BASE = process.env.PERF_BASE || 'http://localhost:4199';
const THROTTLE = Number(process.env.PERF_CPU || 4);
const PAGES = (process.env.PERF_PAGES || ',/apply').split(',');

const b = await launchBrowser();
const out = [];

for (const raw of PAGES) {
  const path = raw || '/';
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  /* Let the first-load work finish, so what follows is steady-state jank and
     not the tail of startup being blamed on scrolling. */
  await page.waitForTimeout(6000);

  const result = await page.evaluate(async () => {
    const frames = [];
    let last = performance.now();
    let stop = false;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const height = document.documentElement.scrollHeight;
    const step = Math.max(40, Math.round(window.innerHeight / 6));
    for (let y = 0; y < height - window.innerHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    stop = true;
    await new Promise((r) => setTimeout(r, 120));

    /* The first interval is measured from before the loop started, so it is
       not a frame time at all. */
    const f = frames.slice(1);
    f.sort((a, b2) => a - b2);
    const pct = (p) => Math.round(f[Math.floor((f.length - 1) * p)] || 0);
    return {
      scrollHeight: height,
      frames: f.length,
      medianMs: pct(0.5),
      p95Ms: pct(0.95),
      worstMs: Math.round(f[f.length - 1] || 0),
      droppedPct: Math.round((f.filter((x) => x > 32).length / f.length) * 100),
      badlyDroppedPct: Math.round((f.filter((x) => x > 100).length / f.length) * 100),
    };
  });

  out.push({ path, cpuThrottle: THROTTLE, ...result });
  await ctx.close();
}

await b.close();
for (const r of out) {
  console.log(
    `${r.path.padEnd(10)} CPUx${r.cpuThrottle}  frames=${String(r.frames).padStart(4)}  ` +
      `median=${String(r.medianMs).padStart(4)}ms  p95=${String(r.p95Ms).padStart(5)}ms  ` +
      `worst=${String(r.worstMs).padStart(5)}ms  dropped>32ms=${String(r.droppedPct).padStart(3)}%  ` +
      `>100ms=${r.badlyDroppedPct}%`
  );
}
