/*
 * THE ENTRY GRAPH GUARD. Runs in `pnpm build`, and fails it.
 *
 * It walks only the STATIC import edges out of `src/main.tsx` and reports every
 * module and every bare package that therefore lands in the chunk the browser
 * must download AND EVALUATE before it can paint anything — on the public
 * landing page exactly as much as on a dashboard.
 *
 * WHY THIS IS A BUILD GUARD RATHER THAN A SCRIPT SOMEBODY REMEMBERS TO RUN.
 *
 * On 2026-10-16 the entry chunk was quietly carrying the whole Supabase client
 * and Zod — 70 KB gzipped — because of ONE top-level import in a leaf file:
 *
 *   router.tsx -> ShellLayout -> AppShell -> AppSidebar
 *              -> lib/useWurxbaseIdentity.ts -> lib/supabase.ts -> lib/env.ts (zod)
 *
 * `vite.config.ts` says in its own comment that Supabase must stay lazy "so
 * the public landing page never downloads a database client it has no use
 * for", and `AuthProvider` imports it dynamically for that reason. None of
 * that helped: a single `import { getSupabase } from '@/lib/supabase'` six
 * files away undid all of it, and the only visible symptom in the build log
 * was that `index-*.js` had got bigger. Nobody can review for that.
 *
 * So the rule is mechanical: the packages in BANNED below are the ones big
 * enough that having them eager is always a mistake, and the build stops if
 * any of them is reachable without crossing a dynamic `import()`. The failure
 * prints the import chain, because "zod is eager" is not actionable and
 * "`lib/env.ts` imports zod, and `AppSidebar` reaches `lib/env.ts` like this"
 * is.
 *
 * TO FIX A FAILURE, make one edge in the printed chain dynamic — usually the
 * leaf, inside the async function that actually needs it:
 *
 *   const supabaseClient = () => import('@/lib/supabase').then((m) => m.getSupabase());
 *
 * Not by adding the package here. This list is the budget, not a record of
 * what happens to be true.
 *
 * Run `node scripts/build/entry-graph.mjs` by hand for the full report, and
 * `node scripts/build/entry-graph.mjs src/main.tsx lib/supabase.ts` to ask for the
 * chain to a specific module.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ENTRY = process.argv[2] || 'src/main.tsx';

/*
 * Each entry is matched against the import specifier as a package name, so
 * `three` matches `three` and `three/examples/x` but not `three-ish`. The
 * reason each one is here:
 *
 *   @supabase/supabase-js  52.5 KB gz. A database client on a marketing page.
 *   zod                    17.8 KB gz. Form schemas; nothing on first paint.
 *   three / vanta         151   KB gz together. A WebGL background, and the
 *                          single largest thing this app can load.
 *   xlsx                  136.8 KB gz. Spreadsheet export, admin only.
 *   jspdf / html2canvas    92.6 KB gz together. PDF export, admin only.
 *   pptxgenjs              Deck export, admin only.
 *
 * Sizes measured 2026-10-16 from `dist-perf`.
 */
const BANNED = [
  '@supabase/supabase-js',
  'zod',
  'three',
  'vanta',
  'xlsx',
  'jspdf',
  'jspdf-autotable',
  'html2canvas',
  'pptxgenjs',
];

