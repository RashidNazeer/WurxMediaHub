#!/usr/bin/env node
/**
 * THE BLUR BUDGET. `docs/GLASS_PLAN.md` §4.3, listed in §7.
 *
 * WHY A BUDGET EXISTS AT ALL. Blur is the most expensive thing a browser
 * composites, and this product's creators are mostly on phones. §1.3 puts it
 * bluntly: `browser.mjs` launches Chromium with `--disable-gpu`, so every
 * browser suite in this repo is software-rendered and *structurally incapable*
 * of judging blur cost. Nothing here measures frames, and nothing here can.
 *
 * SO THIS GUARD COUNTS AND READS INSTEAD OF MEASURING. Layer count, nesting and
 * the animated property list are all facts about the DOM and the cascade, and
 * those are true whether or not there is a GPU in the machine. That makes them
 * exactly the parts of the budget a headless suite CAN hold. The frame cost
 * itself is Phase 7 on a real mid-range Android (§10 item C), and this script
 * is not a substitute for it.
 *
 * THE FOUR ASSERTIONS
 *
 *   1. NO NESTED `backdrop-filter`. A blurred element inside another blurred
 *      element pays twice and looks the same, because the inner one is sampling
 *      a backdrop that has already been blurred. §4.3: "A glass card inside a
 *      glass panel is one of them, not two."
 *   2. AT MOST 3 BLURRED LAYERS PAINTING AT ONCE AT 375px. The budget's own
 *      allowance: chrome, one surface, one overlay. Counted on what is actually
 *      on screen and actually visible, because an element parked off-screen or
 *      behind `visibility: hidden` costs nothing to composite.
 *   3. NOTHING ANIMATES A FILTER, A SHADOW OR A SIZE. §4.3: "Never animate
 *      blur. Animate `transform` and `opacity` only." `filter`,
 *      `backdrop-filter`, `box-shadow`, `width` and `height` are all banned in
 *      transitions and in keyframes: the first two re-run the blur every frame,
 *      `box-shadow` repaints a large soft area, and `width`/`height` relayout.
 *      `transition-property: all` is a violation on its own, because "all"
 *      includes every one of them.
 *   4. THE GUARD CAN SEE GLASS AT ALL. A negative control, so a clean run means
 *      "nothing over budget" and not "the stylesheet never loaded".
 *
 * WHERE IT RUNS. The public pages — `/`, `/apply`, `/login` — need no login, so
 * this one really does run today end to end, unlike the fence guard's live
 * mode. Pass a base URL and any paths to point it somewhere else; signed-in
 * paths need ADMIN_EMAIL and ADMIN_PASSWORD in the environment.
 *
 * Usage:
 *   node scripts/verify/design/check-blur-budget.mjs
 *   node scripts/verify/design/check-blur-budget.mjs http://localhost:5173
 *   node scripts/verify/design/check-blur-budget.mjs http://localhost:5173 / /apply /login
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/verify/design/check-blur-budget.mjs \
 *       http://localhost:5173 /admin /admin/collabs/brands
 */

import { launchBrowser } from '../../lib/browser.mjs';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:4173';

/*
 * THE DEFAULT IS THE THREE PAGES THAT NEED NO LOGIN, and that is deliberate.
 * `GLASS_PLAN.md` §10: phases 1, 1b, 2 and 4 — the token layer, the type, every
 * glass primitive and the whole public site — need no login at all, and that is
 * roughly half the visible surface. A guard that cannot run until somebody
 * finds a password is a guard that does not run.
 */
const PATHS = process.argv.slice(3).length ? process.argv.slice(3) : ['/', '/apply', '/login'];

// 375px is the budget's own width: §4.3 is written about phones, and below `md`
// chrome keeps its blur while page cards fall back to the opaque tint. The
// whole point of the layer cap is what happens at this width.
const VIEWPORT = { width: 375, height: 780 };
const LAYER_CAP = 3;

// The properties that may not appear in any transition or keyframe list, each
// with the reason, so a failure explains itself rather than citing a rule.
const BANNED_ANIMATED = {
  filter: 're-runs the whole filter chain every frame',
  'backdrop-filter': 're-samples and re-blurs the backdrop every frame',
  '-webkit-backdrop-filter': 're-samples and re-blurs the backdrop every frame',
  'box-shadow': 'repaints a large soft area every frame',
  width: 'relayouts every frame',
  height: 'relayouts every frame',
};

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));
const note = (m) => console.log(`        ${m}`);
// Evidence on stderr, beside the FAIL it belongs to, so the two streams do not
// reorder in a pipeline and leave the offender printed under the wrong line.
const detail = (m) => console.error(`        ${m}`);

