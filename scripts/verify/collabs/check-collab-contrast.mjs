#!/usr/bin/env node
/**
 * Every piece of text inside Paid Collabs, measured against what is behind it.
 *
 * WHY THIS EXISTS. The vendored WurxBase stylesheet is re-themed by
 * `vendor-wurxbase.mjs`, and most of that mapping is inferred rather than
 * hand-written. The failure it produces is not an error: a label mapped to the
 * wrong token simply disappears into its own background, and the page still
 * renders, still passes every functional check, and looks fine in whichever
 * theme you happened to open. The first v382 pull put near-black creator names
 * on a near-black table and nothing anywhere complained.
 *
 * So this walks the rendered page, resolves the ACTUAL painted colours, and
 * reports the worst pairs. It is the only honest way to know, because the
 * source CSS cannot tell you what ends up on top of what.
 *
 * Needs a server:
 *   pnpm build; pnpm preview
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-collab-contrast.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { launchBrowser } from '../../lib/browser.mjs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
assertDevProject(env.VITE_SUPABASE_URL, 'check-collab-contrast.mjs');
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');
const BASE = process.env.BASE_URL || 'http://localhost:4173';

/**
 * WCAG AA, PER ELEMENT — not one floor for everything.
 *
 * This used to fail below 3.0 and merely warn between 3.0 and 4.5, on the
 * grounds that "large text is allowed 3.0". Large text is. Body text is not,
 * and body text is most of a screen — so a 12px label at 3.1:1 sailed through
 * as a warning nobody read, on a guard whose whole job is to say whether a
 * label is readable. It measured the right thing and then applied the wrong
 * threshold to it, which is the same class of mistake as not measuring.
 *
 * The real rule: 3.0 for large text — 24px and up, or 18.66px and up at weight
 * 700 — and 4.5 for everything else.
 */
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
const floorFor = (r) =>
  r.size >= LARGE_PX || (r.size >= LARGE_BOLD_PX && r.weight >= 700) ? 3.0 : 4.5;

/*
 * How much of each tab this guard is entitled to measure.
 *
 * THIS IS THE REAL PROTECTION, and the reason it exists is worth keeping.
 * These tabs were measured after a flat 2200ms, which was ample while they
 * only read our own database. Restoring the Euka endpoint put proxy calls
 * behind them, and the guard measured SEVEN elements on a tab that has 2085 —
 * and said PASS, because seven readable labels are seven readable labels. A
 * guard that quietly covers less while reporting the same verdict is this
 * project's most repeated bug.
 *
 * A wait cannot protect against that on its own: waits get outrun by the next
 * thing that makes a page slower. A floor can, because it asks the question
 * that actually matters — did we measure as much as last time? The numbers are
 * roughly two thirds of a known-good run, so ordinary variation passes and a
 * half-drawn screen does not.
 */
const FLOOR = {
  brands: 60,
  creators: 1200,
  performance: 90,
  reporting: 70,
  leaderboard: 70,
  discovery: 10,
};

/*
 * Wait for a tab to have rendered its data, then stop.
 *
 * Settled means: at least one Euka call has come back since this navigation,
 * so data has actually arrived, AND the DOM has been the same size for three
 * consecutive polls.
 *
 * IT DELIBERATELY DOES NOT WAIT FOR EVERY EUKA CALL TO FINISH. Opening Brands
 * kicks off a background sweep of all ten stores — seven seconds each, plus a
 * video sync — and none of it changes the text already on screen. Waiting for
 * silence made one tab take two and a half minutes and the whole guard
 * unrunnable, which is its own kind of failure: a check nobody runs is a check
 * that does not exist. The floor above is what keeps this honest.
 */
async function settle(page, euka, { quiet = 3, every = 700, cap = 45_000 } = {}) {
  const started = Date.now();
  let last = -1;
  let still = 0;
  while (Date.now() - started < cap) {
    await page.waitForTimeout(every);
    const n = await page.evaluate(() => document.querySelectorAll('.wurxbase-root *').length);
    if (n !== last) { last = n; still = 0; continue; }
    if (euka.answered === 0) { still = 0; continue; }   // nothing has come back yet
    if (n > 0 && ++still >= quiet) return n;
  }
  return Math.max(last, 0);
}

