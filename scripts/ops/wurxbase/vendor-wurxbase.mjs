#!/usr/bin/env node
/**
 * Pull a new WurxBase release into `src/vendor/wurxbase/`.
 *
 * WHY THIS EXISTS AS A COMMITTED SCRIPT. The first vendoring on 2026-08-18 was
 * done by a one-off codemod that was never kept, so when v382 arrived on
 * 2026-08-27 the whole transform had to be reconstructed from the output. That
 * cost hours and could only be done because our own copy still carried the
 * answers. Committing the pipeline means the NEXT release is one command.
 *
 *   node scripts/ops/wurxbase/vendor-wurxbase.mjs "<path to their src/>"
 *   node scripts/ops/wurxbase/wurxbase-patches.mjs      # re-applies OUR additions
 *
 * WHAT IT DOES
 *
 *   1. Copies their JavaScript, renaming any file containing JSX to `.jsx`,
 *      because Vite will not parse JSX out of a `.js` file.
 *   2. Rewrites their CSS so every selector is fenced under `.wurxbase-root`,
 *      or their stylesheet restyles the whole product the first time anybody
 *      opens the page — they style `body`, `*` and bare elements.
 *   3. Re-themes their colours onto our `--wx-*` tokens, in three passes of
 *      decreasing confidence, and REPORTS what fell through to the last one.
 *
 * WHAT IT DOES NOT TOUCH
 *
 *   `tailwind.css` is our prebuilt, prefixed copy and is left alone; their
 *   version is three `@tailwind` directives. Rebuild it only if their code
 *   starts using `tw-` classes it did not before — v382 uses none.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';

/*
 * THE REFERENCE COPY COMES FROM GIT, NOT FROM DISK.
 *
 * Everything this script knows about theming is learned by lining their file up
 * against ours. Read that from the working tree and the second run learns from
 * the FIRST RUN'S OUTPUT — including its mistakes, which then look like
 * decisions and get re-applied forever. HEAD is the last version a human saw.
 */
function gitHead(path) {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .replace(/\r\n/g, '\n');
  } catch {
    return '';
  }
}

const SRC = process.argv[2];
if (!SRC || !existsSync(SRC)) {
  console.error('usage: node scripts/ops/wurxbase/vendor-wurxbase.mjs "<path to their src/>"');
  process.exit(1);
}
const DEST = 'src/vendor/wurxbase';

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/* ========================================================================== */
/* 1. THE COLOUR MAP                                                          */
/* ========================================================================== */

/*
 * THREE PASSES, AND THE ORDER IS THE POINT.
 *
 *   a. LEARNED   - read straight out of our existing themed CSS, by lining
 *                  their rules up with ours. Proven, because it is literally
 *                  the decision taken last time.
 *   b. CURATED   - the table below, written by hand for the colours their new
 *                  UI introduced. Small, because the new panels reuse one
 *                  palette: about forty values cover most occurrences.
 *   c. NEAREST   - perceptual fallback, in OKLab, restricted to tokens of the
 *                  right ROLE. This is the one that can be wrong, so anything
 *                  reaching it is counted and printed.
 *
 * A CUSTOM PROPERTY CARRIES ITS ROLE ONLY IN ITS NAME. `--text` read as a fill
 * turned every figure white on white during the first reskin, which is why a
 * fill can only ever become a surface and an ink can only ever become text.
 */
