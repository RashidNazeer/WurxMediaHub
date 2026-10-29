#!/usr/bin/env node
/**
 * DEV ONLY. Drives `sync-creator-avatars` until every creator has been tried.
 *
 * The function refuses to fetch more than `limit` pictures in one call, partly
 * so a bug can never turn into hundreds of outbound requests and partly because
 * a long run would pass the function's own time limit. So a full sweep is
 * several calls, and this is the loop.
 *
 * SAFE TO STOP AND SAFE TO RERUN. A creator who has been tried is not tried
 * again, whether we found a picture or not, so the loop simply picks up where
 * it left off and settles at zero.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/sync-avatars.mjs
 *   ... --refresh          try everybody again, including the ones with no
 *                          picture and the ones we already have
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_ = env.VITE_SUPABASE_URL;
assertDevProject(URL_, 'sync-avatars.mjs');

const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const REFRESH = process.argv.includes('--refresh');
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/*
 * A throwaway admin, removed in the `finally`. The function will not take a
 * service key as a caller: it wants a real staff session, because who asked is
 * part of what it writes to the audit log.
 */
const email = `avatars-${Date.now().toString().slice(-6)}@wurxmediahub.test`;
const PASSWORD = 'a-long-enough-test-password-1';
let userId = null;

try {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(error.message);
  userId = created.user.id;
  const { error: roleErr } = await admin
    .from('profiles')
    .update({ role: 'admin', is_active: true })
    .eq('id', userId);
  if (roleErr) throw new Error(`could not make the runner an admin: ${roleErr.message}`);

  const client = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { data: sess } = await client.auth.getSession();

  const { count: creators } = await admin
    .from('creator_avatar_queue')
    .select('*', { count: 'exact', head: true });
  console.log(`\nCreator pictures${REFRESH ? ', refreshing everybody' : ''}`);
  console.log(`${'='.repeat(64)}`);
  console.log(`  ${creators} creators with a handle to look up\n`);

  let round = 0;
  let stored = 0;
  let missing = 0;
  let bytes = 0;

  // A bound rather than `while (true)`. If something is permanently unfetchable
  // the loop must still end.
  while (round < 12) {
    round++;
    const res = await fetch(`${URL_}/functions/v1/sync-creator-avatars`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${sess.session.access_token}`,
      },
      body: JSON.stringify({ limit: 25, refresh: REFRESH && round === 1 }),
    });
    const body = await res.json();
    if (!res.ok || body.error) {
      console.error(`  round ${round}: FAILED ${body.error ?? res.status}`);
      break;
    }

    stored += body.stored ?? 0;
    missing += body.missing ?? 0;
    bytes += body.bytes ?? 0;
    console.log(
      `  round ${String(round).padStart(2)}  ` +
        `${String(body.considered ?? 0).padStart(3)} tried  ` +
        `${String(body.stored ?? 0).padStart(3)} stored  ` +
        `${String(body.missing ?? 0).padStart(3)} none found`
    );
    for (const r of (body.results ?? []).filter((x) => !x.ok).slice(0, 5)) {
      console.log(`             ! ${r.handle}: ${r.note}`);
    }

    if ((body.considered ?? 0) === 0) break;
  }

  const { count: have } = await admin
    .from('creator_avatars')
    .select('*', { count: 'exact', head: true })
    .not('path', 'is', null);
  const { count: none } = await admin
    .from('creator_avatars')
    .select('*', { count: 'exact', head: true })
    .is('path', null);

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  ${have} creators have a picture, ${none} have none`);
  console.log(`  ${Math.round(bytes / 1024)}KB fetched this run over ${round} call(s)\n`);
} finally {
  if (userId) {
    await admin.from('audit_log').delete().eq('actor_id', userId);
    await admin.auth.admin.deleteUser(userId);
  }
}
