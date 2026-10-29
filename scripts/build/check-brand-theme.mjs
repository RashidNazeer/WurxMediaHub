#!/usr/bin/env node
/**
 * Can an admin pick a colour that makes a Brand Hub unreadable?
 *
 * `check-contrast.mjs` guards `tokens.css` and fails the build if dark and
 * light drift or a pair drops below WCAG AA. It cannot see a brand's colour,
 * because that lives in the DATABASE and is chosen in a colour picker. So this
 * guards the other half: it derives a full theme for a large sweep of colours
 * and asserts every text-on-background pair in the contract clears its ratio,
 * in BOTH modes.
 *
 * The sweep is deliberately hostile. Pure yellow, pure cyan, white, black,
 * greys, fully saturated primaries and a full hue circle at several
 * saturations, because the whole risk here is a colour nobody thought to try.
 *
 * SINCE 2026-10-09 PART OF THIS GUARD IS VACUOUS. A Brand Hub now renders inside
 * the PRISM shell and takes only the brand's accent and hero (see
 * `paletteToAccentVars`), so the brand's own page, card and rail colours are
 * never on screen. These assertions still pass but no longer protect anything
 * users see: rail text on the rail, body and secondary text on the brand page
 * and card surfaces, and the accent used as text on a brand surface. Still
 * meaningful: hero text on every hero stop, and the button label on every accent
 * stop. The vacuous ones are left in place on purpose; do not weaken them.
 *
 * No database and no browser. Runs inside `pnpm build`, so a change to the
 * derivation that quietly breaks one hue cannot reach a deploy.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../src/lib/brand-theme.ts');

/*
 * The module is TypeScript and this is plain Node. Strip the types with the
 * TypeScript compiler that is already a dependency rather than adding a loader:
 * one transpile, into a temp file, imported once.
 */
const dir = mkdtempSync(join(tmpdir(), 'wx-brand-'));
let mod;
try {
  const tsc = resolve(here, '../../node_modules/typescript/bin/tsc');
  /*
   * RUN IT FROM THE TEMP DIRECTORY, not from the repo. Naming files on the
   * command line while a `tsconfig.json` sits in the working directory is
   * TS5112, and tsc treats it as an error rather than a warning.
   */
  execFileSync(
    process.execPath,
    [tsc, SRC, '--outDir', dir, '--module', 'esnext', '--target', 'es2022', '--skipLibCheck'],
    { stdio: 'pipe', cwd: dir }
  );
  mod = await import(pathToFileURL(join(dir, 'brand-theme.js')).href);
} finally {
  // Imported already, so the directory has done its job either way.
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}

const {
  deriveBrandTheme,
  auditBrandTheme,
  contrast,
  CONTRACT,
  AREA_META,
  readBrandThemeConfig,
} = mod;

/* ------------------------------------------------------------- the sweep -- */

const colours = [];

// A full hue circle at three saturations and three lightnesses.
for (let h = 0; h < 360; h += 15) {
  for (const [s, l] of [
    [1, 0.5],
    [0.55, 0.42],
    [0.28, 0.62],
  ]) {
    colours.push(hslHex(h, s, l));
  }
}

// And the ones a person actually types, including the awkward ones.
colours.push(
  '#173d36', // the Penetrex green from Rashid's mockup
  '#2a6356',
  '#5a3045', // Aurora Skin
  '#1d3149', // Pave Goods
  '#c8924b', // Wurx gold, the default
  '#ffffff', // white: no hue at all
  '#000000', // black
  '#808080', // mid grey
  '#f2f2f2',
  '#0a0a0a',
  '#ffff00', // pure yellow, the classic contrast trap
  '#00ffff',
  '#ff00ff',
  '#ff0000',
  '#00ff00',
  '#0000ff'
);

function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/* ------------------------------------------------------------- the checks -- */

let failures = 0;
const worst = new Map();

