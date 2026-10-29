#!/usr/bin/env node
/**
 * THE FENCE GUARD. `docs/guides/GLASS_PLAN.md` §1.2 and §7 call this the single most
 * important new guard in the glass redesign, and this is why.
 *
 * THE LAW
 *
 *   No element on the ancestor chain from `<html>` down to `.wurxbase-root`
 *   may have a computed `backdrop-filter` OR `filter` other than `none`.
 *
 * WHY IT IS A LAW AND NOT A PREFERENCE. A non-`none` `filter` or
 * `backdrop-filter` makes that element the containing block for every
 * `position: fixed` descendant. The vendored Paid Collabs app is full of
 * `inset: 0` centred modal overlays, so the moment something above the fence
 * takes a filter, "fixed" stops meaning the screen and starts meaning that box.
 * It has happened three times — `docs/guides/NEW_MACHINE.md`, `docs/archive/PRISM_PROGRESS.md` and
 * the comment block on `wurxbase-fence` in `global.css` all record it — and the
 * symptom is always the same: the screen dims and the dialog is 3,413px down
 * the page, where nobody looks. The current top bar is opaque *specifically* to
 * avoid this and says so in a comment. Choosing glass A–Z retires that
 * workaround, so the rule has to be checked instead of avoided.
 *
 * `filter` is in the law for the same reason `backdrop-filter` is, and it is the
 * easier one to add by accident: the liquid-glass button recipe in §4.4 ships
 * with `filter: contrast(3)` on a *wrapper*. Drop that wrapper anywhere above
 * the fence and the bug returns wearing different clothes.
 *
 * `filter: grayscale(0)` AND `saturate(100%)` ARE VIOLATIONS TOO. A filter
 * function list that happens to be visually inert still computes to something
 * other than `none`, and the containing block is created on the computed value,
 * not on whether the pixels changed. Only the literal keyword `none` is safe.
 * This is the trap in `filter-none` vs `grayscale-0`.
 *
 * WHAT IS LEGAL, AND THIS GUARD MUST NOT FLAG IT. Siblings and leaves are free.
 * The rail `<aside>`, the `<header>` top bar, modal scrims and every card
 * *inside* an ordinary page may be as glassy as they like — they are not on the
 * chain. Only the chain is illegal. Probe mode below mounts a glass sibling on
 * purpose as a negative control, so a pass means "the walk saw real glass and
 * correctly did not count it" rather than "the walk saw nothing".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THREE MODES, BECAUSE THERE IS NO STAFF LOGIN ON THIS MACHINE
 *
 * `.wurxbase-root` only exists on `/admin/collabs/*`, which is behind a staff
 * login this session does not have (`docs/guides/GLASS_PLAN.md` §10 item B — the password
 * was never stored). So the script does what it can prove today and says
 * loudly what it cannot:
 *
 *   1. STATIC   always runs, needs no browser and no login. Reads the real
 *               class lists off the real ancestor elements in AppShell.tsx and
 *               PaidCollabs.tsx and checks them against every class and project
 *               utility that produces a filter. Also scans our stylesheets for
 *               any rule that would land a filter on an element the chain
 *               contains.
 *   2. PROBE    needs a browser and any URL that loads the app's CSS — the
 *               public landing page is enough. It rebuilds the documented chain
 *               *in a real browser* out of the class strings static mode just
 *               read from source, then asks Chromium for the computed
 *               `backdrop-filter` and `filter` of each. This is a real
 *               computed-style test of the real CSS, in both themes.
 *   3. LIVE     needs a URL where `.wurxbase-root` is actually mounted, which
 *               needs the staff login. Walks the real DOM. This is the only
 *               mode that can see a filter arriving from a route, a portal, a
 *               third-party widget or a runtime style attribute.
 *
 * Usage:
 *   node scripts/verify/design/check-backdrop-ancestry.mjs                   static only
 *   node scripts/verify/design/check-backdrop-ancestry.mjs http://localhost:5173
 *                                                              static + probe,
 *                                                              + live if the
 *                                                              fence is there
 *   node scripts/verify/design/check-backdrop-ancestry.mjs http://localhost:5173 /admin/collabs/brands
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/verify/design/check-backdrop-ancestry.mjs \
 *       http://localhost:5173 /admin/collabs/brands            full live mode
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BASE = process.argv[2] ?? process.env.BASE_URL ?? null;
const PATHS = process.argv.slice(3);
const LIVE_PATHS = PATHS.length ? PATHS : ['/admin/collabs/brands'];
const PROBE_PATH = PATHS[0] && !PATHS[0].startsWith('/admin/collabs') ? PATHS[0] : '/';

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (c, m) => (c ? pass(m) : fail(m));
const note = (m) => console.log(`        ${m}`);
// Offender detail goes to stderr, beside the FAIL line it belongs to. Mixing
// the two streams reorders them in a PowerShell pipeline and the evidence ends
// up above a different assertion, which is how a clear failure becomes a
// confusing one. Same reason check-responsive.mjs prints its culprits this way.
const detail = (m) => console.error(`        ${m}`);

/* ===================================================================== *
 * WHAT COUNTS AS A FILTER
 * ===================================================================== */