/* ===================================================================== *
 * READ EVERYTHING ABOUT ONE PAGE IN ONE PASS
 * ===================================================================== */

/*
 * One `evaluate`, deliberately. Walking the DOM three times means three
 * different moments, and on a page with a scroll-driven aurora the third walk
 * can disagree with the first about what is on screen. One pass over
 * `document.querySelectorAll('*')` gives three answers about the same frame.
 */
const SURVEY = ({ cap }) => {
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    return (
      `<${el.tagName.toLowerCase()}` +
      (el.id ? `#${el.id}` : '') +
      (cls ? ` class="${cls.slice(0, 90)}"` : '') +
      '>'
    );
  };

  const isNone = (v) => !v || v === 'none';
  const all = [...document.querySelectorAll('*')];

  /* ---------------------------------------------- blurred elements ---- */
  const blurred = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter;
    const wbf = cs.getPropertyValue('-webkit-backdrop-filter');
    if (isNone(bf) && isNone(wbf)) continue;

    const r = el.getBoundingClientRect();
    /*
     * "PAINTING AT ONCE" IS NOT "PRESENT IN THE DOCUMENT". A blurred panel
     * scrolled two screens down, or a closed drawer sitting at
     * `visibility: hidden`, costs the compositor nothing. Counting it would
     * fail a page that is perfectly within budget, and the register in
     * CLAUDE.md is clear that a guard which reports everything failing gets
     * switched off rather than fixed.
     */
    const onScreen =
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.top < window.innerHeight &&
      r.right > 0 &&
      r.left < window.innerWidth;
    const visible =
      cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;

    blurred.push({
      label: label(el),
      value: isNone(bf) ? wbf : bf,
      webkitOnly: isNone(bf) && !isNone(wbf),
      painting: onScreen && visible,
      area: Math.round(r.width) * Math.round(r.height),
      rect: `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`,
      el,
    });
  }

  /* ----------------------------------------------------- 1 · nesting -- */
  const blurredSet = new Map(blurred.map((b) => [b.el, b]));
  const nested = [];
  for (const b of blurred) {
    for (let p = b.el.parentElement; p; p = p.parentElement) {
      const outer = blurredSet.get(p);
      if (outer) {
        nested.push({
          inner: b.label,
          innerValue: b.value,
          outer: outer.label,
          outerValue: outer.value,
        });
        break; // The nearest blurred ancestor is the one to fix. Naming all of
        // them would turn one mistake into a wall of text.
      }
    }
  }

  /* ------------------------------------------------- 2 · layer count -- */
  const painting = blurred
    .filter((b) => b.painting)
    .sort((a, b) => b.area - a.area)
    // The element reference is dropped here: it cannot cross back out of
    // `evaluate`, and anything that cannot be serialised fails the whole call.
    .map(({ el: _el, ...rest }) => rest);

  /* --------------------------------------------- 3 · animated props -- */
  /*
   * Keyframes are read out of the stylesheets rather than guessed at from the
   * animation name, because the name says nothing about what it animates.
   * A cross-origin sheet throws on `.cssRules`; those are not ours, and the
   * one thing worse than missing them is this guard dying on a Google Fonts
   * stylesheet.
   */
  const keyframeProps = new Map();
  const readRules = (rules) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.KEYFRAMES_RULE || rule.cssText?.startsWith('@keyframes')) {
        const props = new Set();
        for (const frame of rule.cssRules ?? []) {
          // Index-based rather than `for…of`: a CSSStyleDeclaration exposes an
          // indexed getter and a length, and relying on it being iterable is
          // the kind of thing that works until it does not.
          const style = frame.style;
          for (let i = 0; style && i < style.length; i += 1) props.add(style.item(i));
        }
        keyframeProps.set(rule.name, [...props]);
      } else if (rule.cssRules) {
        readRules(rule.cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      readRules(sheet.cssRules);
    } catch {
      /* cross-origin, not ours */
    }
  }

  const animated = [];
  for (const el of all) {
    const cs = getComputedStyle(el);

    // A transition with no duration is not a transition. Tailwind's
    // `transition-*` utilities set a property list and a duration separately,
    // and a list with `duration-0` next to it animates nothing.
    const durations = cs.transitionDuration.split(',').map((d) => parseFloat(d) || 0);
    const props = cs.transitionProperty.split(',').map((p) => p.trim());
    props.forEach((p, i) => {
      const dur = durations[i % durations.length] ?? 0;
      if (dur <= 0 || !p || p === 'none') return;
      animated.push({
        kind: 'transition',
        label: label(el),
        prop: p,
        how: `${cs.transitionDuration.trim()}`,
      });
    });

    if (cs.animationName && cs.animationName !== 'none') {
      for (const name of cs.animationName.split(',').map((n) => n.trim())) {
        for (const p of keyframeProps.get(name) ?? []) {
          animated.push({
            kind: 'animation',
            label: label(el),
            prop: p,
            how: `@keyframes ${name}`,
          });
        }
      }
    }
  }

  /* ------------------------------------------- 4 · negative control -- */
  // Build one element that definitely should be glass and ask whether the
  // browser agrees. If it does not, the stylesheet never arrived and every
  // count above is a count of zero for the wrong reason.
  const control = document.createElement('div');
  control.className = 'wx-glass';
  control.setAttribute('style', 'position:absolute;left:-10000px;top:0;width:40px;height:40px');
  document.body.appendChild(control);
  const controlValue = getComputedStyle(control).backdropFilter;
  control.remove();

  return {
    total: blurred.length,
    painting,
    offScreen: blurred.length - painting.length,
    nested,
    animated,
    controlValue,
    cap,
  };
};

