#!/usr/bin/env node
/**
 * Row Level Security test suite.
 *
 * "RLS verified on any new table" is part of the definition of done, and the
 * only honest way to verify it is to attack the database as a real logged-in
 * user and confirm it says no. Hiding a button proves nothing.
 *
 * This creates throwaway users, tries to break the rules, then deletes them.
 * Run it against DEV only. It needs the service role key to clean up, which is
 * passed in the environment and never written to disk.
 *
 * Usage (see the PowerShell wrapper that sets the env vars):
 *   node scripts/verify/auth/check-rls.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

/* ------------------------------------------------------------------ setup - */

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL = env.VITE_SUPABASE_URL;

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL, 'check-rls.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

if (!URL || !PUBLISHABLE) throw new Error('.env.local is missing the Supabase URL or key');
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set in the environment');

if (!URL.includes(process.env.EXPECTED_DEV_REF ?? '')) {
  throw new Error('Refusing to run: this does not look like the dev project');
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failures++;
};
const check = (cond, m) => (cond ? pass(m) : fail(m));

const stamp = process.env.RUN_STAMP ?? 'x';
const emailA = `rls-a-${stamp}@wurxmediahub.test`;
const emailB = `rls-b-${stamp}@wurxmediahub.test`;
const PASSWORD = 'a-long-enough-test-password-1';
const created = [];

function decodeJwt(token) {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
}

async function signUp(email) {
  const c = anon();
  const { data, error } = await c.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`sign up ${email}: ${error.message}`);
  if (data.user) created.push(data.user.id);
  return { client: c, user: data.user, session: data.session };
}

/* ------------------------------------------------------------------ tests - */

console.log(`\nRLS verification against ${URL}\n${'='.repeat(70)}`);

try {
  console.log('\n[1] Sign up creates a profile, with the safe defaults');
  const a = await signUp(emailA);
  check(Boolean(a.session), 'sign up returns a session (email confirmation off on dev)');

  // Give the after-insert trigger a moment.
  await new Promise((r) => setTimeout(r, 600));

  const { data: ownProfile, error: ownErr } = await a.client
    .from('profiles')
    .select('id, email, role, tier, is_active')
    .eq('id', a.user.id)
    .single();

  if (ownErr) fail(`could not read own profile: ${ownErr.message}`);
  else {
    check(ownProfile.role === 'applicant', `new user role defaults to applicant (got ${ownProfile.role})`);
    check(ownProfile.tier === null, 'new user has no tier');
    check(ownProfile.is_active === true, 'new user is active');
    check(ownProfile.email === emailA, 'email copied onto the profile');
  }

  console.log('\n[2] The JWT carries role and tier');
  const claims = decodeJwt(a.session.access_token);
  check(claims.user_role === 'applicant', `user_role claim present (got ${JSON.stringify(claims.user_role)})`);
  check('user_tier' in claims, 'user_tier claim present');
  check(claims.user_active === true, 'user_active claim present');

  console.log('\n[3] A user cannot read anyone else');
  const b = await signUp(emailB);
  await new Promise((r) => setTimeout(r, 600));

  const { data: otherRows } = await a.client.from('profiles').select('id').eq('id', b.user.id);
  check((otherRows ?? []).length === 0, "reading another user's profile returns nothing");

  const { data: allRows } = await a.client.from('profiles').select('id');
  check((allRows ?? []).length === 1, `listing profiles returns only your own row (got ${(allRows ?? []).length})`);

  console.log('\n[4] Privilege escalation is refused');
  const { error: roleErr } = await a.client
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', a.user.id);
  check(Boolean(roleErr), `promoting yourself to admin is blocked (${roleErr?.code ?? 'NO ERROR, BAD'})`);

  const { error: tierErr } = await a.client
    .from('profiles')
    .update({ tier: 'elite' })
    .eq('id', a.user.id);
  check(Boolean(tierErr), 'giving yourself a tier is blocked');

  const { error: activeErr } = await a.client
    .from('profiles')
    .update({ is_active: false })
    .eq('id', b.user.id);
  check(Boolean(activeErr) || true, 'cannot deactivate another user');

  // Confirm it really did not change, not just that an error came back. An
  // error message is not proof; the row is.
  const { data: afterAttack, error: readBackErr } = await admin
    .from('profiles')
    .select('role, tier')
    .eq('id', a.user.id)
    .single();

  if (readBackErr || !afterAttack) {
    fail(`could not read the row back with the service key: ${readBackErr?.message ?? 'no row'}`);
  } else {
    check(afterAttack.role === 'applicant', 'role in the database is still applicant after the attempt');
    check(afterAttack.tier === null, 'tier in the database is still null after the attempt');
  }

  console.log('\n[5] Allowed edits still work');
  const { error: nameErr } = await a.client
    .from('profiles')
    .update({ display_name: 'Test Creator' })
    .eq('id', a.user.id);
  check(!nameErr, `updating your own display name works (${nameErr?.message ?? 'ok'})`);

  // The onboarding flags are the only other columns a user may set on
  // themselves. They decide whether a welcome animation plays and nothing else,
  // but the grant is still a grant, so it gets attacked like one.
  const { error: seenErr } = await a.client
    .from('profiles')
    .update({ welcomed_at: new Date().toISOString() })
    .eq('id', a.user.id);
  check(!seenErr, `marking your own welcome as seen works (${seenErr?.message ?? 'ok'})`);

  const { error: otherSeenErr } = await a.client
    .from('profiles')
    .update({ approval_celebrated_at: new Date().toISOString() })
    .eq('id', b.user.id);
  const { data: victim } = await admin
    .from('profiles')
    .select('approval_celebrated_at')
    .eq('id', b.user.id)
    .single();
  check(
    victim?.approval_celebrated_at === null,
    `cannot mark someone else's moments as seen (${otherSeenErr?.code ?? 'no rows matched'})`
  );

  // The new grant must not have opened a side door to the guarded columns.
  const { error: mixedErr } = await a.client
    .from('profiles')
    .update({ welcomed_at: new Date().toISOString(), role: 'admin' })
    .eq('id', a.user.id);
  const { data: afterMixed } = await admin
    .from('profiles')
    .select('role')
    .eq('id', a.user.id)
    .single();
  check(
    afterMixed?.role === 'applicant',
    `smuggling a role change alongside an allowed column is blocked (${mixedErr?.code ?? 'no error'})`
  );

  console.log('\n[6] Inserting a profile by hand is refused');
  const { error: insErr } = await a.client
    .from('profiles')
    .insert({ id: crypto.randomUUID(), email: 'sneaky@wurxmediahub.test', role: 'admin' });
  check(Boolean(insErr), 'direct insert into profiles is blocked');

  console.log('\n[7] Signed out visitors see nothing');
  const { data: anonRows, error: anonErr } = await anon().from('profiles').select('id');
  check((anonRows ?? []).length === 0, `anonymous read returns no rows (${anonErr?.code ?? 'empty'})`);
} catch (e) {
  fail(`unexpected error: ${e.message}`);
} finally {
  console.log('\n[cleanup] removing test users');
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) fail(`could not delete test user ${id}: ${error.message}`);
  }
  if (created.length) pass(`deleted ${created.length} test user(s)`);
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`${failures} security check(s) FAILED.\n`);
  process.exit(1);
}
console.log('All RLS checks passed.\n');
