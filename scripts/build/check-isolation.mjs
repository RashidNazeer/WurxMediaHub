#!/usr/bin/env node
/**
 * The vendored WurxBase code must reach exactly one database, through exactly
 * one client, in exactly one schema.
 *
 * WHAT THIS GUARD USED TO SAY, AND WHY IT CHANGED. Until 2026-08-28 the rule
 * was the opposite of today's: two platforms, two Supabase projects, and the
 * vendored app was forbidden from importing our client at all. Rashid asked for
 * that in as many words — "both platform should not effect each other's data in
 * anyway" — and it was the right rule while there were two products.
 *
 * On 2026-08-28 he consolidated: "now there is only one main copy and that is
 * our own copy in this app we are moving everything here... I want to have only
 * one app being managed from one side." Their eight tables now live in the
 * `wurxbase` SCHEMA of our project. Separation by PROJECT is gone; separation by
 * SCHEMA replaces it, and the isolation that mattered is still real — their
 * `creators` and our `profiles` are different tables and no cascade spans them.
 *
 * The guard was not deleted, because the reason it existed did not go away. It
 * now asserts the new invariant, which is narrower and easier to break:
 *
 *   1. NOTHING may name their old projects. A leftover URL or key does not
 *      error — it quietly reads a database nobody maintains any more and
 *      reports healthy-looking numbers about it. That is the whole failure
 *      mode of this migration and it is invisible from the screen.
 *   2. The vendored code creates no Supabase client of its own. One client for
 *      the whole application, or two of them race to refresh the same token and
 *      people get logged out at random (CLAUDE.md, Auth rules).
 *   3. Only `supabaseClient.js` imports ours. That file is the seam; forty
 *      other files reaching past it is how a seam stops being one.
 *   4. No realtime subscription in the vendored code names schema 'public'.
 *      Their filters used to say `public` because that was their whole
 *      database. Left as they were, they would subscribe to OUR tables of the
 *      same name and silently deliver nothing.
 *
 * It fails the build rather than warning, because a warning in a build log is a
 * thing nobody reads.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const RETIRED = [
  { ref: 'bnevtdezskftlrjjgbsg', name: 'WurxBase', note: 'migrated into the wurxbase schema on 2026-08-28' },
  { ref: 'pfkpgmpicjcirnogxkac', name: 'Paid Collaborations', note: 'the project no longer exists at all' },
  { key: 'sb_publishable_h7DMRqJ19S3cWaEoUR9e8Q_b5FEAEyu', name: "WurxBase's old publishable key" },
  { key: 'sb_publishable_-1vO04qlMUTeuxagCMFJeA_frnpOEfN', name: "Paid Collaborations' old publishable key" },
];

const VENDOR = 'src/vendor/wurxbase';
const SEAM = `${VENDOR}/supabaseClient.js`;
/*
 * The files that are ALLOWED to name a retired project, because naming it is
 * their entire job. Keeping this list short and explicit matters: every entry
 * is a place the guard is blind, so each one says why it is safe.
 *
 *   check-isolation.mjs        this file. It has to know what to look for.
 *   wurxbase-copy-data.mjs     reads the old project to copy the data out. It
 *                              is the only thing that should ever connect, and
 *                              it is kept for the prod run.
 *   check-wurxbase-migration.mjs  asserts that the running app never touches
 *                              them, which it cannot do without the refs.
 */
const NAMING_THEM_IS_THE_JOB = [
  'scripts/build/check-isolation.mjs',
  'scripts/ops/wurxbase/wurxbase-copy-data.mjs',
  'scripts/verify/wurxbase/check-wurxbase-migration.mjs',
];

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.json'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vercel']);