const CURATED = {
  ink: {
    /* their light theme puts near-black on cream; ours is the other way up,
       so their darkest ink is our PRIMARY text rather than our darkest colour */
    '#3c4043': '--wx-text-muted',   // v382 spreadsheet header label
    '#14110c': '--wx-text',
    '#0f0f0f': '--wx-text',
    '#1a1a1a': '--wx-text',
    '#111111': '--wx-text',
    '#f0ede8': '--wx-text',      // their dark theme's text
    '#ffffff': '--wx-text',
    '#a8a296': '--wx-text-muted',
    '#9b9892': '--wx-text-muted',
    '#8a857b': '--wx-text-faint',
    '#b0aa9e': '--wx-text-muted',
    '#6b6b68': '--wx-text-faint',
    '#8e8e93': '--wx-text-faint',
    '#b4362f': '--wx-danger',
    '#dc2626': '--wx-danger',
    '#047857': '--wx-success',
    '#059669': '--wx-success',
    '#5ea9ff': '--wx-info',
    '#1259c3': '--wx-accent',
    '#0e4dad': '--wx-accent',
  },
  fill: {
    /* the v382 "spreadsheet" header set */
    '#f1f3f4': '--wx-surface-2',
    '#f6f8f9': '--wx-surface-2',
    '#ffffff': '--wx-surface-1',
    '#faf9f7': '--wx-surface-1',
    '#f4f1ec': '--wx-surface-2',
    '#f5f3ef': '--wx-surface-2',
    '#f0ede8': '--wx-surface-2',
    '#eae6df': '--wx-surface-3',
    '#2c2319': '--wx-surface-3',
    '#14110c': '--wx-bg',
    '#0f0f0f': '--wx-bg',
    '#1a1a1a': '--wx-surface-1',
    '#1c1c1e': '--wx-surface-1',
    '#232323': '--wx-surface-2',
    '#1259c3': '--wx-accent',
    '#0e4dad': '--wx-accent',
    '#b4362f': '--wx-danger',
    '#8b5cf6': '--wx-stage-live',
  },
  line: {
    '#c9ccd1': '--wx-border-strong',
    '#e1e3e6': '--wx-border',
    '#e4dfd6': '--wx-border',
    '#eae6df': '--wx-border',
    '#f0ede8': '--wx-border',
    '#2c2319': '--wx-border-strong',
    '#14110c': '--wx-border-strong',
    '#1259c3': '--wx-accent',
    '#b4362f': '--wx-danger',
    'rgba(255,255,255,0.06)': '--wx-border',
    'rgba(255,255,255,0.08)': '--wx-border',
    'rgba(255,255,255,0.1)': '--wx-border-strong',
  },
};

/*
 * WHAT THE PERCEPTUAL FALLBACK MAY CHOOSE, and the omission is deliberate.
 *
 * NO SEMANTIC TOKENS HERE. `--wx-info`, `--wx-success`, `--wx-danger` and the
 * stage colours mean something: they are reserved for state, and using one as
 * the nearest match for an arbitrary hue is how a brand blue became our INFO
 * blue and put an off-palette gradient across the reporting screen. A colour
 * that is not semantic resolves to a neutral or to the accent, full stop.
 *
 * A genuinely semantic colour still reaches its token, through `semanticFor`
 * below, which decides on HUE rather than on distance.
 */
const ROLE_TOKENS = {
  ink: ['--wx-text', '--wx-text-muted', '--wx-text-faint', '--wx-accent'],
  fill: ['--wx-bg', '--wx-surface-1', '--wx-surface-2', '--wx-surface-3', '--wx-accent'],
  line: ['--wx-border', '--wx-border-strong', '--wx-border-interactive', '--wx-accent'],
  svg: ['--wx-text', '--wx-text-muted', '--wx-accent'],
};

/**
 * Is this colour saying something, or just decorating?
 *
 * A saturated red, green or amber carries meaning in a dashboard and should
 * land on the matching token. Everything else — their blues, purples, pinks —
 * is brand decoration, and OUR brand is gold, so it resolves to the accent
 * rather than to whichever semantic token happens to sit nearest.
 */
function semanticFor(rgb, r) {
  const [rr, gg, bb] = rgb;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  /*
   * THIS GATE IS WRONG AND IS DELIBERATELY LEFT WRONG. See PARKED 32.
   *
   * HSV saturation is a ratio, so it exaggerates wildly in the dark. Their
   * whole chrome is warm dark browns, and `#30271C` reads as 0.42 saturated at
   * hue 33 — indistinguishable, to this formula, from real amber. So their
   * brown surfaces land on `--wx-warning`. OKLab chroma separates the two with
   * an enormous margin: measured across their palette every neutral sits at or
   * below 0.030 and every genuinely semantic colour at or above 0.105, so
   * `Math.hypot(...oklab(rgb).slice(1)) < 0.06` is the correct test and needs
   * no tuning.
   *
   * IT CANNOT BE SWITCHED ON ALONE. Background and ink are mapped as separate
   * declarations that never see each other, so a pair only stays legible by
   * luck. Their Print PDF button is dark brown with pale cream on it; today
   * both sides go pale and it reads. Correct the gate and the background
   * becomes a solid accent while the ink stays muted — 1.1:1 — and the same
   * happens on three other screens. The fix has to pair the two, not just
   * classify better.
   */
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.35) return null;                       // grey enough to be neutral
  let h = 0;
  if (max === min) h = 0;
  else if (max === rr) h = ((gg - bb) / (max - min)) * 60;
  else if (max === gg) h = (2 + (bb - rr) / (max - min)) * 60;
  else h = (4 + (rr - gg) / (max - min)) * 60;
  if (h < 0) h += 360;
  const soft = r === 'fill';
  if (h < 20 || h >= 345) return soft ? '--wx-danger-soft' : '--wx-danger';
  if (h >= 20 && h < 50) return soft ? '--wx-warning-soft' : '--wx-warning';
  if (h >= 90 && h < 165) return soft ? '--wx-success-soft' : '--wx-success';
  return null;                                        // blue, purple, pink: decoration
}