/* ===================================================================== *
 * RUN
 * ===================================================================== */

console.log(`\nThe blur budget against ${BASE}  (GLASS_PLAN.md §4.3)`);
console.log('='.repeat(72));

const browser = await launchBrowser();

try {
  let session = null;
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', process.env.ADMIN_EMAIL).catch(() => {});
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD).catch(() => {});
    await page
      .getByRole('button', { name: /^sign in$/i })
      .click()
      .catch(() => {});
    await page.waitForURL('**/admin**', { timeout: 25000 }).catch(() => {});
    session = await ctx.storageState();
    await ctx.close();
  }

  for (const path of PATHS) {
    console.log(`\n[${path}] at ${VIEWPORT.width}px`);
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      ...(session ? { storageState: session } : {}),
    });
    const page = await ctx.newPage();
    /*
     * `domcontentloaded` and then a wait, the same choice check-responsive.mjs
     * made and for the same reason: several screens hold an open realtime
     * websocket, so the network is never idle and `networkidle` can only time
     * out. The wait is for the glass to actually be on screen — a card that
     * fades in is over budget just the same.
     */
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);

    /*
     * THE SELF-TEST, AND WHY IT IS WORTH A FLAG.
     *
     * The public pages carry no glass yet — that is Phase 4 — so a clean run
     * here exercises the nesting walk and the layer count against zero
     * elements and proves nothing about either. `BLUR_BUDGET_SELFTEST=1` plants
     * four glass layers with one nested inside another and the guard must then
     * report exactly that: one nested pair and four layers against a budget of
     * three. If it passes under this flag, it is broken.
     *
     * It is a flag rather than a test file because the thing being tested is
     * this script's own reading of computed styles in a real browser, which
     * only exists while a page is open.
     */
    if (process.env.BLUR_BUDGET_SELFTEST === '1') {
      note('SELF-TEST: planting 4 glass layers, one of them nested. Both checks must FAIL.');
      await page.evaluate(() => {
        const mk = (left) => {
          const el = document.createElement('div');
          el.className = 'wx-glass';
          el.setAttribute(
            'style',
            `position:fixed;top:0;left:${left}px;width:80px;height:80px;z-index:9999`
          );
          document.body.appendChild(el);
          return el;
        };
        const panel = mk(0);
        const inner = document.createElement('div');
        inner.className = 'wx-glass';
        inner.setAttribute('style', 'width:40px;height:40px');
        panel.appendChild(inner);
        mk(100);
        mk(200);
      });
    }

    const r = await page.evaluate(SURVEY, { cap: LAYER_CAP });

    /* ------------------------------------------------- 1 · nesting --- */
    check(
      r.nested.length === 0,
      `${path}: no backdrop-filter is nested inside another (${r.total} blurred element(s) in the document)`
    );
    for (const n of r.nested) {
      detail(
        `NESTED BLUR` +
          `\n          inner element    ${n.inner}` +
          `\n          its blur         backdrop-filter: ${n.innerValue}` +
          `\n          blurred ancestor ${n.outer}` +
          `\n          its blur         backdrop-filter: ${n.outerValue}` +
          `\n          why it is waste  the inner element samples a backdrop that is already` +
          `\n                           blurred, so it pays twice and looks the same. §4.3:` +
          `\n                           "a glass card inside a glass panel is one of them, not two"`
      );
    }

    /* --------------------------------------------- 2 · layer count --- */
    check(
      r.painting.length <= LAYER_CAP,
      `${path}: ${r.painting.length} blurred layer(s) painting at once, budget is ${LAYER_CAP}` +
        (r.offScreen ? ` (${r.offScreen} more off screen or hidden, not counted)` : '')
    );
    // Printed whether it passes or fails: the whole budget is three, so knowing
    // which three are spent is the useful part of a pass as well.
    for (const b of r.painting) {
      const line = `        layer  ${b.label}  ${b.value}  ${b.rect}`;
      if (r.painting.length > LAYER_CAP) console.error(line);
      else console.log(line);
    }

    /* ----------------------------------------- 3 · animated props --- */
    /*
     * Grouped by property and by element signature before printing. Tailwind's
     * bare `transition` utility includes `box-shadow`, `filter` and
     * `backdrop-filter` in its own property list, so one careless utility on a
     * repeated row can produce dozens of identical hits. Dozens of identical
     * lines is one mistake printed dozens of times, and it reads as a broken
     * guard rather than as one thing to fix.
     */
    const offenders = new Map();
    for (const a of r.animated) {
      const banned = BANNED_ANIMATED[a.prop];
      const isAll = a.kind === 'transition' && a.prop === 'all';
      if (!banned && !isAll) continue;
      const key = `${a.kind}|${a.prop}|${a.label}`;
      const row = offenders.get(key) ?? {
        ...a,
        count: 0,
        reason: isAll
          ? 'the keyword "all" includes filter, backdrop-filter, box-shadow, width and height'
          : banned,
      };
      row.count += 1;
      offenders.set(key, row);
    }
    const byProperty = [...new Set([...offenders.values()].map((o) => o.prop))];
    check(
      offenders.size === 0,
      `${path}: only transform and opacity animate ` +
        `(${r.animated.length} animated propert${r.animated.length === 1 ? 'y' : 'ies'} read` +
        (byProperty.length ? `, banned: ${byProperty.join(', ')}` : '') +
        ')'
    );
    // Capped at ten distinct offenders. Beyond that the list stops being a
    // list of things to fix and the count is the more useful number.
    const list = [...offenders.values()].sort((a, b) => b.count - a.count);
    for (const o of list.slice(0, 10)) {
      detail(
        `ANIMATED ${o.prop.toUpperCase()}` +
          `\n          element          ${o.label}${o.count > 1 ? `  (and ${o.count - 1} more like it)` : ''}` +
          `\n          ${o.kind === 'transition' ? 'transition' : 'animation'}       ${o.how}` +
          `\n          why it is banned ${o.reason}` +
          `\n          allowed instead  transform and opacity only (§4.3)`
      );
    }
    if (list.length > 10) detail(`and ${list.length - 10} further distinct offender(s)`);

    /* ------------------------------------------ 4 · the guard works -- */
    check(
      r.controlValue && r.controlValue !== 'none',
      `${path}: this guard can see glass — a .wx-glass control computed to ` +
        `backdrop-filter: ${r.controlValue || 'nothing at all'}`
    );
    if (!r.controlValue || r.controlValue === 'none') {
      detail(
        `THE CONTROL FAILED, SO EVERY COUNT ABOVE IS MEANINGLESS. Chromium does not` +
          `\n          think .wx-glass applies a backdrop-filter, which means the app's` +
          `\n          stylesheet did not load at ${BASE}${path}. Check the URL and the server` +
          `\n          before believing a zero.`
      );
    }

    await ctx.close();
  }
} catch (e) {
  fail(`unexpected error: ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n${'='.repeat(72)}`);
/*
 * WHAT A PASS DOES NOT MEAN, and it is worth the three lines. Every browser in
 * this repo runs with `--disable-gpu` (`browser.mjs`), so nothing above has any
 * opinion about frame rate. This is the countable half of §4.3 only.
 */
console.log('Counted, not measured: --disable-gpu means no frame cost is judged here.');
console.log('The frame cost itself is Phase 7, on a real mid-range Android.');
if (failures > 0) {
  console.error(`\n${failures} blur budget check(s) FAILED — see docs/GLASS_PLAN.md §4.3.\n`);
  process.exit(1);
}
console.log('\nEvery page is inside the blur budget.\n');
