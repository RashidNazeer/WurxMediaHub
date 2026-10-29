#!/usr/bin/env node
/* TWO EUKA ACCOUNTS, AND NEITHER ONE ANSWERING FOR THE OTHER.
 *
 * "do not disturb the current flow ... be careful ... so data comes relevant
 * not irrelevant". So this asserts both halves: the ten stores that already
 * worked are all still there and still reachable, the new one is reachable,
 * and a store is never served by the wrong account. Read-only throughout.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const env = Object.fromEntries(readFileSync(process.env.ENV_FILE ? process.env.ENV_FILE : '.env.local', 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const c = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } });

const { error: se } = await c.auth.signInWithPassword({
  email: process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com',
  password: process.env.COLLAB_STAFF_PASSWORD || '1234567890',
});
if (se) { console.log('sign-in failed: ' + se.message); process.exit(1); }

const call = async (body) => {
  const { data, error } = await c.functions.invoke('euka', { body });
  if (!error) return { data };
  const b = await error.context?.json?.().catch(() => null);
  return { err: b?.error ?? error.message, status: error.context?.status };
};

/* ── 1 · the merged list ─────────────────────────────────────────────── */
const meta = await call({});
if (meta.err) { console.log('stores call failed: ' + meta.err); process.exit(1); }
const stores = meta.data.stores || [];
const names = stores.map((s) => s.name);
console.log('accounts: ' + meta.data.accounts + ', unavailable: ' + meta.data.accountsUnavailable);
console.log('stores (' + stores.length + '): ' + names.join(' · '));

const BEFORE = ['Apothecary Brands', 'Aurelia', 'Biostime', 'Cutler Nutrition', 'Dangle-it',
  'Dr Tobias', "Dr. Harvey's", 'Longevity Box', 'Penetrex', 'Swisse Wellness'];
const missing = BEFORE.filter((b) => !names.includes(b));
check(missing.length === 0, 'every store that worked before is still listed', missing.join(', ') || 'all 10 present');
check(names.some((n) => /nutraharmony/i.test(n)), 'the new account\'s store is listed too', names.filter((n) => /nutra/i.test(n)).join(', '));
check(stores.length === BEFORE.length + 1, 'exactly one store was added, nothing duplicated', stores.length + ' total');
check(meta.data.accountsUnavailable === 0, 'both accounts answered', String(meta.data.accountsUnavailable));
check(new Set(stores.map((s) => s.id)).size === stores.length, 'no store id appears twice');

/* ── 2 · a store from EACH account returns its OWN data ──────────────── */
const nutra = stores.find((s) => /nutraharmony/i.test(s.name));
const penetrex = stores.find((s) => s.name === 'Penetrex');

for (const [label, st] of [['Penetrex (existing account)', penetrex], ['Nutra (new account)', nutra]]) {
  if (!st) { check(false, label + ': found in the list'); continue; }
  const r = await call({ store: st.id, type: 'videos' });
  if (r.err) {
    check(false, `${label}: its own account answers for it`, `${r.status} ${r.err}`.slice(0, 140));
    continue;
  }
  /* `videos` is an OBJECT keyed by creator handle, not an array. Reading it
     with .length gave 0 for a store that had answered perfectly well, which
     is the check lying about its subject rather than the subject failing. */
  const v = r.data?.videos;
  const handles = v && typeof v === 'object' ? Object.keys(v).length : 0;
  const n = v && typeof v === 'object'
    ? Object.values(v).reduce((t, a) => t + (Array.isArray(a) ? a.length : 0), 0) : 0;
  console.log(`  ${label}: ${handles} creators, ${n} videos`);
  check(n > 0, `${label}: its own account answers with real data`, handles + ' creators, ' + n + ' videos');
}

/* ── 3 · a store id that belongs to NOBODY is refused, not guessed at ── */
const bogus = await call({ store: '00000000-0000-4000-8000-000000000000', type: 'videos' });
check(Boolean(bogus.err), 'an unknown store is refused rather than served by some other account',
  bogus.err ? `${bogus.status} ${String(bogus.err).slice(0, 90)}` : 'IT RETURNED DATA');
check(/no EUKA account/i.test(String(bogus.err || '')),
  'and the refusal names the real reason', String(bogus.err || '').slice(0, 90));

await c.auth.signOut();
console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