function role(prop) {
  /*
   * A CUSTOM PROPERTY CARRIES ITS ROLE ONLY IN ITS NAME, and getting this wrong
   * is what the first v382 pull did: everything starting with `--` was filed as
   * "other" and left untouched, so their whole variable layer kept its original
   * colours. Near-black creator names on a near-black table, and not one error
   * anywhere, because unthemed CSS is still valid CSS.
   */
  if (prop.startsWith('--')) {
    if (/(^|-)(text|fg|ink|label|title|heading)(-|$)/.test(prop)) return 'ink';
    if (/(^|-)(bg|card|surface|fill|panel)(-|$)/.test(prop)) return 'fill';
    if (/(^|-)(border|divider|line|rule|outline)(-|$)/.test(prop)) return 'line';
    if (/shadow|glow/.test(prop)) return 'shadow';
    if (/accent|brand|primary|blue/.test(prop)) return 'fill';
    return 'other';
  }
  if (/^background/.test(prop)) return 'fill';
  if (prop === 'color' || /text-fill-color|caret-color/.test(prop)) return 'ink';
  if (/border|outline|column-rule/.test(prop)) return 'line';
  if (/shadow/.test(prop)) return 'shadow';
  if (/^(fill|stroke)$/.test(prop)) return 'svg';
  return 'other';
}

/* ---- colour maths, enough of OKLab to rank perceptual distance ---------- */
function parseColour(c) {
  c = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16) / 255);
  m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^#([0-9a-f]{8})$/.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.every((n) => Number.isFinite(n))) return p.slice(0, 3).map((n) => n / 255);
  }
  return null;
}
/*
 * HOW SEE-THROUGH WAS IT?
 *
 * `parseColour` deliberately throws the alpha away, because the perceptual
 * match only makes sense on an opaque colour. Nothing used to put it back,
 * and that is the whole reason the reskin looked the way it did: their row
 * hover is `rgba(20,17,12,.014)`, a wash you can barely see, and it came out
 * of the pipeline as a SOLID fill. A 1.4% tint and a 100% flood are the same
 * colour to a matcher that cannot see alpha.
 *
 * So the alpha is read separately here and re-applied to whatever token the
 * match lands on. A faint thing stays faint.
 */
function alphaOf(c) {
  c = c.trim().toLowerCase();
  let m = /^#[0-9a-f]{3}([0-9a-f])$/.exec(c);
  if (m) return parseInt(m[1] + m[1], 16) / 255;
  m = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(c);
  if (m) return parseInt(m[1], 16) / 255;
  m = /^rgba?\(([^)]+)\)$/.exec(c) || /^hsla?\(([^)]+)\)$/.exec(c);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length >= 4) {
      const raw = p[3];
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return raw.includes('%') ? n / 100 : n;
    }
  }
  return 1;
}

/* Pull one complete `name(...)` expression out of a value, counting brackets
   so a nested `var()` does not end it early. Returns null if it is not there. */
function balanced(value, name) {
  const at = value.toLowerCase().indexOf(name + '(');
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + name.length; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')' && --depth === 0) return value.slice(at, i + 1);
  }
  return null;
}

/* Re-apply an alpha to a token reference. `color-mix` is the only way to say
   "this token, but see-through" without hardcoding the colour and losing the
   theme with it. */