/*
 * Tailwind families that compile to `filter` or `backdrop-filter`. Matched on
 * the utility stem after variants are stripped, so `md:dark:backdrop-blur-xl`
 * is caught as `backdrop-blur-xl`.
 *
 * Every family is listed with the CSS it produces, because the next person to
 * read this needs to be able to check the list rather than trust it.
 */
const FILTER_FAMILIES = [
  { re: /^backdrop-blur(-|$)/, css: 'backdrop-filter: blur(…)' },
  { re: /^backdrop-brightness-/, css: 'backdrop-filter: brightness(…)' },
  { re: /^backdrop-contrast-/, css: 'backdrop-filter: contrast(…)' },
  { re: /^backdrop-grayscale(-|$)/, css: 'backdrop-filter: grayscale(…)' },
  { re: /^backdrop-hue-rotate-/, css: 'backdrop-filter: hue-rotate(…)' },
  { re: /^backdrop-invert(-|$)/, css: 'backdrop-filter: invert(…)' },
  { re: /^backdrop-opacity-/, css: 'backdrop-filter: opacity(…)' },
  { re: /^backdrop-saturate-/, css: 'backdrop-filter: saturate(…)' },
  { re: /^backdrop-sepia(-|$)/, css: 'backdrop-filter: sepia(…)' },
  { re: /^backdrop-filter(-|$)/, css: 'backdrop-filter' },
  { re: /^blur(-|$)/, css: 'filter: blur(…)' },
  { re: /^brightness-/, css: 'filter: brightness(…)' },
  { re: /^contrast-/, css: 'filter: contrast(…)' },
  { re: /^grayscale(-|$)/, css: 'filter: grayscale(…)' },
  { re: /^hue-rotate-/, css: 'filter: hue-rotate(…)' },
  { re: /^-hue-rotate-/, css: 'filter: hue-rotate(-…)' },
  { re: /^invert(-|$)/, css: 'filter: invert(…)' },
  { re: /^saturate-/, css: 'filter: saturate(…)' },
  { re: /^sepia(-|$)/, css: 'filter: sepia(…)' },
  { re: /^drop-shadow-/, css: 'filter: drop-shadow(…)' },
  { re: /^filter(-|$)/, css: 'filter' },
];

// The ONLY safe forms, because they are the only ones whose computed value is
// the keyword `none`. `grayscale-0` is not here on purpose: see the header.
const SAFE_UTILITIES = new Set([
  'filter-none',
  'blur-none',
  'backdrop-filter-none',
  'backdrop-blur-none',
  'drop-shadow-none',
]);

const stripVariants = (token) => {
  // `md:dark:hover:backdrop-blur-xl` → `backdrop-blur-xl`. Arbitrary values
  // (`backdrop-blur-[12px]`) carry no colon, so this is safe for them.
  const parts = token.split(':');
  return parts[parts.length - 1];
};

