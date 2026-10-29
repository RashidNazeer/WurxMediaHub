#!/usr/bin/env node
/**
 * ONE TIKTOK ACCOUNT, ONE APPLICATION — PROVED AGAINST THE REAL DATABASE.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/tiktok/check-tiktok-identity.mjs
 *
 * Rashid, 2026-09-28: "the same person should never be able to apply again",
 * and a rejection must not be permanent — "we should let admin review the
 * rejected again".
 *
 * EVERY ASSERTION PROVES ITS SUBJECT EXISTS BEFORE PROVING IT BLOCKS. That is
 * the mistake this repo has made five times: a guard that "passes" because the
 * row it was supposed to block was never there. So the second claim is only
 * counted as refused AFTER the first claim has been read back out of the table.
 *
 * It writes real rows, because a constraint cannot be tested through a mock —
 * every one is named ZZ-TIKTOK-IDENTITY-CHECK, and the last assertion is that
 * none of them survived.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
const SVC = process.env.SUPABASE_SERVICE_KEY;
if (!SVC) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const TAG = 'ZZ-TIKTOK-IDENTITY-CHECK';
const OPEN_A = `zzcheck-open-a-${TAG}`;
const OPEN_B = `zzcheck-open-b-${TAG}`;
const made = { users: [], identities: [] };

const mkUser = async (n) => {
  const email = `zz.identity.${n}.${TAG.toLowerCase()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Zz!check-9999-aaaa', email_confirm: true,
  });
  if (error) throw new Error(`creating test user ${n}: ${error.message}`);
  made.users.push(data.user.id);
  return data.user.id;
};

const connect = async (profileId, openId) =>
  admin.from('creator_tiktok_connections').insert({
    creator_id: profileId, open_id: openId, display_name: TAG, scope: 'user.info.basic,video.list',
  });

try {
  /* ── 0. the table and the rule exist at all ───────────────────────────── */
  const { error: tblErr } = await admin.from('tiktok_identities').select('id').limit(1);
  check(!tblErr, 'the identity ledger exists and is readable with the service key', tblErr?.message);
  if (tblErr) throw new Error('no ledger — nothing below can mean anything');

  const idA = await mkUser('a');
  const idB = await mkUser('b');
  /* The profile rows are made by a trigger on auth.users; make sure they landed
     before anything depends on them. */
  for (const id of [idA, idB]) {
    const { data } = await admin.from('profiles').select('id').eq('id', id).single();
    check(!!data, `a profile exists for test user ${id.slice(0, 8)}`);
  }

  /* ── 1. connecting claims the account (the trigger, not TypeScript) ───── */
  const { error: c1 } = await connect(idA, OPEN_A);
  check(!c1, 'creator A can connect a TikTok account', c1?.message);
  const { data: claim1 } = await admin.from('tiktok_identities').select('*').eq('open_id', OPEN_A);
  made.identities.push(...(claim1 ?? []).map((r) => r.id));
  check((claim1 ?? []).length === 1, 'connecting WROTE a claim to the ledger, via the database trigger',
    `${(claim1 ?? []).length} rows`);
  check(claim1?.[0]?.profile_id === idA, 'and the claim points at the creator who connected');
  check(claim1?.[0]?.app_generation === 'sandbox-2026', 'and records which TikTok app key vouched for it',
    claim1?.[0]?.app_generation);

  /* ── 2. THE RULE. Second creator, same TikTok account. ────────────────── */
  /* The guard above proves the blocking row is really there. Only now is a
     refusal meaningful. */
  const { error: c2 } = await connect(idB, OPEN_A);
  const { data: claim2 } = await admin.from('tiktok_identities').select('id').eq('open_id', OPEN_A);
  check((claim2 ?? []).length === 1, 'a SECOND creator claiming the same TikTok account adds no second claim',
    `${(claim2 ?? []).length} claims for one open_id`);
  /* The connection insert itself may succeed or be refused by the older partial
     index; what must not happen is a second live claim. */
  check(true, 'second connect attempt returned', c2 ? `refused: ${String(c2.message).slice(0, 60)}` : 'accepted (claim still deduped)');

  /* ── 3. DISCONNECTING MUST NOT UNBAR ──────────────────────────────────── */
  await admin.from('creator_tiktok_connections')
    .update({ revoked_at: new Date().toISOString() }).eq('creator_id', idA);
  const { data: afterRevoke } = await admin.from('tiktok_identities')
    .select('id, released_at').eq('open_id', OPEN_A);
  check((afterRevoke ?? []).length === 1 && !afterRevoke[0].released_at,
    'disconnecting does NOT release the claim — the bar outlives the connection',
    JSON.stringify(afterRevoke));

  /* ── 4. A STAFF RELEASE RE-OPENS IT, and is the only thing that does ─── */
  const target = afterRevoke?.[0]?.id;
  /* First: a non-staff caller must be refused. Sign in as the test creator. */
  const asCreator = createClient(URL_, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } });
  const { data: sess } = await asCreator.auth.signInWithPassword({
    email: `zz.identity.a.${TAG.toLowerCase()}@example.invalid`, password: 'Zz!check-9999-aaaa',
  });
  check(!!sess?.session, 'the test creator can sign in (so the refusal below is about ROLE, not a failed login)');
  const { error: denied } = await asCreator.rpc('release_tiktok_identity',
    { p_identity_id: target, p_reason: 'should not work' });
  check(!!denied, 'a creator CANNOT release a TikTok identity', denied ? 'refused' : 'IT WAS ALLOWED');

  /* A reason is required even for staff. */
  const { error: noReason } = await admin.rpc('release_tiktok_identity',
    { p_identity_id: target, p_reason: '   ' });
  check(!!noReason, 'a release without a reason is refused', noReason ? 'refused' : 'IT WAS ALLOWED');

  const { error: relErr } = await admin.rpc('release_tiktok_identity',
    { p_identity_id: target, p_reason: `${TAG} release` });
  check(!relErr, 'staff CAN release it', relErr?.message);
  const { data: released } = await admin.from('tiktok_identities').select('released_at').eq('id', target).single();
  check(!!released?.released_at, 'and the claim is marked released');

  /* ── 5. AFTER A RELEASE, THE SAME ACCOUNT CAN CLAIM AGAIN ─────────────── */
  /* This is the assertion that catches the obvious-but-wrong design where the
     unique index is not partial and the release button does nothing. */
  await admin.from('creator_tiktok_connections').delete().eq('creator_id', idB);
  const { error: c3 } = await connect(idB, OPEN_A);
  const { data: claim3 } = await admin.from('tiktok_identities').select('id, profile_id, released_at').eq('open_id', OPEN_A);
  made.identities.push(...(claim3 ?? []).map((r) => r.id));
  const live = (claim3 ?? []).filter((r) => !r.released_at);
  check(!c3 && live.length === 1 && live[0].profile_id === idB,
    'a RELEASED account can be claimed again, by someone else — the release button really releases',
    `${(claim3 ?? []).length} total claims, ${live.length} live${c3 ? `, connect error: ${c3.message}` : ''}`);

  /* ── 6. HANDLES ───────────────────────────────────────────────────────── */
  const appRow = (userId, handle) => ({
    user_id: userId, tiktok_handle: handle, niche: 'Beauty',
    worked_with_wurx: false, video_links: 'https://www.tiktok.com/@zzcheck/video/1',
  });
  const { error: appA } = await admin.from('applications').insert(appRow(idA, `zzcheck_${TAG.toLowerCase().slice(0, 12)}`));
  check(!appA, 'a test application can be created', appA?.message);

  /* An applicant may not set the verified flag: it is in no column grant. */
  const { error: flagErr } = await asCreator.from('applications')
    .update({ tiktok_handle_verified: true }).eq('user_id', idA);
  check(!!flagErr, 'an applicant CANNOT mark their own handle as verified',
    flagErr ? String(flagErr.message).slice(0, 70) : 'IT WAS ALLOWED');

  /* Staff marks it verified, then the applicant may not change the handle. */
  await admin.from('applications').update({ tiktok_handle_verified: true }).eq('user_id', idA);
  const { data: isVer } = await admin.from('applications').select('tiktok_handle_verified').eq('user_id', idA).single();
  check(isVer?.tiktok_handle_verified === true, 'staff CAN mark a handle verified (so the next check is meaningful)');
  const { error: editErr } = await asCreator.from('applications')
    .update({ tiktok_handle: 'somethingelse' }).eq('user_id', idA);
  check(!!editErr, 'an applicant CANNOT change a handle TikTok verified',
    editErr ? String(editErr.message).slice(0, 70) : 'IT WAS ALLOWED');

  /* Two applications cannot both hold the same VERIFIED handle. */
  const sharedHandle = `zzcheck_${TAG.toLowerCase().slice(0, 12)}`;
  await admin.from('applications').insert(appRow(idB, sharedHandle.toUpperCase()));
  const { error: dupVer } = await admin.from('applications')
    .update({ tiktok_handle_verified: true }).eq('user_id', idB);
  check(!!dupVer, 'two applications cannot both hold the same VERIFIED handle, in any letter case',
    dupVer ? 'refused' : 'IT WAS ALLOWED');

  /* ── 7. the backfill counted everything it should have ───────────────── */
  const { count: conns } = await admin.from('creator_tiktok_connections')
    .select('*', { count: 'exact', head: true }).not('open_id', 'ilike', `%${TAG}%`);
  const { data: realIds } = await admin.from('tiktok_identities').select('open_id').not('open_id', 'ilike', `%${TAG}%`);
  check((realIds ?? []).length >= (conns ?? 0),
    'every pre-existing connection has a claim in the ledger (backfill)',
    `${(realIds ?? []).length} claims for ${conns ?? 0} connections`);
} catch (e) {
  check(false, 'the check ran to completion', String(e.message).slice(0, 160));
} finally {
  /* ── cleanup, then PROVE it ─────────────────────────────────────────── */
  /*
   * CLAIMS ARE DELETED LAST, AFTER THE ACCOUNTS.
   *
   * Deleting them first left two behind: a claim outlives its account by
   * design, so anything that touches a connection after the sweep can put one
   * back, and the sweep has already run. Ordering it last makes the cleanup
   * independent of what the rest of the teardown does.
   */
  /*
   * DELETING THE ACCOUNT CAN FAIL, AND SWALLOWING THAT LEAVES A ROW BEHIND.
   * It did: one run hit a network blip, `.catch(() => {})` ate it, and a test
   * application survived — which the final assertion then caught, three steps
   * after the thing that actually went wrong. Retry, and say so.
   */
  const undeleted = [];
  for (const id of made.users) {
    await admin.from('creator_tiktok_connections').delete().eq('creator_id', id);
    await admin.from('applications').delete().eq('user_id', id);
    let gone = false;
    for (let i = 0; i < 3 && !gone; i++) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (!error) gone = true;
      else await new Promise((r) => setTimeout(r, 800));
    }
    if (!gone) undeleted.push(id);
  }
  check(undeleted.length === 0, 'every test account was deleted', undeleted.join(', '));
  await admin.from('tiktok_identities').delete().ilike('open_id', `%${TAG}%`);
  const { data: leftIds } = await admin.from('tiktok_identities').select('id').ilike('open_id', `%${TAG}%`);
  const { data: leftApps } = await admin.from('applications').select('id').ilike('tiktok_handle', `%zzcheck%`);
  check((leftIds ?? []).length === 0, 'no test claim survived the cleanup', `${(leftIds ?? []).length} left`);
  check((leftApps ?? []).length === 0, 'no test application survived the cleanup', `${(leftApps ?? []).length} left`);
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
