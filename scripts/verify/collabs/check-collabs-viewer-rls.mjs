#!/usr/bin/env node
/*
 * THE BOUNDARY FOR THE READ-ONLY PAID COLLABS ROLES (two since 2026-09-15).
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-collabs-viewer-rls.mjs
 *
 * Attack the database as each new role — asserting on EFFECT, not on errors.
 *
 * WHY THIS IS THE SECOND VERSION. The first asked "did the write return an
 * error?" and reported three security holes that do not exist. Under RLS a
 * DELETE or UPDATE whose USING clause excludes the row matches NOTHING, and
 * PostgREST answers a zero-row write with a cheerful 204. Absence of an error
 * is not evidence of refusal; the only evidence is whether the data moved.
 * So every write here is checked by reading the row back with the service key.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('d:/Milestone/WurxMediaHub/package.json');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
if (/prod/i.test(env.VITE_SUPABASE_URL || '')) throw new Error('.env.local points at production. Refusing.');
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const svcWb = createClient(env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });

const PW = 'Probe!' + Math.random().toString(36).slice(2, 10);
/* Not ads_manager: full staff since 2026-09-15, proven by check-ads-manager.mjs. */
const ROLES = ['affiliate_team_lead', 'operations_lead'];
const FORBIDDEN = ['brands', 'offers', 'contests', 'tiktok_video_daily', 'audit_log'];
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const before = (await svcWb.from('creators').select('*', { count: 'exact', head: true })).count;
console.log('creators before: ' + before);

const made = [];
try {
  for (const role of ROLES) {
    const email = `probe-${role}-${Date.now()}@wurxmedia.com`;
    const { data: created } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true });
    made.push(created.user.id);
    await svc.from('profiles').update({ role, is_active: true }).eq('id', created.user.id);

    const c = createClient(env.VITE_SUPABASE_URL, ANON, { auth: { persistSession: false } });
    const { error: se } = await c.auth.signInWithPassword({ email, password: PW });
    check(!se, `${role}: can sign in`, se?.message);
    if (se) continue;

    /* READ Paid Collabs — must work. */
    const { data: rows } = await c.schema('wurxbase').from('creators').select('id, name, category').limit(3);
    check(rows?.length > 0, `${role}: CAN read Paid Collabs`, `${rows?.length ?? 0} rows`);
    const target = rows?.[0];

    if (target) {
      /* UPDATE — verified by reading the row back with the service key. */
      const sentinel = 'RLS-PROBE-' + Math.random().toString(36).slice(2, 8);
      await c.schema('wurxbase').from('creators').update({ category: sentinel }).eq('id', target.id);
      const { data: after } = await svcWb.from('creators').select('category').eq('id', target.id).single();
      check(after?.category !== sentinel, `${role}: update CHANGED NOTHING`,
        after?.category === sentinel ? 'THE ROW WAS ACTUALLY MODIFIED' : `still ${JSON.stringify(after?.category)}`);

      /* THE STATUS DROPDOWN, exactly. It writes payment_status and videos,
         and column-level UPDATE grants are their own boundary here, so a
         refusal on `category` does not prove a refusal on these. Rashid
         asked this directly on 2026-09-02 and would not click it himself
         because the rows are real. */
      const { data: was } = await svcWb.from('creators')
        .select('payment_status, videos').eq('id', target.id).single();
      for (const patch of [
        { payment_status: 'Not Yet', videos: 'Done' },        // Payment Pending
        { payment_status: 'Not Yet', videos: 'In Progress' }, // Videos in Progress
        { payment_status: 'Paid' },                          // Payment Sent
      ]) {
        await c.schema('wurxbase').from('creators').update(patch).eq('id', target.id);
      }
      const { data: now } = await svcWb.from('creators')
        .select('payment_status, videos').eq('id', target.id).single();
      check(now?.payment_status === was?.payment_status && now?.videos === was?.videos,
        `${role}: status COLUMNS unchanged after all three menu options`,
        `was ${JSON.stringify(was)}, now ${JSON.stringify(now)}`);
      /* DELETE — verified by the row still existing. */
      await c.schema('wurxbase').from('creators').delete().eq('id', target.id);
      const { count: still } = await svcWb.from('creators').select('*', { count: 'exact', head: true }).eq('id', target.id);
      check(still === 1, `${role}: delete REMOVED NOTHING`, still === 1 ? 'row still present' : 'THE ROW IS GONE');
    }

    /* INSERT — this one does error, because WITH CHECK rejects outright. */
    const { error: ie } = await c.schema('wurxbase').from('creators').insert({ name: 'probe', brand: 'probe' });
    check(Boolean(ie), `${role}: cannot insert`, ie ? 'refused' : 'THE INSERT SUCCEEDED');

    /* The rest of the product stays invisible. */
    for (const t of FORBIDDEN) {
      const { data } = await c.from(t).select('*').limit(2);
      check(!data || data.length === 0, `${role}: cannot read public.${t}`, `${data?.length ?? 0} rows`);
    }
    /* profiles: own row only, never anyone else's. */
    const { data: profs } = await c.from('profiles').select('id');
    check(profs?.length === 1 && profs[0].id === created.user.id,
      `${role}: sees ONLY its own profile row`, `${profs?.length ?? 0} rows visible`);

    await c.auth.signOut();
  }
} finally {
  for (const id of made) await svc.auth.admin.deleteUser(id).catch(() => {});
}

const after = (await svcWb.from('creators').select('*', { count: 'exact', head: true })).count;
check(after === before, 'the probe destroyed nothing', `${before} before, ${after} after`);

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