/** Why this single class token is illegal on the chain, or null if it is fine. */
function utilityVerdict(raw) {
  const token = stripVariants(raw).replace(/^!/, '');
  if (!token || SAFE_UTILITIES.has(token)) return null;
  for (const f of FILTER_FAMILIES) {
    if (f.re.test(token)) return f.css;
  }
  return null;
}

/* ===================================================================== *
 * READING CSS
 * ===================================================================== */

function collectCss(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectCss(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

const CSS_FILES = collectCss(join(ROOT, 'src'));
const CSS = CSS_FILES.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));

// Strip comments before pattern matching. Several of these sheets explain the
// 3,413px bug in prose and name `backdrop-filter` while doing it; a guard that
// fails on its own documentation is the "everything is failing" guard CLAUDE.md
// warns about.
//
// Comments are blanked CHARACTER FOR CHARACTER rather than collapsed, so every
// offset and every line number in the stripped copy still matches the file on
// disk. The first version collapsed each comment to one space and reported a
// real violation in wurxbase-chrome.css at line 1 instead of line 41 — these
// sheets are mostly prose, so the drift was about forty lines in the first
// rule and grew from there. A guard that names the wrong line sends the reader
// looking for a bug that is not where it says it is.
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/*
 * Custom-property values, so `filter: var(--wx-logo-filter)` can be judged
 * rather than guessed at. If every definition of the variable in the project is
 * `none`, the declaration is inert and must not be reported.
 */
const VAR_VALUES = new Map();
for (const { text } of CSS) {
  const re = /(--[\w-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(decomment(text)))) {
    const list = VAR_VALUES.get(m[1]) ?? [];
    list.push(m[2].trim());
    VAR_VALUES.set(m[1], list);
  }
}

/** Could this `filter`/`backdrop-filter` value ever be anything but `none`? */
function valueCanFilter(value, depth = 0) {
  const v = value.trim();
  if (!v || v === 'none' || v === 'initial' || v === 'unset') return false;
  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(v);
  if (varMatch && depth < 4) {
    const defs = VAR_VALUES.get(varMatch[1]) ?? [];
    const fallback = varMatch[2] ? [varMatch[2]] : [];
    const all = [...defs, ...fallback];
    // An undefined variable with no fallback resolves to nothing, which is not
    // a filter. An undefined variable is a different bug, not this one.
    if (all.length === 0) return false;
    return all.some((d) => valueCanFilter(d, depth + 1));
  }
  return true;
}

/*
 * Innermost rule blocks, with their selector prelude. Deliberately simple: the
 * innermost `{ … }` of a `@media`-wrapped rule still has no nested braces, so
 * one regex reaches every declaration block in these sheets without pulling in
 * a CSS parser.
 */
function* ruleBlocks(text) {
  const src = decomment(text);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const prelude = m[1].trim().split('\n').pop().trim();
    /*
     * The reported index is the `{`, NOT `m.index`. The prelude group is
     * greedy over everything since the last brace, so on the first rule of a
     * file it starts at character zero and every such failure claimed line 1.
     * The brace sits on the selector's own line in all of these sheets.
     */
    yield { prelude, body: m[2], index: m.index + m[1].length };
  }
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* ===================================================================== *
 * READING THE CHAIN OUT OF THE SOURCE
 * ===================================================================== */

/*
 * Find the opening tag that contains `anchor`, and hand back both the raw text
 * and a comment-stripped copy.
 *
 * It is a scanner rather than a regex because these two files are the most
 * heavily commented in the project and JSX comments live inside braces: a naive
 * search for the next `>` stops inside a comment, and a naive quote tracker
 * trips over the apostrophe in "Rashid's". So: brace depth, with strings and
 * both comment forms understood.
 */
