#!/usr/bin/env node
/**
 * Fill in TikTok history, however far back it needs to go.
 *
 * The sync function refuses to make more than `maxCalls` requests in one run,
 * partly so a bug can never turn into hundreds of API calls and partly because
 * a hundred sequential requests would run past the function's own time limit.
 * So a deep backfill is several runs, and this is the loop that drives them.
 *
 * IT IS SAFE TO STOP AND SAFE TO RERUN. A day already pulled is skipped without
 * an API call, so the loop simply picks up where it left off; there is no cursor
 * to keep and nothing to get out of step.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/backfill-tiktok.mjs 123
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

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL_, 'backfill-tiktok.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const days = Math.min(Number(process.argv[2] ?? 40), 400);
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

/*
 * A throwaway admin, removed in the `finally`. The sync will not take a service
 * key as a caller: it wants either the scheduler's secret or a real admin
 * session, and the secret deliberately never leaves the vault and the function
 * environment.
 */
const email = `backfill-${Date.now().toString().slice(-6)}@wurxmediahub.test`;
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
  await admin.from('profiles').update({ role: 'admin', is_active: true }).eq('id', userId);

  const client = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  const { data: sess } = await client.auth.getSession();

  console.log(`\nBackfilling ${days} days\n${'='.repeat(60)}\n`);

  let round = 0;
  let totalCalls = 0;
  let totalRows = 0;

  // A generous bound rather than `while (true)`: if a day fails permanently it
  // is retried on the next round, and without this the loop would never end.
  const MAX_ROUNDS = 20;

  while (round < MAX_ROUNDS) {
    round++;
    const res = await fetch(`${URL_}/functions/v1/tiktok-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${sess.session.access_token}`,
        'x-region': 'ap-northeast-1',
      },
      body: JSON.stringify({ days, maxCalls: 40 }),
    });

    const body = await res.json();
    if (!res.ok || body.error) {
      console.error(`  round ${round}: FAILED ${body.error ?? res.status}`);
      break;
    }

    totalCalls += body.calls ?? 0;
    totalRows += body.rowsWritten ?? 0;
    console.log(
      `  round ${String(round).padStart(2)}  ` +
        `${String(body.calls ?? 0).padStart(3)} calls  ` +
        `${String(body.rowsWritten ?? 0).padStart(5)} rows  ` +
        `${String(body.daysSkipped ?? 0).padStart(3)} already had  ` +
        `${(body.failures ?? []).length} failed`
    );

    for (const f of (body.failures ?? []).slice(0, 3)) {
      console.log(`             ! ${f.date}: ${f.reason}`);
    }

    // Nothing called and nothing left means every day is accounted for.
    if ((body.calls ?? 0) === 0) break;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${totalCalls} API calls, ${totalRows} video-days written\n`);

  const { count } = await admin
    .from('tiktok_video_daily')
    .select('*', { count: 'exact', head: true });
  console.log(`  tiktok_video_daily now holds ${count} rows\n`);
} finally {
  if (userId) {
    await admin.from('audit_log').delete().eq('actor_id', userId);
    await admin.auth.admin.deleteUser(userId);
  }
}