/** Forward slashes whatever the platform, without a single escape sequence. */
const posix = (p) => p.split(sep).join('/');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (EXTS.some((x) => e.name.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

const problems = [];
let vendorFiles = 0;
let seamSeen = false;

/* ---- 1. nobody talks to a retired project ----------------------------- */
for (const dir of ['src', 'scripts', 'supabase']) {
  for (const f of walk(dir)) {
    const rel = posix(f);
    if (NAMING_THEM_IS_THE_JOB.some((allowed) => rel.endsWith(allowed))) continue;
    const src = readFileSync(f, 'utf8');
    for (const t of RETIRED) {
      const needle = t.ref || t.key;
      if (!src.includes(needle)) continue;
      /* A migration may describe the move in prose; it may not connect. */
      if (rel.startsWith('supabase/migrations/') && !src.includes(`${needle}.supabase.co`)) continue;
      problems.push(
        `${rel} still names ${t.name}.` +
          `\n        ${t.note || 'Retired.'} A leftover reference does not error — it reads a` +
          '\n        database nobody maintains and reports healthy numbers about it.',
      );
    }
  }
}

/* ---- 2, 3, 4. the vendored code, and how it reaches the database ------- */
for (const f of walk(VENDOR)) {
  const rel = posix(f);
  const src = readFileSync(f, 'utf8');
  vendorFiles += 1;

  if (/\bcreateClient\s*\(/.test(src)) {
    problems.push(
      `${rel} constructs its own Supabase client.` +
        '\n        There is exactly one client, in src/lib/supabase.ts. Two of them race' +
        '\n        to refresh the same token, one loses, and people are logged out at' +
        '\n        random — the exact bug this product is engineered against.',
    );
  }

  const importsOurs = src.includes('@/lib/supabase') || /from '[^']*lib\/supabase'/.test(src);
  if (rel === SEAM) {
    seamSeen = true;
    if (!importsOurs) {
      problems.push(
        `${rel} is the seam and no longer imports our client.` +
          '\n        Everything in the vendored app reaches the database through this' +
          '\n        file. If it stopped, something else started, and that something is' +
          '\n        not scoped to the wurxbase schema.',
      );
    }
    if (!src.includes("'wurxbase'")) {
      problems.push(
        `${rel} does not name the wurxbase schema.` +
          '\n        Unscoped, every .from() in the vendored app queries public, where' +
          '\n        our own tables live.',
      );
    }
  } else if (importsOurs) {
    problems.push(
      `${rel} imports our Supabase client directly.` +
        `\n        Only ${SEAM} may. It is what scopes every query to the wurxbase` +
        '\n        schema; a client obtained anywhere else is pointed at public.',
    );
  }

  /*
   * NO PASSWORD EVER COMES BACK HERE.
   *
   * Their app kept every member's password in the clear — five of them
   * hardcoded in App.jsx and shipped in the browser bundle, the rest in
   * `app_users.password`. Both are gone as of 2026-08-29 and the column is
   * dropped, so any reappearance is a mistake rather than a decision.
   *
   * This matches CODE, not prose: an object key `password:` or a property
   * read `.password`. A comment explaining the history stays legal, which is
   * why the wording elsewhere avoids both forms.
   */
  const pw = src.match(/\bpassword\s*:|\.password\b/g);
  if (pw) {
    problems.push(
      `${rel} handles a password field again (${pw.length} place(s)).` +
        '\n        There is no sign-in in this app any more, so nothing needs one, and' +
        '\n        wurxbase.app_users has no password column to write it to. A person is' +
        '\n        recognised by hub_email against the hub account they signed in with.',
    );
  }

  const publicRealtime = src.match(/schema:\s*'public'/g);
  if (publicRealtime) {
    problems.push(
      `${rel} has ${publicRealtime.length} realtime subscription(s) on schema 'public'.` +
        '\n        Their tables are in wurxbase now. A filter left on public subscribes' +
        '\n        to OUR table of the same name and delivers nothing, silently.',
    );
  }
}

if (vendorFiles > 0 && !seamSeen) {
  problems.push(
    `${SEAM} is missing.` +
      '\n        The vendored app has no seam, so nothing is scoping its queries.',
  );
}

if (problems.length > 0) {
  console.error(`\nISOLATION BROKEN. ${problems.length} problem(s):\n`);
  for (const p of problems) console.error('  - ' + p + '\n');
  console.error(
    '  WurxBase lives in the `wurxbase` schema of our own project since\n' +
      '  2026-08-28. One database, one client, one schema. See docs/OPERATIONS.md.\n',
  );
  process.exit(1);
}

console.log(`  isolation ok: ${vendorFiles} vendored files, one client, one schema, no retired projects`);
