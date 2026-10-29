/*
 * PERFORMANCE PROBE (temporary, performance agent). Measures, changes nothing.
 *
 * Loads each reachable page on a CPU-throttled mobile renderer, records every
 * network response that counts toward the payload, and reads the paint, long
 * task and layout shift entries back out of the page.
 *
 * PERF_BASE   origin to measure (default http://localhost:4199)
 * PERF_CPU    CPU throttling multiplier (default 5)
 * PERF_PAGES  comma separated paths
 * PERF_SETTLE ms to sit on the page after `load` before reading entries
 */
import { launchBrowser } from '../lib/browser.mjs';

const BASE = process.env.PERF_BASE || 'http://localhost:4199';
const THROTTLE = Number(process.env.PERF_CPU || 5);
const PAGES = (process.env.PERF_PAGES || '/,/login,/apply').split(',');
const SETTLE = Number(process.env.PERF_SETTLE || 6000);

function installObservers() {
  window.__perf = { longTasks: [], shifts: [], cls: 0, lcp: 0 };
  const perf = window.__perf;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        perf.longTasks.push({ d: Math.round(e.duration), s: Math.round(e.startTime) });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {
    /* unsupported: the field stays empty rather than failing the run */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        perf.cls += e.value;
        perf.shifts.push({ v: Number(e.value.toFixed(4)), s: Math.round(e.startTime) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {
    /* as above */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) perf.lcp = Math.round(e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {
    /* as above */
  }
}

const IMG = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.gif'];

function kind(url, type) {
  const base = url.split('?')[0].toLowerCase();
  const ext = base.slice(base.lastIndexOf('.'));
  if (ext === '.css' || type === 'stylesheet') return 'css';
  if (ext === '.js' || ext === '.mjs' || type === 'script') return 'js';
  if (ext === '.woff2' || ext === '.woff' || type === 'font') return 'font';
  if (IMG.includes(ext) || type === 'image') return 'img';
  if (ext === '.html' || ext === '.htm' || type === 'document') return 'html';
  return 'other';
}

const browser = await launchBrowser();
const out = [];

for (const path of PAGES) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  });
  await ctx.addInitScript(installObservers);
  const page = await ctx.newPage();

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const seen = new Map();
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.startsWith(BASE)) return;
    if (seen.has(url)) return;
    let bytes = 0;
    try {
      bytes = Number(res.headers()['content-length'] || 0);
      if (!bytes) bytes = (await res.body()).length;
    } catch (e) {
      /* a response whose body is gone is still worth counting as a request */
    }
    seen.set(url, { bytes, k: kind(url, res.request().resourceType()), status: res.status() });
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

  const t0 = Date.now();
  await page
    .goto(BASE + path, { waitUntil: 'load', timeout: 60000 })
    .catch((e) => errors.push('goto: ' + e.message));
  await page.waitForTimeout(SETTLE);

  const perf = await page.evaluate(() => {
    const p = window.__perf || { longTasks: [], shifts: [], cls: 0, lcp: 0 };
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = {};
    for (const e of performance.getEntriesByType('paint')) paints[e.name] = Math.round(e.startTime);
    let decoded = 0;
    for (const e of performance.getEntriesByType('resource')) decoded += e.decodedBodySize || 0;
    return {
      fcp: paints['first-contentful-paint'] ?? null,
      lcp: p.lcp,
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      cls: Number((p.cls || 0).toFixed(4)),
      shifts: p.shifts.slice(0, 10),
      longTasks: p.longTasks.filter((t) => t.d > 50),
      requests: performance.getEntriesByType('resource').length,
      decodedBytes: decoded,
    };
  });

  const byKind = {};
  let total = 0;
  const files = [];
  for (const [url, v] of seen) {
    byKind[v.k] = (byKind[v.k] || 0) + v.bytes;
    total += v.bytes;
    files.push({ f: url.replace(BASE, ''), ...v });
  }
  files.sort((a, b) => b.bytes - a.bytes);

  out.push({
    path,
    cpuThrottle: THROTTLE,
    wallMs: Date.now() - t0,
    ...perf,
    tbt: perf.longTasks.reduce((s, t) => s + (t.d - 50), 0),
    transferTotal: total,
    byKind,
    top: files.slice(0, 20),
    allFiles: files,
    jsCount: files.filter((f) => f.k === 'js').length,
    errors,
  });

  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