function openingTagAround(src, anchorIndex) {
  let start = anchorIndex;
  while (start >= 0 && src[start] !== '<') start -= 1;
  if (start < 0) return null;

  let depth = 0;
  let quote = null;
  let block = false;
  let line = false;
  let stripped = '';
  let j = start;

  for (; j < src.length; j += 1) {
    const c = src[j];
    const c2 = src[j + 1];
    if (block) {
      if (c === '*' && c2 === '/') {
        block = false;
        j += 1;
      }
      continue;
    }
    if (line) {
      if (c === '\n') line = false;
      continue;
    }
    if (quote) {
      stripped += c;
      if (c === '\\') {
        stripped += c2 ?? '';
        j += 1;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && c2 === '*') {
      block = true;
      j += 1;
      continue;
    }
    if (c === '/' && c2 === '/') {
      line = true;
      j += 1;
      continue;
    }
    stripped += c;
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) break;
  }

  return { raw: src.slice(start, j + 1), stripped, line: lineOf(src, start) };
}

/*
 * THE CHAIN, AS `docs/guides/GLASS_PLAN.md` §1.2 DRAWS IT.
 *
 *   <div class="wx-app …">                ← ancestor · MUST stay plain
 *     <aside> rail card </aside>          ← sibling  · MAY be glass
 *     <div class="flex min-w-0 flex-col"> ← ancestor · MUST stay plain
 *       <header> top bar </header>        ← sibling  · MAY be glass
 *       <main class="min-w-0 flex-1">     ← ancestor · MUST stay plain
 *         <div class="w-full px-3 …">     ← ancestor · MUST stay plain
 *           <Outlet/> → PaidCollabs → .wurxbase-root
 *
 * `.wurxbase-root` ITSELF IS ON THE LIST, not just everything above it. A
 * filter there would trap `#wurxbase-portal-host`, which is a child of the root
 * and deliberately outside the fence precisely so its fixed overlays measure
 * against the viewport. Trapping them is the same bug.
 *
 * Each site is found by an anchor string rather than by a line number, so the
 * guard survives the files being edited and fails loudly if the shell is
 * genuinely restructured.
 *
 * EVERY ANCHOR IS A PREFIX WITH NO CLOSING QUOTE, AND THAT IS THE POINT. The
 * first draft anchored on `className="min-w-0 flex-1"` and was then tested by
 * planting `backdrop-blur-xl` on that very element. It did fail — but with
 * "anchor is no longer in AppShell.tsx" rather than with the offending class,
 * because adding a class changes the end of the string. A guard that goes blind
 * at the exact moment somebody adds a class is no use at all, since adding a
 * class is the only way this law gets broken.
 */
const CHAIN_SITES = [
  {
    name: 'the shell grid (outermost ancestor in our code)',
    file: 'src/components/layout/AppShell.tsx',
    anchor: 'wx-app min-h-dvh lg:grid',
  },
  {
    name: 'the content column, beside the rail',
    file: 'src/components/layout/AppShell.tsx',
    anchor: 'className="flex min-w-0 flex-col',
  },
  {
    name: '<main>',
    file: 'src/components/layout/AppShell.tsx',
    anchor: 'className="min-w-0 flex-1',
  },
  {
    name: "<main>'s padding wrapper, which renders the route",
    file: 'src/components/layout/AppShell.tsx',
    anchor: 'className="w-full px-3 py-4',
  },
  {
    name: '.wurxbase-root, the fence itself',
    file: 'src/routes/admin/PaidCollabs.tsx',
    anchor: '"wurxbase-root wurxbase-shell',
  },
];

// The non-utility class names the chain wears. A stylesheet rule whose
// rightmost selector names one of these lands on the chain, wherever the rule
// happens to live. Derived rather than hardcoded, so renaming a wrapper cannot
// quietly narrow the guard.
const CHAIN_OWN_CLASSES = new Set(['wx-app', 'wurxbase-root', 'wurxbase-shell']);

// Selectors that reach the chain above our own code: the document, the Vite
// mount point, and `<main>`.
const CHAIN_ELEMENT_SELECTORS = ['html', ':root', 'body', '#root', 'main', '*'];

/* ===================================================================== *
 * 1 — STATIC. The chain's own class lists.
 * ===================================================================== */

