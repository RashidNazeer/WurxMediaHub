#!/usr/bin/env node
/**
 * Create (or repair) an Ads Manager login.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/create-ads-manager.mjs <email> <password> [display name]
 *
 * AN ADS MANAGER IS FULL STAFF, since 2026-09-15. Rashid: "ads manager will
 * have the same edit access as asad and rashid has which means they can edit
 * anything". Same reach as Ops in the admin app, `superadmin` inside Paid
 * Collabs. Proven by `pnpm verify:ads-manager`.
 *
 * REFUSES TO RE-ROLE AN ACCOUNT THAT ALREADY HOLDS ANOTHER ROLE, except a
 * fresh `applicant` — which is what signing up on the site yourself produces.
 * Pointing this at a creator or an admin by mistake must not quietly change
 * who they are.
 *
 * Runs against whatever `.env.local` points at. That is dev.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const [email, password, ...nameParts] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: create-ads-manager.mjs <email> <password> [display name]');
  process.exit(1);
}
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const db = createClient(env.VITE_SUPABASE_URL, KEY, { auth: { persistSession: false } });
console.log(`project: ${env.VITE_SUPABASE_URL}`);

const display = nameParts.join(' ').trim() || email.split('@')[0];
const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existing = (list?.users || []).find((u) => String(u.email).toLowerCase() === email.toLowerCase());

let id;
if (existing) {
  const { data: prof } = await db.from('profiles').select('role').eq('id', existing.id).single();
  if (prof && !['ads_manager', 'applicant'].includes(prof.role)) {
    console.error(`REFUSING: ${email} already exists with role "${prof.role}".`);
    process.exit(1);
  }
  id = existing.id;
  /* A repair sets the password too: the reason to run this on an existing
     account is nearly always that somebody cannot get in. */
  const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
  if (error) throw error;
  console.log(`exists already, repairing: ${email}`);
} else {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  id = data.user.id;
  console.log(`created: ${email}`);
}

const { error: pe } = await db.from('profiles')
  .update({ role: 'ads_manager', tier: null, is_active: true, display_name: display })
  .eq('id', id);
if (pe) throw pe;

const { data: check } = await db.from('profiles').select('email, role, is_active, display_name').eq('id', id).single();
console.log(`  -> ${check.email}  role=${check.role}  active=${check.is_active}  name=${check.display_name}`);
const { data: all } = await db.from('profiles').select('email').eq('role', 'ads_manager');
console.log(`  Ads Managers on this project now: ${(all || []).map((p) => p.email).join(', ')}`);
