#!/usr/bin/env node
/**
 * THE ROUTE AND THE FUNCTION MUST AGREE ABOUT WHO IS ALLOWED.
 *
 *   node scripts/verify/auth/check-role-gates.mjs
 *
 * WHY THIS EXISTS. On 2026-09-04 Rashid signed up, signed in, and got a red
 * "Not allowed" under the Connect TikTok button. Nothing was broken. Two
 * allow-lists for one screen, kept in different files, disagreed about exactly
 * one role:
 *
 *     src/app/router.tsx            allow={['applicant', 'creator']}
 *     supabase/functions/…          ['creator', 'ops', 'admin']
 *
 * So every applicant — which is what every new signup is — was shown a button
 * and then refused by the server behind it. His words: "sign up login should
 * not let this happen again no matter how many times I do it."
 *
 * A person can only meet this by signing up and clicking, which is the worst
 * possible way to find it. So it is asserted from the source instead.
 *
 * THE RULE: every role the creator app lets onto a screen must be accepted by
 * the Edge Functions that screen calls — or the function must be listed below
 * as deliberately narrower, with the reason and what the screen shows instead.
 * A new function fails this check until somebody classifies it, which is the
 * point: the default is "explain yourself", not "pass silently".
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

/* ── who the creator app admits ──────────────────────────────────────── */
const router = readFileSync('src/app/router.tsx', 'utf8');
const admitted = new Set();
for (const m of router.matchAll(/allow=\{\[([^\]]+)\]\}/g)) {
  for (const r of m[1].matchAll(/'([a-z_]+)'/g)) admitted.add(r[1]);
}
const CREATOR_APP = ['applicant', 'creator'].filter((r) => admitted.has(r));
check(CREATOR_APP.length === 2,
  'the creator app still admits applicants and creators',
  [...admitted].join(', '));

/* ── functions a signed-in CREATOR-APP screen can call, and the rule for
      each. "wide" means it must accept everyone the app admits. "narrow"
      means it deliberately does not, and the screen must say so in words
      rather than offering a control that fails. ─────────────────────── */
const EXPECTED = {
  'tiktok-creator': {
    rule: 'wide',
    why: 'the Profile card is drawn for applicants too; connecting reads only that person\'s own public counts',
  },
  'tiktok-creator-callback': {
    rule: 'wide',
    why: 'the other half of the same connection — refusing here would strand a completed TikTok consent',
  },
  'enter-contest': {
    rule: 'narrow',
    why: 'entering a contest is work, and an applicant has none. The contest screen must show the "opens when you are approved" panel, never an Enter button.',
  },
  'manage-content': {
    rule: 'narrow',
    why: 'submitting a video against a brief is work, and an applicant has none. The Content screen must show the approval panel rather than a submit form.',
  },
  'manage-offer-application': {
    rule: 'narrow',
    why: 'applying to a paid offer requires approval. The offer screen must say so rather than offer Apply.',
  },
};

const dir = 'supabase/functions';
for (const [name, spec] of Object.entries(EXPECTED)) {
  const p = `${dir}/${name}/index.ts`;
  if (!existsSync(p)) { check(false, `${name}: the function still exists`, p); continue; }
  const src = readFileSync(p, 'utf8');

  /* the role allow-list, however it is spelled: `[...].includes(actor.role)` or, once the
     value is coerced, `[...].includes(String(actor.role))`. A parser that knew only the first
     form reported tiktok-creator-callback as refusing everybody the day it changed. */
  const roles = new Set();
  for (const m of src.matchAll(/\[([^\]]*'(?:applicant|creator|ops|admin)'[^\]]*)\]\.includes\(\s*(?:String\(\s*)?actor\.role\s*\)?\s*\)/g)) {
    for (const r of m[1].matchAll(/'([a-z_]+)'/g)) roles.add(r[1]);
  }
  for (const m of src.matchAll(/actor\.role\s*===\s*'([a-z_]+)'/g)) roles.add(m[1]);

  /* A plain string test, not a regex. Written as /actor.role/ the backslash
     was lost in transit and the dot became a wildcard, which matched the
     AUDIT FIELD `actor_role` and made this guard report a function with no
     role gate as refusing everybody. */
  const gatesOnRole = src.includes('actor' + '.' + 'role');
  if (spec.rule === 'wide') {
    if (!gatesOnRole) {
      check(true, `${name}: accepts everyone the creator app lets in`, 'no role gate at all — open to any signed-in account');
      continue;
    }
    const missing = CREATOR_APP.filter((r) => !roles.has(r));
    check(missing.length === 0,
      `${name}: accepts everyone the creator app lets in`,
      missing.length ? 'REFUSES ' + missing.join(', ') + ' — ' + spec.why : [...roles].join(', '));
  } else {
    check(roles.size > 0, `${name}: still gates on a role at all`, [...roles].join(', ') || 'NO ROLE CHECK FOUND');
  }
}

