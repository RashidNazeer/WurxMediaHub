#!/usr/bin/env node
/*
 * ADS MANAGER IS STAFF — and the read-only roles still are not.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-ads-manager.mjs
 *
 * Rashid made Ads Manager full staff on 2026-09-15: "the same edit access as
 * asad and rashid". This proves it where it is actually decided, the database
 * and the Edge Functions, and runs every probe a second time as an Affiliate
 * Team Lead. A probe that cannot fail for the read-only role proves nothing
 * for the staff one.
 *
 * NOTHING REAL IS CHANGED. The only write is a no-op: one Paid Collabs deal's
 * `category` set to the value it already holds. Allowed, PostgREST hands the
 * row back; refused under RLS, it hands back nothing with a cheerful 204. So
 * the evidence is the number of rows returned, never the absence of an error.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const svc = createClient(URL_, KEY, { auth: { persistSession: false } });
const svcWb = createClient(URL_, KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const PW = 'Probe!' + Math.random().toString(36).slice(2, 10);

/* Tables only staff may read. Each is counted with the service key at the
   moment of the probe, so "reads every row" can never be satisfied by an
   empty table, nor broken by a probe account appearing in `profiles`. */
const STAFF_TABLES = ['profiles', 'applications', 'brands', 'offers', 'audit_log'];

const { data: deal } = await svcWb.from('creators').select('id, category').limit(1).single();
check(Boolean(deal), 'there is a Paid Collabs deal to probe with', deal ? '' : 'THIS CHECK SAW NOTHING');

const claimOf = (token) => {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).user_role; }
  catch { return null; }
};

const made = [];
const probe = async (role) => {
  const email = `probe-${role}-${Date.now()}@wurxmedia.com`;
  const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
  if (error) throw error;
  made.push(data.user.id);
  const { error: ue } = await svc.from('profiles').update({ role, is_active: true }).eq('id', data.user.id);
  if (ue) throw ue;
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await c.auth.signInWithPassword({ email, password: PW });
  if (se) throw se;
  return { c, token: s.session.access_token };
};

try {
  for (const [role, staff] of [['ads_manager', true], ['affiliate_team_lead', false]]) {
    const who = await probe(role);
    check(claimOf(who.token) === role, `${role}: the token carries the role`, String(claimOf(who.token)));

    for (const t of STAFF_TABLES) {
      const { count: truth } = await svc.from(t).select('*', { count: 'exact', head: true });
      const { count } = await who.c.from(t).select('*', { count: 'exact', head: true });
      if (staff) {
        check(truth > 0 && count === truth, `${role}: reads every row of public.${t}`, `${count} of ${truth}`);
      } else {
        const want = t === 'profiles' ? 1 : 0;   // its own profile, nothing else
        check(count === want, `${role}: still cannot read public.${t}`, `${count} rows`);
      }
    }

    if (deal) {
      const { data: back } = await who.c.schema('wurxbase').from('creators')
        .update({ category: deal.category }).eq('id', deal.id).select('id');
      const n = back?.length ?? 0;
      check(staff ? n === 1 : n === 0,
        `${role}: ${staff ? 'CAN' : 'still cannot'} write a Paid Collabs deal`, `${n} row(s) written`);
      const { data: after } = await svcWb.from('creators').select('category').eq('id', deal.id).single();
      check(after?.category === deal.category, `${role}: and that deal holds exactly what it held`,
        JSON.stringify(after?.category));
    }

    /* The staff gate in an Edge Function. An empty body is refused by
       validation (400) AFTER the gate, and by the gate itself (403) before it,
       so the status alone says which side of the gate the caller landed on —
       and nothing is ever saved. */
    const res = await fetch(`${URL_}/functions/v1/manage-brand`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${who.token}`, apikey: ANON, 'Content-Type': 'application/json' },
      body: '{}',
    });
    check(staff ? res.status === 400 : res.status === 403,
      `${role}: manage-brand ${staff ? 'lets them past the staff gate' : 'still refuses them'}`,
      `HTTP ${res.status}`);

    await who.c.auth.signOut();
  }
} finally {
  for (const id of made) {
    const { error } = await svc.auth.admin.deleteUser(id);
    if (error) fail.push(`probe account left behind: ${id} — ${error.message}`);
  }
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
