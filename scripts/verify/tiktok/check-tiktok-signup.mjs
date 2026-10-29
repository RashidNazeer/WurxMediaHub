#!/usr/bin/env node
/**
 * TIKTOK-FIRST SIGNUP: the guards, not the happy path.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/tiktok/check-tiktok-signup.mjs
 *
 * The happy path cannot be driven from here — it needs a real TikTok
 * authorisation code, and a real person approving on tiktok.com. What CAN be
 * proved is everything that decides whether the wrong person gets in, which is
 * the part Rashid said he cannot absorb a bug in.
 *
 * THE POSTURE UNDER TEST: this flow mints no sessions. The browser creates the
 * account with the same `signUp` the apply form uses; the server only ever
 * answers "whoever holds this ticket proved they control TikTok account X". So
 * the assertions below are about the ticket, the browser binding and the
 * account it may be spent on — there is no session-minting code to attack.
 *
 * Every refusal is checked against a subject that exists first. "Refused" and
 * "there was nothing there" are the same HTTP status, and telling them apart is
 * the only thing that makes a green suite mean anything.
 */
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_KEY;
if (!SVC) { console.error('SUPABASE_SERVICE_KEY must be set'); process.exit(1); }

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const call = async (body, token) => {
  const res = await fetch(`${URL_}/functions/v1/tiktok-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const TAG = 'zzsignup';
const made = [];
const mkUser = async (n) => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${TAG}.${n}@example.invalid`, password: 'Zz!check-9999-aaaa', email_confirm: true,
  });
  if (error) throw new Error(`creating ${n}: ${error.message}`);
  made.push(data.user.id);
  return data.user.id;
};
const signIn = async (n) => {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data } = await c.auth.signInWithPassword({
    email: `${TAG}.${n}@example.invalid`, password: 'Zz!check-9999-aaaa',
  });
  return data?.session?.access_token ?? null;
};