/* ── every function under supabase/functions that gates on a creator-app
      role must be classified above. A new one fails until it is. ─────── */
const all = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const unclassified = all.filter((n) => {
  if (EXPECTED[n]) return false;
  const p = `${dir}/${n}/index.ts`;
  if (!existsSync(p)) return false;
  const src = readFileSync(p, 'utf8');
  /* only the ones a creator or applicant could plausibly reach */
  return /actor\.role\s*===\s*'creator'|'creator'[^\]]*\]\.includes\(\s*(?:String\(\s*)?actor\.role/.test(src);
});
check(unclassified.length === 0,
  'every creator-facing function is classified wide or narrow',
  unclassified.length ? 'UNCLASSIFIED: ' + unclassified.join(', ') : 'none new');

/* ── WHO IS STAFF, answered the same way in all three places ───────────
      Added 2026-09-15, when Ads Manager became staff. "Staff" is written
      down three times: STAFF_ROLES in the app, is_staff() in the database,
      and a hand-typed test in each Edge Function. Miss one and an Ads Manager
      gets a screen whose queries return nothing, or a Save that answers
      "Not allowed" — the exact fault this file was written for. ───────── */
const ctx = readFileSync('src/lib/auth/auth-context.ts', 'utf8');
const staffDecl = ctx.match(/STAFF_ROLES\s*=\s*\[([^\]]+)\]/);
const STAFF = staffDecl ? [...staffDecl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
check(STAFF.includes('ops') && STAFF.includes('admin'), 'the app has a STAFF_ROLES list', STAFF.join(', ') || 'NOT FOUND');

/* the LAST migration to define is_staff() is the one in force */
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
let dbStaff = null;
for (const f of migs) {
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8');
  const def = sql.match(/function public\.is_staff\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/);
  if (def) dbStaff = { file: f, roles: [...def[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) };
}
check(Boolean(dbStaff) && STAFF.length === dbStaff.roles.length && STAFF.every((r) => dbStaff.roles.includes(r)),
  'STAFF_ROLES matches is_staff() in the database',
  dbStaff ? `app [${STAFF.join(', ')}] · ${dbStaff.file} [${dbStaff.roles.join(', ')}]` : 'is_staff() NOT FOUND');

/* every function that admits ops must admit every staff role */
const lagging = [];
for (const n of all) {
  const p = `${dir}/${n}/index.ts`;
  if (!existsSync(p)) continue;
  const src = readFileSync(p, 'utf8');
  if (!/role\s*[!=]==\s*'ops'|'ops'[^\]]*\]\.includes\(/.test(src)) continue;
  const missing = STAFF.filter((r) => !src.includes(`'${r}'`));
  if (missing.length) lagging.push(`${n} (no ${missing.join(', ')})`);
}
check(lagging.length === 0, 'every Edge Function that admits ops admits every staff role',
  lagging.join(' · ') || 'all agree');

/* ── and the account menu (it replaced the Profile TikTok card) must never print a server string at a person ───────── */
const card = readFileSync('src/components/creator/account/AccountMenu.tsx', 'utf8');
check(!/\{\(act\.error as Error\)\.message\}/.test(card),
  'the TikTok card does not print a raw server error');
check(/function humanError/.test(card),
  'it translates refusals into something a person can act on');

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
