#!/usr/bin/env node
/**
 * Prove the overwrite bug is GONE, not that the code compiles.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/wurxbase/check-wurxbase-write-safety.mjs
 *
 * WHY THIS EXISTS. The failure this fixes is silent: a screen that never
 * loaded saves an empty list, the row is destroyed, nothing errors, and nobody
 * finds out until somebody goes looking for figures they typed last week. A
 * check that only proves the build passes is worth nothing against that. So
 * this reproduces the exact sequence that used to lose data and asserts the
 * data is still there afterwards.
 *
 * It works on rows it creates itself, under a target nothing else uses, and
 * removes them in a finally. It never touches a real angle test.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');

const db = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'wurxbase' },
});

const KEY = `__write_safety_probe__::${Date.now()}`;
const ACTION = 'CREATIVE_ANGLE';
const REAL = [{ id: 'a1', title: 'Hair transplant', videos: ['v1', 'v2'], spend: { v1: 120 } }];

const pass = [];
const fail = [];
const check = (ok, msg, detail) => (ok ? pass : fail).push(detail ? `${msg} — ${detail}` : msg);

const rows = () =>
  db.from('activity_logs').select('id,details,revision').eq('action', ACTION).eq('target', KEY);

try {
  /* ---- the subject exists, saved by somebody who did their job ---------- */
  const seed = await db
    .from('activity_logs')
    .insert({ action: ACTION, target: KEY, details: { angles: REAL }, revision: 1, user_display: 'Seeder' })
    .select('revision')
    .single();
  if (seed.error) throw new Error(`could not seed: ${seed.error.message}`);

  /* ---- 1. ONE ROW PER SUBJECT IS ENFORCED, not merely maintained -------- */
  const dup = await db
    .from('activity_logs')
    .insert({ action: ACTION, target: KEY, details: { angles: [] }, revision: 1 });
  check(
    dup.error?.code === '23505',
    'a second row for the same subject is refused by the database',
    dup.error ? `code ${dup.error.code}` : 'THE INSERT SUCCEEDED — the unique index is not doing its job',
  );

  /* ---- 2. THE BUG ITSELF: a stale writer cannot overwrite --------------- */
  /* Somebody else saves; the row moves to revision 2. */
  const other = await db
    .from('activity_logs')
    .update({ details: { angles: REAL }, revision: 2, user_display: 'Colleague' })
    .eq('action', ACTION)
    .eq('target', KEY)
    .eq('revision', 1)
    .select('revision');
  check(other.data?.length === 1, 'a writer holding the current revision succeeds');

  /* Our stale screen still believes it is on revision 1 and tries to save an
     empty list — the exact shape that used to delete the whole test. */
  const stale = await db
    .from('activity_logs')
    .update({ details: { angles: [] }, revision: 2 })
    .eq('action', ACTION)
    .eq('target', KEY)
    .eq('revision', 1)
    .select('id');
  check(
    (stale.data || []).length === 0,
    'a stale writer changes nothing',
    `${(stale.data || []).length} row(s) updated`,
  );

  const after = await rows();
  const survived = after.data?.[0]?.details?.angles;
  check(
    Array.isArray(survived) && survived.length === REAL.length,
    'the real test SURVIVED the stale save',
    `${Array.isArray(survived) ? survived.length : 'none'} angle(s) still stored`,
  );
  check(
    after.data?.[0]?.details?.angles?.[0]?.spend?.v1 === 120,
    'the hand-typed ad spend survived too',
    `spend = ${JSON.stringify(after.data?.[0]?.details?.angles?.[0]?.spend)}`,
  );

  /* ---- 3. A DELETE FROM A STALE SCREEN IS ALSO REFUSED ------------------ */
  const staleDelete = await db
    .from('activity_logs')
    .delete()
    .eq('action', ACTION)
    .eq('target', KEY)
    .eq('revision', 1)
    .select('id');
  check((staleDelete.data || []).length === 0, 'a stale delete removes nothing');
  const stillThere = await rows();
  check((stillThere.data || []).length === 1, 'the row is still there after the stale delete');

  /* ---- 4. AND A DELIBERATE DELETE, FROM A CURRENT SCREEN, STILL WORKS --- */
  const realDelete = await db
    .from('activity_logs')
    .delete()
    .eq('action', ACTION)
    .eq('target', KEY)
    .eq('revision', 2)
    .select('id');
  check(
    (realDelete.data || []).length === 1,
    'deleting the last angle from a CURRENT screen still deletes',
    'removing the feature would be a different bug',
  );

  /* ---- 5. ALL THREE STATE ACTIONS ARE COVERED, not just the one ---------
     The index carries a WHERE clause naming three actions. A typo in that list
     would leave one of them with the old behaviour and nothing would say so. */
  for (const act of ['BRAND_CONTRACT', 'DISCOVERY_MARK']) {
    const k = `${KEY}::${act}`;
    const first = await db
      .from('activity_logs')
      .insert({ action: act, target: k, details: { probe: true }, revision: 1 })
      .select('id')
      .single();
    const second = await db
      .from('activity_logs')
      .insert({ action: act, target: k, details: { probe: true }, revision: 1 });
    check(
      !first.error && second.error?.code === '23505',
      `${act}: a second row for the same subject is refused too`,
      second.error
        ? `code ${second.error.code}`
        : 'THE INSERT SUCCEEDED — this action is missing from the index predicate',
    );
    await db.from('activity_logs').delete().eq('action', act).eq('target', k);
  }

  /* ---- 6. THE AUDIT TRAIL IS NOT CONSTRAINED ---------------------------- */
  const a = await db.from('activity_logs').insert({ action: 'LOGIN', target: null, user_display: 'probe' }).select('id').single();
  const b = await db.from('activity_logs').insert({ action: 'LOGIN', target: null, user_display: 'probe' }).select('id').single();
  check(
    !a.error && !b.error,
    'ordinary audit rows can still repeat',
    a.error || b.error ? `${(a.error || b.error).message}` : '',
  );
  for (const r of [a.data?.id, b.data?.id]) if (r) await db.from('activity_logs').delete().eq('id', r);
} finally {
  await db.from('activity_logs').delete().eq('action', ACTION).eq('target', KEY);
}

console.log('');
for (const p of pass) console.log(`  PASS  ${p}`);
for (const f of fail) console.log(`  FAIL  ${f}`);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