console.log(`\nThe fence: no filter on the chain from <html> to .wurxbase-root`);
console.log('='.repeat(72));
console.log('\n[1] The ancestor elements, read out of the source');

const chainFromSource = [];
let sitesFound = 0;

for (const site of CHAIN_SITES) {
  const path = join(ROOT, site.file.split('/').join(sep));
  let src;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    fail(`${site.file} could not be read — this guard cannot see the chain`);
    continue;
  }
  const at = src.indexOf(site.anchor);
  if (at < 0) {
    /*
     * NOT A SHRUG. If the anchor is gone the shell has been restructured and
     * this guard is now checking an element that no longer exists, which is
     * indistinguishable from a pass. That is exactly how the fence got broken
     * three times, so it fails and names what to re-point.
     */
    fail(
      `${site.name}: anchor ${site.anchor} is no longer in ${site.file} — ` +
        `the shell changed shape and this guard must be re-pointed before it means anything`
    );
    continue;
  }
  const tag = openingTagAround(src, at);
  if (!tag) {
    fail(`${site.name}: found the anchor in ${site.file} but not the element it sits on`);
    continue;
  }
  sitesFound += 1;

  const tagName = /^<\s*([A-Za-z][\w.-]*)/.exec(tag.raw)?.[1] ?? '?';
  const classes = [...tag.stripped.matchAll(/['"]([^'"]*)['"]/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean)
    // Only things that look like class tokens, so `data-theme` values and
    // aria strings in the same tag are not mistaken for classes.
    .filter((t) => /^[-\w[\]().:!/%#,]+$/.test(t));

  chainFromSource.push({ ...site, tagName, classes, line: tag.line, stripped: tag.stripped });

  const offenders = classes
    .map((c) => ({ cls: c, css: utilityVerdict(c) }))
    .filter((o) => o.css);

  check(
    offenders.length === 0,
    `${site.name}: <${tagName}> at ${site.file}:${tag.line} carries no filter utility`
  );
  for (const o of offenders) {
    detail(
      `OFFENDING ELEMENT  <${tagName}> at ${site.file}:${tag.line}` +
        `\n          class            "${o.cls}"` +
        `\n          produces         ${o.css}` +
        `\n          why it is fatal  a non-none filter on this element makes it the` +
        `\n                           containing block for every position:fixed descendant,` +
        `\n                           which puts the vendored app's modals off-screen`
    );
  }

  // An inline `style` beats every stylesheet, so it gets its own look.
  const inline = /\b(?:backdropFilter|WebkitBackdropFilter|filter)\s*:/.exec(tag.stripped);
  const inlineOk =
    !inline ||
    /\b(?:backdropFilter|WebkitBackdropFilter|filter)\s*:\s*['"]none['"]/.test(tag.stripped);
  check(inlineOk, `${site.name}: <${tagName}> sets no inline filter style`);
  if (!inlineOk) {
    detail(
      `OFFENDING ELEMENT  <${tagName}> at ${site.file}:${tag.line}, inline style ${inline[0]}…`
    );
  }
}

check(
  sitesFound === CHAIN_SITES.length,
  `all ${CHAIN_SITES.length} documented ancestor elements were located (${sitesFound} found)`
);

/* ===================================================================== *
 * 2 — STATIC. Stylesheet rules that would land on the chain.
 * ===================================================================== */

console.log('\n[2] Stylesheet rules that could put a filter on the chain');

// Which of our own utilities apply a filter. Discovered from the sheet rather
// than listed here, so a new glass utility is covered the day it is written.
const FILTER_UTILITIES = [];
for (const { file, text } of CSS) {
  const re = /@utility\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(decomment(text)))) {
    const decl = /(?:^|[\s;{])(?:-webkit-)?(backdrop-filter|filter)\s*:\s*([^;}]+)/.exec(m[2]);
    if (decl && valueCanFilter(decl[2])) {
      FILTER_UTILITIES.push({ name: m[1], css: `${decl[1]}: ${decl[2].trim()}`, file });
    }
  }
}
note(
  FILTER_UTILITIES.length
    ? `project utilities that apply a filter: ${FILTER_UTILITIES.map((u) => u.name).join(', ')}`
    : 'no project utility applies a filter'
);
/*
 * A SANITY CHECK ON THE GUARD ITSELF. `global.css` has carried `wx-glass` and
 * `wx-glass-panel` since August. Finding none of them means the discovery regex
 * broke, and a guard that silently stopped looking is worse than no guard —
 * CLAUDE.md: "a check that reports everything failing is probably a broken
 * check", and the same is true of one that reports everything passing.
 */
check(
  FILTER_UTILITIES.length > 0,
  `this guard can still find the project's glass utilities (it found ${FILTER_UTILITIES.length})`
);

const utilityNames = new Set(FILTER_UTILITIES.map((u) => u.name));
// A project utility on the chain is as fatal as a Tailwind one, so fold the
// discovered names into the per-element verdict and re-check the chain.
for (const el of chainFromSource) {
  const hits = el.classes.filter((c) => utilityNames.has(stripVariants(c)));
  check(
    hits.length === 0,
    `${el.name}: <${el.tagName}> wears no glass utility (${el.classes.length} classes read)`
  );
  for (const h of hits) {
    const u = FILTER_UTILITIES.find((x) => x.name === stripVariants(h));
    detail(
      `OFFENDING ELEMENT  <${el.tagName}> at ${el.file}:${el.line}` +
        `\n          class            "${h}"` +
        `\n          produces         ${u.css}`
    );
  }
}

// And now every rule in every sheet, judged by whether its rightmost compound
// selector can match something on the chain.
const rightmostCompound = (sel) =>
  sel
    .replace(/\s*[>+~]\s*/g, ' ')
    .trim()
    .split(/\s+/)
    .pop() ?? '';

function reachesChain(selector) {
  for (const part of selector.split(',')) {
    const last = rightmostCompound(part.trim());
    if (!last) continue;
    const bare = last.replace(/::?[\w-]+(\([^)]*\))?/g, '');
    if (CHAIN_ELEMENT_SELECTORS.includes(bare)) return last;
    for (const cls of bare.matchAll(/\.([\w-]+)/g)) {
      if (CHAIN_OWN_CLASSES.has(cls[1])) return last;
    }
    // A rule that targets a wrapper by element name with no class at all —
    // `main`, `body > div` — reaches the chain too.
    if (/^[a-z]+$/.test(bare) && CHAIN_ELEMENT_SELECTORS.includes(bare)) return last;
  }
  return null;
}