/* Euka calls sent and answered since the last navigation. */
function trackEuka(page) {
  const state = { answered: 0, total: 0, reset() { this.answered = 0; } };
  const isEuka = (r) => /\/functions\/v1\/euka/.test(r.url());
  page.on('request', (r) => { if (isEuka(r)) state.total++; });
  const done = (r) => { if (isEuka(r)) state.answered++; };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return state;
}

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const stamp = Date.now();
const ME = { email: `contrast-${stamp}@wurx.test`, password: 'Contrast!2026' };

let pass = 0, fail = 0;
const ok = (l) => { console.log(`  PASS  ${l}`); pass++; };
const bad = (l, d) => { console.error(`  FAIL  ${l}${d ? `\n        ${d}` : ''}`); fail++; };

/* The measurement runs in the page: only there is the cascade resolved. */
const PROBE = () => {
  const lum = (c) => {
    const s = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  /*
   * TWO COLOUR FORMS COME BACK FROM getComputedStyle, AND ONLY ONE WAS READ.
   *
   * Chromium resolves `color-mix()` to `color(srgb 0.78 0.57 0.29 / 0.14)`,
   * not to `rgba()`. This only matched `rgba()`, so every colour-mix
   * background returned null and was treated as ABSENT — the walk carried on
   * past it to whatever was underneath, and the element was measured against
   * the wrong thing entirely.
   *
   * That was survivable while colour-mix was rare. It stopped being survivable
   * on 2026-08-28, when the vendoring pipeline was taught to preserve alpha and
   * several hundred backgrounds became colour-mixes overnight. Their greeting
   * banner is the one that gave it away: a 96% ACCENT card measured as
   * `rgb(16,14,12) on rgb(16,14,12)` — the page colour, twice, because the
   * card itself was invisible to this function.
   *
   * `unparseable` is returned rather than null when a background is plainly
   * there but in a form this cannot read. Skipping it silently is the whole
   * failure; the caller reports it instead.
   */
  const parse = (str) => {
    const v = String(str || '').trim();
    if (!v || v === 'none' || v === 'transparent') return null;

    const rgb = /rgba?\(([^)]+)\)/.exec(v);
    if (rgb) {
      const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    }

    /* color(srgb r g b / a) — components are 0..1, alpha optional. */
    const fn = /color\(\s*srgb\s+([^)]+)\)/.exec(v);
    if (fn) {
      const p = fn[1].split(/[\s/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every((n) => Number.isFinite(n))) {
        return { rgb: p.slice(0, 3).map((n) => n * 255), a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 };
      }
    }

    return { unparseable: v.slice(0, 40) };
  };
  const over = (fg, bg) => fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a));

  /*
   * WHAT IS ACTUALLY PAINTED BEHIND AN ELEMENT.
   *
   * Collect every translucent layer up the tree until an opaque one, then
   * composite from the BOTTOM UP. Doing it top-down, as the first version did,
   * loses the order that alpha depends on and throws besides.
   */
  const behind = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      /*
       * A GRADIENT IS MEASURED AT ITS STOPS, not skipped.
       *
       * `getComputedStyle` gives no single colour for one, and the first
       * version therefore reported every gradient-backed element as
       * "unmeasured" and PASSED. That is how an unreadable hero card shipped:
       * 49 elements on the reporting screen were sitting on a gradient, and the
       * guard counted all 49 as fine. The stops are right there in the computed
       * value, so each one is composited and the WORST is what counts.
       */
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        const stops = cs.backgroundImage.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g);
        if (!stops || !stops.length) return null;         // a url() or similar
        const parsed = stops.map(parse).filter((c) => c && !c.unparseable && c.a > 0);
        if (!parsed.length) return null;
        /* Composite each stop over whatever is behind the gradient itself. */
        let under = [0, 0, 0];
        let p = n.parentElement;
        while (p && p !== document.documentElement) {
          const pc = parse(getComputedStyle(p).backgroundColor);
          if (pc && !pc.unparseable && pc.a >= 0.999) { under = pc.rgb; break; }
          p = p.parentElement;
        }
        return { stops: parsed.map((c) => over(c, under)) };
      }
      const c = parse(cs.backgroundColor);
      if (c && c.unparseable) return { unreadable: c.unparseable };
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
      n = n.parentElement;
    }
    let base = [0, 0, 0];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const out = [];
  const root = document.querySelector('.wurxbase-root');
  if (!root) return out;
  for (const el of root.querySelectorAll('*')) {
    /*
     * A FIELD'S VALUE IS TEXT ON SCREEN AND WAS NOT BEING MEASURED.
     *
     * This walked child TEXT NODES, and an <input> has none — its value is a
     * property, not a child. Every figure in the performance matrix lives in an
     * input: on Penetrex that is roughly nine hundred numbers, coloured green
     * for GMV and red for ad spend, sitting on a banded surface, and not one of
     * them was ever measured. The tab reported "157 text elements, worst 4.9:1"
     * and the 157 were its headings.
     *
     * That is the same shape as every other failure recorded in this file: a
     * guard that passes because its subject is absent. A typed value is the
     * most important text on that screen — it is the money.
     */
    const isField = el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color'].includes(el.type);
    const text = isField
      ? String(el.value || '').trim()
      : [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join(' ')
          .trim();
    if (!text || text.length < 2) continue;
    /*
     * AN EMOJI IS A PICTURE, NOT TEXT.
     *
     * It paints its own colours and ignores `color` entirely, so measuring the
     * contrast between its inherited ink and its background is meaningless —
     * the same mistake as reading `color` on SVG text, which takes `fill`.
     * Their greeting banner is a lone `👋` on a coloured card and reported
     * 1:1 against its own background, on whichever tab happened to be open
     * while the banner was still up. Two symptoms of one bad measurement: a
     * failure that is not real, and a guard that moves between runs.
     *
     * Only when the whole label is pictographic. "⚠️ Budget exceeded" still
     * gets measured, because the words in it are genuinely text.
     */
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    /*
     * SVG TEXT IS PAINTED BY `fill`, NOT `color`.
     *
     * Reading `color` on a <text> gives whatever it inherited and has
     * nothing to do with what is on screen. It reported twelve chart labels
     * as white on white while their `fill` was a perfectly readable muted
     * token: twelve invented failures, on the one screen with real ones.
     */
    const isSvgText = el.ownerSVGElement != null || el.tagName === 'text' || el.tagName === 'tspan';
    const fg = parse(isSvgText ? cs.fill : cs.color);
    if (!fg || fg.unparseable || fg.a < 0.15) continue;
    const bgAny = behind(el);
    if (!bgAny) { out.push({ unmeasured: true, text: text.slice(0, 24) }); continue; }
    /* A background this cannot read is NOT a background it may ignore. Say so
       loudly; an unmeasured thing is not a passing thing. */
    if (bgAny.unreadable) { out.push({ unreadable: bgAny.unreadable, text: text.slice(0, 24) }); continue; }

    /* A gradient gives several grounds; the text has to survive the worst. */
    const grounds = bgAny.stops ? bgAny.stops : [bgAny];
    let ratio = Infinity;
    let bg = grounds[0];
    for (const g of grounds) {
      const f = over(fg, g);
      const L1 = lum(f), L2 = lum(g);
      const r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (r < ratio) { ratio = r; bg = g; }
    }
    ratio = Math.round(ratio * 100) / 100;
    out.push({
      text: text.slice(0, 32),
      ratio,
      onGradient: Boolean(bgAny.stops),
      fg: isSvgText ? cs.fill : cs.color,
      bg: `rgb(${bg.map(Math.round).join(',')})`,
      size: Math.round(parseFloat(cs.fontSize)),
      weight: Number(cs.fontWeight) || 400,
      cls: (el.className || '').toString().split(' ').slice(0, 2).join(' '),
      path: (() => {
        const bits = [];
        let n = el;
        for (let i = 0; i < 3 && n && n !== document.documentElement; i++) {
          const c = (n.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
          bits.unshift(c ? `${n.tagName.toLowerCase()}.${c}` : n.tagName.toLowerCase());
          n = n.parentElement;
        }
        return bits.join(' > ');
      })(),
    });
  }
  return out;
};

let browser;
try {
  const { data, error } = await admin.auth.admin.createUser({
    email: ME.email, password: ME.password, email_confirm: true,
  });
  if (error) throw error;
  ME.id = data.user.id;
  await admin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', ME.id);

  browser = await launchBrowser();

  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript(({ t }) => {
      localStorage.setItem('wurxmediahub-theme', t);
      /* SUPERADMIN, not the 'lead' viewer this used to use. A viewer has no
         tabDiscovery capability, so /admin/collabs/discovery correctly bounces
         them to Brands and the sixth screen was never measured at all. The
         point of this guard is to see every surface, which means signing in as
         the role that can reach every surface. */
      sessionStorage.setItem('ch_user', JSON.stringify({ id: 'asad', username: 'Asad', role: 'superadmin', display: 'Asad' }));
    }, { t: theme });
    const page = await ctx.newPage();
    const eukaInflight = trackEuka(page);

    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', ME.email);
    await page.fill('input[name="password"]', ME.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL((u) => !/\/admin\/login/.test(String(u)), { timeout: 30_000 }).catch(() => {});
    const hello = page.getByRole('button', { name: /let.s go/i });
    if (await hello.first().isVisible().catch(() => false)) await hello.first().click();

    await page.goto(`${BASE}/admin/collabs`, { waitUntil: 'domcontentloaded' });
    eukaInflight.reset();
    await settle(page, eukaInflight);

    console.log(`\n[${theme}]`);
    /*
     * EVERY TAB, AND THE OMISSION HERE IS WHY A BAD RESKIN SHIPPED.
     *
     * The first version checked four of the six and reported "8 checks passed",
     * which read as "the reskin is verified". Reporting and Discovery were
     * never opened, and Reporting was the worst screen in the build: unreadable
     * text on a brown hero and an off-palette blue footer. A guard that covers
     * part of a surface and reports a pass is worse than no guard, because it
     * is believed.
     */
    /*
     * NAVIGATE BY URL, AND PROVE THE SCREEN CHANGED.
     *
     * This used to click a button named after each tab. On 2026-08-28 the six
     * tabs became six routes in our own sidebar and the rail inside the app was
     * removed, so `if (await b.count())` found nothing, skipped silently, and
     * this guard measured the SAME screen six times while printing six passes.
     * It went from "11 of 12" to "12 of 12" on a change that touched no colour.
     *
     * That is the third time a check here has passed by not looking. So the
     * fingerprint below is not defensive tidiness: two tabs in a row that
     * render an identical set of labels is now a FAILURE, because the only
     * innocent explanation is that navigation stopped working.
     */
    let lastPrint = null;
    for (const [tab, slug] of [
      ['Brands', 'brands'],
      ['Creators', 'creators'],
      ['Performance', 'performance'],
      ['Reporting', 'reporting'],
      ['Leaderboard', 'leaderboard'],
      ['Discovery', 'discovery'],
    ]) {
      await page.goto(`${BASE}/admin/collabs/${slug}`, { waitUntil: 'domcontentloaded' });
      eukaInflight.reset();
      const settledAt = await settle(page, eukaInflight);

      if (!page.url().includes(`/admin/collabs/${slug}`)) {
        bad(`${tab}: asked for /admin/collabs/${slug} and landed on ${page.url()}`);
        continue;
      }

      const floor = FLOOR[slug] ?? 60;
      if (settledAt < floor) {
        bad(
          `${tab}: only ${settledAt} elements rendered, expected at least ${floor} — this tab is UNMEASURED, not passing`,
          'a half-drawn screen has few labels and all of them read fine'
        );
        continue;
      }

      const all = await page.evaluate(PROBE);
      const unmeasured = all.filter((r) => r.unmeasured).length;
      /* A colour form this cannot parse is a HOLE in the measurement, not a
         pass. It fails the tab, because the alternative is the thing that has
         gone wrong here three times: reporting green over a surface nobody
         looked at. */
      const unreadable = all.filter((r) => r.unreadable);
      if (unreadable.length) {
        const forms = [...new Set(unreadable.map((r) => r.unreadable))].slice(0, 3);
        bad(`${tab}: ${unreadable.length} element(s) sit on a colour this guard cannot parse`,
            `${forms.join(' | ')}
        Teach parse() that form rather than letting it pass unmeasured.`);
        lastPrint = null;
        continue;
      }
      const results = all.filter((r) => !r.unmeasured && !r.unreadable);
      if (results.length === 0) { bad(`${tab}: nothing measurable rendered, so this check is vacuous`); continue; }

      /* What this screen actually says, cheaply. Identical to the previous tab
         means the route did not take us anywhere. */
      const print = `${results.length}|${results.slice(0, 12).map((r) => r.text).join('~')}`;
      if (print === lastPrint) {
        bad(`${tab}: rendered exactly what the previous tab did — navigation is not working, so this check would be measuring the same screen twice`);
        lastPrint = print;
        continue;
      }
      lastPrint = print;


      const failures = results.filter((r) => r.ratio < floorFor(r));

      if (failures.length === 0) {
        ok(
          `${tab}: ${results.length} text elements, worst ${Math.min(...results.map((r) => r.ratio))}:1` +
            `${unmeasured ? `, ${unmeasured} on gradients not measurable` : ''}`
        );
      } else {
        /* Group, so one bad token does not print two hundred times. */
        const byPair = new Map();
        for (const f of failures) {
          const k = `${f.fg} on ${f.bg}`;
          const e = byPair.get(k) ?? { n: 0, ratio: f.ratio, need: floorFor(f), size: f.size, sample: f.text, cls: f.cls, path: f.path };
          e.n++;
          byPair.set(k, e);
        }
        bad(
          `${tab}: ${failures.length} of ${results.length} text elements below the AA floor for their size`,
          [...byPair]
            .sort((a, b) => b[1].n - a[1].n)
            .slice(0, 6)
            .map(([k, v]) => `${String(v.n).padStart(4)}x  ${v.ratio}:1 (needs ${v.need}, ${v.size}px)  ${k}\n              "${v.sample}"  at  ${v.path}`)
            .join('\n        ')
        );
      }
    }

    /*
     * THE SEVENTH SCREEN, AND THE ONE THIS GUARD HAS NEVER SEEN.
     *
     * `/admin/collabs/performance` is a list of brand cards. The actual
     * performance sheet — a hundred creators by ten months of GMV and ad spend,
     * the densest surface in the product and the only one that is almost
     * entirely numbers — is a click further in, and this loop never clicked.
     * It measured 157 headings and reported the tab green while every figure on
     * it went unlooked at.
     *
     * It has to be a click rather than a URL: the drilldown is component state,
     * not a route.
     */
    {
      const tab = 'Performance sheet';
      await page.goto(`${BASE}/admin/collabs/performance`, { waitUntil: 'domcontentloaded' });
      eukaInflight.reset();
      await settle(page, eukaInflight);
      await page.locator('.pc-ava').first().click({ timeout: 20_000 }).catch(() => {});
      const opened = await page.waitForSelector('.pc-mx-row', { timeout: 45_000 }).catch(() => null);
      /* The mouse sits where it clicked, which is over a row, and a hovered row
         is painted differently. Move it off before measuring anything. */
      await page.mouse.move(4, 4);
      await settle(page, eukaInflight);

      if (!opened) {
        bad(`${tab}: no brand drilldown opened, so the sheet is UNMEASURED`);
      } else {
        const all = await page.evaluate(PROBE);
        const unreadable = all.filter((r) => r.unreadable);
        const results = all.filter((r) => !r.unmeasured && !r.unreadable);
        /* Penetrex alone puts about 1,700 measurable figures and labels on
           screen. Anything under a thousand means the sheet did not fill in and
           this check would be reading an empty grid. */
        if (unreadable.length) {
          bad(`${tab}: ${unreadable.length} element(s) sit on a colour this guard cannot parse`,
              [...new Set(unreadable.map((r) => r.unreadable))].slice(0, 3).join(' | '));
        } else if (results.length < 1000) {
          bad(`${tab}: only ${results.length} elements measured, expected 1000+ — the sheet is empty or still loading, not passing`);
        } else {
          const failures = results.filter((r) => r.ratio < floorFor(r));
          const figures = results.filter((r) => /^[\d,.]+$/.test(r.text)).length;
          if (!figures) {
            bad(`${tab}: not one bare number was measured, so the figures — the whole point of this screen — went unchecked`);
          } else if (failures.length === 0) {
            ok(`${tab}: ${results.length} text elements including ${figures} figures, worst ${Math.min(...results.map((r) => r.ratio))}:1`);
          } else {
            const byPair = new Map();
            for (const f of failures) {
              const k = `${f.fg} on ${f.bg}`;
              const e = byPair.get(k) ?? { n: 0, ratio: f.ratio, need: floorFor(f), size: f.size, sample: f.text, path: f.path };
              e.n++;
              byPair.set(k, e);
            }
            bad(
              `${tab}: ${failures.length} of ${results.length} below the AA floor for their size`,
              [...byPair].sort((a, b) => b[1].n - a[1].n).slice(0, 6)
                .map(([k, v]) => `${String(v.n).padStart(4)}x  ${v.ratio}:1 (needs ${v.need}, ${v.size}px)  ${k}\n              "${v.sample}"  at  ${v.path}`)
                .join('\n        ')
            );
          }
        }
      }
    }

    await ctx.close();
  }
} finally {
  if (browser) await browser.close();
  if (ME.id) await admin.auth.admin.deleteUser(ME.id);
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed. Text is disappearing into its background.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. Every label is readable on what is actually behind it.\n`);
