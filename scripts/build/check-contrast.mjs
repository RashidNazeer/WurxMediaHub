#!/usr/bin/env node
/**
 * Design-token guard. Runs as part of `pnpm build`.
 *
 * Two jobs, both aimed at the same promise: dark mode and light mode never
 * drift apart.
 *
 *   1. PARITY, every colour token defined in one theme must also be defined
 *                in the other. This is what actually causes "colour mismatch"
 *                bugs: someone adds --wx-thing to dark, forgets light, and the
 *                token silently falls back to the dark value on a white page.
 *   2. CONTRAST, every text/background pair listed below must clear WCAG AA
 *                in BOTH themes.
 *
 * Exits non-zero on failure, so a bad palette can never reach a deploy.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(here, '../../src/styles/tokens.css');

/* ---------------------------------------------------------------- parsing -- */

const css = readFileSync(TOKENS, 'utf8');

/** Pull the declarations out of the block whose selector list contains `needle`. */
function block(needle) {
  const re = new RegExp(`([^{}]*${needle}[^{}]*)\\{([^}]*)\\}`, 'g');
  const out = {};
  let m;
  while ((m = re.exec(css)) !== null) {
    for (const [, k, v] of m[2].matchAll(/(--wx-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[k] = v.trim();
    }
  }
  return out;
}

const dark = block("data-theme='dark'");
const light = block("data-theme='light'");

/** Colour tokens only, shadows, fonts, gradients and sizes aren't comparable. */
const isColour = (v) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(v.trim());

/* --------------------------------------------------------------- contrast -- */

const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (h) => {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* ------------------------------------------------------------------ rules -- */

/** [foreground token, background token, minimum ratio, human label] */
const PAIRS = [
  ['--wx-text', '--wx-bg', 4.5, 'body text on page'],
  ['--wx-text', '--wx-surface-1', 4.5, 'body text on card'],
  ['--wx-text', '--wx-surface-2', 4.5, 'body text on nested card'],
  ['--wx-text', '--wx-surface-3', 4.5, 'body text on input well'],
  ['--wx-text-muted', '--wx-bg', 4.5, 'muted text on page'],
  ['--wx-text-muted', '--wx-surface-1', 4.5, 'muted text on card'],
  ['--wx-text-muted', '--wx-surface-2', 4.5, 'muted text on nested card'],
  ['--wx-text-faint', '--wx-bg', 4.5, 'faint text on page'],
  ['--wx-text-faint', '--wx-surface-1', 4.5, 'faint text on card'],
  // These two were the hole. `--wx-text-faint` is what every input placeholder
  // is painted in, and an input well is `--wx-surface-3`, so the greyed hint in
  // every form in the product sat at 3.96:1 dark and 3.97:1 light against a
  // required 4.5 and passed every build, because the guard only ever checked
  // the text a person TYPES into the well, never the hint behind it. Faint on a
  // nested card was failing too, at 4.31:1, and had been worked around with a
  // note telling everyone to use `text-muted` there instead of fixing the
  // colour. Both tokens moved 20/255 on 2026-08-13 and both pairs now hold, so
  // they are assertions rather than a comment nobody reads.
  ['--wx-text-faint', '--wx-surface-2', 4.5, 'faint text on nested card'],
  ['--wx-text-faint', '--wx-surface-3', 4.5, 'placeholder in an input well'],
  ['--wx-accent', '--wx-bg', 4.5, 'accent text on page'],
  ['--wx-accent', '--wx-surface-1', 4.5, 'accent text on card'],
  ['--wx-accent', '--wx-surface-2', 4.5, 'accent text on nested card'],
  ['--wx-accent-hover', '--wx-bg', 4.5, 'accent hover on page'],
  ['--wx-on-accent', '--wx-accent', 4.5, 'label on accent button'],
  ['--wx-on-accent', '--wx-accent-hover', 4.5, 'label on hovered accent button'],
  // The three money states. Each is checked on a NESTED card as well, because
  // that is where they actually live (the tinted cells on the creator home) and
  // it is the tightest surface of the three. The design's brighter amber was
  // 3.48:1 there and had to come down.
  ['--wx-stage-live', '--wx-bg', 4.5, 'in-progress money on page'],
  ['--wx-stage-live', '--wx-surface-1', 4.5, 'in-progress money on card'],
  ['--wx-stage-live', '--wx-surface-2', 4.5, 'in-progress money on nested card'],
  ['--wx-stage-due', '--wx-bg', 4.5, 'awaiting-payment money on page'],
  ['--wx-stage-due', '--wx-surface-1', 4.5, 'awaiting-payment money on card'],
  ['--wx-stage-due', '--wx-surface-2', 4.5, 'awaiting-payment money on nested card'],
  ['--wx-stage-paid', '--wx-bg', 4.5, 'paid money on page'],
  ['--wx-stage-paid', '--wx-surface-1', 4.5, 'paid money on card'],
  ['--wx-stage-paid', '--wx-surface-2', 4.5, 'paid money on nested card'],
  ['--wx-success', '--wx-bg', 4.5, 'success text on page'],
  ['--wx-success', '--wx-surface-1', 4.5, 'success text on card'],
  ['--wx-danger', '--wx-bg', 4.5, 'danger text on page'],
  ['--wx-danger', '--wx-surface-1', 4.5, 'danger text on card'],
  ['--wx-warning', '--wx-bg', 4.5, 'warning text on page'],
  ['--wx-warning', '--wx-surface-1', 4.5, 'warning text on card'],
  ['--wx-info', '--wx-bg', 4.5, 'info text on page'],
  ['--wx-info', '--wx-surface-1', 4.5, 'info text on card'],
  // Non-text UI boundaries only need 3:1 (WCAG 1.4.11).
  ['--wx-border-interactive', '--wx-bg', 3, 'control border on page'],
  ['--wx-border-interactive', '--wx-surface-1', 3, 'control border on card'],
  ['--wx-accent', '--wx-bg', 3, 'focus ring on page'],
  ['--wx-text-inverse', '--wx-text', 4.5, 'inverted text on inverted fill'],
];

/* ------------------------------------------------------------------- run --- */

let failures = 0;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failures++;
};

console.log('\nDesign token guard\n' + '='.repeat(70));

// 1. Parity
console.log('\n[1/5] Theme parity (dark <-> light)');
const darkColours = Object.keys(dark).filter((k) => isColour(dark[k]));
const lightColours = Object.keys(light).filter((k) => isColour(light[k]));

for (const k of darkColours) {
  if (!(k in light)) fail(`${k} is defined in dark but MISSING in light`);
}
for (const k of lightColours) {
  if (!(k in dark)) fail(`${k} is defined in light but MISSING in dark`);
}
if (failures === 0) {
  console.log(`  OK    ${darkColours.length} colour tokens present in both themes`);
}

// 2. Contrast
console.log('\n[2/5] WCAG contrast');
for (const [theme, tokens] of [
  ['dark ', dark],
  ['light', light],
]) {
  for (const [fg, bg, min, label] of PAIRS) {
    const fgv = tokens[fg];
    const bgv = tokens[bg];
    if (!fgv || !bgv) {
      fail(`${theme}  ${label}: token ${!fgv ? fg : bg} not found`);
      continue;
    }
    // Translucent tokens sit over an unknown backdrop; skip rather than guess.
    if (!fgv.startsWith('#') || !bgv.startsWith('#')) continue;

    const r = ratio(fgv, bgv);
    if (r < min) {
      fail(
        `${theme}  ${label}: ${r.toFixed(2)}:1 (needs ${min}:1)  ${fg}=${fgv} on ${bg}=${bgv}`
      );
    }
  }
}
if (failures === 0) console.log(`  OK    all pairs pass in both themes`);

// 3. Tier chips. Each L0-L7 ink against ITS OWN chip: a 12% tint of the ink
// composited on a card, exactly as the chip is painted. A token pair check
// cannot see a tint, and ink on a tint is the colour bug this product has had
// four times (see the ink-on-tinted-surfaces note). Added 2026-09-16 with the
// Euka tier palette.
console.log('\n[3/5] Tier labels on their own chips');
const before = failures;
const mixHex = (a, b, t) =>
  '#' + hex(a).map((v, i) => Math.round((v * t + hex(b)[i] * (1 - t)) * 255).toString(16).padStart(2, '0')).join('');
for (const [theme, tokens] of [
  ['dark ', dark],
  ['light', light],
]) {
  const card = tokens['--wx-surface-1'];
  for (let n = 0; n <= 7; n++) {
    const ink = tokens[`--wx-tier-${n}`];
    if (!ink || !ink.startsWith('#')) {
      fail(`${theme}  tier L${n}: --wx-tier-${n} missing or not a hex colour`);
      continue;
    }
    const chip = mixHex(ink, card, 0.12);
    const r = ratio(ink, chip);
    if (r < 4.5) fail(`${theme}  tier L${n} label on its chip: ${r.toFixed(2)}:1 (needs 4.5:1)  ink ${ink} on ${chip}`);
    // The selected tier button in Unique Creators is the ink as a SOLID fill.
    const inv = tokens['--wx-text-inverse'];
    const s = ratio(inv, ink);
    if (s < 4.5) fail(`${theme}  selected tier L${n} button label: ${s.toFixed(2)}:1 (needs 4.5:1)  ${inv} on ${ink}`);
  }
}
if (failures === before) console.log('  OK    every tier label clears 4.5:1 on its own chip, both themes');

// 4. The three totals beside Top videos: views (info), GMV (success) and ad
// spend (danger). Each card is an 8% tint of its ink on a card, and carries
// that ink as the figure and the muted grey as the label. Added 2026-09-16.
console.log('\n[4/5] Top videos totals on their tinted cards');
const before4 = failures;
for (const [theme, tokens] of [
  ['dark ', dark],
  ['light', light],
]) {
  const card = tokens['--wx-surface-1'];
  for (const t of ['--wx-info', '--wx-success', '--wx-danger']) {
    const tint = mixHex(tokens[t], card, 0.08);
    for (const fg of [t, '--wx-text-muted']) {
      const r = ratio(tokens[fg], tint);
      if (r < 4.5) fail(`${theme}  ${fg} on the ${t} total card: ${r.toFixed(2)}:1 (needs 4.5:1)  ${tokens[fg]} on ${tint}`);
    }
  }
}
if (failures === before4) console.log('  OK    each figure and its label clear 4.5:1 on their card, both themes');

// 5. Money figures in the brand table: ad spend in red (danger) and new video
// GMV in green (success), on a resting row (the card) AND on a hovered row,
// which their sheet paints with the gold wash --wx-accent-soft over the card.
// That wash is translucent, so a pair check skips it; it is composited here.
// Added 2026-09-21, when the Ad spend column turned red.
console.log('\n[5/5] Ad spend and GMV figures on resting and hovered rows');
const before5 = failures;
const rgba = (v) => {
  const m = String(v).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim());
  return { hex: '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join(''), a: Number(a) };
};
for (const [theme, tokens] of [
  ['dark ', dark],
  ['light', light],
]) {
  const card = tokens['--wx-surface-1'];
  const wash = rgba(tokens['--wx-accent-soft']);
  if (!wash) {
    fail(`${theme}  --wx-accent-soft is not an rgba() colour, so the hovered row cannot be computed`);
    continue;
  }
  const hovered = mixHex(wash.hex, card, wash.a);
  for (const ink of ['--wx-danger', '--wx-success']) {
    /* A missing token would make every ratio NaN, and NaN < 4.5 is false: the
       check would pass with nothing checked. */
    if (!String(tokens[ink] || '').startsWith('#')) {
      fail(`${theme}  ${ink} missing or not a hex colour`);
      continue;
    }
    for (const [bg, where] of [[card, 'a resting row'], [hovered, 'a hovered row']]) {
      const r = ratio(tokens[ink], bg);
      if (r < 4.5) fail(`${theme}  ${ink} figure on ${where}: ${r.toFixed(2)}:1 (needs 4.5:1)  ${tokens[ink]} on ${bg}`);
    }
  }
}
if (failures === before5) console.log('  OK    red ad spend and green GMV clear 4.5:1 on resting and hovered rows, both themes');

console.log('\n' + '='.repeat(70));
if (failures > 0) {
  console.error(`${failures} problem(s) found. Fix src/styles/tokens.css.\n`);
  process.exit(1);
}
console.log('Design tokens pass.\n');
