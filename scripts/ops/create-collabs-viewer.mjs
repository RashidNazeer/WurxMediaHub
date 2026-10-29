#!/usr/bin/env node
/**
 * Create (or repair) a read-only Paid Collabs login.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/create-collabs-viewer.mjs <email> <role> [password]
 *
 * Roles: affiliate_team_lead | operations_lead
 *
 * NOT ads_manager, since 2026-09-15: that role is full staff now. Use
 * scripts/ops/create-ads-manager.mjs for it.
 *
 * WHAT THESE ACCOUNTS CAN DO, so nobody has to guess later: read every Paid
 * Collabs tab, change nothing anywhere, and see no other screen in the product.
 * That is enforced by `public.is_collabs_viewer()` on the wurxbase SELECT
 * policies — not by the menu, which only decides what is drawn.
 *
 * REFUSES TO TOUCH AN EXISTING ACCOUNT'S ROLE unless it is already one of the
 * three. Pointing this at a colleague's admin login and silently demoting them
 * is the obvious way for this script to ruin somebody's day.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const ROLES = ['affiliate_team_lead', 'operations_lead'];
const [email, role, pwArg] = process.argv.slice(2);
if (!email || !ROLES.includes(role)) {
  console.error(`usage: create-collabs-viewer.mjs <email> <${ROLES.join('|')}> [password]`);
  process.exit(1);
}
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const db = createClient(env.VITE_SUPABASE_URL, KEY, { auth: { persistSession: false } });
const target = env.VITE_SUPABASE_URL;
console.log(`project: ${target}`);

const password = pwArg || '1234567890';
const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existing = (list?.users || []).find((u) => String(u.email).toLowerCase() === email.toLowerCase());

let id;
if (existing) {
  const { data: prof } = await db.from('profiles').select('role').eq('id', existing.id).single();
  if (prof && !ROLES.includes(prof.role)) {
    console.error(`REFUSING: ${email} already exists with role "${prof.role}". This script only creates or repairs the three read-only collabs roles.`);
    process.exit(1);
  }
  id = existing.id;
  console.log(`exists already, repairing: ${email}`);
} else {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  id = data.user.id;
  console.log(`created: ${email}`);
}

const { error: pe } = await db.from('profiles')
  .update({ role, is_active: true, display_name: email.split('@')[0] })
  .eq('id', id);
if (pe) throw pe;

const { data: check } = await db.from('profiles').select('email, role, is_active').eq('id', id).single();
console.log(`  -> ${check.email}  role=${check.role}  active=${check.is_active}`);
console.log('  reads Paid Collabs, writes nothing, sees no other screen.');
