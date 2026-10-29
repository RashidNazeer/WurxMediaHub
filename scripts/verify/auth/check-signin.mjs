#!/usr/bin/env node
/**
 * Does signing in actually produce a usable identity, on whichever project you
 * point it at?
 *
 * THE FAILURE THIS EXISTS FOR is the quietest one there is. If the custom access
 * token hook is not enabled, sign-in SUCCEEDS and the token carries no
 * `user_role` and no `user_tier`. Every policy in the database then treats the
 * person as a stranger: the app loads, the password works, and nothing they own
 * is visible. Nothing errors. Production launched on 2026-08-26 in exactly that
 * state, because enabling the hook is an Auth setting and no migration can
 * reach it.
 *
 * READ `user_role`, NEVER `role`. `role` is Supabase's own built-in claim and is
 * ALWAYS the string 'authenticated', on a working project and a broken one
 * alike. Reading it reported the hook dead on a production launch where it was
 * working perfectly, twice, before the mistake was mine and not the config's.
 *
 * It creates ONE throwaway account and deletes it in a `finally`. That is the
 * only way to see inside a real token; nothing is left behind.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_PUBLISHABLE_KEY=... \
 *     node scripts/verify/auth/check-signin.mjs
 */

import { createClient } from '@supabase/supabase-js';

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !SERVICE || !PUBLISHABLE) {
  throw new Error('SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_PUBLISHABLE_KEY must be set');
}

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });
const email = `signin-check-${Date.now()}@wurx.test`;
const password = 'SignInCheck!2026';

let pass = 0;
let fail = 0;
const ok = (l) => {
  console.log(`  PASS  ${l}`);
  pass++;
};
const bad = (l) => {
  console.error(`  FAIL  ${l}`);
  fail++;
};

console.log(`\nSigning in against ${URL_BASE}\n`);
let id = null;

try {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  id = data.user.id;

  /* The trigger that mirrors auth.users into profiles has to have fired, or
     nobody who signs up ever gets a row and the whole app has no identity. */
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, tier')
    .eq('id', id)
    .maybeSingle();
  if (profile) ok(`the profiles row was created by trigger (role=${profile.role})`);
  else bad('no profiles row was created — the auth trigger is missing');

  const anon = createClient(URL_BASE, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);
  ok('sign-in works');

  const claims = JSON.parse(
    Buffer.from(session.session.access_token.split('.')[1], 'base64').toString('utf8')
  );
  if (claims.user_role) {
    ok(
      `the token carries the app claims: user_role=${claims.user_role}, ` +
        `user_tier=${claims.user_tier}, user_active=${claims.user_active}`
    );
  } else {
    bad(
      'no user_role in the token — the ACCESS TOKEN HOOK IS NOT ENABLED. ' +
        'Authentication -> Hooks -> Customize Access Token. ' +
        `Claims seen: ${Object.keys(claims).join(', ')}`
    );
  }

  /* And deny-by-default holds: a brand new account must see only itself. */
  const { data: others } = await anon.from('profiles').select('id');
  if (others && others.length <= 1) ok(`RLS holds: this account sees ${others.length} profile row(s)`);
  else bad(`RLS LEAK: a brand new account can see ${others?.length} profile rows`);

  await anon.auth.signOut();
} finally {
  if (id) {
    await admin.auth.admin.deleteUser(id);
    console.log(`  ..    removed the throwaway account`);
  }
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. Signing in produces a real identity here.\n`);
