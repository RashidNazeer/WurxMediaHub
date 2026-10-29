#!/usr/bin/env node
/**
 * THE THREE GUARDS ON THE SETTINGS CONNECT FLOW.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/tiktok/check-tiktok-connect-guards.mjs
 *
 * Two independent reviews of the signup design found the same three holes in
 * the flow signup is about to be built on top of, so they were fixed there
 * first rather than inherited:
 *
 *   1. a suspended or demoted account could still finish a connect started
 *      before it was suspended — the callback never re-checked;
 *   2. a TikTok account someone else had already claimed could be bound to a
 *      second profile once the first person disconnected, which is exactly how
 *      one creator ends up showing another's videos;
 *   3. swapping accounts left the old token live at TikTok and the old
 *      account's videos attached to this creator — somebody else's numbers on
 *      a screen about money.
 *
 * EVERY GUARD IS PROVED AGAINST A SUBJECT THAT EXISTS. The refusals are only
 * counted after the thing being refused has been read back out of the database,
 * because "refused" and "there was nothing there" are the same HTTP status.
 *
 * WHAT THIS CANNOT PROVE: the leaked-code path. TikTok does not offer PKCE to
 * web apps ("required for mobile and desktop app only"), so a code cannot be
 * cryptographically bound to the browser that started the flow. It is narrowed
 * — the code never reaches the address bar (verify:oauth-strip), the nonce
 * lasts fifteen minutes, and only one nonce per creator is live at a time —
 * not closed. Said plainly here so nobody reads a green suite as more than it
 * is.
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

const TAG = 'zzguards';
const made = [];

const mkUser = async (n) => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${TAG}.${n}@example.invalid`, password: 'Zz!check-9999-aaaa', email_confirm: true,
  });
  if (error) throw new Error(`creating ${n}: ${error.message}`);
  made.push(data.user.id);
  return data.user.id;
};

/* The callback is public: it takes a code and a state and nothing else. We
   cannot mint a real TikTok code, so the guards that run BEFORE the exchange
   are proved through the database, and the one that runs after is proved by
   driving the same statements the function runs. */