for (const hex of colours) {
  const bad = auditBrandTheme(hex);
  if (bad.length) {
    failures++;
    console.error(`  FAIL  ${hex}`);
    for (const b of bad.slice(0, 4)) {
      console.error(
        `        ${b.mode.padEnd(5)} ${b.label}: ${b.got.toFixed(2)}:1, needs ${b.min}:1`
      );
    }
  }
  // Track the tightest margin per pair, so a change that erodes headroom shows.
  const theme = deriveBrandTheme(hex);
  for (const mode of ['light', 'dark']) {
    for (const pair of CONTRACT) {
      const got = contrast(theme[mode][pair.fg], theme[mode][pair.bg]);
      const key = `${mode} ${pair.label}`;
      const prev = worst.get(key);
      if (!prev || got < prev.got) worst.set(key, { got, min: pair.min, hex });
    }
  }
}

console.log(
  `\nBrand themes checked: ${colours.length} colours x 2 modes x ${CONTRACT.length} pairs`
);

/* --------------------------------------------- the multi-colour sweep -- */
/*
 * From 2026-08-25 an admin no longer picks one colour. They pick up to four
 * PER AREA, for four areas, plus a tone and an angle, which is a space far too
 * large to enumerate and far too large to eyeball.
 *
 * So it is sampled instead, hard, and the sample is DETERMINISTIC. A random
 * seed would mean a build that fails once and passes on the retry, which is the
 * worst possible property for a guard: it teaches everyone to press the button
 * again. This walks the same 1200 themes on every machine, so a failure here is
 * a bug somebody can reproduce from the printed JSON alone.
 *
 * The generator is deliberately stupid, drawing pure random hexes rather than
 * plausible brand palettes. A designer would never put pure yellow next to
 * black in one hero. The whole point is that an admin at 11pm might.
 */
