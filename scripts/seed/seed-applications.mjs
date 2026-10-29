#!/usr/bin/env node
/**
 * Seed demo applications on DEV so the review queue has something in it.
 *
 * Every account it creates uses an @wurxmediahub.demo address and a known
 * password, so they are obvious as test data and easy to remove again. Never
 * run this against prod: CLAUDE.md is explicit that prod never gets test data.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-applications.mjs
 *   SUPABASE_SERVICE_KEY=... node scripts/seed/seed-applications.mjs --clean
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(env.VITE_SUPABASE_URL, 'seed-applications.mjs');

const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(env.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const DOMAIN = '@wurxmediahub.demo';
const PASSWORD = 'demo-password-for-dev-only-1';

const PEOPLE = [
  { handle: 'skinbyamara', niche: 'Beauty & skincare', worked: true },
  { handle: 'thegymledger', niche: 'Fitness & recovery', worked: false },
  { handle: 'nadiacooksfast', niche: 'Food & kitchen', worked: false },
  { handle: 'dailywithdev', niche: 'Health & wellness', worked: true },
  { handle: 'thelaurenedit', niche: 'Beauty & skincare', worked: false },
  { handle: 'homewithkeeley', niche: 'Home & living', worked: false },
  { handle: 'marcusliftsheavy', niche: 'Fitness & recovery', worked: true },
];

const clean = process.argv.includes('--clean');

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw new Error(`could not list users: ${listErr.message}`);
const existing = new Map(
  list.users.filter((u) => u.email?.endsWith(DOMAIN)).map((u) => [u.email, u.id])
);

if (clean) {
  console.log(`\nRemoving ${existing.size} demo account(s) from ${env.VITE_SUPABASE_URL}\n`);
  for (const [email, id] of existing) {
    // Audit rows outlive the account by design, so clear the demo ones too.
    await admin.from('audit_log').delete().eq('actor_id', id);
    await admin.from('audit_log').delete().eq('target_user_id', id);
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(error ? `  FAILED  ${email}  ${error.message}` : `  removed  ${email}`);
  }
  console.log('\nDone.\n');
  process.exit(0);
}

console.log(`\nSeeding demo applications into ${env.VITE_SUPABASE_URL}\n`);

for (const p of PEOPLE) {
  const email = `${p.handle}${DOMAIN}`;
  let userId = existing.get(email);

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: p.handle },
    });
    if (error) {
      console.log(`  FAILED  ${email}  ${error.message}`);
      continue;
    }
    userId = data.user.id;
  }

  const { error: appErr } = await admin.from('applications').upsert(
    {
      user_id: userId,
      tiktok_handle: p.handle,
      niche: p.niche,
      worked_with_wurx: p.worked,
      video_links: [
        `https://www.tiktok.com/@${p.handle}/video/7301234567890123456`,
        `https://www.tiktok.com/@${p.handle}/video/7309876543210987654`,
      ].join('\n'),
    },
    { onConflict: 'user_id' }
  );

  console.log(
    appErr ? `  FAILED  ${p.handle}  ${appErr.message}` : `  ready    @${p.handle}`
  );
}

console.log(`\nAll of them sign in with the password: ${PASSWORD}`);
console.log('Remove them again with: node scripts/seed/seed-applications.mjs --clean\n');