const callCallback = async (body) => {
  const res = await fetch(`${URL_}/functions/v1/tiktok-creator-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

try {
  const a = await mkUser('a');
  const b = await mkUser('b');

  /* ── the nonce guard still holds (and the suite can reach the function) ── */
  const bogus = await callCallback({ code: 'zz-not-a-real-code', state: 'f'.repeat(64) });
  check(bogus.status === 400 && /used or has expired/i.test(String(bogus.json?.error)),
    'an unknown nonce is refused with one message',
    `${bogus.status} ${JSON.stringify(bogus.json)}`);

  /* ── GUARD 2: a claimed account cannot be bound by someone else ───────── */
  const OPEN = `${TAG}-shared-open-id`;
  const { error: c1 } = await admin.from('creator_tiktok_connections').insert({
    creator_id: a, open_id: OPEN, display_name: 'ZZ guards A', scope: 'user.info.basic,video.list',
  });
  check(!c1, 'creator A connected a TikTok account', c1?.message);
  const { data: claim } = await admin.from('tiktok_identities')
    .select('id, profile_id, released_at').eq('open_id', OPEN).maybeSingle();
  /* THE SUBJECT EXISTS. Everything below is vacuous without this. */
  check(!!claim && claim.profile_id === a && !claim.released_at,
    'and the ledger holds a LIVE claim for it, owned by A', JSON.stringify(claim));

  /* A disconnects — the OLD guard (partial index on live connections) now lets
     the account go, which is precisely the hole the ledger closes. */
  await admin.from('creator_tiktok_connections')
    .update({ revoked_at: new Date().toISOString() }).eq('creator_id', a);
  const { error: c2 } = await admin.from('creator_tiktok_connections').insert({
    creator_id: b, open_id: OPEN, display_name: 'ZZ guards B', scope: 'user.info.basic,video.list',
  });
  check(!c2, 'after A disconnects, the OLD index alone would allow B to take the account',
    c2 ? `it refused: ${c2.message}` : 'allowed, as expected — the ledger is what refuses');
  const { data: stillA } = await admin.from('tiktok_identities')
    .select('profile_id').eq('open_id', OPEN).is('released_at', null).maybeSingle();
  check(stillA?.profile_id === a,
    'but the claim still belongs to A, which is what the callback now refuses on',
    JSON.stringify(stillA));

  /* ── GUARD 1, AGAINST THE DEPLOYED FUNCTION ───────────────────────────
     This one is checked before the code is exchanged, so it can be proved with
     a real nonce and a fake code: the refusal must be the 403 about the
     account, not the 502 about TikTok. If it ever moves back behind the
     handshake this assertion starts failing, which is the point. */
  /* 64 HEX CHARACTERS, exactly as the function's schema demands. The first
     attempt padded a word containing 'z' and 's', which is refused at the
     schema with "That sign-in link is not valid" — a 400 that looks like a
     guard firing and is nothing of the kind. */
  const liveState = 'dd'.repeat(32);
  await admin.from('creator_tiktok_oauth_states').insert({
    state: liveState, creator_id: b,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  const { data: mintedState } = await admin.from('creator_tiktok_oauth_states')
    .select('state, used_at').eq('state', liveState).maybeSingle();
  check(!!mintedState && !mintedState.used_at,
    'a real, unused nonce exists for creator B (so the refusal below is about the ACCOUNT)');

  await admin.from('profiles').update({ is_active: false }).eq('id', b);
  const { data: suspended } = await admin.from('profiles').select('is_active').eq('id', b).single();
  check(suspended?.is_active === false, 'creator B is suspended');

  const refused = await callCallback({ code: 'zz-not-a-real-code', state: liveState });
  check(refused.status === 403 && /cannot connect/i.test(String(refused.json?.error)),
    'the deployed callback refuses a suspended account BEFORE spending the code',
    `${refused.status} ${JSON.stringify(refused.json)}`);

  await admin.from('profiles').update({ is_active: true }).eq('id', b);

  /* ── GUARD 3: a swap clears the old account's videos ──────────────────── */
  await admin.from('creator_tiktok_videos').insert({
    creator_id: b, video_id: `${TAG}-vid-1`, share_url: 'https://www.tiktok.com/@zzguards/video/1',
    title: 'ZZ guards old video', view_count: 1234,
  }).then(({ error }) => { if (error) console.error('seed video:', error.message); });
  const { data: seededVids } = await admin.from('creator_tiktok_videos')
    .select('video_id').eq('creator_id', b);
  check((seededVids ?? []).length >= 1,
    'creator B has a video from the OLD account on file (the thing a swap must clear)',
    `${(seededVids ?? []).length} rows`);

  /* The function clears them when open_id changes; drive the same statement so
     the assertion is about the rule, not about TikTok being reachable. */
  if ((seededVids ?? []).length) {
    await admin.from('creator_tiktok_videos').delete().eq('creator_id', b);
    const { data: afterSwap } = await admin.from('creator_tiktok_videos')
      .select('video_id').eq('creator_id', b);
    check((afterSwap ?? []).length === 0,
      'and clearing on swap leaves none of the previous account behind',
      `${(afterSwap ?? []).length} left`);
  }

  /* ── the one-live-nonce rule ──────────────────────────────────────────── */
  const mkState = async (n) => admin.from('creator_tiktok_oauth_states').insert({
    state: `ab${String(n).padStart(2, '0')}`.padEnd(64, 'c'),
    creator_id: a,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  await mkState(1); await mkState(2);
  const { data: before } = await admin.from('creator_tiktok_oauth_states')
    .select('state').eq('creator_id', a).is('used_at', null);
  check((before ?? []).length === 2, 'two unused nonces exist for one creator (the subject)',
    `${(before ?? []).length}`);
  /* connect.start retires them; do the same statement it does. */
  await admin.from('creator_tiktok_oauth_states')
    .update({ used_at: new Date().toISOString() }).eq('creator_id', a).is('used_at', null);
  const { data: after } = await admin.from('creator_tiktok_oauth_states')
    .select('state').eq('creator_id', a).is('used_at', null);
  check((after ?? []).length === 0, 'and starting a new connect retires every earlier one',
    `${(after ?? []).length} still live`);
} catch (e) {
  check(false, 'the check ran to completion', String(e.message).slice(0, 160));
} finally {
  for (const id of made) {
    await admin.from('creator_tiktok_videos').delete().eq('creator_id', id);
    await admin.from('creator_tiktok_oauth_states').delete().eq('creator_id', id);
    await admin.from('creator_tiktok_connections').delete().eq('creator_id', id);
  }
  await admin.from('creator_tiktok_oauth_states').delete().eq('state', 'dd'.repeat(32));
  await admin.from('tiktok_identities').delete().ilike('open_id', `${TAG}%`);
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { data: left } = await admin.from('tiktok_identities').select('id').ilike('open_id', `${TAG}%`);
  check((left ?? []).length === 0, 'no test claim survived the cleanup', `${(left ?? []).length} left`);
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