let seed = 0x5eed1234;
const rnd = () => {
  // Mulberry32. Small, no dependency, and the same everywhere.
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const randomHex = () =>
  `#${Math.floor(rnd() * 0x1000000)
    .toString(16)
    .padStart(6, '0')}`;

const AREAS = Object.keys(AREA_META);
/*
 * Tunable, so a suspicious change can be hammered by hand without editing this
 * file: `BRAND_THEME_SAMPLES=40000 node scripts/build/check-brand-theme.mjs`. The
 * build runs the default, which takes about a second.
 */
const RANDOM_THEMES = Number(process.env.BRAND_THEME_SAMPLES || 1200);
let themeFailures = 0;

for (let i = 0; i < RANDOM_THEMES; i++) {
  const cfg = { v: 1 };
  // Between one and all four areas customised, so the mixed case is covered
  // too: a custom hero over a derived page is the likeliest real-world shape.
  const chosen = AREAS.filter(() => rnd() < 0.6);
  for (const area of chosen.length ? chosen : [pick(AREAS)]) {
    const meta = AREA_META[area];
    const count = 1 + Math.floor(rnd() * meta.max);
    const built = { stops: Array.from({ length: count }, randomHex) };
    if (meta.tone && rnd() < 0.35) built.tone = 'light';
    if (meta.angle && rnd() < 0.5) built.angle = Math.floor(rnd() * 361);
    cfg[area] = built;
  }

  const base = randomHex();
  const bad = auditBrandTheme(base, cfg);
  if (bad.length) {
    themeFailures++;
    if (themeFailures <= 5) {
      console.error(`  FAIL  custom theme on ${base}: ${JSON.stringify(cfg)}`);
      for (const b of bad.slice(0, 4)) {
        console.error(
          `        ${b.mode.padEnd(5)} ${b.label}: ${b.got.toFixed(2)}:1, needs ${b.min}:1`
        );
      }
    }
  }
}

if (themeFailures) {
  console.error(
    `\n  FAIL  ${themeFailures} of ${RANDOM_THEMES} random custom themes are unreadable`
  );
  failures += themeFailures;
} else {
  console.log(
    `  PASS  ${RANDOM_THEMES} random multi-colour themes, every stop of every gradient`
  );
}

/*
 * A CUSTOM AREA HAS TO ACTUALLY CHANGE SOMETHING. A band that clamped too hard,
 * or an override branch that silently stopped being reached, would leave every
 * theme readable and every hub identical, and every contrast check above would
 * still pass. This is the only assertion here that catches "safe but useless".
 */
const plain = deriveBrandTheme('#c8924b');
const wild = deriveBrandTheme('#c8924b', {
  v: 1,
  hero: { stops: ['#dc0945', '#1d3149', '#c8924b'], angle: 40 },
  rail: { stops: ['#1d3149', '#0a0a0a'] },
  page: { stops: ['#dc0945', '#1d3149'] },
  accent: { stops: ['#dc0945', '#c8924b'] },
});
const moved = [
  ['hero', wild.light.heroStops.length === 3 && wild.light.heroAngle === 40],
  ['rail', wild.light.rail !== plain.light.rail],
  ['page cards', wild.light.surface !== plain.light.surface],
  ['accent', wild.light.accent !== plain.light.accent],
  ['dark too', wild.dark.rail !== plain.dark.rail],
];
for (const [what, ok] of moved) {
  if (ok) console.log(`  PASS  a custom ${what} changes the palette`);
  else {
    console.error(
      `  FAIL  a custom ${what} changed nothing, so the override is not being applied`
    );
    failures++;
  }
}

/* And an uncustomised brand must be untouched by all of the above. */
const untouched =
  JSON.stringify(deriveBrandTheme('#173d36')) ===
  JSON.stringify(deriveBrandTheme('#173d36', null));
if (untouched) console.log('  PASS  a brand with no custom areas derives exactly as before');
else {
  console.error('  FAIL  passing no config changed the derived theme');
  failures++;
}

/*
 * The reader is the last line between a hand-edited database row and a
 * creator's screen, so it is asserted rather than assumed.
 */
const junk = [
  null,
  'nope',
  42,
  [],
  { hero: 'red' },
  { hero: { stops: 'red' } },
  { hero: { stops: [] } },
  { hero: { stops: ['nope', 'javascript:alert(1)'] } },
];
const survivors = junk.filter((j) => readBrandThemeConfig(j) !== null);
if (survivors.length === 0)
  console.log('  PASS  malformed themes read back as "no custom areas"');
else {
  console.error(
    `  FAIL  ${survivors.length} malformed theme(s) were accepted: ${JSON.stringify(survivors)}`
  );
  failures++;
}

const kept = readBrandThemeConfig({
  hero: {
    stops: ['#DC0945', 'nope', '#1d3149', '#c8924b', '#000000', '#ffffff'],
    angle: 999,
    tone: 'light',
  },
  page: { stops: ['#dc0945'], tone: 'light', angle: 40 },
});
const keptOk =
  kept &&
  kept.hero.stops.length === AREA_META.hero.max &&
  kept.hero.stops[0] === '#dc0945' &&
  kept.hero.angle === 360 &&
  kept.hero.tone === 'light' &&
  // Page carries neither a tone nor an angle, so both must be dropped rather
  // than stored and quietly ignored by half the code that reads them.
  kept.page.tone === undefined &&
  kept.page.angle === undefined;
if (keptOk) console.log('  PASS  a valid theme survives the reader, over-long and all');
else {
  console.error(`  FAIL  the reader mangled a valid theme: ${JSON.stringify(kept)}`);
  failures++;
}

/*
 * A brand whose derived theme is the SAME in both modes would mean the dark
 * branch silently stopped being applied, which no contrast check would catch.
 */
const sample = deriveBrandTheme('#173d36');
if (sample.light.page === sample.dark.page) {
  console.error(
    '  FAIL  light and dark derive the same page colour, so one mode is not being built'
  );
  failures++;
} else {
  console.log('  PASS  light and dark derive genuinely different palettes');
}

/* An unreadable colour must not silently become grey mush either. */
const grey = deriveBrandTheme('#808080');
if (grey.light.accent === grey.light.page) {
  console.error('  FAIL  a grey brand collapses to a single colour');
  failures++;
} else {
  console.log('  PASS  a grey brand still has a usable accent');
}

console.log('\n  tightest margins seen:');
const rows = [...worst.entries()]
  .sort((a, b) => a[1].got / a[1].min - b[1].got / b[1].min)
  .slice(0, 6);
for (const [key, v] of rows) {
  console.log(`    ${key.padEnd(42)} ${v.got.toFixed(2)}:1 (needs ${v.min}) worst at ${v.hex}`);
}

if (failures) {
  console.error(`\n${failures} brand colour(s) produce an unreadable hub.\n`);
  process.exit(1);
}
console.log(
  '\nEvery brand colour an admin could pick derives a readable hub, in both modes.\n'
);