let cssOffenders = 0;
for (const { file, text } of CSS) {
  for (const block of ruleBlocks(text)) {
    const decl =
      /(?:^|[\s;])(-webkit-backdrop-filter|backdrop-filter|filter)\s*:\s*([^;}]+)/.exec(
        block.body
      );
    if (!decl || !valueCanFilter(decl[2])) continue;
    const hit = reachesChain(block.prelude);
    if (!hit) continue;
    cssOffenders += 1;
    detail(
      `OFFENDING RULE     ${relative(ROOT, file)}:${lineOf(decomment(text), block.index)}` +
        `\n          selector         ${block.prelude}` +
        `\n          matches          ${hit}, which is on the chain` +
        `\n          declares         ${decl[1]}: ${decl[2].trim()}`
    );
  }
}
check(
  cssOffenders === 0,
  `no stylesheet rule puts a filter on <html>, <body>, #root, <main>, .wx-app, ` +
    `.wurxbase-root or .wurxbase-shell (${CSS.length} sheets read)`
);

/* ===================================================================== *
 * 3 and 4 — THE BROWSER
 * ===================================================================== */

if (!BASE) {
  console.log('\n[3] Computed styles in a real browser');
  note('SKIPPED — no URL given. Pass one to check computed styles:');
  note('  node scripts/verify/design/check-backdrop-ancestry.mjs http://localhost:5173');
} else {
  const { launchBrowser } = await import('../../lib/browser.mjs');
  const browser = await launchBrowser();

  // One walker, used by both the probe and the real route, so the two modes
  // cannot disagree about what the law is.
  const WALK = (selector) => {
    const root = document.querySelector(selector);
    if (!root) return null;
    const rows = [];
    for (let el = root; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      rows.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: typeof el.className === 'string' ? el.className.trim().slice(0, 140) : '',
        backdropFilter: cs.backdropFilter || 'none',
        webkitBackdropFilter: cs.getPropertyValue('-webkit-backdrop-filter') || 'none',
        filter: cs.filter || 'none',
        // Not this guard's law, but they create a containing block for fixed
        // descendants as well, so a reader of a failure wants to see them.
        transform: cs.transform,
        perspective: cs.perspective,
        willChange: cs.willChange,
        contain: cs.contain,
      });
    }
    return rows.reverse();
  };

  const isNone = (v) => !v || v === 'none' || v === 'normal' || v === 'auto';

  const judge = (rows, where) => {
    for (const r of rows) {
      const label = `<${r.tag}${r.id ? `#${r.id}` : ''}${r.cls ? ` class="${r.cls}"` : ''}>`;
      const bad = [
        ['backdrop-filter', r.backdropFilter],
        ['-webkit-backdrop-filter', r.webkitBackdropFilter],
        ['filter', r.filter],
      ].filter(([, v]) => !isNone(v));

      // The first class is in the PASS line too, so a reader can tell the four
      // anonymous `div`s on this chain apart without counting rows.
      const short = r.id ? `#${r.id}` : r.cls ? `.${r.cls.split(/\s+/)[0]}` : '';
      check(bad.length === 0, `${where}: ${r.tag}${short} is plain`);
      for (const [prop, value] of bad) {
        detail(
          `OFFENDING ELEMENT  ${label}` +
            `\n          property         ${prop}` +
            `\n          computed value   ${value}` +
            `\n          why it is fatal  this element is now the containing block for every` +
            `\n                           position:fixed descendant of .wurxbase-root`
        );
      }
      const alsoContaining = [
        ['transform', r.transform],
        ['perspective', r.perspective],
        ['contain', r.contain],
        ['will-change', r.willChange],
      ].filter(([, v]) => !isNone(v));
      if (alsoContaining.length) {
        note(
          `note (outside this guard's law, but also a containing block): ${r.tag} has ` +
            alsoContaining.map(([p, v]) => `${p}: ${v}`).join(', ')
        );
      }
    }
  };

  try {
    /* ------------------------------------------------- 3 · probe mode --- */
    console.log('\n[3] The documented chain, rebuilt in Chromium against the real CSS');
    note(
      `built from the class lists read in [1], so it tests today's source, not a copy of it`
    );

    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 780 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${PROBE_PATH}`, { waitUntil: 'domcontentloaded' });
      // The stylesheet, not the app, is what is under test here, so wait for
      // the sheet rather than for React to settle.
      await page.waitForTimeout(1500);

      const built = await page.evaluate(
        ({ chain, glassUtility, themeName }) => {
          document.documentElement.dataset.theme = themeName;
          const host = document.getElementById('root') ?? document.body;

          const holder = document.createElement('div');
          // Off-screen, not display:none, and carrying nothing of its own: a
          // filter here would be the guard failing itself.
          holder.id = 'fence-probe';
          holder.setAttribute(
            'style',
            'position:absolute;left:-10000px;top:0;width:375px;height:600px;'
          );
          host.appendChild(holder);

          let parent = holder;
          for (const link of chain) {
            const el = document.createElement(link.tagName);
            el.className = link.classes.join(' ');
            parent.appendChild(el);
            // THE NEGATIVE CONTROL. A glass sibling at every level, so a pass
            // means the walk ignored real glass rather than found none.
            if (glassUtility) {
              const sib = document.createElement('aside');
              sib.className = glassUtility;
              sib.textContent = 'legal glass sibling';
              parent.appendChild(sib);
            }
            parent = el;
          }
          return {
            siblingGlass: glassUtility
              ? getComputedStyle(holder.querySelector('aside')).backdropFilter
              : 'none',
          };
        },
        {
          chain: chainFromSource.map((c) => ({
            // `<main>` in source is a real tag; the rest are divs. Anything
            // capitalised is a React component and renders as a div here.
            tagName: /^[a-z]/.test(c.tagName) ? c.tagName : 'div',
            classes: c.classes,
          })),
          glassUtility: FILTER_UTILITIES[0]?.name ?? '',
          themeName: theme,
        }
      );

      const rows = await page.evaluate(
        WALK,
        '#fence-probe .wurxbase-root, #fence-probe .wurxbase-shell'
      );
      if (!rows) {
        fail(`${theme} theme: the probe chain did not mount — this guard proved nothing`);
      } else {
        note(`${theme} theme: walked ${rows.length} elements, <html> down to the fence`);
        judge(rows, `probe, ${theme}`);
        // The control, read back. If Chromium says the sibling is not glass,
        // the stylesheet never loaded and every PASS above is meaningless.
        check(
          built.siblingGlass !== 'none',
          `probe, ${theme}: the glass sibling really is glass ` +
            `(${built.siblingGlass}) — so the stylesheet loaded and a filter on the chain ` +
            `would have been seen`
        );
      }
      await ctx.close();
    }

    /* -------------------------------------------------- 4 · live mode --- */
    console.log('\n[4] The real Paid Collabs DOM');

    let signedIn = null;
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
      signedIn = await ctx.storageState();
      await ctx.close();
    }

    for (const path of LIVE_PATHS) {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ...(signedIn ? { storageState: signedIn } : {}),
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const rows = await page.evaluate(WALK, '.wurxbase-root');

      if (!rows) {
        /*
         * A SKIP, NOT A PASS AND NOT A FAILURE. `.wurxbase-root` only exists
         * behind the staff login (`docs/guides/GLASS_PLAN.md` §10 item B). Failing here
         * would make the guard red on every machine that lacks the password,
         * and people switch red guards off. Passing here would be a lie.
         */
        const url = page.url();
        console.log(`  SKIP  ${path}: no .wurxbase-root in the document`);
        note(`landed on ${url}`);
        note(
          process.env.ADMIN_EMAIL
            ? 'the staff sign-in did not reach the route — check ADMIN_EMAIL / ADMIN_PASSWORD'
            : 'this route needs a staff login: set ADMIN_EMAIL and ADMIN_PASSWORD'
        );
        note('[3] checked the same chain by computed style; only [4] can see a filter');
        note('arriving from the route itself, a portal or a runtime style attribute.');
      } else {
        note(`${path}: walked ${rows.length} real elements, <html> down to .wurxbase-root`);
        judge(rows, `live ${path}`);
        // Siblings are legal, and this says so out loud rather than leaving the
        // reader to wonder whether they were counted.
        const glassElsewhere = await page.evaluate(() => {
          const root = document.querySelector('.wurxbase-root');
          const chain = new Set();
          for (let el = root; el; el = el.parentElement) chain.add(el);
          let n = 0;
          for (const el of document.querySelectorAll('body *')) {
            if (chain.has(el)) continue;
            const cs = getComputedStyle(el);
            if (cs.backdropFilter !== 'none' || cs.filter !== 'none') n += 1;
          }
          return n;
        });
        note(
          `${glassElsewhere} filtered element(s) elsewhere on the page — siblings and leaves ` +
            `are legal and were not counted`
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
}

console.log(`\n${'='.repeat(72)}`);
if (failures > 0) {
  console.error(
    `${failures} fence check(s) FAILED. A filter above .wurxbase-root puts the\n` +
      `vendored app's modals off-screen — see docs/guides/GLASS_PLAN.md §1.2.\n`
  );
  process.exit(1);
}
console.log('The chain from <html> to .wurxbase-root is plain. The fence holds.\n');