function resolve(spec, from) {
  let p;
  if (spec.startsWith('@/')) p = path.join(root, 'src', spec.slice(2));
  else if (spec.startsWith('.')) p = path.resolve(path.dirname(from), spec);
  else return null;
  const cands = [
    p,
    p + '.ts',
    p + '.tsx',
    p + '.js',
    p + '.jsx',
    path.join(p, 'index.ts'),
    path.join(p, 'index.tsx'),
    path.join(p, 'index.js'),
  ];
  for (const c of cands) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/*
 * Comments go first, and that is not tidiness.
 *
 * This codebase explains itself at length and those explanations quote import
 * statements — including, in `AuthProvider` and `useMyWork`, the exact
 * `import ... from '@/lib/supabase'` lines they exist to warn against. Read
 * naively, every one of those comments is a static edge and this guard fails
 * the build on its own documentation.
 */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The package name a specifier belongs to: `@scope/name` or `name`. */
function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const seen = new Set();
/** bare specifier -> the file whose top level imports it */
const bare = new Map();
/** module -> the module that first reached it, for printing chains */
const parent = new Map();

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  let src;
  try {
    src = strip(fs.readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  const edges = [];
  /*
   * `(?!type\b)` drops `import type { X } from 'y'`, which is erased at
   * compile time and costs the browser nothing. Without it this guard would
   * fail on `AuthProvider`'s `import type { Session } from
   * '@supabase/supabase-js'` and on `WavesField`'s `import type { VantaEffect }
   * from 'vanta/src/vanta.waves.js'` — both of which are correct code.
   *
   * A dynamic `import()` is not matched by either pattern, which is the whole
   * point: crossing one is what makes a dependency lazy.
   */
  const from = /(?:^|[\n;])\s*(?:import|export)\s+(?!type\b)[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g;
  const side = /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = from.exec(src))) edges.push(m[1]);
  while ((m = side.exec(src))) edges.push(m[1]);
  for (const spec of edges) {
    const target = resolve(spec, file);
    if (!target) {
      if (!bare.has(spec)) bare.set(spec, file);
      continue;
    }
    if (!parent.has(target)) parent.set(target, file);
    walk(target);
  }
}

/** main.tsx -> ... -> file, as a printable chain. */
function chainTo(file) {
  const out = [];
  let c = file;
  while (c) {
    out.push(path.relative(root, c));
    c = parent.get(c);
  }
  return out.reverse();
}

walk(path.join(root, ENTRY));

const violations = [];
for (const [spec, importer] of bare) {
  if (BANNED.includes(packageOf(spec))) violations.push({ spec, importer });
}

/* The guard is quiet when it passes: a build log nobody reads is a build log
   that hides the next regression. One line, and the numbers worth watching. */
if (violations.length === 0) {
  let bytes = 0;
  for (const f of seen) bytes += fs.statSync(f).size;
  const pkgs = [...new Set([...bare.keys()].map(packageOf))].sort();
  console.log(
    `entry-graph: ${seen.size} modules / ${(bytes / 1024).toFixed(0)} KB of source eager ` +
      `from ${ENTRY}; packages: ${pkgs.join(', ')}`
  );

  /* An explicit request for a module's chain, e.g.
     `node scripts/build/entry-graph.mjs src/main.tsx lib/supabase.ts`. */
  for (const want of process.argv.slice(3)) {
    const hit = [...seen].find((f) => f.includes(want.split('/').join(path.sep)));
    console.log(
      hit ? `\n${want}:\n  ${chainTo(hit).join('\n    -> ')}` : `\n${want}: not in the static graph`
    );
  }
  process.exit(0);
}

console.error(
  `\nENTRY GRAPH: ${violations.length} heavy package(s) are on the critical path.\n` +
    `Every visitor downloads and evaluates these before the first paint,\n` +
    `including on the public landing page.\n`
);
for (const { spec, importer } of violations) {
  console.error(`  ${spec}`);
  console.error(`    imported at the top level of: ${path.relative(root, importer)}`);
  console.error(`    reached from ${ENTRY} by:`);
  console.error(`      ${chainTo(importer).join('\n        -> ')}`);
  console.error('');
}
console.error(
  `Make one edge in the chain a dynamic import() — usually the leaf, inside the\n` +
    `async function that needs it:\n\n` +
    `  const supabaseClient = () => import('@/lib/supabase').then((m) => m.getSupabase());\n\n` +
    `See the header of scripts/build/entry-graph.mjs. Do not add the package to BANNED's\n` +
    `exceptions to make this pass; the list is the budget, not a description.\n`
);
process.exit(1);