function withAlpha(tokenRef, a) {
  if (a >= 1) return tokenRef;
  if (a <= 0) return 'transparent';
  const pct = Math.max(1, Math.round(a * 100));
  return `color-mix(in srgb, ${tokenRef} ${pct}%, transparent)`;
}

/*
 * WHEN OUR STORED DECISION IS NOT A DECISION, JUST AN OLD MISTAKE.
 *
 * Passes 1 and 2 both rest on the same idea: where a rule existed before,
 * somebody looked at it and chose a token, and that beats any amount of
 * colour-distance reasoning. That holds right up until the previous run was
 * wrong — and then it is the mechanism that makes the mistake permanent,
 * because the reference is read from `git show HEAD:` and HEAD is the last
 * run's output. The v382 reskin shipped a 1.4% wash as a solid blue, and a
 * re-run would have handed it straight back, verbatim, as a considered choice.
 *
 * So a stored value is trusted unless it claims something their colour cannot
 * support, and the bar for "cannot" is deliberately low: ONE claim, checkable
 * with no judgement in it at all — an OPAQUE token standing where their colour
 * is see-through. A fill is either transparent or it is not.
 *
 * IT DELIBERATELY DOES NOT SECOND-GUESS THE HUE. The first version of this
 * also threw out a semantic token whenever the source colour was too grey to
 * be semantic, and that overruled 515 stored values — including
 * `.pc-bt-sort.on`, whose `--wx-warning` background is a deliberate choice
 * made on a neutral source, and which this script's own comment records as a
 * mistake somebody already made once. It re-broke four screens. Choosing to
 * make a neutral thing loud is a design decision; a person is allowed to make
 * it and a colour-distance rule is not allowed to undo it.
 *
 * Getting the hue right belongs at DERIVATION, in `semanticFor`, where there
 * is no human decision to overrule.
 */
function contradicts(theirValue, ourValue) {
  if (!/var\(--wx-/.test(ourValue)) return false;
  if (/color-mix|rgba?\(|hsla?\(/i.test(ourValue)) return false;   // already see-through
  for (const c of theirValue.match(COLOUR_G) || []) {
    if (parseColour(c) && alphaOf(c) < 0.9) return true;
  }
  return false;
}

const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function oklab(rgb) {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/*
 * OUR PALETTE, IN ITS LIGHT VALUES — and the comment used to say "dark", which
 * was simply untrue. The slice runs from `:root` to the first `@media`, and
 * `[data-theme='light']` sits inside that span, so its definitions overwrite
 * the dark ones and the matcher has always compared against light.
 *
 * Left as it is, now that it is understood, because it is the right end to
 * match from: THEIR design is a light one — white cards, near-black text,
 * cream chrome — so lining their colours up against our light values maps like
 * to like, and the token then flips correctly in dark mode on its own. Match
 * their white card against our DARK surface and it lands on whatever happens
 * to be nearest in the wrong half of the range.
 */
function palette() {
  const css = read('src/styles/tokens.css');
  const block = css.slice(css.indexOf(':root'), css.indexOf('@media'));
  const out = new Map();
  for (const m of block.matchAll(/(--wx-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const rgb = parseColour(m[2].trim());
    if (rgb) out.set(m[1], oklab(rgb));
  }
  return out;
}

/* ========================================================================== */
/* 2. LEARNING FROM OUR OWN CSS                                               */
/* ========================================================================== */

const COLOUR_G = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const normC = (c) => c.toLowerCase().replace(/\s+/g, '');
const FENCE = /^\.wurxbase-root(\.wurxbase-root)?\s*/;
const unfence = (s) =>
  s.split(',').map((x) => x.trim().replace(FENCE, '').trim()).filter(Boolean).join(', ');

function ruleMap(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || sel.startsWith('@')) continue;
    const props = out.get(unfence(sel)) ?? new Map();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i <= 0) continue;
      /* Comments are already stripped here, but leading junk is not: keep the
         property name alone so a custom property is still recognisable. */
      const prop = d.slice(0, i).replace(/^[^a-zA-Z-]*/, '').trim();
      if (!prop) continue;
      props.set(prop.startsWith('--') ? prop : prop.toLowerCase(), d.slice(i + 1).trim());
    }
    out.set(unfence(sel), props);
  }
  return out;
}

/**
 * What OUR copy resolved each of their custom properties to.
 *
 * Taken by NAME rather than by selector, because a variable is declared once
 * and read everywhere: `--pc-text: var(--wx-text)` is the whole decision, and
 * it is a decision a person made during the first reskin. Reusing it beats any
 * amount of inference.
 */
function learnVars(ourCss) {
  const out = new Map();
  for (const m of ourCss.matchAll(/(--[a-z][a-z0-9-]*)\s*:\s*([^;{}]+);/gi)) {
    const name = m[1];
    const val = m[2].trim();
    if (!val.includes('var(--wx-')) continue;          // only themed answers
    if (!out.has(name)) out.set(name, val);
  }
  return out;
}

function learn(theirCss, ourCss) {
  const ours = ruleMap(ourCss);
  const learned = new Map();
  for (const m of theirCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const mine = ours.get(sel);
    if (!mine) continue;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).trim();
      const myVal = mine.get(prop);
      if (!myVal) continue;
      const cols = val.match(COLOUR_G) || [];
      const toks = myVal.match(/var\((--wx-[a-z0-9-]+)\)/g) || [];
      if (cols.length === 1 && toks.length === 1) {
        const key = `${role(prop)}|${normC(cols[0])}`;
        /*
         * WHAT IS LEARNED IS THE TOKEN, AND ONLY THE TOKEN.
         *
         * This map is keyed by colour, so it is global: every occurrence of
         * that colour anywhere gets this answer. Refusing to learn from a rule
         * therefore does not leave the key empty — it hands it to whichever
         * OTHER rule mentions the same colour next, whose choice may be worse.
         * Filtering here re-pointed `#F5E9D6` from `--wx-warning-soft` to the
         * solid accent and put grey text on gold across the report header.
         * So nothing is filtered out here. Opacity is corrected per
         * declaration, at the point of use, where it cannot move a key.
         *
         * THE EXPRESSION ONLY, never the rest of the declaration: what gets
         * stored is substituted for a colour INSIDE another value, so a stored
         * `... !important` lands in front of the original one and lightningcss
         * rejects the whole stylesheet at build.
         */
        if (!learned.has(key)) learned.set(key, balanced(myVal, 'color-mix') ?? toks[0]);
      }
    }
  }
  return learned;
}

