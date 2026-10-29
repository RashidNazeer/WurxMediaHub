#!/usr/bin/env node
/**
 * Create (or promote) an admin account.
 *
 * Admin, ops and creative strategist accounts are NEVER created through the
 * website. Public sign up always produces an 'applicant', and the database will
 * not let anyone change their own role. Staff accounts are made here, with the
 * service role key, by someone who already has it.
 *
 * Safe to re-run: if the account already exists it is promoted rather than
 * duplicated.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/create-admin.mjs <email> <password> [role]
 *
 * role defaults to 'admin'. Valid: admin, ops, creative_strategist.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const [email, password, role = 'admin'] = process.argv.slice(2);

if (!email || !password) {
  console.error('Usage: node scripts/ops/create-admin.mjs <email> <password> [role]');
  process.exit(1);
}
if (!['admin', 'ops', 'creative_strategist'].includes(role)) {
  console.error(`Refusing: "${role}" is not a staff role.`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set in the environment');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

console.log(`\nTarget project: ${env.VITE_SUPABASE_URL}`);
console.log(`Account: ${email}  ->  role ${role}\n`);

// Does the account already exist?
const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw new Error(`could not list users: ${listErr.message}`);

let user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (user) {
  console.log('  Account already exists, updating the password.');
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`could not update the account: ${error.message}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // Confirmed on creation: staff never receive a confirmation email, and this
    // works the same whether or not email delivery is set up yet.
    email_confirm: true,
    user_metadata: { display_name: email.split('@')[0] },
  });
  if (error) throw new Error(`could not create the account: ${error.message}`);
  user = data.user;
  console.log('  Account created.');
}

// The trigger on auth.users already made the profile with role 'applicant'.
// Promote it. This runs as the service role, which the guard trigger allows.
await new Promise((r) => setTimeout(r, 700));

const { error: roleErr } = await admin
  .from('profiles')
  .update({ role, is_active: true })
  .eq('id', user.id);

if (roleErr) throw new Error(`could not set the role: ${roleErr.message}`);

const { data: profile, error: readErr } = await admin
  .from('profiles')
  .select('id, email, role, tier, is_active')
  .eq('id', user.id)
  .single();

if (readErr) throw new Error(`could not read the profile back: ${readErr.message}`);

console.log('\n  Result:');
console.log(`    id        ${profile.id}`);
console.log(`    email     ${profile.email}`);
console.log(`    role      ${profile.role}`);
console.log(`    active    ${profile.is_active}`);

if (profile.role !== role) {
  console.error(`\n  FAILED: role is ${profile.role}, expected ${role}`);
  process.exit(1);
}

console.log(`\n  Done. Sign in at /login. The role only reaches the JWT on the`);
console.log(`  next sign in, so sign out first if you were already logged in.\n`);