try {
  /* ── start: a nonce is minted and TikTok is where we are sent ─────────── */
  const secret = randomBytes(32).toString('hex');
  const started = await call({ action: 'start', browserSecretHash: sha(secret) });
  check(started.status === 200 && /tiktok\.com/.test(String(started.json?.url)),
    'start returns a TikTok approval URL', `${started.status} ${String(started.json?.url).slice(0, 60)}`);
  const state = new URL(String(started.json?.url)).searchParams.get('state');
  check(/^[0-9a-f]{64}$/.test(String(state)), 'and the state on it is a 32-byte nonce');

  const { data: stateRow } = await admin.from('tiktok_signup_states')
    .select('state, browser_secret_hash, used_at').eq('state', state).maybeSingle();
  /* THE SUBJECT. Every refusal below is only meaningful because this row is
     real and unused. */
  check(!!stateRow && !stateRow.used_at, 'the nonce exists server side and is unused');
  check(stateRow?.browser_secret_hash === sha(secret),
    'and it stored the FINGERPRINT of the browser secret, never the secret',
    stateRow?.browser_secret_hash?.slice(0, 16));
  check(stateRow?.browser_secret_hash !== secret, 'the secret itself is nowhere in that row');

  /* ── finish: the browser binding is what stops a stolen state ─────────── */
  const wrongSecret = randomBytes(32).toString('hex');
  const wrongBrowser = await call({ action: 'finish', code: 'zz-not-a-real-code', state, browserSecret: wrongSecret });
  check(wrongBrowser.status === 400,
    'finishing from a DIFFERENT browser is refused, even with the right state',
    `${wrongBrowser.status} ${JSON.stringify(wrongBrowser.json)}`);

  const unknownState = await call({ action: 'finish', code: 'zz-not-a-real-code', state: 'a'.repeat(64), browserSecret: secret });
  check(unknownState.status === wrongBrowser.status
    && JSON.stringify(unknownState.json) === JSON.stringify(wrongBrowser.json),
    'and an unknown state gives the BYTE-IDENTICAL answer, so a live nonce cannot be probed for',
    `${JSON.stringify(unknownState.json)} vs ${JSON.stringify(wrongBrowser.json)}`);

  /* The nonce must survive a wrong-browser attempt rather than being burned by
     it — otherwise anyone could cancel a stranger's signup at will. */
  const { data: afterWrong } = await admin.from('tiktok_signup_states')
    .select('used_at').eq('state', state).maybeSingle();
  check(!afterWrong?.used_at,
    'a failed attempt does NOT burn the nonce, so nobody can cancel a stranger\'s sign-up');

  /* ── claim: needs a session, and a ticket, and the right browser ──────── */
  const noAuth = await call({ action: 'claim', ticket: randomBytes(32).toString('hex'), browserSecret: secret });
  check(noAuth.status === 401, 'claim without a session is refused', `${noAuth.status}`);

  const older = await mkUser('older');
  const olderTok = await signIn('older');
  check(!!olderTok, 'the test account can sign in');

  const bogus = await call({ action: 'claim', ticket: randomBytes(32).toString('hex'), browserSecret: secret }, olderTok);
  check(bogus.status === 409 && /expired|already/i.test(String(bogus.json?.error)),
    'claim with an unknown ticket is refused', `${bogus.status} ${JSON.stringify(bogus.json)}`);

  /* ── the account-age rule, which is what a stolen ticket runs into ────── */
  const OPEN = `${TAG}-open-id`;
  const ticketA = randomBytes(32).toString('hex');
  const { error: pendErr } = await admin.from('tiktok_signup_pending').insert({
    ticket_hash: sha(ticketA), browser_secret_hash: sha(secret),
    open_id: OPEN, handle: 'zzsignuphandle', display_name: 'ZZ Signup',
    scope: 'user.info.basic,video.list',
    access_token: 'zz-fake-access', refresh_token: 'zz-fake-refresh',
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  check(!pendErr, 'a proven-but-unclaimed TikTok identity exists (the subject)', pendErr?.message);

  /* `older` was created BEFORE that row, which is exactly the shape of a stolen
     ticket being attached to somebody's existing account. */
  const stolen = await call({ action: 'claim', ticket: ticketA, browserSecret: secret }, olderTok);
  check(stolen.status === 409 && /cannot be used with this account/i.test(String(stolen.json?.error)),
    'a ticket CANNOT be attached to an account that existed before it',
    `${stolen.status} ${JSON.stringify(stolen.json)}`);

  /* Now a genuinely new account: same row, but backdated so the account is the
     newer of the two, which is the real sequence in the product. */
  await admin.from('tiktok_signup_pending')
    .update({ created_at: new Date(Date.now() - 60 * 60_000).toISOString() })
    .eq('ticket_hash', sha(ticketA));
  const fresh = await mkUser('fresh');
  const freshTok = await signIn('fresh');

  /* Wrong browser, right ticket, right account: still refused. */
  const wrongB = await call({ action: 'claim', ticket: ticketA, browserSecret: wrongSecret }, freshTok);
  check(wrongB.status === 409 && /expired/i.test(String(wrongB.json?.error)),
    'and a ticket spent from a different browser is refused',
    `${wrongB.status} ${JSON.stringify(wrongB.json)}`);

  const claimed = await call({ action: 'claim', ticket: ticketA, browserSecret: secret }, freshTok);
  check(claimed.status === 200 && claimed.json?.ok,
    'the right ticket, the right browser and a NEW account binds',
    `${claimed.status} ${JSON.stringify(claimed.json)}`);

  const { data: conn } = await admin.from('creator_tiktok_connections')
    .select('open_id, revoked_at').eq('creator_id', fresh).maybeSingle();
  check(conn?.open_id === OPEN && !conn.revoked_at, 'a live connection was written', JSON.stringify(conn));
  const { data: tok } = await admin.from('creator_tiktok_tokens')
    .select('access_token').eq('creator_id', fresh).maybeSingle();
  check(tok?.access_token === 'zz-fake-access', 'and the TikTok token moved to the creator');
  const { data: pendAfter } = await admin.from('tiktok_signup_pending')
    .select('access_token, claimed_by').eq('ticket_hash', sha(ticketA)).maybeSingle();
  check(pendAfter?.access_token === null && pendAfter?.claimed_by === fresh,
    'the token was MOVED, not copied — none is left in the pending row',
    JSON.stringify(pendAfter));

  const { data: ident } = await admin.from('tiktok_identities')
    .select('profile_id, handle, source').eq('open_id', OPEN).is('released_at', null).maybeSingle();
  check(ident?.profile_id === fresh && ident?.handle === 'zzsignuphandle',
    'the identity ledger records the claim with the VERIFIED handle', JSON.stringify(ident));

  /* Idempotent: a double submit of the same form must not fail the person. */
  const again = await call({ action: 'claim', ticket: ticketA, browserSecret: secret }, freshTok);
  check(again.status === 200 && again.json?.already === true,
    'submitting the same form twice is idempotent, not an error',
    `${again.status} ${JSON.stringify(again.json)}`);

  /* ── the application takes the verified handle, whatever the browser says ── */
  const asFresh = createClient(URL_, ANON, { auth: { persistSession: false } });
  await asFresh.auth.signInWithPassword({ email: `${TAG}.fresh@example.invalid`, password: 'Zz!check-9999-aaaa' });
  const { error: appErr } = await asFresh.from('applications').insert({
    user_id: fresh, tiktok_handle: 'somebodyelseshandle', niche: 'Beauty',
    worked_with_wurx: false, video_links: 'https://www.tiktok.com/@zz/video/1',
  });
  check(!appErr, 'the new creator can submit their application', appErr?.message);
  const { data: app } = await admin.from('applications')
    .select('tiktok_handle, tiktok_handle_verified').eq('user_id', fresh).maybeSingle();
  check(app?.tiktok_handle === 'zzsignuphandle' && app?.tiktok_handle_verified === true,
    'and the stored handle is the one TIKTOK vouched for, not the one the browser sent',
    JSON.stringify(app));

  const { data: logged } = await admin.from('audit_log')
    .select('action, target_user_id').eq('action', 'tiktok_signup.claimed')
    .eq('target_user_id', fresh).limit(1);
  check((logged ?? []).length === 1, 'the claim was audited');
} catch (e) {
  check(false, 'the check ran to completion', String(e.message).slice(0, 200));
} finally {
  for (const id of made) {
    await admin.from('creator_tiktok_tokens').delete().eq('creator_id', id);
    await admin.from('creator_tiktok_connections').delete().eq('creator_id', id);
    await admin.from('applications').delete().eq('user_id', id);
  }
  await admin.from('tiktok_signup_pending').delete().ilike('open_id', `${TAG}%`);
  await admin.from('tiktok_signup_states').delete().ilike('browser_secret_hash', '%');
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {});
  await admin.from('tiktok_identities').delete().ilike('open_id', `${TAG}%`);
  const { data: left } = await admin.from('tiktok_identities').select('id').ilike('open_id', `${TAG}%`);
  check((left ?? []).length === 0, 'no test claim survived the cleanup', `${(left ?? []).length} left`);
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