/* ========================================================================== */
/* 3. THE TRANSFORM                                                           */
/* ========================================================================== */

/**
 * Fence one selector list.
 *
 * ATTRIBUTE SELECTORS ATTACH TO THE FENCE rather than becoming its descendants.
 * Their theming keys off `[data-theme]` and friends written onto the ROOT, and
 * the seam mirrors those onto our wrapper; turning `:root[data-accent="x"]`
 * into `.wurxbase-root [data-accent="x"]` would stop every one of them matching.
 */
function fenceSelector(sel) {
  return sel
    .split(',')
    .map((one) => {
      let s = one.trim();
      if (!s) return s;
      if (s.startsWith('.wurxbase-root')) return s;               // already ours
      if (/^(from|to|\d+%)$/.test(s)) return s;                    // keyframe stop
      if (/^(:root|html|body)$/.test(s)) return '.wurxbase-root';
      const m = /^(?::root|html|body)((?:\[[^\]]*\]|[:.#][^\s>+~]*)+)?(.*)$/.exec(s);
      if (m && (m[1] || m[2] !== undefined) && /^(?::root|html|body)/.test(s)) {
        return `.wurxbase-root${m[1] ?? ''}${m[2] ?? ''}`;
      }
      return `.wurxbase-root ${s}`;
    })
    .join(', ');
}

const stats = { verbatim: 0, learned: 0, curated: 0, nearest: 0, kept: 0, translucent: 0, redecided: 0 };
const nearestLog = new Map();

function themeValue(prop, value, learned, pal, vars) {
  /*
   * A CUSTOM PROPERTY WE ALREADY DECIDED ABOUT KEEPS THAT DECISION, verbatim.
   * Only a variable their new release introduced falls through to the colour
   * mapping below.
   */
  if (prop.startsWith('--') && vars && vars.has(prop)) {
    stats.learned += (value.match(COLOUR_G) || []).length || 1;
    return vars.get(prop);
  }
  const r = role(prop);
  /* Shadows stay as they are: they are neutral rgba and read correctly on
     either ground, and there is no shadow token with the same geometry. */
  if (r === 'shadow' || r === 'other') { stats.kept += (value.match(COLOUR_G) || []).length; return value; }

  return value.replace(COLOUR_G, (c) => {
    const a0 = alphaOf(c);
    if (a0 < 1) stats.translucent++;
    const key = `${r}|${normC(c)}`;
    if (learned.has(key)) {
      stats.learned++;
      const v = learned.get(key);
      /*
       * THE LEARNED MAP KNOWS WHICH TOKEN, NOT HOW SEE-THROUGH.
       *
       * Its keys do carry the alpha, so in principle its answer is already
       * the answer for this exact colour — but it was learned from a run that
       * could not see alpha at all, so a bare opaque token standing against a
       * see-through colour is that run's bug, not last time's decision. The
       * hue is kept, which is the part a person may have chosen; only the
       * opacity is restored. An entry that is already a colour-mix carries
       * its own opacity and is left exactly as it is.
       */
      return /color-mix/i.test(v) ? v : withAlpha(v, a0);
    }
    /* CURATED is hand-written and its keys spell out the alpha, so its answer
       is final: `rgba(255,255,255,0.06) -> --wx-border` is somebody saying
       "that faint white line is our border colour", not an oversight. */
    const cur = CURATED[r]?.[normC(c)];
    if (cur) { stats.curated++; return `var(${cur})`; }
    const rgb = parseColour(c);
    const choices = ROLE_TOKENS[r];
    if (!rgb || !choices) { stats.kept++; return c; }
    const a = a0;
    const sem = (r === 'fill' || r === 'ink' || r === 'line') ? semanticFor(rgb, r) : null;
    if (sem) { stats.nearest++; nearestLog.set(`${r}|${normC(c)} -> ${sem}`, (nearestLog.get(`${r}|${normC(c)} -> ${sem}`) ?? 0) + 1); return withAlpha(`var(${sem})`, a); }
    const lab = oklab(rgb);
    let best = null, bestD = Infinity;
    for (const t of choices) {
      const p = pal.get(t);
      if (!p) continue;
      const d = dist(lab, p);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (!best) { stats.kept++; return c; }
    stats.nearest++;
    nearestLog.set(key, (nearestLog.get(key) ?? 0) + 1);
    return withAlpha(`var(${best})`, a);
  });
}

/*
 * COMMENTS ARE LIFTED OUT BEFORE THE WALK AND PUT BACK AFTER.
 *
 * The walker splits on braces, so a comment sitting above a rule lands in the
 * SELECTOR position and gets fenced along with it. The first attempt emitted
 * `.wurxbase-root /* CREATOR HUB ... *​/` as a selector and postcss refused the
 * whole file at line 1. Comments are worth keeping — theirs explain the
 * layout — so they are parked as placeholders rather than stripped.
 */
const PH = /\u0000C(\d+)\u0000/g;

function transformCss(theirCss, ourCss, pal) {
  const learned = learn(theirCss, ourCss);
  const vars = learnVars(ourCss);
  /*
   * A DECLARATION WE ALREADY THEMED KEEPS OUR EXACT VALUE.
   *
   * Inference is only for what is genuinely new. Where a rule existed before,
   * somebody looked at it and chose a token, and no amount of colour-distance
   * reasoning beats that: the first attempt re-derived `.pc-bt-sort.on` as
   * `--wx-on-accent` when the human had chosen `--wx-warning`, which put white
   * text on a white header in light mode.
   *
   * It also means a colour THEY changed in an existing rule is overridden by
   * ours, which is the point of a reskin rather than a loss.
   */
  const ourRules = ruleMap(ourCss);

  const comments = [];
  let src = theirCss.replace(/\/\*[\s\S]*?\*\//g, (c) => {
    comments.push(c);
    return `\u0000C${comments.length - 1}\u0000`;
  });

  /*
   * THE GOOGLE FONTS IMPORT GOES. It is PARKED 29(d): the main product
   * self-hosts every typeface, and this one line made an admin's browser talk
   * to Google the moment they opened Paid Collabs. Inter is already self-hosted
   * here, so dropping it changes nothing on screen and removes a third party
   * from the admin panel entirely.
   */
  src = src.replace(/@import\s+url\((['"]?)https:\/\/fonts\.googleapis\.com[^)]*\1\)\s*;/g, '');

  let out = '';
  let i = 0;
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    out += src.slice(i, m.index);
    i = m.index + m[0].length;
    const head = m[1];
    const body = m[2];

    /* Head comments are emitted as they are; only the selector is fenced. */
    const headComments = head.match(PH) || [];
    const headTrim = head.replace(PH, '').trim();

    if (headTrim.startsWith('@')) {
      out += `${head}{${body}}`;
      continue;
    }

    const inKeyframes = /@keyframes[^{]*\{[^}]*$/.test(out.slice(-400));
    const sel = headTrim ? (inKeyframes ? headTrim : fenceSelector(headTrim)) : headTrim;

    const previously = headTrim ? ourRules.get(headTrim) : null;

    const decls = body
      .split(';')
      .map((d) => {
        const k = d.indexOf(':');
        if (k < 0) return d.trim() ? d : null;

        /*
         * A COMMENT BETWEEN TWO DECLARATIONS BELONGS TO NEITHER.
         *
         * Splitting on ';' leaves the previous line's trailing comment glued to
         * the FRONT of the next property, so `--sheet-head-bg` arrived as
         * "<comment> --sheet-head-bg", stopped starting with "--", was filed as
         * an unknown role and kept its raw #F1F3F4. That put a light grey
         * spreadsheet header inside the dark theme, and only the contrast guard
         * noticed. The comment is lifted off and put back in front.
         */
        const rawProp = d.slice(0, k);
        const lead = rawProp.match(PH) || [];
        const prop = rawProp.replace(PH, '').trim();
        if (!prop) return d;
        const val = d.slice(k + 1);
        const p = prop.startsWith('--') ? prop : prop.toLowerCase();
        const pre = lead.length ? lead.join(' ') + ' ' : '';

        const mine = previously?.get(p);
        if (mine !== undefined && /var\(--wx-/.test(mine) && !contradicts(val, mine)) {
          stats.verbatim++;
          return `${pre}${prop}: ${mine}`;
        }
        if (mine !== undefined && contradicts(val, mine)) stats.redecided++;
        return `${pre}${prop}: ${themeValue(p, val.trim(), learned, pal, vars)}`;
      })
      .filter(Boolean);

    const lead = headComments.length ? headComments.join('\n') + '\n' : '';
    out += `\n${lead}${sel} {${decls.join('; ')}${decls.length ? ';' : ''}}`;
  }
  out += src.slice(i);

  /* Put the real comments back. */
  return out.replace(PH, (_, n) => comments[Number(n)]);
}

/* ========================================================================== */
/* 4. RUN                                                                     */
/* ========================================================================== */

/**
 * Colours hardcoded into `style={{}}` objects in their JSX.
 *
 * NO STYLESHEET SWEEP CAN SEE THESE, and an inline style beats any rule we
 * write short of `!important` on every one. `CreativeAngles` paints its
 * selected row `#1259C3` inline, which is why a brand-blue band appeared in the
 * middle of a gold product no matter what the CSS said.
 *
 * Matched by the PROPERTY NAME immediately before the colour, so a hex used for
 * anything other than a style is left alone. React accepts `var(--wx-*)` in an
 * inline style exactly like any other value.
 */
const STYLE_PROP = String.raw`(background|backgroundColor|color|borderColor|border|borderTop|borderBottom|borderLeft|borderRight|outline|boxShadow|fill|stroke)`;

function themeInlineStyles(src, learned, pal, vars) {
  /*
   * THE WHOLE VALUE, NOT JUST THE FIRST COLOUR IN IT.
   *
   * The first version matched from the property name to the first colour,
   * so a two-stop gradient had its first stop themed and its second left
   * raw: warning-soft at 0% and a hardcoded #2A2118 at 100%. That is a
   * permanently dark pill behind theme-coloured ink, which is invisible in
   * light mode. Capture the quoted value whole, then map every colour in it.
   *
   * Single and double quotes only. A template literal in a style value can
   * contain interpolation, and rewriting inside one risks changing code
   * rather than colour.
   */
  /* `\2` is the QUOTE. STYLE_PROP is a capture group of its own, so it takes
     group 1 and the quote is group 2; `\1` asked the value to be closed by
     the property name, matched nothing, and themed none of the 468 inline
     colours while still building cleanly. */
  const re = new RegExp('\\b' + STYLE_PROP + '\\s*:\\s*([\'"])((?:[^\'"\\\\]|\\\\.)*)\\2', 'g');
  const COL = /#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g;
  let changed = 0;
  const out = src.replace(re, (whole, prop, q, value) => {
    const cssProp = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
    let touched = false;
    const next = value.replace(COL, (colour) => {
      const themed = themeValue(cssProp, colour, learned, pal, vars);
      if (themed !== colour) { touched = true; changed += 1; }
      return themed;
    });
    if (!touched) return whole;
    return prop + ': ' + q + next + q;
  });
  return { out, changed };
}

const JSX_TO_JSX = new Set(['App.js', 'WurxUI.js', 'PaidCollabs.js', 'AccessControl.js', 'GodMode.js', 'CreativeAngles.js', 'SqlQuest.js']);
const PLAIN_JS = new Set(['access.js', 'angleStore.js', 'brandContract.js', 'godSettings.js', 'contractPdf.js', 'supabaseClient.js']);
const COPY_CSS = new Set(['responsive.css', 'theme.css']);
const THEME_CSS = new Set(['App.css', 'paidcollabs.css']);

console.log(`vendoring from ${SRC}\n`);

for (const f of readdirSync(SRC)) {
  const from = join(SRC, f);
  if (JSX_TO_JSX.has(f)) {
    const to = join(DEST, basename(f, '.js') + '.jsx');
    const pal2 = palette();
    const ref = gitHead(`${DEST}/paidcollabs.css`) + '\n' + gitHead(`${DEST}/App.css`);
    const { out, changed } = themeInlineStyles(read(from), learn('', ref), pal2, learnVars(ref));
    writeFileSync(to, out);
    console.log(`  js  ${f.padEnd(20)} -> ${basename(to)}${changed ? `, ${changed} inline colour(s) themed` : ''}`);
  } else if (PLAIN_JS.has(f)) {
    writeFileSync(join(DEST, f), read(from));
    console.log(`  js  ${f.padEnd(20)} -> ${f}`);
  } else if (COPY_CSS.has(f)) {
    /* Already fenced last time and unchanged since; re-fence from source so
       the pipeline stays the single source of truth. */
    const pal = palette();
    const ourPath = join(DEST, f);
    const ours = gitHead(`${DEST}/${f}`);
    writeFileSync(ourPath, transformCss(read(from), ours, pal));
    console.log(`  css ${f.padEnd(20)} -> fenced`);
  }
}

const pal = palette();
for (const f of THEME_CSS) {
  const from = join(SRC, f);
  if (!existsSync(from)) continue;
  const ourPath = join(DEST, f);
  const ours = gitHead(`${DEST}/${f}`);
  if (!ours) console.log(`  ..  no HEAD copy of ${f}; nothing to learn from`);
  const before = { ...stats };
  const outCss = transformCss(read(from), ours, pal);
  writeFileSync(ourPath, outCss);
  console.log(
    `  css ${f.padEnd(20)} -> kept ours ${stats.verbatim - before.verbatim}, ` +
      `learned ${stats.learned - before.learned}, curated ${stats.curated - before.curated}, ` +
      `nearest ${stats.nearest - before.nearest}, untouched ${stats.kept - before.kept}`
  );
}

console.log(
  `\ntotals: kept ours ${stats.verbatim}  learned ${stats.learned}  curated ${stats.curated}  ` +
    `nearest ${stats.nearest}  untouched ${stats.kept}\n` +
    `        of the matched colours, ${stats.translucent} were see-through and kept their alpha\n` +
    `        ${stats.redecided} stored decisions were overruled: the source colour could not support them`
);
if (nearestLog.size) {
  console.log(`\nfell through to the perceptual fallback (${nearestLog.size} distinct) - the ones worth eyeballing:`);
  for (const [k, n] of [...nearestLog].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`   ${String(n).padStart(4)}x  ${k}`);
  }
}
console.log('\nnext: node scripts/ops/wurxbase/wurxbase-patches.mjs   (re-applies our Ad spend and ROI blocks)');
